// Order alerts → Web Push to every OTHER device that turned notifications on.
//
// The browser that makes an order change (new / edited / cancelled) posts the
// alert records it computed (tracking.jsx _orderAlertDiff — before/after per
// line and per field). This function signs and sends one push per alert to
// every row in push_subscriptions except the sending device, so a locked Android
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
//   TELEGRAM_BOT_TOKEN — optional: from @BotFather. Every alert is ALSO posted to the
//                        staff Telegram group (free, no quota). Unset = Telegram off.
//   TELEGRAM_CHAT_ID   — optional, comma-separated. Usually NOT needed: when it is
//                        unset, an admin's test button asks Telegram which groups the
//                        bot is in (getUpdates) and remembers them in app_state key
//                        "telegram_chats". Someone must have posted in the group first.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import satori from "npm:satori@0.12.2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { buildCard, type CardInput, type CardLine } from "./card.ts";

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
// Who may RECEIVE alerts — checked against the live account on every send.
const RECEIVER_ROLES = ["admin", "manager", "staff", "packer"];
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

/* ── Telegram (optional second channel) ──────────────────────────────────────
   One message per alert to the staff group. No 4 KB limit here, so it carries
   the full line list / diff. HTML parse mode — every value is escaped. */
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function telegramText(a: any, by: string): string {
  const k = KIND[a.kind] || KIND.edit;
  const out: string[] = [`${k.icon} <b>${esc(k.tag)} · ${esc(str(a.short || a.id, 40))}</b>`];
  const head = [str(a.customer, 60), str(a.channel, 20)].filter(Boolean).map(esc).join(" · ");
  if (head) out.push(head);
  const diff = (Array.isArray(a.diff) ? a.diff : []).slice(0, 30);
  const items = (Array.isArray(a.items) ? a.items : []).slice(0, 30);
  if (a.kind === "edit" && diff.length) {
    out.push("");
    diff.forEach((d: any) => {
      const from = Number(d.from) || 0, to = Number(d.to) || 0;
      const what = from === 0 ? "➕ เพิ่ม" : to === 0 ? "➖ เอาออก" : "🔁";
      out.push(`${what} <code>${esc(str(d.sku, 30))}</code> ${esc(str(d.name, 60))} : ${from} → <b>${to}</b>`);
    });
  } else if (items.length) {
    out.push("");
    items.forEach((i: any) => out.push(`• <code>${esc(str(i.sku, 30))}</code> ${esc(str(i.name, 60))} × <b>${Number(i.qty) || 0}</b>`));
  }
  const fields = (Array.isArray(a.fields) ? a.fields : []).slice(0, 7);
  if (fields.length) {
    out.push("");
    fields.forEach((f: any) => out.push(`✏️ ${esc(str(f.label, 20))}: ${esc(str(f.from, 60)) || "-"} → <b>${esc(str(f.to, 60)) || "-"}</b>`));
  }
  out.push("", `⚠️ ${esc(k.msg)}${by ? " (โดย " + esc(by) + ")" : ""}`);
  return out.join("\n").slice(0, 4000);
}

let _tgLastError = "";

// The secret is pasted by hand from BotFather's message, so accept it with
// stray spaces, a "bot" prefix, or surrounding text — keep just "<id>:<key>".
function tgToken(): string {
  const raw = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
  const m = raw.match(/\d{6,}:[A-Za-z0-9_-]{30,}/);
  return m ? m[0] : raw.trim();
}

