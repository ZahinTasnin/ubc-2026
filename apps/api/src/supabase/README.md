# supabase/ (Dev 4)

The Supabase-backed store lives in `../store/supabase-store.ts` (server-only, service-role key).
`index.ts` uses it when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise the
in-memory store (not durable). Schema: `/supabase/migrations`.

`pnpm --filter @hedged/api test:db` runs the shared store contract tests against the database in
`../../.env` (rows are tagged with a random run id and deleted afterwards).
