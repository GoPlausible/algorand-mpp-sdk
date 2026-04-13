# Cloudflare Workers Demo

An alternative deployment of the MPP SDK demo that runs entirely on Cloudflare Workers — a single worker serves both the paid API endpoints and the React SPA. Functionally identical to the [Express demo](./demo.md), but packaged for edge deployment with one-command `wrangler deploy`.

For the full feature walkthrough, demonstrated scenarios, UI description, and endpoint list, see the [Demo Guide](./demo.md) — everything there applies here too. This page covers only what is specific to the Cloudflare version.

## When to Use This Demo

- You want to deploy the demo to production without managing a Node.js host
- You want to see how the SDK runs in a non-Node runtime (Web APIs, no Node built-ins)
- You want a single-artifact deployment (API + SPA in one worker) instead of the two-process Express setup

## Architecture

```
Cloudflare Worker (single deployment)
├── /api/v1/health              → Health check
├── /api/v1/weather/:city       → Weather API (0.01 ALGO)
├── /api/v1/marketplace/products → List products (free)
├── /api/v1/marketplace/buy/:id → Purchase (USDC)
└── /*                          → React SPA (Cloudflare Assets)
```

- **[Hono](https://hono.dev/)** — Lightweight web framework for the worker routes
- **Cloudflare Assets** — Serves the built React SPA from `dist/` as static assets
- **Worker Env Bindings** — `wrangler.toml` `[vars]` for non-secrets, `wrangler secret` for secrets

## Setup

From the repo root:

```bash
pnpm build                  # Build the SDK
pnpm demo:cf:install        # Install demo-cloudflare dependencies
pnpm demo:cf:dev            # Local dev via wrangler (port 8787)
```

The worker runs at `http://localhost:8787` and serves both API routes and the SPA from a single origin — no separate frontend dev server.

## Configuration

### Non-secret Variables (`demo-cloudflare/wrangler.toml`)

```toml
[vars]
RECIPIENT = "YOUR_ALGO_ADDRESS"
NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
```

| Variable | Description | Default |
|----------|-------------|---------|
| `RECIPIENT` | Address receiving payments | Zero address |
| `NETWORK` | CAIP-2 network identifier | TestNet |

### Secrets (Wrangler CLI)

```bash
cd demo-cloudflare
wrangler secret put MPP_SECRET_KEY    # HMAC secret for challenge signing
wrangler secret put FEE_PAYER_KEY     # Optional: 25-word mnemonic or base64 key
```

| Secret | Description | Required |
|--------|-------------|----------|
| `MPP_SECRET_KEY` | HMAC secret for challenge signing | Yes |
| `FEE_PAYER_KEY` | Mnemonic or base64 private key for fee sponsorship | No (fee sponsorship disabled if unset) |

## Build & Deploy

```bash
pnpm demo:cf:build          # Build SPA + wrangler dry-run
pnpm demo:cf:deploy         # Build SPA + deploy to your Cloudflare account
```

Deployment requires `wrangler login` first; see the [Cloudflare Wrangler docs](https://developers.cloudflare.com/workers/wrangler/) for account setup.

## Differences from the Express Demo

| Aspect | Express Demo | Cloudflare Demo |
|--------|-------------|-----------------|
| Runtime | Node.js | Cloudflare Workers (V8 isolates) |
| Framework | Express.js | Hono |
| Env vars | `.env` file + `--env-file` | `wrangler.toml` `[vars]` + `wrangler secret` |
| Static files | `express.static()` | Cloudflare Assets binding |
| Deployment | Self-hosted Node process | `wrangler deploy` to Cloudflare edge |
| Request object | Express `req`/`res` | Native Web API `Request`/`Response` |
| Processes | Two (server on 3000, app on 5173) | One (worker on 8787) |

The SDK itself is identical in both demos — the difference is purely how the server/app are packaged and deployed.

## See Also

- [Demo Guide](./demo.md) — Full feature walkthrough (applies to both demos)
- [demo-cloudflare/README.md](../demo-cloudflare/README.md) — In-tree README with command-level reference
- [Payment Flows](./payment-flows.md) — Server-broadcast and fee sponsorship sequence diagrams
