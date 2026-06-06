-- ════════════════════════════════════════════════════════════════════
--  Role-based Row Level Security for คลังพร้อมส่ง IMS
--  Applied 2026-05-30. Re-runnable (idempotent): drops all existing
--  policies first, then recreates the granular set.
--
--  Role source: auth.jwt() -> 'app_metadata' -> 'role'
--  app_metadata is NOT user-editable (only the service role / Edge Function
--  can set it), so a user cannot escalate their own privileges. Never read
--  the role from user_metadata for authz — that field IS user-editable.
-- ════════════════════════════════════════════════════════════════════

-- 1. Backfill app_metadata.role from user_metadata.role for existing users.
--    Existing sessions must re-login (or wait for token refresh) for the new
--    claim to appear in their JWT.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', coalesce(raw_user_meta_data->>'role', 'viewer'))
where raw_app_meta_data->>'role' is null;

-- 2. Helper: the caller's role, read from the (tamper-proof) app_metadata claim.
create or replace function public.auth_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'viewer')
$$;

-- 2b. Working-hours gate (see create-workhours-rls.sql for full docs). Defined
--     here too so a full re-run of this file recreates the helpers the write
--     policies below depend on. Returns true for roles the schedule doesn't
--     govern, so admin/manager are unaffected by default.
create or replace function public.hhmm_to_min(t text) returns int
language sql immutable as $$
  select case
    when t ~ '^[0-9]{1,2}:[0-9]{2}$'
         and split_part(t, ':', 1)::int between 0 and 23
         and split_part(t, ':', 2)::int between 0 and 59
    then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int
    else null
  end;
$$;

create or replace function public.within_work_hours() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text := public.auth_role();
  wh jsonb; v_roles jsonb; v_local timestamp; v_today text; v_dow int; v_min int;
  day_cfg jsonb; v_open int; v_close int;
begin
  select value -> 'workHours' into wh from public.store_settings where key = 'main';
  if wh is null then return true; end if;
  if coalesce((wh ->> 'enabled')::boolean, false) = false then return true; end if;
  v_roles := wh -> 'roles';
  if v_roles is null or not (v_roles ? v_role) then return true; end if;
  v_local := (now() at time zone 'Asia/Bangkok');
  v_today := to_char(v_local, 'YYYY-MM-DD');
  -- per-user today-only outside-hours pass (granted from User Management)
  if auth.uid() is not null and (wh -> 'exceptions' ->> auth.uid()::text) = v_today then return true; end if;
  v_dow   := extract(dow  from v_local)::int;
  v_min   := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  day_cfg := wh -> 'days' -> v_dow::text;
  if day_cfg is null then return false; end if;
  if coalesce((day_cfg ->> 'on')::boolean, false) = false then return false; end if;
  v_open  := public.hhmm_to_min(day_cfg ->> 'open');
  v_close := public.hhmm_to_min(day_cfg ->> 'close');
  if v_open is null or v_close is null then return true; end if;
  if v_close > v_open then return v_min >= v_open and v_min < v_close;
  else return v_min >= v_open or v_min < v_close; end if;
end;
$$;
grant execute on function public.hhmm_to_min(text)   to anon, authenticated;
grant execute on function public.within_work_hours() to anon, authenticated;

-- 3. Drop every existing policy in public (clears the wide-open trial policies).
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 4. Data tables — read: anyone signed in · write: admin/manager/staff · delete: admin/manager
--    labels + app_state share this exact model. They MUST be listed here because
--    step 3 above drops every policy in public — omitting them would leave those
--    tables with RLS enabled and no policy (deny-all) after a re-run. (Their
--    policies are also defined in create-labels-table.sql / create-app-state-table.sql
--    for fresh setups; the drop-if-exists there keeps both paths idempotent.)
do $$
declare t text;
begin
  foreach t in array array['products','orders','order_items','bundles','bundle_items','stock_adjustments','labels','app_state']
  loop
    execute format($f$create policy "read"   on public.%I for select using (auth.role() = 'authenticated')$f$, t);
    execute format($f$create policy "insert" on public.%I for insert with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours())$f$, t);
    execute format($f$create policy "update" on public.%I for update using (public.auth_role() in ('admin','manager','staff')) with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours())$f$, t);
    execute format($f$create policy "delete" on public.%I for delete using (public.auth_role() in ('admin','manager') and public.within_work_hours())$f$, t);
  end loop;
end $$;

-- 5. audit_log — append-only: anyone signed in can read + insert; only admin can delete; no updates.
create policy "read"   on public.audit_log for select using (auth.role() = 'authenticated');
create policy "insert" on public.audit_log for insert with check (auth.role() = 'authenticated');
create policy "delete" on public.audit_log for delete using (public.auth_role() = 'admin');

-- 6. store_settings — read: anyone signed in · write: admin/manager · delete: admin
create policy "read"   on public.store_settings for select using (auth.role() = 'authenticated');
create policy "insert" on public.store_settings for insert with check (public.auth_role() in ('admin','manager'));
create policy "update" on public.store_settings for update using (public.auth_role() in ('admin','manager')) with check (public.auth_role() in ('admin','manager'));
create policy "delete" on public.store_settings for delete using (public.auth_role() = 'admin');
