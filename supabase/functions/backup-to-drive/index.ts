// Nightly full-data backup → Google Drive.
// Reads every table with the service role, uploads a JSON snapshot to a Drive
// folder, and prunes old backups. Uses an OAuth refresh token (uploads to the
// owner's own Drive — 15GB free — avoiding the service-account 0-quota gotcha).
// Triggered by cron (x-cron-secret) or manually by a logged-in admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TABLES = ["products", "orders", "bundles", "bundle_items", "labels", "store_settings", "app_state", "audit_log"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
    refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error("Google token error: " + JSON.stringify(j).slice(0, 200));
  return j.access_token as string;
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Authorize: internal cron (shared secret) OR a logged-in admin (manual run).
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const internalOk = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!internalOk) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);
    const { data: { user }, error } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return json({ success: false, error: "Unauthorized" }, 401);
    const role = (user.app_metadata as any)?.role || (user.user_metadata as any)?.role;
    if (role !== "admin") return json({ success: false, error: "Forbidden — admin only" }, 403);
  }

  const folderId = Deno.env.get("GDRIVE_FOLDER_ID");
  if (!folderId) return json({ success: false, error: "GDRIVE_FOLDER_ID not configured" }, 500);
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    if (!Deno.env.get(k)) return json({ success: false, error: `${k} not configured` }, 500);
  }

  // 1) Snapshot every table.
  const tables: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const { data, error } = await admin.from(t).select("*");
    tables[t] = error ? [] : (data || []);
    counts[t] = Array.isArray(tables[t]) ? (tables[t] as unknown[]).length : 0;
  }
  const snapshot = {
    app: "PS TACTICAL — คลังพร้อมส่ง (IMS)",
    kind: "ims-backup", version: 1,
    generatedAt: new Date().toISOString(),
    counts, tables,
  };
  const content = JSON.stringify(snapshot);

  // 2) Google OAuth access token.
  let token: string;
  try { token = await getAccessToken(); }
  catch (e) { return json({ success: false, error: String(e).slice(0, 300) }, 502); }

  // 3) Upload as a multipart file into the target folder.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const boundary = "ims" + Math.random().toString(36).slice(2);
  const meta = { name: `ims-backup-${stamp}.json`, parents: [folderId] };
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;

  const up = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  );
  const upJson = await up.json();
  if (!up.ok || !upJson.id)
    return json({ success: false, error: "Drive upload failed: " + JSON.stringify(upJson).slice(0, 300) }, 502);

  // 4) Retention — keep the newest N backups, delete the rest (best-effort).
  const keep = parseInt(Deno.env.get("BACKUP_RETENTION") || "30", 10) || 30;
  let pruned = 0;
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and name contains 'ims-backup' and trashed = false`);
    const list = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { "Authorization": "Bearer " + token } },
    );
    const lj = await list.json();
    const files = Array.isArray(lj.files) ? lj.files : [];
    for (const f of files.slice(keep)) {
      const del = await fetch(
        `https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`,
        { method: "DELETE", headers: { "Authorization": "Bearer " + token } },
      );
      if (del.ok) pruned++;
    }
  } catch (_) { /* retention is best-effort — never fail the backup over it */ }

  return json({ success: true, file: upJson.name, id: upJson.id, counts, pruned });
});
