-- Web push subscriptions for order alerts (2026-10-12).
-- One row per browser/device that turned on "แจ้งเตือนออร์เดอร์บนเครื่องนี้".
-- The order-push Edge Function (service role) reads every row and sends the
-- notification; clients only ever touch their OWN rows.
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  role        text,
  ua          text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_sub_own_select on public.push_subscriptions;
create policy push_sub_own_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_sub_own_delete on public.push_subscriptions;
create policy push_sub_own_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Inserts/updates go through this function only. A push endpoint belongs to a
-- BROWSER, not a person: when someone else signs in on the same phone the row
-- must move to them, which a plain upsert can't do under "own rows" RLS.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_role text default null, p_ua text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' then raise exception 'bad endpoint'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, role, ua, updated_at)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_role, 20), left(p_ua, 200), now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        role = excluded.role, ua = excluded.ua, updated_at = now();
end $$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
