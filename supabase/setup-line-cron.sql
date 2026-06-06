-- ============================================================================
-- Daily low-stock LINE digest — schedule the line-alert Edge Function via cron.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor) AFTER you
-- have set the Edge Function secrets LINE_CHANNEL_ACCESS_TOKEN and CRON_SECRET.
-- (The chatbot — line-bot — also needs LINE_CHANNEL_SECRET, set in the same place,
--  plus the channel's Webhook URL pointed at …/functions/v1/line-bot.)
-- Re-runnable: it unschedules any previous job first.
--
-- Before running: replace  PUT-YOUR-CRON-SECRET-HERE  with the SAME value you
-- set as the CRON_SECRET edge-function secret.
-- ============================================================================

-- 1. Extensions (no-op if already enabled). Also enable them under
--    Database → Extensions if these fail due to permissions.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Remove any previous schedule with this name (safe if it doesn't exist).
do $$
begin
  perform cron.unschedule('line-lowstock-daily');
exception when others then
  null;
end $$;

-- 3. Schedule: every day at 01:00 UTC = 08:00 Asia/Bangkok (ICT).
--    Change '0 1 * * *' to adjust the time (cron runs in UTC).
select cron.schedule(
  'line-lowstock-daily',
  '0 1 * * *',
  $$
  select net.http_post(
    url     := 'https://eayufrfkmpeeeuaimvqw.supabase.co/functions/v1/line-alert',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4. Verify it was scheduled:
--    select jobname, schedule, active from cron.job where jobname = 'line-lowstock-daily';
--
-- To send a one-off test right now without waiting for the schedule, either click
-- "ส่งทดสอบ" in the app's Settings page, or run the http_post block from step 3
-- on its own in the SQL editor.
