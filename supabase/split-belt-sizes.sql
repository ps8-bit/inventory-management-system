-- ============================================================
--  แยกไซซ์เข็มขัด — ต่อไซซ์ท้ายรหัสสินค้า (2026-07-27)
--
--  ปัญหา: เข็มขัดหลายรุ่นใช้รหัสเดียวรวมทุกไซซ์ เช่น BAT-BT01-BK = 32 เส้น
--  ทั้งที่ในไฟล์นับสต็อกแยกไว้ชัดเจนในคอลัมน์ "ไซซ์" (S 19 + M 13)
--  → ขายหรือหยิบตามไซซ์ไม่ได้เลย ระบบรู้แค่ยอดรวม
--
--  แก้: สร้าง SKU ใหม่ต่อท้ายด้วยไซซ์ (-S / -M / -L / -XL) ตามรูปแบบที่
--  แคตตาล็อกใช้อยู่แล้ว (เช่น AFG-VT15-BK-M, TW-VT23-BK-M, TT-CX1-BK-L)
--  แล้วย้ายจำนวนตามไฟล์นับสต็อก จากนั้นลบรหัสรวมเดิมทิ้ง
--
--  ที่มาของจำนวน: 250769 ตารางสินค้า_อัปเดต22 (1).xlsx ชีต "รายการ ชุด A"
--  คอลัมน์ ไซซ์ + จำนวน(ตัวเลข) แถว 235-246
--
--  ตรวจก่อนแก้แล้ว: ทั้ง 6 SKU ไม่มี bundle_items / order_items /
--  stock_adjustments อ้างถึงเลย และ reserved = 0 ทุกตัว → ลบได้ปลอดภัย
--  รวม 58 เส้นเท่าเดิมทั้งก่อนและหลัง (32+14+6+1+3+2)
--
--  ชื่อสินค้าเติม " [ไซซ์]" ต่อท้าย เพราะตาราง products ไม่มีคอลัมน์ size
--  พนักงานจึงต้องแยกออกจากชื่อในหน้าจอขาย/ฉลาก
--
--  รูปสินค้า: คัดลอก app_state 'img:<รหัสเดิม>' ไปให้ทุกไซซ์ก่อนลบของเดิม
--  ไม่งั้นรูปหายทั้งกลุ่ม
-- ============================================================

do $$
declare v_note text := 'แยกไซซ์ 2026-07-27';
begin
  create temp table _belt_split(old_sku text, size text, qty int) on commit drop;

  insert into _belt_split(old_sku, size, qty) values
    -- BATTLE GEAR LASER CUT BELT — ไฟล์แถว 235-236
    ('BAT-BT01-BK',   'S',  19),
    ('BAT-BT01-BK',   'M',  13),
    -- APE FORCE GEAR RONIN STYLE BELT (MCBK) — แถว 237-239
    ('AFG-BT22-MCBK', 'S',   2),
    ('AFG-BT22-MCBK', 'M',  11),
    ('AFG-BT22-MCBK', 'L',   1),
    -- RONIN STYLE BELT (BK) — แถว 240
    ('AFG-BT22-BK',   'L',   1),
    -- RONIN STYLE INNER BELT — แถว 241-242
    ('AFG-BT22-B-BK', 'M',   3),
    ('AFG-BT22-B-BK', 'S',   3),
    -- เข็มขัด RONIN (BK) — แถว 243-245
    ('RONIN-BK',      'L',   1),
    ('RONIN-BK',      'XL',  1),
    ('RONIN-BK',      'M',   1),
    -- เข็มขัด RONIN (MCBK) — แถว 246
    ('RONIN-MCBK',    'M',   2);

  -- กันพลาด: จำนวนที่แยกต้องเท่ากับจำนวนเดิมของทุกรหัส
  if exists (
    select 1 from (select old_sku, sum(qty) s from _belt_split group by old_sku) b
      join public.products p on p.sku = b.old_sku
     where p.qty <> b.s
  ) then
    raise exception 'จำนวนที่แยกไม่ตรงกับสต็อกเดิม — ยกเลิกทั้งหมด';
  end if;

  -- 1. สร้าง SKU ใหม่ โดยคัดลอกคุณสมบัติจากรหัสเดิม (ราคา/ทุน/หมวด/แบรนด์/ตำแหน่ง)
  --    trigger products_guard_cost บน INSERT ใช้ coalesce(new.cost,0) จึงคง cost ไว้
  insert into public.products (sku, name, cat, cost, price, qty, reserved, reorder, loc, supplier, brand)
  select b.old_sku || '-' || b.size,
         p.name || ' [' || b.size || ']',
         p.cat, p.cost, p.price, b.qty, 0, p.reorder, p.loc, p.supplier, p.brand
    from _belt_split b
    join public.products p on p.sku = b.old_sku
  on conflict (sku) do update
     set qty = excluded.qty, name = excluded.name, updated_at = now();

  -- 2. คัดลอกรูปสินค้าไปทุกไซซ์ (ต้องทำก่อนลบรหัสเดิม)
  insert into public.app_state (key, value)
  select 'img:' || b.old_sku || '-' || b.size, a.value
    from _belt_split b
    join public.app_state a on a.key = 'img:' || b.old_sku
  on conflict (key) do nothing;

  -- 3. ลงตำแหน่งจัดเก็บให้ SKU ใหม่ (เข็มขัดทั้งหมดอยู่โซน A ตำแหน่งเดียว)
  insert into public.product_locations (sku, loc, qty, note)
  select b.old_sku || '-' || b.size, p.loc, b.qty, v_note
    from _belt_split b
    join public.products p on p.sku = b.old_sku
   where coalesce(p.loc, '') not in ('', '-', '—')
  on conflict (sku, loc) do update
     set qty = excluded.qty, note = excluded.note, updated_at = now();

  -- 4. ประวัติการแก้ไข — 1 บรรทัดต่อ 1 รหัสเดิม (แก้ผ่าน SQL จึงเขียนเอง)
  insert into public.audit_log (entity, entity_id, action, summary, note, user_name)
  select 'product', t.old_sku, 'update', t.summary,
         'ตามคอลัมน์ "ไซซ์" ในไฟล์ 250769 ตารางสินค้า_อัปเดต22 (1).xlsx', 'PS Admin'
    from (
      select b.old_sku,
             'แยกไซซ์: ' || b.old_sku || ' (' || p.qty || ' เส้น) → ' ||
             string_agg(b.old_sku || '-' || b.size || ' = ' || b.qty, ', ' order by b.qty desc) as summary
        from _belt_split b join public.products p on p.sku = b.old_sku
       group by b.old_sku, p.qty
    ) t
   where not exists (select 1 from public.audit_log a where a.summary = t.summary);

  -- 5. ลบรหัสรวมเดิม (product_locations ของมันหายตาม FK on delete cascade)
  delete from public.app_state where key in (select 'img:' || old_sku from _belt_split);
  delete from public.products  where sku in (select distinct old_sku from _belt_split);

  raise notice 'belt size split applied';
end $$;

-- ---------- ตรวจผล ----------
select p.sku, p.name, p.brand, p.qty, p.price, p.cost,
       coalesce(string_agg(pl.loc || ' = ' || pl.qty, ' | '), '(none)') as split_rows
  from public.products p
  left join public.product_locations pl on pl.sku = p.sku
 where p.sku like 'BAT-BT01-BK%' or p.sku like 'AFG-BT22%' or p.sku like 'RONIN-%'
 group by p.sku, p.name, p.brand, p.qty, p.price, p.cost
 order by p.sku;
