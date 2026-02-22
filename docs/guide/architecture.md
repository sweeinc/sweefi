# SweeFi Architecture & Brand Strategy

**Date**: February 18, 2026
**Status**: Canonical — supersedes any prior @sweepay references

---

## The Rename History

This project was originally built as `sweepay-project` with `@sweepay/*` packages.
It was renamed to `sweefi` after discovering SweePay AG (Swiss Bitcoin payments company).

Research confirmed SweePay AG also has active European trademark registration (EUIPO).
Decision: keep `@sweefi` — it's cleaner, already owned on npm, and avoids any conflict.

---

## The Stack

```
s402                       ← open protocol (unscoped, Apache 2.0, standalone)
  ├── @sweefi/server        ← chain-agnostic HTTP: s402Gate, wrapFetchWithS402
  └── @sweefi/ui-core       ← UI state machine + PaymentAdapter interface
        ├── @sweefi/sui     ← Sui adapter (40 PTB builders, SuiPaymentAdapter)
        │     ├── @sweefi/mcp ← MCP tools for AI agents (30+5 opt-in)
        │     └── @sweefi/cli ← CLI (wallet, pay, prepaid, mandates)
        ├── @sweefi/vue     ← Vue 3 plugin + useSweefiPayment()
        └── @sweefi/react   ← React context + useSweefiPayment()

@sweefi/facilitator         ← self-hostable settlement service (Docker/Fly.io, not on npm)

─────────────────────────────────────────────────────

SweeFi (future)         ← for-profit DeFi product built ON TOP of @sweefi/*
SweeWorld               ← for-profit agent marketplace (for-profit)
SweeCard (backburner)   ← future TradFi/crypto bridge card
```

---

## SweeFi vs @sweefi/* — The Stripe Analogy

| Layer | What It Is | Model |
|-------|-----------|-------|
| `s402` | Open protocol standard (like HTTP) | Apache 2.0, free forever |
| `@sweefi/*` | Open source payment SDK family (the Stripe) | Apache 2.0, free to use |
| `SweeFi` (future) | Consumer DeFi product (the Cash App) | For-profit, closed |
| `SweeWorld` | Agent marketplace | For-profit, closed |

**How Stripe makes money with open SDKs:**
Stripe's `stripe-node`, `stripe-js` etc. are MIT open source. But Stripe charges
2.9% + 30¢ per transaction through their proprietary network. The SDK is the
distribution mechanism — it creates adoption. The moat is the service behind it.

Applied to SweeFi:
- `@sweefi/*` (open) → creates developer adoption → feeds s402 ecosystem
- Protocol fees on s402 transactions → revenue
- SweeFi yield product (closed) → revenue
- SweeWorld marketplace (closed) → revenue

**The open source SDK is the distribution strategy, not the product.**

---

## npm Org Strategy

| Package | Scope | Visibility |
|---------|-------|-----------|
| `s402` | unscoped | public |
| `sui-gas-station` | unscoped | public |
| `@sweefi/ui-core` | @sweefi | public |
| `@sweefi/server` | @sweefi | public |
| `@sweefi/sui` | @sweefi | public |
| `@sweefi/vue` | @sweefi | public |
| `@sweefi/react` | @sweefi | public |
| `@sweefi/mcp` | @sweefi | public |
| `@sweefi/cli` | @sweefi | public |
| `@sweefi/facilitator` | @sweefi | private (Docker/Fly.io only) |

---

## Architecture Restructure (Completed 2026-02-20)

The SDK was restructured from a monolithic `@sweefi/sdk` into a role-based package family:

- `@sweefi/sdk` → renamed to **`@sweefi/server`** (chain-agnostic HTTP only; Sui-specific exports moved to `@sweefi/sui`)
- `@sweefi/widget` → **deleted**; tests migrated to `@sweefi/ui-core`, `@sweefi/vue`, `@sweefi/react`
- **`@sweefi/ui-core`** → new package: framework-agnostic state machine + `PaymentAdapter` interface
- **`@sweefi/vue`** → new package: Vue 3 `SweefiPlugin` + `useSweefiPayment()` composable
- **`@sweefi/react`** → new package: React `SweefiProvider` + `useSweefiPayment()` hook (via `useSyncExternalStore`)

See `docs/SDK-ARCHITECTURE-RESTRUCTURE.md` for the full plan and execution log.

---

## GitHub

- Org: `sweeinc` (not Danny-Devs)
- Repo: `github.com/sweeinc/sweefi` (private)
- Transferred: February 18, 2026

---

## Licensing

All open source packages: **Apache 2.0** (includes explicit patent grant — critical
for financial software). MIT was considered but Apache 2.0 is better for a
payments protocol.

---

## Trademark Status

| Mark | Status | Notes |
|------|--------|-------|
| `SWEEFI` | File ITU at USPTO | Class 036 (financial services) |
| `@sweefi` npm | Owned | ✅ |
| `sweefi.com` | Buy | Priority |
| `SweePay` | Do NOT use | SweePay AG has EUIPO registration |
| `SWEE` | Pending (Class 036) | Swee Technologies (golf) owns Classes 009/041 |
