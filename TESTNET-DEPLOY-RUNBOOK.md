# SweeFi v8 — Testnet Deploy & npm Publish Runbook

> **Date written:** 2026-02-21
> **Package:** sweefi (edition 2024.beta, Sui mainnet-v1.62.1 framework)
> **Current live version:** v7 (`0x242f...54c3d`) — uses `sweefi::*` modules
> **What changes in v8:** Signed receipts v0.2 + Security Reviews A/B/C fixes
> **Type of deploy:** Fresh publish (NOT upgrade) — new package ID every time

---

## Before You Start — Read This

A "fresh publish" means you run `sui client publish` and get a **brand new package ID**. There is no upgrade path. The old v7 package stays live forever (Sui is immutable). Any new PTB calls should use the v8 ID going forward.

You need:
1. A funded testnet keypair
2. npm account (`dannydevs`) + `@sweefi` org (already owned)
3. About 30 minutes

---

## Part 1 — Prerequisites

### 1a. Verify Sui CLI + active keypair

```bash
# Check CLI version (need 1.40+)
sui --version

# Check your active address
sui client active-address

# Check active environment is testnet
sui client active-env
```

Expected output for env: `testnet` (or similar). If it says `devnet` or `mainnet`, switch:

```bash
sui client switch --env testnet
```

If you have no testnet environment set up:

```bash
sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
sui client switch --env testnet
```

### 1b. Generate a keypair (if you don't have one with testnet SUI)

```bash
# Generate new Ed25519 keypair — save the mnemonic shown in the output
sui client new-address ed25519
```

The output shows:
```
╭─────────────────────────────────────────────────────────────────────────────────╮
│ Created new keypair and saved it to keystore.                                   │
│ ╭────────────────┬────────────────────────────────────────────────────────────╮ │
│ │ alias          │ <some-name>                                                │ │
│ │ suiAddress     │ 0x<your-new-address>                                       │ │
│ │ keyScheme      │ ed25519                                                    │ │
│ │ mnemonic       │ word word word word word ... (24 words)                   │ │
│ ╰────────────────┴────────────────────────────────────────────────────────────╯ │
╰─────────────────────────────────────────────────────────────────────────────────╯
```

**Save the mnemonic now.** It's shown once.

Switch to the new address if you want to use it:

```bash
sui client switch --address 0x<your-new-address>
```

### 1c. Get testnet SUI from faucet

```bash
# Option A: CLI faucet request
sui client faucet

# Option B: Web faucet (paste your address)
# https://faucet.triangleplatform.com/sui/testnet
# or https://suifaucet.xyz
```

Verify you received SUI:

```bash
sui client gas
```

You need at least 0.5 SUI (500,000,000 MIST) for the publish gas budget.

### 1d. Verify all tests pass before publishing anything

```bash
# From the sweefi project root
cd /Users/dannydevs/repos/danny/projects/sweefi-project/sweefi

# Move tests (requires Sui CLI)
cd contracts
sui move test
cd ..

# TypeScript tests (all packages)
pnpm test

# Typecheck
pnpm typecheck
```

All 3 must be green before proceeding. Do not publish broken code.

### 1e. npm login + @sweeinc org

```bash
# Verify you're logged in as dannydevs
npm whoami
# Expected: dannydevs

# If not logged in:
npm login
# (enter username: dannydevs, password, OTP)

# Create @sweeinc org (run once, ~2 min)
# Option A: CLI
npm org create sweeinc
# Option B: Web → https://www.npmjs.com/org/create → "sweeinc"

# Verify @sweefi org still owned (sanity check)
npm org ls @sweefi
```

---

## Part 2 — Move Contract Deploy (v8)

### Step 1: Build first

```bash
cd /Users/dannydevs/repos/danny/projects/sweefi-project/sweefi/contracts

# Build without publishing (verify no compile errors)
sui move build
```

Expected: `Build Successful` with no warnings about unused variables or deprecated patterns.

### Step 2: Publish to testnet

```bash
# This is the real deploy — gas budget 500M MIST = 0.5 SUI
sui client publish --gas-budget 500000000
```

