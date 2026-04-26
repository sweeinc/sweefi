//! SweeFi Prepaid Balance — the Agent Killer Feature
//!
//! "The first protocol where an AI agent deposits $5, makes 1,000 API calls,
//! and the provider claims earned funds — all with 3 on-chain transactions."
//!
//! Trust model: TRUST-BOUNDED, not trustless.
//! The provider submits `call_count` — the program cannot verify calls actually happened.
//! A dishonest provider can drain the balance by lying about call count.
//! Agent's protection:
//!   1. Rate cap bounds per-call extraction
//!   2. max_calls bounds total extraction
//!   3. Deposit amount is the absolute maximum loss
//!   4. Small deposits + short refill cycles limit exposure
//!   5. Reputation enforcement (dishonest providers lose repeat business)
//!
//! This is v0.1: economic security only. v0.2 fraud proofs are NOT implemented
//! on Solana due to Ed25519 signature verification costs.
//!
//! Matches Move semantics from sweefi::prepaid (error codes 600-series).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("FsdmgrStNw43ib6UXL4CPJ2cPHXwoSiGoMAYKppcgAxC");

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

pub const MIN_DEPOSIT: u64 = 1_000_000;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 10_000;

/// Minimum withdrawal delay: 1 minute in seconds
pub const MIN_WITHDRAWAL_DELAY: i64 = 60;
/// Maximum withdrawal delay: 7 days in seconds
pub const MAX_WITHDRAWAL_DELAY: i64 = 7 * 24 * 60 * 60;

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

#[account]
#[derive(Default)]
pub struct PrepaidBalance {
    /// Agent who deposited and can withdraw
    pub agent: Pubkey,
    /// Provider who can claim
    pub provider: Pubkey,
    /// Token mint
    pub mint: Pubkey,
    /// Max base units per call (rate cap)
    pub rate_per_call: u64,
    /// CUMULATIVE total calls settled on-chain (not incremental)
    pub claimed_calls: u64,
    /// Hard lifetime cap (u64::MAX = unlimited)
    pub max_calls: u64,
    /// Timestamp of last claim
    pub last_claim_ts: i64,
    /// Agent must wait this long after request_withdrawal before finalizing
    pub withdrawal_delay: i64,
    /// Is a withdrawal pending?
    pub withdrawal_pending: bool,
    /// When was withdrawal requested?
    pub withdrawal_requested_ts: i64,
    /// Fee in basis points
    pub fee_bps: u16,
    pub fee_recipient: Pubkey,
    /// Nonce for PDA
    pub nonce: u64,
    pub bump: u8,
}

