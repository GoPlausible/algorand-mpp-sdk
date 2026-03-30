import { Address } from "@algorandfoundation/algokit-utils";
import {
  type Transaction,
  TransactionType,
  type TransactionSigner,
  decodeSignedTransaction,
  decodeTransaction,
  encodeTransactionRaw,
} from "@algorandfoundation/algokit-utils/transact";
import { Method, Receipt, Store } from "mppx";

import {
  ALGORAND_MAINNET,
  DEFAULT_ALGOD_URLS,
  DEFAULT_MIN_FEE,
} from "../constants.js";
import * as Methods from "../Methods.js";
import {
  base64ToUint8Array,
  coSignBase64Transaction,
  computeRequiredFee,
} from "../utils/transactions.js";

// ── Algorand-specific error types per spec (RFC 9457 Problem Details) ──

const PROBLEM_BASE = "https://paymentauth.org/problems/algorand";

class AlgorandPaymentError extends Error {
  readonly type: string;
  readonly status = 402;

  constructor(type: string, message: string) {
    super(message);
    this.type = `${PROBLEM_BASE}/${type}`;
    this.name = "AlgorandPaymentError";
  }
}

/** Cannot decode credential, parse JSON, or required fields absent/wrong type. */
const malformedCredential = (detail: string) =>
  new AlgorandPaymentError("malformed-credential", detail);

/** Too many transactions (>16), mismatched Group IDs, or paymentIndex out of range. */
const groupInvalid = (detail: string) =>
  new AlgorandPaymentError("group-invalid", detail);

/** Group contains close, aclose, or rekey fields. */
const dangerousTransaction = (detail: string) =>
  new AlgorandPaymentError("dangerous-transaction", detail);

/** On-chain transfer doesn't match challenge. */
const transferMismatch = (detail: string) =>
  new AlgorandPaymentError("transfer-mismatch", detail);

/** Transaction group failed simulation or was rejected by network. */
const transactionFailed = (detail: string) =>
  new AlgorandPaymentError("transaction-failed", detail);

/** Server attempted to broadcast but Algorand rejected it. */
const broadcastFailed = (detail: string) =>
  new AlgorandPaymentError("broadcast-failed", detail);

/** Fee payer transaction structure is invalid (maps to group-invalid per spec). */
const feePayerInvalid = (detail: string) =>
  new AlgorandPaymentError("group-invalid", detail);

