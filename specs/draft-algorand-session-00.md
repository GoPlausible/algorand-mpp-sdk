---
title: Algorand Session Intent for HTTP Payment Authentication
abbrev: Algorand Session
docname: draft-algorand-session-00
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

normative:
  RFC2119:
  RFC3339:
  RFC4648:
  RFC8174:
  RFC8259:
  RFC8785:
  RFC9457:
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
  ALGORAND-ABI:
    title: "Algorand ABI and ARC-4"
    target: https://dev.algorand.co/concepts/smart-contracts/abi/
    author:
      - org: Algorand Foundation
    date: 2026
  ALGORAND-BOXES:
    title: "Algorand Box Storage"
    target: https://dev.algorand.co/concepts/smart-contracts/storage/box/
    author:
      - org: Algorand Foundation
    date: 2026
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
  ALGORAND-REKEY:
    title: "Algorand Account Rekeying"
    target: https://dev.algorand.co/concepts/accounts/rekeying/
    author:
      - org: Algorand Foundation
    date: 2026
  ALGORAND-INNER:
    title: "Algorand Inner Transactions"
    target: https://dev.algorand.co/concepts/smart-contracts/inner-txns/
    author:
      - org: Algorand Foundation
    date: 2026
  WEBAUTHN:
    title: "Web Authentication: An API for accessing Public Key Credentials - Level 2"
    target: https://www.w3.org/TR/webauthn-2/
    author:
      - org: W3C
    date: 2021
  FIDO2:
    title: "FIDO2: Web Authentication (WebAuthn)"
    target: https://fidoalliance.org/fido2/
    author:
      - org: FIDO Alliance
    date: 2024
  ARC-52:
    title: "ARC-52: Extended HD Wallet for Algorand (BIP32-Ed25519)"
    target: https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0052.md
    author:
      - org: Algorand Foundation
    date: 2024
  CAIP-2:
    title: "CAIP-2: Blockchain ID Specification"
    target: https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md
    author:
      - org: Chain Agnostic Improvement Proposals
    date: 2024
  MSGPACK:
    title: "MessagePack Specification"
    target: https://msgpack.org/
    author:
      - name: Sadayuki Furuhashi
    date: 2023
---

--- abstract

This document defines the "session" intent for the "algorand"
payment method within the Payment HTTP Authentication Scheme
{{I-D.httpauth-payment}}. Sessions enable metered, streaming,
or repeated-use access to resources through off-chain vouchers
backed by an on-chain escrow. The client opens a payment
channel by depositing into an ARC-4 escrow application on the
Algorand blockchain, authorizes incremental spend via
Ed25519-signed vouchers, and settles on-chain when the session
closes.

--- middle

# Introduction

HTTP Payment Authentication {{I-D.httpauth-payment}} defines
a challenge-response mechanism that gates access to resources
behind payments. This document registers the "session" intent
for the "algorand" payment method.

The `session` intent establishes a unidirectional streaming
payment channel using an on-chain ARC-4 application escrow
and off-chain Ed25519-signed vouchers. This enables
high-frequency, low-cost payments by batching many off-chain
voucher updates into periodic on-chain settlement.

Unlike the `charge` intent (defined separately), which settles
a full on-chain transaction per request, the `session` intent
allows clients to pay incrementally as service is consumed.
This makes sessions suitable for streaming, metered APIs, and
any use case where per-request on-chain settlement would be
prohibitively expensive or slow.

## Algorand-Specific Capabilities

This specification leverages Algorand-specific capabilities:

- **ARC-4 application escrow**: Channel state is managed by
  an ARC-4 compliant application {{ALGORAND-ABI}} using box
  storage {{ALGORAND-BOXES}} for per-channel data. ABI method
  routing provides a typed interface for open, settle, topUp,
  close, requestClose, and withdraw operations.

- **Atomic transaction groups**: Channel open combines the
  application call and deposit transfer in a single atomic
  group {{ALGORAND-ATOMIC}} (up to 16 transactions). Either
  all succeed or all fail, ensuring the channel is never
  partially initialized.

- **Fee pooling**: The server can sponsor all on-chain
  operations (open, topUp) so the client never needs ALGO
  for transaction fees. A single transaction in the group
  can cover fees for all transactions via Algorand's native
  fee pooling mechanism.

- **Ed25519 native voucher signing**: Vouchers are signed
  using Ed25519, Algorand's native signature curve
  {{ALGORAND-SIGNING}}. Voucher signatures can be verified
  on-chain by the escrow application using the AVM's
  built-in `ed25519verify` or `ed25519verify_bare` opcodes,
  without requiring external verification programs.

- **Inner transactions**: The escrow application issues
  inner transactions {{ALGORAND-INNER}} for settlement and
  refund operations, keeping these operations atomic within
  a single application call.

- **Instant finality**: Algorand achieves instant finality
  with no forks {{ALGORAND-DOCS}}. Channel operations are
  confirmed in sub-4 seconds, and once confirmed, they
  cannot be reversed.

- **Box storage**: Per-channel state is stored in application
  boxes {{ALGORAND-BOXES}}, supporting an unlimited number
  of channels per escrow application. Box creation and
  deletion are tied to the Minimum Balance Requirement (MBR),
  which naturally prevents channel spam.

- **Minimum Balance Requirement (MBR)**: Box creation
  requires the escrow application to hold additional ALGO
  to meet MBR. This creates a natural economic barrier
  against channel exhaustion attacks.

- **FIDO2/WebAuthn passkey compatibility**: Algorand's
  native Ed25519 signature curve is compatible with
  FIDO2/WebAuthn passkey authentication {{WEBAUTHN}}.
  Passkeys can be cryptographically bound to Algorand
  Ed25519 keypairs via a custom WebAuthn extension that
  proves account ownership during the attestation
  ceremony. This enables biometric-authenticated voucher
  signing without introducing additional signature curves
  or on-chain verification methods.

## Session Flow

~~~
  Client                      Server             Algorand
     |                           |                  |
     |  (1) GET /resource        |                  |
     |-------------------------> |                  |
     |                           |                  |
     |  (2) 402 (pricing, asset) |                  |
     |<------------------------- |                  |
     |                           |                  |
     |  (3) open (deposit group  |                  |
     |       + initial voucher)  |                  |
     |-------------------------> |                  |
     |                           | (4) sign fee     |
     |                           |     payer txn +  |
     |                           |     broadcast    |
     |                           |----------------> |
     |  (5) 200 OK + Receipt     |                  |
     |<------------------------- |                  |
     |                           |                  |
     |  (6) voucher (cumulative: |                  |
     |       100)                |  no on-chain tx  |
     |-------------------------> |                  |
     |  (7) 200 OK + Receipt     |                  |
     |<------------------------- |                  |
     |                           |                  |
     |  (8) voucher (cumulative: |                  |
     |       200)                |  no on-chain tx  |
     |-------------------------> |                  |
     |  (9) 200 OK + Receipt     |                  |
     |<------------------------- |                  |
     |        ...                |                  |
     |                           |                  |
     |  (10) close (final        |                  |
     |        voucher)           |                  |
     |-------------------------> |                  |
     |                           | (11) settle +    |
     |                           |      refund      |
     |                           |      (inner txns)|
     |                           |----------------> |
     |  (12) 204 + Receipt       |                  |
     |<------------------------- |                  |
     |                           |                  |
~~~

Steps 6--9 are off-chain: the client signs a voucher
authorizing cumulative spend, the server verifies the
signature and serves the resource. No on-chain
transaction occurs per request.

When fee sponsorship is enabled, the server co-signs
as fee payer on steps 4 and 11 --- the client never
needs ALGO for transaction fees.

## Relationship to the Charge Intent

The "charge" intent (defined separately) handles one-time
payments. The "session" intent handles metered, streaming,
or repeated-use payments within a single channel. Both
intents share the same `algorand` method identifier and
encoding conventions.

# Requirements Language

{::boilerplate bcp14-tagged}

# Terminology

Payment Channel
: A unidirectional payment relationship between a payer
  and payee, consisting of an on-chain escrow managed by
  an ARC-4 application and a sequence of off-chain
  vouchers. The channel is identified by a unique
  `channelId`.

Channel Application
: An ARC-4 compliant Algorand application
  {{ALGORAND-ABI}} that manages channel escrow using box
  storage {{ALGORAND-BOXES}}. It enforces deposit,
  settlement, and withdrawal rules. The application ID
  is declared in the challenge so clients can verify they
  are interacting with the expected application.

Voucher
: An Ed25519-signed message authorizing a cumulative
  payment amount for a specific channel. Vouchers are
  monotonically increasing in amount.

Cumulative Amount
: The total amount authorized from channel open, not a
  per-request delta. For example, if the first voucher
  authorizes 100 and the second authorizes 250, the
  payee may claim up to 250 total, not 350.

Authorized Signer
: The key permitted to sign vouchers for a channel.
  Defaults to the payer unless the channel open binds a
  delegated signer in the channel box state.

Grace Period
: A time window after a client requests forced close,
  during which the server can still settle outstanding
  vouchers before funds are returned to the client.

Settlement Rate Limit
: An optional on-chain enforcement mechanism that caps
  how fast the server can settle funds from the escrow.
  Defined by a `settlementInterval` (minimum seconds
  between settlements) and `maxDebitPerInterval`
  (maximum base units per interval). Set by the client
  at channel open and enforced by the escrow application.
  This reduces client trust requirements in the
  pre-authorized model by preventing the server from
  settling the full deposit at once.

Passkey-Enhanced Signing
: A client-side security enhancement where the payer's
  Ed25519 signing key is gated behind FIDO2/WebAuthn
  {{WEBAUTHN}} passkey authentication. The passkey is
  bound to the Algorand Ed25519 keypair during a FIDO2
  attestation ceremony. Subsequent voucher signing
  requires biometric or device PIN authentication before
  the Ed25519 key is used. This enhancement applies to
  both the Default and Pre-Authorized authorization
  models without changing the wire format.

