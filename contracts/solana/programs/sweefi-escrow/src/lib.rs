//! SweeFi Escrow — time-locked vault with arbiter dispute resolution
//!
//! State machine:
//!   ACTIVE ─── buyer release() ──────────→ RELEASED (terminal)
//!     │   └─── deadline passes, refund() → REFUNDED (terminal)
//!     │
//!     └── buyer/seller dispute() ──→ DISPUTED
//!                                     ├── arbiter release() → RELEASED
//!                                     └── arbiter refund()  → REFUNDED
//!                                     └── deadline passes   → REFUNDED
//!
//! Matches Move semantics from sweefi::escrow (error codes 200-series).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("AbH1dHyrGjE8P6Ti4QLSWp9zVzZZfAg26uK5DqLY12Gt");

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

pub const MIN_DEPOSIT: u64 = 1_000_000;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_FEE_BPS: u16 = 10_000;
pub const MAX_DESCRIPTION_LEN: usize = 1024;

/// Grace period ratio: 50% of original duration
pub const GRACE_RATIO_BPS: u64 = 5_000;
/// Minimum grace: 7 days in seconds
pub const GRACE_FLOOR: i64 = 7 * 24 * 60 * 60;
/// Maximum grace: 30 days in seconds
pub const GRACE_CAP: i64 = 30 * 24 * 60 * 60;

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowState {
    Active,
    Disputed,
    Released,
    Refunded,
}

impl Default for EscrowState {
    fn default() -> Self {
        EscrowState::Active
    }
}

#[account]
#[derive(Default)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub state: EscrowState,
    pub fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub created_at: i64,
    pub nonce: u64,
    pub bump: u8,
}

impl Escrow {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 2 + 32 + 8 + 8 + 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════════════════════

#[event]
pub struct EscrowCreated {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub arbiter: Pubkey,
    pub amount: u64,
    pub deadline: i64,
    pub timestamp: i64,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub fee_amount: u64,
    pub released_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EscrowRefunded {
    pub escrow: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub refunded_by: Pubkey,
    pub reason: u8,
    pub timestamp: i64,
}

#[event]
pub struct EscrowDisputed {
    pub escrow: Pubkey,
    pub disputed_by: Pubkey,
    pub new_deadline: i64,
    pub timestamp: i64,
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum EscrowError {
    #[msg("Not the buyer (200)")]
    NotBuyer,

    #[msg("Not the seller (201)")]
    NotSeller,

    #[msg("Not the arbiter (202)")]
    NotArbiter,

    #[msg("Not authorized (203)")]
    NotAuthorized,

    #[msg("Deadline must be in the future (204)")]
    DeadlineInPast,

    #[msg("Deadline has not been reached (205)")]
    DeadlineNotReached,

    #[msg("Escrow already resolved (206)")]
    AlreadyResolved,

    #[msg("Escrow is not disputed (207)")]
    NotDisputed,

    #[msg("Escrow is already disputed (208)")]
    AlreadyDisputed,

    #[msg("Amount below minimum (209)")]
    ZeroAmount,

    #[msg("Invalid fee (210)")]
    InvalidFee,

    #[msg("Description too long (211)")]
    DescriptionTooLong,

    #[msg("Arbiter cannot be seller (212)")]
    ArbiterIsSeller,

    #[msg("Arbiter cannot be buyer (213)")]
    ArbiterIsBuyer,

    #[msg("Buyer cannot be seller (214)")]
    BuyerIsSeller,

    #[msg("Deadline has been reached (215)")]
    DeadlineReached,

    #[msg("Arithmetic overflow")]
    Overflow,
}

// ═══════════════════════════════════════════════════════════════════════════
// Instructions
// ═══════════════════════════════════════════════════════════════════════════

#[program]
pub mod sweefi_escrow {
    use super::*;

    /// Create a new escrow. Buyer deposits funds.
    pub fn create(
        ctx: Context<Create>,
        amount: u64,
        deadline: i64,
        fee_bps: u16,
        nonce: u64,
    ) -> Result<()> {
        let clock = Clock::get()?;

        require!(amount >= MIN_DEPOSIT, EscrowError::ZeroAmount);
        require!(deadline > clock.unix_timestamp, EscrowError::DeadlineInPast);
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::InvalidFee);

        let buyer = ctx.accounts.buyer.key();
        let seller = ctx.accounts.seller.key();
        let arbiter = ctx.accounts.arbiter.key();

        require!(buyer != seller, EscrowError::BuyerIsSeller);
        require!(arbiter != seller, EscrowError::ArbiterIsSeller);
        require!(arbiter != buyer, EscrowError::ArbiterIsBuyer);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = buyer;
        escrow.seller = seller;
        escrow.arbiter = arbiter;
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.deadline = deadline;
        escrow.state = EscrowState::Active;
        escrow.fee_bps = fee_bps;
        escrow.fee_recipient = ctx.accounts.fee_recipient.key();
        escrow.created_at = clock.unix_timestamp;
        escrow.nonce = nonce;
        escrow.bump = ctx.bumps.escrow;

