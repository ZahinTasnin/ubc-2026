use crate::errors::EscrowError;
use crate::events::HedgeMarkedEvent;
use crate::state::{
    Config, Promo, PromoState, Purchase, PurchaseState, CONFIG_SEED, PROMO_SEED, PURCHASE_SEED,
};
use anchor_lang::prelude::*;

/// Relayer attests that the off-chain (simulated) hedge for ONE purchase succeeded.
/// `Deposited -> Hedged`. Blocked while paused.
#[derive(Accounts)]
pub struct MarkHedged<'info> {
    #[account(constraint = relayer.key() == config.relayer @ EscrowError::Unauthorized)]
    pub relayer: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ EscrowError::Paused
    )]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [PROMO_SEED, promo.merchant.as_ref(), &promo.promo_nonce.to_le_bytes()],
        bump = promo.bump
    )]
    pub promo: Account<'info, Promo>,
    /// Must be this promo's purchase: seeds bind (promo, customer, purchase_id) to the account.
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

impl<'info> MarkHedged<'info> {
    pub fn handler(&mut self) -> Result<()> {
        // Purchase state first, so a retry after success reports AlreadyHedged even if the
        // promo has since been resolved.
        match self.purchase.state {
            PurchaseState::Deposited => {}
            PurchaseState::Hedged
            | PurchaseState::ClaimedByCustomer
            | PurchaseState::ClaimedByMerchant => return err!(EscrowError::AlreadyHedged),
            // Conflicting transition: the purchase was cancelled.
            PurchaseState::Cancelled | PurchaseState::Refunded => {
                return err!(EscrowError::InvalidState)
            }
        }
        require!(
            self.promo.state == PromoState::Active,
            EscrowError::PromoNotActive
        );

        let now = Clock::get()?.unix_timestamp;
        self.purchase.state = PurchaseState::Hedged;
        self.purchase.hedged_at = now;

        emit!(HedgeMarkedEvent {
            promo: self.promo.key(),
            purchase: self.purchase.key(),
            relayer: self.relayer.key(),
            marked_at: now,
        });
        Ok(())
    }
}
