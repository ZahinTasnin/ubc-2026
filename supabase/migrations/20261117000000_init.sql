-- Hedged Refund Promotions: off-chain orchestration schema (Dev 4).
--
-- The on-chain Promo/Purchase accounts are authoritative for funds; these tables are the derived
-- operational record (CLAUDE.md §9). All money is integer base units (6 decimals, = micro-USD);
-- prices are micro-USD per $1-payout contract. Every hedge here is SIMULATED (simulated = true).
--
-- Access: RLS is enabled with NO policies, so only the server-side service role can read/write.
-- The browser never talks to Supabase directly; it goes through apps/api.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------
-- promotions
-- ---------------------------------------------------------------------------------------------
create table promotions (
  id                        uuid primary key default gen_random_uuid(),
  -- on-chain (mirrors Promo account; promo_pda null until initialize_promo is confirmed)
  promo_pda                 text unique,
  promo_nonce               numeric(20, 0) not null check (promo_nonce >= 0),
  merchant                  text not null,
  mint                      text not null,
  offer_amount              bigint not null check (offer_amount > 0),
  deposit_deadline          bigint not null,          -- unix seconds
  cancel_timeout_secs       bigint,                   -- snapshot read from chain
  on_chain_state            text not null default 'Active'
                              check (on_chain_state in ('Active', 'ResolvedYes', 'ResolvedNo')),
  -- off-chain merchant config
  gemini_market_id          text not null check (char_length(gemini_market_id) between 1 and 64),
  outcome_label             text not null,
  max_yes_price_micro_usd   bigint not null check (max_yes_price_micro_usd between 1 and 1000000),
  hedge_budget              bigint not null check (hedge_budget >= 0),
  -- simulated premium currently reserved by live hedges; never exceeds the budget
  reserved_premium          bigint not null default 0
                              check (reserved_premium >= 0 and reserved_premium <= hedge_budget),
  resolved_outcome          text check (resolved_outcome in ('YES', 'NO')),
  resolve_tx_signature      text,
  resolved_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (merchant, promo_nonce)
);

-- ---------------------------------------------------------------------------------------------
-- purchases
-- ---------------------------------------------------------------------------------------------
create table purchases (
  id                        uuid primary key default gen_random_uuid(),
  promotion_id              uuid not null references promotions (id),
  -- on-chain facts (from the verified DepositEvent)
  purchase_pda              text not null unique,     -- hedge idempotency key (CLAUDE.md §5.1)
  purchase_id_hex           text not null check (purchase_id_hex ~ '^[0-9a-f]{32}$'),
  customer                  text not null,
  amount                    bigint not null check (amount > 0),
  deposit_tx_signature      text not null,
  deposit_event_index       integer not null check (deposit_event_index >= 0),
  deposited_at              bigint not null,          -- unix seconds (on-chain clock)
  on_chain_state            text not null default 'Deposited'
                              check (on_chain_state in ('Deposited', 'Hedged', 'Cancelled', 'Refunded',
                                                        'ClaimedByCustomer', 'ClaimedByMerchant')),
  -- off-chain orchestration
  status                    text not null default 'DEPOSITED'
                              check (status in ('DEPOSITED', 'PENDING_HEDGE', 'HEDGE_SIMULATED', 'HEDGED',
                                                'HEDGE_FAILED', 'CANCEL_PENDING', 'CANCELLED',
                                                'REFUNDED', 'RESOLVED', 'CLAIMED')),
  attempts                  integer not null default 0,
  last_error                text,
  -- set when automation must stop and an operator has to look (e.g. orphaned hedge)
  needs_reconciliation      boolean not null default false,
  mark_hedged_tx_signature  text,
  cancel_tx_signature       text,
  claim_tx_signature        text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (deposit_tx_signature, deposit_event_index)
);
create index purchases_promotion_status_idx on purchases (promotion_id, status);

