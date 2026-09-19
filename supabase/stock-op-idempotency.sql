-- ============================================================
--  Idempotent stock movements — "บันทึกซ้ำ" fix (2026-09-19)
--
--  ปัญหา: deduct_stock / adjust_stock ย้ายสต็อกแบบ DELTA (qty - n / qty + n)
--  ถ้าเน็ตหลุดหรือ request timeout "หลังจาก" เซิร์ฟเวอร์ commit ไปแล้ว ฝั่ง
--  แอปจะมองว่าเขียนไม่สำเร็จ แล้วเข้าคิวส่งใหม่ → สต็อกถูกตัด/เพิ่ม 2 รอบ
--  ทั้งที่ผู้ใช้กดครั้งเดียว (อาการ: รับเข้า/ตัดสต็อกซ้ำ ยอดไม่ตรงของจริง)
--
--  วิธีแก้: ทุกการเขียนมี op_id (สร้างจากฝั่งแอป ครั้งเดียวต่อ 1 การกระทำ และ
--  ใช้ id เดิมทุกครั้งที่ retry) เก็บลง stock_ops ที่มี PRIMARY KEY
--  → รอบที่สองชนกุญแจ ระบบจะ "ไม่ทำซ้ำ" แต่ตอบจำนวนคงเหลือปัจจุบันกลับไป
--  แอปจึงได้ตัวเลขที่ถูกต้องและไม่ตัดสต็อกซ้ำ
--
--  ปลอดภัยกับการ deploy สลับลำดับ: ฟังก์ชันเดิมแบบ 1 พารามิเตอร์ยังอยู่ครบ
--  และเวอร์ชันใหม่รับ op_id เป็นพารามิเตอร์ที่ "ไม่มี default" → PostgREST
--  เลือกฟังก์ชันจากชุดชื่อพารามิเตอร์ที่ส่งมา จึงไม่มีทางกำกวม แอปเวอร์ชันเก่า
--  ที่ยังส่งแบบ 1 พารามิเตอร์ก็ทำงานได้เหมือนเดิม
--
--  วิธีใช้: เปิด Supabase → SQL Editor → New query → วางไฟล์นี้ → Run
--  (รันซ้ำได้ — create if not exists / create or replace)
-- ============================================================

-- 1. ตารางบันทึก operation id ที่ทำไปแล้ว -------------------------------
create table if not exists public.stock_ops (
  op_id      text primary key,
  kind       text        not null,          -- 'deduct' | 'adjust'
  payload    jsonb,
  created_by uuid        default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists stock_ops_created_at_idx on public.stock_ops (created_at desc);

alter table public.stock_ops enable row level security;

drop policy if exists "read"   on public.stock_ops;
drop policy if exists "insert" on public.stock_ops;
-- อ่าน/เขียนได้ทุกคนที่ล็อกอิน: ตารางนี้เป็นแค่กันซ้ำ ไม่ได้ถือข้อมูลสต็อกเอง
-- และการกันซ้ำต้องทำงานแม้ในเวลาที่ within_work_hours() ปิดการเขียน products
-- อยู่แล้ว (ถ้าเขียน stock_ops ไม่ได้ การกันซ้ำจะเงียบหายไป = อันตรายกว่า)
create policy "read"   on public.stock_ops for select using (auth.role() = 'authenticated');
create policy "insert" on public.stock_ops for insert with check (auth.role() = 'authenticated');

grant select, insert on public.stock_ops to authenticated;

-- 2. deduct_stock(deductions, op_id) -----------------------------------
create or replace function public.deduct_stock(deductions jsonb, op_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  d record;
  r record;
  updated jsonb := '[]'::jsonb;
  claimed boolean := false;
  -- คัดลอกพารามิเตอร์ลงตัวแปรท้องถิ่นก่อนใช้ในคำสั่ง SQL: ชื่อ op_id ต้องตรงกับ
  -- ที่ PostgREST ส่งมา แต่ถ้าเอาไปใช้ตรง ๆ จะชนกับคอลัมน์ชื่อเดียวกันใน stock_ops
  v_op text := op_id;
begin
  if deductions is null or jsonb_typeof(deductions) <> 'array' then
    return updated;
  end if;

  if v_op is null or v_op = '' then
    -- ไม่มี op_id → ทำงานเหมือนเวอร์ชันเดิมทุกประการ
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
      update public.products
         set qty = greatest(0, qty - d.qty),
             updated_at = now()
       where sku = d.sku
       returning sku, qty into r;
    else
      -- ทำไปแล้วรอบก่อน: ไม่แตะสต็อก แค่ตอบจำนวนคงเหลือปัจจุบันกลับไป
      select p.sku, p.qty into r from public.products p where p.sku = d.sku;
    end if;

    if found then
      updated := updated || jsonb_build_object('sku', r.sku, 'qty', r.qty);
    end if;
  end loop;

  return updated;
end $$;

revoke all on function public.deduct_stock(jsonb, text) from public, anon;
grant execute on function public.deduct_stock(jsonb, text) to authenticated;

-- 3. adjust_stock(adjustments, op_id) ----------------------------------
create or replace function public.adjust_stock(adjustments jsonb, op_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  d record;
  r record;
  updated jsonb := '[]'::jsonb;
  claimed boolean := false;
  -- คัดลอกพารามิเตอร์ลงตัวแปรท้องถิ่นก่อนใช้ในคำสั่ง SQL: ชื่อ op_id ต้องตรงกับ
  -- ที่ PostgREST ส่งมา แต่ถ้าเอาไปใช้ตรง ๆ จะชนกับคอลัมน์ชื่อเดียวกันใน stock_ops
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
      update public.products
         set qty = greatest(0, qty + d.delta),
             updated_at = now()
       where sku = d.sku
       returning sku, qty into r;
    else
      select p.sku, p.qty into r from public.products p where p.sku = d.sku;
    end if;

    if found then
      updated := updated || jsonb_build_object('sku', r.sku, 'qty', r.qty);
    end if;
  end loop;

  return updated;
end $$;

revoke all on function public.adjust_stock(jsonb, text) from public, anon;
grant execute on function public.adjust_stock(jsonb, text) to authenticated;

-- 4. เก็บกวาด ---------------------------------------------------------
--  แถวเก่าไม่มีประโยชน์แล้ว (คิวออฟไลน์ของแอปเลิกส่งซ้ำหลัง 7 วัน)
--  ลบด้วยมือเป็นครั้งคราว หรือผูกกับ pg_cron ที่มีอยู่แล้วก็ได้:
--    delete from public.stock_ops where created_at < now() - interval '30 days';

-- 5. ให้ PostgREST เห็นฟังก์ชันใหม่ทันที (ไม่ต้องรอ cache หมดอายุ)
notify pgrst, 'reload schema';