impl PrepaidBalance {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 2 + 32 + 8 + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

#[event]
pub struct PrepaidDeposited {
    pub balance: Pubkey,
    pub agent: Pubkey,
    pub provider: Pubkey,
    pub amount: u64,
    pub rate_per_call: u64,
    pub max_calls: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrepaidClaimed {
    pub balance: Pubkey,
    pub provider: Pubkey,
    pub calls_delta: u64,
    pub total_claimed_calls: u64,
    pub amount: u64,
    pub fee_amount: u64,
    pub remaining: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrepaidWithdrawalRequested {
    pub balance: Pubkey,
    pub agent: Pubkey,
    pub remaining: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrepaidWithdrawn {
    pub balance: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PrepaidTopUp {
    pub balance: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub new_total: u64,
    pub timestamp: i64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum PrepaidError {
    #[msg("Not the agent (600)")]
    NotAgent,

    #[msg("Not the provider (601)")]
    NotProvider,

    #[msg("Deposit below minimum (602)")]
    ZeroDeposit,

    #[msg("Rate must be greater than zero (603)")]
    ZeroRate,

    #[msg("Withdrawal is locked (604)")]
    WithdrawalLocked,

    #[msg("Call count cannot decrease (605)")]
    CallCountRegression,

    #[msg("Max calls exceeded (606)")]
    MaxCallsExceeded,

    #[msg("Rate limit exceeded (607)")]
    RateLimitExceeded,

    #[msg("Invalid fee (608)")]
    InvalidFee,

    #[msg("Withdrawal already pending (609)")]
    WithdrawalPending,

    #[msg("No withdrawal pending (610)")]
    WithdrawalNotPending,

    #[msg("Balance not exhausted (611)")]
    BalanceNotExhausted,

    #[msg("Withdrawal delay too short (612)")]
    WithdrawalDelayTooShort,

    #[msg("Withdrawal delay too long (613)")]
    WithdrawalDelayTooLong,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Nothing to claim")]
    NothingToClaim,
}

// ═══════════════════════════════════════════════════════════════════════════
// Instructions
// ═══════════════════════════════════════════════════════════════════════════

#[program]
pub mod sweefi_prepaid {
    use super::*;

    /// Agent deposits funds and creates a prepaid balance.
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        rate_per_call: u64,
        max_calls: u64,
        withdrawal_delay: i64,
        fee_bps: u16,
        nonce: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(amount >= MIN_DEPOSIT, PrepaidError::ZeroDeposit);
        require!(rate_per_call > 0, PrepaidError::ZeroRate);
        require!(fee_bps <= MAX_FEE_BPS, PrepaidError::InvalidFee);
        require!(withdrawal_delay >= MIN_WITHDRAWAL_DELAY, PrepaidError::WithdrawalDelayTooShort);
        require!(withdrawal_delay <= MAX_WITHDRAWAL_DELAY, PrepaidError::WithdrawalDelayTooLong);

        // Capture keys BEFORE mutable borrow to satisfy borrow checker
        let balance_key = ctx.accounts.balance.key();
        let agent_key = ctx.accounts.agent.key();
        let provider_key = ctx.accounts.provider.key();
        let mint_key = ctx.accounts.mint.key();
        let fee_recipient_key = ctx.accounts.fee_recipient.key();

        let balance = &mut ctx.accounts.balance;
        balance.agent = agent_key;
        balance.provider = provider_key;
        balance.mint = mint_key;
        balance.rate_per_call = rate_per_call;
        balance.claimed_calls = 0;
        balance.max_calls = if max_calls == 0 { u64::MAX } else { max_calls };
        balance.last_claim_ts = clock.unix_timestamp;
        balance.withdrawal_delay = withdrawal_delay;
        balance.withdrawal_pending = false;
        balance.withdrawal_requested_ts = 0;
        balance.fee_bps = fee_bps;
        balance.fee_recipient = fee_recipient_key;
        balance.nonce = nonce;
        balance.bump = ctx.bumps.balance;

        // Transfer tokens from agent to escrow
        token::transfer(
            CpiContext::new(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.agent_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(PrepaidDeposited {
            balance: balance_key,
            agent: agent_key,
            provider: provider_key,
            amount,
            rate_per_call,
            max_calls: balance.max_calls,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Provider claims for cumulative call count.
    /// The count is CUMULATIVE — not incremental. Safe for retries.
    pub fn claim(ctx: Context<Claim>, cumulative_call_count: u64) -> Result<()> {
        let balance = &mut ctx.accounts.balance;
        let clock = Clock::get()?;

        require!(ctx.accounts.provider.key() == balance.provider, PrepaidError::NotProvider);
        require!(cumulative_call_count > balance.claimed_calls, PrepaidError::CallCountRegression);
        require!(cumulative_call_count <= balance.max_calls, PrepaidError::MaxCallsExceeded);

        let calls_delta = cumulative_call_count
            .checked_sub(balance.claimed_calls)
            .ok_or(PrepaidError::Overflow)?;

        // Calculate gross amount (rate × delta)
        let gross_amount = (calls_delta as u128)
            .checked_mul(balance.rate_per_call as u128)
            .ok_or(PrepaidError::Overflow)?;

        // Cap to available balance
        let escrow_balance = ctx.accounts.escrow_token_account.amount;
        let capped_amount = if gross_amount > escrow_balance as u128 {
            escrow_balance
        } else {
            gross_amount as u64
        };

        if capped_amount == 0 {
            return err!(PrepaidError::NothingToClaim);
        }

        // Calculate fee
        let fee_bps = balance.fee_bps;
        let fee_amount = capped_amount
            .checked_mul(fee_bps as u64)
            .ok_or(PrepaidError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(PrepaidError::Overflow)?;

        let provider_amount = capped_amount.checked_sub(fee_amount).ok_or(PrepaidError::Overflow)?;

        // Copy values for PDA seeds
        let agent_key = balance.agent;
        let provider_key = balance.provider;
        let nonce_bytes = balance.nonce.to_le_bytes();
        let bump = balance.bump;
        let was_withdrawal_pending = balance.withdrawal_pending;

        // PDA seeds
        let seeds = &[
            b"prepaid".as_ref(),
            agent_key.as_ref(),
            provider_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer fee
        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.fee_token_account.to_account_info(),
                        authority: ctx.accounts.balance.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        // Transfer to provider
        if provider_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.provider_token_account.to_account_info(),
                        authority: ctx.accounts.balance.to_account_info(),
                    },
                    signer_seeds,
                ),
                provider_amount,
            )?;
        }

        // Now mutate
        let balance = &mut ctx.accounts.balance;
        balance.claimed_calls = cumulative_call_count;
        balance.last_claim_ts = clock.unix_timestamp;

        // Clear any pending withdrawal (provider activity resets it)
        if was_withdrawal_pending {
            balance.withdrawal_pending = false;
            balance.withdrawal_requested_ts = 0;
        }

        // Reload escrow balance after transfers
        ctx.accounts.escrow_token_account.reload()?;
        let remaining = ctx.accounts.escrow_token_account.amount;

        emit!(PrepaidClaimed {
            balance: ctx.accounts.balance.key(),
            provider: provider_key,
            calls_delta,
            total_claimed_calls: cumulative_call_count,
            amount: provider_amount,
            fee_amount,
            remaining,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Agent requests withdrawal. Starts the delay timer.
    pub fn request_withdrawal(ctx: Context<AgentAction>) -> Result<()> {
        let clock = Clock::get()?;

        // Capture keys before mutable borrow
        let balance_key = ctx.accounts.balance.key();
        let agent_key = ctx.accounts.agent.key();
        let remaining = ctx.accounts.escrow_token_account.amount;

        let balance = &mut ctx.accounts.balance;

        require!(agent_key == balance.agent, PrepaidError::NotAgent);
        require!(!balance.withdrawal_pending, PrepaidError::WithdrawalPending);

        balance.withdrawal_pending = true;
        balance.withdrawal_requested_ts = clock.unix_timestamp;

        emit!(PrepaidWithdrawalRequested {
            balance: balance_key,
            agent: balance.agent,
            remaining,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Agent finalizes withdrawal after delay has passed.
    pub fn finalize_withdrawal(ctx: Context<FinalizeWithdrawal>) -> Result<()> {
        let balance = &ctx.accounts.balance;
        let clock = Clock::get()?;

        require!(ctx.accounts.agent.key() == balance.agent, PrepaidError::NotAgent);
        require!(balance.withdrawal_pending, PrepaidError::WithdrawalNotPending);

        let deadline = balance.withdrawal_requested_ts
            .checked_add(balance.withdrawal_delay)
            .ok_or(PrepaidError::Overflow)?;
        require!(clock.unix_timestamp >= deadline, PrepaidError::WithdrawalLocked);

        // Copy values for PDA seeds
        let agent_key = balance.agent;
        let provider_key = balance.provider;
        let nonce_bytes = balance.nonce.to_le_bytes();
        let bump = balance.bump;

        // Transfer remaining balance to agent
        let seeds = &[
            b"prepaid".as_ref(),
            agent_key.as_ref(),
            provider_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let withdraw_amount = ctx.accounts.escrow_token_account.amount;
        if withdraw_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.agent_token_account.to_account_info(),
                        authority: ctx.accounts.balance.to_account_info(),
                    },
                    signer_seeds,
                ),
                withdraw_amount,
            )?;
        }

        // Now mutate
        let balance = &mut ctx.accounts.balance;
        balance.withdrawal_pending = false;
        balance.withdrawal_requested_ts = 0;

        emit!(PrepaidWithdrawn {
            balance: ctx.accounts.balance.key(),
            agent: agent_key,
            amount: withdraw_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Agent adds more funds.
    pub fn top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
        let clock = Clock::get()?;

        // Capture keys before mutable borrow
        let balance_key = ctx.accounts.balance.key();
        let agent_key = ctx.accounts.agent.key();

        // Read balance to check agent, then do transfer
        require!(agent_key == ctx.accounts.balance.agent, PrepaidError::NotAgent);

        token::transfer(
            CpiContext::new(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.agent_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            amount,
        )?;

        ctx.accounts.escrow_token_account.reload()?;
        let new_total = ctx.accounts.escrow_token_account.amount;

        emit!(PrepaidTopUp {
            balance: balance_key,
            agent: agent_key,
            amount,
            new_total,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Account contexts
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(amount: u64, rate_per_call: u64, max_calls: u64, withdrawal_delay: i64, fee_bps: u16, nonce: u64)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    /// CHECK: Provider address
    pub provider: UncheckedAccount<'info>,

    /// CHECK: Fee recipient
    pub fee_recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = agent,
        space = PrepaidBalance::LEN,
        seeds = [b"prepaid", agent.key().as_ref(), provider.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub balance: Account<'info, PrepaidBalance>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = agent,
    )]
    pub agent_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = agent,
        associated_token::mint = mint,
        associated_token::authority = balance,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,

    #[account(
        mut,
        seeds = [b"prepaid", balance.agent.as_ref(), balance.provider.as_ref(), &balance.nonce.to_le_bytes()],
        bump = balance.bump,
    )]
    pub balance: Account<'info, PrepaidBalance>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = balance,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = provider,
    )]
    pub provider_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&balance.fee_recipient, &balance.mint)
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AgentAction<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [b"prepaid", balance.agent.as_ref(), balance.provider.as_ref(), &balance.nonce.to_le_bytes()],
        bump = balance.bump,
    )]
    pub balance: Account<'info, PrepaidBalance>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = balance,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,
}

#[derive(Accounts)]
pub struct FinalizeWithdrawal<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [b"prepaid", balance.agent.as_ref(), balance.provider.as_ref(), &balance.nonce.to_le_bytes()],
        bump = balance.bump,
    )]
    pub balance: Account<'info, PrepaidBalance>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = balance,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = agent,
    )]
    pub agent_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [b"prepaid", balance.agent.as_ref(), balance.provider.as_ref(), &balance.nonce.to_le_bytes()],
        bump = balance.bump,
    )]
    pub balance: Account<'info, PrepaidBalance>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = agent,
    )]
    pub agent_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = balance.mint,
        associated_token::authority = balance,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
