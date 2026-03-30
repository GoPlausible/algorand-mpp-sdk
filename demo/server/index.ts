import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Request, Response } from 'express'
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { secretKeyToMnemonic } from '@algorandfoundation/algokit-utils/algo25'
import { registerWeather } from './modules/weather.js'
import { registerMarketplace } from './modules/marketplace.js'

import { ALGORAND_TESTNET, TESTNET_ALGOD_URL } from './constants.js'

// ── Configuration ──

// Recipient is the Algorand address that receives payments.
// Set RECIPIENT env var or a default demo address is used.
const RECIPIENT = process.env.RECIPIENT ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ'
const NETWORK = process.env.NETWORK ?? ALGORAND_TESTNET
const SECRET_KEY = process.env.MPP_SECRET_KEY ?? crypto.randomBytes(32).toString('hex')

// ── Fee payer ──
// When FEE_PAYER_KEY is set, the server will act as fee payer
// for all transactions (fee sponsorship mode).
// Accepts either:
//   - A 25-word Algorand mnemonic (space-separated)
//   - A base64-encoded private key (44 chars, ends with =)

let feePayerSigner: import('@algorandfoundation/algokit-utils/transact').TransactionSigner | undefined
let feePayerAddress: string | undefined

if (process.env.FEE_PAYER_KEY) {
  try {
    const algorand = AlgorandClient.testNet()
    const key = process.env.FEE_PAYER_KEY.trim()
    const isMnemonic = key.split(/\s+/).length === 25

    const mnemonic = isMnemonic
      ? key
      : secretKeyToMnemonic(new Uint8Array(Buffer.from(key, 'base64')))
    const account = algorand.account.fromMnemonic(mnemonic)

    feePayerAddress = account.addr.toString()
    feePayerSigner = account.signer

    // Check balance
    const info = await algorand.account.getInformation(account.addr)
    const balanceMicroAlgo = info.balance
    const balanceAlgo = Number(balanceMicroAlgo) / 1_000_000
    console.log(`  Fee payer loaded: ${feePayerAddress} (${balanceAlgo.toFixed(3)} ALGO)`)
  } catch (err) {
    console.warn('Could not load fee payer from FEE_PAYER_KEY:', err)
    feePayerSigner = undefined
    feePayerAddress = undefined
  }
} else {
  console.log('  No FEE_PAYER_KEY set — fee sponsorship disabled.')
  console.log('  Clients will pay their own transaction fees.')
}

// ── Express app ──

const app = express()
app.use(express.json())
app.use(
  cors({
    exposedHeaders: [
      'www-authenticate',
      'payment-receipt',
    ],
  }),
)

// Health check — exposes server info and fee payer status
app.get('/api/v1/health', async (_req: Request, res: Response) => {
  let feePayerBalance: number | undefined
  if (feePayerAddress) {
    try {
      const response = await fetch(`${TESTNET_ALGOD_URL}/v2/accounts/${feePayerAddress}`)
      const data = (await response.json()) as { amount?: number }
      if (data.amount) {
        feePayerBalance = data.amount / 1_000_000
      }
    } catch { /* algod may be down */ }
  }
  res.json({
    ok: true,
    network: NETWORK,
    recipient: RECIPIENT,
    feePayer: feePayerAddress ?? null,
    feePayerBalance: feePayerBalance ?? null,
    feePayerEnabled: !!feePayerSigner,
  })
})

// Register modules
registerWeather(app, RECIPIENT, SECRET_KEY, feePayerSigner, feePayerAddress)
registerMarketplace(app, RECIPIENT, SECRET_KEY, feePayerSigner, feePayerAddress)

// Serve SPA in production
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appDist = path.join(__dirname, '../app/dist')
app.use(express.static(appDist))
app.get('*splat', (_req: Request, res: Response) => {
  res.sendFile(path.join(appDist, 'index.html'))
})

// ANSI colors
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  console.log()
  console.log(bold('  algorand-mpp-sdk demo'))
  console.log()
  console.log(`  ${dim('Server')}      ${cyan(`http://localhost:${PORT}`)}`)
  console.log(`  ${dim('Recipient')}   ${green(RECIPIENT)}`)
  console.log(`  ${dim('Fee payer')}   ${feePayerAddress ? green(feePayerAddress) : dim('disabled')}`)
  console.log(`  ${dim('Network')}     ${magenta(NETWORK)}`)
  console.log()
  console.log(bold('  Endpoints'))
  console.log()
  const endpoints = [
    { method: 'GET',  path: '/api/v1/weather/:city',            cost: '0.01 ALGO' },
    { method: 'GET',  path: '/api/v1/marketplace/products',     cost: '' },
    { method: 'GET',  path: '/api/v1/marketplace/buy/:id',      cost: '0.10-0.17 USDC' },
    { method: 'GET',  path: '/api/v1/health',                   cost: '' },
  ]
  const maxMethod = Math.max(...endpoints.map(e => e.method.length))
  const maxPath = Math.max(...endpoints.map(e => e.path.length))
  for (const ep of endpoints) {
    const m = ep.method === 'POST' ? cyan(ep.method) : green(ep.method)
    const mPad = ' '.repeat(maxMethod - ep.method.length)
    const pPad = ' '.repeat(maxPath - ep.path.length)
    const cost = ep.cost
      ? `${yellow(ep.cost)}  ${feePayerSigner ? dim('server pays fees') : dim('client pays fees')}`
      : dim('free')
    console.log(`  ${m}${mPad}  ${ep.path}${pPad}  ${cost}`)
  }
  console.log()
  console.log(dim('  Faucets:'))
  console.log(dim('    ALGO: https://lora.algokit.io/testnet/fund'))
  console.log(dim('    USDC: https://faucet.circle.com/'))
  console.log()
})
