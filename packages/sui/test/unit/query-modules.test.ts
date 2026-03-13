import { describe, it, expect, vi } from 'vitest';
import {
  StreamingMeterBcs, EscrowBcs, PrepaidBalanceBcs,
  MandateBcs, ProtocolStateBcs,
} from '../../src/types/bcs';
import { SweefiPluginConfig } from '../../src/utils/config';
import { ResourceNotFoundError, ConfigurationError } from '../../src/utils/errors';
import type { QueryContext } from '../../src/queries/context';
import { StreamQueries } from '../../src/queries/streamQueries';
import { EscrowQueries, EscrowState } from '../../src/queries/escrowQueries';
import { PrepaidQueries } from '../../src/queries/prepaidQueries';
import { MandateQueries } from '../../src/queries/mandateQueries';
import { ProtocolQueries } from '../../src/queries/protocolQueries';
import { BalanceQueries } from '../../src/queries/balanceQueries';

// ── Test helpers ────────────────────────────────────────────────

const ADDR_A = '0x' + 'aa'.repeat(32);
const ADDR_B = '0x' + 'bb'.repeat(32);
const ADDR_C = '0x' + 'cc'.repeat(32);
const OBJECT_ID = '0x' + '01'.repeat(32);
const PROTOCOL_STATE_ID = '0x' + '99'.repeat(32);

/** Create a mock QueryContext with a stubbed core.getObject / core.getBalance */
function createMockCtx(overrides?: { protocolState?: string }): QueryContext & { getObjectMock: ReturnType<typeof vi.fn>; getBalanceMock: ReturnType<typeof vi.fn> } {
  const getObjectMock = vi.fn();
  const getBalanceMock = vi.fn();
  const config = new SweefiPluginConfig({
    packageId: '0x' + 'ff'.repeat(32),
    protocolState: overrides?.protocolState ?? PROTOCOL_STATE_ID,
    network: 'localnet',
  });
  return {
    client: {
      core: {
        getObject: getObjectMock,
        getBalance: getBalanceMock,
      },
    } as any,
    config,
    getObjectMock,
    getBalanceMock,
  };
}

/** Serialize a BCS struct into a mock getObject response */
function mockObjectResponse(bcsType: { serialize: (data: any) => { toBytes: () => Uint8Array } }, data: any) {
  return {
    object: {
      objectId: OBJECT_ID,
      version: '1',
      digest: 'test',
      owner: { $kind: 'AddressOwner', AddressOwner: ADDR_A },
      type: 'test::type::Type',
      content: bcsType.serialize(data).toBytes(),
    },
  };
}

// ══════════════════════════════════════════════════════════════
// StreamQueries
// ══════════════════════════════════════════════════════════════

describe('StreamQueries', () => {
  const streamData = {
    id: OBJECT_ID,
    payer: ADDR_A,
    recipient: ADDR_B,
    balance: { value: '5000000000' },
    rate_per_second: '1000',
    budget_cap: '10000000000',
    total_claimed: '2000000000',
    last_claim_ms: '1710000000000',
    created_at_ms: '1709000000000',
    active: true,
    paused_at_ms: '0',
    fee_micro_pct: '10000',
    fee_recipient: ADDR_C,
  };

  it('parses stream object via BCS', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(StreamingMeterBcs, streamData));
    const queries = new StreamQueries(ctx);

    const result = await queries.getStream(OBJECT_ID);

    expect(result.payer).toBe(ADDR_A);
    expect(result.recipient).toBe(ADDR_B);
    expect(result.balanceValue).toBe(5_000_000_000n);
    expect(result.ratePerSecond).toBe(1000n);
    expect(result.budgetCap).toBe(10_000_000_000n);
    expect(result.totalClaimed).toBe(2_000_000_000n);
    expect(result.active).toBe(true);
    expect(result.feeMicroPct).toBe(10_000n);
    expect(result.feeRecipient).toBe(ADDR_C);
  });

  it('calls getObject with correct params', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(StreamingMeterBcs, streamData));
    const queries = new StreamQueries(ctx);

    await queries.getStream(OBJECT_ID);

    expect(ctx.getObjectMock).toHaveBeenCalledWith({
      objectId: OBJECT_ID,
      include: { content: true },
    });
  });
});

// ══════════════════════════════════════════════════════════════
// EscrowQueries
// ══════════════════════════════════════════════════════════════

