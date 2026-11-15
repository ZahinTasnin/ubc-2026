# supabase/migrations (Dev 3)

PostgreSQL migrations. Suggested tables (CLAUDE.md §9): `promotions`, `purchases`,
`simulated_hedges`, `market_quotes`, `market_outcomes`, processing checkpoints. Store Solana keys
as text, money as integer base units (numeric/bigint), unique constraint on deposit event id
`(tx_signature, event_index)`. No migrations yet.
