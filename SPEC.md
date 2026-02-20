# SweeFi Specification

> **Version 3.0** — February 16, 2026. The single canonical specification for SweeFi.
> Supersedes all prior spec documents. See `../ARCHIVE-SPEC-v1.md` for historical context.

## Vision

SweeFi enables **autonomous digital commerce without platforms**.

Today, every online transaction flows through intermediaries: Stripe for payments, Amazon for delivery guarantees, Gumroad for content distribution, API key providers for access control. Each takes a cut, adds friction, and requires account creation.

SweeFi replaces all of them with a single HTTP header and Sui's programmable transactions.

An AI agent discovers an API. The API responds with HTTP 402 and its price. The agent pays on-chain. The API delivers. No account. No API key. No subscription. No platform. The HTTP endpoint *is* the business.

---

## The Swee Ecosystem

SweeFi is part of a three-product ecosystem, each with a distinct role:

| Brand | What | Audience | Priority |
|-------|------|----------|----------|
| **SweeFi** | Payment protocol + SDK (s402) | Developers | **Now** — shipping |
| **SweeAgent** | Agent identity, reputation, commerce network | AI agents + developers | **Next** — architect seams now, build when agent commerce ignites |
| **SweeWorld** | Geo-location mobile app (pins, tipping, SEAL content, creator economy) | Consumers | **Soon** — brainstorm + prototype |

**SweeFi** is the foundation — the payment rails everything else builds on. **SweeAgent** (`@sweeagent/*` packages) implements agent identity (`did:sui`), on-chain reputation, and agent discovery — the intelligence layer that makes agent-to-agent commerce trustworthy. **SweeWorld** is a consumer-facing Tauri mobile app where humans and agents interact in the physical world via geo-located pins, tipping, and SEAL-gated content.

The three compose cleanly:
- SweeAgent depends on SweeFi for payments (never the reverse)
- SweeWorld imports from both SweeFi and SweeAgent
- `s402` remains chain-agnostic and ecosystem-agnostic — it knows nothing about identity or mobile apps

## Payment Schemes

SweeFi ships five deployed payment schemes, with a sixth (unlock/seal receipt-gated) in progress:

### Deployed Schemes

| Scheme | What It Eliminates | Sui Advantage | Status |
|--------|--------------------|---------------|--------|
| **Exact** | API keys, subscriptions, payment processors | ~400ms atomic settlement via PTBs | Deployed, facilitator scheme complete |
| **Prepaid** | Per-request negotiation friction | Shared object balance — trustless collateral | Deployed, facilitator scheme complete |
| **Escrow** | Trust in the counterparty (no Amazon/Gumroad/Fiverr) | Atomic release + receipt mint in one PTB | Deployed, facilitator scheme complete |
| **Stream** | Metering infrastructure, billing systems | On-chain `StreamingMeter` with budget caps | Deployed, facilitator scheme complete |
| **Seal** | Trust in the delivery mechanism | SEAL threshold encryption — cryptographic, not access-control | `seal_policy.move` deployed, client scheme complete |

### Not Yet Deployed

| Scheme | What It Eliminates | Status |
|--------|--------------------|--------|
| **Unlock** | Trust in content delivery (pay-to-decrypt) | Client scheme done, facilitator handler not yet built |
| **Split** | Splitter contracts, multi-step approvals | Fee splitting built into payment.move; cross-scheme splits planned |
| **Direct** | Facilitator dependency | Client scheme done (self-sovereign settlement) |

### Exploratory (demand-driven)

| Scheme | What It Eliminates | Likelihood |
|--------|--------------------|------------|
| **Subscription** | Billing platforms (Stripe, Chargebee) | High — natural extension of mandates |
| **Auction** | Centralized allocation of scarce resources | Speculative — unclear demand |
| **Conditional** | Trust in delivery/SLA verification | Speculative — requires oracle infra |

### What the combination enables

Together, these schemes create a closed loop that doesn't exist today:

**An AI agent deposits a budget (prepaid), discovers an API it needs (exact), and buys digital goods from a stranger (escrow). No platform. No API key. No account. No human involved.**

In v0.2, the loop extends: escrow + seal enables trustless *delivery* (not just trustless *payment*), and streaming handles continuous-access billing.

From the seller side: a developer adds `s402Gate()` middleware to an Express/Hono route. That endpoint now accepts money. No Stripe dashboard, no OAuth, no billing page. The endpoint is the business.

What this unlocks:

1. **Pay-per-use anything** — Any HTTP endpoint becomes monetizable with one line of middleware. Exact handles one-shot; prepaid handles high-frequency.
2. **Autonomous agent budgets** — Prepaid + AP2 mandate = agents that operate within a financial envelope without phoning home every transaction.
3. **Trustless commerce** — Escrow means neither party needs to trust the other. No marketplace operator taking 30%.
4. **Trustless digital goods** (v0.2) — Escrow + Seal: funds held until content verifiably delivered via SEAL encryption. The cryptography *is* the delivery confirmation.

