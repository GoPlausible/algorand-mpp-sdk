---
title: Algorand Charge Intent for HTTP Payment Authentication
abbrev: Algorand Charge
docname: draft-algorand-charge-00
version: 00
category: info
ipr: noModificationTrust200902
submissiontype: independent
consensus: false

author:
  - name: Mohammad Ghiasi
    ins: M.G
    email: emg110@goplausible.com
    org: GoPlausible
  - name: Cosimo Bassi
    ins: C.B
    email: cosimo.bassi@algorand.foundation
    org: Algorand Foundation
    
normative:
  RFC2119:
  RFC3339:
  RFC4648:
  RFC8174:
  RFC8259:
  RFC8785:
  RFC9457:
  I-D.payment-intent-charge:
    title: "'charge' Intent for HTTP Payment Authentication"
    target: https://datatracker.ietf.org/doc/draft-payment-intent-charge/
    author:
      - name: Jake Moxey
      - name: Brendan Ryan
      - name: Tom Meagher
    date: 2026
  I-D.httpauth-payment:
    title: "The 'Payment' HTTP Authentication Scheme"
    target: https://datatracker.ietf.org/doc/draft-ietf-httpauth-payment/
    author:
      - name: Jake Moxey
    date: 2026-01

informative:
  ALGORAND-DOCS:
    title: "Algorand Developer Documentation"
    target: https://dev.algorand.co
    author:
      - org: Algorand Foundation
    date: 2026
  ALGORAND-TRANSACTIONS:
    title: "Algorand Transaction Reference"
    target: https://dev.algorand.co/concepts/transactions/reference/
    author:
      - org: Algorand Foundation
    date: 2026
  ALGORAND-ATOMIC:
    title: "Algorand Atomic Transaction Groups"
    target: https://dev.algorand.co/concepts/transactions/atomic-txn-groups/
    author:
      - org: Algorand Foundation
    date: 2026
  CAIP-2:
    title: "CAIP-2: Blockchain ID Specification"
    target: https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
    author:
      - org: Chain Agnostic Improvement Proposals
    date: 2024
  ALGORAND-SIGNING:
    title: "Algorand Transaction Signing"
    target: https://dev.algorand.co/concepts/transactions/signing/
    author:
      - org: Algorand Foundation
    date: 2026
  ALGORAND-LSIG:
    title: "Algorand Logic Signatures"
    target: https://dev.algorand.co/concepts/smart-contracts/logic-sigs/
    author:
      - org: Algorand Foundation
    date: 2026
  ALGORAND-LEASE:
    title: "Algorand Transaction Lease"
    target: https://dev.algorand.co/concepts/transactions/reference/#lease
    author:
      - org: Algorand Foundation
    date: 2026
  MSGPACK:
    title: "MessagePack Specification"
    target: https://msgpack.org/
    author:
      - name: Sadayuki Furuhashi
    date: 2023
---

--- abstract

This document defines the "charge" intent for the "algorand" payment
method within the Payment HTTP Authentication Scheme
{{I-D.httpauth-payment}}. The client constructs and signs a native
ALGO or Algorand Standard Asset (ASA) transfer within an atomic
transaction group on the Algorand blockchain; the server verifies
the payment and presents the transaction identifier as proof of
payment.

The client sends the signed transaction group to the server
for broadcast via a `type="transaction"` credential. The
server verifies, optionally signs the fee payer transaction,
and broadcasts the group to the Algorand network.

--- middle

# Introduction

HTTP Payment Authentication {{I-D.httpauth-payment}} defines a
challenge-response mechanism that gates access to resources behind
payments. This document registers the "charge" intent for the
"algorand" payment method.

Algorand is a Layer-1 blockchain with instant finality (no forks),
sub-4-second block times, and low transaction fees
{{ALGORAND-DOCS}}. This specification supports payments in both
native ALGO and Algorand Standard Assets (ASAs), making it suitable
for micropayment use cases where fast confirmation and low overhead
are important.

A distinguishing feature of this specification is its use of
Algorand's native atomic transaction groups
{{ALGORAND-ATOMIC}}. Rather than submitting a single transaction,
clients construct a group of transactions that execute atomically
(all succeed or all fail). This enables fee sponsorship and
complex payment flows without requiring smart contracts.

## Charge Flow

~~~
   Client                     Server              Algorand Network
      |                          |                        |
      |  (1) GET /resource       |                        |
      |----------------------->  |                        |
      |                          |                        |
      |  (2) 402 Payment Required|                        |
      |      (recipient, amount, |                        |
      |       feePayerKey?)      |                        |
      |<-----------------------  |                        |
      |                          |                        |
      |  (3) Build group, sign   |                        |
      |      payment txn(s)      |                        |
      |                          |                        |
      |  (4) Authorization:      |                        |
      |      Payment <credential>|                        |
      |      (signed txn group)  |                        |
      |----------------------->  |                        |
      |                          |  (5) Sign fee payer    |
      |                          |      txn (if present)  |
      |                          |  (6) Broadcast group   |
      |                          |----------------------> |
      |                          |  (7) Instant finality  |
      |                          |<---------------------- |
      |                          |                        |
      |  (8) 200 OK + Receipt    |                        |
      |<-----------------------  |                        |
      |                          |                        |
~~~

The server controls transaction broadcast, enabling optional
fee sponsorship ({{fee-sponsorship}}) and server-side
verification before committing to the network.
When `feePayer` is `true`, the challenge includes
`feePayerKey` so the client includes a fee payer transaction
in the group. The server signs the fee payer transaction before
broadcasting. When `feePayer` is `false` or omitted,
the client fully signs the group and the server broadcasts
it as-is.

## Relationship to the Charge Intent

This document inherits the shared request semantics of the
"charge" intent from {{I-D.payment-intent-charge}}. It defines
only the Algorand-specific `methodDetails`, `payload`, and
verification procedures for the "algorand" payment method.

# Requirements Language

{::boilerplate bcp14-tagged}

# Terminology

Transaction Identifier (TxID)
: The SHA-512/256 hash of `"TX" || msgpack(txn_body)`, where
  `txn_body` is the unsigned transaction fields (excluding
  the signature wrapper `sig`/`msig`/`lsig`). The hash is
  base32-encoded without padding, producing a 52-character
  uppercase string. Serves as both the transaction identifier
  and proof of payment in this specification.

Algorand Standard Asset (ASA)
: A fungible or non-fungible token on Algorand, identified by a
  unique 64-bit unsigned integer (ASA ID). ASAs are native to the
  protocol and do not require smart contracts
  {{ALGORAND-TRANSACTIONS}}.

Atomic Transaction Group
: A set of up to 16 top-level transactions that are submitted
  and executed atomically on the Algorand network. Either all
  transactions in the group succeed, or the entire group is
  rejected. Groups are identified by a Group ID, computed as
  `SHA-512/256("TG" || TxID[0] || TxID[1] || ... || TxID[n])`
  {{ALGORAND-ATOMIC}}. Each top-level transaction is authorized
  by an external signature (Ed25519, multisig, or logic
  signature). Additionally, applications (smart contracts)
  invoked within the group may emit up to 256 inner
  transactions.

Microalgos
: The smallest unit of native ALGO. 1 ALGO = 1,000,000
  microalgos.

