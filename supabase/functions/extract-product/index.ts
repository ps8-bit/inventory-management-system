// Product-name OCR. The browser sends a downscaled product photo; this function
// calls Gemini (key stays server-side) and returns the product name + any code.
// Mirrors extract-slip's security model: CORS allowlist + JWT (write roles).

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
const WRITE_ROLES = ["admin", "manager", "staff"];

function buildPrompt() {
  return `คุณเป็นผู้ช่วยอ่านข้อความจากรูปภาพสินค้า (OCR) จงอ่าน "ชื่อสินค้า" จากรูปภาพที่แนบมา ซึ่งอาจเป็นป้ายสินค้า กล่อง ฉลาก แท็กราคา หรือป้ายเขียนมือ

เงื่อนไข:
- "name": ชื่อสินค้าที่เด่นและชัดเจนที่สุดในรูป อ่านตามที่เห็นจริง (ไทย/อังกฤษ/ตัวเลข ปนกันได้) — ตัดข้อความที่ไม่ใช่ชื่อสินค้าออก เช่น ราคา เลขบาร์โค้ด คำว่า "ชื่อสินค้า/Product" โลโก้ร้าน
- "code": รหัสสินค้า/รุ่น/SKU ที่ปรากฏในรูป ถ้ามี (เอาเฉพาะตัวอักษรอังกฤษ ตัวเลข และเครื่องหมายขีด) ถ้าไม่มีให้เป็น ""
- ห้ามเดาหรือแต่งข้อมูลที่ไม่มีในรูปเด็ดขาด หากอ่านชื่อสินค้าไม่ได้เลย ให้ "name": ""

ตอบกลับเป็น JSON Object เท่านั้น ห้ามมีข้อความเกริ่นนำ ห้ามมีคำอธิบาย และห้ามห่อด้วย Markdown code block ตาม Schema นี้:
{ "name": "string", "code": "string" }`;
}

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

  // Authorize: a logged-in user with write permission (the browser name scanner).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  const role = (user.app_metadata as any)?.role || (user.user_metadata as any)?.role;
  if (!WRITE_ROLES.includes(role))
    return json({ success: false, error: "Forbidden — insufficient permission" }, 403);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ success: false, error: "GEMINI_API_KEY not configured" }, 500);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  const { image_base64, mime_type } = payload || {};
  if (typeof image_base64 !== "string" || !image_base64)
    return json({ success: false, error: "Missing image_base64" }, 400);
  const mime = ALLOWED_MIME.includes(mime_type) ? mime_type : "image/jpeg";
  if (image_base64.length > 11_000_000)
    return json({ success: false, error: "Image too large" }, 413);

  const geminiBody = {
    contents: [{
      parts: [
        { text: buildPrompt() },
        { inlineData: { mimeType: mime, data: image_base64 } },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let modelText = "";
  let lastStatus = 0;
  let lastDetail = "";

  outer:
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(2000);
      let res: Response;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody) },
        );
      } catch (e) {
        lastStatus = 0; lastDetail = String(e).slice(0, 300);
        continue;
      }
      if (res.status === 429 || res.status === 503) {
        lastStatus = res.status; lastDetail = (await res.text()).slice(0, 300);
        continue;
      }
      if (res.status === 404) {
        lastStatus = 404; lastDetail = (await res.text()).slice(0, 300);
        break;
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
      ? "Gemini รับคำขอมากเกินไป (429) — รอสักครู่แล้วลองใหม่"
      : lastStatus === 0 ? "เชื่อมต่อ Gemini ไม่ได้" : `Gemini error ${lastStatus}`;
    return json({ success: false, error: msg, detail: lastDetail }, 502);
  }

  let result: any;
  try { result = parseModelJSON(modelText); }
  catch { return json({ success: false, error: "Model did not return valid JSON", raw: modelText.slice(0, 500) }, 502); }

  const name = String(result?.name ?? "").trim().slice(0, 200);
  const code = String(result?.code ?? "").replace(/[^A-Za-z0-9\-]/g, "").slice(0, 60);

  return json({ success: true, name, code, raw: modelText.slice(0, 300) });
});
