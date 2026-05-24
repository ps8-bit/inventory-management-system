/* Mock data for the IMS */

const PRODUCTS = [
  { sku: "TH-APP-001", name: "เสื้อยืดคอกลม Cotton 100% สีขาว", cat: "เสื้อผ้า", cost: 165, price: 290, qty: 248, reserved: 18, reorder: 50, loc: "A-02-03", supplier: "บางกอกแฟชั่น" },
  { sku: "TH-APP-002", name: "เสื้อยืดคอกลม Cotton 100% สีดำ", cat: "เสื้อผ้า", cost: 165, price: 290, qty: 12,  reserved: 4,  reorder: 50, loc: "A-02-04", supplier: "บางกอกแฟชั่น" },
  { sku: "TH-ELE-118", name: "หูฟังบลูทูธ ANC รุ่น Air Pro 2", cat: "อิเล็กทรอนิกส์", cost: 990, price: 1890, qty: 86, reserved: 8, reorder: 30, loc: "B-01-12", supplier: "Tech Wave Co." },
  { sku: "TH-ELE-119", name: "สายชาร์จ USB-C 65W 1.2 เมตร", cat: "อิเล็กทรอนิกส์", cost: 220, price: 390, qty: 0, reserved: 0, reorder: 100, loc: "B-01-08", supplier: "Tech Wave Co." },
  { sku: "TH-HOM-220", name: "หมอนรองคอ Memory Foam สีเทา", cat: "ของใช้ในบ้าน", cost: 320, price: 590, qty: 145, reserved: 22, reorder: 40, loc: "C-03-02", supplier: "Comfort Living" },
  { sku: "TH-HOM-221", name: "ผ้าห่มขนแกะ Microfiber 180×220", cat: "ของใช้ในบ้าน", cost: 480, price: 890, qty: 67, reserved: 5, reorder: 25, loc: "C-03-05", supplier: "Comfort Living" },
  { sku: "TH-BTY-310", name: "เซรั่ม Vitamin C 30ml", cat: "ความงาม", cost: 340, price: 690, qty: 32, reserved: 12, reorder: 40, loc: "D-01-01", supplier: "Glow Lab" },
  { sku: "TH-BTY-311", name: "ครีมกันแดด SPF50 PA++++ 50ml", cat: "ความงาม", cost: 290, price: 590, qty: 198, reserved: 14, reorder: 50, loc: "D-01-04", supplier: "Glow Lab" },
  { sku: "TH-FOD-405", name: "กาแฟดริปอาราบิก้า 250g (ห่อ)", cat: "อาหารและเครื่องดื่ม", cost: 160, price: 290, qty: 412, reserved: 32, reorder: 80, loc: "E-02-07", supplier: "Doi Coffee" },
  { sku: "TH-FOD-406", name: "ชาเขียวมัทฉะออร์แกนิก 100g", cat: "อาหารและเครื่องดื่ม", cost: 250, price: 450, qty: 21, reserved: 6, reorder: 30, loc: "E-02-09", supplier: "Doi Coffee" },
  { sku: "TH-ACC-512", name: "กระเป๋าสะพายข้าง Canvas สีกากี", cat: "เครื่องประดับ", cost: 440, price: 790, qty: 54, reserved: 9, reorder: 20, loc: "A-04-01", supplier: "Urban Goods" },
  { sku: "TH-ACC-513", name: "หมวกแก๊ปแฟชั่น Unisex สีเบจ", cat: "เครื่องประดับ", cost: 210, price: 390, qty: 128, reserved: 12, reorder: 40, loc: "A-04-06", supplier: "Urban Goods" }
];

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
  if (window.dbUpsertProducts) dbUpsertProducts([...PRODUCTS]).catch(() => {});
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
function removeProductsFromStore(skus) {
  const set = new Set(Array.isArray(skus) ? skus : [skus]);
  for (let i = PRODUCTS.length - 1; i >= 0; i--) {
    if (set.has(PRODUCTS[i].sku)) PRODUCTS.splice(i, 1);
  }
  saveProductStore();
  if (window.dbDeleteProducts) dbDeleteProducts([...set]).catch(() => {});
}
function resetProductStore() {
  try { localStorage.removeItem("ims_products"); } catch (e) {}
  window.location.reload();
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
  try {
    const adj = JSON.parse(localStorage.getItem("ims_stock_adj") || "{}");
    if (sku in adj) { delete adj[sku]; localStorage.setItem("ims_stock_adj", JSON.stringify(adj)); }
  } catch (e) {}
}
function deductManyAndPersist(deductions) {
  deductions.forEach(({ sku, qty }) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (p) p.qty = Math.max(0, p.qty - qty);
  });
  saveProductStore();
  try {
    const adj = JSON.parse(localStorage.getItem("ims_stock_adj") || "{}");
    let changed = false;
    deductions.forEach(({ sku }) => { if (sku in adj) { delete adj[sku]; changed = true; } });
    if (changed) localStorage.setItem("ims_stock_adj", JSON.stringify(adj));
  } catch (e) {}
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

