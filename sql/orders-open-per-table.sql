-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ตัวกัน "1 โต๊ะ มีบิลเปิดได้ใบเดียว" (orders)
-- รันใน Supabase → SQL Editor ได้ทุกเมื่อ (มีอยู่แล้วก็ไม่ทำอะไร — IF NOT EXISTS)
--
-- ทำไมต้องมี: ลูกค้า 2 คนสแกน QR โต๊ะว่างแล้วกดสั่งพร้อมกัน แอปทั้งสองเครื่องเห็นว่า
-- "โต๊ะนี้ยังไม่มีบิล" แล้วต่างคนต่างสร้างบิลใหม่ → ได้ 2 บิลในโต๊ะเดียว
-- ใบหนึ่งออกใบครัวไปแล้ว แต่แคชเชียร์เห็น/เก็บเงินแค่ใบเดียว = อาหารฟรีโดยไม่มีใครรู้
--
-- แอปพึ่งตัวกันนี้อยู่ (api.posAppendItems ใน src/FoodCostApp.jsx):
-- ตอนสร้างบิลใหม่ ถ้าฐานตอบ "duplicate key" = มีอีกเครื่องเพิ่งเปิดบิลโต๊ะนี้ไปก่อน
-- แอปจะวนกลับไปต่อท้ายรายการลงบิลใบนั้นแทน ⟹ ถ้า index นี้หายไป จะไม่มีอะไรเตือนเลย
--
-- เจ้าของรันไว้แล้วเมื่อ 14/06/2569 — ไฟล์นี้เก็บไว้ให้สร้างใหม่ได้ (เช่นหลังกู้ข้อมูลลงฐานใหม่)
-- "บิลเปิด" = สถานะที่ไม่ใช่ paid/cancelled ตรงกับที่แอปใช้ทุกจุด (getActiveOrders / getOrderByTable)
-- table_id ว่าง (บิลไม่ผูกโต๊ะ) ไม่ถูกจำกัด — unique index ยอมให้ NULL ซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════

-- 0) ตรวจก่อน: ถ้ามีโต๊ะที่มีบิลเปิดเกิน 1 ใบอยู่แล้ว คำสั่งข้อ 1 จะล้ม
--    ต้องเก็บเงิน/ยกเลิกบิลที่เกินก่อน (node tools/check-data.mjs ข้อ 15 บอกได้เหมือนกัน)
-- select table_id, count(*) as open_bills, array_agg(id order by id) as order_ids
--   from public.orders
--  where status not in ('paid','cancelled') and table_id is not null
--  group by table_id
-- having count(*) > 1;

-- 1) ตัวกัน
create unique index if not exists uniq_open_order_per_table
  on public.orders (table_id)
  where status not in ('paid','cancelled');

-- 2) ยืนยันว่ามีอยู่จริง (ต้องได้ 1 แถว และ indexdef ลงท้ายด้วย WHERE ... NOT IN paid/cancelled)
-- select indexname, indexdef
--   from pg_indexes
--  where schemaname = 'public' and tablename = 'orders'
--    and indexname = 'uniq_open_order_per_table';
