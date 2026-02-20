// PTB construction layer for SweeFi contracts
// Builds Sui Programmable Transaction Blocks against deployed Move contracts.

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
export { SUI_CLOCK, TESTNET_PACKAGE_ID, TESTNET_PACKAGE_ID_V1, TESTNET_PACKAGE_ID_V2, TESTNET_PACKAGE_ID_V3, TESTNET_PACKAGE_ID_V4, TESTNET_PACKAGE_ID_V5, TESTNET_PACKAGE_ID_V6, TESTNET_ADMIN_CAP, TESTNET_PROTOCOL_STATE, TESTNET_UPGRADE_CAP, testnetConfig } from "./deployments";

// Payment PTB builders
export {
  buildPayTx,
  buildPayComposableTx,
  buildCreateInvoiceTx,
  buildPayInvoiceTx,
} from "./payment";

// Stream PTB builders
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
export { buildPayAndProveTx } from "./composable";

// Escrow PTB builders
export type {
  CreateEscrowParams,
  EscrowOpParams,
} from "./escrow";
export {
  buildCreateEscrowTx,
  buildReleaseEscrowTx,
  buildReleaseEscrowComposableTx,
  buildRefundEscrowTx,
  buildDisputeEscrowTx,
} from "./escrow";

// Admin PTB builders (emergency pause circuit breaker)
export {
  buildAdminPauseTx,
  buildAdminUnpauseTx,
  buildBurnAdminCapTx,
} from "./admin";

// Mandate PTB builders (AP2 spending authorization)
export type {
  CreateMandateParams,
  MandatedPayParams,
  RevokeMandateParams,
  CreateRegistryParams,
} from "./mandate";
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
} from "./types";
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
} from "./prepaid";