        // Transfer tokens from buyer to escrow
        token::transfer(
            CpiContext::new(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(EscrowCreated {
            escrow: ctx.accounts.escrow.key(),
            buyer,
            seller,
            arbiter,
            amount,
            deadline,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Buyer releases funds to seller (voluntary completion).
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let clock = Clock::get()?;
        let caller = ctx.accounts.caller.key();

        // Buyer can release anytime in Active state
        // Arbiter can release only in Disputed state
        match ctx.accounts.escrow.state {
            EscrowState::Active => {
                require!(caller == ctx.accounts.escrow.buyer, EscrowError::NotBuyer);
            }
            EscrowState::Disputed => {
                require!(caller == ctx.accounts.escrow.arbiter, EscrowError::NotArbiter);
            }
            _ => return err!(EscrowError::AlreadyResolved),
        }

        release_internal(ctx, clock.unix_timestamp)
    }

    /// Refund funds to buyer (timeout or arbiter decision).
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let clock = Clock::get()?;

        let caller = ctx.accounts.caller.key();

        match escrow.state {
            EscrowState::Active => {
                // After deadline, anyone can trigger refund (permissionless)
                require!(clock.unix_timestamp >= escrow.deadline, EscrowError::DeadlineNotReached);
            }
            EscrowState::Disputed => {
                // Arbiter can refund, OR anyone after deadline
                if clock.unix_timestamp < escrow.deadline {
                    require!(caller == escrow.arbiter, EscrowError::NotArbiter);
                }
            }
            _ => return err!(EscrowError::AlreadyResolved),
        }

        let reason = escrow.state as u8;

        // Copy values for PDA seeds
        let buyer_key = escrow.buyer;
        let seller_key = escrow.seller;
        let nonce_bytes = escrow.nonce.to_le_bytes();
        let bump = escrow.bump;

        // Transfer full amount back to buyer (no fee on refund)
        let seeds = &[
            b"escrow".as_ref(),
            buyer_key.as_ref(),
            seller_key.as_ref(),
            nonce_bytes.as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let refund_amount = ctx.accounts.escrow_token_account.amount;
        if refund_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    *ctx.accounts.token_program.key,
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.buyer_token_account.to_account_info(),
                        authority: ctx.accounts.escrow.to_account_info(),
                    },
                    signer_seeds,
                ),
                refund_amount,
            )?;
        }

        // Now mutate
        let escrow = &mut ctx.accounts.escrow;
        escrow.state = EscrowState::Refunded;

        emit!(EscrowRefunded {
            escrow: ctx.accounts.escrow.key(),
            buyer: buyer_key,
            seller: seller_key,
            amount: refund_amount,
            refunded_by: caller,
            reason,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    /// Buyer or seller raises a dispute.
    pub fn dispute(ctx: Context<Dispute>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        require!(escrow.state == EscrowState::Active, EscrowError::AlreadyDisputed);

        let caller = ctx.accounts.caller.key();
        require!(
            caller == escrow.buyer || caller == escrow.seller,
            EscrowError::NotAuthorized
        );

        // Cannot dispute after deadline (M-01: prevents arbiter-seller collusion)
        require!(clock.unix_timestamp < escrow.deadline, EscrowError::DeadlineReached);

        escrow.state = EscrowState::Disputed;

        // Extend deadline with grace period
        let original_duration = escrow.deadline.saturating_sub(escrow.created_at);
        let grace = (original_duration as u64)
            .saturating_mul(GRACE_RATIO_BPS)
            .saturating_div(BPS_DENOMINATOR) as i64;
        let clamped_grace = grace.max(GRACE_FLOOR).min(GRACE_CAP);

        let new_deadline = escrow.deadline.saturating_add(clamped_grace);
        escrow.deadline = new_deadline;

        emit!(EscrowDisputed {
            escrow: ctx.accounts.escrow.key(),
            disputed_by: caller,
            new_deadline,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

fn release_internal(ctx: Context<Release>, now: i64) -> Result<()> {
    // Capture escrow key before mutable borrow
    let escrow_key = ctx.accounts.escrow.key();
    let caller_key = ctx.accounts.caller.key();

    // Copy values for PDA seeds and event BEFORE mutable borrow
    let buyer_key = ctx.accounts.escrow.buyer;
    let seller_key = ctx.accounts.escrow.seller;
    let nonce_bytes = ctx.accounts.escrow.nonce.to_le_bytes();
    let bump = ctx.accounts.escrow.bump;
    let fee_bps = ctx.accounts.escrow.fee_bps;

    let seeds = &[
        b"escrow".as_ref(),
        buyer_key.as_ref(),
        seller_key.as_ref(),
        nonce_bytes.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let amount = ctx.accounts.escrow_token_account.amount;

    // Calculate fee
    let fee_amount = amount
        .checked_mul(fee_bps as u64)
        .ok_or(EscrowError::Overflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(EscrowError::Overflow)?;

    let seller_amount = amount.checked_sub(fee_amount).ok_or(EscrowError::Overflow)?;

    // Transfer fee
    if fee_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.fee_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            fee_amount,
        )?;
    }

    // Transfer to seller
    if seller_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                *ctx.accounts.token_program.key,
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer_seeds,
            ),
            seller_amount,
        )?;
    }

    // Now take mutable borrow for state mutation
    ctx.accounts.escrow.state = EscrowState::Released;

    emit!(EscrowReleased {
        escrow: escrow_key,
        buyer: buyer_key,
        seller: seller_key,
        amount,
        fee_amount,
        released_by: caller_key,
        timestamp: now,
    });

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Account contexts
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(amount: u64, deadline: i64, fee_bps: u16, nonce: u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Seller address
    pub seller: UncheckedAccount<'info>,

    /// CHECK: Arbiter address
    pub arbiter: UncheckedAccount<'info>,

    /// CHECK: Fee recipient
    pub fee_recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = buyer,
        space = Escrow::LEN,
        seeds = [b"escrow", buyer.key().as_ref(), seller.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = escrow.mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = seller_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&escrow.seller, &escrow.mint)
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&escrow.fee_recipient, &escrow.mint)
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        associated_token::mint = escrow.mint,
        associated_token::authority = escrow,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = buyer_token_account.key() == anchor_spl::associated_token::get_associated_token_address(&escrow.buyer, &escrow.mint)
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.buyer.as_ref(), escrow.seller.as_ref(), &escrow.nonce.to_le_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,
}
