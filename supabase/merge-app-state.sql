-- Server-side shallow merge for app_state jsonb values.
--
-- WHY: order_overrides (status/carrier/tracking/deleted for every order) is a
-- single app_state row. The old client path read the whole map, merged one order,
-- and upserted the ENTIRE map — so two devices editing DIFFERENT orders within the
-- realtime-latency window clobbered each other (last-write-wins lost update).
-- This function lets a writer send ONLY the changed order's entry and have Postgres
-- merge it into the stored map, so concurrent edits to different orders survive.
--
-- SECURITY INVOKER → the caller's own privileges apply, so app_state RLS still
-- gates who may write (staff/manager/admin per the existing policy). The shallow
-- `||` merge is enough because the client sends the complete per-order object as
-- the patch value ({ "<id>": { ...full entry... } }) and never deletes keys.
create or replace function merge_app_state(k text, patch jsonb)
returns text
language sql
security invoker
as $$
  insert into app_state (key, value, updated_at)
  values (k, patch, now())
  on conflict (key) do update
    set value = app_state.value || excluded.value,
        updated_at = now()
  returning key;
$$;

-- Callable by authenticated users; the RLS policy on app_state (not this grant)
-- decides whether the underlying write is allowed.
grant execute on function merge_app_state(text, jsonb) to authenticated;