Box Storage
: Algorand application storage mechanism where data is
  stored in named boxes associated with the application
  {{ALGORAND-BOXES}}. Each box has a name (key) and
  content (value), and requires the application to hold
  additional ALGO for MBR.

Minimum Balance Requirement (MBR)
: The minimum ALGO balance an account or application must
  maintain. For box storage, MBR increases by 2500
  microalgos plus 400 microalgos per byte (box name size
  plus box content size) for each box created.

Inner Transaction
: A transaction authorized by an application during
  execution, rather than by an external signature
  {{ALGORAND-INNER}}. The escrow application uses inner
  transactions for settlement payments and refunds.

Microalgos
: The smallest unit of native ALGO. 1 ALGO = 1,000,000
  microalgos.

Base Units
: The smallest transferable unit of an ASA, determined by
  the asset's decimal precision. For example, USDC on
  Algorand (ASA ID 31566704) uses 6 decimals, so
  1 USDC = 1,000,000 base units.

Algorand Standard Asset (ASA)
: A fungible or non-fungible token on Algorand, identified
  by a unique 64-bit unsigned integer (ASA ID). ASAs are
  native to the protocol and do not require smart contracts
  {{ALGORAND-TRANSACTIONS}}.

# Intent Identifier

The intent identifier for this specification is "session".
It MUST be lowercase.

# Encoding Conventions {#encoding}

All JSON {{RFC8259}} objects carried in auth-params or HTTP
headers in this specification MUST be serialized using the
JSON Canonicalization Scheme (JCS) {{RFC8785}} before
encoding. JCS produces a deterministic byte sequence, which
is required for any digest or signature operations defined
by the base spec {{I-D.httpauth-payment}}.

The resulting bytes MUST then be encoded using base64url
{{RFC4648}} Section 5 without padding characters (`=`).
Implementations MUST NOT append `=` padding when encoding,
and MUST accept input with or without padding when decoding.

This encoding convention applies to: the `request` auth-param
in `WWW-Authenticate`, the credential token in
`Authorization`, and the receipt token in `Payment-Receipt`.

Individual transactions within a `paymentGroup` are encoded
as standard base64 ({{RFC4648}} Section 4), consistent with
the Algorand SDK convention for msgpack-encoded transactions
{{MSGPACK}}.

# Channel Application Interface

The channel application manages escrow state and enforces
settlement rules. This section defines the logical interface
that conforming channel applications MUST implement.

## Channel State {#channel-state}

Each channel is represented by a box in the escrow
application {{ALGORAND-BOXES}}. The box name is a
deterministic 32-byte hash derived from the channel
parameters:

~~~
boxName = SHA-512/256(
    payer ||
    payee ||
    assetId ||
    salt ||
    authorizedSigner
)
~~~

Where `payer` and `payee` are 32-byte public keys,
`assetId` is an 8-byte big-endian uint64, `salt` is a
32-byte client-chosen random value, and
`authorizedSigner` is a 32-byte public key (equal to
`payer` when no delegation is used).

The `channelId` is the base32-encoded (without padding)
representation of the 32-byte box name, producing a
52-character uppercase string consistent with Algorand
address and transaction identifier encoding.

The box content stores the following fields using ABI
encoding {{ALGORAND-ABI}}:

| Field | ABI Type | Description |
|-------|----------|-------------|
| `payer` | address | Client who deposited funds |
| `payee` | address | Server authorized to settle |
| `assetId` | uint64 | ASA ID (0 for native ALGO) |
| `authorizedSigner` | address | Voucher signer (payer if not delegated) |
| `deposit` | uint64 | Total amount deposited |
| `settled` | uint64 | Cumulative amount settled to payee |
| `closeRequestedAt` | uint64 | Unix timestamp of close request (0 if none) |
| `settlementInterval` | uint64 | Minimum seconds between settlements (0 if no rate limit) |
| `maxDebitPerInterval` | uint64 | Maximum base units per interval (0 if no rate limit) |
| `lastSettledAt` | uint64 | Timestamp of most recent settlement (0 if never settled) |
| `finalized` | bool | Whether channel is closed |

Channel applications MUST derive the box name
deterministically from the channel parameters above.
Clients and servers MUST independently compute the
expected box name and MUST verify that the open
transaction creates a box with exactly that name.
Relying on a client-declared `channelId` string alone
is NOT sufficient.

## ABI Methods {#abi-methods}

The channel application MUST implement the following
ARC-4 ABI methods {{ALGORAND-ABI}}. The signatures shown
are a reference; alternative implementations MAY use
different parameter encoding as long as the semantics are
preserved.

### open

Creates the channel box and receives the initial deposit.
The open operation MUST be submitted as an atomic
transaction group {{ALGORAND-ATOMIC}} containing at
minimum:

1. An application call transaction invoking the `open`
   method on the escrow application.
2. A payment (`pay`) or asset transfer (`axfer`)
   transaction depositing funds into the escrow
   application account.

The payer authority for the deposit transfer MUST be a
signer on the transaction.

| Parameter | ABI Type | Description |
|-----------|----------|-------------|
| `payee` | address | Server's address |
| `assetId` | uint64 | ASA ID (0 for native ALGO) |
| `deposit` | uint64 | Initial deposit in base units |
| `salt` | byte[32] | Client-chosen random value |
| `authorizedSigner` | address | Voucher signer (payer address if not delegated) |
| `settlementInterval` | uint64 | OPTIONAL. Min seconds between settlements (0 to disable) |
| `maxDebitPerInterval` | uint64 | OPTIONAL. Max base units per interval (0 to disable) |

When both `settlementInterval` and `maxDebitPerInterval`
are non-zero, the escrow application enforces on-chain
settlement rate limiting. When either is zero, no rate
limit is enforced. Both values are stored in the channel
box and cannot be modified after open.

Returns the computed `channelId` (32-byte box name,
base32-encoded).

### settle

Payee presents a signed voucher. The application verifies
the Ed25519 signature (using the AVM's `ed25519verify`
or `ed25519verify_bare` opcode), checks that
`cumulativeAmount > settled` and
`cumulativeAmount <= deposit`, then issues an inner
transaction {{ALGORAND-INNER}} transferring the delta
(`cumulativeAmount - settled`) to the payee.

When settlement rate limiting is enabled
(`settlementInterval > 0` and `maxDebitPerInterval > 0`),
the application MUST additionally enforce:

~~~
elapsed = Global.latest_timestamp - lastSettledAt
allowedIntervals = elapsed / settlementInterval
maxSettleable = allowedIntervals * maxDebitPerInterval
delta = cumulativeAmount - settled

REJECT if delta > maxSettleable
~~~

After a successful settlement, the application updates
`lastSettledAt = Global.latest_timestamp`.

The server MAY call settle at any time to claim
accumulated funds without closing the channel, subject
to the rate limit if enabled.

| Parameter | ABI Type | Description |
|-----------|----------|-------------|
| `channelId` | byte[32] | Box name identifying the channel |
| `cumulativeAmount` | uint64 | Cumulative total authorized |
| `signature` | byte[64] | Ed25519 voucher signature |

The payee authority MUST be a signer on the transaction.

### topUp

Payer transfers additional funds to the escrow. The
operation MUST be submitted as an atomic group containing
an application call and a deposit transfer, same as open.
The application increases `deposit` accordingly. If
`closeRequestedAt > 0`, topUp MUST reset it to 0
(cancelling any pending forced close).

| Parameter | ABI Type | Description |
|-----------|----------|-------------|
| `channelId` | byte[32] | Existing channel identifier |
| `additionalAmount` | uint64 | Additional deposit in base units |

The payer authority for the additional deposit MUST be a
signer on the transaction.

### requestClose

Payer initiates a forced close. The application sets
`closeRequestedAt` to the current latest timestamp
(`Global.latest_timestamp`). This starts a grace period
during which the payee can still call settle or close.

| Parameter | ABI Type | Description |
|-----------|----------|-------------|
| `channelId` | byte[32] | Channel identifier |

The payer authority MUST be a signer on the transaction.

### withdraw

Payer recovers remaining funds after the grace period has
expired. The application verifies
`Global.latest_timestamp >= closeRequestedAt + gracePeriod`,
issues an inner transaction transferring
`deposit - settled` to the payer, marks the channel as
finalized, and deletes the box.

| Parameter | ABI Type | Description |
|-----------|----------|-------------|
| `channelId` | byte[32] | Channel identifier |

The payer authority MUST be a signer on the transaction.

### close

Payee closes the channel by settling any final delta
authorized by a voucher and refunding the remainder to
the payer atomically via inner transactions. If no new
delta exists beyond the current `settled` watermark,
the close path MAY omit voucher verification and act
as a refund-only cooperative close.

| Parameter | ABI Type | Description |
|-----------|----------|-------------|
| `channelId` | byte[32] | Channel identifier |
| `cumulativeAmount` | uint64 | Final cumulative amount |
| `signature` | byte[64] | Ed25519 voucher signature |

The application settles the delta to the payee, refunds
the remainder to the payer, marks the channel as
finalized, and deletes the box --- all within a single
application call using inner transactions.

When settlement rate limiting is enabled, the close
method MUST enforce the same rate limit as settle.
If the final delta exceeds the rate-limited maximum,
the server MUST call settle first (within rate limits)
and then close the channel after sufficient time has
elapsed. This prevents the server from bypassing the
rate limit by calling close instead of settle.

The payee authority MUST be a signer on the transaction.

## Grace Period

The grace period (RECOMMENDED: 15 minutes / 900 seconds)
protects the payee. If the payer calls requestClose while
the payee has unsubmitted vouchers, the payee has until
the grace period expires to call settle or close.

Without a grace period, the payer could withdraw funds
immediately after receiving service, before the server
has time to settle.

TopUp cancels pending close requests by resetting
`closeRequestedAt` to 0, preventing a grief attack where
the payer requests close repeatedly to disrupt the
session.

## Access Control

| Method | Caller |
|--------|--------|
| open | Anyone (payer signs the deposit transfer) |
| settle | Payee only |
| topUp | Payer only |
| requestClose | Payer only |
| withdraw | Payer only (after grace period) |
| close | Payee only |

