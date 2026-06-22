import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// LINE chatbot webhook for คลังพร้อมส่ง — replies to on-demand report commands.
// Reply messages (responding to an incoming message) are FREE & unlimited on LINE,
// so querying the bot costs nothing. The separate line-alert function still handles
// the scheduled daily push.
//
// Commands (Thai): ของต่ำ/สต็อกต่ำ · สต็อกรวม · ออเดอร์/ค้างส่ง · ยอดขาย · เมนู/ช่วยเหลือ
//
// Two entry paths:
//   1. LINE webhook  — POST from LINE, verified via X-Line-Signature (HMAC-SHA256
//                      of the raw body with LINE_CHANNEL_SECRET). Replies through LINE.
//   2. Preview       — POST { mode:"preview", command:"ของต่ำ" } with an admin JWT.
//                      Returns { text } so the app / a developer can test the report
//                      logic against real data without wiring up LINE.
//
// Secrets (Supabase → Edge Functions → Manage secrets):
//   LINE_CHANNEL_ACCESS_TOKEN  — same token used by line-alert (for sending replies)
//   LINE_CHANNEL_SECRET        — channel secret, used to verify webhook signatures
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY provided automatically)
//
// LINE setup: paste this function's URL as the channel's Webhook URL and turn
// "Use webhook" ON in the Messaging API channel settings.

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-line-signature",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const enc = new TextEncoder();
const baht = (n: number) => "฿" + Math.round(n).toLocaleString("en-US");
const num = (n: any) => Number(n) || 0;

// Thai Buddhist-era short date "4 มิ.ย. 2569"
function thaiDate(d: Date) {
  const m = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${d.getUTCDate()} ${m[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}
// "Today" in Thailand (UTC+7) as YYYY-MM-DD
function thaiTodayISO() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function verifyLineSignature(secret: string, rawBody: string, signature: string) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === signature;
}

async function lineReply(token: string, replyToken: string, text: string) {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
}

// Reply with an arbitrary LINE message array (text and/or flex).
async function lineReplyMessages(token: string, replyToken: string, messages: any[]) {
  return fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
    body: JSON.stringify({ replyToken, messages }),
  });
}

// A command result is either a plain string (text reply) or { text, flex } where
// `flex` is a Flex contents object and `text` doubles as the altText fallback.
type BotReply = string | { text: string; flex?: any };
function toLineMessages(msg: BotReply): any[] {
  if (typeof msg === "string") return [{ type: "text", text: msg }];
  if (msg && msg.flex) {
    const alt = (msg.text || "รายงาน").replace(/\s+/g, " ").trim().slice(0, 380);
    return [{ type: "flex", altText: alt, contents: msg.flex }];
  }
  return [{ type: "text", text: (msg && msg.text) || "—" }];
}

// Send a reply (text or flex). On a flex send failure (malformed JSON → LINE 4xx)
// fall back to plain text so the user still gets an answer. Used by the webhook
// loop and the background slip handler.
async function sendReply(token: string, replyToken: string, msg: BotReply) {
  const messages = toLineMessages(msg);
  const r = await lineReplyMessages(token, replyToken, messages);
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    const isFlex = messages.some((m: any) => m.type === "flex");
    console.error(`[line-bot] reply failed (${isFlex ? "flex" : "text"})`, r.status, detail.slice(0, 400));
    if (isFlex) {
      const t = typeof msg === "string" ? msg : (msg.text || "—");
      await lineReplyMessages(token, replyToken, [{ type: "text", text: t }]).catch(() => {});
    }
  }
}

// ───────────────────── shared Flex card kit (PS TACTICAL) ─────────────────────
const BRAND_GRAD = { type: "linearGradient", angle: "135deg", startColor: "#FF7A1A", endColor: "#2A2A2A" };
function flexHeader(title: string, subtitle?: string) {
  const contents: any[] = [{ type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true }];
  if (subtitle) contents.push({ type: "text", text: subtitle, color: "#FFFFFFCC", size: "xs", margin: "sm", wrap: true });
  return { type: "box", layout: "vertical", paddingAll: "16px", background: BRAND_GRAD, contents };
}
function flexCard(header: any, bodyContents: any[], footerContents?: any[]) {
  const bubble: any = {
    type: "bubble",
    header,
    body: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "16px", contents: bodyContents },
  };
  if (footerContents && footerContents.length) {
    bubble.footer = { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footerContents };
  }
  return bubble;
}
function flexPill(text: string, color: string, bg: string) {
  return {
    type: "box", layout: "horizontal", margin: "md",
    contents: [
      { type: "box", layout: "vertical", flex: 0, backgroundColor: bg, cornerRadius: "6px",
        paddingTop: "2px", paddingBottom: "2px", paddingStart: "8px", paddingEnd: "8px",
        contents: [{ type: "text", text, size: "xs", color, weight: "bold" }] },
      { type: "filler" },
    ],
  };
}
function kvRow(label: string, value: string, opts: { color?: string; bold?: boolean; big?: boolean } = {}) {
  return {
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#6B7280", flex: 4, gravity: "center", wrap: true },
      { type: "text", text: value, size: opts.big ? "lg" : "sm", color: opts.color || "#1A1A1A",
        weight: opts.bold ? "bold" : "regular", flex: 5, align: "end", gravity: "center", wrap: true },
    ],
  };
}
// A name + faint sku/sub on the left, a colored value on the right.
function itemRow(name: string, sub: string, right: string, rightColor: string, nameBold = false) {
  return {
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      { type: "text", size: "sm", flex: 5, wrap: true, contents: [
        { type: "span", text: name, color: "#1A1A1A", weight: nameBold ? "bold" : "regular" },
        ...(sub ? [{ type: "span", text: "  " + sub, color: "#9CA3AF", size: "xs" }] : []),
      ] },
      { type: "text", text: right, size: "sm", color: rightColor, weight: "bold", flex: 2, align: "end", gravity: "center", wrap: true },
    ],
  };
}
function moreRow(n: number) {
  return { type: "text", text: `…และอีก ${n} รายการ`, size: "xs", color: "#9CA3AF", margin: "sm" };
}
function appButton(label = "เปิดในแอป") {
  return { type: "button", style: "link", height: "sm", action: { type: "uri", label, uri: APP_URL } };
}
function msgButton(label: string, text: string) {
  return { type: "button", style: "secondary", height: "sm", margin: "sm", action: { type: "message", label, text } };
}

