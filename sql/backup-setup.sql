-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — auto-backup setup. Run ONCE in the Supabase SQL editor.
-- Creates the backup audit table + the completeness/drift oracle RPC.
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Audit table — one row per backup run (api/backup.js writes it).
create table if not exists public.backups (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',   -- running | success | failed | degraded
  trigger        text not null default 'cron',       -- cron | manual
  file_name      text,
  drive_id       text,
  gz_size_bytes  bigint,
  raw_size_bytes bigint,
  total_rows     bigint,
  table_count    int,
  complete       boolean,
  verified       boolean not null default false,
  tables         jsonb,          -- { "stock_logs": {"count":12026,"fetched":12026,"complete":true,"error":null}, ... }
  missing_tables jsonb,          -- DB tables not in our backup list (drift → run fails)
  extra_tables   jsonb,          -- list tables missing from DB (renamed/dropped → run fails)
  rotation       jsonb,          -- { "deleted":[...], "kept":26, "error":null }
  error          text,
  duration_ms    int
);
create index if not exists backups_started_idx on public.backups (started_at desc);
alter table public.backups disable row level security;   -- match the rest of the schema (RLS off)

-- 2) Completeness + drift oracle. SECURITY DEFINER so it bypasses RLS and returns EVERY
--    public table plus its EXACT row count — callable with the publishable key. The backup
--    uses these counts to (a) verify it fetched every row and (b) detect a newly-added table
--    that isn't in its list yet (missing_tables → the run is marked failed).
create or replace function public.backup_manifest()
returns table(table_name text, row_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    table_name := r.relname;
    execute format('select count(*) from public.%I', r.relname) into row_count;
    return next;
  end loop;
end
$$;
revoke all on function public.backup_manifest() from public;
grant execute on function public.backup_manifest() to anon, authenticated;

-- 3) RESTORE oracle. Restoring is impossible through PostgREST alone: several business
--    tables (branches, ingredients, menus, app_users, suppliers, order_requests, ...) use
--    `id GENERATED ALWAYS AS IDENTITY`, and PostgREST cannot send OVERRIDING SYSTEM VALUE —
--    so the original ids (which every foreign key depends on) cannot be preserved. This
--    SECURITY DEFINER RPC restores ONE table's rows server-side, preserving ids, in a SINGLE
--    transaction (all-or-nothing — a failure rolls back, a table is never left half-filled).
--    Whitelisted to the known tables; `backups` is intentionally NOT restorable (audit only).
--    p_mode: 'insert'  = empty-only (writes only if the table is currently empty)
--            'append'  = insert missing rows, keep existing (ON CONFLICT DO NOTHING)
--            'replace' = delete all rows, then insert (DESTRUCTIVE; local break-glass only)
create or replace function public.restore_table(p_table text, p_rows jsonb, p_mode text default 'insert')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'branches','app_users','suppliers','categories','expense_categories','ingredients','menus',
    'assets','table_zones','tables','printers','pos_settings','pos_shifts','cash_movements',
    'purchase_orders','purchase_requisitions','order_requests','orders','external_sales',
    'stock_count_sessions','stock_logs','waste_logs','approval_log','action_history',
    'cost_history','cost_snapshots','crm_customers','crm_transactions','crm_vouchers',
    'crm_reservations','crm_booking_requests','crm_feedback','crm_point_claims','crm_promotions',
    'crm_broadcasts','crm_events','promotions','push_subscriptions'];
  n_before bigint; n_after bigint; has_gen_always boolean; ov text; conflict text := '';
  colname text; seqname text;
begin
  if not (p_table = any(allowed)) then raise exception 'restore_table: % not allowed', p_table; end if;
  if p_mode not in ('insert','append','replace') then raise exception 'restore_table: bad mode %', p_mode; end if;
  execute format('select count(*) from public.%I', p_table) into n_before;
  if p_mode = 'insert' and n_before > 0 then
    return jsonb_build_object('skipped', true, 'reason', 'nonempty', 'live', n_before, 'inserted', 0);
  end if;
  if p_mode = 'replace' then execute format('delete from public.%I', p_table); n_before := 0; end if;
  -- Only tables with a GENERATED ALWAYS identity accept (indeed require) OVERRIDING SYSTEM VALUE.
  select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name=p_table and is_identity='YES' and identity_generation='ALWAYS')
    into has_gen_always;
  ov := case when has_gen_always then ' overriding system value ' else ' ' end;
  if p_mode = 'append' then conflict := ' on conflict do nothing '; end if;
  execute format('insert into public.%1$I %2$s select * from jsonb_populate_recordset(null::public.%1$I, $1) %3$s',
                 p_table, ov, conflict) using p_rows;
  execute format('select count(*) from public.%I', p_table) into n_after;
  -- CRITICAL: we inserted ORIGINAL ids explicitly (OVERRIDING SYSTEM VALUE / plain), which does NOT
  -- advance the owning sequence. Without this resync the next natural INSERT (new order, stock_log,
  -- ...) would call nextval()=1 and collide with a restored id → the app can't write after recovery.
  -- Covers GENERATED ALWAYS, BY DEFAULT identity, and serial; pos_settings (no sequence) is skipped.
  for colname in select column_name from information_schema.columns
                 where table_schema = 'public' and table_name = p_table loop
    seqname := pg_get_serial_sequence(format('public.%I', p_table), colname);
    if seqname is not null then
      execute format('select setval(%L, coalesce((select max(%I) from public.%I),1), (select count(*) > 0 from public.%I))',
                     seqname, colname, p_table, p_table);
    end if;
  end loop;
  return jsonb_build_object('inserted', n_after - n_before, 'live', n_after, 'skipped', false);
end;
$$;
revoke all on function public.restore_table(text, jsonb, text) from public;
grant execute on function public.restore_table(text, jsonb, text) to anon, authenticated;

-- Owner sanity check anytime:
-- select started_at, status, verified, total_rows, gz_size_bytes,
--        jsonb_array_length(coalesce(missing_tables,'[]'::jsonb)) as missing_tables
-- from public.backups order by started_at desc limit 30;
