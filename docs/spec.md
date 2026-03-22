# Algorand Charge Specification

## Overview

The **Algorand Charge** specification defines how the MPP `charge` intent is implemented on the Algorand blockchain. It is an IETF-style internet draft authored by GoPlausible.

The full specification is available at: [specs/draft-algorand-charge-00.md](../specs/draft-algorand-charge-00.md)

## Key Design Decisions

### Atomic Transaction Groups

Algorand supports atomic transaction groups — multiple transactions that execute as a single unit (all succeed or all fail). The spec leverages this for:

- **Fee sponsorship** — A fee payer transaction (index 0) covers fees for the entire group
- **Payment splits** — Multiple recipients receive funds in the same atomic group
- **Referral payments** — Additional split transactions route commissions to referrers

### CAIP-2 Network Identification

Networks are identified using [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format:

| Network | CAIP-2 Identifier |
|---------|-------------------|
| MainNet | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=` |
| TestNet | `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=` |

### Dual Settlement Modes

| Mode | Credential Type | Who Broadcasts | Use Case |
|------|----------------|----------------|----------|
| **Pull** | `type="transaction"` | Server | Default. Enables fee sponsorship. Server has full control. |
| **Push** | `type="txid"` | Client | Fallback when server can't broadcast. No fee sponsorship. |

### Native ALGO and ASA Support

The spec supports both native ALGO payments and Algorand Standard Asset (ASA) transfers. When `asaId` is present in the challenge, the payment uses ASA transfer transactions. When absent, native ALGO payment transactions are used.

## Challenge Structure

The server's 402 response includes `methodDetails` specific to Algorand:

```json
{
  "amount": "10000",
  "currency": "ALGO",
  "recipient": "ALGO_ADDRESS...",
  "methodDetails": {
    "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
    "reference": "unique-charge-id",
    "asaId": "10458941",
    "decimals": 6,
    "feePayer": true,
    "feePayerKey": "FEE_PAYER_ALGO_ADDRESS...",
    "splits": [
      { "recipient": "PLATFORM_ADDRESS...", "amount": "500", "memo": "platform fee" }
    ],
    "suggestedParams": {
      "firstValid": 12345678,
      "lastValid": 12346678,
      "genesisHash": "base64...",
      "genesisId": "testnet-v1.0"
    }
  }
}
```

## Credential Structure

### Pull Mode (type="transaction")

```json
{
  "paymentGroup": [
    "base64-encoded-fee-payer-txn",
    "base64-encoded-payment-txn"
  ],
  "paymentIndex": 1,
  "type": "transaction"
}
```

### Push Mode (type="txid")

```json
{
  "txid": "ALGORAND_TXID_52CHARS...",
  "type": "txid"
}
```

## Security Considerations

- Challenges are HMAC-signed to prevent tampering
- The server verifies transaction amounts, recipients, and group structure before broadcasting
- Fee payer transactions are validated (zero amount, self-payment, correct fee pooling)
- Dangerous transaction fields (rekey, close-to) are rejected
- Transaction groups are simulated before broadcast to catch errors early
