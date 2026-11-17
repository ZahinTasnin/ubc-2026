use crate::errors::EscrowError;
use crate::events::PurchaseCancelledEvent;
use crate::state::{
    Config, Promo, Purchase, PurchaseState, CONFIG_SEED, PROMO_SEED, PURCHASE_SEED,
};
use anchor_lang::prelude::*;

/// Relayer cancels ONE un-hedged purchase: `Deposited -> Cancelled`. This only creates a refund
/// entitlement for `purchase.customer` (claimed later via `claim_refund`); no tokens move here.
/// Allowed while paused and in any promo state: it can only return a customer's own funds.
#[derive(Accounts)]
pub struct CancelUnhedged<'info> {
    #[account(constraint = relayer.key() == config.relayer @ EscrowError::Unauthorized)]
    pub relayer: Signer<'info>,
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
        has_one = promo
    )]
    pub purchase: Account<'info, Purchase>,
}

impl<'info> CancelUnhedged<'info> {
    pub fn handler(&mut self) -> Result<()> {
        match self.purchase.state {
            PurchaseState::Deposited => {}
            PurchaseState::Cancelled | PurchaseState::Refunded => {
                return err!(EscrowError::AlreadyCancelled)
            }
            // Conflicting transition: a hedged purchase can never be cancelled.
            PurchaseState::Hedged
            | PurchaseState::ClaimedByCustomer
            | PurchaseState::ClaimedByMerchant => return err!(EscrowError::InvalidState),
        }

        let now = Clock::get()?.unix_timestamp;
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
