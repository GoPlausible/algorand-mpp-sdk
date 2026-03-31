# Algorand Charge Specification

## Overview

The **Algorand Charge** specification defines how the MPP `charge` intent is implemented on the Algorand blockchain. It is an IETF-style internet draft authored by GoPlausible.

The full specification is available at: [specs/draft-algorand-charge-00.md](../specs/draft-algorand-charge-00.md)

## Key Design Decisions

### Atomic Transaction Groups

Algorand supports atomic transaction groups — multiple transactions that execute as a single unit (all succeed or all fail). The spec leverages this for:

- **Fee sponsorship** — A fee payer transaction (index 0) covers fees for the entire group
- **Lease-based idempotency** — Protocol-level replay protection bound to each challenge

### CAIP-2 Network Identification

Networks are identified using [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) format:

| Network | CAIP-2 Identifier |
|---------|-------------------|
| MainNet | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=` |
| TestNet | `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=` |

### Settlement

The client signs the transaction group and sends it to the server as a `type="transaction"` credential. The server verifies, optionally signs the fee payer, and broadcasts to the Algorand network.

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
    "challengeReference": "unique-charge-id",
    "lease": "base64-encoded-32-byte-value...",
    "asaId": "10458941",
    "decimals": 6,
    "feePayer": true,
    "feePayerKey": "FEE_PAYER_ALGO_ADDRESS...",
    "suggestedParams": {
      "fee": 0,
      "firstValid": 12345678,
      "lastValid": 12346678,
      "genesisHash": "base64...",
      "genesisId": "testnet-v1.0",
      "minFee": 1000
    }
  }
}
```

## Credential Structure

### Credential Payload

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


## Security Considerations

- Challenges are HMAC-signed to prevent tampering
- The server verifies transaction amounts, recipients, and group structure before broadcasting
- Fee payer transactions are validated (zero amount, self-payment, correct fee pooling)
- Dangerous transaction fields (rekey, close-to) are rejected
- Transaction groups are simulated before broadcast to catch errors early
