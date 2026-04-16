import type { Express } from 'express'
import type { TransactionSigner } from '@algorandfoundation/algokit-utils/transact'
import { Mppx, algorand } from '../sdk.js'
import { toWebRequest, logPayment } from '../utils.js'
import {
  ALGORAND_TESTNET,
  TESTNET_ALGOD_URL,
  USDC_ASA_ID,
} from '../constants.js'

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

export function registerMarketplace(
  app: Express,
  platformAddress: string,
  secretKey: string,
  feePayerSigner?: TransactionSigner,
  feePayerAddress?: string,
) {
  // List products (free endpoint)
  app.get('/api/v1/marketplace/products', (_req, res) => {
    const list = Object.entries(PRODUCTS).map(([id, p]) => ({
      id,
      name: p.name,
      description: p.description,
      price: `${(p.price / 1_000_000).toFixed(2)} USDC`,
      priceRaw: String(p.price),
    }))
    res.json(list)
  })

  // Purchase — USDC payment to platform
  app.get('/api/v1/marketplace/buy/:productId', async (req, res) => {
    const product = PRODUCTS[req.params.productId]
    if (!product) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const mppx = Mppx.create({
      secretKey,
      methods: [
        algorand.charge({
          recipient: platformAddress,
          network: ALGORAND_TESTNET,
          algodUrl: TESTNET_ALGOD_URL,
          asaId: USDC_ASA_ID,
          ...(feePayerSigner && feePayerAddress ? {
            signer: feePayerSigner,
            signerAddress: feePayerAddress,
          } : {}),
        }),
      ],
    })

    const result = await mppx.charge({
      amount: String(product.price),
      currency: 'USDC',
      description: `Purchase: ${product.name}`,
    })(toWebRequest(req))

    if (result.status === 402) {
      const challenge = result.challenge as Response
      res.writeHead(challenge.status, Object.fromEntries(challenge.headers))
      res.end(await challenge.text())
      return
    }

    const response = result.withReceipt(
      Response.json({
        product: product.name,
        price: `${(product.price / 1_000_000).toFixed(2)} USDC`,
        status: 'purchased',
      }),
    ) as Response
    logPayment(req.path, response)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(await response.text())
  })
}
