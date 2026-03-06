# s402 Protocol Specification

> **Version:** 1 &middot; **Status:** Living Standard &middot; **Last Updated:** 2026-03-04

## Abstract

s402 is an HTTP-native payment protocol that enables machine-to-machine commerce using HTTP 402 (Payment Required) responses. An s402 server declares payment requirements; an s402 client constructs and signs a blockchain transaction satisfying those requirements; an optional facilitator verifies and broadcasts the transaction.

s402 is **chain-agnostic** at the wire level and supports five payment schemes: exact (one-shot), stream (per-second micropayments), escrow (time-locked trade), unlock (pay-to-decrypt via SEAL), and prepaid (deposit-based batching).

s402 is **wire-compatible with x402** (Coinbase). Any x402 client can pay an s402 server's exact scheme without modification.

## Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

Additional definitions:

| Term | Definition |
|------|-----------|
| **Resource Server** | The HTTP server protecting a resource behind a paywall. Returns 402 responses. |
| **Client** | The HTTP client (human wallet or AI agent) that pays for access. |
| **Facilitator** | An optional intermediary that verifies and broadcasts payment transactions. Non-custodial. |
| **Scheme** | A named payment mode (`exact`, `stream`, `escrow`, `unlock`, `prepaid`). |
| **Requirements** | The payment terms declared by the server in the 402 response. |
| **Payload** | The signed transaction sent by the client to satisfy requirements. |
| **Settlement** | Broadcasting the transaction on-chain and confirming finality. |

See the full [Glossary](/guide/glossary) for domain-specific terms.

---

## 1. Protocol Flow

### 1.1 Standard Flow (Two HTTP Round-Trips)

```
Client                    Resource Server              Facilitator
  |                            |                            |
  |── GET /resource ──────────>|                            |
  |<── 402 + payment-required ─|                            |
  |                            |                            |
  |  [build + sign transaction]                             |
  |                            |                            |
  |── GET /resource ──────────>|                            |
  |   + x-payment header       |── POST /s402/process ─────>|
  |                            |<── settle response ────────|
  |<── 200 + content ──────────|                            |
  |   + payment-response       |                            |
```

### 1.2 Client Decision Tree

```
receive HTTP response
├─ status != 402 → pass through (done)
├─ status == 402, no payment-required header → pass through (not s402)
└─ status == 402, has payment-required header
   ├─ decode requirements (Base64 JSON)
   ├─ detect protocol version
   │  ├─ has s402Version → s402
   │  ├─ has x402Version → x402 (normalize via fromX402Requirements)
   │  └─ neither → unknown (abort)
   ├─ select scheme (first match in server's accepts vs client's registered schemes)
   │  └─ no match → abort with SCHEME_NOT_SUPPORTED
   ├─ check expiresAt (if present)
   │  └─ expired → abort with REQUIREMENTS_EXPIRED (retryable: re-fetch)
   ├─ build + sign transaction for selected scheme
   ├─ encode payload as Base64 JSON
   ├─ retry original request with x-payment header
   ├─ check retry response
   │  ├─ status == 200 → success (done)
   │  ├─ status == 402, SAME requirements → settlement failed (abort)
   │  └─ status == 402, DIFFERENT requirements → re-evaluate (new price/terms)
   └─ if network error after payment sent → PAYMENT_SENT_RESPONSE_LOST
```

### 1.3 Server Decision Tree

```
receive HTTP request
├─ has x-payment header OR Content-Type: application/s402+json
│  ├─ decode payload
│  │  ├─ decode fails → 400 Bad Request
│  │  └─ decode succeeds
│  │     ├─ payload.scheme not in config.accepts → 400 (scheme not accepted)
│  │     ├─ processPayment handler exists
│  │     │  ├─ call processPayment(payload, requirements)
│  │     │  │  ├─ { success: true } → set payment-response header, proceed to 200
│  │     │  │  └─ { success: false } → 402 with error details
│  │     │  └─ exception → 400
│  │     └─ no processPayment handler → 402 (fail closed)
│  └─ (never grant access without successful settlement)
└─ no payment header
   └─ 402 with payment-required header
```

---

## 2. Wire Format

### 2.1 HTTP Headers

| Header | Direction | Content | Required |
|--------|-----------|---------|----------|
| `payment-required` | Server → Client | Base64-encoded JSON `PaymentRequirements` | MUST be present on 402 responses |
| `x-payment` | Client → Server | Base64-encoded JSON `PaymentPayload` | MUST be present on payment retry |
| `payment-response` | Server → Client | Base64-encoded JSON `SettleResponse` | SHOULD be present on 200 after payment |
| `x-stream-id` | Client → Server | StreamingMeter object ID (plain string) | MUST for stream scheme phase 2 |