// Thai phone → national significant number (drop +66 / leading zeros) so
// "+66 81…" and "081…" compare equal.
function phoneNSN(p: string) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("66")) d = d.slice(2);
  return d.replace(/^0+/, "");
}
const last7 = (s: string) => String(s || "").replace(/\D/g, "").slice(-7);

// Normalise an OCR'd courier string to one of the app's carrier names.
const CARRIER_ALIASES: [RegExp, string][] = [
  [/flash/i, "Flash Express"],
  [/kerry|kex/i, "KEX"],
  [/j&t|jt|เจแอนด์ที|เจ\s*แอนด์/i, "J&T Express"],
  [/ems|ไปรษณ|thai\s*post|ปณ\.?|ลงทะเบียน/i, "Thai Post (EMS)"],
  [/ninja/i, "Ninja Van"],
  [/dhl/i, "DHL"],
  [/best\s*ex|เบสท์/i, "Best Express"],
  [/scg/i, "SCG Express"],
  [/alpha/i, "Alpha Fast"],
  [/lalamove|lala/i, "Lalamove"],
];
function mapCarrier(s: string) {
  const x = String(s || "");
  for (const [re, name] of CARRIER_ALIASES) if (re.test(x)) return name;
  return x.trim();
}

// Carrier tracking deep-links — mirrors CARRIER_URLS in tracking.jsx so the bot's
// "ติดตามพัสดุ" button opens the same page the app links to. Carriers without a
// per-parcel page (Shopee/Alpha) are omitted → button falls back to the app.
const APP_URL = "https://psstock.vercel.app";
const CARRIER_TRACK_URLS: Record<string, (t: string) => string> = {
  "KEX":             (t) => `https://th.kex-express.com/th/track/?track=${t}`,
  "Flash Express":   (t) => `https://www.flashexpress.co.th/fle/tracking/?se=${t}`,
  "J&T Express":     (t) => `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${t}`,
  "Thai Post (EMS)": (t) => `https://track.thailandpost.co.th/?trackNumber=${t}`,
  "Ninja Van":       (t) => `https://www.ninjavan.co/th-th/tracking?id=${t}`,
  "Best Express":    (t) => `https://www.best-inc-th.com/track/defaultSearch?logisticNo=${t}`,
  "DHL":             (t) => `https://www.dhl.com/th-th/home/tracking.html?tracking-id=${t}`,
};
function carrierTrackUrl(carrier: string, tracking: string): string | null {
  const fn = CARRIER_TRACK_URLS[carrier];
  return fn && tracking ? fn(encodeURIComponent(tracking)) : null;
}

// ── Bot access control: an allowlist of LINE userIds, stored in app_state ──
// Staff enroll once by sending the passcode (LINE_BOT_PASSCODE). Anyone not on
// the list gets a polite refusal and no data. If no passcode is set, the bot
// stays open (backward-compatible) so the owner can't lock themselves out.
async function loadBotUsers(admin: any): Promise<any[]> {
  const { data } = await admin.from("app_state").select("value").eq("key", "line_bot_users").maybeSingle();
  return Array.isArray(data?.value) ? data.value : [];
}
async function saveBotUsers(admin: any, users: any[]) {
  await admin.from("app_state").upsert({ key: "line_bot_users", value: users, updated_at: new Date().toISOString() });
}
async function lineProfileName(token: string, userId: string): Promise<string> {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { Authorization: "Bearer " + token } });
    if (r.ok) { const j = await r.json(); return j.displayName || ""; }
  } catch { /* ignore */ }
  return "";
}

// ───────────────────────── report builders ─────────────────────────

