//! Account schemas and PDA seeds. Spec: docs/interfaces.md ("Escrow architecture") — keep in sync.
//!
//! Architecture: ONE token vault per promotion (ATA of the Promo PDA), pooled deposits, and ONE
//! Purchase PDA per deposit holding that purchase's exact liability. All token amounts are u64
//! base units of the mock USD mint (6 decimals: 5 tokens = 5_000_000). Arithmetic is checked.
use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const PROMO_SEED: &[u8] = b"promo";
pub const PURCHASE_SEED: &[u8] = b"purchase";
pub const MAX_MARKET_ID_LEN: usize = 64;
pub const PURCHASE_ID_LEN: usize = 16;

/// Global singleton. PDA: ["config"]. Holds the single MVP relayer, the admin and the pause flag.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// The one authorized relayer: mark_hedged, cancel_unhedged, resolve_promo.
    pub relayer: Pubkey,
    /// The only accepted mint (mock USD, 6 decimals).
    pub mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

/// PDA: ["promo", merchant, promo_nonce.to_le_bytes()]. Also the authority of the vault ATA.
#[account]
#[derive(InitSpace)]
pub struct Promo {
    pub merchant: Pubkey,
    pub mint: Pubkey,
    /// ATA(promo PDA, mint). Stored for cheap verification; always re-derivable.
    pub vault: Pubkey,
    pub promo_nonce: u64,
    /// Exact amount every deposit must equal (demo: 5_000_000).
    pub offer_amount: u64,
    /// Unix seconds; deposits rejected at/after this.
    pub deposit_deadline: i64,
    /// Exact Gemini market identifier (used for quotes AND final settlement).
    #[max_len(MAX_MARKET_ID_LEN)]
    pub market_id: String,
    pub state: PromoState,
    /// 0 until resolved.
    pub resolved_at: i64,
    // ---- accounting (token base units) ----
    pub total_deposited: u64,
    /// Sum of all vault payouts (refunds + merchant payouts).
    pub total_paid_out: u64,
    pub purchase_count: u64,
    pub bump: u8,
}

impl Promo {
    /// Outstanding liability = deposits not yet paid out. Invariant: vault.amount >= outstanding
    /// (equality unless someone donates tokens to the vault).
    pub fn outstanding(&self) -> Option<u64> {
        self.total_deposited.checked_sub(self.total_paid_out)
    }
}

/// PDA: ["purchase", promo, customer, purchase_id (16 bytes)]. One per deposit.
#[account]
#[derive(InitSpace)]
pub struct Purchase {
    pub promo: Pubkey,
    pub customer: Pubkey,
    /// Client-generated unique id (UUIDv4 bytes). Allows many purchases per customer.
    pub purchase_id: [u8; PURCHASE_ID_LEN],
    /// This purchase's liability inside the shared vault (== promo.offer_amount at deposit).
    pub amount: u64,
    pub state: PurchaseState,
    pub deposited_at: i64,
    /// 0 if never set.
    pub hedged_at: i64,
    pub cancelled_at: i64,
    pub settled_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum PromoState {
    Active,
    ResolvedYes,
    ResolvedNo,
}

/// Purchase escrow lifecycle. Terminal states: Refunded, ClaimedByCustomer, ClaimedByMerchant.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum PurchaseState {
    Deposited,
    Hedged,
    /// cancel_unhedged done; customer is entitled to claim_refund.
    Cancelled,
    /// Cancelled purchase paid back to the customer.
    Refunded,
    /// Hedged purchase paid to the customer after YES.
    ClaimedByCustomer,
    /// Hedged purchase paid to the merchant after NO.
    ClaimedByMerchant,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Outcome {
    Yes,
    No,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ClaimKind {
    CancelRefund,
    YesRefund,
    MerchantPayout,
}