All header names MUST be lowercase per HTTP/2 (RFC 9113 section 8.2.1).

### 2.2 Encoding

All headers use: `Base64(UTF8(JSON.stringify(object)))`.

- Encode: `btoa(new TextEncoder().encode(JSON.stringify(obj)))`
- Decode: `JSON.parse(new TextDecoder().decode(atob(headerValue)))`

Maximum encoded header size: **64 KB** (`MAX_HEADER_BYTES = 65536`). Payloads exceeding this MUST use body transport.

### 2.3 Dual Transport

| Transport | Content-Type | When to Use |
|-----------|-------------|-------------|
| **Header** (default) | N/A | Most payloads (RECOMMENDED for simplicity) |
| **Body** | `application/s402+json` | Large payloads, e.g., complex DeFi PTBs |

> **Note:** There is no enforced size threshold. Clients SHOULD use header transport by default and switch to body transport when Base64-encoded headers approach the 64 KB limit. In practice, payloads over ~8 KB are more reliably transmitted via body.

Detection order:
1. `Content-Type` contains `application/s402+json` → body transport
2. `x-payment` header present → header transport
3. Otherwise → unknown (not an s402 request)

### 2.4 Protocol Detection

To distinguish s402 from x402:
1. Decode the `payment-required` header
2. If decoded JSON has `s402Version` → s402
3. If decoded JSON has `x402Version` but no `s402Version` → x402
4. Otherwise → unknown

### 2.5 Key Stripping (Trust Boundary)

All decode functions MUST strip unknown keys from decoded objects. Only whitelisted keys survive decoding. The `extensions` field is an opaque bag — consumers MUST treat its contents as untrusted input.

---

## 3. Payment Requirements

The `payment-required` header carries a JSON object with the following fields.

### 3.1 Required Fields

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `s402Version` | `"1"` | Exactly the string `"1"` | Protocol version. |
| `accepts` | `string[]` | Non-empty array. Valid values: `"exact"`, `"stream"`, `"escrow"`, `"unlock"`, `"prepaid"`. | Schemes the server accepts. |
| `network` | `string` | Non-empty. No control characters. CAIP-2 format. | Target blockchain network (e.g., `"sui:testnet"`). |
| `asset` | `string` | Non-empty. No control characters. | Token identifier (e.g., `"0x2::sui::SUI"`). |
| `amount` | `string` | Non-negative integer: `/^(0\|[1-9][0-9]*)$/`. Within u64 range (0–18446744073709551615). | Payment amount in base units. |
| `payTo` | `string` | Non-empty. No control characters. | Recipient address. |

**Validation rules for `amount`:**
- MUST be a string, not a number (avoids floating-point precision loss)
- MUST NOT have leading zeros (except `"0"` itself)
- MUST NOT contain decimals, negatives, or whitespace
- `"0"` is valid (free access with receipt)

**Control character rejection** (applies to `network`, `asset`, `payTo`, `facilitatorUrl`, `protocolFeeAddress`):
- MUST NOT contain characters in range `[\x00-\x1f\x7f]`
- Prevents header injection attacks

### 3.2 Optional Fields

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `facilitatorUrl` | `string` | Valid URL. No control characters. | Where to send payment for verification + settlement. |
| `protocolFeeBps` | `number` | Integer, 0–10000. Not NaN or Infinity. | Fee in basis points (10000 = 100%). Advisory only. |
| `protocolFeeAddress` | `string` | Non-empty. No control characters. | Address receiving protocol fees. Advisory only. |
| `receiptRequired` | `boolean` | — | Whether server requires on-chain receipt NFT. |
| `settlementMode` | `"facilitator" \| "direct"` | — | Preferred settlement path. |
| `expiresAt` | `number` | Positive finite number. Unix timestamp in milliseconds. | Requirements expiry. Facilitator MUST reject after this time. |
| `mandate` | `object` | See section 3.3. | Mandate authorization requirements. |
| `stream` | `object` | See section 3.4. | Stream scheme parameters. |
| `escrow` | `object` | See section 3.5. | Escrow scheme parameters. |
| `unlock` | `object` | See section 3.6. | Unlock (SEAL) scheme parameters. |
| `prepaid` | `object` | See section 3.7. | Prepaid scheme parameters. |
| `extensions` | `Record<string, unknown>` | Opaque. MUST be treated as untrusted. | Vendor extensions (e.g., `gasStation`). |

