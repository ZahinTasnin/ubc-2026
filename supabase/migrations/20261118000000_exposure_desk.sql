-- Exposure desk (Dev 4): SIMULATED platform-level trades that hedge the NET exposure of all shops
-- per Gemini event (apps/api/src/desk). No Gemini order is ever placed; `simulated` is forced true.

create table desk_fills (
  id                        uuid primary key default gen_random_uuid(),
  simulated                 boolean not null default true check (simulated),
  event_ticker              text not null,
  market_id                 text not null,
  side                      text not null check (side in ('BUY', 'SELL')),
  contracts                 numeric(20, 2) not null check (contracts > 0),
  amount                    bigint not null check (amount >= 0),
  avg_price_micro_usd       bigint not null check (avg_price_micro_usd between 0 and 1000000),
  quote_fetched_at          timestamptz not null,
  created_at                timestamptz not null default now()
);
create index desk_fills_event_idx on desk_fills (event_ticker, created_at);

alter table desk_fills enable row level security;
grant select, insert, update, delete on desk_fills to service_role;
