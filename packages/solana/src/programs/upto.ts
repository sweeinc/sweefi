/**
 * SweeFi Upto Program — TypeScript client for the Anchor program
 *
 * PDA seeds: [b"upto", payer, recipient, nonce_le_bytes]
 * Program ID: F1bK8wXXkh6E5eYJ6wNtW1xtPR7LBy8te3Gh5njAVTbx
 *
 * Matches the Anchor program in contracts/solana/programs/sweefi-upto
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

// ─── Program Constants ───────────────────────────────────────────────────────

export const UPTO_PROGRAM_ID = new PublicKey('F1bK8wXXkh6E5eYJ6wNtW1xtPR7LBy8te3Gh5njAVTbx');

export const MIN_DEPOSIT = 1_000_000n; // 0.001 token
export const BPS_DENOMINATOR = 10_000n;
export const MAX_FEE_BPS = 10_000;

// ─── Account State ───────────────────────────────────────────────────────────

export enum UptoState {
  Pending = 0,
  Settled = 1,
  Expired = 2,
}

export interface UptoDeposit {
  payer: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  maxAmount: bigint;
  deadline: bigint; // Unix timestamp in seconds
  state: UptoState;
  feeBps: number;
  feeRecipient: PublicKey;
  nonce: bigint;
  bump: number;
}

// ─── PDA Derivation ──────────────────────────────────────────────────────────

export function deriveUptoDepositPda(
  payer: PublicKey,
  recipient: PublicKey,
  nonce: bigint,
  programId: PublicKey = UPTO_PROGRAM_ID,
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce);

  return PublicKey.findProgramAddressSync(
    [Buffer.from('upto'), payer.toBuffer(), recipient.toBuffer(), nonceBuffer],
    programId,
  );
}

/**
 * Get the escrow token account address.
 *
 * IMPORTANT: Anchor's `associated_token` constraint creates a standard ATA
 * with the deposit PDA as the authority. This is NOT a custom PDA derivation.
 *
 * @returns Promise<PublicKey> - the ATA address (no bump needed for ATAs)
 */
export async function getEscrowTokenAccount(
  deposit: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  // Anchor uses associated_token::authority = deposit, which creates a standard ATA
  return getAssociatedTokenAddress(mint, deposit, true); // allowOwnerOffCurve = true for PDA authority
}

// ─── Instruction Builders ────────────────────────────────────────────────────

export interface CreateUptoParams {
  payer: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  amount: bigint;
  deadlineSeconds: bigint;
  feeBps: number;
  feeRecipient: PublicKey;
  nonce: bigint;
}

export interface SettleUptoParams {
  deposit: PublicKey;
  recipient: PublicKey;
  feeRecipient: PublicKey;
  actualAmount: bigint;
  mint: PublicKey;
}

export interface ExpireUptoParams {
  deposit: PublicKey;
  payer: PublicKey;
  mint: PublicKey;
}

/**
 * Build instruction to create an upto deposit.
 *
 * Account layout (matches Anchor's Create context):
 * 0. [signer] payer
 * 1. [] recipient
 * 2. [writable] deposit (PDA)
 * 3. [] mint
 * 4. [writable] payerTokenAccount
 * 5. [writable] escrowTokenAccount (PDA)
 * 6. [] feeRecipient
 * 7. [] tokenProgram
 * 8. [] systemProgram
 * 9. [] rent
 */
export async function buildCreateUptoIx(
  params: CreateUptoParams,
): Promise<TransactionInstruction> {
  const [depositPda, bump] = deriveUptoDepositPda(
    params.payer,
    params.recipient,
    params.nonce,
  );

  const payerTokenAccount = await getAssociatedTokenAddress(
    params.mint,
    params.payer,
  );

  const escrowTokenAccount = await getEscrowTokenAccount(depositPda, params.mint);

  // Anchor instruction discriminator for "create"
  // sha256("global:create")[0..8]
  const discriminator = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  // Instruction data: discriminator + args
  const argsBuffer = Buffer.alloc(8 + 8 + 2 + 8); // amount, deadline, fee_bps, nonce
  let offset = 0;

  // amount (u64)
  argsBuffer.writeBigUInt64LE(params.amount, offset);
  offset += 8;

  // deadline (i64)
  argsBuffer.writeBigInt64LE(params.deadlineSeconds, offset);
  offset += 8;

  // fee_bps (u16)
  argsBuffer.writeUInt16LE(params.feeBps, offset);
  offset += 2;

  // nonce (u64)
  argsBuffer.writeBigUInt64LE(params.nonce, offset);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: UPTO_PROGRAM_ID,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.recipient, isSigner: false, isWritable: false },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.feeRecipient, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build instruction to settle an upto deposit.
 *
 * Account layout (matches Anchor's Settle context):
 * 0. [signer] recipient
 * 1. [writable] deposit (PDA)
 * 2. [] payer
 * 3. [writable] escrowTokenAccount
 * 4. [writable] recipientTokenAccount
 * 5. [writable] payerTokenAccount (for refund)
 * 6. [writable] feeTokenAccount
 * 7. [] tokenProgram
 * 8. [] clock
 */
export async function buildSettleUptoIx(
  params: SettleUptoParams,
  payer: PublicKey,
  recipientSigner: PublicKey,
): Promise<TransactionInstruction> {
  const recipientTokenAccount = await getAssociatedTokenAddress(
    params.mint,
    params.recipient,
  );

  const payerTokenAccount = await getAssociatedTokenAddress(
    params.mint,
    payer,
  );

  const feeTokenAccount = await getAssociatedTokenAddress(
    params.mint,
    params.feeRecipient,
  );

  const escrowTokenAccount = await getEscrowTokenAccount(params.deposit, params.mint);

  // Anchor instruction discriminator for "settle"
  // sha256("global:settle")[0..8]
  const discriminator = Buffer.from([175, 42, 185, 87, 144, 131, 102, 212]);

  const argsBuffer = Buffer.alloc(8); // actual_amount (u64)
  argsBuffer.writeBigUInt64LE(params.actualAmount, 0);

  const data = Buffer.concat([discriminator, argsBuffer]);

  return new TransactionInstruction({
    programId: UPTO_PROGRAM_ID,
    keys: [
      { pubkey: recipientSigner, isSigner: true, isWritable: false },
      { pubkey: params.deposit, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: false, isWritable: false },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build instruction to expire an upto deposit (refund to payer after deadline).
 *
 * Account layout (matches Anchor's Expire context):
 * 0. [signer] caller (anyone can call after deadline)
 * 1. [writable] deposit (PDA)
 * 2. [] payer
 * 3. [writable] escrowTokenAccount
 * 4. [writable] payerTokenAccount
 * 5. [] tokenProgram
 * 6. [] clock
 */
export async function buildExpireUptoIx(
  params: ExpireUptoParams,
  caller: PublicKey,
): Promise<TransactionInstruction> {
  const payerTokenAccount = await getAssociatedTokenAddress(
    params.mint,
    params.payer,
  );

  const escrowTokenAccount = await getEscrowTokenAccount(params.deposit, params.mint);

  // Anchor instruction discriminator for "expire"
  // sha256("global:expire")[0..8]
  const discriminator = Buffer.from([243, 83, 205, 58, 57, 201, 247, 146]);

  return new TransactionInstruction({
    programId: UPTO_PROGRAM_ID,
    keys: [
      { pubkey: caller, isSigner: true, isWritable: false },
      { pubkey: params.deposit, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: false, isWritable: false },
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
      { pubkey: payerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });
}
