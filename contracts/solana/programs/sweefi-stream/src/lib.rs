//! SweeFi Streaming Micropayments — per-second streaming with budget caps
//!
//! "The first protocol where an agent pays $0.0003/second for inference,
//! with on-chain budget caps, automatic settlement, and zero pre-funding."
//!
//! State machine:
//!   ACTIVE ─── claim() ───→ ACTIVE (loop)
//!     │
//!     ├─── pause() ──→ PAUSED ──→ resume() ──→ ACTIVE
//!     │
//!     └─── close() / recipient_close() ──→ CLOSED (terminal)
//!
//! Matches Move semantics from sweefi::stream (error codes 100-series).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("HMTeFyU4yXf7QB3D1WE7vQqPrZSecmeD1f5gqCauDL7M");

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

pub const MIN_DEPOSIT: u64 = 1_000_000;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 10_000;

/// Default recipient close timeout: 7 days in seconds
pub const DEFAULT_RECIPIENT_CLOSE_TIMEOUT: i64 = 7 * 24 * 60 * 60;
/// Minimum close timeout: 1 day
pub const MIN_RECIPIENT_CLOSE_TIMEOUT: i64 = 24 * 60 * 60;
/// Maximum close timeout: 30 days
pub const MAX_RECIPIENT_CLOSE_TIMEOUT: i64 = 30 * 24 * 60 * 60;

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

#[account]
#[derive(Default)]
pub struct StreamMeter {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    /// Rate in base units per second
    pub rate_per_second: u64,
    /// Maximum total budget (gross outflow including fees)
    pub budget_cap: u64,
    /// Cumulative gross claimed
    pub total_claimed: u64,
    /// Accrual window starts here; updated on claim
    pub last_claim_ts: i64,
    /// Creation timestamp
    pub created_at: i64,
    /// Is the stream actively accruing?
    pub active: bool,
    /// Timestamp when paused (0 if not paused)
    pub paused_at: i64,
    /// Fee in basis points
    pub fee_bps: u16,
    pub fee_recipient: Pubkey,
    /// Close timeout for recipient_close
    pub recipient_close_timeout: i64,
    /// Last activity timestamp (for recipient_close)
    pub last_activity: i64,
    /// Nonce for PDA
    pub nonce: u64,
    pub bump: u8,
}

