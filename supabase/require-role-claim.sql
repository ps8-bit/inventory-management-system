-- ════════════════════════════════════════════════════════════════════
--  Reads require an explicit app_metadata.role claim (2026-10-21)
--
--  Hole found by the 2026-10-21 audit: every public table's SELECT policy
--  was `auth.role() = 'authenticated'`, and public.auth_role() defaults to
--  'viewer' when the claim is missing. Supabase Auth public sign-up was ON,
--  so anyone who registered and confirmed an email got a session with NO
--  app_metadata.role and could read every order, label (customer names,
--  phones, addresses), order_files (label PDFs), stock and audit_log row.
--
--  The owner switches off "Allow new users to sign up" in the dashboard
--  (the app never calls signUp — invites and invite codes go through the
--  admin API). This file is the second layer: a role-less account reads
--  NOTHING even if sign-up is ever turned back on.
--
--    1. public.has_role_claim() — true only when the JWT carries
--       app_metadata.role in ('admin','manager','staff','packer','viewer').
--       app_metadata is writable by the service role only, so it can't be
--       self-assigned the way user_metadata can. ADD A NEW ROLE HERE TOO,
--       or that role reads nothing.
--    2. The "read" policy of all 14 data tables uses it.
--    3. products_v (security_invoker = false — it bypasses products' RLS and
--       repeats the read rule itself) uses it in its WHERE.
--    4. audit_log / stock_ops INSERT go from "any authenticated" to it.
--    5. actor_names() (SECURITY DEFINER over auth.users) requires it.
--
--  Every other write/delete policy is left exactly as it is: they already
--  check auth_role() against a list that never includes 'viewer', so a
--  role-less caller (auth_role() = 'viewer') could not write before either.
--  No policy here uses within_work_hours() — keep it that way (see
--  product-locations-policy-fix.sql for what a one-sided time gate did).
--
--  Older scripts (rls-policies.sql, create-*-table.sql, stock-op-
--  idempotency.sql, protect-cost-column.sql, sale-price-lead-time.sql, …)
--  were updated to the same rule, so re-running one no longer re-opens it.
--
--  The policy calls are wrapped in (select …) so Postgres evaluates the
--  claim once per statement (InitPlan), not once per row.
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
--  หรือ: npx supabase db query --linked --file supabase/require-role-claim.sql
--  ทั้งไฟล์อยู่ในทรานแซกชันเดียว — ถ้าการตรวจท้ายไฟล์ไม่ผ่าน จะไม่มีอะไรเปลี่ยน
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. The claim check ──────────────────────────────────────────────────
create or replace function public.has_role_claim()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')
         in ('admin', 'manager', 'staff', 'packer', 'viewer')
$$;

revoke all on function public.has_role_claim() from public;
-- anon too: it evaluates these policies on any table request and must get
-- 0 rows back, not a "permission denied for function" error.
grant execute on function public.has_role_claim() to anon, authenticated, service_role;

-- 2. Read policies ────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'products', 'orders', 'order_items', 'bundles', 'bundle_items',
    'stock_adjustments', 'labels', 'app_state', 'product_locations',
    'order_files', 'order_attachments', 'audit_log', 'store_settings',
    'stock_ops'
  ] loop
    if to_regclass('public.' || t) is null then
      raise exception 'table public.% not found — nothing applied', t;
    end if;
    execute format('drop policy if exists "read" on public.%I', t);
    execute format(
      'create policy "read" on public.%I for select using ((select public.has_role_claim()))', t);
  end loop;
end $$;

-- 3. Inserts that were open to any signed-in account ────────────────────
drop policy if exists "insert" on public.audit_log;
create policy "insert" on public.audit_log for insert
  with check ((select public.has_role_claim()));

drop policy if exists "insert" on public.stock_ops;
create policy "insert" on public.stock_ops for insert
  with check ((select public.has_role_claim()));

-- 4. products_v — same columns as live (protect-cost-column.sql +
--    sale-price-lead-time.sql), only the WHERE changes. CREATE OR REPLACE
--    keeps the grants; they are re-asserted below anyway.
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
  where (select public.has_role_claim());   -- mirrors the products "read" policy

revoke all on public.products_v from anon, public;
revoke all on public.products_v from authenticated;
grant select on public.products_v to authenticated;

-- 5. actor_names — signed in AND holding a role ───────────────────────
create or replace function public.actor_names(ids uuid[])
returns table (id uuid, name text)
language sql stable security definer set search_path = public, auth as $$
  select u.id,
         coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)) as name
    from auth.users u
   where auth.uid() is not null
     and public.has_role_claim()
     and u.id = any(ids);
$$;

revoke all on function public.actor_names(uuid[]) from public, anon;
grant execute on function public.actor_names(uuid[]) to authenticated;

-- 6. Verify before committing — any failure rolls the whole file back ──
do $$
declare
  bad text;
begin
  -- every data table's SELECT policy uses the claim check
  select string_agg(t, ', ') into bad
    from unnest(array[
      'products', 'orders', 'order_items', 'bundles', 'bundle_items',
      'stock_adjustments', 'labels', 'app_state', 'product_locations',
      'order_files', 'order_attachments', 'audit_log', 'store_settings',
      'stock_ops'
    ]) t
   where not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t
        and p.cmd = 'SELECT' and p.qual like '%has_role_claim%');
  if bad is not null then raise exception 'read policy not switched on: %', bad; end if;

  -- no policy in public still grants on "signed in" alone
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and coalesce(qual, '') || coalesce(with_check, '') like '%auth.role()%';
  if bad is not null then raise exception 'policies still keyed on auth.role(): %', bad; end if;

  -- no time gate anywhere
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and coalesce(qual, '') || coalesce(with_check, '') like '%within_work_hours%';
  if bad is not null then raise exception 'within_work_hours() found in: %', bad; end if;

  -- the cost view repeats the rule
  if pg_get_viewdef('public.products_v'::regclass) not like '%has_role_claim%'
     or pg_get_viewdef('public.products_v'::regclass) like '%auth.role()%' then
    raise exception 'products_v WHERE was not updated';
  end if;
  if not exists (select 1 from pg_class
                  where oid = 'public.products_v'::regclass
                    and reloptions @> array['security_invoker=false']) then
    raise exception 'products_v lost security_invoker=false';
  end if;

  -- no RLS-less table in public that a client role can read
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
     and (has_table_privilege('anon', c.oid, 'SELECT')
          or has_table_privilege('authenticated', c.oid, 'SELECT'));
  if bad is not null then raise exception 'tables without RLS readable by clients: %', bad; end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ตรวจผล:
--   select tablename, policyname, cmd, coalesce(qual, with_check) as expr
--   from pg_policies where schemaname = 'public' order by tablename, cmd;
