import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { UptoDepositBcs } from '../types/bcs.js';

/** Must match upto_deposit.move constants: STATE_PENDING=0, STATE_SETTLED=1, STATE_EXPIRED=2 */
export const UptoDepositState = {
  Pending: 0,
  Settled: 1,
  Expired: 2,
} as const;
export type UptoDepositStateValue = typeof UptoDepositState[keyof typeof UptoDepositState];

export interface UptoDepositData {
  payer: string;
  recipient: string;
  balanceValue: bigint;
  maxAmount: bigint;
  settlementCeiling: bigint;
  settlementDeadlineMs: bigint;
  state: UptoDepositStateValue;
  feeMicroPct: bigint;
  feeRecipient: string;
  createdAtMs: bigint;
}

export class UptoQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getUptoDeposit(depositId: string): Promise<UptoDepositData> {
    const { object } = await this.#ctx.client.core.getObject({
      objectId: depositId,
      include: { content: true },
    });

    if (!object.content) {
      throw new ResourceNotFoundError('UptoDeposit', depositId);
    }

    const parsed = UptoDepositBcs.parse(object.content);
    return {
      payer: parsed.payer,
      recipient: parsed.recipient,
      balanceValue: BigInt(parsed.balance.value),
      maxAmount: BigInt(parsed.max_amount),
      settlementCeiling: BigInt(parsed.settlement_ceiling),
      settlementDeadlineMs: BigInt(parsed.settlement_deadline_ms),
      state: parsed.state as UptoDepositStateValue,
      feeMicroPct: BigInt(parsed.fee_micro_pct),
      feeRecipient: parsed.fee_recipient,
      createdAtMs: BigInt(parsed.created_at_ms),
    };
  }
}
