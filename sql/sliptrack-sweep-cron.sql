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

-- Every minute → fire-and-forget HTTP POST to the sweep endpoint. The endpoint itself only acts
-- on POs untouched for ≥2 min (so it never races the browser's own push) and processes a bounded
-- batch per run.
select cron.schedule(
  'sliptrack-sweep',
  '* * * * *',
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
