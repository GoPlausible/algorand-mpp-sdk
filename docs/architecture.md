# SDK Architecture

## Package Structure

```
@goplausible/algorand-mpp-sdk
├── sdk/src/
│   ├── index.ts              # Root exports (shared types)
│   ├── Methods.ts            # Shared charge method schema (zod)
│   ├── constants.ts          # CAIP-2 identifiers, algod URLs, fee constants
│   ├── client/
│   │   ├── index.ts          # Client exports: charge, algorand, Mppx
│   │   ├── Charge.ts         # Client-side charge implementation
│   │   └── Methods.ts        # algorand.charge() client factory
│   ├── server/
│   │   ├── index.ts          # Server exports: charge, algorand, Mppx, Store
│   │   ├── Charge.ts         # Server-side charge implementation (verify, sign, broadcast)
│   │   └── Methods.ts        # algorand.charge() server factory
│   └── utils/
│       └── transactions.ts   # Transaction building, signing, encoding utilities
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@algorandfoundation/algokit-utils` | Transaction construction, address handling, encoding |
| `mppx` | MPP protocol library (challenge/credential serialization, HTTP handling) |

The SDK does **not** depend on `algosdk`. It uses `algokit-utils` v10 which is fully decoupled from algosdk.

## Entry Points

The SDK provides three entry points:

```ts
// Server-side (Express, Hono, etc.)
import { Mppx, algorand, Store } from '@goplausible/algorand-mpp-sdk/server'

// Client-side (browser, React, etc.)
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/client'

// Shared types and method schema
import { charge } from '@goplausible/algorand-mpp-sdk'
```

## Server-Side Architecture

### Creating a Paid Endpoint

```ts
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/server'

const mppx = Mppx.create({
  secretKey: 'hmac-secret-for-challenges',
  methods: [
    algorand.charge({
      recipient: 'ALGO_ADDRESS...',
      network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
      algodUrl: 'https://testnet-api.4160.nodely.dev',
      // Optional: fee sponsorship
      signer: feePayerSigner,
      signerAddress: 'FEE_PAYER_ADDRESS...',
      // Optional: ASA payments
      asaId: 10458941n,
      decimals: 6,
    }),
  ],
})
```

### Server Charge Flow

```
algorand.charge() server factory
  │
  ├── createChallenge()
  │   ├── Fetch suggested params from algod
  │   ├── Generate unique challengeReference
  │   ├── Derive lease from challengeReference (SHA-256)
  │   └── Return challenge with methodDetails
  │
  └── verify()
      ├── Decode transaction group (signed + unsigned)
      ├── Verify group ID consistency
      ├── Verify payment amount, recipient, ASA ID
      ├── Verify lease matches expected value
      ├── Check for dangerous fields (rekey, close-to)
      ├── Verify fee payer (pooled fee via formula)
      ├── Sign fee payer transaction (if applicable)
      ├── Broadcast transaction group
      └── Broadcast to Algorand network
```

## Client-Side Architecture

### Creating a Payment Client

```ts
import { Mppx, algorand } from '@goplausible/algorand-mpp-sdk/client'

const method = algorand.charge({
  signer: signTransactions,   // use-wallet's signTransactions
  senderAddress: 'CLIENT_ADDRESS...',
  algodUrl: 'https://testnet-api.4160.nodely.dev',
})

const mppx = Mppx.create({ methods: [method] })

// Automatically handles 402 → pay → retry
const response = await mppx.fetch('https://api.example.com/paid-resource')
```

### Client Charge Flow

```
mppx.fetch(url)
  │
  ├── Initial request → receives 402
  │
  ├── createCredential()
  │   ├── Parse challenge (amount, recipient, methodDetails)
  │   ├── Resolve suggested params (from challenge or algod)
  │   ├── Build transaction group
  │   │   ├── Fee payer txn (if server sponsors fees)
  │   │   └── Payment txn (ALGO or ASA)
  │   ├── Assign group ID
  │   ├── Encode transactions to raw bytes
  │   ├── Sign via signer (use-wallet / custom)
  │   └── Serialize credential (paymentGroup + paymentIndex)
  │
  └── Retry request with Authorization: Payment header
```

## Signer Interface

The SDK uses a signer interface compatible with `@txnlab/use-wallet` and x402's `ClientAvmSigner`:

```ts
type Signer = (
  txns: Uint8Array[],           // Raw-encoded transactions
  indexesToSign?: number[]       // Which transactions to sign
) => Promise<(Uint8Array | null)[]>  // Signed bytes or null for unsigned
```

The SDK encodes `Transaction` objects to `Uint8Array[]` internally before passing to the signer. The signer never sees algokit-utils `Transaction` objects — only raw msgpack bytes.

## Method Schema

The charge method is defined using `mppx`'s `Method.from()` with zod schemas:

```ts
export const charge = Method.from({
  intent: 'charge',
  name: 'algorand',
  schema: {
    credential: { payload: z.object({ ... }) },
    request: z.object({
      amount: z.string(),
      currency: z.string(),
      recipient: z.string(),
      methodDetails: z.object({
        network: z.optional(z.string()),
        challengeReference: z.string(),
        lease: z.optional(z.string()),
        asaId: z.optional(z.string()),
        feePayer: z.optional(z.boolean()),
        feePayerKey: z.optional(z.string()),
        suggestedParams: z.optional(z.object({ ... })),
      }),
    }),
  },
})
```

This shared schema ensures type safety between server and client and validates all challenge/credential data at runtime.