## MBR Considerations {#mbr}

Box creation requires the escrow application to hold
additional ALGO to meet the Minimum Balance Requirement.
The MBR increase for a box is:

~~~
box_mbr = 2500 + 400 * (box_name_length + box_content_length)
~~~

measured in microalgos. For the channel state box defined
in this specification:

~~~
box_name_length  = 32 bytes (SHA-512/256 hash)
box_content_length = 161 bytes (ABI-encoded state)
box_mbr = 2500 + 400 * (32 + 161) = 79,700 microalgos
~~~

The deposit atomic group MUST include sufficient ALGO to
cover the box MBR. When `feePayer` is `true`, the server's
fee payer transaction SHOULD cover this cost. When
`feePayer` is `false`, the payer MUST include an additional
ALGO payment to the escrow application account to cover
MBR.

On channel close or withdraw, box deletion releases the
MBR back to the escrow application. The application
SHOULD return released MBR to the payer via an inner
transaction.

## Ed25519 Voucher Verification On-Chain

The escrow application verifies Ed25519 voucher
signatures directly using the AVM's built-in
`ed25519verify` or `ed25519verify_bare` opcodes. This
provides native, efficient on-chain verification without
requiring external verification programs or instruction
introspection.

The verification procedure on-chain MUST:

1. Reconstruct the signed message from the voucher
   parameters (`channelId`, `cumulativeAmount`, and
   `expiresAt` if present) using the same
   deterministic serialization used off-chain.

2. Verify the Ed25519 signature against the channel's
   `authorizedSigner` public key (or `payer` if no
   delegation is used).

3. Reject signatures that do not match the expected
   signer.

# Request Schema

## Shared Fields

The `request` auth-param of the `WWW-Authenticate: Payment`
header contains a JCS-serialized, base64url-encoded JSON
object (see {{encoding}}). The following shared fields are
included:

amount
: REQUIRED. Price per unit of service in base units,
  encoded as a decimal string. For native ALGO, the
  amount is in microalgos. For ASAs, the amount is in the
  asset's smallest unit. The value MUST be a positive
  integer that fits in a 64-bit unsigned integer.

currency
: REQUIRED. A display label identifying the unit for
  `amount`. For native ALGO, MUST be the string "ALGO"
  (uppercase). For ASAs, this field is INFORMATIONAL
  ONLY --- the canonical asset identity is `asaId` in
  `methodDetails`. Implementations MUST use `asaId`
  (not `currency`) when constructing and verifying
  transactions. The value SHOULD be a human-readable
  ticker (e.g., "USDC"). Since ASA names and unit names
  are NOT unique on Algorand, clients MUST NOT rely on
  `currency` to identify the asset; clients MUST verify
  `asaId` against a trusted asset registry or their own
  allowlist before signing. MUST NOT exceed 128
  characters.

recipient
: REQUIRED. The Algorand address of the account receiving
  settlement payments. This is a 58-character
  base32-encoded string.

description
: OPTIONAL. A human-readable memo describing the resource
  or service being paid for. MUST NOT exceed 256
  characters.

unitType
: OPTIONAL. Unit being priced (for example, `"request"`,
  `"token"`, or `"byte"`).

suggestedDeposit
: OPTIONAL. Suggested initial channel deposit in base
  units, encoded as a decimal string. Clients MAY deposit
  less or more depending on expected usage. The minimum
  viable deposit is implementation-defined but SHOULD be
  at least `amount` to cover one unit of service.

externalId
: OPTIONAL. Merchant's reference (e.g., order ID, invoice
  number). May be used for reconciliation.

For the `session` intent, `amount` specifies the price
per unit of service, not a total charge. When `unitType`
is present, clients can estimate cost before a session
begins:

~~~
total = amount * units_consumed
~~~

## Method Details

The following fields are nested under `methodDetails` in
the request JSON:

network
: OPTIONAL. Identifies which Algorand network the payment
  should be made on, using the CAIP-2 format {{CAIP-2}}:
  `algorand:<genesis-hash>`. The genesis hash is the
  base64-encoded SHA-256 hash of the network's genesis
  block. Well-known values:

  - MainNet: `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=`
  - TestNet: `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`

  Defaults to the MainNet value if omitted.

appId
: REQUIRED. Application ID of the channel escrow
  application, encoded as a decimal string. Clients MUST
  verify this matches their expected application before
  depositing funds.

channelId
: OPTIONAL. Existing channel identifier to resume. When
  present, clients SHOULD verify the referenced channel
  is open and sufficiently funded before reuse. When
  absent, clients generate a random salt and open a new
  channel.

asaId
: Conditionally REQUIRED. The ASA ID (64-bit unsigned
  integer) of the asset to transfer, encoded as a decimal
  string. If omitted, the payment is in native ALGO.
  When present, `decimals` MUST also be present.

decimals
: Conditionally REQUIRED. The number of decimal places
  for the ASA (0--19). MUST be present when `asaId` is
  present; MUST be absent when `asaId` is absent.

challengeReference
: REQUIRED. A server-generated unique identifier for
  this payment challenge, encoded as a string. MUST NOT
  exceed 128 characters. The server uses this value to
  correlate incoming credentials with issued challenges
  and to enforce single-use semantics. MUST be unique
  per challenge.

lease
: OPTIONAL. A base64-encoded 32-byte value to set as the
  `lx` (lease) field on the deposit transaction(s)
  {{ALGORAND-LEASE}}. When present, the Algorand protocol
  enforces that no two transactions from the same sender
  with the same lease can be confirmed within overlapping
  validity windows. Servers SHOULD set `lease` to a
  deterministic value derived from the challenge, such as
  `SHA-256(challengeReference)`.

feePayer
: OPTIONAL. A boolean indicating whether the server will
  pay transaction fees on behalf of the client. Defaults
  to `false` if omitted. When `true`, the `feePayerKey`
  field MUST also be present.

feePayerKey
: Conditionally REQUIRED. The Algorand address of the
  server's fee payer account. MUST be present when
  `feePayer` is `true`; MUST be absent when `feePayer`
  is `false` or omitted.

suggestedParams
: OPTIONAL. A JSON object containing suggested
  transaction parameters. When provided, clients SHOULD
  use these parameters instead of fetching them from an
  Algorand node. Fields:

  - `firstValid` (number): First valid round.
  - `lastValid` (number): Last valid round. The
    difference between `lastValid` and `firstValid`
    MUST NOT exceed 1000 rounds.
  - `genesisHash` (string): Base64-encoded genesis hash.
    MUST match the `network` genesis hash.
  - `genesisId` (string): Genesis ID string (e.g.,
    "mainnet-v1.0", "testnet-v1.0").
  - `fee` (number): Current suggested fee per byte in
    microalgos.
  - `minFee` (number): Network minimum fee per
    transaction in microalgos.

minVoucherDelta
: OPTIONAL. Minimum amount increase between accepted
  vouchers, encoded as a decimal string.

ttlSeconds
: OPTIONAL. Suggested session duration in seconds,
  encoded as a decimal string.

gracePeriodSeconds
: OPTIONAL. Grace period for forced close in seconds,
  encoded as a decimal string (RECOMMENDED: 900, i.e.,
  15 minutes).

settlementInterval
: OPTIONAL. Minimum seconds between on-chain settlements,
  encoded as a decimal string. When present alongside
  `maxDebitPerInterval`, the escrow application enforces
  on-chain rate limiting: the server can settle at most
  `maxDebitPerInterval` base units per `settlementInterval`
  seconds. MUST be at least `"10"` (10 seconds, approx.
  3 Algorand blocks) when present. Clients set this value
  to control how fast the server can drain the deposit.

maxDebitPerInterval
: OPTIONAL. Maximum base units the server can settle per
  interval, encoded as a decimal string. MUST be present
  when `settlementInterval` is present; MUST be absent
  when `settlementInterval` is absent.

### New Channel Example

~~~json
{
  "amount": "25",
  "unitType": "token",
  "suggestedDeposit": "10000000",
  "currency": "ALGO",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "LLM inference API",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "appId": "123456789",
    "challengeReference": "f47ac10b-58cc-4372-a567-\
0e02b2c3d479",
    "lease": "xH7kQ2mN9vB4wP1jR6tY3cA8eF5gD0iL\
sU4oK7nM2bX=",
    "gracePeriodSeconds": "900"
  }
}
~~~

This requests a price of 25 microalgos per LLM token,
with a suggested deposit of 10 ALGO. The client generates
a random salt locally.

### Existing Channel Example

~~~json
{
  "amount": "25",
  "unitType": "token",
  "currency": "ALGO",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "appId": "123456789",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "challengeReference": "b2c3d4e5-f6a7-8901-bcde-\
f12345678901"
  }
}
~~~

For existing channels, `suggestedDeposit` is omitted since
the channel already has funds.

### ASA (USDC) with Fee Sponsorship Example