// Chat ids: the secret wins; otherwise the ones remembered in app_state.
async function telegramChats(admin: any): Promise<string[]> {
  const env = (Deno.env.get("TELEGRAM_CHAT_ID") || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (env.length) return env;
  const { data } = await admin.from("app_state").select("value").eq("key", "telegram_chats").maybeSingle();
  const ids = data && data.value && Array.isArray(data.value.ids) ? data.value.ids : [];
  return ids.map((c: unknown) => String(c)).filter(Boolean);
}

// Ask Telegram which groups the bot has seen and remember them. A group that was
// upgraded to a supergroup reports migrate_to_chat_id — the new id replaces it.
async function discoverTelegramChats(admin: any): Promise<string[]> {
  const token = tgToken();
  if (!token) return [];
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=[]`);
    const j: any = await r.json().catch(() => ({}));
    if (!j.ok) { _tgLastError = `getUpdates ${r.status}: ${j.description || ""}`; console.error(_tgLastError); return []; }
    if (!(j.result || []).length) _tgLastError = "getUpdates returned no updates";
    // Groups win. With no group yet, fall back to private chats with the bot
    // (the admin pressed /start on it) — the admin's test is what links them.
    const groups = new Map<string, string>();
    const privates = new Map<string, string>();
    for (const u of j.result || []) {
      const m = u.message || u.edited_message || u.channel_post || u.my_chat_member || {};
      const c = m.chat;
      if (!c) continue;
      if (c.type === "private") { privates.set(String(c.id), [c.first_name, c.last_name, c.username && "@" + c.username].filter(Boolean).join(" ")); continue; }
      if (c.type !== "group" && c.type !== "supergroup") continue;
      groups.set(String(c.id), c.title || "");
      if (m.migrate_to_chat_id) { groups.delete(String(c.id)); groups.set(String(m.migrate_to_chat_id), c.title || ""); }
    }
    const found = groups.size ? groups : privates;
    const ids = [...found.keys()];
    if (ids.length) {
      await admin.from("app_state").upsert({
        key: "telegram_chats",
        value: { ids, titles: [...found.values()], at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
    }
    return ids;
  } catch (e) { _tgLastError = "getUpdates threw: " + String(e); console.error(_tgLastError); return []; }
}

type TgPhoto = { url: string; caption: string };
type TgMessage = { text: string; photos: TgPhoto[]; cards?: Uint8Array[] };

// Lines a packer has to go and pick: every line of a new order, and the lines
// an edit added or raised. Removals and cancels stay text-only.
function photoLines(a: any): { sku: string; name: string; qty: number }[] {
  if (a.kind === "new") {
    return (Array.isArray(a.items) ? a.items : [])
      .map((i: any) => ({ sku: str(i.sku, 30), name: str(i.name, 60), qty: Number(i.qty) || 0 }));
  }
  if (a.kind === "edit") {
    return (Array.isArray(a.diff) ? a.diff : [])
      .filter((d: any) => (Number(d.to) || 0) > (Number(d.from) || 0))
      .map((d: any) => ({ sku: str(d.sku, 30), name: str(d.name, 60), qty: Number(d.to) || 0 }));
  }
  return [];
}

// Product photos live in app_state "img:<sku>" (product-images.jsx). Only
// http(s) URLs can be fetched by Telegram — data: URLs and missing ones skip.
async function photoUrls(admin: any, skus: string[]): Promise<Record<string, string>> {
  const keys = [...new Set(skus.filter(Boolean))].map((s) => "img:" + s);
  if (!keys.length) return {};
  const { data } = await admin.from("app_state").select("key, value").in("key", keys);
  const out: Record<string, string> = {};
  (data || []).forEach((r: any) => {
    const u = typeof r.value === "string" ? r.value : "";
    if (/^https:\/\//.test(u)) out[r.key.slice(4)] = u;
  });
  return out;
}

async function buildTelegramMessages(admin: any, alerts: any[], by: string): Promise<TgMessage[]> {
  const lines = alerts.map(photoLines);
  const cardSkus = alerts.flatMap((a) => cardLines(a).map((l) => l.sku));
  const urls = await photoUrls(admin, [...lines.flat().map((l) => l.sku), ...cardSkus]);
  return Promise.all(alerts.map(async (a, i) => {
    const seen = new Set<string>();
    const photos = lines[i]
      .filter((l) => urls[l.sku] && !seen.has(l.sku) && seen.add(l.sku))
      .slice(0, 10)
      .map((l) => ({ url: urls[l.sku], caption: `${l.sku} · ${l.name} × ${l.qty}`.slice(0, 1000) }));
    let cards: Uint8Array[] | undefined;
    try { cards = await renderCards(a, by, urls); }
    catch (e) { _tgLastError = "card render: " + String((e as Error)?.message || e).slice(0, 200); console.error(_tgLastError); }
    return { text: telegramText(a, by), photos, cards };
  }));
}

/* ── Picture card (card.ts, the owner's design) ───────────────────────────────
   satori lays it out, resvg rasterises it. Fonts (Prompt, Thai + Latin subsets)
   and the resvg wasm load once per warm instance. Photos come from the small
   JPEG thumbnails at product-images/t/<photo name>.jpg — resvg can't draw the
   webp originals; a SKU without a thumbnail shows a blank frame. Any failure
   falls back to the album/text path, so an alert is never lost to the card. */
const FONT_BASE = "https://cdn.jsdelivr.net/npm/@fontsource/prompt@5.0.8/files/";
const RESVG_WASM = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const CARD_ROWS = 20;
let _cardReady: Promise<any[]> | null = null;
let _cardLoaded = false;   // fonts + wasm are in memory
let _cardWarm = false;     // ...already when this request started (timing report)

function cardAssets(): Promise<any[]> {
  if (!_cardReady) {
    _cardReady = (async () => {
      const fonts = await Promise.all([400, 600, 700].flatMap((weight) => ["latin", "thai"].map(async (sub) => {
        const r = await fetch(`${FONT_BASE}prompt-${sub}-${weight}-normal.woff`);
        if (!r.ok) throw new Error("font " + r.status);
        return { name: sub === "thai" ? "PromptThai" : "Prompt", weight, style: "normal", data: await r.arrayBuffer() };
      })));
      await initWasm(fetch(RESVG_WASM));
      _cardLoaded = true;
      return fonts;
    })();
    _cardReady.catch(() => { _cardReady = null; });   // retry on the next alert
  }
  return _cardReady;
}

async function sampleItems(admin: any): Promise<any[]> {
  try {
    const { data } = await admin.from("app_state").select("key").like("key", "img:%").limit(40);
    const skus = (data || []).map((r: any) => r.key.slice(4)).slice(0, 3);
    if (!skus.length) return [];
    const { data: prods } = await admin.from("products").select("sku, name").in("sku", skus);
    const name: Record<string, string> = {};
    (prods || []).forEach((p: any) => { name[p.sku] = p.name; });
    return skus.map((sku: string, i: number) => ({ sku, name: name[sku] || "", qty: i === 0 ? 2 : 1 }));
  } catch { return []; }
}

function cardLines(a: any): CardLine[] {
  if (a.kind === "edit") {
    return (Array.isArray(a.diff) ? a.diff : []).map((d: any) => ({
      sku: str(d.sku, 30), name: str(d.name, 80), qty: Number(d.to) || 0,
      from: Number(d.from) || 0, to: Number(d.to) || 0 }));
  }
  return (Array.isArray(a.items) ? a.items : [])
    .map((i: any) => ({ sku: str(i.sku, 30), name: str(i.name, 80), qty: Number(i.qty) || 0 }));
}

const PHOTO_RE = /\/product-images\/p\/([^/?#]+?)\.[a-z0-9]+(?:[?#].*)?$/i;

async function thumbData(photo: string | undefined): Promise<string | undefined> {
  if (!photo || !PHOTO_RE.test(photo)) return undefined;
  try {
    const r = await fetch(photo.replace(PHOTO_RE, "/product-images/t/$1.jpg"));
    if (!r.ok || !/jpeg|png/.test(r.headers.get("content-type") || "")) return undefined;
    const b = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return "data:image/jpeg;base64," + btoa(bin);
  } catch { return undefined; }
}

async function renderCards(a: any, by: string, urls: Record<string, string>): Promise<Uint8Array[] | undefined> {
  const kind = a.kind === "removed" || a.kind === "edit" ? a.kind : "new";
  const lines = cardLines(a);
  if (!lines.length) return undefined;              // nothing to draw (e.g. the settings test)
  const [fonts, photos] = await Promise.all([cardAssets(), Promise.all(lines.map((l) => thumbData(urls[l.sku])))]);
  lines.forEach((l, i) => { l.photo = photos[i]; });
  const fields = kind === "edit" ? (Array.isArray(a.fields) ? a.fields : []).slice(0, 5)
    .map((f: any) => ({ label: str(f.label, 20), from: str(f.from, 60), to: str(f.to, 60) })) : [];
  const pages = Math.min(10, Math.ceil(lines.length / CARD_ROWS));
  const out: Uint8Array[] = [];
  for (let p = 0; p < pages; p++) {
    const input: CardInput = {
      kind, id: str(a.short || a.id, 40), channel: str(a.channel, 20), customer: str(a.customer, 40), by,
      lines: lines.slice(p * CARD_ROWS, (p + 1) * CARD_ROWS), fields: p === pages - 1 ? fields : [],
      page: p + 1, pages, start: p * CARD_ROWS,
      totalLines: lines.length, totalQty: lines.reduce((n, l) => n + (l.qty || 0), 0),
    };
    const { el, width, height } = buildCard(input);
    const svg = await satori(el, { width, height, fonts });
    out.push(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
  }
  return out;
}

async function tgCall(token: string, method: string, body: unknown): Promise<boolean> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return true;
  _tgLastError = `${method} ${r.status}: ` + (await r.text().catch(() => "")).slice(0, 200);
  console.error(_tgLastError);
  return false;
}

// One alert = an album (photo per line, the summary as the first caption) when
// it has photos and the summary fits a caption; otherwise the album with short
// captions followed by the text. A failed album still sends the text.
async function sendCards(token: string, chat_id: string, cards: Uint8Array[], caption: string): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", chat_id);
  if (cards.length === 1) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([cards[0]], { type: "image/png" }), "card.png");
  } else {
    form.append("media", JSON.stringify(cards.map((_, i) => (i === 0
      ? { type: "photo", media: "attach://c0", caption, parse_mode: "HTML" }
      : { type: "photo", media: `attach://c${i}` }))));
    cards.forEach((c, i) => form.append(`c${i}`, new Blob([c], { type: "image/png" }), `card${i}.png`));
  }
  const method = cards.length === 1 ? "sendPhoto" : "sendMediaGroup";
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
  if (r.ok) return true;
  _tgLastError = `${method} ${r.status}: ` + (await r.text().catch(() => "")).slice(0, 200);
  console.error(_tgLastError);
  return false;
}

