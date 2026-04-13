// Cloudflare Workers environment bindings
export interface Env {
  // Variables (set in wrangler.toml [vars])
  RECIPIENT: string
  NETWORK: string

  // Secrets (set via `wrangler secret put`)
  MPP_SECRET_KEY?: string
  FEE_PAYER_KEY?: string
}