~~~json
{
  "amount": "100",
  "unitType": "request",
  "suggestedDeposit": "5000000",
  "currency": "USDC",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "Premium API access",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "appId": "123456789",
    "asaId": "31566704",
    "decimals": 6,
    "challengeReference": "a1b2c3d4-e5f6-7890-abcd-\
ef1234567890",
    "feePayer": true,
    "feePayerKey": "GH9ZWEMDLJ8DSCKNTKTQPBNWLNNBJUSZAG\
9VP2KGTKJR",
    "gracePeriodSeconds": "900",
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

This requests 0.0001 USDC per request for a USDC session
where the server pays transaction fees.

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
: REQUIRED. A JSON object containing the session-specific
  credential fields. The `action` field discriminates the
  type. Implementations MUST ignore unknown fields to
  allow forward-compatible extensions.

## Payload Actions

The `payload` object uses an `action` discriminator.
Four actions are defined:

| Action | Description |
|--------|-------------|
| `open` | Opens channel, begins session |
| `topUp` | Adds funds to existing channel |
| `voucher` | Submits updated cumulative voucher |
| `close` | Requests cooperative close |

## Action: "open" {#open-payload}

Opens a new payment channel and begins the session.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | REQUIRED | `"open"` |
| `channelId` | string | REQUIRED | Base32-encoded box name (52 characters) |
| `payer` | string | REQUIRED | Payer's Algorand address |
| `depositAmount` | string | REQUIRED | Initial deposit in base units |
| `paymentGroup` | array | REQUIRED | Base64-encoded msgpack transactions |
| `paymentIndex` | number | REQUIRED | Zero-based index of the deposit transfer in `paymentGroup` |
| `authorizedSigner` | string | OPTIONAL | Algorand address of delegated voucher signer |
| `settlementInterval` | string | OPTIONAL | Min seconds between settlements (decimal string) |
| `maxDebitPerInterval` | string | OPTIONAL | Max base units per interval (decimal string) |
| `expiresAt` | string | OPTIONAL | Session expiration (ISO 8601 / {{RFC3339}}) |
| `voucher` | object | REQUIRED | Signed initial voucher (see {{voucher-format}}) |

The `paymentGroup` contains the atomic group for the open
operation: an application call transaction invoking the
escrow's `open` method, a deposit transfer to the escrow
application account, and optionally a fee payer transaction.
Each element is base64-encoded (standard base64, {{RFC4648}}
Section 4) msgpack-serialized.

When `feePayer` is `true`, the client partially signs
(deposit transfer authority only) and leaves the fee payer
transaction unsigned. The server co-signs the fee payer
transaction before broadcasting --- same pattern as the
charge intent's fee sponsorship.

Servers MUST derive `payer`, `channelId`, `depositAmount`,
`authorizedSigner`, and all channel parameters from the
signed transaction and confirmed on-chain state. Servers
MUST NOT trust these values solely because they appear in
the HTTP payload.

Example (decoded):

~~~json
{
  "challenge": {
    "id": "kM9xPqWvT2nJrHsY4aDfEb",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "session",
    "request": "eyJ...",
    "expires": "2026-03-15T12:05:00Z"
  },
  "payload": {
    "action": "open",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "payer": "CLIENTADDRESS...",
    "depositAmount": "10000000",
    "paymentGroup": [
      "<base64 unsigned fee payer txn>",
      "<base64 signed app call txn>",
      "<base64 signed ALGO deposit txn>"
    ],
    "paymentIndex": 2,
    "voucher": {
      "voucher": {
        "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
        "cumulativeAmount": "0"
      },
      "signer": "CLIENTADDRESS...",
      "signature": "<base64 Ed25519 signature>"
    }
  }
}
~~~

## Action: "voucher" {#voucher-payload}

Submits a new voucher authorizing additional spend.
This action is entirely off-chain. No transaction is
broadcast.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | REQUIRED | `"voucher"` |
| `channelId` | string | REQUIRED | Existing channel identifier |
| `voucher` | object | REQUIRED | Signed voucher (see {{voucher-format}}) |

Example (decoded):

~~~json
{
  "challenge": {
    "id": "kM9xPqWvT2nJrHsY4aDfEb",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "session",
    "request": "eyJ...",
    "expires": "2026-03-15T12:05:00Z"
  },
  "payload": {
    "action": "voucher",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "voucher": {
      "voucher": {
        "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
        "cumulativeAmount": "250000"
      },
      "signer": "CLIENTADDRESS...",
      "signature": "<base64 Ed25519 signature>"
    }
  }
}
~~~

## Action: "topUp" {#topup-payload}

Adds funds to an existing channel.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | REQUIRED | `"topUp"` |
| `channelId` | string | REQUIRED | Existing channel identifier |
| `additionalAmount` | string | REQUIRED | Amount to add in base units |
| `paymentGroup` | array | REQUIRED | Base64-encoded msgpack transactions |
| `paymentIndex` | number | REQUIRED | Index of additional deposit transfer |

Example (decoded):

~~~json
{
  "challenge": {
    "id": "nX7kPqWvT2mJrHsY4aDfEb",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "session",
    "request": "eyJ...",
    "expires": "2026-03-15T12:10:00Z"
  },
  "payload": {
    "action": "topUp",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "additionalAmount": "5000000",
    "paymentGroup": [
      "<base64 unsigned fee payer txn>",
      "<base64 signed app call txn>",
      "<base64 signed deposit transfer txn>"
    ],
    "paymentIndex": 2
  }
}
~~~

## Action: "close" {#close-payload}

Requests cooperative close.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | REQUIRED | `"close"` |
| `channelId` | string | REQUIRED | Existing channel identifier |
| `voucher` | object | OPTIONAL | Final signed voucher (see {{voucher-format}}) |

If `voucher` is present, the server settles the final
delta on-chain and refunds the remainder atomically.
If the highest amount has already been settled on-chain,
the server MAY close without a new voucher.

Example (decoded):

~~~json
{
  "challenge": {
    "id": "pR8wN5vB2mQ7jT1tX9cA6e",
    "realm": "api.example.com",
    "method": "algorand",
    "intent": "session",
    "request": "eyJ...",
    "expires": "2026-03-15T12:15:00Z"
  },
  "payload": {
    "action": "close",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "voucher": {
      "voucher": {
        "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
        "cumulativeAmount": "500000"
      },
      "signer": "CLIENTADDRESS...",
      "signature": "<base64 Ed25519 signature>"
    }
  }
}
~~~

# Voucher Format {#voucher-format}

## Voucher Data

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channelId` | string | REQUIRED | Channel this voucher authorizes |
| `cumulativeAmount` | string | REQUIRED | Total authorized spend (base units) |
| `expiresAt` | string | OPTIONAL | Voucher expiration (ISO 8601 / {{RFC3339}}) |

All other channel context (payer, recipient, asset,
network, application, and signer policy) is established
by the on-chain channel state and the deterministic box
name derivation defined in {{channel-state}}. The voucher
only needs to identify the channel and authorize a
cumulative amount because the `channelId` is already
bound to that context. Implementations MUST NOT accept
vouchers for channels whose box name cannot be recomputed
from the channel parameters.

## Signed Voucher

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `voucher` | object | REQUIRED | Voucher data (above) |
| `signer` | string | REQUIRED | Algorand address of the voucher signer |
| `signature` | string | REQUIRED | Base64-encoded Ed25519 signature |

## Voucher Signing {#voucher-signing}

1. Serialize the voucher data object using JCS
   {{RFC8785}} to produce deterministic bytes.

2. Prepend the 4-byte prefix `MPPv` (ASCII:
   `0x4D505076`) as a domain separator. This prevents
   cross-protocol signature replay --- a voucher
   signature cannot be confused with an Algorand
   transaction signature (which uses the `TX` prefix)
   or any other Ed25519-signed message.

3. Sign the prefixed bytes using Ed25519 with the
   payer's keypair (or the delegated signer's keypair
   if the channel's `authorizedSigner` is set to a
   different key).

4. Encode the 64-byte Ed25519 signature as standard
   base64 ({{RFC4648}} Section 4).

~~~
message = "MPPv" || JCS(voucherData)
signature = Ed25519_Sign(signerPrivateKey, message)
encodedSignature = base64(signature)
~~~

## Voucher Verification {#voucher-verification}

The server MUST verify each voucher:

1. Deserialize and canonicalize the voucher data using
   JCS {{RFC8785}}.

2. Prepend the `MPPv` domain separator prefix.

3. Verify the Ed25519 signature against the `signer`
   public key. The public key is extracted from the
   Algorand address (first 32 bytes of the
   base32-decoded address, discarding the 4-byte
   checksum).

4. Verify the `signer` matches the channel's
   `authorizedSigner` (or `payer` if no delegation).

5. Verify `channelId` matches the active channel.

6. Verify `cumulativeAmount > acceptedCumulative`
   (cumulative increase), unless the submission is an
   idempotent retry handled per
   {{concurrency-and-idempotency}}.

7. Verify the channel is not finalized.

8. Verify `closeRequestedAt == 0`. Servers MUST reject
   new voucher acceptance on channels with a pending
   forced close unless the voucher is being used only
   to settle or cooperatively close the channel.

9. Verify `cumulativeAmount <= deposit` (does not
   exceed escrow balance).

10. If `expiresAt` is present, verify the voucher has
    not expired (with configurable clock skew
    tolerance, RECOMMENDED: 30 seconds).

11. Persist the new `acceptedCumulative` amount to
    durable storage BEFORE serving the resource.

## Cumulative Semantics

Vouchers specify cumulative totals, not incremental
deltas:

- Voucher #1: `cumulativeAmount = "100"` (authorizes
  100 total)
- Voucher #2: `cumulativeAmount = "250"` (authorizes
  250 total)
- Voucher #3: `cumulativeAmount = "400"` (authorizes
  400 total)

When settling, the application computes:
`delta = cumulativeAmount - settled`.

# Authorized Signer {#authorized-signer}

The `authorizedSigner` field in the channel box state
determines which Ed25519 key is permitted to sign
vouchers. Two authorization models are defined.

## Default: Payer Signs Directly

By default, the payer signs vouchers directly with the
same Ed25519 keypair that controls their Algorand
account. The `authorizedSigner` is set to the payer's
public key (or equivalently, the payer's address). This
matches the simplest channel model: the funding key is
also the voucher-signing key, and the deposit is the
hard cap enforced by the channel.

## Pre-Authorized Session {#pre-authorized-session}

In the pre-authorized model, the client signs a single
voucher at channel open with `cumulativeAmount` set to
the full deposit amount (or any cap the client is
comfortable with). This one-time signature pre-authorizes
the server to spend up to the authorized amount. No
further voucher signatures are required during the
session.

~~~
open voucher: cumulativeAmount = depositAmount
~~~

The server then:

1. Validates the initial voucher at open.
2. Deducts from `spentAmount` per request via the
   standard debit processing procedure.
3. If `available = acceptedCumulative - spentAmount`
   falls below the cost of the next request, the server
   returns 402 requesting a topUp.
4. Settles at close using the single pre-authorized
   voucher.

The client's risk is capped at the deposit amount. The
client authorized the full amount but the server only
settles actual consumption on-chain. This is analogous
to a pre-authorization hold on a payment card: the
maximum is reserved, but only actual usage is charged.

Pre-authorized sessions are the RECOMMENDED model for
most use cases because they:

- Require no additional client signatures after open
- Require no delegated key management
- Work with any wallet that can sign a single
  transaction group
- Minimize round-trips during streaming or metered
  service delivery
- Can be combined with on-chain settlement rate
  limiting (see {{rate-limit-enforcement}}) to cap
  the server's settlement rate without requiring
  additional client interaction

When the client wants to extend a session beyond the
initial deposit, they submit a `topUp` action with
additional funds and MAY sign a new voucher with a
higher `cumulativeAmount` covering the new total.

# Passkey-Enhanced Security {#passkey-security}

Both authorization models (Default and Pre-Authorized)
MAY be enhanced with FIDO2/WebAuthn {{WEBAUTHN}} passkey
authentication. Passkey enhancement is a client-side
security layer that gates access to the payer's Ed25519
signing key behind biometric or device authentication.
It does not change the wire format, credential schema,
or on-chain verification --- the server receives
identical Ed25519-signed vouchers regardless of whether
passkey authentication was used.

Because Algorand uses Ed25519 natively, passkeys can be
cryptographically bound to Algorand Ed25519 keypairs
without introducing additional signature curves.

## Attestation Binding

The binding between a passkey and an Algorand Ed25519
key is established during a FIDO2 attestation
(registration) ceremony:

1. The authentication service (relying party) issues a
   random challenge.

2. The user creates a passkey via the platform
   authenticator (biometric, device PIN, or security
   key).

3. Simultaneously, the user signs the SAME FIDO2
   challenge with their Algorand Ed25519 private key.

4. The credential is submitted with both:
   - The standard FIDO2 attestation response (proving
     passkey creation)
   - A custom WebAuthn extension containing the Ed25519
     signature and Algorand address (proving account
     ownership)

5. The authentication service validates both the FIDO2
   credential and the Ed25519 signature, then stores
   the binding: passkey credential to Algorand address
   to Ed25519 public key.

This proves that the entity who created the passkey
also controls the Algorand private key.

## Passkey with Default Model

When using passkeys with the Default authorization
model, the client authenticates via FIDO2 assertion
(biometric) before signing each voucher. This adds
per-voucher user consent to the incremental voucher
flow:

1. Client authenticates via passkey (biometric/PIN).
2. Client signs the voucher with the passkey-bound
   Ed25519 key.
3. Server receives a standard Ed25519-signed voucher.

## Passkey with Pre-Authorized Model

When using passkeys with the Pre-Authorized model,
the client authenticates via FIDO2 assertion once at
channel open before signing the single pre-authorization
voucher. This adds biometric consent to the deposit
authorization:

1. Client authenticates via passkey (biometric/PIN).
2. Client signs the open voucher
   (`cumulativeAmount = depositAmount`) with the
   passkey-bound Ed25519 key.
3. No further signatures or biometric prompts needed.

This combines the simplicity of pre-authorization
(one signature) with the security of passkey
authentication (biometric consent for the deposit).

## Passkey Voucher Signing Flow

~~~
  Client                FIDO2 Authenticator    Server
     |                        |                  |
     |  (1) Biometric prompt  |                  |
     |----------------------->|                  |
     |                        |                  |
     |  (2) Assertion OK      |                  |
     |<-----------------------|                  |
     |                        |                  |
     |  (3) Sign voucher with |                  |
     |      passkey-bound     |                  |
     |      Ed25519 key       |                  |
     |                        |                  |
     |  (4) Authorization:    |                  |
     |      Payment (voucher) |                  |
     |--------------------------------------->   |
     |                        |                  |
     |  (5) 200 OK + Receipt  |                  |
     |<---------------------------------------   |
~~~

Steps 1--3 happen entirely on the client. The server
receives a standard Ed25519-signed voucher at step 4
and verifies it identically to any other voucher.

## Wire Format Compatibility

Passkey enhancement requires no changes to the wire
format. The server cannot distinguish a passkey-gated
signature from any other Ed25519 signature at the
protocol level --- the passkey binding is a client-side
key management concern, not a wire format change.

## Authentication Service Independence

This specification does NOT prescribe a specific FIDO2
relying party implementation. The passkey attestation
and assertion ceremonies happen between the client and
an authentication service that is outside the scope of
the MPP session protocol. The session protocol only
requires that:

1. An Ed25519 key was bound to a passkey (established
   during attestation, outside session scope).
2. Vouchers are signed with that Ed25519 key using the
   standard signing procedure.

Different implementations MAY use different FIDO2
servers, different custom WebAuthn extension formats,
or different key storage strategies. The session
protocol is agnostic to all of these.

# Fee Sponsorship {#fee-sponsorship}

When `feePayer` is `true` in the challenge, the server
commits to paying Algorand transaction fees on behalf
of the client using Algorand's native fee pooling
mechanism.

## Fee Calculation

The required fee for each transaction is computed as:

~~~
required_fee = max(fee_per_byte * txn_size_in_bytes,
                   min_fee)
~~~

Under normal conditions, `fee_per_byte` equals `0`,
so `required_fee = min_fee` (typically 1000 microalgos).

## Fee Pooling

Algorand supports fee pooling within atomic groups: a
single transaction can cover fees for all transactions
by setting a sufficiently high fee value:

~~~
sum(fee[i] for i in group) >= sum(required_fee[i]
                                  for i in group)
~~~

## Server-Paid Fees

When `feePayer` is `true` for `open` or `topUp`:

1. **Client constructs group**: The client builds the
   application call and deposit transfer with `fee`
   set to `0` and `flatFee` set to `true`. The client
   includes an unsigned transaction from the server's
   `feePayerKey` address: a zero-amount ALGO payment
   (`type: pay`) to itself. The fee payer transaction
   MUST carry the entire pooled fee.

2. **Client signs payment transaction(s)**: The client
   signs only its own transaction(s) in the group. The
   fee payer transaction is left unsigned.

3. **Client sends credential**: The client sends the
   group (with the unsigned fee payer transaction) in
   the `paymentGroup` field.

4. **Server verifies and signs**: The server verifies
   the group contents (see {{fee-payer-verification}}),
   then signs the fee payer transaction with its fee
   payer key.

5. **Server broadcasts**: The fully signed group is
   broadcast to the Algorand network.

## Client-Paid Fees

When `feePayer` is `false` or omitted, the client MUST
set appropriate fees on its transaction(s) and fully sign
the entire group. The server broadcasts the group as-is.

## Server-Initiated Operations

The `settle` and `close` application methods are
server-originated. The server pays transaction fees for
these operations regardless of the `feePayer` setting:

- Voucher updates (`action="voucher"`) are off-chain and
  incur no transaction fees.
- Settlement and channel close are initiated by the
  server using the highest valid voucher.
- Servers MAY recover settlement costs through pricing.

## Fee Payer Transaction Verification {#fee-payer-verification}

When verifying the fee payer transaction, servers MUST
check:

1. The `snd` (sender) matches the server's `feePayerKey`.
2. The `type` is `pay` (ALGO payment).
3. The `amt` (amount) is absent or `0`.
4. The `rcv` (receiver) matches the `snd` (self-payment)
   OR is absent.
5. The `close` (close remainder to) field is absent.
6. The `rekey` (rekey to) field is absent.
7. The `fee` covers the group's pooled minimum. The fee
   MUST NOT exceed a server-configured maximum as a
   safety bound against fee griefing.
8. The transaction is unsigned.

# Server State Management

## Per-Channel State

The server MUST maintain the following state for each
open channel:

| Field | Description |
|-------|-------------|
| `channelId` | Channel box name (base32-encoded) |
| `status` | `"open"` or `"closed"` |
| `payer` | Payer Algorand address |
| `authorizedSigner` | Voucher signer address |
| `escrowedAmount` | Total deposited (from on-chain) |
| `acceptedCumulative` | Highest voucher amount accepted |
| `spentAmount` | Cumulative amount charged for delivered service |
| `settledOnChain` | Highest cumulative amount settled on-chain |
| `closeRequestedAt` | Pending forced-close timestamp, if any |

The available off-chain balance is computed as:

~~~
available = acceptedCumulative - spentAmount
~~~

The on-chain settlement watermark is distinct:

~~~
unsettled = spentAmount - settledOnChain
~~~

## Debit Processing

For each request on an open channel:

1. Compute `cost` from the challenged `amount`,
   `unitType`, and any implementation-specific metering
   policy.
2. Compute `available = acceptedCumulative - spentAmount`.
3. If `available < cost`: return 402 requesting a new
   voucher or topUp.
4. Persist `spentAmount += cost` BEFORE serving.
5. Serve the resource with a receipt.

## Partial Settlement

The server MAY call the channel application's settle
method at any time to claim accumulated funds without
closing the channel. This is useful for:

- Reducing counterparty risk on long-running sessions
- Freeing up server working capital
- Periodic reconciliation

After settlement, the channel box's `settled` field
reflects the claimed amount. The server MUST update
`settledOnChain` after confirmation and continues
accepting vouchers for amounts above the new settled
baseline.

## Crash Safety

Servers MUST persist metering state increments BEFORE
delivering the response. More precisely, servers MUST
persist both:

- `acceptedCumulative` BEFORE relying on new voucher
  balance; and
- `spentAmount` BEFORE or atomically with delivering
  the metered service.

Servers SHOULD use transactional storage or write-ahead
logging to ensure recovery after process or machine
crashes.

## Concurrency and Idempotency {#concurrency-and-idempotency}

Servers MUST serialize voucher acceptance and debit
processing per `channelId`. Voucher updates arriving
on different HTTP connections or multiplexed streams
MUST be processed atomically with respect to:

- `acceptedCumulative`;
- `spentAmount`; and
- `closeRequestedAt`.

Servers MUST treat voucher submissions idempotently:

- Resubmitting a voucher with the same
  `cumulativeAmount` as the highest accepted voucher
  MUST succeed and MUST NOT change channel state.
- Submitting a voucher with lower `cumulativeAmount`
  than the highest accepted voucher SHOULD return the
  current receipt state and MUST NOT reduce channel
  state.
- Clients MAY safely retry voucher submissions after
  network failures.

Clients SHOULD include an `Idempotency-Key` header on
metered HTTP requests. Servers SHOULD cache
`(challengeId, idempotencyKey)` pairs and MUST NOT
increment `spentAmount` twice for a duplicate idempotent
request.

# Settlement Procedure

## Open

1. Verify the `paymentGroup` contains 16 or fewer
   elements and that all transactions share the same
   Group ID.

2. Locate the application call transaction and verify
   it targets the expected escrow application (`appId`
   from the challenge).

3. Verify the application call invokes the `open` ABI
   method with correct parameters.

4. Locate the deposit transfer at `paymentIndex` and
   verify it transfers the declared `depositAmount` to
   the escrow application account:
   - For native ALGO: `type` is `pay`, `amt` matches
     `depositAmount`, `rcv` matches the escrow
     application account address.
   - For ASA: `type` is `axfer`, `aamt` matches
     `depositAmount`, `arcv` matches the escrow
     application account address, `xaid` matches
     `asaId`.

5. Verify no transaction in the group contains
   dangerous fields: `close`, `aclose`, or `rekey`
   MUST be absent on all transactions.

6. If the challenge included a `lease` value, verify
   the deposit transaction's `lx` field matches.

7. If `feePayer` is `true`, verify the fee payer
   transaction (see {{fee-payer-verification}}) and
   sign it with the server's fee payer key.

8. Recompute the expected box name from the
   transaction's payer, payee, asset, authorized
   signer, salt, and verify it equals the declared
   `channelId`.

9. Broadcast the fully signed group to the Algorand
   network.

10. Verify channel state on-chain after confirmation by
    reading the channel box from the escrow application:
    - `payer` matches the transaction signer
    - `payee` matches the challenged `recipient`
    - `assetId` matches the challenge currency
    - `deposit` matches `depositAmount`
    - `authorizedSigner` matches the open parameters
    - channel is not finalized
    - `closeRequestedAt == 0`

11. Verify the initial voucher against the confirmed
    channel state (see {{voucher-verification}}).

12. Create server-side channel state.

13. Return 200 with receipt.

## Voucher Update (No Settlement)

1. Verify voucher signature and monotonicity per
   {{voucher-verification}}.
2. Verify the channel is open and has no pending
   forced close.
3. Persist `acceptedCumulative`.
4. Debit `cost` from available balance by persisting
   `spentAmount`.
5. Return 200 with receipt.

## TopUp

1. Verify the `paymentGroup` structure, Group ID, and
   that the application call targets the expected
   escrow application invoking the `topUp` method.

2. Verify the additional deposit transfer at
   `paymentIndex`.

3. Verify no dangerous fields in the group.

4. If `feePayer` is `true`, verify and sign the fee
   payer transaction.

5. Broadcast the group.

6. Verify deposit increase on-chain by reading the
   updated channel box.

7. Increase `escrowedAmount` in server-side state.

8. If the application cleared `closeRequestedAt`,
   clear it in server-side state as well.

9. Return 204 with receipt.

## Close (Cooperative)

1. If a final voucher is provided and authorizes an
   amount above `settledOnChain`, verify it per
   {{voucher-verification}}.

2. The server calls the escrow application's `close`
   method, which atomically:
   - settles any final delta to the payee via inner
     transaction
   - refunds the remainder to the payer via inner
     transaction
   - marks the channel as finalized
   - deletes the channel box

3. Mark channel as `"closed"` in server-side state.

4. Persist final `settledOnChain` and terminal
   accounting state after confirmation.

5. Return 204 with receipt containing `txHash`.

## Forced Close (Client-Initiated)

If the server becomes unresponsive, the client can
force-close the channel:

1. Client calls `requestClose` on the escrow
   application.
2. Grace period begins (RECOMMENDED: 15 minutes).
3. During the grace period, the server MAY still
   call `settle` with the latest voucher.
4. After the grace period, the client calls `withdraw`
   to recover `deposit - settled`.

This ensures the client can always recover unspent
funds, even if the server disappears.

# Voucher Submission Transport

Voucher updates and top-up requests SHOULD be
submitted to the same resource URI that requires
payment. This allows session payment to compose with
arbitrary protected endpoints without a dedicated
payment control plane route.

Clients MAY use `HEAD` for voucher-only or top-up-only
requests when no response body is required. Servers
SHOULD support such requests where practical.

# Receipt Format

Receipts are returned in the `Payment-Receipt` header.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | REQUIRED | `"algorand"` |
| `intent` | string | REQUIRED | `"session"` |
| `reference` | string | REQUIRED | Channel identifier |
| `status` | string | REQUIRED | `"success"` |
| `timestamp` | string | REQUIRED | {{RFC3339}} timestamp |
| `acceptedCumulative` | string | REQUIRED | Highest voucher amount accepted |
| `spent` | string | REQUIRED | Total amount charged so far |

For close actions, the receipt MAY additionally include:

| Field | Type | Description |
|-------|------|-------------|
| `txHash` | string | Settlement transaction identifier (52-character base32 TxID) |
| `spent` | string | Total amount settled |
| `refunded` | string | Amount refunded to client |

Example receipt for a voucher update (decoded):

~~~json
{
  "method": "algorand",
  "intent": "session",
  "reference": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
  "status": "success",
  "timestamp": "2026-03-15T12:04:58Z",
  "acceptedCumulative": "250000",
  "spent": "200000"
}
~~~

Example receipt for a close action (decoded):

~~~json
{
  "method": "algorand",
  "intent": "session",
  "reference": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
  "status": "success",
  "timestamp": "2026-03-15T12:10:00Z",
  "txHash": "ABCDE6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7XYZ",
  "spent": "500000",
  "refunded": "9500000"
}
~~~

For streaming responses, servers SHOULD include the
receipt in the initial response headers and SHOULD emit
a final receipt when the stream completes. When balance
is exhausted mid-stream, servers SHOULD pause delivery
and request a higher voucher or top-up rather than
serving beyond the authorized balance.

# Error Responses

When rejecting a credential, the server MUST return HTTP
402 (Payment Required) with a fresh
`WWW-Authenticate: Payment` challenge per
{{I-D.httpauth-payment}}. The server SHOULD include a
response body conforming to {{RFC9457}} Problem Details.

The following problem types are defined under the
`https://paymentauth.org/problems/algorand/` namespace:

https://paymentauth.org/problems/algorand/malformed-credential
: HTTP 402. The credential token could not be decoded,
  the JSON could not be parsed, or required fields are
  absent or have the wrong type.

https://paymentauth.org/problems/algorand/unknown-challenge
: HTTP 402. The `credential.challenge.id` does not match
  any challenge issued by this server, or the challenge
  has already been consumed.

https://paymentauth.org/problems/algorand/group-invalid
: HTTP 402. The transaction group structure is invalid:
  too many transactions, mismatched Group IDs, or
  `paymentIndex` out of range.

https://paymentauth.org/problems/algorand/dangerous-transaction
: HTTP 402. The transaction group contains dangerous
  fields such as `close`, `aclose`, or `rekey`.

https://paymentauth.org/problems/algorand/app-mismatch
: HTTP 402. The application call does not target the
  expected escrow application or invokes an unexpected
  method.

https://paymentauth.org/problems/algorand/channel-not-found
: HTTP 402. No channel with the specified `channelId`
  exists in the escrow application.

https://paymentauth.org/problems/algorand/channel-finalized
: HTTP 402. The channel has already been closed and
  finalized.

https://paymentauth.org/problems/algorand/invalid-voucher-signature
: HTTP 402. The voucher Ed25519 signature could not be
  verified.

https://paymentauth.org/problems/algorand/signer-mismatch
: HTTP 402. The voucher signer does not match the
  channel's authorized signer.

https://paymentauth.org/problems/algorand/amount-exceeds-deposit
: HTTP 402. The voucher `cumulativeAmount` exceeds the
  channel's deposit.

https://paymentauth.org/problems/algorand/delta-too-small
: HTTP 402. The voucher amount increase is below the
  server's `minVoucherDelta`.

https://paymentauth.org/problems/algorand/insufficient-balance
: HTTP 402. The authorized balance (acceptedCumulative
  minus spentAmount) is insufficient for the requested
  service.

https://paymentauth.org/problems/algorand/close-pending
: HTTP 402. The channel has a pending forced close
  (`closeRequestedAt != 0`) and new vouchers are not
  accepted.

https://paymentauth.org/problems/algorand/transfer-mismatch
: HTTP 402. The deposit transfer does not match the
  challenge parameters (wrong amount, wrong recipient,
  wrong asset).

https://paymentauth.org/problems/algorand/rate-limit-exceeded
: HTTP 402. The settlement delta exceeds the on-chain
  rate limit for this channel. The server must wait for
  additional intervals to elapse before settling the
  requested amount.

https://paymentauth.org/problems/algorand/broadcast-failed
: HTTP 402. The transaction group was rejected by the
  Algorand network.

Example error response body:

~~~json
{
  "type": "https://paymentauth.org/problems/algorand/\
amount-exceeds-deposit",
  "title": "Amount Exceeds Deposit",
  "status": 402,
  "detail": "Voucher cumulative amount 15000000 exceeds \
channel deposit of 10000000"
}
~~~

# Security Considerations

## Transport Security

All communication MUST use TLS 1.2 or higher. Algorand
credentials MUST only be transmitted over HTTPS
connections.

## Escrow Safety

Funds are held by the channel application, not the
server. The server can only claim funds by presenting
valid Ed25519 voucher signatures to the application
via the `settle` or `close` methods. The client can
always recover unspent funds via forced close after
the grace period.

## Voucher Replay Protection

Vouchers are bound to a specific channel via
`channelId` and ordered by `cumulativeAmount`. A voucher
from one channel cannot be replayed in another.

The `MPPv` domain separator prefix prevents voucher
signatures from being confused with Algorand transaction
signatures (which use the `TX` prefix) or other
Ed25519-signed messages.

This replay protection depends on deterministic box
name derivation. The channel box name MUST be bound to
the escrow application ID and channel parameters so
that vouchers cannot be replayed across different
application deployments or different Algorand networks.

## Cumulative Amount Safety

Vouchers authorize cumulative totals (not deltas). A
compromised voucher only authorizes up to its stated
amount. The channel application enforces that
settlements never exceed the deposit.

## Grace Period Security

The grace period prevents a race condition where the
payer withdraws before the server can settle. Without
it, a malicious payer could use the service, then
immediately withdraw. The server has the grace period
to submit any outstanding vouchers.

TopUp cancels pending close requests, preventing a
grief attack where the payer requests close repeatedly
to disrupt the session.

Servers MUST stop accepting new service vouchers once
`closeRequestedAt` is set. During the grace period,
the server MAY use the latest previously accepted
voucher to settle or cooperatively close the channel,
but SHOULD NOT continue serving new metered content
unless the close request is cancelled by a confirmed
top-up.

## Pre-Authorized Session Risks

In the pre-authorized model, the client signs a single
voucher for the full deposit at channel open. The
client's risk is capped at the deposit amount. If the
server is malicious, it could settle the full deposit
without delivering commensurate service. Mitigations:

- **Settlement rate limiting** (RECOMMENDED): Clients
  SHOULD set `settlementInterval` and
  `maxDebitPerInterval` at channel open to enforce
  on-chain rate limiting. This prevents the server
  from settling the full deposit at once --- the escrow
  application drip-feeds funds at the client-specified
  rate. Combined with forced close, this ensures the
  client can always recover the majority of unspent
  funds even if the server acts maliciously. See
  {{rate-limit-enforcement}}.
- Clients SHOULD deposit only amounts they are
  willing to risk with the server.
- Clients SHOULD monitor receipts and close the
  channel if spending appears abnormal.
- The forced close mechanism ensures clients can
  always recover unspent funds after the grace period,
  even if the server becomes unresponsive.
- Servers SHOULD provide transparent metering data in
  receipts to build client trust.

## Passkey-Enhanced Security Considerations

When using FIDO2/WebAuthn passkeys to gate access to
the payer's Ed25519 signing key (see
{{passkey-security}}), the following additional security
considerations apply. These apply regardless of whether
the Default or Pre-Authorized authorization model is
used.