Base Units
: The smallest transferable unit of an ASA, determined by the
  asset's decimal precision. For example, USDC on Algorand
  (ASA ID 31566704) uses 6 decimals, so 1 USDC = 1,000,000
  base units.

Fee Payer
: An account that pays Algorand transaction fees on behalf of
  other accounts in a group. Algorand supports fee pooling, where
  a single transaction in a group can cover the fees for all
  transactions in the group by setting a sufficiently high fee.

Minimum Balance Requirement (MBR)
: The minimum ALGO balance an account must maintain. The base
  MBR is 0.1 ALGO (100,000 microalgos), plus 0.1 ALGO per
  asset opted in to, per application opted in to, and other
  on-chain state.

Asset Opt-In
: The process by which an Algorand account explicitly enables
  receiving a particular ASA. An asset transfer to an account
  that has not opted in to the asset will be rejected.

CAIP-2
: Chain Agnostic Improvement Proposal 2, a standard for
  identifying blockchain networks. Algorand networks are
  identified as `algorand:<genesis-hash>` {{CAIP-2}}.

Lease
: A 32-byte value (`lx` field) that, when set on a
  transaction, prevents any other transaction from the same
  sender with the same lease from being confirmed while
  their validity windows overlap. Used in this specification
  to bind payments to challenges at the Algorand protocol
  level, providing ledger-enforced idempotency
  {{ALGORAND-LEASE}}.

Inner Transaction
: A transaction authorized by an application (smart contract)
  during execution, rather than by an external signature. A
  single atomic group can contain up to 16 top-level
  transactions and up to 256 inner transactions.

# Intent Identifier

The intent identifier for this specification is "charge".
It MUST be lowercase.

# Intent: "charge"

The "charge" intent represents a one-time payment gating access
to a resource. The client builds and signs an Algorand transaction
group containing the transfer and sends the signed group to the
server for broadcast. The server verifies the transfer details,
broadcasts the group to the Algorand network, and returns a
receipt upon confirmation.

# Encoding Conventions {#encoding}

All JSON {{RFC8259}} objects carried in auth-params or HTTP
headers in this specification MUST be serialized using the JSON
Canonicalization Scheme (JCS) {{RFC8785}} before encoding. JCS
produces a deterministic byte sequence, which is required for
any digest or signature operations defined by the base spec
{{I-D.httpauth-payment}}.

The resulting bytes MUST then be encoded using base64url
{{RFC4648}} Section 5 without padding characters (`=`).
Implementations MUST NOT append `=` padding when encoding,
and MUST accept input with or without padding when decoding.

This encoding convention applies to: the `request` auth-param
in `WWW-Authenticate`, the credential token in `Authorization`,
and the receipt token in `Payment-Receipt`.

Individual transactions within a `paymentGroup` are encoded as
standard base64 ({{RFC4648}} Section 4), consistent with the
Algorand SDK convention for msgpack-encoded transactions
{{MSGPACK}}.

# Request Schema

## Shared Fields

The `request` auth-param of the `WWW-Authenticate: Payment`
header contains a JCS-serialized, base64url-encoded JSON
object (see {{encoding}}). The following shared fields are
included in that object:

amount
: REQUIRED. The payment amount in base units, encoded as a
  decimal string. For native ALGO, the amount is in microalgos.
  For ASAs, the amount is in the asset's smallest unit (e.g.,
  for USDC with 6 decimals, "1000000" represents 1 USDC).
  The value MUST be a positive integer that fits in a 64-bit
  unsigned integer (max 18,446,744,073,709,551,615).

currency
: REQUIRED. A display label identifying the unit for `amount`.
  For native ALGO, MUST be the string "ALGO" (uppercase). For
  ASAs, this field is INFORMATIONAL ONLY -- the canonical asset
  identity is `asaId` in `methodDetails`. Implementations MUST
  use `asaId` (not `currency`) when constructing and verifying
  transactions. The value SHOULD be a human-readable ticker
  (e.g., "USDC") to aid client display. Since ASA names and
  unit names are NOT unique on Algorand (any account can create
  an ASA with any name), clients MUST NOT rely on `currency` to
  identify the asset; clients MUST verify `asaId` against a
  trusted asset registry or their own allowlist before signing.
  MUST NOT exceed 128 characters.

description
: OPTIONAL. A human-readable memo describing the resource or
  service being paid for. MUST NOT exceed 256 characters.

recipient
: REQUIRED. The Algorand address of the account receiving the
  payment. This is a 58-character base32-encoded string. For
  native ALGO transfers, this is the destination account. For
  ASA transfers, this is the account that must have opted in
  to the asset.

externalId
: OPTIONAL. Merchant's reference (e.g., order ID, invoice
  number), per {{I-D.payment-intent-charge}}. May be used for
  reconciliation or idempotency. When present, clients SHOULD
  include this value in the transaction's `note` field
  (max 1024 bytes), making it visible on-chain for auditing
  and reconciliation. Servers MAY verify the note matches the
  `externalId` from the challenge.

## Method Details

The following fields are nested under `methodDetails` in
the request JSON:

network
: OPTIONAL. Identifies which Algorand network the payment
  should be made on, using the CAIP-2 format {{CAIP-2}}:
  `algorand:<genesis-hash>`. The genesis hash is the
  base64-encoded SHA-256 hash of the network's genesis block.
  Well-known values:

  - MainNet: `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=`
  - TestNet: `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`

  Defaults to the MainNet value if omitted. Clients MUST
  reject challenges whose network does not match their
  configured network.

asaId
: Conditionally REQUIRED. The ASA ID (64-bit unsigned integer)
  of the asset to transfer, encoded as a decimal string. If
  omitted, the payment is in native ALGO. The `asaId` is the
  sole canonical identifier for the asset. The `amount` field
  is always in the asset's base units (smallest indivisible
  unit), so no decimal conversion is required for transaction
  construction or server-side verification: the server
  compares `aamt` directly against `amount`. Clients needing
  decimal precision for human-readable display (e.g., to
  show "1.00 USDC" instead of "1000000") MUST fetch the
  authoritative `decimals` value from the asset's on-chain
  parameters via `v2/assets/{asaId}`, not from the challenge.

challengeReference
: REQUIRED. A server-generated unique identifier for this
  payment challenge, encoded as a string. MUST NOT exceed
  128 characters. The server uses this value to correlate
  incoming credentials with issued challenges and to enforce
  single-use semantics. MUST be unique per challenge. This
  field is distinct from the `reference` field in the receipt,
  which contains the on-chain transaction identifier (TxID).

lease
: REQUIRED. A base64-encoded 32-byte value to set as the
  `lx` (lease) field on the payment transaction
  {{ALGORAND-LEASE}}. The server MUST set this to
  `SHA-256(challengeReference)`, deterministically binding
  the on-chain payment to the specific challenge.

  The lease serves two critical functions:

  1. **TxID uniqueness across challenges**: because the
     `lx` field is part of the transaction body, different
     challenges produce different TxIDs even when sender,
     receiver, amount, and round range are identical. Without
     this, two charges with the same parameters would hash
     to the same TxID, causing the protocol to dedupe them
     as one payment — leaving the merchant short-paid.

  2. **Mutual exclusion**: the Algorand protocol enforces
     that no two transactions from the same sender with the
     same `lx` value can be confirmed within overlapping
     validity windows (`firstValid` to `lastValid`). If a
     client signs two distinct transaction groups (A and B)
     covering the same charge, the lease ensures that if A
     is confirmed then B is rejected (and vice-versa). This
     prevents double-settlement for a single charge.

  Note: replay of the *exact same transaction* (same TxID)
  is already handled by the Algorand protocol, which
  rejects duplicate TxIDs within the validity window and
  expired TxIDs outside it. The lease addresses a different
  threat: multiple *distinct* transactions covering the same
  logical payment.

  Clients MUST set the `lx` field on the payment
  transaction to the provided value. Servers MUST verify
  the `lx` field matches `SHA-256(challengeReference)`
  during credential verification.

