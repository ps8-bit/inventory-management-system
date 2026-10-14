-- Weekly sales action digest (line-alert mode "weekly") — Mondays 09:00 Bangkok.
-- Copies the daily low-stock job's command (and so its x-cron-secret header)
-- and only swaps the body, so the secret never has to be pasted here.
-- Requires the 'line-lowstock-daily' job from setup-line-cron.sql. Re-runnable.
do $$ begin perform cron.unschedule('line-sales-weekly'); exception when others then null; end $$;
select cron.schedule(
  'line-sales-weekly',
  '0 2 * * 1',
  replace(command, '''{}''::jsonb', '''{"mode":"weekly"}''::jsonb')
) from cron.job where jobname = 'line-lowstock-daily';
