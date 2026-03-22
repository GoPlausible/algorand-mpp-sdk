# Payment Flows

## Pull Mode (Default)

In pull mode, the client signs the transaction group and sends it to the server. The server co-signs (if fee sponsorship is enabled), simulates, and broadcasts.

```
Client                              Server                          Algorand
  |                                   |                               |
  |  GET /api/v1/weather/tokyo        |                               |
  |---------------------------------->|                               |
  |                                   |                               |
  |  402 Payment Required             |                               |
  |  WWW-Authenticate: Payment        |                               |
  |  { amount, recipient, network,    |                               |
  |    feePayer, feePayerKey,         |                               |
  |    suggestedParams, reference }   |                               |
  |<----------------------------------|                               |
  |                                   |                               |
  |  Build atomic group:              |                               |
  |  [0] Fee payer txn (unsigned)     |                               |
  |  [1] Payment txn (signed)         |                               |
  |                                   |                               |
  |  GET /api/v1/weather/tokyo        |                               |
  |  Authorization: Payment           |                               |
  |  { paymentGroup, paymentIndex,    |                               |
  |    type: "transaction" }          |                               |
  |---------------------------------->|                               |
  |                                   |  Verify group structure        |
  |                                   |  Verify payment details        |
  |                                   |  Co-sign fee payer txn         |
  |                                   |  Simulate group                |
  |                                   |                               |
  |                                   |  Broadcast signed group        |
  |                                   |------------------------------>|
  |                                   |                               |
  |                                   |  Confirmed (round N)          |
  |                                   |<------------------------------|
  |                                   |                               |
  |  200 OK                           |                               |
  |  Payment-Receipt: { txid, ... }   |                               |
  |  { weather data }                 |                               |
  |<----------------------------------|                               |
```

## Push Mode (Fallback)

In push mode, the client broadcasts the transaction itself and sends the confirmed TxID. Push mode cannot be used with fee sponsorship.

```
Client                              Server                          Algorand
  |                                   |                               |
  |  GET /api/v1/weather/tokyo        |                               |
  |---------------------------------->|                               |
  |                                   |                               |
  |  402 Payment Required             |                               |
  |<----------------------------------|                               |
  |                                   |                               |
  |  Build & sign txn group           |                               |
  |  Broadcast to Algorand            |                               |
  |-------------------------------------------------------------->   |
  |                                   |                               |
  |  Confirmed: TXID_ABC...          |                               |
  |<--------------------------------------------------------------|  |
  |                                   |                               |
  |  GET /api/v1/weather/tokyo        |                               |
  |  Authorization: Payment           |                               |
  |  { txid: "TXID_ABC...",           |                               |
  |    type: "txid" }                 |                               |
  |---------------------------------->|                               |
  |                                   |  Lookup txn via indexer        |
  |                                   |------------------------------>|
  |                                   |  Verify amount, recipient     |
  |                                   |<------------------------------|
  |                                   |                               |
  |  200 OK                           |                               |
  |  Payment-Receipt: { txid, ... }   |                               |
  |<----------------------------------|                               |
```

## Fee Sponsorship

When the server sets `FEE_PAYER_KEY`, it acts as a fee payer for all transactions. The client builds the group with an unsigned fee payer transaction at index 0. The server co-signs it after verification.

### Transaction Group Structure (with fee payer)

```
Index 0: Fee Payer Transaction (unsigned → server co-signs)
  ├── sender:   FEE_PAYER_ADDRESS (server's fee payer)
  ├── receiver: FEE_PAYER_ADDRESS (self-pay, zero amount)
  ├── amount:   0
  └── fee:      N * 1000 microalgos (covers fees for entire group)

Index 1: Payment Transaction (signed by client)
  ├── sender:   CLIENT_ADDRESS
  ├── receiver: RECIPIENT_ADDRESS
  ├── amount:   payment amount
  └── fee:      0 (covered by fee payer via fee pooling)
```

Fee pooling is an Algorand feature where one transaction in an atomic group can pay the fees for all other transactions. The fee payer transaction sets `fee = groupSize * minFee` and all other transactions set `fee = 0`.

