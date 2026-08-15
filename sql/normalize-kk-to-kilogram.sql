-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — รวมตัวย่อหน่วยกิโลกรัมให้เหลือคำเดียว (15/08/2569)
--   "กก." · "กิโล" · "กส."  →  "กิโลกรัม"
--
-- ปลอดภัยต่อตัวเลข: UNIT_G["กก."] = UNIT_G["กิโลกรัม"] = 1000 เท่ากันเป๊ะ
-- การแปลงนี้เปลี่ยนแค่ "ข้อความชื่อหน่วย" ไม่มีจำนวน/ต้นทุน/สต๊อกตัวไหนเปลี่ยน
-- ส่วน "กิโล" กับ "กส." ไม่มีใน UNIT_G เลย (แปลงเป็นกรัมไม่ได้) แก้แล้วจะดีขึ้น
--
-- ⚠️ ต้องรัน "ส่วนที่ 2 ทั้งหมด" ในคราวเดียว ห้ามแปลงแค่ตาราง ingredients
--    เพราะตัวหัก "ของที่สั่งแล้วรอเข้า" เทียบหน่วยในใบสั่งกับ buy_unit
--    ถ้าแปลงข้างเดียว 149 บรรทัดใน 74 ใบที่ยังเปิดอยู่จะกลายเป็น "หน่วยไม่ตรง"
--    → ระบบเลิกหักของที่สั่งไปแล้ว → เสนอให้สั่งซ้ำ
--
-- ขอบเขต (วัดจริงก่อนเขียน): ingredients 172 · order_requests 3,235 บรรทัด
--   ใน 1,380 ใบ · purchase_orders 7,083 บรรทัด ใน 329 ใบ
--   stock_logs 10,809 · waste_logs 213 · สูตรอาหาร 0 (ไม่มีสูตรไหนใช้ตัวย่อ)
-- ══════════════════════════════════════════════════════════════════════════

-- ══ ส่วนที่ 1 — สำรองก่อน (รันก่อนเสมอ) ═══════════════════════════════════
create table if not exists _backup_unit_kk_20690815 as
select 'ingredients' as tbl, id, to_jsonb(buy_unit) as val from ingredients where buy_unit in ('กก.','กิโล','กส.')
union all select 'order_requests', id, items from order_requests where items @> '[{"unit":"กก."}]' or items @> '[{"unit":"กิโล"}]' or items @> '[{"unit":"กส."}]'
union all select 'purchase_orders', id, items from purchase_orders where items @> '[{"unit":"กก."}]' or items @> '[{"unit":"กิโล"}]' or items @> '[{"unit":"กส."}]';

select tbl, count(*) as สำรองไว้ from _backup_unit_kk_20690815 group by tbl order by tbl;


-- ══ ส่วนที่ 2 — แปลง (รันทั้งก้อนในคราวเดียว) ═════════════════════════════
-- 2a) ตารางวัตถุดิบ
update ingredients set buy_unit='กิโลกรัม' where buy_unit in ('กก.','กิโล','กส.');
update ingredients set sub_unit='กิโลกรัม' where sub_unit in ('กก.','กิโล','กส.');

-- 2b) ใบสั่งซัพนอก — เขียน items ใหม่ทั้งอาร์เรย์
--     ⚠️ WITH ORDINALITY + ORDER BY ord จำเป็น: ไม่ใส่แล้วลำดับรายการในใบจะสลับ
update order_requests set items=(
  select jsonb_agg(case when e->>'unit' in ('กก.','กิโล','กส.') then jsonb_set(e,'{unit}','"กิโลกรัม"') else e end order by ord)
  from jsonb_array_elements(items) with ordinality t(e,ord))
where items @> '[{"unit":"กก."}]' or items @> '[{"unit":"กิโล"}]' or items @> '[{"unit":"กส."}]';

-- 2c) ใบสั่งซื้อ/ใบส่งของ (PO)
update purchase_orders set items=(
  select jsonb_agg(case when e->>'unit' in ('กก.','กิโล','กส.') then jsonb_set(e,'{unit}','"กิโลกรัม"') else e end order by ord)
  from jsonb_array_elements(items) with ordinality t(e,ord))
where items @> '[{"unit":"กก."}]' or items @> '[{"unit":"กิโล"}]' or items @> '[{"unit":"กส."}]';

-- 2d) ประวัติ (คอลัมน์ข้อความธรรมดา — แสดงผลอย่างเดียว)
update stock_logs set unit='กิโลกรัม' where unit in ('กก.','กิโล','กส.');
update waste_logs set unit='กิโลกรัม' where unit in ('กก.','กิโล','กส.');


-- ══ ส่วนที่ 3 — ตรวจ (ต้องได้ 0 ทุกช่อง) ══════════════════════════════════
select
  (select count(*) from ingredients where buy_unit in ('กก.','กิโล','กส.'))                          as เหลือ_วัตถุดิบ,
  (select count(*) from ingredients where sub_unit in ('กก.','กิโล','กส.'))                          as เหลือ_หน่วยย่อย,
  (select count(*) from order_requests where items @> '[{"unit":"กก."}]' or items @> '[{"unit":"กิโล"}]' or items @> '[{"unit":"กส."}]') as เหลือ_ใบซัพนอก,
  (select count(*) from purchase_orders where items @> '[{"unit":"กก."}]' or items @> '[{"unit":"กิโล"}]' or items @> '[{"unit":"กส."}]') as เหลือ_PO,
  (select count(*) from stock_logs where unit in ('กก.','กิโล','กส.'))                               as เหลือ_ประวัตินับ,
  (select count(*) from waste_logs where unit in ('กก.','กิโล','กส.'))                               as เหลือ_ของเสีย;

-- ตรวจความสมบูรณ์: จำนวนบรรทัดในทุกใบต้องเท่าเดิมเป๊ะ (กัน jsonb_agg ทำรายการหาย)
select count(*) as ใบที่จำนวนบรรทัดเปลี่ยน_ต้องเป็น0
from _backup_unit_kk_20690815 b
join order_requests o on o.id=b.id and b.tbl='order_requests'
where jsonb_array_length(b.val) <> jsonb_array_length(o.items);

select count(*) as PO_ที่จำนวนบรรทัดเปลี่ยน_ต้องเป็น0
from _backup_unit_kk_20690815 b
join purchase_orders p on p.id=b.id and b.tbl='purchase_orders'
where jsonb_array_length(b.val) <> jsonb_array_length(p.items);


-- ══ กู้คืนถ้าพลาด ═════════════════════════════════════════════════════════
-- update ingredients i set buy_unit = b.val #>> '{}' from _backup_unit_kk_20690815 b where b.tbl='ingredients' and b.id=i.id;
-- update order_requests o set items = b.val from _backup_unit_kk_20690815 b where b.tbl='order_requests' and b.id=o.id;
-- update purchase_orders p set items = b.val from _backup_unit_kk_20690815 b where b.tbl='purchase_orders' and b.id=p.id;

-- ══ ลบตารางสำรองเมื่อมั่นใจแล้ว (รอ 1-2 สัปดาห์) ══════════════════════════
-- drop table _backup_unit_kk_20690815;