### 3.3 Mandate Requirements

When present, declares that the server requires mandate authorization.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `required` | `boolean` | REQUIRED | Whether mandate is mandatory. |
| `minPerTx` | `string` | OPTIONAL | Minimum per-transaction cap the mandate MUST have. |
| `coinType` | `string` | OPTIONAL | Coin type the mandate MUST cover. |

### 3.4 Stream Requirements

MUST be present when `accepts` includes `"stream"`.

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `ratePerSecond` | `string` | REQUIRED | Non-negative integer string. | Payment rate in base units per second. |
| `budgetCap` | `string` | REQUIRED | Non-negative integer string. | Maximum total payout. |
| `minDeposit` | `string` | REQUIRED | Non-negative integer string. | Minimum initial deposit. |
| `streamSetupUrl` | `string` | OPTIONAL | — | URL for stream setup negotiation. |

### 3.5 Escrow Requirements

MUST be present when `accepts` includes `"escrow"`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `seller` | `string` | REQUIRED | Seller's address. |
| `arbiter` | `string` | OPTIONAL | Dispute arbiter address. |
| `deadlineMs` | `string` | REQUIRED | Escrow deadline (Unix timestamp ms). Non-negative integer string. |

### 3.6 Unlock Requirements (SEAL)

MUST be present when `accepts` includes `"unlock"`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `encryptionId` | `string` | REQUIRED | SEAL encryption key identifier. |
| `walrusBlobId` | `string` | REQUIRED | Walrus blob containing encrypted content. |
| `encryptionPackageId` | `string` | REQUIRED | Move package implementing SEAL policy. |

### 3.7 Prepaid Requirements

MUST be present when `accepts` includes `"prepaid"`.

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `ratePerCall` | `string` | REQUIRED | Non-negative integer string. | Cost per API call in base units. |
| `maxCalls` | `string` | OPTIONAL | — | Maximum calls. Omit for unlimited. |
| `minDeposit` | `string` | REQUIRED | Non-negative integer string. | Minimum deposit amount. |
| `withdrawalDelayMs` | `string` | REQUIRED | 60000–604800000 (1 min – 7 days). | Agent withdrawal delay. |
| `providerPubkey` | `string` | OPTIONAL | 32-byte Ed25519 public key, hex. | Provider's signing key for v0.2 receipts. |
| `disputeWindowMs` | `string` | OPTIONAL | 60000–86400000 (1 min – 24h). | Dispute window for v0.2 claims. |

**Pairing invariant:** `providerPubkey` and `disputeWindowMs` MUST both be present or both absent. Presence of either without the other is a validation error.

---

## 4. Payment Payload

The `x-payment` header carries a JSON object with the following fields.

### 4.1 Base Fields

| Field | Type | Required | Validation | Description |
|-------|------|----------|------------|-------------|
| `s402Version` | `"1"` | OPTIONAL | If present, MUST be `"1"`. | Protocol version echo. |
| `scheme` | `string` | REQUIRED | One of: `"exact"`, `"stream"`, `"escrow"`, `"unlock"`, `"prepaid"`. | Selected payment scheme. |
| `payload` | `object` | REQUIRED | Non-null object. | Scheme-specific signed transaction data. |

### 4.2 Inner Payload by Scheme

| Scheme | Required Inner Fields | Optional Inner Fields |
|--------|----------------------|----------------------|
| `exact` | `transaction` (Base64 BCS), `signature` (Base64) | — |
| `stream` | `transaction`, `signature` | — |
| `escrow` | `transaction`, `signature` | — |
| `unlock` | `transaction`, `signature`, `encryptionId` | — |
| `prepaid` | `transaction`, `signature`, `ratePerCall` | `maxCalls` |

- `transaction`: Base64-encoded BCS-serialized transaction bytes
- `signature`: Base64-encoded cryptographic signature over the transaction
- Only whitelisted keys per scheme survive decoding

---

## 5. Settlement Response

Returned by the facilitator after settlement. Sent to the client in the `payment-response` header.

