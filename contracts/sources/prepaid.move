/// SweeFi Prepaid Balance — the Agent Killer Feature
///
/// "The first protocol where an AI agent deposits $5, makes 1,000 API calls,
/// and the provider claims earned funds — all with 3 on-chain transactions."
///
/// Trust model: TRUST-BOUNDED, not trustless.
/// The provider submits `call_count` — Move cannot verify calls actually happened.
/// A dishonest provider can drain the balance by lying about call count.
/// Agent's protection:
///   1. Rate cap bounds per-call extraction
///   2. max_calls bounds total extraction
///   3. Deposit amount is the absolute maximum loss
///   4. Small deposits + short refill cycles limit exposure
///   5. Reputation enforcement (dishonest providers lose repeat business)
///
/// v0.2: Signed usage receipts with on-chain fraud proofs.
/// When dispute_window_ms > 0, claims enter a pending state. The agent can
/// dispute with a provider-signed receipt proving the claim count is fraudulent.
/// See ADR-007 for the full trust model.
///
/// Design decisions:
///   - PrepaidBalance is a SHARED object (both agent and provider mutate it)
///   - Cumulative claimed_calls (not incremental) — idempotent retries safe
///   - Clock-based withdrawal lock (not epoch — 24h too coarse)
///   - Two-phase withdrawal: request → grace period → finalize
///     Claims are ALLOWED during grace period (provider's window to submit final claims)
///   - u128 intermediate math for rate * count (Cetus $223M lesson)
///   - Zero-delta claims are no-ops (prevents withdrawal lock griefing)
///   - Per-provider isolation: one PrepaidBalance per agent-provider pair
///
/// C-06 (Bilateral key loss): If both the agent and provider lose access to
/// their keys, the PrepaidBalance becomes permanently locked — no admin or
/// third-party can recover the funds. This is by design (no admin backdoor),
/// but operators should be aware:
///   - Funds at risk = current PrepaidBalance.balance at time of key loss
///   - Mitigation: use small deposits + frequent refill cycles
///   - Future: governance-gated emergency drain after long dormancy period
module sweefi::prepaid {
    use sui::coin::{Self, Coin};
    use sui::balance::Balance;
    use sui::event;
    use sui::clock::Clock;
    use std::type_name;
    use std::ascii;
    use sweefi::admin;
    use sweefi::math;
    use sui::ed25519;
    use std::bcs;

    // ══════════════════════════════════════════════════════════════
    // Error codes (600-series)
    // ══════════════════════════════════════════════════════════════

    const ENotAgent: u64 = 600;
    const ENotProvider: u64 = 601;
    const EZeroDeposit: u64 = 602;
    const EZeroRate: u64 = 603;
    const EWithdrawalLocked: u64 = 604;
    const ECallCountRegression: u64 = 605;
    const EMaxCallsExceeded: u64 = 606;
    const ERateLimitExceeded: u64 = 607;
    const EInvalidFeeBps: u64 = 608;
    const EWithdrawalPending: u64 = 609;
    const EWithdrawalNotPending: u64 = 610;
    const EBalanceNotExhausted: u64 = 611;
    const EWithdrawalDelayTooShort: u64 = 612;
    const EWithdrawalDelayTooLong: u64 = 613;
    // v0.2 fraud proof error codes
    const EInvalidDisputeWindow: u64 = 614;
    const ENoPendingClaim: u64 = 615;
    const EClaimNotFinalizable: u64 = 616;
    const EInvalidFraudProof: u64 = 617;
    const EBalanceDisputed: u64 = 618;
    const EInvalidProviderPubkey: u64 = 619;
    const EPendingClaimExists: u64 = 620;
    const EBalanceNotDisputed: u64 = 621;
    const EDisputeWindowExpired: u64 = 622;

    // ══════════════════════════════════════════════════════════════
    // Constants
    // ══════════════════════════════════════════════════════════════

    /// Minimum withdrawal delay: 1 minute (60,000 ms)
    const MIN_WITHDRAWAL_DELAY_MS: u64 = 60_000;

