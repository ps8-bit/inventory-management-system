// Resolve product images from web pages. The browser sends product-page URLs
// (e.g. a WooCommerce permalink, or https://store/?p=<ID>); this function fetches
// each page server-side (browsers can't, due to CORS) and returns its og:image.
// Used by the catalog importer to backfill photos for products that have no
// image in the CSV. Mirrors extract-product's security model: CORS allowlist +
// JWT (write roles). SSRF-guarded: only http/https, private/loopback hosts blocked.

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

const WRITE_ROLES = ["admin", "manager", "staff"];
const MAX_URLS = 50;       // per request
const CONCURRENCY = 6;     // simultaneous page fetches
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 600_000;

// Block loopback / private / link-local hosts so a logged-in user can't turn this
// into an SSRF probe of internal infrastructure. (Also means a localhost store URL
// is rejected — the public store domain is required, which is expected.)
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 link-local / ULA
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function pickMeta(html: string, prop: string): string | null {
  const p = prop.replace(/[:]/g, "\\:");
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? m[1] : null;
}

function pickLinkImageSrc(html: string): string | null {
  const m = html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']image_src["']/i);
  return m ? m[1] : null;
}

function absolutize(src: string, base: string): string {
  try { return new URL(src, base).href; } catch { return src; }
}

async function resolveOne(rawUrl: string): Promise<{ url: string; image: string | null; error?: string }> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { url: rawUrl, image: null, error: "invalid url" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { url: rawUrl, image: null, error: "unsupported protocol" };
  if (isBlockedHost(u.hostname)) return { url: rawUrl, image: null, error: "blocked host (localhost/private)" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.href, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PSStockBot/1.0; +https://psstock.vercel.app)" },
    });
    if (!res.ok) return { url: rawUrl, image: null, error: `HTTP ${res.status}` };
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("image/")) return { url: rawUrl, image: res.url || u.href }; // URL was already an image
    if (ct && !ct.includes("html") && !ct.includes("xml")) return { url: rawUrl, image: null, error: "not a web page" };

    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_HTML_BYTES);
    const html = new TextDecoder("utf-8").decode(buf);
    const finalUrl = res.url || u.href;
    const img = pickMeta(html, "og:image")
            || pickMeta(html, "og:image:url")
            || pickMeta(html, "og:image:secure_url")
            || pickMeta(html, "twitter:image")
            || pickMeta(html, "twitter:image:src")
            || pickLinkImageSrc(html);
    if (!img) return { url: rawUrl, image: null, error: "no image found on page" };
    return { url: rawUrl, image: absolutize(img.trim(), finalUrl) };
  } catch (e) {
    return { url: rawUrl, image: null, error: String(e).includes("aborted") ? "timeout" : "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

// Resolve a list with bounded concurrency (workers pull from a shared cursor).
async function resolveAll(urls: string[]) {
  const results: Array<{ url: string; image: string | null; error?: string }> = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= urls.length) return;
      results[i] = await resolveOne(urls[i]);
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
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

  // Authorize: a logged-in user with write permission.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);
  const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);
  const role = (user.app_metadata as any)?.role || (user.user_metadata as any)?.role;
  if (!WRITE_ROLES.includes(role)) return json({ success: false, error: "Forbidden — insufficient permission" }, 403);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ success: false, error: "Invalid JSON body" }, 400); }

  // Accept { url } (single) or { urls: [] } (batch).
  let urls: string[] = [];
  if (typeof payload?.url === "string") urls = [payload.url];
  else if (Array.isArray(payload?.urls)) urls = payload.urls.filter((x: unknown) => typeof x === "string");
  urls = urls.map((s) => s.trim()).filter(Boolean).slice(0, MAX_URLS);
  if (!urls.length) return json({ success: false, error: "Missing url(s)" }, 400);

  const results = await resolveAll(urls);
  const found = results.filter((r) => r.image).length;
  return json({ success: true, count: urls.length, found, results });
});
