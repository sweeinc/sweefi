# SweeFi `$extend()` Plugin Architecture

> **Goal**: Refactor `@sweefi/sui` into a Mysten-compatible `$extend()` domain SDK
> **Why**: Payment capabilities should compose with any Sui client, not require a separate SDK. A shared composition pattern across the ecosystem reduces developer learning cost from O(n) to O(1).
> **Created**: 2026-03-11
> **Waves**: 4 complete (v2.0 protocol — SHIPPED)

---

## Why `$extend()`? (First Principles)

The `$extend()` plugin pattern is not adopted because "Mysten does it." It is adopted because it solves three real problems:

1. **Composition over construction**: Payments are a cross-cutting capability, not a standalone application. A developer building a dApp already has a `SuiGrpcClient`. Asking them to construct a second client object creates config duplication (network, RPC URL) and a "two worlds" mental model. `$extend()` says: "add payments to your existing client."

2. **Ecosystem coherence**: When DeepBook, Walrus, SuiNS, Kiosk, and SweeFi all follow the same pattern, a developer who learns one learns all. The total learning cost across N SDKs drops from O(N) (N different APIs) to O(1) (one pattern, N namespaces).

3. **Transport agnosticism for free**: By receiving `ClientWithCoreApi` (which wraps `CoreClient`), SweeFi's query modules work identically across gRPC, GraphQL, and JSON-RPC. No transport-specific code in the payment SDK.

**One entry point. One pattern.**

```typescript
import { sweefi } from '@sweefi/sui';
```

`SweefiClient` is also exported for testing and advanced use (direct construction with mocked dependencies), but all documentation, README examples, and guides show the `$extend()` path.

---

## The Vision

```typescript
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { sweefi } from '@sweefi/sui';

// Zero-config for testnet/mainnet (package IDs auto-filled):
const client = new SuiGrpcClient({ network: 'testnet' })
  .$extend(sweefi());

// Or with custom config (localnet, custom deployment):
// .$extend(sweefi({ packageId: '0x...', protocolState: '0x...' }))

// === Transaction builders (curried: params → (tx) → void) ===
const tx = new Transaction();
tx.add(client.sweefi.payment.pay({ amount: 1_000_000_000n, ... }));
tx.add(client.sweefi.stream.create({ ratePerSecond: 100n, ... }));
tx.add(client.sweefi.escrow.create({ deadline: Date.now() + 86400_000, ... }));

// === Queries (async, transport-agnostic via client.core) ===
const stream = await client.sweefi.getStream('0xstreamId');
const mandate = await client.sweefi.getMandate('0xmandateId');

// === Composable flows (return TransactionResult for chaining in same PTB) ===
const receipt = tx.add(client.sweefi.payment.payComposable({ ... }));
tx.moveCall({                                     // atomic pay + SEAL decryption
  target: `${packageId}::seal_policy::seal_approve`,
  arguments: [tx.object(policyId), receipt],
});

// === Composes with other $extend() SDKs ===
const fullClient = new SuiGrpcClient({ network: 'mainnet' })
  .$extend(sweefi())
  .$extend(deepbook({ address: '0x...' }));
// fullClient.sweefi.* AND fullClient.deepbook.* both work
```

---

## Architecture: Following the DeepBook Pattern

### File Structure

```
packages/sui/src/
├── index.ts                          # Exports sweefi() factory + all public types
├── client.ts                         # sweefi() factory + SweefiClient class
├── types.ts                          # All public interfaces (options, params, return types)
│
├── transactions/                     # Transaction builder contracts (curried: params → tx → void)
│   ├── payment.ts                    # PaymentContract — pay, payComposable, createInvoice, payInvoice
│   ├── stream.ts                     # StreamContract — create, claim, pause, resume, close, topUp
│   ├── escrow.ts                     # EscrowContract — create, release, refund, dispute
│   ├── prepaid.ts                    # PrepaidContract — deposit, claim, withdrawal flow, dispute, close
│   ├── mandate.ts                    # MandateContract — create, mandatedPay, revoke, createRegistry
│   ├── agentMandate.ts               # AgentMandateContract — create, pay, upgrade, updateCaps
│   ├── admin.ts                      # AdminContract — pause, unpause, autoUnpause, burnCap
│   └── identity.ts                   # IdentityContract — register, recordReceipt
│
├── queries/                          # Read-only query modules (simulate + BCS parse)
│   ├── context.ts                    # QueryContext interface
│   ├── balanceQueries.ts             # Check balances, token support
│   ├── streamQueries.ts              # Stream state: remaining, accrued
│   ├── escrowQueries.ts              # Escrow state inspection
│   ├── prepaidQueries.ts             # Prepaid balance + claim status
│   ├── mandateQueries.ts             # Mandate limits, usage, registry
│   └── protocolQueries.ts            # Protocol pause state, admin info
│
├── utils/
│   ├── config.ts                     # SweefiConfig class (network-specific data)
│   ├── constants.ts                  # Package IDs, coin types, deployments per network
│   ├── errors.ts                     # SweefiError hierarchy
│   ├── assert.ts                     # Fee/amount validation (existing)
│   └── receipts.ts                   # v0.2 signed receipt utilities (existing)
│
├── types/
│   └── bcs.ts                        # BCS type definitions matching Move struct layouts
│
├── s402/                             # s402 scheme implementations (UNCHANGED)
│   └── index.ts                      # Exact, Prepaid, Stream, Escrow, Unlock schemes
│
└── adapter/                          # SuiPaymentAdapter (UNCHANGED)
    └── SuiPaymentAdapter.ts
```

