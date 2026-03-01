---
"@sweefi/sui": minor
"@sweefi/mcp": minor
"@sweefi/cli": minor
"@sweefi/ap2-adapter": minor
"@sweefi/react": patch
"@sweefi/vue": patch
"@sweefi/server": patch
"@sweefi/solana": patch
"@sweefi/ui-core": patch
---

Rename `feeBps` → `feeMicroPercent` across all packages

**BREAKING** for `@sweefi/sui`, `@sweefi/mcp`, `@sweefi/cli`, `@sweefi/ap2-adapter`:

- All PTB builder params: `feeBps: number` → `feeMicroPercent: number`
- Range changed: 0–10,000 (bps) → 0–1,000,000 (micro-percent)
- `assertFeeBps()` → `assertFeeMicroPercent()`
- Move contracts: `fee_bps` → `fee_micro_pct` in all struct fields, params, events, accessors
- Facilitator: `FEE_BPS` env var → `FEE_MICRO_PERCENT`, default 50 → 5,000
- MCP tools: Zod schemas updated to accept 0–1,000,000 range

**Migration**: Multiply old BPS values by 100. `bpsToMicroPercent()` is available as a public convenience.

Common values: 50 bps (0.5%) → 5,000 | 100 bps (1%) → 10,000 | 10,000 bps (100%) → 1,000,000