async function reportLowStock(admin: any): Promise<BotReply> {
  const { data: products } = await admin.from("products").select("sku, name, qty, reorder").order("sku");
  const low: any[] = [], out: any[] = [];
  for (const p of products || []) {
    const q = num(p.qty), r = num(p.reorder);
    if (q <= 0) out.push(p); else if (q <= r) low.push(p);
  }
  const date = thaiDate(new Date());

  if (!low.length && !out.length) {
    const text = "✅ สต็อกปกติ — ไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ";
    return { text, flex: flexCard(flexHeader("📦 สต็อกต่ำ", date),
      [{ type: "text", text, size: "sm", color: "#0F6E56", wrap: true }]) };
  }

  // text (altText / fallback)
  const tline = (p: any) => `• ${p.name || p.sku} (${p.sku}) — เหลือ ${num(p.qty)} / จุดสั่ง ${num(p.reorder)}`;
  let t = `📦 สต็อกต่ำ — ${date}\n`;
  if (out.length) t += `\n🔴 หมดสต็อก (${out.length})\n` + out.slice(0, 20).map(tline).join("\n") + "\n";
  if (low.length) t += `\n🟡 ต่ำกว่าจุดสั่งซื้อ (${low.length})\n` + low.slice(0, 20).map(tline).join("\n") + "\n";
  t += `\nรวม ${out.length + low.length} SKU ที่ต้องสั่งซื้อเพิ่ม`;
  const text = t.length > 4900 ? t.slice(0, 4900) + "\n…(ตัดทอน)" : t;

  // flex
  const body: any[] = [];
  const push = (arr: any[], label: string, color: string, bg: string) => {
    if (!arr.length) return;
    body.push(flexPill(`${label} ${arr.length}`, color, bg));
    arr.slice(0, 12).forEach((p) => body.push(
      itemRow(p.name || p.sku, p.sku, `${num(p.qty)} / ${num(p.reorder)}`, color)));
    if (arr.length > 12) body.push(moreRow(arr.length - 12));
  };
  push(out, "🔴 หมดสต็อก", "#A32D2D", "#FCEBEB");
  push(low, "🟡 ต่ำกว่าจุดสั่งซื้อ", "#854F0B", "#FAEEDA");
  const flex = flexCard(flexHeader("📦 สต็อกต่ำ", date), body, [
    { type: "text", text: `รวม ${out.length + low.length} SKU ที่ต้องสั่งซื้อเพิ่ม`, size: "xs", color: "#6B7280", align: "center", wrap: true },
    appButton(),
  ]);
  return { text, flex };
}

async function reportStockSummary(admin: any): Promise<BotReply> {
  const { data: products } = await admin.from("products").select("sku, qty, reserved, price");
  const p = products || [];
  const skus = p.length;
  const totalQty = p.reduce((s: number, x: any) => s + num(x.qty), 0);
  const reserved = p.reduce((s: number, x: any) => s + num(x.reserved), 0);
  const ready = p.reduce((s: number, x: any) => s + Math.max(0, num(x.qty) - num(x.reserved)), 0);
  const value = p.reduce((s: number, x: any) => s + num(x.qty) * num(x.price), 0);
  const date = thaiDate(new Date());
  const n = (v: number) => v.toLocaleString("en-US");

  const text = `📊 สรุปสต็อก — ${date}\n\n`
    + `• จำนวน SKU: ${skus}\n`
    + `• คงเหลือรวม: ${n(totalQty)} ชิ้น\n`
    + `• พร้อมขาย: ${n(ready)} ชิ้น\n`
    + `• จองไว้: ${n(reserved)} ชิ้น\n`
    + `• มูลค่าสต็อก (ตามราคาขาย): ${baht(value)}`;

  const flex = flexCard(flexHeader("📊 สรุปสต็อก", date), [
    kvRow("จำนวน SKU", n(skus)),
    kvRow("คงเหลือรวม", n(totalQty) + " ชิ้น"),
    kvRow("พร้อมขาย", n(ready) + " ชิ้น", { color: "#0F6E56", bold: true }),
    kvRow("จองไว้", n(reserved) + " ชิ้น"),
    { type: "separator", margin: "md" },
    kvRow("มูลค่าสต็อก", baht(value), { color: "#993C1D", bold: true, big: true }),
  ]);
  return { text, flex };
}

async function reportPendingOrders(admin: any): Promise<BotReply> {
  const { data: orders } = await admin.from("orders").select("id, customer, status, carrier");
  const o = orders || [];
  const picking = o.filter((x: any) => x.status === "picking");
  const packed = o.filter((x: any) => x.status === "packed");
  const pending = [...picking, ...packed];

  if (!pending.length) {
    const text = "✅ ไม่มีออร์เดอร์ค้างส่ง — จัดส่งครบแล้ว";
    return { text, flex: flexCard(flexHeader("🚚 ออร์เดอร์ค้างส่ง", thaiDate(new Date())),
      [{ type: "text", text, size: "sm", color: "#0F6E56", wrap: true }]) };
  }

  const line = (x: any) => `• ${x.id} — ${x.customer || "—"}${x.carrier ? " · " + x.carrier : ""}`;
  let t = `🚚 ออร์เดอร์ค้างส่ง (${pending.length})\n`
    + `กำลังหยิบ ${picking.length} · พร้อมส่ง ${packed.length}\n\n`
    + pending.slice(0, 25).map(line).join("\n");
  if (pending.length > 25) t += `\n…และอีก ${pending.length - 25} รายการ`;

  const orderRow = (x: any) => {
    const packedOne = x.status === "packed";
    return itemRow(x.id, x.customer || "—",
      packedOne ? "พร้อมส่ง" : "กำลังหยิบ", packedOne ? "#085041" : "#854F0B", true);
  };
  const body: any[] = pending.slice(0, 15).map(orderRow);
  if (pending.length > 15) body.push(moreRow(pending.length - 15));
  const flex = flexCard(
    flexHeader(`🚚 ออร์เดอร์ค้างส่ง (${pending.length})`, `กำลังหยิบ ${picking.length} · พร้อมส่ง ${packed.length}`),
    body, [appButton()]);
  return { text: t, flex };
}

