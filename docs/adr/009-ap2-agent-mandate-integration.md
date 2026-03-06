# ADR-009: AP2 Agent Mandate Integration Strategy

**Status:** Proposed
**Date:** 2026-02-28
**Authors:** Danny, Claude (research session)

## Context

Google's AP2 (Agent Payments Protocol) launched Sept 2025 with 60+ partners including **Mysten Labs**, Mastercard, PayPal, Coinbase, and Adyen. AP2 defines how AI agents receive spending authorization from humans via cryptographically signed "mandates."

SweeFi already implements agent mandates on-chain via `mandate.move` and `agent_mandate.move` — predating AP2's spec by months. The mandate concepts are structurally similar but operate at different layers:

- **AP2**: Off-chain authorization (JSON, hardware-backed signatures, traditional payment rails)
- **SweeFi**: On-chain enforcement (Move objects, PTB atomicity, Sui consensus)

This ADR defines how SweeFi integrates with AP2 to become the **Sui-native settlement rail** for AP2-authorized agent payments.

## AP2 Spec Analysis (V0.1, Feb 2026)

### Three Mandate Types

1. **Cart Mandate** — Human-present. User approves exact cart. Merchant co-signs commitment to fulfill. Fields: cart ID, payer/payee identity, payment method (tokenized), amount, currency, refund conditions.

