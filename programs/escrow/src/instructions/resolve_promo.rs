use crate::errors::EscrowError;
use crate::events::ResolutionEvent;
use crate::state::{Config, Outcome, Promo, PromoState, CONFIG_SEED, PROMO_SEED};
use anchor_lang::prelude::*;

/// Relayer records the final outcome of the promo's market, exactly once:
/// `Active -> ResolvedYes | ResolvedNo`. Blocked while paused. Purchases are NOT touched here;
/// each is settled by its own claim. Rejected before `promo.deposit_deadline` (D4). The outcome is only accepted from the configured relayer
/// (trusted-relayer MVP; the backend must have verified official Gemini settlement off-chain).
#[derive(Accounts)]
pub struct ResolvePromo<'info> {
    #[account(constraint = relayer.key() == config.relayer @ EscrowError::Unauthorized)]
    pub relayer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ EscrowError::Paused
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PROMO_SEED, promo.merchant.as_ref(), &promo.promo_nonce.to_le_bytes()],
        bump = promo.bump
    )]
    pub promo: Account<'info, Promo>,
}

impl<'info> ResolvePromo<'info> {
    pub fn handler(&mut self, outcome: Outcome) -> Result<()> {
        // One-time resolution: any later call (same or different outcome) is rejected; the
        // gateway re-reads state to tell an idempotent retry from a conflicting one.
        require!(
            self.promo.state == PromoState::Active,
            EscrowError::AlreadyResolved
        );

        // D4: never before the deposit deadline. Checked AFTER the Active check so a retry on an
        // already-resolved promo still reports `AlreadyResolved`. At the deadline itself, deposits
        // are already closed (`deposits_open` is `now < deadline`), so there is no overlap.
        let now = Clock::get()?.unix_timestamp;
        require!(
            self.promo.resolution_open(now),
            EscrowError::ResolutionTooEarly
        );
        self.promo.state = match outcome {
            Outcome::Yes => PromoState::ResolvedYes,
            Outcome::No => PromoState::ResolvedNo,
        };
        self.promo.resolved_at = now;

        emit!(ResolutionEvent {
            promo: self.promo.key(),
            outcome,
            relayer: self.relayer.key(),
            resolved_at: now,
        });
        Ok(())
    }
}
