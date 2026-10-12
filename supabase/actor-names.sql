-- ════════════════════════════════════════════════════════════════════════
--  actor_names(ids) — display names for the login ids stamped on history rows
--  (2026-10-12). audit_log / stock_adjustments.actor_id come from auth.uid()
--  (supabase/ledger-before-after.sql), so they can't be faked; this turns them
--  back into the name the app shows, for ประวัติการแก้ไข and the order timeline.
--
--  auth.users is not readable by clients, hence SECURITY DEFINER. It returns
--  ONLY id + display name (user_metadata.name, else the email's local part —
--  the same fallback mapSessionToUser uses) for the ids asked, never emails or
--  roles, and only to signed-in users. Idempotent.
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.actor_names(ids uuid[])
returns table (id uuid, name text)
language sql stable security definer set search_path = public, auth as $$
  select u.id,
         coalesce(nullif(u.raw_user_meta_data->>'name', ''), split_part(u.email, '@', 1)) as name
    from auth.users u
   where auth.uid() is not null
     and u.id = any(ids);
$$;

revoke all on function public.actor_names(uuid[]) from public, anon;
grant execute on function public.actor_names(uuid[]) to authenticated;