### 5.1 Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | `boolean` | REQUIRED | Whether settlement succeeded. |
| `txDigest` | `string` | OPTIONAL | On-chain transaction identifier. |
| `receiptId` | `string` | OPTIONAL | On-chain receipt object ID. |
| `finalityMs` | `number` | OPTIONAL | Time to finality in milliseconds. |
| `streamId` | `string` | OPTIONAL | StreamingMeter object ID (stream scheme). |
| `escrowId` | `string` | OPTIONAL | Escrow object ID (escrow scheme). |
| `balanceId` | `string` | OPTIONAL | PrepaidBalance object ID (prepaid scheme). |
| `error` | `string` | OPTIONAL | Human-readable error message. |
| `errorCode` | `string` | OPTIONAL | Machine-readable error code (see section 8). |

---

## 6. Payment Schemes

### 6.1 Exact (One-Shot Payment)

The simplest scheme. One payment per request. Settlement is atomic.

**Client MUST:**
1. Build a transaction transferring `amount` of `asset` to `payTo`
2. If `protocolFeeBps > 0` AND `protocolFeeAddress` is set AND `protocolFeeAddress !== payTo`:
   - Calculate `fee = floor(amount * protocolFeeBps / 10000)`
   - Transfer `amount - fee` to `payTo`
   - Transfer `fee` to `protocolFeeAddress`
3. If `protocolFeeAddress === payTo` OR `protocolFeeAddress` is absent:
   - Transfer full `amount` to `payTo`
4. Sign the transaction
5. Set `scheme: "exact"` in payload

**Facilitator MUST verify:**
1. Transaction signature is valid (dry-run simulation succeeds)
2. Simulation status is `"success"`
3. Balance changes show:
   - **No fee split**: recipient received `>= amount` of correct asset
   - **Fee split** (protocolFeeAddress set and differs from payTo): merchant received `>= amount - fee` AND fee address received `>= fee`

**Facilitator MUST settle:**
1. Re-verify (defense against TOCTOU attacks)
2. Broadcast transaction
3. Wait for finality confirmation
4. Return `txDigest`

### 6.2 Stream (Per-Second Micropayments)

Two-phase protocol. Phase 1 creates the stream; phase 2 uses it.

**Phase 1 — Stream Creation:**
1. Client receives 402 with `stream` requirements
2. Client builds transaction creating a StreamingMeter on-chain
3. Client sends payload via `x-payment`
4. Facilitator verifies `StreamCreated` event:
   - Package ID MUST match expected deployment (anti-spoofing)
   - `token_type`, `payer`, `recipient` match requirements
   - `deposit >= minDeposit`
   - `rate_per_second` exact match
   - `budget_cap >= budgetCap` from requirements
5. Returns `streamId`

**Phase 2 — Subsequent Requests:**
1. Client sends requests with `x-stream-id` header (plain string, not Base64)
2. Server reads on-chain StreamingMeter state to verify sufficient balance
3. Server grants access

### 6.3 Escrow (Time-Locked Trustless Trade)

**State machine:**

```
             create()
               │
               ▼
         ┌──────────┐
    ┌────│  ACTIVE   │────┐
    │    └──────────┘    │
    │         │          │
dispute()  release()  deadline passes
    │         │          │
    ▼         ▼          ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ DISPUTED │  │ RELEASED │  │ REFUNDED │
└──────────┘  └──────────┘  └──────────┘
    │                        (permissionless)
    │
arbiter calls
release() or refund()
    │
    ▼
┌──────────┐
│ RELEASED │
│ or       │
│ REFUNDED │
└──────────┘
```

**Key behavioral rules:**
- `release()` has NO deadline check — buyer can release at any time (buyer satisfaction has no expiry)
- `dispute()` MUST be called before deadline (`clock_ms < deadline_ms`)
- After deadline with no dispute: anyone MAY call `refund()` (permissionless exit)
- Arbiter MUST NOT be the buyer or seller

**Facilitator MUST verify:**
1. `EscrowCreated` event with correct package ID
2. `token_type`, `buyer` (= signer), `seller`, `amount`, `deadline_ms` match requirements
3. `fee_micro_pct` matches (converted from bps: `bps * 100 = micro-percent`)
4. Arbiter matches if specified

### 6.4 Unlock (Pay-to-Decrypt via SEAL)

> **Naming:** The wire protocol scheme value is `"unlock"`. The human-facing name is "SEAL" (Sui Encryption Abstraction Layer). Use `"unlock"` in code and `accepts` arrays; use "SEAL" in documentation and UI.

Composite scheme: escrow creation + SEAL key release.

1. Client creates escrow (same as section 6.3)
2. Facilitator settles escrow, returns `escrowId`
3. Client presents receipt to SEAL key servers
4. Key servers verify on-chain receipt via `seal_approve()` (dry-run)
5. Key servers release decryption key
6. Client decrypts content from Walrus blob

