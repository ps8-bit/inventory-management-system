-- ============================================================================
-- ต้องจัดการ phase 4 — actual sale price + supplier lead time (2026-10-14)
--
-- 1. stock_adjustments.unit_price — the price a ขายออก line was REALLY sold at
--    (discounts included). Analytics used today's catalog price for every
--    ปรับสต็อก/ขายออก sale, so promo results and revenue ignored discounts.
--    NULL = not recorded (older rows, non-sale moves) → the client falls back
--    to the catalog price, exactly as before.
-- 2. products.lead_days — days from ordering to the stock arriving. Drives the
--    board's "ใกล้หมด" threshold and reorder quantity. NULL = unknown → the
--    old fixed 14 / 30 days.
--
-- products_v must list every column the client needs (dbLoadProducts reads the
-- view, never the table), so lead_days is appended to it. CREATE OR REPLACE
-- VIEW keeps the view's options (security_invoker = false) and grants when a
-- column is only added at the end. Re-runnable.
-- ============================================================================

alter table public.stock_adjustments add column if not exists unit_price numeric;
alter table public.products add column if not exists lead_days integer;
alter table public.products drop constraint if exists products_lead_days_range;
alter table public.products add constraint products_lead_days_range
  check (lead_days is null or (lead_days >= 0 and lead_days <= 365));

create or replace view public.products_v
with (security_invoker = false) as
 select sku,
    name,
    cat,
        case
            when auth_role() = any (array['admin'::text, 'manager'::text]) then cost
            else null::numeric
        end as cost,
    price,
    qty,
    reserved,
    reorder,
    loc,
    supplier,
    created_at,
    updated_at,
    brand,
    lead_days
   from products p
  where (select public.has_role_claim());   -- require-role-claim.sql

-- products has COLUMN-level SELECT grants (protect-cost-column.sql), so a new
-- column is invisible to `authenticated` until granted. Not cost — just the
-- lead time, which every role may read.
grant select (lead_days) on public.products to authenticated;

notify pgrst, 'reload schema';
