import type { Transaction } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import type { SweefiConfig } from "@sweefi/sui/ptb";

export type CheckoutStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "simulating"
  | "ready"
  | "paying"
  | "paid"
  | "error";

export interface PayResult {
  digest: string;
  receiptId: string | null;
}

export interface CheckoutState {
  status: CheckoutStatus;
  address: string | null;
  digest: string | null;
  receiptId: string | null;
  error: string | null;
}

export interface PaymentRequest {
  recipient: string;
  coinType: string;
  amount: bigint;
  feeBps: number;
  feeRecipient: string;
  memo?: string;
}

export interface WalletAdapter {
  connect?: () => Promise<string>;
  getAddress: () => string | null;
  signAndExecuteTransaction: (input: {
    transaction: Transaction;
  }) => Promise<{
    digest?: string;
    objectChanges?: Array<{ type?: string; objectType?: string; objectId?: string }>;
  }>;
}

export interface CheckoutControllerOptions {
  wallet: WalletAdapter;
  suiClient: SuiJsonRpcClient;
  config: SweefiConfig;
  payment: PaymentRequest;
}
