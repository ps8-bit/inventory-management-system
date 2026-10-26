-- Product photos in our own Supabase Storage (2026-10-26).
-- Before this, 289 of 333 product photos were links to Shopify / Shopline CDNs
-- (gone the day they delete or rename a file) and the rest were multi-hundred-KB
-- data: URIs inside app_state "img:<sku>" rows, which made the photo set take
-- ~30 s to load. Now every photo is an 800 px WebP file here and the img:<sku>
-- row holds only its public URL (product-images.jsx mirrors new photos on save
-- and an admin/manager device moves the old ones in the background).
--
-- Public READ: product photos are not secret and a public URL works in a plain
-- <img> with no token. Writes follow the app_state product-photo writers:
-- staff can add (quick-add with a photo); only admin/manager replace or delete.
-- Idempotent — safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_images_read"   on storage.objects;
drop policy if exists "product_images_insert" on storage.objects;
drop policy if exists "product_images_update" on storage.objects;
drop policy if exists "product_images_delete" on storage.objects;

create policy "product_images_read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "product_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images'
              and public.auth_role() in ('admin', 'manager', 'staff'));

create policy "product_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.auth_role() in ('admin', 'manager'))
  with check (bucket_id = 'product-images' and public.auth_role() in ('admin', 'manager'));

create policy "product_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.auth_role() in ('admin', 'manager'));
