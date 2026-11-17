use crate::errors::EscrowError;
use crate::state::{Config, CONFIG_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

/// Mock USD mint decimals (docs/interfaces.md §1).
pub const MOCK_USD_DECIMALS: u8 = 6;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(constraint = mint.decimals == MOCK_USD_DECIMALS @ EscrowError::WrongDecimals)]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializeConfig<'info> {
    pub fn handler(&mut self, relayer: Pubkey, bump: u8) -> Result<()> {
        require!(relayer != Pubkey::default(), EscrowError::InvalidRelayer);
        self.config.set_inner(Config {
            admin: self.admin.key(),
            relayer,
            mint: self.mint.key(),
            paused: false,
            bump,
        });
        Ok(())
    }
}
