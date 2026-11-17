use crate::errors::EscrowError;
use crate::events::DepositEvent;
use crate::state::{
    Config, Promo, PromoState, Purchase, PurchaseState, CONFIG_SEED, PROMO_SEED, PURCHASE_ID_LEN,
    PURCHASE_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
#[instruction(purchase_id: [u8; PURCHASE_ID_LEN])]
pub struct Deposit<'info> {
    #[account(mut)]
    pub customer: Signer<'info>,
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
        constraint = promo.state == PromoState::Active @ EscrowError::PromoNotActive
    )]
    pub promo: Account<'info, Promo>,
    #[account(address = promo.mint @ EscrowError::WrongMint)]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = customer,
        space = 8 + Purchase::INIT_SPACE,
        seeds = [PURCHASE_SEED, promo.key().as_ref(), customer.key().as_ref(), &purchase_id],
        bump
    )]
    pub purchase: Account<'info, Purchase>,
    #[account(
        mut,
        constraint = customer_token_account.mint == mint.key() @ EscrowError::WrongMint,
        constraint = customer_token_account.owner == customer.key() @ EscrowError::WrongTokenAccount
    )]
    pub customer_token_account: Account<'info, TokenAccount>,
    #[account(mut, address = promo.vault @ EscrowError::WrongTokenAccount)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {
    pub fn handler(
        &mut self,
        purchase_id: [u8; PURCHASE_ID_LEN],
        amount: u64,
        bump: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now < self.promo.deposit_deadline,
            EscrowError::DepositClosed
        );
        require!(amount == self.promo.offer_amount, EscrowError::WrongAmount);

        let total_deposited = self
            .promo
            .total_deposited
            .checked_add(amount)
            .ok_or(EscrowError::MathOverflow)?;
        let purchase_count = self
            .promo
            .purchase_count
            .checked_add(1)
            .ok_or(EscrowError::MathOverflow)?;

        token::transfer_checked(
            CpiContext::new(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.customer_token_account.to_account_info(),
                    mint: self.mint.to_account_info(),
                    to: self.vault.to_account_info(),
                    authority: self.customer.to_account_info(),
                },
            ),
            amount,
            self.mint.decimals,
        )?;

        self.promo.total_deposited = total_deposited;
        self.promo.purchase_count = purchase_count;
        self.purchase.set_inner(Purchase {
            promo: self.promo.key(),
            customer: self.customer.key(),
            purchase_id,
            amount,
            state: PurchaseState::Deposited,
            deposited_at: now,
            hedged_at: 0,
            cancelled_at: 0,
            settled_at: 0,
            bump,
        });

        emit!(DepositEvent {
            promo: self.promo.key(),
            purchase: self.purchase.key(),
            customer: self.customer.key(),
            purchase_id,
            amount,
            deposited_at: now,
        });
        Ok(())
    }
}
