-- ════════════════════════════════════════════════════════════════════
--  app_state table — shared key-value store, realtime-synced across devices.
--  Holds data that used to be localStorage-only: categories, locations,
--  stock_adj, order_overrides. Shape matches dbLoadState/dbSaveState in
--  supabase.jsx: one row per key, value is arbitrary jsonb.
--    key text PK · value jsonb · updated_at timestamptz
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.app_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Role-based RLS (same model as the data tables):
--   read: any signed-in user · write: admin/manager/staff · delete: admin/manager
-- NOTE: rls-policies.sql also lists 'app_state' in its data-tables array, so a
-- re-run of that script recreates these policies. The drop-if-exists below keeps
-- this file idempotent for fresh setups.
alter table public.app_state enable row level security;

drop policy if exists "read"   on public.app_state;
drop policy if exists "insert" on public.app_state;
drop policy if exists "update" on public.app_state;
drop policy if exists "delete" on public.app_state;

create policy "read"   on public.app_state for select using (auth.role() = 'authenticated');
create policy "insert" on public.app_state for insert with check (public.auth_role() in ('admin','manager','staff'));
create policy "update" on public.app_state for update using (public.auth_role() in ('admin','manager','staff')) with check (public.auth_role() in ('admin','manager','staff'));
create policy "delete" on public.app_state for delete using (public.auth_role() in ('admin','manager'));

-- Enable realtime so KV changes broadcast to other open devices.
alter publication supabase_realtime add table public.app_state;
