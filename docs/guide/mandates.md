# Mandates (AP2)

Spending authorization for AI agents. A human creates a mandate that limits what an agent can spend — per transaction, daily, weekly, and lifetime caps. Revocable at any time.

## Two Mandate Types

| Type | Module | Use Case |
|------|--------|----------|
| **Basic Mandate** | `mandate.move` | Simple per-tx + lifetime cap |
| **Agent Mandate** | `agent_mandate.move` | L0–L3 progressive autonomy with daily/weekly caps |

Both are compatible with Google's [AP2 agent payment protocol](https://developers.google.com/payments/agent-payments). See [@sweefi/ap2-adapter](/guide/ap2-adapter) for the bridge.

## Basic Mandates

Simple delegation: per-transaction limit + lifetime total.

```typescript
import {
  buildCreateMandateTx,
  buildMandatedPayTx,
  buildCreateRegistryTx,
  buildRevokeMandateTx,
  testnetConfig,
} from '@sweefi/sui/ptb';

// 1. Human creates mandate for AI agent
const createTx = buildCreateMandateTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: humanAddress,
  delegate: agentAddress,
  maxPerTx: 1_000_000n,        // 0.001 SUI per transaction
  maxTotal: 100_000_000n,      // 0.1 SUI lifetime cap
  expiresAtMs: BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
});

// 2. Agent pays using the mandate
const payTx = buildMandatedPayTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  recipient: merchantAddress,
  amount: 500_000n,
  mandateId: '0xMANDATE_ID',
  registryId: '0xREGISTRY_ID',
  feeMicroPercent: 0,
  feeRecipient: humanAddress,
});
```

### Revocation

Create a `RevocationRegistry` and use it to instantly kill any mandate:

```typescript
// Create registry (once per delegator)
const registryTx = buildCreateRegistryTx(testnetConfig, {
  sender: humanAddress,
});

// Revoke mandate (instant, on-chain)
const revokeTx = buildRevokeMandateTx(testnetConfig, {
  sender: humanAddress,
  mandateId: '0xMANDATE_ID',
  registryId: '0xREGISTRY_ID',
});
```

**Critical**: `is_id_revoked(registry, id)` does NOT check `registry.owner == mandate.delegator`. All callers must assert ownership BEFORE calling it. This was the V8 H-1 security fix — a rogue delegate could bypass revocation by passing an empty registry they own.

## Agent Mandates (L0–L3)

Progressive autonomy with daily and weekly spending caps. The mandate level determines what the agent can do:

| Level | Name | Capabilities |
|-------|------|-------------|
| **L0** | Read-Only | Check balances, view history. No spending. |
| **L1** | Monitor | L0 + notifications. No spending. |
| **L2** | Capped | L1 + spending within per-tx, daily, weekly, and lifetime caps |
| **L3** | Autonomous | Full spending authority (still within caps) |

### Create an Agent Mandate

```typescript
import { buildCreateAgentMandateTx } from '@sweefi/sui/ptb';

const tx = buildCreateAgentMandateTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: humanAddress,
  delegate: agentAddress,
  level: 2,                      // L2: Capped
  maxPerTx: 1_000_000n,         // 0.001 SUI per transaction
  dailyLimit: 10_000_000n,      // 0.01 SUI per day
  weeklyLimit: 50_000_000n,     // 0.05 SUI per week
  maxTotal: 500_000_000n,       // 0.5 SUI lifetime
  expiresAtMs: BigInt(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
});
```

### Pay with Agent Mandate

```typescript
import { buildAgentMandatedPayTx } from '@sweefi/sui/ptb';

const tx = buildAgentMandatedPayTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: agentAddress,
  recipient: merchantAddress,
  amount: 500_000n,
  mandateId: '0xAGENT_MANDATE_ID',
  registryId: '0xREGISTRY_ID',
  feeMicroPercent: 0,
  feeRecipient: humanAddress,
});
```

### Upgrade Level (Delegator Only)

Levels can only go up (L0 → L1 → L2 → L3), never down:

```typescript
import { buildUpgradeMandateLevelTx } from '@sweefi/sui/ptb';

const tx = buildUpgradeMandateLevelTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: humanAddress,
  mandateId: '0xAGENT_MANDATE_ID',
  newLevel: 3,  // Upgrade to L3: Autonomous
});
```

### Update Caps (Delegator Only)

```typescript
import { buildUpdateMandateCapsTx } from '@sweefi/sui/ptb';

const tx = buildUpdateMandateCapsTx(testnetConfig, {
  coinType: '0x2::sui::SUI',
  sender: humanAddress,
  mandateId: '0xAGENT_MANDATE_ID',
  newMaxPerTx: 5_000_000n,
  newDailyLimit: 50_000_000n,
  newWeeklyLimit: 200_000_000n,
  newMaxTotal: 1_000_000_000n,
});
```

### Lazy Reset

Daily and weekly counters reset lazily — the reset happens at the next `validate_and_spend()` call when a day/week has elapsed, not on a timer. This avoids scheduled transactions.

```
last_daily_reset_ms = 1708900000000
now = 1708990000000  (>24h later)
→ daily_spent resets to 0 before spending
```

## On-Chain Types

### Mandate (Owned by delegate)

```
Fields:
  delegator: address
  delegate: address
  max_per_tx: u64
  max_total: u64
  total_spent: u64
  expires_at_ms: Option<u64>
```

### AgentMandate (Owned by delegate)

```
Fields:
  delegator: address
  delegate: address
  level: u8              — 0 (Read-Only) to 3 (Autonomous)
  max_per_tx: u64
  daily_limit: u64
  daily_spent: u64
  last_daily_reset_ms: u64
  weekly_limit: u64
  weekly_spent: u64
  last_weekly_reset_ms: u64
  max_total: u64
  total_spent: u64
  expires_at_ms: Option<u64>
```

### RevocationRegistry (Shared)

```
Fields:
  owner: address
  // Dynamic fields: RevokedKey(ID) → true
```

## Error Codes

### Basic Mandate (400-series)

| Code | Name | Meaning |
|------|------|---------|
| 400 | `ENotDelegate` | Caller is not the delegate |
| 401 | `EExpired` | Mandate has expired |
| 402 | `EPerTxLimitExceeded` | Amount > max_per_tx |
| 403 | `ETotalLimitExceeded` | Would exceed lifetime cap |
| 404 | `ENotDelegator` | Caller is not the delegator |
| 405 | `ERevoked` | Mandate has been revoked |

### Agent Mandate (500-series)

| Code | Name | Meaning |
|------|------|---------|
| 500 | `ENotDelegate` | Caller is not the delegate |
| 501 | `EExpired` | Mandate has expired |
| 506 | `EDailyLimitExceeded` | Would exceed daily cap |
| 507 | `EWeeklyLimitExceeded` | Would exceed weekly cap |
| 508 | `EInvalidLevel` | Level not in 0–3 |
| 509 | `ELevelNotAuthorized` | Level too low for operation |
| 510 | `ECannotDowngrade` | Level can only increase |

## Next Steps

- [@sweefi/ap2-adapter](/guide/ap2-adapter) — Bridge AP2 intents to on-chain mandates
- [Fee & Trust Model](/guide/fee-ownership) — How fees work
- [Move Modules](/guide/contracts) — Full contract reference
- [@sweefi/mcp](/guide/mcp) — Mandate tools for AI agents
