-- ════════════════════════════════════════════════════════════════════
--  server_now() — returns the database's current wall-clock time.
--  Used by the working-hours access gate (see dbServerTimeMs in supabase.jsx)
--  so a restricted user (staff/viewer) can't get in outside their allowed
--  hours by changing their device clock. The time is evaluated server-side
--  and is therefore not spoofable from the browser.
--
--  Safe to expose: it leaks nothing but the current time and takes no input.
--  Until this is applied the app falls back to the device clock automatically.
--
--  Apply via Supabase → SQL Editor (idempotent — safe to re-run).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

-- Both signed-in users and the anon key may read the time.
grant execute on function public.server_now() to anon, authenticated;
