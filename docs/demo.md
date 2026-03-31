# Demo Application

The demo is a full-stack application demonstrating the Algorand MPP SDK in action. It includes a server with paid API endpoints and a React frontend for interactive testing.

## Components

### Server (`demo/server/`)

An Express.js server that exposes paid endpoints using the MPP SDK's server-side `algorand.charge()`.

- **Weather API** — Charges 0.01 ALGO per request (native ALGO payments)
- **Marketplace** — Charges USDC for product purchases (ASA payments)
- **Health endpoint** — Reports server status, network, and fee payer info

### App (`demo/app/`)

A React + Vite single-page application that:

- Connects Algorand wallets via `@txnlab/use-wallet` (Pera, Defly, Lute)
- Displays an interactive API playground for testing paid endpoints
- Shows the full 402 payment flow in a live terminal
- Resolves NFDomains (.algo names) for wallet display and referral input

## Demonstrated Scenarios

### 1. Native ALGO Payment (Weather API)

**Flow:** Client requests weather data → 402 challenge → pays 0.01 ALGO → receives data

- Demonstrates basic MPP charge flow
- Uses native ALGO (no ASA, no opt-in needed)
- 8 available cities to query

### 2. ASA Payment (Marketplace Purchase)

**Flow:** Client buys a product → 402 challenge → pays USDC → receives purchase confirmation

- Demonstrates ASA (Algorand Standard Asset) payments
- USDC on TestNet (ASA ID: 10458941)
- Products: Algorand Hoodie (0.17 USDC), Validator Mug (0.15 USDC), NFT Sticker Pack (0.10 USDC)
- Requires USDC opt-in for the buyer

### 3. Fee Sponsorship

**Flow:** Server pays transaction fees on behalf of the client

- Fee payer transaction at index 0 covers all fees via fee pooling
- Client's transactions have zero fee
- Server signs the fee payer transaction after verification
- Configurable via `FEE_PAYER_KEY` environment variable

### 5. NFDomains Integration

- Connected wallet displays NFD name (e.g., `alice.algo`) instead of truncated address
- Wallet modal shows NFD name alongside full address
- Referrer input accepts NFD names — resolved to deposit address before sending
- NFD lookups always use mainnet API (NFDs don't exist on testnet)

### 6. Server-Broadcast Settlement

- Client signs transactions and sends the group to the server
- Server verifies, signs fee payer, simulates, and broadcasts
- Server has full control over when and whether to broadcast

### 7. Product Listing (Free Endpoint)

- `/api/v1/marketplace/products` returns available products without payment
- Demonstrates that not all endpoints require payment
- Products displayed in the UI with icons and prices

## UI Features

### Wallet Bar
- Shows connected wallet icon, NFD name or short address, ALGO balance
- Network indicator (reads from server configuration)
- Quick disconnect button

### Endpoint Sidebar
- Lists all API endpoints with methods and costs
- Click to select and configure parameters

### Showcase Panel
- **Weather**: City selection chips — click to set the city parameter
- **Marketplace**: Product cards with images, descriptions, prices — click to select for purchase

### API Panel
- Shows selected endpoint, method, path, and cost
- Parameter inputs (with NFD-aware placeholder for referrer)
- Send Request button and code snippet toggle

### Terminal
- Live log of the payment flow:
  - Request sent
  - 402 Payment Required (amount + currency)
  - Signing transaction group
  - Broadcasting to Algorand
  - Confirmed with TxID
  - 200 OK with response data

### Code Snippet
- Shows the equivalent TypeScript code for the current endpoint
- Demonstrates how to use the SDK programmatically

## Setup

```bash
# From repo root
pnpm build                # Build the SDK
pnpm demo:install         # Install demo dependencies

# Configure
cp demo/server/.env-local demo/server/.env
cp demo/app/.env-local demo/app/.env

# Run
pnpm demo:dev             # Server (port 3000) + App (port 5173)
```

## Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `RECIPIENT` | Address receiving payments | Zero address |
| `NETWORK` | CAIP-2 network identifier | TestNet |
| `MPP_SECRET_KEY` | HMAC secret for challenge signing | Random |
| `FEE_PAYER_KEY` | Mnemonic or base64 key for fee sponsorship | Disabled |
| `PORT` | Server port | 3000 |

## App Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_ALGOD_URL` | Algod URL for balance queries | TestNet Nodely |
| `VITE_API_BASE_URL` | Server API URL | `http://localhost:3000` |
| `VITE_PORT` | Vite dev server port | 5173 |

## Getting TestNet Funds

1. **ALGO** — [Lora TestNet Faucet](https://lora.algokit.io/testnet/fund)
2. **USDC** — [Circle Faucet](https://faucet.circle.com/) (select Algorand TestNet)
3. **Opt-in to USDC** — Add ASA ID `10458941` via your wallet before receiving USDC

## Wallet Support

| Wallet | ID | Notes |
|--------|----|-------|
| Pera | `WalletId.PERA` | Mobile + web |
| Defly | `WalletId.DEFLY` | Mobile + web |
| Lute | `WalletId.LUTE` | Desktop, requires `siteName` option |

## Vite Configuration Note

The demo app requires a specific Vite config to work with `@algorandfoundation/algokit-utils`:

```ts
// vite.config.ts
resolve: {
  conditions: ['import'],  // Force ESM resolution for algokit-utils
}
```

This is needed because algokit-utils v10 alpha declares `"type": "commonjs"` which causes Vite to resolve the CJS build by default, leading to transaction encoding corruption. The `conditions: ['import']` setting forces Vite to use the ESM `.mjs` files which work correctly. See [.notes/algokit-utils-browser-bug.md](../.notes/algokit-utils-browser-bug.md) for full details.