async function reportSales(admin: any): Promise<BotReply> {
  const [{ data: products }, { data: orders }] = await Promise.all([
    admin.from("products").select("sku, price"),
    admin.from("orders").select("id, status, line_items, cod_amount, date_iso, created_at"),
  ]);
  const priceOf: Record<string, number> = {};
  for (const p of products || []) priceOf[p.sku] = num(p.price);

  const today = thaiTodayISO();
  const month = today.slice(0, 7);
  const dateOf = (o: any) => (o.date_iso || (o.created_at ? o.created_at.slice(0, 10) : ""));
  const revenueOf = (o: any) => {
    const li = Array.isArray(o.line_items) ? o.line_items : [];
    const fromItems = li.reduce((s: number, it: any) => s + num(it.qty) * (priceOf[it.sku] ?? num(it.price)), 0);
    return fromItems > 0 ? fromItems : num(o.cod_amount);
  };
  const o = orders || [];
  const todayOrders = o.filter((x: any) => dateOf(x) === today);
  const monthOrders = o.filter((x: any) => dateOf(x).slice(0, 7) === month);
  const sum = (arr: any[]) => arr.reduce((s, x) => s + revenueOf(x), 0);
  const tRev = sum(todayOrders), mRev = sum(monthOrders);

  const date = thaiDate(new Date());
  let t = `💰 ยอดขาย — ${date}\n\n`
    + `วันนี้: ${todayOrders.length} ออร์เดอร์ · ${baht(tRev)}\n`
    + `เดือนนี้: ${monthOrders.length} ออร์เดอร์ · ${baht(mRev)}`;
  const noteNeeded = mRev === 0 && monthOrders.length > 0;
  if (noteNeeded) t += `\n\n(ออร์เดอร์ส่วนใหญ่เป็นฉลาก/ไม่มีรายการสินค้า จึงคำนวณมูลค่าไม่ได้)`;

  const metric = (label: string, count: number, amt: number) => ({
    type: "box", layout: "vertical", spacing: "xs", flex: 1,
    backgroundColor: "#F7F7F7", cornerRadius: "10px", paddingAll: "14px",
    contents: [
      { type: "text", text: label, size: "xs", color: "#6B7280" },
      { type: "text", text: baht(amt), size: "xl", color: "#993C1D", weight: "bold", wrap: true },
      { type: "text", text: count.toLocaleString("en-US") + " ออร์เดอร์", size: "xxs", color: "#9CA3AF" },
    ],
  });
  const body: any[] = [
    { type: "box", layout: "horizontal", spacing: "md",
      contents: [metric("วันนี้", todayOrders.length, tRev), metric("เดือนนี้", monthOrders.length, mRev)] },
  ];
  if (noteNeeded) body.push({ type: "text", text: "ออร์เดอร์ส่วนใหญ่เป็นฉลาก/ไม่มีรายการสินค้า จึงคำนวณมูลค่าไม่ได้",
    size: "xxs", color: "#9CA3AF", wrap: true, margin: "md" });
  return { text: t, flex: flexCard(flexHeader("💰 ยอดขาย", date), body) };
}

