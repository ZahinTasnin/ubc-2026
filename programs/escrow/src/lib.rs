//! Hedged refund promotions — escrow program skeleton (Dev 2).
//!
//! Account schemas, events and errors are defined; NO instructions yet. Spec (PDA seeds, vault
//! model, authority/pause matrix, accounting): docs/interfaces.md §1–3, docs/workflow.md.
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
