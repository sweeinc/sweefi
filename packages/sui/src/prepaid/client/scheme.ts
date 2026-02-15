import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@sweepay/core/types";
import type { ClientSuiSigner } from "../../signer";
import type { SweepayConfig } from "../../ptb/types";
import { buildDepositTx } from "../../ptb/prepaid";

/**
 * Sui client implementation for the Prepaid payment scheme (x402-compat layer).
 * Builds a deposit PTB, signs it, and returns the payload.
 * The transaction is NOT executed — the facilitator broadcasts it during settlement.
 */
export class PrepaidSuiScheme implements SchemeNetworkClient {
  readonly scheme = "prepaid";

  constructor(
    private readonly signer: ClientSuiSigner,
    private readonly config: SweepayConfig,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const { amount, asset, payTo } = paymentRequirements;
    const extra = paymentRequirements.extra as PrepaidRequirementsExtra | undefined;

    if (!extra?.ratePerCall) {
      throw new Error("Prepaid requirements must include ratePerCall in extra");
    }

    const ratePerCall = extra.ratePerCall;
    const maxCalls = extra.maxCalls;
    const withdrawalDelayMs = extra.withdrawalDelayMs ?? "3600000"; // default 1 hour

    // Build deposit PTB using existing builder
    const tx = buildDepositTx(this.config, {
      coinType: asset,
      sender: this.signer.address,
      provider: payTo,
      amount: BigInt(amount),
      ratePerCall: BigInt(ratePerCall),
      maxCalls: maxCalls ? BigInt(maxCalls) : undefined,
      withdrawalDelayMs: BigInt(withdrawalDelayMs),
      feeBps: extra.protocolFeeBps ? Number(extra.protocolFeeBps) : 0,
      feeRecipient: extra.protocolFeeAddress ?? payTo,
    });

    const { signature, bytes } = await this.signer.signTransaction(tx);

    return {
      x402Version,
      payload: {
        transaction: bytes,
        signature,
        ratePerCall,
        maxCalls,
      },
    };
  }
}

/** Prepaid-specific fields in requirements.extra */
interface PrepaidRequirementsExtra {
  ratePerCall?: string;
  maxCalls?: string;
  minDeposit?: string;
  withdrawalDelayMs?: string;
  protocolFeeBps?: string | number;
  protocolFeeAddress?: string;
}
