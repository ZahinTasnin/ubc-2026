# orchestration/ (Dev 4)

Verified deposit -> simulated hedge; failure -> cancel_unhedged; finalized outcome -> resolve_promo.
Uses `@hedged/solana/server` (do not reimplement Anchor instructions). Idempotent, checkpointed,
reconciling.
