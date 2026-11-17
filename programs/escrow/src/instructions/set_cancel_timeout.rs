use crate::errors::EscrowError;
use crate::state::{valid_cancel_timeout, Config, CONFIG_SEED};
use anchor_lang::prelude::*;

/// Admin sets the customer-recovery timeout used by FUTURE promos (each promo snapshots the value
/// at `initialize_promo`, so existing promos keep the term they were created with). Allowed while
/// paused. Gives the admin no access to funds.
#[derive(Accounts)]
pub struct SetCancelTimeout<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ EscrowError::Unauthorized
    )]
    pub config: Account<'info, Config>,
}

impl<'info> SetCancelTimeout<'info> {
    pub fn handler(&mut self, cancel_timeout_secs: i64) -> Result<()> {
        require!(
            valid_cancel_timeout(cancel_timeout_secs),
            EscrowError::InvalidTimeout
        );
        self.config.cancel_timeout_secs = cancel_timeout_secs;
        Ok(())
    }
}