describe('EscrowQueries', () => {
  const escrowData = {
    id: OBJECT_ID,
    buyer: ADDR_A,
    seller: ADDR_B,
    arbiter: ADDR_C,
    balance: { value: '1000000000' },
    amount: '1000000000',
    deadline_ms: '1711000000000',
    state: 0,
    fee_micro_pct: '5000',
    fee_recipient: ADDR_C,
    created_at_ms: '1709000000000',
    description: Array.from(new TextEncoder().encode('test escrow')),
  };

  it('parses escrow object via BCS', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(EscrowBcs, escrowData));
    const queries = new EscrowQueries(ctx);

    const result = await queries.getEscrow(OBJECT_ID);

    expect(result.buyer).toBe(ADDR_A);
    expect(result.seller).toBe(ADDR_B);
    expect(result.arbiter).toBe(ADDR_C);
    expect(result.balanceValue).toBe(1_000_000_000n);
    expect(result.amount).toBe(1_000_000_000n);
    expect(result.state).toBe(EscrowState.Active);
    expect(new TextDecoder().decode(result.description)).toBe('test escrow');
  });

  it('maps disputed state correctly', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(
      mockObjectResponse(EscrowBcs, { ...escrowData, state: 1 }),
    );
    const queries = new EscrowQueries(ctx);

    const result = await queries.getEscrow(OBJECT_ID);
    expect(result.state).toBe(EscrowState.Disputed);
  });
});

// ══════════════════════════════════════════════════════════════
// PrepaidQueries
// ══════════════════════════════════════════════════════════════

describe('PrepaidQueries', () => {
  const prepaidData = {
    id: OBJECT_ID,
    agent: ADDR_A,
    provider: ADDR_B,
    deposited: { value: '10000000000' },
    rate_per_call: '100000',
    claimed_calls: '50',
    max_calls: '1000',
    last_claim_ms: '1710000000000',
    withdrawal_delay_ms: '86400000',
    withdrawal_pending: false,
    withdrawal_requested_ms: '0',
    fee_micro_pct: '10000',
    fee_recipient: ADDR_C,
    provider_pubkey: Array.from(new Uint8Array(32).fill(0xab)),
    dispute_window_ms: '3600000',
    pending_claim_count: '0',
    pending_claim_amount: '0',
    pending_claim_fee: '0',
    pending_claim_ms: '0',
    disputed: false,
  };

  it('parses prepaid balance via BCS', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(PrepaidBalanceBcs, prepaidData));
    const queries = new PrepaidQueries(ctx);

    const result = await queries.getPrepaidBalance(OBJECT_ID);

    expect(result.agent).toBe(ADDR_A);
    expect(result.provider).toBe(ADDR_B);
    expect(result.depositedValue).toBe(10_000_000_000n);
    expect(result.ratePerCall).toBe(100_000n);
    expect(result.claimedCalls).toBe(50n);
    expect(result.maxCalls).toBe(1_000n);
    expect(result.withdrawalPending).toBe(false);
    expect(result.disputed).toBe(false);
    expect(result.providerPubkey).toBeInstanceOf(Uint8Array);
    expect(result.providerPubkey.length).toBe(32);
  });

  it('handles withdrawal pending state', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(
      mockObjectResponse(PrepaidBalanceBcs, {
        ...prepaidData,
        withdrawal_pending: true,
        withdrawal_requested_ms: '1710500000000',
      }),
    );
    const queries = new PrepaidQueries(ctx);

    const result = await queries.getPrepaidBalance(OBJECT_ID);
    expect(result.withdrawalPending).toBe(true);
    expect(result.withdrawalRequestedMs).toBe(1_710_500_000_000n);
  });
});

// ══════════════════════════════════════════════════════════════
// MandateQueries
// ══════════════════════════════════════════════════════════════

describe('MandateQueries', () => {
  it('parses mandate with expiry', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(MandateBcs, {
      id: OBJECT_ID,
      delegator: ADDR_A,
      delegate: ADDR_B,
      max_per_tx: '1000000000',
      max_total: '50000000000',
      total_spent: '5000000000',
      expires_at_ms: '1720000000000',
    }));
    const queries = new MandateQueries(ctx);

    const result = await queries.getMandate(OBJECT_ID);

    expect(result.delegator).toBe(ADDR_A);
    expect(result.delegate).toBe(ADDR_B);
    expect(result.maxPerTx).toBe(1_000_000_000n);
    expect(result.maxTotal).toBe(50_000_000_000n);
    expect(result.totalSpent).toBe(5_000_000_000n);
    expect(result.expiresAtMs).toBe(1_720_000_000_000n);
  });

  it('handles null expiry (no expiration)', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(MandateBcs, {
      id: OBJECT_ID,
      delegator: ADDR_A,
      delegate: ADDR_B,
      max_per_tx: '1000000000',
      max_total: '0',
      total_spent: '0',
      expires_at_ms: null,
    }));
    const queries = new MandateQueries(ctx);

    const result = await queries.getMandate(OBJECT_ID);
    expect(result.expiresAtMs).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// ProtocolQueries
// ══════════════════════════════════════════════════════════════

