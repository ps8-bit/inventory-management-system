import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin-only user management. Every privileged action (invite / change role /
// suspend / delete / list) runs here with the service role, AFTER verifying the
// caller is a logged-in admin. The browser can never hold the service key, so
// these operations must live server-side.

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

const ALLOWED_ROLES = ["admin", "manager", "staff", "viewer"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Shape an auth.users row into what the UI table expects.
function toClientUser(u: any) {
  const meta = u.user_metadata || {};
  const app = u.app_metadata || {};
  const name = meta.name || (u.email ? u.email.split("@")[0] : "ผู้ใช้");
  const banned = u.banned_until && new Date(u.banned_until).getTime() > Date.now();
  return {
    id: u.id,
    email: u.email || "",
    name,
    role: app.role || meta.role || "viewer",
    avatar: meta.avatar || name.slice(0, 2),
    active: !banned,
    created_at: u.created_at || null,
    last_sign_in_at: u.last_sign_in_at || null,
    invited: !u.last_sign_in_at,           // never logged in yet → invite pending
  };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Verify the caller is a real, logged-in admin (role from tamper-proof app_metadata).
  const { data: { user: caller }, error: authErr } =
    await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !caller) return json({ error: "Unauthorized" }, 401);
  if (caller.app_metadata?.role !== "admin")
    return json({ error: "Forbidden — admin only" }, 403);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const action = payload?.action;

  try {
    switch (action) {
      /* ---- list every user ---- */
      case "list": {
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) return json({ error: error.message }, 400);
        return json({ users: (data.users || []).map(toClientUser) });
      }

      /* ---- invite a new member (sends email; they set their own password) ---- */
      case "invite": {
        const { name, email, role, avatar } = payload;
        const redirectTo = ALLOWED_ORIGINS.includes(payload.redirectTo)
          ? payload.redirectTo : ALLOWED_ORIGINS[0];
        if (!name || !email || !role) return json({ error: "กรอกข้อมูลไม่ครบ" }, 400);
        if (!EMAIL_RE.test(email)) return json({ error: "อีเมลไม่ถูกต้อง" }, 400);
        if (!ALLOWED_ROLES.includes(role)) return json({ error: "บทบาทไม่ถูกต้อง" }, 400);

        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { name, role, avatar: avatar || name.slice(0, 2) },  // user_metadata (display)
          redirectTo,
        });
        if (error) return json({ error: error.message }, 400);

        // app_metadata.role is the authoritative claim RLS reads — set it explicitly.
        await admin.auth.admin.updateUserById(data.user.id, { app_metadata: { role } });
        return json({ user: toClientUser({ ...data.user, app_metadata: { role } }) });
      }

      /* ---- change a member's role ---- */
      case "setRole": {
        const { id, role } = payload;
        if (!id || !ALLOWED_ROLES.includes(role)) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
        if (id === caller.id) return json({ error: "เปลี่ยนบทบาทของตัวเองไม่ได้" }, 400);
        const { data, error } = await admin.auth.admin.updateUserById(id, {
          app_metadata: { role },
          user_metadata: { role },   // keep display copy in sync
        });
        if (error) return json({ error: error.message }, 400);
        return json({ user: toClientUser(data.user) });
      }

      /* ---- suspend / re-activate ---- */
      case "setActive": {
        const { id, active } = payload;
        if (!id) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
        if (id === caller.id) return json({ error: "ระงับบัญชีของตัวเองไม่ได้" }, 400);
        const { data, error } = await admin.auth.admin.updateUserById(id, {
          ban_duration: active ? "none" : "876000h",   // ~100 years = suspended
        });
        if (error) return json({ error: error.message }, 400);
        return json({ user: toClientUser(data.user) });
      }

      /* ---- delete a member ---- */
      case "delete": {
        const { id } = payload;
        if (!id) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
        if (id === caller.id) return json({ error: "ลบบัญชีของตัวเองไม่ได้" }, 400);
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: "ไม่รู้จักคำสั่ง" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
