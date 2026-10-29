-- ============================================================================
-- ลงขายแล้วบน — which platforms each product is listed on (2026-10-29)
--
-- products.platforms = text[] of channel ids (shopee, lazada, tiktok, line,
-- web, facebook). Lets the shop filter "in stock but not listed on X yet" so
-- no product is forgotten on a platform.
--
-- products_v must list every column the client reads (dbLoadProducts reads the
-- view), so platforms is appended. CREATE OR REPLACE keeps options + grants
-- when a column is only added at the end. Re-runnable.
-- วิธีใช้: Supabase → SQL Editor → New query → วางไฟล์นี้ → Run
-- ============================================================================

alter table public.products add column if not exists platforms text[] not null default '{}';

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
    lead_days,
    platforms
   from products p
  where (select public.has_role_claim());   -- require-role-claim.sql

-- products has COLUMN-level SELECT grants (protect-cost-column.sql).
grant select (platforms) on public.products to authenticated;

notify pgrst, 'reload schema';
