-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — correctness-audit fixes. Run ONCE in the Supabase SQL editor.
-- Adds atomic RPCs so loyalty points and stock-pending retries can't lose/double under
-- concurrency (mirrors the proven apply_branch_stock_delta pattern).
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Atomic loyalty-points increment. Points are a redeemable balance; the app used to read
--    points client-side and PATCH an absolute value, so two concurrent awards to the SAME
--    customer clobbered each other (an award silently lost). This makes the read-modify-write
--    a single atomic statement. Never goes below 0.
create or replace function public.apply_crm_points_delta(p_id bigint, p_delta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare new_pts int;
begin
  update public.crm_customers
     set points = greatest(0, coalesce(points, 0) + p_delta)
   where id = p_id
   returning points into new_pts;
  return new_pts;   -- null if no such customer
end;
$$;
revoke all on function public.apply_crm_points_delta(bigint, int) from public;
grant execute on function public.apply_crm_points_delta(bigint, int) to anon, authenticated;

-- 2+3) Atomically CLAIM a document's stock_pending (row-locked): return the current pending
--    and clear it in one transaction. The 🔁 retry button then re-applies exactly what it
--    claimed — so two devices clicking retry can't both apply the same stranded lines
--    (double-credit / minted stock). Returns null if there is nothing pending (already claimed).
create or replace function public.claim_po_pending(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare old_pending jsonb;
begin
  select stock_pending into old_pending from public.purchase_orders where id = p_id for update;
  if old_pending is null then return null; end if;
  update public.purchase_orders set stock_pending = null where id = p_id;
  return old_pending;
end;
$$;
revoke all on function public.claim_po_pending(bigint) from public;
grant execute on function public.claim_po_pending(bigint) to anon, authenticated;

create or replace function public.claim_order_pending(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare old_pending jsonb;
begin
  select stock_pending into old_pending from public.order_requests where id = p_id for update;
  if old_pending is null then return null; end if;
  update public.order_requests set stock_pending = null where id = p_id;
  return old_pending;
end;
$$;
revoke all on function public.claim_order_pending(bigint) from public;
grant execute on function public.claim_order_pending(bigint) to anon, authenticated;
