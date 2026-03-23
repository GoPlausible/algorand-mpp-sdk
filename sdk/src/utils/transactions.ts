import {
    Address,
} from '@algorandfoundation/algokit-utils';
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
} from '@algorandfoundation/algokit-utils/transact';

import { ALGORAND_MAINNET, DEFAULT_ALGOD_URLS, MIN_TXN_FEE } from '../constants.js';

const textEncoder = new TextEncoder();

/** Suggested params for transaction construction. */
export type SuggestedTransactionParams = {
    firstValid: bigint;
    genesisHash: Uint8Array;
    genesisId: string;
    lastValid: bigint;
};

/** A split payment entry. */
export type Split = {
    amount: string;
    memo?: string;
    recipient: string;
};

/**
 * Build a payment transaction (ALGO or ASA).
 */
export function buildPaymentTransaction(params: {
    amount: bigint;
    asaId?: bigint;
    fee?: bigint;
    note?: Uint8Array;
    receiver: string;
    sender: string;
    suggestedParams: SuggestedTransactionParams;
}): Transaction {
    const { sender, receiver, amount, asaId, fee, note, suggestedParams } = params;

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
    const totalFee = BigInt(groupSize) * MIN_TXN_FEE;
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
 */
export function buildChargeGroup(params: {
    amount: bigint;
    asaId?: bigint;
    externalId?: string;
    feePayerKey?: string;
    receiver: string;
    reference: string;
    sender: string;
    splits?: Split[];
    suggestedParams: SuggestedTransactionParams;
    useServerFeePayer: boolean;
}): { paymentIndex: number; transactions: Transaction[] } {
    const {
        sender,
        receiver,
        amount,
        asaId,
        reference,
        externalId,
        splits,
        useServerFeePayer,
        feePayerKey,
        suggestedParams,
    } = params;

    // Validate split count per spec (max 7).
    if (splits && splits.length > 7) {
        throw new Error('splits cannot exceed 7 entries');
    }

    const transactions: Transaction[] = [];

    // Compute primary amount (total minus splits).
    const splitsTotal = (splits ?? []).reduce((sum, s) => sum + BigInt(s.amount), 0n);
    const primaryAmount = amount - splitsTotal;

    // Build note with reference and optional externalId.
    const noteStr = externalId ? `mppx:${reference}:${externalId}` : `mppx:${reference}`;
    const note = textEncoder.encode(noteStr);

    // Fee payer transaction (index 0 when present).
    if (useServerFeePayer && feePayerKey) {
        // The group size is: 1 (fee payer) + 1 (primary) + splits count
        const groupSize = 1 + 1 + (splits?.length ?? 0);
        transactions.push(
            buildFeePayerTransaction({ feePayerKey, groupSize, suggestedParams }),
        );
    }

    // Primary payment transaction.
    const paymentIndex = transactions.length;
    const clientFee = useServerFeePayer ? 0n : MIN_TXN_FEE;

    transactions.push(
        buildPaymentTransaction({
            sender,
            receiver,
            amount: primaryAmount,
            asaId,
            fee: clientFee,
            note,
            suggestedParams,
        }),
    );

    // Split payment transactions.
    for (const split of splits ?? []) {
        const splitNote = split.memo ? textEncoder.encode(split.memo) : undefined;
        transactions.push(
            buildPaymentTransaction({
                sender,
                receiver: split.recipient,
                amount: BigInt(split.amount),
                asaId,
                fee: useServerFeePayer ? 0n : MIN_TXN_FEE,
                note: splitNote,
                suggestedParams,
            }),
        );
    }

    // Assign group ID.
    const grouped = groupTransactions(transactions);

    return { paymentIndex, transactions: grouped };
}

/**
 * Client-side signer type matching use-wallet's signTransactions and x402's ClientAvmSigner.
 * Receives raw-encoded Uint8Array[], returns signed bytes (null for unsigned).
 */
export type ClientSigner = (txns: Uint8Array[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>;

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
    const encodedTxns = transactions.map(txn => encode(txn));

    // Determine which indexes the client should sign.
    const indexesToSign = transactions
        .map((_, i) => i)
        .filter(i => i !== feePayerIndex);

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
export function decodeBase64Transaction(base64Str: string): SignedTransaction | Transaction {
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
export function getTransaction(decoded: SignedTransaction | Transaction): Transaction {
    if ('txn' in decoded) {
        return decoded.txn;
    }
    return decoded;
}

/**
 * Check if a decoded transaction is signed.
 */
export function isSigned(decoded: SignedTransaction | Transaction): decoded is SignedTransaction {
    return 'txn' in decoded;
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
    serverParams: { firstValid: number; genesisHash: string; genesisId: string; lastValid: number } | undefined,
    network: string | undefined,
    algodUrl?: string,
): Promise<SuggestedTransactionParams> {
    if (serverParams) {
        return {
            firstValid: BigInt(serverParams.firstValid),
            lastValid: BigInt(serverParams.lastValid),
            genesisHash: base64ToUint8Array(serverParams.genesisHash),
            genesisId: serverParams.genesisId,
        };
    }

    // Fetch from algod.
    const resolvedNetwork = network || ALGORAND_MAINNET;
    const url = algodUrl ?? resolveAlgodUrl(resolvedNetwork);
    const response = await fetch(`${url}/v2/transactions/params`);
    const data = (await response.json()) as {
        'consensus-version': string;
        fee: number;
        'genesis-hash': string;
        'genesis-id': string;
        'last-round': number;
        'min-fee': number;
    };

    return {
        firstValid: BigInt(data['last-round']),
        lastValid: BigInt(data['last-round'] + 1000),
        genesisHash: base64ToUint8Array(data['genesis-hash']),
        genesisId: data['genesis-id'],
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
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(base64, 'base64'));
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
