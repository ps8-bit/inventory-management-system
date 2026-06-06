// Shipping-slip OCR + fuzzy customer match.
// The browser sends a downscaled slip photo + the current list of pending
// customers; this function calls Gemini (key stays server-side) and returns the
// cleansed JSON. Mirrors create-user's security model: CORS allowlist + JWT.

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
// Roles allowed to write order data (matches the RLS write model).
const WRITE_ROLES = ["admin", "manager", "staff"];

// Build the extraction + data-cleansing prompt. The pending list is injected so
// the model can fuzzy-match a possibly-garbled recipient name to a real customer.
// A single slip / receipt may list MANY parcels — extract every one as an array.
function buildPrompt(pending: unknown) {
  const pendingJSON = JSON.stringify(pending ?? [], null, 0);
  return `จงวิเคราะห์รูปภาพสลิป/ใบเสร็จขนส่งที่แนบมานี้ เพื่อสกัดข้อมูลและทำความสะอาดข้อมูล (Data Cleansing) ตามเงื่อนไขต่อไปนี้:

สำคัญมาก: สลิปหรือใบเสร็จ "หนึ่งใบ" อาจมีพัสดุได้ "หลายชิ้น" (หลายผู้รับ + หลายเลขพัสดุ ในใบเดียว) ให้สกัดข้อมูลออกมา "ทุกชิ้น" เป็น array โดยแต่ละชิ้น 1 object

1. สกัดข้อมูลของแต่ละพัสดุ:
   - "courier": ชื่อบริษัทขนส่งของชิ้นนั้น (เช่น Flash Express, J&T Express, EMS/ไปรษณีย์ไทย, Kerry ฯลฯ)
   - "tracking_number": เลขพัสดุของชิ้นนั้น (เอาเฉพาะตัวเลขและตัวอักษรภาษาอังกฤษที่เป็นรหัสพัสดุหลัก ห้ามมีช่องว่างหรือเว้นวรรค เช่น TH10028RX1Z70A หรือ WB340106691TH)
   - "customer_phone": เบอร์โทรของ "ผู้รับ" ของชิ้นนั้น (เอาเฉพาะตัวเลข 10 หลัก เช่น 0812345678 ห้ามมีขีด)
   - หมายเหตุ: ให้ดูเฉพาะข้อมูลของ "ผู้รับ" (ผู้รับ/Recipient/ถึง) เท่านั้น ห้ามเอาข้อมูลของ "ผู้ส่ง" (ผู้ส่ง/Sender/จาก) มาใช้เด็ดขาด

2. การทำ Fuzzy Matching สำหรับชื่อลูกค้า (ทำกับผู้รับของแต่ละชิ้น):
   - อ่านชื่อ "ผู้รับ" ของพัสดุชิ้นนั้น ซึ่งบางครั้งอาจอ่านเพี้ยน สระ/วรรณยุกต์หาย หรือพิมพ์ผิดเล็กน้อย
   - นำชื่อที่อ่านได้ไปเทียบกับ "รายชื่อลูกค้าที่ถูกต้องในระบบ" ด้านล่าง
   - หากพบชื่อที่คล้ายกันมาก (สระเพี้ยน, ตัวสะกดใกล้เคียง, ชื่อย่อ, หรือสลับชื่อ-นามสกุล) ให้จับคู่กับชื่อในระบบนั้น และอาจใช้เบอร์โทรช่วยยืนยัน
   - ประเมิน "confidence_score" (0.0–1.0): ตรงเป๊ะ = 1.0, ไม่พบที่ใกล้เคียงเลย = ใส่ "matched_customer_name": null และ "confidence_score": 0.0

---
[รายชื่อลูกค้าที่ถูกต้องในระบบ (Pending Customers)]
${pendingJSON}
---

ตอบกลับเป็น JSON Object เท่านั้น ห้ามมีข้อความเกริ่นนำ ห้ามมีคำอธิบาย และห้ามห่อด้วย Markdown code blocks โดยมี Schema ดังนี้:

{
  "success": true,
  "parcels": [
    {
      "courier": "string",
      "tracking_number": "string",
      "extracted_name_from_slip": "string (ชื่อผู้รับที่อ่านได้ตรงๆ จากสลิป)",
      "matched_customer_name": "string หรือ null",
      "confidence_score": float,
      "customer_phone": "string"
    }
  ]
}

หากมีพัสดุชิ้นเดียวก็ใส่ใน array ที่มี 1 object หากมีหลายชิ้นให้ใส่ครบทุกชิ้นตามลำดับที่ปรากฏบนสลิป`;
}

