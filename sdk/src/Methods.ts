import { Method, z } from "mppx";

/**
 * Algorand charge method — shared schema used by both server and client.
 *
 * The client signs the transaction group and sends the serialized bytes
 * to the server. The server verifies, optionally signs the fee payer
 * transaction, and broadcasts the group to the Algorand network.
 */
export const charge = Method.from({
  intent: "charge",
  name: "algorand",
  schema: {
    credential: {
      payload: z.object({
        /**
         * Array of base64-encoded msgpack-serialized transactions (signed or unsigned).
         * Max 16 elements.
         */
        paymentGroup: z.array(z.string()),
        /**
         * Zero-based index into paymentGroup identifying the primary payment transaction.
         */
        paymentIndex: z.number(),
        /** Payload type. Must be "transaction". */
        type: z.string(),
      }),
    },
    request: z.object({
      /** Amount in base units (microalgos for ALGO, smallest unit for ASAs). */
      amount: z.string(),
      /**
       * Display label identifying the unit for amount. "ALGO" for native.
       * For ASAs this is INFORMATIONAL ONLY — the canonical asset identity is
       * `asaId` in `methodDetails`. ASA names are NOT unique on Algorand;
       * clients MUST NOT rely on `currency` to identify the asset.
       */
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
        /**
         * Base64-encoded 32-byte lease value for the payment transaction's `lx` field.
         * Provides protocol-level idempotency bound to this challenge.
         */
        lease: z.optional(z.string()),
        /** CAIP-2 network identifier (algorand:<genesis-hash>). Defaults to MainNet. */
        network: z.optional(z.string()),
        /**
         * Server-generated unique identifier for this payment challenge.
         * Distinct from the receipt `reference` which is the on-chain TxID.
         */
        challengeReference: z.string(),
        /** Suggested transaction parameters from the server. */
        suggestedParams: z.optional(
          z.object({
            /** Suggested fee per byte in microalgos. 0 under normal conditions; increases under congestion. */
            fee: z.number(),
            /** First valid round. */
            firstValid: z.number(),
            /** Genesis hash (base64). */
            genesisHash: z.string(),
            /** Genesis ID string (e.g., "mainnet-v1.0"). */
            genesisId: z.string(),
            /** Last valid round. */
            lastValid: z.number(),
            /** Network minimum fee per transaction in microalgos. */
            minFee: z.number(),
          }),
        ),
      }),
      /** Algorand address of the account receiving the payment. */
      recipient: z.string(),
    }),
  },
});
