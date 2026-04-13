/**
 * s402 Exact Scheme — Client (Solana)
 *
 * Builds a signed SPL token (or native SOL) transfer transaction for one-shot
 * exact payments. Mirrors ExactSuiClientScheme from @sweefi/sui.
 *
 * Transaction anatomy:
 *   - Native SOL: one or two SystemProgram.transfer instructions (+ fee split)
 *   - SPL token:  one or two createTransferInstruction calls via @solana/spl-token
 *
 * Protocol fee split:
 *   When protocolFeeBps > 0, the total amount is split at the instruction level.
 *   Both instructions share the same signer and blockhash — atomically safe.
 *
 * Amounts:
 *   All amounts are kept as BigInt throughout and passed directly to web3.js/spl-token
 *   (both accept number | bigint since v1.77 / v0.4.0). Number() conversion is
 *   intentionally avoided to prevent precision loss above 2^53.
 */

import { Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';
import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402ExactPayload,
  s402PaymentPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSolanaSigner } from '../../signer.js';
import { NATIVE_SOL_MINT } from '../../constants.js';

// ─── ExactSolanaClientScheme ──────────────────────────────────────────────────

export class ExactSolanaClientScheme implements s402ClientScheme {
  readonly scheme = 'exact' as const;

  constructor(
    private readonly signer: ClientSolanaSigner,
    private readonly connection: Connection,
  ) {}

  /**
   * Build and sign the payment transaction, returning the s402 payload AND the
   * blockhash metadata needed for confirmTransaction.
   *
   * This is the authoritative method — createPayment() delegates to it.
   * SolanaPaymentAdapter.signAndBroadcast() calls this directly so it can use
   * the same blockhash for transaction confirmation (avoids the mismatch that
   * occurs when a second getLatestBlockhash() call is made after sendRawTransaction).
   */
  async createPaymentWithMeta(requirements: s402PaymentRequirements): Promise<{
    s402Payload: s402ExactPayload;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const { amount, asset, payTo, protocolFeeBps, protocolFeeAddress } = requirements;

    const payer = new PublicKey(this.signer.address);
    const recipient = new PublicKey(payTo);
    const totalAmount = BigInt(amount);

    const tx = new Transaction();

    const isNative = asset === NATIVE_SOL_MINT || asset === 'native';

    if (isNative) {
      // ── Native SOL transfer ──────────────────────────────────────────────
      if (protocolFeeBps && protocolFeeBps > 0 && protocolFeeAddress) {
        const feeAmount = (totalAmount * BigInt(protocolFeeBps)) / 10000n;
        const merchantAmount = totalAmount - feeAmount;
        tx.add(
          // Pass bigint directly — SystemProgram.transfer accepts number | bigint (v1.77+)
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: recipient,
            lamports: merchantAmount,
          }),
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: new PublicKey(protocolFeeAddress),
            lamports: feeAmount,
          }),
        );
      } else {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: payer,
            toPubkey: recipient,
            lamports: totalAmount,
          }),
        );
      }
    } else {
      // ── SPL token transfer ───────────────────────────────────────────────
      const mint = new PublicKey(asset);
      const sourceAta = await getAssociatedTokenAddress(mint, payer);
      const destAta = await getAssociatedTokenAddress(mint, recipient);

      if (protocolFeeBps && protocolFeeBps > 0 && protocolFeeAddress) {
        const feeAmount = (totalAmount * BigInt(protocolFeeBps)) / 10000n;
        const merchantAmount = totalAmount - feeAmount;
        const feeRecipient = new PublicKey(protocolFeeAddress);
        const feeDestAta = await getAssociatedTokenAddress(mint, feeRecipient);

        tx.add(
          // createTransferInstruction accepts number | bigint (spl-token v0.4+)
          createTransferInstruction(
            sourceAta,
            destAta,
            payer,
            merchantAmount,
            [],
            TOKEN_PROGRAM_ID,
          ),
          createTransferInstruction(
            sourceAta,
            feeDestAta,
            payer,
            feeAmount,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      } else {
        tx.add(
          createTransferInstruction(
            sourceAta,
            destAta,
            payer,
            totalAmount,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      }
    }

    const { serialized, signature, blockhash, lastValidBlockHeight } =
      await this.signer.signTransaction(tx, this.connection);

    return {
      s402Payload: {
        s402Version: S402_VERSION,
        scheme: 'exact',
        payload: {
          transaction: serialized,
          signature,
        },
      },
      blockhash,
      lastValidBlockHeight,
    };
  }

  /** Satisfies the s402ClientScheme interface. Delegates to createPaymentWithMeta(). */
  async createPayment(requirements: s402PaymentRequirements): Promise<s402ExactPayload> {
    const { s402Payload } = await this.createPaymentWithMeta(requirements);
    return s402Payload;
  }

  /**
   * Settlement verification stub.
   *
   * Solana lacks Sui's deterministic digest-from-bytes, so we cannot do
   * offline digest-binding verification. Returns unverified with a reason.
   * Full implementation requires on-chain transaction lookup via RPC.
   */
  verifySettlement(
    _payload: s402PaymentPayload,
    settleResponse: s402SettleResponse,
  ): s402SettlementVerification {
    return {
      verified: false,
      expectedDigest: '',
      actualDigest: settleResponse.txDigest ?? null,
      reason: 'Solana settlement verification not yet implemented — requires RPC lookup',
    };
  }
}
