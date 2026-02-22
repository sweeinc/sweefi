/**
 * SuiPaymentAdapter — implements PaymentAdapter from @sweefi/ui-core
 *
 * Signer injection model: accepts a pre-connected wallet (Ed25519Keypair for
 * Node.js agents, browser WalletClient via toClientSuiSigner for UI) plus a
 * SuiJsonRpcClient. The adapter never manages wallet lifecycle.
 *
 * Currently supports the `exact` payment scheme. Advanced schemes (stream,
 * escrow, prepaid) can be added as overrides or via a multi-scheme subclass.
 *
 * Usage:
 *   const adapter = new SuiPaymentAdapter({
 *     wallet: keypair,          // Ed25519Keypair or any @mysten/sui Signer
 *     client: suiClient,        // SuiJsonRpcClient
 *     network: 'sui:testnet',
 *   });
 *   const controller = createPaymentController(adapter);
 */

import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";
import type { PaymentAdapter, SimulationResult } from "@sweefi/ui-core";
import type { s402PaymentRequirements } from "s402";
import { toClientSuiSigner } from "../signer.js";
import { ExactSuiClientScheme } from "../s402/exact/client.js";
import type { SuiNetwork } from "../client/s402-types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SuiPaymentAdapterConfig {
  /** Sui keypair or compatible signer (Ed25519Keypair, Secp256k1Keypair, etc.) */
  wallet: Signer;
  /** Pre-configured SuiJsonRpcClient */
  client: SuiJsonRpcClient;
  /** CAIP-2 network identifier */
  network: SuiNetwork;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class SuiPaymentAdapter implements PaymentAdapter {
  readonly network: string;

  private readonly suiSigner: ReturnType<typeof toClientSuiSigner>;
  private readonly client: SuiJsonRpcClient;
  private readonly exactScheme: ExactSuiClientScheme;

  constructor({ wallet, client, network }: SuiPaymentAdapterConfig) {
    this.network = network;
    this.client = client;
    this.suiSigner = toClientSuiSigner(wallet, client);
    this.exactScheme = new ExactSuiClientScheme(this.suiSigner);
  }

  getAddress(): string | null {
    return this.suiSigner.address ?? null;
  }

  /**
   * Dry-run the payment transaction without committing funds.
   *
   * Builds the PTB locally (no signing needed for dry-run) then calls
   * `dryRunTransactionBlock` to verify the transaction would succeed
   * and estimate the gas fee.
   */
  async simulate(reqs: s402PaymentRequirements): Promise<SimulationResult> {
    // Guard: only 'exact' is supported in this adapter
    if (!reqs.accepts.includes("exact")) {
      return {
        success: false,
        error: {
          code: "UNSUPPORTED_SCHEME",
          message: `SuiPaymentAdapter supports 'exact' only. Requested: ${reqs.accepts.join(", ")}`,
        },
      };
    }

    try {
      // Build the draft PTB (identical structure to ExactSuiClientScheme, but no sign)
      const tx = new Transaction();
      tx.setSender(this.suiSigner.address);

      const totalAmount = BigInt(reqs.amount);

      if (reqs.protocolFeeBps && reqs.protocolFeeBps > 0) {
        const feeAmount = (totalAmount * BigInt(reqs.protocolFeeBps)) / 10000n;
        const merchantAmount = totalAmount - feeAmount;
        const feeAddress = reqs.protocolFeeAddress ?? reqs.payTo;
        const coin = coinWithBalance({ type: reqs.asset, balance: totalAmount });
        const [merchantCoin, feeCoin] = tx.splitCoins(coin, [merchantAmount, feeAmount]);
        tx.transferObjects([merchantCoin], reqs.payTo);
        tx.transferObjects([feeCoin], feeAddress);
      } else {
        const coin = coinWithBalance({ type: reqs.asset, balance: totalAmount });
        tx.transferObjects([coin], reqs.payTo);
      }

      // Build without signing — dry-run only needs the bytes
      const bytes = await tx.build({ client: this.client });

      const dryRun = await this.client.dryRunTransactionBlock({
        transactionBlock: toBase64(bytes),
      });

      if (dryRun.effects.status.status !== "success") {
        const rawError = dryRun.effects.status.error ?? "Simulation failed";
        return {
          success: false,
          error: { code: inferErrorCode(rawError), message: rawError },
        };
      }

      // Compute net gas fee: computationCost + storageCost − storageRebate
      const { computationCost, storageCost, storageRebate } = dryRun.effects.gasUsed;
      const gasFee =
        BigInt(computationCost) +
        BigInt(storageCost) -
        BigInt(storageRebate);

      return {
        success: true,
        estimatedFee: { amount: gasFee, currency: "SUI" },
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
   * Uses ExactSuiClientScheme to sign the PTB, then executes it via
   * the SuiJsonRpcClient and returns the tx digest as `txId`.
   */
  async signAndBroadcast(reqs: s402PaymentRequirements): Promise<{ txId: string }> {
    const payload = await this.exactScheme.createPayment(reqs);
    const { transaction, signature } = payload.payload;

    const result = await this.client.executeTransactionBlock({
      transactionBlock: transaction,
      signature,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== "success") {
      throw new Error(
        `Transaction failed: ${result.effects?.status?.error ?? "unknown error"}`,
      );
    }

    return { txId: result.digest };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferErrorCode(message: string): string {
  const m = message.toLowerCase();
  // Check gas-specific errors first — "InsufficientGas" is a gas shortfall, not a balance shortfall
  if (m.includes("insufficientgas") || m.includes("notsufficientgas") || (m.includes("gas") && !m.includes("balance"))) {
    return "INSUFFICIENT_GAS";
  }
  if (m.includes("insufficient") || m.includes("balance")) {
    return "INSUFFICIENT_BALANCE";
  }
  return "SIMULATION_FAILED";
}
