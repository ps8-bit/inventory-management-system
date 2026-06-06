-- ============================================================================
-- Nightly Google Drive backup — schedule the backup-to-drive Edge Function.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor) AFTER you
-- have set the function secrets (see SETUP-BACKUP.md):
--   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
--   GDRIVE_FOLDER_ID, CRON_SECRET  (and optionally BACKUP_RETENTION).
-- Re-runnable: it unschedules any previous job first.
--
-- Before running: replace  PUT-YOUR-CRON-SECRET-HERE  with the SAME value you
-- set as the CRON_SECRET edge-function secret.
-- ============================================================================

-- 1. Extensions (no-op if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Remove any previous schedule with this name (safe if it doesn't exist).
do $$
begin
  perform cron.unschedule('ims-nightly-backup');
exception when others then
  null;
end $$;

-- 3. Schedule: every day at 19:00 UTC = 02:00 Asia/Bangkok (ICT).
--    Change '0 19 * * *' to adjust the time (cron runs in UTC).
select cron.schedule(
  'ims-nightly-backup',
  '0 19 * * *',
  $$
  select net.http_post(
    url     := 'https://eayufrfkmpeeeuaimvqw.supabase.co/functions/v1/backup-to-drive',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', 'PUT-YOUR-CRON-SECRET-HERE'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- 4. Verify it was scheduled:
--    select jobname, schedule, active from cron.job where jobname = 'ims-nightly-backup';
--
-- To run a one-off test now (without waiting for the schedule), run the
-- net.http_post block from step 3 on its own in the SQL editor, then check your
-- Google Drive folder for a new ims-backup-*.json file.