The key differentiator: **these compose via Sui PTBs**. Escrow + Seal isn't two separate systems bolted together — it's one atomic transaction that does both. x402 on EVM cannot replicate this.

---

## Scheme Details

### Exact

**Status:** Spec-complete, deployed, E2E demo'd.

One-shot payment. Client builds a signed transfer PTB, facilitator verifies + broadcasts atomically. This is the x402-compatible baseline.

```
Client                    Server                  Facilitator
  |--- GET /api/data ------->|                         |
  |<-- 402 + requirements ---|                         |
  |                          |                         |
  |  (build PTB, sign)       |                         |
  |--- GET + X-PAYMENT ----->|--- verify + settle ---->|
  |                          |<--- { success, tx } ----|
  |<-- 200 + data -----------|                         |
```

**Use cases:** API calls, paywall content, one-off purchases.

**x402 interop:** An x402 client can talk to an s402 server using this scheme with zero modifications. s402 always includes `"exact"` in its `accepts` array.

### Prepaid (Balance)

**Status:** Deployed on testnet v7. Facilitator scheme complete. 8 PTB builders.

Deposit-based access. Agent deposits funds into an on-chain Balance shared object. Each API call decrements atomically. When balance hits zero, 402 again (or auto-topup via mandate).

```
Phase 1 (deposit):
  Agent deposits 10 SUI → Balance shared object created
  One on-chain TX. Gas: ~$0.007.

Phase 2 (usage — off-chain):
  Agent makes API calls freely
  Server tracks usage off-chain (signed receipts)
  No on-chain TX per call. Gas: $0.00.

Phase 3 (claim):
  Provider claims accumulated usage from Balance
  One on-chain TX. Gas: ~$0.007.
  ─────────────────────────────────────────────
  Total: $0.014 gas for unlimited API calls per session
```

**Why this changes everything:**

Without prepaid, per-call settlement is economically impossible:
- 1,000 API calls × $0.007 gas = **$7.00 gas** for $1.00 of API usage

With prepaid + batch claim:
- 2 transactions × $0.007 gas = **$0.014 gas** for $1.00 of API usage
- Per-call effective gas: **$0.000014**

**Trust model:** The Balance shared object is trustless collateral. The agent can't rug (funds locked in the object). The provider can't overclaim (Move module enforces rate caps). Neither party trusts the other.

**Move module design:**

```move
module sweefi::prepaid {
    /// Shared object — agent's prepaid balance for a specific provider
    struct Balance has key {
        id: UID,
        owner: address,          // agent (depositor)
        provider: address,       // authorized claimer
        deposited: Balance<SUI>,
        rate_per_call: u64,      // max MIST per call (rate cap)
        max_calls: u64,          // hard cap on total calls (defense-in-depth)
        claimed_calls: u64,      // provider's running count
        lock_duration_ms: u64,   // how long the withdrawal lock lasts (e.g. 30 min)
        last_claim_ms: u64,      // timestamp of last provider claim (refreshes lock)
    }

    /// Agent deposits SUI → creates per-provider Balance object
    public fun deposit(..., clock: &Clock): Balance

    /// Provider claims accumulated usage (Move-enforced rate cap)
    public fun claim(balance: &mut Balance, call_count: u64, clock: &Clock, ...)
    // Enforces: (call_count - claimed_calls) × rate_per_call <= remaining
    // Enforces: call_count <= max_calls
    // Updates: last_claim_ms = clock.timestamp_ms()

    /// Agent withdraws unclaimed remainder (only after lock expires)
    public fun withdraw(balance: &mut Balance, clock: &Clock, ...)
    // Enforces: clock.timestamp_ms() >= last_claim_ms + lock_duration_ms
}
```

**Design decisions:**
- **Per-provider Balance objects** — Agent creates one Balance per provider. Prevents one provider from seeing another's collateral.
- **Rate-capped claims** — Provider can only claim `count × rate_per_call`. No signed receipts needed. Move enforcement is the receipt.
- **Hard call cap (`max_calls`)** — Defense-in-depth. Even if the deposit balance could cover more, claims are hard-capped. Agent sets this at deposit time based on expected usage.
- **Clock-based withdrawal lock** — Agent cannot withdraw until `lock_duration_ms` after the provider's last claim. Uses `sui::clock::Clock` timestamps (millisecond precision), not epochs (~24h granularity, too coarse for API patterns). A 30-minute lock is practical; epoch-based locks would force 24h+ delays.
- **Lock refresh on claim** — Each provider `claim()` call resets `last_claim_ms`, extending the withdrawal lock. This prevents the agent from timing a withdrawal between claims. As long as the provider is actively claiming, the lock stays fresh.

**Use cases:** AI agent API budgets, high-frequency API access, compute metering, batch data purchases.

### Escrow

**Status:** v0.1. Contracts deployed, HTTP integration ready.

Time-locked vault with arbiter dispute resolution. Full state machine: `ACTIVE -> DISPUTED -> RELEASED / REFUNDED`.

