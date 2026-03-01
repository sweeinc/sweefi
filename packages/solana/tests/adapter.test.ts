/**
 * @sweefi/solana — Unit Tests
 *
 * All external dependencies are mocked. These tests NEVER hit devnet.
 *
 * Coverage:
 *   - ExactSolanaServerScheme.buildRequirements() — pure logic, no mocks needed
 *   - SolanaPaymentAdapter.getAddress() / simulate() / signAndBroadcast()
 *   - ExactSolanaClientScheme.createPayment()
 *   - ExactSolanaFacilitatorScheme.verify() / settle()
 *   - SolanaKeypairSigner construction
 *   - Constants sanity checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Peer dep mocks ───────────────────────────────────────────────────────────
//
// @solana/web3.js and @solana/spl-token are peer deps — not installed here.
// We mock them in full so tests run offline. Each mock class/function is the
// minimal surface needed to exercise our code paths.
//
// vi.hoisted() ensures these are available when vi.mock() factories execute
// (vi.mock is hoisted to the top of the file at compile time).

const {
  MOCK_PAYER_ADDRESS,
  MOCK_RECIPIENT_ADDRESS,
  MOCK_USDC_MINT,
  MOCK_TX_SIGNATURE,
  MOCK_BLOCKHASH,
  mockTransaction,
  MockTransaction,
  MockPublicKey,
  MockSystemProgram,
  mockConnection,
  MockConnection,
  MOCK_SOURCE_ATA,
  MOCK_DEST_ATA,
} = vi.hoisted(() => {
  const _MOCK_PAYER_ADDRESS = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
  const _MOCK_RECIPIENT_ADDRESS = 'BobVAwj3ySXFHR2eq6bBg9rp1fTQEUGegCGpCvTCnDvL';
  const _MOCK_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const _MOCK_TX_SIGNATURE = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d1MV3ry2FaLDDpTWFwJiE3FGJbDTdqtSURHEKnPfScTD';
  const _MOCK_BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

  const _mockTransaction = {
    add: vi.fn().mockReturnThis(),
    sign: vi.fn(),
    serialize: vi.fn().mockReturnValue(Buffer.from('mock-tx-bytes')),
    serializeMessage: vi.fn().mockReturnValue(Buffer.from('mock-message')),
    compileMessage: vi.fn().mockReturnValue({
      accountKeys: [
        { toBase58: () => _MOCK_PAYER_ADDRESS },
        { toBase58: () => _MOCK_RECIPIENT_ADDRESS },
      ],
    }),
    signatures: [
      {
        publicKey: { toBase58: () => _MOCK_PAYER_ADDRESS, toBytes: () => new Uint8Array(32).fill(1) },
        signature: Buffer.from(new Uint8Array(64).fill(2)),
      },
    ],
    feePayer: { toBase58: () => _MOCK_PAYER_ADDRESS },
    recentBlockhash: _MOCK_BLOCKHASH,
  };

  const _MockTransaction = vi.fn().mockImplementation(() => ({ ..._mockTransaction }));
  (_MockTransaction as unknown as Record<string, unknown>).from = vi.fn().mockReturnValue({ ..._mockTransaction });

  const _MockPublicKey = vi.fn().mockImplementation((key: string) => ({
    toBase58: () => key,
    toBytes: () => new Uint8Array(32).fill(1),
    equals: (other: { toBase58(): string }) => other.toBase58() === key,
    toString: () => key,
  }));

  const _MockSystemProgram = {
    transfer: vi.fn().mockReturnValue({ programId: 'system', keys: [], data: Buffer.alloc(12) }),
  };

  const _mockConnection = {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: _MOCK_BLOCKHASH,
      lastValidBlockHeight: 1000,
    }),
    simulateTransaction: vi.fn().mockResolvedValue({
      value: {
        err: null,
        logs: [],
        unitsConsumed: 10_000,
        preBalances: [1_000_000_000, 0],
        postBalances: [998_995_000, 1_000_000],
        preTokenBalances: [],
        postTokenBalances: [],
      },
    }),
    getAccountInfo: vi.fn().mockResolvedValue({ lamports: 2_039_280, data: Buffer.alloc(165) }),
    sendRawTransaction: vi.fn().mockResolvedValue(_MOCK_TX_SIGNATURE),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  };

  const _MockConnection = vi.fn().mockImplementation(() => _mockConnection);

  return {
    MOCK_PAYER_ADDRESS: _MOCK_PAYER_ADDRESS,
    MOCK_RECIPIENT_ADDRESS: _MOCK_RECIPIENT_ADDRESS,
    MOCK_USDC_MINT: _MOCK_USDC_MINT,
    MOCK_TX_SIGNATURE: _MOCK_TX_SIGNATURE,
    MOCK_BLOCKHASH: _MOCK_BLOCKHASH,
    mockTransaction: _mockTransaction,
    MockTransaction: _MockTransaction,
    MockPublicKey: _MockPublicKey,
    MockSystemProgram: _MockSystemProgram,
    mockConnection: _mockConnection,
    MockConnection: _MockConnection,
    MOCK_SOURCE_ATA: 'SourceATA111111111111111111111111111111111111',
    MOCK_DEST_ATA: 'DestATA1111111111111111111111111111111111111',
  };
});

// ── @solana/web3.js mock ──────────────────────────────────────────────────────

vi.mock('@solana/web3.js', () => ({
  Transaction: MockTransaction,
  PublicKey: MockPublicKey,
  SystemProgram: MockSystemProgram,
  Connection: MockConnection,
  clusterApiUrl: vi.fn().mockReturnValue('https://api.devnet.solana.com'),
}));

// ── @solana/spl-token mock ────────────────────────────────────────────────────

vi.mock('@solana/spl-token', () => ({
  TOKEN_PROGRAM_ID: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
  createAssociatedTokenAccountIdempotentInstruction: vi.fn().mockReturnValue({
    programId: { toBase58: () => 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bY' },
    keys: [],
    data: Buffer.alloc(1),
  }),
  createTransferInstruction: vi.fn().mockReturnValue({
    programId: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
    keys: [],
    data: Buffer.alloc(10),
  }),
  getAssociatedTokenAddress: vi.fn().mockImplementation((_mint: unknown, owner: { toBase58(): string }) =>
    Promise.resolve(
      owner.toBase58() === MOCK_PAYER_ADDRESS ? MOCK_SOURCE_ATA : MOCK_DEST_ATA,
    ),
  ),
}));

// ─── Import SUT after mocks are hoisted ──────────────────────────────────────

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction as mockCreateTransferInstruction,
} from '@solana/spl-token';
import {
  ExactSolanaServerScheme,
  ExactSolanaClientScheme,
  ExactSolanaFacilitatorScheme,
  SolanaPaymentAdapter,
  SolanaKeypairSigner,
  SOLANA_DEVNET_CAIP2,
  SOLANA_MAINNET_CAIP2,
  NATIVE_SOL_MINT,
  USDC_DEVNET_MINT,
  BASE_FEE_LAMPORTS,
  ATA_RENT_LAMPORTS,
} from '../src/index.js';
import type {
  ClientSolanaSigner,
  FacilitatorSolanaSigner,
  SolanaSimulateResult,
} from '../src/index.js';
import type { s402PaymentRequirements } from 's402';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeReqs(overrides: Partial<s402PaymentRequirements> = {}): s402PaymentRequirements {
  return {
    s402Version: '1',
    accepts: ['exact'],
    network: SOLANA_DEVNET_CAIP2,
    asset: MOCK_USDC_MINT,
    amount: '1000000', // 1 USDC
    payTo: MOCK_RECIPIENT_ADDRESS,
    ...overrides,
  };
}

const mockSigner: ClientSolanaSigner = {
  address: MOCK_PAYER_ADDRESS,
  signTransaction: vi.fn().mockResolvedValue({
    serialized: Buffer.from('signed-tx').toString('base64'),
    signature: Buffer.from(new Uint8Array(64).fill(2)).toString('base64'),
    blockhash: MOCK_BLOCKHASH,
    lastValidBlockHeight: 1000,
  }),
};

function makeSimResult(overrides: Partial<SolanaSimulateResult> = {}): SolanaSimulateResult {
  return {
    success: true,
    accountKeys: [MOCK_PAYER_ADDRESS, MOCK_RECIPIENT_ADDRESS],
    preBalances: [1_000_000_000, 0],
    postBalances: [998_995_000, 1_000_000],
    preTokenBalances: [],
    postTokenBalances: [],
    unitsConsumed: 10_000,
    ...overrides,
  };
}

// ─── ExactSolanaServerScheme ──────────────────────────────────────────────────

describe('ExactSolanaServerScheme', () => {
  const server = new ExactSolanaServerScheme();

  it('has scheme = "exact"', () => {
    expect(server.scheme).toBe('exact');
  });

  it('builds requirements with explicit asset', () => {
    const reqs = server.buildRequirements({
      schemes: ['exact'],
      network: SOLANA_DEVNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      price: '1000000',
      asset: MOCK_USDC_MINT,
    });

    expect(reqs.accepts).toContain('exact');
    expect(reqs.network).toBe(SOLANA_DEVNET_CAIP2);
    expect(reqs.asset).toBe(MOCK_USDC_MINT);
    expect(reqs.amount).toBe('1000000');
    expect(reqs.payTo).toBe(MOCK_RECIPIENT_ADDRESS);
  });

  it('defaults to devnet USDC when no asset given', () => {
    const reqs = server.buildRequirements({
      schemes: ['exact'],
      network: SOLANA_DEVNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      price: '500000',
    });

    expect(reqs.asset).toBe(USDC_DEVNET_MINT);
  });

  it('defaults to mainnet USDC on mainnet', () => {
    const reqs = server.buildRequirements({
      schemes: ['exact'],
      network: SOLANA_MAINNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      price: '500000',
    });

    expect(reqs.asset).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('includes protocolFeeBps if provided', () => {
    const reqs = server.buildRequirements({
      schemes: ['exact'],
      network: SOLANA_DEVNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      price: '1000000',
      protocolFeeBps: 50,
    });

    expect(reqs.protocolFeeBps).toBe(50);
  });

  it('throws if price is missing', () => {
    expect(() =>
      server.buildRequirements({
        schemes: ['exact'],
        network: SOLANA_DEVNET_CAIP2,
        payTo: MOCK_RECIPIENT_ADDRESS,
      } as Parameters<typeof server.buildRequirements>[0]),
    ).toThrow('price');
  });
});

// ─── SolanaKeypairSigner ──────────────────────────────────────────────────────

describe('SolanaKeypairSigner', () => {
  it('exposes address from the keypair public key', () => {
    const mockKeypair = {
      publicKey: new MockPublicKey(MOCK_PAYER_ADDRESS),
      secretKey: new Uint8Array(64),
      sign: vi.fn().mockReturnValue({ signature: new Uint8Array(64) }),
    };

    const signer = new SolanaKeypairSigner(mockKeypair as ConstructorParameters<typeof SolanaKeypairSigner>[0]);
    expect(signer.address).toBe(MOCK_PAYER_ADDRESS);
  });
});

// ─── SolanaPaymentAdapter ─────────────────────────────────────────────────────

describe('SolanaPaymentAdapter', () => {
  let adapter: SolanaPaymentAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SolanaPaymentAdapter({
      wallet: mockSigner,
      connection: mockConnection as ConstructorParameters<typeof SolanaPaymentAdapter>[0]['connection'],
      network: SOLANA_DEVNET_CAIP2,
    });
  });

  it('exposes the correct network', () => {
    expect(adapter.network).toBe(SOLANA_DEVNET_CAIP2);
  });

  it('getAddress() returns the signer address', () => {
    expect(adapter.getAddress()).toBe(MOCK_PAYER_ADDRESS);
  });

  it('simulate() returns UNSUPPORTED_SCHEME when exact not in accepts', async () => {
    const result = await adapter.simulate(makeReqs({ accepts: ['prepaid'] }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('UNSUPPORTED_SCHEME');
  });

  it('simulate() returns success with estimatedFee for SOL transfer', async () => {
    const result = await adapter.simulate(makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(result.success).toBe(true);
    expect(result.estimatedFee?.amount).toBe(BASE_FEE_LAMPORTS);
    expect(result.estimatedFee?.currency).toBe('SOL');
  });

  it('simulate() returns success with estimatedFee for SPL token transfer', async () => {
    const result = await adapter.simulate(makeReqs());
    expect(result.success).toBe(true);
    expect(result.estimatedFee?.currency).toBe('SOL');
  });

  it('simulate() returns failure when simulation returns an error', async () => {
    mockConnection.simulateTransaction.mockResolvedValueOnce({
      value: { err: { InstructionError: [0, 'InsufficientFunds'] }, logs: [] },
    });
    const result = await adapter.simulate(makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBeDefined();
  });

  it('signAndBroadcast() returns txId on success', async () => {
    const { txId } = await adapter.signAndBroadcast(makeReqs());
    expect(typeof txId).toBe('string');
    expect(mockConnection.sendRawTransaction).toHaveBeenCalledOnce();
    expect(mockConnection.confirmTransaction).toHaveBeenCalledOnce();
  });

  it('signAndBroadcast() throws when confirmation fails', async () => {
    mockConnection.confirmTransaction.mockResolvedValueOnce({
      value: { err: 'InstructionError' },
    });
    await expect(adapter.signAndBroadcast(makeReqs())).rejects.toThrow('Transaction failed');
  });
});

// ─── SolanaPaymentAdapter — ATA creation ──────────────────────────────────────
//
// Covers Priya's 6-scenario test matrix for the missing-ATA fix.
// Each test controls mockConnection.getAccountInfo independently via
// mockResolvedValueOnce so scenarios are fully isolated.

describe('SolanaPaymentAdapter — ATA creation', () => {
  let adapter: SolanaPaymentAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: ATA exists. Individual tests override with null to simulate missing ATA.
    mockConnection.getAccountInfo.mockResolvedValue({ lamports: 2_039_280, data: Buffer.alloc(165) });
    adapter = new SolanaPaymentAdapter({
      wallet: mockSigner,
      connection: mockConnection as ConstructorParameters<typeof SolanaPaymentAdapter>[0]['connection'],
      network: SOLANA_DEVNET_CAIP2,
    });
  });

  // ── Scenario 1: Happy path — ATA exists ────────────────────────────────────

  it('simulate() — ATA exists: returns BASE_FEE_LAMPORTS, no ataCreationRequired fields', async () => {
    const result = await adapter.simulate(makeReqs());

    expect(result.success).toBe(true);
    expect(result.estimatedFee?.amount).toBe(BASE_FEE_LAMPORTS);
    expect(result.ataCreationRequired).toBeUndefined();
    expect(result.ataCreationCostLamports).toBeUndefined();
  });

  // ── Scenario 2 & 3: Missing ATA — simulate detects and surfaces true cost ──
  //
  // Wei's constraint from the council: estimatedFee.amount MUST include ATA rent
  // when ataCreationRequired is true, otherwise success: true is a lie — the
  // broadcast can fail if the payer can't afford the combined cost.

  it('simulate() — ATA missing: ataCreationRequired: true, rent folded into estimatedFee', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);

    const result = await adapter.simulate(makeReqs());

    expect(result.success).toBe(true);
    expect(result.ataCreationRequired).toBe(true);
    expect(result.ataCreationCostLamports).toBe(ATA_RENT_LAMPORTS);
    // The single estimatedFee.amount already includes both costs — callers must not add them again
    expect(result.estimatedFee?.amount).toBe(BASE_FEE_LAMPORTS + ATA_RENT_LAMPORTS);
  });

  it('simulate() — ATA missing: success is true (transfer itself is valid; rent gap is surfaced, not an error)', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);

    const result = await adapter.simulate(makeReqs());

    // success: true means the SPL transfer instructions are valid.
    // The caller is responsible for checking ataCreationRequired and confirming the
    // user has enough SOL for the combined cost before calling signAndBroadcast.
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // ── Scenario 4: signAndBroadcast without prior simulate — auto-creates ATA ─

  it('signAndBroadcast() — ATA missing: atomically creates ATA then transfers, self-sufficient', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);

    const { txId } = await adapter.signAndBroadcast(makeReqs());

    expect(txId).toBe(MOCK_TX_SIGNATURE);
    // Idempotent ATA creation instruction must be prepended
    expect(createAssociatedTokenAccountIdempotentInstruction).toHaveBeenCalledOnce();
    // The signer is called directly (via signBroadcastWithAtaCreate, not through the scheme)
    expect(mockSigner.signTransaction).toHaveBeenCalledOnce();
    expect(mockConnection.sendRawTransaction).toHaveBeenCalledOnce();
    expect(mockConnection.confirmTransaction).toHaveBeenCalledOnce();
  });

  // ── Scenario 5: Race condition — ATA created between simulate() and broadcast

  it('signAndBroadcast() — ATA appears between simulate and broadcast: takes normal scheme path', async () => {
    // simulate() sees missing ATA; signAndBroadcast()'s independent check sees it now exists
    mockConnection.getAccountInfo
      .mockResolvedValueOnce(null)                               // simulate's check
      .mockResolvedValueOnce({ lamports: 2_039_280 });           // signAndBroadcast's check

    const simResult = await adapter.simulate(makeReqs());
    expect(simResult.ataCreationRequired).toBe(true);           // simulate correctly flagged it

    vi.clearAllMocks();
    mockConnection.getAccountInfo.mockResolvedValueOnce({ lamports: 2_039_280 });
    mockConnection.sendRawTransaction.mockResolvedValue(MOCK_TX_SIGNATURE);
    mockConnection.confirmTransaction.mockResolvedValue({ value: { err: null } });

    const { txId } = await adapter.signAndBroadcast(makeReqs());

    expect(txId).toBeDefined();
    // ATA now exists — signBroadcastWithAtaCreate must NOT be called
    expect(createAssociatedTokenAccountIdempotentInstruction).not.toHaveBeenCalled();
  });

  // ── Scenario 6: ATA missing + on-chain failure (e.g. insufficient SOL for rent)

  it('signAndBroadcast() — ATA missing, on-chain failure: throws with actionable message', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);
    mockConnection.confirmTransaction.mockResolvedValueOnce({
      value: { err: 'InsufficientFundsForRent' },
    });

    await expect(adapter.signAndBroadcast(makeReqs())).rejects.toThrow('Transaction failed');
  });

  // ── Idempotency guarantee ──────────────────────────────────────────────────
  //
  // When signBroadcastWithAtaCreate is called, it uses the idempotent instruction.
  // If the ATA was created in the window between getAccountInfo and sendRawTransaction
  // (a second race condition), the instruction safely no-ops on-chain — no error.

  it('signAndBroadcast() — idempotent instruction called with correct payer/destAta/recipient/mint', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);

    await adapter.signAndBroadcast(makeReqs());

    expect(createAssociatedTokenAccountIdempotentInstruction).toHaveBeenCalledWith(
      expect.objectContaining({ toBase58: expect.any(Function) }), // payer (PublicKey)
      MOCK_DEST_ATA,                                                // destAta (string from getAssociatedTokenAddress mock)
      expect.objectContaining({ toBase58: expect.any(Function) }), // recipient (PublicKey)
      expect.objectContaining({ toBase58: expect.any(Function) }), // mint (PublicKey)
    );
  });

  // ── simulate() must match broadcast tx exactly ────────────────────────────
  //
  // Critical: the simulation tx must include the ATA creation instruction so
  // success: true is accurate. Without it, simulateTransaction() targets a
  // non-existent account and the real RPC returns an error — tests missed this
  // because simulateTransaction is mocked to always return { err: null }.

  it('simulate() — ATA missing: ATA creation instruction IS included in the simulation tx', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);

    await adapter.simulate(makeReqs());

    // The idempotent instruction must be part of the simulated tx, not just the broadcast tx.
    // This ensures simulateTransaction() exercises the real combined instruction set.
    expect(createAssociatedTokenAccountIdempotentInstruction).toHaveBeenCalledOnce();
  });

  // ── Fee-split path inside signBroadcastWithAtaCreate ──────────────────────
  //
  // The fee-split logic inside signBroadcastWithAtaCreate is separate from the
  // one in ExactSolanaClientScheme — it must be exercised directly to prevent
  // silent divergence (which would cause facilitator verification failures).

  it('signAndBroadcast() — ATA missing with fee split: emits two transfer instructions', async () => {
    mockConnection.getAccountInfo.mockResolvedValueOnce(null);

    const { txId } = await adapter.signAndBroadcast(
      makeReqs({ protocolFeeBps: 50, protocolFeeAddress: 'FeeWallet11111111111111111111111111111111111' }),
    );

    expect(txId).toBe(MOCK_TX_SIGNATURE);
    expect(createAssociatedTokenAccountIdempotentInstruction).toHaveBeenCalledOnce();
    // Two transfers: merchantAmount to recipient, feeAmount to fee wallet
    expect(mockCreateTransferInstruction).toHaveBeenCalledTimes(2);
  });

  // ── Native SOL is unaffected ───────────────────────────────────────────────

  it('simulate() — native SOL: getAccountInfo is never called (no ATA concept for SOL)', async () => {
    await adapter.simulate(makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
  });

  it('signAndBroadcast() — native SOL: getAccountInfo is never called', async () => {
    await adapter.signAndBroadcast(makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(mockConnection.getAccountInfo).not.toHaveBeenCalled();
  });
});

// ─── ExactSolanaClientScheme ──────────────────────────────────────────────────

describe('ExactSolanaClientScheme', () => {
  const scheme = new ExactSolanaClientScheme(
    mockSigner,
    mockConnection as ConstructorParameters<typeof ExactSolanaClientScheme>[1],
  );

  it('has scheme = "exact"', () => {
    expect(scheme.scheme).toBe('exact');
  });

  it('createPayment() returns a correctly-shaped s402ExactPayload', async () => {
    const payload = await scheme.createPayment(makeReqs());
    expect(payload.scheme).toBe('exact');
    expect(typeof payload.payload.transaction).toBe('string');
    expect(typeof payload.payload.signature).toBe('string');
  });

  it('createPayment() handles native SOL transfers', async () => {
    const payload = await scheme.createPayment(makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(payload.scheme).toBe('exact');
    expect(MockSystemProgram.transfer).toHaveBeenCalled();
  });
});

// ─── ExactSolanaFacilitatorScheme ─────────────────────────────────────────────

describe('ExactSolanaFacilitatorScheme', () => {
  const mockFacilitatorSigner: FacilitatorSolanaSigner = {
    verifyAndGetPayer: vi.fn().mockResolvedValue(MOCK_PAYER_ADDRESS),
    simulateTransaction: vi.fn().mockResolvedValue(makeSimResult({
      // SOL path: recipient (index 1) received 1_000_000 lamports
      preBalances: [1_000_000_000, 0],
      postBalances: [998_995_000, 1_000_000],
    })),
    executeTransaction: vi.fn().mockResolvedValue(MOCK_TX_SIGNATURE),
    confirmTransaction: vi.fn().mockResolvedValue(undefined),
  };

  const scheme = new ExactSolanaFacilitatorScheme(mockFacilitatorSigner);

  const exactPayload = {
    s402Version: '1' as const,
    scheme: 'exact' as const,
    payload: { transaction: Buffer.from('tx').toString('base64'), signature: '' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (mockFacilitatorSigner.verifyAndGetPayer as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_PAYER_ADDRESS);
    (mockFacilitatorSigner.simulateTransaction as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSimResult({
        preBalances: [1_000_000_000, 0],
        postBalances: [998_995_000, 1_000_000],
      }),
    );
    (mockFacilitatorSigner.executeTransaction as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_TX_SIGNATURE);
    (mockFacilitatorSigner.confirmTransaction as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('has scheme = "exact"', () => {
    expect(scheme.scheme).toBe('exact');
  });

  it('verify() returns invalid for wrong scheme', async () => {
    const result = await scheme.verify(
      { ...exactPayload, scheme: 'prepaid' as 'exact' },
      makeReqs({ asset: NATIVE_SOL_MINT }),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toMatch(/exact/i);
  });

  it('verify() returns invalid when signature check fails', async () => {
    (mockFacilitatorSigner.verifyAndGetPayer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Invalid signature'),
    );
    const result = await scheme.verify(exactPayload, makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain('Invalid signature');
  });

  it('verify() returns invalid when simulation fails', async () => {
    (mockFacilitatorSigner.simulateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSimResult({ success: false, err: 'InsufficientFunds' }),
    );
    const result = await scheme.verify(exactPayload, makeReqs({ asset: NATIVE_SOL_MINT }));
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toMatch(/simulation/i);
  });

  it('verify() succeeds for a valid SOL transfer', async () => {
    const result = await scheme.verify(
      exactPayload,
      makeReqs({ asset: NATIVE_SOL_MINT, amount: '1000000' }),
    );
    expect(result.valid).toBe(true);
    expect(result.payerAddress).toBe(MOCK_PAYER_ADDRESS);
  });

  it('verify() returns invalid when SOL recipient balance did not increase enough', async () => {
    (mockFacilitatorSigner.simulateTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeSimResult({
        preBalances: [1_000_000_000, 0],
        postBalances: [999_999_500, 500], // only 500 lamports increase, need 1_000_000
      }),
    );
    const result = await scheme.verify(
      exactPayload,
      makeReqs({ asset: NATIVE_SOL_MINT, amount: '1000000' }),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toMatch(/SOL balance/i);
  });

  it('settle() executes the transaction on success', async () => {
    const result = await scheme.settle(
      exactPayload,
      makeReqs({ asset: NATIVE_SOL_MINT, amount: '1000000' }),
    );
    expect(result.success).toBe(true);
    expect(result.txDigest).toBe(MOCK_TX_SIGNATURE);
    expect(typeof result.finalityMs).toBe('number');
    expect(mockFacilitatorSigner.executeTransaction).toHaveBeenCalledOnce();
    expect(mockFacilitatorSigner.confirmTransaction).toHaveBeenCalledOnce();
  });

  it('settle() returns failure when executeTransaction throws', async () => {
    (mockFacilitatorSigner.executeTransaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('RPC node unavailable'),
    );
    const result = await scheme.settle(
      exactPayload,
      makeReqs({ asset: NATIVE_SOL_MINT, amount: '1000000' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('RPC node unavailable');
  });

  // ── SPL token path ──────────────────────────────────────────────────────────

  it.todo(
    'Danny: verify() succeeds for a valid SPL token transfer — ' +
      'implement by mocking postTokenBalances with owner === MOCK_RECIPIENT_ADDRESS',
  );

  it.todo(
    'Danny: verify() returns invalid when SPL token recipient balance did not increase',
  );
});

// ─── Constants sanity ─────────────────────────────────────────────────────────

describe('constants', () => {
  it('CAIP-2 identifiers are correct', () => {
    expect(SOLANA_DEVNET_CAIP2).toBe('solana:devnet');
    expect(SOLANA_MAINNET_CAIP2).toBe('solana:mainnet-beta');
  });

  it('NATIVE_SOL_MINT is the wrapped SOL address', () => {
    expect(NATIVE_SOL_MINT).toBe('So11111111111111111111111111111111111111112');
  });

  it('BASE_FEE_LAMPORTS is 5000n', () => {
    expect(BASE_FEE_LAMPORTS).toBe(5_000n);
  });
});
