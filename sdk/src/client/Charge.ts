import { Credential, Method } from "mppx";

import { ALGORAND_MAINNET, DEFAULT_ALGOD_URLS } from "../constants.js";
import * as Methods from "../Methods.js";
import {
  buildChargeGroup,
  resolveSuggestedParams,
  signAndEncodeGroup,
  base64ToUint8Array,
  type TransactionEncoder,
} from "../utils/transactions.js";

/**
 * Creates an Algorand `charge` method for usage on the client.
 *
 * The client signs the transaction group and sends the serialized group
 * as a `type="transaction"` credential. The server broadcasts it to the
 * Algorand network.
 *
 * When the server advertises `feePayer: true` in the challenge, the client
 * includes an unsigned fee payer transaction in the group. The server adds
 * its signature before broadcasting.
 *
 * @example
 * ```ts
 * import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/client'
 *
 * const method = algorand.charge({ signer, algodUrl: 'https://testnet-api.4160.nodely.dev' })
 * const mppx = Mppx.create({ methods: [method] })
 *
 * const response = await mppx.fetch('https://api.example.com/paid-content')
 * console.log(await response.json())
 * ```
 */
export function charge(parameters: charge.Parameters) {
  const {
    signer,
    senderAddress,
    onProgress,
    encoder,
  } = parameters;

  const method = Method.toClient(Methods.charge, {
    async createCredential({ challenge }) {
      const { amount, currency, recipient, methodDetails } = challenge.request;
      const {
        network,
        asaId,
        decimals,
        challengeReference,
        feePayer: serverPaysFees,
        feePayerKey,
        lease: leaseB64,
        suggestedParams: serverSuggestedParams,
      } = methodDetails;

      const resolvedNetwork = network || ALGORAND_MAINNET;
      const algodUrl =
        parameters.algodUrl ??
        DEFAULT_ALGOD_URLS[resolvedNetwork] ??
        DEFAULT_ALGOD_URLS[ALGORAND_MAINNET];

      onProgress?.({
        amount,
        currency: currency || (asaId ? "ASA" : "ALGO"),
        feePayerKey: feePayerKey || undefined,
        recipient,
        asaId: asaId || undefined,
        type: "challenge",
      });

      const useServerFeePayer = !!(serverPaysFees && feePayerKey);

      // Resolve suggested params.
      const txnParams = await resolveSuggestedParams(
        serverSuggestedParams,
        resolvedNetwork,
        algodUrl,
      );

      // Decode lease if present.
      const lease = leaseB64 ? base64ToUint8Array(leaseB64) : undefined;

      // Build the transaction group.
      const { transactions, paymentIndex } = buildChargeGroup({
        sender: senderAddress,
        receiver: recipient,
        amount: BigInt(amount),
        asaId: asaId ? BigInt(asaId) : undefined,
        challengeReference,
        externalId: challenge.request.externalId,
        lease,
        useServerFeePayer,
        feePayerKey,
        suggestedParams: txnParams,
      });

      onProgress?.({ type: "signing" });

      // Sign the group (leave fee payer unsigned if present).
      const feePayerIndex = useServerFeePayer ? 0 : undefined;
      const paymentGroup = await signAndEncodeGroup({
        transactions,
        signer,
        feePayerIndex,
        encoder,
      });

      onProgress?.({ paymentGroup, type: "signed" });

      return Credential.serialize({
        challenge,
        source: senderAddress,
        payload: { paymentGroup, paymentIndex, type: "transaction" },
      });
    },
  });

  return method;
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
    signer: (
      txns: Uint8Array[],
      indexesToSign?: number[],
    ) => Promise<(Uint8Array | null)[]>;
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
        type: "challenge";
      }
    | { paymentGroup: string[]; type: "signed" }
    | { type: "signing" };
}
