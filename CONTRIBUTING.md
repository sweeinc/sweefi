# Contributing to SweeFi

Thanks for your interest in contributing to SweeFi! This project is open-source under Apache 2.0.

## Getting Started

```bash
git clone https://github.com/sweeinc/sweefi.git
cd sweefi
pnpm install
pnpm build
pnpm test
```

**Requirements**: Node.js >= 20, pnpm >= 9. Move contracts require the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install).

## Development

```bash
pnpm -r typecheck          # Typecheck all packages
pnpm -r test               # Run all TS tests
cd contracts && sui move test  # Run Move tests
pnpm --filter @sweefi/sui test  # Single package
```

## Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code, add tests
3. Ensure `pnpm typecheck`, `pnpm test`, and `sui move test` all pass
4. Write a clear PR description explaining what and why

## Move Contracts

Move contract changes require extra care since they handle real funds on-chain:

- All fee calculations use `u128` intermediates (see `math.move`)
- Fee unit is micro-percent (0–1,000,000 where 1,000,000 = 100%)
- Run the full Move test suite: `cd contracts && sui move test`
- Read the relevant ADR in `docs/adr/` before changing load-bearing design decisions

## Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning. If your PR changes user-visible behavior, add a changeset:

```bash
pnpm changeset
```

## Code of Conduct

Be respectful and constructive. We're building the future of autonomous payments — let's do it with integrity.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 license.
