-- Live stock across devices + close anonymous read of orders (2026-09-30).
-- Paste into the Supabase SQL editor and Run. Safe to re-run.
--
-- 1) Publish the tables the app already listens to (setupRealtimeSync in
--    supabase.jsx). Until now the publication held only app_state + labels, so
--    a sale on one phone never reached another device until it reloaded.
--    `products` is deliberately NOT published: postgres_changes payloads carry
--    the whole row and staff have no SELECT on products.cost. Stock movements
--    arrive through stock_adjustments (one row per movement, no cost) and the
--    client reloads the catalog through products_v, which masks cost per role.
do $$
declare t text;
begin
  foreach t in array array['stock_adjustments','product_locations','orders',
                           'audit_log','store_settings','bundles','bundle_items']
  loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 2) orders were readable by ANYONE holding the public anon key (policy "read"
--    allowed role anon): customer names, phones and addresses. The public
--    tracking page now uses only the track-lookup Edge Function (service role,
--    server-side filtering, masked phones), so reads become authenticated-only.
--    Publishing orders without this would also stream every new order to
--    anonymous realtime subscribers.
alter policy "read" on public.orders using (auth.role() = 'authenticated');

-- Check: expect the 7 tables above plus app_state and labels, and the orders
-- policy without 'anon'.
select
  (select string_agg(tablename, ', ' order by tablename) from pg_publication_tables
    where pubname = 'supabase_realtime') as published_tables,
  (select qual from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'read') as orders_read_policy;
