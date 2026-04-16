/**
 * SweeFi Prepaid Program — TypeScript client for the Anchor program
 *
 * PDA seeds: [b"prepaid", agent, provider, nonce_le_bytes]
 * Program ID: Vf1dcqmKo9zgNC73BujFcRnbNRj1fAGeYWSUnwYzfjJ
 *
 * Matches the Anchor program in contracts/solana/programs/sweefi-prepaid
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

// ─── Program Constants ───────────────────────────────────────────────────────

export const PREPAID_PROGRAM_ID = new PublicKey('Vf1dcqmKo9zgNC73BujFcRnbNRj1fAGeYWSUnwYzfjJ');

export const MIN_DEPOSIT = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;
export const MAX_FEE_BPS = 10_000;
export const MIN_WITHDRAWAL_DELAY = 60; // 1 minute
export const MAX_WITHDRAWAL_DELAY = 7 * 24 * 60 * 60; // 7 days

// ─── Account State ───────────────────────────────────────────────────────────

export interface PrepaidBalance {
  agent: PublicKey;
  provider: PublicKey;
  mint: PublicKey;
  ratePerCall: bigint;
  claimedCalls: bigint;
  maxCalls: bigint;
  lastClaimTs: bigint;
  withdrawalDelay: bigint;
  withdrawalPending: boolean;
  withdrawalRequestedTs: bigint;
  feeBps: number;
  feeRecipient: PublicKey;
  nonce: bigint;
  bump: number;
}

// ─── PDA Derivation ──────────────────────────────────────────────────────────

export function derivePrepaidBalancePda(
  agent: PublicKey,
  provider: PublicKey,
  nonce: bigint,
  programId: PublicKey = PREPAID_PROGRAM_ID,
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce);

  return PublicKey.findProgramAddressSync(
    [Buffer.from('prepaid'), agent.toBuffer(), provider.toBuffer(), nonceBuffer],
    programId,
  );
}

/**
 * Get the escrow token account address for a prepaid balance.
 * Uses standard ATA derivation with the balance PDA as authority.
 */
export async function getEscrowTokenAccount(
  balance: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, balance, true);
}

// ─── Instruction Builders ────────────────────────────────────────────────────

const CLOCK_SYSVAR = new PublicKey('SysvarC1ock11111111111111111111111111111111');

export interface CreatePrepaidParams {
  agent: PublicKey;
  provider: PublicKey;
  mint: PublicKey;
  amount: bigint;
  ratePerCall: bigint;
  maxCalls?: bigint;
  withdrawalDelay?: bigint;
  feeBps: number;
  feeRecipient: PublicKey;
  nonce: bigint;
}

export interface ClaimPrepaidParams {
  balance: PublicKey;
  provider: PublicKey;
  mint: PublicKey;
  feeRecipient: PublicKey;
  callCount: bigint; // Cumulative call count
}

export interface TopUpPrepaidParams {
  balance: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  amount: bigint;
}

/**
 * Build instruction to create a prepaid balance (agent deposits).
 */
export async function buildCreatePrepaidIx(
  params: CreatePrepaidParams,
): Promise<TransactionInstruction> {
  const [balancePda] = derivePrepaidBalancePda(params.agent, params.provider, params.nonce);

  const agentTokenAccount = await getAssociatedTokenAddress(params.mint, params.agent);
  const escrowTokenAccount = await getEscrowTokenAccount(balancePda, params.mint);

  // sha256("global:create")[0..8]
  const discriminator = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  // Args: amount, rate_per_call, max_calls, withdrawal_delay, fee_bps, nonce
  const argsBuffer = Buffer.alloc(8 + 8 + 8 + 8 + 2 + 8);
  let offset = 0;

  argsBuffer.writeBigUInt64LE(params.amount, offset); offset += 8;
  argsBuffer.writeBigUInt64LE(params.ratePerCall, offset); offset += 8;
  argsBuffer.writeBigUInt64LE(params.maxCalls ?? 0n, offset); offset += 8;
  argsBuffer.writeBigInt64LE(params.withdrawalDelay ?? BigInt(MIN_WITHDRAWAL_DELAY), offset); offset += 8;
  argsBuffer.writeUInt16LE(params.feeBps, offset); offset += 2;
  argsBuffer.writeBigUInt64LE(params.nonce, offset);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: PREPAID_PROGRAM_ID,
    keys: [
      { pubkey: params.agent, isSigner: true, isWritable: true },
      { pubkey: params.provider, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: balancePda, isSigner: false, isWritable: true },
      { pubkey: agentTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build instruction to claim prepaid funds (provider claims for call count).
 */
export async function buildClaimPrepaidIx(
  params: ClaimPrepaidParams,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(params.balance, params.mint);
  const providerTokenAccount = await getAssociatedTokenAddress(params.mint, params.provider);
  const feeTokenAccount = await getAssociatedTokenAddress(params.mint, params.feeRecipient);

  // sha256("global:claim")[0..8]
  const discriminator = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);

  const argsBuffer = Buffer.alloc(8);
  argsBuffer.writeBigUInt64LE(params.callCount, 0);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: PREPAID_PROGRAM_ID,
    keys: [
      { pubkey: params.provider, isSigner: true, isWritable: true },
      { pubkey: params.balance, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: providerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build instruction to request withdrawal (starts delay timer).
 */
export async function buildRequestWithdrawalIx(
  balance: PublicKey,
  agent: PublicKey,
  mint: PublicKey,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(balance, mint);

  // sha256("global:request_withdrawal")[0..8]
  const discriminator = Buffer.from([251, 85, 121, 205, 56, 201, 12, 177]);

  return new TransactionInstruction({
    programId: PREPAID_PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: true, isWritable: true },
      { pubkey: balance, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to finalize withdrawal (after delay).
 */
export async function buildFinalizeWithdrawalIx(
  balance: PublicKey,
  agent: PublicKey,
  mint: PublicKey,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(balance, mint);
  const agentTokenAccount = await getAssociatedTokenAddress(mint, agent);

  // sha256("global:finalize_withdrawal")[0..8]
  const discriminator = Buffer.from([178, 87, 206, 68, 201, 186, 164, 232]);

  return new TransactionInstruction({
    programId: PREPAID_PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: true, isWritable: true },
      { pubkey: balance, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: agentTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to top up a prepaid balance.
 */
export async function buildTopUpPrepaidIx(
  params: TopUpPrepaidParams,
): Promise<TransactionInstruction> {
  const agentTokenAccount = await getAssociatedTokenAddress(params.mint, params.agent);
  const escrowTokenAccount = await getEscrowTokenAccount(params.balance, params.mint);

  // sha256("global:top_up")[0..8]
  const discriminator = Buffer.from([236, 225, 96, 9, 60, 106, 77, 208]);

  const argsBuffer = Buffer.alloc(8);
  argsBuffer.writeBigUInt64LE(params.amount, 0);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: PREPAID_PROGRAM_ID,
    keys: [
      { pubkey: params.agent, isSigner: true, isWritable: true },
      { pubkey: params.balance, isSigner: false, isWritable: true },
      { pubkey: agentTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  });
}
