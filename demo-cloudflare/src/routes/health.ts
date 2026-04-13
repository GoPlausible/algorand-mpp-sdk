import { Hono } from 'hono'
import type { Env } from '../env'
import type { FeePayer } from '../fee-payer'
import { TESTNET_ALGOD_URL } from '../constants'

export function healthRoutes(feePayer: FeePayer | null) {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/api/v1/health', async (c) => {
    let feePayerBalance: number | undefined
    if (feePayer) {
      try {
        const response = await fetch(`${TESTNET_ALGOD_URL}/v2/accounts/${feePayer.address}`)
        const data = (await response.json()) as { amount?: number }
        if (data.amount) {
          feePayerBalance = data.amount / 1_000_000
        }
      } catch { /* algod may be down */ }
    }

    return c.json({
      ok: true,
      network: c.env.NETWORK,
      recipient: c.env.RECIPIENT,
      feePayer: feePayer?.address ?? null,
      feePayerBalance: feePayerBalance ?? null,
      feePayerEnabled: !!feePayer,
    })
  })

  return app
}
