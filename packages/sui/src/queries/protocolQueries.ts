import type { QueryContext } from './context.js';
import { ResourceNotFoundError } from '../utils/errors.js';
import { ProtocolStateBcs } from '../types/bcs.js';

export interface ProtocolStateData {
  paused: boolean;
  pausedAtMs: bigint;
}

export class ProtocolQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async isPaused(): Promise<boolean> {
    const state = await this.getProtocolState();
    return state.paused;
  }

  async getProtocolState(): Promise<ProtocolStateData> {
    const protocolStateId = this.#ctx.config.requireProtocolState();

    const { object } = await this.#ctx.client.core.getObject({
      objectId: protocolStateId,
      include: { content: true },
    });

    if (!object.content) {
      throw new ResourceNotFoundError('ProtocolState', protocolStateId);
    }

    const parsed = ProtocolStateBcs.parse(object.content);
    return {
      paused: parsed.paused,
      pausedAtMs: BigInt(parsed.paused_at_ms),
    };
  }
}
