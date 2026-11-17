use crate::errors::EscrowError;
use crate::state::{valid_cancel_timeout, Config, CONFIG_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;

/// Mock USD mint decimals (docs/interfaces.md §1).
pub const MOCK_USD_DECIMALS: u8 = 6;

/// SECURITY: only the program's upgrade authority (the deployer) can create the singleton
/// Config. Without this, whoever calls first after deployment would become admin and choose the
/// relayer and mint (front-running takeover). Matches docs/interfaces.md §2 "deployer/admin".
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ EscrowError::Unauthorized
    )]
    pub program: Program<'info, crate::program::Escrow>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ EscrowError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,
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
    pub fn handler(&mut self, relayer: Pubkey, cancel_timeout_secs: i64, bump: u8) -> Result<()> {
        require!(relayer != Pubkey::default(), EscrowError::InvalidRelayer);
        require!(
            valid_cancel_timeout(cancel_timeout_secs),
            EscrowError::InvalidTimeout
        );
        self.config.set_inner(Config {
            admin: self.admin.key(),
            relayer,
            mint: self.mint.key(),
            paused: false,
            bump,
            cancel_timeout_secs,
        });
        Ok(())
    }
}
