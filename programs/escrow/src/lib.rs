//! Hedged refund promotions — escrow program (Dev 2).
//!
//! 12 instructions: initialize_config, set_paused, set_relayer, set_cancel_timeout,
//! initialize_promo, deposit, mark_hedged, cancel_unhedged, cancel_expired_deposit, resolve_promo,
//! claim_refund, claim_merchant. Spec (PDA seeds, vault model, authority/pause matrix,
//! accounting): docs/interfaces.md §1–3, docs/workflow.md; overview: programs/escrow/docs.md.
use anchor_lang::prelude::*;
use state::{Outcome, PURCHASE_ID_LEN};

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

// Placeholder; replaced by `anchor keys sync` (keypair lives in target/deploy, gitignored).
declare_id!("E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr");

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        relayer: Pubkey,
        cancel_timeout_secs: i64,
    ) -> Result<()> {
        ctx.accounts
            .handler(relayer, cancel_timeout_secs, ctx.bumps.config)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.handler(paused)
    }

    pub fn initialize_promo(
        ctx: Context<InitializePromo>,
        promo_nonce: u64,
        offer_amount: u64,
        deposit_deadline: i64,
        market_id: String,
    ) -> Result<()> {
        ctx.accounts.handler(
            promo_nonce,
            offer_amount,
            deposit_deadline,
            market_id,
            ctx.bumps.promo,
        )
    }

    pub fn deposit(
        ctx: Context<Deposit>,
        purchase_id: [u8; PURCHASE_ID_LEN],
        amount: u64,
    ) -> Result<()> {
        ctx.accounts
            .handler(purchase_id, amount, ctx.bumps.purchase)
    }

    pub fn set_relayer(ctx: Context<SetRelayer>, new_relayer: Pubkey) -> Result<()> {
        ctx.accounts.handler(new_relayer)
    }

    pub fn mark_hedged(ctx: Context<MarkHedged>) -> Result<()> {
        ctx.accounts.handler()
    }

    pub fn cancel_unhedged(ctx: Context<CancelUnhedged>) -> Result<()> {
        ctx.accounts.handler()
    }

    pub fn resolve_promo(ctx: Context<ResolvePromo>, outcome: Outcome) -> Result<()> {
        ctx.accounts.handler(outcome)
    }

    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        ctx.accounts.handler()
    }

    pub fn claim_merchant(ctx: Context<ClaimMerchant>) -> Result<()> {
        ctx.accounts.handler()
    }

    pub fn set_cancel_timeout(
        ctx: Context<SetCancelTimeout>,
        cancel_timeout_secs: i64,
    ) -> Result<()> {
        ctx.accounts.handler(cancel_timeout_secs)
    }

    pub fn cancel_expired_deposit(ctx: Context<CancelExpiredDeposit>) -> Result<()> {
        ctx.accounts.handler()
    }
}
