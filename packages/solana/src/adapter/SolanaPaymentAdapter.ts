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
  createAssociatedTokenAccountIdempotentInstruction,
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
import { NATIVE_SOL_MINT, BASE_FEE_LAMPORTS, ATA_RENT_LAMPORTS } from '../constants.js';
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
      let ataCreationRequired = false;

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

        // Pre-flight: check if the recipient's ATA exists. Returns null when uninitialized.
        // Using getAccountInfo rather than post-simulation error parsing — RPC error
        // message strings are not a stable API and vary across providers and validator versions.
        const destAtaInfo = await this.connection.getAccountInfo(destAta, 'confirmed');
        ataCreationRequired = destAtaInfo === null;

        // CRITICAL: include the ATA creation instruction in the simulation tx so that
        // the simulation accurately represents the transaction that will actually be
        // broadcast. Without this, simulateTransaction targets a non-existent account
        // and fails — making success: true unreachable when the ATA is missing.
        if (ataCreationRequired) {
          tx.add(
            createAssociatedTokenAccountIdempotentInstruction(payer, destAta, recipient, mint),
          );
        }

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

      // Base fee: 5000 lamports per signature. When ATA creation is required,
      // rent (~0.002 SOL) is included so the caller sees the true total cost.
      return {
        success: true,
        estimatedFee: {
          amount: ataCreationRequired
            ? BASE_FEE_LAMPORTS + ATA_RENT_LAMPORTS
            : BASE_FEE_LAMPORTS,
          currency: 'SOL',
        },
        ...(ataCreationRequired && {
          ataCreationRequired: true,
          ataCreationCostLamports: ATA_RENT_LAMPORTS,
        }),
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
    const isNative = reqs.asset === NATIVE_SOL_MINT || reqs.asset === 'native';

    // For SPL tokens, detect a missing recipient ATA and handle it atomically.
    // Self-sufficient: does not assume simulate() was called first.
    if (!isNative) {
      const payer = new PublicKey(this.wallet.address);
      const recipient = new PublicKey(reqs.payTo);
      const mint = new PublicKey(reqs.asset);
      const destAta = await getAssociatedTokenAddress(mint, recipient);
      const destAtaInfo = await this.connection.getAccountInfo(destAta, 'confirmed');

      if (destAtaInfo === null) {
        return this.signBroadcastWithAtaCreate(reqs, payer, recipient, mint, destAta);
      }
    }

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

  /**
   * Build, sign, and broadcast a transaction that atomically creates the
   * recipient's ATA and performs the SPL token transfer.
   *
   * Called when signAndBroadcast() detects that destAta does not yet exist.
   * Uses createAssociatedTokenAccountIdempotentInstruction — safe to include
   * even if the ATA was created between simulate() and signAndBroadcast()
   * (race condition safety). The rent (~0.002 SOL) is charged to the payer.
   */
  private async signBroadcastWithAtaCreate(
    reqs: s402PaymentRequirements,
    payer: PublicKey,
    recipient: PublicKey,
    mint: PublicKey,
    destAta: PublicKey,
  ): Promise<{ txId: string }> {
    const sourceAta = await getAssociatedTokenAddress(mint, payer);
    const totalAmount = BigInt(reqs.amount);

    const tx = new Transaction();

    // Idempotent ATA creation — no-ops if ATA already exists (race condition safety).
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(payer, destAta, recipient, mint),
    );

    if (reqs.protocolFeeBps && reqs.protocolFeeBps > 0 && reqs.protocolFeeAddress) {
      const feeAmount = (totalAmount * BigInt(reqs.protocolFeeBps)) / 10000n;
      const merchantAmount = totalAmount - feeAmount;
      const feeRecipient = new PublicKey(reqs.protocolFeeAddress);
      const feeDestAta = await getAssociatedTokenAddress(mint, feeRecipient);
      tx.add(
        createTransferInstruction(sourceAta, destAta, payer, merchantAmount, [], TOKEN_PROGRAM_ID),
        createTransferInstruction(sourceAta, feeDestAta, payer, feeAmount, [], TOKEN_PROGRAM_ID),
      );
    } else {
      tx.add(
        createTransferInstruction(sourceAta, destAta, payer, totalAmount, [], TOKEN_PROGRAM_ID),
      );
    }

    const { serialized, blockhash, lastValidBlockHeight } =
      await this.wallet.signTransaction(tx, this.connection);

    const txBytes = base64ToUint8Array(serialized);
    const txId = await this.connection.sendRawTransaction(txBytes, { skipPreflight: false });

    const confirmation = await this.connection.confirmTransaction(
      { signature: txId, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    return { txId };
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
  // Belt-and-suspenders: primary detection is the getAccountInfo pre-flight check,
  // but this catches ATA errors from any remaining code paths (e.g. fee recipient ATA).
  if (
    m.includes('account does not exist') ||
    m.includes('invalid account data') ||
    m.includes('accountnotfound')
  ) {
    return 'DESTINATION_ATA_NOT_FOUND';
  }
  return 'SIMULATION_FAILED';
}
