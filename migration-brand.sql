-- Add a Brand field to products.
-- Run this in the Supabase SQL editor (project ref eayufrfkmpeeeuaimvqw)
-- BEFORE deploying the code that writes `brand` — dbUpsertProducts sends an
-- explicit column list, so a missing column makes every product save fail.
-- Non-destructive and idempotent.

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text;
