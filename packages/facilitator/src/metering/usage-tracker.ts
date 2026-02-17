/**
 * Settlement record for revenue metering.
 */
export interface SettlementRecord {
  amount: string;
  network: string;
  txDigest: string;
  timestamp: number;
}

/**
 * Interface for settlement tracking.
 * Phase 1: InMemoryUsageTracker (below).
 * Phase 2: Swap in a persistent implementation (Redis, Postgres, on-chain).
 */
export interface IUsageTracker {
  record(apiKey: string, amount: string, network: string, txDigest: string): void;
  getTotalSettled(apiKey: string): bigint;
  getAllRecords(): Map<string, SettlementRecord[]>;
}

/**
 * In-memory settlement tracking for revenue metering.
 * Phase 1: Track locally, invoice manually.
 * Phase 2: On-chain fee splitting via Move contract.
 */
export class UsageTracker implements IUsageTracker {
  private settlements = new Map<string, SettlementRecord[]>();

  record(apiKey: string, amount: string, network: string, txDigest: string): void {
    const records = this.settlements.get(apiKey) ?? [];
    records.push({
      amount,
      network,
      txDigest,
      timestamp: Date.now(),
    });
    this.settlements.set(apiKey, records);
  }

  getTotalSettled(apiKey: string): bigint {
    const records = this.settlements.get(apiKey) ?? [];
    return records.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  getAllRecords(): Map<string, SettlementRecord[]> {
    return new Map(this.settlements);
  }
}