    /// Maximum withdrawal delay: 7 days (604,800,000 ms) — matches stream.move
    const MAX_WITHDRAWAL_DELAY_MS: u64 = 604_800_000;

    /// Minimum deposit: 1,000,000 base units (0.001 SUI or 1 USDC).
    /// Prevents dust-deposit spam that creates near-empty shared objects.
    const MIN_DEPOSIT: u64 = 1_000_000;

    /// Minimum dispute window: 1 minute (60,000 ms)
    const MIN_DISPUTE_WINDOW_MS: u64 = 60_000;

    /// Maximum dispute window: 24 hours (86,400,000 ms)
    const MAX_DISPUTE_WINDOW_MS: u64 = 86_400_000;

    /// Ed25519 public key length (32 bytes)
    const ED25519_PUBKEY_LEN: u64 = 32;

    /// Ed25519 signature length (64 bytes)
    const ED25519_SIG_LEN: u64 = 64;

    // ══════════════════════════════════════════════════════════════
    // Types
    // ══════════════════════════════════════════════════════════════

    /// Prepaid balance — shared object.
    /// Agent deposits funds, provider claims via cumulative call count.
    /// phantom T: the coin type (SUI, USDC, etc.)
    ///
    /// NOTE: Named PrepaidBalance (not Balance) to avoid collision with sui::balance::Balance.
    /// NOTE: `agent` field (not `owner`) to distinguish from Sui object ownership.
    public struct PrepaidBalance<phantom T> has key {
        id: UID,
        agent: address,                // depositor
        provider: address,             // authorized claimer
        deposited: Balance<T>,         // locked collateral
        rate_per_call: u64,            // max base-units per call (rate cap)
        claimed_calls: u64,            // CUMULATIVE calls claimed (not incremental)
        max_calls: u64,                // hard cap; u64::MAX = unlimited
        last_claim_ms: u64,            // Clock timestamp of last claim
        withdrawal_delay_ms: u64,      // agent waits this long after last claim to withdraw
        withdrawal_pending: bool,      // two-phase withdrawal flag
        withdrawal_requested_ms: u64,  // when withdrawal was requested
        fee_bps: u64,                  // protocol fee on claims (basis points)
        fee_recipient: address,        // where fees go
        // ── v0.2 fraud proof fields ──────────────────────────────
        provider_pubkey: vector<u8>,   // 32-byte Ed25519 pubkey (empty = v0.1 mode)
        dispute_window_ms: u64,        // 0 = v0.1, >0 = v0.2 optimistic mode
        pending_claim_count: u64,      // Cumulative count (0 = no pending claim)
        pending_claim_amount: u64,     // Gross amount locked in pending claim
        pending_claim_fee: u64,        // Fee portion of pending claim
        pending_claim_ms: u64,         // When pending claim was submitted
        disputed: bool,                // Fraud proven → frozen for agent withdrawal
    }

    // ══════════════════════════════════════════════════════════════
    // Events
    // ══════════════════════════════════════════════════════════════

    public struct PrepaidDeposited has copy, drop {
        balance_id: ID,
        agent: address,
        provider: address,
        amount: u64,
        rate_per_call: u64,
        max_calls: u64,
        token_type: ascii::String,
        timestamp_ms: u64,
    }

