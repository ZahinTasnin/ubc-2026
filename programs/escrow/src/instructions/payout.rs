//! Shared payout path for `claim_refund` / `claim_merchant` (not an instruction itself).
use crate::errors::EscrowError;
use crate::state::{Promo, PROMO_SEED};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

/// Pays exactly `amount` (one purchase's own liability) from the pooled vault to `destination`,
/// signed by the Promo PDA, and updates `promo.total_paid_out`. Callers must already have
/// validated the purchase state, the signer, and that `destination` has the right owner/mint;
/// they move the purchase to its terminal state in the same instruction (checks-effects-interactions,
/// and the whole transaction is atomic anyway).
pub fn pay_from_vault<'info>(
    promo: &mut Account<'info, Promo>,
    vault: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    token_program: &Program<'info, Token>,
    amount: u64,
) -> Result<()> {
    let total_paid_out = promo
        .total_paid_out
        .checked_add(amount)
        .ok_or(EscrowError::MathOverflow)?;
    // Invariants: paid out never exceeds deposited, and the vault can cover this payout.
    require!(
        total_paid_out <= promo.total_deposited,
        EscrowError::InsufficientVaultFunds
    );
    require!(vault.amount >= amount, EscrowError::InsufficientVaultFunds);
    promo.total_paid_out = total_paid_out;

    let nonce = promo.promo_nonce.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        PROMO_SEED,
        promo.merchant.as_ref(),
        nonce.as_ref(),
        &[promo.bump],
    ]];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: destination.to_account_info(),
                authority: promo.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        mint.decimals,
    )
}
