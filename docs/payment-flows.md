# Payment Flow

## Server-Broadcast

The client signs the transaction group and sends it to the server. The server signs the fee payer (if fee sponsorship is enabled) and broadcasts.

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
  |    suggestedParams, lease,        |                               |
  |    challengeReference }           |                               |
  |<----------------------------------|                               |
  |                                   |                               |
  |  Build atomic group:              |                               |
  |  [0] Fee payer txn (unsigned)     |                               |
  |  [1] Payment txn (signed, +lease) |                               |
  |                                   |                               |
  |  GET /api/v1/weather/tokyo        |                               |
  |  Authorization: Payment           |                               |
  |  { paymentGroup, paymentIndex,    |                               |
  |    type: "transaction" }          |                               |
  |---------------------------------->|                               |
  |                                   |  Verify group structure        |
  |                                   |  Verify payment details        |
  |                                   |  Verify lease                  |
  |                                   |  Sign fee payer txn            |
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

## Fee Sponsorship

When the server sets `FEE_PAYER_KEY`, it acts as a fee payer for all transactions. The client builds the group with an unsigned fee payer transaction at index 0. The server signs it after verification.

### Transaction Group Structure (with fee payer)

```
Index 0: Fee Payer Transaction (unsigned → server signs)
  ├── sender:   FEE_PAYER_ADDRESS (server's fee payer)
  ├── receiver: FEE_PAYER_ADDRESS (self-pay, zero amount)
  ├── amount:   0
  └── fee:      pooled fee (sum of max(fee*size, minFee) for each txn)

Index 1: Payment Transaction (signed by client)
  ├── sender:   CLIENT_ADDRESS
  ├── receiver: RECIPIENT_ADDRESS
  ├── amount:   payment amount
  ├── lease:    lx field (from challenge)
  └── fee:      0 (covered by fee payer via fee pooling)
```

Fee pooling is an Algorand feature where one transaction in an atomic group can pay the fees for all other transactions. The required fee per transaction is `max(fee_per_byte * txn_size, minFee)` using values from `suggestedParams`. Under normal conditions (`fee` = 0), this simplifies to `minFee` per transaction.

### Without Fee Sponsorship

```
Index 0: Payment Transaction (signed by client)
  ├── sender:   CLIENT_ADDRESS
  ├── receiver: RECIPIENT_ADDRESS
  ├── amount:   payment amount
  ├── lease:    lx field (from challenge)
  └── fee:      max(fee * txn_size, minFee) from suggestedParams
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
- Recipient must be opted in to the ASA

## Verification Steps (Server)

When the server receives the payment credential, it performs these checks:

1. **Decode transactions** — Parse signed and unsigned transactions from the group
2. **Verify group ID** — All transactions share the same group ID (for groups of 2+)
3. **Verify payment** — Amount, recipient, and ASA ID match the challenge
4. **Verify lease** — Payment transaction's `lx` field matches the expected lease
5. **Check dangerous fields** — Reject transactions with `rekeyTo` or `closeRemainderTo`
6. **Sign fee payer** — If fee sponsorship is enabled, verify and sign the fee payer transaction
7. **Broadcast** — Submit to the Algorand network
9. **Issue receipt** — Return `Payment-Receipt` header with transaction details
