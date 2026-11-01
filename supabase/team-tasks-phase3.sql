-- ════════════════════════════════════════════════════════════════════════
--  team_tasks phase 3 (2026-11-01). Run AFTER team-tasks.sql + team-tasks-phase2.sql.
--  A. team_task_settings      — who receives task reports (owner-editable, server-read)
--  B. team_task_push_log      — one row per (task, kind, key) actually notified → replay/spam guard
--  C. templates.evidence      — photo rule for recurring checklist tasks
--  D. team_tasks_guard v3     — + lock data.evidence, freeze data once submitted,
--                               refuse a 'review' without the required photos
--  E. spawn_recurring_tasks   — copies the template's evidence rule
--  F. realtime                — publish team_tasks so the owner sees progress live
--  Idempotent: safe to re-run. Drops no data.
-- ════════════════════════════════════════════════════════════════════════

-- A. report recipients (single row, id = 1)
create table if not exists public.team_task_settings (
  id              int primary key default 1 check (id = 1),
  report_roles    text[] not null default array['admin']::text[],
  report_users    uuid[] not null default '{}'::uuid[],
  telegram        boolean not null default true,
  updated_by_name text,
  updated_at      timestamptz not null default now()
);
insert into public.team_task_settings (id) values (1) on conflict (id) do nothing;
alter table public.team_task_settings enable row level security;
revoke all on public.team_task_settings from anon;
grant select, insert, update on public.team_task_settings to authenticated;
drop policy if exists "tts_read"   on public.team_task_settings;
drop policy if exists "tts_insert" on public.team_task_settings;
drop policy if exists "tts_update" on public.team_task_settings;
create policy "tts_read"   on public.team_task_settings for select using (public.auth_role() in ('admin', 'manager'));
create policy "tts_insert" on public.team_task_settings for insert with check (public.auth_role() = 'admin');
create policy "tts_update" on public.team_task_settings for update
  using (public.auth_role() = 'admin') with check (public.auth_role() = 'admin');

-- B. notification claim log — service role only (no client policy at all)
create table if not exists public.team_task_push_log (
  task_id text not null,
  kind    text not null,
  key     text not null,
  at      timestamptz not null default now(),
  primary key (task_id, kind, key)
);
alter table public.team_task_push_log enable row level security;
revoke all on public.team_task_push_log from anon, authenticated;

-- C. evidence rule on templates
alter table public.team_task_templates add column if not exists evidence text not null default 'one';
alter table public.team_task_templates drop constraint if exists team_task_templates_evidence_check;
alter table public.team_task_templates add constraint team_task_templates_evidence_check
  check (evidence in ('one', 'item', 'item2'));

-- D. guard v3 (phase-2 body + evidence lock, data freeze after submit, photo check on review)
create or replace function public.team_tasks_guard() returns trigger
language plpgsql as $$
declare
  k text;
  ev text; n int;
  pat constant text := '%/storage/v1/object/public/product-images/task/%';
  locked text[] := array['lines', 'rounds', 'items', 'trk', 'supplier', 'selfBy', 'recurringId', 'evidence'];
