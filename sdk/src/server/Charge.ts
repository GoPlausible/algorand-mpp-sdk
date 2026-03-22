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
 * import { Mppx, algorand } from '@algorand/mpp/server'
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

            // Pre-fetch suggested params so the client can skip an RPC call.
            let suggestedParams: {
                firstValid: number;
                genesisHash: string;
                genesisId: string;
                lastValid: number;
            } | undefined;

            try {
                const res = await fetch(`${algodUrl}/v2/transactions/params`);
                const data = (await res.json()) as {
                    'genesis-hash': string;
                    'genesis-id': string;
                    'last-round': number;
                };
                suggestedParams = {
                    firstValid: data['last-round'],
                    lastValid: data['last-round'] + 1000,
                    genesisHash: data['genesis-hash'],
                    genesisId: data['genesis-id'],
                };
            } catch {
                // Non-fatal — client will fetch its own params.
            }

            return {
                ...request,
                methodDetails: {
                    network,
                    reference,
                    ...(asaId ? { asaId: String(asaId), decimals } : {}),
                    ...(signer && signerAddress ? { feePayer: true, feePayerKey: signerAddress } : {}),
                    ...(splits?.length ? { splits } : {}),
                    ...(suggestedParams ? { suggestedParams } : {}),
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
                throw new Error('type="txid" credentials cannot be used with fee sponsorship (feePayer: true)');
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
    throw new Error('Missing or invalid payload type: must be "transaction" or "txid"');
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
        throw new Error('Missing paymentGroup in credential payload');
    }
    if (paymentIndex === undefined || paymentIndex === null) {
        throw new Error('Missing paymentIndex in credential payload');
    }
    if (paymentGroup.length > 16) {
        throw new Error('paymentGroup exceeds maximum of 16 transactions');
    }
    if (paymentIndex < 0 || paymentIndex >= paymentGroup.length) {
        throw new Error('paymentIndex out of range');
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
            throw new Error('Fee payer transaction not found in group');
        }

        // Verify fee payer transaction.
        verifyFeePayerTransaction(transactions[feePayerIndex], signerAddress, transactions.length);

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
        throw new Error('Missing txid in credential payload');
    }

    // Validate TxID format (52-char base32).
    if (!/^[A-Z2-7]{52}$/.test(txid)) {
        throw new Error('Invalid txid format: must be 52-character base32');
    }

    // Replay prevention.
    const consumedKey = `algorand-charge:consumed:${txid}`;
    if (await store.get(consumedKey)) {
        throw new Error('Transaction identifier already consumed');
    }

    // Fetch transaction from indexer.
    const tx = await fetchTransactionFromIndexer(indexerUrl, txid);
    if (!tx) {
        throw new Error('Transaction not found or not yet confirmed');
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
        throw new Error('Transactions must have a group ID');
    }
    for (let i = 1; i < transactions.length; i++) {
        const groupId = transactions[i].group;
        if (!groupId || !arraysEqual(firstGroupId, groupId)) {
            throw new Error('All transactions must share the same group ID');
        }
    }
}

function verifyPaymentDetails(txn: Transaction, challenge: ChallengeRequest, recipient: string) {
    const { asaId } = challenge.methodDetails;
    const splits = challenge.methodDetails.splits ?? [];
    const splitsTotal = splits.reduce((sum, s) => sum + BigInt(s.amount), 0n);
    const primaryAmount = BigInt(challenge.amount) - splitsTotal;

    if (primaryAmount <= 0n) {
        throw new Error('Splits consume the entire amount — primary recipient must receive a positive amount');
    }

    if (asaId) {
        // ASA transfer.
        if (txn.type !== TransactionType.AssetTransfer) {
            throw new Error(`Expected asset transfer transaction, got ${txn.type}`);
        }
        if (!txn.assetTransfer) {
            throw new Error('Missing asset transfer fields');
        }
        if (txn.assetTransfer.assetId !== BigInt(asaId)) {
            throw new Error(`ASA ID mismatch: expected ${asaId}, got ${txn.assetTransfer.assetId}`);
        }
        if (txn.assetTransfer.amount !== primaryAmount) {
            throw new Error(`Amount mismatch: expected ${primaryAmount}, got ${txn.assetTransfer.amount}`);
        }
        if (txn.assetTransfer.receiver.toString() !== recipient) {
            throw new Error(`Recipient mismatch: expected ${recipient}, got ${txn.assetTransfer.receiver}`);
        }
    } else {
        // Native ALGO payment.
        if (txn.type !== TransactionType.Payment) {
            throw new Error(`Expected payment transaction, got ${txn.type}`);
        }
        if (!txn.payment) {
            throw new Error('Missing payment fields');
        }
        if (txn.payment.amount !== primaryAmount) {
            throw new Error(`Amount mismatch: expected ${primaryAmount}, got ${txn.payment.amount}`);
        }
        if (txn.payment.receiver.toString() !== recipient) {
            throw new Error(`Recipient mismatch: expected ${recipient}, got ${txn.payment.receiver}`);
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
            throw new Error(`Missing split transfer for recipient ${split.recipient} amount ${split.amount}`);
        }
    }
}