feePayer
: OPTIONAL. A boolean indicating whether the server will pay
  transaction fees on behalf of the client. Defaults to `false`
  if omitted. When `true`, the `feePayerKey` field MUST also
  be present. See {{fee-sponsorship}}.

feePayerKey
: Conditionally REQUIRED. The Algorand address of the server's
  fee payer account. MUST be present when `feePayer` is `true`;
  MUST be absent when `feePayer` is `false` or omitted. The
  client includes a fee payer transaction from this address
  in the transaction group.

suggestedParams
: OPTIONAL. A JSON object containing suggested transaction
  parameters for the client to use when constructing the
  transaction group. When provided, clients SHOULD use these
  parameters instead of fetching them from an Algorand node.
  This avoids an extra RPC round-trip and ensures the server
  can verify parameter freshness. If omitted, clients MUST
  fetch parameters themselves via the `v2/transactions/params`
  algod endpoint.

  Fields:

  - `firstValid` (number): First valid round for the
    transaction.
  - `lastValid` (number): Last valid round for the
    transaction. The difference between `lastValid` and
    `firstValid` MUST NOT exceed 1000 rounds.
  - `genesisHash` (string): Base64-encoded genesis hash.
    MUST match the `network` genesis hash.
  - `genesisId` (string): Genesis ID string (e.g.,
    "mainnet-v1.0", "testnet-v1.0").
  - `fee` (number): The current suggested fee per byte
    in microalgos, as returned by `v2/transactions/params`.
    Under normal (non-congested) conditions this is `0`.
    Under congestion, this value increases, making
    transaction fees dependent on serialized size.
  - `minFee` (number): The network minimum fee per
    transaction in microalgos, as returned by
    `v2/transactions/params`. Clients MUST use these
    values to compute per-transaction fees using
    `max(fee * txn_size_in_bytes, minFee)` and MUST
    NOT hardcode fee constants.

### Native ALGO Example

~~~json
{
  "amount": "10000000",
  "currency": "ALGO",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "Weather API access",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "challengeReference": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "lease": "xH7kQ2mN9vB4wP1jR6tY3cA8eF5gD0iL\
sU4oK7nM2bX="
  }
}
~~~

This requests a transfer of 10 ALGO (10,000,000 microalgos).
The `lease` value binds this payment to the challenge at
the Algorand protocol level.

### ASA (USDC) Example

~~~json
{
  "amount": "1000000",
  "currency": "USDC",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "Premium API call",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "asaId": "31566704",
    "challengeReference": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "lease": "Yk3pR8wN5vB2mQ7jT1tX9cA6eF4gD0iL\
sU3oK8nM1bZ="
  }
}
~~~

This requests a transfer of 1 USDC (1,000,000 base units,
ASA ID 31566704). Implementations MUST use `asaId`
(31566704) — not `currency` ("USDC") — to identify the
asset when constructing and verifying transactions.

### Fee Sponsorship Example

~~~json
{
  "amount": "10000000",
  "currency": "ALGO",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "Weather API access",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "challengeReference": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "lease": "xH7kQ2mN9vB4wP1jR6tY3cA8eF5gD0iL\
sU4oK7nM2bX=",
    "feePayer": true,
    "feePayerKey": "GH9ZWEMDLJ8DSCKNTKTQPBNWLNNBJUSZAG9VP\
2KGTKJR"
  }
}
~~~

This requests a transfer of 10 ALGO where the server pays
transaction fees via fee pooling in the atomic group.

# Credential Schema

The `Authorization` header carries a single base64url-encoded
JSON token (no auth-params). The decoded object contains the
following top-level fields:

challenge
: REQUIRED. An echo of the challenge auth-params from the
  `WWW-Authenticate` header: `id`, `realm`, `method`,
  `intent`, `request`, and (if present) `expires`. This
  binds the credential to the exact challenge that was
  issued.

source
: OPTIONAL. A payer identifier string, as defined by
  {{I-D.httpauth-payment}}. Algorand implementations MAY
  use the payer's Algorand address or a DID.

payload
: REQUIRED. A JSON object containing the Algorand-specific
  credential fields. The `type` field MUST be
  `"transaction"`.

## Transaction Payload {#transaction-payload}

The client sends the
signed transaction group to the server for broadcast. The
payload contains the group as an array of base64-encoded
msgpack-serialized transactions.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | REQUIRED | `"transaction"` |
| `paymentGroup` | array | REQUIRED | Array of base64-encoded msgpack-serialized transactions (signed or unsigned). Max 16 elements. |
| `paymentIndex` | number | REQUIRED | Zero-based index into `paymentGroup` identifying the primary payment transaction |

