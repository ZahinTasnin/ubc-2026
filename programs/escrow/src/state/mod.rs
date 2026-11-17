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
/// Bounds for the customer-recovery timeout (seconds). Max 30 days so a misconfiguration can
/// neither make recovery instant-and-meaningless nor push it out of reach.
pub const MIN_CANCEL_TIMEOUT_SECS: i64 = 1;
pub const MAX_CANCEL_TIMEOUT_SECS: i64 = 30 * 24 * 60 * 60;

pub fn valid_cancel_timeout(secs: i64) -> bool {
    (MIN_CANCEL_TIMEOUT_SECS..=MAX_CANCEL_TIMEOUT_SECS).contains(&secs)
}

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
    /// Seconds after `Purchase.deposited_at` before the customer may cancel a still-`Deposited`
    /// purchase themselves (`cancel_expired_deposit`). Snapshotted into each new Promo.
    pub cancel_timeout_secs: i64,
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
    /// Snapshot of `Config.cancel_timeout_secs` at `initialize_promo`: a later admin change cannot
    /// shorten (or lengthen) the recovery term customers and the backend relied on for this promo.
    pub cancel_timeout_secs: i64,
}

impl Promo {
    /// Deposits are accepted strictly BEFORE the deadline (rejected at and after it).
    pub fn deposits_open(&self, now: i64) -> bool {
        now < self.deposit_deadline
    }

    /// Resolution is allowed from the deadline onward (rejected strictly before it). This is the
    /// exact complement of `deposits_open`: at every instant either deposits are open or the promo
    /// may be resolved, never both and never neither (no gap in which a deposit could race a
    /// resolution, and no window where a promo is stuck unresolvable).
    pub fn resolution_open(&self, now: i64) -> bool {
        now >= self.deposit_deadline
    }

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

impl Purchase {
    /// `Some(true)` once `now >= deposited_at + timeout_secs` (inclusive: allowed AT the boundary),
    /// `Some(false)` before it, `None` on arithmetic overflow (never silently wraps).
    pub fn cancel_timeout_elapsed(&self, timeout_secs: i64, now: i64) -> Option<bool> {
        self.deposited_at
            .checked_add(timeout_secs)
            .map(|release_at| now >= release_at)
    }
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
    /// Cancelled by the relayer (`cancel_unhedged`) or by the customer after the timeout
    /// (`cancel_expired_deposit`); the customer is entitled to `claim_refund`.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn promo(deadline: i64) -> Promo {
        Promo {
            merchant: Pubkey::default(),
            mint: Pubkey::default(),
            vault: Pubkey::default(),
            promo_nonce: 0,
            offer_amount: 5_000_000,
            deposit_deadline: deadline,
            market_id: String::new(),
            state: PromoState::Active,
            resolved_at: 0,
            total_deposited: 0,
            total_paid_out: 0,
            purchase_count: 0,
            bump: 255,
            cancel_timeout_secs: 600,
        }
    }

    fn purchase(deposited_at: i64) -> Purchase {
        Purchase {
            promo: Pubkey::default(),
            customer: Pubkey::default(),
            purchase_id: [0; PURCHASE_ID_LEN],
            amount: 5_000_000,
            state: PurchaseState::Deposited,
            deposited_at,
            hedged_at: 0,
            cancelled_at: 0,
            settled_at: 0,
            bump: 255,
        }
    }

    #[test]
    fn cancel_timeout_boundary_is_exact_and_inclusive() {
        let p = purchase(1_000);
        // immediately before / exactly at / after deposited_at + timeout
        assert_eq!(p.cancel_timeout_elapsed(600, 1_599), Some(false));
        assert_eq!(p.cancel_timeout_elapsed(600, 1_600), Some(true));
        assert_eq!(p.cancel_timeout_elapsed(600, 1_601), Some(true));
        // right at deposit time, never elapsed for a positive timeout
        assert_eq!(p.cancel_timeout_elapsed(600, 1_000), Some(false));
    }

    #[test]
    fn cancel_timeout_overflow_is_reported_not_wrapped() {
        let p = purchase(i64::MAX - 5);
        assert_eq!(p.cancel_timeout_elapsed(10, i64::MAX), None);
        assert_eq!(p.cancel_timeout_elapsed(5, i64::MAX), Some(true));
    }

    #[test]
    fn cancel_timeout_bounds() {
        assert!(!valid_cancel_timeout(0));
        assert!(!valid_cancel_timeout(-1));
        assert!(valid_cancel_timeout(MIN_CANCEL_TIMEOUT_SECS));
        assert!(valid_cancel_timeout(600));
        assert!(valid_cancel_timeout(MAX_CANCEL_TIMEOUT_SECS));
        assert!(!valid_cancel_timeout(MAX_CANCEL_TIMEOUT_SECS + 1));
        assert!(!valid_cancel_timeout(i64::MIN));
        assert!(!valid_cancel_timeout(i64::MAX));
    }

    #[test]
    fn deadline_boundary_is_exact() {
        let p = promo(1_000);
        // immediately before: deposits open, resolution closed
        assert!(p.deposits_open(999));
        assert!(!p.resolution_open(999));
        // exactly at the deadline: deposits closed, resolution open
        assert!(!p.deposits_open(1_000));
        assert!(p.resolution_open(1_000));
        // after
        assert!(!p.deposits_open(1_001));
        assert!(p.resolution_open(1_001));
    }

    #[test]
    fn deposits_and_resolution_never_overlap_or_leave_a_gap() {
        let p = promo(50);
        for now in -5..=120 {
            assert_ne!(p.deposits_open(now), p.resolution_open(now), "now={now}");
        }
        // extreme values
        for now in [i64::MIN, i64::MAX] {
            let p = promo(0);
            assert_ne!(p.deposits_open(now), p.resolution_open(now));
        }
    }
}
