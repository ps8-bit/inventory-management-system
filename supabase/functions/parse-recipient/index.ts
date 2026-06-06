// Parse a freeform Thai recipient blob into name / phone / addr1 / addr2 using
// Gemini (free tier). Text-only — the label editor calls this as the "AI" option
// alongside the instant local parser. Mirrors extract-slip's auth/CORS model.

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

const WRITE_ROLES = ["admin", "manager", "staff"];

function buildPrompt(text: string) {
  return `แยกข้อมูล "ผู้รับพัสดุ" จากข้อความต่อไปนี้ให้เป็น JSON สำหรับกรอกฉลากจัดส่ง

ข้อความ:
"""
${text}
"""

กติกา:
- "name": ชื่อ-นามสกุลผู้รับเท่านั้น (ตัดคำว่า "ชื่อ"/"คุณ" นำหน้าออกได้ แต่เก็บชื่อจริงไว้) ห้ามมีเบอร์โทรหรือที่อยู่ปน
- "phone": เบอร์โทรผู้รับ เอาเฉพาะตัวเลข 10 หลัก (มือถือ) หรือ 9 หลัก (เบอร์บ้าน) ห้ามมีขีดหรือเว้นวรรค ถ้าขึ้นต้น +66/66 ให้แปลงเป็น 0
- "addr1": ที่อยู่บรรทัดบน = บ้านเลขที่ หมู่ ซอย ถนน อาคาร
- "addr2": ที่อยู่บรรทัดล่าง = ตำบล/แขวง อำเภอ/เขต จังหวัด รหัสไปรษณีย์
- ถ้าไม่พบส่วนไหน ให้ใส่เป็นสตริงว่าง ""

ตอบเป็น JSON object เท่านั้น ห้ามมีข้อความอื่น ห้ามมี markdown:
{ "name": "string", "phone": "string", "addr1": "string", "addr2": "string" }`;
}

function parseModelJSON(t: string) {
  return JSON.parse(t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""));
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  const role = (user.app_metadata as any)?.role || (user.user_metadata as any)?.role;
  if (!WRITE_ROLES.includes(role)) return json({ success: false, error: "Forbidden" }, 403);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ success: false, error: "GEMINI_API_KEY not configured" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "Invalid JSON" }, 400); }
  const text = String(body?.text ?? "").trim();
  if (!text) return json({ success: false, error: "Missing text" }, 400);
  if (text.length > 4000) return json({ success: false, error: "Text too long" }, 413);

  const geminiBody = {
    contents: [{ parts: [{ text: buildPrompt(text) }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };

  const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let modelText = "";
  let lastStatus = 0;

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
      } catch { lastStatus = 0; continue; }
      if (res.status === 429 || res.status === 503) { lastStatus = res.status; continue; }
      if (res.status === 404) { lastStatus = 404; break; }
      if (!res.ok) return json({ success: false, error: `Gemini error ${res.status}` }, 502);
      const data = await res.json();
      modelText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
      if (modelText) break outer;
    }
  }

  if (!modelText) {
    const msg = lastStatus === 429 ? "Gemini รับคำขอมากเกินไป (429) รอสักครู่แล้วลองใหม่" : "เชื่อมต่อ Gemini ไม่ได้";
    return json({ success: false, error: msg }, 502);
  }

  let r: any;
  try { r = parseModelJSON(modelText); }
  catch { return json({ success: false, error: "Model did not return valid JSON" }, 502); }

  return json({
    success: true,
    name: String(r.name ?? "").trim(),
    phone: String(r.phone ?? "").replace(/\D/g, "").slice(0, 10),
    addr1: String(r.addr1 ?? "").trim(),
    addr2: String(r.addr2 ?? "").trim(),
  });
});