### Key Design Decisions

#### 1. The Factory Function + Public API Interface

The factory returns `SweefiPublicAPI`, not the raw `SweefiClient` class. This is both a security boundary (internal methods stay internal) and a documentation contract (the interface IS the public surface).

```typescript
// client.ts
import type { ClientWithCoreApi, SuiClientRegistration, SuiClientTypes } from '@mysten/sui/client';

export interface SweefiOptions<Name = 'sweefi'> {
  packageId?: string;           // Deployed package ID (auto-filled for testnet/mainnet)
  protocolState?: string;       // Protocol state object (auto-filled for known networks)
  adminCap?: string;            // Optional: admin capabilities
  coinTypes?: Record<string, CoinConfig>;  // Custom coin configs
  name?: Name;                  // Custom namespace (default: 'sweefi')
}

/** The public API surface exposed via $extend(). This is the contract — not SweefiClient. */
export interface SweefiPublicAPI {
  // Transaction builder namespaces
  readonly payment: PaymentContract;
  readonly stream: StreamContract;
  readonly escrow: EscrowContract;
  readonly prepaid: PrepaidContract;
  readonly mandate: MandateContract;
  readonly agentMandate: AgentMandateContract;
  readonly admin: AdminContract;
  readonly identity: IdentityContract;

  // Query delegates
  getBalance(owner: string, coinType: string): Promise<bigint>;
  getStream(streamId: string): Promise<StreamState>;
  getEscrow(escrowId: string): Promise<EscrowState>;
  getPrepaidBalance(balanceId: string): Promise<PrepaidState>;
  getMandate(mandateId: string): Promise<MandateState>;
  isProtocolPaused(): Promise<boolean>;
}

export function sweefi<Name extends string = 'sweefi'>(
  options?: SweefiOptions<Name>,
): SuiClientRegistration<ClientWithCoreApi, Name, SweefiPublicAPI> {
  const { name = 'sweefi' as Name, ...rest } = options ?? {};
  return {
    name,
    register: (client) => {
      return new SweefiClient({
        client,
        network: client.network,
        ...rest,
      });
    },
  };
}
```

`SweefiClient` implements `SweefiPublicAPI` and is exported for testing/advanced use, but the factory's return type is the interface, not the class.

#### 2. The Client Class

```typescript
/** Exported for testing/advanced use. Most users go through sweefi() + $extend(). */
export class SweefiClient implements SweefiPublicAPI {
  // === Public transaction builder properties (like DeepBook) ===
  payment: PaymentContract;
  stream: StreamContract;
  escrow: EscrowContract;
  prepaid: PrepaidContract;
  mandate: MandateContract;
  agentMandate: AgentMandateContract;
  admin: AdminContract;
  identity: IdentityContract;

  // === Private query modules ===
  #balanceQueries: BalanceQueries;
  #streamQueries: StreamQueries;
  #escrowQueries: EscrowQueries;
  #prepaidQueries: PrepaidQueries;
  #mandateQueries: MandateQueries;
  #protocolQueries: ProtocolQueries;

  constructor(options: SweefiOptions & { client: ClientWithCoreApi; network: SuiClientTypes.Network }) {
    const config = new SweefiConfig(options);

    // Transaction builders — public, domain-grouped
    this.payment = new PaymentContract(config);
    this.stream = new StreamContract(config);
    this.escrow = new EscrowContract(config);
    this.prepaid = new PrepaidContract(config);
    this.mandate = new MandateContract(config);
    this.agentMandate = new AgentMandateContract(config);
    this.admin = new AdminContract(config);
    this.identity = new IdentityContract(config);

    // Query context — only the contracts that queries actually simulate through
    const ctx: QueryContext = {
      client: options.client,
      config,
    };

    this.#balanceQueries = new BalanceQueries(ctx);
    this.#streamQueries = new StreamQueries(ctx);
    this.#escrowQueries = new EscrowQueries(ctx);
    this.#prepaidQueries = new PrepaidQueries(ctx);
    this.#mandateQueries = new MandateQueries(ctx);
    this.#protocolQueries = new ProtocolQueries(ctx);
  }

  // === Public query delegates ===

  getBalance(owner: string, coinType: string): Promise<bigint> {
    return this.#balanceQueries.getBalance(owner, coinType);
  }

  getStream(streamId: string): Promise<StreamState> {
    return this.#streamQueries.getStream(streamId);
  }

  getEscrow(escrowId: string): Promise<EscrowState> {
    return this.#escrowQueries.getEscrow(escrowId);
  }

  getPrepaidBalance(balanceId: string): Promise<PrepaidState> {
    return this.#prepaidQueries.getPrepaidBalance(balanceId);
  }

  getMandate(mandateId: string): Promise<MandateState> {
    return this.#mandateQueries.getMandate(mandateId);
  }

  isProtocolPaused(): Promise<boolean> {
    return this.#protocolQueries.isPaused();
  }
}
```

