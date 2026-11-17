use crate::errors::EscrowError;
use crate::state::{Config, CONFIG_SEED};
use anchor_lang::prelude::*;

/// Admin-only; allowed while paused (it is how you unpause). Admin has no fund access.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

impl<'info> SetPaused<'info> {
    pub fn handler(&mut self, paused: bool) -> Result<()> {
        self.config.paused = paused;
        Ok(())
    }
}