describe('ProtocolQueries', () => {
  it('returns paused=false for unpaused protocol', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(ProtocolStateBcs, {
      id: PROTOCOL_STATE_ID,
      paused: false,
      paused_at_ms: '0',
    }));
    const queries = new ProtocolQueries(ctx);

    expect(await queries.isPaused()).toBe(false);
  });

  it('returns paused=true for paused protocol', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(ProtocolStateBcs, {
      id: PROTOCOL_STATE_ID,
      paused: true,
      paused_at_ms: '1710000000000',
    }));
    const queries = new ProtocolQueries(ctx);

    expect(await queries.isPaused()).toBe(true);
  });

  it('getProtocolState returns full state data', async () => {
    const ctx = createMockCtx();
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(ProtocolStateBcs, {
      id: PROTOCOL_STATE_ID,
      paused: true,
      paused_at_ms: '1710000000000',
    }));
    const queries = new ProtocolQueries(ctx);

    const state = await queries.getProtocolState();
    expect(state.paused).toBe(true);
    expect(state.pausedAtMs).toBe(1_710_000_000_000n);
  });

  it('throws ConfigurationError when protocolState not configured', async () => {
    const getObjectMock = vi.fn();
    const config = new SweefiPluginConfig({
      packageId: '0x' + 'ff'.repeat(32),
      network: 'localnet',
    });
    const queries = new ProtocolQueries({
      client: { core: { getObject: getObjectMock } } as any,
      config,
    });

    await expect(queries.isPaused()).rejects.toThrow(ConfigurationError);
  });

  it('uses configured protocolState object ID', async () => {
    const ctx = createMockCtx({ protocolState: PROTOCOL_STATE_ID });
    ctx.getObjectMock.mockResolvedValue(mockObjectResponse(ProtocolStateBcs, {
      id: PROTOCOL_STATE_ID,
      paused: false,
      paused_at_ms: '0',
    }));
    const queries = new ProtocolQueries(ctx);

    await queries.isPaused();

    expect(ctx.getObjectMock).toHaveBeenCalledWith({
      objectId: PROTOCOL_STATE_ID,
      include: { content: true },
    });
  });
});

// ══════════════════════════════════════════════════════════════
// BalanceQueries
// ══════════════════════════════════════════════════════════════

describe('BalanceQueries', () => {
  it('returns balance as bigint', async () => {
    const ctx = createMockCtx();
    ctx.getBalanceMock.mockResolvedValue({
      balance: { coinType: '0x2::sui::SUI', balance: '9876543210', coinBalance: '9876543210', addressBalance: '9876543210' },
    });
    const queries = new BalanceQueries(ctx);

    const result = await queries.getBalance(ADDR_A, '0x2::sui::SUI');
    expect(result).toBe(9_876_543_210n);
  });

  it('passes correct params to core.getBalance', async () => {
    const ctx = createMockCtx();
    ctx.getBalanceMock.mockResolvedValue({
      balance: { coinType: '0x2::sui::SUI', balance: '0' },
    });
    const queries = new BalanceQueries(ctx);

    await queries.getBalance(ADDR_A, '0x2::sui::SUI');

    expect(ctx.getBalanceMock).toHaveBeenCalledWith({
      owner: ADDR_A,
      coinType: '0x2::sui::SUI',
    });
  });

  it('returns 0n for zero balance', async () => {
    const ctx = createMockCtx();
    ctx.getBalanceMock.mockResolvedValue({
      balance: { coinType: '0x2::sui::SUI', balance: '0' },
    });
    const queries = new BalanceQueries(ctx);

    expect(await queries.getBalance(ADDR_A, '0x2::sui::SUI')).toBe(0n);
  });
});

// ══════════════════════════════════════════════════════════════
// SweefiClient query delegates
// ══════════════════════════════════════════════════════════════

describe('SweefiClient query delegates', () => {
  it('exposes all query methods on the public API', async () => {
    // Import here to avoid circular issues
    const { SweefiClient } = await import('../../src/extend');

    const mockCore = {
      getObject: vi.fn().mockResolvedValue(mockObjectResponse(StreamingMeterBcs, {
        id: OBJECT_ID,
        payer: ADDR_A,
        recipient: ADDR_B,
        balance: { value: '1000' },
        rate_per_second: '1',
        budget_cap: '1000',
        total_claimed: '0',
        last_claim_ms: '0',
        created_at_ms: '0',
        active: true,
        paused_at_ms: '0',
        fee_micro_pct: '0',
        fee_recipient: ADDR_C,
      })),
      getBalance: vi.fn().mockResolvedValue({
        balance: { balance: '42' },
      }),
    };

    const client = new SweefiClient({
      client: { core: mockCore } as any,
      network: 'testnet',
    });

    // Verify all query methods exist
    expect(typeof client.getStream).toBe('function');
    expect(typeof client.getEscrow).toBe('function');
    expect(typeof client.getPrepaidBalance).toBe('function');
    expect(typeof client.getMandate).toBe('function');
    expect(typeof client.isProtocolPaused).toBe('function');
    expect(typeof client.getProtocolState).toBe('function');
    expect(typeof client.getBalance).toBe('function');

    // Verify one delegate actually works end-to-end
    const stream = await client.getStream(OBJECT_ID);
    expect(stream.payer).toBe(ADDR_A);

    const balance = await client.getBalance(ADDR_A, '0x2::sui::SUI');
    expect(balance).toBe(42n);
  });
});