### Biometric Gating

With the Default model, each voucher signing operation
SHOULD be preceded by a FIDO2 assertion (biometric or
device PIN authentication), providing per-voucher user
consent. With the Pre-Authorized model, the FIDO2
assertion SHOULD be performed once at channel open
before signing the pre-authorization voucher.
Implementations MAY batch multiple vouchers per
assertion for performance, but SHOULD require
re-assertion after a configurable inactivity timeout.

### Authenticator-Level Key Protection

The passkey private key is managed by the FIDO2
authenticator (hardware security module, TPM, or secure
enclave) and never leaves the authenticator. The Ed25519
key bound to the passkey may be stored differently
depending on the implementation --- it may reside in the
authenticator, in a platform secure enclave, or in
software protected by the passkey authentication gate.
Implementations SHOULD store the bound Ed25519 private
key in the most secure storage available on the platform.

### Attestation Binding Integrity

The binding between the passkey and the Algorand Ed25519
key is established during the FIDO2 attestation ceremony.
Implementations MUST verify the Ed25519 signature over
the FIDO2 challenge during attestation to ensure the
binding is authentic. A compromised attestation service
could bind a passkey to a key the user does not control.

### Attestation Replay Prevention

The Ed25519 signature in the attestation binding is over
the FIDO2 challenge, which is a server-generated random
nonce. This prevents replay --- a signature from one
attestation ceremony cannot be reused in another. The
authentication service MUST generate a fresh challenge
for each attestation request.

