// Order alerts → Web Push to every OTHER device that turned notifications on.
//
// The browser that makes an order change (new / edited / cancelled) posts the
// alert records it computed (tracking.jsx _orderAlertDiff — before/after per
// line and per field). This function signs and sends one push per alert to
// every row in push_subscriptions except the sender's own, so a locked Android
// phone or a Home-Screen iPhone shows it in the notification tray. The service
// worker stores each payload so the app can show the full before/after review
// when it is opened.
//
// Security: CORS allowlist + JWT; senders must hold an order-writing role (the
// tamper-proof app_metadata claim). Deploy WITH JWT verification (default).
//
// Secrets (Supabase dashboard → Edge Functions → Manage secrets, or
// `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — base64url P-256 public key (same value as the app's ORDER_PUSH_VAPID_PUBLIC)
//   VAPID_PRIVATE_KEY  — base64url private key (never in the repo)
//   VAPID_SUBJECT      — "https://psstock.vercel.app" (contact the push services may use)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const ALLOWED_ORIGINS = [
  "https://psstock.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const SENDER_ROLES = ["admin", "manager", "staff", "packer"];
const MAX_ALERTS = 5;
// Web Push payloads are capped at 4096 bytes after encryption overhead;
// stay well under it.
const MAX_BYTES = 3000;

const KIND = {
  new:     { icon: "🆕", tag: "ออร์เดอร์ใหม่",  msg: "ตรวจสอบและเช็คสินค้าให้ตรงก่อนแพ็ค" },
  edit:    { icon: "✏️", tag: "ออร์เดอร์ถูกแก้ไข", msg: "เช็คสินค้าใหม่อีกครั้ง" },
  removed: { icon: "⛔", tag: "ออร์เดอร์ถูกยกเลิก", msg: "ห้ามส่ง — นำสินค้ากลับที่เดิม" },
} as Record<string, { icon: string; tag: string; msg: string }>;

const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;

// Keep only known fields, short strings, and few lines — then shrink further
// until the whole payload fits.
function slimAlert(a: any, lines: number, textLen: number) {
  return {
    id: str(a.id, 60),
    kind: KIND[a.kind] ? a.kind : "edit",
    at: Number(a.at) || Date.now(),
    short: str(a.short, 40),
    customer: str(a.customer, 40),
    channel: str(a.channel, 20),
    status: str(a.status, 12),
    items: (Array.isArray(a.items) ? a.items : []).slice(0, lines)
      .map((i: any) => ({ sku: str(i.sku, 30), name: str(i.name, textLen), qty: Number(i.qty) || 0 })),
    diff: (Array.isArray(a.diff) ? a.diff : []).slice(0, lines)
      .map((d: any) => ({ sku: str(d.sku, 30), name: str(d.name, textLen), from: Number(d.from) || 0, to: Number(d.to) || 0 })),
    fields: (Array.isArray(a.fields) ? a.fields : []).slice(0, 7)
      .map((f: any) => ({ k: str(f.k, 10), label: str(f.label, 20), from: str(f.from, textLen), to: str(f.to, textLen) })),
  };
}

function summary(a: any): string {
  if (a.kind !== "edit") {
    const n = (a.items || []).length;
    return n ? `${n} รายการ` : "";
  }
  const d = a.diff || [];
  const add = d.filter((x: any) => x.from === 0).length;
  const rem = d.filter((x: any) => x.to === 0).length;
  const qty = d.length - add - rem;
  const parts: string[] = [];
  if (add) parts.push(`เพิ่ม ${add}`);
  if (qty) parts.push(`แก้จำนวน ${qty}`);
  if (rem) parts.push(`เอาออก ${rem}`);
  (a.fields || []).forEach((f: any) => parts.push(f.label));
  return parts.length ? "แก้: " + parts.join(", ") : "";
}

function buildPayload(a: any, by: string) {
  for (const [lines, textLen] of [[8, 48], [6, 32], [4, 24], [2, 16], [0, 16]]) {
    const alert = slimAlert(a, lines, textLen);
    const k = KIND[alert.kind];
    const head = [alert.customer, alert.channel, summary(alert)].filter(Boolean).join(" · ");
    const payload = {
      title: `${k.icon} ${k.tag} · ${alert.short || alert.id}`,
      body: `${head ? head + "\n" : ""}${k.msg}${by ? " (โดย " + by + ")" : ""}`,
      tag: "ims-order-" + alert.id,
      url: "/",
      alert,
    };
    if (bytes(payload) <= MAX_BYTES) return payload;
  }
  return null;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ ok: false, error: "Unauthorized" }, 401);
  const role = (user.app_metadata as any)?.role;
  if (!SENDER_ROLES.includes(role)) return json({ ok: false, error: "Forbidden" }, 403);

  const PUB = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const PRIV = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const SUBJECT = Deno.env.get("VAPID_SUBJECT") || "https://psstock.vercel.app";
  if (!PUB || !PRIV) return json({ ok: false, error: "VAPID keys not configured" }, 500);
  webpush.setVapidDetails(SUBJECT, PUB, PRIV);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }

  // {mode:"test"} → one test push to the CALLER's own devices (settings button).
  const test = body && body.mode === "test";
  const alerts = test
    ? [{ id: "TEST", kind: "new", short: "ทดสอบ", customer: "การแจ้งเตือนทำงานปกติ", items: [] }]
    : (Array.isArray(body?.alerts) ? body.alerts : []).slice(0, MAX_ALERTS);
  if (!alerts.length) return json({ ok: true, sent: 0 });

  let q = admin.from("push_subscriptions").select("endpoint, p256dh, auth, role, user_id");
  q = test ? q.eq("user_id", user.id) : q.neq("user_id", user.id);
  const { data: subs, error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);
  const targets = (subs || []).filter((s: any) => s.role !== "viewer");

  const by = test ? "" : str((user.user_metadata as any)?.name || (user.user_metadata as any)?.full_name || "", 30);
  const payloads = alerts.map((a: any) => buildPayload(a, by)).filter(Boolean);

  let sent = 0, failed = 0;
  const dead: string[] = [];
  await Promise.all(targets.map(async (s: any) => {
    for (const p of payloads) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(p),
          { TTL: 60 * 60 * 12, urgency: "high" },
        );
        sent++;
      } catch (e: any) {
        failed++;
        // 404/410 = the browser dropped this subscription; forget it.
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { dead.push(s.endpoint); break; }
      }
    }
  }));
  if (dead.length) await admin.from("push_subscriptions").delete().in("endpoint", dead);

  return json({ ok: true, devices: targets.length, sent, failed, removed: dead.length });
});
