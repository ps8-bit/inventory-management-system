-- ============================================================
--  stock_adjustments — ตาราง + RLS สำหรับฟีเจอร์ "ปรับสต็อก" (2026-07-19)
--
--  เก็บประวัติการปรับสต็อกแบบมีเหตุผล: นับสต็อกผิด / สินค้าเสียหาย /
--  สูญหาย / ขายนอกระบบ (Shopee, Lazada, TikTok, หน้าร้าน ฯลฯ)
--  delta บวก = เพิ่มเข้า, delta ลบ = หักออก (มุมมองเดียวกับ adjust_stock RPC)
--
--  หมายเหตุ: ตารางนี้ประกาศอยู่แล้วใน supabase-schema.sql และ RLS ประกาศใน
--  rls-policies.sql (รันกับ prod แล้ว) — ไฟล์นี้คือ insurance ให้สภาพแวดล้อม
--  ใหม่/สำรองตามทันโดยไม่ต้องรันทั้งสคริปต์ใหญ่ จึงประกาศ helper functions
--  ที่นโยบายพึ่งพาซ้ำในตัว (verbatim จาก rls-policies.sql §2/§2b) และลบ
--  นโยบายช่วงทดลองที่ supabase-schema.sql เปิดกว้างไว้ด้วย
--
--  วิธีใช้: เปิด Supabase → SQL Editor → New query → วางไฟล์นี้ → Run (รันซ้ำได้)
--
--  Security: read = ทุกบัญชีที่ล็อกอิน · insert/update = admin/manager/staff
--  ภายในเวลาทำงาน (public.within_work_hours) · delete = admin/manager
--  — ตรงกับที่ loop ใน rls-policies.sql สร้างให้ตารางนี้ทุกนโยบาย
-- ============================================================

create table if not exists public.stock_adjustments (
  id         bigint generated always as identity primary key,
  sku        text references public.products(sku) on delete cascade,
  delta      integer not null,             -- + รับเข้า / - ตัดออก
  reason     text,
  created_at timestamptz default now(),
  created_by text
);

alter table public.stock_adjustments enable row level security;

-- Helpers the write policies depend on — verbatim from rls-policies.sql §2/§2b
-- so this file works on an environment provisioned only from supabase-schema.sql.
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

-- Drop the wide-open trial policy supabase-schema.sql creates (permissive
-- policies OR together — leaving it would keep the table writable by anyone
-- signed in), then our own four so the recreate below is idempotent.
drop policy if exists "เปิดให้ใช้งานช่วงทดลอง" on public.stock_adjustments;
drop policy if exists "read"   on public.stock_adjustments;
drop policy if exists "insert" on public.stock_adjustments;
drop policy if exists "update" on public.stock_adjustments;
drop policy if exists "delete" on public.stock_adjustments;

create policy "read"   on public.stock_adjustments for select using (auth.role() = 'authenticated');
create policy "insert" on public.stock_adjustments for insert with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours());
create policy "update" on public.stock_adjustments for update using (public.auth_role() in ('admin','manager','staff')) with check (public.auth_role() in ('admin','manager','staff') and public.within_work_hours());
create policy "delete" on public.stock_adjustments for delete using (public.auth_role() in ('admin','manager') and public.within_work_hours());