const INBOUND = [
  { id: "GR-26051901", po: "PO-2025-0488", supplier: "บางกอกแฟชั่น", items: 6, qty: 320, status: "received", ts: "09:24" },
  { id: "GR-26051902", po: "PO-2025-0489", supplier: "Tech Wave Co.", items: 3, qty: 80, status: "in-progress", ts: "10:55" },
  { id: "GR-26051903", po: "PO-2025-0490", supplier: "Doi Coffee", items: 4, qty: 240, status: "scheduled", ts: "14:00" },
  { id: "GR-26051904", po: "PO-2025-0491", supplier: "Glow Lab", items: 8, qty: 410, status: "scheduled", ts: "15:30" }
];

const OUTBOUND = [
  { id: "SO-26051921", channel: "Shopee",  customer: "คุณ ปิยะนุช สวัสดิ์ชาติ", phone: "081-552-0917", items: 2, status: "packed",    carrier: "Kerry",     tracking: "TH8842919012", ts: "11:02", date: "19 พ.ค. 2569", dateIso: "2026-05-19" },
  { id: "SO-26051922", channel: "Lazada",  customer: "คุณ ธนวัฒน์ กิตติพันธ์", phone: "094-228-1170", items: 1, status: "picking",   carrier: "Flash",     tracking: "",            ts: "11:18", date: "19 พ.ค. 2569", dateIso: "2026-05-19" },
  { id: "SO-26051923", channel: "TikTok",  customer: "คุณ ศิริพร มงคลชัย",     phone: "086-771-1129", items: 4, status: "shipped",   carrier: "Thai Post", tracking: "EX554210099TH", ts: "09:44", date: "19 พ.ค. 2569", dateIso: "2026-05-19" },
  { id: "SO-26051924", channel: "Shopee",  customer: "คุณ ณัฐภัทร วงศ์ดี",     phone: "092-808-4421", items: 1, status: "picking",   carrier: "J&T",       tracking: "",            ts: "11:42", date: "19 พ.ค. 2569", dateIso: "2026-05-19" },
  { id: "SO-26051925", channel: "เว็บไซต์", customer: "คุณ ปวีณา ทองสุข",       phone: "089-114-2208", items: 3, status: "packed",    carrier: "Kerry",     tracking: "TH8842919013", ts: "11:50", date: "19 พ.ค. 2569", dateIso: "2026-05-19" },
  { id: "SO-26051926", channel: "TikTok",  customer: "คุณ อรรถพล จันทร์เพ็ญ",  phone: "065-902-3344", items: 2, status: "shipped",   carrier: "Flash",     tracking: "FX99214470TH", ts: "08:30", date: "19 พ.ค. 2569", dateIso: "2026-05-19" },
  { id: "SO-26051820", channel: "Shopee",  customer: "คุณ ภัทรพล สวัสดิ์",      phone: "088-330-7712", items: 2, status: "delivered", carrier: "Kerry",     tracking: "TH8842918845", ts: "16:12", date: "18 พ.ค. 2569", dateIso: "2026-05-18" },
  { id: "SO-26051815", channel: "Lazada",  customer: "คุณ พรนภา ใจดี",          phone: "061-449-2210", items: 1, status: "delivered", carrier: "Flash",     tracking: "FX99214412TH", ts: "14:55", date: "18 พ.ค. 2569", dateIso: "2026-05-18" },
  { id: "SO-26051611", channel: "TikTok",  customer: "คุณ ปิยะวัฒน์ ก.",        phone: "095-118-2240", items: 4, status: "delivered", carrier: "Thai Post", tracking: "EX554208816TH", ts: "11:32", date: "16 พ.ค. 2569", dateIso: "2026-05-16" }
];

