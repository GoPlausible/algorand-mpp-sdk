import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { secretKeyToMnemonic } from '@algorandfoundation/algokit-utils/algo25'
import type { TransactionSigner } from '@algorandfoundation/algokit-utils/transact'

export interface FeePayer {
  signer: TransactionSigner
  address: string
}

/**
 * Load fee payer from FEE_PAYER_KEY env/secret.
 * Accepts 25-word mnemonic or base64-encoded private key.
 * Returns null if not configured or invalid.
 */
export function loadFeePayer(feePayerKey: string | undefined): FeePayer | null {
  if (!feePayerKey) return null

  try {
    const algorand = AlgorandClient.testNet()
    const key = feePayerKey.trim()
    const isMnemonic = key.split(/\s+/).length === 25

    const mnemonic = isMnemonic
      ? key
      : secretKeyToMnemonic(new Uint8Array(
          // Workers have atob but not Buffer — use atob for base64 decode
          Uint8Array.from(atob(key), c => c.charCodeAt(0)),
        ))
    const account = algorand.account.fromMnemonic(mnemonic)

    return {
      signer: account.signer,
      address: account.addr.toString(),
    }
  } catch (err) {
    console.warn('Could not load fee payer from FEE_PAYER_KEY:', err)
    return null
  }
}