Each element of `paymentGroup` is a base64-encoded (standard
base64, {{RFC4648}} Section 4) msgpack-serialized Algorand
transaction. Signed transactions include the signature wrapper;
unsigned transactions (e.g., the fee payer transaction awaiting
the server's signature) contain only the transaction body.

All transactions in the group MUST share the same Group ID,
computed as `SHA-512/256("TG" || TxID[0] || ... || TxID[n])`.
The `paymentIndex` identifies the transaction that
transfers funds to the `recipient` from the challenge request.

Example (decoded):

~~~json
{
  "challenge": {
    "id": "kM9xPqWvT2nJrHsY4aDfEb",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "charge",
    "request": "eyJ...",
    "expires": "2026-03-15T12:05:00Z"
  },
  "payload": {
    "type": "transaction",
    "paymentIndex": 1,
    "paymentGroup": [
      "<base64-encoded unsigned fee payer txn>",
      "<base64-encoded signed ASA transfer txn>"
    ]
  }
}
~~~

# Fee Sponsorship {#fee-sponsorship}

When a challenge includes `feePayer: true` in `methodDetails`,
the server commits to paying Algorand transaction fees on behalf
of the client. This section describes the fee sponsorship
mechanism using Algorand's native fee pooling.

## Fee Calculation

The algod REST API's `v2/transactions/params` endpoint
returns two fee-related parameters: `fee` (the current
suggested fee per byte in microalgos) and `min-fee` (the
network minimum fee per transaction). The required fee
for each transaction is computed as:

~~~
required_fee = max(fee_per_byte * transaction_size_in_bytes,
                   min_fee)
~~~

Under normal (non-congested) network conditions,
`fee_per_byte` equals `0`, simplifying the formula to:

~~~
required_fee = max(0, min_fee) = min_fee
~~~

This is why standard Algorand transactions cost 0.001 ALGO
(1000 microalgos) during normal conditions. Under network
congestion, `fee_per_byte` increases, making fees dependent
on the serialized transaction size in bytes.

## Fee Pooling

Algorand supports fee pooling within atomic transaction
groups: the sum of all `fee` fields across all transactions
in the group must meet or exceed the sum of all individual
transaction required fees. This means a single transaction
can cover the fees for all transactions in the group by
setting a sufficiently high fee value. The pooled fee
requirement is:

~~~
sum(fee[i] for i in group) >= sum(required_fee[i] for i
                                  in group)
~~~

Under normal conditions (where `fee_per_byte` is 0), this
simplifies to `sum(fees) >= N * min_fee`. Under congestion,
larger serialized transactions may require higher fees.

## Server-Paid Fees

When `feePayer` is `true`:

1. **Client constructs group**: The client builds the payment
   transaction(s) with the `fee` field set to `0` in the
   transaction body. (Note: Algorand SDKs typically expose a
   `flatFee` flag to prevent automatic fee computation; this
   is an SDK convenience, not a wire protocol field.) The
   client also includes an unsigned transaction
   from the server's `feePayerKey` address: a zero-amount
   ALGO payment (`type: pay`) to itself. Since client
   transactions set `fee` to `0`, the fee payer transaction
   MUST carry the entire pooled fee, computed using values
   from `suggestedParams` or `v2/transactions/params`.

2. **Client assigns Group ID and signs**: The client assigns
   the Group ID to all transactions (including the fee payer
   transaction), then signs only its own transaction(s). The
   fee payer transaction is left unsigned. Once the Group ID
   is assigned and any transaction is signed, every
   transaction in the group is immutable — including the
   unsigned fee payer transaction, whose bytes contribute to
   the Group ID hash.

3. **Client sends credential**: The client sends the group
   (with the unsigned fee payer transaction) as a
   `type="transaction"` credential.

4. **Server verifies and signs**: The server verifies the
   group contents (see {{fee-payer-verification}}), then
   signs the fee payer transaction with its fee payer key.
   The server MUST NOT modify the fee payer transaction
   (changing any field would alter the Group ID and
   invalidate all client signatures). If the fee on the
   fee payer transaction is insufficient (e.g., due to
   congestion), the server MUST reject the credential and
   issue a fresh challenge with updated `suggestedParams`
   reflecting current fee requirements.

5. **Server broadcasts**: The fully signed group is broadcast
   to the Algorand network.

## Client-Paid Fees

When `feePayer` is `false` or omitted, the client MUST set
appropriate fees on its transaction(s) and fully sign the
entire group. The server broadcasts the group as-is without
adding any signatures.

## Server Requirements

When acting as fee payer, servers:

- MUST maintain sufficient ALGO balance in the fee payer
  account to cover transaction fees and MBR
- MUST verify the fee payer transaction contents before
  signing (see {{fee-payer-verification}})
- MAY recover fee costs through pricing or other business
  logic
- SHOULD implement rate limiting to mitigate fee exhaustion
  attacks (see {{fee-payer-risks}})

## Client Requirements

- When `feePayer` is `true`: clients MUST include an unsigned
  fee payer transaction from `feePayerKey` in the group and
  MUST set `fee` to `0` on their own transactions. Clients
  MUST use `type="transaction"` credentials.
- When `feePayer` is `false` or omitted: clients MUST set
  appropriate fees on their own transactions and fully sign
  all transactions.

# Verification Procedure {#verification}

Upon receiving a request with a credential, the server MUST:

1. Decode the base64url credential and parse the JSON.

2. Verify that `payload.type` is `"transaction"`.

3. Look up the stored challenge using
   `credential.challenge.id`. If no matching challenge
   is found, reject the request.

4. Verify that all fields in `credential.challenge`
   exactly match the stored challenge auth-params.

## Transaction Verification {#transaction-verification}

1. Verify the `paymentGroup` contains 16 or fewer elements.

2. Decode all transactions from the `paymentGroup`. Each
   element is base64-decoded and then msgpack-decoded to
   reveal the transaction contents.

3. Verify all transactions share the same Group ID.

4. Locate the transaction at `paymentGroup[paymentIndex]`
   and verify the payment details:

   - For native ALGO payments (`asaId` absent): verify
     the transaction `type` is `pay`, `amt` matches
     `amount`, and `rcv` matches `recipient`.
   - For ASA payments (`asaId` present): verify the
     transaction `type` is `axfer`, `aamt` matches
     `amount`, `arcv` matches `recipient`, and `xaid`
     matches `asaId`.

5. Verify that the payment transaction's `lx` field
   matches `SHA-256(challengeReference)`.

6. Verify the group contains only expected transactions:
   the payment transaction and (when `feePayer` is
   `true`) the fee payer transaction. Reject any group
   containing unexpected transactions.

7. If `feePayer` is `true`, verify the fee payer
   transaction (see {{fee-payer-verification}}). The
   fee payer transaction MUST NOT contain `close`,
   `aclose`, or `rekey` fields — these could drain or
   compromise the server's fee payer account.

   Note: `close`, `aclose`, and `rekey` on the client's
   own payment transaction are the client's prerogative
   and do not affect the server's payment verification
   (`arcv`/`aamt`/`xaid` checks are sufficient).

8. Simulate the transaction group against an Algorand
   node's `v2/transactions/simulate` endpoint. If
   simulation fails, reject the credential. This
   catches invalid transactions (including
   future-dated `firstValid`, insufficient balance,
   and invalid signatures) without spending fees.

   Note: signature validity (including resolution of
   `auth-addr` for rekeyed accounts) is enforced by
   the Algorand protocol at simulation and broadcast.
   The server does not pre-validate signatures.

9. If `feePayer` is `true`, sign the fee payer
   transaction with the server's fee payer key.

10. Broadcast the fully signed group to the Algorand
    network via the `v2/transactions` endpoint.

11. Algorand provides instant finality: once the
    transaction is included in a block, it is final.
    No additional confirmation is needed.

12. Return the resource with a Payment-Receipt header.

### Fee Payer Transaction Verification {#fee-payer-verification}

When verifying the fee payer transaction within the group,
servers MUST check:

1. The `snd` (sender) matches the server's `feePayerKey`.

2. The `type` is `pay` (ALGO payment).

3. The `amt` (amount) is absent or `0`. In msgpack
   encoding, omitted fields default to zero. Servers
   SHOULD reject fee payer transactions where `amt` is
   any non-zero value.

4. The `rcv` (receiver) matches the `snd` (payment to
   self) OR is absent (defaults to sender).

5. The `close` (close remainder to) field is absent.

6. The `rekey` (rekey to) field is absent.

7. The `fee` covers the group's pooled minimum. The server
   computes each transaction's required fee as
   `max(fee_per_byte * txn_size, min_fee)` using current
   values from `v2/transactions/params`, then verifies the
   fee payer transaction's `fee` meets or exceeds the sum
   of all required fees. The fee MUST NOT exceed a
   server-configured maximum (e.g., 3x the computed
   pooled minimum) as a safety bound against fee griefing.

8. The transaction is unsigned (the server will sign it).

## Replay Protection {#replay-protection}

This specification relies on three complementary layers
of replay protection, each enforced at a different level:

### Algorand Protocol — TxID Uniqueness

The Algorand protocol natively rejects transaction replay:

- Within the validity window (`firstValid` to
  `lastValid`): algod rejects a transaction whose TxID
  has already been confirmed, returning a "duplicate"
  error.
- Outside the validity window: algod rejects the
  transaction as "expired."

The server treats these algod error codes as authoritative
replay detection. No server-side TxID store is needed.

### Challenge State Machine — Credential Replay

The challenge state machine (below) prevents the same
credential from being processed twice at the application
layer. Once a challenge transitions to `claimed`, no
additional credential is accepted for that challenge.
Once `fulfilled`, retries receive the cached response.

### Lease — Mutual Exclusion

The `lease` field (`lx`) on the payment transaction
prevents multiple *distinct* transactions covering the
same charge from both being confirmed. If a client signs
two different transaction groups (A and B) for the same
charge (same `challengeReference` → same `lx` value),
the Algorand protocol ensures that if A is confirmed
then B is rejected, and vice-versa. This is not replay
protection (the protocol's TxID uniqueness already
handles that) — it is mutual exclusion between
logically-equivalent-but-distinct transactions.

Because `lease` is REQUIRED and derived as
`SHA-256(challengeReference)`, every charge produces a
unique `lx` value, which in turn guarantees distinct
TxIDs even when sender, receiver, amount, and round
range are identical across charges.

### Challenge State Machine

Servers SHOULD track challenge lifecycle through the
following states:

1. **issued**: Challenge created and sent in
   `WWW-Authenticate`. The `challengeReference` is
   recorded.
2. **claimed**: A credential has been received for this
   challenge. Only one credential may be accepted per
   challenge; concurrent submissions for the same
   challenge MUST be serialized.
3. **broadcast**: The transaction group has been
   submitted to the Algorand network.
4. **confirmed**: The transaction is confirmed in a
   block with instant finality.
5. **fulfilled**: The resource has been served and the
   receipt returned. Terminal success state.
6. **failed**: The transaction failed (broadcast
   rejection or on-chain failure).
   The server issues a fresh challenge.

Transitions MUST be atomic. A challenge in the `claimed`
state MUST NOT accept additional credentials. A challenge
in the `fulfilled` state MUST return the cached receipt
on retry (idempotent success).

# Settlement Procedure

For `type="transaction"` credentials, the client signs the
transaction group and sends it to the server. The server
optionally adds a fee payer signature and broadcasts:

~~~
   Client                    Server                 Algorand Network
      |                        |                          |
      |  (1) Authorization:    |                          |
      |      Payment           |                          |
      |      <credential>      |                          |
      |      (signed group)    |                          |
      |----------------------->|                          |
      |                        |                          |
      |                        |  (2) If feePayer: true,  |
      |                        |      verify & sign      |
      |                        |      fee payer txn      |
      |                        |                          |
      |                        |  (3) Broadcast group     |
      |                        |----------------------->  |
      |                        |  (4) Instant finality    |
      |                        |<-----------------------  |
      |                        |                          |
      |  (5) 200 OK + Receipt  |                          |
      |<-----------------------|                          |
      |                        |                          |
~~~

1. Client submits credential containing signed transaction
   group.
2. If `feePayer` is `true`, the server verifies the fee
   payer transaction and signs it with its fee payer key.
3. Server simulates the group to catch failures without
   spending fees.
4. Server materializes the response (prepares the resource
   payload) before broadcasting, so that the only remaining
   failure after broadcast is network/transport.
5. Server broadcasts the group to Algorand.
6. Transaction is included in a block with instant finality
   (sub-4-second block time, no forks).
7. Server returns the resource with a Payment-Receipt header.

## Idempotent Response Delivery

Algorand settlement is irreversible: once confirmed, a
transaction cannot be reversed or charged back. If the
server broadcasts successfully but fails to deliver the
response (e.g., server crash, network drop), there is
no on-chain refund path. The core HTTP Payment
Authentication Scheme's Idempotency and Concurrent
Request Handling requirements ({{I-D.httpauth-payment}})
are therefore the sole recovery mechanism.

Servers SHOULD compute the expected TxID from the unsigned
transaction body (the `txn` field inside the signed
wrapper, excluding signatures) and persist it together
with the challenge state **before** broadcasting. This enables
recovery on retry:

- **Within validity window**: re-broadcast attempt;
  algod returns "duplicate" if the original landed,
  confirming settlement. Server serves the response.
- **After validity window expiry**: algod rejects with
  "expired" on broadcast. Server looks up the
  pre-computed TxID via indexer
  (`v2/transactions/{txid}`). If found and confirmed,
  settlement occurred; server serves the response.
  If not found, the transaction expired without
  landing; client was not charged; server returns
  402 with a fresh challenge.

Servers SHOULD prepare the full response payload
before broadcasting (step 4 above), so that only
network/transport failures remain after the irreversible
broadcast step.

## Client Transaction Construction

### Native ALGO

The client MUST construct a transaction group containing
a payment transaction (`type: pay`) with:

- `snd`: the client's Algorand address
- `rcv`: the `recipient` from the challenge
- `amt`: the `amount` from the challenge

### ASA Transfers

The client MUST construct a transaction group containing
an asset transfer transaction (`type: axfer`) with:

- `snd`: the client's Algorand address
- `arcv`: the `recipient` from the challenge
- `aamt`: the `amount` from the challenge
- `xaid`: the `asaId` from `methodDetails`

The recipient account MUST have already opted in to the
ASA. If the recipient has not opted in, the transaction
will fail on-chain. Servers SHOULD ensure they have
opted in to the asset specified in the challenge.

### Fee Payer Configuration

When `feePayer` is `true` in the challenge:

- The client MUST include an unsigned `pay` transaction
  from `feePayerKey` to itself with `amt` of `0` and
  `fee` set to cover the entire group's pooled fees.
  Each transaction's required fee is computed as
  `max(fee_per_byte * txn_size, min_fee)` using values
  from `suggestedParams` or `v2/transactions/params`.
  The fee payer's `fee` MUST be at least the sum of all
  required fees in the group. Clients MUST NOT hardcode
  fee values.
- The client MUST set the `fee` field to `0` on its own
  transaction(s).
- The fee payer transaction SHOULD be the first
  transaction in the group (index 0).

When `feePayer` is `false` or absent:

- The client MUST ensure the group's total fees meet
  or exceed the sum of all per-transaction required
  fees (`max(fee_per_byte * txn_size, min_fee)` per
  transaction), either by setting an appropriate `fee`
  on each transaction, or by using Algorand's fee
  pooling to concentrate fees on a single transaction
  in the group.
- The client MUST fully sign all transactions in the
  group.

### Group Construction

After constructing all transactions, the client MUST:

1. Set the `lx` field on the payment transaction to the
   `lease` value from the challenge. The fee payer
   transaction MUST NOT have a lease set (it is a
   zero-amount self-payment, not a payment to the
   server).

2. Assign a Group ID to all transactions using the
   `assign_group_id` operation, which computes
   `SHA-512/256("TG" || TxID[0] || ... || TxID[n])`
   and sets the `grp` field on each transaction.

3. Sign each transaction with the appropriate key(s).
   Fee payer transactions (when `feePayer` is `true`)
   are left unsigned.

4. Encode each transaction (signed or unsigned) as
   msgpack and then base64.

## Finality

Algorand achieves instant finality: once a transaction is
included in a block, it is final and cannot be reversed.
There are no forks in the Algorand consensus protocol, so
there is no risk of transaction rollback. This eliminates
the need for multiple confirmation levels.

The server can return the receipt immediately after the
transaction is confirmed in a block (sub-4 seconds from
broadcast).

## Receipt Generation

Upon successful verification, the server MUST include
a `Payment-Receipt` header in the 200 response.

The receipt payload for Algorand charge:

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | `"algorand"` |
| `reference` | string | The transaction identifier (52-character base32 TxID) |
| `status` | string | `"success"` |
| `timestamp` | string | {{RFC3339}} verification time |

Note: challenge-to-receipt binding is handled by the
framework itself — the credential echoes the challenge
`id`, which the server verifies before issuing the
receipt. The receipt does not duplicate the challenge
identifier.

Example (decoded):

~~~json
{
  "method": "algorand",
  "reference": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPFNC6J\
HA5XNBQQHW7MWA",
  "status": "success",
  "timestamp": "2026-03-10T21:00:00Z"
}
~~~

# Error Responses

When rejecting a credential, the server MUST return HTTP
402 (Payment Required) with a fresh
`WWW-Authenticate: Payment` challenge per
{{I-D.httpauth-payment}}. The server SHOULD include a
response body conforming to RFC 9457 {{RFC9457}} Problem
Details, with `Content-Type: application/problem+json`.
The following problem types are defined for this method
under the `https://paymentauth.org/problems/algorand/`
namespace. These refine the core problem types defined in
{{I-D.httpauth-payment}} with Algorand-specific semantics.

https://paymentauth.org/problems/algorand/malformed-credential
: HTTP 402. The credential token could not be decoded, the
  JSON could not be parsed, or required fields (`challenge`,
  `payload`, `payload.type`) are absent or have the wrong
  type. A fresh challenge MUST be included in
  `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/unknown-challenge
: HTTP 402. The value of `credential.challenge.id` does
  not match any challenge issued by this server, or the
  challenge has already been consumed. A fresh challenge
  MUST be included in `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/group-invalid
: HTTP 402. The transaction group structure is invalid:
  too many transactions (exceeds 16), mismatched Group IDs,
  or `paymentIndex` out of range. A fresh challenge MUST be
  included in `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/fee-payer-invalid
: HTTP 402. The fee payer transaction failed verification:
  non-zero amount, `close`/`aclose`/`rekey` fields present,
  unreasonable fee, or wrong sender. A fresh challenge MUST
  be included in `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/transfer-mismatch
: HTTP 402. The on-chain transfer does not match the
  challenge parameters. This includes: wrong recipient,
  wrong amount, wrong ASA ID, or missing transfer
  transaction. A fresh challenge MUST be included in
  `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/transaction-not-found
: HTTP 402. The transaction identifier could not be fetched
  from the Algorand network. The transaction may not exist
  or may have expired. A fresh challenge MUST be included
  in `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/transaction-failed
: HTTP 402. The transaction group was rejected by the
  network or failed to confirm. A fresh challenge MUST be
  included in `WWW-Authenticate`.

https://paymentauth.org/problems/algorand/broadcast-failed
: HTTP 402. The server attempted to broadcast a
  `type="transaction"` credential but the Algorand network
  rejected it (e.g., invalid signature, insufficient
  funds, expired round range). A fresh challenge MUST be
  included in `WWW-Authenticate`.

Example error response body:

~~~json
{
  "type": "https://paymentauth.org/problems/algorand/\
transfer-mismatch",
  "title": "Transfer Mismatch",
  "status": 402,
  "detail": "Asset receiver does not match expected \
recipient"
}
~~~

# Security Considerations

## Transport Security

All communication MUST use TLS 1.2 or higher. Algorand
credentials MUST only be transmitted over HTTPS
connections.

## Replay Protection

Three layers prevent replay (see {{replay-protection}}):
the Algorand protocol rejects duplicate TxIDs and expired
transactions; the challenge state machine prevents
credential reuse at the application layer; and the
required `lease` field provides mutual exclusion between
distinct transactions covering the same charge. No
server-side TxID store is required.

## Client-Side Verification

Clients MUST verify the challenge before signing:

1. `amount` is reasonable for the service
2. `asaId`, if present, identifies a known and trusted
   asset — clients MUST verify `asaId` against a
   trusted registry or allowlist (do NOT rely on
   `currency` for asset identity, as ASA names are
   not unique on Algorand)
3. `recipient` is the expected party
4. `feePayerKey`, if present, is the expected server
5. `network` matches the client's configured network
6. `lease` is consistent with the `challengeReference`
   (clients SHOULD independently compute
   `SHA-256(challengeReference)` and verify it matches)

Malicious servers could request excessive amounts,
direct payments to unexpected recipients, or specify
a fraudulent `asaId` paired with a recognizable
`currency` label (e.g., `currency: "USDC"` with a
malicious `asaId`).

## Dangerous Transaction Fields

Algorand transactions support `close` (close remainder
to), `aclose` (asset close to), and `rekey` (rekey to)
fields. When present on the fee payer transaction, these
fields could drain or compromise the server's fee payer
account. Servers MUST reject fee payer transactions
containing any of these fields (see
{{fee-payer-verification}}). On the client's own payment
transaction, these fields affect only the client's
account and do not alter the payment to the recipient;
servers need not reject them.

## RPC Trust

The server relies on its Algorand node (algod) and
indexer to provide accurate transaction data for on-chain
verification. A compromised node could return fabricated
transaction data, causing the server to accept payments
that were never made. Servers SHOULD use trusted node
providers or run their own nodes.

## Fee Payer Risks {#fee-payer-risks}

Servers acting as fee payers accept financial risk in
exchange for providing a seamless payment experience.

Denial of Service via Bad Transactions
: Malicious clients could submit transaction groups that
  fail on-chain (insufficient balance, invalid
  instructions), causing the server to pay fees (at least
  `minFee` per transaction in the group) without receiving
  payment. Mitigations:

  - **Rate limiting**: per client address, per IP, or
    per time window.
  - **Balance verification**: check the client's balance
    covers the transfer amount before signing.
  - **Client authentication**: require API keys or OAuth
    tokens before accepting fee-sponsored transactions.

Fee Payer Balance Exhaustion
: Servers MUST monitor fee payer balance (including MBR)
  and reject new fee-sponsored requests when insufficient.
  The server SHOULD return a 402 with `feePayer: false`,
  allowing the client to pay its own fees as fallback.

Fee Payer Transaction Manipulation
: A malicious client could craft a fee payer transaction
  that transfers funds FROM the server's fee payer
  account. Servers MUST verify the fee payer transaction
  contains only a zero-amount self-payment with
  reasonable fees and no `close` or `rekey` fields
  (see {{fee-payer-verification}}).

## Asset Opt-In

In order for the recipient to receive payment in a
particular ASA, the recipient account MUST be opted in
to that asset. Servers SHOULD ensure they have opted in
to all assets they accept as payment. Clients SHOULD
verify the recipient is opted in before constructing the
transaction (using the `v2/accounts/{address}` algod
endpoint), though this is not strictly required as the
network will reject the transaction if the recipient is
not opted in.

## Transaction Group Security

The server receives a complete transaction
group from the client. A malicious client could include
unexpected transactions in the group. Servers MUST verify
that the group contains only expected transactions:
the payment transfer and optionally a fee payer
transaction. Any unexpected transactions MUST cause
rejection.

## Round Range Freshness

Algorand transactions include `firstValid` and `lastValid`
round numbers that define the validity window. The
difference MUST NOT exceed 1000 rounds. When the server
provides `suggestedParams` in the challenge, clients
SHOULD verify the round range is plausible. A malicious
server could provide an expired round range, causing the
client to sign a transaction that will never be accepted.
The practical risk is limited to a failed payment attempt
that the client can retry.

The charge intent requires immediate settlement. A
transaction with `firstValid` significantly beyond the
current round is not immediately broadcastable and would
force the server to hold the credential until the window
opens — effectively a scheduled payment, which is outside
the scope of the charge intent. The mandatory simulation
step ({{transaction-verification}}) catches this: algod
rejects transactions whose `firstValid` has not yet been
reached.

## Algorand Address Verification

Algorand addresses include a 4-byte checksum appended
to the public key before base32 encoding. Implementations
MUST validate the checksum when processing addresses to
prevent payments to malformed addresses.

# IANA Considerations

## Payment Method Registration

This document requests registration of the following
entry in the "HTTP Payment Methods" registry established
by {{I-D.httpauth-payment}}:

| Method Identifier | Description | Reference |
|-------------------|-------------|-----------|
| `algorand` | Algorand blockchain native ALGO and ASA transfer | This document |

## Payment Intent Registration

This document requests registration of the following
entry in the "HTTP Payment Intents" registry established
by {{I-D.httpauth-payment}}:

| Intent | Applicable Methods | Description | Reference |
|--------|-------------------|-------------|-----------|
| `charge` | `algorand` | One-time ALGO or ASA transfer | This document |

--- back

# Examples

The following examples illustrate the complete HTTP exchange
for each flow. Base64url values are shown with their decoded
JSON below.

## Native ALGO Charge

A 10 ALGO charge for weather API access.

**1. Challenge (402 response):**

~~~http
HTTP/1.1 402 Payment Required
WWW-Authenticate: Payment id="kM9xPqWvT2nJrHsY4aDfEb",
  realm="api.example.com",
  method="algorand",
  intent="charge",
  request="eyJhbW91bnQiOiIxMDAwMDAwMCIsImN1cnJlbmN5Ij
    oiQUxHTyIsImRlc2NyaXB0aW9uIjoiV2VhdGhlciBBUEkgY
    WNjZXNzIiwibWV0aG9kRGV0YWlscyI6eyJuZXR3b3JrIjoi
    YWxnb3JhbmQ6d0dIRTJQd2R2ZDdTMTJCTDVGYU9QMjBFR1l
    lc043M2t0aUMxcXpra2l0OD0iLCJyZWZlcmVuY2UiOiJmND
    dhYzEwYi01OGNjLTQzNzItYTU2Ny0wZTAyYjJjM2Q0NzkifS
    wicmVjaXBpZW50IjoiN1hLWFRHMkNXODdEOTdUWEpTRFBCRD
    VKQktIRVRRQTgzVFpSVUpPU0dBU1UifQ",
  expires="2026-03-15T12:05:00Z"
Cache-Control: no-store
~~~

Decoded `request`:

~~~json
{
  "amount": "10000000",
  "currency": "ALGO",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "Weather API access",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "challengeReference": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "lease": "xH7kQ2mN9vB4wP1jR6tY3cA8eF5gD0iL\
sU4oK7nM2bX="
  }
}
~~~

