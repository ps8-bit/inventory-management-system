-- ============================================================
--  Rename an existing product's SKU (correct a wrong code) — 2026-09-23
--
--  products.sku is the PRIMARY KEY, referenced by bundle_items, stock_adjustments
--  and product_locations with `on delete cascade` but NO `on update cascade` —
--  so a plain `update products set sku = ...` would be rejected by every one of
--  those foreign keys the moment a child row still points at the old value.
--
--  Fix, in two parts:
--   1. Add `on update cascade` to the three FKs so a PK rename propagates to
--      every dependent row atomically, enforced by Postgres itself — not hand-
--      rolled multi-statement updates that would need to out-race the FK checks.
--   2. A `rename_product_sku` RPC that does the actual UPDATE. SECURITY DEFINER
--      (not INVOKER, unlike adjust_stock/deduct_stock): the cascade has to reach
--      product_locations under `within_work_hours()` RLS regardless of when the
--      admin/manager runs it, and the function does its OWN admin/manager check
--      up front instead of relying on row policies — this moves stock's own
--      address, not a display field, so it stays out of the editProduct capability
--      (server list admin+manager only — see CAPS.renameSku in data.jsx) and
--      capServerLocked keeps the UI from ever offering the button to staff.
--
--  Deliberately NOT touched: order_items.sku / orders.lineItems have no FK to
--  products (order rows are point-in-time snapshots), so a rename leaves every
--  past order showing the code it was placed under — that is intentional, not
--  a bug this migration should "fix".
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
-- ============================================================

-- 1. Re-point the three FKs to cascade on UPDATE too (constraint name looked
--    up dynamically so this doesn't depend on Postgres's default naming).
do $$
declare
  r record;
begin
  for r in
    select tc.constraint_name, tc.table_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name in ('bundle_items', 'stock_adjustments', 'product_locations')
      and kcu.column_name = 'sku'
      and ccu.table_name = 'products'
  loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.constraint_name);
  end loop;
end $$;

alter table public.bundle_items
  add constraint bundle_items_sku_fkey
  foreign key (sku) references public.products(sku) on delete cascade on update cascade;

alter table public.stock_adjustments
  add constraint stock_adjustments_sku_fkey
  foreign key (sku) references public.products(sku) on delete cascade on update cascade;

alter table public.product_locations
  add constraint product_locations_sku_fkey
  foreign key (sku) references public.products(sku) on delete cascade on update cascade;

-- 2. The rename RPC itself.
create or replace function public.rename_product_sku(p_old_sku text, p_new_sku text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_sku text := nullif(trim(p_old_sku), '');
  new_sku text := nullif(trim(p_new_sku), '');
begin
  if public.auth_role() not in ('admin', 'manager') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if old_sku is null or new_sku is null then
    raise exception 'sku required' using errcode = '22023';
  end if;
  if old_sku = new_sku then
    return jsonb_build_object('sku', new_sku);
  end if;
  if not exists (select 1 from public.products where sku = old_sku) then
    raise exception 'sku not found: %', old_sku using errcode = 'P0002';
  end if;
  if exists (select 1 from public.products where sku = new_sku) then
    raise exception 'sku already exists: %', new_sku using errcode = '23505';
  end if;

  update public.products set sku = new_sku, updated_at = now() where sku = old_sku;
  -- bundle_items / stock_adjustments / product_locations follow via
  -- on update cascade (added above) — no manual child updates needed.

  return jsonb_build_object('sku', new_sku);
end $$;

revoke all on function public.rename_product_sku(text, text) from public, anon;
grant execute on function public.rename_product_sku(text, text) to authenticated;

notify pgrst, 'reload schema';