// Card first (the whole order in one picture, the summary as its caption); then
// the album; then plain text. Each step only runs when the one before failed.
async function sendOne(token: string, chat_id: string, m: TgMessage): Promise<boolean> {
  if (m.cards && m.cards.length) {
    const caption = m.text.length <= 1024 ? m.text : m.text.split("\n")[0];
    if (await sendCards(token, chat_id, m.cards, caption)) return true;
  }
  if (!m.photos.length) {
    return tgCall(token, "sendMessage", { chat_id, text: m.text, parse_mode: "HTML", disable_web_page_preview: true });
  }
  const fits = m.text.length <= 1024;
  const media = m.photos.map((p, i) => (i === 0 && fits
    ? { type: "photo", media: p.url, caption: m.text, parse_mode: "HTML" }
    : { type: "photo", media: p.url, caption: p.caption }));
  const ok = media.length === 1
    ? await tgCall(token, "sendPhoto", { chat_id, photo: media[0].media, caption: media[0].caption, parse_mode: (media[0] as any).parse_mode })
    : await tgCall(token, "sendMediaGroup", { chat_id, media });
  if (ok && fits) return true;
  return tgCall(token, "sendMessage", { chat_id, text: m.text, parse_mode: "HTML", disable_web_page_preview: true });
}

