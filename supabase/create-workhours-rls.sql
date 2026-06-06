-- ════════════════════════════════════════════════════════════════════
--  Server-side enforcement of the working-hours access window.
--
--  The app already blocks off-hours sign-in + kicks restricted users out of
--  the UI, but a technically-skilled user could still call the database API
--  directly with a valid token. These policies close that gap: writes/deletes
--  by a *governed* role (e.g. staff/viewer) are rejected at the database level
--  when the current server time is outside the configured window.
--
--  The schedule is read from store_settings → value->'workHours' (the same
--  object the Settings UI edits). Time is evaluated in Asia/Bangkok from the
--  server clock, so a changed device clock has no effect here.
--
--  Logic mirrors workHoursStatus() in data.jsx exactly:
--    · feature off / role not listed  → allowed (not governed)
--    · day off or no config for today → blocked
--    · malformed open/close time      → allowed (fail open)
--    · close > open                   → [open, close)
--    · close <= open                  → overnight: minute >= open OR < close
--
--  Idempotent — safe to apply via Supabase → SQL Editor and to re-run.
--  NOTE: rls-policies.sql carries the same write policies; both files are kept
--  in sync so a full re-run of rls-policies.sql does not drop this enforcement.
-- ════════════════════════════════════════════════════════════════════

-- "HH:MM" → minutes since midnight, or NULL if malformed.
create or replace function public.hhmm_to_min(t text)
returns int
language sql
immutable
as $$
  select case
    when t ~ '^[0-9]{1,2}:[0-9]{2}$'
         and split_part(t, ':', 1)::int between 0 and 23
         and split_part(t, ':', 2)::int between 0 and 59
    then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int
    else null
  end;
$$;

-- True when the CALLER's role is allowed to write right now. Returns true for
-- any role the schedule does not govern (so admin/manager are unaffected by
-- default). SECURITY DEFINER so it can always read the schedule regardless of
-- the caller's RLS, and never recurses into the write policies.
create or replace function public.within_work_hours()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role   text := public.auth_role();
  wh       jsonb;
  v_roles  jsonb;
  v_local  timestamp;          -- "now" as Bangkok wall-clock
  v_today  text;               -- today's Bangkok date, YYYY-MM-DD
  v_dow    int;
  v_min    int;
  day_cfg  jsonb;
  v_open   int;
  v_close  int;
begin
  select value -> 'workHours' into wh
  from public.store_settings where key = 'main';

  if wh is null then return true; end if;
  if coalesce((wh ->> 'enabled')::boolean, false) = false then return true; end if;

  v_roles := wh -> 'roles';
  -- Not governed (role absent from the list) → always allowed.
  if v_roles is null or not (v_roles ? v_role) then return true; end if;

  v_local := (now() at time zone 'Asia/Bangkok');
  v_today := to_char(v_local, 'YYYY-MM-DD');

  -- Per-user "allow outside hours" pass, valid only for today (Bangkok). The
  -- admin grants it from the User Management screen; it auto-expires at midnight.
  if auth.uid() is not null
     and (wh -> 'exceptions' ->> auth.uid()::text) = v_today
  then return true; end if;

  v_dow   := extract(dow  from v_local)::int;                 -- 0=Sunday .. 6=Saturday
  v_min   := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

  day_cfg := wh -> 'days' -> v_dow::text;
  if day_cfg is null then return false; end if;
  if coalesce((day_cfg ->> 'on')::boolean, false) = false then return false; end if;

  v_open  := public.hhmm_to_min(day_cfg ->> 'open');
  v_close := public.hhmm_to_min(day_cfg ->> 'close');
  if v_open is null or v_close is null then return true; end if;  -- misconfigured → fail open

  if v_close > v_open then
    return v_min >= v_open and v_min < v_close;
  else
    return v_min >= v_open or v_min < v_close;                    -- overnight window
  end if;
end;
$$;

grant execute on function public.hhmm_to_min(text)      to anon, authenticated;
grant execute on function public.within_work_hours()    to anon, authenticated;

-- Re-create the write policies on the data tables to AND in the time gate.
-- store_settings is intentionally excluded so an admin can edit the schedule at
-- any time; audit_log stays append-only (logging is allowed regardless).
do $$
declare t text;
begin
  foreach t in array array['products','orders','order_items','bundles','bundle_items','stock_adjustments','labels','app_state']
  loop
    execute format('drop policy if exists "insert" on public.%I', t);
    execute format('drop policy if exists "update" on public.%I', t);
    execute format('drop policy if exists "delete" on public.%I', t);

    execute format($f$create policy "insert" on public.%I for insert
      with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours())$f$, t);

    execute format($f$create policy "update" on public.%I for update
      using (public.auth_role() in ('admin','manager','staff'))
      with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours())$f$, t);

    execute format($f$create policy "delete" on public.%I for delete
      using (public.auth_role() in ('admin','manager') and public.within_work_hours())$f$, t);
  end loop;
end $$;