### Cross-Origin Protection

FIDO2 passkeys are origin-bound {{WEBAUTHN}}. A passkey
created for one relying party cannot be used to
authenticate on a different origin. This prevents
phishing attacks where a malicious server tries to
obtain voucher signatures by impersonating the
legitimate authentication service.

### Credential Counter Validation

FIDO2 authenticators maintain a signature counter that
increments with each assertion. Implementations SHOULD
validate the counter to detect credential cloning. If
the counter value received is less than or equal to the
previously stored counter, the credential may have been
cloned and the assertion SHOULD be rejected.

### Deterministic Key Recovery

Algorand's ARC-52 {{ARC-52}} HD wallet specification
enables deterministic Ed25519 key derivation from a
24-word BIP39 mnemonic using BIP32-Ed25519 with
Peikert's amendment (g=9). Passkey-bound Ed25519 keys
MAY be HD-derived from the same root seed, allowing
users to regenerate their passkey-bound key from their
seed phrase and derivation path without depending on a
specific authenticator. This enhances self-sovereignty
while maintaining the passkey as the biometric
authentication gate.

## Settlement Rate Limit Enforcement {#rate-limit-enforcement}

When `settlementInterval` and `maxDebitPerInterval` are
set at channel open, the escrow application enforces
on-chain rate limiting on all `settle` and `close`
operations. This mechanism ensures neither party needs
to trust the other:

