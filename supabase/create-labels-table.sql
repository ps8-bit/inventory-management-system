-- ════════════════════════════════════════════════════════════════════
--  labels table — shipping-label queue, synced across devices.
--  Shape matches dbUpsertLabels/dbLoadLabels in supabase.jsx:
--    id text PK · so_id text · data jsonb (whole label object) · created_at
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.labels (
  id         text primary key,
  so_id      text,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Role-based RLS (same model as the other tables):
--   read: any signed-in user · write: admin/manager/staff · delete: admin/manager
alter table public.labels enable row level security;

drop policy if exists "read"   on public.labels;
drop policy if exists "insert" on public.labels;
drop policy if exists "update" on public.labels;
drop policy if exists "delete" on public.labels;

create policy "read"   on public.labels for select using (auth.role() = 'authenticated');
create policy "insert" on public.labels for insert with check (public.auth_role() in ('admin','manager','staff'));
create policy "update" on public.labels for update using (public.auth_role() in ('admin','manager','staff')) with check (public.auth_role() in ('admin','manager','staff'));
create policy "delete" on public.labels for delete using (public.auth_role() in ('admin','manager'));

-- Enable realtime so label changes broadcast to other open devices.
alter publication supabase_realtime add table public.labels;
