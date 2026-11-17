# programs/escrow/idl (Dev 2)

Committed export of the Anchor IDL (`escrow.json`) and generated types (`escrow.ts`), copied from
`target/idl` and `target/types` after `anchor build`. Dev 3 (`packages/solana`) consumes these;
Dev 1 and Dev 4 go through `packages/solana`, not the IDL directly. Re-export and notify the team on
every instruction, account, event or PDA-seed change. Exported after `anchor build`; currently covers initialize_config, set_paused, set_relayer, initialize_promo, deposit, mark_hedged, cancel_unhedged, resolve_promo (claims still TODO).