**The output is long. You need three things from it. Copy the entire output to a text file first:**

```bash
# Save output to a file so you can refer back to it
sui client publish --gas-budget 500000000 2>&1 | tee ~/Desktop/sweefi-v8-deploy.txt
```

### Step 3: Extract IDs from publish output

In the terminal output, look for:

```
----- Transaction Digest ----
<tx-digest>

----- Transaction Effects ----
...
Published Objects:
  ┌──
  │ PackageID: 0x<NEW-PACKAGE-ID>
  │ Version: 1
  │ Digest: ...
  └──

----- Object changes ----
Created Objects:
  ┌──
  │ ObjectID: 0x<PROTOCOL-STATE-ID>
  │ Type: 0x<pkg>::admin::ProtocolState
  │ Owner: Shared
  └──
  ┌──
  │ ObjectID: 0x<ADMIN-CAP-ID>
  │ Type: 0x<pkg>::admin::AdminCap
  │ Owner: Account Address (your address)
  └──
  ┌──
  │ ObjectID: 0x<UPGRADE-CAP-ID>
  │ Type: 0x2::package::UpgradeCap
  │ Owner: Account Address (your address)
  └──
```

Write down all four values:
- `PACKAGE_ID` = the PackageID from "Published Objects"
- `PROTOCOL_STATE_ID` = the AdminState SharedObject
- `ADMIN_CAP_ID` = the AdminCap (your address owns it)
- `UPGRADE_CAP_ID` = the UpgradeCap (your address owns it)

### Step 4: Update deployments.ts

Open: `packages/sui/src/ptb/deployments.ts`

Add v8 entries and update the canonical pointer:

```typescript
/** Sui Testnet v8 — signed receipts v0.2 + Security A/B/C fixes (2026-02-21) */
export const TESTNET_PACKAGE_ID_V8 =
  "0x<PASTE-NEW-PACKAGE-ID-HERE>";

// Update the canonical pointer (was V7, now V8):
export const TESTNET_PACKAGE_ID =
  "0x<PASTE-NEW-PACKAGE-ID-HERE>";  // same value as V8

export const TESTNET_ADMIN_CAP =
  "0x<PASTE-ADMIN-CAP-ID-HERE>";

export const TESTNET_PROTOCOL_STATE =
  "0x<PASTE-PROTOCOL-STATE-ID-HERE>";

export const TESTNET_UPGRADE_CAP =
  "0x<PASTE-UPGRADE-CAP-ID-HERE>";
```

Keep all previous `TESTNET_PACKAGE_ID_V1` through `TESTNET_PACKAGE_ID_V7` — historical record.

### Step 5: Verify the deploy

```bash
# Verify the package exists on-chain
sui client object 0x<NEW-PACKAGE-ID>

# Verify the ProtocolState shared object
sui client object 0x<PROTOCOL-STATE-ID>

# Verify your AdminCap (you should own it)
sui client object 0x<ADMIN-CAP-ID>
```

Each should return object details without errors. If any return "object not found", the publish failed — check `~/Desktop/sweefi-v8-deploy.txt` for error messages.

### Step 6: Rebuild TypeScript packages (picks up new IDs)

```bash
cd /Users/dannydevs/repos/danny/projects/sweefi-project/sweefi

# Rebuild everything after updating deployments.ts
pnpm build

# Re-run tests to confirm the new IDs are wired correctly
pnpm test
```

All tests must still pass. If they don't, fix before publishing to npm.

---

## Part 3 — npm Publish (Dependency Order)

> **Why order matters:** `@sweefi/sui` depends on `@sweefi/server` and `@sweefi/ui-core` via
> `workspace:*`. pnpm replaces `workspace:*` with the actual version at publish time.
> npm must resolve those versions when someone installs `@sweefi/sui`. Publish leaf
> packages first or consumers get install errors.

