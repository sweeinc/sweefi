# ADR-004: AdminCap & Emergency Pause

**Status:** Accepted (Implemented)
**Date:** 2026-02-13
**Implemented:** 2026-02-13
**Authors:** Strategy AI (Session 109)

## Context

SweeFi currently ships with **no admin capability**. Once the Move package is published, no one can pause, upgrade, or modify the contracts. This was an intentional choice for trustlessness — users don't need to trust a contract owner.

However, every production DeFi protocol on Sui ships with an AdminCap pattern:

| Protocol | AdminCap | Emergency Pause | Upgrade Authority |
|----------|----------|----------------|-------------------|
| DeepBook v3 | Yes | Yes | Mysten-controlled |
| Cetus | Yes | Yes | Multisig |
| Turbos | Yes | Yes | Team-controlled |
| Aftermath | Yes | Yes | Team-controlled |
| Navi | Yes | Yes | Team-controlled |

The reason is not philosophical — it's **operational risk management**. An immutable contract with a critical bug means permanently frozen or draining funds with zero recourse. The industry learned this from Ethereum (The DAO, Parity multisig freeze, Ronin bridge). Even Uniswap v2, the gold standard of minimal governance, retained a fee switch that governance could activate.

SweeFi manages real funds (payments, streams with ongoing deposits, escrows with time-locked balances). A bug discovered post-mainnet without an emergency pause would be catastrophic.

## Decision

### Add AdminCap with a Burn-to-Trustless Lifecycle

```
Phase 1: Launch with AdminCap (pause/unpause)
    │
    ├── Bug found? → Pause, fix in new package version, migrate
    ├── No bugs for N months? → Proceed to Phase 2
    │
Phase 2: Burn AdminCap (transfer to 0x0)
    │
    └── Irrevocable. Protocol is now fully trustless.
        Same as current design, but battle-tested first.
```

### Proposed Move Interface

```move
/// Created once in module init(). Whoever holds this can pause/unpause.
public struct AdminCap has key, store { id: UID }

/// Shared object — every entry point checks this before proceeding.
public struct ProtocolState has key {
    id: UID,
    paused: bool,
}

/// Pause all protocol operations. Only AdminCap holder can call.
public entry fun pause(_: &AdminCap, state: &mut ProtocolState) {
    state.paused = true;
}

/// Resume all protocol operations.
public entry fun unpause(_: &AdminCap, state: &mut ProtocolState) {
    state.paused = false;
}

/// Irrevocably destroy the AdminCap. Protocol becomes fully immutable.
/// This is a one-way door — once burned, no one can ever pause again.
public entry fun burn_admin_cap(cap: AdminCap) {
    let AdminCap { id } = cap;
    object::delete(id);
}
```

### Entry Point Guard

Every public/entry function that mutates state gets a one-line guard:

```move
assert!(!protocol_state.paused, EProtocolPaused);
```

### What AdminCap Does NOT Include

- **No parameter changes**: Cannot modify fee caps, timeout durations, or any contract constants. These remain immutable.
- **No upgrade authority**: The package remains non-upgradeable. AdminCap is strictly pause/unpause.
- **No fund extraction**: AdminCap cannot withdraw funds from streams, escrows, or any balance. It can only freeze new operations.
- **No censorship**: Read-only functions (getters, view functions) are NOT paused. Only state-mutating operations are affected.

### AdminCap Custody

From day one, the AdminCap should be held by a **Sui multisig** (minimum 2-of-3):

```
AdminCap holder: Multisig(2-of-3)
  ├── Key 1: Danny (founder)
  ├── Key 2: Operational key (cold storage)
  └── Key 3: Trusted third party / future team member
```

This prevents single-key compromise from pausing the protocol, while keeping operational agility for genuine emergencies.

### Two-Tier Guard (Implemented)

The implementation uses a **two-tier guard** design, not a blanket pause:

| Module | Guarded Functions | Unguarded Functions | Rationale |
|--------|-------------------|---------------------|-----------|
| **stream** | `create`, `create_with_timeout`, `top_up` | `claim`, `pause`, `resume`, `close`, `recipient_close` | Stop new money entering; users can always exit |
| **escrow** | `create` | `release`, `refund`, `dispute` | Stop new deposits; existing escrows resolve normally |
| **payment** | _(none)_ | All functions | Preserve owned-object fast path (no consensus overhead) |
| **seal_policy** | _(none)_ | `seal_approve` | Read-only, no state mutation |

**Key principle**: Users must always be able to withdraw their funds. Pause only blocks new money from entering the system. Error codes: 500-series (EAlreadyPaused=500, ENotPaused=501).

### The Burn Event

When AdminCap is burned, emit an event:

```move
public struct AdminCapBurned has copy, drop {
    burned_by: address,
    timestamp_ms: u64,
}
```

This creates an on-chain, indexable proof that the protocol is irrevocably trustless. Useful for auditors, grant reviewers, and users verifying the protocol's status.

## Consequences

### Positive

- **Safety net**: Critical bugs can be contained before funds are lost.
- **Industry standard**: Matches expectations of auditors, grant reviewers, and institutional users.
- **Credible path to trustlessness**: Burn-to-trustless is stronger than "trust us, we don't have a key" — it's verifiable on-chain.
- **Minimal attack surface**: Pause/unpause only. No parameter tweaking, no fund extraction, no upgrade authority.

### Negative

- **Shared object overhead**: `ProtocolState` is a shared object — every transaction must read it, adding one consensus round-trip. This is the same cost model as stream/escrow operations (already shared), so the marginal impact is small for those modules. For payments (currently pure owned-object path), this adds latency.
- **Centralization risk during Phase 1**: Until the cap is burned, the multisig holders can pause the protocol. Mitigated by: (a) multisig prevents unilateral action, (b) pause only freezes operations — doesn't extract funds, (c) clear public commitment to burn timeline.
- **Complexity**: Four modules need guard checks. Migration of existing streams/escrows needs consideration if paused mid-lifecycle.

## Open Questions (Resolved)

1. **Burn timeline**: TBD — after first audit and sufficient mainnet operational history.
2. **Granular pause**: Resolved — single boolean is sufficient for launch. Per-module granularity deferred to V2 if market demands. The two-tier guard (guard creation only) provides adequate surgical control.
3. **ProtocolState impact on payment hot path**: Resolved — payments are NOT guarded. The owned-object fast path is preserved. Only stream/escrow (already shared objects) take the marginal ProtocolState read.

## References

- **`docs/MAINNET-DEPLOYMENT.md`** — Step-by-step launch runbook implementing this ADR's multisig custody requirement. Contains the exact `sui keytool` commands for generating keys, creating the 2-of-3 multisig address, and verifying the AdminCap transfer. Run this checklist at mainnet deploy.
- DeepBook v3 source: `packages/deepbook/sources/admin.move`
- Cetus emergency pause: documented in their audit reports
- Sui multisig: [docs.sui.io/concepts/cryptography/transaction-auth/multisig](https://docs.sui.io/concepts/cryptography/transaction-auth/multisig)
- The DAO hack (2016): motivation for emergency pause patterns in DeFi
