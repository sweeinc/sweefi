/**
 * s402 Stream Scheme — Client (Solana)
 *
 * Creates per-second streaming micropayments with on-chain budget caps.
 */

import { Transaction, PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402PaymentPayload,
  s402StreamPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSolanaSigner } from '../../signer.js';
import {
  buildCreateStreamIx,
  deriveStreamMeterPda,
} from '../../programs/stream.js';

export class StreamSolanaClientScheme implements s402ClientScheme {
  readonly scheme = 'stream' as const;

  constructor(
    private readonly signer: ClientSolanaSigner,
    private readonly connection: Connection,
  ) {}

  async createPayment(requirements: s402PaymentRequirements): Promise<s402PaymentPayload> {
    const { asset, payTo, protocolFeeBps, stream } = requirements;

    if (!stream) {
      throw new Error('Stream scheme requires requirements.stream');
    }

    const payer = new PublicKey(this.signer.address);
    const recipient = new PublicKey(payTo);
    const mint = new PublicKey(asset);
    const feeRecipient = new PublicKey(requirements.protocolFeeAddress ?? payTo);

    const deposit = BigInt(stream.minDeposit);
    const ratePerSecond = BigInt(stream.ratePerSecond);
    const budgetCap = BigInt(stream.budgetCap);
    const feeBps = protocolFeeBps ?? 0;

    const nonce = BigInt(Date.now());
    const [meterPda] = deriveStreamMeterPda(payer, recipient, nonce);

    const tx = new Transaction();

    const createIx = await buildCreateStreamIx({
      payer,
      recipient,
      mint,
      deposit,
      ratePerSecond,
      budgetCap,
      feeBps,
      feeRecipient,
      nonce,
    });

    tx.add(createIx);

    const { serialized, signature } = await this.signer.signTransaction(tx, this.connection);

    const payload: s402StreamPayload = {
      s402Version: S402_VERSION,
      scheme: 'stream',
      payload: {
        transaction: serialized,
        signature,
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
      reason: 'Solana stream settlement verification requires RPC lookup',
    };
  }
}
