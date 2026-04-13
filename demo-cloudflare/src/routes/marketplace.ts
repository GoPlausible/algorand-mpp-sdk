import { Hono } from 'hono'
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/server'
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

  // Purchase — USDC payment to platform
  app.get('/api/v1/marketplace/buy/:productId', async (c) => {
    const product = PRODUCTS[c.req.param('productId')]
    if (!product) {
      return c.json({ error: 'Product not found' }, 404)
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
          ...(feePayer ? {
            signer: feePayer.signer,
            signerAddress: feePayer.address,
          } : {}),
        }),
      ],
    })

    const result = await mppx.charge({
      amount: String(product.price),
      currency: 'USDC',
      description: `Purchase: ${product.name}`,
    })(c.req.raw)

    if (result.status === 402) {
      return result.challenge as Response
    }

    return result.withReceipt(
      Response.json({
        product: product.name,
        price: `${(product.price / 1_000_000).toFixed(2)} USDC`,
        status: 'purchased',
      }),
    ) as Response
  })

  return app
}
