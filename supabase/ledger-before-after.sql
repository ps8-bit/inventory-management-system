-- ════════════════════════════════════════════════════════════════════════
--  Movement history: stock BEFORE / AFTER each movement + tamper-proofing
--  (2026-10-12) — run once in the Supabase SQL editor. Idempotent.
--
--  1. stock_adjustments.qty_before / qty_after (nullable). New rows carry the
--     server's own before/after (the stock RPCs already return them).
--  2. One-time EXACT backfill for rows since the pack launch (2026-10-07
--     Bangkok). Every movement since then has exactly one ledger row, so walking
--     back from today's products.qty one row at a time in INSERTION order (id —
--     not created_at, which a backdated sale moves into the past) reproduces the
--     real stock at each step. Verified 2026-10-12 before applying: matched all
--     16 server-recorded ปรับสต็อก/รับเข้า before→after values, all 4 stock-count
--     (a → b) reasons, and all 27 products created since then start at exactly 0;
--     no step below zero. The block re-checks and RAISES (writes nothing) if any
--     check fails. Older rows stay NULL (counts from 2026-09-28 back disagree).
--  3. The history is evidence, so it must not be editable after the fact:
--     UPDATE on stock_adjustments was open to staff — now admin only (the app
--     never updates a ledger row; a sku rename reaches it through the FK cascade,
--     which RLS does not apply to).
--  4. Who wrote a row is taken from the login, not from the name the app sends:
--     actor_id = auth.uid(), forced by trigger on audit_log and stock_adjustments.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Columns
alter table public.stock_adjustments add column if not exists qty_before integer;
alter table public.stock_adjustments add column if not exists qty_after  integer;

-- 2. Exact backfill, guarded
do $$
declare v_start bigint; v_neg int; v_bad int; v_new int;
begin
  select min(id) into v_start from public.stock_adjustments
   where created_at >= timestamptz '2026-10-07 00:00:00+07';
  if v_start is null then return; end if;

  create temp table _chain on commit drop as
  select a.id, a.sku, a.delta,
         p.qty - coalesce(sum(a.delta) over (partition by a.sku order by a.id desc
                 rows between unbounded preceding and 1 preceding), 0) as q_after,
         row_number() over (partition by a.sku order by a.id) as rn
    from public.stock_adjustments a
    join public.products p on p.sku = a.sku
   where a.id >= v_start;

  select count(*) into v_neg from _chain where q_after < 0 or q_after - delta < 0;
  if v_neg > 0 then raise exception 'aborted: % step(s) below zero', v_neg; end if;

  select count(*) into v_bad
    from _chain c join public.stock_adjustments a on a.id = c.id
   where a.reason ~ '^ตรวจนับสต็อก \(\d+ → \d+\)'
     and ((regexp_match(a.reason, '\((\d+) → (\d+)\)'))[1]::int <> c.q_after - c.delta
       or (regexp_match(a.reason, '\((\d+) → (\d+)\)'))[2]::int <> c.q_after);
  if v_bad > 0 then raise exception 'aborted: % stock-count checkpoint(s) disagree', v_bad; end if;

  -- A product created since the start must begin at 0.
  select count(*) into v_new
    from _chain c
   where c.rn = 1 and c.q_after - c.delta <> 0
     and c.sku in (select entity_id from public.audit_log
                    where entity = 'product' and action = 'add'
                      and created_at >= timestamptz '2026-10-07 00:00:00+07');
  if v_new > 0 then raise exception 'aborted: % new product(s) do not start at 0', v_new; end if;

  update public.stock_adjustments a
     set qty_before = c.q_after - c.delta, qty_after = c.q_after
    from _chain c
   where a.id = c.id and a.qty_after is null;
end $$;

-- 3. Ledger rows are not editable except by admin
drop policy if exists "update" on public.stock_adjustments;
create policy "update" on public.stock_adjustments
  for update using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- 4. Real author on every new history row
alter table public.audit_log         add column if not exists actor_id uuid;
alter table public.stock_adjustments add column if not exists actor_id uuid;

create or replace function public.set_actor_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actor_id := auth.uid();
  return new;
end $$;

drop trigger if exists audit_log_actor on public.audit_log;
create trigger audit_log_actor before insert on public.audit_log
  for each row execute function public.set_actor_id();
drop trigger if exists stock_adjustments_actor on public.stock_adjustments;
create trigger stock_adjustments_actor before insert on public.stock_adjustments
  for each row execute function public.set_actor_id();
