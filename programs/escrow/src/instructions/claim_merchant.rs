use super::payout::pay_from_vault;
use crate::errors::EscrowError;
use crate::events::ClaimEvent;
use crate::state::{
    ClaimKind, Config, Promo, PromoState, Purchase, PurchaseState, CONFIG_SEED, PROMO_SEED,
    PURCHASE_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Merchant claims one purchase's `amount`: `Hedged -> ClaimedByMerchant`, only when the promo
/// is `ResolvedNo`. Blocked while paused. One purchase per call (docs/interfaces.md §8.4).
#[derive(Accounts)]
pub struct ClaimMerchant<'info> {
    pub merchant: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ EscrowError::Paused
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [PROMO_SEED, promo.merchant.as_ref(), &promo.promo_nonce.to_le_bytes()],
        bump = promo.bump,
        constraint = promo.merchant == merchant.key() @ EscrowError::Unauthorized
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
    #[account(address = promo.mint @ EscrowError::WrongMint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, address = promo.vault @ EscrowError::WrongTokenAccount)]
    pub vault: Account<'info, TokenAccount>,
    /// Destination: must be owned by the merchant and hold the promo's mint.
    #[account(
        mut,
        constraint = merchant_token_account.mint == mint.key() @ EscrowError::WrongMint,
        constraint = merchant_token_account.owner == merchant.key() @ EscrowError::WrongTokenAccount
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> ClaimMerchant<'info> {
    pub fn handler(&mut self) -> Result<()> {
        match self.purchase.state {
            PurchaseState::Hedged => {}
            PurchaseState::Refunded
            | PurchaseState::ClaimedByCustomer
            | PurchaseState::ClaimedByMerchant => return err!(EscrowError::AlreadyClaimed),
            // Un-hedged or cancelled purchases can never be paid to the merchant.
            PurchaseState::Deposited | PurchaseState::Cancelled => {
                return err!(EscrowError::InvalidState)
            }
        }
        require!(
            self.promo.state == PromoState::ResolvedNo,
            EscrowError::InvalidState
        );

        let amount = self.purchase.amount;
        let now = Clock::get()?.unix_timestamp;
        self.purchase.state = PurchaseState::ClaimedByMerchant;
        self.purchase.settled_at = now;

        pay_from_vault(
            &mut self.promo,
            &self.vault,
            &self.merchant_token_account,
            &self.mint,
            &self.token_program,
            amount,
        )?;

        emit!(ClaimEvent {
            promo: self.promo.key(),
            purchase: self.purchase.key(),
            recipient: self.merchant.key(),
            amount,
            kind: ClaimKind::MerchantPayout,
            claimed_at: now,
        });
        Ok(())
    }
}
