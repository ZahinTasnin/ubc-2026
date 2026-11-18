-- Smoke test for supabase/migrations/20261117000000_init.sql.
-- Run in the Supabase SQL editor AFTER applying the migration. Everything happens inside one
-- transaction that is rolled back at the end, so it leaves no data behind.
-- Expected output: a single row "smoke test passed". Any failed check raises an exception.

begin;

do $$
declare
  v_promo   uuid;
  v_purch   uuid;
  v_purch2  uuid;
  v_hedge   simulated_hedges%rowtype;
  v_again   simulated_hedges%rowtype;
  v_row     purchases%rowtype;
  v_n       int;
begin
  insert into promotions (status, promo_pda, promo_nonce, merchant, mint, item_name, shop_name,
                          offer_amount, deposit_deadline, gemini_market_id, outcome_label,
                          max_yes_price_micro_usd, hedge_budget)
  values ('ACTIVE', 'PROMO_PDA_TEST', 1, 'MERCHANT_TEST', 'MINT_TEST', 'Latte', 'Bean There',
          5000000, 1795379400, 'GEMI-TEST-EVT-TEX', 'Texas wins', 500000, 2000000)
  returning id into v_promo;

  insert into purchases (promotion_id, purchase_pda, purchase_id_hex, customer, amount,
                         deposit_tx_signature, deposit_event_index, deposited_at)
  values (v_promo, 'PURCHASE_1', repeat('a', 32), 'CUSTOMER_1', 5000000, 'SIG_1', 0, 1795370000)
  returning id into v_purch;
  insert into purchases (promotion_id, purchase_pda, purchase_id_hex, customer, amount,
                         deposit_tx_signature, deposit_event_index, deposited_at)
  values (v_promo, 'PURCHASE_2', repeat('b', 32), 'CUSTOMER_2', 5000000, 'SIG_2', 0, 1795370001)
  returning id into v_purch2;

  -- duplicate deposit event is rejected by the unique (signature, event_index)
  begin
    insert into purchases (promotion_id, purchase_pda, purchase_id_hex, customer, amount,
                           deposit_tx_signature, deposit_event_index, deposited_at)
    values (v_promo, 'PURCHASE_DUP', repeat('c', 32), 'C', 5000000, 'SIG_1', 0, 1);
    raise exception 'duplicate deposit event was accepted';
  exception when unique_violation then null;
  end;

  -- CAS transition: only from the expected status; patch fields applied
  select * into v_row from transition_purchase('PURCHASE_1', array['DEPOSITED'], 'PENDING_HEDGE');
  if v_row.status <> 'PENDING_HEDGE' or v_row.attempts <> 1 then
    raise exception 'lease failed: % %', v_row.status, v_row.attempts;
  end if;
  select count(*) into v_n from transition_purchase('PURCHASE_1', array['DEPOSITED'], 'PENDING_HEDGE');
  if v_n <> 0 then raise exception 'second lease should not win'; end if;

  -- reserve: $1.70 premium fits the $2.00 budget
  select * into v_hedge from reserve_simulated_hedge(jsonb_build_object(
    'purchase_id', v_purch, 'promotion_id', v_promo, 'market_id', 'GEMI-TEST-EVT-TEX',
    'status', 'SIMULATED_FILLED', 'requested_contracts', '5', 'filled_contracts', '5',
    'avg_fill_price_micro_usd', 340000, 'premium', 1700000, 'modeled_fee', 0,
    'assumptions', '["Simulated only"]'::jsonb, 'quote_fetched_at', now()));
  if v_hedge.reserved_premium <> 1700000 then raise exception 'reservation not recorded'; end if;

  -- reserve again for the same purchase: same hedge back, nothing reserved twice
  select * into v_again from reserve_simulated_hedge(jsonb_build_object(
    'purchase_id', v_purch, 'promotion_id', v_promo, 'market_id', 'GEMI-TEST-EVT-TEX',
    'status', 'SIMULATED_FILLED', 'requested_contracts', '5', 'filled_contracts', '5',
    'premium', 1700000));
  if v_again.id <> v_hedge.id then raise exception 'second hedge created'; end if;
  if (select reserved_premium from promotions where id = v_promo) <> 1700000 then
    raise exception 'budget reserved twice';
  end if;

  -- second purchase does not fit the remaining $0.30
  begin
    perform reserve_simulated_hedge(jsonb_build_object(
      'purchase_id', v_purch2, 'promotion_id', v_promo, 'market_id', 'GEMI-TEST-EVT-TEX',
      'status', 'SIMULATED_FILLED', 'requested_contracts', '5', 'filled_contracts', '5',
      'premium', 1700000));
    raise exception 'budget overrun was accepted';
  exception when raise_exception then
    if sqlerrm <> 'BUDGET_EXCEEDED' then raise; end if;
  end;

  -- void releases the reservation; voiding twice is a no-op
  perform void_simulated_hedge(v_hedge.id, 'MARK_HEDGED_FAILED');
  perform void_simulated_hedge(v_hedge.id, 'MARK_HEDGED_FAILED');
  if (select reserved_premium from promotions where id = v_promo) <> 0 then
    raise exception 'reservation not released';
  end if;
  if (select status from simulated_hedges where id = v_hedge.id) <> 'VOIDED' then
    raise exception 'hedge not voided';
  end if;

  -- patch fields on transition; last_error cleared when absent
  select * into v_row from transition_purchase('PURCHASE_1', array['PENDING_HEDGE'], 'CANCELLED',
    jsonb_build_object('on_chain_state', 'Cancelled', 'cancel_tx_signature', 'SIG_CANCEL',
                       'last_error', 'QUOTE_OVER_CAP'));
  if v_row.on_chain_state <> 'Cancelled' or v_row.cancel_tx_signature <> 'SIG_CANCEL'
     or v_row.last_error <> 'QUOTE_OVER_CAP' then
    raise exception 'patch not applied';
  end if;

  -- simulated flag cannot be turned off
  begin
    update simulated_hedges set simulated = false where id = v_hedge.id;
    raise exception 'simulated=false was accepted';
  exception when check_violation then null;
  end;
end $$;

select 'smoke test passed' as result;
rollback;