function verifyNoDangerousFields(txn: Transaction) {
    // Check for close remainder to (ALGO).
    if (txn.payment?.closeRemainderTo) {
        throw new Error('Dangerous: transaction contains closeRemainderTo field');
    }
    // Check for close asset to (ASA).
    if (txn.assetTransfer?.closeRemainderTo) {
        throw new Error('Dangerous: transaction contains close asset to field');
    }
    // Check for rekey.
    if (txn.rekeyTo) {
        throw new Error('Dangerous: transaction contains rekeyTo field');
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
        throw new Error('Fee payer transaction must be a payment transaction');
    }
    if (txn.sender.toString() !== feePayerAddress) {
        throw new Error('Fee payer sender does not match feePayerKey');
    }
    if (!txn.payment || txn.payment.amount !== 0n) {
        throw new Error('Fee payer transaction amount must be 0');
    }
    const receiverStr = txn.payment.receiver.toString();
    if (receiverStr !== feePayerAddress) {
        throw new Error('Fee payer receiver must be the fee payer address (pay to self)');
    }
    if (txn.payment.closeRemainderTo) {
        throw new Error('Fee payer transaction must not have closeRemainderTo');
    }
    if (txn.rekeyTo) {
        throw new Error('Fee payer transaction must not have rekeyTo');
    }
    // Verify fee is reasonable (N * minFee * 2 as safety multiplier).
    const maxReasonableFee = BigInt(groupSize) * MIN_TXN_FEE * 2n;
    if (txn.fee !== undefined && txn.fee > maxReasonableFee) {
        throw new Error(`Fee payer fee ${txn.fee} exceeds reasonable maximum ${maxReasonableFee}`);
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
            throw new Error(`Expected axfer transaction, got ${tx['tx-type']}`);
        }
        const xfer = tx['asset-transfer-transaction'];
        if (!xfer) throw new Error('Missing asset-transfer-transaction');
        if (String(xfer['asset-id']) !== asaId) {
            throw new Error(`ASA ID mismatch: expected ${asaId}, got ${xfer['asset-id']}`);
        }
        if (BigInt(xfer.amount) !== primaryAmount) {
            throw new Error(`Amount mismatch: expected ${primaryAmount}, got ${xfer.amount}`);
        }
        if (xfer.receiver !== recipient) {
            throw new Error(`Recipient mismatch: expected ${recipient}, got ${xfer.receiver}`);
        }
    } else {
        if (tx['tx-type'] !== 'pay') {
            throw new Error(`Expected pay transaction, got ${tx['tx-type']}`);
        }
        const pay = tx['payment-transaction'];
        if (!pay) throw new Error('Missing payment-transaction');
        if (BigInt(pay.amount) !== primaryAmount) {
            throw new Error(`Amount mismatch: expected ${primaryAmount}, got ${pay.amount}`);
        }
        if (pay.receiver !== recipient) {
            throw new Error(`Recipient mismatch: expected ${recipient}, got ${pay.receiver}`);
        }
    }

    // Check for dangerous fields.
    if (tx['payment-transaction']?.['close-remainder-to']) {
        throw new Error('Dangerous: transaction contains close-remainder-to');
    }
    if (tx['asset-transfer-transaction']?.['close-to']) {
        throw new Error('Dangerous: transaction contains close-to');
    }
    if (tx['rekey-to']) {
        throw new Error('Dangerous: transaction contains rekey-to');
    }
}

// ── Algod/Indexer RPC helpers ──

async function simulateGroup(algodUrl: string, paymentGroup: string[]): Promise<void> {
    const groupBytes = paymentGroup.map(b64 => base64ToUint8Array(b64));

    // Build simulate request.
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
        throw new Error(`Transaction simulation failed: ${failure}`);
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
        throw new Error(`Failed to broadcast: ${data.message ?? 'unknown error'}`);
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
            throw new Error(`Transaction failed: ${data['pool-error']}`);
        }

        await new Promise(r => setTimeout(r, 1_000));
    }
    throw new Error('Transaction confirmation timeout');
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