// Look up a specific order / parcel by order id, customer name, phone, or tracking.
// Searches both the labels queue and the orders table (unmasked — internal team use).
async function lookupOrder(query: string, admin: any): Promise<BotReply> {
  const raw = (query || "").trim();
  if (raw.length < 3) return { text: "พิมพ์เลขออเดอร์ เบอร์โทร หรือเลขพัสดุ (อย่างน้อย 3 ตัว) เช่น “เช็ค 0812345678”" };
  const digits = raw.replace(/\D/g, "");
  const q = raw.toLowerCase();
  const nq = phoneNSN(digits);
  const toks = q.split(/\s+/).filter((t) => t.length >= 2);

  const ship: any[] = [];
  const { data: labelRows } = await admin.from("labels").select("data");
  (labelRows || []).forEach((row: any) => {
    const l = row.data; if (!l) return;
    const r = l.recipient || {};
    const id = (l.soId && !/^ฉลากใหม่/.test(l.soId)) ? l.soId : l.id;
    ship.push({ id, customer: r.name || "", phone: r.phone || "", carrier: l.carrier || "", tracking: l.tracking || "", status: l.tracking ? "shipped" : "packed" });
  });
  const { data: orderRows } = await admin.from("orders").select("*");
  (orderRows || []).forEach((row: any) => {
    ship.push({
      id: row.id, customer: row.customer || "", phone: row.phone || "",
      carrier: row.carrier === "—" ? "" : (row.carrier || ""),
      tracking: row.tracking === "—" ? "" : (row.tracking || ""),
      status: row.status || "picking",
    });
  });

  const seen = new Set<string>();
  const results = ship.filter((o) => {
    const phone = String(o.phone || "").replace(/\D/g, "");
    const name = String(o.customer || "").toLowerCase().replace(/\s+/g, " ");
    const trk = String(o.tracking || "").toLowerCase();
    const hit =
      (digits.length >= 4 && (phone.includes(digits) || (!!nq && phoneNSN(phone).includes(nq)))) ||
      name.includes(q) || (toks.length > 0 && toks.every((t) => name.includes(t))) ||
      (q.length >= 4 && trk.includes(q)) ||
      (q.length >= 3 && String(o.id).toLowerCase().includes(q));
    if (!hit) return false;
    const key = o.id + "|" + o.tracking;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);

  if (!results.length) return { text: `ไม่พบออร์เดอร์/พัสดุที่ตรงกับ “${raw}”` };
  const ST: Record<string, string> = { picking: "กำลังหยิบ", packed: "พร้อมส่ง", shipped: "ส่งแล้ว", delivered: "ถึงปลายทาง" };
  const line = (o: any) =>
    `• ${o.id} — ${o.customer || "—"}\n  ${ST[o.status] || o.status}` +
    `${o.carrier ? " · " + o.carrier : ""}${o.tracking ? " · " + o.tracking : " · (ยังไม่มีเลขพัสดุ)"}`;
  const text = `🔎 ผลค้นหา “${raw}” (${results.length})\n\n` + results.map(line).join("\n");
  return { text, flex: lookupFlex(results) };
}

// ── Render lookup results as a LINE Flex bubble (1 hit) or carousel (many) ──
// Gradient PS-TACTICAL header (id + status pill) · customer/carrier/tracking rows
// · a tap button to the carrier's tracking page (falls back to the app).
const STATUS_LABEL: Record<string, string> = { picking: "กำลังหยิบ", packed: "พร้อมส่ง", shipped: "ส่งแล้ว", delivered: "ถึงปลายทาง" };
function infoRow(label: string, value: string) {
  return {
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#9CA3AF", flex: 2 },
      { type: "text", text: value || "—", size: "sm", color: "#1A1A1A", flex: 5, align: "end", wrap: true },
    ],
  };
}
function lookupBubble(o: any) {
  const status = STATUS_LABEL[o.status] || o.status || "—";
  const trackUrl = carrierTrackUrl(o.carrier, o.tracking);
  const action = trackUrl
    ? { type: "uri", label: "ติดตามพัสดุ", uri: trackUrl }
    : { type: "uri", label: "เปิดในแอป", uri: APP_URL };
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box", layout: "horizontal", spacing: "sm", paddingAll: "14px",
      background: { type: "linearGradient", angle: "135deg", startColor: "#FF7A1A", endColor: "#2A2A2A" },
      contents: [
        { type: "text", text: String(o.id || "—"), color: "#FFFFFF", weight: "bold", size: "md",
          flex: 1, gravity: "center", wrap: false, adjustMode: "shrink-to-fit" },
        { type: "box", layout: "vertical", flex: 0, cornerRadius: "16px", backgroundColor: "#FFFFFF33",
          paddingTop: "4px", paddingBottom: "4px", paddingStart: "10px", paddingEnd: "10px",
          contents: [ { type: "text", text: status, color: "#FFFFFF", size: "xs", gravity: "center" } ] },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
      contents: [
        infoRow("ลูกค้า", o.customer || "—"),
        infoRow("ขนส่ง", o.carrier || "—"),
        infoRow("เลขพัสดุ", o.tracking || "ยังไม่มีเลขพัสดุ"),
      ],
    },
    footer: {
      type: "box", layout: "vertical", paddingAll: "6px",
      contents: [ { type: "button", style: "link", height: "sm", action } ],
    },
  };
}
function lookupFlex(results: any[]) {
  const items = results.slice(0, 12).map(lookupBubble);
  if (!items.length) return undefined;
  return items.length === 1 ? items[0] : { type: "carousel", contents: items };
}

