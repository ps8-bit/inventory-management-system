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

// --- SSRF guard --------------------------------------------------------------
// A logged-in user controls the URL, so we must stop this becoming a probe of
// internal infrastructure. Defense in depth: (1) accept only real domain names —
// no IP literals in ANY encoding; (2) DNS-resolve and reject internal IPs;
// (3) follow redirects MANUALLY, re-validating every hop (a public URL must not
// 302 us into the cloud metadata network).

// Reject any host that isn't a normal domain with a letter TLD. This kills every
// IP-literal vector at once: dotted-decimal (127.0.0.1), integer (2130706433),
// hex (0x7f000001), octal, and IPv6 (::1) — none match this shape, so all block.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (!/^(?=.*[a-z])([a-z0-9-]+\.)+[a-z]{2,}$/.test(h)) return true;
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost")
      || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home")
      || h.endsWith(".corp")) return true;
  return false;
}

// True if an IP string sits in a private / loopback / link-local / CGNAT range.
function isBlockedIp(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s.includes(":")) { // IPv6
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
    const m4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/); // IPv4-mapped ::ffff:127.0.0.1
    if (m4) return isBlockedIp(m4[1]);
    return false;
  }
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;             // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
  return false;
}

// Resolve the host and reject if ANY A/AAAA record is internal (defeats a public
// name that points at an internal IP). Best-effort: if the runtime forbids DNS
// resolution we fall through to the per-hop host check, which still blocks every
// IP-literal target.
async function resolvesToBlockedIp(hostname: string): Promise<boolean> {
  const ips: string[] = [];
  try { ips.push(...await Deno.resolveDns(hostname, "A")); } catch { /* ignore */ }
  try { ips.push(...await Deno.resolveDns(hostname, "AAAA")); } catch { /* ignore */ }
  return ips.some(isBlockedIp);
}

// Fetch following at most maxHops redirects, re-validating the host at EVERY hop.
async function safeFetch(startUrl: string, maxHops = 4): Promise<{ res: Response; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("unsupported protocol");
    if (isBlockedHost(u.hostname)) throw new Error("blocked host");
    if (await resolvesToBlockedIp(u.hostname)) throw new Error("blocked host");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(u.href, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PSStockBot/1.0; +https://psstock.vercel.app)" },
      });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { res, finalUrl: u.href };
      try { await res.body?.cancel(); } catch { /* ignore */ }
      current = new URL(loc, u.href).href; // resolves relative redirects
      continue;
    }
    return { res, finalUrl: u.href };
  }
  throw new Error("too many redirects");
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

  try {
    const { res, finalUrl } = await safeFetch(u.href);
    if (!res.ok) return { url: rawUrl, image: null, error: `HTTP ${res.status}` };
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("image/")) return { url: rawUrl, image: finalUrl }; // URL was already an image
    if (ct && !ct.includes("html") && !ct.includes("xml")) return { url: rawUrl, image: null, error: "not a web page" };

    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_HTML_BYTES);
    const html = new TextDecoder("utf-8").decode(buf);
    const img = pickMeta(html, "og:image")
            || pickMeta(html, "og:image:url")
            || pickMeta(html, "og:image:secure_url")
            || pickMeta(html, "twitter:image")
            || pickMeta(html, "twitter:image:src")
            || pickLinkImageSrc(html);
    if (!img) return { url: rawUrl, image: null, error: "no image found on page" };
    return { url: rawUrl, image: absolutize(img.trim(), finalUrl) };
  } catch (e) {
    const msg = String(e);
    if (msg.includes("blocked host")) return { url: rawUrl, image: null, error: "blocked host (private/internal)" };
    if (msg.includes("unsupported protocol")) return { url: rawUrl, image: null, error: "unsupported protocol" };
    if (msg.includes("too many redirects")) return { url: rawUrl, image: null, error: "too many redirects" };
    return { url: rawUrl, image: null, error: msg.includes("aborted") ? "timeout" : "fetch failed" };
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
  // Authorize on the tamper-proof claim ONLY. user_metadata is self-writable by
  // the user (sb.auth.updateUser), so it must never decide permission.
  const role = (user.app_metadata as any)?.role;
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
