-- ════════════════════════════════════════════════════════════════════
--  product_locations: let staff DELETE a position row
--  Run once in the Supabase SQL editor.
--
--  WHY: selling the last piece off a shelf removes that row — saveLocSplit
--  drops rows whose qty hits 0 and dbSaveProductLocs DELETEs them. The
--  original policy allowed DELETE for admin/manager only, so a staff user
--  (the role that actually picks stock) would deduct the quantity fine and
--  then silently fail to clear the empty shelf, leaving a phantom pile that
--  the next realtime refetch resurrects.
--
--  Staff can already INSERT and UPDATE these rows, so allowing DELETE adds
--  no privilege they don't effectively have — it just stops the split from
--  drifting out of sync with products.qty.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "delete" on public.product_locations;
create policy "delete" on public.product_locations for delete
  using (public.auth_role() in ('admin','manager','staff') and public.within_work_hours());

-- Verify:
--   select policyname, cmd, qual from pg_policies
--   where schemaname='public' and tablename='product_locations' order by cmd;
--
-- Drift check (should return no rows):
--   select * from public.product_location_audit where diff <> 0;
