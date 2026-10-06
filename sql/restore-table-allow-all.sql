-- ════════════════════════════════════════════════════════════════════════
-- ให้ปุ่มกู้คืนข้อมูลกู้ได้ครบทุกตารางที่สำรองไว้ (6 ต.ค. 69)
--
-- ปัญหา: ไฟล์สำรองมี 4 ตารางนี้ครบ แต่ฟังก์ชัน restore_table ในฐานไม่ยอมรับ ("not allowed")
--   stock_movements   ประวัติการขยับสต๊อกทุกครั้ง
--   sliptrack_opening ยอดยกมางวดแรกที่ส่งเข้าบัญชี (จับครั้งเดียว หายแล้วสร้างใหม่ไม่ได้)
--   asset_transfers   ใบโอนย้ายสินทรัพย์ระหว่างสาขา
--   order_edits       ร่องรอยการแก้บิลที่จ่ายแล้ว
--
-- วิธีใช้: Supabase → SQL Editor → วางทั้งไฟล์นี้ → Run (รันซ้ำได้ ไม่แตะข้อมูลใดๆ แค่เปลี่ยนรายชื่อที่ยอมรับ)
-- ตัวฟังก์ชันข้างล่างคัดมาจาก sql/backup-setup.sql ตรงตัวทุกบรรทัด — แก้ที่หนึ่งต้องแก้อีกที่ด้วย (มีด่านตรวจ)
-- ════════════════════════════════════════════════════════════════════════
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
    'crm_broadcasts','crm_events','crm_line_users','order_items','promotions','push_subscriptions',
    -- เพิ่ม 6 ต.ค. 69: สำรองอยู่แล้วแต่เคยกู้คืนไม่ได้ (restore_table ตอบ "not allowed")
    'stock_movements','sliptrack_opening','asset_transfers','order_edits'];
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

-- ตรวจหลังรัน (ไม่เขียนอะไร เพราะทุกตารางมีข้อมูลอยู่แล้ว โหมด insert จะข้ามตารางที่ไม่ว่าง):
-- select public.restore_table('order_edits', '[]'::jsonb, 'insert');   -- ต้องได้ {"skipped": true, "reason": "nonempty", ...}
