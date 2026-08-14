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


-- ══ ส่วนที่ 2 — รวมของสาขา 7 เข้าสาขา 6 ═══════════════════════════════════
-- สาขา 7 "คุณนายแจ่วฮ้อน" กับสาขา 6 "คุณนายตื่นสาย/แจ่วฮ้อน" คือร้านเดียวกัน
-- สาขา 7 เป็นระเบียนเก่าที่ถูกลบไปแล้ว → ย้ายสต๊อกที่ค้างมารวมกับสาขา 6
--
-- ตรวจตัวอย่างผลลัพธ์แล้ว 14/08/2569 (ก่อนรัน):
--   · 82 รายการ · มูลค่า ฿33,239
--   · 78 รายการบวกทับช่องสาขา 6 ที่มีอยู่แล้ว · 4 รายการสร้างช่องใหม่
--   · ไม่มีค่าติดลบ
--   · net-conservation ผ่านครบ — จำนวนรวมต่อวัตถุดิบไม่เปลี่ยน แค่ย้ายช่อง
--   · สาขา 6 มีของกลุ่มนี้อยู่เดิม ฿44,929 → หลังรวม ฿78,168
--
-- ✅ ปลอดภัยถ้ารันซ้ำ: รอบสองจะไม่เจอคีย์ '7' แล้ว จึงไม่มีแถวไหนถูกบวกซ้ำ
-- ✅ เป็นคำสั่งเดียว = ทรานแซกชันเดียว สำเร็จทั้งหมดหรือไม่เกิดอะไรเลย
--
-- 2a) ย้ายยอด: บวกทับของเดิมที่สาขา 6 ไม่ใช่เขียนทับ
update ingredients
set stock_by_branch =
      (stock_by_branch - '7')
      || jsonb_build_object('6', to_jsonb(
           coalesce((stock_by_branch->>'6')::numeric, 0) + (stock_by_branch->>'7')::numeric
         ))
where stock_by_branch ? '7'
  and (stock_by_branch->>'7')::numeric <> 0;

-- 2b) เก็บกวาดคีย์ '7' ที่เหลือซึ่งเป็น 0 อยู่แล้ว (ตอนตรวจไม่มี แต่กันไว้)
update ingredients
set stock_by_branch = stock_by_branch - '7'
where stock_by_branch ? '7';

-- 2c) ตรวจหลังทำ — ต้องได้ 0 ทั้งคู่
select
  (select count(*) from ingredients where stock_by_branch ? '7')                as เหลือคีย์7,
  (select count(*) from ingredients where safety_by_branch ? '7')               as เหลือsafety7;

-- 2d) เทียบยอดสาขา 6 กับตอนก่อนรวม (ควรเพิ่มขึ้นเท่ากับที่ย้ายมา)
select round(sum((stock_by_branch->>'6')::numeric * coalesce(buy_price,0))) as มูลค่าสาขา6
from ingredients where stock_by_branch ? '6';


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