**Full dependency graph (publish bottom-up):**
```
s402 (external — already published at ^0.1.6)
  ├── @sweefi/ui-core    (leaf — depends only on s402)
  ├── @sweefi/server     (leaf — depends only on s402)
  └── @sweefi/sui        (depends on server + ui-core)
        ├── @sweefi/mcp      (depends on sui)
        ├── @sweefi/cli      (depends on sui)
        └── @sweefi/facilitator (depends on sui — open-source, Apache 2.0)

@sweefi/ui-core (separately):
  ├── @sweefi/react      (depends on ui-core)
  ├── @sweefi/vue        (depends on ui-core)
  └── @sweefi/solana     (depends on ui-core — Solana adapter, exact scheme)
```

### Dry-run first (no actual publish)

```bash
cd /Users/dannydevs/repos/danny/projects/sweefi-project/sweefi

# Dry-run all packages to verify what would be published
pnpm --filter @sweefi/ui-core publish --dry-run --access public
pnpm --filter @sweefi/server publish --dry-run --access public
pnpm --filter @sweefi/sui publish --dry-run --access public
pnpm --filter @sweefi/react publish --dry-run --access public
pnpm --filter @sweefi/vue publish --dry-run --access public
pnpm --filter @sweefi/mcp publish --dry-run --access public
pnpm --filter @sweefi/cli publish --dry-run --access public
```

> **Note**: `@sweefi/facilitator` is `private: true` — it is NOT published to npm.
> It is deployed via Docker/Fly.io. See the Fly.io section below.

Check each dry-run output. You want to see the list of files that would be uploaded and no errors. `workspace:*` deps should appear as `^0.1.0` (resolved).

### Real publish — in order

**Tier 1 (leaf packages, no internal deps):**

```bash
cd packages/ui-core
pnpm publish --access public
cd ../..

cd packages/server
pnpm publish --access public
cd ../..
```

Wait ~30 seconds after each publish before proceeding. npm registry replication can lag.

**Verify tier 1 landed:**

```bash
npm view @sweefi/ui-core version   # should show 0.1.0
npm view @sweefi/server version    # should show 0.1.0
```

**Tier 2 (@sweefi/sui — depends on tier 1):**

```bash
cd packages/sui
pnpm publish --access public
cd ../..
```

```bash
npm view @sweefi/sui version   # should show 0.1.0
```

**Tier 3 (all depend on @sweefi/sui or @sweefi/ui-core):**

```bash
cd packages/react
pnpm publish --access public
cd ../..

cd packages/vue
pnpm publish --access public
cd ../..

cd packages/solana
pnpm publish --access public
cd ../..

cd packages/mcp
pnpm publish --access public
cd ../..

cd packages/cli
pnpm publish --access public
cd ../..

```

> **Note**: `@sweefi/facilitator` is NOT published — deployed via Docker/Fly.io.

### Verify all packages landed

```bash
for pkg in @sweefi/ui-core @sweefi/server @sweefi/sui @sweefi/react @sweefi/vue @sweefi/solana @sweefi/mcp @sweefi/cli; do
  echo -n "$pkg: "
  npm view $pkg version 2>/dev/null || echo "NOT FOUND"
done
```

---

## Part 4 — Post-Deploy Verification

### 4a. Verify npm install works from scratch

```bash
# Create a fresh temp project
mkdir /tmp/sweefi-verify && cd /tmp/sweefi-verify
npm init -y

# Install the main package
npm install @sweefi/sui @mysten/sui

# Quick smoke test — verify imports resolve
node -e "const { testnetConfig } = require('@sweefi/sui'); console.log('Package ID:', testnetConfig.packageId)"
```

Expected: prints the v8 package ID you set in `deployments.ts`.

Clean up:
```bash
cd ~ && rm -rf /tmp/sweefi-verify
```

### 4b. Live testnet smoke test (optional but recommended)

```bash
cd /Users/dannydevs/repos/danny/projects/sweefi-project/sweefi

# Run the live integration test suite against testnet
# (requires funded keypair — uses SWEEFI_LIVE_TESTNET flag)
SWEEFI_LIVE_TESTNET=1 pnpm --filter @sweefi/sui test:live
```

This runs dryrun tests against the real testnet node using the new v8 package ID.

### 4c. Verify the ProtocolState is accessible