### Without Fee Sponsorship

```
Index 0: Payment Transaction (signed by client)
  ├── sender:   CLIENT_ADDRESS
  ├── receiver: RECIPIENT_ADDRESS
  ├── amount:   payment amount
  └── fee:      1000 microalgos (client pays own fee)
```

## Payment Splits

Splits allow a single purchase to distribute funds to multiple recipients atomically.

### Without Referral (2 transactions + optional fee payer)

```
[0] Fee payer txn     → FEE_PAYER pays fees for group
[1] Primary payment   → CLIENT → SELLER (product price minus splits)
[2] Platform fee      → CLIENT → PLATFORM (5% of price)
```

### With Referral (3 transactions + optional fee payer)

```
[0] Fee payer txn     → FEE_PAYER pays fees for group
[1] Primary payment   → CLIENT → SELLER (product price minus splits)
[2] Platform fee      → CLIENT → PLATFORM (5% of price)
[3] Referral fee      → CLIENT → REFERRER (2% of price)
```

### Splits Sequence Diagram

```
Client                              Server                          Algorand
  |                                   |                               |
  |  GET /marketplace/buy/hoodie      |                               |
  |  ?referrer=REFERRER_ADDR          |                               |
  |---------------------------------->|                               |
  |                                   |                               |
  |  402 Payment Required             |                               |
  |  { amount: "178500",              |                               |
  |    currency: "USDC",              |                               |
  |    splits: [                      |                               |
  |      { recipient: PLATFORM,       |                               |
  |        amount: "8500" },          |                               |
  |      { recipient: REFERRER,       |                               |
  |        amount: "3400" }           |                               |
  |    ] }                            |                               |
  |<----------------------------------|                               |
  |                                   |                               |
  |  Build atomic group:              |                               |
  |  [0] Fee payer (0 ALGO, unsigned) |                               |
  |  [1] 170000 USDC → SELLER        |                               |
  |  [2] 8500 USDC → PLATFORM        |                               |
  |  [3] 3400 USDC → REFERRER        |                               |
  |  Sign [1],[2],[3]; leave [0]      |                               |
  |                                   |                               |
  |  Authorization: Payment           |                               |
  |  { paymentGroup: [...],           |                               |
  |    paymentIndex: 1 }              |                               |
  |---------------------------------->|                               |
  |                                   |  Verify all splits match      |
  |                                   |  Co-sign [0]                  |
  |                                   |  Simulate & broadcast         |
  |                                   |------------------------------>|
  |                                   |                               |
  |  200 OK { product, breakdown }    |  Confirmed atomically         |
  |<----------------------------------|<------------------------------|
```

## Native ALGO vs ASA Payments

### ALGO Payment (Weather API)

- No `asaId` in challenge
- Uses `TransactionType.Payment` (native ALGO transfer)
- Amount in microalgos (1 ALGO = 1,000,000 microalgos)
- No opt-in required

### ASA Payment (Marketplace — USDC)

- `asaId: "10458941"` in challenge (TestNet USDC)
- Uses `TransactionType.AssetTransfer`
- Amount in base units (1 USDC = 1,000,000 units with 6 decimals)
- All recipients (seller, platform, referrer) must be opted in to the ASA

## Verification Steps (Server)

When the server receives the payment credential, it performs these checks:

1. **Decode transactions** — Parse signed and unsigned transactions from the group
2. **Verify group ID** — All transactions share the same group ID (for groups of 2+)
3. **Verify payment** — Amount, recipient, and ASA ID match the challenge
4. **Verify splits** — Each split recipient and amount matches the challenge
5. **Check dangerous fields** — Reject transactions with `rekeyTo` or `closeRemainderTo`
6. **Co-sign fee payer** — If fee sponsorship is enabled, sign the fee payer transaction
7. **Simulate** — Run the group through algod simulation to catch errors
8. **Broadcast** — Submit to the Algorand network
9. **Issue receipt** — Return `Payment-Receipt` header with transaction details