**2. Credential (retry with signed transaction group):**

~~~http
GET /weather HTTP/1.1
Host: api.example.com
Authorization: Payment <base64url-encoded credential>
~~~

Decoded credential:

~~~json
{
  "challenge": {
    "id": "kM9xPqWvT2nJrHsY4aDfEb",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "charge",
    "request": "<base64url-encoded request>",
    "expires": "2026-03-15T12:05:00Z"
  },
  "payload": {
    "type": "transaction",
    "paymentIndex": 0,
    "paymentGroup": [
      "<base64-encoded signed ALGO payment txn>"
    ]
  }
}
~~~

**3. Response (with receipt):**

~~~http
HTTP/1.1 200 OK
Payment-Receipt: <base64url-encoded receipt>
Content-Type: application/json

{"temperature": 72, "condition": "sunny"}
~~~

Decoded receipt:

~~~json
{
  "method": "algorand",
  "reference": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPFNC6J\
HA5XNBQQHW7MWA",
  "status": "success",
  "timestamp": "2026-03-15T12:04:58Z"
}
~~~

## ASA (USDC) Charge with Fee Sponsorship

A 5 USDC charge where the server sponsors transaction fees
and includes `suggestedParams` to eliminate client RPC
dependency.

Decoded `request`:

~~~json
{
  "amount": "5000000",
  "currency": "USDC",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "Premium API call",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "asaId": "31566704",
    "challengeReference": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "lease": "Yk3pR8wN5vB2mQ7jT1tX9cA6eF4gD0iL\
sU3oK8nM1bZ=",
    "feePayer": true,
    "feePayerKey": "GH9ZWEMDLJ8DSCKNTKTQPBNWLNNBJUSZAG9VP\
2KGTKJR",
    "suggestedParams": {
      "firstValid": 53347179,
      "lastValid": 53348179,
      "genesisHash": "wGHE2Pwdvd7S12BL5FaOP20EGYesN73k\
tiC1qzkkit8=",
      "genesisId": "mainnet-v1.0",
      "fee": 0,
      "minFee": 1000
    }
  }
}
~~~

