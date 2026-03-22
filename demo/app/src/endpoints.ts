import type { Endpoint } from './types.js'

export const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET',
    path: '/api/v1/weather/:city',
    description: 'City weather data',
    cost: '0.01 ALGO',
    params: [{ name: 'city', default: 'san-francisco' }],
  },
  {
    method: 'GET',
    path: '/api/v1/marketplace/products',
    description: 'List marketplace products',
    cost: 'free',
  },
  {
    method: 'GET',
    path: '/api/v1/marketplace/buy/:productId',
    description: 'Marketplace purchase (splits)',
    cost: '0.10-0.17 USDC + fees',
    params: [
      { name: 'productId', default: 'algo-hoodie' },
      { name: 'referrer', default: '' },
    ],
  },
]

/** Build a URL from an endpoint and parameter values. */
export function buildUrl(endpoint: Endpoint, paramValues: Record<string, string>): string {
  let url = endpoint.path
  const queryParams: string[] = []

  for (const param of endpoint.params ?? []) {
    const value = paramValues[param.name] || param.default
    if (url.includes(`:${param.name}`)) {
      url = url.replace(`:${param.name}`, encodeURIComponent(value))
    } else if (value) {
      queryParams.push(`${param.name}=${encodeURIComponent(value)}`)
    }
  }

  if (queryParams.length) url += `?${queryParams.join('&')}`
  return url
}

/** Generate a code snippet for a given endpoint. */
export function buildSnippet(endpoint: Endpoint, paramValues: Record<string, string>): string {
  const url = buildUrl(endpoint, paramValues)
  return `import { Mppx, algorand } from '@algorand/mpp/client'

const method = algorand.charge({
  signer,          // TransactionSigner from use-wallet or algokit-utils
  senderAddress,   // Algorand address string
  algodUrl: 'https://testnet-api.4160.nodely.dev',
})

const mppx = Mppx.create({ methods: [method] })

const response = await mppx.fetch('${url}')
const data = await response.json()
console.log(data)`
}
