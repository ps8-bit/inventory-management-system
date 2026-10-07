-- ═══════════════════════════════════════════════════════════════════════════
--  Shelf reminder notes (โน้ตประจำช่อง) — OWNER (admin) ONLY.  2026-10-07
--
--  Notes live in their own app_state row 'pack_loc_notes' ({ "<loc>": {text,by,at} }).
--  They used to sit inside 'pack_progress', which packers MUST be able to write
--  (their pick ticks), so the database could not stop a packer from writing a
--  note. Now 'pack_loc_notes' gets the same admin-only gate as 'role_perms' on
--  insert / update / delete; everyone authenticated can still READ it (packers
--  need to see the notes). merge_app_state is SECURITY INVOKER, so the RPC path
--  is gated by these same policies.
--
--  Reproduces the live expressions (checked 2026-10-07 via pg_policies) and only
--  widens the admin-only key list. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════
drop policy if exists "insert" on public.app_state;
drop policy if exists "update" on public.app_state;
drop policy if exists "delete" on public.app_state;

create policy "insert" on public.app_state for insert with check (
  (public.auth_role() in ('admin','manager','staff') and (key not in ('role_perms','pack_loc_notes') or public.auth_role() = 'admin'))
  or (public.auth_role() = 'packer' and key in ('pack_progress','order_overrides'))
);
create policy "update" on public.app_state for update using (
  (public.auth_role() in ('admin','manager','staff') and (key not in ('role_perms','pack_loc_notes') or public.auth_role() = 'admin'))
  or (public.auth_role() = 'packer' and key in ('pack_progress','order_overrides'))
) with check (
  (public.auth_role() in ('admin','manager','staff') and (key not in ('role_perms','pack_loc_notes') or public.auth_role() = 'admin'))
  or (public.auth_role() = 'packer' and key in ('pack_progress','order_overrides'))
);
create policy "delete" on public.app_state for delete using (
  public.auth_role() in ('admin','manager') and (key not in ('role_perms','pack_loc_notes') or public.auth_role() = 'admin')
);

-- Check
select policyname, cmd, coalesce(with_check, qual) as rule
  from pg_policies where schemaname = 'public' and tablename = 'app_state' order by policyname;
