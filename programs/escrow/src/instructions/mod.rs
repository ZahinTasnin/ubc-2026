//! One module per instruction (docs/interfaces.md §2). Implemented: initialize_config,
//! set_paused, set_relayer, initialize_promo, deposit, mark_hedged, cancel_unhedged,
//! resolve_promo, claim_refund, claim_merchant. `payout` is the shared PDA-signed transfer helper.
//!
//! Each `Accounts` struct carries its logic as an `impl` method so modules don't collide on a
//! shared `handler` name when glob re-exported.
pub mod cancel_unhedged;
pub mod claim_merchant;
pub mod claim_refund;
pub mod deposit;
pub mod initialize_config;
pub mod initialize_promo;
pub mod mark_hedged;
pub mod payout;
pub mod resolve_promo;
pub mod set_paused;
pub mod set_relayer;

pub use cancel_unhedged::*;
pub use claim_merchant::*;
pub use claim_refund::*;
pub use deposit::*;
pub use initialize_config::*;
pub use initialize_promo::*;
pub use mark_hedged::*;
pub use resolve_promo::*;
pub use set_paused::*;
pub use set_relayer::*;
