-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ข้อความแจ้งลูกค้าตอนสแกน QR ครั้งแรก (เช่น "ราคายังไม่รวม VAT 7%")
-- รันใน Supabase → SQL Editor ครั้งเดียว (รันซ้ำได้ — IF NOT EXISTS)
--
-- ตั้งที่ จัดการหลังบ้าน → ตั้งค่า POS (หรือ จอขาย → 🧾 จัดการใบเสร็จ) ต่อจากข้อความใบเสร็จ — รายสาขา
--   customer_notice_title = หัวข้อ (ว่าง = "เงื่อนไขการใช้บริการ")
--   customer_notice_text  = ข้อความ (ว่าง = ไม่แสดงกล่องเลย)
-- หน้าลูกค้าขึ้นกล่องให้กด "เข้าใจแล้ว" ครั้งแรกที่สแกน QR ของโต๊ะ (จำต่อ QR ใบนั้น — ลูกค้ากลุ่มใหม่ได้ QR ใหม่ก็เห็นอีก
-- · แก้ข้อความแล้ว ลูกค้าที่เปิด/รีเฟรชหน้าหลังจากนั้นเห็นข้อความใหม่อีกครั้ง)
--
-- เป็นตารางเดิม (pos_settings) → ไม่ต้องปิด RLS / ไม่ต้อง GRANT · สำรองข้อมูลรายวันครอบคลุมเอง (สำรองทั้งแถว)
-- ก่อนรัน: ช่องในฟอร์มบันทึกไม่ได้ (บอกให้รันไฟล์นี้) · หน้าลูกค้าไม่ขึ้นกล่อง · อย่างอื่นปกติทุกอย่าง
-- ══════════════════════════════════════════════════════════════════════════

alter table public.pos_settings add column if not exists customer_notice_title text;
alter table public.pos_settings add column if not exists customer_notice_text text;

-- ให้ API (PostgREST) เห็นคอลัมน์ใหม่ทันที ไม่ต้องรอ
notify pgrst, 'reload schema';

-- ตรวจผล (อ่านอย่างเดียว) — ต้องได้แถวกลับมา ไม่ใช่ error "column ... does not exist":
--   GET https://niplvsfxynrufiyvbwme.supabase.co/rest/v1/pos_settings?select=branch_id,customer_notice_title,customer_notice_text
