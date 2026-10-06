-- ════════════════════════════════════════════════════════════════════
--  ให้ deduct_stock / adjust_stock บอก "ก่อนแก้" กลับมาด้วย (2026-09-19)
--
--  ปัญหา: ประวัติบันทึกตัวเลข from → to ที่ "เครื่องเดาเอง" ไม่ใช่ของจริง
--  แอปคำนวณ from/to จากสำเนาในเครื่อง แล้วเขียน audit ทันที ส่วนเซิร์ฟเวอร์
--  ค่อยบวก/ลบ delta กับค่าจริงของมันทีหลัง ถ้าสำเนาในเครื่องล้าสมัย
--  (อีกเครื่องเพิ่งขายไป / realtime ยังมาไม่ถึง) ตัวเลขในประวัติจะมั่ว
--
--  ของจริงที่เจอ AFG-OT33-BK 2026-09-01 12:11:11 บันทึกไว้ว่า 30 → 29
--  แต่สต็อกจริงตอนนั้นคือ 60 → 59 (สองวันถัดมาประวัติขึ้น 59 → 57 โดยไม่มี
--  ร่องรอยว่ากระโดดจาก 29 ไป 59 ตอนไหน) — ตัวสต็อกถูกเสมอเพราะ RPC ทำงาน
--  แบบ atomic แต่ "ตัวเลขที่บันทึก" ผิด ทำให้อ่านประวัติแล้วสับสน
--
--  วิธีแก้: RPC คืน before มาด้วย แอปจึงบันทึกเลขก่อน/หลังของจริงจาก
--  เซิร์ฟเวอร์ แทนที่จะเดาเอง (ดู applyStockAdjustment ใน data.jsx)
--
--  เพิ่มเฉพาะ key 'before' ในผลลัพธ์ ของเดิม sku/qty ยังอยู่ครบ
--  ฝั่งแอปที่ยังไม่อัปเดตจึงทำงานได้เหมือนเดิม
--  ใช้ SELECT ... FOR UPDATE ล็อกแถวก่อน แล้วค่อย UPDATE ในทรานแซกชันเดียว
--  ความเป็น atomic เท่าเดิมทุกประการ
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
-- ════════════════════════════════════════════════════════════════════

create or replace function public.deduct_stock(deductions jsonb, op_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  d record;
  r record;
  v_before int;
  updated jsonb := '[]'::jsonb;
  claimed boolean := false;
  v_op text := op_id;
begin
  if deductions is null or jsonb_typeof(deductions) <> 'array' then
    return updated;
  end if;

  if v_op is null or v_op = '' then
    claimed := true;
  else
    insert into public.stock_ops (op_id, kind, payload)
    values (v_op, 'deduct', deductions)
    on conflict do nothing;
    claimed := found;
  end if;

  for d in
    select x->>'sku' as sku, (x->>'qty')::int as qty
    from jsonb_array_elements(deductions) x
  loop
    if d.sku is null or d.qty is null or d.qty <= 0 then
      continue;
    end if;

    if claimed then
      -- ล็อกแถวแล้วอ่านค่าก่อนแก้ ในทรานแซกชันเดียวกับ UPDATE
      select p.qty into v_before from public.products p where p.sku = d.sku for update;
      if not found then continue; end if;

      update public.products
         set qty = greatest(0, qty - d.qty),
             updated_at = now()
       where sku = d.sku
       returning sku, qty into r;
    else
      -- ทำไปแล้วรอบก่อน: ไม่แตะสต็อก และ before = ค่าปัจจุบัน (ไม่มีอะไรขยับ)
      select p.sku, p.qty into r from public.products p where p.sku = d.sku;
      if not found then continue; end if;
      v_before := r.qty;
    end if;

    updated := updated || jsonb_build_object('sku', r.sku, 'qty', r.qty, 'before', v_before);
  end loop;

  return updated;
end $$;

revoke all on function public.deduct_stock(jsonb, text) from public, anon;
grant execute on function public.deduct_stock(jsonb, text) to authenticated;


create or replace function public.adjust_stock(adjustments jsonb, op_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  d record;
  r record;
  v_before int;
  updated jsonb := '[]'::jsonb;
  claimed boolean := false;
  v_op text := op_id;
begin
  if adjustments is null or jsonb_typeof(adjustments) <> 'array' then
    return updated;
  end if;

  if v_op is null or v_op = '' then
    claimed := true;
  else
    insert into public.stock_ops (op_id, kind, payload)
    values (v_op, 'adjust', adjustments)
    on conflict do nothing;
    claimed := found;
  end if;

  for d in
    select x->>'sku' as sku, (x->>'delta')::int as delta
    from jsonb_array_elements(adjustments) x
  loop
    if d.sku is null or d.delta is null or d.delta = 0 then
      continue;
    end if;

    if claimed then
      select p.qty into v_before from public.products p where p.sku = d.sku for update;
      if not found then continue; end if;

      update public.products
         set qty = greatest(0, qty + d.delta),
             updated_at = now()
       where sku = d.sku
       returning sku, qty into r;
    else
      select p.sku, p.qty into r from public.products p where p.sku = d.sku;
      if not found then continue; end if;
      v_before := r.qty;
    end if;

    updated := updated || jsonb_build_object('sku', r.sku, 'qty', r.qty, 'before', v_before);
  end loop;

  return updated;
end $$;

revoke all on function public.adjust_stock(jsonb, text) from public, anon;
grant execute on function public.adjust_stock(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
