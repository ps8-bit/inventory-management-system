-- ═══════════════════════════════════════════════════════════════════════════
--  พนักงานแพ็ค (role "packer") + ใบปะหน้าแนบออร์เดอร์ (order_files)
--  Used by the แพ็คสินค้า page (pack-docs.jsx + the existing pack flow).
--
--  The packer may ONLY:
--    • save pick progress           → app_state key 'pack_progress'
--    • mark an order packed         → app_state key 'order_overrides' (setOrderField)
--    • re-point a pick to the shelf it really came from → product_locations
--  Everything else (products, orders, stock, other app_state keys, label files)
--  stays admin/manager/staff. Policies below reproduce the LIVE expressions
--  (checked 2026-10-06 via pg_policies) and only add the packer clause.
--  Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── app_state: packer may write exactly two keys ───────────────────────────
drop policy if exists "insert" on public.app_state;
drop policy if exists "update" on public.app_state;
create policy "insert" on public.app_state for insert with check (
  (public.auth_role() in ('admin','manager','staff') and (key <> 'role_perms' or public.auth_role() = 'admin'))
  or (public.auth_role() = 'packer' and key in ('pack_progress','order_overrides'))
);
create policy "update" on public.app_state for update using (
  (public.auth_role() in ('admin','manager','staff') and (key <> 'role_perms' or public.auth_role() = 'admin'))
  or (public.auth_role() = 'packer' and key in ('pack_progress','order_overrides'))
) with check (
  (public.auth_role() in ('admin','manager','staff') and (key <> 'role_perms' or public.auth_role() = 'admin'))
  or (public.auth_role() = 'packer' and key in ('pack_progress','order_overrides'))
);

-- ── product_locations: packer may re-point a pick (repointPackLine) ────────
drop policy if exists "insert" on public.product_locations;
drop policy if exists "update" on public.product_locations;
drop policy if exists "delete" on public.product_locations;
create policy "insert" on public.product_locations for insert with check (public.auth_role() in ('admin','manager','staff','packer'));
create policy "update" on public.product_locations for update
  using (public.auth_role() in ('admin','manager','staff','packer'))
  with check (public.auth_role() in ('admin','manager','staff','packer'));
create policy "delete" on public.product_locations for delete using (public.auth_role() in ('admin','manager','staff','packer'));

-- ── order_files: the courier label attached to an order ───────────────────
create table if not exists public.order_files (
  id          text primary key,                 -- the order id (SO-… / label-born id)
  name        text not null default '',
  type        text not null check (type in ('image/jpeg','application/pdf')),
  data_url    text not null,
  updated_at  timestamptz not null default now(),
  -- The payload must really be the declared type: a crafted "data:text/html"
  -- value opened as a blob would run script in the app's origin.
  constraint order_files_payload_chk check (
    (type = 'image/jpeg'      and data_url like 'data:image/jpeg;base64,%') or
    (type = 'application/pdf' and data_url like 'data:application/pdf;base64,%')
  ),
  constraint order_files_size_chk check (length(data_url) <= 3000000)
);
alter table public.order_files enable row level security;
drop policy if exists "read"   on public.order_files;
drop policy if exists "insert" on public.order_files;
drop policy if exists "update" on public.order_files;
drop policy if exists "delete" on public.order_files;
create policy "read"   on public.order_files for select using (auth.role() = 'authenticated');
create policy "insert" on public.order_files for insert with check (public.auth_role() in ('admin','manager','staff'));
create policy "update" on public.order_files for update
  using (public.auth_role() in ('admin','manager','staff'))
  with check (public.auth_role() in ('admin','manager','staff'));
create policy "delete" on public.order_files for delete using (public.auth_role() in ('admin','manager','staff'));

-- ── retire the separate งานแพ็คสินค้า tables (option B, never used — empty) ──
drop table if exists public.pack_files;
drop table if exists public.pack_orders;
drop function if exists public.pack_orders_guard();
