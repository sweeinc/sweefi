/**
 * s402 Escrow Scheme — Client (Solana)
 *
 * Creates time-locked escrow with arbiter dispute resolution.
 */

import { Transaction, PublicKey } from '@solana/web3.js';
import type { Connection } from '@solana/web3.js';
import type {
  s402ClientScheme,
  s402PaymentRequirements,
  s402PaymentPayload,
  s402EscrowPayload,
  s402SettleResponse,
  s402SettlementVerification,
} from 's402';
import { S402_VERSION } from 's402';
import type { ClientSolanaSigner } from '../../signer.js';
import {
  buildCreateEscrowIx,
  deriveEscrowPda,
} from '../../programs/escrow.js';

export class EscrowSolanaClientScheme implements s402ClientScheme {
  readonly scheme = 'escrow' as const;

  constructor(
    private readonly signer: ClientSolanaSigner,
    private readonly connection: Connection,
  ) {}

  async createPayment(requirements: s402PaymentRequirements): Promise<s402PaymentPayload> {
    const { amount, asset, payTo, protocolFeeBps, escrow } = requirements;

    if (!escrow) {
      throw new Error('Escrow scheme requires requirements.escrow');
    }

    const buyer = new PublicKey(this.signer.address);
    const seller = new PublicKey(escrow.seller);
    const mint = new PublicKey(asset);
    const feeRecipient = new PublicKey(requirements.protocolFeeAddress ?? payTo);

    const escrowAmount = BigInt(amount);
    const deadline = BigInt(escrow.deadlineMs);
    const feeBps = protocolFeeBps ?? 0;

    // Arbiter is optional
    const arbiter = escrow.arbiter
      ? new PublicKey(escrow.arbiter)
      : buyer; // Self-arbiter if none specified

    const nonce = BigInt(Date.now());
    const [escrowPda] = deriveEscrowPda(buyer, seller, nonce);

    const tx = new Transaction();

    const createIx = await buildCreateEscrowIx({
      buyer,
      seller,
      arbiter,
      mint,
      amount: escrowAmount,
      deadline,
      feeBps,
      feeRecipient,
      nonce,
    });

    tx.add(createIx);

    const { serialized, signature } = await this.signer.signTransaction(tx, this.connection);

    const payload: s402EscrowPayload = {
      s402Version: S402_VERSION,
      scheme: 'escrow',
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
      reason: 'Solana escrow settlement verification requires RPC lookup',
    };
  }
}
