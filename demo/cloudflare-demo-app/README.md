# Algorand MPP Demo — Cloudflare Workers

A single Cloudflare Worker that serves both the API endpoints and the React SPA. Identical functionality to the Express demo but runs on Cloudflare's edge network.

## Setup

```bash
# From repo root
pnpm build                                  # Build the SDK
cd demo/cloudflare-demo-app
pnpm install                                # Install dependencies
```

## Configuration

### Variables (wrangler.toml)

Set non-secret variables in `wrangler.toml` under `[vars]`:

```toml
[vars]
RECIPIENT = "YOUR_ALGO_ADDRESS"
NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
```

### Secrets (wrangler CLI)

Set secrets via the Wrangler CLI:

```bash
# HMAC secret for challenge signing
wrangler secret put MPP_SECRET_KEY

# Fee payer key (25-word mnemonic or base64 private key)
wrangler secret put FEE_PAYER_KEY
```

## Development

```bash
pnpm dev                    # Start local worker with Wrangler
```

The worker runs at `http://localhost:8787` and serves both API routes and the React SPA.

## Deploy

```bash
pnpm deploy                 # Build app + deploy to Cloudflare
```

## Architecture

```
Cloudflare Worker
├── /api/v1/health              → Health check
├── /api/v1/weather/:city       → Weather API (0.01 ALGO)
├── /api/v1/marketplace/products → List products (free)
├── /api/v1/marketplace/buy/:id → Purchase (USDC + splits)
└── /*                          → React SPA (static assets)
```

- **Hono** — Lightweight router for the Worker
- **Cloudflare Assets** — Serves the built React SPA from `dist/`
- **Worker Env Bindings** — Variables from `wrangler.toml`, secrets from `wrangler secret`

## Differences from Express Demo

| Aspect | Express Demo | Cloudflare Demo |
|--------|-------------|-----------------|
| Runtime | Node.js | Cloudflare Workers |
| Framework | Express.js | Hono |
| Env vars | `.env` file + `--env-file` | `wrangler.toml` [vars] + `wrangler secret` |
| Static files | `express.static()` | Cloudflare Assets |
| Deployment | Self-hosted | `wrangler deploy` to Cloudflare edge |
| Request object | Express → Web API conversion | Native Web API `Request` |
