/**
 * s402 Prepaid Scheme — Client (Solana)
 *
 * Agent deposits funds, provider claims via cumulative call count.
 */

import { Transaction, PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402PaymentPayload,
  s402PrepaidPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSolanaSigner } from '../../signer.js';
import {
  buildCreatePrepaidIx,
  derivePrepaidBalancePda,
} from '../../programs/prepaid.js';

export class PrepaidSolanaClientScheme implements s402ClientScheme {
  readonly scheme = 'prepaid' as const;

  constructor(
    private readonly signer: ClientSolanaSigner,
    private readonly connection: Connection,
  ) {}

  async createPayment(requirements: s402PaymentRequirements): Promise<s402PaymentPayload> {
    const { asset, payTo, protocolFeeBps, prepaid } = requirements;

    if (!prepaid) {
      throw new Error('Prepaid scheme requires requirements.prepaid');
    }

    const agent = new PublicKey(this.signer.address);
    const provider = new PublicKey(payTo);
    const mint = new PublicKey(asset);
    const feeRecipient = new PublicKey(requirements.protocolFeeAddress ?? payTo);

    const depositAmount = BigInt(prepaid.minDeposit);
    const ratePerCall = BigInt(prepaid.ratePerCall);
    const maxCalls = prepaid.maxCalls ? BigInt(prepaid.maxCalls) : 0n;
    const withdrawalDelay = BigInt(prepaid.withdrawalDelayMs);
    const feeBps = protocolFeeBps ?? 0;

    const nonce = BigInt(Date.now());
    const [balancePda] = derivePrepaidBalancePda(agent, provider, nonce);

    const tx = new Transaction();

    const createIx = await buildCreatePrepaidIx({
      agent,
      provider,
      mint,
      amount: depositAmount,
      ratePerCall,
      maxCalls,
      withdrawalDelay,
      feeBps,
      feeRecipient,
      nonce,
    });

    tx.add(createIx);

    const { serialized, signature } = await this.signer.signTransaction(tx, this.connection);

    const payload: s402PrepaidPayload = {
      s402Version: S402_VERSION,
      scheme: 'prepaid',
      payload: {
        transaction: serialized,
        signature,
        ratePerCall: ratePerCall.toString(),
        maxCalls: maxCalls > 0n ? maxCalls.toString() : undefined,
      },
    };

    return payload;
  }

  verifySettlement(
    _payload: s402PaymentPayload,
    settleResponse: s402SettleResponse,
  ): s402SettlementVerification {
    return {
      verified: false,
      expectedDigest: '',
      actualDigest: settleResponse.txDigest ?? null,
      reason: 'Solana prepaid settlement verification requires RPC lookup',
    };
  }
}
