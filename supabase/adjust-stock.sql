-- ============================================================
--  Atomic SIGNED stock adjustment RPC — audit fix 2026-07-10 (#02)
--
--  Problem: inbound receiving, the qty stepper, and manual stock adjusts used to
--  write an ABSOLUTE qty computed from the device's local (possibly stale) copy,
--  via a whole-catalog upsert. Two devices adjusting the same sku — or one device
--  adjusting sku A while another sells sku B — clobbered each other's stock.
--
--  Fix: adjust on the server in one UPDATE per sku, qty = GREATEST(0, qty + delta).
--  Concurrent calls serialize on the row lock, so the result is exact. This is the
--  signed twin of deduct_stock (delta may be positive = receive, negative = remove).
--
--  วิธีใช้: เปิด Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
--
--  Security: SECURITY INVOKER → the UPDATE runs under the caller's RLS policies
--  (admin/manager/staff + within_work_hours), same gating as deduct_stock. A
--  viewer matches 0 rows → client surfaces PERMISSION_OR_MISSING.
-- ============================================================

create or replace function public.adjust_stock(adjustments jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  d record;
  r record;
  updated jsonb := '[]'::jsonb;
begin
  if adjustments is null or jsonb_typeof(adjustments) <> 'array' then
    return updated;
  end if;

  for d in
    select x->>'sku' as sku, (x->>'delta')::int as delta
    from jsonb_array_elements(adjustments) x
  loop
    if d.sku is null or d.delta is null or d.delta = 0 then
      continue;
    end if;

    update public.products
       set qty = greatest(0, qty + d.delta),
           updated_at = now()
     where sku = d.sku
     returning sku, qty into r;

    if found then
      updated := updated || jsonb_build_object('sku', r.sku, 'qty', r.qty);
    end if;
  end loop;

  return updated;
end $$;

-- Signed-in users only; RLS does the real gating per row.
revoke all on function public.adjust_stock(jsonb) from public, anon;
grant execute on function public.adjust_stock(jsonb) to authenticated;
