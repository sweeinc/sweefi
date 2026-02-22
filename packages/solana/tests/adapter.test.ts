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

const MOCK_PAYER_ADDRESS = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
const MOCK_RECIPIENT_ADDRESS = 'BobVAwj3ySXFHR2eq6bBg9rp1fTQEUGegCGpCvTCnDvL';
const MOCK_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const MOCK_TX_SIGNATURE = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d1MV3ry2FaLDDpTWFwJiE3FGJbDTdqtSURHEKnPfScTD';
const MOCK_BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

// ── @solana/web3.js mock ──────────────────────────────────────────────────────

const mockTransaction = {
  add: vi.fn().mockReturnThis(),
  sign: vi.fn(),
  serialize: vi.fn().mockReturnValue(Buffer.from('mock-tx-bytes')),
  serializeMessage: vi.fn().mockReturnValue(Buffer.from('mock-message')),
  compileMessage: vi.fn().mockReturnValue({
    accountKeys: [
      { toBase58: () => MOCK_PAYER_ADDRESS },
      { toBase58: () => MOCK_RECIPIENT_ADDRESS },
    ],
  }),
  signatures: [
    {
      publicKey: { toBase58: () => MOCK_PAYER_ADDRESS, toBytes: () => new Uint8Array(32).fill(1) },
      signature: Buffer.from(new Uint8Array(64).fill(2)),
    },
  ],
  feePayer: { toBase58: () => MOCK_PAYER_ADDRESS },
  recentBlockhash: MOCK_BLOCKHASH,
};

const MockTransaction = vi.fn().mockImplementation(() => ({ ...mockTransaction }));
// Transaction.from() static method for deserialization
(MockTransaction as unknown as Record<string, unknown>).from = vi.fn().mockReturnValue({ ...mockTransaction });

const MockPublicKey = vi.fn().mockImplementation((key: string) => ({
  toBase58: () => key,
  toBytes: () => new Uint8Array(32).fill(1),
  equals: (other: { toBase58(): string }) => other.toBase58() === key,
  toString: () => key,
}));

const MockSystemProgram = {
  transfer: vi.fn().mockReturnValue({ programId: 'system', keys: [], data: Buffer.alloc(12) }),
};

const mockConnection = {
  getLatestBlockhash: vi.fn().mockResolvedValue({
    blockhash: MOCK_BLOCKHASH,
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
  sendRawTransaction: vi.fn().mockResolvedValue(MOCK_TX_SIGNATURE),
  confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
};

const MockConnection = vi.fn().mockImplementation(() => mockConnection);

vi.mock('@solana/web3.js', () => ({
  Transaction: MockTransaction,
  PublicKey: MockPublicKey,
  SystemProgram: MockSystemProgram,
  Connection: MockConnection,
  clusterApiUrl: vi.fn().mockReturnValue('https://api.devnet.solana.com'),
}));

// ── @solana/spl-token mock ────────────────────────────────────────────────────

const MOCK_SOURCE_ATA = 'SourceATA111111111111111111111111111111111111';
const MOCK_DEST_ATA = 'DestATA1111111111111111111111111111111111111';

vi.mock('@solana/spl-token', () => ({
  TOKEN_PROGRAM_ID: { toBase58: () => 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
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
      network: SOLANA_DEVNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      amount: '1000000',
      asset: MOCK_USDC_MINT,
    } as Parameters<typeof server.buildRequirements>[0]);

    expect(reqs.accepts).toContain('exact');
    expect(reqs.network).toBe(SOLANA_DEVNET_CAIP2);
    expect(reqs.asset).toBe(MOCK_USDC_MINT);
    expect(reqs.amount).toBe('1000000');
    expect(reqs.payTo).toBe(MOCK_RECIPIENT_ADDRESS);
  });

  it('defaults to devnet USDC when no asset given', () => {
    const reqs = server.buildRequirements({
      network: SOLANA_DEVNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      amount: '500000',
    } as Parameters<typeof server.buildRequirements>[0]);

    expect(reqs.asset).toBe(USDC_DEVNET_MINT);
  });

  it('defaults to mainnet USDC on mainnet', () => {
    const reqs = server.buildRequirements({
      network: SOLANA_MAINNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      amount: '500000',
    } as Parameters<typeof server.buildRequirements>[0]);

    expect(reqs.asset).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  });

  it('includes protocolFeeBps if provided', () => {
    const reqs = server.buildRequirements({
      network: SOLANA_DEVNET_CAIP2,
      payTo: MOCK_RECIPIENT_ADDRESS,
      amount: '1000000',
      protocolFeeBps: 50,
    } as Parameters<typeof server.buildRequirements>[0]);

    expect(reqs.protocolFeeBps).toBe(50);
  });

  it('throws if amount is missing', () => {
    expect(() =>
      server.buildRequirements({
        network: SOLANA_DEVNET_CAIP2,
        payTo: MOCK_RECIPIENT_ADDRESS,
      } as Parameters<typeof server.buildRequirements>[0]),
    ).toThrow('amount');
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
    s402Version: '1',
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