#### 3. Transaction Builder Contract (Curried Pattern)

Following DeepBook's `method = (params) => (tx: Transaction) => void`.

**Important**: Builders use **named param types** from `types.ts` (re-exported from existing `ptb/types.ts`), not inline objects. This matches DeepBook's pattern of exporting `PlaceLimitOrderParams`, `SwapParams`, etc.

The return type distinguishes mutation from composition:
- `(tx: Transaction) => void` — mutates the transaction (no return)
- `(tx: Transaction) => TransactionResult` — returns a result for chaining

```typescript
// transactions/payment.ts
import type { Transaction, TransactionResult } from '@mysten/sui/transactions';
import { coinWithBalance } from '@mysten/sui/transactions';
import type { SweefiConfig } from '../utils/config.js';
import type { PayParams } from '../types.js';

export class PaymentContract {
  #config: SweefiConfig;

  constructor(config: SweefiConfig) {
    this.#config = config;
  }

  /**
   * Direct payment with fee split. Receipt auto-transferred to sender.
   * @returns Thunk that mutates the transaction (use with tx.add() or call directly)
   */
  pay = (params: PayParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    const memo = typeof params.memo === 'string'
      ? new TextEncoder().encode(params.memo)
      : params.memo ?? new Uint8Array();

    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    tx.moveCall({
      target: `${this.#config.packageId}::payment::pay_and_keep`,
      typeArguments: [params.coinType],
      arguments: [
        coin,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.amount),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.vector('u8', Array.from(memo)),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  /**
   * Composable payment — returns receipt TransactionResult for use in same PTB.
   * Example: atomic pay + SEAL access in one transaction.
   *
   * Usage:
   *   const receipt = tx.add(client.sweefi.payment.payComposable({ ... }));
   *   // receipt is a TransactionResult — pass it to seal_policy::seal_approve
   */
  payComposable = (params: PayParams): ((tx: Transaction) => TransactionResult) => (tx: Transaction) => {
    const memo = typeof params.memo === 'string'
      ? new TextEncoder().encode(params.memo)
      : params.memo ?? new Uint8Array();

    const coin = coinWithBalance({ type: params.coinType, balance: params.amount });

    return tx.moveCall({
      target: `${this.#config.packageId}::payment::pay`,
      typeArguments: [params.coinType],
      arguments: [
        coin,
        tx.pure.address(params.recipient),
        tx.pure.u64(params.amount),
        tx.pure.u64(params.feeMicroPercent),
        tx.pure.address(params.feeRecipient),
        tx.pure.vector('u8', Array.from(memo)),
        tx.object(this.#config.SUI_CLOCK),
      ],
    });
  };

  createInvoice = (params: CreateInvoiceParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    // ... similar pattern
  };

  payInvoice = (params: PayInvoiceParams): ((tx: Transaction) => void) => (tx: Transaction) => {
    // ... similar pattern
  };
}
```

#### 4. Query Module Pattern

Query modules use `client.core.getObjects()` with `include: { content: true }` for BCS parsing. The `content` field returns raw `Uint8Array` bytes across all transports (gRPC, GraphQL, JSON-RPC).

```typescript
// queries/context.ts
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { SweefiConfig } from '../utils/config.js';

export interface QueryContext {
  client: ClientWithCoreApi;
  config: SweefiConfig;
}
```

```typescript
// queries/streamQueries.ts
import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { StreamingMeterBcs } from '../types/bcs.js';

export interface StreamState {
  payer: string;
  recipient: string;
  ratePerSecond: bigint;
  budgetCap: bigint;
  totalClaimed: bigint;
  lastClaimMs: bigint;
  createdAtMs: bigint;
  active: boolean;
  pausedAtMs: bigint;
  feeMicroPct: bigint;
  feeRecipient: string;
}

export class StreamQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getStream(streamId: string): Promise<StreamState> {
    const result = await this.#ctx.client.core.getObjects({
      objectIds: [streamId],
      include: { content: true },  // Returns raw BCS bytes as Uint8Array
    });
    const obj = result.objects[0];
    if (!obj?.content) throw new ResourceNotFoundError('StreamingMeter', streamId);

    const parsed = StreamingMeterBcs.parse(obj.content);  // content is already Uint8Array
    return {
      payer: parsed.payer,
      recipient: parsed.recipient,
      ratePerSecond: parsed.rate_per_second,
      budgetCap: parsed.budget_cap,
      totalClaimed: parsed.total_claimed,
      lastClaimMs: parsed.last_claim_ms,
      createdAtMs: parsed.created_at_ms,
      active: parsed.active,
      pausedAtMs: parsed.paused_at_ms,
      feeMicroPct: parsed.fee_micro_pct,
      feeRecipient: parsed.fee_recipient,
    };
  }
}
```

#### 5. BCS Type Definitions (Matching Move Structs)

Every query module parses on-chain objects via BCS, not raw `fields as Record<string, unknown>`. These definitions must exactly match the Move struct field order and types.

```typescript
// types/bcs.ts
import { bcs } from '@mysten/sui/bcs';