The client uses `suggestedParams` from the challenge (no RPC
call needed). Since `fee` (fee per byte) is `0` (no
congestion), each transaction's required fee is
`max(0 * size, 1000) = 1000`. The pooled fee for this
2-transaction group is `2 * 1000 = 2000` microalgos. The
client includes a zero-amount fee payer transaction from
`feePayerKey` at index 0 with `fee: 2000`, and partially
signs only the ASA transfer at index 1. The `lease` field
is set on the ASA transfer to bind it to the challenge at
the protocol level. The server signs the fee payer
transaction and broadcasts.

Decoded credential:

~~~json
{
  "challenge": { "...": "echoed challenge" },
  "payload": {
    "type": "transaction",
    "paymentIndex": 1,
    "paymentGroup": [
      "<base64 unsigned fee payer pay txn>",
      "<base64 signed ASA transfer txn>"
    ]
  }
}
~~~

Decoded transaction group (via msgpack):

~~~
-[0] (fee payer, unsigned — pooled fee covers group)
{
  "txn": {
    "fee": 2000,
    "fv": 53347179,
    "gen": "mainnet-v1.0",
    "gh": "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qz\
kkit8=",
    "grp": "<group-id>",
    "lv": 53348179,
    "rcv": "GH9ZWEMDLJ8DSCKNTKTQPBNWLNNBJUSZAG9VP2K\
GTKJR",
    "snd": "GH9ZWEMDLJ8DSCKNTKTQPBNWLNNBJUSZAG9VP2K\
GTKJR",
    "type": "pay"
  }
}

