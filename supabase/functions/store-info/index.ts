// Public store branding for the customer tracking page (#track). Anon-callable.
// Returns ONLY public-safe fields (name, logo, tagline, phone) via the service
// role — the sender address is deliberately NOT exposed, matching the privacy
// choice to keep the shop address off the public lookup page.

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data } = await admin
    .from("store_settings").select("value").eq("key", "main").maybeSingle();

  const v = (data?.value as any) || {};
  // Only public-safe branding — NO address.
  return json({
    success: true,
    store: {
      name:    v.name    || "",
      logo:    v.logo    || null,
      tagline: v.tagline || "",
      phone:   (v.sender && v.sender.phone) || "",
    },
  });
});
