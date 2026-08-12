-- ══════════════════════════════════════════════════════════════════════════
-- NAIWANSOOK FOODCOST — SlipTrack sweep cron (Supabase pg_cron). Run ONCE in the SQL editor.
--
-- WHY: PO → accounting (SlipTrack) is pushed by the browser the moment a PO is received/paid/cancelled.
-- That push is best-effort — a network blip or a closed tab can drop it silently. This schedules
-- a SERVER-SIDE sweep that needs no client open: every minute it pings /api/sliptrack-sweep, which
-- re-posts any PO whose sync flag is still null or 'failed' — a bill for awaiting_payment/paid, a
-- VOID for cancelled. Idempotent (SlipTrack upserts by external_id), so re-posting an already-synced
-- PO is a no-op.
--
-- BEFORE RUNNING:
--   1. In Vercel → Settings → Environment Variables, add:
--        SLIPTRACK_SWEEP_KEY = <a long random secret you choose>
--      (SLIPTRACK_API_KEY must already be set — same token the live push uses.)
--   2. Redeploy so the new env var + /api/sliptrack-sweep are live.
--   3. Replace <YOUR_SWEEP_KEY> below with the SAME value you set for SLIPTRACK_SWEEP_KEY.
--      ⚠️ Do NOT commit the real key — this file lives in a PUBLIC repo. Keep the placeholder here
--         and paste the real value only into the SQL editor when you run it.
--   4. If your app is on a custom domain, change the host in the URL below.
-- ══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-runnable: drop the old schedule first if it exists.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sliptrack-sweep') then
    perform cron.unschedule('sliptrack-sweep');
  end if;
end $$;

-- ⚠️ ทุก 10 นาที — ห้ามกลับไปเป็น '* * * * *' เด็ดขาด
--
-- เดิมตั้งไว้ทุกนาที = 1,440 ครั้ง/วัน = 43,200 ครั้ง/เดือน ยิงตลอด 24 ชม. แม้ร้านปิด
-- และ 99.9% ของรอบนั้น "ไม่มีงานให้ทำเลย" (ตรวจจริง 12 ส.ค. 69: ค้าง 0 ใบ จาก 217 ใบที่ซิงก์แล้ว)
-- แต่ละรอบยังต้องปลุกฟังก์ชัน + คุยกับ Supabase = กิน Fluid Active CPU จริงทุกครั้ง
-- คิดที่ 0.2–0.25 วิ/รอบ ก็กินโควตาฟรี 4 ชม./เดือน ไปราว 60–75% โดยไม่ได้อะไรกลับมาเลย
--
-- ทุก 10 นาที = 144 ครั้ง/วัน (ลดลง 90%) และไม่ได้ทำให้การรับประกันหายไป:
-- ตัวที่ผลักเข้าบัญชีจริงคือเบราว์เซอร์ ซึ่งยิงทันทีที่รับของ/จ่ายเงิน/ยกเลิก
-- cron ตัวนี้เป็นแค่ตาข่ายรองรับกรณีเน็ตหลุด/ปิดแท็บ ซึ่งนานๆ เกิดที
-- ผลที่ต่างกันคือ "ใบที่หลุดจริง" เข้าบัญชีช้าสุด 10 นาทีแทน 1 นาที — งานบัญชีรับได้สบาย
-- (endpoint เองก็เว้น 2 นาทีก่อนแตะใบใหม่อยู่แล้ว กันชนกับ push ของเบราว์เซอร์)
select cron.schedule(
  'sliptrack-sweep',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://foodcost-eta.vercel.app/api/sliptrack-sweep?key=<YOUR_SWEEP_KEY>',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 8000
    );
  $$
);

-- ── Verify / operate ────────────────────────────────────────────────────────
-- List the job:            select jobid, jobname, schedule, active from cron.job where jobname='sliptrack-sweep';
-- Recent run status:       select * from cron.job_run_details where jobid=(select jobid from cron.job where jobname='sliptrack-sweep') order by start_time desc limit 10;
-- pg_net responses:        select id, status_code, content from net._http_response order by created desc limit 10;
-- Pause it:                select cron.unschedule('sliptrack-sweep');