/**
 * Creates an Algorand `charge` method for usage on the server.
 *
 * The server receives a signed transaction group from the client,
 * optionally co-signs the fee payer transaction, simulates,
 * broadcasts, and verifies on-chain.
 *
 * @example
 * ```ts
 * import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/server'
 *
 * const mppx = Mppx.create({
 *   methods: [algorand.charge({
 *     recipient: 'ALGO_ADDRESS...',
 *     network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
 *   })],
 * })
 *
 * export async function handler(request: Request) {
 *   const result = await mppx.charge({ amount: '1000000', currency: 'ALGO' })(request)
 *   if (result.status === 402) return result.challenge
 *   return result.withReceipt(Response.json({ data: '...' }))
 * }
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const {
    recipient,
    asaId,
    decimals,
    network = ALGORAND_MAINNET,
    store = Store.memory(),
    signer,
    signerAddress,
  } = parameters;

  const algodUrl =
    parameters.algodUrl ??
    DEFAULT_ALGOD_URLS[network] ??
    DEFAULT_ALGOD_URLS[ALGORAND_MAINNET];

  // Validate addresses at config time (checksum verification per spec).
  try {
    Address.fromString(recipient);
  } catch {
    throw new Error(`Invalid recipient address: ${recipient}`);
  }
  if (signerAddress) {
    try {
      Address.fromString(signerAddress);
    } catch {
      throw new Error(`Invalid fee payer (signerAddress): ${signerAddress}`);
    }
  }

  if (asaId && decimals === undefined) {
    throw new Error("decimals is required when asaId is set");
  }

  return Method.toServer(Methods.charge, {
    defaults: {
      currency: asaId ? "ASA" : "ALGO",
      methodDetails: {
        challengeReference: "",
      },
      recipient: "",
    },

    async request({ credential, request }) {
      if (credential) {
        return credential.challenge.request as typeof request;
      }

      const challengeReference = crypto.randomUUID();

      // Derive lease from challengeReference: SHA-256(challengeReference).
      const leaseBytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(challengeReference),
        ),
      );
      const leaseB64 =
        typeof Buffer !== "undefined"
          ? Buffer.from(leaseBytes).toString("base64")
          : btoa(String.fromCharCode(...leaseBytes));

      // Fetch suggested params (MUST be present per spec).
      // Failure propagates as a 500 — the server cannot issue a
      // valid challenge without transaction parameters.
      const res = await fetch(`${algodUrl}/v2/transactions/params`);
      if (!res.ok) {
        throw new Error(`Algod unreachable: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as {
        fee: number;
        "genesis-hash": string;
        "genesis-id": string;
        "last-round": number;
        "min-fee": number;
      };
      const suggestedParams = {
        fee: data.fee ?? 0,
        firstValid: data["last-round"],
        lastValid: data["last-round"] + 1000,
        genesisHash: data["genesis-hash"],
        genesisId: data["genesis-id"],
        minFee: data["min-fee"] || Number(DEFAULT_MIN_FEE),
      };

      return {
        ...request,
        methodDetails: {
          network,
          challengeReference,
          lease: leaseB64,
          ...(asaId ? { asaId: String(asaId), decimals } : {}),
          ...(signer && signerAddress
            ? { feePayer: true, feePayerKey: signerAddress }
            : {}),
          suggestedParams,
        },
        recipient,
      };
    },

    async verify({ credential }) {
      const cred = credential as unknown as CredentialPayload;
      const challenge = cred.challenge.request;

      if (cred.payload.type !== "transaction") {
        throw malformedCredential(
          'Invalid payload type: must be "transaction"',
        );
      }

      return await verifyTransaction(
        cred,
        challenge,
        algodUrl,
        recipient,
        store,
        signer,
        signerAddress,
      );
    },
  });
}

// ── Server-broadcast verification (type="transaction") ──

async function verifyTransaction(
  credential: CredentialPayload,
  challenge: ChallengeRequest,
  algodUrl: string,
  recipient: string,
  store: Store.Store,
  signer?: TransactionSigner,
  signerAddress?: string,
) {
  const { paymentGroup, paymentIndex } = credential.payload;
  if (!paymentGroup || paymentGroup.length === 0) {
    throw malformedCredential("Missing paymentGroup in credential payload");
  }
  if (paymentIndex === undefined || paymentIndex === null) {
    throw malformedCredential("Missing paymentIndex in credential payload");
  }
  // Spec: group must contain only the payment and optionally a fee payer (max 2).
  const expectedSize = challenge.methodDetails.feePayer ? 2 : 1;
  if (paymentGroup.length > expectedSize) {
    throw groupInvalid(
      `paymentGroup has ${paymentGroup.length} transactions but expected at most ${expectedSize}`,
    );
  }
  if (paymentIndex < 0 || paymentIndex >= paymentGroup.length) {
    throw groupInvalid("paymentIndex out of range");
  }

  // Decode all transactions.
  // Try unsigned first: decodeSignedTransaction can incorrectly succeed on
  // raw unsigned bytes (producing garbage), so we check for the presence of
  // a signature to distinguish signed from unsigned.
  const decoded = paymentGroup.map((b64) => {
    const bytes = base64ToUint8Array(b64);
    try {
      const signed = decodeSignedTransaction(bytes);
      // Verify it's actually signed (has a non-empty sig field).
      if (signed.sig && signed.sig.length > 0) {
        return { signed, type: "signed" as const };
      }
    } catch {
      /* not a valid signed transaction */
    }
    return { unsigned: decodeTransaction(bytes), type: "unsigned" as const };
  });

  // Extract raw transactions for verification.
  const transactions = decoded.map((d) =>
    d.type === "signed" ? d.signed!.txn : d.unsigned!,
  );

  // Verify all transactions share the same group ID.
  verifyGroupId(transactions);

  // Step 4: Verify the payment transaction matches the challenge.
  const paymentTxn = transactions[paymentIndex];
  verifyPaymentDetails(paymentTxn, challenge, recipient);

  // Step 5: Check for dangerous fields on all transactions.
  for (const txn of transactions) {
    verifyNoDangerousFields(txn);
  }

  // Step 6: Verify lease if present in challenge.
  if (challenge.methodDetails.lease) {
    verifyLease(paymentTxn, challenge.methodDetails.lease);
  }

  // Step 7: Fee payer verification and co-signing.
  let finalGroup = [...paymentGroup];
  if (challenge.methodDetails.feePayer && signer && signerAddress) {
    const feePayerIndex = findFeePayerIndex(transactions, signerAddress);
    if (feePayerIndex === -1) {
      throw feePayerInvalid("Fee payer transaction not found in group");
    }

    // Step 7.8: Verify fee payer transaction is unsigned.
    if (decoded[feePayerIndex].type !== "unsigned") {
      throw feePayerInvalid(
        "Fee payer transaction must be unsigned (server will sign it)",
      );
    }

    // Resolve fee params from challenge's suggestedParams or use defaults.
    const minFee = challenge.methodDetails.suggestedParams?.minFee
      ? BigInt(challenge.methodDetails.suggestedParams.minFee)
      : DEFAULT_MIN_FEE;
    const feePerByte = challenge.methodDetails.suggestedParams?.fee
      ? BigInt(challenge.methodDetails.suggestedParams.fee)
      : 0n;

    // Compute pooled minimum using spec formula:
    //   sum(max(fee_per_byte * txn_size, min_fee)) for each txn
    const pooledMinimum = computePooledMinimum(
      transactions,
      feePerByte,
      minFee,
    );

    // Verify fee payer transaction structure and fee bounds.
    verifyFeePayerTransaction(
      transactions[feePayerIndex],
      signerAddress,
      pooledMinimum,
    );

    // Verify client transactions have fee=0 when fee payer is present (per spec).
    for (let i = 0; i < transactions.length; i++) {
      if (i === feePayerIndex) continue;
      const txnFee = transactions[i].fee;
      if (txnFee !== undefined && txnFee > 0n) {
        throw transferMismatch(
          `Client transaction at index ${i} has fee=${txnFee} but fee payer is covering fees — client fees must be 0`,
        );
      }
    }

    // Co-sign the fee payer transaction.
    const signedFeePayerB64 = await coSignBase64Transaction(
      signer,
      paymentGroup[feePayerIndex],
      transactions,
      feePayerIndex,
    );
    finalGroup[feePayerIndex] = signedFeePayerB64;
  }

  // Simulate the transaction group.
  await simulateGroup(algodUrl, finalGroup);

  // Broadcast the transaction group.
  const txid = await broadcastGroup(algodUrl, finalGroup);

  // Wait for confirmation (Algorand has instant finality).
  await waitForConfirmation(algodUrl, txid);

  // Mark consumed to prevent replay.
  await store.put(`algorand-charge:consumed:${txid}`, true);

  // Note: the spec defines a `challengeId` field in the receipt, but the
  // mppx Receipt schema does not support it. The challenge binding is
  // enforced by the mppx framework through the challenge-credential flow.
  return Receipt.from({
    method: "algorand",
    reference: txid,
    status: "success",
    timestamp: new Date().toISOString(),
  });
}

