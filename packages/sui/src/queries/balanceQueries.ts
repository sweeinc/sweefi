import type { QueryContext } from './context.js';

export class BalanceQueries {
  #ctx: QueryContext;

  constructor(ctx: QueryContext) {
    this.#ctx = ctx;
  }

  async getBalance(owner: string, coinType: string): Promise<bigint> {
    const { balance } = await this.#ctx.client.core.getBalance({
      owner,
      coinType,
    });
    return BigInt(balance.balance);
  }
}
