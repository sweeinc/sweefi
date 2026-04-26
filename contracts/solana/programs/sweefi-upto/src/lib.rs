//! SweeFi Upto Deposit — variable-amount payment with client-enforced ceiling
//!
//! "Pay up to X" — the payer deposits a maximum and the facilitator settles
//! the actual usage, with the remainder returned.
//!
//! Use case: API metering, compute billing, any scenario where the exact cost
//! isn't known at payment time but the payer wants an on-chain spending cap.
//!
//! State machine:
//!   PENDING ─── recipient settle() ──→ SETTLED (terminal, fee charged)
//!     │
//!     └── deadline passes, expire() ───→ EXPIRED (terminal, no fee, full refund)
//!
//! Matches Move semantics from sweefi::upto_deposit (error codes 700-series).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("7H1iJSgBnFC7fgVje5EjXHRQs9XHCFDpcFQ2aXHaovsD");

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/// Minimum deposit: 1,000,000 base units (0.001 SOL or 1 USDC).
/// Matches Move MIN_DEPOSIT.
pub const MIN_DEPOSIT: u64 = 1_000_000;

/// Basis points denominator (10,000 = 100%).
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Maximum fee in basis points.
pub const MAX_FEE_BPS: u16 = 10_000;

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum UptoState {
    Pending,
    Settled,
    Expired,
}

impl Default for UptoState {
    fn default() -> Self {
        UptoState::Pending
    }
}

/// Upto deposit vault — PDA holding escrowed funds.
/// Seeds: ["upto", payer, recipient, nonce]
#[account]
#[derive(Default)]
pub struct UptoDeposit {
    /// Payer who deposited funds
    pub payer: Pubkey,
    /// Recipient who can settle
    pub recipient: Pubkey,
    /// Token mint for this deposit
    pub mint: Pubkey,
    /// Original deposit amount (max amount)
    pub max_amount: u64,
    /// Client-enforced ceiling on settlement (0 = no ceiling)
    pub settlement_ceiling: u64,
    /// Unix timestamp (seconds) after which expire() is permissionless
    pub settlement_deadline: i64,
    /// Current state
    pub state: UptoState,
    /// Fee in basis points (0-10000)
    pub fee_bps: u16,
    /// Address that receives the fee
    pub fee_recipient: Pubkey,
    /// Timestamp when deposit was created
    pub created_at: i64,
    /// Nonce for PDA derivation (allows multiple deposits between same parties)
    pub nonce: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl UptoDeposit {
    pub const LEN: usize = 8  // discriminator
        + 32  // payer
        + 32  // recipient
        + 32  // mint
        + 8   // max_amount
        + 8   // settlement_ceiling
        + 8   // settlement_deadline
        + 1   // state
        + 2   // fee_bps
        + 32  // fee_recipient
        + 8   // created_at
        + 8   // nonce
        + 1;  // bump
}

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

#[event]
pub struct UptoDepositCreated {
    pub deposit: Pubkey,
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub max_amount: u64,
    pub settlement_ceiling: u64,
    pub settlement_deadline: i64,
    pub fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct UptoDepositSettled {
    pub deposit: Pubkey,
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub actual_amount: u64,
    pub fee_amount: u64,
    pub refunded: u64,
    pub timestamp: i64,
}

#[event]
pub struct UptoDepositExpired {
    pub deposit: Pubkey,
    pub payer: Pubkey,
    pub max_amount: u64,
    pub timestamp: i64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum UptoError {
    #[msg("Deposit amount below minimum (700)")]
    DepositTooSmall,  // 700

    #[msg("Deadline must be in the future (701)")]
    DeadlineInPast,  // 701

    #[msg("Fee exceeds maximum (702)")]
    InvalidFee,  // 702

    #[msg("Deposit is not in pending state (703)")]
    NotPending,  // 703

    #[msg("Only recipient can settle (704)")]
    NotRecipient,  // 704

    #[msg("Deadline has not been reached (705)")]
    DeadlineNotReached,  // 705

    #[msg("Settlement amount exceeds maximum or ceiling (706)")]
    SettleAmountTooHigh,  // 706

    #[msg("Settlement amount cannot be zero (707)")]
    SettleAmountZero,  // 707

    #[msg("Ceiling exceeds max amount (708)")]
    CeilingExceedsMax,  // 708

    #[msg("Payer and recipient cannot be the same (709)")]
    PayerIsRecipient,  // 709

    #[msg("Deadline has been reached, use expire() (710)")]
    DeadlineReached,  // 710

    #[msg("Arithmetic overflow")]
    Overflow,
}

// ═══════════════════════════════════════════════════════════════════════════
// Instructions
// ═══════════════════════════════════════════════════════════════════════════

#[program]
pub mod sweefi_upto {
    use super::*;

