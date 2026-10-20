// Public parcel tracking lookup. Anon-callable: a customer searches by full phone
// number, tracking number or order id and gets back ONLY their matching shipments. Uses the service role to read
// the data but filters server-side, so the full customer table is never exposed
// to the browser, and phone numbers are masked in the response.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Thai phone -> "national significant number": strip non-digits, drop the +66
// country code and any leading zero, so "+66 81 552 0917" and "081-552-0917" match.
function phoneNSN(p: string) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("66") && d.length > 9) d = d.slice(2); // "661234567" is an 06x mobile, not +66
  return d.replace(/^0+/, "");
}

// 0812345678 -> 081xxxx678 (enough for the owner to recognise, useless for harvesting)
function maskPhone(p: string) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 7) return d ? d.slice(0, 2) + "xxxx" : "";
  return d.slice(0, 3) + "xxxx" + d.slice(-3);
}

// UTC ISO timestamp → Asia/Bangkok calendar date. A raw .slice(0,10) on the UTC
// string files anything created 00:00–06:59 Bangkok under the previous day. Thailand
// has no DST, so a fixed +7h offset is exact. Mirrors bangkokDateOf() in the frontend.
function bkkDate(iso: string): string {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10) : (iso || "").slice(0, 10);
}

// Turn a stored label object into a public, tracking-safe shipment row.
function labelToPublic(l: any) {
  if (!l || typeof l !== "object") return null;
  const r = l.recipient || {};
  const id = (l.soId && !/^ฉลากใหม่/.test(l.soId)) ? l.soId : l.id;
  const dateIso = bkkDate(l.created_at);
  return {
    id,
    channel: "ฉลาก",
    customer: r.name || "",
    phone: r.phone || "",          // raw, used for matching; masked before returning
    status: l.tracking ? "shipped" : "packed",
    carrier: l.carrier || "",
    tracking: l.tracking || "",
    items: Array.isArray(l.items) ? l.items.length : 0,
    dateIso,
  };
}

// "สมชาย ใจดี" -> "สมชาย ใ." — the customer recognises their own order, a
// scraper doesn't get a full-name list.
function maskName(n: string) {
  const parts = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1 && /^(คุณ|นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.)$/.test(parts[0])) parts.shift();
  if (!parts.length) return "";
  const first = parts[0].length > 12 ? Array.from(parts[0]).slice(0, 12).join("") + "…" : parts[0];
  return parts.length > 1 ? first + " " + Array.from(parts[1])[0] + "." : first;
}

// Client IP: the LAST X-Forwarded-For entry, which the Supabase gateway appends.
// A client-sent XFF is kept in front of it, and cf-connecting-ip / x-real-ip may
// pass through client values, so neither is trusted.
// TODO(verify): confirm live with a header-echo function before relying on it.
function clientIp(req: Request): string {
  const xff = (req.headers.get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff[xff.length - 1] || "";
}

// Durable per-IP cap shared by every isolate (supabase/track-lookup-rate-limit.sql).
const RL_WINDOW_S = 60;
const RL_MAX = 20;

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (b: unknown, s = 200) =>
    // no-store: in-app browsers (Facebook/LINE) must never reuse an earlier status.
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const raw = String(body?.query ?? "").trim();
  if (raw.length < 3) return json({ success: false, error: "พิมพ์อย่างน้อย 3 ตัวอักษร", results: [] }, 400);

  const q = raw.toLowerCase().replace(/\s+/g, "");
  // A full Thai phone number: only digits / separators / +66, ≥9 national digits.
  const nq = /^[\d\s+()-]+$/.test(raw) ? phoneNSN(raw) : "";
  const isPhone = raw.replace(/\D/g, "").length >= 9 && nq.length >= 8 && nq.length <= 9;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // TODO(verify): which header the gateway overwrites is not yet confirmed live.
  // No IP at all → one shared bucket, so a missing header can't mean "unlimited".
  const ip = clientIp(req) || "no-ip";
  {
    const { data: ok, error: rlErr } = await admin.rpc("track_lookup_hit", { p_key: ip, p_window_s: RL_WINDOW_S, p_max: RL_MAX });
    if (!rlErr && ok === false) return json({ success: false, error: "คำขอถี่เกินไป กรุณาลองใหม่อีกครั้งในสักครู่", results: [] }, 429);
  }

  const shipments: any[] = [];

  // Labels (the คิวฉลาก shipments) — data jsonb holds the whole label object.
  const { data: labelRows } = await admin.from("labels").select("data, created_at");
  (labelRows || []).forEach((row: any) => {
    const lbl = row.data;
    if (lbl && !lbl.created_at && row.created_at) lbl.created_at = row.created_at;
    const o = labelToPublic(lbl);
    if (o) shipments.push(o);
  });

  // Orders table (in case some shipments live there too).
  const { data: orderRows } = await admin.from("orders").select("*");
  (orderRows || []).forEach((row: any) => {
    // Normalize the legacy "—" sentinel (older sell/issue orders) to empty so a
    // customer never sees "—" as a tracking number.
    const carrier = row.carrier === "—" ? "" : (row.carrier || "");
    const tracking = row.tracking === "—" ? "" : (row.tracking || "");
    shipments.push({
      id: row.id, channel: row.channel || "", customer: row.customer || "",
      phone: row.phone || "", status: row.status || "picking",
      carrier, tracking,
      items: row.item_count ?? 0, dateIso: row.date_iso || bkkDate(row.created_at),
    });
  });

  // Status/tracking edits (slip scan, pack, manual edit) live in the app_state
  // `order_overrides` blob, not on the orders row — apply the public-safe fields
  // so a slip-scanned tracking number reaches the customer. Deleted → hidden.
  const { data: ovRow } = await admin.from("app_state").select("value").eq("key", "order_overrides").maybeSingle();
  const overrides: Record<string, any> = (ovRow && ovRow.value && typeof ovRow.value === "object") ? ovRow.value : {};
  for (let i = shipments.length - 1; i >= 0; i--) {
    const ov = overrides[shipments[i].id];
    if (!ov || typeof ov !== "object") continue;
    if (ov.deleted) { shipments.splice(i, 1); continue; }
    const s = shipments[i];
    for (const k of ["status", "carrier", "tracking", "phone", "customer"]) {
      if (typeof ov[k] === "string" && ov[k] !== "" && ov[k] !== "—") s[k] = ov[k];
    }
  }

  // Server-side filter — only rows matching the query ever leave this function.
  const seen = new Set<string>();
  // Exact matches only: a full phone number, or a whole tracking number / order
  // id. No substrings and no name search — a fragment like "0812" or a common
  // first name must not return other customers' parcels.
  const results = shipments.filter((o) => {
    const hit =
      // A stored phone may hold two numbers or an extension — compare each group.
      (isPhone && (phoneNSN(String(o.phone || "")) === nq ||
        String(o.phone || "").split(/[^\d+-]+/).some((g) => phoneNSN(g) === nq))) ||
      (q.length >= 6 && String(o.tracking || "").toLowerCase().replace(/\s+/g, "") === q) ||
      (q.length >= 6 && String(o.id || "").toLowerCase() === q);
    if (!hit) return false;
    const key = o.id + "|" + o.tracking;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
    .slice(0, 25)
    .map((o) => ({ ...o, customer: maskName(o.customer), phone: maskPhone(o.phone) }));

  return json({ success: true, results });
});