    public struct PrepaidClaimed has copy, drop {
        balance_id: ID,
        provider: address,
        calls_delta: u64,
        total_claimed_calls: u64,
        amount: u64,
        fee_amount: u64,
        remaining: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidWithdrawalRequested has copy, drop {
        balance_id: ID,
        agent: address,
        remaining: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidWithdrawn has copy, drop {
        balance_id: ID,
        agent: address,
        refunded: u64,
        total_claimed_calls: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidTopUp has copy, drop {
        balance_id: ID,
        agent: address,
        amount: u64,
        new_balance: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidClosed has copy, drop {
        balance_id: ID,
        closed_by: address,
        total_claimed_calls: u64,
        timestamp_ms: u64,
    }

    // v0.2 events

    public struct PrepaidClaimPending has copy, drop {
        balance_id: ID,
        provider: address,
        cumulative_call_count: u64,
        amount: u64,
        fee_amount: u64,
        dispute_window_ms: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidClaimFinalized has copy, drop {
        balance_id: ID,
        provider: address,
        cumulative_call_count: u64,
        amount: u64,
        fee_amount: u64,
        timestamp_ms: u64,
    }

    public struct PrepaidFraudProven has copy, drop {
        balance_id: ID,
        agent: address,
        receipt_call_number: u64,
        claimed_calls: u64,        // settled calls at time of dispute (fraudulent delta = pending_claim_count - claimed_calls)
        pending_claim_count: u64,
        timestamp_ms: u64,
    }

    // ══════════════════════════════════════════════════════════════
    // Deposit (agent)
    // ══════════════════════════════════════════════════════════════

    /// Agent deposits funds and creates a PrepaidBalance shared object.
    /// This is the only function guarded by admin pause.
    public fun deposit<T>(
        coin: Coin<T>,
        provider: address,
        rate_per_call: u64,
        max_calls: u64,
        withdrawal_delay_ms: u64,
        fee_bps: u64,
        fee_recipient: address,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);

        let amount = coin.value();
        // H-6: Enforce minimum deposit to prevent dust spam on shared objects
        assert!(amount >= MIN_DEPOSIT, EZeroDeposit);
        assert!(rate_per_call > 0, EZeroRate);
        // max_calls=0 means provider can never claim (claim() checks cumulative <= max_calls,
        // so any non-zero count fails). Use u64::MAX for unlimited calls.
        assert!(max_calls > 0, EZeroRate);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);
        assert!(withdrawal_delay_ms >= MIN_WITHDRAWAL_DELAY_MS, EWithdrawalDelayTooShort);
        assert!(withdrawal_delay_ms <= MAX_WITHDRAWAL_DELAY_MS, EWithdrawalDelayTooLong);

        let now_ms = clock.timestamp_ms();
        let agent = ctx.sender();

        let balance = PrepaidBalance<T> {
            id: object::new(ctx),
            agent,
            provider,
            deposited: coin::into_balance(coin),
            rate_per_call,
            claimed_calls: 0,
            max_calls,
            last_claim_ms: now_ms,
            withdrawal_delay_ms,
            withdrawal_pending: false,
            withdrawal_requested_ms: 0,
            fee_bps,
            fee_recipient,
            // v0.2 defaults (unsigned mode — immediate claims)
            provider_pubkey: vector[],
            dispute_window_ms: 0,
            pending_claim_count: 0,
            pending_claim_amount: 0,
            pending_claim_fee: 0,
            pending_claim_ms: 0,
            disputed: false,
        };

        event::emit(PrepaidDeposited {
            balance_id: object::id(&balance),
            agent,
            provider,
            amount,
            rate_per_call,
            max_calls,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(balance);
    }

    /// Agent deposits funds with signed receipt support (v0.2).
    /// Requires a 32-byte Ed25519 provider public key and a dispute window.
    /// Claims on this balance enter a pending state and can be disputed.
    public fun deposit_with_receipts<T>(
        coin: Coin<T>,
        provider: address,
        rate_per_call: u64,
        max_calls: u64,
        withdrawal_delay_ms: u64,
        fee_bps: u64,
        fee_recipient: address,
        provider_pubkey: vector<u8>,
        dispute_window_ms: u64,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);

        let amount = coin.value();
        assert!(amount >= MIN_DEPOSIT, EZeroDeposit);
        assert!(rate_per_call > 0, EZeroRate);
        assert!(max_calls > 0, EZeroRate);
        assert!(fee_bps <= 10_000, EInvalidFeeBps);
        assert!(withdrawal_delay_ms >= MIN_WITHDRAWAL_DELAY_MS, EWithdrawalDelayTooShort);
        assert!(withdrawal_delay_ms <= MAX_WITHDRAWAL_DELAY_MS, EWithdrawalDelayTooLong);

        // v0.2 validation
        assert!(provider_pubkey.length() == ED25519_PUBKEY_LEN, EInvalidProviderPubkey);
        assert!(dispute_window_ms >= MIN_DISPUTE_WINDOW_MS, EInvalidDisputeWindow);
        assert!(dispute_window_ms <= MAX_DISPUTE_WINDOW_MS, EInvalidDisputeWindow);
        // F4: withdrawal_delay must be >= dispute_window so the withdrawal delay
        // doesn't expire before a claim submitted at deposit-time can be disputed.
        // Prevents foot-gun configs like withdrawal_delay=60s, dispute_window=24h.
        assert!(withdrawal_delay_ms >= dispute_window_ms, EWithdrawalDelayTooShort);

        let now_ms = clock.timestamp_ms();
        let agent = ctx.sender();

        let balance = PrepaidBalance<T> {
            id: object::new(ctx),
            agent,
            provider,
            deposited: coin::into_balance(coin),
            rate_per_call,
            claimed_calls: 0,
            max_calls,
            last_claim_ms: now_ms,
            withdrawal_delay_ms,
            withdrawal_pending: false,
            withdrawal_requested_ms: 0,
            fee_bps,
            fee_recipient,
            provider_pubkey,
            dispute_window_ms,
            pending_claim_count: 0,
            pending_claim_amount: 0,
            pending_claim_fee: 0,
            pending_claim_ms: 0,
            disputed: false,
        };

        event::emit(PrepaidDeposited {
            balance_id: object::id(&balance),
            agent,
            provider,
            amount,
            rate_per_call,
            max_calls,
            token_type: type_name::into_string(type_name::with_defining_ids<T>()),
            timestamp_ms: now_ms,
        });

        transfer::share_object(balance);
    }

    // ══════════════════════════════════════════════════════════════
    // Claim (provider)
    // ══════════════════════════════════════════════════════════════

    /// Provider claims earned funds based on cumulative call count.
    /// Provider says "I've served N total calls". Move computes the delta
    /// from the last claim and transfers `delta * rate_per_call` (minus fees).
    ///
    /// IMPORTANT: Zero-delta claims (cumulative == claimed_calls) are no-ops.
    /// This prevents the provider from griefing the withdrawal lock by spamming
    /// claim(same_count) to indefinitely extend last_claim_ms.
    ///
    /// Claims are ALLOWED during pending withdrawal — the grace period IS
    /// the provider's window to submit final claims.
    /// Provider claims earned funds based on cumulative call count.
    ///
    /// v0.1 mode (dispute_window_ms == 0): immediate settlement.
    /// v0.2 mode (dispute_window_ms > 0): stores pending claim, defers transfer.
    ///
    /// Zero-delta claims are no-ops (prevents withdrawal lock griefing).
    /// Claims are ALLOWED during pending withdrawal (provider's grace period).
    public fun claim<T>(
        balance: &mut PrepaidBalance<T>,
        cumulative_call_count: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.provider, ENotProvider);
        assert!(!balance.disputed, EBalanceDisputed);
        assert!(balance.pending_claim_count == 0, EPendingClaimExists);

        // Explicit underflow guard (council CRITICAL F-04)
        assert!(cumulative_call_count >= balance.claimed_calls, ECallCountRegression);

        let delta = cumulative_call_count - balance.claimed_calls;

        // Zero-delta = no-op (prevents withdrawal lock griefing)
        if (delta == 0) return;

        // max_calls cap check
        assert!(cumulative_call_count <= balance.max_calls, EMaxCallsExceeded);

        // u128 intermediate math for overflow safety (council CRITICAL F-05)
        let gross_amount_u128 = (delta as u128) * (balance.rate_per_call as u128);

        // Cap at u64::MAX
        let gross_amount = if (gross_amount_u128 > 0xFFFFFFFFFFFFFFFF) {
            0xFFFFFFFFFFFFFFFF
        } else {
            (gross_amount_u128 as u64)
        };

        // Must have enough balance
        assert!(gross_amount <= balance.deposited.value(), ERateLimitExceeded);

        // Calculate fee (overflow-safe, same as stream.move)
        let fee_amount = math::calculate_fee(gross_amount, balance.fee_bps);

        if (balance.dispute_window_ms == 0) {
            // ── v0.1: Immediate settlement ──────────────────────
            let provider_amount = gross_amount - fee_amount;

            // Transfer fee
            if (fee_amount > 0) {
                let fee_bal = balance.deposited.split(fee_amount);
                transfer::public_transfer(
                    coin::from_balance(fee_bal, ctx),
                    balance.fee_recipient,
                );
            };

            // Transfer to provider
            if (provider_amount > 0) {
                let claim_bal = balance.deposited.split(provider_amount);
                transfer::public_transfer(
                    coin::from_balance(claim_bal, ctx),
                    balance.provider,
                );
            };

            // Update state
            let now_ms = clock.timestamp_ms();
            balance.claimed_calls = cumulative_call_count;
            balance.last_claim_ms = now_ms;

            event::emit(PrepaidClaimed {
                balance_id: object::id(balance),
                provider: balance.provider,
                calls_delta: delta,
                total_claimed_calls: cumulative_call_count,
                amount: gross_amount,
                fee_amount,
                remaining: balance.deposited.value(),
                timestamp_ms: now_ms,
            });
        } else {
            // ── v0.2: Optimistic claim (pending) ────────────────
            let now_ms = clock.timestamp_ms();
            balance.pending_claim_count = cumulative_call_count;
            balance.pending_claim_amount = gross_amount;
            balance.pending_claim_fee = fee_amount;
            balance.pending_claim_ms = now_ms;

            event::emit(PrepaidClaimPending {
                balance_id: object::id(balance),
                provider: balance.provider,
                cumulative_call_count,
                amount: gross_amount,
                fee_amount,
                dispute_window_ms: balance.dispute_window_ms,
                timestamp_ms: now_ms,
            });
        };
    }

    /// Finalizes a pending claim after the dispute window has elapsed.
    /// Permissionless — anyone can call to prevent provider griefing.
    public fun finalize_claim<T>(
        balance: &mut PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(balance.pending_claim_count > 0, ENoPendingClaim);
        assert!(!balance.disputed, EBalanceDisputed);

        let now_ms = clock.timestamp_ms();
        assert!(
            now_ms >= balance.pending_claim_ms + balance.dispute_window_ms,
            EClaimNotFinalizable,
        );

        let gross_amount = balance.pending_claim_amount;
        let fee_amount = balance.pending_claim_fee;
        let provider_amount = gross_amount - fee_amount;
        let cumulative = balance.pending_claim_count;
        let delta = cumulative - balance.claimed_calls;

        // Transfer fee
        if (fee_amount > 0) {
            let fee_bal = balance.deposited.split(fee_amount);
            transfer::public_transfer(
                coin::from_balance(fee_bal, ctx),
                balance.fee_recipient,
            );
        };

        // Transfer to provider
        if (provider_amount > 0) {
            let claim_bal = balance.deposited.split(provider_amount);
            transfer::public_transfer(
                coin::from_balance(claim_bal, ctx),
                balance.provider,
            );
        };

        // Update state
        balance.claimed_calls = cumulative;
        balance.last_claim_ms = now_ms;

        // Clear pending state
        balance.pending_claim_count = 0;
        balance.pending_claim_amount = 0;
        balance.pending_claim_fee = 0;
        balance.pending_claim_ms = 0;

        event::emit(PrepaidClaimFinalized {
            balance_id: object::id(balance),
            provider: balance.provider,
            cumulative_call_count: cumulative,
            amount: gross_amount,
            fee_amount,
            timestamp_ms: now_ms,
        });

        // Also emit PrepaidClaimed for indexer compatibility
        event::emit(PrepaidClaimed {
            balance_id: object::id(balance),
            provider: balance.provider,
            calls_delta: delta,
            total_claimed_calls: cumulative,
            amount: gross_amount,
            fee_amount,
            remaining: balance.deposited.value(),
            timestamp_ms: now_ms,
        });
    }

    /// Agent disputes a pending claim with a provider-signed receipt as fraud proof.
    ///
    /// Receipt message format (BCS-encoded, matches TypeScript buildReceiptMessage):
    ///   bcs(balance_id: address) || bcs(call_number: u64) ||
    ///   bcs(timestamp_ms: u64)   || bcs(response_hash: vector<u8>)
    public fun dispute_claim<T>(
        balance: &mut PrepaidBalance<T>,
        receipt_balance_id: address,
        receipt_call_number: u64,
        receipt_timestamp_ms: u64,
        receipt_response_hash: vector<u8>,
        signature: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.pending_claim_count > 0, ENoPendingClaim);
        assert!(!balance.disputed, EBalanceDisputed);

        let now_ms = clock.timestamp_ms();
        // Dispute must happen within the dispute window
        assert!(
            now_ms < balance.pending_claim_ms + balance.dispute_window_ms,
            EDisputeWindowExpired,
        );

        // Verify receipt is for this specific balance (replay protection)
        assert!(
            receipt_balance_id == object::id(balance).to_address(),
            EInvalidFraudProof,
        );

        // The fraud proof: signed receipt says provider served call N,
        // but provider claims more than N total calls
        assert!(
            receipt_call_number < balance.pending_claim_count,
            EInvalidFraudProof,
        );
        // F1: Receipt must be from the current pending batch, not a previously
        // settled one. Without this, an agent could reuse a receipt from a prior
        // finalized batch (call_number <= claimed_calls) to fraudulently dispute
        // a legitimate new pending claim.
        assert!(
            receipt_call_number > balance.claimed_calls,
            EInvalidFraudProof,
        );

        // Reconstruct the signed message (matches TypeScript buildReceiptMessage)
        let mut msg = vector[];
        msg.append(bcs::to_bytes(&receipt_balance_id));
        msg.append(bcs::to_bytes(&receipt_call_number));
        msg.append(bcs::to_bytes(&receipt_timestamp_ms));
        msg.append(bcs::to_bytes(&receipt_response_hash));

        // Verify Ed25519 signature from provider's key
        assert!(signature.length() == ED25519_SIG_LEN, EInvalidFraudProof);
        assert!(
            ed25519::ed25519_verify(&signature, &balance.provider_pubkey, &msg),
            EInvalidFraudProof,
        );

        // Fraud proven — freeze the balance
        let pending_count = balance.pending_claim_count;
        balance.disputed = true;

        // Clear pending state (no funds move)
        balance.pending_claim_count = 0;
        balance.pending_claim_amount = 0;
        balance.pending_claim_fee = 0;
        balance.pending_claim_ms = 0;

        event::emit(PrepaidFraudProven {
            balance_id: object::id(balance),
            agent: balance.agent,
            receipt_call_number,
            claimed_calls: balance.claimed_calls,
            pending_claim_count: pending_count,
            timestamp_ms: now_ms,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Two-phase withdrawal (agent)
    // ══════════════════════════════════════════════════════════════

    /// Agent signals intent to withdraw remaining funds.
    /// Starts the grace period — provider can still claim during this time.
    /// After withdrawal_delay_ms, agent can call finalize_withdrawal().
    public fun request_withdrawal<T>(
        balance: &mut PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(!balance.withdrawal_pending, EWithdrawalPending);

        let now_ms = clock.timestamp_ms();
        balance.withdrawal_pending = true;
        balance.withdrawal_requested_ms = now_ms;

        event::emit(PrepaidWithdrawalRequested {
            balance_id: object::id(balance),
            agent: balance.agent,
            remaining: balance.deposited.value(),
            timestamp_ms: now_ms,
        });
    }

    /// Agent finalizes withdrawal after the grace period has elapsed.
    /// Destructures the PrepaidBalance, returning remaining funds to agent.
    ///
    /// NOTE: The grace period is anchored to `withdrawal_requested_ms`, NOT `last_claim_ms`.
    /// Late claims during the grace period do NOT extend the delay. This is intentional:
    /// the provider has exactly `withdrawal_delay_ms` from the request to submit final claims.
    public fun finalize_withdrawal<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.withdrawal_pending, EWithdrawalNotPending);
        // Cannot finalize withdrawal while a claim is pending
        assert!(balance.pending_claim_count == 0, EPendingClaimExists);

        let now_ms = clock.timestamp_ms();
        assert!(
            now_ms >= balance.withdrawal_requested_ms + balance.withdrawal_delay_ms,
            EWithdrawalLocked,
        );

        let refunded = balance.deposited.value();
        let total_claimed = balance.claimed_calls;

        event::emit(PrepaidWithdrawn {
            balance_id: object::id(&balance),
            agent: balance.agent,
            refunded,
            total_claimed_calls: total_claimed,
            timestamp_ms: now_ms,
        });

        // Destructure and clean up
        let PrepaidBalance {
            id,
            agent,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
            provider_pubkey: _,
            dispute_window_ms: _,
            pending_claim_count: _,
            pending_claim_amount: _,
            pending_claim_fee: _,
            pending_claim_ms: _,
            disputed: _,
        } = balance;

        // Refund remaining to agent
        if (deposited.value() > 0) {
            transfer::public_transfer(coin::from_balance(deposited, ctx), agent);
        } else {
            deposited.destroy_zero();
        };

        id.delete();
    }

    /// Agent cancels a pending withdrawal request. Re-enables normal operation.
    public fun cancel_withdrawal<T>(
        balance: &mut PrepaidBalance<T>,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.withdrawal_pending, EWithdrawalNotPending);

        balance.withdrawal_pending = false;
        balance.withdrawal_requested_ms = 0;
    }

    // ══════════════════════════════════════════════════════════════
    // Top up (agent)
    // ══════════════════════════════════════════════════════════════

    /// Agent adds more funds to an existing PrepaidBalance.
    /// Blocked during pending withdrawal (would conflict with finalize).
    public fun top_up<T>(
        balance: &mut PrepaidBalance<T>,
        coin: Coin<T>,
        protocol_state: &admin::ProtocolState,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        admin::assert_not_paused(protocol_state);
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(!balance.withdrawal_pending, EWithdrawalPending);

        let amount = coin.value();
        assert!(amount > 0, EZeroDeposit);

        balance.deposited.join(coin::into_balance(coin));

        event::emit(PrepaidTopUp {
            balance_id: object::id(balance),
            agent: balance.agent,
            amount,
            new_balance: balance.deposited.value(),
            timestamp_ms: clock.timestamp_ms(),
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Close (both parties — prevents dead shared objects)
    // ══════════════════════════════════════════════════════════════

    /// Agent closes an exhausted balance (0 remaining).
    /// Returns storage rebate by destructuring the shared object.
    public fun agent_close<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.deposited.value() == 0, EBalanceNotExhausted);
        assert!(balance.pending_claim_count == 0, EPendingClaimExists);
        assert!(!balance.disputed, EBalanceDisputed);

        let total_claimed = balance.claimed_calls;

        event::emit(PrepaidClosed {
            balance_id: object::id(&balance),
            closed_by: balance.agent,
            total_claimed_calls: total_claimed,
            timestamp_ms: clock.timestamp_ms(),
        });

        let PrepaidBalance {
            id,
            agent: _,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
            provider_pubkey: _,
            dispute_window_ms: _,
            pending_claim_count: _,
            pending_claim_amount: _,
            pending_claim_fee: _,
            pending_claim_ms: _,
            disputed: _,
        } = balance;

        deposited.destroy_zero();
        id.delete();
    }

    /// Provider closes a fully-claimed balance.
    /// Returns storage rebate by destructuring the shared object.
    public fun provider_close<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.provider, ENotProvider);
        assert!(balance.deposited.value() == 0, EBalanceNotExhausted);
        assert!(balance.pending_claim_count == 0, EPendingClaimExists);
        assert!(!balance.disputed, EBalanceDisputed);

        let total_claimed = balance.claimed_calls;

        event::emit(PrepaidClosed {
            balance_id: object::id(&balance),
            closed_by: balance.provider,
            total_claimed_calls: total_claimed,
            timestamp_ms: clock.timestamp_ms(),
        });

        let PrepaidBalance {
            id,
            agent: _,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
            provider_pubkey: _,
            dispute_window_ms: _,
            pending_claim_count: _,
            pending_claim_amount: _,
            pending_claim_fee: _,
            pending_claim_ms: _,
            disputed: _,
        } = balance;

        deposited.destroy_zero();
        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Disputed balance recovery (agent, v0.2)
    // ══════════════════════════════════════════════════════════════

    /// Agent withdraws all remaining funds from a disputed balance.
    /// Immediate — no delay. Trust is broken, agent recovers everything.
    public fun withdraw_disputed<T>(
        balance: PrepaidBalance<T>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == balance.agent, ENotAgent);
        assert!(balance.disputed, EBalanceNotDisputed);

        let refunded = balance.deposited.value();
        let total_claimed = balance.claimed_calls;
        let now_ms = clock.timestamp_ms();

        event::emit(PrepaidWithdrawn {
            balance_id: object::id(&balance),
            agent: balance.agent,
            refunded,
            total_claimed_calls: total_claimed,
            timestamp_ms: now_ms,
        });

        let PrepaidBalance {
            id,
            agent,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
            provider_pubkey: _,
            dispute_window_ms: _,
            pending_claim_count: _,
            pending_claim_amount: _,
            pending_claim_fee: _,
            pending_claim_ms: _,
            disputed: _,
        } = balance;

        if (deposited.value() > 0) {
            transfer::public_transfer(coin::from_balance(deposited, ctx), agent);
        } else {
            deposited.destroy_zero();
        };

        id.delete();
    }

