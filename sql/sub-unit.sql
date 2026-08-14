-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — หน่วยย่อย (ซื้อยกลัง แต่สูตร SOP หยิบทีละขวด)
-- รันครั้งเดียวใน Supabase → SQL Editor
--
-- ปัญหาที่แก้: เดิมสูตรแปลงหน่วยได้ 2 ทางเท่านั้น
--   1) หน่วยน้ำหนัก/ปริมาตร (กรัม กก. มล. ลิตร) — แปลงผ่าน UNIT_G
--   2) หน่วยที่ซื้อเอง — แปลงผ่าน convert_to_gram
-- เคส "ซื้อเป็นลัง ใช้เป็นขวด" ตกท่อทั้งคู่ → ระบบนับ "1 ขวด" เป็น 1 กรัม
--
-- วัดจริง 14/08/2569: เบียร์ลีโอ ซื้อ ฿640/ลัง · สูตรใส่ "1 ขวด"
--   ได้ต้นทุน ฿0.64 ทั้งที่ควรเป็น ฿53.33 (1 ลัง 12 ขวด) = ผิด 83 เท่า
--   และตอนผลิตก็ตัดสต๊อกแทบไม่ลด ของค้างในระบบตลอดไป
--
-- หลังรันไฟล์นี้: ไปที่การ์ดวัตถุดิบ → ช่อง "1 <หน่วยที่ซื้อ> มีกี่หน่วยย่อย"
--   ใส่ 12 แล้วเลือกหน่วยย่อย "ขวด" → สูตร SOP เลือก "ขวด" ได้ทันที
-- ══════════════════════════════════════════════════════════════════════════

alter table ingredients
  add column if not exists sub_unit    text,
  add column if not exists sub_per_buy numeric;

comment on column ingredients.sub_unit    is 'หน่วยย่อยที่สูตร SOP หยิบได้ เช่น "ขวด" เมื่อซื้อเป็น "ลัง" (null = ไม่มี)';
comment on column ingredients.sub_per_buy is 'จำนวนหน่วยย่อยต่อ 1 หน่วยที่ซื้อ เช่น 12 = 1 ลัง มี 12 ขวด';

-- ตรวจว่าเพิ่มแล้ว (ต้องได้ 2 แถว)
select column_name, data_type
from information_schema.columns
where table_name = 'ingredients' and column_name in ('sub_unit','sub_per_buy')
order by column_name;


-- ── ตั้งค่าให้เบียร์/เครื่องดื่มที่ซื้อยกลัง (ไม่บังคับ — ตั้งในหน้าเว็บก็ได้) ──
-- ⚠️ ตรวจก่อนว่าลังละกี่ขวดจริง แต่ละยี่ห้อไม่เท่ากัน — ใส่ผิดคือต้นทุนผิดทั้งเมนู
-- ดูรายการที่ซื้อเป็นลังทั้งหมดก่อน:
select id, name, buy_unit, buy_price, convert_to_gram,
       round(buy_price / 12, 2) as ถ้าลังละ12_ต้นทุนต่อขวด
from ingredients
where buy_unit = 'ลัง'
order by name;

-- แล้วค่อยตั้งทีละตัวตามจริง เช่น:
-- update ingredients set sub_unit = 'ขวด', sub_per_buy = 12 where id = 810;   -- เบียร์ลีโอ
-- update ingredients set sub_unit = 'ขวด', sub_per_buy = 12 where id = 811;   -- เบียร์สิงห์


-- ── ย้อนกลับถ้าไม่เอาแล้ว ──
-- alter table ingredients drop column if exists sub_unit, drop column if exists sub_per_buy;
