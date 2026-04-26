# sweeinc/sweefi — MIGRATED (read-only archive)

This repository's contents have been absorbed into **`sweeinc/platform`** under
`products/sweefi/` as part of the Swee Inc v5.2 architecture migration
(2026-04-26).

## Where things went

| Old location (this repo) | New location |
|---|---|
| `packages/sui/` | [`sweeinc/platform/products/sweefi/sui/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/sui) |
| `packages/solana/` | [`sweeinc/platform/products/sweefi/solana/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/solana) |
| `packages/cli/` | [`sweeinc/platform/products/sweefi/cli/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/cli) |
| `packages/hono/` | [`sweeinc/platform/products/sweefi/hono/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/hono) |
| `packages/mcp/` | [`sweeinc/platform/products/sweefi/mcp/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/mcp) |
| `packages/react/` | [`sweeinc/platform/products/sweefi/react/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/react) |
| `packages/vue/` | [`sweeinc/platform/products/sweefi/vue/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/vue) |
| `packages/ap2-adapter/` | [`sweeinc/platform/products/sweefi/ap2-adapter/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/ap2-adapter) |
| `packages/ui-core/` | [`sweeinc/platform/products/sweefi/ui-core/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/ui-core) |
| `packages/facilitator/` | [`sweeinc/platform/products/sweefi/facilitator/`](https://github.com/sweeinc/platform/tree/main/products/sweefi/facilitator) — now publishable as `npx @sweefi/facilitator` |
| `contracts/` (Sui Move) | [`sweeinc/lab/products/sweefi-contracts/move/`](https://github.com/sweeinc/lab) (private) |
| `contracts/solana/` (Anchor) | [`sweeinc/lab/products/sweefi-contracts/solana/`](https://github.com/sweeinc/lab) (private) |

## npm packages — unchanged

All `@sweefi/*` packages publish from `sweeinc/platform`. Versions and names
are unchanged; only the source repository moved.

- [`@sweefi/sui`](https://www.npmjs.com/package/@sweefi/sui)
- [`@sweefi/solana`](https://www.npmjs.com/package/@sweefi/solana)
- [`@sweefi/cli`](https://www.npmjs.com/package/@sweefi/cli)
- [`@sweefi/hono`](https://www.npmjs.com/package/@sweefi/hono)
- [`@sweefi/mcp`](https://www.npmjs.com/package/@sweefi/mcp)
- [`@sweefi/react`](https://www.npmjs.com/package/@sweefi/react)
- [`@sweefi/vue`](https://www.npmjs.com/package/@sweefi/vue)
- [`@sweefi/ap2-adapter`](https://www.npmjs.com/package/@sweefi/ap2-adapter)
- [`@sweefi/ui-core`](https://www.npmjs.com/package/@sweefi/ui-core)
- [`@sweefi/facilitator`](https://www.npmjs.com/package/@sweefi/facilitator) — first npm release

## Why the move

Architecture v5.2 split Swee's repos by **OSS intent** (public vs private),
not by maturity. Mature, audited, ready-to-show code lives in
`sweeinc/platform`; incubator + commercial + strategic-moat code lives in
`sweeinc/lab` (private). One TypeScript monorepo per intent class. Product
cohesion within each repo (`products/{name}/{component}/`).

Full design: [DAN-411](https://linear.app/dannydevs/issue/DAN-411).

## History preservation

This repo is **archived**, not deleted. All commit history remains
browsable here. Cross-repo migrations preserved history via `git
filter-repo --to-subdirectory-filter` where applicable.
