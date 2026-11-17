use super::payout::pay_from_vault;
use crate::errors::EscrowError;
use crate::events::ClaimEvent;
use crate::state::{
    ClaimKind, Config, Promo, PromoState, Purchase, PurchaseState, CONFIG_SEED, PROMO_SEED,
    PURCHASE_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Customer reclaims exactly `purchase.amount`:
/// - `Cancelled -> Refunded` (any promo state; allowed while paused), or
/// - `Hedged -> ClaimedByCustomer` when the promo is `ResolvedYes` (blocked while paused).
#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    pub customer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
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
    #[account(address = promo.mint @ EscrowError::WrongMint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, address = promo.vault @ EscrowError::WrongTokenAccount)]
    pub vault: Account<'info, TokenAccount>,
    /// Destination: must be owned by the customer and hold the promo's mint.
    #[account(
        mut,
        constraint = customer_token_account.mint == mint.key() @ EscrowError::WrongMint,
        constraint = customer_token_account.owner == customer.key() @ EscrowError::WrongTokenAccount
    )]
    pub customer_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> ClaimRefund<'info> {
    pub fn handler(&mut self) -> Result<()> {
        let (next_state, kind) = match self.purchase.state {
            PurchaseState::Cancelled => (PurchaseState::Refunded, ClaimKind::CancelRefund),
            PurchaseState::Hedged => {
                // Only YES refunds a hedged purchase to its customer.
                require!(
                    self.promo.state == PromoState::ResolvedYes,
                    EscrowError::InvalidState
                );
                require!(!self.config.paused, EscrowError::Paused);
                (PurchaseState::ClaimedByCustomer, ClaimKind::YesRefund)
            }
            PurchaseState::Refunded
            | PurchaseState::ClaimedByCustomer
            | PurchaseState::ClaimedByMerchant => return err!(EscrowError::AlreadyClaimed),
            PurchaseState::Deposited => return err!(EscrowError::InvalidState),
        };

        let amount = self.purchase.amount;
        let now = Clock::get()?.unix_timestamp;
        self.purchase.state = next_state;
        self.purchase.settled_at = now;

        pay_from_vault(
            &mut self.promo,
            &self.vault,
            &self.customer_token_account,
            &self.mint,
            &self.token_program,
            amount,
        )?;

        emit!(ClaimEvent {
            promo: self.promo.key(),
            purchase: self.purchase.key(),
            recipient: self.customer.key(),
            amount,
            kind,
            claimed_at: now,
        });
        Ok(())
    }
}
