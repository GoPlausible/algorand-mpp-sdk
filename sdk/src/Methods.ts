import { Method, z } from 'mppx';

/**
 * Algorand charge method — shared schema used by both server and client.
 *
 * Supports two settlement modes:
 *
 * - **Pull mode** (`type="transaction"`, default): Client signs the
 *   transaction group and sends the serialized bytes to the server.
 *   The server broadcasts it to the Algorand network.
 *
 * - **Push mode** (`type="txid"`): Client broadcasts the transaction
 *   group itself and sends the confirmed TxID. The server verifies on-chain.
 */
export const charge = Method.from({
    intent: 'charge',
    name: 'algorand',
    schema: {
        credential: {
            payload: z.object({
                /**
                 * Array of base64-encoded msgpack-serialized transactions (signed or unsigned).
                 * Max 16 elements. Present when type="transaction".
                 */
                paymentGroup: z.optional(z.array(z.string())),
                /**
                 * Zero-based index into paymentGroup identifying the primary payment transaction.
                 * Present when type="transaction".
                 */
                paymentIndex: z.optional(z.number()),
                /**
                 * 52-character base32 Algorand transaction identifier.
                 * Present when type="txid".
                 */
                txid: z.optional(z.string()),
                /** Payload type: "transaction" (server broadcasts) or "txid" (client already broadcast). */
                type: z.string(),
            }),
        },
        request: z.object({
            /** Amount in base units (microalgos for ALGO, smallest unit for ASAs). */
            amount: z.string(),
            /** Identifies the unit for amount. "ALGO" for native, or token symbol/ASA ID (e.g. "USDC"). */
            currency: z.string(),
            /** Human-readable memo describing the resource or service being paid for. */
            description: z.optional(z.string()),
            /** Merchant's reference (e.g., order ID, invoice number) for reconciliation. */
            externalId: z.optional(z.string()),
            methodDetails: z.object({
                /** ASA ID of the asset to transfer. If absent, payment is in native ALGO. */
                asaId: z.optional(z.string()),
                /** Number of decimal places for the ASA (0-19). Required when asaId is present. */
                decimals: z.optional(z.number()),
                /** If true, server pays transaction fees via fee pooling. */
                feePayer: z.optional(z.boolean()),
                /** Server's Algorand address for fee payment. Present when feePayer is true. */
                feePayerKey: z.optional(z.string()),
                /** CAIP-2 network identifier (algorand:<genesis-hash>). Defaults to MainNet. */
                network: z.optional(z.string()),
                /** Server-generated unique identifier for this charge. */
                reference: z.string(),
                /** Additional payment splits (max 7). Same asset as primary payment. */
                splits: z.optional(
                    z.array(
                        z.object({
                            /** Amount in base units (same asset as primary). */
                            amount: z.string(),
                            /** Optional memo for this split (max 1024 bytes). */
                            memo: z.optional(z.string()),
                            /** Algorand address of the split recipient. */
                            recipient: z.string(),
                        }),
                    ),
                ),
                /** Suggested transaction parameters from the server. */
                suggestedParams: z.optional(
                    z.object({
                        /** First valid round. */
                        firstValid: z.number(),
                        /** Genesis hash (base64). */
                        genesisHash: z.string(),
                        /** Genesis ID string (e.g., "mainnet-v1.0"). */
                        genesisId: z.string(),
                        /** Last valid round. */
                        lastValid: z.number(),
                    }),
                ),
            }),
            /** Algorand address of the account receiving the payment. */
            recipient: z.string(),
        }),
    },
});