// ── Verification helpers ──

function verifyGroupId(transactions: Transaction[]) {
  if (transactions.length <= 1) return; // Single transactions don't need a group ID
  const firstGroupId = transactions[0].group;
  if (!firstGroupId) {
    throw groupInvalid("Transactions must have a group ID");
  }
  for (let i = 1; i < transactions.length; i++) {
    const groupId = transactions[i].group;
    if (!groupId || !arraysEqual(firstGroupId, groupId)) {
      throw groupInvalid("All transactions must share the same group ID");
    }
  }
}

function verifyPaymentDetails(
  txn: Transaction,
  challenge: ChallengeRequest,
  recipient: string,
) {
  const { asaId } = challenge.methodDetails;
  const expectedAmount = BigInt(challenge.amount);

  if (asaId) {
    if (txn.type !== TransactionType.AssetTransfer) {
      throw transferMismatch(
        `Expected asset transfer transaction, got ${txn.type}`,
      );
    }
    if (!txn.assetTransfer) {
      throw transferMismatch("Missing asset transfer fields");
    }
    if (txn.assetTransfer.assetId !== BigInt(asaId)) {
      throw transferMismatch(
        `ASA ID mismatch: expected ${asaId}, got ${txn.assetTransfer.assetId}`,
      );
    }
    if (txn.assetTransfer.amount !== expectedAmount) {
      throw transferMismatch(
        `Amount mismatch: expected ${expectedAmount}, got ${txn.assetTransfer.amount}`,
      );
    }
    if (txn.assetTransfer.receiver.toString() !== recipient) {
      throw transferMismatch(
        `Recipient mismatch: expected ${recipient}, got ${txn.assetTransfer.receiver}`,
      );
    }
  } else {
    if (txn.type !== TransactionType.Payment) {
      throw transferMismatch(`Expected payment transaction, got ${txn.type}`);
    }
    if (!txn.payment) {
      throw transferMismatch("Missing payment fields");
    }
    if (txn.payment.amount !== expectedAmount) {
      throw transferMismatch(
        `Amount mismatch: expected ${expectedAmount}, got ${txn.payment.amount}`,
      );
    }
    if (txn.payment.receiver.toString() !== recipient) {
      throw transferMismatch(
        `Recipient mismatch: expected ${recipient}, got ${txn.payment.receiver}`,
      );
    }
  }
}