// Slip photo → OCR (extract-slip) → auto-save tracking onto the matched pending
// label + its order. Runs in the background (after the webhook's 200 reply).
async function processSlipImage(
  messageId: string, replyToken: string, admin: any,
  SUPABASE_URL: string, LINE_TOKEN: string, CRON_SECRET: string,
) {
  try {
    if (!LINE_TOKEN) return;
    // 1. download the image bytes from LINE
    const imgRes = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { Authorization: "Bearer " + LINE_TOKEN },
    });
    if (!imgRes.ok) { await lineReply(LINE_TOKEN, replyToken, "⚠️ ดึงรูปจาก LINE ไม่ได้ ลองส่งใหม่อีกครั้ง"); return; }
    const mime = (imgRes.headers.get("content-type") || "image/jpeg").split(";")[0];
    const b64 = encodeBase64(new Uint8Array(await imgRes.arrayBuffer()));

    // 2. ALL labels with a recipient → fuzzy-match candidates (include ones that
    //    already have tracking so we can recognise & report them, not just say "no match")
    const { data: labelRows } = await admin.from("labels").select("id, so_id, data");
    const candidates = (labelRows || [])
      .map((r: any) => ({ rowId: r.id, soId: r.so_id, lbl: r.data }))
      .filter((x: any) => x.lbl && x.lbl.recipient?.name);
    const pending_customers = candidates.map((x: any) => ({ name: x.lbl.recipient.name, phone: x.lbl.recipient.phone || "" }));

    // 3. OCR via extract-slip (internal service call, shares CRON_SECRET)
    const ocrRes = await fetch(SUPABASE_URL + "/functions/v1/extract-slip", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ image_base64: b64, mime_type: mime, pending_customers }),
    });
    const ocr = await ocrRes.json().catch(() => ({}));
    if (!ocr.success) { await lineReply(LINE_TOKEN, replyToken, "⚠️ อ่านสลิปไม่สำเร็จ: " + (ocr.error || "ลองถ่ายให้ชัดขึ้น")); return; }
    const parcels = Array.isArray(ocr.parcels) ? ocr.parcels : [];
    if (!parcels.length) { await lineReply(LINE_TOKEN, replyToken, "⚠️ ไม่พบเลขพัสดุในรูปสลิป — ลองถ่ายใหม่ให้เห็นเลขพัสดุชัดๆ"); return; }

    // 4. match each parcel to a label. Save when the label has no tracking yet;
    //    report when it already has one; skip when nothing matches.
    const norm = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const avail = [...candidates];
    const saved: any[] = [], already: any[] = [], skipped: any[] = [];
    for (const p of parcels) {
      const trk = p.tracking_number;
      if (!trk) { skipped.push({ ...p, reason: "ไม่มีเลขพัสดุ" }); continue; }
      let idx = -1;
      if (p.matched_customer_name) idx = avail.findIndex((x) => norm(x.lbl.recipient.name) === norm(p.matched_customer_name));
      if (idx < 0 && last7(p.customer_phone)) idx = avail.findIndex((x) => last7(x.lbl.recipient.phone) && last7(x.lbl.recipient.phone) === last7(p.customer_phone));
      if (idx < 0 || (p.confidence_score || 0) < 0.5) {
        skipped.push({ ...p, reason: idx < 0 ? "จับคู่ออเดอร์ไม่ได้" : "ความมั่นใจต่ำ" });
        continue;
      }
      const m = avail[idx];
      avail.splice(idx, 1);   // consume so two parcels can't map to the same label
      if (m.lbl.tracking) {
        // Already shipped — recognise it, don't overwrite an existing tracking number.
        already.push({ name: m.lbl.recipient.name, existing: m.lbl.tracking, slip: trk, same: norm(m.lbl.tracking) === norm(trk) });
        continue;
      }
      const carrier = mapCarrier(p.courier) || m.lbl.carrier || "";
      await admin.from("labels").update({ data: { ...m.lbl, tracking: trk, carrier } }).eq("id", m.rowId);
      if (m.soId && !/^ฉลากใหม่/.test(m.soId)) {
        await admin.from("orders").update({ tracking: trk, carrier, status: "shipped" }).eq("id", m.soId);
      }
      saved.push({ name: m.lbl.recipient.name, tracking: trk, carrier });
    }

    // 5. reply with the result — text (altText) + a Flex card
    let msg = `📷 อ่านสลิปเสร็จ — พบ ${parcels.length} พัสดุ\n`;
    if (saved.length) msg += `\n✅ บันทึกเลขพัสดุแล้ว (${saved.length})\n` +
      saved.map((s) => `• ${s.name} — ${s.tracking}${s.carrier ? " (" + s.carrier + ")" : ""}`).join("\n") + "\n";
    if (already.length) msg += `\n☑️ มีเลขพัสดุอยู่แล้ว (${already.length})\n` +
      already.map((s) => s.same
        ? `• ${s.name} — ${s.existing} (ตรงกัน)`
        : `• ${s.name} — เดิม ${s.existing} / สลิป ${s.slip} (ไม่เปลี่ยน)`).join("\n") + "\n";
    if (skipped.length) msg += `\n⚠️ ยังไม่บันทึก (${skipped.length}) — ตรวจในแอป\n` +
      skipped.map((s) => `• ${s.tracking_number || "(ไม่มีเลข)"} · ผู้รับ: ${s.extracted_name_from_slip || "-"} — ${s.reason}`).join("\n");

    const body: any[] = [];
    if (saved.length) {
      body.push(flexPill(`✅ บันทึกแล้ว ${saved.length}`, "#085041", "#E1F5EE"));
      saved.forEach((s) => body.push(itemRow(s.name, s.carrier || "", s.tracking, "#0F6E56")));
    }
    if (already.length) {
      body.push(flexPill(`☑️ มีอยู่แล้ว ${already.length}`, "#185FA5", "#E6F1FB"));
      already.forEach((s) => body.push(itemRow(s.name, "", s.same ? "ตรงกัน" : "ไม่เปลี่ยน", "#185FA5")));
    }
    if (skipped.length) {
      body.push(flexPill(`⚠️ ยังไม่บันทึก ${skipped.length}`, "#A32D2D", "#FCEBEB"));
      skipped.forEach((s) => body.push(itemRow(s.extracted_name_from_slip || s.tracking_number || "-", "", s.reason, "#A32D2D")));
    }
    if (!body.length) body.push({ type: "text", text: "ไม่พบเลขพัสดุที่ใช้ได้", size: "sm", color: "#6B7280", wrap: true });
    const flex = flexCard(flexHeader("📷 อ่านสลิปขนส่ง", `พบ ${parcels.length} พัสดุ`), body, [appButton()]);
    await sendReply(LINE_TOKEN, replyToken, { text: msg.trim(), flex });
  } catch (e) {
    if (LINE_TOKEN) await lineReply(LINE_TOKEN, replyToken, "⚠️ เกิดข้อผิดพลาดในการอ่านสลิป: " + String(e).slice(0, 120));
  }
}