-[1] (ASA transfer, signed by client)
{
  "sig": "<Ed25519 signature>",
  "txn": {
    "aamt": 5000000,
    "arcv": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
    "fv": 53347179,
    "gh": "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qz\
kkit8=",
    "grp": "<group-id>",
    "lv": 53348179,
    "lx": "Yk3pR8wN5vB2mQ7jT1tX9cA6eF4gD0iLsU3oK\
8nM1bZ=",
    "snd": "<client-algorand-address>",
    "type": "axfer",
    "xaid": 31566704
  }
}
~~~

The fee payer transaction at index 0 carries `fee: 2000`
(2 × 1000 `minFee`), covering both transactions via
Algorand's fee pooling. The payment transaction at
index 1 has `fee: 0` (omitted in msgpack) and includes
the `lx` (lease) field binding it to the challenge.

# Signature Schemes

Each top-level transaction in the `paymentGroup` MUST be
signed individually by the owner(s) of the sender address.
Algorand supports three signature types for top-level
transactions:

Ed25519 Single Signature (`sig`)
: A standard Ed25519 signature over the transaction's
  canonical msgpack encoding, prefixed with "TX". This is
  the most common signature type and is used for accounts
  controlled by a single key.

Multisignature (`msig`)
: A `k-of-n` threshold multisignature scheme where `k`
  out of `n` authorized signers must sign the transaction.
  The multisig structure includes the version, threshold,
  and an ordered list of public keys with their
  corresponding signatures. See the Algorand multisignature
  documentation for details.

