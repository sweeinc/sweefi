/**
 * SweeFi Stream Program — TypeScript client for the Anchor program
 *
 * PDA seeds: [b"stream", payer, recipient, nonce_le_bytes]
 * Program ID: AEEnjPx8GGyFq5mbhGd2du47VTWgLXomofgcD3oLi9kN
 *
 * Matches the Anchor program in contracts/solana/programs/sweefi-stream
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

export const STREAM_PROGRAM_ID = new PublicKey('AEEnjPx8GGyFq5mbhGd2du47VTWgLXomofgcD3oLi9kN');

export const MIN_DEPOSIT = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;
export const MAX_FEE_BPS = 10_000;
export const DEFAULT_RECIPIENT_CLOSE_TIMEOUT = 7 * 24 * 60 * 60; // 7 days in seconds

// ─── Account State ───────────────────────────────────────────────────────────

export enum StreamState {
  Active = 0,
  Paused = 1,
  Closed = 2,
}

export interface StreamMeter {
  payer: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  ratePerSecond: bigint;
  budgetCap: bigint;
  totalClaimed: bigint;
  totalFeesPaid: bigint;
  state: StreamState;
  startTs: bigint;
  lastClaimTs: bigint;
  lastActivity: bigint;
  pausedAccrual: bigint;
  feeBps: number;
  feeRecipient: PublicKey;
  recipientCloseTimeout: bigint;
  recipientCloseRequestedTs: bigint;
  nonce: bigint;
  bump: number;
}

// ─── PDA Derivation ──────────────────────────────────────────────────────────

export function deriveStreamMeterPda(
  payer: PublicKey,
  recipient: PublicKey,
  nonce: bigint,
  programId: PublicKey = STREAM_PROGRAM_ID,
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce);

  return PublicKey.findProgramAddressSync(
    [Buffer.from('stream'), payer.toBuffer(), recipient.toBuffer(), nonceBuffer],
    programId,
  );
}

/**
 * Get the escrow token account address for a stream meter.
 * Uses standard ATA derivation with the meter PDA as authority.
 */
export async function getEscrowTokenAccount(
  meter: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, meter, true);
}

// ─── Instruction Builders ────────────────────────────────────────────────────

export interface CreateStreamParams {
  payer: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  deposit: bigint;
  ratePerSecond: bigint;
  budgetCap?: bigint;
  feeBps: number;
  feeRecipient: PublicKey;
  recipientCloseTimeout?: bigint;
  nonce: bigint;
}

export interface ClaimStreamParams {
  meter: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  payer: PublicKey; // Original payer (for fee recipient lookup)
  feeRecipient: PublicKey;
}

export interface CloseStreamParams {
  meter: PublicKey;
  payer: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  feeRecipient: PublicKey;
}

export interface TopUpStreamParams {
  meter: PublicKey;
  payer: PublicKey;
  mint: PublicKey;
  amount: bigint;
}

const CLOCK_SYSVAR = new PublicKey('SysvarC1ock11111111111111111111111111111111');

/**
 * Build instruction to create a stream meter.
 */
export async function buildCreateStreamIx(
  params: CreateStreamParams,
): Promise<TransactionInstruction> {
  const [meterPda] = deriveStreamMeterPda(params.payer, params.recipient, params.nonce);

  const payerTokenAccount = await getAssociatedTokenAddress(params.mint, params.payer);
  const escrowTokenAccount = await getEscrowTokenAccount(meterPda, params.mint);

  // sha256("global:create")[0..8]
  const discriminator = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  // Args: deposit_amount, rate_per_second, budget_cap, fee_bps, recipient_close_timeout, nonce
  const argsBuffer = Buffer.alloc(8 + 8 + 8 + 2 + 8 + 8);
  let offset = 0;

  argsBuffer.writeBigUInt64LE(params.deposit, offset); offset += 8;
  argsBuffer.writeBigUInt64LE(params.ratePerSecond, offset); offset += 8;
  argsBuffer.writeBigUInt64LE(params.budgetCap ?? 0n, offset); offset += 8;
  argsBuffer.writeUInt16LE(params.feeBps, offset); offset += 2;
  argsBuffer.writeBigInt64LE(params.recipientCloseTimeout ?? BigInt(DEFAULT_RECIPIENT_CLOSE_TIMEOUT), offset); offset += 8;
  argsBuffer.writeBigUInt64LE(params.nonce, offset);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: STREAM_PROGRAM_ID,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.recipient, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: meterPda, isSigner: false, isWritable: true },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build instruction to claim accrued funds from a stream.
 */
export async function buildClaimStreamIx(
  params: ClaimStreamParams,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(params.meter, params.mint);
  const recipientTokenAccount = await getAssociatedTokenAddress(params.mint, params.recipient);
  const feeTokenAccount = await getAssociatedTokenAddress(params.mint, params.feeRecipient);

  // sha256("global:claim")[0..8]
  const discriminator = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]);

  return new TransactionInstruction({
    programId: STREAM_PROGRAM_ID,
    keys: [
      { pubkey: params.recipient, isSigner: true, isWritable: true },
      { pubkey: params.meter, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to pause a stream (payer only).
 */
export async function buildPauseStreamIx(
  meter: PublicKey,
  payer: PublicKey,
): Promise<TransactionInstruction> {
  // sha256("global:pause")[0..8]
  const discriminator = Buffer.from([211, 22, 221, 251, 74, 121, 193, 47]);

  return new TransactionInstruction({
    programId: STREAM_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: meter, isSigner: false, isWritable: true },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to resume a paused stream (payer only).
 */
export async function buildResumeStreamIx(
  meter: PublicKey,
  payer: PublicKey,
): Promise<TransactionInstruction> {
  // sha256("global:resume")[0..8]
  const discriminator = Buffer.from([1, 166, 51, 170, 127, 32, 141, 206]);

  return new TransactionInstruction({
    programId: STREAM_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: meter, isSigner: false, isWritable: true },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to close a stream (payer only, settles all accrued).
 */
export async function buildCloseStreamIx(
  params: CloseStreamParams,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(params.meter, params.mint);
  const recipientTokenAccount = await getAssociatedTokenAddress(params.mint, params.recipient);
  const payerTokenAccount = await getAssociatedTokenAddress(params.mint, params.payer);
  const feeTokenAccount = await getAssociatedTokenAddress(params.mint, params.feeRecipient);

  // sha256("global:close")[0..8]
  const discriminator = Buffer.from([98, 165, 201, 177, 108, 65, 206, 96]);

  return new TransactionInstruction({
    programId: STREAM_PROGRAM_ID,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.meter, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to top up a stream with more funds.
 */
export async function buildTopUpStreamIx(
  params: TopUpStreamParams,
): Promise<TransactionInstruction> {
  const payerTokenAccount = await getAssociatedTokenAddress(params.mint, params.payer);
  const escrowTokenAccount = await getEscrowTokenAccount(params.meter, params.mint);

  // sha256("global:top_up")[0..8]
  const discriminator = Buffer.from([236, 225, 96, 9, 60, 106, 77, 208]);

  const argsBuffer = Buffer.alloc(8);
  argsBuffer.writeBigUInt64LE(params.amount, 0);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: STREAM_PROGRAM_ID,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.meter, isSigner: false, isWritable: true },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}
