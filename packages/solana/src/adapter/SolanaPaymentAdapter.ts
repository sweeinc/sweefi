/**
 * SolanaPaymentAdapter — implements PaymentAdapter from @sweefi/ui-core
 *
 * Signer injection model: accepts a pre-connected signer (SolanaKeypairSigner
 * for Node.js agents, SolanaWalletSigner for browser) plus a pre-configured
 * Solana Connection. The adapter never manages wallet or connection lifecycle.
 *
 * Currently supports the `exact` payment scheme (SPL token + native SOL).
 * Advanced schemes (prepaid, stream, escrow) require Anchor programs that do
 * not yet exist for Solana — see TODO comments below.
 *
 * Usage:
 *   const adapter = new SolanaPaymentAdapter({
 *     wallet: new SolanaKeypairSigner(keypair),
 *     connection: new Connection(clusterApiUrl('devnet'), 'confirmed'),
 *     network: 'solana:devnet',
 *   });
 *   const controller = createPaymentController(adapter);
 */

import {
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { Connection } from '@solana/web3.js';
import type { PaymentAdapter, SimulationResult } from '@sweefi/ui-core';
import type { s402PaymentRequirements } from 's402';
import type { ClientSolanaSigner } from '../signer.js';
import { ExactSolanaClientScheme } from '../s402/exact/client.js';
import type { SolanaNetwork } from '../constants.js';
import { NATIVE_SOL_MINT, BASE_FEE_LAMPORTS } from '../constants.js';
import { base64ToUint8Array } from '../utils/encoding.js';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface SolanaPaymentAdapterConfig {
  /** Signer: SolanaKeypairSigner for agents/CLI, SolanaWalletSigner for browsers */
  wallet: ClientSolanaSigner;
  /** Pre-configured Solana Connection (controls RPC endpoint and commitment) */
  connection: Connection;
  /** CAIP-2 network identifier */
  network: SolanaNetwork;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class SolanaPaymentAdapter implements PaymentAdapter {
  readonly network: string;

  private readonly wallet: ClientSolanaSigner;
  private readonly connection: Connection;
  private readonly exactScheme: ExactSolanaClientScheme;

  constructor({ wallet, connection, network }: SolanaPaymentAdapterConfig) {
    this.network = network;
    this.wallet = wallet;
    this.connection = connection;
    this.exactScheme = new ExactSolanaClientScheme(wallet, connection);
  }

  getAddress(): string | null {
    try {
      return this.wallet.address ?? null;
    } catch {
      // SolanaWalletSigner throws if wallet is disconnected
      return null;
    }
  }

  /**
   * Dry-run the payment without committing funds.
   *
   * Builds a legacy Transaction (matching createPayment exactly — same fee split
   * logic, same instruction set) and simulates it via the Connection. Returns an
   * estimated fee in lamports. Using a legacy Transaction ensures the simulated
   * account/balance changes match what the actual transaction would produce.
   *
   * Note: The fee estimate is a lower bound (base fee only). Priority fees, if
   * used by the consumer, will add to the actual cost. For a tighter estimate,
   * call connection.getFeeForMessage() on the compiled message after simulation.
   */
  async simulate(reqs: s402PaymentRequirements): Promise<SimulationResult> {
    if (!reqs.accepts.includes('exact')) {
      return {
        success: false,
        error: {
          code: 'UNSUPPORTED_SCHEME',
          message: `SolanaPaymentAdapter supports 'exact' only. Got: ${reqs.accepts.join(', ')}`,
        },
      };
    }

    // TODO (future): prepaid, stream, escrow once Anchor programs are deployed.

    try {
      const payer = new PublicKey(this.wallet.address);
      const recipient = new PublicKey(reqs.payTo);
      const totalAmount = BigInt(reqs.amount);
      const isNative = reqs.asset === NATIVE_SOL_MINT || reqs.asset === 'native';

      // Build the same instruction set as ExactSolanaClientScheme.createPayment(),
      // including any protocol fee split, so simulation reflects the real tx structure.
      const tx = new Transaction();

      if (isNative) {
        if (reqs.protocolFeeBps && reqs.protocolFeeBps > 0 && reqs.protocolFeeAddress) {
          const feeAmount = (totalAmount * BigInt(reqs.protocolFeeBps)) / 10000n;
          const merchantAmount = totalAmount - feeAmount;
          tx.add(
            SystemProgram.transfer({
              fromPubkey: payer,
              toPubkey: recipient,
              lamports: merchantAmount,
            }),
            SystemProgram.transfer({
              fromPubkey: payer,
              toPubkey: new PublicKey(reqs.protocolFeeAddress),
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
        const mint = new PublicKey(reqs.asset);
        const sourceAta = await getAssociatedTokenAddress(mint, payer);
        const destAta = await getAssociatedTokenAddress(mint, recipient);

        if (reqs.protocolFeeBps && reqs.protocolFeeBps > 0 && reqs.protocolFeeAddress) {
          const feeAmount = (totalAmount * BigInt(reqs.protocolFeeBps)) / 10000n;
          const merchantAmount = totalAmount - feeAmount;
          const feeRecipient = new PublicKey(reqs.protocolFeeAddress);
          const feeDestAta = await getAssociatedTokenAddress(mint, feeRecipient);
          tx.add(
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

      const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
      tx.feePayer = payer;
      tx.recentBlockhash = blockhash;

      const result = await this.connection.simulateTransaction(tx);

      if (result.value.err) {
        const rawError = JSON.stringify(result.value.err);
        return {
          success: false,
          error: { code: inferErrorCode(rawError), message: rawError },
        };
      }

      // Base fee: 5000 lamports per signature (no priority fee assumed)
      return {
        success: true,
        estimatedFee: { amount: BASE_FEE_LAMPORTS, currency: 'SOL' },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: { code: inferErrorCode(message), message },
      };
    }
  }

  /**
   * Sign and broadcast the payment transaction.
   *
   * Delegates to ExactSolanaClientScheme.createPaymentWithMeta() — which returns
   * the s402 payload AND the blockhash that was baked into the transaction at
   * sign time. That same blockhash is passed to confirmTransaction so the
   * lastValidBlockHeight is guaranteed to match the actual transaction.
   *
   * Using a fresh getLatestBlockhash() here would risk a mismatch: the second
   * call may return a different lastValidBlockHeight, causing confirmTransaction
   * to time out even though the transaction succeeds on-chain.
   */
  async signAndBroadcast(reqs: s402PaymentRequirements): Promise<{ txId: string }> {
    const { s402Payload, blockhash, lastValidBlockHeight } =
      await this.exactScheme.createPaymentWithMeta(reqs);

    const { transaction: serializedTx } = s402Payload.payload;
    const txBytes = base64ToUint8Array(serializedTx);

    const signature = await this.connection.sendRawTransaction(txBytes, {
      skipPreflight: false,
    });

    const confirmation = await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    if (confirmation.value.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
      );
    }

    return { txId: signature };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferErrorCode(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('insufficient') && (m.includes('fund') || m.includes('lamport'))) {
    return 'INSUFFICIENT_BALANCE';
  }
  if (m.includes('blockhash') || m.includes('expired')) {
    return 'TRANSACTION_EXPIRED';
  }
  return 'SIMULATION_FAILED';
}
