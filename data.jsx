/* Product catalog — populated from Supabase on login, falls back to localStorage */

const PRODUCTS = [];

const stockStatus = (p) => {
  if (p.qty === 0) return { key: "out", label: "หมดสต็อก", cls: "badge-danger" };
  if (p.qty <= p.reorder) return { key: "low", label: "ต่ำกว่าจุดสั่งซื้อ", cls: "badge-warning" };
  return { key: "ok", label: "พร้อมขาย", cls: "badge-success" };
};

/* ── Persistent product catalog store ──
   PRODUCTS is a single shared array that every screen reads from.
   It is mutated IN PLACE so that all existing PRODUCTS.find() / PRODUCTS.map()
   calls across the app stay valid. Every mutation persists to localStorage
   and broadcasts "ims-products-change" so open screens re-render. */
(function hydrateProductStore() {
  try {
    const saved = localStorage.getItem("ims_products");
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length) {
        PRODUCTS.length = 0;
        arr.forEach(p => PRODUCTS.push(p));
      }
    }
  } catch (e) {}
})();

function saveProductStore() {
  try { localStorage.setItem("ims_products", JSON.stringify(PRODUCTS)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-products-change"));
  if (!window.dbUpsertProducts) return;
  dbUpsertProducts([...PRODUCTS]).then(res => {
    if (!res || !res.error) return;
    const perm = res.error === 'PERMISSION_OR_MISSING';
    // Don't fail silently: surface via the global toast bridge (app.jsx listens).
    window.dispatchEvent(new CustomEvent('ims-toast', {
      detail: perm ? 'บันทึกไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์แก้ไขสินค้า'
                   : 'บันทึกสินค้าไม่สำเร็จ: ' + res.error
    }));
    // A permission block can never persist this edit → reload canonical server
    // state so the UI stops showing a change that didn't save. (Network errors
    // are left alone — the local copy retries on the next save.)
    if (perm && window.dbLoadProducts) {
      dbLoadProducts().then(fresh => {
        if (!fresh) return;
        PRODUCTS.length = 0; fresh.forEach(p => PRODUCTS.push(p));
        try { localStorage.setItem("ims_products", JSON.stringify(PRODUCTS)); } catch (e) {}
        window.dispatchEvent(new CustomEvent("ims-products-change"));
      }).catch(() => {});
    }
  }).catch(() => {});
}
function addProductToStore(p) {
  PRODUCTS.unshift({ reserved: 0, ...p });
  saveProductStore();
}
function updateProductInStore(sku, changes) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (p) Object.assign(p, changes);
  saveProductStore();
}
function updateManyProducts(skus, changes) {
  const set = new Set(skus);
  PRODUCTS.forEach(p => { if (set.has(p.sku)) Object.assign(p, changes); });
  saveProductStore();
}
async function removeProductsFromStore(skus) {
  const set = new Set(Array.isArray(skus) ? skus : [skus]);
  // Optimistic local removal (instant UI). Note: we deliberately do NOT call
  // saveProductStore() here — that would upsert the whole catalog and trigger a
  // realtime reload that races the delete and flickers the row back.
  const removed = [];
  for (let i = PRODUCTS.length - 1; i >= 0; i--) {
    if (set.has(PRODUCTS[i].sku)) { removed.push(PRODUCTS[i]); PRODUCTS.splice(i, 1); }
  }
  if (!removed.length) return { ok: true };
  try { localStorage.setItem("ims_products", JSON.stringify(PRODUCTS)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-products-change"));

  if (!window.dbDeleteProducts) return { ok: true };
  const res = await dbDeleteProducts([...set]);
  if (res && res.error) {
    // Delete didn't persist (no permission, etc.) → restore canonical server
    // state so the UI doesn't lie about what was removed.
    if (window.dbLoadProducts) {
      const fresh = await dbLoadProducts();
      if (fresh) { PRODUCTS.length = 0; fresh.forEach(p => PRODUCTS.push(p)); }
    } else {
      removed.forEach(p => PRODUCTS.push(p));
    }
    try { localStorage.setItem("ims_products", JSON.stringify(PRODUCTS)); } catch (e) {}
    window.dispatchEvent(new CustomEvent("ims-products-change"));
    const msg = res.error === 'PERMISSION_OR_MISSING'
      ? 'ลบไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์ลบสินค้า (ต้องเป็นผู้ดูแลระบบหรือผู้จัดการ)'
      : 'ลบไม่สำเร็จ: ' + res.error;
    return { ok: false, error: msg };
  }
  return { ok: true };
}
function resetProductStore() {
  try { localStorage.removeItem("ims_products"); } catch (e) {}
  window.location.reload();
}

/* ── Category store ──
   A separate ordered list so admins can add/rename/delete categories
   without touching individual products. Falls back to deriving from
   the current PRODUCTS array on first load (migration-free). */
function loadCategories() {
  // Cloud copy (synced via app_state) wins so every device shares one list.
  if (Array.isArray(window._DB_CATEGORIES) && window._DB_CATEGORIES.length) return window._DB_CATEGORIES;
  try {
    const s = localStorage.getItem("ims_categories");
    if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; }
  } catch (e) {}
  // First run: derive from existing products + deduplicate
  return [...new Set(PRODUCTS.map(p => p.cat).filter(Boolean))].sort();
}
function saveCategories(cats) {
  try { localStorage.setItem("ims_categories", JSON.stringify(cats)); } catch (e) {}
  window._DB_CATEGORIES = cats;
  window.dispatchEvent(new CustomEvent("ims-categories-change"));
  if (window.dbSaveState) dbSaveState("categories", cats).catch(() => {});
}
function addCategory(name) {
  const cats = loadCategories();
  if (!name.trim() || cats.includes(name.trim())) return false;
  saveCategories([...cats, name.trim()]);
  return true;
}
function renameCategory(oldName, newName) {
  if (!newName.trim() || oldName === newName.trim()) return false;
  const cats = loadCategories().map(c => c === oldName ? newName.trim() : c);
  saveCategories(cats);
  // Update all products that use the old category name
  PRODUCTS.forEach(p => { if (p.cat === oldName) p.cat = newName.trim(); });
  saveProductStore();
  return true;
}
function deleteCategory(name, fallback = "ทั่วไป") {
  const cats = loadCategories().filter(c => c !== name);
  // Reassign products in the deleted category to the fallback
  let changed = false;
  PRODUCTS.forEach(p => { if (p.cat === name) { p.cat = fallback; changed = true; } });
  if (changed) saveProductStore();
  if (!cats.includes(fallback)) cats.unshift(fallback);
  saveCategories(cats);
  return true;
}

/* ── Persistent stock deduction helpers ──
   Always mutate PRODUCTS in-place + call saveProductStore() so changes
   go to Supabase. Also clear any matching ims_stock_adj entry so the
   display overlay doesn't double-count. */
function deductStockAndPersist(sku, qty) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return;
  p.qty = Math.max(0, p.qty - qty);
  saveProductStore();
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  if (sku in adj) { delete adj[sku]; if (typeof applyStockAdj === "function") applyStockAdj(adj); }
}
function deductManyAndPersist(deductions) {
  deductions.forEach(({ sku, qty }) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (p) p.qty = Math.max(0, p.qty - qty);
  });
  saveProductStore();
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  let changed = false;
  deductions.forEach(({ sku }) => { if (sku in adj) { delete adj[sku]; changed = true; } });
  if (changed && typeof applyStockAdj === "function") applyStockAdj(adj);
}