**CRITICAL constraint:** `seal_approve()` MUST NEVER check `ctx.sender()`. Access follows receipt ownership (bearer model). See [ADR-005](/adr/005-permissive-access-receipt-transferability).

### 6.5 Prepaid (Deposit-Based Batching)

**Two versions:**

| | v0.1 (Economic Security) | v0.2 (Cryptographic Security) |
|---|---|---|
| **Trust model** | Provider self-reports call count | Provider signs receipts per-call |
| **Detection** | `providerPubkey` absent | `providerPubkey` present |
| **Dispute** | None | On-chain fraud proof |

**Client MUST:**
1. Build transaction creating PrepaidBalance on-chain
2. Deposit `>= minDeposit`
3. Include `ratePerCall` in payload (MUST exact-match requirements)
4. If requirements specify `maxCalls`, include it (MUST match)

**Server MUST (v0.2):**
1. Issue `X-S402-Receipt` header with every API response
2. Receipt format: `v2:base64(sig):callNumber:timestampMs:base64(responseHash)`
3. `callNumber` MUST be sequential (1-indexed) and strictly increasing
4. Sign: `Ed25519(balanceId || callNumber || timestampMs || responseHash)` using BCS encoding

**Facilitator MUST verify:**
1. `PrepaidDeposited` event with correct package ID
2. `token_type`, `agent` (= signer), `provider` (= payTo), `amount >= minDeposit`
3. `ratePerCall` matches between payload and requirements
4. v0.2: validate `providerPubkey` format (32-byte hex)

---

## 7. Verification Protocol

Verification uses **dry-run simulation**: the facilitator submits the signed transaction to a blockchain node in simulation mode to predict its effects without broadcasting.

### 7.1 Verification Steps (All Schemes)

1. Decode transaction bytes from Base64
2. Extract signer address from signature
3. Submit to RPC node for dry-run simulation
4. Check simulation `status === "success"`
5. Extract relevant events (scheme-specific)
6. Verify event fields match requirements
7. Verify event package ID matches expected deployment (anti-spoofing)

### 7.2 Event Anti-Spoofing

On mainnet, a facilitator scheme MUST be constructed with the expected `packageId`. Events from other packages MUST be rejected. This prevents an attacker from deploying a fake contract that emits matching events but does not actually transfer funds.

On testnet, this check MAY be relaxed if no `packageId` is provided.

### 7.3 Balance-Change Verification (Exact Scheme)

Two branches:

```
IF protocolFeeBps > 0
   AND protocolFeeAddress is set
   AND protocolFeeAddress !== payTo
THEN
   // Fee split mode
   fee = floor(amount * protocolFeeBps / 10000)
   merchantAmount = amount - fee
   VERIFY: payTo received >= merchantAmount of asset
   VERIFY: protocolFeeAddress received >= fee of asset
ELSE
   // No fee split (merged balance change)
   VERIFY: payTo received >= amount of asset
```

**Why two branches?** When `protocolFeeAddress === payTo`, Sui merges balance changes into one entry. Checking merchant + fee separately would fail because there's only one balance change entry.

---

## 8. Error Codes

Each error code specifies whether the condition is retryable.

| Code | Retryable | Meaning | Suggested Action |
|------|-----------|---------|------------------|
| `INSUFFICIENT_BALANCE` | no | Wallet lacks funds | Top up wallet or reduce amount |
| `MANDATE_EXPIRED` | no | Mandate past expiry | Request new mandate from delegator |
| `MANDATE_LIMIT_EXCEEDED` | no | Per-tx or lifetime cap hit | Request mandate increase |
| `STREAM_DEPLETED` | yes | Stream balance exhausted | Top up stream deposit |
| `ESCROW_DEADLINE_PASSED` | no | Escrow deadline expired | Create new escrow |
| `UNLOCK_DECRYPTION_FAILED` | yes | SEAL key release failed | Retry with fresh session key |
| `FINALITY_TIMEOUT` | yes | TX submitted, not confirmed | Retry finality check |
| `FACILITATOR_UNAVAILABLE` | yes | Facilitator unreachable | Fall back to direct settlement |
| `INVALID_PAYLOAD` | no | Payload format error | Check format, re-sign |
| `SCHEME_NOT_SUPPORTED` | no | Scheme not registered | Use `"exact"` (always supported) |
| `NETWORK_MISMATCH` | no | Client/server network differs | Match network config |
| `SIGNATURE_INVALID` | no | Bad signature | Re-sign with correct keypair |
| `REQUIREMENTS_EXPIRED` | yes | `expiresAt` passed | Re-fetch requirements |
| `VERIFICATION_FAILED` | no | Dry-run rejected TX | Check amount and TX structure |
| `SETTLEMENT_FAILED` | yes | RPC broadcast failure | Retry after delay |