/** Matches `stream::StreamingMeter<T>` (contracts/sources/stream.move:77-91) */
export const StreamingMeterBcs = bcs.struct('StreamingMeter', {
  id: bcs.Address,  // UID serializes as address
  payer: bcs.Address,
  recipient: bcs.Address,
  balance: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T> is a struct, not bare u64
  rate_per_second: bcs.u64(),
  budget_cap: bcs.u64(),
  total_claimed: bcs.u64(),
  last_claim_ms: bcs.u64(),
  created_at_ms: bcs.u64(),
  active: bcs.bool(),
  paused_at_ms: bcs.u64(),
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
});

/** Matches `escrow::Escrow<T>` (contracts/sources/escrow.move:102-115) */
export const EscrowBcs = bcs.struct('Escrow', {
  id: bcs.Address,
  buyer: bcs.Address,
  seller: bcs.Address,
  arbiter: bcs.Address,
  balance: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T>
  amount: bcs.u64(),
  deadline_ms: bcs.u64(),
  state: bcs.u8(),       // 0=Active, 1=Released, 2=Refunded, 3=Disputed
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
  created_at_ms: bcs.u64(),
  description: bcs.vector(bcs.u8()),
});

/** Matches `prepaid::PrepaidBalance<T>` (contracts/sources/prepaid.move:138-162) */
export const PrepaidBalanceBcs = bcs.struct('PrepaidBalance', {
  id: bcs.Address,
  agent: bcs.Address,
  provider: bcs.Address,
  deposited: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T>
  rate_per_call: bcs.u64(),
  claimed_calls: bcs.u64(),
  max_calls: bcs.u64(),
  last_claim_ms: bcs.u64(),
  withdrawal_delay_ms: bcs.u64(),
  withdrawal_pending: bcs.bool(),
  withdrawal_requested_ms: bcs.u64(),
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
  provider_pubkey: bcs.vector(bcs.u8()),
  dispute_window_ms: bcs.u64(),
  pending_claim_count: bcs.u64(),
  pending_claim_amount: bcs.u64(),
  pending_claim_fee: bcs.u64(),
  pending_claim_ms: bcs.u64(),
  disputed: bcs.bool(),
});

/** Matches `payment::Invoice` (contracts/sources/payment.move:42-49) */
export const InvoiceBcs = bcs.struct('Invoice', {
  id: bcs.Address,
  creator: bcs.Address,
  recipient: bcs.Address,
  expected_amount: bcs.u64(),
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
});

/** Matches `mandate::Mandate<T>` (contracts/sources/mandate.move:46-54) */
export const MandateBcs = bcs.struct('Mandate', {
  id: bcs.Address,
  delegator: bcs.Address,
  delegate: bcs.Address,
  max_per_tx: bcs.u64(),
  max_total: bcs.u64(),
  total_spent: bcs.u64(),
  expires_at_ms: bcs.option(bcs.u64()),
});
```

> **Note on `Balance<T>`**: Sui's `Balance<T>` serializes as `struct { value: u64 }` in BCS — NOT a bare u64. The phantom type parameter `T` is part of the Move type tag, not the BCS payload. Access the amount via `parsed.balance.value`.
>
> **Note on `UID`**: `sui::object::UID` serializes as a 32-byte address in BCS.
>
> **Note on gas coin edge case**: When using `coinWithBalance()` with SUI (the gas coin), the SDK handles coin splitting automatically. However, if the payment `amount` exceeds the user's balance minus gas, the transaction will fail at execution. Builders don't validate this — it's a runtime concern.

#### 6. Error Hierarchy (with Stable Codes)

Following DeepBook's error pattern, plus stable `SweefiErrorCode` constants for programmatic consumers (MCP tools, server middleware, CLI):

```typescript
// utils/errors.ts

