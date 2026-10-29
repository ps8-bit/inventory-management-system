/* ============ CARRIER CONFIGURATION — one registry for every shipping company ============
   The customer tracking page (#track, tracking.jsx) reads ONLY this file to decide
   which logo, name and button a shipment gets. To add a carrier, append one entry
   to CARRIER_CONFIG — no component changes needed.

   Entry fields:
     id        stable carrier id (what a future carrier API / webhook would store)
     name      display name on the page
     ctaName   optional shorter name for the button ("ติดตามพัสดุกับ <ctaName || name>")
     short     text drawn in the brand-colour logo tile
     bg / fg   logo tile colours (brand colours)
     mark      wordmark drawn as the logo: [{ t: text, c: colour, i: italic }], plus
               optional markBg (box colour) and markSub ({ t, c } small second line)
     logo      optional self-hosted image path, e.g. "img/carriers/flash.svg". The CSP
               blocks third-party img-src, so logos must live in this repo; a missing
               or broken file falls back to the drawn tile.
     aliases   lower-case substrings matched against the free-text carrier stored on
               orders/labels ("ไปรษณีย์ไทย", "Kerry Express", "J&T" …)
     site      the carrier's official tracking page (fallback when there is no deep link)
     trackUrl  (encodedTracking) => URL that opens the page WITH the number filled in,
               or null when the site can't take the number from the URL
     hosts     the only hostnames a generated URL may point at (checked by safeTrackUrl)
     verified  date the deep link was opened in a browser and seen to load the number

   Deep links verified 2026-10-29 by loading each URL and checking the number reached
   the page's search box. J&T's site ignores every query parameter tried (billcode,
   billCode, bills) so it gets the copy-then-open fallback instead of a fake link. */
const CARRIER_CONFIG = [
  { id: "thaipost", name: "ไปรษณีย์ไทย (EMS)", ctaName: "EMS", short: "EMS", bg: "#E30613", fg: "#fff",
    mark: [{ t: "ไปรษณีย์ไทย", c: "#E30613" }], markSub: { t: "Thailand Post", c: "#1B2A6B" },
    aliases: ["thai post", "thaipost", "ไปรษณีย์", "ems", "thailand post", "logispost", "eco-post"],
    site: "https://track.thailandpost.co.th/",
    trackUrl: (t) => "https://track.thailandpost.co.th/?trackNumber=" + t,
    hosts: ["track.thailandpost.co.th"], verified: "2026-10-29" },
  { id: "flash", name: "Flash Express", short: "Flash", bg: "#FFC20E", fg: "#1a1a1a",
    mark: [{ t: "FLASH", c: "#111", i: 1 }], markBg: "#FFE500", markSub: { t: "EXPRESS", c: "#111" },
    aliases: ["flash", "แฟลช"],
    site: "https://www.flashexpress.co.th/fle/tracking",
    trackUrl: (t) => "https://www.flashexpress.co.th/fle/tracking?se=" + t,
    hosts: ["www.flashexpress.co.th"], verified: "2026-10-29" },
  { id: "jt", name: "J&T Express", short: "J&T", bg: "#D71920", fg: "#fff",
    mark: [{ t: "J&T", c: "#E2231A", i: 1 }], markSub: { t: "EXPRESS", c: "#E2231A" },
    aliases: ["j&t", "j & t", "jt express", "jnt", "เจแอนด์ที"],
    site: "https://www.jtexpress.co.th/service/track",
    trackUrl: null,
    hosts: ["www.jtexpress.co.th"], verified: "2026-10-29" },
  { id: "kex", name: "KEX Express (Kerry)", ctaName: "KEX", short: "KEX", bg: "#F26B21", fg: "#fff",
    mark: [{ t: "KEX", c: "#F26B21" }], markSub: { t: "EXPRESS", c: "#444" },
    aliases: ["kex", "kerry", "เคอรี่"],
    site: "https://th.kex-express.com/th/track/",
    trackUrl: (t) => "https://th.kex-express.com/th/track/?track=" + t,
    hosts: ["th.kex-express.com"], verified: "2026-10-29" },
  { id: "spx", name: "SPX Express", short: "SPX", bg: "#EE4D2D", fg: "#fff",
    mark: [{ t: "SPX", c: "#EE4D2D", i: 1 }], markSub: { t: "EXPRESS", c: "#EE4D2D" },
    aliases: ["spx", "shopee"],
    site: "https://spx.co.th/track",
    trackUrl: (t) => "https://spx.co.th/track?" + t,
    hosts: ["spx.co.th"], verified: "2026-10-29" },
  { id: "ninjavan", name: "Ninja Van", short: "NV", bg: "#C8102E", fg: "#fff",
    mark: [{ t: "ninja", c: "#C8102E" }], markSub: { t: "van", c: "#111" },
    aliases: ["ninja", "นินจา"],
    site: "https://www.ninjavan.co/th-th/tracking",
    trackUrl: (t) => "https://www.ninjavan.co/th-th/tracking?id=" + t,
    hosts: ["www.ninjavan.co"], verified: "2026-10-29" },
  { id: "dhl", name: "DHL Express", short: "DHL", bg: "#FFCC00", fg: "#D40511",
    mark: [{ t: "DHL", c: "#D40511", i: 1 }], markBg: "#FFCC00",
    aliases: ["dhl"],
    site: "https://www.dhl.com/th-th/home/tracking.html",
    trackUrl: (t) => "https://www.dhl.com/th-th/home/tracking.html?submit=1&tracking-id=" + t,
    hosts: ["www.dhl.com"], verified: "2026-10-29" },
  { id: "fedex", name: "FedEx", short: "FedEx", bg: "#4D148C", fg: "#fff",
    mark: [{ t: "Fed", c: "#4D148C" }, { t: "Ex", c: "#FF6600" }],
    aliases: ["fedex"],
    site: "https://www.fedex.com/en-th/tracking.html",
    trackUrl: (t) => "https://www.fedex.com/fedextrack/?trknbr=" + t,
    hosts: ["www.fedex.com"], verified: "2026-10-29" },
];