    /// Create an upto deposit without a settlement ceiling.
    /// The recipient can settle any amount up to max_amount.
    pub fn create(
        ctx: Context<Create>,
        amount: u64,
        settlement_deadline: i64,
        fee_bps: u16,
        nonce: u64,
    ) -> Result<()> {
        create_internal(ctx, amount, 0, settlement_deadline, fee_bps, nonce)
    }

    /// Create an upto deposit with a client-enforced settlement ceiling.
    /// The recipient cannot settle more than settlement_ceiling.
    pub fn create_with_ceiling(
        ctx: Context<CreateWithCeiling>,
        amount: u64,
        settlement_ceiling: u64,
        settlement_deadline: i64,
        fee_bps: u16,
        nonce: u64,
    ) -> Result<()> {
        require!(settlement_ceiling > 0 && settlement_ceiling <= amount, UptoError::CeilingExceedsMax);
        create_with_ceiling_internal(ctx, amount, settlement_ceiling, settlement_deadline, fee_bps, nonce)
    }

    /// Recipient settles the deposit for the actual usage amount.
    /// Fee is charged on the settled amount. Remainder refunded to payer.
    /// Must be called before the settlement deadline.
    pub fn settle(ctx: Context<Settle>, actual_amount: u64) -> Result<()> {
        let deposit = &ctx.accounts.deposit;
        let clock = Clock::get()?;

        // Validations
        require!(deposit.state == UptoState::Pending, UptoError::NotPending);
        require!(ctx.accounts.recipient.key() == deposit.recipient, UptoError::NotRecipient);
        require!(clock.unix_timestamp < deposit.settlement_deadline, UptoError::DeadlineReached);
        require!(actual_amount > 0, UptoError::SettleAmountZero);
        require!(actual_amount <= deposit.max_amount, UptoError::SettleAmountTooHigh);

        // Enforce ceiling if set
        if deposit.settlement_ceiling > 0 {
            require!(actual_amount <= deposit.settlement_ceiling, UptoError::SettleAmountTooHigh);
        }

        // Calculate fee
        let fee_bps = deposit.fee_bps;
        let fee_amount = actual_amount
            .checked_mul(fee_bps as u64)
            .ok_or(UptoError::Overflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(UptoError::Overflow)?;

        let recipient_amount = actual_amount.checked_sub(fee_amount).ok_or(UptoError::Overflow)?;
        let refunded = deposit.max_amount.checked_sub(actual_amount).ok_or(UptoError::Overflow)?;

        // Copy values for PDA seeds
        let payer_key = deposit.payer;
        let recipient_key = deposit.recipient;
        let nonce_bytes = deposit.nonce.to_le_bytes();
        let bump = deposit.bump;

        // PDA signer seeds
        let seeds = &[
            b"upto".as_ref(),
            payer_key.as_ref(),
            recipient_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer fee to fee recipient (if any)
        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.fee_token_account.to_account_info(),
                        authority: ctx.accounts.deposit.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        // Transfer settled amount (minus fee) to recipient
        if recipient_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.recipient_token_account.to_account_info(),
                        authority: ctx.accounts.deposit.to_account_info(),
                    },
                    signer_seeds,
                ),
                recipient_amount,
            )?;
        }

