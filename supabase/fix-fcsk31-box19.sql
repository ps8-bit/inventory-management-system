-- ============================================================
--  แก้ FCSK 3.1 / FCSK 3.0 กล่อง 19 — 2026-07-27
--
--  อาการ: ฐานข้อมูลถูกสร้างจากไฟล์นับสต็อก "ฉบับเมื่อวาน" ซึ่งบันทึกกล่อง 19
--  เป็นบรรทัดเดียว (VT23-BK-M = 14). ไฟล์ฉบับแก้แล้วแยกเป็น 3 บรรทัด:
--     TW-VT23-BK-M  (FCSK 3.0 M TWIN)  = 11
--     VT23-BK-M     (FCSK 3.1 BK)      = 3
--     VT23-MCBK-M   (FCSK 3.1 MCBK)    = 1
--  เสื้อ FCSK 3.0 จำนวน 11 ตัว จึงถูกนับรวมอยู่ใต้รหัสของ FCSK 3.1 (11+3=14)
--  แล้วแถวนั้นยังถูกเปลี่ยนชื่อเป็น "FCSK 3.0 TWIN" ทำให้ดูเหมือนถูกต้อง
--
--  ผลกระทบ: FCSK 3.1 BK ขึ้น 14 ตัว (จริง 3 → ขายเกิน),
--           FCSK 3.0 M BK ขึ้น 24 ตัว (จริง 35 → ขายไม่ได้ 11 ตัว ~฿41,800)
--  ยอดรวมทั้งกล่องไม่เปลี่ยน (39 ตัว) — ผิดที่ "รหัสไหนเป็นเจ้าของ" เท่านั้น
--
--  ตรวจก่อนแก้แล้ว (2026-07-27): ทั้ง 3 SKU ยัง updated_at = 2026-07-26 03:27
--  (เวลาที่ migrate), ไม่มี order_items อ้างถึง, ไม่มี stock_adjustments หลัง
--  migration → ไฟล์นับสต็อกยังเป็นความจริงล่าสุดของสินค้ากลุ่มนี้
--
--  รันซ้ำได้ (idempotent): การ rename จะไม่ match รอบสอง, product_locations
--  ใช้ delete+insert, audit_log กัน insert ซ้ำด้วย not exists
-- ============================================================

do $$
declare
  v_box8  text := 'ตึกพาณิชย์ › ชั้น 2 › B (กล่อง 8)';
  v_box19 text := 'ตึกพาณิชย์ › ชั้น 2 › B (กล่อง 19)';
  v_actor text := 'PS Admin';
begin
  -- 1. ล้างแถวตำแหน่งเดิมของ 3 SKU (ต้องลบก่อน rename เพราะ FK ไม่มี ON UPDATE)
  delete from public.product_locations
   where sku in ('TW-VT23-BK-M', 'VT23-BK-M', 'VT23-BK-MCBK-M', 'VT23-MCBK-M');

  -- 2a. FCSK 3.0 M TWIN — คืน 11 ตัวที่อยู่กล่อง 19 (24 + 11 = 35)
  update public.products
     set qty = 35, updated_at = now()
   where sku = 'TW-VT23-BK-M';

  -- 2b. FCSK 3.1 BK — เหลือ 3 ตัว + คืนชื่อ/แบรนด์ที่ถูกต้อง
  update public.products
     set qty = 3, name = 'เสื้อเกราะ FCSK 3.1', brand = 'TACTICAL UNIT', updated_at = now()
   where sku = 'VT23-BK-M';

  -- 2c. FCSK 3.1 MCBK — แก้รหัสที่พิมพ์เกิน 'BK-' และคืนชื่อ/แบรนด์
  update public.products
     set sku = 'VT23-MCBK-M', name = 'เสื้อเกราะ FCSK 3.1', brand = 'TACTICAL UNIT', updated_at = now()
   where sku = 'VT23-BK-MCBK-M';

  -- 3. ลงตำแหน่งจริงแยกจำนวน (ตารางใหม่ product_locations)
  --    TW-VT23-BK-M อยู่ 2 กล่อง — เก็บได้ตรงไปตรงมาแล้ว ไม่ต้องตั้งตำแหน่งรวม
  --    ชื่อ "B (กล่อง 8,19)" แบบเดิมอีกต่อไป
  insert into public.product_locations (sku, loc, qty, note) values
    ('TW-VT23-BK-M', v_box8,  24, 'แก้ FCSK 3.1 2026-07-27 · หลัก (หยิบก่อน) · รวม 35'),
    ('TW-VT23-BK-M', v_box19, 11, 'แก้ FCSK 3.1 2026-07-27 · สำรอง · รวม 35'),
    ('VT23-BK-M',    v_box19,  3, 'แก้ FCSK 3.1 2026-07-27'),
    ('VT23-MCBK-M',  v_box19,  1, 'แก้ FCSK 3.1 2026-07-27')
  on conflict (sku, loc) do update
     set qty = excluded.qty, note = excluded.note, updated_at = now();

  -- 4. ประวัติการแก้ไข — แก้ผ่าน SQL จึงต้องเขียน audit_log เอง
  insert into public.audit_log (entity, entity_id, action, summary, note, user_name)
  select * from (values
    ('product', 'TW-VT23-BK-M', 'update',
     'แก้จำนวน 24 → 35 ตัว (คืน 11 ตัวในกล่อง 19 ที่ถูกนับรวมไปกับ FCSK 3.1)',
     'ตามไฟล์นับสต็อก 250769 ตารางสินค้า_อัปเดต22 (1).xlsx — กล่อง 8 = 24, กล่อง 19 = 11', 'PS Admin'),
    ('product', 'VT23-BK-M', 'update',
     'แก้จำนวน 14 → 3 ตัว + คืนชื่อเป็น "เสื้อเกราะ FCSK 3.1" และแบรนด์ TACTICAL UNIT',
     'เดิมรวมเสื้อ FCSK 3.0 จำนวน 11 ตัวไว้ผิดรหัส และถูกตั้งชื่อเป็น FCSK 3.0 TWIN', 'PS Admin'),
    ('product', 'VT23-MCBK-M', 'update',
     'แก้รหัสสินค้า VT23-BK-MCBK-M → VT23-MCBK-M + คืนชื่อ/แบรนด์',
     'รหัสเดิมพิมพ์ "BK-" เกินมา 1 ส่วน', 'PS Admin')
  ) as t(entity, entity_id, action, summary, note, user_name)
  where not exists (
    select 1 from public.audit_log a
     where a.entity_id = t.entity_id and a.summary = t.summary
  );

  raise notice 'FCSK 3.1 fix applied';
end $$;

-- ---------- ตรวจผล ----------
select p.sku, p.name, p.brand, p.qty, p.loc,
       coalesce(string_agg(pl.loc || ' = ' || pl.qty, ' | ' order by pl.qty desc), '(none)') as split_rows
  from public.products p
  left join public.product_locations pl on pl.sku = p.sku
 where p.sku in ('TW-VT23-BK-M','VT23-BK-M','VT23-MCBK-M','VT23-BK-MCBK-M','FCSK3.1-BK','FCSK3.1-MCBK')
 group by p.sku, p.name, p.brand, p.qty, p.loc
 order by p.sku;
