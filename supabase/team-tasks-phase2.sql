-- ════════════════════════════════════════════════════════════════════════
--  team_tasks phase 2 (2026-10-30). Run AFTER supabase/team-tasks.sql.
--  A. widen the type check for the phase-2 types (photo; recount/shelve are
--     reserved for a later pass).
--  B. team_tasks_guard: a non-manager may only move their OWN task through the
--     worker states and may not touch what the owner set (title, due, assignee,
--     expected lines, approved rounds, ...). Fields are silently restored, an
--     illegal status change is a hard error. Same idea as products_guard_cost.
--  C. weekly recurring templates + spawn_recurring_tasks() + daily pg_cron job.
--  Idempotent: safe to re-run. Drops no data.
-- ════════════════════════════════════════════════════════════════════════

-- A. allow the phase-2 task types (widening a CHECK is non-destructive)
alter table public.team_tasks drop constraint if exists team_tasks_type_check;
alter table public.team_tasks add constraint team_tasks_type_check
  check (type in ('receive', 'general', 'photo', 'recount', 'shelve'));

-- B. non-managers may only move their own task through the worker states and may not
--    touch what the owner set. Silent restore for fields, hard error for status.
create or replace function public.team_tasks_guard() returns trigger
language plpgsql as $$
declare
  k text;
  locked text[] := array['lines', 'rounds', 'items', 'trk', 'supplier', 'selfBy', 'recurringId'];
begin
  if auth.uid() is null then return new; end if;                     -- service role / cron
  if public.auth_role() in ('admin', 'manager') then return new; end if;
  new.type := old.type;            new.title := old.title;
  new.due := old.due;              new.assignee := old.assignee;
  new.assignee_name := old.assignee_name;
  new.created_by := old.created_by; new.created_by_name := old.created_by_name;
  new.created_at := old.created_at;
  foreach k in array locked loop
    if old.data ? k then new.data := jsonb_set(new.data, array[k], old.data -> k, true);
    else new.data := new.data - k; end if;
  end loop;
  if new.status is distinct from old.status then
    if not (
         (old.status in ('todo', 'doing', 'back', 'partial') and new.status in ('doing', 'review', 'blocked'))
      or (old.type = 'photo' and old.status in ('todo', 'doing') and new.status = 'done')
    ) then
      raise exception 'ไม่มีสิทธิ์เปลี่ยนสถานะงานจาก % เป็น %', old.status, new.status using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists team_tasks_guard on public.team_tasks;
create trigger team_tasks_guard before update on public.team_tasks
  for each row execute function public.team_tasks_guard();

-- C. weekly recurring tasks (general type)
create table if not exists public.team_task_templates (
  id              text primary key,
  title           text not null,
  items           jsonb not null default '[]'::jsonb,
  assignee        uuid not null,
  assignee_name   text,
  weekday         int  not null check (weekday between 0 and 6),   -- 0 = Sunday (JS getDay)
  active          boolean not null default true,
  created_by      uuid default auth.uid(),
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.team_task_templates enable row level security;
revoke all on public.team_task_templates from anon;
grant select, insert, update, delete on public.team_task_templates to authenticated;
drop policy if exists "tpl_all" on public.team_task_templates;
create policy "tpl_all" on public.team_task_templates for all
  using (public.auth_role() in ('admin', 'manager'))
  with check (public.auth_role() in ('admin', 'manager'));

-- Creates this week's instance of every active template whose day has come (Bangkok time).
-- Deterministic id → re-running never duplicates. Callable by anyone signed in (harmless).
create or replace function public.spawn_recurring_tasks() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Bangkok')::date;
  t record; d date; n int := 0; c int;
begin
  for t in select * from public.team_task_templates where active loop
    d := date_trunc('week', today)::date + ((t.weekday + 6) % 7);
    if d > today or d < (t.created_at at time zone 'Asia/Bangkok')::date then continue; end if;
    insert into public.team_tasks (id, type, status, title, assignee, assignee_name, created_by, created_by_name, due, data)
    values ('R' || t.id || '-' || to_char(d, 'YYYYMMDD'), 'general', 'todo', t.title, t.assignee, t.assignee_name,
            t.created_by, coalesce(t.created_by_name, 'ระบบ'), d,
            jsonb_build_object('items', t.items, 'checked', '[]'::jsonb, 'recurringId', t.id,
              'log', jsonb_build_array(jsonb_build_object('at', now(), 'by', 'ระบบ',
                     'text', 'สร้างอัตโนมัติ (งานประจำทุกสัปดาห์) · มอบหมายให้ ' || coalesce(t.assignee_name, '')))))
    on conflict (id) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;
revoke all on function public.spawn_recurring_tasks() from public, anon;
grant execute on function public.spawn_recurring_tasks() to authenticated;

-- Daily 00:05 Bangkok (17:05 UTC). Skipped silently if pg_cron isn't installed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin perform cron.unschedule('team-tasks-recurring'); exception when others then null; end;
    perform cron.schedule('team-tasks-recurring', '5 17 * * *', 'select public.spawn_recurring_tasks()');
  end if;
end $$;