function helpText(): BotReply {
  const text = "🤖 บอทคลังพร้อมส่ง — พิมพ์คำสั่ง:\n\n"
    + "• ของต่ำ — สินค้าต่ำกว่าจุดสั่งซื้อ\n"
    + "• สต็อก — สรุปสต็อกรวม\n"
    + "• ออเดอร์ — ออร์เดอร์ค้างส่ง\n"
    + "• ยอดขาย — ยอดขายวันนี้/เดือนนี้\n"
    + "• เช็ค <เลขออเดอร์/เบอร์/เลขพัสดุ> — ค้นหาสถานะพัสดุ\n"
    + "• 📷 ส่งรูปสลิปขนส่ง — บันทึกเลขพัสดุอัตโนมัติ\n"
    + "• เมนู — แสดงคำสั่งทั้งหมด";
  const flex = flexCard(flexHeader("🤖 บอทคลังพร้อมส่ง", "เมนูคำสั่ง"), [
    { type: "text", text: "แตะปุ่มเพื่อดูรายงาน หรือพิมพ์ “เช็ค <เบอร์/เลขออเดอร์>” เพื่อค้นหาพัสดุ", size: "xs", color: "#6B7280", wrap: true },
    msgButton("📦 ของต่ำ", "ของต่ำ"),
    msgButton("📊 สต็อก", "สต็อก"),
    msgButton("🚚 ออเดอร์", "ออเดอร์"),
    msgButton("💰 ยอดขาย", "ยอดขาย"),
    { type: "text", text: "📷 ส่งรูปสลิปขนส่งเพื่อบันทึกเลขพัสดุอัตโนมัติ", size: "xxs", color: "#9CA3AF", wrap: true, margin: "md" },
  ]);
  return { text, flex };
}

