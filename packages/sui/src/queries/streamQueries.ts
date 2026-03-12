import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { StreamingMeterBcs } from '../types/bcs.js';

export interface StreamState {
  payer: string;
  recipient: string;
  balanceValue: bigint;
  ratePerSecond: bigint;
  budgetCap: bigint;
  totalClaimed: bigint;
  lastClaimMs: bigint;
  createdAtMs: bigint;
  active: boolean;
  pausedAtMs: bigint;
  feeMicroPct: bigint;
  feeRecipient: string;
}

export class StreamQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getStream(streamId: string): Promise<StreamState> {
    const { object } = await this.#ctx.client.core.getObject({
      objectId: streamId,
      include: { content: true },
    });

    if (!object.content) {
      throw new ResourceNotFoundError('StreamingMeter', streamId);
    }

    const parsed = StreamingMeterBcs.parse(object.content);
    return {
      payer: parsed.payer,
      recipient: parsed.recipient,
      balanceValue: BigInt(parsed.balance.value),
      ratePerSecond: BigInt(parsed.rate_per_second),
      budgetCap: BigInt(parsed.budget_cap),
      totalClaimed: BigInt(parsed.total_claimed),
      lastClaimMs: BigInt(parsed.last_claim_ms),
      createdAtMs: BigInt(parsed.created_at_ms),
      active: parsed.active,
      pausedAtMs: BigInt(parsed.paused_at_ms),
      feeMicroPct: BigInt(parsed.fee_micro_pct),
      feeRecipient: parsed.fee_recipient,
    };
  }
}
