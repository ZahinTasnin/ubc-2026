use crate::state::{ClaimKind, Outcome};
use anchor_lang::prelude::*;

// Event schemas (docs/interfaces.md "Anchor events"). Events are NOTIFICATIONS, not proof: the
// off-chain listener (Dev 3) must verify the finalized tx and account/token state. Signature,
// slot and event index are attached off-chain, not stored here. Amounts are u64 base units;
// timestamps are i64 unix seconds from Clock.

/// Emitted by `deposit`.
#[event]
pub struct DepositEvent {
    pub promo: Pubkey,
    pub purchase: Pubkey,
    pub customer: Pubkey,
    pub purchase_id: [u8; 16],
    pub amount: u64,
    pub deposited_at: i64,
}

/// Emitted by `mark_hedged`.
#[event]
pub struct HedgeMarkedEvent {
    pub promo: Pubkey,
    pub purchase: Pubkey,
    pub relayer: Pubkey,
    pub marked_at: i64,
}

/// Emitted by `cancel_unhedged` (relayer) AND by `cancel_expired_deposit` (customer, after the
/// timeout). The payload is identical; only the transaction signer differs.
#[event]
pub struct PurchaseCancelledEvent {
    pub promo: Pubkey,
    pub purchase: Pubkey,
    pub customer: Pubkey,
    pub amount: u64,
    pub cancelled_at: i64,
}

/// Emitted by `resolve_promo`.
#[event]
pub struct ResolutionEvent {
    pub promo: Pubkey,
    pub outcome: Outcome,
    pub relayer: Pubkey,
    pub resolved_at: i64,
}

/// Emitted by `claim_refund` (CancelRefund | YesRefund) and `claim_merchant` (MerchantPayout).
#[event]
pub struct ClaimEvent {
    pub promo: Pubkey,
    pub purchase: Pubkey,
    /// Owner of the destination token account (customer or merchant).
    pub recipient: Pubkey,
    pub amount: u64,
    pub kind: ClaimKind,
    pub claimed_at: i64,
}