begin
  -- Server-owned status-transition stamp (every writer, managers included): the
  -- order-push replay guard keys on it, so a no-op update can't mint a new key.
  if new.status is distinct from old.status then
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{statusAt}', to_jsonb(clock_timestamp()::text), true);
  elsif old.data ? 'statusAt' then
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{statusAt}', old.data -> 'statusAt', true);
  else
    new.data := coalesce(new.data, '{}'::jsonb) - 'statusAt';
  end if;
  if auth.uid() is null then return new; end if;                     -- service role / cron
  if public.auth_role() in ('admin', 'manager') then return new; end if;
  new.type := old.type;            new.title := old.title;
  new.due := old.due;              new.assignee := old.assignee;
  new.assignee_name := old.assignee_name;
  new.created_by := old.created_by; new.created_by_name := old.created_by_name;
  new.created_at := old.created_at;
  new.id := old.id;
  foreach k in array locked loop
    if old.data ? k then new.data := jsonb_set(new.data, array[k], old.data -> k, true);
    else new.data := new.data - k; end if;
  end loop;
  -- prevStatus is set by the server, never trusted from the client (resume would
  -- otherwise jump to whatever the client wrote, e.g. 'done').
  if new.status = 'blocked' and old.status is distinct from 'blocked' then
    new.data := jsonb_set(new.data, '{prevStatus}', to_jsonb(old.status), true);
  elsif old.data ? 'prevStatus' then
    new.data := jsonb_set(new.data, '{prevStatus}', old.data -> 'prevStatus', true);
  else
    new.data := new.data - 'prevStatus';
  end if;
  -- The timeline is append-only for non-managers.
  if coalesce(jsonb_array_length(new.data -> 'log'), 0) < coalesce(jsonb_array_length(old.data -> 'log'), 0)
     or (old.data ? 'log' and (select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
           from jsonb_array_elements(new.data -> 'log') with ordinality x(e, ord)
           where ord <= jsonb_array_length(old.data -> 'log')) is distinct from old.data -> 'log') then
    new.data := jsonb_set(new.data, '{log}', coalesce(old.data -> 'log', '[]'::jsonb), true);
  end if;
  -- Evidence and counts are frozen once the report is in (or the task is closed).
  if old.status in ('review', 'done', 'cancel') then
    new.data := old.data;
  end if;
  -- A checklist report must carry the photos the owner required.
  if new.status = 'review' and old.status is distinct from 'review' and old.type = 'general' then
    ev := coalesce(new.data ->> 'evidence', 'one');
    n  := coalesce(jsonb_array_length(new.data -> 'items'), 0);
    if ev = 'one' then
      if coalesce(new.data ->> 'photo', '') not like pat then
        raise exception 'ต้องแนบรูปก่อนส่งรายงาน' using errcode = '23514';
      end if;
    else
      for ix in 0 .. n - 1 loop
        if coalesce(new.data -> 'itemPhotos' -> ix -> 'after' ->> 'u', '') not like pat
           or (ev = 'item2' and coalesce(new.data -> 'itemPhotos' -> ix -> 'before' ->> 'u', '') not like pat) then
          raise exception 'ต้องมีรูปครบทุกข้อก่อนส่งรายงาน' using errcode = '23514';
        end if;
      end loop;
    end if;
  end if;
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

-- E. recurring spawn copies the template's evidence rule
create or replace function public.spawn_recurring_tasks() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Bangkok')::date;
  t record; d date; n int := 0; c int;
begin
  for t in select * from public.team_task_templates where active loop
    d := date_trunc('week', today)::date + ((t.weekday + 6) % 7);
    if d > today or d < (t.created_at at time zone 'Asia/Bangkok')::date then continue; end if;
    -- re-enabled (or edited) mid-week: don't spawn this week's already-past day
    if d < (t.updated_at at time zone 'Asia/Bangkok')::date and d < today then continue; end if;
    insert into public.team_tasks (id, type, status, title, assignee, assignee_name, created_by, created_by_name, due, data)
    values ('R' || t.id || '-' || to_char(d, 'YYYYMMDD'), 'general', 'todo', t.title, t.assignee, t.assignee_name,
            t.created_by, coalesce(t.created_by_name, 'ระบบ'), d,
            jsonb_build_object('items', t.items, 'checked', '[]'::jsonb, 'recurringId', t.id,
              'evidence', t.evidence, 'itemPhotos', '[]'::jsonb,
              'log', jsonb_build_array(jsonb_build_object('at', now(), 'by', 'ระบบ',
                     'text', 'สร้างอัตโนมัติ (งานประจำทุกสัปดาห์) · มอบหมายให้ ' || coalesce(t.assignee_name, '')))))
    on conflict (id) do nothing;
    get diagnostics c = row_count; n := n + c;
  end loop;
  return n;
end $$;

-- F. realtime for team_tasks (RLS still applies: staff receive only their own rows)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'team_tasks') then
    execute 'alter publication supabase_realtime add table public.team_tasks';
  end if;
end $$;
