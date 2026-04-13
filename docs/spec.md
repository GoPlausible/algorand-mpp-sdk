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

The server's 402 response carries the challenge in the `request` auth-param of the `WWW-Authenticate: Payment` header. That value is a JCS-serialized, base64url-encoded JSON object. Decoded, it looks like:

```json
{
  "amount": "10000",
  "currency": "ALGO",
  "recipient": "ALGO_ADDRESS...",
  "description": "Optional human-readable memo",
  "externalId": "Optional merchant reference (echoed in the txn note)",
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

Key rules from the spec:
- `amount` is in base units (microalgos for ALGO, asset base units for ASAs).
- `currency` is informational for ASAs — clients MUST use `asaId` (not `currency`) for asset identity and verify it against a trusted allowlist.
- `asaId` and `decimals` are conditionally required together: both present for ASA payments, both absent for native ALGO.
- `feePayer` and `feePayerKey` are paired: `feePayerKey` MUST be present when `feePayer` is `true`.
- Servers SHOULD derive `lease` deterministically (e.g., `SHA-256(challengeReference)`) so the on-chain transaction is bound to the challenge at the ledger level.

## Credential Structure

The `Authorization: Payment` header carries a single base64url-encoded JSON token (no auth-params). Decoded, it has the following shape:

```json
{
  "challenge": {
    "id": "kM9xPqWvT2nJrHsY4aDfEb",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "charge",
    "request": "<base64url-encoded request>",
    "expires": "2026-03-15T12:05:00Z"
  },
  "source": "optional-payer-identifier",
  "payload": {
    "type": "transaction",
    "paymentIndex": 1,
    "paymentGroup": [
      "<base64-encoded unsigned fee payer txn>",
      "<base64-encoded signed payment txn>"
    ]
  }
}
```

- `challenge` echoes the `WWW-Authenticate` auth-params and binds the credential to the exact challenge that was issued.
- `payload.type` MUST be `"transaction"` (the only credential type this spec defines for Algorand).
- `payload.paymentGroup` contains up to 16 base64-encoded msgpack-serialized transactions — signed and/or unsigned — all sharing the same Group ID.
- `payload.paymentIndex` identifies the transaction that transfers funds to the `recipient`.

## Receipt Structure

On success the server returns `200 OK` with a `Payment-Receipt` header — a single base64url-encoded JSON token. Decoded:

```json
{
  "method": "algorand",
  "reference": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPFNC6JHA5XNBQQHW7MWA",
  "status": "success",
  "timestamp": "2026-03-10T21:00:00Z"
}
```

`reference` is the 52-character base32 TxID of the settled payment. The receipt does not duplicate the challenge ID — that binding is handled by the challenge echo in the credential.

## Error Responses

When rejecting a credential, the server returns `402 Payment Required` with a fresh `WWW-Authenticate` challenge and (SHOULD) an RFC 9457 `application/problem+json` body. Algorand-specific problem types live under `https://paymentauth.org/problems/algorand/`:

- `malformed-credential` — credential could not be decoded or required fields are missing
- `unknown-challenge` — `challenge.id` doesn't match an issued challenge, or the challenge is already consumed
- `group-invalid` — group is too large, has mismatched Group IDs, or `paymentIndex` is out of range
- `dangerous-transaction` — group contains `close`, `aclose`, or `rekey`
- `transfer-mismatch` — on-chain transfer doesn't match challenge (wrong recipient, amount, or ASA)
- `transaction-not-found` / `transaction-failed` / `broadcast-failed` — settlement errors

## Security Considerations

This section summarises the spec's security model. See [draft-algorand-charge-00.md](../specs/draft-algorand-charge-00.md) "Security Considerations" for the complete text.

- **Transport** — All traffic MUST use TLS 1.2+.
- **Replay protection** — Two complementary layers:
  - Server-side TxID tracking: servers MUST atomically check-and-consume TxIDs before accepting a credential.
  - Algorand-native lease: when `lease` is present, the ledger rejects duplicate transactions from the same sender with the same `lx` while their validity windows overlap. Servers SHOULD always set `lease` to benefit from ledger-level replay prevention.
- **Client-side challenge verification** — Before signing, clients MUST verify `amount`, `recipient`, `network`, `feePayerKey` (if present), and crucially `asaId` against a trusted registry. `currency` is NOT a trustworthy asset identifier.
- **Dangerous transaction fields** — `close`, `aclose`, and `rekey` can cause irreversible loss of funds or account control. Clients MUST NOT set them; servers MUST reject any group that contains them.
- **Fee payer verification** — The server verifies the fee payer transaction (correct sender, zero amount, self-pay, bounded fee, no `close`/`rekey`) before signing and broadcasting. The pooled fee is computed as `sum(max(fee_per_byte * txn_size, minFee))` across the group; servers enforce an upper bound (e.g., 3x the computed minimum) to prevent fee-griefing.
- **Rekeyed accounts** — Algorand accounts can transfer signing authority via rekey. Servers verifying signatures MUST inspect the sender's `auth-addr` and reject unexpected rekeys on their own fee payer account.
- **Fee payer risks** — Servers acting as fee payer SHOULD rate-limit per client/IP, verify client balance before signing, and monitor fee payer balance (including MBR). If fee payer balance is insufficient, the server SHOULD fall back to `feePayer: false` rather than fail silently.
- **Address validation** — Algorand addresses include a 4-byte checksum; implementations MUST validate it when parsing.
