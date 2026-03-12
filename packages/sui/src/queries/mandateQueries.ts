import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { MandateBcs } from '../types/bcs.js';

export interface MandateState {
  delegator: string;
  delegate: string;
  maxPerTx: bigint;
  maxTotal: bigint;
  totalSpent: bigint;
  expiresAtMs: bigint | null;
}

export class MandateQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getMandate(mandateId: string): Promise<MandateState> {
    const { object } = await this.#ctx.client.core.getObject({
      objectId: mandateId,
      include: { content: true },
    });

    if (!object.content) {
      throw new ResourceNotFoundError('Mandate', mandateId);
    }

    const parsed = MandateBcs.parse(object.content);
    return {
      delegator: parsed.delegator,
      delegate: parsed.delegate,
      maxPerTx: BigInt(parsed.max_per_tx),
      maxTotal: BigInt(parsed.max_total),
      totalSpent: BigInt(parsed.total_spent),
      expiresAtMs: parsed.expires_at_ms != null ? BigInt(parsed.expires_at_ms) : null,
    };
  }
}
