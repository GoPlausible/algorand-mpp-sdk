import { Address } from "@algorandfoundation/algokit-utils";
import {
  Transaction,
  TransactionType,
  groupTransactions,
  encodeSignedTransaction,
  encodeTransactionRaw,
  decodeSignedTransaction,
  decodeTransaction,
  type SignedTransaction,
  type TransactionSigner,
} from "@algorandfoundation/algokit-utils/transact";

import {
  ALGORAND_MAINNET,
  DEFAULT_ALGOD_URLS,
  DEFAULT_MIN_FEE,
} from "../constants.js";

const textEncoder = new TextEncoder();

/** Suggested params for transaction construction. */
export type SuggestedTransactionParams = {
  firstValid: bigint;
  genesisHash: Uint8Array;
  genesisId: string;
  lastValid: bigint;
  /** Current network minimum fee per transaction in microalgos. */
  minFee: bigint;
};

/**
 * Build a payment transaction (ALGO or ASA).
 */
export function buildPaymentTransaction(params: {
  amount: bigint;
  asaId?: bigint;
  fee?: bigint;
  lease?: Uint8Array;
  note?: Uint8Array;
  receiver: string;
  sender: string;
  suggestedParams: SuggestedTransactionParams;
}): Transaction {
  const { sender, receiver, amount, asaId, fee, lease, note, suggestedParams } =
    params;

  if (asaId !== undefined) {
    // ASA transfer
    return new Transaction({
      type: TransactionType.AssetTransfer,
      sender: Address.fromString(sender),
      fee,
      firstValid: suggestedParams.firstValid,
      lastValid: suggestedParams.lastValid,
      genesisHash: suggestedParams.genesisHash,
      genesisId: suggestedParams.genesisId,
      lease,
      note,
      assetTransfer: {
        assetId: asaId,
        amount,
        receiver: Address.fromString(receiver),
      },
    });
  }

  // Native ALGO payment
  return new Transaction({
    type: TransactionType.Payment,
    sender: Address.fromString(sender),
    fee,
    firstValid: suggestedParams.firstValid,
    lastValid: suggestedParams.lastValid,
    genesisHash: suggestedParams.genesisHash,
    genesisId: suggestedParams.genesisId,
    lease,
    note,
    payment: {
      receiver: Address.fromString(receiver),
      amount,
    },
  });
}

/**
 * Build a zero-amount fee payer transaction (pay to self).
 */
export function buildFeePayerTransaction(params: {
  feePayerKey: string;
  groupSize: number;
  suggestedParams: SuggestedTransactionParams;
}): Transaction {
  const { feePayerKey, groupSize, suggestedParams } = params;
  const totalFee = BigInt(groupSize) * suggestedParams.minFee;
  return new Transaction({
    type: TransactionType.Payment,
    sender: Address.fromString(feePayerKey),
    fee: totalFee,
    firstValid: suggestedParams.firstValid,
    lastValid: suggestedParams.lastValid,
    genesisHash: suggestedParams.genesisHash,
    genesisId: suggestedParams.genesisId,
    payment: {
      receiver: Address.fromString(feePayerKey),
      amount: 0n,
    },
  });
}

/**
 * Build a complete payment group for a charge challenge.
 *
 * Transaction group structure: [optional fee payer] + [payment].
 */
export function buildChargeGroup(params: {
  amount: bigint;
  asaId?: bigint;
  challengeReference: string;
  externalId?: string;
  feePayerKey?: string;
  lease?: Uint8Array;
  receiver: string;
  sender: string;
  suggestedParams: SuggestedTransactionParams;
  useServerFeePayer: boolean;
}): { paymentIndex: number; transactions: Transaction[] } {
  const {
    sender,
    receiver,
    amount,
    asaId,
    challengeReference,
    externalId,
    lease,
    useServerFeePayer,
    feePayerKey,
    suggestedParams,
  } = params;

  const transactions: Transaction[] = [];

  // Build note with challengeReference and optional externalId.
  const noteStr = externalId
    ? `mppx:${challengeReference}:${externalId}`
    : `mppx:${challengeReference}`;
  const note = textEncoder.encode(noteStr);

  // Fee payer transaction (index 0 when present).
  // Fee payer MUST NOT have a lease set (per spec).
  if (useServerFeePayer && feePayerKey) {
    const groupSize = 2; // fee payer + payment
    transactions.push(
      buildFeePayerTransaction({ feePayerKey, groupSize, suggestedParams }),
    );
  }

  // Primary payment transaction.
  const paymentIndex = transactions.length;
  const clientFee = useServerFeePayer ? 0n : suggestedParams.minFee;

  transactions.push(
    buildPaymentTransaction({
      sender,
      receiver,
      amount,
      asaId,
      fee: clientFee,
      lease,
      note,
      suggestedParams,
    }),
  );

  // Assign group ID.
  const grouped = groupTransactions(transactions);

  return { paymentIndex, transactions: grouped };
}

/**
 * Client-side signer type matching use-wallet's signTransactions and x402's ClientAvmSigner.
 * Receives raw-encoded Uint8Array[], returns signed bytes (null for unsigned).
 */
