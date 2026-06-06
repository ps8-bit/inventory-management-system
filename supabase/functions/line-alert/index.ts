import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Daily low-stock alert → LINE Official Account (Messaging API broadcast).
//
// LINE Notify was discontinued 2025-03-31, so this uses the Messaging API:
// it broadcasts ONE text message to every friend of the OA. Each recipient
// counts as 1 message against the OA's monthly quota (free plan ~200-500/mo),
// so a daily digest to a small team stays free.
//
// Two ways to invoke:
//   1. Scheduled (pg_cron) — server-to-server, header `x-cron-secret: <CRON_SECRET>`.
//   2. Manual test from the app — admin JWT in Authorization, body `{ mode: "test" }`.
//
// Secrets (set in Supabase dashboard → Edge Functions → Manage secrets):
//   LINE_CHANNEL_ACCESS_TOKEN  — long-lived channel access token from the LINE
//                                Developers console (Messaging API channel).
//   CRON_SECRET                — any random string; pg_cron sends it in the header.
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

const ALLOWED_ORIGINS = [
  "https://psstock.vercel.app",
  "http://localhost:3000",
  "http://localhost:5173",
];

function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Thai Buddhist-era date, e.g. "4 มิ.ย. 2569"
function thaiDate(d: Date) {
  const months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

// Build the digest text from low-stock products. Returns null when nothing is low.
function buildMessage(products: any[]): string | null {
  const low: any[] = [];
  const out: any[] = [];
  for (const p of products) {
    const qty = Number(p.qty) || 0;
    const reorder = Number(p.reorder) || 0;
    if (qty <= 0) out.push(p);
    else if (qty <= reorder) low.push(p);
  }
  if (!low.length && !out.length) return null;

  const line = (p: any) =>
    `• ${p.name || p.sku} (${p.sku}) — เหลือ ${Number(p.qty) || 0} / จุดสั่ง ${Number(p.reorder) || 0}`;

  let msg = `📦 แจ้งเตือนสต็อกต่ำ — คลังพร้อมส่ง\n${thaiDate(new Date())}\n`;
  if (out.length) {
    msg += `\n🔴 หมดสต็อก (${out.length})\n` + out.slice(0, 30).map(line).join("\n") + "\n";
    if (out.length > 30) msg += `…และอีก ${out.length - 30} รายการ\n`;
  }
  if (low.length) {
    msg += `\n🟡 ต่ำกว่าจุดสั่งซื้อ (${low.length})\n` + low.slice(0, 30).map(line).join("\n") + "\n";
    if (low.length > 30) msg += `…และอีก ${low.length - 30} รายการ\n`;
  }
  msg += `\nรวม ${out.length + low.length} SKU ที่ต้องสั่งซื้อเพิ่ม`;
  // LINE text message hard limit is 5000 chars.
  return msg.length > 4900 ? msg.slice(0, 4900) + "\n…(ตัดทอน)" : msg;
}

async function lineBroadcast(token: string, text: string) {
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ messages: [{ type: "text", text }] }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

  if (!LINE_TOKEN) return json({ error: "LINE_CHANNEL_ACCESS_TOKEN not set" }, 500);

  let payload: any = {};
  try { payload = await req.json(); } catch { /* empty body = scheduled digest */ }
  const mode = payload?.mode === "test" ? "test" : "digest";

  // ---- Authorize: cron-secret header (scheduled) OR admin JWT (manual test) ----
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const cronOk = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
  let adminOk = false;
  if (!cronOk) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const { data: { user } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      adminOk = user?.app_metadata?.role === "admin";
    }
  }
  if (!cronOk && !adminOk) return json({ error: "Unauthorized" }, 401);

  // ---- Manual test: send a fixed message so the team can confirm wiring ----
  if (mode === "test") {
    const r = await lineBroadcast(LINE_TOKEN, "✅ ทดสอบการแจ้งเตือนสต็อกจาก คลังพร้อมส่ง — การเชื่อมต่อ LINE ทำงานปกติ");
    if (!r.ok) return json({ error: "LINE broadcast failed", status: r.status, detail: r.body }, 502);
    return json({ sent: true, mode: "test" });
  }

  // ---- Daily digest: read products with service role, build & broadcast ----
  const { data: products, error } = await admin
    .from("products")
    .select("sku, name, qty, reorder")
    .order("sku");
  if (error) return json({ error: error.message }, 500);

  const text = buildMessage(products || []);
  if (!text) return json({ sent: false, reason: "no low stock today" });

  const r = await lineBroadcast(LINE_TOKEN, text);
  if (!r.ok) return json({ error: "LINE broadcast failed", status: r.status, detail: r.body }, 502);
  return json({ sent: true, mode: "digest", lowCount: (products || []).filter((p: any) => (Number(p.qty)||0) <= (Number(p.reorder)||0)).length });
});