// Gemini sometimes wraps JSON in ```json fences despite instructions — strip them.
function parseModelJSON(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Authorize: either an internal service call (line-bot, shares CRON_SECRET) OR a
  // logged-in user with write permission (the browser slip scanner).
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const internalOk = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!internalOk) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);
    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
    const role = (user.app_metadata as any)?.role || (user.user_metadata as any)?.role;
    if (!WRITE_ROLES.includes(role))
      return json({ success: false, error: "Forbidden — insufficient permission" }, 403);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ success: false, error: "GEMINI_API_KEY not configured" }, 500);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const { image_base64, mime_type, pending_customers } = payload || {};
  if (typeof image_base64 !== "string" || !image_base64)
    return json({ success: false, error: "Missing image_base64" }, 400);
  const mime = ALLOWED_MIME.includes(mime_type) ? mime_type : "image/jpeg";
  // Guard against oversized uploads (base64 is ~1.33x raw bytes; ~8MB raw cap).
  if (image_base64.length > 11_000_000)
    return json({ success: false, error: "Image too large" }, 413);
  if (pending_customers != null && !Array.isArray(pending_customers))
    return json({ success: false, error: "pending_customers must be an array" }, 400);

  const geminiBody = {
    contents: [{
      parts: [
        { text: buildPrompt(pending_customers) },
        { inlineData: { mimeType: mime, data: image_base64 } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  // Try models in order; on a rate-limit (429) or transient (503) error, wait
  // and retry, then fall back to the next model. This rides out the free-tier
  // per-minute limit that causes the "Gemini error 429" the user saw.
  const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let modelText = "";
  let lastStatus = 0;
  let lastDetail = "";

  outer:
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2000); // brief backoff before a retry
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) },
        );
      } catch (e) {
        lastStatus = 0; lastDetail = String(e).slice(0, 300);
        continue; // network blip — retry
      }
      if (res.status === 429 || res.status === 503) {
        lastStatus = res.status; lastDetail = (await res.text()).slice(0, 300);
        continue; // overloaded — retry, then next model
      }
      if (res.status === 404) {
        lastStatus = 404; lastDetail = (await res.text()).slice(0, 300);
        break; // model unavailable on this key — try the next model
      }
      if (!res.ok) {
        const errText = await res.text();
        return json({ success: false, error: `Gemini error ${res.status}`, detail: errText.slice(0, 500) }, 502);
      }
      const data = await res.json();
      modelText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
      if (modelText) break outer;
      lastStatus = 200; lastDetail = "empty response";
    }
  }

  if (!modelText) {
    const msg = lastStatus === 429
      ? "Gemini รับคำขอมากเกินไป (429) — โควต้าฟรีเต็มชั่วคราว รอสักครู่แล้วลองใหม่"
      : lastStatus === 0 ? "เชื่อมต่อ Gemini ไม่ได้" : `Gemini error ${lastStatus}`;
    return json({ success: false, error: msg, detail: lastDetail }, 502);
  }

  let result: any;
  try { result = parseModelJSON(modelText); }
  catch { return json({ success: false, error: "Model did not return valid JSON", raw: modelText.slice(0, 500) }, 502); }

  // Normalise the cleansed fields server-side so the client gets clean data
  // regardless of small model deviations from the schema.
  const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
  const normParcel = (p: any) => ({
    courier: String(p?.courier ?? "").trim(),
    tracking_number: String(p?.tracking_number ?? "").replace(/[^A-Za-z0-9]/g, ""),
    extracted_name_from_slip: String(p?.extracted_name_from_slip ?? "").trim(),
    matched_customer_name: p?.matched_customer_name == null ? null : String(p.matched_customer_name).trim(),
    confidence_score: typeof p?.confidence_score === "number" ? Math.max(0, Math.min(1, p.confidence_score)) : 0,
    customer_phone: digits(p?.customer_phone).slice(0, 10),
  });

  // Accept either the new {parcels:[...]} shape or a single flat object (back-compat).
  let parcels: any[];
  if (Array.isArray(result.parcels)) parcels = result.parcels;
  else if (result.tracking_number || result.extracted_name_from_slip || result.courier) parcels = [result];
  else parcels = [];

  return json({ success: true, parcels: parcels.map(normParcel) });
});
