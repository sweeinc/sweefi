import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { EscrowBcs } from '../types/bcs.js';

export const EscrowState = {
  Active: 0,
  Released: 1,
  Refunded: 2,
  Disputed: 3,
} as const;
export type EscrowStateValue = typeof EscrowState[keyof typeof EscrowState];

export interface EscrowData {
  buyer: string;
  seller: string;
  arbiter: string;
  balanceValue: bigint;
  amount: bigint;
  deadlineMs: bigint;
  state: EscrowStateValue;
  feeMicroPct: bigint;
  feeRecipient: string;
  createdAtMs: bigint;
  description: Uint8Array;
}

export class EscrowQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getEscrow(escrowId: string): Promise<EscrowData> {
    const { object } = await this.#ctx.client.core.getObject({
      objectId: escrowId,
      include: { content: true },
    });

    if (!object.content) {
      throw new ResourceNotFoundError('Escrow', escrowId);
    }

    const parsed = EscrowBcs.parse(object.content);
    return {
      buyer: parsed.buyer,
      seller: parsed.seller,
      arbiter: parsed.arbiter,
      balanceValue: BigInt(parsed.balance.value),
      amount: BigInt(parsed.amount),
      deadlineMs: BigInt(parsed.deadline_ms),
      state: parsed.state as EscrowStateValue,
      feeMicroPct: BigInt(parsed.fee_micro_pct),
      feeRecipient: parsed.fee_recipient,
      createdAtMs: BigInt(parsed.created_at_ms),
      description: new Uint8Array(parsed.description),
    };
  }
}