        // Refund remainder to payer
        if refunded > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.payer_token_account.to_account_info(),
                        authority: ctx.accounts.deposit.to_account_info(),
                    },
                    signer_seeds,
                ),
                refunded,
            )?;
        }

        // Now mutate
        let deposit = &mut ctx.accounts.deposit;
        deposit.state = UptoState::Settled;

        emit!(UptoDepositSettled {
            deposit: ctx.accounts.deposit.key(),
            payer: payer_key,
            recipient: recipient_key,
            actual_amount,
            fee_amount,
            refunded,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Expire an unsettled deposit after the deadline.
    /// Permissionless — anyone can trigger (prevents key-loss lockup).
    /// No fee charged on expire.
    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        let deposit = &ctx.accounts.deposit;
        let clock = Clock::get()?;

        require!(deposit.state == UptoState::Pending, UptoError::NotPending);
        require!(clock.unix_timestamp >= deposit.settlement_deadline, UptoError::DeadlineNotReached);

        // Copy values for PDA seeds
        let payer_key = deposit.payer;
        let recipient_key = deposit.recipient;
        let nonce_bytes = deposit.nonce.to_le_bytes();
        let bump = deposit.bump;
        let max_amount = deposit.max_amount;

        // PDA signer seeds
        let seeds = &[
            b"upto".as_ref(),
            payer_key.as_ref(),
            recipient_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Full refund to payer — no fee on unused service
        let refund_amount = ctx.accounts.escrow_token_account.amount;

        if refund_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.payer_token_account.to_account_info(),
                        authority: ctx.accounts.deposit.to_account_info(),
                    },
                    signer_seeds,
                ),
                refund_amount,
            )?;
        }

        // Now mutate
        let deposit = &mut ctx.accounts.deposit;
        deposit.state = UptoState::Expired;

        emit!(UptoDepositExpired {
            deposit: ctx.accounts.deposit.key(),
            payer: payer_key,
            max_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

fn create_internal(
    ctx: Context<Create>,
    amount: u64,
    settlement_ceiling: u64,
    settlement_deadline: i64,
    fee_bps: u16,
    nonce: u64,
) -> Result<()> {
    let clock = Clock::get()?;

    // Validations
    require!(amount >= MIN_DEPOSIT, UptoError::DepositTooSmall);
    require!(settlement_deadline > clock.unix_timestamp, UptoError::DeadlineInPast);
    require!(fee_bps <= MAX_FEE_BPS, UptoError::InvalidFee);
    require!(ctx.accounts.payer.key() != ctx.accounts.recipient.key(), UptoError::PayerIsRecipient);

    // Initialize deposit state
    let deposit = &mut ctx.accounts.deposit;
    deposit.payer = ctx.accounts.payer.key();
    deposit.recipient = ctx.accounts.recipient.key();
    deposit.mint = ctx.accounts.mint.key();
    deposit.max_amount = amount;
    deposit.settlement_ceiling = settlement_ceiling;
    deposit.settlement_deadline = settlement_deadline;
    deposit.state = UptoState::Pending;
    deposit.fee_bps = fee_bps;
    deposit.fee_recipient = ctx.accounts.fee_recipient.key();
    deposit.created_at = clock.unix_timestamp;
    deposit.nonce = nonce;
    deposit.bump = ctx.bumps.deposit;

    // Transfer tokens from payer to escrow
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

    emit!(UptoDepositCreated {
        deposit: ctx.accounts.deposit.key(),
        payer: ctx.accounts.payer.key(),
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        max_amount: amount,
        settlement_ceiling,
        settlement_deadline,
        fee_bps,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Internal implementation for create_with_ceiling (uses CreateWithCeiling context)
fn create_with_ceiling_internal(
    ctx: Context<CreateWithCeiling>,
    amount: u64,
    settlement_ceiling: u64,
    settlement_deadline: i64,
    fee_bps: u16,
    nonce: u64,
) -> Result<()> {
    let clock = Clock::get()?;

    // Validations
    require!(amount >= MIN_DEPOSIT, UptoError::DepositTooSmall);
    require!(settlement_deadline > clock.unix_timestamp, UptoError::DeadlineInPast);
    require!(fee_bps <= MAX_FEE_BPS, UptoError::InvalidFee);
    require!(ctx.accounts.payer.key() != ctx.accounts.recipient.key(), UptoError::PayerIsRecipient);

    // Initialize deposit state
    let deposit = &mut ctx.accounts.deposit;
    deposit.payer = ctx.accounts.payer.key();
    deposit.recipient = ctx.accounts.recipient.key();
    deposit.mint = ctx.accounts.mint.key();
    deposit.max_amount = amount;
    deposit.settlement_ceiling = settlement_ceiling;
    deposit.settlement_deadline = settlement_deadline;
    deposit.state = UptoState::Pending;
    deposit.fee_bps = fee_bps;
    deposit.fee_recipient = ctx.accounts.fee_recipient.key();
    deposit.created_at = clock.unix_timestamp;
    deposit.nonce = nonce;
    deposit.bump = ctx.bumps.deposit;

    // Transfer tokens from payer to escrow
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

    emit!(UptoDepositCreated {
        deposit: ctx.accounts.deposit.key(),
        payer: ctx.accounts.payer.key(),
        recipient: ctx.accounts.recipient.key(),
        mint: ctx.accounts.mint.key(),
        max_amount: amount,
        settlement_ceiling,
        settlement_deadline,
        fee_bps,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Account contexts
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(amount: u64, settlement_deadline: i64, fee_bps: u16, nonce: u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Recipient address — validated to not equal payer
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Fee recipient address
    pub fee_recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = UptoDeposit::LEN,
        seeds = [b"upto", payer.key().as_ref(), recipient.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub deposit: Account<'info, UptoDeposit>,

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
        associated_token::authority = deposit,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Separate context for create_with_ceiling — Anchor 1.0 requires instruction args to match exactly
#[derive(Accounts)]
#[instruction(amount: u64, settlement_ceiling: u64, settlement_deadline: i64, fee_bps: u16, nonce: u64)]
pub struct CreateWithCeiling<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Recipient address — validated to not equal payer
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Fee recipient address
    pub fee_recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = UptoDeposit::LEN,
        seeds = [b"upto", payer.key().as_ref(), recipient.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub deposit: Account<'info, UptoDeposit>,

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
        associated_token::authority = deposit,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [b"upto", deposit.payer.as_ref(), deposit.recipient.as_ref(), &deposit.nonce.to_le_bytes()],
        bump = deposit.bump,
    )]
    pub deposit: Account<'info, UptoDeposit>,

    #[account(
        mut,
        associated_token::mint = deposit.mint,
        associated_token::authority = deposit,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = deposit.mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: Payer's token account for refunds
    #[account(
        mut,
        constraint = payer_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&deposit.payer, &deposit.mint)
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// CHECK: Fee recipient's token account
    #[account(
        mut,
        constraint = fee_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&deposit.fee_recipient, &deposit.mint)
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Expire<'info> {
    /// CHECK: Anyone can trigger expire after deadline
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"upto", deposit.payer.as_ref(), deposit.recipient.as_ref(), &deposit.nonce.to_le_bytes()],
        bump = deposit.bump,
    )]
    pub deposit: Account<'info, UptoDeposit>,

    #[account(
        mut,
        associated_token::mint = deposit.mint,
        associated_token::authority = deposit,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// CHECK: Payer's token account for refund
    #[account(
        mut,
        constraint = payer_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&deposit.payer, &deposit.mint)
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
