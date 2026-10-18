-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — คลัง "แพ็คเกจบุฟเฟต์" รายสาขา (pos_settings.buffet_packages)
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้ — IF NOT EXISTS)
--
-- เก็บเป็น jsonb (array) ในแถวตั้งค่า POS ของแต่ละสาขา — แถวเดียวกับคลังตัวเลือก (option_library)
--   [{ id:'pk_…', name, active:true,
--      lines:[{key:'adult',label:'ผู้ใหญ่',price,guest:true},
--             {key:'child',label:'เด็ก',price,guest:true},
--             {key:'x_…',label:'เตาเพิ่ม',price,guest:false} …],
--      menu_ids:[เลขเมนู …], updated_at, updated_by }]
--   ลำดับใน array = ลำดับที่โชว์ · ลบ = active:false (โต๊ะที่เปิดด้วยแพ็คเกจนั้นยังหาเมนูเจอ)
--
-- ปลอดภัยกับข้อมูลเดิม: เพิ่มคอลัมน์ที่ว่างได้ ไม่แตะแถวไหน
-- เป็นตารางเดิม (pos_settings) → ไม่ต้องปิด RLS / ไม่ต้อง GRANT เพิ่ม
-- สำรองข้อมูลรายวันครอบคลุมเอง (api/backup.js สำรอง pos_settings ทั้งแถวอยู่แล้ว)
--
-- ก่อนรัน: จอ "แพ็คเกจบุฟเฟต์" ขึ้นว่า "ต้องรัน SQL เพิ่มคอลัมน์ก่อน" · สาขาอื่น (River) ทำงานเหมือนเดิมทุกอย่าง
-- หลังรัน: เปิดจอแพ็คเกจใหม่อีกครั้ง สร้างแพ็คเกจได้ทันที
-- ══════════════════════════════════════════════════════════════════════════

alter table public.pos_settings add column if not exists buffet_packages jsonb;

-- ให้ API (PostgREST) เห็นคอลัมน์ใหม่ทันที ไม่ต้องรอ
notify pgrst, 'reload schema';

-- ตรวจผล (อ่านอย่างเดียว) — ต้องได้แถวกลับมา ไม่ใช่ error 42703 "column ... does not exist"
--   GET https://niplvsfxynrufiyvbwme.supabase.co/rest/v1/pos_settings?select=branch_id,buffet_packages
--   (header apikey: <คีย์ publishable>) · ค่าเริ่มต้นเป็น null ทุกสาขา = ยังไม่มีแพ็คเกจ
-- หรือใน SQL Editor:
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'pos_settings' and column_name = 'buffet_packages';
