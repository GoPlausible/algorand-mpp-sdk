import { charge as charge_ } from './Charge.js';

/**
 * Creates Algorand payment methods for usage on the server.
 *
 * @example
 * ```ts
 * import { Mppx, algorand } from '@goplausible/algorand-mpp/server'
 *
 * const mppx = Mppx.create({
 *   methods: [algorand.charge({ recipient: 'ALGO...', network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=' })],
 * })
 * ```
 */
export const algorand: {
    (parameters: algorand.Parameters): ReturnType<typeof charge_>;
    charge: typeof charge_;
} = Object.assign((parameters: algorand.Parameters) => algorand.charge(parameters), {
    charge: charge_,
});

export declare namespace algorand {
    type Parameters = charge_.Parameters;
}