// Any carrier string that matches no entry. No link is ever invented for it —
// the customer gets the number to copy and the name the shop typed.
const CUSTOM_CARRIER = { id: "other", name: "", short: "", bg: "#1a1a1a", fg: "#fff",
  aliases: [], site: null, trackUrl: null, hosts: [] };

function carrierById(id) {
  return CARRIER_CONFIG.find(c => c.id === id) || null;
}

/* Free-text carrier ("Kerry Express", "ไปรษณีย์ไทย") or a carrier id → config entry.
   Unknown → a custom entry carrying the typed name, with no link. */
function resolveCarrier(carrier) {
  const raw = String(carrier || "").trim();
  if (!raw || raw === "—") return null;
  const byId = carrierById(raw.toLowerCase());
  if (byId) return byId;
  const n = raw.toLowerCase() + " ";
  const hit = CARRIER_CONFIG.find(c => c.aliases.some(a => n.includes(a)));
  if (hit) return hit;
  return { ...CUSTOM_CARRIER, name: raw, short: raw.replace(/\s+/g, "").slice(0, 3).toUpperCase() };
}

/* A tracking number we're willing to put in a URL: letters, digits, dashes only,
   6–40 chars (spaces dropped). Anything else is shown, never linked. */
function cleanTrackingNumber(t) {
  const v = String(t || "").replace(/\s+/g, "").trim();
  return /^[A-Za-z0-9-]{6,40}$/.test(v) ? v.toUpperCase() : "";
}

// Last gate before a URL reaches an <a href>: https only, host on the carrier's allowlist.
function safeTrackUrl(url, cfg) {
  if (!url || !cfg || !Array.isArray(cfg.hosts)) return null;
  try {
    const u = new URL(url);
    return (u.protocol === "https:" && cfg.hosts.includes(u.hostname)) ? u.href : null;
  } catch (e) { return null; }
}

/* Everything the page needs to send a customer to the carrier:
     { cfg, tracking, url, deepLink }
   url = the deep link when the carrier takes the number from the URL, else the
   official tracking page (deepLink false → the page tells them to paste the number). */
function carrierTrackLink(carrier, tracking) {
  const cfg = resolveCarrier(carrier);
  const num = cleanTrackingNumber(tracking);
  if (!cfg) return { cfg: null, tracking: num, url: null, deepLink: false };
  const deep = (num && typeof cfg.trackUrl === "function") ? safeTrackUrl(cfg.trackUrl(encodeURIComponent(num)), cfg) : null;
  const site = cfg.site ? safeTrackUrl(cfg.site, cfg) : null;
  return { cfg, tracking: num, url: deep || site, deepLink: !!deep };
}

