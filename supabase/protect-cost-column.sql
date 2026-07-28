-- ════════════════════════════════════════════════════════════════════
--  DATABASE-LEVEL PROTECTION FOR products.cost
--
--  The app already hides ต้นทุน/กำไร from roles without the viewCost
--  capability (data.jsx canDo → the screens + every export). That is a UI
--  gate: dbLoadProducts used to `select('*')`, so the cost of every SKU was
--  still delivered to the browser and readable from devtools.
--
--  This closes it in Postgres:
--    1. `authenticated` loses SELECT on the cost COLUMN (column-level grant,
--       so every other column still reads normally).
--    2. Reads go through public.products_v, a view that returns cost only to
--       admin/manager and NULL to everyone else. The view is deliberately NOT
--       security_invoker: it runs as its owner, which is the only way it can
--       read a column the caller may not. It therefore bypasses the table's
--       RLS, so it repeats the read rule (auth.role() = 'authenticated')
--       itself — if products' row policy is ever narrowed per-role, THIS VIEW
--       MUST BE NARROWED THE SAME WAY.
--    3. A BEFORE trigger keeps a caller that cannot see cost from writing it.
--       Without this the masking would destroy data: a staff client holds
--       cost = null/0 for every product, and dbUpsertProducts sends whole
--       rows, so the first save would wipe the real cost of every SKU.
--
--  Client side: supabase.jsx dbLoadProducts reads products_v. Every other
--  product call (upsert / update / delete / deduct_stock / adjust_stock)
--  targets the TABLE and only ever selects `sku` back, so none of them need
--  the cost column. The Edge Functions (line-bot, line-alert, backup-to-drive)
--  use the service_role key, which is unaffected by these grants.
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
-- ════════════════════════════════════════════════════════════════════

-- 1. Cost-masking read view ────────────────────────────────────────────
drop view if exists public.products_v;
create view public.products_v
with (security_invoker = false) as
select
  p.sku,
  p.name,
  p.cat,
  case when public.auth_role() in ('admin', 'manager') then p.cost else null end as cost,
  p.price,
  p.qty,
  p.reserved,
  p.reorder,
  p.loc,
  p.supplier,
  p.created_at,
  p.updated_at,
  p.brand
from public.products p
where auth.role() = 'authenticated';   -- mirrors the products "read" RLS policy

-- A single-table view is AUTO-UPDATABLE, and this one is not security_invoker,
-- so any write privilege on it would run as the owner and bypass the products
-- RLS entirely. Supabase's default privileges hand new objects in `public` full
-- CRUD, so strip everything back to SELECT — revoke first, then grant.
revoke all on public.products_v from anon, public;
revoke all on public.products_v from authenticated;
grant select on public.products_v to authenticated;

-- 2. Take the cost column away from the app's read role ────────────────
--    NOTE: revoking a COLUMN privilege while the role still holds the
--    TABLE-level one is a silent no-op in Postgres, so the table grant has to
--    go first and every other column is then granted back explicitly.
revoke select on public.products from authenticated;
grant select (sku, name, cat, price, qty, reserved, reorder, loc, supplier, created_at, updated_at, brand)
  on public.products to authenticated;

-- 3. Never let a cost-blind caller overwrite cost ──────────────────────
create or replace function public.guard_product_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- admin/manager can see cost, so their writes are taken at face value.
  if public.auth_role() in ('admin', 'manager') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.cost := old.cost;                 -- keep whatever is already stored
  else
    new.cost := coalesce(new.cost, 0);    -- new SKU from staff: keep their estimate
  end if;
  return new;
end;
$$;

drop trigger if exists products_guard_cost on public.products;
create trigger products_guard_cost
  before insert or update on public.products
  for each row execute function public.guard_product_cost();

-- 4. Let PostgREST pick up the new view + grants immediately.
notify pgrst, 'reload schema';
