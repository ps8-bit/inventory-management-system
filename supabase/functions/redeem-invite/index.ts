import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// PUBLIC (deployed --no-verify-jwt): a new employee redeems a one-time invite
// code from the login screen to create their own account. The code carries the
// role, so the caller never chooses it. Codes live in public.invite_codes,
// readable only by the service role (supabase/invite-codes.sql).

const ALLOWED_ORIGINS = [
  "https://psstock.vercel.app",
  "http://localhost:8080",
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normCode = (c: unknown) => {
  const s = String(c || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.length === 8 ? s.slice(0, 4) + "-" + s.slice(4) : "";
};

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const code = normCode(p?.code);
  const name = String(p?.name || "").trim().slice(0, 60);
  const email = String(p?.email || "").trim().toLowerCase();
  const password = String(p?.password || "");
  if (!code) return json({ error: "รหัสเชิญไม่ถูกต้อง" }, 400);
  if (!name) return json({ error: "กรุณากรอกชื่อ" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "อีเมลไม่ถูกต้อง" }, 400);
  if (password.length < 8) return json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Claim the code atomically: only one request can flip used_at from null.
  const now = new Date().toISOString();
  const { data: claimed, error: claimErr } = await admin.from("invite_codes")
    .update({ used_at: now, used_email: email })
    .eq("code", code).is("used_at", null).is("revoked_at", null).gt("expires_at", now)
    .select();
  if (claimErr) return json({ error: "เกิดข้อผิดพลาด ลองใหม่" }, 500);
  if (!claimed || !claimed.length) {
    await new Promise((r) => setTimeout(r, 800));   // slow down guessing
    return json({ error: "รหัสเชิญไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว" }, 400);
  }
  const role = claimed[0].role;
  const release = () => admin.from("invite_codes")
    .update({ used_at: null, used_email: null }).eq("code", code);

  let data: any = null, error: any = null;
  try {
    ({ data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { role },                                   // authoritative claim RLS reads
      user_metadata: { name, role, avatar: name.slice(0, 2), invite_code: code },
    }));
  } catch (e) {
    error = { message: (e as Error).message || "สร้างบัญชีไม่สำเร็จ" };   // a throw must not burn the code
  }
  if (error || !data?.user) {
    await release();   // give the code back so they can retry with another email/password
    const errCode = String(error?.code || "");
    const msg = /email_exists|already|registered/i.test(errCode + " " + (error?.message || ""))
      ? "อีเมลนี้มีบัญชีอยู่แล้ว — ใช้ “ลืมรหัสผ่าน?” แทน" : (error?.message || "สร้างบัญชีไม่สำเร็จ");
    return json({ error: msg, code: errCode }, 400);
  }
  await admin.from("invite_codes").update({ used_by: data.user.id }).eq("code", code);
  return json({ ok: true, role });
});
