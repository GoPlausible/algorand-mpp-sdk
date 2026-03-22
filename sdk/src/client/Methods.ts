import { charge as charge_ } from './Charge.js';

/**
 * Creates an Algorand `charge` method for usage on the client.
 *
 * Intercepts 402 responses, sends an Algorand transaction to pay the challenge,
 * and retries with the credential automatically.
 *
 * @example
 * ```ts
 * import { Mppx, algorand } from '@goplausible/algorand-mpp/client'
 *
 * const method = algorand.charge({ signer, senderAddress: 'ALGO...' })
 * const mppx = Mppx.create({ methods: [method] })
 *
 * const response = await mppx.fetch('https://api.example.com/paid-content')
 * ```
 */
export const algorand: {
    (parameters: algorand.Parameters): ReturnType<typeof charge_>;
    charge: typeof charge_;
} = Object.assign((parameters: algorand.Parameters) => charge_(parameters), {
    charge: charge_,
});

export declare namespace algorand {
    type Parameters = charge_.Parameters;
}
