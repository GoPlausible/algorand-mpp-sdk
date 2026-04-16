import { Hono } from 'hono'
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/server'
import type { Env } from '../env'
import type { FeePayer } from '../fee-payer'
import {
  ALGORAND_TESTNET,
  TESTNET_ALGOD_URL,
} from '../constants'

const WEATHER: Record<string, { temperature: number; conditions: string; humidity: number }> = {
  'san-francisco': { temperature: 15, conditions: 'Foggy', humidity: 85 },
  'new-york':      { temperature: 22, conditions: 'Partly Cloudy', humidity: 60 },
  'london':        { temperature: 12, conditions: 'Rainy', humidity: 90 },
  'tokyo':         { temperature: 26, conditions: 'Sunny', humidity: 55 },
  'paris':         { temperature: 18, conditions: 'Overcast', humidity: 70 },
  'sydney':        { temperature: 24, conditions: 'Clear', humidity: 45 },
  'berlin':        { temperature: 10, conditions: 'Cloudy', humidity: 75 },
  'dubai':         { temperature: 38, conditions: 'Sunny', humidity: 30 },
}

export function weatherRoutes(secretKey: string, feePayer: FeePayer | null, recipient: string) {
  const app = new Hono<{ Bindings: Env }>()

  const mppx = Mppx.create({
    secretKey,
    methods: [algorand.charge({
      recipient,
      network: ALGORAND_TESTNET,
      algodUrl: TESTNET_ALGOD_URL,
      ...(feePayer ? {
        signer: feePayer.signer,
        signerAddress: feePayer.address,
      } : {}),
    })],
  })

  app.get('/api/v1/weather/:city', async (c) => {
    const city = c.req.param('city').toLowerCase().replace(/\s+/g, '-')

    const result = await mppx.charge({
      amount: '10000', // 0.01 ALGO
      currency: 'ALGO',
      description: `Weather for ${c.req.param('city')}`,
    })(c.req.raw)

    if (result.status === 402) {
      const challenge = result.challenge as Response
      return challenge
    }

    const data = WEATHER[city]
    if (!data) {
      const available = Object.keys(WEATHER).join(', ')
      return c.json({ error: `City not found. Available: ${available}` }, 404)
    }

    return result.withReceipt(
      Response.json({ city: c.req.param('city'), ...data }),
    ) as Response
  })

  return app
}