Logic Signature (`lsig`)
: A signature verified by the Algorand Virtual Machine
  (AVM) by executing a TEAL program. Logic signatures
  enable contract-controlled accounts and delegated
  signing. A logic signature may be used by fee payers
  to enforce constraints on the transaction group
  (e.g., ensuring the fee payer transaction is only a
  zero-amount self-payment). This can offload malicious
  transaction detection to on-chain logic.

Servers MUST accept all three signature types when
verifying transaction groups. The fee payer transaction
(when unsigned and awaiting server signature) will
typically be signed with an Ed25519 single signature by
the server, though servers MAY use a logic signature
to enforce fee payer constraints programmatically.

# Algorand Addresses

Algorand addresses are 58-character base32-encoded (RFC
4648, without padding) representations derived from
public keys or program hashes.

## Address Derivation from Public Keys

For standard accounts, the address is derived from the
Ed25519 public key as follows:

1. Compute the SHA-512/256 hash of the 32-byte public
   key.
2. Take the last 4 bytes of the hash as a checksum.
3. Concatenate the 32-byte public key with the 4-byte
   checksum (36 bytes total).
4. Base32-encode (without padding) the 36-byte result,
   producing a 58-character uppercase string.

~~~
address = base32_nopad(publicKey || checksum)
where checksum = sha512_256(publicKey)[-4:]
~~~

## Logic Signature Addresses

For contract accounts (logic signatures), the address is
derived from the program bytecode. The program hash serves
as the 32-byte "public key equivalent," and the checksum
is computed from that hash (not from the bytecode
directly):

~~~
program_hash = sha512_256("Program" || bytecode)
checksum     = sha512_256(program_hash)[-4:]
address      = base32_nopad(program_hash || checksum)
~~~

This encoding ensures that addresses can be derived
directly from public keys without requiring an on-chain
lookup or a prior signature (unlike EVM's `ecRecover`).
Implementations MUST validate the checksum when
processing addresses.

# Transaction Encoding

Algorand encodes transactions using MessagePack (msgpack)
{{MSGPACK}}, a binary serialization format. Each element
in the `paymentGroup` array is the base64 encoding of a
msgpack-encoded transaction.

## Decoding

To inspect a transaction group, each element can be
base64-decoded and then msgpack-decoded. Using the
Algorand CLI tool `goal`:

~~~
% cat payload.json \
  | jq -r '.paymentGroup[]' \
  | base64 -d \
  | goal clerk inspect -
-[0]
{
  "txn": {
    "fee": 2000,
    "fv": 53347179,
    "gen": "mainnet-v1.0",
    "gh": "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1q\
zkkit8=",
    "grp": "fy1Szr+lgvgTJsviMY2KnHSsXqyfCJ1UOCE+\
2Tf3vS8=",
    "lv": 53348179,
    "rcv": "<fee-payer-address>",
    "snd": "<fee-payer-address>",
    "type": "pay"
  }
}

-[1]
{
  "sig": "<base64-Ed25519-signature>",
  "txn": {
    "aamt": 5000000,
    "arcv": "<recipient-address>",
    "fv": 53347179,
    "gh": "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1q\
zkkit8=",
    "grp": "fy1Szr+lgvgTJsviMY2KnHSsXqyfCJ1UOCE+\
2Tf3vS8=",
    "lv": 53348179,
    "snd": "<client-address>",
    "type": "axfer",
    "xaid": 31566704
  }
}
~~~

## Signed vs Unsigned Transactions

Unsigned transactions are encoded as a msgpack map with
a single `txn` key containing the transaction fields.
Signed transactions wrap the transaction with additional
keys: `sig` (Ed25519), `msig` (multisig), or `lsig`
(logic signature).

## Transaction Field Reference

Key transaction fields used in this specification:

| Field | Full Name | Type | Description |
|-------|-----------|------|-------------|
| `type` | Type | string | `"pay"` (ALGO) or `"axfer"` (ASA) |
| `snd` | Sender | address | Transaction sender |
| `rcv` | Receiver | address | ALGO payment receiver |
| `amt` | Amount | uint64 | ALGO amount in microalgos |
| `fee` | Fee | uint64 | Transaction fee in microalgos |
| `fv` | FirstValid | uint64 | First valid round |
| `lv` | LastValid | uint64 | Last valid round |
| `gh` | GenesisHash | bytes | Network genesis hash |
| `gen` | GenesisID | string | Network genesis ID |
| `grp` | Group | bytes | Group ID (SHA-512/256 hash) |
| `note` | Note | bytes | Arbitrary data (max 1024 bytes) |
| `lx` | Lease | bytes | 32-byte lease for replay prevention |
| `arcv` | AssetReceiver | address | ASA transfer receiver |
| `aamt` | AssetAmount | uint64 | ASA amount in base units |
| `xaid` | XferAsset | uint64 | ASA ID being transferred |
| `close` | CloseRemainderTo | address | Close ALGO balance to |
| `aclose` | AssetCloseTo | address | Close ASA balance to |
| `rekey` | RekeyTo | address | Rekey account to |

For a complete reference, see {{ALGORAND-TRANSACTIONS}}.

# Gasless Transactions via Logic Signatures

Servers acting as fee payers MAY use logic signatures
to enforce constraints on the fee payer transaction
programmatically. Instead of signing the fee payer
transaction with a standard Ed25519 key, the server
provides a logic signature program that validates:

- The transaction type is `pay`
- The amount is `0`
- The `close` and `rekey` fields are absent
- The fee is within acceptable bounds

This offloads malicious transaction detection from
the server's application layer to on-chain verification
by the AVM, providing an additional layer of security.
The server provides its signature of the transaction
identifier as an argument to the logic signature program.

# Acknowledgements

The author thanks the Algorand Foundation, Algorand Foundation CTO and engineering team, Algorand developer community, the GoPlausible team, and the MPP working group for their input
on this specification.