    // ══════════════════════════════════════════════════════════════
    // Read-only accessors
    // ══════════════════════════════════════════════════════════════

    public fun balance_agent<T>(b: &PrepaidBalance<T>): address { b.agent }
    public fun balance_provider<T>(b: &PrepaidBalance<T>): address { b.provider }
    public fun balance_remaining<T>(b: &PrepaidBalance<T>): u64 { b.deposited.value() }
    public fun balance_claimed_calls<T>(b: &PrepaidBalance<T>): u64 { b.claimed_calls }
    public fun balance_rate_per_call<T>(b: &PrepaidBalance<T>): u64 { b.rate_per_call }
    public fun balance_max_calls<T>(b: &PrepaidBalance<T>): u64 { b.max_calls }
    public fun balance_withdrawal_pending<T>(b: &PrepaidBalance<T>): bool { b.withdrawal_pending }
    public fun balance_withdrawal_delay_ms<T>(b: &PrepaidBalance<T>): u64 { b.withdrawal_delay_ms }
    public fun balance_last_claim_ms<T>(b: &PrepaidBalance<T>): u64 { b.last_claim_ms }
    public fun balance_fee_bps<T>(b: &PrepaidBalance<T>): u64 { b.fee_bps }
    // v0.2 accessors
    public fun balance_provider_pubkey<T>(b: &PrepaidBalance<T>): &vector<u8> { &b.provider_pubkey }
    public fun balance_dispute_window_ms<T>(b: &PrepaidBalance<T>): u64 { b.dispute_window_ms }
    public fun balance_disputed<T>(b: &PrepaidBalance<T>): bool { b.disputed }
    public fun balance_pending_claim_count<T>(b: &PrepaidBalance<T>): u64 { b.pending_claim_count }
    public fun balance_pending_claim_ms<T>(b: &PrepaidBalance<T>): u64 { b.pending_claim_ms }

    // ══════════════════════════════════════════════════════════════
    // Internal helpers
    // ══════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════
    // Test helpers
    // ══════════════════════════════════════════════════════════════

    #[test_only]
    public fun destroy_for_testing<T>(balance: PrepaidBalance<T>) {
        let PrepaidBalance {
            id,
            agent: _,
            provider: _,
            deposited,
            rate_per_call: _,
            claimed_calls: _,
            max_calls: _,
            last_claim_ms: _,
            withdrawal_delay_ms: _,
            withdrawal_pending: _,
            withdrawal_requested_ms: _,
            fee_bps: _,
            fee_recipient: _,
            provider_pubkey: _,
            dispute_window_ms: _,
            pending_claim_count: _,
            pending_claim_amount: _,
            pending_claim_fee: _,
            pending_claim_ms: _,
            disputed: _,
        } = balance;

        if (deposited.value() > 0) {
            // In tests we can't easily transfer, so use test-only destroy
            std::unit_test::destroy(deposited);
        } else {
            deposited.destroy_zero();
        };

        id.delete();
    }
}