export type ClientSigner = (
  txns: Uint8Array[],
  indexesToSign?: number[],
) => Promise<(Uint8Array | null)[]>;

/**
 * Optional encoder function for converting Transaction objects to raw bytes.
 * Defaults to algokit-utils' encodeTransactionRaw.
 * Override with algosdk's encoder in browser environments where algokit-utils
 * encoding is broken.
 */
export type TransactionEncoder = (txn: Transaction) => Uint8Array;

/**
 * Sign transactions with the given signer.
 * Returns an array of base64-encoded msgpack transactions.
 * Fee payer transactions (at feePayerIndex) are left unsigned.
 *
 * Encodes Transaction objects to raw bytes, then passes Uint8Array[] to the signer
 * matching use-wallet and x402 ClientAvmSigner interfaces.
 *
 * @param params.encoder - Optional custom encoder. Use this in browser environments
 *   where algokit-utils' encodeTransactionRaw produces corrupted bytes.
 */
export async function signAndEncodeGroup(params: {
  feePayerIndex?: number;
  signer: ClientSigner;
  transactions: Transaction[];
  encoder?: TransactionEncoder;
}): Promise<string[]> {
  const { transactions, signer, feePayerIndex, encoder } = params;
  const encode = encoder ?? encodeTransactionRaw;

  // Encode all transactions to raw bytes.
  const encodedTxns = transactions.map((txn) => encode(txn));

  // Determine which indexes the client should sign.
  const indexesToSign = transactions
    .map((_, i) => i)
    .filter((i) => i !== feePayerIndex);

  // Pass raw bytes and indexes to the signer.
  const signedTxns = await signer(encodedTxns, indexesToSign);

  // Build result array.
  const result: string[] = [];

  for (let i = 0; i < transactions.length; i++) {
    const signed = signedTxns[i];
    if (signed) {
      result.push(uint8ArrayToBase64(signed));
    } else if (i === feePayerIndex) {
      result.push(uint8ArrayToBase64(encodedTxns[i]));
    } else {
      throw new Error(`Transaction at index ${i} was not signed`);
    }
  }

  return result;
}

/**
 * Decode a base64-encoded transaction (signed or unsigned).
 */
export function decodeBase64Transaction(
  base64Str: string,
): SignedTransaction | Transaction {
  const bytes = base64ToUint8Array(base64Str);
  try {
    return decodeSignedTransaction(bytes);
  } catch {
    return decodeTransaction(bytes);
  }
}

/**
 * Extract the underlying Transaction from a decoded result.
 */
export function getTransaction(
  decoded: SignedTransaction | Transaction,
): Transaction {
  if ("txn" in decoded) {
    return decoded.txn;
  }
  return decoded;
}

/**
 * Check if a decoded transaction is signed.
 */
export function isSigned(
  decoded: SignedTransaction | Transaction,
): decoded is SignedTransaction {
  return "txn" in decoded;
}

/**
 * Co-sign a base64-encoded unsigned transaction with the given signer.
 * Returns the signed transaction as base64.
 */
export async function coSignBase64Transaction(
  signer: TransactionSigner,
  base64Txn: string,
  transactions: Transaction[],
  indexToSign: number,
): Promise<string> {
  const signedBytes = await signer(transactions, [indexToSign]);
  return uint8ArrayToBase64(signedBytes[0]);
}

/**
 * Resolve suggested params from server challenge or fetch from algod.
 */
export async function resolveSuggestedParams(
  serverParams:
    | {
        firstValid: number;
        genesisHash: string;
        genesisId: string;
        lastValid: number;
        minFee: number;
      }
    | undefined,
  network: string | undefined,
  algodUrl?: string,
): Promise<SuggestedTransactionParams> {
  if (serverParams) {
    return {
      firstValid: BigInt(serverParams.firstValid),
      lastValid: BigInt(serverParams.lastValid),
      genesisHash: base64ToUint8Array(serverParams.genesisHash),
      genesisId: serverParams.genesisId,
      minFee: BigInt(serverParams.minFee),
    };
  }

  // Fetch from algod.
  const resolvedNetwork = network || ALGORAND_MAINNET;
  const url = algodUrl ?? resolveAlgodUrl(resolvedNetwork);
  const response = await fetch(`${url}/v2/transactions/params`);
  const data = (await response.json()) as {
    "consensus-version": string;
    fee: number;
    "genesis-hash": string;
    "genesis-id": string;
    "last-round": number;
    "min-fee": number;
  };

  return {
    firstValid: BigInt(data["last-round"]),
    lastValid: BigInt(data["last-round"] + 1000),
    genesisHash: base64ToUint8Array(data["genesis-hash"]),
    genesisId: data["genesis-id"],
    minFee: BigInt(data["min-fee"] || Number(DEFAULT_MIN_FEE)),
  };
}

/**
 * Resolve an algod URL for a given CAIP-2 network.
 */
export function resolveAlgodUrl(network: string): string {
  return DEFAULT_ALGOD_URLS[network] ?? DEFAULT_ALGOD_URLS[ALGORAND_MAINNET];
}

// ── Base64 helpers ──

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
