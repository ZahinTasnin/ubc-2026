use crate::errors::EscrowError;
use crate::state::{Config, CONFIG_SEED};
use anchor_lang::prelude::*;

/// Admin rotates the single relayer key. Allowed while paused (key-compromise recovery).
/// The admin gains no fund access: the relayer can only drive state transitions.
#[derive(Accounts)]
pub struct SetRelayer<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

impl<'info> SetRelayer<'info> {
    pub fn handler(&mut self, new_relayer: Pubkey) -> Result<()> {
        require!(
            new_relayer != Pubkey::default(),
            EscrowError::InvalidRelayer
        );
        self.config.relayer = new_relayer;
        Ok(())
    }
}
