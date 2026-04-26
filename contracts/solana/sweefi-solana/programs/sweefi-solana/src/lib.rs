use anchor_lang::prelude::*;

declare_id!("FAk6Ruv7tchhZysKmWSHn9rYcKJTgBm54FoB1ZdYTyTf");

#[program]
pub mod sweefi_solana {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
