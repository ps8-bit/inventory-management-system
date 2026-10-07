-- Invite codes: an admin generates a short one-time code (with a role + expiry);
-- a new employee enters it on the login screen to create their own account.
-- Only the service role (manage-users / redeem-invite Edge Functions) touches
-- this table: RLS is ON with NO policies, so the browser can never list codes.
create table if not exists public.invite_codes (
  code        text primary key,
  role        text not null check (role in ('manager','staff','packer','viewer')),
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid,
  used_email  text,
  revoked_at  timestamptz
);
alter table public.invite_codes enable row level security;
revoke all on public.invite_codes from anon, authenticated;
