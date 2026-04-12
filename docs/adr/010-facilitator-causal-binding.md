# ADR-010: Facilitator Causal Binding (S8)

**Status:** Accepted
**Date:** 2026-04-11
**Authors:** Danny, Claude (s402 v0.3.0 session)

## Context

SweeFi delegates transaction broadcasting to a facilitator: the client signs a PTB, sends it to the facilitator, and the facilitator broadcasts it to the Sui network. This creates a trust gap — the client has no way to verify that the `txDigest` the facilitator returns actually corresponds to the transaction the client signed.

A malicious facilitator could:
1. Accept the client's signed payment
2. Broadcast it correctly (or not at all)
3. Return a *different* valid transaction digest — one from an unrelated transaction observed on-chain

The client would record that fake digest as its receipt, unable to prove the real payment status. This gap was identified in the April 2026 scale-fragility review and formalized as invariant S8 (Facilitator Accountability) in s402 v0.3.0.

### Why this is solvable locally

Sui's transaction digest is deterministic: `base58(blake2b_256("TransactionData::" || bcs_bytes))`. The client holds the BCS-encoded transaction bytes (it signed them), so it can recompute the expected digest at any time — **offline, no RPC call** — and compare it to what the facilitator returned.

For the facilitator to defeat this check, it would need to find `bcs_bytes' ≠ bcs_bytes` such that `blake2b_256("TransactionData::" || bcs_bytes') == blake2b_256("TransactionData::" || bcs_bytes)` — a blake2b-256 collision at ~2^128 work, infeasible by current or projected compute.

## Decision

SweeFi adopts s402's S8 invariant by implementing `verifySettlement()` on all client-signed scheme adapters in `@sweefi/sui`. The implementation uses `TransactionDataBuilder.getDigestFromBytes()` from `@mysten/sui/transactions` — a synchronous, pure function that derives the Sui transaction digest from BCS-encoded bytes.

### Scope

| Scheme | Client signs? | S8 coverage | Implementation |
|--------|---------------|-------------|----------------|
| exact | Yes | Full | `exact/client.ts` — delegates to `verifySuiSettlement` |
| stream | Yes | Full | `stream/client.ts` — delegates to `verifySuiSettlement` |
| escrow | Yes | Full | `escrow/client.ts` — delegates to `verifySuiSettlement` |
| unlock TX1 | Yes | Full | `unlock/client.ts` — delegates to `verifySuiSettlement` |
| unlock TX2 | No (facilitator-constructed) | None | Out of scope — needs separate attestation mechanism |
| prepaid | Yes (deposit TX) | Full | `prepaid/client.ts` — delegates to `verifySuiSettlement`. Receipt-chain for claim phase is separate. |

### Why the implementation is identical across schemes

The digest function doesn't care what the PTB contains — it hashes the raw BCS bytes regardless of whether they encode a bare `transferObjects` (exact), a `streaming_meter::create` Move call (stream), or an `escrow::lock` call (escrow). Every client-signed scheme's `verifySettlement` is structurally identical except for the scheme guard check.

## Alternatives Considered

- **Option A: RPC-based verification.** Query Sui to check if the digest exists on-chain. Rejected — adds latency, requires network access, and doesn't prove the digest corresponds to *this* transaction (only that *some* transaction exists with that digest).

- **Option B: No client-side verification.** Trust the facilitator. Rejected — violates the s402 principle that facilitators are trusted-for-liveness, not trusted-for-correctness.

- **Option C (chosen): Local digest recomputation.** Pure, offline, zero-dependency check. The client already has the signed bytes; deriving the digest is a single hash call.

### Caller integration

The `createS402Client` fetch wrapper in `packages/sui/src/client/s402-client.ts` calls `verifySuiSettlement` automatically after every successful `SettleResponse`. On mismatch, it throws `s402Error('DIGEST_MISMATCH')` — a non-retryable error. The client MUST NOT record the payment as settled.

### Implementation architecture

All 5 scheme adapters delegate to a single shared helper: `verifySuiSettlement()` in `packages/sui/src/s402/verify.ts`. This avoids copy-paste divergence — the digest check is identical across schemes, and bugs only need fixing in one place. The helper also wraps `fromBase64()` in a try/catch so malformed payloads return `{ verified: false }` instead of throwing.

## Consequences

- **Positive:** Closes the causal-binding hole for all 5 client-signed schemes (including prepaid deposit). Malicious facilitators can no longer return fake digests without detection. Zero runtime cost beyond a single blake2b-256 hash.
- **Positive:** No new dependencies — `TransactionDataBuilder` is already a transitive dependency via `@mysten/sui/transactions`.
- **Positive:** Shared helper means all schemes stay in sync — one implementation, one test suite.
- **Negative:** unlock-TX2 remains unverified (facilitator-constructed transaction). This is a known gap filed for future work.
- **Risk:** If `@mysten/sui` changes the digest algorithm or `TransactionDataBuilder.getDigestFromBytes` API, the verification breaks. Mitigated by the Sui SDK's strong semver discipline and the fact that digest computation is a core primitive unlikely to change.