/* ── Persistent order store ──
   Mirrors outbound orders to localStorage so badge counts and other
   components can read them without requiring the Outbound screen
   to be mounted. */
function loadOrders() {
  if (window._DB_ORDERS) return window._DB_ORDERS;
  try {
    const raw = localStorage.getItem("ims_orders");
    if (raw !== null) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  return OUTBOUND.map(o => ({ ...o }));
}
function saveOrders(orders) {
  try { localStorage.setItem("ims_orders", JSON.stringify(orders)); } catch (e) {}
  // Detect and delete removed orders from DB
  const prev = window._DB_ORDERS;
  if (prev && window.dbDeleteOrder) {
    const newIds = new Set(orders.map(o => o.id));
    prev.filter(o => !newIds.has(o.id)).forEach(o => dbDeleteOrder(o.id).catch(() => {}));
  }
  window._DB_ORDERS = orders;
  window.dispatchEvent(new CustomEvent("ims-orders-change"));
  if (window.dbUpsertOrders) dbUpsertOrders(orders).catch(() => {});
}

const INBOUND = [];

const OUTBOUND = [];

const TODAY_ISO = new Date().toISOString().slice(0, 10);

const isoToThai = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m-1]} ${y + 543}`;
};

const CARRIERS = [
  { id: "kerry",    name: "KEX",              color: "oklch(0.62 0.2 30)" },
  { id: "flash",    name: "Flash Express",    color: "oklch(0.6 0.18 70)" },
  { id: "jt",       name: "J&T Express",      color: "oklch(0.55 0.15 25)" },
  { id: "thaipost", name: "Thai Post (EMS)",  color: "oklch(0.5 0.18 145)" },
  { id: "ninja",    name: "Ninja Van",        color: "oklch(0.55 0.18 270)" },
  { id: "shopee",   name: "Shopee Express",   color: "oklch(0.6 0.2 30)" },
  { id: "best",     name: "Best Express",     color: "oklch(0.45 0.05 250)" }
];

const ACTIVITY = [];

const LOCATIONS = [
  // 8 cols × 4 rows; some empty, varying fill
  // Zones A B C D E
  // We'll generate a structured map
];
// generate
const _zonePrefix = ["A","A","B","B","C","C","D","E"];
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 8; c++) {
    const zone = _zonePrefix[c];
    const code = `${zone}-${String(r+1).padStart(2,"0")}-${String(c+1).padStart(2,"0")}`;
    // fill bias
    let fill = Math.floor((Math.sin(r*1.7 + c*0.9 + zone.charCodeAt(0)) + 1) * 50);
    if (Math.random() < 0.08) fill = 0;
    if (Math.random() < 0.1) fill = 98;
    LOCATIONS.push({ code, fill, skus: Math.max(0, Math.floor(fill/14)) });
  }
}

/* ── Storage-location store ──
   Editable registry of warehouse bins, persisted to localStorage. Seeded from
   the generated map on first run (migration-free). `skus` is computed live from
   PRODUCTS by the screens; `fill` is an owner-set utilisation %. */
function loadLocations() {
  if (Array.isArray(window._DB_LOCATIONS) && window._DB_LOCATIONS.length) return window._DB_LOCATIONS;
  try {
    const s = localStorage.getItem("ims_locations");
    if (s) { const a = JSON.parse(s); if (Array.isArray(a) && a.length) return a; }
  } catch (e) {}
  return LOCATIONS.map(l => ({ code: l.code, fill: l.fill }));
}
function saveLocations(locs) {
  try { localStorage.setItem("ims_locations", JSON.stringify(locs)); } catch (e) {}
  window._DB_LOCATIONS = locs;
  window.dispatchEvent(new CustomEvent("ims-locations-change"));
  if (window.dbSaveState) dbSaveState("locations", locs).catch(() => {});
}
function addLocation(code, fill) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return false;
  const locs = loadLocations();
  if (locs.some(l => l.code === c)) return false;
  locs.push({ code: c, fill: Math.max(0, Math.min(100, Number(fill) || 0)) });
  locs.sort((a, b) => a.code.localeCompare(b.code));
  saveLocations(locs);
  return true;
}
function updateLocation(code, changes) {
  const locs = loadLocations().map(l => l.code === code ? { ...l, ...changes } : l);
  saveLocations(locs);
}
/* Capability: hard-delete of records is reserved for admin/manager (mirrors the
   Supabase DELETE RLS policy). Locations live in the app_state blob, where a
   delete is persisted by dbSaveState as an UPDATE of the blob — which staff IS
   allowed to do — so the row-level DELETE policy can't stop them. The app must
   gate it instead. */
function canDeleteData() {
  const role = (window.__currentUser && window.__currentUser.role) || "viewer";
  return role === "admin" || role === "manager";
}
function removeLocation(code) {
  // Authoritative guard for every call site (desktop + mobile): a staff/viewer
  // delete would otherwise silently persist through the app_state blob update.
  if (!canDeleteData()) {
    try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: "เฉพาะผู้ดูแลระบบหรือผู้จัดการเท่านั้นที่ลบตำแหน่งได้" })); } catch (e) {}
    return false;
  }
  saveLocations(loadLocations().filter(l => l.code !== code));
  return true;
}
// Live SKU count for a bin = products whose loc matches the code.
function skusInLocation(code) {
  return PRODUCTS.filter(p => (p.loc || "") === code).length;
}

/* Sales channels — used for outbound deduction + per-channel stock tracking */
const CHANNEL_LIST = [
  { id: "shopee", name: "Shopee",        color: "oklch(0.62 0.2 30)",  short: "SP" },
  { id: "lazada", name: "Lazada",        color: "oklch(0.5 0.2 280)",  short: "LZ" },
  { id: "tiktok", name: "TikTok Shop",   color: "oklch(0.35 0.04 220)", short: "TT" },
  { id: "line",   name: "LINE Shopping", color: "oklch(0.6 0.18 145)", short: "LN" },
  { id: "web",    name: "เว็บไซต์",      color: "oklch(0.55 0.13 235)", short: "WB" },
  { id: "other",  name: "ออฟไลน์ / อื่นๆ", color: "oklch(0.55 0.01 80)", short: "OT" }
];

const CHANNELS = [
  { id: "shopee", name: "Shopee",          today: 0, pct: 0 },
  { id: "lazada", name: "Lazada",          today: 0, pct: 0 },
  { id: "tiktok", name: "TikTok Shop",     today: 0, pct: 0 },
  { id: "web",    name: "เว็บไซต์",        today: 0, pct: 0 },
  { id: "line",   name: "LINE Shopping",   today: 0, pct: 0 },
  { id: "other",  name: "ออฟไลน์ / อื่นๆ", today: 0, pct: 0 }
];

/* Per-SKU sales by channel over the last N days — REAL, derived from orders.
   Each order's matching-SKU units are attributed to the order's channel(s):
   via `deductions` (per-channel split) when present, else the order's channel
   name. Returns [{ ...channel, sold }] for every channel (0 when none). */
const channelSalesFor = (sku, days = 30) => {
  const orders = (typeof loadOrders === "function" ? loadOrders() : []) || [];
  let cutoff = "";
  try {
    const today = (typeof bangkokDateStr === "function") ? bangkokDateStr() : new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split("-").map(Number);
    cutoff = new Date(Date.UTC(y, m - 1, d - days + 1)).toISOString().slice(0, 10);
  } catch (e) {}
  const byId = {}; const nameToId = {};
  CHANNEL_LIST.forEach(c => { byId[c.id] = 0; nameToId[c.name] = c.id; });
  for (const o of orders) {
    if (!o || !Array.isArray(o.lineItems) || !o.lineItems.length) continue;
    if (cutoff && o.dateIso && o.dateIso < cutoff) continue;
    const units = o.lineItems.reduce((s, li) => s + (li && li.sku === sku ? (Number(li.qty) || 0) : 0), 0);
    if (!units) continue;
    const ded = Array.isArray(o.deductions) ? o.deductions.filter(d => Number(d.qty) > 0) : [];
    if (ded.length) {
      const tot = ded.reduce((s, d) => s + (Number(d.qty) || 0), 0) || 1;
      ded.forEach(d => {
        const id = Object.prototype.hasOwnProperty.call(byId, d.id) ? d.id : (nameToId[d.name] || "other");
        byId[id] += units * (Number(d.qty) || 0) / tot;
      });
    } else {
      const id = nameToId[(o.channel || "").trim()] || "other";
      byId[id] += units;
    }
  }
  return CHANNEL_LIST.map(c => ({ ...c, sold: Math.round(byId[c.id] || 0) }));
};

const LABEL_SIZES = [
  { id: "100x150", label: "100 × 150 mm", w: 100, h: 150, desc: "มาตรฐานพัสดุ" },
  { id: "100x100", label: "100 × 100 mm", w: 100, h: 100, desc: "ฉลากเล็ก" },
  { id: "75x100",  label: "75 × 100 mm",  w: 75,  h: 100, desc: "เครื่องประดับ / ขนาดเล็ก" },
  { id: "a6",      label: "A6 (105 × 148 mm)", w: 105, h: 148, desc: "กระดาษ A6" }
];

const SAMPLE_LABELS = [];

/* Users loaded from Supabase Auth — this array is populated by UserManagement component */
const USERS = [];

const ROLES = [
  { id: "admin",   label: "ผู้ดูแลระบบ", desc: "เข้าถึงและจัดการทุกฟีเจอร์ รวมถึงผู้ใช้งานและสิทธิ์", color: "oklch(0.55 0.2 25)",  badge: "badge-danger" },
  { id: "manager", label: "ผู้จัดการ",   desc: "ดูและจัดการสต็อก ออร์เดอร์ ฉลาก แต่จัดการผู้ใช้ไม่ได้", color: "oklch(0.5 0.18 252)", badge: "badge-info" },
  { id: "staff",   label: "พนักงานคลัง", desc: "รับเข้า ตัดสต็อก พิมพ์ฉลาก เท่านั้น",          color: "oklch(0.55 0.15 150)", badge: "badge-success" },
  { id: "viewer",  label: "ดูเท่านั้น",   desc: "ดูข้อมูลและรายงานได้ ไม่สามารถแก้ไข",         color: "oklch(0.55 0.01 80)",  badge: "badge-neutral" }
];

const ROLE_NAV = {
  admin:   ["dashboard","inbound","outbound","inventory","stocktake","locations","import","bundles","labels","tracking","analytics","handheld","users","layout","history","settings"],
  manager: ["dashboard","inbound","outbound","inventory","stocktake","locations","import","bundles","labels","tracking","analytics","handheld","history","settings"],
  staff:   ["dashboard","inbound","outbound","inventory","stocktake","locations","bundles","labels","tracking","handheld"],
  viewer:  ["dashboard","inventory","locations","bundles","labels","tracking","analytics"]
};

/* ── Working-hours access window ──
   Admin-configured, per-weekday open/close schedule (stored in store.workHours,
   synced via store_settings). Restricts the configured roles to their allowed
   window so staff can't sign in and key stock at odd hours; admin/manager are
   normally left unrestricted. Enforced client-side (login gate + session poll)
   against SERVER time (see dbServerTimeMs) so a changed device clock can't
   bypass it. Times are evaluated in Asia/Bangkok regardless of device timezone. */
const WORKHOURS_DAY_LABELS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

function defaultWorkHours() {
  const days = {};
  for (let d = 0; d < 7; d++) days[d] = { on: d >= 1 && d <= 6, open: "08:00", close: "18:00" };
  // exceptions: { <userId>: "YYYY-MM-DD" } — a per-user "allow outside hours"
  // pass that is valid only for that Bangkok date, then auto-expires at midnight.
  return { enabled: false, roles: ["staff", "viewer"], days, exceptions: {} };
}

// "YYYY-MM-DD" for an epoch-ms timestamp, in Asia/Bangkok (used for today-only
// exceptions). en-CA formats as YYYY-MM-DD.
function bangkokDateStr(nowMs) {
  const d = new Date(typeof nowMs === "number" ? nowMs : Date.now());
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(d);
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

// The raw exception date stored for a user (or null).
function workHoursExceptionDate(store, userId) {
  const ex = store && store.workHours && store.workHours.exceptions;
  return (ex && userId && ex[userId]) || null;
}

// True when a user currently holds a valid (today) outside-hours pass.
function hasActiveWorkHoursException(store, userId, nowMs) {
  const ex = workHoursExceptionDate(store, userId);
  return !!ex && ex === bangkokDateStr(nowMs);
}

// "HH:MM" → minutes since midnight, or null if malformed.
function hmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? "" : s).trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

// Weekday (0=Sun) + minutes-of-day in Asia/Bangkok for an epoch-ms timestamp.
function bangkokParts(nowMs) {
  const d = new Date(typeof nowMs === "number" ? nowMs : Date.now());
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Bangkok", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const wk = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    let hour = parseInt(map.hour, 10);
    if (hour === 24 || isNaN(hour)) hour = 0;       // some engines emit "24" for midnight
    const min = parseInt(map.minute, 10) || 0;
    const day = wk[map.weekday];
    return { day: day == null ? d.getDay() : day, minutes: hour * 60 + min };
  } catch (e) {
    // Intl unavailable → fall back to device-local time.
    return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

/* Evaluate the schedule for one role at a given moment.
   Returns { restricted, allowed, dayLabel, open, close, closedDay }.
   restricted=false → this role isn't governed (always allowed). */
function workHoursStatus(store, role, nowMs) {
  const wh = store && store.workHours;
  if (!wh || !wh.enabled || !Array.isArray(wh.roles) || !wh.roles.includes(role)) {
    return { restricted: false, allowed: true };
  }
  const { day, minutes } = bangkokParts(nowMs);
  const cfg = wh.days && wh.days[day];           // numeric key coerces to "0".."6" after JSON
  const dayLabel = WORKHOURS_DAY_LABELS[day];
  if (!cfg || !cfg.on) return { restricted: true, allowed: false, dayLabel, closedDay: true };
  const open = hmToMinutes(cfg.open), close = hmToMinutes(cfg.close);
  if (open == null || close == null) return { restricted: true, allowed: true, dayLabel }; // misconfigured → fail open
  const within = close > open
    ? (minutes >= open && minutes < close)
    : (minutes >= open || minutes < close);      // close<=open ⇒ overnight window
  return { restricted: true, allowed: within, dayLabel, open: cfg.open, close: cfg.close };
}

// User-facing Thai reason for an outside-window block.
function workHoursMessage(st) {
  if (!st || st.allowed) return "";
  if (st.closedDay) {
    return `วันนี้ (วัน${st.dayLabel}) เป็นวันหยุด อยู่นอกวันทำการที่กำหนด — ระบบเปิดให้เข้าใช้งานเฉพาะวันและเวลาทำการเท่านั้น หากจำเป็นต้องเข้าใช้งาน กรุณาติดต่อผู้ดูแลระบบ`;
  }
  return `ขณะนี้อยู่นอกเวลาทำการ (วัน${st.dayLabel} เปิดให้ใช้งาน ${st.open}–${st.close} น.) กรุณาเข้าใช้งานในเวลาทำการ หากจำเป็น กรุณาติดต่อผู้ดูแลระบบ`;
}

/* Schedule status for a SPECIFIC user — the role-based window with that user's
   today-only exception applied. When blocked but a valid exception exists, the
   user is allowed and the result is flagged { exception:true }. Used by the
   login/session gate and by the User Management screen's status column. */
function workHoursStatusForUser(store, role, userId, nowMs) {
  const base = workHoursStatus(store, role, nowMs);
  if (!base.restricted || base.allowed) return base;
  if (hasActiveWorkHoursException(store, userId, nowMs)) {
    return { ...base, allowed: true, exception: true };
  }
  return base;
}

/* ---------- Scan feedback sound (Web Audio, no asset / offline) ----------
   Shared lazily-created AudioContext (one per page), reused for every beep.
   Guarded everywhere so audio failure can never break the scan flow.
   Mute via localStorage "ims_scan_sound" = "off" (defaults on) — ready for a
   future Settings toggle without touching the scan call sites. */
let __scanAudioCtx = null;
let __lastBeepAt = 0;
function __getAudioCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!__scanAudioCtx) __scanAudioCtx = new AC();
  if (__scanAudioCtx.state === "suspended") { try { __scanAudioCtx.resume(); } catch (e) {} }
  return __scanAudioCtx;
}
function __beep({ freq = 880, dur = 0.1, type = "square", gain = 0.06 } = {}) {
  try {
    if (localStorage.getItem("ims_scan_sound") === "off") return;
    const now = Date.now();
    if (now - __lastBeepAt < 100) return;   // throttle rapid repeats
    __lastBeepAt = now;
    const ctx = __getAudioCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    // short attack + decay envelope so it sounds like a clean "beep", no click
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (e) { /* never let sound break scanning */ }
}
/* Success: single bright high beep */
function playScanBeep() { __beep({ freq: 880, dur: 0.1 }); }
/* Not-found / error: lower double tone (distinct from success) */
function playScanErrorBeep() {
  __beep({ freq: 300, dur: 0.12, type: "sawtooth", gain: 0.07 });
  setTimeout(() => { __lastBeepAt = 0; __beep({ freq: 250, dur: 0.14, type: "sawtooth", gain: 0.07 }); }, 130);
}

/* Collision-resistant order id (timestamp base36 + random suffix, de-duped
   against stored orders). True multi-user guarantees still need the server,
   but this removes the realistic Math.random() clash window the old
   8-digit scheme had when several people sell at once. */
function genOrderId() {
  let existing = new Set();
  try { existing = new Set((typeof loadOrders === "function" ? loadOrders() : []).map(o => o.id)); } catch (e) {}
  let id, attempts = 0;
  do {
    const t = Date.now().toString(36).toUpperCase();
    const r = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, "0");
    id = "SO-" + t + r;
    if (++attempts > 20) break; // safety: never spin forever
  } while (existing.has(id));
  return id;
}

// Snapshot a sold line item with the product's price/cost AT SALE TIME, so
// revenue analytics stay accurate even if the catalog price changes later or
// the SKU is removed. Shape stays backward-compatible: {sku,name,qty} + price,cost.
function snapLineItem(sku, name, qty) {
  const p = PRODUCTS.find(x => x.sku === sku);
  const price = p ? (Number(p.price) || 0) : 0;
  const cost  = p ? (p.cost ?? Math.round(price * 0.6)) : 0;
  return { sku, name: name || (p ? p.name : sku), qty, price, cost };
}

/* ── Stock take / cycle count ───────────────────────────────────────────
   The in-progress count ({sku: countedQty}) is kept in localStorage so it
   survives a refresh and is shared between the desktop and mobile screens
   (same browser). Applying it reconciles each SKU's qty to the counted value. */
const STOCKTAKE_KEY = "ims_stocktake_v1";
function loadStockTake() {
  try { const o = JSON.parse(localStorage.getItem(STOCKTAKE_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch (e) { return {}; }
}
function saveStockTake(counts) {
  try { localStorage.setItem(STOCKTAKE_KEY, JSON.stringify(counts || {})); } catch (e) {}
}
// Reconcile system stock to the physical count. counts = { sku: countedQty }.
// Returns the list of actual changes [{ sku, name, from, to, delta }] and
// persists once (localStorage + Supabase) via saveProductStore().
function applyStockCounts(counts) {
  if (!counts) return [];
  const changes = [];
  Object.keys(counts).forEach(sku => {
    const raw = counts[sku];
    if (raw === "" || raw == null) return;          // not counted → skip
    const p = PRODUCTS.find(x => x.sku === sku);
    if (!p) return;
    const to = Math.max(0, Math.round(Number(raw) || 0));
    if (to === p.qty) return;                        // no change
    changes.push({ sku, name: p.name, from: p.qty, to, delta: to - p.qty });
    p.qty = to;
  });
  if (changes.length) saveProductStore();
  return changes;
}

Object.assign(window, {
  playScanBeep, playScanErrorBeep, genOrderId, snapLineItem,
  loadStockTake, saveStockTake, applyStockCounts,
  PRODUCTS, stockStatus, INBOUND, OUTBOUND, ACTIVITY, LOCATIONS, CHANNELS, CHANNEL_LIST, channelSalesFor, LABEL_SIZES, SAMPLE_LABELS,
  USERS, ROLES, ROLE_NAV, CARRIERS, TODAY_ISO, isoToThai,
  saveProductStore, addProductToStore, updateProductInStore, updateManyProducts, removeProductsFromStore, resetProductStore,
  deductStockAndPersist, deductManyAndPersist,
  loadOrders, saveOrders,
  loadLocations, saveLocations, addLocation, updateLocation, removeLocation, skusInLocation, canDeleteData,
  defaultWorkHours, workHoursStatus, workHoursMessage, hmToMinutes, bangkokParts, WORKHOURS_DAY_LABELS,
  bangkokDateStr, workHoursExceptionDate, hasActiveWorkHoursException, workHoursStatusForUser
});
