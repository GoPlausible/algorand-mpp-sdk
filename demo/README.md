# Algorand MPP Demo

A demo server demonstrating the Algorand Machine Payments Protocol (MPP) SDK.

## Overview

The demo server exposes paid API endpoints that require Algorand payments to access.
It demonstrates:

- **Native ALGO payments** — Weather API charges 0.01 ALGO per request
- **USDC (ASA) payments** — Marketplace charges USDC for purchases
- **Fee sponsorship** — Server optionally pays transaction fees on behalf of clients
- **Server-broadcast mode** — Server receives signed transaction group, verifies, simulates, and broadcasts
- **Client-broadcast mode** — Client broadcasts transaction and sends TxID for server verification

## Quick Start

```bash
# From the repo root
pnpm build              # Build the SDK first
pnpm demo:install       # Install demo dependencies

# Configure environment
cp demo/server/.env-local demo/server/.env   # Edit with your values
cp demo/app/.env-local demo/app/.env         # Edit with your values

# Development (hot reload)
pnpm demo:dev           # Runs server + app concurrently

# Production
pnpm demo:build         # Build server + app
pnpm demo:start         # Start production server
```

The server starts on `http://localhost:3000` and the app on `http://localhost:5173` in dev mode.

## Configuration

Copy `.env-local` to `.env` in each demo directory and edit as needed.

### Server (`demo/server/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `RECIPIENT` | Algorand address receiving payments | Zero address (demo) |
| `NETWORK` | CAIP-2 network identifier | TestNet |
| `MPP_SECRET_KEY` | Secret key for mppx challenge signing | Random (generated) |
| `FEE_PAYER_KEY` | 25-word mnemonic or base64 private key for fee sponsorship | None (disabled) |
| `PORT` | Server port | 3000 |

### App (`demo/app/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_ALGOD_URL` | Algod URL for balance/transaction queries | TestNet Nodely |
| `VITE_API_BASE_URL` | Demo server API URL (proxied in dev) | `http://localhost:3000` |
| `VITE_PORT` | Vite dev server port | 5173 |

### Fee Sponsorship

To enable the server to pay transaction fees on behalf of clients, set `FEE_PAYER_KEY` in `demo/server/.env`:

```
# 25-word mnemonic
FEE_PAYER_KEY=word1 word2 word3 ... word25

# or base64 private key
FEE_PAYER_KEY=abc123...base64==
```

The fee payer account needs a small amount of TestNet ALGO (0.1+ ALGO) to cover transaction fees.

## API Endpoints

### Weather API (ALGO payments)

```bash
# Returns 402 Payment Required with challenge
curl http://localhost:3000/api/v1/weather/tokyo

# Available cities: san-francisco, new-york, london, tokyo, paris, sydney, berlin, dubai
```

Cost: 0.01 ALGO (10,000 microalgos) per request.

### Marketplace (USDC payments)

```bash
# List products (free)
curl http://localhost:3000/api/v1/marketplace/products

# Buy a product (returns 402 with USDC charge challenge)
curl http://localhost:3000/api/v1/marketplace/buy/algo-hoodie
```

Products: `algo-hoodie` (0.17 USDC), `validator-mug` (0.15 USDC), `nft-sticker-pack` (0.10 USDC).

#### Payment Splits

Each purchase is split into multiple ASA transfer transactions in a single atomic group:

| Recipient | Share | Example (Algorand Hoodie) |
|-----------|-------|--------------------------|
| **Seller** | Product price | 0.17 USDC |
| **Platform** | 5% of price | 0.0085 USDC |
| **Referral** (optional) | 2% of price | 0.0034 USDC |

- **Without referral**: buyer pays 0.17 + 0.0085 = **0.1785 USDC**
- **With referral**: buyer pays 0.17 + 0.0085 + 0.0034 = **0.1819 USDC**

All split transactions are sent as an atomic group — they all succeed or all fail together. The referral split is only included when a `?referrer=ADDRESS` query parameter is provided.

> **Note:** In the demo, the platform address and seller address are both set to `RECIPIENT`. In production, each would be a distinct address.

#### Referral Program

The referral system allows third parties to earn a commission by driving purchases. When a referrer's Algorand address is included in the purchase URL, 2% of the product price is automatically routed to their account as part of the atomic payment group.

**How it works:**

1. A referrer shares a purchase link with their address: `https://example.com/api/v1/marketplace/buy/algo-hoodie?referrer=THEIR_ALGO_ADDRESS`
2. When a buyer uses that link, the server includes a referral split in the 402 challenge
3. The client builds an atomic group with an additional ASA transfer to the referrer
4. On confirmation, the referrer receives their 2% commission in the same transaction group

**Integration example:**

```bash
# Without referral — 2 transactions (seller + platform)
curl http://localhost:3000/api/v1/marketplace/buy/algo-hoodie

# With referral — 3 transactions (seller + platform + referrer)
curl "http://localhost:3000/api/v1/marketplace/buy/algo-hoodie?referrer=REFERRER_ALGO_ADDRESS"
```

The referral fee is additive — it increases the total cost to the buyer rather than reducing the seller's or platform's share. This ensures sellers and the platform receive their full amounts regardless of whether a referral is involved.

### Health Check

```bash
curl http://localhost:3000/api/v1/health
```

## Transaction Flow

### Server-Broadcast Mode (default)

1. Client sends `GET /api/v1/weather/tokyo`
2. Server responds `402 Payment Required` with `WWW-Authenticate: Payment` header containing the charge challenge
3. Client builds an atomic transaction group (fee payer txn + payment txn)
4. Client signs its payment transaction(s), leaves fee payer unsigned
5. Client retries the request with `Authorization: Payment <credential>` containing the signed group
6. Server verifies the group, co-signs the fee payer transaction
7. Server simulates the group, broadcasts to Algorand TestNet
8. Algorand confirms with instant finality (~3.3s)
9. Server returns the weather data with `Payment-Receipt` header

### Client-Broadcast Mode (fallback)

1. Same as above through step 3
2. Client signs and broadcasts the group to Algorand itself
3. Client retries with `Authorization: Payment <credential>` containing the TxID
4. Server fetches the transaction from algod/indexer, verifies details
5. Server returns the weather data with receipt

## Getting TestNet Funds

Before using the demo, fund your wallet with TestNet tokens:

1. **ALGO** — Go to [Lora TestNet Faucet](https://lora.algokit.io/testnet/fund), paste your Algorand address, and request funds
2. **USDC** — Go to [Circle Faucet](https://faucet.circle.com/), select **Algorand TestNet**, and request USDC
3. **Opt-in to USDC** — Before receiving USDC, your account must opt-in to ASA ID `10458941`. You can do this via your wallet (Pera, Defly, or Lute) by adding the USDC asset.
