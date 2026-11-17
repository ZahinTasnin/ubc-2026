use crate::errors::EscrowError;
use crate::state::{Config, Promo, PromoState, CONFIG_SEED, MAX_MARKET_ID_LEN, PROMO_SEED};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(promo_nonce: u64)]
pub struct InitializePromo<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = !config.paused @ EscrowError::Paused
    )]
    pub config: Account<'info, Config>,
    #[account(address = config.mint @ EscrowError::WrongMint)]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = merchant,
        space = 8 + Promo::INIT_SPACE,
        seeds = [PROMO_SEED, merchant.key().as_ref(), &promo_nonce.to_le_bytes()],
        bump
    )]
    pub promo: Account<'info, Promo>,
    /// The single pooled vault: ATA of the Promo PDA (the PDA is the token authority).
    /// `init_if_needed` (not `init`) so a third party cannot grief a promo by pre-creating its
    /// deterministic vault ATA. Safe: the ATA address pins mint + owner (checked by the
    /// `associated_token` constraints) and nobody can set a delegate/close authority on an ATA whose
    /// owner is a not-yet-existing PDA.
    #[account(
        init_if_needed,
        payer = merchant,
        associated_token::mint = mint,
        associated_token::authority = promo
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> InitializePromo<'info> {
    pub fn handler(
        &mut self,
        promo_nonce: u64,
        offer_amount: u64,
        deposit_deadline: i64,
        market_id: String,
        bump: u8,
    ) -> Result<()> {
        require!(offer_amount > 0, EscrowError::InvalidOfferAmount);
        require!(!market_id.is_empty(), EscrowError::EmptyMarketId);
        require!(
            market_id.len() <= MAX_MARKET_ID_LEN,
            EscrowError::MarketIdTooLong
        );
        require!(
            deposit_deadline > Clock::get()?.unix_timestamp,
            EscrowError::InvalidDeadline
        );
        self.promo.set_inner(Promo {
            merchant: self.merchant.key(),
            mint: self.mint.key(),
            vault: self.vault.key(),
            promo_nonce,
            offer_amount,
            deposit_deadline,
            market_id,
            state: PromoState::Active,
            resolved_at: 0,
            total_deposited: 0,
            total_paid_out: 0,
            purchase_count: 0,
            bump,
            // snapshot: later admin changes do not alter this promo's recovery term
            cancel_timeout_secs: self.config.cancel_timeout_secs,
        });
        Ok(())
    }
}
