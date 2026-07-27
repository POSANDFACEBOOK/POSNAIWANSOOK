-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — ส่งยอดตรวจนับสต๊อก + ทะเบียนทรัพย์สิน เข้าระบบบัญชี (SlipTrack)
-- รันครั้งเดียวใน Supabase SQL editor
--
-- ส่งอะไร:
--   • inventory_count — มูลค่าสต๊อกคงเหลือ (ต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก) ต่อ สาขา × หมวดบัญชี
--     ใช้ทำรายงาน "สินค้าและวัตถุดิบ (ม.87)" → ไหลต่อไปงบต้นทุนขาย/ภ.ง.ด.50
--   • fixed_asset — ทะเบียนทรัพย์สิน (บัญชีคิดค่าเสื่อมเส้นตรง ม.65 ทวิ ให้เอง)
--
-- ตั้งเวลา 23:45 น. เวลาไทย (= 16:45 UTC) — หลังสาขาปิดรอบนับสต๊อก (16:00–23:30) แล้ว
-- จึงเป็นยอด "ปลายวัน" ที่นิ่งแล้ว และวันสุดท้ายของเดือนจะกลายเป็นยอดปิดงวดโดยอัตโนมัติ
-- ยิงซ้ำได้ทุกวัน (idempotent) — ฝั่งบัญชีทับยอดเดิมของงวดนั้นให้
--
-- ก่อนรัน:
--   1. ต้อง deploy โค้ดที่มี /api/sliptrack-daily ขึ้น production แล้ว
--   2. env ที่ Vercel ต้องมี SLIPTRACK_API_KEY (มีอยู่แล้ว) และ SLIPTRACK_SWEEP_KEY (ตั้งไว้ตอนทำ PO sweep)
--   3. แทน <YOUR_SWEEP_KEY> ด้านล่างด้วยค่าเดียวกับ SLIPTRACK_SWEEP_KEY
--      ⚠️ repo เป็น PUBLIC — อย่า commit คีย์จริง ใส่ตอนวางใน SQL editor เท่านั้น
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- รันซ้ำได้: ลบตารางเวลาเดิมก่อน
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sliptrack-daily') then
    perform cron.unschedule('sliptrack-daily');
  end if;
end $$;

select cron.schedule(
  'sliptrack-daily',
  '45 16 * * *',      -- 16:45 UTC = 23:45 น. เวลาไทย ทุกวัน
  $$
    select net.http_post(
      url := 'https://foodcost-eta.vercel.app/api/sliptrack-daily?key=<YOUR_SWEEP_KEY>',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 55000
    );
  $$
);

-- ── ตรวจ / ใช้งาน ───────────────────────────────────────────────────────────
-- ดูตารางเวลา:      select jobid, jobname, schedule, active from cron.job where jobname='sliptrack-daily';
-- ผลการยิงล่าสุด:    select id, status_code, content from net._http_response order by created desc limit 5;
-- หยุดชั่วคราว:      select cron.unschedule('sliptrack-daily');
--
-- ลองด้วยมือก่อนได้ (ไม่ส่งจริง แค่คำนวณให้ดู):
--   https://foodcost-eta.vercel.app/api/sliptrack-daily?key=<YOUR_SWEEP_KEY>&dry=1
-- ส่งเฉพาะบางส่วน:  &only=stock  หรือ  &only=assets
