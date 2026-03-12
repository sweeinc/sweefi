import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { PrepaidBalanceBcs } from '../types/bcs.js';

export interface PrepaidState {
  agent: string;
  provider: string;
  depositedValue: bigint;
  ratePerCall: bigint;
  claimedCalls: bigint;
  maxCalls: bigint;
  lastClaimMs: bigint;
  withdrawalDelayMs: bigint;
  withdrawalPending: boolean;
  withdrawalRequestedMs: bigint;
  feeMicroPct: bigint;
  feeRecipient: string;
  providerPubkey: Uint8Array;
  disputeWindowMs: bigint;
  pendingClaimCount: bigint;
  pendingClaimAmount: bigint;
  pendingClaimFee: bigint;
  pendingClaimMs: bigint;
  disputed: boolean;
}

export class PrepaidQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getPrepaidBalance(balanceId: string): Promise<PrepaidState> {
    const { object } = await this.#ctx.client.core.getObject({
      objectId: balanceId,
      include: { content: true },
    });

    if (!object.content) {
      throw new ResourceNotFoundError('PrepaidBalance', balanceId);
    }

    const parsed = PrepaidBalanceBcs.parse(object.content);
    return {
      agent: parsed.agent,
      provider: parsed.provider,
      depositedValue: BigInt(parsed.deposited.value),
      ratePerCall: BigInt(parsed.rate_per_call),
      claimedCalls: BigInt(parsed.claimed_calls),
      maxCalls: BigInt(parsed.max_calls),
      lastClaimMs: BigInt(parsed.last_claim_ms),
      withdrawalDelayMs: BigInt(parsed.withdrawal_delay_ms),
      withdrawalPending: parsed.withdrawal_pending,
      withdrawalRequestedMs: BigInt(parsed.withdrawal_requested_ms),
      feeMicroPct: BigInt(parsed.fee_micro_pct),
      feeRecipient: parsed.fee_recipient,
      providerPubkey: new Uint8Array(parsed.provider_pubkey),
      disputeWindowMs: BigInt(parsed.dispute_window_ms),
      pendingClaimCount: BigInt(parsed.pending_claim_count),
      pendingClaimAmount: BigInt(parsed.pending_claim_amount),
      pendingClaimFee: BigInt(parsed.pending_claim_fee),
      pendingClaimMs: BigInt(parsed.pending_claim_ms),
      disputed: parsed.disputed,
    };
  }
}
