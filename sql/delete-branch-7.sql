-- ═══════════════════════════════════════════════════════════════════════════
-- ลบสาขา id 7 "คุณนายแจ่วฮ้อน"
--
-- ทำไมลบจากหน้าเว็บ/API ไม่ได้:
--   purchase_orders.branch_id มี foreign key → branches.id แบบ ON DELETE SET NULL
--   พอสั่งลบสาขา Postgres จะไปเซ็ต branch_id ของใบสั่งซื้อ 11 ใบเป็น null
--   แล้วไปชน trigger ที่ห้ามแก้ branch_id หลังสร้างใบ (P0001 "branch_id ของ PO
--   ไม่สามารถเปลี่ยนได้หลังสร้าง") → ทั้งรายการถูกยกเลิก ไม่มีอะไรถูกลบ
--
-- ⚠️ สิ่งที่จะเสียไปถ้าลบจริง (ตรวจจากข้อมูลจริงเมื่อ 8 ส.ค. 69):
--   · ใบสั่งซื้อ 11 ใบ ฿43,705 จะไม่รู้ว่าเป็นของสาขาไหนอีกต่อไป (branch_id = null)
--     ในนั้นมี 7 ใบสถานะ awaiting_payment รวม ฿30,068 ที่ยังค้างจ่าย
--   · สต๊อกที่บันทึกไว้ในสาขานี้ 82 รายการ มูลค่า ฿33,294 จะกลายเป็นข้อมูลกำพร้า
--     (ค่ายังอยู่ใน ingredients.stock_by_branch['7'] แต่ไม่มีสาขาให้อ้างอิงแล้ว)
--   · เมนู 92 รายการและวัตถุดิบ 105 รายการยังเก็บเลข 7 ไว้ใน visible_branches
--
-- ทางเลือกที่ไม่เสียอะไรเลย: เปลี่ยนชื่อแทน (ดูขั้นที่ 0 ข้างล่าง)
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ขั้นที่ 0 · ทางเลือกที่แนะนำ: ไม่ลบ แค่เปลี่ยนชื่อให้เลิกสับสน ────────────
-- พนักงานสับสนเพราะมีสาขาชื่อคล้ายกัน 2 แห่ง:
--   id 6 "คุณนายตื่นสาย/แจ่วฮ้อน"  ← ยังเปิด ใช้งานอยู่จริง
--   id 7 "คุณนายแจ่วฮ้อน"          ← ปิดแล้ว
-- เปลี่ยนชื่อ id 7 แล้วสับสนจบทันที โดยใบสั่งซื้อและประวัติทั้งหมดยังอ่านออกเหมือนเดิม
--
--   update public.branches set name = '(ปิดแล้ว) คุณนายแจ่วฮ้อน' where id = 7;
--
-- ถ้าเลือกทางนี้ หยุดแค่นี้ ไม่ต้องรันอะไรต่อ


-- ── ขั้นที่ 1 · ดูของจริงก่อนตัดสินใจ (อ่านอย่างเดียว ปลอดภัย) ────────────────
select 'ใบสั่งซื้อที่ผูกกับสาขา 7' as รายการ, count(*) as จำนวน,
       to_char(coalesce(sum(total),0),'FM999,999,999.00') as มูลค่า
from public.purchase_orders where branch_id = 7
union all
select 'ในนั้นที่ยังค้างจ่าย', count(*),
       to_char(coalesce(sum(total),0),'FM999,999,999.00')
from public.purchase_orders where branch_id = 7 and status = 'awaiting_payment';

-- ชื่อ constraint และ trigger ที่ขวางอยู่ (ต้องใช้ชื่อจริงในขั้นที่ 2)
select conname as ชื่อ_foreign_key, confdeltype as ตอนลบทำอะไร
from pg_constraint
where conrelid = 'public.purchase_orders'::regclass and contype = 'f'
  and confrelid = 'public.branches'::regclass;

select tgname as ชื่อ_trigger
from pg_trigger
where tgrelid = 'public.purchase_orders'::regclass and not tgisinternal;


-- ── ขั้นที่ 2 · ถ้ายืนยันจะลบจริง ───────────────────────────────────────────
-- รันทั้งบล็อกในครั้งเดียว มันอยู่ใน transaction เดียว ถ้าพังกลางทางจะย้อนกลับทั้งหมด
-- แก้ <ชื่อ_trigger> เป็นชื่อที่ได้จากขั้นที่ 1 ก่อนรัน

/*
begin;

  -- สำรองใบสั่งซื้อไว้ก่อน เผื่ออยากรู้ทีหลังว่าใบไหนเคยเป็นของสาขานี้
  create table if not exists public.purchase_orders_branch7_backup as
  select * from public.purchase_orders where branch_id = 7;

  -- ปิด trigger ที่ห้ามแก้ branch_id ชั่วคราว เพื่อให้ ON DELETE SET NULL ทำงานได้
  alter table public.purchase_orders disable trigger <ชื่อ_trigger>;

  delete from public.branches where id = 7;

  alter table public.purchase_orders enable trigger <ชื่อ_trigger>;

  -- ตรวจก่อน commit — ต้องได้ 0 สาขา และ 11 ใบที่ branch_id เป็น null
  select (select count(*) from public.branches where id = 7)              as สาขาที่เหลือ,
         (select count(*) from public.purchase_orders where branch_id is null) as ใบที่ไม่มีสาขาแล้ว,
         (select count(*) from public.purchase_orders_branch7_backup)      as ใบที่สำรองไว้;

commit;
*/


-- ── ขั้นที่ 3 · เก็บกวาดเลข 7 ที่ค้างอยู่ (ทำหรือไม่ทำก็ได้) ──────────────────
-- ไม่ทำก็ไม่มีอะไรเสีย: ทุกหน้าที่ให้เลือกสาขาวนจากตาราง branches ซึ่งจะไม่มี 7 แล้ว
-- และไม่มีโค้ดไหนรวมสต๊อกข้ามสาขา ค่าที่ค้างจึงไม่โผล่ที่ไหนเลย
-- ⚠️ ถ้ารัน จะลบบันทึกมูลค่าสต๊อก ฿33,294 ของสาขานี้ทิ้งถาวร

/*
update public.menus       set visible_branches = visible_branches - '7'  where visible_branches ? '7';
update public.ingredients set visible_branches = visible_branches - '7'  where visible_branches ? '7';
update public.ingredients set stock_by_branch  = stock_by_branch  - '7'  where stock_by_branch  ? '7';
update public.app_users   set allowed_branches = allowed_branches - '7'  where allowed_branches ? '7';
*/
