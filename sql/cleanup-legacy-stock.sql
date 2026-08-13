-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ล้างเศษข้อมูลสต๊อกที่โค้ดไม่อ่านแล้ว (13/08/2569)
--
-- ที่มา: โค้ดเลิกใช้ 2 อย่างไปแล้ว แต่ข้อมูลยังค้างอยู่ใน DB
--   1) คอลัมน์ ingredients.stock — ยอดรวมยุคก่อนแยกสต๊อกรายสาขา
--      branchStock() เลิก fallback มาอ่านตัวนี้แล้ว และฟอร์มแก้ไขวัตถุดิบเลิกเขียนแล้ว
--   2) คีย์ "7" ใน stock_by_branch — สาขาคุณนายแจ่วฮ้อน ถูกลบไปแล้ว
--      ไม่มีสาขา 7 ใน branches อีก ของก้อนนี้จึงไม่โผล่ที่ไหนเลยในระบบ
--
-- ⚠️ รันทีละส่วน อ่านผลก่อนไปส่วนถัดไป · ส่วนที่ 3 เท่านั้นที่ปลอดภัยแน่นอน
-- ══════════════════════════════════════════════════════════════════════════

-- ══ ส่วนที่ 0 — สำรองก่อนแตะอะไรทั้งสิ้น (รันก่อนเสมอ) ══════════════════════
create table if not exists _backup_ing_stock_20690813 as
select id, name, stock, stock_by_branch, now() as backed_up_at
from ingredients;

-- ตรวจว่าสำรองครบ (ต้องได้จำนวนเท่ากับวัตถุดิบทั้งหมด ~815)
select count(*) as สำรองไว้ from _backup_ing_stock_20690813;

-- กู้คืนถ้าพลาด:
--   update ingredients i set stock = b.stock, stock_by_branch = b.stock_by_branch
--   from _backup_ing_stock_20690813 b where b.id = i.id;


-- ══ ส่วนที่ 1 — รายงาน (อ่านอย่างเดียว ไม่แก้อะไร) ═════════════════════════
-- 1a) ของที่ค้างอยู่ใต้สาขา 7 ที่ถูกลบไปแล้ว
select
  count(*)                                                                as รายการ,
  round(sum((stock_by_branch->>'7')::numeric * coalesce(buy_price,0)))    as มูลค่ารวม
from ingredients
where stock_by_branch ? '7'
  and (stock_by_branch->>'7')::numeric <> 0;

-- 1b) ดูรายตัว เรียงตามมูลค่า
select
  id, name,
  (stock_by_branch->>'7')::numeric                                   as จำนวนค้าง,
  buy_unit                                                           as หน่วย,
  round((stock_by_branch->>'7')::numeric * coalesce(buy_price,0))    as มูลค่า
from ingredients
where stock_by_branch ? '7'
  and (stock_by_branch->>'7')::numeric <> 0
order by 5 desc;

-- 1c) ยอดรวมเก่าในคอลัมน์ stock ที่โค้ดไม่อ่านแล้ว
select id, name, stock, buy_unit, stock_by_branch
from ingredients
where coalesce(stock,0) <> 0
order by stock * coalesce(buy_price,0) desc;


-- ══ ส่วนที่ 2 — ของสาขา 7 : ต้องตัดสินใจก่อน เลือกทางเดียว ════════════════
-- ⚠️ นี่คือของจริงมูลค่า ~฿33,000 ที่เคยอยู่ที่สาขาคุณนายแจ่วฮ้อน
--    ตอนปิดสาขา ของถูกขนไปสาขาอื่น หรือใช้หมด/ทิ้งไปแล้ว? ตอบก่อนแล้วค่อยเลือก
--    ห้ามเดา — ยอดนี้ไหลไปงบบัญชีมูลค่าสต๊อก (ม.87)

-- ── ทาง A: ของถูกขนไปสาขาอื่น → ย้ายยอดไปรวมกับสาขานั้น ──
--    เปลี่ยนเลข '5' เป็นรหัสสาขาปลายทางจริง (2=คลองสาม 3=อยุธยา 4=บางใหญ่ 5=กาญจนบุรี 6=แจ่วฮ้อนใหม่ 8=The River)
--    บวกทับของเดิมที่ปลายทางมีอยู่ ไม่ใช่เขียนทับ
-- update ingredients
-- set stock_by_branch =
--       (stock_by_branch - '7')
--       || jsonb_build_object('5', to_jsonb(
--            coalesce((stock_by_branch->>'5')::numeric, 0) + (stock_by_branch->>'7')::numeric
--          ))
-- where stock_by_branch ? '7'
--   and (stock_by_branch->>'7')::numeric <> 0;

-- ── ทาง B: ของใช้หมด/ทิ้งไปแล้ว → ตัดจำหน่าย (ลบคีย์ทิ้ง) ──
--    ยอดจะหายจากมูลค่าสต๊อกรวมทันที ฿33,239 ควรแจ้งบัญชีก่อน
-- update ingredients
-- set stock_by_branch = stock_by_branch - '7'
-- where stock_by_branch ? '7';

-- ตรวจหลังทำ (ต้องได้ 0)
-- select count(*) as เหลือคีย์7 from ingredients where stock_by_branch ? '7';


-- ══ ส่วนที่ 3 — ล้างยอดรวมเก่า (ปลอดภัย ทำได้เลย) ═════════════════════════
-- โค้ดไม่อ่านคอลัมน์นี้แล้วตั้งแต่ commit "Stop showing a branch stock it never
-- counted" — ตั้งเป็น 0 เพื่อไม่ให้ใครหลงคิดว่าเป็นสต๊อกจริงในอนาคต
-- ไม่กระทบตัวเลขบนหน้าจอเลย เพราะทุกหน้าอ่านจาก stock_by_branch อยู่แล้ว
update ingredients set stock = 0 where coalesce(stock,0) <> 0;

-- ตรวจ (ต้องได้ 0)
select count(*) as เหลือยอดรวมเก่า from ingredients where coalesce(stock,0) <> 0;


-- ══ เก็บกวาด ══════════════════════════════════════════════════════════════
-- ทิ้งตารางสำรองเมื่อมั่นใจแล้ว (รอสัก 1-2 สัปดาห์)
-- drop table _backup_ing_stock_20690813;