impl StreamMeter {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 2 + 32 + 8 + 8 + 8 + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

#[event]
pub struct StreamCreated {
    pub meter: Pubkey,
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub deposit: u64,
    pub rate_per_second: u64,
    pub budget_cap: u64,
    pub timestamp: i64,
}

#[event]
pub struct StreamClaimed {
    pub meter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub fee_amount: u64,
    pub total_claimed: u64,
    pub timestamp: i64,
}

#[event]
pub struct StreamPaused {
    pub meter: Pubkey,
    pub payer: Pubkey,
    pub total_claimed: u64,
    pub timestamp: i64,
}

#[event]
pub struct StreamResumed {
    pub meter: Pubkey,
    pub payer: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct StreamClosed {
    pub meter: Pubkey,
    pub payer: Pubkey,
    pub total_claimed: u64,
    pub refunded: u64,
    pub timestamp: i64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum StreamError {
    #[msg("Not the payer (100)")]
    NotPayer,

    #[msg("Not the recipient (101)")]
    NotRecipient,

    #[msg("Stream is not active (102)")]
    StreamInactive,

    #[msg("Stream is already active (103)")]
    StreamAlreadyActive,

    #[msg("Rate must be greater than zero (104)")]
    ZeroRate,

    #[msg("Deposit below minimum (105)")]
    ZeroDeposit,

    #[msg("Nothing to claim (106)")]
    NothingToClaim,

    #[msg("Invalid fee (107)")]
    InvalidFee,

    #[msg("Budget cap exceeded (108)")]
    BudgetCapExceeded,

    #[msg("Timeout not reached (109)")]
    TimeoutNotReached,

    #[msg("Timeout too short (110)")]
    TimeoutTooShort,

    #[msg("Timeout too long (111)")]
    TimeoutTooLong,

    #[msg("Arithmetic overflow")]
    Overflow,
}

// ═══════════════════════════════════════════════════════════════════════════
// Instructions
// ═══════════════════════════════════════════════════════════════════════════

#[program]
pub mod sweefi_stream {
    use super::*;

    /// Create a streaming payment channel.
    pub fn create(
        ctx: Context<Create>,
        deposit_amount: u64,
        rate_per_second: u64,
        budget_cap: u64,
        fee_bps: u16,
        recipient_close_timeout: i64,
        nonce: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(deposit_amount >= MIN_DEPOSIT, StreamError::ZeroDeposit);
        require!(rate_per_second > 0, StreamError::ZeroRate);
        require!(fee_bps <= MAX_FEE_BPS, StreamError::InvalidFee);
        require!(budget_cap > 0, StreamError::BudgetCapExceeded);
        require!(deposit_amount <= budget_cap, StreamError::BudgetCapExceeded);

        // Validate timeout bounds
        let timeout = if recipient_close_timeout == 0 {
            DEFAULT_RECIPIENT_CLOSE_TIMEOUT
        } else {
            require!(recipient_close_timeout >= MIN_RECIPIENT_CLOSE_TIMEOUT, StreamError::TimeoutTooShort);
            require!(recipient_close_timeout <= MAX_RECIPIENT_CLOSE_TIMEOUT, StreamError::TimeoutTooLong);
            recipient_close_timeout
        };

        let meter = &mut ctx.accounts.meter;
        meter.payer = ctx.accounts.payer.key();
        meter.recipient = ctx.accounts.recipient.key();
        meter.mint = ctx.accounts.mint.key();
        meter.rate_per_second = rate_per_second;
        meter.budget_cap = budget_cap;
        meter.total_claimed = 0;
        meter.last_claim_ts = clock.unix_timestamp;
        meter.created_at = clock.unix_timestamp;
        meter.active = true;
        meter.paused_at = 0;
        meter.fee_bps = fee_bps;
        meter.fee_recipient = ctx.accounts.fee_recipient.key();
        meter.recipient_close_timeout = timeout;
        meter.last_activity = clock.unix_timestamp;
        meter.nonce = nonce;
        meter.bump = ctx.bumps.meter;

        // Transfer deposit
        token::transfer(
            CpiContext::new(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            deposit_amount,
        )?;

        emit!(StreamCreated {
            meter: ctx.accounts.meter.key(),
            payer: ctx.accounts.payer.key(),
            recipient: ctx.accounts.recipient.key(),
            deposit: deposit_amount,
            rate_per_second,
            budget_cap,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Recipient claims accrued amount.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let meter = &ctx.accounts.meter;
        let clock = Clock::get()?;

        require!(ctx.accounts.recipient.key() == meter.recipient, StreamError::NotRecipient);
        require!(meter.active, StreamError::StreamInactive);

        // Calculate accrued amount
        let elapsed = clock.unix_timestamp.checked_sub(meter.last_claim_ts).ok_or(StreamError::Overflow)?;
        if elapsed <= 0 {
            return err!(StreamError::NothingToClaim);
        }

        // Gross amount before fee
        let mut gross_amount = (elapsed as u64)
            .checked_mul(meter.rate_per_second)
            .ok_or(StreamError::Overflow)?;

        // Cap to remaining budget
        let remaining_budget = meter.budget_cap.checked_sub(meter.total_claimed).ok_or(StreamError::Overflow)?;
        if gross_amount > remaining_budget {
            gross_amount = remaining_budget;
        }

        // Cap to available balance
        let balance = ctx.accounts.escrow_token_account.amount;
        if gross_amount > balance {
            gross_amount = balance;
        }

        if gross_amount == 0 {
            return err!(StreamError::NothingToClaim);
        }

        // Calculate fee
        let fee_amount = gross_amount
            .checked_mul(meter.fee_bps as u64)
            .ok_or(StreamError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(StreamError::Overflow)?;

        let recipient_amount = gross_amount.checked_sub(fee_amount).ok_or(StreamError::Overflow)?;

        // Copy values for PDA seeds before mutable borrow
        let payer_key = meter.payer;
        let recipient_key = meter.recipient;
        let nonce_bytes = meter.nonce.to_le_bytes();
        let bump = meter.bump;
        let meter_total = meter.total_claimed;

        // PDA seeds with owned values
        let seeds = &[
            b"stream".as_ref(),
            payer_key.as_ref(),
            recipient_key.as_ref(),
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
                        authority: ctx.accounts.meter.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        // Transfer to recipient
        if recipient_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.meter.to_account_info(),
                    },
                    signer_seeds,
                ),
                recipient_amount,
            )?;
        }

        // Capture meter key BEFORE mutable borrow
        let meter_key = ctx.accounts.meter.key();

        // Now mutate (re-borrow as mutable)
        let meter = &mut ctx.accounts.meter;
        meter.total_claimed = meter_total.checked_add(gross_amount).ok_or(StreamError::Overflow)?;
        meter.last_claim_ts = clock.unix_timestamp;
        meter.last_activity = clock.unix_timestamp;

        emit!(StreamClaimed {
            meter: meter_key,
            recipient: recipient_key,
            amount: recipient_amount,
            fee_amount,
            total_claimed: meter.total_claimed,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Payer pauses the stream. Accrual stops but unclaimed amount is preserved.
    pub fn pause(ctx: Context<PayerAction>) -> Result<()> {
        let clock = Clock::get()?;
        let meter_key = ctx.accounts.meter.key();
        let meter = &mut ctx.accounts.meter;

        require!(ctx.accounts.payer.key() == meter.payer, StreamError::NotPayer);
        require!(meter.active, StreamError::StreamInactive);

        let payer_key = meter.payer;
        let total = meter.total_claimed;

        meter.active = false;
        meter.paused_at = clock.unix_timestamp;
        meter.last_activity = clock.unix_timestamp;

        emit!(StreamPaused {
            meter: meter_key,
            payer: payer_key,
            total_claimed: total,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Payer resumes the stream.
    pub fn resume(ctx: Context<PayerAction>) -> Result<()> {
        let clock = Clock::get()?;
        let meter_key = ctx.accounts.meter.key();
        let meter = &mut ctx.accounts.meter;

        require!(ctx.accounts.payer.key() == meter.payer, StreamError::NotPayer);
        require!(!meter.active, StreamError::StreamAlreadyActive);
        require!(meter.paused_at > 0, StreamError::StreamAlreadyActive);

        let payer_key = meter.payer;

        meter.active = true;
        // Shift last_claim_ts forward by the paused duration
        let paused_duration = clock.unix_timestamp.checked_sub(meter.paused_at).ok_or(StreamError::Overflow)?;
        meter.last_claim_ts = meter.last_claim_ts.checked_add(paused_duration).ok_or(StreamError::Overflow)?;
        meter.paused_at = 0;
        meter.last_activity = clock.unix_timestamp;

        emit!(StreamResumed {
            meter: meter_key,
            payer: payer_key,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Payer closes the stream. Claims any remaining accrued amount, refunds the rest.
    pub fn close(ctx: Context<Close>) -> Result<()> {
        let clock = Clock::get()?;
        require!(ctx.accounts.payer.key() == ctx.accounts.meter.payer, StreamError::NotPayer);
        close_internal(ctx, clock.unix_timestamp)
    }

    /// Recipient can close after timeout of inactivity (prevents locked funds).
    pub fn recipient_close(ctx: Context<RecipientClose>) -> Result<()> {
        let clock = Clock::get()?;
        let meter = &ctx.accounts.meter;

        require!(ctx.accounts.recipient.key() == meter.recipient, StreamError::NotRecipient);

        let deadline = meter.last_activity.checked_add(meter.recipient_close_timeout).ok_or(StreamError::Overflow)?;
        require!(clock.unix_timestamp >= deadline, StreamError::TimeoutNotReached);

        close_internal_recipient(ctx, clock.unix_timestamp)
    }

    /// Payer adds more funds to the stream.
    pub fn top_up(ctx: Context<TopUp>, amount: u64) -> Result<()> {
        let meter = &mut ctx.accounts.meter;
        let clock = Clock::get()?;

        require!(ctx.accounts.payer.key() == meter.payer, StreamError::NotPayer);

        token::transfer(
            CpiContext::new(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
        )?;

        meter.last_activity = clock.unix_timestamp;

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

fn close_internal(ctx: Context<Close>, now: i64) -> Result<()> {
    let meter = &ctx.accounts.meter;

    // Copy values for PDA seeds before any mutable operations
    let payer_key = meter.payer;
    let recipient_key = meter.recipient;
    let nonce_bytes = meter.nonce.to_le_bytes();
    let bump = meter.bump;
    let fee_bps = meter.fee_bps;
    let mut total_claimed = meter.total_claimed;

    // Calculate any final accrued amount if active
    let mut final_claim = 0u64;
    if meter.active {
        let elapsed = now.checked_sub(meter.last_claim_ts).unwrap_or(0);
        if elapsed > 0 {
            let accrued = (elapsed as u64).saturating_mul(meter.rate_per_second);
            let remaining_budget = meter.budget_cap.saturating_sub(total_claimed);
            final_claim = accrued.min(remaining_budget).min(ctx.accounts.escrow_token_account.amount);
        }
    }

    let seeds = &[
        b"stream".as_ref(),
        payer_key.as_ref(),
        recipient_key.as_ref(),
        nonce_bytes.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    // Pay final claim to recipient (with fee)
    if final_claim > 0 {
        let fee_amount = final_claim
            .checked_mul(fee_bps as u64)
            .ok_or(StreamError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(StreamError::Overflow)?;
        let recipient_amount = final_claim.saturating_sub(fee_amount);

        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.fee_token_account.to_account_info(),
                        authority: ctx.accounts.meter.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        if recipient_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.meter.to_account_info(),
                    },
                    signer_seeds,
                ),
                recipient_amount,
            )?;
        }

        total_claimed = total_claimed.saturating_add(final_claim);
    }

    // Refund remaining to payer
    let refund = ctx.accounts.escrow_token_account.amount;
    if refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.payer_token_account.to_account_info(),
                    authority: ctx.accounts.meter.to_account_info(),
                },
                signer_seeds,
            ),
            refund,
        )?;
    }

    // Mutate after all CPI calls
    let meter = &mut ctx.accounts.meter;
    meter.total_claimed = total_claimed;
    meter.active = false;

    emit!(StreamClosed {
        meter: ctx.accounts.meter.key(),
        payer: payer_key,
        total_claimed,
        refunded: refund,
        timestamp: now,
    });

    Ok(())
}

fn close_internal_recipient(ctx: Context<RecipientClose>, now: i64) -> Result<()> {
    let meter = &ctx.accounts.meter;

    // Copy values for PDA seeds
    let payer_key = meter.payer;
    let recipient_key = meter.recipient;
    let nonce_bytes = meter.nonce.to_le_bytes();
    let bump = meter.bump;
    let fee_bps = meter.fee_bps;
    let mut total_claimed = meter.total_claimed;

    let mut final_claim = 0u64;
    if meter.active {
        let elapsed = now.checked_sub(meter.last_claim_ts).unwrap_or(0);
        if elapsed > 0 {
            let accrued = (elapsed as u64).saturating_mul(meter.rate_per_second);
            let remaining_budget = meter.budget_cap.saturating_sub(total_claimed);
            final_claim = accrued.min(remaining_budget).min(ctx.accounts.escrow_token_account.amount);
        }
    }

    let seeds = &[
        b"stream".as_ref(),
        payer_key.as_ref(),
        recipient_key.as_ref(),
        nonce_bytes.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    if final_claim > 0 {
        let fee_amount = final_claim
            .checked_mul(fee_bps as u64)
            .ok_or(StreamError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(StreamError::Overflow)?;
        let recipient_amount = final_claim.saturating_sub(fee_amount);

        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.fee_token_account.to_account_info(),
                        authority: ctx.accounts.meter.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        if recipient_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.meter.to_account_info(),
                    },
                    signer_seeds,
                ),
                recipient_amount,
            )?;
        }

        total_claimed = total_claimed.saturating_add(final_claim);
    }

    let refund = ctx.accounts.escrow_token_account.amount;
    if refund > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.payer_token_account.to_account_info(),
                    authority: ctx.accounts.meter.to_account_info(),
                },
                signer_seeds,
            ),
            refund,
        )?;
    }

    // Mutate after all CPI calls
    let meter = &mut ctx.accounts.meter;
    meter.total_claimed = total_claimed;
    meter.active = false;

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Account contexts
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(deposit_amount: u64, rate_per_second: u64, budget_cap: u64, fee_bps: u16, recipient_close_timeout: i64, nonce: u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Recipient address
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Fee recipient
    pub fee_recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = StreamMeter::LEN,
        seeds = [b"stream", payer.key().as_ref(), recipient.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub meter: Account<'info, StreamMeter>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = payer,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = meter,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", meter.payer.as_ref(), meter.recipient.as_ref(), &meter.nonce.to_le_bytes()],
        bump = meter.bump,
    )]
    pub meter: Account<'info, StreamMeter>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = meter,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&meter.fee_recipient, &meter.mint)
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PayerAction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", meter.payer.as_ref(), meter.recipient.as_ref(), &meter.nonce.to_le_bytes()],
        bump = meter.bump,
    )]
    pub meter: Account<'info, StreamMeter>,
}

#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", meter.payer.as_ref(), meter.recipient.as_ref(), &meter.nonce.to_le_bytes()],
        bump = meter.bump,
    )]
    pub meter: Account<'info, StreamMeter>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = meter,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = recipient_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&meter.recipient, &meter.mint)
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = payer_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&meter.payer, &meter.mint)
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&meter.fee_recipient, &meter.mint)
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RecipientClose<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", meter.payer.as_ref(), meter.recipient.as_ref(), &meter.nonce.to_le_bytes()],
        bump = meter.bump,
    )]
    pub meter: Account<'info, StreamMeter>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = meter,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = payer_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&meter.payer, &meter.mint)
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&meter.fee_recipient, &meter.mint)
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TopUp<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"stream", meter.payer.as_ref(), meter.recipient.as_ref(), &meter.nonce.to_le_bytes()],
        bump = meter.bump,
    )]
    pub meter: Account<'info, StreamMeter>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = payer,
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = meter.mint,
        associated_token::authority = meter,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
