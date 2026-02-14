import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { PaymentPayload, PaymentRequirements, SchemeNetworkClient } from "@sweepay/core/types";
import type { ClientSuiSigner } from "../../signer";
import type { ExactSuiPayload } from "../../types";

/**
 * Sui client implementation for the Exact payment scheme.
 * Builds a PTB to transfer the required coin amount, signs it, and returns the payload.
 * The transaction is NOT executed — the facilitator broadcasts it during settlement.
 */
export class ExactSuiScheme implements SchemeNetworkClient {
  readonly scheme = "exact";

  /**
   * Creates a new ExactSuiScheme client instance.
   *
   * @param signer - The client signer for signing transactions
   */
  constructor(private readonly signer: ClientSuiSigner) {}

  /**
   * Creates a payment payload by building and signing a PTB.
   * Uses coinWithBalance() to automatically handle coin selection, merging, and splitting.
   *
   * @param x402Version - The x402 protocol version
   * @param paymentRequirements - The payment requirements (amount, asset, payTo, network)
   * @returns Promise resolving to a signed payment payload
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, "x402Version" | "payload">> {
    const { amount, asset, payTo } = paymentRequirements;

    // Build a PTB that transfers the required coin amount to the recipient
    const tx = new Transaction();
    tx.setSender(this.signer.address);

    // coinWithBalance handles coin selection, merging, and splitting automatically
    const coin = coinWithBalance({ type: asset, balance: BigInt(amount) });
    tx.transferObjects([coin], payTo);

    // Sign but do NOT execute — the facilitator will broadcast during settle
    const { signature, bytes } = await this.signer.signTransaction(tx);

    const payload: ExactSuiPayload = {
      signature,
      transaction: bytes,
    };

    return {
      x402Version,
      payload,
    };
  }
}