- **Client protection**: The server cannot settle the
  full deposit at once. Even with a pre-authorized
  voucher covering the entire deposit, the escrow
  application limits how much can be claimed per
  interval. If the client detects non-delivery, they
  call `requestClose` and recover unspent funds after
  the grace period. The maximum loss is bounded by
  `maxDebitPerInterval * (elapsed_time / settlementInterval)`
  plus whatever the server settles during the grace
  period.

- **Server protection**: The rate limit does not
  affect the server's ability to earn --- it only
  affects how fast funds move on-chain. The server
  can still deliver service and track debits
  off-chain at any rate. The rate limit controls
  settlement pace, not service delivery pace.

- **Withdraw is NOT rate-limited**: The client's
  `withdraw` call (after grace period expiration) is
  NOT subject to settlement rate limits. The client
  always recovers `deposit - settled` in full,
  regardless of rate limit settings.

### Rate Limit Parameter Selection

Clients SHOULD choose `settlementInterval` and
`maxDebitPerInterval` to match the expected consumption
rate with reasonable headroom:

~~~
maxDebitPerInterval >= amount * expected_units_per_interval
~~~

For example, an LLM API charging 25 microalgos per
token at ~100 tokens/second with a 10-second interval:

~~~
settlementInterval = 10
maxDebitPerInterval = 25 * 100 * 10 = 25000
~~~

This allows the server to settle up to 25,000 microalgos
(0.025 ALGO) every 10 seconds. Setting
`maxDebitPerInterval` too low may cause the server to
refuse the channel (insufficient settlement throughput
for the service model).

### Timestamp Granularity

Algorand block timestamps have approximately 3.3-second
granularity. The minimum recommended
`settlementInterval` is 10 seconds (~3 blocks) to
ensure meaningful time discrimination. Values below
4 seconds may not provide reliable rate limiting due to
block-time resolution.

### Server Rejection of Rate Limits

Servers MAY reject channel opens with rate limit
parameters that are too restrictive for their service
model. When rejecting, the server SHOULD return a 402
with a fresh challenge suggesting different parameters.

## Channel Application Trust

Clients MUST verify the `methodDetails.appId` in the
challenge matches a known, audited application before
depositing funds. A malicious server could specify an
application that steals deposits.

Clients SHOULD verify the application's approval and
clear programs match expected bytecode before
interacting with it.

## MBR and Channel Exhaustion

A malicious client could open many channels with small
deposits, consuming box storage and increasing the
escrow application's MBR. Mitigations:

- The MBR cost per channel (approximately 70,100
  microalgos) creates a natural economic barrier.
- Channel applications SHOULD require a minimum deposit
  that covers both the MBR and an economically useful
  service amount.
- Servers SHOULD enforce a minimum deposit in the
  challenge's `suggestedDeposit` and reject deposits
  below a configured threshold.

## Dangerous Transaction Fields

Algorand transactions support `close` (close remainder
to), `aclose` (asset close to), and `rekey` (rekey to)
fields that can cause irreversible loss of funds or
account control. Clients MUST NOT include these fields.
Servers MUST reject any transaction group containing
these fields.

## Rekeyed Account Authorization {#rekeyed-accounts}

Algorand accounts can be rekeyed, transferring signing
authority to a different key while retaining the same
address {{ALGORAND-REKEY}}. Servers verifying transaction
credentials MUST account for rekeyed accounts:

1. Check whether the sender account has been rekeyed by
   inspecting the account's `auth-addr` field. If
   rekeyed, the signature MUST be from the `auth-addr`
   key.

2. Reject fee payer transactions where the server's fee
   payer account has been unexpectedly rekeyed.

3. Clients whose accounts are rekeyed MUST sign with
   their current authorized key.

## Fee Payer Risks {#fee-payer-risks}

Servers acting as fee payers accept financial risk.
Mitigations:

- **Rate limiting**: per client address, per IP, or per
  time window.
- **Balance verification**: check the client's balance
  covers the deposit amount before signing.
- **Fee payer balance monitoring**: servers MUST monitor
  fee payer balance and reject new fee-sponsored
  requests when insufficient.
- **Fee payer transaction verification**: servers MUST
  verify the fee payer transaction is a zero-amount
  self-payment with reasonable fees and no dangerous
  fields (see {{fee-payer-verification}}).

## Clock Skew

Voucher expiration depends on timestamp comparison.
Servers MUST allow configurable clock skew tolerance
(RECOMMENDED: 30 seconds).

## RPC Trust

The server relies on its Algorand node (algod) to
provide accurate transaction and box data. A compromised
node could return fabricated data. Servers SHOULD use
trusted node providers or run their own nodes.

## Box Storage Security

