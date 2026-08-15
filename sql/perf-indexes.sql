-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ดัชนีสำหรับคิวรีที่ถูกยิงประจำ (15/08/2569)
-- รันครั้งเดียวใน Supabase → SQL Editor · รันซ้ำได้ (IF NOT EXISTS)
--
-- ที่มา: แจ้งเตือน "ฐานข้อมูลเริ่มตอบช้า (4566 ms)" — ตัวกินหลัก (reload ทั้งตาราง
-- หลังบันทึกนับสต๊อกทุกแถว) แก้ที่ฝั่งแอปแล้ว ไฟล์นี้คือมาตรฐานฝั่ง DB:
-- คิวรีที่ถูก poll ซ้ำๆ ต้องมีดัชนีรองรับ ไม่ใช่กวาดทั้งตารางทุกรอบ
-- ตารางยังเล็ก (พันแถว) จึงสร้างเร็ว แต่ผลคือ Disk IO ต่อ poll ลดลงถาวร
-- และยิ่งตารางโตขึ้นเรื่อยๆ ยิ่งต่างมาก
-- ══════════════════════════════════════════════════════════════════════════

-- 1) ออเดอร์ลูกค้าตามโต๊ะ — หน้า QR ลูกค้า poll ทุก 45 วิ "ต่อโต๊ะที่เปิดอยู่"
--    คิวรี: orders?table_id=eq.X&status=neq.paid&status=neq.cancelled
--    ดัชนีบางส่วน: เก็บเฉพาะออเดอร์ที่ยังไม่จบ (แถวส่วนใหญ่จบแล้ว = ดัชนีเล็กมาก)
create index if not exists idx_orders_table_active
  on orders (table_id, created_at desc)
  where status not in ('paid','cancelled');

-- 2) ออเดอร์ POS ต่อสาขาต่อวัน — จอครัว/แคชเชียร์ poll ทุก 10-30 วิ
--    คิวรี: orders?branch_id=eq.X&created_at=gte...&order=created_at.desc
create index if not exists idx_orders_branch_created
  on orders (branch_id, created_at desc);

-- 3) ใบสั่งซัพนอกที่ยังเปิด — หน้าอนุมัติ poll ทุก 60 วิ + sweep ทุก 10 นาที
--    + ตัวหัก "ของที่สั่งแล้วรอเข้า" ในหน้าสรุปซื้อ/สร้างคำสั่งซื้อ
create index if not exists idx_order_requests_open
  on order_requests (status, id desc)
  where status in ('pending_approval','pending','approved');

-- 4) ใบสั่งซัพนอกต่อสาขา — getOrders(branch) ใช้ทุกครั้งที่เปิดแท็บสั่งของ
create index if not exists idx_order_requests_branch
  on order_requests (branch_id, id desc);

-- 5) PO ตามสถานะ — หน้าอนุมัติ + หน้าเอกสาร PO
create index if not exists idx_purchase_orders_status
  on purchase_orders (status, id desc);

-- 6) ประวัติการนับ — หน้าประวัติต่อวัตถุดิบ + export รวมต่อ session
create index if not exists idx_stock_logs_ingredient
  on stock_logs (ingredient_id, counted_at desc);
create index if not exists idx_stock_logs_session
  on stock_logs (session_id);

-- ตรวจว่าสร้างครบ (ต้องได้ 7 แถว)
select indexname from pg_indexes
where indexname like 'idx_orders%' or indexname like 'idx_order_requests%'
   or indexname like 'idx_purchase_orders%' or indexname like 'idx_stock_logs%'
order by indexname;
