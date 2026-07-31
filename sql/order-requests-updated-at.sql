-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — เพิ่ม updated_at ให้ order_requests. รันครั้งเดียว วางทีเดียวจบ
--
-- ทำไมต้องมี:
-- หน้ารายการสั่งซื้อคอยเช็กว่า "Area อนุมัติแล้วหรือยัง" โดย **ดึงข้อมูลทั้งก้อนใหม่**
-- ทุก 20-60 วินาที = 1,158 KB ต่อครั้ง. ครัวกลางเปิดหน้าค้างไว้ 1 ชั่วโมง
-- = อ่านฐานข้อมูล ~204 MB ซึ่งเป็นตัวกินเครดิต Disk IO ตัวจริงที่ทำระบบล่ม 30 ก.ค. 69
-- (ไม่ใช่พื้นที่เต็ม ไม่ใช่ขาด index)
--
-- แก้โดยให้ถามแค่ "มีแถวไหนถูกแก้หลังจากเวลานี้ไหม" (~20 ไบต์) แล้วดึงของจริง
-- **เฉพาะเมื่อมีการเปลี่ยนแปลงจริง** ซึ่งเกิดไม่กี่ครั้งต่อชั่วโมง ไม่ใช่ทุก 20 วินาที
--
-- ทำไมต้องใช้ updated_at ไม่ใช่แค่เทียบ status:
-- ถ้าเทียบแค่ status จะจับ "การแก้จำนวนของที่รับจริง" ไม่ได้ (แก้ items แต่ status เดิม)
-- = คนอื่นเห็นจำนวนเก่าโดยไม่รู้ตัว ผิดกฎเหล็กที่ว่าจำนวน/สต๊อกห้ามผิด
-- trigger จับ **ทุกการแก้ทุกคอลัมน์** จึงไม่มีอะไรหลุด
-- ══════════════════════════════════════════════════════════════════════════

-- 1) คอลัมน์ + เติมค่าย้อนหลังจาก created_at (แถวเก่าจะไม่ถูกมองว่า "เพิ่งแก้")
alter table public.order_requests
  add column if not exists updated_at timestamptz;

-- หมายเหตุ: อย่าใส่ requested_at ใน coalesce — คอลัมน์นั้นเป็น **text** (เก็บ ISO string)
-- ไม่ใช่ timestamptz จะได้ error 42804 "COALESCE types cannot be matched"
-- ตรวจแล้วว่า created_at มีค่าครบทุกแถว (ไม่มี null เลย) จึงไม่ต้องมี fallback อื่น
update public.order_requests
   set updated_at = coalesce(created_at, now())
 where updated_at is null;

alter table public.order_requests
  alter column updated_at set default now();

-- 2) trigger: แก้แถวไหนก็ประทับเวลาใหม่อัตโนมัติ ไม่ต้องแก้โค้ดแอปทุกจุดที่เขียน
--    (สำคัญ — ถ้าให้แอปเซ็ตเอง จุดที่ลืมจะกลายเป็นการเปลี่ยนแปลงที่มองไม่เห็น)
--    ตั้งชื่อเจาะจงตารางโดยเจตนา: ชื่อกลางๆ อย่าง touch_updated_at() ถ้าตารางอื่นใช้อยู่
--    คำสั่ง create or replace จะทับตรรกะของเขาทิ้งเงียบๆ
create or replace function public.order_requests_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists order_requests_touch on public.order_requests;
create trigger order_requests_touch
  before update on public.order_requests
  for each row execute function public.order_requests_touch_updated_at();

-- 3) index สำหรับคำถาม "มีอะไรใหม่กว่าเวลานี้ไหม" — ให้เป็นการมองแค่ปลาย index
--    ไม่ใช่ไล่อ่าน 1,583 แถว (ไม่มี index = การประหยัดจะหายไปเกือบหมด)
create index if not exists order_requests_updated_at
  on public.order_requests (updated_at desc);

-- ตรวจว่าใช้ได้:
--   select id, status, updated_at from public.order_requests order by updated_at desc limit 5;
-- ทดสอบ trigger (ต้องเห็น updated_at ขยับมาเป็นเวลาปัจจุบัน):
--   update public.order_requests set note = note where id = (select max(id) from public.order_requests);
--   select id, updated_at from public.order_requests order by id desc limit 1;
