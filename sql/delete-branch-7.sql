-- ═══════════════════════════════════════════════════════════════════════════
-- ลบสาขา id 7 "คุณนายแจ่วฮ้อน"
--
-- ⚠️ ต้องรันในโปรเจกต์ FOODCOST (niplvsfxynrufiyvbwme) เท่านั้น
--    ไม่ใช่ SlipTrack — คนละฐานข้อมูลกัน SlipTrack ไม่มีตาราง branches
--    เช็คให้แน่ใจด้วยขั้นที่ 1 ก่อนเสมอ
--
-- ทำไมลบจากหน้าเว็บ/API ไม่ได้:
--   purchase_orders.branch_id มี foreign key → branches.id แบบ ON DELETE SET NULL
--   พอสั่งลบสาขา Postgres จะไปเซ็ต branch_id ของใบสั่งซื้อ 11 ใบเป็น null
--   แล้วชน trigger ที่ห้ามแก้ branch_id หลังสร้างใบ
--   (P0001 "branch_id ของ PO ไม่สามารถเปลี่ยนได้หลังสร้าง") → ยกเลิกทั้งรายการ
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ขั้นที่ 1 · เช็คว่าอยู่ถูกฐานข้อมูล + ดูของจริง (อ่านอย่างเดียว ปลอดภัย) ──
-- ถ้าขั้นนี้ error ว่าไม่มีตาราง branches แปลว่าอยู่ผิดโปรเจกต์ ให้สลับก่อน
select b.id, b.name, b.active,
       (select count(*) from public.purchase_orders p where p.branch_id = b.id) as ใบสั่งซื้อ,
       (select coalesce(sum(p.total),0) from public.purchase_orders p where p.branch_id = b.id) as มูลค่ารวม,
       (select count(*) from public.purchase_orders p
         where p.branch_id = b.id and p.status = 'awaiting_payment')            as ใบที่ค้างจ่าย
from public.branches b
where b.id in (6,7)
order by b.id;
-- ที่ควรเห็น: id 6 คุณนายตื่นสาย/แจ่วฮ้อน (active true) · id 7 คุณนายแจ่วฮ้อน (active false, 11 ใบ)


-- ── ทางเลือก A · ไม่ลบ แค่เปลี่ยนชื่อให้เลิกสับสน (ไม่เสียอะไรเลย) ──────────
-- พนักงานสับสนเพราะชื่อสองสาขาคล้ายกันมาก:
--   id 6 "คุณนายตื่นสาย/แจ่วฮ้อน" ← ยังเปิด ใช้งานจริง ลงสต๊อกล่าสุด 7 ส.ค. 69
--   id 7 "คุณนายแจ่วฮ้อน"         ← ปิดแล้ว
-- เปลี่ยนชื่อแล้วแยกออกทันที ใบสั่งซื้อและประวัติยังอ่านออกครบ
-- รันแค่บรรทัดเดียวนี้แล้วจบ:

--   update public.branches set name = '(ปิดแล้ว) คุณนายแจ่วฮ้อน' where id = 7;


-- ── ทางเลือก B · ลบจริง ────────────────────────────────────────────────────
-- ⚠️ สิ่งที่จะเสียไป (ตรวจจากข้อมูลจริง 8 ส.ค. 69):
--    · ใบสั่งซื้อ 11 ใบ ฿43,705 จะไม่รู้ว่าเป็นของสาขาไหน (branch_id = null)
--      ในนั้น 7 ใบสถานะ awaiting_payment รวม ฿30,068 ที่ยังค้างจ่าย
--    · สต๊อกที่บันทึกไว้ 82 รายการ มูลค่า ฿33,294 กลายเป็นข้อมูลกำพร้า
--    · เมนู 92 รายการ / วัตถุดิบ 105 รายการ ยังเก็บเลข 7 ไว้ใน visible_branches
--
-- ลอกทั้งบล็อกไปวางแล้วกด Run ได้เลย ไม่ต้องแก้อะไร
-- ทุกอย่างอยู่ใน transaction เดียว ถ้าพังกลางทางจะย้อนกลับทั้งหมดเอง

begin;

  -- สำรองใบสั่งซื้อไว้ก่อน (ตารางนี้จะอยู่ถาวร เผื่ออยากรู้ทีหลังว่าใบไหนเคยเป็นของสาขานี้)
  create table if not exists public.purchase_orders_branch7_backup as
    select * from public.purchase_orders where branch_id = 7;

  -- สำรองตัวสาขาเองไว้ด้วย เผื่ออยากเอากลับ
  create table if not exists public.branch7_backup as
    select * from public.branches where id = 7;

  -- ปิด trigger ของตารางใบสั่งซื้อชั่วคราว เพื่อให้ ON DELETE SET NULL ทำงานได้
  -- (ปิดเฉพาะ trigger ที่คนสร้าง ไม่แตะ trigger ระบบ/foreign key)
  alter table public.purchase_orders disable trigger user;

  delete from public.branches where id = 7;

  alter table public.purchase_orders enable trigger user;

  -- ตรวจก่อน commit — ต้องได้ 0 / 11 / 11
  select (select count(*) from public.branches where id = 7)                        as สาขาที่เหลือ_ต้องเป็น0,
         (select count(*) from public.purchase_orders where branch_id is null)      as ใบที่ไม่มีสาขาแล้ว,
         (select count(*) from public.purchase_orders_branch7_backup)               as ใบที่สำรองไว้;

commit;


-- ── ถ้าลบไปแล้วอยากเอากลับ ────────────────────────────────────────────────
--   insert into public.branches overriding system value
--   select * from public.branch7_backup;
--   -- แล้วคืน branch_id ให้ใบสั่งซื้อ (ต้องปิด trigger ชั่วคราวเหมือนกัน):
--   begin;
--     alter table public.purchase_orders disable trigger user;
--     update public.purchase_orders p set branch_id = 7
--     from public.purchase_orders_branch7_backup b where p.id = b.id;
--     alter table public.purchase_orders enable trigger user;
--   commit;


-- ── เก็บกวาดเลข 7 ที่ค้างอยู่ (จะทำหรือไม่ก็ได้) ────────────────────────────
-- ไม่ทำก็ไม่มีอะไรเสีย: ทุกหน้าที่ให้เลือกสาขาวนจากตาราง branches ซึ่งไม่มี 7 แล้ว
-- และไม่มีโค้ดไหนรวมสต๊อกข้ามสาขา ค่าที่ค้างจึงไม่โผล่ที่ไหน
-- ⚠️ ถ้ารัน จะลบบันทึกมูลค่าสต๊อก ฿33,294 ของสาขานี้ทิ้งถาวร

--   update public.menus       set visible_branches = visible_branches - '7' where visible_branches ? '7';
--   update public.ingredients set visible_branches = visible_branches - '7' where visible_branches ? '7';
--   update public.ingredients set stock_by_branch  = stock_by_branch  - '7' where stock_by_branch  ? '7';
--   update public.app_users   set allowed_branches = allowed_branches - '7' where allowed_branches ? '7';