const TODAY_ISO = new Date().toISOString().slice(0, 10);

const isoToThai = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m-1]} ${y + 543}`;
};

const CARRIERS = [
  { id: "kerry",    name: "Kerry Express",    color: "oklch(0.62 0.2 30)" },
  { id: "flash",    name: "Flash Express",    color: "oklch(0.6 0.18 70)" },
  { id: "jt",       name: "J&T Express",      color: "oklch(0.55 0.15 25)" },
  { id: "thaipost", name: "Thai Post (EMS)",  color: "oklch(0.5 0.18 145)" },
  { id: "ninja",    name: "Ninja Van",        color: "oklch(0.55 0.18 270)" },
  { id: "shopee",   name: "Shopee Express",   color: "oklch(0.6 0.2 30)" },
  { id: "best",     name: "Best Express",     color: "oklch(0.45 0.05 250)" }
];

const ACTIVITY = [
  { t: "11:50", type: "out",  text: "หยิบสินค้า SO-26051925 — 3 รายการ", who: "ภาณุพงศ์" },
  { t: "11:42", type: "out",  text: "สร้างใบจัดส่ง SO-26051924", who: "ระบบ" },
  { t: "11:18", type: "out",  text: "เริ่มหยิบสินค้า SO-26051922", who: "วรรณา" },
  { t: "11:02", type: "out",  text: "แพ็คสินค้าเสร็จ SO-26051921 — Kerry TH8842919012", who: "ภาณุพงศ์" },
  { t: "10:55", type: "in",   text: "รับเข้า GR-26051902 — Tech Wave Co. (กำลังตรวจนับ)", who: "สมชาย" },
  { t: "10:14", type: "move", text: "ย้ายสต็อก B-01-08 → B-01-12 (40 ชิ้น)", who: "สมชาย" },
  { t: "09:44", type: "out",  text: "ส่งมอบให้ไปรษณีย์ไทย — SO-26051923", who: "ระบบ" },
  { t: "09:24", type: "in",   text: "รับเข้า GR-26051901 — 320 ชิ้น เข้าโซน A", who: "สมชาย" }
];

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
  { id: "shopee", name: "Shopee",       today: 124, pct: 42 },
  { id: "lazada", name: "Lazada",       today: 78,  pct: 26 },
  { id: "tiktok", name: "TikTok Shop",  today: 61,  pct: 21 },
  { id: "web",    name: "เว็บไซต์",     today: 22,  pct: 7 },
  { id: "line",   name: "LINE Shopping", today: 10, pct: 3 },
  { id: "other",  name: "ออฟไลน์ / อื่นๆ", today: 0, pct: 1 }
];

/* Deterministic per-SKU channel breakdown */
const channelStockFor = (sku) => {
  let seed = 0; for (const c of sku) seed = (seed * 131 + c.charCodeAt(0)) >>> 0;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
  return CHANNEL_LIST.map(c => ({
    ...c,
    sold30d: Math.floor(rng() * 80),
    reserved: Math.floor(rng() * 6)
  }));
};

const LABEL_SIZES = [
  { id: "100x150", label: "100 × 150 mm", w: 100, h: 150, desc: "มาตรฐานพัสดุ" },
  { id: "100x100", label: "100 × 100 mm", w: 100, h: 100, desc: "ฉลากเล็ก" },
  { id: "75x100",  label: "75 × 100 mm",  w: 75,  h: 100, desc: "เครื่องประดับ / ขนาดเล็ก" },
  { id: "a6",      label: "A6 (105 × 148 mm)", w: 105, h: 148, desc: "กระดาษ A6" }
];

const SAMPLE_LABELS = [
  {
    id: "L1", soId: "SO-26051921",
    sender: { name: "คลังสินค้า BangkokFulfill", addr1: "199/4 ถ.พระราม 9 แขวงห้วยขวาง", addr2: "เขตห้วยขวาง กรุงเทพฯ 10310", phone: "02-555-0188" },
    recipient: { name: "คุณ ปิยะนุช สวัสดิ์ชาติ", addr1: "88/12 ซ.รามคำแหง 24", addr2: "แขวงหัวหมาก เขตบางกะปิ กรุงเทพฯ 10240", phone: "081-552-0917" },
    carrier: "Kerry Express", tracking: "TH8842919012", cod: 0, weight: "0.6 kg",
    items: [
      { sku: "TH-APP-001", name: "เสื้อยืดคอกลม Cotton 100% สีขาว — Size M", qty: 1 },
      { sku: "TH-APP-002", name: "เสื้อยืดคอกลม Cotton 100% สีดำ — Size L", qty: 1 }
    ]
  },
  {
    id: "L2", soId: "SO-26051925",
    sender: { name: "คลังสินค้า BangkokFulfill", addr1: "199/4 ถ.พระราม 9 แขวงห้วยขวาง", addr2: "เขตห้วยขวาง กรุงเทพฯ 10310", phone: "02-555-0188" },
    recipient: { name: "คุณ ปวีณา ทองสุข", addr1: "45 หมู่ 3 ต.บางพระ อ.ศรีราชา", addr2: "จ.ชลบุรี 20110", phone: "089-114-2208" },
    carrier: "Kerry Express", tracking: "TH8842919013", cod: 1280, weight: "1.4 kg",
    items: [
      { sku: "TH-HOM-220", name: "หมอนรองคอ Memory Foam สีเทา", qty: 2 },
      { sku: "TH-BTY-311", name: "ครีมกันแดด SPF50 PA++++ 50ml", qty: 1 }
    ]
  },
  {
    id: "L3", soId: "SO-26051926",
    sender: { name: "คลังสินค้า BangkokFulfill", addr1: "199/4 ถ.พระราม 9 แขวงห้วยขวาง", addr2: "เขตห้วยขวาง กรุงเทพฯ 10310", phone: "02-555-0188" },
    recipient: { name: "คุณ อรรถพล จันทร์เพ็ญ", addr1: "120/8 ถ.นิมมานเหมินทร์ ซ.7", addr2: "ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200", phone: "065-902-3344" },
    carrier: "Flash Express", tracking: "FX99214470TH", cod: 0, weight: "0.9 kg",
    items: [
      { sku: "TH-ELE-118", name: "หูฟังบลูทูธ ANC รุ่น Air Pro 2 — สีดำ", qty: 1 },
      { sku: "TH-FOD-405", name: "กาแฟดริปอาราบิก้า 250g (ห่อ)", qty: 1 }
    ]
  },
  {
    id: "L4", soId: "SO-26051923",
    sender: { name: "คลังสินค้า BangkokFulfill", addr1: "199/4 ถ.พระราม 9 แขวงห้วยขวาง", addr2: "เขตห้วยขวาง กรุงเทพฯ 10310", phone: "02-555-0188" },
    recipient: { name: "คุณ ศิริพร มงคลชัย", addr1: "78 ม.4 ต.บางบ่อ อ.บางบ่อ", addr2: "จ.สมุทรปราการ 10560", phone: "086-771-1129" },
    carrier: "Thai Post EMS", tracking: "EX554210099TH", cod: 0, weight: "0.4 kg",
    items: [
      { sku: "TH-ACC-513", name: "หมวกแก๊ปแฟชั่น Unisex สีเบจ", qty: 2 },
      { sku: "TH-BTY-310", name: "เซรั่ม Vitamin C 30ml", qty: 1 },
      { sku: "TH-ACC-512", name: "กระเป๋าสะพายข้าง Canvas สีกากี", qty: 1 }
    ]
  }
];

/* Users & roles for auth */
const USERS = [
  { id: 1, name: "สมชาย ภูมิดี",      email: "somchai@bangkokfulfill.co",   role: "admin",   active: true,  lastSeen: "เมื่อ 2 นาที",    avatar: "สม", joined: "15 ม.ค. 2566" },
  { id: 2, name: "ภาณุพงศ์ จันทร์ดี",  email: "panupong@bangkokfulfill.co",  role: "manager", active: true,  lastSeen: "เมื่อ 18 นาที",   avatar: "ภณ", joined: "02 มี.ค. 2566" },
  { id: 3, name: "วรรณา รัตนะ",       email: "wanna@bangkokfulfill.co",    role: "staff",   active: true,  lastSeen: "วันนี้ 11:18",      avatar: "วร", joined: "20 มิ.ย. 2566" },
  { id: 4, name: "ปวีณา ทองสุข",      email: "paveena@bangkokfulfill.co",  role: "staff",   active: true,  lastSeen: "เมื่อวาน",          avatar: "ปว", joined: "14 ก.ย. 2566" },
  { id: 5, name: "ณัฐภัทร วงศ์ดี",    email: "natthapat@bangkokfulfill.co", role: "viewer",  active: false, lastSeen: "1 สัปดาห์ก่อน",    avatar: "นภ", joined: "08 ม.ค. 2567" }
];

const ROLES = [
  { id: "admin",   label: "ผู้ดูแลระบบ", desc: "เข้าถึงและจัดการทุกฟีเจอร์ รวมถึงผู้ใช้งานและสิทธิ์", color: "oklch(0.55 0.2 25)",  badge: "badge-danger" },
  { id: "manager", label: "ผู้จัดการ",   desc: "ดูและจัดการสต็อก ออร์เดอร์ ฉลาก แต่จัดการผู้ใช้ไม่ได้", color: "oklch(0.5 0.18 252)", badge: "badge-info" },
  { id: "staff",   label: "พนักงานคลัง", desc: "รับเข้า ตัดสต็อก พิมพ์ฉลาก เท่านั้น",          color: "oklch(0.55 0.15 150)", badge: "badge-success" },
  { id: "viewer",  label: "ดูเท่านั้น",   desc: "ดูข้อมูลและรายงานได้ ไม่สามารถแก้ไข",         color: "oklch(0.55 0.01 80)",  badge: "badge-neutral" }
];

const ROLE_NAV = {
  admin:   ["dashboard","inbound","outbound","inventory","locations","import","bundles","labels","tracking","analytics","handheld","users","layout","history","settings"],
  manager: ["dashboard","inbound","outbound","inventory","locations","import","bundles","labels","tracking","analytics","handheld","history","settings"],
  staff:   ["dashboard","inbound","outbound","inventory","locations","bundles","labels","tracking","handheld"],
  viewer:  ["dashboard","inventory","locations","bundles","labels","tracking","analytics"]
};

Object.assign(window, {
  PRODUCTS, stockStatus, INBOUND, OUTBOUND, ACTIVITY, LOCATIONS, CHANNELS, CHANNEL_LIST, channelStockFor, LABEL_SIZES, SAMPLE_LABELS,
  USERS, ROLES, ROLE_NAV, CARRIERS, TODAY_ISO, isoToThai,
  saveProductStore, addProductToStore, updateProductInStore, updateManyProducts, removeProductsFromStore, resetProductStore,
  deductStockAndPersist, deductManyAndPersist,
  loadOrders, saveOrders
});
