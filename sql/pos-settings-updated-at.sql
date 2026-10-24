-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ประทับ updated_at ให้ pos_settings ทุกครั้งที่แก้
-- ไม่บังคับ · รันครั้งเดียว วางทีเดียวจบ · 24 ต.ค. 69 (ลด egress หลังย้าย Supabase ลงแผนฟรี/Nano)
--
-- ทำไม:
-- จอขาย (iPad ร้าน) เคยดึงตั้งค่า POS ทั้งแถว (~6 KB: PIN พนักงาน คลังตัวเลือก แพ็คเกจ) ทุก 60 วินาทีต่อเครื่อง
-- ตอนนี้จอถามแค่ updated_at ของแถว (~50 ไบต์) แล้วดึงทั้งแถวเฉพาะเมื่อเวลาเปลี่ยน + ดึงเต็มบังคับทุก 10 นาที (ตาข่าย)
--
-- แอปประทับเวลาเองแล้วทุกทางของแอป: VAT / ค่าบริการ / พร้อมเพย์ / PIN พนักงาน / คลังตัวเลือก (patchPOSSettings)
--   + แพ็คเกจบุฟเฟต์ · ลำดับหมวด/ลำดับเมนู (ตรวจทาน 24 ต.ค. 69)
-- ที่เหลือคือการแก้ในฐานตรงๆ (SQL / Table Editor)
--   ยังไม่รันไฟล์นี้ = การแก้ในฐานตรงๆ ถึงจอขายเครื่องอื่นช้าสุด ~10 นาที (เดิม 60 วิ)
--   (ราคาแพ็คเกจตอนเปิดโต๊ะ และเมนูในแพ็คเกจตอนส่ง อ่านสดจากฐานอยู่แล้ว — ยอดเงินไม่ผิด)
--   รันแล้ว = ทุกการแก้ทุกทางถึงจอขายภายใน 60 วิเหมือนเดิม
--
-- ปลอดภัย: ไม่แตะคอลัมน์อื่นเลย แตะแค่ updated_at
-- ชื่อฟังก์ชันเจาะจงตารางโดยเจตนา (ชื่อกลางๆ ถ้าตารางอื่นใช้อยู่ create or replace จะทับตรรกะของเขาเงียบๆ)
-- ══════════════════════════════════════════════════════════════════════════

-- 1) คอลัมน์ (มีอยู่แล้วในฐานจริง — ฟอร์ม VAT เขียนทุกครั้ง · กันไว้เผื่อฐานที่กู้คืนมา)
alter table public.pos_settings
  add column if not exists updated_at timestamptz;

-- แถวที่ยังไม่มีเวลา: จอขายดึงเต็มทุกรอบ (ไม่เดาว่าไม่เปลี่ยน) — เติมให้ครั้งเดียวจะได้ประหยัดด้วย
update public.pos_settings
   set updated_at = now()
 where updated_at is null;

alter table public.pos_settings
  alter column updated_at set default now();

-- 2) trigger: แก้แถวไหน ทางไหนก็ตาม ประทับเวลาใหม่อัตโนมัติ
create or replace function public.pos_settings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pos_settings_touch on public.pos_settings;
create trigger pos_settings_touch
  before update on public.pos_settings
  for each row execute function public.pos_settings_touch_updated_at();

-- ไม่ต้องมี index: ถามทีละสาขา (branch_id=eq.X) แถวเดียวต่อสาขาอยู่แล้ว
--
-- ตรวจว่าใช้ได้:
--   select branch_id, updated_at from public.pos_settings order by branch_id;
-- ทดสอบ trigger (ต้องเห็น updated_at ขยับมาเป็นเวลาปัจจุบัน — ไม่เปลี่ยนค่าอื่น):
--   update public.pos_settings set updated_at = updated_at where branch_id = 5;
--   select branch_id, updated_at from public.pos_settings where branch_id = 5;