The channel application MUST validate box ownership
before reading or modifying box contents. The
application MUST verify that the box name corresponds
to the claimed channel parameters by recomputing the
deterministic hash.

## Inner Transaction Safety

The channel application MUST validate all inner
transaction targets and amounts. Inner transactions
for settlement MUST only transfer funds to the
`payee` address stored in the channel box. Inner
transactions for refund MUST only transfer funds to
the `payer` address stored in the channel box.

## Denial of Service

To mitigate voucher flooding and channel griefing:

- servers SHOULD rate-limit voucher submissions per
  channel;
- servers SHOULD perform cheap format and monotonicity
  checks before expensive signature verification;
- servers MAY enforce a minimum voucher delta; and
- servers SHOULD refuse channels with prolonged
  inactivity or uneconomic deposit sizes.

## Algorand Address Verification

Algorand addresses include a 4-byte checksum appended
to the public key before base32 encoding. Implementations
MUST validate the checksum when processing addresses to
prevent payments to malformed addresses.

## Round Range Freshness

Algorand transactions include `firstValid` and
`lastValid` round numbers that define the validity
window. The difference MUST NOT exceed 1000 rounds.
When the server provides `suggestedParams`, clients
SHOULD verify the round range is plausible.

# IANA Considerations

## Payment Intent Registration

This document requests registration of the following
entry in the "HTTP Payment Intents" registry established
by {{I-D.httpauth-payment}}:

| Intent | Applicable Methods | Description | Reference |
|--------|-------------------|-------------|-----------|
| `session` | `algorand` | Metered Algorand payments via off-chain vouchers | This document |

--- back

# Channel Lifecycle

The following diagram illustrates the complete channel
lifecycle:

~~~
+-------------------------------------------------------+
|                     CHANNEL OPEN                       |
|     Client deposits via atomic group (app call +      |
|     payment/axfer). Box created with channel state.   |
+-------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------+
|                  SESSION PAYMENTS                      |
|      Client signs Ed25519 vouchers (off-chain).       |
|      Server provides service, deducts from balance.   |
|      Server may periodically settle() on-chain.       |
+-------------------------------------------------------+
                          |
            +-------------+-------------+
            v                           v
+-------------------------+  +--------------------------+
|   COOPERATIVE CLOSE     |  |      FORCED CLOSE        |
|  Server calls close()   |  | 1. Client calls          |
|   on escrow app.        |  |    requestClose()        |
|  Inner txns: settle     |  | 2. Wait grace period     |
|   delta + refund.       |  |    (15 min)              |
|  Box deleted.           |  | 3. Client calls          |
|                         |  |    withdraw()            |
+-------------------------+  +--------------------------+
            |                           |
            +-------------+-------------+
                          v
+-------------------------------------------------------+
|                   CHANNEL CLOSED                       |
|          Funds distributed. Box deleted.               |
|          MBR released to payer.                        |
+-------------------------------------------------------+
~~~

# Signature Schemes

Each top-level transaction in the `paymentGroup` MUST be
signed individually by the owner(s) of the sender
address. Algorand supports three signature types:

Ed25519 Single Signature (`sig`)
: A standard Ed25519 signature over the transaction's
  canonical msgpack encoding, prefixed with "TX".

Multisignature (`msig`)
: A `k-of-n` threshold multisignature scheme where `k`
  out of `n` authorized signers must sign.

Logic Signature (`lsig`)
: A signature verified by the AVM by executing a TEAL
  program {{ALGORAND-LSIG}}. Logic signatures enable
  contract-controlled accounts and delegated signing.

Servers MUST accept all three signature types when
verifying transaction groups.

# Gasless Transactions via Logic Signatures

Servers acting as fee payers MAY use logic signatures
{{ALGORAND-LSIG}} to enforce constraints on the fee
payer transaction programmatically. Instead of signing
with an Ed25519 key, the server provides a logic
signature program that validates:

- The transaction type is `pay`
- The amount is `0`
- The `close` and `rekey` fields are absent
- The fee is within acceptable bounds

This offloads malicious transaction detection from the
server's application layer to on-chain verification by
the AVM.

# Passkey-Enhanced Pre-Authorized Session Example

A complete ALGO session using passkey-enhanced security
with the pre-authorized model for LLM inference streaming.
The client authenticates via biometric once at open, signs
a single pre-authorization voucher, and the server meters
all subsequent requests without further signatures.

**1. Prerequisites (outside session protocol scope):**

The client has previously completed a FIDO2 attestation
ceremony binding a passkey to their Algorand Ed25519 key.
The authentication service stores the binding:

~~~
passkey credential ID -> Algorand address ->
  Ed25519 public key
~~~

**2. Challenge (402 response):**

The challenge is identical to a non-passkey session:

~~~http
HTTP/1.1 402 Payment Required
WWW-Authenticate: Payment id="pK7xBqWvR3nJsHtY5bEgFc",
  realm="api.llm-service.com",
  method="algorand",
  intent="session",
  request="eyJhbW91bnQiOiIyNSIsInVuaXRUeXBlIjoidG9rZW4i...",
  expires="2026-03-15T12:05:00Z"
Cache-Control: no-store
~~~

**3. Passkey authentication + pre-authorized open:**

The client authenticates via biometric (FIDO2 assertion),
then signs a single pre-authorization voucher for the
full deposit. The server receives a standard credential
--- indistinguishable from a non-passkey session.

~~~json
{
  "challenge": { "...": "echoed challenge" },
  "payload": {
    "action": "open",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "payer": "PAYERADDR...",
    "depositAmount": "10000000",
    "paymentGroup": [
      "<base64 unsigned fee payer txn>",
      "<base64 signed app call txn>",
      "<base64 signed ALGO deposit txn>"
    ],
    "paymentIndex": 2,
    "voucher": {
      "voucher": {
        "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427A\
CAVIPFNC6JHA5XNBQQHW7MWA",
        "cumulativeAmount": "10000000"
      },
      "signer": "PAYERADDR...",
      "signature": "<base64 Ed25519 signature>"
    }
  }
}
~~~

Note: `cumulativeAmount` equals `depositAmount` ---
this is the pre-authorized model. The biometric
authentication happened on the client before signing.
The server sees a standard Ed25519 voucher.

**4. Streaming without further signatures:**

No additional vouchers or biometric prompts are needed.
The server meters each request against the pre-authorized
balance.

**5. Close:**

No final voucher signature needed --- the server already
holds the pre-authorized voucher from open.

# Full Session Example

A complete ALGO session for LLM inference streaming.

**1. Challenge (402 response):**

~~~http
HTTP/1.1 402 Payment Required
WWW-Authenticate: Payment id="kM9xPqWvT2nJrHsY4aDfEb",
  realm="api.llm-service.com",
  method="algorand",
  intent="session",
  request="eyJhbW91bnQiOiIyNSIsInVuaXRUeXBlIjoidG9rZW4i...",
  expires="2026-03-15T12:05:00Z"
Cache-Control: no-store
~~~

Decoded `request`:

~~~json
{
  "amount": "25",
  "unitType": "token",
  "suggestedDeposit": "10000000",
  "currency": "ALGO",
  "recipient": "7XKXTG2CW87D97TXJSDPBD5JBKHETQA83TZRUJ\
OSGASU",
  "description": "LLM inference API",
  "methodDetails": {
    "network": "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYes\
N73ktiC1qzkkit8=",
    "appId": "123456789",
    "challengeReference": "f47ac10b-58cc-4372-a567-\
0e02b2c3d479",
    "feePayer": true,
    "feePayerKey": "GH9ZWEMDLJ8DSCKNTKTQPBNWLNNBJUSZAG\
9VP2KGTKJR",
    "gracePeriodSeconds": "900",
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

**2. Open credential:**

~~~http
GET /v1/chat/completions HTTP/1.1
Host: api.llm-service.com
Authorization: Payment <base64url-encoded credential>
~~~

Decoded credential:

~~~json
{
  "challenge": {
    "id": "kM9xPqWvT2nJrHsY4aDfEb",
    "realm": "api.llm-service.com",
    "method": "algorand",
    "intent": "session",
    "request": "eyJ...",
    "expires": "2026-03-15T12:05:00Z"
  },
  "payload": {
    "action": "open",
    "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427ACAVIPF\
NC6JHA5XNBQQHW7MWA",
    "payer": "CLIENTADDR...",
    "depositAmount": "10000000",
    "paymentGroup": [
      "<base64 unsigned fee payer pay txn>",
      "<base64 signed app call txn>",
      "<base64 signed ALGO deposit txn>"
    ],
    "paymentIndex": 2,
    "voucher": {
      "voucher": {
        "channelId": "NTRZR6HGMMZGYMJKUNVNLKLA427A\
CAVIPFNC6JHA5XNBQQHW7MWA",
        "cumulativeAmount": "0"
      },
      "signer": "CLIENTADDR...",
      "signature": "<base64 Ed25519 signature>"
    }
  }
}
~~~

**3. Response (streaming begins):**

~~~http
HTTP/1.1 200 OK
Payment-Receipt: <base64url-encoded receipt>
Content-Type: text/event-stream

data: {"token": "Hello"}
data: {"token": " world"}
...
~~~

**4. Voucher update (mid-stream):**

~~~http
HEAD /v1/chat/completions HTTP/1.1
Host: api.llm-service.com
Authorization: Payment <base64url credential with
  action="voucher", cumulativeAmount="5000">
~~~

**5. Close:**

~~~http
GET /v1/chat/completions HTTP/1.1
Host: api.llm-service.com
Authorization: Payment <base64url credential with
  action="close", final voucher>
~~~

~~~http
HTTP/1.1 204 No Content
Payment-Receipt: <base64url receipt with txHash,
  spent, refunded>
~~~

# Acknowledgements

The author thanks the Algorand Foundation, Algorand
Foundation CTO and engineering team,
Algorand developer community, the GoPlausible team, and
the MPP working group for their input on this
specification. The passkey integration design draws on
the Algorand ecosystem's established pattern of binding
FIDO2/WebAuthn credentials to Ed25519 keypairs via
custom WebAuthn extensions.
