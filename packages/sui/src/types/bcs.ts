import { bcs } from '@mysten/sui/bcs';

/** Matches `stream::StreamingMeter<T>` (contracts/sources/stream.move:77-91) */
export const StreamingMeterBcs = bcs.struct('StreamingMeter', {
  id: bcs.Address,  // UID serializes as address
  payer: bcs.Address,
  recipient: bcs.Address,
  balance: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T> is a struct, not bare u64
  rate_per_second: bcs.u64(),
  budget_cap: bcs.u64(),
  total_claimed: bcs.u64(),
  last_claim_ms: bcs.u64(),
  created_at_ms: bcs.u64(),
  active: bcs.bool(),
  paused_at_ms: bcs.u64(),
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
});

/** Matches `escrow::Escrow<T>` (contracts/sources/escrow.move:102-115) */
export const EscrowBcs = bcs.struct('Escrow', {
  id: bcs.Address,
  buyer: bcs.Address,
  seller: bcs.Address,
  arbiter: bcs.Address,
  balance: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T>
  amount: bcs.u64(),
  deadline_ms: bcs.u64(),
  state: bcs.u8(),       // 0=Active, 1=Released, 2=Refunded, 3=Disputed
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
  created_at_ms: bcs.u64(),
  description: bcs.vector(bcs.u8()),
});

/** Matches `prepaid::PrepaidBalance<T>` (contracts/sources/prepaid.move:138-162) */
export const PrepaidBalanceBcs = bcs.struct('PrepaidBalance', {
  id: bcs.Address,
  agent: bcs.Address,
  provider: bcs.Address,
  deposited: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T>
  rate_per_call: bcs.u64(),
  claimed_calls: bcs.u64(),
  max_calls: bcs.u64(),
  last_claim_ms: bcs.u64(),
  withdrawal_delay_ms: bcs.u64(),
  withdrawal_pending: bcs.bool(),
  withdrawal_requested_ms: bcs.u64(),
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
  provider_pubkey: bcs.vector(bcs.u8()),
  dispute_window_ms: bcs.u64(),
  pending_claim_count: bcs.u64(),
  pending_claim_amount: bcs.u64(),
  pending_claim_fee: bcs.u64(),
  pending_claim_ms: bcs.u64(),
  disputed: bcs.bool(),
});

/** Matches `payment::Invoice` (contracts/sources/payment.move:42-49) */
export const InvoiceBcs = bcs.struct('Invoice', {
  id: bcs.Address,
  creator: bcs.Address,
  recipient: bcs.Address,
  expected_amount: bcs.u64(),
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
});

/** Matches `mandate::Mandate<T>` (contracts/sources/mandate.move:46-54) */
export const MandateBcs = bcs.struct('Mandate', {
  id: bcs.Address,
  delegator: bcs.Address,
  delegate: bcs.Address,
  max_per_tx: bcs.u64(),
  max_total: bcs.u64(),
  total_spent: bcs.u64(),
  expires_at_ms: bcs.option(bcs.u64()),
});

/** Matches `admin::ProtocolState` (contracts/sources/admin.move) */
export const ProtocolStateBcs = bcs.struct('ProtocolState', {
  id: bcs.Address,
  paused: bcs.bool(),
  paused_at_ms: bcs.u64(),
});

/** Matches `upto_deposit::UptoDeposit<T>` (contracts/sources/upto_deposit.move — planned) */
export const UptoDepositBcs = bcs.struct('UptoDeposit', {
  id: bcs.Address,
  payer: bcs.Address,
  recipient: bcs.Address,
  balance: bcs.struct('Balance', { value: bcs.u64() }),  // Balance<T>
  max_amount: bcs.u64(),
  settlement_ceiling: bcs.u64(),
  settlement_deadline_ms: bcs.u64(),
  state: bcs.u8(),       // 0=Pending, 1=Settled, 2=Expired
  fee_micro_pct: bcs.u64(),
  fee_recipient: bcs.Address,
  created_at_ms: bcs.u64(),
});

/** Matches `agent_mandate::AgentMandate<T>` (contracts/sources/agent_mandate.move) */
export const AgentMandateBcs = bcs.struct('AgentMandate', {
  id: bcs.Address,
  delegator: bcs.Address,
  delegate: bcs.Address,
  level: bcs.u8(),
  max_per_tx: bcs.u64(),
  daily_limit: bcs.u64(),
  daily_spent: bcs.u64(),
  last_daily_reset_ms: bcs.u64(),
  weekly_limit: bcs.u64(),
  weekly_spent: bcs.u64(),
  last_weekly_reset_ms: bcs.u64(),
  max_total: bcs.u64(),
  total_spent: bcs.u64(),
  expires_at_ms: bcs.option(bcs.u64()),
});
