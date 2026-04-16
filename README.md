# Algorand MPP SDK
<img width="3362" height="1248" alt="algorand mpp sdk" src="https://github.com/user-attachments/assets/e82c7a2e-9ab9-45a6-abbb-73a122d80f70" />


**Machine Payments Protocol (MPP) for Algorand** — HTTP-native micropayments using `402 Payment Required`.

[![npm](https://img.shields.io/npm/v/@goplausible/algorand-mpp-sdk)](https://www.npmjs.com/package/@goplausible/algorand-mpp-sdk)
[![License](https://img.shields.io/github/license/GoPlausible/algorand-mpp-sdk)](LICENSE)

---

Try it live: https://mpp.goplausible.xyz (TestNet)

## What is MPP?

The Machine Payments Protocol (MPP) enables any HTTP API to charge for access using standard HTTP headers. When a client requests a paid resource, the server responds with `402 Payment Required` and a payment challenge. The client pays on-chain, retries the request with proof of payment, and receives the resource.

MPP is designed for **machine-to-machine payments** — AI agents, automated systems, and applications that consume paid APIs without human intervention.

## What is the Algorand MPP SDK?

This SDK implements MPP for the **Algorand blockchain**, supporting:

- **Native ALGO payments** and **ASA payments** (USDC, etc.)
- **Fee sponsorship** — server pays transaction fees on behalf of clients
- **Lease-based mutual exclusion** — protocol-level challenge binding that ensures TxID uniqueness across charges and prevents double-settlement
- **Server-broadcast** — server broadcasts transactions

Built on [`@algorandfoundation/algokit-utils`](https://github.com/algorandfoundation/algokit-utils-ts) v10 (no algosdk dependency) and the [`mppx`](https://www.npmjs.com/package/mppx) protocol library.

## Documentation

| Document | Description |
|----------|-------------|
| [Documentation Index](docs/README.md) | Full documentation table of contents |
| [What is MPP?](docs/mpp-overview.md) | Protocol overview and comparison with traditional payments |
| [Algorand Charge Spec](docs/spec.md) | Algorand-specific charge method specification |
| [Architecture](docs/architecture.md) | SDK modules, entry points, and design decisions |
| [Payment Flows](docs/payment-flows.md) | Sequence diagrams for all payment modes |
| [Demo Guide](docs/demo.md) | Demo app features, scenarios, and walkthrough |
| [Demo README](demo/README.md) | Demo quick start, configuration, and API reference |
| [Cloudflare Demo Guide](docs/demo-cloudflare.md) | Cloudflare Workers deployment — architecture, config, and differences from the Express demo |
| [Cloudflare Demo README](demo-cloudflare/README.md) | Cloudflare Workers demo setup, `wrangler.toml`, and deployment |
| [Full Specification](specs/draft-algorand-charge-00.md) | Complete IETF-style specification |

## Installation

```bash
npm install @goplausible/algorand-mpp-sdk mppx
# or
pnpm add @goplausible/algorand-mpp-sdk mppx
```

## Quick Start

### Server (Express)

```ts
import express from 'express'
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/server'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    algorand.charge({
      recipient: 'YOUR_ALGO_ADDRESS',
      network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
      algodUrl: 'https://testnet-api.4160.nodely.dev',
    }),
  ],
})

const app = express()

app.get('/api/data', async (req, res) => {
  const webReq = toWebRequest(req) // convert Express req to Web Request
  const result = await mppx.charge({
    amount: '10000',       // 0.01 ALGO
    currency: 'ALGO',
    description: 'API data access',
  })(webReq)

  if (result.status === 402) {
    const challenge = result.challenge as Response
    res.writeHead(challenge.status, Object.fromEntries(challenge.headers))
    res.end(await challenge.text())
    return
  }

  const response = result.withReceipt(Response.json({ data: '...' })) as Response
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(await response.text())
})
```

### Client (Browser with use-wallet)

```ts
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/client'

// signTransactions from @txnlab/use-wallet
const method = algorand.charge({
  signer: signTransactions,
  senderAddress: activeAccount.address,
  algodUrl: 'https://testnet-api.4160.nodely.dev',
})

const mppx = Mppx.create({ methods: [method] })

// Automatically handles 402 → pay → retry
const response = await mppx.fetch('https://api.example.com/api/data')
const data = await response.json()
```

### Server with Fee Sponsorship + USDC

```ts
algorand.charge({
  recipient: 'SELLER_ADDRESS',
  network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
  algodUrl: 'https://testnet-api.4160.nodely.dev',
  // ASA payment (USDC)
  asaId: 10458941n,
  // Fee sponsorship
  signer: feePayerSigner,
  signerAddress: 'FEE_PAYER_ADDRESS',
})
```

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 10

### Setup

```bash
git clone https://github.com/GoPlausible/algorand-mpp-sdk.git
cd algorand-mpp-sdk
pnpm install
```

### Build

```bash
pnpm build          # Build the SDK (TypeScript → dist/)
```

### Test

```bash
pnpm test           # Run unit tests
pnpm test:watch     # Watch mode
pnpm test:all       # Unit + integration tests
```

### Lint & Format

```bash
pnpm lint           # Check for lint errors
pnpm lint:fix       # Auto-fix lint errors
pnpm format         # Format code with Prettier
pnpm typecheck      # Type-check without emitting
```

## Running the Demo

The demo includes a paid API server and a React frontend for interactive testing.

### Setup

```bash
pnpm build              # Build the SDK first
pnpm demo:install       # Install demo dependencies

# Configure environment
cp demo/server/.env-local demo/server/.env   # Edit with your values
cp demo/app/.env-local demo/app/.env         # Edit with your values
```

### Development (hot reload)

```bash
pnpm demo:dev           # Runs server (port 3000) + app (port 5173)
```

### Production

```bash
pnpm demo:build         # Build server + app
pnpm demo:start         # Start production server
```

### Cloudflare Workers Demo

An alternative deployment that runs the same endpoints as a single Cloudflare Worker (API + SPA together, no separate server process). Useful for edge deployment or when you want one-command deploys via `wrangler`.

```bash
pnpm build              # Build the SDK first
pnpm demo:cf:install    # Install CF demo dependencies
pnpm demo:cf:dev        # Local dev via wrangler (port 8787)
pnpm demo:cf:build      # Build SPA + wrangler dry-run
pnpm demo:cf:deploy     # Deploy to your Cloudflare account
```

Configure `wrangler.toml` vars and secrets (`MPP_SECRET_KEY`, optional `FEE_PAYER_KEY`) before deploying — see the [Cloudflare Demo Guide](docs/demo-cloudflare.md) for architecture and full setup, or the [in-tree README](demo-cloudflare/README.md) for CLI-level reference.

### Demo Endpoints

| Method | Path | Cost | Description |
|--------|------|------|-------------|
| GET | `/api/v1/weather/:city` | 0.01 ALGO | Weather data (native ALGO payment) |
| GET | `/api/v1/marketplace/products` | Free | List marketplace products |
| GET | `/api/v1/marketplace/buy/:id` | 0.10-0.17 USDC | Marketplace purchase (USDC payment) |
| GET | `/api/v1/health` | Free | Server status and configuration |

### Getting TestNet Funds

1. **ALGO** — [Lora TestNet Faucet](https://lora.algokit.io/testnet/fund)
2. **USDC** — [Circle Faucet](https://faucet.circle.com/) (select Algorand TestNet)
3. **Opt-in to USDC** — Add ASA ID `10458941` via your wallet

## Project Structure

```
algorand-mpp-sdk/
├── sdk/src/                # SDK source code
│   ├── client/             # Client-side charge (browser/Node)
│   ├── server/             # Server-side charge (verify, sign, broadcast)
│   ├── utils/              # Transaction building and encoding
│   ├── Methods.ts          # Shared charge method schema
│   └── constants.ts        # Network IDs, algod URLs
├── demo/
│   ├── server/             # Express demo server
│   └── app/                # React + Vite demo frontend
├── demo-cloudflare/        # Cloudflare Workers demo (single-worker API + SPA)
├── docs/                   # Documentation
├── specs/                  # Algorand charge specification
├── dist/                   # Built SDK output
└── package.json
```

## License

[MIT](LICENSE)

## Links

- [GoPlausible](https://goplausible.com)
- [MPP Protocol](https://paymentauth.org)
- [Algorand](https://algorand.co)
- [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts)