function verifyLease(txn: Transaction, expectedLeaseB64: string) {
  const expectedLease =
    typeof Buffer !== "undefined"
      ? new Uint8Array(Buffer.from(expectedLeaseB64, "base64"))
      : (() => {
          const binary = atob(expectedLeaseB64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return bytes;
        })();

  if (!txn.lease) {
    throw transferMismatch("Payment transaction is missing lease (lx) field");
  }
  if (!arraysEqual(txn.lease, expectedLease)) {
    throw transferMismatch("Payment transaction lease does not match expected value");
  }
}

function verifyNoDangerousFields(txn: Transaction) {
  if (txn.payment?.closeRemainderTo) {
    throw dangerousTransaction("Transaction contains closeRemainderTo field");
  }
  if (txn.assetTransfer?.closeRemainderTo) {
    throw dangerousTransaction("Transaction contains close asset to field");
  }
  if (txn.rekeyTo) {
    throw dangerousTransaction("Transaction contains rekeyTo field");
  }
}

function findFeePayerIndex(
  transactions: Transaction[],
  feePayerAddress: string,
): number {
  return transactions.findIndex(
    (txn) =>
      txn.type === TransactionType.Payment &&
      txn.sender.toString() === feePayerAddress &&
      txn.payment?.amount === 0n,
  );
}

/**
 * Compute the pooled minimum fee for a transaction group using the spec formula:
 *   pooled_minimum = sum(max(fee_per_byte * txn_size, min_fee)) for each txn
 */
function computePooledMinimum(
  transactions: Transaction[],
  feePerByte: bigint,
  minFee: bigint,
): bigint {
  let total = 0n;
  for (const txn of transactions) {
    const encoded = encodeTransactionRaw(txn);
    total += computeRequiredFee(feePerByte, BigInt(encoded.length), minFee);
  }
  return total;
}

function verifyFeePayerTransaction(
  txn: Transaction,
  feePayerAddress: string,
  pooledMinimum: bigint,
) {
  if (txn.type !== TransactionType.Payment) {
    throw feePayerInvalid(
      "Fee payer transaction must be a payment transaction",
    );
  }
  if (txn.sender.toString() !== feePayerAddress) {
    throw feePayerInvalid("Fee payer sender does not match feePayerKey");
  }
  if (!txn.payment || txn.payment.amount !== 0n) {
    throw feePayerInvalid("Fee payer transaction amount must be 0");
  }
  const receiverStr = txn.payment.receiver.toString();
  if (receiverStr !== feePayerAddress) {
    throw feePayerInvalid(
      "Fee payer receiver must be the fee payer address (pay to self)",
    );
  }
  if (txn.payment.closeRemainderTo) {
    throw dangerousTransaction(
      "Fee payer transaction must not have closeRemainderTo",
    );
  }
  if (txn.rekeyTo) {
    throw dangerousTransaction("Fee payer transaction must not have rekeyTo");
  }
  // Verify fee covers pooled minimum with safety bound (3x) against fee griefing.
  const maxReasonableFee = pooledMinimum * 3n;
  if (txn.fee !== undefined && txn.fee < pooledMinimum) {
    throw feePayerInvalid(
      `Fee payer fee ${txn.fee} is below pooled minimum ${pooledMinimum}`,
    );
  }
  if (txn.fee !== undefined && txn.fee > maxReasonableFee) {
    throw feePayerInvalid(
      `Fee payer fee ${txn.fee} exceeds reasonable maximum ${maxReasonableFee}`,
    );
  }
}

// ── Algod RPC helpers ──

async function simulateGroup(
  algodUrl: string,
  paymentGroup: string[],
): Promise<void> {
  const request = {
    "txn-groups": [
      {
        txns: paymentGroup,
      },
    ],
    "allow-empty-signatures": true,
  };

  const response = await fetch(`${algodUrl}/v2/transactions/simulate`, {
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  const data = (await response.json()) as {
    "txn-groups"?: Array<{ "failure-message"?: string }>;
  };

  const failure = data["txn-groups"]?.[0]?.["failure-message"];
  if (failure) {
    throw transactionFailed(`Transaction simulation failed: ${failure}`);
  }
}

async function broadcastGroup(
  algodUrl: string,
  paymentGroup: string[],
): Promise<string> {
  const groupBytes = paymentGroup.map((b64) => base64ToUint8Array(b64));

  // Concatenate all transaction bytes.
  const totalLength = groupBytes.reduce((sum, b) => sum + b.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const bytes of groupBytes) {
    combined.set(bytes, offset);
    offset += bytes.length;
  }

  const response = await fetch(`${algodUrl}/v2/transactions`, {
    body: combined,
    headers: { "Content-Type": "application/x-binary" },
    method: "POST",
  });

  const data = (await response.json()) as { txId?: string; message?: string };
  if (!data.txId) {
    throw broadcastFailed(data.message ?? "unknown error");
  }

  return data.txId;
}

async function waitForConfirmation(
  algodUrl: string,
  txid: string,
  timeoutMs = 15_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`${algodUrl}/v2/transactions/pending/${txid}`);
    const data = (await response.json()) as {
      "confirmed-round"?: number;
      "pool-error"?: string;
    };

    if (data["confirmed-round"] && data["confirmed-round"] > 0) {
      return;
    }

    if (data["pool-error"]) {
      throw transactionFailed(`Transaction failed: ${data["pool-error"]}`);
    }

    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw transactionFailed("Transaction confirmation timeout");
}

// ── Helpers ──

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── Types ──

type CredentialPayload = {
  challenge: {
    id?: string;
    request: ChallengeRequest;
  };
  payload: {
    paymentGroup?: string[];
    paymentIndex?: number;
    type?: string;
  };
};

type ChallengeRequest = {
  amount: string;
  currency: string;
  methodDetails: {
    asaId?: string;
    challengeReference: string;
    decimals?: number;
    feePayer?: boolean;
    feePayerKey?: string;
    lease?: string;
    network?: string;
    suggestedParams?: {
      fee: number;
      firstValid: number;
      genesisHash: string;
      genesisId: string;
      lastValid: number;
      minFee: number;
    };
  };
  recipient: string;
};

export declare namespace charge {
  type Parameters = {
    /** ASA ID for token payments. If absent, payments are in native ALGO. */
    asaId?: bigint;
    /** Custom algod URL. Defaults to public API for the selected network. */
    algodUrl?: string;
    /** Token decimals (required when asaId is set). */
    decimals?: number;
    /** CAIP-2 network identifier. Defaults to Algorand MainNet. */
    network?: string;
    /** Algorand address of the account receiving payments. */
    recipient: string;
    /**
     * Server-side signer for fee sponsorship (feePayer mode).
     * When provided, the server's address is included in the challenge
     * as `feePayerKey`, and the server co-signs the fee payer transaction
     * before broadcasting.
     */
    signer?: TransactionSigner;
    /** The Algorand address corresponding to the signer. Required when signer is provided. */
    signerAddress?: string;
    /**
     * Pluggable key-value store for consumed-TxID tracking (replay prevention).
     * Defaults to in-memory. Use a persistent store in production.
     */
    store?: Store.Store;
  };
}
