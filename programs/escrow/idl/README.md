# programs/escrow/idl (Dev 2)

Committed export of the Anchor IDL (`escrow.json`) and generated types (`escrow.ts`), copied from
`target/idl` and `target/types` after `anchor build`. Dev 3 (`packages/solana`) consumes these;
Dev 1 and Dev 4 go through `packages/solana`, not the IDL directly. Re-export and notify the team on
every instruction, account, event or PDA-seed change. Not generated yet.
