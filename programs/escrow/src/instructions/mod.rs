//! One module per instruction (docs/interfaces.md §2). Implemented: initialize_config,
//! set_paused, set_relayer, initialize_promo, deposit, mark_hedged, cancel_unhedged,
//! resolve_promo. TODO(Dev 2): claim_refund, claim_merchant.
//!
//! Each `Accounts` struct carries its logic as an `impl` method so modules don't collide on a
//! shared `handler` name when glob re-exported.
pub mod cancel_unhedged;
pub mod deposit;
pub mod initialize_config;
pub mod initialize_promo;
pub mod mark_hedged;
pub mod resolve_promo;
pub mod set_paused;
pub mod set_relayer;

pub use cancel_unhedged::*;
pub use deposit::*;
pub use initialize_config::*;
pub use initialize_promo::*;
pub use mark_hedged::*;
pub use resolve_promo::*;
pub use set_paused::*;
pub use set_relayer::*;
