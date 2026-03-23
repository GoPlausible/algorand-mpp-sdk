import { Address } from '@algorandfoundation/algokit-utils';
import {
    type SignedTransaction,
    type Transaction,
    TransactionType,
    type TransactionSigner,
    decodeSignedTransaction,
    decodeTransaction,
    encodeSignedTransaction,
} from '@algorandfoundation/algokit-utils/transact';
import { Method, Receipt, Store } from 'mppx';

import {
    ALGORAND_MAINNET,
    DEFAULT_ALGOD_URLS,
    DEFAULT_INDEXER_URLS,
    MIN_TXN_FEE,
    NETWORK_GENESIS_HASH,
} from '../constants.js';
import * as Methods from '../Methods.js';
import {
    base64ToUint8Array,
    coSignBase64Transaction,
    uint8ArrayToBase64,
    resolveSuggestedParams,
} from '../utils/transactions.js';

// ── Algorand-specific error types per spec (RFC 9457 Problem Details) ──

const PROBLEM_BASE = 'https://paymentauth.org/problems/algorand';

class AlgorandPaymentError extends Error {
    readonly type: string;
    readonly status = 402;

    constructor(type: string, message: string) {
        super(message);
        this.type = `${PROBLEM_BASE}/${type}`;
        this.name = 'AlgorandPaymentError';
    }
}

/** Cannot decode credential, parse JSON, or required fields absent/wrong type. */
const malformedCredential = (detail: string) =>
    new AlgorandPaymentError('malformed-credential', detail);

/** challenge.id matches no issued challenge, or challenge already consumed. */
const unknownChallenge = (detail: string) =>
    new AlgorandPaymentError('unknown-challenge', detail);

/** payload.type is "txid" but challenge specifies feePayer: true. */
const invalidCredentialType = (detail: string) =>
    new AlgorandPaymentError('invalid-credential-type', detail);

/** Too many transactions (>16), mismatched Group IDs, or paymentIndex out of range. */
const groupInvalid = (detail: string) =>
    new AlgorandPaymentError('group-invalid', detail);

/** Group contains close, aclose, or rekey fields. */
const dangerousTransaction = (detail: string) =>
    new AlgorandPaymentError('dangerous-transaction', detail);

/** On-chain transfer doesn't match challenge. */
const transferMismatch = (detail: string) =>
    new AlgorandPaymentError('transfer-mismatch', detail);

/** TxID cannot be fetched from Algorand network. */
const transactionNotFound = (detail: string) =>
    new AlgorandPaymentError('transaction-not-found', detail);

/** Transaction group failed simulation or was rejected by network. */
const transactionFailed = (detail: string) =>
    new AlgorandPaymentError('transaction-failed', detail);

/** Server attempted to broadcast but Algorand rejected it. */
const broadcastFailed = (detail: string) =>
    new AlgorandPaymentError('broadcast-failed', detail);

/** TxID already used to fulfill a previous challenge. */
const txidConsumed = (detail: string) =>
    new AlgorandPaymentError('txid-consumed', detail);

/** Fee payer transaction is invalid. */
const feePayerInvalid = (detail: string) =>
    new AlgorandPaymentError('fee-payer-invalid', detail);

