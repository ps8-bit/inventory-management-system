-- ============================================================
--  Atomic stock deduction RPC — migration 2026-06-12
--
--  Problem: every sell/issue used to read qty in the client, subtract,
--  then upsert the WHOLE catalog. Two devices selling the same SKU at
--  the same time both read qty=5, both write 4 → one sale is lost.
--
--  Fix: deduct on the server in one UPDATE per SKU. Concurrent calls
--  serialize on the row lock, so qty = GREATEST(0, qty - n) is exact.
--
--  วิธีใช้: เปิด Supabase → SQL Editor → New query → วางไฟล์นี้ → Run
--  (รันซ้ำได้ — create or replace)
--
--  Security: SECURITY INVOKER → the UPDATE runs under the caller's RLS
--  policies ("update" policy: admin/manager/staff + within_work_hours).
--  A viewer calling this matches 0 rows and the client surfaces
--  PERMISSION_OR_MISSING, same as every other write path.
-- ============================================================

create or replace function public.deduct_stock(deductions jsonb)
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
  if deductions is null or jsonb_typeof(deductions) <> 'array' then
    return updated;
  end if;

  for d in
    select x->>'sku' as sku, (x->>'qty')::int as qty
    from jsonb_array_elements(deductions) x
  loop
    if d.sku is null or d.qty is null or d.qty <= 0 then
      continue;
    end if;

    update public.products
       set qty = greatest(0, qty - d.qty),
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
revoke all on function public.deduct_stock(jsonb) from public, anon;
grant execute on function public.deduct_stock(jsonb) to authenticated;
