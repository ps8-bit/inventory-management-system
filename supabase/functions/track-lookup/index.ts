// Public parcel tracking lookup. Anon-callable: a customer searches by phone or
// name and gets back ONLY their matching shipments. Uses the service role to read
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
  if (d.startsWith("66")) d = d.slice(2);
  return d.replace(/^0+/, "");
}

// 0812345678 -> 081xxxx678 (enough for the owner to recognise, useless for harvesting)
function maskPhone(p: string) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 7) return d ? d.slice(0, 2) + "xxxx" : "";
  return d.slice(0, 3) + "xxxx" + d.slice(-3);
}

// Turn a stored label object into a public, tracking-safe shipment row.
function labelToPublic(l: any) {
  if (!l || typeof l !== "object") return null;
  const r = l.recipient || {};
  const id = (l.soId && !/^ฉลากใหม่/.test(l.soId)) ? l.soId : l.id;
  const dateIso = (l.created_at || "").slice(0, 10);
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

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const raw = String(body?.query ?? "").trim();
  if (raw.length < 3) return json({ success: false, error: "พิมพ์อย่างน้อย 3 ตัวอักษร", results: [] }, 400);

  const digits = raw.replace(/\D/g, "");
  const q = raw.toLowerCase();
  const nq = phoneNSN(digits);
  const toks = q.split(/\s+/).filter((t) => t.length >= 2);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
      items: row.item_count ?? 0, dateIso: row.date_iso || (row.created_at || "").slice(0, 10),
    });
  });

  // Server-side filter — only rows matching the query ever leave this function.
  const seen = new Set<string>();
  const results = shipments.filter((o) => {
    const phone = String(o.phone || "").replace(/\D/g, "");
    const name = String(o.customer || "").toLowerCase().replace(/\s+/g, " ");
    const trk = String(o.tracking || "").toLowerCase();
    const hit =
      // Phone: raw-digit substring OR format-agnostic national-number match.
      (digits.length >= 4 && (phone.includes(digits) || (!!nq && phoneNSN(phone).includes(nq)))) ||
      // Name: full substring OR every typed word present (any order / spacing / title).
      name.includes(q) ||
      (toks.length > 0 && toks.every((t) => name.includes(t))) ||
      // Tracking / order id.
      (q.length >= 4 && trk.includes(q)) ||
      (q.length >= 4 && String(o.id).toLowerCase().includes(q));
    if (!hit) return false;
    const key = o.id + "|" + o.tracking;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
    .slice(0, 25)
    .map((o) => ({ ...o, phone: maskPhone(o.phone) }));

  return json({ success: true, results });
});