/**
 * Creates an Algorand `charge` method for usage on the server.
 *
 * Supports two settlement modes:
 *
 * - **Pull mode** (`type="transaction"`, default): The server receives a
 *   signed transaction group from the client, optionally co-signs the
 *   fee payer transaction, simulates, broadcasts, and verifies on-chain.
 *
 * - **Push mode** (`type="txid"`): The client has already broadcast
 *   the transaction group. The server verifies the transfer on-chain
 *   using the TxID.
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
        splits,
        signer,
        signerAddress,
    } = parameters;

    const algodUrl = parameters.algodUrl ?? DEFAULT_ALGOD_URLS[network] ?? DEFAULT_ALGOD_URLS[ALGORAND_MAINNET];
    const indexerUrl = parameters.indexerUrl ?? DEFAULT_INDEXER_URLS[network] ?? DEFAULT_INDEXER_URLS[ALGORAND_MAINNET];

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
    if (splits) {
        for (const split of splits) {
            try {
                Address.fromString(split.recipient);
            } catch {
                throw new Error(`Invalid split recipient address: ${split.recipient}`);
            }
        }
    }

    if (asaId && decimals === undefined) {
        throw new Error('decimals is required when asaId is set');
    }

    if (splits && splits.length > 7) {
        throw new Error('splits cannot exceed 7 entries');
    }

    return Method.toServer(Methods.charge, {
        defaults: {
            currency: asaId ? 'ASA' : 'ALGO',
            methodDetails: {
                reference: '',
            },
            recipient: '',
        },

        async request({ credential, request }) {
            if (credential) {
                return credential.challenge.request as typeof request;
            }

            const reference = crypto.randomUUID();

            // Fetch suggested params (MUST be present per spec).
            // Failure propagates as a 500 — the server cannot issue a
            // valid challenge without transaction parameters.
            const res = await fetch(`${algodUrl}/v2/transactions/params`);
            if (!res.ok) {
                throw new Error(`Algod unreachable: ${res.status} ${res.statusText}`);
            }
            const data = (await res.json()) as {
                'genesis-hash': string;
                'genesis-id': string;
                'last-round': number;
            };
            const suggestedParams = {
                firstValid: data['last-round'],
                lastValid: data['last-round'] + 1000,
                genesisHash: data['genesis-hash'],
                genesisId: data['genesis-id'],
            };

            return {
                ...request,
                methodDetails: {
                    network,
                    reference,
                    ...(asaId ? { asaId: String(asaId), decimals } : {}),
                    ...(signer && signerAddress ? { feePayer: true, feePayerKey: signerAddress } : {}),
                    ...(splits?.length ? { splits } : {}),
                    suggestedParams,
                },
                recipient,
            };
        },

        async verify({ credential }) {
            const cred = credential as unknown as CredentialPayload;
            const challenge = cred.challenge.request;
            const payloadType = resolvePayloadType(cred.payload);

            // Spec: type="txid" MUST NOT be used with feePayer: true
            if (payloadType === 'txid' && challenge.methodDetails.feePayer) {
                throw invalidCredentialType('type="txid" credentials cannot be used with fee sponsorship (feePayer: true)');
            }

            if (payloadType === 'transaction') {
                return await verifyTransaction(cred, challenge, algodUrl, recipient, store, signer, signerAddress);
            }

            return await verifyTxid(cred, challenge, indexerUrl, recipient, store);
        },
    });
}

// ── Payload type resolution ──

function resolvePayloadType(payload: {
    paymentGroup?: string[];
    paymentIndex?: number;
    txid?: string;
    type?: string;
}): 'transaction' | 'txid' {
    if (payload.type === 'txid') return 'txid';
    if (payload.type === 'transaction') return 'transaction';
    throw malformedCredential('Missing or invalid payload type: must be "transaction" or "txid"');
}

// ── Pull mode (type="transaction") ──

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
        throw malformedCredential('Missing paymentGroup in credential payload');
    }
    if (paymentIndex === undefined || paymentIndex === null) {
        throw malformedCredential('Missing paymentIndex in credential payload');
    }
    if (paymentGroup.length > 16) {
        throw groupInvalid('paymentGroup exceeds maximum of 16 transactions');
    }
    if (paymentIndex < 0 || paymentIndex >= paymentGroup.length) {
        throw groupInvalid('paymentIndex out of range');
    }

    // Decode all transactions.
    // Try unsigned first: decodeSignedTransaction can incorrectly succeed on
    // raw unsigned bytes (producing garbage), so we check for the presence of
    // a signature to distinguish signed from unsigned.
    const decoded = paymentGroup.map(b64 => {
        const bytes = base64ToUint8Array(b64);
        try {
            const signed = decodeSignedTransaction(bytes);
            // Verify it's actually signed (has a non-empty sig field).
            if (signed.sig && signed.sig.length > 0) {
                return { signed, type: 'signed' as const };
            }
        } catch { /* not a valid signed transaction */ }
        return { unsigned: decodeTransaction(bytes), type: 'unsigned' as const };
    });

    // Extract raw transactions for verification.
    const transactions = decoded.map(d =>
        d.type === 'signed' ? d.signed!.txn : d.unsigned!
    );

    // Verify all transactions share the same group ID.
    verifyGroupId(transactions);

    // Verify the payment transaction matches the challenge.
    const paymentTxn = transactions[paymentIndex];
    verifyPaymentDetails(paymentTxn, challenge, recipient);

    // Verify splits if present.
    if (challenge.methodDetails.splits?.length) {
        verifySplits(transactions, paymentIndex, challenge);
    }

    // Safety: check for dangerous fields on all transactions.
    for (const txn of transactions) {
        verifyNoDangerousFields(txn);
    }

    // Fee payer verification and co-signing.
    let finalGroup = [...paymentGroup];
    if (challenge.methodDetails.feePayer && signer && signerAddress) {
        const feePayerIndex = findFeePayerIndex(transactions, signerAddress);
        if (feePayerIndex === -1) {
            throw feePayerInvalid('Fee payer transaction not found in group');
        }

        // Verify fee payer transaction.
        verifyFeePayerTransaction(transactions[feePayerIndex], signerAddress, transactions.length);

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

    return Receipt.from({
        method: 'algorand',
        reference: txid,
        status: 'success',
        timestamp: new Date().toISOString(),
    });
}

