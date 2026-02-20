import { buildPayTx } from "@sweefi/sui/ptb";
import type { CheckoutControllerOptions, CheckoutState, PayResult } from "./types";

function extractReceiptId(
  objectChanges: Array<{ type?: string; objectType?: string; objectId?: string }> | undefined,
): string | null {
  if (!objectChanges) return null;
  const created = objectChanges.find(
    (item) => item.type === "created" && item.objectType?.includes("PaymentReceipt"),
  );
  return created?.objectId ?? null;
}

function canTreatAsValidDryrun(error: string | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  return [
    "insufficientgas",
    "insufficientcoinbalance",
    "gasbalancetoolow",
    "commandargumenterror",
  ].some((needle) => normalized.includes(needle));
}

export class SweefiCheckoutController {
  private readonly options: CheckoutControllerOptions;
  private state: CheckoutState = {
    status: "idle",
    address: null,
    digest: null,
    receiptId: null,
    error: null,
  };

  constructor(options: CheckoutControllerOptions) {
    this.options = options;
    this.state.address = options.wallet.getAddress();
    if (this.state.address) this.state.status = "connected";
  }

  getState(): CheckoutState {
    return { ...this.state };
  }

  async connectWallet(): Promise<string> {
    this.state.status = "connecting";
    this.state.error = null;

    if (this.options.wallet.connect) {
      const address = await this.options.wallet.connect();
      this.state.address = address;
      this.state.status = "connected";
      return address;
    }

    const address = this.options.wallet.getAddress();
    if (!address) {
      this.state.status = "error";
      this.state.error = "Wallet adapter does not provide an address. Add connect() or getAddress().";
      throw new Error(this.state.error);
    }

    this.state.address = address;
    this.state.status = "connected";
    return address;
  }

  async simulatePayment(): Promise<void> {
    const address = this.state.address ?? this.options.wallet.getAddress();
    if (!address) {
      this.state.status = "error";
      this.state.error = "Connect wallet before simulation.";
      throw new Error(this.state.error);
    }

    this.state.status = "simulating";
    this.state.error = null;

    const tx = buildPayTx(this.options.config, {
      sender: address,
      recipient: this.options.payment.recipient,
      coinType: this.options.payment.coinType,
      amount: this.options.payment.amount,
      feeBps: this.options.payment.feeBps,
      feeRecipient: this.options.payment.feeRecipient,
      memo: this.options.payment.memo,
    });

    const result = await this.options.suiClient.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: address,
    });

    const status = result.effects?.status;
    if (status?.status === "success" || canTreatAsValidDryrun(status?.error)) {
      this.state.status = "ready";
      return;
    }

    this.state.status = "error";
    this.state.error = status?.error ?? "Simulation failed";
    throw new Error(this.state.error);
  }

  async pay(): Promise<PayResult> {
    const address = this.state.address ?? this.options.wallet.getAddress();
    if (!address) {
      this.state.status = "error";
      this.state.error = "Connect wallet before paying.";
      throw new Error(this.state.error);
    }

    this.state.status = "paying";
    this.state.error = null;

    const tx = buildPayTx(this.options.config, {
      sender: address,
      recipient: this.options.payment.recipient,
      coinType: this.options.payment.coinType,
      amount: this.options.payment.amount,
      feeBps: this.options.payment.feeBps,
      feeRecipient: this.options.payment.feeRecipient,
      memo: this.options.payment.memo,
    });

    const result = await this.options.wallet.signAndExecuteTransaction({ transaction: tx });
    const digest = result.digest ?? "";

    if (!digest) {
      this.state.status = "error";
      this.state.error = "Payment did not return a transaction digest.";
      throw new Error(this.state.error);
    }

    const receiptId = extractReceiptId(result.objectChanges);
    this.state.status = "paid";
    this.state.digest = digest;
    this.state.receiptId = receiptId;

    return { digest, receiptId };
  }
}
