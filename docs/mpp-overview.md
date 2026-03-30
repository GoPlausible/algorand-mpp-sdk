# What is MPP?

## Machine Payments Protocol

The Machine Payments Protocol (MPP) is an open standard for HTTP-native payments. It uses the `402 Payment Required` HTTP status code — originally reserved in HTTP/1.1 for future use — to enable any web API to charge for access programmatically.

MPP is designed for **machine-to-machine payments**: automated agents, AI systems, IoT devices, and applications that consume paid APIs without human intervention.

## How It Works

MPP follows a simple challenge-response flow built on standard HTTP headers:

```
Client                          Server
  |                               |
  |  GET /api/weather/tokyo       |
  |------------------------------>|
  |                               |
  |  402 Payment Required         |
  |  WWW-Authenticate: Payment    |
  |<------------------------------|
  |                               |
  |  (client builds & signs txn)  |
  |                               |
  |  GET /api/weather/tokyo       |
  |  Authorization: Payment ...   |
  |------------------------------>|
  |                               |
  |  200 OK                       |
  |  Payment-Receipt: ...         |
  |<------------------------------|
```

1. **Client requests** a paid resource
2. **Server responds** `402 Payment Required` with a `WWW-Authenticate: Payment` header containing a challenge (amount, recipient, currency, method details)
3. **Client pays** by building and signing a blockchain transaction
4. **Client retries** the request with an `Authorization: Payment` header containing proof of payment
5. **Server verifies** the payment and returns the resource with a `Payment-Receipt` header

## Key Concepts

### Intents

MPP supports different payment **intents**. The Algorand MPP SDK implements the `charge` intent — a one-time payment for a specific resource.

### Methods

Each blockchain has its own **method** that defines how payments are constructed and verified. The Algorand method (`algorand`) uses atomic transaction groups, ASA transfers, and Algorand-specific verification.

### Credentials

After paying, the client sends a **credential** proving payment. Two types are supported:

- **`type="transaction"`** (Server-broadcast mode) — The client sends the signed transaction group; the server broadcasts it
- **`type="txid"`** (Client-broadcast mode) — The client broadcasts the transaction itself and sends the confirmed transaction ID

### Challenges

The server's 402 response contains a **challenge** with all information needed to construct the payment:

- `amount` — Payment amount in base units
- `currency` — Token identifier (ALGO, USDC, etc.)
- `recipient` — Receiving Algorand address
- `methodDetails` — Algorand-specific parameters (network, ASA ID, fee payer, lease, suggested params)

## MPP vs Traditional Payment APIs

| Aspect | Traditional | MPP |
|--------|------------|-----|
| Integration | Custom per provider (Stripe, PayPal, etc.) | Standard HTTP headers |
| Settlement | Days (card networks) | Seconds (blockchain finality) |
| Authentication | API keys, OAuth tokens | Cryptographic payment proof |
| Machine-friendly | Requires webhooks, callbacks | Native HTTP request/response |
| Micropayments | Not viable (minimum fees) | Sub-cent transactions possible |
| Cross-border | Complex compliance | Permissionless |

## Related Standards

- [HTTP Payment Authentication Scheme](https://datatracker.ietf.org/doc/draft-ietf-httpauth-payment/) — The `Payment` HTTP authentication scheme
- [Charge Intent](https://datatracker.ietf.org/doc/draft-payment-intent-charge/) — The `charge` intent specification
- [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) — Chain-agnostic blockchain identifiers
- [x402 Protocol](https://github.com/coinbase/x402) — Reference implementation by Coinbase