// ── Push mode (type="txid") ──

async function verifyTxid(
    credential: CredentialPayload,
    challenge: ChallengeRequest,
    indexerUrl: string,
    recipient: string,
    store: Store.Store,
) {
    const { txid } = credential.payload;
    if (!txid) {
        throw malformedCredential('Missing txid in credential payload');
    }

    // Validate TxID format (52-char base32).
    if (!/^[A-Z2-7]{52}$/.test(txid)) {
        throw malformedCredential('Invalid txid format: must be 52-character base32');
    }

    // Replay prevention.
    const consumedKey = `algorand-charge:consumed:${txid}`;
    if (await store.get(consumedKey)) {
        throw txidConsumed('Transaction identifier already consumed');
    }

    // Fetch transaction from indexer.
    const tx = await fetchTransactionFromIndexer(indexerUrl, txid);
    if (!tx) {
        throw transactionNotFound('Transaction not found or not yet confirmed');
    }

    // Verify transfer details.
    verifyOnChainTransaction(tx, challenge, recipient);

    // Mark consumed.
    await store.put(consumedKey, true);

    return Receipt.from({
        method: 'algorand',
        reference: txid,
        status: 'success',
        timestamp: new Date().toISOString(),
    });
}

// ── Verification helpers ──

function verifyGroupId(transactions: Transaction[]) {
    if (transactions.length <= 1) return; // Single transactions don't need a group ID
    const firstGroupId = transactions[0].group;
    if (!firstGroupId) {
        throw groupInvalid('Transactions must have a group ID');
    }
    for (let i = 1; i < transactions.length; i++) {
        const groupId = transactions[i].group;
        if (!groupId || !arraysEqual(firstGroupId, groupId)) {
            throw groupInvalid('All transactions must share the same group ID');
        }
    }
}

function verifyPaymentDetails(txn: Transaction, challenge: ChallengeRequest, recipient: string) {
    const { asaId } = challenge.methodDetails;
    const splits = challenge.methodDetails.splits ?? [];
    const splitsTotal = splits.reduce((sum, s) => sum + BigInt(s.amount), 0n);
    const primaryAmount = BigInt(challenge.amount) - splitsTotal;

    if (primaryAmount <= 0n) {
        throw transferMismatch('Splits consume the entire amount — primary recipient must receive a positive amount');
    }

    if (asaId) {
        if (txn.type !== TransactionType.AssetTransfer) {
            throw transferMismatch(`Expected asset transfer transaction, got ${txn.type}`);
        }
        if (!txn.assetTransfer) {
            throw transferMismatch('Missing asset transfer fields');
        }
        if (txn.assetTransfer.assetId !== BigInt(asaId)) {
            throw transferMismatch(`ASA ID mismatch: expected ${asaId}, got ${txn.assetTransfer.assetId}`);
        }
        if (txn.assetTransfer.amount !== primaryAmount) {
            throw transferMismatch(`Amount mismatch: expected ${primaryAmount}, got ${txn.assetTransfer.amount}`);
        }
        if (txn.assetTransfer.receiver.toString() !== recipient) {
            throw transferMismatch(`Recipient mismatch: expected ${recipient}, got ${txn.assetTransfer.receiver}`);
        }
    } else {
        if (txn.type !== TransactionType.Payment) {
            throw transferMismatch(`Expected payment transaction, got ${txn.type}`);
        }
        if (!txn.payment) {
            throw transferMismatch('Missing payment fields');
        }
        if (txn.payment.amount !== primaryAmount) {
            throw transferMismatch(`Amount mismatch: expected ${primaryAmount}, got ${txn.payment.amount}`);
        }
        if (txn.payment.receiver.toString() !== recipient) {
            throw transferMismatch(`Recipient mismatch: expected ${recipient}, got ${txn.payment.receiver}`);
        }
    }
}

