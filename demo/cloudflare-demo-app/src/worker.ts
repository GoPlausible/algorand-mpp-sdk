import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import { loadFeePayer, type FeePayer } from './fee-payer'
import { healthRoutes } from './routes/health'
import { weatherRoutes } from './routes/weather'
import { marketplaceRoutes } from './routes/marketplace'
import { ALGORAND_TESTNET } from './constants'

const app = new Hono<{ Bindings: Env }>()

// CORS — expose payment headers
app.use('*', cors({
  exposeHeaders: ['www-authenticate', 'payment-receipt'],
}))

// Cache fee payer per isolate (reused across requests)
let cachedFeePayer: FeePayer | null | undefined

app.use('/api/*', async (c, next) => {
  // Lazy-init fee payer from secrets on first API request
  if (cachedFeePayer === undefined) {
    cachedFeePayer = loadFeePayer(c.env.FEE_PAYER_KEY)
    if (cachedFeePayer) {
      console.log(`Fee payer loaded: ${cachedFeePayer.address}`)
    } else {
      console.log('No FEE_PAYER_KEY — fee sponsorship disabled.')
    }
  }
  await next()
})

// Mount routes — initialized lazily per request using env bindings
app.route('', (() => {
  const router = new Hono<{ Bindings: Env }>()

  router.get('/api/v1/health', async (c) => {
    const feePayer = cachedFeePayer ?? null
    const routes = healthRoutes(feePayer)
    return routes.fetch(c.req.raw, c.env)
  })

  router.get('/api/v1/weather/:city', async (c) => {
    const feePayer = cachedFeePayer ?? null
    const secretKey = c.env.MPP_SECRET_KEY || crypto.randomUUID()
    const recipient = c.env.RECIPIENT
    const routes = weatherRoutes(secretKey, feePayer, recipient)
    return routes.fetch(c.req.raw, c.env)
  })

  router.get('/api/v1/marketplace/products', async (c) => {
    const feePayer = cachedFeePayer ?? null
    const secretKey = c.env.MPP_SECRET_KEY || crypto.randomUUID()
    const recipient = c.env.RECIPIENT
    const routes = marketplaceRoutes(secretKey, feePayer, recipient)
    return routes.fetch(c.req.raw, c.env)
  })

  router.get('/api/v1/marketplace/buy/:productId', async (c) => {
    const feePayer = cachedFeePayer ?? null
    const secretKey = c.env.MPP_SECRET_KEY || crypto.randomUUID()
    const recipient = c.env.RECIPIENT
    const routes = marketplaceRoutes(secretKey, feePayer, recipient)
    return routes.fetch(c.req.raw, c.env)
  })

  return router
})())

export default app