**Client-side scenario (not an error code):**

`PAYMENT_SENT_RESPONSE_LOST` — The client successfully sent a signed payment but the HTTP response was lost (network error). The payment MAY have been settled on-chain. The client SHOULD check on-chain state (via `txDigest` or balance query) before re-attempting payment. This is not a formal error code but a client behavioral state.

**Client retry logic:**
- `retryable: true` → MAY retry (RECOMMENDED: exponential backoff, max 3 attempts)
- `retryable: false` → MUST NOT retry with same parameters

---

## 9. Discovery

### 9.1 Resource Server Discovery

**Endpoint:** `GET /.well-known/s402.json`

```typescript
{
  s402Version: "1",            // REQUIRED
  schemes: string[],           // REQUIRED — supported schemes
  networks: string[],          // REQUIRED — CAIP-2 network IDs
  assets: string[],            // REQUIRED — accepted token types
  directSettlement: boolean,   // REQUIRED — supports direct settlement?
  mandateSupport: boolean,     // REQUIRED — supports mandates?
  protocolFeeMicroPercent: number  // OPTIONAL — fee in micro-percent
}
```

### 9.2 Facilitator Discovery

**Endpoint:** `GET /.well-known/s402-facilitator`

```typescript
{
  version: "1",
  feeMicroPercent: number,         // Fee in micro-percent (1000000 = 100%)
  feeRecipient: string | null,     // Fee recipient address
  minFeeUsd: string,               // Minimum fee in USD
  supportedSchemes: string[],      // Schemes this facilitator handles
  supportedNetworks: string[],     // CAIP-2 networks
  validUntil: string               // ISO 8601 timestamp (rolling 30-day window)
}
```

### 9.3 Provider Key Verification (Prepaid v0.2)

**Endpoint:** `POST /.well-known/s402-key-proof`

Challenge-response to verify provider controls their advertised Ed25519 key.

- **Request:** `Content-Type: application/octet-stream`, body = 64 bytes: 32-byte nonce + 32-byte public key
- **Response:** 64-byte Ed25519 signature over the challenge
- Client MUST verify this signature before depositing into a v0.2 PrepaidBalance

---

## 10. Facilitator API

### 10.1 Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Returns `{ status: "ok", timestamp }` |
| `/supported` | GET | No | Capability query: networks + schemes |
| `/.well-known/s402-facilitator` | GET | No | Facilitator identity + fee info |
| `/.well-known/s402.json` | GET | No | Resource server discovery |
| `/verify` | POST | API key | Dry-run verification only |
| `/settle` | POST | API key | Broadcast + wait for finality |
| `/s402/process` | POST | API key | Atomic verify + settle (RECOMMENDED) |
| `/settlements` | GET | API key | Per-key settlement history |

### 10.2 Request Body (verify, settle, process)

```typescript
{
  paymentPayload: {
    scheme: string,         // REQUIRED — valid scheme
    payload: {
      transaction: string,  // REQUIRED — Base64 BCS
      signature: string     // REQUIRED — Base64
    }
  },
  paymentRequirements: {
    network: string,        // REQUIRED — non-empty
    amount: string,         // REQUIRED — valid non-negative integer string
    payTo: string           // REQUIRED — valid address
    // ... other requirements fields
  }
}
```

### 10.3 Process Behavioral Requirements

The `/s402/process` endpoint (atomic verify + settle) MUST:

1. Check `expiresAt` before AND after verification (double-check prevents TOCTOU)
2. Reject if `payload.scheme` is not in `requirements.accepts`
3. Track in-flight requests — reject concurrent duplicate payloads
4. Apply verification timeout: 5 seconds
5. Apply settlement timeout: 15 seconds
6. Never throw uncaught exceptions — always return `SettleResponse`

### 10.4 Idempotent Dedup

If a client retries after a network timeout, the facilitator SHOULD return the cached successful response with `X-Idempotent-Replay: true` instead of re-executing.

- Dedup key: `SHA-256(apiKey + canonicalBody)`
- API key MUST be included in key (prevents cross-tenant cache collisions)
- TTL: 60 seconds
- Applies to `/settle` and `/s402/process`

