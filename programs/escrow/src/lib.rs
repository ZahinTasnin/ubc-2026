//! Hedged refund promotions — escrow program skeleton (Dev 2).
//!
//! NO business logic yet. See CLAUDE.md §6 for the instruction/authority design:
//! initialize_promo, deposit, mark_hedged, cancel_unhedged, resolve_promo, claim_refund,
//! claim_merchant. Build the transition/authorization matrix BEFORE implementing.
use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

// Placeholder; replaced by `anchor keys sync` (keypair lives in target/deploy, gitignored).
declare_id!("E6tFGqHoSUpQmL3U5u8TmYHDJnjdHm8yKk4KifJUt4zr");

#[program]
pub mod escrow {
    // TODO(Dev 2): add instructions (one file each under src/instructions/).
}
