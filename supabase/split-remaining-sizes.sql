-- ============================================================
--  แยกไซซ์ที่เหลือ (ไม่ใช่เข็มขัด) — 2026-07-27
--  ต่อจาก supabase/split-belt-sizes.sql ใช้กติกาเดียวกันทุกอย่าง
--
--  รหัสที่เหลือซึ่ง "ยังไม่มีไซซ์ในรหัส" แต่ไฟล์นับสต็อกระบุไซซ์ไว้:
--    55-VT01-BK   (5)  → M 5              ไฟล์แถว 250
--    PM10267-BK   (5)  → M 1, XL 1, L 3   ไฟล์แถว 175-177
--    PM10267-RG   (2)  → L 2              ไฟล์แถว 178
--  รวม 12 ชิ้นเท่าเดิมก่อน/หลัง
--
--  หมายเหตุ: 55-VT01-BK และ PM10267-RG มีไซซ์เดียว การแยกจึงเท่ากับ
--  "เติมไซซ์ต่อท้ายรหัส" ทำเพื่อให้ทั้งแคตตาล็อกใช้กติกาเดียวกัน
--
--  ไม่แตะรหัสที่ "มีไซซ์อยู่ในรหัสแล้ว" (TT-CX1-*, AFG-VT15-BK-M/-XL,
--  AFG-VT15-MCBK-XL) เพราะคอลัมน์ไซซ์ในไฟล์แค่ระบุซ้ำ ต่อท้ายอีกจะกลายเป็น
--  TT-CX1-BK-S-S
--
--  ยังค้าง: AFG-VT15-BK (6 ชิ้น = XL 2 + ไม่ระบุ 3 + XL 1) — 3 ชิ้นที่เป็น XL
--  น่าจะต้องย้ายไป AFG-VT15-BK-XL แต่อีก 3 ชิ้นไม่รู้ไซซ์ ต้องให้เจ้าของยืนยัน
--
--  ตรวจก่อนแก้: ทั้ง 3 SKU ไม่มี bundle_items / order_items /
--  stock_adjustments อ้างถึง และ reserved = 0
-- ============================================================

do $$
declare v_note text := 'แยกไซซ์ 2026-07-27';
begin
  create temp table _size_split(old_sku text, size text, qty int) on commit drop;

  insert into _size_split(old_sku, size, qty) values
    ('55-VT01-BK', 'M',  5),   -- ไฟล์แถว 250
    ('PM10267-BK', 'M',  1),   -- ไฟล์แถว 175
    ('PM10267-BK', 'XL', 1),   -- ไฟล์แถว 176
    ('PM10267-BK', 'L',  3),   -- ไฟล์แถว 177
    ('PM10267-RG', 'L',  2);   -- ไฟล์แถว 178

  if exists (
    select 1 from (select old_sku, sum(qty) s from _size_split group by old_sku) b
      join public.products p on p.sku = b.old_sku
     where p.qty <> b.s
  ) then
    raise exception 'จำนวนที่แยกไม่ตรงกับสต็อกเดิม — ยกเลิกทั้งหมด';
  end if;

  -- 1. SKU ใหม่ (คัดลอกคุณสมบัติจากรหัสเดิม; trigger คง cost ไว้บน INSERT)
  insert into public.products (sku, name, cat, cost, price, qty, reserved, reorder, loc, supplier, brand)
  select b.old_sku || '-' || b.size,
         p.name || ' [' || b.size || ']',
         p.cat, p.cost, p.price, b.qty, 0, p.reorder, p.loc, p.supplier, p.brand
    from _size_split b
    join public.products p on p.sku = b.old_sku
  on conflict (sku) do update
     set qty = excluded.qty, name = excluded.name, updated_at = now();

  -- 2. คัดลอกรูปก่อนลบรหัสเดิม
  insert into public.app_state (key, value)
  select 'img:' || b.old_sku || '-' || b.size, a.value
    from _size_split b
    join public.app_state a on a.key = 'img:' || b.old_sku
  on conflict (key) do nothing;

  -- 3. ตำแหน่งจัดเก็บของ SKU ใหม่
  insert into public.product_locations (sku, loc, qty, note)
  select b.old_sku || '-' || b.size, p.loc, b.qty, v_note
    from _size_split b
    join public.products p on p.sku = b.old_sku
   where coalesce(p.loc, '') not in ('', '-', '—')
  on conflict (sku, loc) do update
     set qty = excluded.qty, note = excluded.note, updated_at = now();

  -- 4. ประวัติการแก้ไข
  insert into public.audit_log (entity, entity_id, action, summary, note, user_name)
  select 'product', t.old_sku, 'update', t.summary,
         'ตามคอลัมน์ "ไซซ์" ในไฟล์ 250769 ตารางสินค้า_อัปเดต22 (1).xlsx', 'PS Admin'
    from (
      select b.old_sku,
             'แยกไซซ์: ' || b.old_sku || ' (' || p.qty || ' ชิ้น) → ' ||
             string_agg(b.old_sku || '-' || b.size || ' = ' || b.qty, ', ' order by b.qty desc) as summary
        from _size_split b join public.products p on p.sku = b.old_sku
       group by b.old_sku, p.qty
    ) t
   where not exists (select 1 from public.audit_log a where a.summary = t.summary);

  -- 5. ลบรหัสรวมเดิม
  delete from public.app_state where key in (select 'img:' || old_sku from _size_split);
  delete from public.products  where sku in (select distinct old_sku from _size_split);

  raise notice 'remaining size split applied';
end $$;

select p.sku, p.name, p.qty, p.price, p.cost,
       coalesce(string_agg(pl.loc || ' = ' || pl.qty, ' | '), '(none)') as split_rows
  from public.products p
  left join public.product_locations pl on pl.sku = p.sku
 where p.sku like '55-VT01%' or p.sku like 'PM10267%'
 group by p.sku, p.name, p.qty, p.price, p.cost
 order by p.sku;
