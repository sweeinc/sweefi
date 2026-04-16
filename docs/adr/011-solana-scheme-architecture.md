# ADR-011: Solana Scheme Architecture

**Status:** Proposed
**Date:** 2026-04-14
**Supersedes:** None

## Context

SweeFi's `@sweefi/solana` package currently implements only the `exact` scheme (40 tests). To achieve feature parity with `@sweefi/sui` (662 tests, all 6 schemes) and be "Miami Consensus-ready," we need to implement four additional schemes:

1. **upto** — deposit max, settle actual, refund remainder
2. **prepaid** — cumulative call counting with rate caps
3. **stream** — per-second streaming micropayments
4. **escrow** — time-locked vault with arbiter dispute resolution

The `unlock` scheme requires SEAL + Walrus (Sui-specific infrastructure) and is explicitly out of scope for Solana.

### Sui vs Solana: Fundamental Differences

| Concept | Sui | Solana |
|---------|-----|--------|
| **State storage** | Objects (owned or shared) | Accounts (PDAs for program-owned) |
| **State mutation** | PTBs with move calls | Instructions with account inputs |
| **Time** | Clock module (milliseconds) | Sysvar Clock (seconds) |
| **Tokens** | `Coin<T>` with `Balance<T>` | SPL Token accounts |
| **Events** | Sui events | Anchor events / logs |
| **Identity** | `ctx.sender()` | `Signer` account constraint |
| **Fees** | Gas (SUI) | Rent + transaction fees (SOL) |

The core challenge: Sui's shared objects enable multi-party state mutation naturally. Solana requires **Program Derived Addresses (PDAs)** — deterministic addresses derived from seeds — to achieve similar semantics.

## Decision

