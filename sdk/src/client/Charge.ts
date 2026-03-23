import { Credential, Method } from 'mppx';

import { ALGORAND_MAINNET, DEFAULT_ALGOD_URLS } from '../constants.js';
import * as Methods from '../Methods.js';
import {
    buildChargeGroup,
    resolveSuggestedParams,
    signAndEncodeGroup,
    base64ToUint8Array,
    uint8ArrayToBase64,
    type TransactionEncoder,
} from '../utils/transactions.js';

/**
 * Creates an Algorand `charge` method for usage on the client.
 *
 * Supports two modes controlled by the `broadcast` option:
 *
 * - **Pull mode** (`broadcast: false`, default): Signs the transaction
 *   group and sends the serialized group as a `type="transaction"` credential.
 *   The server broadcasts it to the Algorand network.
 *
 * - **Push mode** (`broadcast: true`): Signs, broadcasts, confirms
 *   the transaction on-chain, and sends the TxID as a `type="txid"`
 *   credential. Cannot be used with fee sponsorship.
 *
 * When the server advertises `feePayer: true` in the challenge, the client
 * includes an unsigned fee payer transaction in the group. The server adds
 * its signature before broadcasting.
 *
 * @example
 * ```ts
 * import { Mppx, algorand } from '@goplausible/algorand-mpp/client'
 *
 * const method = algorand.charge({ signer, algodUrl: 'https://testnet-api.4160.nodely.dev' })
 * const mppx = Mppx.create({ methods: [method] })
 *
 * const response = await mppx.fetch('https://api.example.com/paid-content')
 * console.log(await response.json())
 * ```
 */
export function charge(parameters: charge.Parameters) {
    const { signer, senderAddress, broadcast = false, onProgress, encoder } = parameters;

    const method = Method.toClient(Methods.charge, {
        async createCredential({ challenge }) {
            const { amount, currency, recipient, methodDetails } = challenge.request;
            const {
                network,
                asaId,
                decimals,
                reference,
                feePayer: serverPaysFees,
                feePayerKey,
                suggestedParams: serverSuggestedParams,
                splits,
            } = methodDetails;

            const resolvedNetwork = network || ALGORAND_MAINNET;
            const algodUrl = parameters.algodUrl ?? DEFAULT_ALGOD_URLS[resolvedNetwork] ?? DEFAULT_ALGOD_URLS[ALGORAND_MAINNET];

            onProgress?.({
                amount,
                currency: currency || (asaId ? 'ASA' : 'ALGO'),
                feePayerKey: feePayerKey || undefined,
                recipient,
                asaId: asaId || undefined,
                type: 'challenge',
            });

            const useServerFeePayer = serverPaysFees && feePayerKey && !broadcast;


            // Resolve suggested params.
            const txnParams = await resolveSuggestedParams(
                serverSuggestedParams,
                resolvedNetwork,
                algodUrl,
            );

            // Build the transaction group.
            const { transactions, paymentIndex } = buildChargeGroup({
                sender: senderAddress,
                receiver: recipient,
                amount: BigInt(amount),
                asaId: asaId ? BigInt(asaId) : undefined,
                reference,
                externalId: challenge.request.externalId,
                splits,
                useServerFeePayer: !!useServerFeePayer,
                feePayerKey,
                suggestedParams: txnParams,
            });

            onProgress?.({ type: 'signing' });

            // Sign the group (leave fee payer unsigned if present).
            const feePayerIndex = useServerFeePayer ? 0 : undefined;
            const paymentGroup = await signAndEncodeGroup({
                transactions,
                signer,
                feePayerIndex,
                encoder,
            });

            if (broadcast) {
                // ── Push mode (type="txid") ──
                onProgress?.({ type: 'paying' });

                // Combine all signed transactions for broadcast.
                const groupBytes = paymentGroup.map(b64 => base64ToUint8Array(b64));
                const txid = await broadcastAndConfirm(algodUrl, groupBytes);

                onProgress?.({ txid, type: 'paid' });

                return Credential.serialize({
                    challenge,
                    source: senderAddress,
                    payload: { txid, type: 'txid' },
                });
            }

            // ── Pull mode (type="transaction", default) ──
            onProgress?.({ paymentGroup, type: 'signed' });

            return Credential.serialize({
                challenge,
                source: senderAddress,
                payload: { paymentGroup, paymentIndex, type: 'transaction' },
            });
        },
    });

    return method;
}

// ── Push mode helpers ──

/**
 * Broadcast a transaction group and wait for confirmation.
 * Returns the TxID of the first transaction in the group.
 */
async function broadcastAndConfirm(algodUrl: string, groupBytes: Uint8Array[]): Promise<string> {
    // Concatenate all transaction bytes for raw send.
    const totalLength = groupBytes.reduce((sum, b) => sum + b.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const bytes of groupBytes) {
        combined.set(bytes, offset);
        offset += bytes.length;
    }

    // Send raw transaction group.
    const response = await fetch(`${algodUrl}/v2/transactions`, {
        body: combined,
        headers: { 'Content-Type': 'application/x-binary' },
        method: 'POST',
    });

    const data = (await response.json()) as { txId?: string; message?: string };
    if (!data.txId) {
        throw new Error(`Failed to broadcast transaction: ${data.message ?? 'unknown error'}`);
    }

    const txid = data.txId;

    // Wait for confirmation.
    await waitForConfirmation(algodUrl, txid);

    return txid;
}

async function waitForConfirmation(algodUrl: string, txid: string, timeoutMs = 30_000) {
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

        await new Promise(r => setTimeout(r, 2_000));
    }
    throw new Error('Transaction confirmation timeout');
}

export declare namespace charge {
    type Parameters = {
        /**
         * The Algorand address of the sender (client's address).
         * This is the account that will sign and pay for the transaction(s).
         */
        senderAddress: string;
        /**
         * Algorand transaction signer function.
         * Receives raw-encoded transactions as Uint8Array[] and indexes to sign.
         * Returns signed transaction bytes (null for transactions not signed).
         *
         * Compatible with:
         * - `@txnlab/use-wallet` `signTransactions`
         * - x402's `ClientAvmSigner.signTransactions`
         * - Any function matching `(txns: Uint8Array[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>`
         */
        signer: (txns: Uint8Array[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>;
        /**
         * If true, the client broadcasts the transaction group and sends the TxID
         * as a `type="txid"` credential. If false (default), the client sends
         * the signed transaction group as a `type="transaction"` credential and the
         * server broadcasts it.
         *
         * Cannot be used with server fee sponsorship (feePayer mode).
         */
        broadcast?: boolean;
        /** Custom algod URL. If not set, inferred from the challenge's network field. */
        algodUrl?: string;
        /** Called at each step of the payment process. */
        onProgress?: (event: ProgressEvent) => void;
        /**
         * Custom transaction encoder. Override in browser environments where
         * algokit-utils' encodeTransactionRaw produces corrupted bytes.
         * Receives a Transaction object and must return raw msgpack bytes.
         */
        encoder?: TransactionEncoder;
    };

    type ProgressEvent =
        | {
              amount: string;
              currency: string;
              feePayerKey?: string;
              recipient: string;
              asaId?: string;
              type: 'challenge';
          }
        | { txid: string; type: 'paid' }
        | { paymentGroup: string[]; type: 'signed' }
        | { type: 'paying' }
        | { type: 'signing' };
}
