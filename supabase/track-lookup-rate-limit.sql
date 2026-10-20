-- Durable per-IP throttle for the public track-lookup Edge Function.
-- Shared by every isolate (the old in-memory Map was per-isolate and keyed on a
-- client-controlled header, so it never fired). Called only with the service role.
create table if not exists public.track_lookup_hits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.track_lookup_hits enable row level security;  -- no policies: no client access
revoke all on public.track_lookup_hits from anon, authenticated;

-- Count one hit; returns true while under p_max hits in the current window.
create or replace function public.track_lookup_hit(p_key text, p_window_s int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  n int;
begin
  insert into public.track_lookup_hits as t (key, window_start, hits)
  values (left(p_key, 100), w, 1)
  on conflict (key, window_start) do update set hits = t.hits + 1
  returning hits into n;
  if random() < 0.01 then
    delete from public.track_lookup_hits where window_start < now() - interval '1 hour';
  end if;
  return n <= p_max;
end $$;
revoke all on function public.track_lookup_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.track_lookup_hit(text, int, int) to service_role;
