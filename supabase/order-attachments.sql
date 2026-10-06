-- ═══════════════════════════════════════════════════════════════════════════
--  รูป/ไฟล์แนบออร์เดอร์ (order_attachments) — แพ็คสินค้า page (pack-docs.jsx)
--
--  Many files per order (photos of the packed parcel, damage, slips…), added
--  by anyone who works the pack page — INCLUDING the packer role, which can't
--  touch order_files (the one courier label). Separate table so the label slot
--  and its rules stay unchanged.
--    • read:   any signed-in user
--    • insert: admin / manager / staff / packer (created_by forced to the caller)
--    • delete: admin / manager / staff, or the uploader's own file
--  Same payload guard as order_files: only real JPEG/PDF data URLs.
--  Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.order_attachments (
  id              uuid primary key default gen_random_uuid(),
  order_id        text not null,
  name            text not null default '',
  type            text not null check (type in ('image/jpeg','application/pdf')),
  data_url        text not null,
  created_by      uuid not null default auth.uid(),
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  constraint order_attachments_payload_chk check (
    (type = 'image/jpeg'      and data_url like 'data:image/jpeg;base64,%') or
    (type = 'application/pdf' and data_url like 'data:application/pdf;base64,%')
  ),
  constraint order_attachments_size_chk check (length(data_url) <= 3000000)
);
create index if not exists order_attachments_order_idx on public.order_attachments (order_id, created_at);

alter table public.order_attachments enable row level security;
drop policy if exists "read"   on public.order_attachments;
drop policy if exists "insert" on public.order_attachments;
drop policy if exists "delete" on public.order_attachments;
create policy "read" on public.order_attachments for select using (auth.role() = 'authenticated');
create policy "insert" on public.order_attachments for insert with check (
  public.auth_role() in ('admin','manager','staff','packer') and created_by = auth.uid()
);
create policy "delete" on public.order_attachments for delete using (
  public.auth_role() in ('admin','manager','staff') or created_by = auth.uid()
);
-- no UPDATE policy: an attachment is replaced by delete + add.