```bash
# Confirm the shared ProtocolState is readable from testnet RPC
sui client object 0x<PROTOCOL-STATE-ID> --json | python3 -m json.tool | grep '"paused"'
```

Should return `"paused": false` (or similar unpause state). If the object returns an error, the deploy is not correct.

---

## Part 5 — Rollback

### If the Move deploy fails

The transaction either succeeds fully or fails fully — Sui transactions are atomic. If publish fails:
1. Check the error in `~/Desktop/sweefi-v8-deploy.txt`
2. Common errors:
   - `InsufficientGas` → increase `--gas-budget` to `1000000000` (1 SUI) and retry
   - `Bytecode verification failed` → there's a bug in the Move source, fix before re-running
   - `Missing dependency` → the Sui framework rev in Move.toml doesn't match testnet, update rev
3. If the publish fails, **nothing is on-chain** — retry freely, it's testnet

### If you published a bad npm package

npm unpublish is only allowed within 72 hours of first publish and only if no other packages depend on it:

```bash
# Unpublish a specific version (not the whole package)
npm unpublish @sweefi/ui-core@0.1.0

# If other packages depend on it, you CANNOT unpublish
# Instead: bump to 0.1.1 with the fix and re-publish
```

To bump a version:
```bash
cd packages/<package-name>
npm version patch  # bumps 0.1.0 → 0.1.1
pnpm publish --access public
```

### If deployments.ts is updated with wrong IDs

1. Fix the IDs in `packages/sui/src/ptb/deployments.ts`
2. Rebuild: `pnpm build`
3. Re-publish `@sweefi/sui` with a patch bump (`npm version patch` in packages/sui)
4. Re-publish all packages that depend on @sweefi/sui with patch bumps

### Recovery priority order

If something goes wrong mid-publish and you need to stop:
1. It's safe to stop after any individual package publish
2. The already-published packages stay live on npm
3. Resume from where you left off — npm publish is idempotent per version (same version can't be re-published, but you haven't changed versions so just continue with unpublished packages)

---

## Reference: What Each Object ID Controls

| Object | Type | Owner | Required for |
|--------|------|-------|--------------|
| `TESTNET_PACKAGE_ID` | Immutable Package | — | All PTB calls |
| `TESTNET_PROTOCOL_STATE` | Shared Object | Global | pay(), stream(), escrow() — pause guard |
| `TESTNET_ADMIN_CAP` | Owned Object | Your keypair | pause/unpause, burn |
| `TESTNET_UPGRADE_CAP` | Owned Object | Your keypair | Future contract upgrades |

> **Security note:** `ADMIN_CAP` and `UPGRADE_CAP` are owned by the keypair you used to deploy.
> Back up the keypair's mnemonic. If you lose it, you lose the ability to pause or upgrade.
> For production mainnet, transfer these to a multisig or hardware-wallet-backed address.

---

## Checklist Summary

```
Prerequisites
[ ] sui client active-env = testnet
[ ] sui client gas ≥ 0.5 SUI
[ ] npm whoami = dannydevs
[ ] @sweeinc org created on npmjs.com
[ ] pnpm test = all green
[ ] pnpm typecheck = 0 errors

Move Deploy
[ ] sui move build = success
[ ] sui client publish = success, output saved to ~/Desktop/sweefi-v8-deploy.txt
[ ] Extracted: PACKAGE_ID, PROTOCOL_STATE, ADMIN_CAP, UPGRADE_CAP
[ ] Updated packages/sui/src/ptb/deployments.ts with v8 IDs
[ ] pnpm build + pnpm test = still green after ID update

npm Publish (in order)
[ ] @sweefi/ui-core published + verified (npm view)
[ ] @sweefi/server published + verified
[ ] @sweefi/sui published + verified
[ ] @sweefi/react published + verified
[ ] @sweefi/vue published + verified
[ ] @sweefi/solana published + verified
[ ] @sweefi/mcp published + verified
[ ] @sweefi/cli published + verified

Post-Deploy
[ ] Fresh npm install smoke test passes
[ ] testnetConfig.packageId matches v8 package ID
[ ] ProtocolState accessible on-chain (not paused)
```
