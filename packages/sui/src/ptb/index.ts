// PTB construction layer for SweeFi contracts
// Builds Sui Programmable Transaction Blocks against deployed Move contracts.
//
// NOTE: The buildXxxTx() exports below are LEGACY. Prefer the contract classes
// (PaymentContract, StreamContract, EscrowContract, etc.) from `@sweefi/sui`.

// Config + parameter types
export type {
  SweefiConfig,
  AdminParams,
  PayParams,
  CreateInvoiceParams,
  PayInvoiceParams,
  CreateStreamParams,
  CreateStreamWithTimeoutParams,
  StreamOpParams,
  StreamTopUpParams,
  BatchClaimParams,
} from "./types";

// Deployment constants
export { SUI_CLOCK, TESTNET_PACKAGE_ID, TESTNET_ADMIN_CAP, TESTNET_PROTOCOL_STATE, TESTNET_UPGRADE_CAP, testnetConfig } from "./deployments";

// Payment PTB builders
/** @deprecated Use {@link PaymentContract} from `@sweefi/sui` instead. */
export {
  buildPayTx,
  buildPayComposableTx,
  buildCreateInvoiceTx,
  buildPayInvoiceTx,
} from "./payment";

// Stream PTB builders
/** @deprecated Use {@link StreamContract} from `@sweefi/sui` instead. */
export {
  buildCreateStreamTx,
  buildCreateStreamWithTimeoutTx,
  buildClaimTx,
  buildBatchClaimTx,
  buildPauseTx,
  buildResumeTx,
  buildCloseTx,
  buildRecipientCloseTx,
  buildTopUpTx,
} from "./stream";

// Composable PTB builders (atomic multi-step flows)
export type { PayAndProveParams } from "./composable";
/** @deprecated Use {@link PaymentContract.payComposable} from `@sweefi/sui` instead. */
export { buildPayAndProveTx } from "./composable";

// Escrow PTB builders
export type {
  CreateEscrowParams,
  EscrowOpParams,
} from "./escrow";
/** @deprecated Use {@link EscrowContract} from `@sweefi/sui` instead. */
export {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildReleaseEscrowComposableTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
} from "./escrow";

// Admin PTB builders (emergency pause circuit breaker)
export type { AutoUnpauseParams } from "./admin";
/** @deprecated Use {@link AdminContract} from `@sweefi/sui` instead. */
export {
  buildAdminPauseTx,
  buildAdminUnpauseTx,
  buildBurnAdminCapTx,
  buildAutoUnpauseTx,
} from "./admin";

// Mandate PTB builders (AP2 spending authorization)
export type {
  CreateMandateParams,
  MandatedPayParams,
  RevokeMandateParams,
  CreateRegistryParams,
} from "./mandate";
/** @deprecated Use {@link MandateContract} from `@sweefi/sui` instead. */
export {
  buildCreateMandateTx,
  buildMandatedPayTx,
  buildCreateRegistryTx,
  buildRevokeMandateTx,
} from "./mandate";

// Agent Mandate PTB builders (tiered spending authorization with periodic caps)
export type {
  CreateAgentMandateParams,
  AgentMandatedPayParams,
  AgentMandatedPayCheckedParams,
  UpgradeMandateLevelParams,
  UpdateMandateCapsParams,
  MandateLevelValue,
} from "./agent-mandate";
/** @deprecated Use {@link AgentMandateContract} from `@sweefi/sui` instead. */
export {
  MandateLevel,
  buildCreateAgentMandateTx,
  buildAgentMandatedPayTx,
  buildAgentMandatedPayCheckedTx,
  buildUpgradeMandateLevelTx,
  buildUpdateMandateCapsTx,
} from "./agent-mandate";

// Prepaid PTB builders (agent micropayment balances)
export type {
  PrepaidDepositParams,
  PrepaidClaimParams,
  PrepaidOpParams,
  PrepaidTopUpParams,
  PrepaidDepositWithReceiptsParams,
  PrepaidFinalizeClaimParams,
  PrepaidDisputeClaimParams,
  PrepaidWithdrawDisputedParams,
} from "./types";
/** @deprecated Use {@link PrepaidContract} from `@sweefi/sui` instead. */
export {
  UNLIMITED_CALLS,
  buildDepositTx as buildPrepaidDepositTx,
  buildClaimTx as buildPrepaidClaimTx,
  buildRequestWithdrawalTx,
  buildFinalizeWithdrawalTx,
  buildCancelWithdrawalTx,
  buildAgentCloseTx as buildPrepaidAgentCloseTx,
  buildProviderCloseTx as buildPrepaidProviderCloseTx,
  buildTopUpTx as buildPrepaidTopUpTx,
  // v0.2 signed receipts
  buildDepositWithReceiptsTx,
  buildFinalizeClaimTx as buildPrepaidFinalizeClaimTx,
  buildDisputeClaimTx,
  buildWithdrawDisputedTx,
  // Utility helpers
  bytesToHex,
  // L2 mitigation: provider key ownership verification
  verifyProviderKey,
} from "./prepaid";

// Receipt utilities (v0.2 signed usage receipts — BCS message construction + pluggable Ed25519)
export type { Ed25519Signer, Ed25519Verifier } from "../receipts";
export { buildReceiptMessage, signReceipt, verifyReceipt } from "../receipts";