2. **Intent Mandate** — Human-NOT-present. User pre-authorizes agent within constraints. Contains "Prompt Playback" (agent's NL understanding of user intent). Has TTL expiry. Signed via hardware-backed device key.

3. **Payment Mandate** — Bridges authorization to settlement. Contains tokenized payment details, AI agent presence signal (human-present vs not), cryptographic attestation chain.

### AP2 V0.1 vs SweeFi: Enforcement Comparison

| Capability | AP2 V0.1 | SweeFi (Live) | Difference |
|---|---|---|---|
| Crypto payments | Via x402 extension (Base, Solana, BNB). Sui spec exists but zero implementation — all Sui PRs closed (#340, #381, #382). | All 5 schemes (Sui + Solana) | SweeFi: implemented and shipped. x402 Sui: spec only. |
| Spending caps | Cart total only (via PaymentRequest) | `max_per_tx`, `max_total` per Mandate | SweeFi: per-tx + lifetime caps, Move-enforced |
| Periodic caps | Not in spec (Google building internally — PR #77) | `daily_limit`, `weekly_limit` (AgentMandate) | SweeFi ships now, Move-enforced |
| Tiered auth levels | Not supported | L0-L3 (READ_ONLY → AUTONOMOUS) | SweeFi-only |
| Revocation | Not standardized (see issue #118) | Same-block (RevocationRegistry) | SweeFi: instant, trustless, on-chain |
| Settlement security | x402 exact: temporal gap on EVM (approve + transfer pattern) | s402: atomic PTB (no gap) | s402 eliminates verify-settle race condition on EVM. On Sui, both would be atomic — but x402 has no Sui implementation. |
| On-chain enforcement | Trusts payment processor | Move consensus | Architectural difference |
| Micropayments | Via x402 (per-tx settlement) | Prepaid scheme (batch settlement) | SweeFi: economically viable at sub-cent scale |
| Streaming | Not supported | StreamingMeter | SweeFi-only |
| Dispute resolution | Card disputes | Escrow + arbiter | SweeFi: programmable, on-chain |
| Pay-to-decrypt | Not supported | SEAL integration | SweeFi-only |

### AP2 Trust Model

- V0.1: Manually curated allow lists (Shopping Agents ↔ Credential Providers ↔ Merchants)
- V1.x (planned): Real-time identity via MCP/A2A, mTLS, DNS verification
- AP2 actors: User → Shopping Agent → Credential Provider → Merchant → Payment Processor → Network/Issuer

## Decision

### Integration Architecture

```
AP2 (Authorization Layer)
    ↓ Intent/Cart Mandate
s402 (Wire Protocol)
    ↓ HTTP 402 challenge-response
SweeFi (Settlement Layer)
    ↓ Mandate<T> enforcement + PTB execution
Sui (Consensus)
```

### Field Mapping: AP2 → SweeFi

| AP2 Field | SweeFi Equivalent | Notes |
|---|---|---|
| Intent Mandate TTL | `expires_at_ms` | Functionally identical |
| User identity | `delegator: address` | Off-chain identity → on-chain address mapping needed |
| Agent identity | `delegate: address` | Off-chain agent ID → on-chain address mapping needed |
| Payment method | Coin type `<T>` | AP2 declares accepted methods; s402 specifies coin type |
| Cart total amount | Used to validate against `max_per_tx` | SweeFi is a cap, AP2 is exact |
| N/A | `max_total` (lifetime) | SweeFi-only; no AP2 equivalent |
| N/A | `daily_limit` / `weekly_limit` | SweeFi-only; no AP2 equivalent |
| N/A | Authorization Level (L0-L3) | SweeFi-only; enables trust ratchet |
| User signature (hardware key) | Delegator signs `create_mandate` TX | Different crypto: ECDSA vs Ed25519 |
| Merchant signature | Provider address in PaymentRequirements | Different trust model |
| AI agent presence signal | Implicit (agent owns Mandate object) | SweeFi knows it's agentic by design |
| Revocation | `RevocationRegistry` (instant, on-chain) | AP2: not standardized in V0.1; SweeFi: same-block on-chain |

### Fiat-to-Crypto Bridge

The USD → SUI conversion happens ONCE at deposit time:

1. Human buys USDC via on-ramp (Coinbase, MoonPay, etc.)
2. Human deposits USDC into SweeFi Prepaid vault or agent wallet on Sui
3. Human creates `Mandate<USDC>` with spending limits
4. All subsequent agent transactions are USDC-on-Sui (no per-TX conversion)
5. Agent draws from pre-funded vault per Mandate constraints

### Implementation Plan

**Phase 1: `@sweefi/ap2-adapter` package**
- Accept AP2 Intent Mandate (JSON) → map to SweeFi Mandate parameters
- Create on-chain Mandate via PTB from AP2 intent
- Return AP2-compatible PaymentMandate confirmations
- Validate AP2 signatures (ECDSA hardware-backed keys)

**Phase 2: s402 as AP2 payment method**
- Register `s402:sui` as accepted payment method in AP2 merchant declarations
- AP2 Shopping Agent recognizes s402-gated services → routes through Sui settlement
- Credential Provider can verify Mandate existence by reading Sui state

**Phase 3: Credential Provider integration**
- SweeFi Mandate becomes an AP2 "credential" (proof of on-chain spending authorization)
- Credential Provider queries Sui for mandate status, remaining balance, revocation state
- Enables AP2 risk engine to include on-chain signals

## Consequences

### Positive
- SweeFi becomes the **Sui-native AP2 settlement rail** (Mysten Labs already an AP2 partner)
- Grant narrative: "Bridge Google's 60-partner authorization layer to Sui's enforcement layer"
- SweeFi mandates are strictly superior to AP2 mandates for on-chain commerce
- Opens path to institutional adoption via AP2's financial partner network

### Negative
- AP2 V0.1 core is pull-only (cards). Crypto settlement exists via x402 (Base, Solana, BNB) and s402 (Sui, Solana). s402 is the superior settlement protocol — atomic, 5 schemes, Move-enforced. Bidirectional x402 compat already shipped in s402@0.1.7 (`compat.ts`).
- Identity mapping (off-chain AP2 identities → on-chain Sui addresses) adds complexity
- AP2 spec is still V0.1; may change substantially before V1.x

### Neutral
- AP2 and SweeFi mandates serve different domains (off-chain vs on-chain). They complement, don't replace each other.
- Agents may carry both: AP2 mandate for Amazon purchases, SweeFi mandate for DeFi operations.

## Known Limitations
- s402 is the Sui-native settlement protocol. x402 has a Sui scheme spec (`coinbase/x402`) but zero implementation — all Sui PRs (#340, #381, #382) were closed. s402 is the only implemented Sui settlement protocol. Bidirectional x402 compat shipped in `compat.ts` as free insurance.
- No formal identity standard bridges AP2's hardware-backed keys to Sui addresses (may need zkLogin or similar).
- AP2 V0.1 IntentMandate has no spending cap fields (only `intent_expiry` for TTL). Google is building spending rules internally (PR #77). SweeFi's mandate system (per-tx caps, periodic caps, tiered levels, instant on-chain revocation) is a strict superset TODAY. Streaming payments also SweeFi-only.

## Risk: AP2 Evolution
- Google is building spending rules into AP2 internally (PR #77, closed Oct 30, 2025)
- SweeFi's "superset" advantage has a shelf life — the durable advantage is ENFORCEMENT MODEL (Move consensus vs trust-based), not feature list
- Durable narrative: "Same authorization concepts. Fundamentally different trust model."

## References
- [AP2 Specification](https://ap2-protocol.org/specification/)
- [AP2 GitHub](https://github.com/google-agentic-commerce/AP2)
- [Coinbase x402 + AP2 Integration](https://www.coinbase.com/developer-platform/discover/launches/google_x402)
- SweeFi `mandate.move` (contracts/sources/mandate.move)
- SweeFi `agent_mandate.move` (contracts/sources/agent_mandate.move)
- SweeFi STRATEGY.md (AP2 positioning)
- Memory: `memory/ap2-s402-integration.md` (research session notes)