---

## 11. Fee System

### 11.1 Units

| Context | Unit | Denominator | Example |
|---------|------|-------------|---------|
| Wire format (s402) | Basis points (bps) | 10,000 = 100% | `500` = 5% |
| On-chain (Move) | Micro-percent | 1,000,000 = 100% | `50000` = 5% |

**Conversion:** `microPercent = bps * 100`

### 11.2 Calculation

```
fee = floor(amount * feeMicroPercent / 1000000)
net = amount - fee
```

- All intermediate arithmetic MUST use u128 to prevent overflow
- Division MUST truncate toward zero (floor rounding)
- Invariant: `fee + net <= amount` (remainder stays with payer)

### 11.3 Trust Model

The **facilitator** owns the authoritative fee configuration. The `protocolFeeBps` in requirements is advisory (transparency hint for the client). The on-chain contract enforces the fee set at deployment time.

---

## 12. x402 Compatibility

s402 is wire-compatible with x402 (Coinbase).

### 12.1 Server Compatibility

An s402 server MUST always include `"exact"` in its `accepts` array. This ensures x402 clients (which only support exact) can interact.

### 12.2 Client Compatibility

An s402 client SHOULD auto-detect the protocol version:
1. Decode `payment-required` header
2. If `s402Version` present → s402 (native handling)
3. If `x402Version` present → normalize via `normalizeRequirements()`
4. Normalized requirements use s402 field names and validation

### 12.3 Field Mapping

| x402 Field | s402 Equivalent | Notes |
|------------|----------------|-------|
| `x402Version` | `s402Version` | Different version numbering |
| `maxAmountRequired` | `amount` | x402 V1 legacy name |
| `scheme` | `accepts[0]` | x402 has single scheme; s402 has array |
| `resource` | (not mapped) | x402-specific |
| `description` | (not mapped) | x402-specific |

---

## 13. Gas Sponsorship

An optional extension allowing the facilitator to pay gas fees on behalf of clients.

### 13.1 Discovery

Gas station info is published in `requirements.extensions`:

```typescript
extensions: {
  gasStation: {
    sponsorAddress: string,  // Facilitator's gas-paying address
    maxBudget?: string       // Maximum gas budget (in base units)
  }
}
```

### 13.2 Client Behavior

If `gasStation` is present in requirements extensions:
1. Set `tx.setGasOwner(sponsorAddress)` on the transaction
2. If `maxBudget` is provided, set `tx.setGasBudget(maxBudget)`
3. Sign with client key only (facilitator co-signs during settlement)

### 13.3 Facilitator Behavior

During settlement:
1. Inspect `tx.gasData.owner`
2. If owner matches facilitator's sponsor address:
   - Validate gas budget: MUST NOT be zero, MUST NOT exceed `maxSponsorGasBudget`
   - Co-sign transaction as gas sponsor
   - Execute with dual signatures: `[clientSignature, sponsorSignature]`
3. If owner does not match: execute with client signature only (standard flow)

---

## 14. Mandate Integration

Mandates are on-chain spending authorizations from a human delegator to an AI agent.

### 14.1 Client Behavior

```
IF requirements.mandate?.required === true
   AND client has mandateConfig (mandateId, registryId, packageId)
THEN
   prepend validate_and_spend MoveCall to transaction
   (mandate check happens BEFORE payment in same PTB)
ELSE IF requirements.mandate?.required === true
   AND client has NO mandateConfig
THEN
   throw error (do NOT retry — mandate issue won't resolve by retrying)
ELSE
   build transaction without mandate check (standard flow)
```

### 14.2 Error Handling

Mandate-related errors MUST NOT trigger payment retry:
- `MANDATE_EXPIRED` → client needs new mandate
- `MANDATE_LIMIT_EXCEEDED` → client needs mandate increase
- Move abort codes 402 (`EPerTxLimitExceeded`), 403 (`ETotalLimitExceeded`) → same

---

## 15. Security Considerations

### 15.1 Transport Security

All s402 communication MUST use HTTPS. Payment data in headers is Base64-encoded but NOT encrypted. TLS provides confidentiality.

### 15.2 Requirements Expiration

Servers SHOULD set `expiresAt` on payment requirements. Facilitators MUST reject expired requirements. This prevents replay attacks where an attacker captures a valid payment and replays it after price changes.

### 15.3 Event Origin Verification

