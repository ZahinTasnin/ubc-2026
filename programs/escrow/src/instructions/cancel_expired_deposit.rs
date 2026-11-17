use crate::errors::EscrowError;
use crate::events::PurchaseCancelledEvent;
use crate::state::{
    Config, Promo, Purchase, PurchaseState, CONFIG_SEED, PROMO_SEED, PURCHASE_SEED,
};
use anchor_lang::prelude::*;

/// Customer-signed recovery for a purchase the relayer never hedged or cancelled (relayer
/// disappeared). `Deposited -> Cancelled` once `now >= purchase.deposited_at +
/// promo.cancel_timeout_secs`. Identical in effect to the relayer's `cancel_unhedged` (same state,
/// same `PurchaseCancelledEvent`, no tokens move); the customer then uses the existing
/// `claim_refund` cancel path.
///
/// Safety properties (docs/D2-PROPOSAL.md, approved scope):
/// - ONLY the purchase's own customer can call it, and only for that purchase.
/// - ONLY a `Deposited` purchase: a `Hedged` purchase is never cancelled by timeout (an on-chain
///   timeout does not prove an off-chain hedge was unwound), so hedged purchases keep waiting for
///   resolution.
/// - Mutually exclusive with `mark_hedged` / `cancel_unhedged` (all need `Deposited`).
/// - Allowed in any promo state and while paused: it only returns the caller's own funds, like
///   `cancel_unhedged`.
#[derive(Accounts)]
pub struct CancelExpiredDeposit<'info> {
    pub customer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [PROMO_SEED, promo.merchant.as_ref(), &promo.promo_nonce.to_le_bytes()],
        bump = promo.bump
    )]
    pub promo: Account<'info, Promo>,
    #[account(
        mut,
        seeds = [
            PURCHASE_SEED,
            promo.key().as_ref(),
            purchase.customer.as_ref(),
            &purchase.purchase_id
        ],
        bump = purchase.bump,
        has_one = promo,
        constraint = purchase.customer == customer.key() @ EscrowError::Unauthorized
    )]
    pub purchase: Account<'info, Purchase>,
}

impl<'info> CancelExpiredDeposit<'info> {
    pub fn handler(&mut self) -> Result<()> {
        // State first (like the relayer instructions) so a replay reports AlreadyCancelled, not a
        // timing error.
        match self.purchase.state {
            PurchaseState::Deposited => {}
            PurchaseState::Cancelled | PurchaseState::Refunded => {
                return err!(EscrowError::AlreadyCancelled)
            }
            // A hedged (or settled-after-hedge) purchase can never be cancelled by timeout.
            PurchaseState::Hedged
            | PurchaseState::ClaimedByCustomer
            | PurchaseState::ClaimedByMerchant => return err!(EscrowError::InvalidState),
        }

        let now = Clock::get()?.unix_timestamp;
        let elapsed = self
            .purchase
            .cancel_timeout_elapsed(self.promo.cancel_timeout_secs, now)
            .ok_or(EscrowError::MathOverflow)?;
        require!(elapsed, EscrowError::TimeoutNotElapsed);

        self.purchase.state = PurchaseState::Cancelled;
        self.purchase.cancelled_at = now;

        emit!(PurchaseCancelledEvent {
            promo: self.promo.key(),
            purchase: self.purchase.key(),
            customer: self.purchase.customer,
            amount: self.purchase.amount,
            cancelled_at: now,
        });
        Ok(())
    }
}