function verifySplits(transactions: Transaction[], paymentIndex: number, challenge: ChallengeRequest) {
    const splits = challenge.methodDetails.splits!;
    const { asaId } = challenge.methodDetails;

    for (const split of splits) {
        const found = transactions.some((txn, idx) => {
            if (idx === paymentIndex) return false; // Skip primary payment.
            if (asaId) {
                return (
                    txn.type === TransactionType.AssetTransfer &&
                    txn.assetTransfer?.receiver.toString() === split.recipient &&
                    txn.assetTransfer?.amount === BigInt(split.amount) &&
                    txn.assetTransfer?.assetId === BigInt(asaId)
                );
            }
            return (
                txn.type === TransactionType.Payment &&
                txn.payment?.receiver.toString() === split.recipient &&
                txn.payment?.amount === BigInt(split.amount)
            );
        });

        if (!found) {
            throw transferMismatch(`Missing split transfer for recipient ${split.recipient} amount ${split.amount}`);
        }
    }
}

function verifyNoDangerousFields(txn: Transaction) {
    if (txn.payment?.closeRemainderTo) {
        throw dangerousTransaction('Transaction contains closeRemainderTo field');
    }
    if (txn.assetTransfer?.closeRemainderTo) {
        throw dangerousTransaction('Transaction contains close asset to field');
    }
    if (txn.rekeyTo) {
        throw dangerousTransaction('Transaction contains rekeyTo field');
    }
}

function findFeePayerIndex(transactions: Transaction[], feePayerAddress: string): number {
    return transactions.findIndex(txn =>
        txn.type === TransactionType.Payment &&
        txn.sender.toString() === feePayerAddress &&
        txn.payment?.amount === 0n
    );
}

function verifyFeePayerTransaction(txn: Transaction, feePayerAddress: string, groupSize: number) {
    if (txn.type !== TransactionType.Payment) {
        throw feePayerInvalid('Fee payer transaction must be a payment transaction');
    }
    if (txn.sender.toString() !== feePayerAddress) {
        throw feePayerInvalid('Fee payer sender does not match feePayerKey');
    }
    if (!txn.payment || txn.payment.amount !== 0n) {
        throw feePayerInvalid('Fee payer transaction amount must be 0');
    }
    const receiverStr = txn.payment.receiver.toString();
    if (receiverStr !== feePayerAddress) {
        throw feePayerInvalid('Fee payer receiver must be the fee payer address (pay to self)');
    }
    if (txn.payment.closeRemainderTo) {
        throw dangerousTransaction('Fee payer transaction must not have closeRemainderTo');
    }
    if (txn.rekeyTo) {
        throw dangerousTransaction('Fee payer transaction must not have rekeyTo');
    }
    // Verify fee is reasonable: must be at least N*minFee, no more than N*minFee*2 (safety multiplier).
    const expectedFee = BigInt(groupSize) * MIN_TXN_FEE;
    const maxReasonableFee = expectedFee * 2n;
    if (txn.fee !== undefined && txn.fee < expectedFee) {
        throw feePayerInvalid(`Fee payer fee ${txn.fee} is below minimum ${expectedFee} for group of ${groupSize}`);
    }
    if (txn.fee !== undefined && txn.fee > maxReasonableFee) {
        throw feePayerInvalid(`Fee payer fee ${txn.fee} exceeds reasonable maximum ${maxReasonableFee}`);
    }
}

function verifyOnChainTransaction(
    tx: IndexerTransaction,
    challenge: ChallengeRequest,
    recipient: string,
) {
    const { asaId } = challenge.methodDetails;
    const splits = challenge.methodDetails.splits ?? [];
    const splitsTotal = splits.reduce((sum, s) => sum + BigInt(s.amount), 0n);
    const primaryAmount = BigInt(challenge.amount) - splitsTotal;

    if (asaId) {
        if (tx['tx-type'] !== 'axfer') {
            throw transferMismatch(`Expected axfer transaction, got ${tx['tx-type']}`);
        }
        const xfer = tx['asset-transfer-transaction'];
        if (!xfer) throw transferMismatch('Missing asset-transfer-transaction');
        if (String(xfer['asset-id']) !== asaId) {
            throw transferMismatch(`ASA ID mismatch: expected ${asaId}, got ${xfer['asset-id']}`);
        }
        if (BigInt(xfer.amount) !== primaryAmount) {
            throw transferMismatch(`Amount mismatch: expected ${primaryAmount}, got ${xfer.amount}`);
        }
        if (xfer.receiver !== recipient) {
            throw transferMismatch(`Recipient mismatch: expected ${recipient}, got ${xfer.receiver}`);
        }
    } else {
        if (tx['tx-type'] !== 'pay') {
            throw transferMismatch(`Expected pay transaction, got ${tx['tx-type']}`);
        }
        const pay = tx['payment-transaction'];
        if (!pay) throw transferMismatch('Missing payment-transaction');
        if (BigInt(pay.amount) !== primaryAmount) {
            throw transferMismatch(`Amount mismatch: expected ${primaryAmount}, got ${pay.amount}`);
        }
        if (pay.receiver !== recipient) {
            throw transferMismatch(`Recipient mismatch: expected ${recipient}, got ${pay.receiver}`);
        }
    }

    // Check for dangerous fields.
    if (tx['payment-transaction']?.['close-remainder-to']) {
        throw dangerousTransaction('Transaction contains close-remainder-to');
    }
    if (tx['asset-transfer-transaction']?.['close-to']) {
        throw dangerousTransaction('Transaction contains close-to');
    }
    if (tx['rekey-to']) {
        throw dangerousTransaction('Transaction contains rekey-to');
    }
}

