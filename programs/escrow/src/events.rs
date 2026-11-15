use anchor_lang::prelude::*;

// Preliminary event shapes (CLAUDE.md §6). Amounts are integer token base units.

#[event]
pub struct DepositEvent {
    pub purchase: Pubkey,
    pub promo: Pubkey,
    pub customer: Pubkey,
    pub amount: u64,
}

// TODO(Dev 2): PromotionResolvedEvent, PurchaseCancelledEvent, optional PurchaseHedgedEvent.
