/**
 * Gas Sponsor Service
 *
 * Wraps `sui-gas-station`'s GasSponsor with reservation tracking for
 * automatic coin recycling after settlement.
 *
 * Flow:
 *   1. Client sends kind bytes → POST /sponsor
 *   2. GasSponsor reserves a pool coin, builds full tx, signs as sponsor
 *   3. Service stores reservation (keyed by gas coin objectId)
 *   4. After settle() succeeds, service fetches effects and reports to GasSponsor
 *   5. GasSponsor updates the coin's ObjectRef for reuse
 *
 * If reportSettlement is never called (e.g., client abandons), the coin
 * auto-releases after reservationTimeoutMs (default 30s). A periodic
 * revalidation refreshes stale ObjectRefs on epoch boundaries.
 */

import { GasSponsor } from "sui-gas-station";
import type {
  GasCoinReservation,
  SponsoredTransaction,
  PoolStats,
  SponsorPolicy,
} from "sui-gas-station";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { Signer } from "@mysten/sui/cryptography";

export interface GasSponsorServiceOptions {
  client: SuiJsonRpcClient;
  signer: Signer;
  maxBudgetPerTx: bigint;
  maxPerHour?: number;
}

export class GasSponsorService {
  private readonly gasSponsor: GasSponsor;
  private readonly client: SuiJsonRpcClient;
  private readonly sponsorAddress: string;

  /**
   * Track reservations by gas coin objectId so we can report execution
   * after settle() completes. Entries auto-expire if unreported.
   */
  private readonly reservations = new Map<string, GasCoinReservation>();

  private _initialized = false;

  constructor(options: GasSponsorServiceOptions) {
    const { client, signer, maxBudgetPerTx } = options;
    this.client = client;
    this.sponsorAddress = signer.toSuiAddress();

    const policy: SponsorPolicy = {
      maxBudgetPerTx,
      // Reject any kind bytes that reference the gas coin — prevents
      // drain attacks where malicious PTBs extract value from sponsor's coin.
      allowGasCoinUsage: false,
    };

    this.gasSponsor = new GasSponsor({
      client,
      signer,
      policy,
      // Moderate pool: 10 coins × 0.5 SUI = 5 SUI total gas budget
      targetPoolSize: 10,
      targetCoinBalance: 500_000_000n,
      minCoinBalance: 50_000_000n,
      reservationTimeoutMs: 30_000,
      onPoolDepleted: (stats) => {
        console.warn(
          `[gas-service] Pool depleted! ${stats.availableCoins}/${stats.totalCoins} coins available. ` +
          `Triggering replenish.`,
        );
        // Fire-and-forget replenishment
        this.gasSponsor.replenish().catch((err) => {
          console.error("[gas-service] Replenish failed:", err);
        });
      },
    });
  }

  /**
   * Initialize the gas coin pool. Must be called before sponsoring.
   * Fetches sponsor's coins from chain and splits them into pool-sized denominations.
   */
  async initialize(): Promise<void> {
    await this.gasSponsor.initialize();
    this._initialized = true;
    const stats = this.gasSponsor.getStats();
    console.log(
      `[gas-service] Initialized. Pool: ${stats.availableCoins} coins, ` +
      `sponsor: ${this.sponsorAddress}`,
    );
  }

  get initialized(): boolean {
    return this._initialized;
  }

  get address(): string {
    return this.sponsorAddress;
  }

  /**
   * Sponsor a transaction from kind bytes.
   *
   * @param sender - The client's Sui address
   * @param transactionKindBytes - Base64-encoded kind bytes (from tx.build({ onlyTransactionKind: true }))
   * @param network - CAIP-2 network identifier (for logging)
   * @returns Sponsored transaction with bytes and sponsor signature
   */
  async sponsor(
    sender: string,
    transactionKindBytes: string,
    network: string,
  ): Promise<SponsoredTransaction> {
    if (!this._initialized) {
      throw new Error("Gas sponsor not initialized — call initialize() first");
    }

    const result = await this.gasSponsor.sponsorTransaction({
      sender,
      transactionKindBytes,
    });

    // Track reservation for post-settle coin recycling
    this.reservations.set(result.reservation.objectId, result.reservation);

    console.log(
      `[gas-service] Sponsored tx for ${sender} on ${network}. ` +
      `Gas coin: ${result.reservation.objectId}, budget: ${result.gasBudget}`,
    );

    return result;
  }

  /**
   * Report a settled transaction to recycle the gas coin.
   *
   * Called after settle() executes a sponsored transaction. Fetches
   * execution effects from chain and updates the coin pool.
   *
   * @param txDigest - Transaction digest from settlement
   * @param gasObjectId - Gas coin objectId (from transaction's gasData.payment)
   */
  async reportSettlement(txDigest: string, gasObjectId: string): Promise<void> {
    const reservation = this.reservations.get(gasObjectId);
    if (!reservation) {
      // Not a sponsored tx we track (might have expired), skip silently
      return;
    }

    try {
      const result = await this.client.getTransactionBlock({
        digest: txDigest,
        options: { showEffects: true },
      });

      if (result.effects) {
        // The SDK's TransactionBlockEffects is structurally compatible with
        // sui-gas-station's ExecutionEffects (gasObject.reference + gasUsed)
        this.gasSponsor.reportExecution(
          reservation,
          result.effects as Parameters<typeof this.gasSponsor.reportExecution>[1],
        );
      }

      this.reservations.delete(gasObjectId);
    } catch (err) {
      console.error(
        `[gas-service] Failed to report settlement for ${txDigest}:`,
        err,
      );
      // Don't delete reservation — it'll expire naturally via timeout
    }
  }

  getStats(): PoolStats {
    return this.gasSponsor.getStats();
  }

  async close(): Promise<void> {
    await this.gasSponsor.close();
    this.reservations.clear();
    this._initialized = false;
  }
}