/* ---- Shipment status model ----
   The shop's own statuses (picking / packed / shipped / delivered) cover the first
   three stages and the final one. The carrier-side stages in between can only come
   from a carrier API / webhook (a future `shipmentStatus` field on the shipment);
   until one exists they are never shown as reached — the page points the customer
   at the carrier's site instead. "ถึงศูนย์ปลายทาง" is NOT delivery. */
const SHIPMENT_STAGES = [
  { id: "preparing",          label: "เตรียมสินค้า",      source: "shop" },
  { id: "ready",              label: "พร้อมจัดส่ง",       source: "shop" },
  { id: "handed_over",        label: "ส่งให้ขนส่ง",       source: "shop" },
  { id: "in_transit",         label: "ระหว่างขนส่ง",      source: "carrier" },
  { id: "at_destination_hub", label: "ถึงศูนย์ปลายทาง",   source: "carrier" },
  { id: "out_for_delivery",   label: "กำลังนำจ่าย",       source: "carrier" },
  { id: "delivered",          label: "จัดส่งสำเร็จ",      source: "carrier" },
];
const _ORDER_TO_STAGE = { picking: "preparing", packed: "ready", shipped: "handed_over", delivered: "delivered" };

/* Stage index for one shipment. A carrier-reported status wins when it is a known
   stage; otherwise the order status maps. "delivered" from the shop's back office
   counts (staff marked it); nothing else ever reaches it. */
function shipmentStageIndex(orderStatus, shipmentStatus) {
  const fromCarrier = SHIPMENT_STAGES.findIndex(s => s.id === shipmentStatus);
  if (fromCarrier >= 0) return fromCarrier;
  const id = _ORDER_TO_STAGE[orderStatus] || "preparing";
  return SHIPMENT_STAGES.findIndex(s => s.id === id);
}

/* "TH1, TH2" or "TH1 TH2" in one tracking field = several boxes. Returns the
   distinct numbers in their stored order. */
function splitTrackingNumbers(t) {
  const seen = new Set();
  return String(t || "").split(/[,;/|\s]+/).map(s => s.trim()).filter(s => {
    if (!s || s === "—" || seen.has(s.toUpperCase())) return false;
    seen.add(s.toUpperCase()); return true;
  });
}

/* Carrier logo. cfg.logo (a file hosted in this repo) wins; otherwise the carrier's
   wordmark is drawn from cfg.mark in its brand colours, at a fixed 2:1 box so every
   carrier sits in the same slot. Unknown carriers get a neutral initials tile. */
function CarrierLogo({ cfg, size = 56 }) {
  const [broken, setBroken] = React.useState(false);
  if (!cfg) return null;
  const w = Math.round(size * 1.9);
  const box = { width: w, height: size, flexShrink: 0, borderRadius: Math.round(size * 0.2), display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", lineHeight: 1 };
  if (cfg.logo && !broken) {
    return <span style={box}><img src={cfg.logo} alt={cfg.name} onError={() => setBroken(true)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/></span>;
  }
  if (Array.isArray(cfg.mark) && cfg.mark.length) {
    const len = cfg.mark.reduce((n, m) => n + m.t.length, 0);
    const fs = Math.round(size * Math.min(0.5, 2.6 / Math.max(len, 3)));
    return (
      <span role="img" aria-label={cfg.name} style={{ ...box, background: cfg.markBg || "transparent" }}>
        <span style={{ fontSize: fs, fontWeight: 900, letterSpacing: "-0.02em" }}>
          {cfg.mark.map((m, i) => <span key={i} style={{ color: m.c, fontStyle: m.i ? "italic" : "normal" }}>{m.t}</span>)}
        </span>
        {cfg.markSub && <span style={{ marginTop: Math.round(size * 0.06), fontSize: Math.max(8, Math.round(size * 0.16)), fontWeight: 700, letterSpacing: "0.18em", color: cfg.markSub.c }}>{cfg.markSub.t}</span>}
      </span>
    );
  }
  return <span aria-hidden="true" style={{ ...box, width: size, background: cfg.bg, color: cfg.fg, fontWeight: 800, fontSize: Math.round(size * 0.32) }}>{cfg.short || "?"}</span>;
}

Object.assign(window, {
  CARRIER_CONFIG, CUSTOM_CARRIER, carrierById, resolveCarrier, cleanTrackingNumber, safeTrackUrl,
  carrierTrackLink, SHIPMENT_STAGES, shipmentStageIndex, splitTrackingNumbers, CarrierLogo,
});
