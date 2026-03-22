import { Hono } from 'hono'
import { Mppx, algorand } from '@goplausible/algorand-mpp/server'
import type { Env } from '../env'
import type { FeePayer } from '../fee-payer'
import {
  ALGORAND_TESTNET,
  TESTNET_ALGOD_URL,
  TESTNET_INDEXER_URL,
  USDC_ASA_ID,
  USDC_DECIMALS,
} from '../constants'

const PRODUCTS: Record<
  string,
  { name: string; price: number; description: string }
> = {
  'algo-hoodie': {
    name: 'Algorand Hoodie',
    price: 170_000, // 0.17 USDC
    description: 'Premium Algorand-branded hoodie',
  },
  'validator-mug': {
    name: 'Validator Mug',
    price: 150_000, // 0.15 USDC
    description: 'Ceramic mug for node operators',
  },
  'nft-sticker-pack': {
    name: 'NFT Sticker Pack',
    price: 100_000, // 0.10 USDC
    description: 'Holographic sticker collection',
  },
}

const PLATFORM_FEE_BPS = 500 // 5%
const REFERRAL_FEE_BPS = 200 // 2%

export function marketplaceRoutes(secretKey: string, feePayer: FeePayer | null, platformAddress: string) {
  const app = new Hono<{ Bindings: Env }>()

  // List products (free)
  app.get('/api/v1/marketplace/products', (c) => {
    const list = Object.entries(PRODUCTS).map(([id, p]) => ({
      id,
      name: p.name,
      description: p.description,
      price: `${(p.price / 1_000_000).toFixed(2)} USDC`,
      priceRaw: String(p.price),
    }))
    return c.json(list)
  })

  // Purchase with splits
  app.get('/api/v1/marketplace/buy/:productId', async (c) => {
    const product = PRODUCTS[c.req.param('productId')]
    if (!product) {
      return c.json({ error: 'Product not found' }, 404)
    }

    const referrer = c.req.query('referrer')

    // Validate referrer is opted in to USDC
    if (referrer) {
      try {
        const acctRes = await fetch(`${TESTNET_ALGOD_URL}/v2/accounts/${referrer}`)
        const acctData = (await acctRes.json()) as { assets?: Array<{ 'asset-id': number }> }
        const hasUsdc = acctData.assets?.some((a) => a['asset-id'] === Number(USDC_ASA_ID))
        if (!hasUsdc) {
          return c.json({
            error: 'Referrer not opted in to USDC',
            detail: `Account ${referrer} must opt in to ASA ${USDC_ASA_ID} (TestNet USDC) before receiving referral payments.`,
            faucet: 'https://faucet.circle.com/',
          }, 400)
        }
      } catch {
        return c.json({ error: 'Could not verify referrer account' }, 400)
      }
    }

    // Compute splits
    const platformFee = Math.floor((product.price * PLATFORM_FEE_BPS) / 10_000)
    const referralFee = referrer ? Math.floor((product.price * REFERRAL_FEE_BPS) / 10_000) : 0
    const totalAmount = product.price + platformFee + referralFee

    const splits: Array<{ recipient: string; amount: string; memo?: string }> = [
      { recipient: platformAddress, amount: String(platformFee), memo: 'platform fee (5%)' },
    ]

    if (referrer) {
      splits.push({ recipient: referrer, amount: String(referralFee), memo: 'referral (2%)' })
    }

    const mppx = Mppx.create({
      secretKey,
      methods: [
        algorand.charge({
          recipient: platformAddress,
          network: ALGORAND_TESTNET,
          algodUrl: TESTNET_ALGOD_URL,
          indexerUrl: TESTNET_INDEXER_URL,
          asaId: USDC_ASA_ID,
          decimals: USDC_DECIMALS,
          splits,
          ...(feePayer ? {
            signer: feePayer.signer,
            signerAddress: feePayer.address,
          } : {}),
        }),
      ],
    })

    const result = await mppx.charge({
      amount: String(totalAmount),
      currency: 'USDC',
      description: `Purchase: ${product.name}`,
    })(c.req.raw)

    if (result.status === 402) {
      return result.challenge as Response
    }

    return result.withReceipt(
      Response.json({
        product: product.name,
        breakdown: {
          seller: `${(product.price / 1_000_000).toFixed(2)} USDC`,
          platformFee: `${(platformFee / 1_000_000).toFixed(2)} USDC`,
          ...(referrer ? { referralFee: `${(referralFee / 1_000_000).toFixed(2)} USDC` } : {}),
          total: `${(totalAmount / 1_000_000).toFixed(2)} USDC`,
        },
        status: 'purchased',
      }),
    ) as Response
  })

  return app
}
