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

// ── Flex card kit (mirrors line-bot's low-stock card; PS TACTICAL brand) ──
const APP_URL = "https://psstock.vercel.app";
const BRAND_GRAD = { type: "linearGradient", angle: "135deg", startColor: "#FF7A1A", endColor: "#2A2A2A" };
const numA = (v: any) => Number(v) || 0;
function flexHeader(title: string, subtitle?: string) {
  const contents: any[] = [{ type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true }];
  if (subtitle) contents.push({ type: "text", text: subtitle, color: "#FFFFFFCC", size: "xs", margin: "sm", wrap: true });
  return { type: "box", layout: "vertical", paddingAll: "16px", background: BRAND_GRAD, contents };
}
function flexPill(text: string, color: string, bg: string) {
  return { type: "box", layout: "horizontal", margin: "md", contents: [
    { type: "box", layout: "vertical", flex: 0, backgroundColor: bg, cornerRadius: "6px",
      paddingTop: "2px", paddingBottom: "2px", paddingStart: "8px", paddingEnd: "8px",
      contents: [{ type: "text", text, size: "xs", color, weight: "bold" }] },
    { type: "filler" },
  ] };
}
function itemRow(name: string, sub: string, right: string, rightColor: string) {
  return { type: "box", layout: "horizontal", spacing: "sm", contents: [
    { type: "text", size: "sm", flex: 5, wrap: true, contents: [
      { type: "span", text: name, color: "#1A1A1A" },
      ...(sub ? [{ type: "span", text: "  " + sub, color: "#9CA3AF", size: "xs" }] : []),
    ] },
    { type: "text", text: right, size: "sm", color: rightColor, weight: "bold", flex: 2, align: "end", gravity: "center" },
  ] };
}

// Build the digest as a Flex bubble. Returns null when nothing is low.
function buildFlex(products: any[]): any {
  const low: any[] = [], out: any[] = [];
  for (const p of products) {
    const qty = numA(p.qty), reorder = numA(p.reorder);
    if (qty <= 0) out.push(p); else if (qty <= reorder) low.push(p);
  }
  if (!low.length && !out.length) return null;
  const body: any[] = [];
  const push = (arr: any[], label: string, color: string, bg: string) => {
    if (!arr.length) return;
    body.push(flexPill(`${label} ${arr.length}`, color, bg));
    arr.slice(0, 12).forEach((p) => body.push(itemRow(p.name || p.sku, p.sku, `${numA(p.qty)} / ${numA(p.reorder)}`, color)));
    if (arr.length > 12) body.push({ type: "text", text: `…และอีก ${arr.length - 12} รายการ`, size: "xs", color: "#9CA3AF", margin: "sm" });
  };
  push(out, "🔴 หมดสต็อก", "#A32D2D", "#FCEBEB");
  push(low, "🟡 ต่ำกว่าจุดสั่งซื้อ", "#854F0B", "#FAEEDA");
  return {
    type: "bubble",
    header: flexHeader("📦 แจ้งเตือนสต็อกต่ำ", `คลังพร้อมส่ง · ${thaiDate(new Date())}`),
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: body },
    footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: [
      { type: "text", text: `รวม ${out.length + low.length} SKU ที่ต้องสั่งซื้อเพิ่ม`, size: "xs", color: "#6B7280", align: "center", wrap: true },
      { type: "button", style: "link", height: "sm", action: { type: "uri", label: "เปิดในแอป", uri: APP_URL } },
    ] },
  };
}