On mainnet, facilitator scheme implementations MUST verify that on-chain events originate from the expected package ID. Without this check, an attacker could deploy a contract that emits fake payment events.

### 15.4 Finality Confirmation

Both direct settlement and facilitator schemes MUST call `waitForTransaction()` before returning `success: true`. Returning success before finality risks the transaction being reverted.

### 15.5 Double-Spend Prevention

The facilitator's `/s402/process` endpoint tracks in-flight transactions. Concurrent identical payloads are rejected. This prevents double-spend where the same signed transaction is submitted simultaneously to multiple facilitator instances.

### 15.6 TOCTOU Defense

The facilitator's `settle()` function re-runs `verify()` before broadcasting. This defends against time-of-check-time-of-use attacks where on-chain state changes between verification and settlement.

---

## 16. Receipt Wire Format (Prepaid v0.2)

### 16.1 Header

`X-S402-Receipt: v2:{base64Signature}:{callNumber}:{timestampMs}:{base64ResponseHash}`

### 16.2 Fields

| Part | Format | Validation |
|------|--------|------------|
| Version | `"v2"` | Exactly `"v2"` |
| Signature | Base64 | 64-byte Ed25519 signature |
| Call Number | Decimal integer | `> 0`, sequential, 1-indexed |
| Timestamp | Decimal integer | `> 0`, Unix milliseconds |
| Response Hash | Base64 | SHA-256 of response body (32 bytes) |

### 16.3 Signature Message

BCS-encoded concatenation: `balanceId (address) || callNumber (u64) || timestampMs (u64) || responseHash (vector<u8>)`

- Address: 32 bytes from hex (no BCS length prefix — fixed-size in BCS)
- u64: 8 bytes little-endian via `DataView.setBigUint64(0, value, true)`
- vector: ULEB128 length prefix + raw bytes

---

## Appendix A: Type Reference (TypeScript)

```typescript
// Protocol version
const S402_VERSION = "1";

// Scheme union
type s402Scheme = "exact" | "stream" | "escrow" | "unlock" | "prepaid";

// Settlement mode
type s402SettlementMode = "facilitator" | "direct";

// Core interfaces
interface s402PaymentRequirements {
  s402Version: "1";
  accepts: s402Scheme[];
  network: string;     // CAIP-2
  asset: string;
  amount: string;      // Non-negative integer string
  payTo: string;
  facilitatorUrl?: string;
  protocolFeeBps?: number;
  protocolFeeAddress?: string;
  receiptRequired?: boolean;
  settlementMode?: s402SettlementMode;
  expiresAt?: number;
  mandate?: s402MandateRequirements;
  stream?: s402StreamExtra;
  escrow?: s402EscrowExtra;
  unlock?: s402UnlockExtra;
  prepaid?: s402PrepaidExtra;
  extensions?: Record<string, unknown>;
}

interface s402PaymentPayload {
  s402Version?: "1";
  scheme: s402Scheme;
  payload: {
    transaction: string;    // Base64 BCS
    signature: string;      // Base64
    [key: string]: unknown; // Scheme-specific fields
  };
}

interface s402SettleResponse {
  success: boolean;
  txDigest?: string;
  receiptId?: string;
  finalityMs?: number;
  streamId?: string;
  escrowId?: string;
  balanceId?: string;
  error?: string;
  errorCode?: string;
}

interface s402VerifyResponse {
  valid: boolean;
  invalidReason?: string;
  payerAddress?: string;
}
```

## Appendix B: Scheme Interface Contracts

Implementors extending s402 to new chains MUST implement these interfaces:

```typescript
// Client-side: build + sign payment
interface s402ClientScheme {
  readonly scheme: s402Scheme;
  createPayment(requirements: s402PaymentRequirements): Promise<s402PaymentPayload>;
}

// Server-side: build requirements for a route
interface s402ServerScheme {
  readonly scheme: s402Scheme;
  buildRequirements(config: s402RouteConfig): s402PaymentRequirements;
}

// Facilitator-side: verify + settle
interface s402FacilitatorScheme {
  readonly scheme: s402Scheme;
  verify(payload: s402PaymentPayload, requirements: s402PaymentRequirements): Promise<s402VerifyResponse>;
  settle(payload: s402PaymentPayload, requirements: s402PaymentRequirements): Promise<s402SettleResponse>;
}

// Self-sovereign: no facilitator
interface s402DirectScheme {
  readonly scheme: s402Scheme;
  settleDirectly(requirements: s402PaymentRequirements): Promise<s402SettleResponse>;
}
```
