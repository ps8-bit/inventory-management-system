-- ════════════════════════════════════════════════════════════════════
--  product_locations: ปลดล็อกให้ "บันทึกแล้วเปลี่ยนจริง" (2026-09-19)
--
--  อาการที่เจอ: กดบันทึกแล้วยอดรวมของสินค้าเปลี่ยน แต่จำนวนแยกตามตำแหน่ง
--  (ชั้น/กล่อง) ไม่เปลี่ยนตาม → หน้าตำแหน่งสินค้าโชว์ของที่ไม่มีอยู่จริง
--  และตัวแก้ไขการแบ่งตำแหน่งจะขึ้น error ว่า "จำนวนรวมทุกตำแหน่งไม่เท่ากับสต็อก"
--
--  สาเหตุที่ตรวจพบจาก pg_policies ของ prod:
--
--  1) product_locations เป็นตาราง "เดียวในทั้งฐานข้อมูล" ที่ policy เขียน
--     ผูกกับ within_work_hours() — products / orders / labels / app_state /
--     stock_adjustments / bundles ไม่มีเงื่อนไขเวลาเลย
--     work hours เปิดอยู่ 08:00–18:00 และคุม role staff + viewer
--     → พนักงาน staff ทำงานหลัง 18:00: products.qty เขียนผ่าน แต่
--       product_locations ถูกปฏิเสธ → ตัวเลขสองฝั่งแยกกันถาวร
--
--  2) DELETE เปิดให้แค่ admin/manager แต่คนที่หยิบของจริงคือ staff
--     ขายชิ้นสุดท้ายออกจากชั้น = ต้องลบแถวนั้นทิ้ง (saveLocSplit ตัดแถวที่
--     qty เหลือ 0 และ dbSaveProductLocs สั่ง DELETE) → staff ทำไม่ได้
--     กลายเป็นกองผีที่ realtime ดึงกลับมาทุกครั้ง
--     (ไฟล์ product-locations-staff-delete.sql เขียนไว้แล้วแต่ไม่เคยรันจริง)
--
--  หลังรันไฟล์นี้ policy ของ product_locations จะเทียบเท่า products คือ
--  ตรวจ role อย่างเดียว ไม่มีเงื่อนไขเวลา และ staff ลบแถวตำแหน่งว่างได้
--  staff แก้ qty เป็น 0 ได้อยู่แล้วผ่าน UPDATE การให้ DELETE จึงไม่ได้เพิ่ม
--  สิทธิ์ใหม่ แค่ทำให้บันทึกได้ครบจริง
--
--  วิธีใช้: Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
-- ════════════════════════════════════════════════════════════════════

drop policy if exists "insert" on public.product_locations;
drop policy if exists "update" on public.product_locations;
drop policy if exists "delete" on public.product_locations;

create policy "insert" on public.product_locations for insert
  with check (public.auth_role() in ('admin','manager','staff'));

create policy "update" on public.product_locations for update
  using      (public.auth_role() in ('admin','manager','staff'))
  with check (public.auth_role() in ('admin','manager','staff'));

-- ลบได้ถึงระดับ staff: เป็นแค่การเก็บกวาดแถวตำแหน่งที่เหลือ 0
create policy "delete" on public.product_locations for delete
  using (public.auth_role() in ('admin','manager','staff'));

-- SELECT เดิมไม่แตะ (authenticated อ่านได้ทั้งหมด)

-- ตรวจผล:
--   select policyname, cmd, coalesce(with_check, qual) as expr
--   from pg_policies where schemaname='public' and tablename='product_locations'
--   order by cmd;
--
-- ตรวจ drift (ผลรวมตามตำแหน่ง ต้องเท่ากับ products.qty):
--   with s as (select sku, sum(qty)::int shelf_sum from public.product_locations group by sku)
--   select p.sku, p.qty, s.shelf_sum from s join public.products p using (sku)
--   where s.shelf_sum <> p.qty;