// ── Weekly sales action digest (mode "weekly") ─────────────────────────────
// Mirrors the app's ต้องจัดการ board in miniature: best sellers this week, the
// ones about to run out, and how much stock hasn't sold in 60 days. Sales =
// every sale-type ledger row in stock_adjustments (ขาย… / ตัดสต็อก…). Values are
// at SELL price only — the OA broadcasts to staff too, who never see cost.
const DAY = 86400000;
function isSaleReason(r: string) { return /^(ขาย|ตัดสต็อก)/.test(r || ""); }
function buildWeekly(products: any[], moves: any[], now: number) {
  const first = moves.length ? Math.min(...moves.map((m) => Date.parse(m.created_at) || now)) : now;
  const observed = Math.max(1, Math.min(60, Math.ceil((now - first) / DAY)));
  const s60 = new Map<string, number>(), s7 = new Map<string, number>();
  for (const m of moves) {
    const t = Date.parse(m.created_at) || 0, q = -numA(m.delta);
    if (q <= 0 || !isSaleReason(m.reason)) continue;
    if (now - t < 60 * DAY) s60.set(m.sku, (s60.get(m.sku) || 0) + q);
    if (now - t < 7 * DAY) s7.set(m.sku, (s7.get(m.sku) || 0) + q);
  }
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const top = [...s7.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([sku, u]) => ({ p: bySku.get(sku) || { sku, name: sku }, u }));
  const restock: any[] = [];
  let deadSkus = 0, deadPcs = 0, deadValue = 0;
  for (const p of products) {
    const qty = Math.max(0, numA(p.qty)), sold = s60.get(p.sku) || 0;
    const perDay = sold / observed;
    if (sold > 0 && perDay > 0 && qty / perDay < 14) restock.push({ p, days: Math.round(qty / perDay), order: Math.max(0, Math.ceil(perDay * 30 - qty)) });
    if (sold === 0 && qty > 0) { deadSkus++; deadPcs += qty; deadValue += qty * numA(p.price); }
  }
  restock.sort((a, b) => a.days - b.days);
  const units7 = [...s7.values()].reduce((a, b) => a + b, 0);
  const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");

  let text = `📊 สรุปยอดขายประจำสัปดาห์ — คลังพร้อมส่ง\n${thaiDate(new Date(now + 7 * 3600000))}\nขาย 7 วัน: ${fmtN(units7)} ชิ้น\n`;
  if (top.length) text += `\n⭐ ขายดี 7 วัน\n` + top.map((t) => `• ${t.p.name} (${t.p.sku}) — ${t.u} ชิ้น`).join("\n") + "\n";
  if (restock.length) text += `\n🔴 ใกล้หมด (${restock.length})\n` + restock.slice(0, 10).map((r) => `• ${r.p.sku} — พอขาย ~${r.days} วัน · แนะนำสั่ง ${r.order}`).join("\n") + "\n";
  text += `\n💤 ไม่มียอดขาย ${observed} วัน: ${fmtN(deadSkus)} SKU · ${fmtN(deadPcs)} ชิ้น · มูลค่าขาย ฿${fmtN(deadValue)}\nดูรายละเอียด: วิเคราะห์ยอดขาย › ต้องจัดการ`;
  if (text.length > 4900) text = text.slice(0, 4900) + "\n…(ตัดทอน)";

  const body: any[] = [
    { type: "text", text: `ขาย 7 วัน ${fmtN(units7)} ชิ้น`, size: "md", weight: "bold", color: "#1A1A1A" },
  ];
  if (top.length) {
    body.push(flexPill("⭐ ขายดี 7 วัน", "#0F6E3A", "#E3F5EA"));
    top.forEach((t) => body.push(itemRow(t.p.name || t.p.sku, t.p.sku, `${t.u} ชิ้น`, "#0F6E3A")));
  }
  if (restock.length) {
    body.push(flexPill(`🔴 ใกล้หมด ${restock.length}`, "#A32D2D", "#FCEBEB"));
    restock.slice(0, 8).forEach((r) => body.push(itemRow(r.p.name || r.p.sku, r.p.sku, `~${r.days} วัน`, "#A32D2D")));
  }
  body.push(flexPill(`💤 ไม่มียอดขาย ${observed} วัน`, "#854F0B", "#FAEEDA"));
  body.push({ type: "text", text: `${fmtN(deadSkus)} SKU · ${fmtN(deadPcs)} ชิ้น · มูลค่าขาย ฿${fmtN(deadValue)}`, size: "sm", color: "#1A1A1A", wrap: true });
  const flex = {
    type: "bubble",
    header: flexHeader("📊 สรุปยอดขายประจำสัปดาห์", `คลังพร้อมส่ง · ${thaiDate(new Date(now + 7 * 3600000))}`),
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: body },
    footer: { type: "box", layout: "vertical", paddingAll: "12px", contents: [
      { type: "button", style: "link", height: "sm", action: { type: "uri", label: "เปิด ต้องจัดการ", uri: APP_URL } },
    ] },
  };
  return { text, flex, stats: { units7, restock: restock.length, deadSkus, observed } };
}

// Broadcast a text or (preferred) Flex message to every OA friend.
async function lineBroadcast(token: string, altText: string, flex?: any) {
  const messages = flex
    ? [{ type: "flex", altText: altText.replace(/\s+/g, " ").trim().slice(0, 380), contents: flex }]
    : [{ type: "text", text: altText }];
  const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ messages }),
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

  // Build/health ping (no auth) — verify a deploy from outside.
  if (payload?.mode === "ping") return json({ ok: true, build: "alert-weekly-1" });

  const mode = ["test", "weekly", "weekly-preview"].includes(payload?.mode) ? payload.mode : "digest";

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

  // ---- Weekly sales digest (cron: body {mode:"weekly"}); weekly-preview returns it unsent ----
  if (mode === "weekly" || mode === "weekly-preview") {
    const now = Date.now();
    const [{ data: prods, error: e1 }, { data: moves, error: e2 }] = await Promise.all([
      admin.from("products").select("sku, name, qty, price"),
      admin.from("stock_adjustments").select("sku, delta, reason, created_at")
        .lt("delta", 0).gte("created_at", new Date(now - 60 * DAY).toISOString()).limit(50000),
    ]);
    if (e1 || e2) return json({ error: (e1 || e2)!.message }, 500);
    const w = buildWeekly(prods || [], moves || [], now);
    if (mode === "weekly-preview") return json({ sent: false, mode, text: w.text, stats: w.stats });
    let r = await lineBroadcast(LINE_TOKEN, w.text, w.flex);
    if (!r.ok) r = await lineBroadcast(LINE_TOKEN, w.text);
    if (!r.ok) return json({ error: "LINE broadcast failed", status: r.status, detail: r.body }, 502);
    return json({ sent: true, mode, stats: w.stats });
  }

  // ---- Daily digest: read products with service role, build & broadcast ----
  const { data: products, error } = await admin
    .from("products")
    .select("sku, name, qty, reorder")
    .order("sku");
  if (error) return json({ error: error.message }, 500);

  const text = buildMessage(products || []);
  if (!text) return json({ sent: false, reason: "no low stock today" });

  const flex = buildFlex(products || []);
  let r = await lineBroadcast(LINE_TOKEN, text, flex);
  if (!r.ok && flex) r = await lineBroadcast(LINE_TOKEN, text);   // fallback to text
  if (!r.ok) return json({ error: "LINE broadcast failed", status: r.status, detail: r.body }, 502);
  return json({ sent: true, mode: "digest", lowCount: (products || []).filter((p: any) => (Number(p.qty)||0) <= (Number(p.reorder)||0)).length });
});