- Buyer deposits funds, locked until release or deadline
- Buyer confirms delivery → funds release to seller (receipt minted)
- Deadline passes → permissionless refund (anyone can trigger)
- Either party disputes → arbiter resolves

**Use cases:** Digital goods delivery, freelance payments, trustless commerce.

### Seal

**Status:** `seal_policy.move` deployed. Token-gated access works. Receipt-gated (unlock scheme) in progress.

Pay-to-decrypt via [Sui SEAL](https://docs.sui.io/concepts/cryptography/seal). Escrow + encrypted content delivery. The buyer pays into escrow; on release, the `EscrowReceipt` unlocks SEAL-encrypted content stored on [Walrus](https://docs.walrus.site).

**Implementation note:** Sui's `seal_approve` requires all arguments to be `Argument::Input` (not results of prior commands in the same PTB). This means the seal flow is two-stage: TX1 creates the escrow receipt, TX2 passes that receipt as input to `seal_approve` for decryption. With Sui's ~400ms finality, the two-stage flow adds under a second of latency.

**Use cases:** Paywalled content (ebooks, datasets, research papers, training data), premium API responses, trustless digital goods delivery.

### Stream

**Status:** Deployed on testnet v7. Facilitator scheme complete. 9 PTB builders.

Per-second micropayments via on-chain `StreamingMeter`. Client deposits funds into a shared object; recipient claims accrued tokens over time.

```
Phase 1 (402 exchange):
  Client builds stream creation PTB --> facilitator broadcasts
  Result: StreamingMeter shared object on-chain

Phase 2 (ongoing access):
  Client includes X-STREAM-ID header --> server checks on-chain balance
  Server grants access as long as stream has funds
```

**Use cases:** Continuous-access billing (AI inference sessions, video streaming, real-time data feeds). Best for use cases where billing is truly time-proportional.

**Note:** For most API metering, Prepaid is a better fit than Stream. Stream is ideal when the resource consumption is continuous and time-based (e.g., a live video feed or an open inference session), not discrete per-request.

### Subscription (exploratory — most likely v0.3 candidate)

> **Status: NOT COMMITTED.** Natural extension of mandate infrastructure. Built if recurring billing demand materializes.

Recurring payments via mandate + scheduled pull. Builds on existing mandate contracts. The new piece would be a `Subscription` object tracking billing state and a `pull()` function that validates timing + mandate limits in one PTB.

**Use cases:** Monthly API tiers, SaaS billing, recurring data feeds.

### Auction and Conditional (exploratory — speculative)

> **Status: SPECULATIVE.** Unclear current demand. Documented for completeness, not as commitments.

**Auction:** Competitive pricing for scarce resources. Multiple agents bid, winner settles atomically, losers refund permissionlessly. Interesting for GPU compute markets but unclear whether this belongs in HTTP 402 or is a separate protocol.

**Conditional:** Oracle-gated payments. Funds held until external condition is met (price feeds, uptime SLAs). Requires oracle infrastructure (Pyth, Switchboard) that's still maturing on Sui. Powerful concept but complex to ship.

---

## Cross-Cutting Features

### Split Payments (v0.2)

Atomic multi-party settlement as a feature on any scheme. One PTB splits payment to multiple recipients:

```typescript
payTo: '0xvendor',
splitTo: [
  { address: '0xcreator', bps: 8500 },   // 85%
  { address: '0xplatform', bps: 1000 },   // 10%
  { address: '0xaffiliate', bps: 500 },   // 5%
]
```

Sui PTBs handle multiple `splitCoins` + `transferObjects` atomically. One transaction, one gas fee, cryptographic proof of the split. EVM requires a splitter contract or multiple approvals.

**Use cases:** Creator royalties, affiliate programs, protocol fees, marketplace commissions.

### AP2 Mandates

Agent spending authorization. A human creates a mandate for an AI agent with per-transaction limits, lifetime caps, and expiry. The agent operates autonomously within these bounds.

**Status:** Contracts deployed, HTTP integration ready.

### Gas Sponsorship

SweeFi facilitator sponsors gas for settlement transactions via `sui-gas-station`. The end user (agent or human) never pays gas directly — it's absorbed into the protocol fee.

**Status:** Battle-tested on devnet, 61 tests passing.

---

## Architecture

```
AI Agent (Claude, GPT, Cursor, etc.)
    |
    +-- s402 fetch wrapper ------> @sweefi/sdk (auto-pay client)
    |                                   |
    +-- MCP tool discovery -------> @sweefi/mcp (35 tools)
    |                                   |
    +-- Direct PTB --------------> @sweefi/sui (40 PTB builders)
    |                                   |
    |                         s402 (protocol spec, zero deps)
    |                                   |
    +-- Gas sponsorship ---------> sui-gas-station
    |                                   |
    |                         @sweefi/facilitator (verify + settle)
    |                                   |
    +-- Agent identity ----------> @sweeagent/identity (did:sui, profiles)     [FUTURE]
    |                                   |
    +-- Agent reputation --------> @sweeagent/reputation (on-chain scoring)   [FUTURE]
    |                                   |
    +-- Agent discovery ---------> @sweeagent/registry (search, match)        [FUTURE]
                                        |
                              Sui blockchain (10 Move modules, testnet v7)
                                        |
                                 +------+------+
                                 |  payment    | Direct pay + receipts
                                 |  prepaid    | Deposit + rate-capped claims
                                 |  stream     | Micropayments + budget caps
                                 |  escrow     | Time-locked + arbiter disputes
                                 |  seal_policy| Pay-to-decrypt via SEAL
                                 |  mandate    | Basic spending delegation
                                 |  agent_mand.| L0-L3 tiered autonomy
                                 |  admin      | Protocol governance
                                 |  identity   | On-chain identity binding
                                 |  math       | Safe arithmetic helpers
                                 +-------------+
```

## Packages

### In This Monorepo

| Package | Description | Tests |
|---------|-------------|-------|
| [`@sweefi/core`](packages/core) | Shared types, client factories (Sui, SEAL, Walrus), constants | 54 |
| [`@sweefi/sui`](packages/sui) | 40 PTB builders, signer utils, s402 scheme implementations | 176 |
| [`@sweefi/sdk`](packages/sdk) | Client + server SDK (s402 auto-pay client, s402Gate middleware) | 6 |
| [`@sweefi/facilitator`](packages/facilitator) | Self-hostable payment verification + settlement service | 37 |
| [`@sweefi/mcp`](packages/mcp) | MCP server — 30 default + 5 opt-in AI agent tools | 79 |
| [`@sweefi/cli`](packages/cli) | CLI for wallet, pay, prepaid, mandate operations | 42 |
| [`@sweefi/widget`](packages/widget) | Framework-agnostic checkout core + React + Vue adapters | 6 |
| [`sweefi-contracts`](contracts) | 10 Move modules on Sui testnet (v7) | 185 |

**Total: 585 tests (400 TypeScript + 185 Move)**

### External Dependencies

| Package | Description | Notes |
|---------|-------------|-------|
| [`s402`](https://www.npmjs.com/package/s402) | Chain-agnostic HTTP 402 protocol spec (zero deps) | Published on npm, imported as `s402@^0.1.0` |
| `@mysten/sui` | Sui TypeScript SDK | Peer dependency, `^2.0.0` (resolved to 2.4.0) |
| `@mysten/seal` | SEAL threshold encryption | `^1.0.0` (resolved to 1.0.1) |
| `@mysten/walrus` | Walrus decentralized storage | `^1.0.0` (resolved to 1.0.3) |

---

## Roadmap

### v0.1 — Current State (Feb 16, 2026)

Everything below is DONE. Contracts deployed to testnet v7. All packages build, typecheck, and pass tests.

- [x] s402 protocol spec published on npm as `s402@0.1.2`
- [x] x402 V1 + V2 compatibility layer
- [x] Exact scheme: contracts + PTB builders + facilitator scheme + SDK
- [x] Prepaid scheme: contracts + 8 PTB builders + facilitator scheme + MCP tools
- [x] Escrow scheme: contracts + 5 PTB builders + facilitator scheme + MCP tools
- [x] Stream scheme: contracts + 9 PTB builders + facilitator scheme + MCP tools
- [x] Seal policy: `seal_policy.move` deployed, token-gated access works
- [x] Mandates: basic + agent (L0-L3) contracts + 9 PTB builders + MCP tools
- [x] Admin: pause/unpause/burn contracts + 3 PTB builders
- [x] Identity + math helper modules
- [x] @sweefi/mcp: 35 MCP tools (30 default + 5 opt-in)
- [x] @sweefi/cli: CLI for wallet, pay, prepaid, mandate operations
- [x] @sweefi/widget: React + Vue checkout adapters
- [x] @sweefi/facilitator: settles 4 schemes (exact, prepaid, stream, escrow)
- [x] Migrated to @mysten/sui 2.x + @mysten/seal 1.x
- [x] 585 total tests (400 TypeScript + 185 Move)

### Next — Ship It

- [ ] Wire up `demos/agent-pays-api` end-to-end (live demo)
- [ ] npm publish all packages (mechanically ready)
- [ ] Unlock facilitator scheme (pay-to-decrypt settlement)
- [ ] Identity PTB builders
- [ ] Documentation site

### v1.0 — Production

- [ ] Mainnet deployment (requires security audit + AdminCap governance decision)
- [ ] Professional or rigorous self-audit
- [ ] npm publish v1.0
- [ ] Documentation site
- [ ] Monitoring + incident response

### Exploratory (demand-driven, not committed)

- [ ] Subscription scheme (natural extension of mandates)
- [ ] Cross-chain routing (x402 wire compat already built)
- [ ] Split payments as cross-cutting feature on all schemes

---

## Economics

### Protocol Fee

SweeFi charges a **percentage-based fee with a floor**:

```
Protocol fee = max($0.01, settlement amount × 50 bps)
```

- **50 basis points (0.5%)** of the settlement amount
- **$0.01 minimum** — ensures every settlement covers infrastructure costs
- Authoritative rate lives on-chain in `ProtocolState.protocolFeeBps` (Move contract)
- Charged per on-chain settlement, **not** per API call

### Fee Trust Model (Important Architecture Decision)

The protocol fee is **owned by the Facilitator, not the Resource Server**.

The s402 wire format includes an optional `protocolFeeBps` field in the HTTP 402 requirements. This field is **advisory only** — it is a transparency hint so the client knows the total cost before committing. It is never the source of truth for settlement math.

**The source of truth is the on-chain `ProtocolState` object**, which holds the canonical fee rate and recipient address. The Move contracts enforce this unconditionally. A malicious Resource Server that inflates `protocolFeeBps` in the HTTP header cannot change what the PTB actually does on-chain.

This is the same model used by every mature payments network:
- Visa sets interchange rates — merchants cannot override them
- Stripe charges its own fee — sellers cannot configure what Stripe takes
- SweeFi's facilitator owns the fee schedule — resource servers cannot manipulate it

**Practical implications:**
1. The SweeFi hosted facilitator exposes its fee schedule at `/.well-known/s402-facilitator` (signed)
2. Clients SHOULD verify the `protocolFeeBps` in HTTP requirements matches the facilitator's signed schedule
3. Facilitators MUST reject settlements where the PTB-encoded fee does not match `ProtocolState`
4. Resource Servers SHOULD omit `protocolFeeBps` from requirements and let the facilitator provide it — including it is a courtesy to the client's UI, nothing more

This is per settlement. With Prepaid, a session with 1,000 API calls has only 2 settlements (deposit + claim).

### How it compares

| Transaction | SweeFi (0.5% + $0.01 floor) | Stripe (2.9% + $0.30) | How much cheaper |
|---|---|---|---|
| $1 prepaid claim (1K API calls) | $0.01 | $0.33 | **33x** |
| $5 one-shot API call | $0.025 | $0.45 | **18x** |
| $10 dataset purchase | $0.05 | $0.59 | **12x** |
| $50 escrow | $0.25 | $1.75 | **7x** |
| $100 digital goods | $0.50 | $3.20 | **6x** |
| $1,000 enterprise deal | $5.00 | $29.30 | **6x** |

**At every price point, SweeFi is 6-33x cheaper than Stripe.** And unlike Stripe, there's no account, no approval process, and no chargebacks.

### Gas

Sui gas is ~$0.007 per transaction. The gas station absorbs this into the protocol fee so end users never see gas costs. At the $0.01 floor, gas absorption is sustainable ($0.01 revenue - $0.007 gas = $0.003 margin even on the cheapest transactions).

### Revenue at Scale

| Monthly Volume | Total Settlement Value | Protocol Revenue | After Gas |
|---|---|---|---|
| 100K sessions × $1 avg | $100K | $1,000 | $600 |
| 1M sessions × $2 avg | $2M | $10,000 | $7,200 |
| 10M sessions × $5 avg | $50M | $250,000 | $180,000 |
| 100M sessions × $5 avg | $500M | $2,500,000 | $1,800,000 |

Protocol fees reach sustainability at ~10M sessions/month. Before that, revenue comes from the hosted facilitator service and analytics SaaS (higher-margin products).

### Full Revenue Stack

| Stream | Model | Margin | When |
|---|---|---|---|
| **Protocol fees** | 50 bps per settlement | Low | v0.1 |
| **Hosted facilitator** | Free tier + Pro ($49/mo) + Enterprise | Medium | v0.1 |
| **SweeFi Vaults** | Yield on idle prepaid/escrow TVL (via Aftermath, Cetus, Scallop) | **High** | Tier 2 |
| **Analytics dashboard** | SaaS — revenue per endpoint, agent cohorts, settlement latency | **High** | Tier 2 |
| **Agent credit** | Underwriting credit lines backed by on-chain payment history | **Very high** | Tier 3 |
| **Reputation API** | Freemium — agent credit scores, provider quality ratings | **Very high** | Tier 2-3 |
| **Enterprise** | Custom SLAs, priority settlement, compliance tools | High | Later |

The protocol fees are the foundation. The data products are the profit center. The vaults are the DeFi wedge. The reputation moat is the defensibility.

### SweeFi Vaults

Every `PrepaidBalance`, `StreamMeter`, and `Escrow` object is locked capital — TVL sitting in SweeFi's smart contracts. Today it earns no yield. The natural evolution:

**SweeFi Vaults** route idle payment capital into Sui DeFi protocols (Aftermath, Cetus, Scallop) while keeping it instantly spendable. SweeFi earns the spread between yield generated and yield passed to depositors.

- Prepaid balances are ideal candidates — they sit idle between API calls
- Escrow deposits earn yield during the settlement window
- Stream meter deposits earn yield between per-second billing events
- Neither payer nor provider needs to know this is happening — it's entirely in the facilitator layer

This is how traditional payment processors earn their second revenue line. Stripe earns yield on funds in transit. SweeFi does it on-chain, transparently, at DeFi rates.

### Agent Credit

SweeFi holds something no traditional payment processor has: a complete, verifiable, on-chain payment history for every agent. Six months of clean `PrepaidBalance` top-ups and on-time stream payments is a credit score.

The product: **"pay after you earn"** credit lines for agents with strong payment history. An agent with a proven track record can access working capital against future earnings rather than pre-depositing collateral. Combined with `identity.move` (on-chain agent identity), this becomes the foundation of an agent lending market.

Revenue model: spread between borrowing cost and lending rate, underwriting fees, credit score API access.

---

## Competitive Position

### vs x402 (Coinbase)

x402 proved the concept. s402 takes it further with Sui-native capabilities:

| | x402 (EVM) | SweeFi (Sui) |
|---|---|---|
| Payment modes | Exact only | 6 core schemes (v0.1-v0.2), extensible architecture |
| Settlement | Two-step verify/settle | Atomic PTBs |
| Finality | 12s+ (L1), 2s (L2) | ~400ms |
| Micro-payments | Economically broken ($7 gas/1K calls) | Economically viable ($0.014 gas/1K calls via prepaid) |
| Agent auth | None | AP2 Mandates (spending limits, expiry, revocation) |
| Content gating | Server trust | SEAL threshold encryption |
| Stablecoins | USDC (Circle) | USDC + USDT + USDe + SUI-native stables |
| Multi-party | Splitter contract + approvals | Native PTB composition |
| Reputation | None | On-chain receipts exist; scoring layer planned |
| Discovery | None | `.well-known/s402.json` shipped; registry planned |
| Cross-chain | EVM only | x402 compat layer shipped; bridge routing future |
| Compatibility | n/a | x402 V1/V2 wire-compatible |

### vs BEEP (justbeep.it)

BEEP is a proprietary Sui payment service. SweeFi is open-source and protocol-level.

- SweeFi: open protocol (anyone can run a facilitator)
- BEEP: proprietary service (vendor lock-in)
- SweeFi: 3 payment schemes at launch (v0.1), 6 total (v0.2)
- BEEP: exact only (a402)

---

## Multi-Chain Strategy

s402 is the protocol. SweeFi is the multi-chain runtime — the thing that makes s402 work on real blockchains. The package structure is designed for this from day one:

```
s402 (npm, chain-agnostic — the protocol)
    ↑                          ↑
@sweefi/sui              @sweefi/solana          (future: @sweefi/aptos, etc.)
@sweefi/sdk              (chain selected at runtime via network field)
@sweefi/cli              (--chain sui | solana flag)
@sweefi/mcp              (same MCP tools, different provider)
```

Developers who only want Sui install `@sweefi/sui`. Developers who only want Solana install `@sweefi/solana`. Nobody installs both unless they need both.

### @sweefi/solana — Planned

All five s402 schemes translate to Solana's programming model:

| Scheme | Sui primitive | Solana equivalent |
|--------|--------------|-------------------|
| **Exact** | PTB + coin transfer | SPL token transfer instruction |
| **Prepaid** | Shared `PrepaidBalance` object | Program-Derived Address (PDA) balance account |
| **Stream** | Shared `StreamMeter` + `sui::clock` | PDA meter + `Clock` sysvar (`unix_timestamp`) |
| **Escrow** | Owned escrow object | PDA-held escrow account (standard Solana pattern) |
| **Unlock** | Mysten Seal threshold encryption | Lit Protocol or custom key server |

The TypeScript layer (`@sweefi/solana`) ports cleanly — same s402 scheme interfaces, different on-chain calls. The Anchor programs (Rust) for Stream and Escrow are the primary engineering effort. Exact and Prepaid can be stubbed with existing SPL Token primitives for an early testnet demo.

### Why multi-chain strengthens the position

- x402 (Coinbase) is EVM-only and Coinbase-controlled
- SweeFi supporting Sui + Solana means s402 is the interoperable standard, not a chain-specific format
- A Solana API server and a Sui client cannot interoperate (different chains), but they use identical HTTP headers — the protocol is the common ground
- This is the TCP/IP play: the protocol is neutral, implementations compete on execution

### Chain selection criteria for future implementations

A chain is a good s402 candidate if it has: sub-second finality (or fast enough for HTTP request latency), gas cheap enough for micropayments, and smart contract capability for Escrow and Stream. **Aptos** (Move language sibling to Sui) and **Stellar** (built for payments natively) are the strongest candidates after Solana.

---

## Design Principles

1. **Protocol-agnostic core, multi-chain implementations.** `s402` defines chain-agnostic protocol types and HTTP encoding. `@sweefi/sui` is the reference implementation. `@sweefi/solana` is the second implementation (planned). Other chains can implement s402 schemes using their own primitives — the HTTP wire format never changes.

2. **Wire-compatible with x402.** The `exact` scheme uses the same headers and encoding as x402 V1. The compat layer handles V1 (`maxAmountRequired`) and V2 (`amount`, envelope format). s402 clients work with x402 servers and vice versa via the `exact` scheme.

3. **Scheme-specific verification.** Each scheme has its own verify logic. Exact (signature + dry-run), prepaid (balance check + rate cap), stream (deposit + rate), escrow (state machine + arbiter), seal (escrow receipt + SEAL approve). The facilitator dispatches — it doesn't share logic.

4. **Zero runtime dependencies in core.** `s402` is pure TypeScript protocol definitions. No Sui SDK, no crypto libraries, no HTTP framework. Chain-specific code belongs in adapters.

5. **Errors tell you what to do.** Every error code includes `retryable` (can the client try again?) and `suggestedAction` (what should it do?). Agents can self-recover.

6. **Composability via PTBs.** Payment schemes compose atomically. Escrow + Seal is one PTB. Pay + Split is one PTB. This is Sui's killer feature and SweeFi exploits it fully.

7. **No funds locked forever.** Every scheme includes permissionless recovery: streams have budget caps + recipient close, escrows have deadline refunds, prepaid has withdrawal locks that expire, mandates have expiry + revocation.

---

## Supported Assets

SweeFi is multi-asset by design. The `asset` field in s402 requirements is a Sui coin type address. Providers can accept any combination:

| Asset | Type on Sui | Status |
|-------|------------|--------|
| **SUI** | `0x2::sui::SUI` | Native. Gas token. |
| **USDC** | Circle native USDC | Live on mainnet. Primary stablecoin. |
| **USDT** | Tether native USDT | Live on mainnet (launched Dec 2024). |
| **USDe** | Ethena synthetic dollar | Available via bridge. |
| **BUCK** | Bucket Protocol CDP stablecoin | Sui-native. |

**Strategic implication:** An agent on *any chain* that holds USDC can bridge to Sui and interact with the entire s402 ecosystem. And a Sui-native agent holding USDC can pay for services on any chain that accepts USDC. SweeFi + stablecoins = chain-agnostic agent commerce settled on the fastest chain.

No v0.1 protocol changes needed — multi-asset support is already in the wire format.

---

## Platform Capabilities

Payment schemes are the foundation. Platform capabilities are the moat. The protocol is open — anyone can implement s402. The value accrues in data, discovery, and network effects.

### Tier 1: Infrastructure (enables everything — build alongside v0.1)

| Capability | What It Does | Status |
|------------|-------------|--------|
| **Facilitator Network** | Verify + settle. Self-hostable or use SweeFi's hosted service | Built, 37 tests, settles 4 schemes |
| **Agent SDK** | `client.fetch(url)` — 3 lines to auto-pay for anything | Built, 6 tests |
| **MCP Server** | AI agents discover payment tools natively via MCP protocol | Built, 35 tools, 79 tests |
| **CLI** | Terminal tool for wallet, pay, prepaid, mandate operations | Built, 42 tests |

Table stakes. Not a moat, but nothing works without them.

### Tier 2: Intelligence (the data moat) — SweeAgent

> **Status: VISION — NOT YET BUILT.** The raw data (on-chain receipts) exists today. The indexing, aggregation, and scoring layers do not. When built, these capabilities will ship as `@sweeagent/*` packages.

Every s402 settlement creates on-chain data: `PaymentReceipt` objects, escrow state transitions, prepaid balance activity, stream meters. This data accumulates only when people use SweeFi schemes. A competing protocol starts at zero.

**On-Chain Reputation** (`@sweeagent/reputation`)

Aggregate settlement data into trust signals:

- **Agent credit scores** — "This agent has settled 50,000 payments, zero disputes, average $0.02." Agents with history can skip escrow, get better rates, access premium APIs without upfront deposits.
- **Provider quality scores** — "This API has 99.8% successful settlements, median latency 340ms, zero overclaims on prepaid." Agents choose providers programmatically based on on-chain evidence.
- **Dispute rate tracking** — Escrow dispute ratios are public. Bad actors get priced out or excluded automatically.

Reputation is the embodied network effect. It can't be forked — the data is on Sui and tied to real settlement history.

**How indexing works (the honest architecture):** On-chain aggregation is too expensive. The practical path is an off-chain indexer (using Sui's event subscription API or a custom indexer built on Sui's checkpoint data) that reads `PaymentReceipt` events, computes scores, and serves them via API. Scores can be anchored on-chain periodically (e.g., Merkle root of the reputation state) for verification without paying per-receipt gas. This is the same pattern Sui explorers and analytics tools use. It's centralized at the indexing layer — but the raw data is permissionlessly readable, so anyone can run a competing indexer and verify the scores.

**Payment Analytics (SaaS opportunity)**

Provider-facing dashboard:
- Revenue per endpoint, per scheme, per time period
- Agent cohort analysis (retention, average spend, churn)
- Settlement latency percentiles
- Gas cost absorption tracking
- Prepaid balance utilization rates

Free tier for basic metrics. Paid tier for deep analytics. Providers who see their revenue data in SweeFi's dashboard don't switch.

**Price Discovery**

SweeFi's facilitator sees all settlements it processes. This enables agent-facing price comparison:
- "Weather API A: 1000 MIST/call, 99.9% uptime, 340ms median"
- "Weather API B: 800 MIST/call, 97% uptime, 890ms median"

Agents optimize spend automatically. Providers compete on price and quality.

### Tier 3: Network Effects (the flywheel) — SweeAgent

> **Status: FUTURE VISION — NOT YET BUILT.** Requires significant adoption of Tier 1+2 before these become viable. Included for strategic direction, not as near-term commitments. These capabilities will ship as `@sweeagent/*` packages.

**Service Registry** (`@sweeagent/registry`)

`.well-known/s402.json` is static and per-server — you have to already know the URL. A global registry is dynamic and searchable:

```
Agent: "I need a weather API that accepts s402 prepaid on sui:mainnet"
Registry: [
  { url: "api.weather.io", schemes: ["exact","prepaid"], reputation: 98.5, price: "800 MIST/call" },
  { url: "storms.api.dev", schemes: ["exact"],           reputation: 94.2, price: "500 MIST/call" },
]
```

Likely starts as an off-chain API that crawls `.well-known/s402.json` endpoints and indexes them. On-chain registry comes later if demand justifies it.

**Cross-Chain Routing**

> **Status: FUTURE — depends on bridge maturity.** Circle CCTP on Sui is early. Wormhole works but isn't plug-and-play for arbitrary payment routing. This is directionally correct but not imminent.

The concept: agent pays in USDC on Base via x402, SweeFi facilitator bridges to Sui and settles there. Provider never knows the agent was on EVM. SweeFi becomes a universal HTTP 402 router.

This is where the x402 compat layer pays off strategically — SweeFi can accept x402 wire format from any chain and settle on Sui's superior infrastructure. But the bridge plumbing needs to mature first.

**Agent Marketplace** (SweeAgent endgame)

The endgame vision: a marketplace where agents advertise capabilities, other agents discover and pay them, reputation scores gate access, and escrow protects both sides. SweeFi takes a protocol fee on marketplace transactions. SweeAgent provides the identity (`did:sui`), reputation (on-chain scoring), and discovery (registry) that make this marketplace trustworthy.

This is the long-term network effect play. It requires Tiers 1-2 to be mature and significant adoption before it's viable.

### Tier 4: Enterprise & Privacy (long-term)

> **Status: LONG-TERM VISION.** None of this is planned for v0.x. Included for completeness and to show the strategic ceiling.

**Confidential Payments** — ZK proofs on payment amounts and participants. Enterprise customers who can't have payment data public.

**Compliance Tools** — Audit trails, tax reporting, optional AML/KYC hooks for regulated providers. The receipts are already on-chain; compliance is a read layer.

**SLA Enforcement** — Ties into the Conditional scheme. Trustless SLAs with automatic refunds.

### The Flywheel

```
More providers register
        ↓
More agents discover services via registry
        ↓
More settlements → more reputation data accumulates
        ↓
Better reputation → lower friction (skip escrow, better rates, unsecured access)
        ↓
Lower friction → more providers register (cycle repeats)
        ↓
Data moat deepens → competitors can't replicate the reputation graph
```

The protocol is open. The schemes are open. **The reputation graph is the moat.** It only exists because real money settled through SweeFi on Sui. It can't be forked, spoofed, or replicated without actual economic activity.

---

## Swee Ecosystem Packages

### SweeFi (shipping now)

| Package | Description | Tests |
|---------|-------------|-------|
| `@sweefi/sui` | 40 PTB builders for all contract operations | 176 |
| `@sweefi/core` | Shared types, network configs, client factories | 54 |
| `@sweefi/facilitator` | Self-hostable payment verification service | 37 |
| `@sweefi/mcp` | MCP server with 35 AI agent tools | 79 |
| `@sweefi/sdk` | Client + server SDK (3-line integration) | 6 |
| `@sweefi/cli` | CLI for wallet, payments, and provider management | 42 |
| `@sweefi/widget` | Checkout UI — Vue + React adapters | 6 |
| `sweefi-contracts` | 10 Move modules on Sui testnet (v7) | 185 |

**External dependencies**: `s402@0.1.2` (HTTP 402 protocol), `@mysten/sui@2.4.0`, `@mysten/seal@1.0.1`

**Totals**: 400 TypeScript tests + 185 Move tests = 585

### SweeAgent (future — architect seams now)

| Package | Description | Status |
|---------|-------------|--------|
| `@sweeagent/identity` | Agent identity via `did:sui`, profiles, credibility bonds | Vision |
| `@sweeagent/reputation` | On-chain reputation scoring from receipt data | Vision |
| `@sweeagent/registry` | Agent/service discovery and search | Vision |

### SweeWorld (future — Tauri mobile app)

| Component | Description | Status |
|-----------|-------------|--------|
| SweeWorld app | Geo-location pins, tipping, SEAL content, creator economy | Brainstorm |

---

*SweeFi: the payment layer for the agentic internet. SweeAgent: the trust layer. SweeWorld: the world layer.*
