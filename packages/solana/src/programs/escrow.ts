/**
 * SweeFi Escrow Program — TypeScript client for the Anchor program
 *
 * PDA seeds: [b"escrow", buyer, seller, nonce_le_bytes]
 * Program ID: 3vmb27R62ovX5moiQnM479eU5fPfaLKJFKmdYAMVfhqB
 *
 * Matches the Anchor program in contracts/solana/programs/sweefi-escrow
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

export const ESCROW_PROGRAM_ID = new PublicKey('3vmb27R62ovX5moiQnM479eU5fPfaLKJFKmdYAMVfhqB');

export const MIN_DEPOSIT = 1_000_000n;
export const BPS_DENOMINATOR = 10_000n;
export const MAX_FEE_BPS = 10_000;
export const MAX_DESCRIPTION_LEN = 1024;
export const GRACE_RATIO_BPS = 5000n; // 50%
export const GRACE_FLOOR = 7 * 24 * 60 * 60; // 7 days
export const GRACE_CAP = 30 * 24 * 60 * 60; // 30 days

// ─── Account State ───────────────────────────────────────────────────────────

export enum EscrowState {
  Active = 0,
  Disputed = 1,
  Released = 2,
  Refunded = 3,
}

export interface EscrowAccount {
  buyer: PublicKey;
  seller: PublicKey;
  arbiter: PublicKey;
  mint: PublicKey;
  amount: bigint;
  createdTs: bigint;
  deadline: bigint;
  state: EscrowState;
  feeBps: number;
  feeRecipient: PublicKey;
  nonce: bigint;
  bump: number;
}

// ─── PDA Derivation ──────────────────────────────────────────────────────────

export function deriveEscrowPda(
  buyer: PublicKey,
  seller: PublicKey,
  nonce: bigint,
  programId: PublicKey = ESCROW_PROGRAM_ID,
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce);

  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), seller.toBuffer(), nonceBuffer],
    programId,
  );
}

/**
 * Get the escrow token account address.
 * Uses standard ATA derivation with the escrow PDA as authority.
 */
export async function getEscrowTokenAccount(
  escrow: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, escrow, true);
}

// ─── Instruction Builders ────────────────────────────────────────────────────

const CLOCK_SYSVAR = new PublicKey('SysvarC1ock11111111111111111111111111111111');

export interface CreateEscrowParams {
  buyer: PublicKey;
  seller: PublicKey;
  arbiter: PublicKey;
  mint: PublicKey;
  amount: bigint;
  deadline: bigint;
  feeBps: number;
  feeRecipient: PublicKey;
  nonce: bigint;
}

export interface ReleaseEscrowParams {
  escrow: PublicKey;
  caller: PublicKey; // Buyer or arbiter
  seller: PublicKey;
  mint: PublicKey;
  feeRecipient: PublicKey;
}

export interface RefundEscrowParams {
  escrow: PublicKey;
  caller: PublicKey;
  buyer: PublicKey;
  mint: PublicKey;
}

/**
 * Build instruction to create an escrow.
 */
export async function buildCreateEscrowIx(
  params: CreateEscrowParams,
): Promise<TransactionInstruction> {
  const [escrowPda] = deriveEscrowPda(params.buyer, params.seller, params.nonce);

  const buyerTokenAccount = await getAssociatedTokenAddress(params.mint, params.buyer);
  const escrowTokenAccount = await getEscrowTokenAccount(escrowPda, params.mint);

  // sha256("global:create")[0..8]
  const discriminator = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  // Args: amount, deadline, fee_bps, nonce
  const argsBuffer = Buffer.alloc(8 + 8 + 2 + 8);
  let offset = 0;

  argsBuffer.writeBigUInt64LE(params.amount, offset); offset += 8;
  argsBuffer.writeBigInt64LE(params.deadline, offset); offset += 8;
  argsBuffer.writeUInt16LE(params.feeBps, offset); offset += 2;
  argsBuffer.writeBigUInt64LE(params.nonce, offset);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: params.buyer, isSigner: true, isWritable: true },
      { pubkey: params.seller, isSigner: false, isWritable: false },
      { pubkey: params.arbiter, isSigner: false, isWritable: false },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
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
 * Build instruction to release escrow to seller.
 */
export async function buildReleaseEscrowIx(
  params: ReleaseEscrowParams,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(params.escrow, params.mint);
  const sellerTokenAccount = await getAssociatedTokenAddress(params.mint, params.seller);
  const feeTokenAccount = await getAssociatedTokenAddress(params.mint, params.feeRecipient);

  // sha256("global:release")[0..8]
  const discriminator = Buffer.from([253, 249, 15, 206, 28, 127, 193, 241]);

  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: params.caller, isSigner: true, isWritable: true },
      { pubkey: params.escrow, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: sellerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to refund escrow to buyer.
 */
export async function buildRefundEscrowIx(
  params: RefundEscrowParams,
): Promise<TransactionInstruction> {
  const escrowTokenAccount = await getEscrowTokenAccount(params.escrow, params.mint);
  const buyerTokenAccount = await getAssociatedTokenAddress(params.mint, params.buyer);

  // sha256("global:refund")[0..8]
  const discriminator = Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]);

  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: params.caller, isSigner: true, isWritable: true },
      { pubkey: params.escrow, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: buyerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}

/**
 * Build instruction to dispute an escrow.
 */
export async function buildDisputeEscrowIx(
  escrow: PublicKey,
  caller: PublicKey,
): Promise<TransactionInstruction> {
  // sha256("global:dispute")[0..8]
  const discriminator = Buffer.from([216, 92, 128, 146, 202, 85, 135, 73]);

  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: caller, isSigner: true, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}