// Map free text → report. Order matters (check "ต่ำ" before "สต็อก", and lookups
// before the pending-list "ออเดอร์" so a query with an id/phone isn't swallowed).
async function handleCommand(text: string, admin: any): Promise<BotReply> {
  const t = (text || "").trim();
  const low = t.toLowerCase();

  // Explicit lookup keyword → the rest of the message is the query.
  const kw = t.match(/^(เช็ค|เช็ก|ค้นหา|ค้นหาออเดอร์|หา|ติดตาม|ตามพัสดุ|พัสดุ|เลขพัสดุ|track|find|search)\s*(.*)$/i);
  if (kw) {
    const q = kw[2].trim();
    return q ? lookupOrder(q, admin)
      : "พิมพ์ต่อท้ายด้วยเลขออเดอร์ เบอร์โทร หรือเลขพัสดุ เช่น “เช็ค 0812345678”";
  }
  // Bare phone (≥9 digits), an SO-id, or a tracking-looking token → lookup.
  const digits = t.replace(/\D/g, "");
  const words = t.split(/\s+/);
  const looksTracking = words.some((w) => /^[A-Za-z0-9]{10,}$/.test(w) && /\d/.test(w) && /[A-Za-z]/.test(w));
  if (digits.length >= 9 || /\bSO-?\w{3,}\b/i.test(t) || looksTracking) return lookupOrder(t, admin);

  if (/ต่ำ|low|reorder|สั่งซื้อ|ของหมด|หมดสต/.test(low)) return reportLowStock(admin);
  if (/ออเดอร|order|ค้างส่ง|รอส่ง/.test(low))           return reportPendingOrders(admin);
  if (/ยอดขาย|ขาย|sales|รายได้|revenue/.test(low))      return reportSales(admin);
  if (/สต็อก|สต๊อก|stock|คงคลัง|คงเหลือ|รวม/.test(low)) return reportStockSummary(admin);
  return helpText();
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
  const LINE_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") || "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
  const PASSCODE = Deno.env.get("LINE_BOT_PASSCODE") || "";  // unset → bot stays open
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const raw = await req.text();
  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { /* may be empty */ }

  // ── Build/health ping (no auth) — lets a deploy be verified from outside. ──
  if (payload?.mode === "ping") return json({ ok: true, build: "flex-all-2" });

  // ── Preview mode: admin JWT, returns the reply text (no LINE needed) ──
  if (payload?.mode === "preview") {
    const authHeader = req.headers.get("Authorization");
    let adminOk = false;
    if (authHeader) {
      const { data: { user } } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
      adminOk = user?.app_metadata?.role === "admin";
    }
    if (!adminOk) return json({ error: "Unauthorized" }, 401);
    const out = await handleCommand(payload.command || "เมนู", admin);
    const text = typeof out === "string" ? out : out.text;
    const flex = typeof out === "string" ? undefined : out.flex;
    return json({ text, flex });
  }

  // ── LINE webhook: verify signature FIRST (only needs LINE_CHANNEL_SECRET) ──
  // The token is only required to *send* replies, so a verify ping or follow event
  // still returns 200 even before LINE_CHANNEL_ACCESS_TOKEN is set.
  const sigOk = await verifyLineSignature(LINE_SECRET, raw, req.headers.get("x-line-signature") || "");
  if (!sigOk) return json({ error: "Invalid signature" }, 401);

  const events = Array.isArray(payload?.events) ? payload.events : [];
  const bg: Promise<unknown>[] = [];   // slow tasks (slip OCR) run after the 200

  // Access control: load the allowlist once (only if lockdown is configured).
  let botUsers: any[] | null = null;
  const authorized = async (userId: string): Promise<boolean> => {
    if (!PASSCODE) return true;            // lockdown not set up → open mode
    if (!userId) return false;             // group/no-id → deny
    if (botUsers === null) botUsers = await loadBotUsers(admin);
    return botUsers.some((u) => u.id === userId);
  };

  for (const ev of events) {
    const userId: string = ev.source?.userId || "";
    const reply = async (msg: BotReply) => {
      if (LINE_TOKEN && ev.replyToken) await sendReply(LINE_TOKEN, ev.replyToken, msg);
      else if (!LINE_TOKEN) console.error("[line-bot] LINE_CHANNEL_ACCESS_TOKEN not set — cannot reply");
    };

    // New friend follows the OA.
    if (ev.type === "follow" && ev.replyToken) {
      await reply(PASSCODE
        ? "👋 ยินดีต้อนรับสู่บอทคลังพร้อมส่ง (เฉพาะทีมงาน)\nพิมพ์รหัสผ่านเพื่อเริ่มใช้งาน"
        : helpText());
      continue;
    }

    // Text message.
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      const txt = String(ev.message.text || "").trim();

      // Enrollment: an unknown user sends the passcode → add them to the allowlist.
      if (PASSCODE && txt === PASSCODE) {
        if (botUsers === null) botUsers = await loadBotUsers(admin);
        if (!botUsers.some((u) => u.id === userId) && userId) {
          const name = LINE_TOKEN ? await lineProfileName(LINE_TOKEN, userId) : "";
          botUsers.push({ id: userId, name, at: new Date().toISOString() });
          await saveBotUsers(admin, botUsers);
        }
        await reply("✅ ลงทะเบียนใช้บอทเรียบร้อย — พิมพ์ “เมนู” เพื่อดูคำสั่ง");
        continue;
      }

      if (!(await authorized(userId))) {
        await reply("🔒 บอทนี้สำหรับทีมงานภายในเท่านั้น\nหากเป็นทีมงาน พิมพ์รหัสผ่านเพื่อลงทะเบียน หรือติดต่อผู้ดูแลระบบ");
        continue;
      }

      // Authorized: a couple of self-service management commands, else a report.
      if (/^(รายชื่อบอท|ใครใช้บอท|bot users)$/i.test(txt)) {
        if (botUsers === null) botUsers = await loadBotUsers(admin);
        const list = botUsers.length
          ? botUsers.map((u, i) => `${i + 1}. ${u.name || u.id.slice(0, 8) + "…"}`).join("\n")
          : "ยังไม่มีผู้ลงทะเบียน";
        await reply(`👥 ผู้ใช้บอทที่ลงทะเบียน (${botUsers.length})\n${list}`);
        continue;
      }
      if (/^(ออกจากบอท|เลิกใช้บอท|unenroll)$/i.test(txt)) {
        if (botUsers === null) botUsers = await loadBotUsers(admin);
        botUsers = botUsers.filter((u) => u.id !== userId);
        await saveBotUsers(admin, botUsers);
        await reply("✅ ยกเลิกการลงทะเบียนแล้ว — คุณจะไม่สามารถใช้บอทได้จนกว่าจะลงทะเบียนใหม่");
        continue;
      }
      await reply(await handleCommand(txt, admin));
      continue;
    }

    // Slip photo → OCR + auto-save (background). Authorized users only.
    if (ev.type === "message" && ev.message?.type === "image" && ev.replyToken) {
      if (!(await authorized(userId))) {
        await reply("🔒 บอทนี้สำหรับทีมงานภายในเท่านั้น — พิมพ์รหัสผ่านเพื่อลงทะเบียนก่อน");
        continue;
      }
      bg.push(processSlipImage(ev.message.id, ev.replyToken, admin, SUPABASE_URL, LINE_TOKEN, CRON_SECRET));
      continue;
    }
  }
  if (bg.length) {
    const ER = (globalThis as any).EdgeRuntime;
    if (ER && typeof ER.waitUntil === "function") ER.waitUntil(Promise.allSettled(bg));
    else await Promise.allSettled(bg);   // fallback: block until done
  }
  // LINE expects a fast 200 even if there were no actionable events.
  return json({ ok: true });
});
