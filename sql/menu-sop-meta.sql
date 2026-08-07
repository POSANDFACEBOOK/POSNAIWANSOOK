-- ═══════════════════════════════════════════════════════════════════════════
-- ใบ SOP แบบใหม่ (A4 แผ่นเดียวต่อเมนู) มี 2 ช่องที่ยังไม่มีในฐานข้อมูล
--   prep_time = เวลาทำ      → ขึ้นเป็นป้ายที่แถบหัว และช่อง "เวลาปฏิบัติงานรวม" ที่แถบท้าย
--   packaging = บรรจุภัณฑ์   → ขึ้นเป็นการ์ด "บรรจุภัณฑ์" ที่คอลัมน์ซ้าย
--
-- เก็บเป็น text ไม่ใช่ตัวเลข/interval เพราะครัวเขียนกันหลายแบบ
-- ("5 นาที", "5 นาที (ทอด 4 นาที)", "ประมาณ 10-12 นาที") บังคับรูปแบบแล้วจะกรอกไม่ได้จริง
--
-- ปลอดภัยกับข้อมูลเดิม: เพิ่มคอลัมน์ที่ยอมให้ว่างได้ ไม่แตะแถวไหนทั้งสิ้น
-- รันซ้ำได้ (IF NOT EXISTS)
--
-- ก่อนรัน: ช่องกรอก 2 ช่องนี้จะถูกซ่อนในหน้าแก้ไขเมนู และใบ SOP โชว์ "—"
-- หลังรัน: รีเฟรชหน้าเว็บหนึ่งครั้ง ช่องกรอกจะขึ้นมาเอง
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.menus add column if not exists prep_time text;
alter table public.menus add column if not exists packaging  text;

-- วัตถุดิบก็พิมพ์ใบ SOP หน้าตาเดียวกัน ใช้คอลัมน์ชื่อเดียวกัน
alter table public.ingredients add column if not exists prep_time text;
alter table public.ingredients add column if not exists packaging  text;

-- ตรวจผล — ต้องได้ 4 แถว
select table_name, column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name in ('menus','ingredients')
  and column_name in ('prep_time','packaging')
order by table_name, column_name;
