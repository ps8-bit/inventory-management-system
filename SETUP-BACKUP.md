# Automatic nightly backup → Google Drive

This sets up the **`backup-to-drive`** Edge Function to upload a full JSON snapshot
of your data to a Google Drive folder every night, keeping the newest 30 copies.

It uploads to **your own Google account's Drive** using an OAuth *refresh token*
(15 GB free, backups are tiny). This avoids the "service account has 0 storage"
problem, so it works with a normal Gmail — no Google Workspace needed.

> Tier 1 (the **"ดาวน์โหลดไฟล์สำรอง"** button in Settings → สำรองข้อมูล) already
> works with zero setup. This document is only for the **automatic** nightly upload.

You do this once (~15 min). Steps 1–5 are on Google; step 6 stores the secrets;
step 7 schedules it. The function itself is already deployed.

---

## 1. Enable the Google Drive API
1. Go to <https://console.cloud.google.com/> → create a project (e.g. `ps-tactical-backup`).
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.

## 2. Create an OAuth client
1. **APIs & Services → OAuth consent screen** → User type **External** → fill app
   name + your email → Save. Under **Audience/Test users**, add your own Gmail.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   → Application type **Web application**.
3. Under **Authorized redirect URIs** add: `https://developers.google.com/oauthplayground`
4. **Create** → copy the **Client ID** and **Client secret**.

## 3. Get a refresh token (one time)
1. Open <https://developers.google.com/oauthplayground/>.
2. Click the **⚙️ (top-right) → "Use your own OAuth credentials"** → paste the
   Client ID + Client secret from step 2.
3. In the left **"Input your own scopes"** box, enter:
   `https://www.googleapis.com/auth/drive.file`
   → **Authorize APIs** → sign in with your Gmail → allow.
4. Click **"Exchange authorization code for tokens"**.
5. Copy the **Refresh token** (a long string starting with `1//`).

## 4. Create the Drive folder
1. In Google Drive, make a folder, e.g. **`PS TACTICAL Backups`**.
2. Open it; the URL is `https://drive.google.com/drive/folders/XXXXXXXX` —
   copy that `XXXXXXXX` part (the **folder ID**).

## 5. (Already done) the function is deployed
`backup-to-drive` is deployed. If you ever change it, re-deploy with:
```
npx supabase functions deploy backup-to-drive --project-ref eayufrfkmpeeeuaimvqw
```

## 6. Set the secrets
Run these (replace the values). You can also set them in the Supabase Dashboard →
**Edge Functions → Manage secrets**.
```
npx supabase secrets set GOOGLE_CLIENT_ID="<client id>"        --project-ref eayufrfkmpeeeuaimvqw
npx supabase secrets set GOOGLE_CLIENT_SECRET="<client secret>" --project-ref eayufrfkmpeeeuaimvqw
npx supabase secrets set GOOGLE_REFRESH_TOKEN="<refresh token>" --project-ref eayufrfkmpeeeuaimvqw
npx supabase secrets set GDRIVE_FOLDER_ID="<folder id>"         --project-ref eayufrfkmpeeeuaimvqw
npx supabase secrets set BACKUP_RETENTION="30"                  --project-ref eayufrfkmpeeeuaimvqw
```
`CRON_SECRET` is likely already set (it powers the LINE digest). If not:
```
npx supabase secrets set CRON_SECRET="<a long random string>" --project-ref eayufrfkmpeeeuaimvqw
```

## 7. Schedule it
Open **Supabase Dashboard → SQL Editor**, paste the contents of
[`supabase/setup-backup-cron.sql`](supabase/setup-backup-cron.sql), replace
`PUT-YOUR-CRON-SECRET-HERE` with your `CRON_SECRET`, and **Run**.
Default time is **02:00 Asia/Bangkok**.

## 8. Test it now
In the SQL Editor, run just the `net.http_post(...)` block from the cron file once,
then check your Drive folder for a new `ims-backup-*.json`. (Or `curl` the function
with `-H "x-cron-secret: <CRON_SECRET>"`.)

---

## Restoring from a backup
The backup is a plain JSON of every table (`tables.products`, `tables.orders`, …).
To restore, the rows can be upserted back into Supabase. A guided in-app
**Restore** is not built yet (it overwrites live data, so it needs care) — ping me
and I'll add it behind a confirmation.

## Security notes
- The Google credentials live **only** as Supabase Edge-Function secrets (server
  side) — never in the frontend or git.
- The function only runs for the **cron** (shared secret) or a logged-in **admin**.
- Scope is `drive.file`: the app can only see/manage files **it created**, not your
  whole Drive.
