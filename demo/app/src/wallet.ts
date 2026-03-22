import { Mppx, algorand } from '@algorand/mpp/client'
import algosdk from 'algosdk'

// The SDK's client signer matches use-wallet's signTransactions exactly:
//   (txns: Uint8Array[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>
type UseWalletSignTransactions = <T extends algosdk.Transaction[] | Uint8Array[]>(txnGroup: T | T[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>

type Signer = (txns: Uint8Array[], indexesToSign?: number[]) => Promise<(Uint8Array | null)[]>

// algosdk-based transaction encoder for browser environments.
// algokit-utils' encodeTransactionRaw produces corrupted bytes in Vite bundles.
// This encoder uses algosdk which works correctly in the browser.
export function algosdkEncoder(txn: any): Uint8Array {
  // The Transaction object from algokit-utils has all the fields we need.
  // We manually build an algosdk-compatible msgpack object.
  const obj: Record<string, unknown> = {
    type: txn.type,
    snd: txn.sender?.publicKey ?? new Uint8Array(32),
    fee: Number(txn.fee ?? 0),
    fv: Number(txn.firstValid),
    lv: Number(txn.lastValid),
    gh: txn.genesisHash,
    gen: txn.genesisId,
  }

  if (txn.group) obj.grp = txn.group
  if (txn.note && txn.note.length > 0) obj.note = txn.note

  // Payment fields
  if (txn.payment) {
    obj.rcv = txn.payment.receiver?.publicKey ?? new Uint8Array(32)
    obj.amt = Number(txn.payment.amount ?? 0)
  }

  // Asset transfer fields
  if (txn.assetTransfer) {
    obj.arcv = txn.assetTransfer.receiver?.publicKey ?? new Uint8Array(32)
    obj.aamt = Number(txn.assetTransfer.amount ?? 0)
    obj.xaid = Number(txn.assetTransfer.assetId)
  }

  // Sort keys alphabetically (Algorand canonical encoding)
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key]
    // Skip zero/empty values (Algorand canonical: omit defaults)
    if (val === 0 || val === '' || val === undefined || val === null) continue
    if (val instanceof Uint8Array && val.length === 0) continue
    sorted[key] = val
  }

  const encoded = algosdk.msgpackRawEncode(sorted) as Uint8Array

  // Verify round-trip
  const verify = algosdk.msgpackRawDecode(encoded) as Record<string, unknown>
  const sndBytes = verify['snd'] as Uint8Array | undefined
  console.log('[algosdkEncoder] encoded keys:', Object.keys(verify), 'snd bytes:', sndBytes?.length, 'has grp:', 'grp' in verify)

  return encoded
}

// Wrap use-wallet's signTransactions.
// For null entries (fee payer txns the wallet can't sign), return the
// properly encoded unsigned bytes.
export function createSigner(signTransactions: UseWalletSignTransactions): Signer {
  return async (txns: Uint8Array[], indexesToSign?: number[]) => {
    const signed = await signTransactions(txns, indexesToSign)
    console.log('[createSigner] wallet returned:', signed.map((s, i) => `[${i}]=${s ? s.length + 'B' : 'null'}`).join(' '))
    // For null entries, return the original bytes (already encoded by algosdkEncoder)
    return signed.map((s, i) => s ?? txns[i])
  }
}

const TESTNET_ALGOD_URL = import.meta.env.VITE_ALGOD_URL ?? 'https://testnet-api.4160.nodely.dev'

export type Balances = { algo: number; usdc: number }

// ── Balance fetching ──

export async function getBalances(address: string): Promise<Balances> {
  const response = await fetch(`${TESTNET_ALGOD_URL}/v2/accounts/${address}`)
  const data = (await response.json()) as {
    amount?: number
    assets?: Array<{ 'asset-id': number; amount: number }>
  }

  const algo = (data.amount ?? 0) / 1_000_000

  // USDC TestNet ASA ID: 10458941
  const usdcAsset = data.assets?.find((a) => a['asset-id'] === 10458941)
  const usdc = usdcAsset ? usdcAsset.amount / 1_000_000 : 0

  return { algo, usdc }
}

export async function getAlgoBalance(address: string): Promise<number> {
  const response = await fetch(`${TESTNET_ALGOD_URL}/v2/accounts/${address}`)
  const data = (await response.json()) as { amount?: number }
  return (data.amount ?? 0) / 1_000_000
}

// ── Mppx client ──

let mppxInstance: ReturnType<typeof Mppx.create> | null = null
let currentAddress: string | null = null

type ProgressEvent =
  | { type: 'challenge'; recipient: string; amount: string; currency: string; asaId?: string; feePayerKey?: string }
  | { type: 'signing' }
  | { type: 'signed'; paymentGroup: string[] }
  | { type: 'paying' }
  | { type: 'paid'; txid: string }

let progressCallback: ((event: ProgressEvent) => void) | null = null

export function createMppxClient(signer: Signer, senderAddress: string) {
  if (mppxInstance && currentAddress === senderAddress) {
    return mppxInstance
  }

  const method = algorand.charge({
    signer,
    senderAddress,
    algodUrl: TESTNET_ALGOD_URL,
    encoder: algosdkEncoder,
    onProgress(event) {
      progressCallback?.(event as ProgressEvent)
    },
  })

  mppxInstance = Mppx.create({ methods: [method] })
  currentAddress = senderAddress
  return mppxInstance
}

export function resetMppxClient() {
  mppxInstance = null
  currentAddress = null
}

// ── Pay and fetch ──

export type Step =
  | { type: 'request'; url: string }
  | { type: 'challenge'; amount: string; recipient: string; currency?: string; feePayerKey?: string }
  | { type: 'signing' }
  | { type: 'paying' }
  | { type: 'paid'; txid: string }
  | { type: 'success'; data: unknown; status: number }
  | { type: 'error'; message: string }

export async function* payAndFetch(
  url: string,
  signer: Signer,
  senderAddress: string,
): AsyncGenerator<Step> {
  yield { type: 'request', url }

  const steps: Step[] = []
  let resolve: (() => void) | null = null

  progressCallback = (event) => {
    let step: Step
    switch (event.type) {
      case 'challenge':
        step = {
          type: 'challenge',
          amount: event.amount,
          recipient: event.recipient,
          currency: event.currency,
          feePayerKey: event.feePayerKey,
        }
        break
      case 'signing':
        step = { type: 'signing' }
        break
      case 'signed':
        return // internal detail, skip
      case 'paying':
        step = { type: 'paying' }
        break
      case 'paid':
        step = { type: 'paid', txid: event.txid }
        break
    }
    steps.push(step)
    resolve?.()
  }

  try {
    const mppx = createMppxClient(signer, senderAddress)
    const fetchPromise = mppx.fetch(url)

    while (true) {
      if (steps.length > 0) {
        yield steps.shift()!
        continue
      }

      const result = await Promise.race([
        fetchPromise.then((r: Response) => ({ done: true as const, response: r })),
        new Promise<{ done: false }>((r) => {
          resolve = () => r({ done: false })
        }),
      ])

      if (result.done) {
        while (steps.length > 0) yield steps.shift()!

        const response = result.response
        try {
          const data = await response.json()
          yield { type: 'success', data, status: response.status }
        } catch {
          yield { type: 'success', data: await response.text(), status: response.status }
        }
        return
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message }
  } finally {
    progressCallback = null
  }
}