async function sendTelegram(chats: string[], messages: TgMessage[]): Promise<{ sent: number; failed: number; error?: string } | null> {
  const token = tgToken();
  if (!token || !messages.length) return null;
  if (!chats.length) return { sent: 0, failed: 0, error: "no group found — post a message in the group, then press test again" };
  let sent = 0, failed = 0;
  for (const chat_id of chats) {
    for (const m of messages) {   // in order, so a "new" never lands after its "edit"
      try { if (await sendOne(token, chat_id, m)) sent++; else failed++; }
      catch (e) { failed++; console.error("telegram", e); }
    }
  }
  return { sent, failed };
}

// Start loading the card assets the moment the instance boots, so a cold start
// overlaps the auth + order checks instead of running after them.
if (tgToken()) cardAssets().catch(() => {});

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
  const hasPush = !!(PUB && PRIV);
  const hasTelegram = !!tgToken();
  if (!hasPush && !hasTelegram) return json({ ok: false, error: "VAPID keys not configured" }, 500);
  if (hasPush) webpush.setVapidDetails(SUBJECT, PUB, PRIV);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }

  // {mode:"test"} → one test push to the CALLER's own devices (settings button).
  const test = body && body.mode === "test";
  const alerts = test
    ? [{ id: "TEST", kind: "new", short: "ทดสอบ", customer: "การแจ้งเตือนทำงานปกติ", items: [] }]
    : (Array.isArray(body?.alerts) ? body.alerts : []).slice(0, MAX_ALERTS);
  if (!alerts.length) return json({ ok: true, sent: 0 });

  const by = test ? "" : str((user.user_metadata as any)?.name || (user.user_metadata as any)?.full_name || "", 30);
  // The group is shared, so only an admin's test button posts to it.
  let tgAlerts = test && role !== "admin" ? [] : alerts;
  // The admin's test shows a real card: three products that have photos.
  if (test && tgAlerts.length) tgAlerts = [{ ...tgAlerts[0], short: "TEST", channel: "ทดสอบ", items: await sampleItems(admin) }];
  const telegramP = (async () => {
    if (!hasTelegram || !tgAlerts.length) return null;
    let chats = await telegramChats(admin);
    if (!chats.length && test) chats = await discoverTelegramChats(admin);
    const t0 = performance.now();
    _cardWarm = _cardLoaded;
    const msgs = await buildTelegramMessages(admin, tgAlerts, by);
    const tBuilt = performance.now();
    const res = await sendTelegram(chats, msgs);
    const timing = { build: Math.round(tBuilt - t0), send: Math.round(performance.now() - tBuilt),
      cards: msgs.map((m) => (m.cards ? m.cards.length : 0)), warm: _cardWarm };
    // Leave the outcome of an admin test where the owner (and support) can see it.
    if (test) {
      await admin.from("app_state").upsert({
        key: "telegram_status",
        value: { at: new Date().toISOString(), chats: chats.length, result: res, lastError: _tgLastError, timing },
        updated_at: new Date().toISOString(),
      });
    }
    return res;
  })();
  if (!hasPush) return json({ ok: true, devices: 0, sent: 0, telegram: await telegramP });

  // Skip only the DEVICE that made the change (its own endpoint), not the whole
  // account: the owner edits on the desktop and must still get the alert on
  // their phone. A sender without push on (no endpoint) skips nothing.
  const self = typeof body?.endpoint === "string" ? body.endpoint : "";
  let q = admin.from("push_subscriptions").select("endpoint, p256dh, auth, role, user_id");
  if (test) q = q.eq("user_id", user.id);
  else if (self) q = q.neq("endpoint", self);
  const { data: subs, error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);
  // Decide by each owner's CURRENT account, never the role the browser stored
  // when push was turned on: a suspended, deleted or demoted employee's phone
  // must stop showing customer names / phones / addresses. Their rows go too.
  const ids = [...new Set((subs || []).map((s: any) => s.user_id))];
  const okUser: Record<string, boolean> = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data, error: e } = await admin.auth.admin.getUserById(id);
      if (e) { okUser[id] = !/not.?found/i.test(e.message || ""); return; }   // transient → keep
      const u: any = data && data.user;
      const banned = u && u.banned_until && new Date(u.banned_until).getTime() > Date.now();
      okUser[id] = !!u && !banned && RECEIVER_ROLES.includes((u.app_metadata || {}).role);
    } catch { okUser[id] = true; }
  }));
  const stale = (subs || []).filter((s: any) => !okUser[s.user_id]).map((s: any) => s.endpoint);
  if (stale.length) await admin.from("push_subscriptions").delete().in("endpoint", stale);
  const targets = (subs || []).filter((s: any) => okUser[s.user_id]);

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

  return json({ ok: true, devices: targets.length, sent, failed, removed: dead.length, telegram: await telegramP });
});