-- ---------------------------------------------------------------------------------------------
-- market_quotes: every live Gemini quote a hedge decision was based on (audit trail)
-- ---------------------------------------------------------------------------------------------
create table market_quotes (
  id                        bigserial primary key,
  source                    text not null default 'gemini-predictions'
                              check (source = 'gemini-predictions'),
  market_id                 text not null,
  fetched_at                timestamptz not null,
  yes_ask_micro_usd         bigint not null check (yes_ask_micro_usd between 1 and 1000000),
  asks                      jsonb not null,           -- [{priceMicroUsd, quantity}], best first
  created_at                timestamptz not null default now()
);
create index market_quotes_market_idx on market_quotes (market_id, fetched_at desc);

-- ---------------------------------------------------------------------------------------------
-- simulated_hedges: at most ONE per purchase (unique purchase_id)
-- ---------------------------------------------------------------------------------------------
create table simulated_hedges (
  id                        uuid primary key default gen_random_uuid(),
  purchase_id               uuid not null unique references purchases (id),
  promotion_id              uuid not null references promotions (id),
  simulated                 boolean not null default true check (simulated),
  market_id                 text not null,
  quote_id                  bigint references market_quotes (id),
  status                    text not null
                              check (status in ('PENDING', 'SIMULATED_FILLED', 'SIMULATED_PARTIAL', 'FAILED',
                                                'VOIDED', 'SETTLED_WIN', 'SETTLED_LOSS')),
  failure_reason            text check (failure_reason in ('QUOTE_OVER_CAP', 'QUOTE_STALE',
                                                'QUOTE_UNAVAILABLE', 'INSUFFICIENT_LIQUIDITY',
                                                'PARTIAL_FILL', 'BUDGET_EXCEEDED',
                                                'MARK_HEDGED_FAILED')),
  requested_contracts       numeric(20, 2) not null check (requested_contracts > 0),
  filled_contracts          numeric(20, 2) not null default 0 check (filled_contracts >= 0),
  avg_fill_price_micro_usd  bigint,
  premium                   bigint check (premium >= 0),
  modeled_fee               bigint not null default 0,
  -- portion of promotions.reserved_premium held by this hedge (released when VOIDED)
  reserved_premium          bigint not null default 0 check (reserved_premium >= 0),
  virtual_payout            bigint,
  assumptions               jsonb not null default '[]'::jsonb,
  quote_fetched_at          timestamptz,
  settled_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- market_outcomes: OFFICIAL settlement only (or a clearly labeled demo fixture)
-- ---------------------------------------------------------------------------------------------
create table market_outcomes (
  market_id                 text primary key,
  outcome                   text not null check (outcome in ('YES', 'NO')),
  source                    text not null
                              check (source in ('gemini-official-settlement', 'manual-demo-fixture')),
  resolved_at               timestamptz not null,
  fetched_at                timestamptz not null
);

-- ---------------------------------------------------------------------------------------------
-- chain_events: dedupe of every verified program event by (signature, event_index)
-- ---------------------------------------------------------------------------------------------
create table chain_events (
  event_id                  text primary key,         -- `${signature}:${eventIndex}`
  signature                 text not null,
  event_index               integer not null,
  name                      text not null,
  slot                      bigint not null,
  payload                   jsonb not null,
  processed_at              timestamptz not null default now(),
  unique (signature, event_index)
);

-- ---------------------------------------------------------------------------------------------
-- checkpoints: last acked slot per subscription, for replay after restart
-- ---------------------------------------------------------------------------------------------
create table checkpoints (
  name                      text primary key,         -- e.g. 'deposits', 'resolutions', 'claims'
  slot                      bigint not null,
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- RLS: deny everything except the service role (which bypasses RLS).
-- ---------------------------------------------------------------------------------------------
alter table promotions       enable row level security;
alter table purchases        enable row level security;
alter table market_quotes    enable row level security;
alter table simulated_hedges enable row level security;
alter table market_outcomes  enable row level security;
alter table chain_events     enable row level security;
alter table checkpoints      enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Atomic helpers (called via supabase.rpc from apps/api)
-- ---------------------------------------------------------------------------------------------

-- Compare-and-set a purchase's status. Returns the updated row, or nothing if the current status
-- was not in p_from (another worker got there first).
create function transition_purchase(
  p_purchase_pda text, p_from text[], p_to text, p_last_error text default null
) returns setof purchases
language sql as $$
  update purchases
     set status = p_to,
         last_error = p_last_error,
         attempts = case when p_to = 'PENDING_HEDGE' then attempts + 1 else attempts end,
         updated_at = now()
   where purchase_pda = p_purchase_pda and status = any (p_from)
  returning *;
$$;

-- Insert the ONE simulated hedge for a purchase and reserve its premium against the promotion
-- budget in the same transaction. Idempotent: if the purchase already has a hedge, returns it
-- unchanged and reserves nothing. Raises 'BUDGET_EXCEEDED' if the premium does not fit.
create function reserve_simulated_hedge(p_hedge jsonb) returns setof simulated_hedges
language plpgsql as $$
declare
  v_purchase_id uuid := (p_hedge ->> 'purchase_id')::uuid;
  v_promotion   promotions%rowtype;
  v_reserve     bigint := case when p_hedge ->> 'status' in ('SIMULATED_FILLED', 'SIMULATED_PARTIAL')
                               then coalesce((p_hedge ->> 'premium')::bigint, 0) else 0 end;
begin
  if exists (select 1 from simulated_hedges where purchase_id = v_purchase_id) then
    return query select * from simulated_hedges where purchase_id = v_purchase_id;
    return;
  end if;

  select * into v_promotion from promotions
   where id = (p_hedge ->> 'promotion_id')::uuid for update;
  if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
  if v_promotion.reserved_premium + v_reserve > v_promotion.hedge_budget then
    raise exception 'BUDGET_EXCEEDED';
  end if;

  update promotions set reserved_premium = reserved_premium + v_reserve, updated_at = now()
   where id = v_promotion.id;

  return query
  insert into simulated_hedges (
    purchase_id, promotion_id, market_id, quote_id, status, failure_reason, requested_contracts,
    filled_contracts, avg_fill_price_micro_usd, premium, modeled_fee, reserved_premium,
    assumptions, quote_fetched_at
  ) values (
    v_purchase_id, v_promotion.id, p_hedge ->> 'market_id', (p_hedge ->> 'quote_id')::bigint,
    p_hedge ->> 'status', p_hedge ->> 'failure_reason', (p_hedge ->> 'requested_contracts')::numeric,
    (p_hedge ->> 'filled_contracts')::numeric, (p_hedge ->> 'avg_fill_price_micro_usd')::bigint,
    (p_hedge ->> 'premium')::bigint, coalesce((p_hedge ->> 'modeled_fee')::bigint, 0), v_reserve,
    coalesce(p_hedge -> 'assumptions', '[]'::jsonb), (p_hedge ->> 'quote_fetched_at')::timestamptz
  )
  on conflict (purchase_id) do nothing
  returning *;
end;
$$;

-- Void a simulated hedge (purchase cancelled / mark_hedged abandoned) and release its reserved
-- premium back to the promotion budget. Idempotent.
create function void_simulated_hedge(p_hedge_id uuid, p_failure_reason text)
returns setof simulated_hedges
language plpgsql as $$
declare v_hedge simulated_hedges%rowtype;
begin
  select * into v_hedge from simulated_hedges where id = p_hedge_id for update;
  if not found then raise exception 'HEDGE_NOT_FOUND'; end if;
  if v_hedge.status in ('VOIDED', 'FAILED', 'SETTLED_WIN', 'SETTLED_LOSS') then
    return query select * from simulated_hedges where id = p_hedge_id;
    return;
  end if;
  update promotions set reserved_premium = reserved_premium - v_hedge.reserved_premium,
                        updated_at = now()
   where id = v_hedge.promotion_id;
  return query
  update simulated_hedges
     set status = 'VOIDED', failure_reason = coalesce(p_failure_reason, failure_reason),
         reserved_premium = 0, updated_at = now()
   where id = p_hedge_id
  returning *;
end;
$$;

-- Only the service role may call these.
revoke all on function transition_purchase(text, text[], text, text) from public, anon, authenticated;
revoke all on function reserve_simulated_hedge(jsonb) from public, anon, authenticated;
revoke all on function void_simulated_hedge(uuid, text) from public, anon, authenticated;
