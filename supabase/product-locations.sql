-- ============================================================
--  product_locations — ตำแหน่งจัดเก็บแบบหลายที่ต่อ 1 SKU (2026-07-26)
--
--  ที่มา: products.loc เก็บ "ตำแหน่งเดียว" เป็น text path เช่น
--    "ตึกพาณิชย์ › ชั้น 1 › A"  หรือ  "ตึกพาณิชย์ › ชั้น 2 › B (กล่อง 8)"
--  แต่ของจริงมีสินค้าที่เก็บ 2 ที่ (โซน A ข้างล่าง + กล่องสำรองชั้นบน)
--  ทำให้ต้องเลือก "A เป็นตำแหน่งหลัก" และจำนวนที่อยู่ในกล่องหายไปจากระบบ
--  (ครั้งล่าสุด 102 ชิ้นถูกบันทึกว่าอยู่โซน A ทั้งที่อยู่ในกล่องชั้นบน —
--   ยอดรวมถูก แต่ตำแหน่งผิด ทำให้หยิบของไม่เจอ)
--
--  ตารางนี้เก็บ "จำนวนต่อตำแหน่ง" 1 แถว = 1 SKU ต่อ 1 ตำแหน่ง
--  products.loc ยังอยู่ต่อในฐานะ "ตำแหน่งหลัก" (primary/หยิบก่อน) เพื่อไม่
--  พังโค้ดเดิมทั้งหมดที่อ่าน p.loc — ตารางนี้คือแหล่งความจริงของการกระจาย
--  INVARIANT: sum(product_locations.qty) ต่อ sku ต้องเท่ากับ products.qty
--  ใช้ view public.product_location_audit ตรวจ (diff ต้องเป็น 0 ทุกแถว)
--
--  loc ไม่มี FK ได้ เพราะผังตำแหน่ง (อาคาร›ชั้น›ตำแหน่ง) เก็บเป็น JSON blob
--  ใน app_state key 'locations' ไม่ใช่ตาราง — แอปต้องตรวจเองด้วย locIsStored()
--
--  วิธีใช้: เปิด Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
--
--  Security: read = ทุกบัญชีที่ล็อกอิน · insert/update = admin/manager/staff
--  ภายในเวลาทำงาน (public.within_work_hours) · delete = admin/manager
--  — ตรงกับโมเดลของ products/stock_adjustments
--
--  ⚠ ต้องเพิ่มชื่อ 'product_locations' ใน array ของ rls-policies.sql §4 ด้วย
--    เพราะ §3 ของไฟล์นั้น drop ทุก policy ใน schema public — ถ้าไม่เพิ่ม
--    การรัน rls-policies.sql ซ้ำจะทำให้ตารางนี้เหลือ RLS เปิดแต่ไม่มี policy
--    = deny-all เงียบ ๆ (ทำแล้วในไฟล์นั้น commit เดียวกัน)
-- ============================================================

create table if not exists public.product_locations (
  sku        text    not null references public.products(sku) on delete cascade,
  loc        text    not null,
  qty        integer not null default 0 check (qty >= 0),
  note       text,
  updated_at timestamptz default now(),
  primary key (sku, loc)
);

-- ค้นหา "ในตำแหน่งนี้มีอะไรอยู่" (หน้าตำแหน่งจัดเก็บ / หยิบของ)
create index if not exists product_locations_loc_idx on public.product_locations (loc);

alter table public.product_locations enable row level security;

-- Helpers ที่ policy ด้านล่างพึ่งพา — verbatim จาก rls-policies.sql §2/§2b
-- เพื่อให้ไฟล์นี้รันได้บนสภาพแวดล้อมที่ provision จาก supabase-schema.sql เท่านั้น
create or replace function public.auth_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'viewer')
$$;

create or replace function public.hhmm_to_min(t text) returns int
language sql immutable as $$
  select case
    when t ~ '^[0-9]{1,2}:[0-9]{2}$'
         and split_part(t, ':', 1)::int between 0 and 23
         and split_part(t, ':', 2)::int between 0 and 59
    then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int
    else null
  end;
$$;

create or replace function public.within_work_hours() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role text := public.auth_role();
  wh jsonb; v_roles jsonb; v_local timestamp; v_today text; v_dow int; v_min int;
  day_cfg jsonb; v_open int; v_close int;
begin
  select value -> 'workHours' into wh from public.store_settings where key = 'main';
  if wh is null then return true; end if;
  if coalesce((wh ->> 'enabled')::boolean, false) = false then return true; end if;
  v_roles := wh -> 'roles';
  if v_roles is null or not (v_roles ? v_role) then return true; end if;
  v_local := (now() at time zone 'Asia/Bangkok');
  v_today := to_char(v_local, 'YYYY-MM-DD');
  -- per-user today-only outside-hours pass (granted from User Management)
  if auth.uid() is not null and (wh -> 'exceptions' ->> auth.uid()::text) = v_today then return true; end if;
  v_dow   := extract(dow  from v_local)::int;
  v_min   := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  day_cfg := wh -> 'days' -> v_dow::text;
  if day_cfg is null then return false; end if;
  if coalesce((day_cfg ->> 'on')::boolean, false) = false then return false; end if;
  v_open  := public.hhmm_to_min(day_cfg ->> 'open');
  v_close := public.hhmm_to_min(day_cfg ->> 'close');
  if v_open is null or v_close is null then return true; end if;
  if v_close > v_open then return v_min >= v_open and v_min < v_close;
  else return v_min >= v_open or v_min < v_close; end if;
end;
$$;
grant execute on function public.hhmm_to_min(text)   to anon, authenticated;
grant execute on function public.within_work_hours() to anon, authenticated;

drop policy if exists "read"   on public.product_locations;
drop policy if exists "insert" on public.product_locations;
drop policy if exists "update" on public.product_locations;
drop policy if exists "delete" on public.product_locations;

create policy "read"   on public.product_locations for select using (auth.role() = 'authenticated');
create policy "insert" on public.product_locations for insert with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours());
create policy "update" on public.product_locations for update using (public.auth_role() in ('admin','manager','staff')) with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours());
create policy "delete" on public.product_locations for delete using (public.auth_role() in ('admin','manager') and public.within_work_hours());

-- ตรวจ invariant: จำนวนที่กระจายตามตำแหน่ง ต้องรวมได้เท่ากับ products.qty
-- security_invoker = true (PG15+) ให้ RLS ทำงานตามสิทธิ์ของผู้เรียก ไม่ใช่ owner
-- ไม่ SELECT cost/price ออกมา เพื่อไม่ให้ทะลุการซ่อนต้นทุนของ role staff
create or replace view public.product_location_audit
with (security_invoker = true) as
select p.sku,
       p.qty                             as product_qty,
       coalesce(sum(pl.qty), 0)::int     as split_qty,
       p.qty - coalesce(sum(pl.qty), 0)::int as diff,
       count(pl.loc)::int                as positions,
       p.loc                             as primary_loc
from public.products p
left join public.product_locations pl on pl.sku = p.sku
group by p.sku, p.qty, p.loc;

grant select on public.product_location_audit to authenticated;