/** Stable error codes for programmatic handling (MCP, server, CLI consumers).
 *  Const object + type union instead of enum — tree-shakes, no runtime object, isolatedModules-safe. */
export const SweefiErrorCode = {
  PACKAGE_ID_REQUIRED: 'PACKAGE_ID_REQUIRED',
  ADMIN_CAP_NOT_SET: 'ADMIN_CAP_NOT_SET',
  PROTOCOL_STATE_NOT_SET: 'PROTOCOL_STATE_NOT_SET',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  INVALID_COIN_TYPE: 'INVALID_COIN_TYPE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;
export type SweefiErrorCode = typeof SweefiErrorCode[keyof typeof SweefiErrorCode];

export const ErrorMessages: Record<string, string> = {
  [SweefiErrorCode.PACKAGE_ID_REQUIRED]: 'packageId is required for custom networks (auto-fills for testnet/mainnet)',
  [SweefiErrorCode.ADMIN_CAP_NOT_SET]: 'adminCap not configured — required for admin operations',
  [SweefiErrorCode.PROTOCOL_STATE_NOT_SET]: 'protocolState not configured — required for stream/escrow/prepaid',
};

export class SweefiError extends Error {
  readonly code: SweefiErrorCode;
  constructor(code: SweefiErrorCode, message: string) {
    super(message);
    this.name = 'SweefiError';
    this.code = code;
  }
}

export class ResourceNotFoundError extends SweefiError {
  constructor(resourceType: string, id: string) {
    super(SweefiErrorCode.RESOURCE_NOT_FOUND, `${resourceType} not found: ${id}`);
    this.name = 'ResourceNotFoundError';
  }
}

export class ConfigurationError extends SweefiError {
  constructor(code: SweefiErrorCode, message: string) {
    super(code, message);
    this.name = 'ConfigurationError';
  }
}

export class ValidationError extends SweefiError {
  constructor(message: string) {
    super(SweefiErrorCode.VALIDATION_FAILED, message);
    this.name = 'ValidationError';
  }
}
```

#### 7. Config Class

```typescript
// utils/config.ts
import type { SuiClientTypes } from '@mysten/sui/client';
import type { CoinConfig } from '../types.js';
import { ConfigurationError, ErrorMessages } from './errors.js';

interface NetworkDefaults {
  packageId: string;
  protocolState: string;
  adminCap: string;
}

// Import from existing deployments.ts (single source of truth for package IDs)
import { TESTNET_DEPLOYMENT, MAINNET_DEPLOYMENT } from '../ptb/deployments.js';

const NETWORK_DEFAULTS: Partial<Record<SuiClientTypes.Network, NetworkDefaults>> = {
  testnet: TESTNET_DEPLOYMENT,
  // mainnet: MAINNET_DEPLOYMENT — uncommented when mainnet deploys
};

export class SweefiConfig {
  readonly packageId: string;
  readonly protocolState?: string;
  readonly adminCap?: string;
  readonly network: SuiClientTypes.Network;
  readonly SUI_CLOCK = '0x6';

  #coinTypes: Record<string, CoinConfig>;

  constructor(options: {
    packageId?: string;
    protocolState?: string;
    adminCap?: string;
    network: SuiClientTypes.Network;
    coinTypes?: Record<string, CoinConfig>;
  }) {
    const defaults = NETWORK_DEFAULTS[options.network];

    const packageId = options.packageId ?? defaults?.packageId;
    if (!packageId) {
      throw new ConfigurationError(
        SweefiErrorCode.PACKAGE_ID_REQUIRED,
        ErrorMessages[SweefiErrorCode.PACKAGE_ID_REQUIRED],
      );
    }

    this.packageId = packageId;
    // No silent empty string — undefined means "not configured"
    this.protocolState = options.protocolState ?? defaults?.protocolState;
    this.adminCap = options.adminCap ?? defaults?.adminCap;
    this.network = options.network;
    this.#coinTypes = options.coinTypes ?? {};
  }

  getCoinDecimals(coinType: string): number {
    const config = this.#coinTypes[coinType];
    if (config) return config.decimals;
    // Known defaults — throw for anything else instead of guessing
    if (coinType.includes('sui::SUI')) return 9;
    throw new ValidationError(`Unknown coin decimals for ${coinType} — configure via coinTypes option`);
  }

  requireProtocolState(): string {
    if (!this.protocolState) {
      throw new ConfigurationError(
        SweefiErrorCode.PROTOCOL_STATE_NOT_SET,
        ErrorMessages[SweefiErrorCode.PROTOCOL_STATE_NOT_SET],
      );
    }
    return this.protocolState;
  }

  requireAdminCap(): string {
    if (!this.adminCap) {
      throw new ConfigurationError(
        SweefiErrorCode.ADMIN_CAP_NOT_SET,
        ErrorMessages[SweefiErrorCode.ADMIN_CAP_NOT_SET],
      );
    }
    return this.adminCap;
  }
}
```

---

## Function Mapping: Old → New

### `client.sweefi.payment.*` (PaymentContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildPayTx` | `.pay(params)` | `payment::pay_and_keep` |
| `buildPayComposableTx` | `.payComposable(params)` | `payment::pay` |
| `buildCreateInvoiceTx` | `.createInvoice(params)` | `payment::create_and_send_invoice` |
| `buildPayInvoiceTx` | `.payInvoice(params)` | `payment::pay_invoice_and_keep` |

### `client.sweefi.stream.*` (StreamContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildCreateStreamTx` | `.create(params)` | `stream::create` |
| `buildCreateStreamWithTimeoutTx` | `.createWithTimeout(params)` | `stream::create_with_timeout` |
| `buildClaimTx` | `.claim(params)` | `stream::claim` |
| `buildBatchClaimTx` | `.batchClaim(params)` | `stream::claim` (multiple) |
| `buildPauseTx` | `.pause(params)` | `stream::pause` |
| `buildResumeTx` | `.resume(params)` | `stream::resume` |
| `buildCloseTx` | `.close(params)` | `stream::close` |
| `buildRecipientCloseTx` | `.recipientClose(params)` | `stream::recipient_close` |
| `buildTopUpTx` | `.topUp(params)` | `stream::top_up` |

### `client.sweefi.escrow.*` (EscrowContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildCreateEscrowTx` | `.create(params)` | `escrow::create` |
| `buildReleaseEscrowTx` | `.release(params)` | `escrow::release_and_keep` |
| `buildReleaseEscrowComposableTx` | `.releaseComposable(params)` | `escrow::release` |
| `buildRefundEscrowTx` | `.refund(params)` | `escrow::refund` |
| `buildDisputeEscrowTx` | `.dispute(params)` | `escrow::dispute` |

### `client.sweefi.prepaid.*` (PrepaidContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildPrepaidDepositTx` | `.deposit(params)` | `prepaid::deposit` |
| `buildDepositWithReceiptsTx` | `.depositWithReceipts(params)` | `prepaid::deposit_with_receipts` |
| `buildPrepaidClaimTx` | `.claim(params)` | `prepaid::claim` |
| `buildRequestWithdrawalTx` | `.requestWithdrawal(params)` | `prepaid::request_withdrawal` |
| `buildFinalizeWithdrawalTx` | `.finalizeWithdrawal(params)` | `prepaid::finalize_withdrawal` |
| `buildCancelWithdrawalTx` | `.cancelWithdrawal(params)` | `prepaid::cancel_withdrawal` |
| `buildDisputeClaimTx` | `.disputeClaim(params)` | `prepaid::dispute_claim` |
| `buildWithdrawDisputedTx` | `.withdrawDisputed(params)` | `prepaid::withdraw_disputed` |
| `buildPrepaidAgentCloseTx` | `.agentClose(params)` | `prepaid::agent_close` |
| `buildPrepaidProviderCloseTx` | `.providerClose(params)` | `prepaid::provider_close` |
| `buildPrepaidTopUpTx` | `.topUp(params)` | `prepaid::top_up` |

### `client.sweefi.mandate.*` (MandateContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildCreateMandateTx` | `.create(params)` | `mandate::create_and_transfer` |
| `buildCreateRegistryTx` | `.createRegistry(params)` | `mandate::create_registry` |
| `buildMandatedPayTx` | `.mandatedPay(params)` | `mandate::validate_and_spend` → `payment::pay` |
| `buildRevokeMandateTx` | `.revoke(params)` | `mandate::revoke` |

### `client.sweefi.agentMandate.*` (AgentMandateContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildCreateAgentMandateTx` | `.create(params)` | `agent_mandate::create_and_transfer` |
| `buildAgentMandatedPayTx` | `.pay(params)` | `agent_mandate::validate_and_spend` → `payment::pay` |
| `buildAgentMandatedPayCheckedTx` | `.payChecked(params)` | Same + receipt check |
| `buildUpgradeMandateLevelTx` | `.upgradeLevel(params)` | `agent_mandate::upgrade_level` |
| `buildUpdateMandateCapsTx` | `.updateCaps(params)` | `agent_mandate::update_caps` |

### `client.sweefi.admin.*` (AdminContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| `buildAdminPauseTx` | `.pause(params)` | `admin::pause` |
| `buildAdminUnpauseTx` | `.unpause(params)` | `admin::unpause` |
| `buildAutoUnpauseTx` | `.autoUnpause(params)` | `admin::auto_unpause` |
| `buildBurnAdminCapTx` | `.burnCap(params)` | `admin::burn_admin_cap` |

### `client.sweefi.identity.*` (IdentityContract)

| Current Function | Extension Method | Move Target |
|-----------------|-----------------|-------------|
| (new) | `.register(params)` | `identity::register` |
| (new) | `.recordReceipt(params)` | `identity::record_receipt` |

---

## Implementation Plan

### Phase 1: Skeleton + Payment + TEST (prove the pattern end-to-end) ✅
1. Create `utils/errors.ts` — error hierarchy
2. Create `SweefiConfig` class with validation
3. Create `sweefi()` factory + `SweefiClient` class (payment only initially)
4. Refactor `PaymentContract` (4 methods) using curried pattern + named param types
5. Create `types/bcs.ts` — BCS type definitions for on-chain objects
6. **TEST: `sweefi-extension.test.ts`** — verify the factory registers, namespace works, pay thunk mutates tx correctly
7. **TEST: `payment-contract.test.ts`** — verify each builder produces correct Move calls
8. Export from `index.ts`: `sweefi` (factory), `SweefiClient` (class), `SweefiPublicAPI` (interface), all types
9. **VERIFY: TypeScript inference** — confirm `client.sweefi.payment.pay` resolves to correct signature in VS Code (not `any`)
10. `pnpm typecheck && pnpm test` — green before proceeding

### Phase 2: All Transaction Builders (each with tests) ✅
11. `StreamContract` (9 methods) + `stream-contract.test.ts`
12. `EscrowContract` (5 methods) + `escrow-contract.test.ts`
13. `PrepaidContract` (11 methods) + `prepaid-contract.test.ts`
14. `MandateContract` (4 methods) + `mandate-contract.test.ts`
15. `AgentMandateContract` (5 methods) + `agent-mandate-contract.test.ts`
16. `AdminContract` (4 methods) + `admin-contract.test.ts`
17. `IdentityContract` (2 methods) + `identity-contract.test.ts`

### Phase 3: Query Modules (with BCS parsing) ✅
18. `StreamQueries` — getStream (BCS-parsed)
19. `EscrowQueries` — getEscrow (BCS-parsed)
20. `PrepaidQueries` — getPrepaidBalance, getClaimStatus
21. `MandateQueries` — getMandate, getMandateUsage
22. `ProtocolQueries` — isPaused, getProtocolState
23. `BalanceQueries` — getBalance (uses `client.core.listCoins`)

### Phase 4: Clean Up + Internal Consumers ✅
24. Remove old `buildXxxTx()` functions entirely (alpha — clean break)
25. Update `@sweefi/mcp` to use new client internally
26. Update `SuiPaymentAdapter` to delegate to contract classes

### Phase 5 (Future): Codegen Integration
27. Investigate `@mysten/codegen` for auto-generating transaction builders from Move ABI
28. If viable, replace hand-written builders with generated ones

---

## Scope: What's Untouched

| Component | Why untouched |
|-----------|---------------|
| `s402/` scheme classes | Chain-agnostic protocol — separate concern (schemes migrated to use contract classes in Phase 4) |
| `SuiPaymentAdapter` | Different abstraction layer (ui-core interface) |
| Move contracts, `receipts.ts`, `assert.ts` | Infrastructure, unchanged |

---

## Cross-Extension Composition

The `$extend()` pattern supports multiple extensions via TypeScript intersection types:

```typescript
const client = new SuiGrpcClient({ network: 'mainnet' })
  .$extend(sweefi())
  .$extend(deepbook({ address: '0x...' }))
  .$extend(walrus({ aggregatorUrl: '...' }));

// All namespaces coexist — TypeScript infers the intersection:
await client.sweefi.getStream('0x...');
await client.deepbook.midPrice('SUI_USDC');
await client.walrus.readBlob('0x...');

// Compose in a single PTB:
const tx = new Transaction();
tx.add(client.sweefi.payment.pay({ ... }));
tx.add(client.deepbook.deepBook.placeLimitOrder({ ... }));
```

**No namespace conflicts**: Each extension has its own namespace (`sweefi`, `deepbook`, `walrus`). The generic `Name` parameter even allows multiple instances: `$extend(sweefi({ name: 'payments' }))`.

**No interaction constraints**: Extensions only depend on `ClientWithCoreApi` (read: `{ core: CoreClient }`). They don't reference each other. Composition is purely additive.

---

## Test Strategy

### Unit Tests (per contract)

Each transaction builder contract gets its own test file. Tests verify:
- Correct `tx.moveCall()` target for each builder
- Correct arguments and typeArguments
- Correct handling of optional params (memo, maxCalls)
- Error cases (validation failures)

```typescript
// test/payment-contract.test.ts
import { describe, it, expect } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { PaymentContract } from '../src/transactions/payment.js';
import { SweefiConfig } from '../src/utils/config.js';

describe('PaymentContract', () => {
  const config = new SweefiConfig({ network: 'testnet' });
  const contract = new PaymentContract(config);

  it('pay produces correct moveCall', () => {
    const tx = new Transaction();
    contract.pay({
      coinType: '0x2::sui::SUI',
      amount: 1_000_000_000n,
      recipient: '0x' + 'ab'.repeat(32),
      feeMicroPercent: 10_000n,
      feeRecipient: '0x' + 'cd'.repeat(32),
    })(tx);

    const json = tx.getData();
    expect(json.commands).toHaveLength(2); // coinWithBalance + moveCall
    const moveCall = json.commands[1];
    expect(moveCall.$kind).toBe('MoveCall');
    expect(moveCall.MoveCall.target).toContain('::payment::pay_and_keep');
  });
});
```

### Integration Tests (extension registration)

```typescript
// test/sweefi-extension.test.ts
describe('sweefi() extension', () => {
  it('registers with SuiGrpcClient', () => {
    const client = new SuiGrpcClient({ network: 'testnet' })
      .$extend(sweefi());

    expect(client.sweefi).toBeInstanceOf(SweefiClient);
    expect(client.sweefi.payment).toBeInstanceOf(PaymentContract);
    expect(client.sweefi.stream).toBeInstanceOf(StreamContract);
  });

  it('composes with other extensions', () => {
    const client = new SuiGrpcClient({ network: 'testnet' })
      .$extend(sweefi())
      .$extend(deepbook({ address: '0x...' }));

    expect(client.sweefi).toBeDefined();
    expect(client.deepbook).toBeDefined();
  });

  it('supports custom namespace', () => {
    const client = new SuiGrpcClient({ network: 'testnet' })
      .$extend(sweefi({ name: 'payments' }));

    expect((client as any).payments).toBeInstanceOf(SweefiClient);
  });

  it('throws ConfigurationError for unknown network without packageId', () => {
    expect(() =>
      new SuiGrpcClient({ network: 'localnet' })
        .$extend(sweefi())
    ).toThrow(ConfigurationError);
  });
});
```

### E2E Tests (on testnet, optional)

For testnet validation, verify actual transaction execution:
- Build a payment tx → simulate via `client.core.simulateTransaction()`
- Build a stream create tx → simulate → verify command results
- Query a known testnet object → verify BCS parsing

---

## Why This Is the Killer Interview Demo

1. **First-principles reasoning**: Chose `$extend()` for composition and ecosystem coherence, not because "DeepBook does it" — can articulate *why* from first principles
2. **40+ transaction builders across 8 contracts**: More complex than most domain SDKs in the monorepo
3. **s402 stays chain-agnostic**: Shows you understand separation of concerns
4. **Query modules use `client.core`**: Transport-agnostic — works with gRPC, GraphQL, or JSON-RPC
5. **Narrowed public API interface**: Factory returns `SweefiPublicAPI`, not the raw class — explicit surface boundary, same pattern a Mysten senior would design
6. **Real published packages**: This isn't a toy — 7 packages on npm, 1,569 tests
7. **Error hierarchy with stable codes**: `SweefiError` → `ConfigurationError` / `ResourceNotFoundError` / `ValidationError`, all with `SweefiErrorCode` for programmatic handling
8. **BCS parsing with concrete type defs**: Every Move struct has a matching `bcs.struct()` definition — type-safe on-chain data parsing, not `fields as any`
9. **Cross-extension composition proven**: Works alongside DeepBook, Walrus, any `$extend()` SDK
10. **Clean break, not compat theater**: Alpha status leveraged to ship the right API on day one — no deprecation wrappers cluttering the codebase
11. **Codegen-compatible**: Architecture can adopt `@mysten/codegen` for auto-generated builders when Move ABI tooling matures

---

## Status

- **Phases 1–4 complete.** All consumers migrated to the contract class pattern.
- **1,168 tests passing** across 4 packages (`@sweefi/sui`, `@sweefi/mcp`, `@sweefi/cli`, `@sweefi/facilitator`).
- Old `ptb/` builder functions preserved but **deprecated** — contract classes are the canonical API.
- Phase 5 (codegen integration) remains future work.

---

*Last updated: 2026-03-11 (Phases 1–4 complete. All consumers migrated to contract class pattern.)*