We will implement all four schemes using **Anchor** (Solana's dominant smart contract framework) with PDAs for state management and SPL token escrows for fund custody.

### 1. PDA Architecture

Each scheme gets a unique PDA derived from a combination of seeds that ensures:
- **Uniqueness**: No two deposits/streams/escrows collide
- **Determinism**: Clients can compute the PDA address before the account exists
- **Security**: Only the program can sign for PDA accounts

```
Upto PDA:
  seeds = ["upto", payer.key(), recipient.key(), nonce (u64)]

Prepaid PDA:
  seeds = ["prepaid", agent.key(), provider.key(), nonce (u64)]

Stream PDA:
  seeds = ["stream", payer.key(), recipient.key(), nonce (u64)]

Escrow PDA:
  seeds = ["escrow", buyer.key(), seller.key(), nonce (u64)]
```

The `nonce` allows multiple deposits between the same parties. It's client-provided and must be unique for each new deposit.

### 2. Token Escrow Pattern

SPL tokens are held in **Associated Token Accounts (ATAs)** owned by the PDA:

```
┌─────────────────┐          ┌──────────────────┐
│  User Wallet    │          │  PDA State Acct  │
│  (owner)        │          │  (scheme data)   │
└────────┬────────┘          └────────┬─────────┘
         │                            │
         │                            │ owns
         ▼                            ▼
┌─────────────────┐          ┌──────────────────┐
│  User's ATA     │   ────>  │  PDA's Escrow    │
│  (user tokens)  │  deposit │  ATA (locked)    │
└─────────────────┘          └──────────────────┘
```

- **Deposit**: User transfers tokens from their ATA to the PDA's escrow ATA
- **Settle/Claim**: Program signs CPI to transfer from escrow ATA to recipient
- **Refund/Expire**: Program signs CPI to transfer back to user

### 3. State Machines

All four schemes follow terminal state machines matching their Move counterparts:

**Upto:**
```
PENDING ─── settle() ──→ SETTLED (terminal)
   │
   └─── expire() ───→ EXPIRED (terminal)
```

**Prepaid:**
```
ACTIVE ─── claim() ───→ ACTIVE (loop)
   │
   ├─── request_withdrawal() ──→ WITHDRAWAL_PENDING
   │                                    │
   │                                    └── finalize_withdrawal() ──→ CLOSED (terminal)
   │
   └─── (v0.2 only) dispute() ──→ DISPUTED (terminal, frozen)
```

**Stream:**
```
ACTIVE ─── claim() ───→ ACTIVE (loop)
   │
   ├─── pause() ──→ PAUSED ──→ resume() ──→ ACTIVE
   │
   └─── close() ──→ CLOSED (terminal)
```

**Escrow:**
```
ACTIVE ─── release() ──────→ RELEASED (terminal)
   │
   ├─── deadline ──→ refund() ──→ REFUNDED (terminal)
   │
   └─── dispute() ──→ DISPUTED
                        ├── release() ──→ RELEASED
                        └── refund()  ──→ REFUNDED
```

### 4. Time Handling

Solana's `Clock` sysvar provides `unix_timestamp` in **seconds** (not milliseconds like Sui). Our TypeScript integration will:

1. Accept milliseconds in the s402 wire format (spec-compliant)
2. Convert to seconds when building Anchor instructions
3. Convert back to milliseconds in events/queries

```typescript
// In client.ts
const deadlineSeconds = Math.floor(requirements.upto.settlementDeadlineMs / 1000);
```

### 5. Fee Calculation

Move contracts use micro-percent (1,000,000 = 100%). For consistency:
- **On-chain (Anchor)**: Use basis points (10,000 = 100%) — Solana convention
- **Wire format**: Use basis points (s402 spec)
- **No conversion needed** between TypeScript and Anchor

Fee calculation in Rust:
```rust
let fee = amount.checked_mul(fee_bps as u64)
    .ok_or(ErrorCode::Overflow)?
    .checked_div(10_000)
    .ok_or(ErrorCode::DivisionError)?;
```

### 6. Program Structure

```
contracts/solana/
├── Anchor.toml
├── Cargo.toml
├── programs/
│   ├── sweefi-upto/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── state.rs      # UptoDeposit account struct
│   │       ├── instructions/ # create, settle, expire
│   │       ├── events.rs
│   │       └── errors.rs
│   ├── sweefi-stream/
│   ├── sweefi-escrow/
│   └── sweefi-prepaid/
└── tests/
    └── *.ts                  # Anchor test suite
```

Each program is independent (no cross-program invocations between schemes). This matches the Move module architecture.

### 7. TypeScript Integration Pattern

Follow the existing `exact` scheme pattern in `packages/solana/src/s402/`:

```typescript
// client.ts
export class UptoSolanaClientScheme implements s402ClientScheme {
  readonly scheme = 'upto' as const;
  
  constructor(
    private readonly signer: ClientSolanaSigner,
    private readonly connection: Connection,
    private readonly programId: PublicKey,
  ) {}
  
  async createPayment(requirements: s402PaymentRequirements): Promise<s402UptoPayload> {
    // 1. Compute PDA address
    // 2. Build Anchor instruction
    // 3. Create Transaction with instruction
    // 4. Sign via signer.signTransaction()
    // 5. Return s402UptoPayload
  }
}

// facilitator.ts
export class UptoSolanaFacilitatorScheme implements s402FacilitatorScheme {
  readonly scheme = 'upto' as const;
  
  async verify(payload, requirements): Promise<s402VerifyResponse> {
    // 1. Deserialize transaction
    // 2. Verify Ed25519 signature
    // 3. Simulate transaction
    // 4. Verify PDA creation / state changes
  }
  
  async settle(payload, requirements): Promise<s402SettleResponse> {
    // 1. Verify first (defense in depth)
    // 2. Execute deposit transaction
    // 3. Execute settle instruction (for upto, this is a separate tx)
  }
}
```

### 8. Limitations

1. **No `unlock` scheme**: Requires SEAL + Walrus — NOT available on Solana
2. **No fraud proofs (v0.2 prepaid)**: Ed25519 signature verification in Solana is expensive. v0.1 (economic security) only for initial release
3. **No receipt objects**: Solana has no equivalent to Sui's `key + store` receipts. Use events + off-chain indexing instead
4. **Rent considerations**: Each PDA requires rent-exempt balance (~0.002 SOL). Closed accounts return rent to a designated address

## Alternatives Considered

### Option A: Raw Solana (no Anchor)

**Pros:**
- Smaller binary size
- No Anchor dependency

**Cons:**
- Manual account serialization (Borsh)
- No automatic PDA derivation helpers
- No generated IDL for client integration
- Significantly more boilerplate

**Why rejected:** Anchor is the industry standard. The developer experience and safety benefits outweigh binary size concerns.

### Option B: Single monolithic program

**Pros:**
- Simpler deployment (one program ID)
- Shared state possible

**Cons:**
- Harder to audit
- Scheme coupling
- Larger binary

**Why rejected:** Matches Move's module-per-scheme architecture. Independent programs are easier to reason about and audit.

### Option C: Skip Anchor, use native SPL + inline PDA

**Pros:**
- Minimal dependencies

**Cons:**
- Reinventing Anchor's safety checks
- No IDL, harder TypeScript integration

**Why rejected:** False economy. Anchor's maturity and safety are worth the dependency.

## Consequences

### Positive

- **Parity**: Solana supports 5/6 s402 schemes (everything except `unlock`)
- **Familiar patterns**: Follows established Anchor conventions
- **Type safety**: Generated TypeScript types from Anchor IDL
- **Testability**: Anchor's test framework integrates with existing vitest setup

### Negative

- **Dependency**: Anchor 0.30+ required (active maintenance)
- **Rent overhead**: Each active deposit/stream/escrow requires ~0.002 SOL rent
- **Deploy complexity**: Four separate programs to deploy and track
- **No receipts**: Off-chain indexing required for historical queries

### Risks

- **Anchor versioning**: Major Anchor upgrades may require migration
- **PDA seed collisions**: Nonce management is client responsibility — misuse could cause address collisions (mitigated by uniqueness check in `create` instructions)
- **Time drift**: Solana slot times can vary; deadline calculations have ~1-2 second uncertainty
