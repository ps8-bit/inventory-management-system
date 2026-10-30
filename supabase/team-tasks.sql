-- ════════════════════════════════════════════════════════════════════════
--  team_tasks — งานของทีม (2026-10-30). The owner/manager assigns a task to one
--  person; that person does it on their phone and reports; the owner approves.
--  Phase 1 types: 'receive' (expected delivery check: blind count, damaged,
--  photos, partial rounds) and 'general' (checklist + photo).
--
--  One row per task; everything type-specific (lines, rounds, photos, timeline)
--  lives in `data` jsonb. tasks.jsx writes the WHOLE row with an
--  `updated_at = <what I read>` guard, so two devices editing one task can't
--  silently overwrite each other — the loser gets 0 rows back and reloads.
--
--  RLS: admin/manager see and edit every task; anyone else sees and edits only
--  tasks assigned to them, and can't move a task to someone else. Only
--  admin/manager create; only admin deletes. Stock itself is never moved by
--  this table — approving a receive goes through the normal stock RPCs.
--  Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════════
create table if not exists public.team_tasks (
  id              text primary key,
  type            text not null check (type in ('receive', 'general')),
  status          text not null default 'todo'
                  check (status in ('todo', 'doing', 'review', 'back', 'partial', 'blocked', 'done', 'cancel')),
  title           text not null,
  assignee        uuid,
  assignee_name   text,
  created_by      uuid default auth.uid(),
  created_by_name text,
  due             date,
  data            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists team_tasks_assignee_idx on public.team_tasks (assignee);
create index if not exists team_tasks_created_idx on public.team_tasks (created_at desc);

create or replace function public.team_tasks_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists team_tasks_touch on public.team_tasks;
create trigger team_tasks_touch before update on public.team_tasks
  for each row execute function public.team_tasks_touch();

alter table public.team_tasks enable row level security;
revoke all on public.team_tasks from anon;
grant select, insert, update, delete on public.team_tasks to authenticated;

drop policy if exists "read"   on public.team_tasks;
drop policy if exists "insert" on public.team_tasks;
drop policy if exists "update" on public.team_tasks;
drop policy if exists "delete" on public.team_tasks;

create policy "read" on public.team_tasks for select using (
  public.auth_role() in ('admin', 'manager') or assignee = auth.uid()
);
create policy "insert" on public.team_tasks for insert with check (
  public.auth_role() in ('admin', 'manager')
);
create policy "update" on public.team_tasks for update
  using      (public.auth_role() in ('admin', 'manager') or assignee = auth.uid())
  with check (public.auth_role() in ('admin', 'manager') or assignee = auth.uid());
create policy "delete" on public.team_tasks for delete using (
  public.auth_role() = 'admin'
);

-- People a task can be assigned to (id + display name + role), for the assign
-- form. auth.users is not client-readable, hence SECURITY DEFINER; only
-- admin/manager get rows back, and never emails.
create or replace function public.task_assignees()
returns table (id uuid, name text, role text)
language sql stable security definer set search_path = public, auth as $$
  select u.id,
         coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)) as name,
         u.raw_app_meta_data->>'role' as role
    from auth.users u
   where public.auth_role() in ('admin', 'manager')
     and u.raw_app_meta_data->>'role' in ('admin', 'manager', 'staff', 'packer')
   order by 2;
$$;
revoke all on function public.task_assignees() from public, anon;
grant execute on function public.task_assignees() to authenticated;
