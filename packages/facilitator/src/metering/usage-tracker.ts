/**
 * In-memory settlement tracking for revenue metering.
 * Phase 1: Track locally, invoice manually.
 * Phase 2: On-chain fee splitting via Move contract.
 */
export class UsageTracker {
  private settlements = new Map<string, SettlementRecord[]>();

  /**
   * Record a successful settlement for an API key.
   */
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

  /**
   * Get total settled amount for an API key.
   */
  getTotalSettled(apiKey: string): bigint {
    const records = this.settlements.get(apiKey) ?? [];
    return records.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  /**
   * Get all settlement records (for dashboard/invoicing).
   */
  getAllRecords(): Map<string, SettlementRecord[]> {
    return new Map(this.settlements);
  }
}

interface SettlementRecord {
  amount: string;
  network: string;
  txDigest: string;
  timestamp: number;
}
