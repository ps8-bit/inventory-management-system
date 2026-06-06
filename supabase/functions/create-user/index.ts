import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Only these origins may call this function. Anything else gets no CORS grant,
// so a malicious page on another domain cannot invoke it from a victim's browser.
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

Deno.serve(async (req) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return new Response("Method Not Allowed", { status: 405, headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401, headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Verify caller is a real logged-in admin
  const { data: { user }, error: authErr } = await admin.auth.getUser(
    authHeader.replace("Bearer ", "")
  );
  if (authErr || !user) return new Response("Unauthorized", { status: 401, headers: cors });
  if (user.user_metadata?.role !== "admin")
    return new Response(JSON.stringify({ error: "Forbidden — admin only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

  const { name, email, password, role, avatar } = await req.json();
  const fail = (msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  // Server-side validation — never trust the client. The browser form can be
  // bypassed, so re-check everything here before touching the auth admin API.
  const ALLOWED_ROLES = ["admin", "manager", "staff", "viewer"];
  if (!name || !email || !password || !role) return fail("Missing fields");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("อีเมลไม่ถูกต้อง");
  if (typeof password !== "string" || password.length < 8) return fail("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
  if (!ALLOWED_ROLES.includes(role)) return fail("บทบาทไม่ถูกต้อง");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // name/avatar in user_metadata (display only).
    // role ALSO in app_metadata — the authoritative, tamper-proof source RLS reads.
    user_metadata: { name, role, avatar: avatar || name.slice(0, 2) },
    app_metadata: { role },
  });

  if (error)
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  return new Response(JSON.stringify({ id: data.user.id, email: data.user.email }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