// ── Algod/Indexer RPC helpers ──

async function simulateGroup(algodUrl: string, paymentGroup: string[]): Promise<void> {
    const request = {
        'txn-groups': [
            {
                txns: paymentGroup,
            },
        ],
        'allow-empty-signatures': true,
    };

    const response = await fetch(`${algodUrl}/v2/transactions/simulate`, {
        body: JSON.stringify(request),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });

    const data = (await response.json()) as {
        'txn-groups'?: Array<{ 'failure-message'?: string }>;
    };

    const failure = data['txn-groups']?.[0]?.['failure-message'];
    if (failure) {
        throw transactionFailed(`Transaction simulation failed: ${failure}`);
    }
}

async function broadcastGroup(algodUrl: string, paymentGroup: string[]): Promise<string> {
    const groupBytes = paymentGroup.map(b64 => base64ToUint8Array(b64));

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
        headers: { 'Content-Type': 'application/x-binary' },
        method: 'POST',
    });

    const data = (await response.json()) as { txId?: string; message?: string };
    if (!data.txId) {
        throw broadcastFailed(data.message ?? 'unknown error');
    }

    return data.txId;
}

async function waitForConfirmation(algodUrl: string, txid: string, timeoutMs = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const response = await fetch(`${algodUrl}/v2/transactions/pending/${txid}`);
        const data = (await response.json()) as {
            'confirmed-round'?: number;
            'pool-error'?: string;
        };

        if (data['confirmed-round'] && data['confirmed-round'] > 0) {
            return;
        }

        if (data['pool-error']) {
            throw transactionFailed(`Transaction failed: ${data['pool-error']}`);
        }

        await new Promise(r => setTimeout(r, 1_000));
    }
    throw transactionFailed('Transaction confirmation timeout');
}

async function fetchTransactionFromIndexer(
    indexerUrl: string,
    txid: string,
): Promise<IndexerTransaction | null> {
    const response = await fetch(`${indexerUrl}/v2/transactions/${txid}`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
        transaction?: IndexerTransaction;
    };

    return data.transaction ?? null;
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
        txid?: string;
        type?: string;
    };
};

type ChallengeRequest = {
    amount: string;
    currency: string;
    methodDetails: {
        asaId?: string;
        decimals?: number;
        feePayer?: boolean;
        feePayerKey?: string;
        network?: string;
        reference: string;
        splits?: Array<{ amount: string; memo?: string; recipient: string }>;
        suggestedParams?: {
            firstValid: number;
            genesisHash: string;
            genesisId: string;
            lastValid: number;
        };
    };
    recipient: string;
};

type IndexerTransaction = {
    'asset-transfer-transaction'?: {
        amount: number;
        'asset-id': number;
        'close-to'?: string;
        receiver: string;
    };
    'confirmed-round'?: number;
    id: string;
    'payment-transaction'?: {
        amount: number;
        'close-remainder-to'?: string;
        receiver: string;
    };
    'rekey-to'?: string;
    sender: string;
    'tx-type': string;
};

export declare namespace charge {
    type Parameters = {
        /** ASA ID for token payments. If absent, payments are in native ALGO. */
        asaId?: bigint;
        /** Custom algod URL. Defaults to public API for the selected network. */
        algodUrl?: string;
        /** Token decimals (required when asaId is set). */
        decimals?: number;
        /** Custom indexer URL. Defaults to public indexer for the selected network. */
        indexerUrl?: string;
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
        /** Additional payment splits. Same asset as primary payment. Max 7 entries. */
        splits?: Array<{
            /** Amount in base units (same asset as primary). */
            amount: string;
            /** Optional memo (max 1024 bytes). */
            memo?: string;
            /** Algorand address of the split recipient. */
            recipient: string;
        }>;
        /**
         * Pluggable key-value store for consumed-TxID tracking (replay prevention).
         * Defaults to in-memory. Use a persistent store in production.
         */
        store?: Store.Store;
    };
}
