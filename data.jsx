/* Product catalog — populated from Supabase on login, falls back to localStorage */

/* Capture the initial URL (hash + query) the instant this first app script runs —
   BEFORE supabase.jsx (loaded next) calls createClient, which asynchronously
   consumes a recovery/invite token and STRIPS it from the URL. In-browser Babel
   makes the later scripts (incl. app.jsx) mount React long AFTER that strip, so
   reading window.location at mount can miss "type=recovery" and wrongly drop the
   user into the app instead of the set-new-password screen. */
if (typeof window !== "undefined" && !window.__IMS_INIT) {
  window.__IMS_INIT = { hash: window.location.hash || "", search: window.location.search || "" };
}

const PRODUCTS = [];

/* ── omit(obj, ...keys) — ALWAYS use this instead of `const {a, ...rest} = obj` ──
   Object-rest destructuring is unsafe in this project. Babel-standalone compiles
   it to a top-level `var _excluded = ["a"]` and every .jsx file runs as a classic
   script in ONE global scope, so the LAST-loaded file's `_excluded` silently
   overwrites every earlier file's — and the rest-object then keeps keys it was
   supposed to drop. It fails quietly, at runtime, in whichever file loads first.
   Verified 2026-07-26 (qty leaking through updateManyProducts / importProductsBulk). */
function omit(obj, ...keys) {
  const out = {};
  Object.keys(obj || {}).forEach(k => { if (keys.indexOf(k) === -1) out[k] = obj[k]; });
  return out;
}

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

// Shared handler for a product write result (scoped or full). On an RLS block we
// can't persist the edit, so reload canonical server state so the UI stops showing
// a change that didn't save; other errors just toast (the local copy is retained).
function _onProductWriteResult(res) {
  if (!res || !res.error) return;
  const perm = res.error === 'PERMISSION_OR_MISSING';
  window.dispatchEvent(new CustomEvent('ims-toast', {
    detail: perm ? 'บันทึกไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์แก้ไขสินค้า'
                 : 'บันทึกสินค้าไม่สำเร็จ: ' + res.error
  }));
  if (perm && window.dbLoadProducts) {
    dbLoadProducts().then(fresh => {
      if (!fresh) return;
      PRODUCTS.length = 0; fresh.forEach(p => PRODUCTS.push(p));
      _persistProductsLocal();
    }).catch(() => {});
  }
}
// FULL-catalog upsert. Kept ONLY as a legacy fallback (when the scoped/atomic DB
// helpers below aren't loaded) and for CSV import. Every normal edit path now
// writes just the rows/columns it changed, so one device's edit can't clobber
// another device's stock on unrelated skus. Do NOT reintroduce into per-edit paths.
function saveProductStore() {
  _persistProductsLocal();
  if (!window.dbUpsertProducts) return;
  dbUpsertProducts([...PRODUCTS]).then(_onProductWriteResult).catch(() => {});
}
// Persist a SUBSET of product rows (absolute values) — used where SETTING qty is
// the intent: a new product, a stock-take count. Never touches unrelated skus.
function _syncProductRows(skus) {
  _persistProductsLocal();
  if (!window.dbUpsertProducts) return;
  const set = new Set(Array.isArray(skus) ? skus : [skus]);
  const rows = PRODUCTS.filter(p => set.has(p.sku));
  if (!rows.length) return;
  dbUpsertProducts(rows).then(_onProductWriteResult).catch(() => {});
}
// Persist ONLY the changed non-qty columns of one product (a field edit) — never
// rewrites qty, so a concurrent sale of the SAME sku isn't clobbered.
function _syncProductFields(sku, fields) {
  if (typeof dbUpdateProduct !== "function") { saveProductStore(); return; } // legacy fallback
  dbUpdateProduct(sku, fields).then(res => {
    // 0 rows can mean a real RLS block OR a row not inserted yet (a field edit
    // racing a brand-new product's insert — an UPDATE matches nothing). Retry as a
    // full-row upsert: it inserts-or-updates (resolving the race) and still surfaces
    // a genuine permission block via its own result.
    if (res && res.error === "PERMISSION_OR_MISSING") { _syncProductRows([sku]); return; }
    _onProductWriteResult(res);
  }).catch(() => _productWriteToast()); // network throw — don't fail silently (offline field edits aren't queued yet; see #09)
}
function _productWriteToast() {
  window.dispatchEvent(new CustomEvent('ims-toast', { detail: 'บันทึกไม่สำเร็จ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่' }));
}
// Persist ONE field (same value) across many skus — category rename, location
// re-point. Scoped column UPDATE, never qty, never the whole catalog.
function _syncManyFields(skus, fields) {
  const arr = Array.isArray(skus) ? skus : [...skus];
  if (!arr.length) return;
  _persistProductsLocal();
  if (typeof dbUpdateProducts === "function") dbUpdateProducts(arr, fields).then(_onProductWriteResult).catch(() => _productWriteToast());
  else saveProductStore();
}
// Persist a qty CHANGE as an atomic server-side delta (concurrent-safe). Falls
// back to a scoped absolute row write if adjust_stock isn't deployed, and to the
// offline queue on network failure.
async function _syncQtyDelta(sku, delta) {
  if (!delta) return;
  if (typeof dbAdjustStock !== "function") { _syncProductRows([sku]); return; }
  if (!navigator.onLine) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("adjust", [{ sku, delta }]);
    return;
  }
  try {
    const res = await dbAdjustStock([{ sku, delta }]);
    if (res && res.ok) { _applyServerQty(res.rows); return; }
    if (res && res.error === "RPC_MISSING") { _syncProductRows([sku]); return; }
    if (res && res.error === "PERMISSION_OR_MISSING") { _applyServerQty(res.rows); _onProductWriteResult(res); return; }
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("adjust", [{ sku, delta }]);
  } catch (e) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("adjust", [{ sku, delta }]);
  }
}
function addProductToStore(p) {
  // A blank sku is an unmanageable row: sku is the PK, and the delete/update
  // APIs can't address an empty key (PostgREST in.() drops it from the filter).
  // Refuse creation instead of writing a row nobody can edit or remove.
  const sku = String((p && p.sku) || "").trim();
  if (!sku) {
    try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: "เพิ่มสินค้าไม่สำเร็จ: ต้องมีรหัส SKU" })); } catch (e) {}
    return false;
  }
  const np = { reserved: 0, ...p, sku };
  PRODUCTS.unshift(np);
  _syncProductRows([np.sku]); // single-row upsert (insert) — not the whole catalog
  return true;
}
// Field edit. A qty here is an ABSOLUTE set (edit modals normally omit qty and
// change stock via adjustProductQty). A pure field edit updates only its columns
// (never qty), so it can't clobber a concurrent sale of the same sku; an edit that
// does carry qty falls back to one scoped whole-row write (never a delta, never
// the whole catalog).
function updateProductInStore(sku, changes) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return;
  Object.assign(p, changes);
  _persistProductsLocal();
  if ('qty' in changes) _syncProductRows([sku]);
  else _syncProductFields(sku, changes);
}
// Apply a RELATIVE stock change (inbound receive, manual adjust) as an atomic
// server-side delta. Callers pass the RAW delta — no absolute round-trip for the
// client to reverse-engineer, so a pending display overlay (ims_stock_adj) or a
// stale local qty can't corrupt the amount applied to the server.
function adjustProductQty(sku, delta) {
  const d = Number(delta) || 0;
  if (!d) return;
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return;
  p.qty = Math.max(0, (Number(p.qty) || 0) + d);
  _persistProductsLocal();
  _syncQtyDelta(sku, d);
}
// Overwrite a product with ABSOLUTE values (import of an existing sku) — scoped
// single-row write, correct "these values ARE the truth" semantic. Distinct from
// adjustProductQty (relative) and from a whole-catalog upsert.
function setProductAbsolute(sku, changes) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return;
  Object.assign(p, changes);
  _syncProductRows([sku]);
}
function updateManyProducts(skus, changes) {
  const set = new Set(skus);
  const affected = [];
  PRODUCTS.forEach(p => { if (set.has(p.sku)) { Object.assign(p, changes); affected.push(p.sku); } });
  if (!affected.length) return;
  _persistProductsLocal();
  const fields = omit(changes, "qty");
  if (Object.keys(fields).length) _syncManyFields(affected, fields);
  // A bulk qty set (rare) is absolute → scoped row writes, not a per-sku delta.
  if ('qty' in changes) _syncProductRows(affected);
}
/* ── Bulk product import (CSV / Excel) ──
   Applies MANY rows in one pass: mutate PRODUCTS locally, then persist only the
   touched skus with a chunked, SCOPED upsert. Deliberately NOT saveProductStore()
   (which rewrites the whole catalog and can clobber another device's stock on
   unrelated skus) and NOT one request per row (a 500-row file would fire 500).

   Each item: { sku, values, mode }
     "add"     — create a new product (values absolute, reserved starts at 0)
     "set"     — existing sku, overwrite everything INCLUDING qty (file is truth)
     "keepQty" — existing sku, overwrite every field EXCEPT qty/reserved
     "addQty"  — existing sku, overwrite fields and ADD values.qty to current stock
     "skip"    — ignored entirely
   A "set"/"keepQty"/"addQty" item whose sku doesn't exist is created instead, and
   an "add" whose sku DOES exist is treated as "keepQty" — the caller classified
   against a snapshot, so a row can't silently vanish if the catalog moved under it.

   Note on qty: every mode persists via a full-row upsert, so even "keepQty" writes
   the qty this device currently holds. That's the same "spreadsheet is truth"
   semantic as a stock-take — do not call this from an incremental edit path.

   onProgress(done, total) is called per chunk. Async: resolves after the DB write
   settles, with { added, updated, skipped, skus, error? }. */
async function importProductsBulk(items, onProgress) {
  const list = Array.isArray(items) ? items : [];
  const touched = [];
  let added = 0, updated = 0, skipped = 0;

  list.forEach(it => {
    const sku = String((it && it.sku) || "").trim();
    if (!sku || !it || it.mode === "skip") { skipped++; return; }
    const v = it.values || {};
    const rawQty = v.qty;
    const fields = omit(v, "qty", "reserved");   // stock is applied per-mode below
    const cur = PRODUCTS.find(p => p.sku === sku);

    if (!cur) {
      PRODUCTS.unshift({ reserved: 0, ...fields, sku, qty: Math.max(0, Number(rawQty) || 0) });
      added++; touched.push(sku);
      return;
    }
    Object.assign(cur, fields);
    if (it.mode === "set")          cur.qty = Math.max(0, Number(rawQty) || 0);
    else if (it.mode === "addQty")  cur.qty = Math.max(0, (Number(cur.qty) || 0) + (Number(rawQty) || 0));
    // "add" on an existing sku and "keepQty" both leave cur.qty untouched.
    updated++; touched.push(sku);
  });

  if (!touched.length) { if (onProgress) onProgress(0, 0); return { added: 0, updated: 0, skipped, skus: [] }; }

  _persistProductsLocal();
  if (!window.dbUpsertProducts) return { added, updated, skipped, skus: touched, offline: true };

  const set = new Set(touched);
  const rows = PRODUCTS.filter(p => set.has(p.sku));
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    let res;
    try { res = await dbUpsertProducts(rows.slice(i, i + CHUNK)); }
    catch (e) { _productWriteToast(); return { added, updated, skipped, skus: touched, error: (e && e.message) || String(e) }; }
    if (res && res.error) { _onProductWriteResult(res); return { added, updated, skipped, skus: touched, error: res.error }; }
    if (onProgress) onProgress(Math.min(i + CHUNK, rows.length), rows.length);
  }
  return { added, updated, skipped, skus: touched };
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
  let res = await dbDeleteProducts([...set]);
  if (res && res.error === 'PERMISSION_OR_MISSING' && window.authRefresh) {
    // An RLS block can be a phantom: a role granted in app_metadata reaches RLS
    // only through a NEW access token, so a session minted before the grant keeps
    // failing after the account is already correct. Refresh once and retry before
    // concluding the account truly lacks the right.
    try {
      const { data } = await authRefresh();
      if (data && data.session) res = await dbDeleteProducts([...set]);
    } catch (e) {}
  }
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
    let msg = res.error === 'PERMISSION_OR_MISSING'
      ? 'ลบไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์ลบสินค้า (ต้องเป็นผู้ดูแลระบบหรือผู้จัดการ)'
      : 'ลบไม่สำเร็จ: ' + res.error;
    // Name the role RLS actually saw (from the live token) so a permission toast
    // is diagnosable at a glance instead of contradicting the role shown in the UI.
    if (res.error === 'PERMISSION_OR_MISSING' && window.authTokenRole) {
      try {
        const tr = await authTokenRole();
        msg += tr ? ' — สิทธิ์ในระบบขณะนี้: ' + tr : ' — ไม่พบข้อมูลสิทธิ์ใน token';
        if (tr && tr !== 'admin' && tr !== 'manager') msg += ' → ออกจากระบบแล้วเข้าใหม่';
      } catch (e) {}
    }
    // With a valid role the block means these skus matched no DB row — show them
    // verbatim with their true length so stale/dirty local copies are visible
    // (a hidden character makes the length exceed what the eye counts).
    if (Array.isArray(res.missing) && res.missing.length) {
      msg += ' — ไม่พบใน DB: ' + res.missing.slice(0, 4)
        .map(s => JSON.stringify(String(s)) + '[' + String(s).length + ']').join(', ')
        + (res.missing.length > 4 ? ' +' + (res.missing.length - 4) : '');
    }
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
  // Re-point all products that used the old category name — scoped to their cat
  // column only, so the rename can't clobber concurrent stock changes.
  const affected = [];
  PRODUCTS.forEach(p => { if (p.cat === oldName) { p.cat = newName.trim(); affected.push(p.sku); } });
  _syncManyFields(affected, { cat: newName.trim() });
  return true;
}
function deleteCategory(name, fallback = "ทั่วไป") {
  const cats = loadCategories().filter(c => c !== name);
  // Reassign products in the deleted category to the fallback (scoped column write)
  const affected = [];
  PRODUCTS.forEach(p => { if (p.cat === name) { p.cat = fallback; affected.push(p.sku); } });
  _syncManyFields(affected, { cat: fallback });
  if (!cats.includes(fallback)) cats.unshift(fallback);
  saveCategories(cats);
  return true;
}

/* ── Persistent stock deduction helpers ──
   Optimistic local mutation (PRODUCTS in place, never reassigned) followed by
   an ATOMIC server-side deduction via the deduct_stock RPC (one
   qty = GREATEST(0, qty - n) UPDATE per SKU — see migration-atomic-stock.sql).
   This replaces the old full-catalog upsert, whose read-modify-write cycle
   lost sales when two devices deducted the same SKU concurrently.
   Fallbacks: RPC missing (migration not applied) → legacy saveProductStore();
   offline/network error → offline queue, flushed on reconnect.
   Also clears any matching ims_stock_adj entry so the display overlay
   doesn't double-count. */
function _persistProductsLocal() {
  try { localStorage.setItem("ims_products", JSON.stringify(PRODUCTS)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-products-change"));
}

/* Write server-canonical quantities (RPC return value) back into PRODUCTS.
   The same SKU can appear more than once (sold alone + inside a bundle in one
   cart); entries are applied in order so the last — final — qty wins. */
function _applyServerQty(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  let changed = false;
  rows.forEach(r => {
    const p = PRODUCTS.find(x => x.sku === r.sku);
    if (p && typeof r.qty === "number" && p.qty !== r.qty) { p.qty = r.qty; changed = true; }
  });
  if (changed) _persistProductsLocal();
}

async function _deductRemote(deductions) {
  if (typeof dbDeductStock !== "function") { saveProductStore(); return; }
  if (!navigator.onLine) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("deduct", deductions);
    return;
  }
  try {
    const res = await dbDeductStock(deductions);
    if (res && res.ok) { _applyServerQty(res.rows); return; }
    if (res && res.error === "PERMISSION_OR_MISSING") {
      _applyServerQty(res.rows); // rows RLS did allow are still canonical
      window.dispatchEvent(new CustomEvent("ims-toast", {
        detail: "ตัดสต็อกไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์แก้ไขสินค้า"
      }));
      // Reload canonical server state so the UI stops showing a deduction
      // that didn't persist (mirrors saveProductStore's perm-block path).
      if (window.dbLoadProducts) {
        dbLoadProducts().then(fresh => {
          if (!fresh) return;
          PRODUCTS.length = 0; fresh.forEach(p => PRODUCTS.push(p));
          _persistProductsLocal();
        }).catch(() => {});
      }
      return;
    }
    if (res && res.error === "RPC_MISSING") { saveProductStore(); return; }
    // Other failure (likely transient network/server) → queue for retry.
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("deduct", deductions);
  } catch (e) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("deduct", deductions);
  }
}

function deductStockAndPersist(sku, qty) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return;
  p.qty = Math.max(0, p.qty - qty);
  _persistProductsLocal();
  _deductRemote([{ sku, qty }]);
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  if (sku in adj) { delete adj[sku]; if (typeof applyStockAdj === "function") applyStockAdj(adj); }
}
function deductManyAndPersist(deductions) {
  deductions.forEach(({ sku, qty }) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (p) p.qty = Math.max(0, p.qty - qty);
  });
  _persistProductsLocal();
  _deductRemote(deductions);
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  let changed = false;
  deductions.forEach(({ sku }) => { if (sku in adj) { delete adj[sku]; changed = true; } });
  if (changed && typeof applyStockAdj === "function") applyStockAdj(adj);
}

/* ── Reasoned stock adjustment (ปรับสต็อก) ──
   One choke point for a stock correction with a recorded reason — miscount,
   damaged/lost item, or a sale made outside the system (Shopee/Lazada/หน้าร้าน).
   Desktop (StockAdjustModal) and mobile (MAdjust) BOTH call this; the UIs are
   forked but the logic must not be. Distinct from the sell/ตัดสต็อก flows: it
   never creates an order, so external sales recorded here deliberately do NOT
   feed revenue/channel analytics (those read orders — use ตัดสต็อก for that). */
function applyStockAdjustment({ sku, delta, reason, note, source }) {
  const d = Math.trunc(Number(delta) || 0);
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p || !d) return { ok: false };
  // Both modals preview against the EFFECTIVE qty (raw + ims_stock_adj overlay).
  // Fold any residual overlay entry (legacy pending-sale artifact — nothing
  // writes new ones) into the applied delta and clear it, so the stock shown
  // after apply is exactly the preview the user confirmed, ตั้งค่าเป็น lands on
  // the counted number, and the audit from→to matches what was on screen.
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  const ov = Number(adj[sku]) || 0;
  const from = Math.max(0, (Number(p.qty) || 0) + ov);   // what the user saw
  // Delta from the CLAMPED baseline the user saw (≡ d + ov when raw+ov ≥ 0,
  // but correct when a stale overlay pushed the display below the 0-clamp —
  // ตั้งค่าเป็น still lands on the counted number instead of under-shooting).
  const applied = from + d - (Number(p.qty) || 0);
  if (applied) adjustProductQty(sku, applied);           // optimistic in-place + atomic RPC + offline queue
  if (sku in adj) { delete adj[sku]; if (typeof applyStockAdj === "function") applyStockAdj(adj); }
  const to = Math.max(0, Number(p.qty) || 0);            // overlay cleared → raw IS the displayed qty
  const eff = to - from;
  const reasonLabel = (reason && reason.label) || String(reason || "");
  const noteText = String(note || "").trim();
  const fullReason = noteText ? `${reasonLabel} — ${noteText}` : reasonLabel;
  // Record the EFFECTIVE local delta (post-clamp), not the requested one, so the
  // trail never claims more than happened. Skip both writes when nothing moved.
  if (eff) {
    // Audit trail: only summary/note survive to the DB (changes[] stays local),
    // so sku, ±delta, from→to and the reason are all packed into them.
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: sku, action: "adjust",
        summary: `ปรับสต็อก ${p.name} (${sku}) ${eff > 0 ? "+" : ""}${eff} ชิ้น (${from} → ${to})${source === "mobile" ? " (มือถือ)" : ""}`,
        changes: [{ label: "จำนวน", from: `${from} ชิ้น`, to: `${to} ชิ้น` }],
        note: fullReason
      });
    }
    // Structured, queryable history (stock_adjustments table). Best-effort like
    // dbInsertAuditEntry — the atomic stock write above is the authoritative one.
    if (typeof dbInsertStockAdjustment === "function") {
      dbInsertStockAdjustment([{ sku, delta: eff, reason: fullReason }]).catch(() => {});
    }
  }
  return { ok: true, from, to, eff };
}

/* Multi-SKU version of the above — one shared reason/note, many products.
   Both ปรับสต็อก UIs (desktop StockAdjustModal, mobile MAdjust) select several
   items at once, and both must stay on the single choke point above, so this
   only loops it and aggregates: per-SKU audit rows + stock_adjustments history
   stay granular (the ProductDrawer history panel reads them per product).
   items = [{ sku, delta }] → { ok, applied, skipped, net, results }. */
function applyStockAdjustmentBatch(items, opts) {
  const { reason, note, source } = opts || {};
  const list = Array.isArray(items) ? items : [];
  const results = [];
  let applied = 0, skipped = 0, net = 0;
  list.forEach(it => {
    if (!it || !it.sku) { skipped++; return; }
    const res = applyStockAdjustment({ sku: it.sku, delta: it.delta, reason, note, source }) || { ok: false };
    results.push({ sku: it.sku, ...res });
    // eff === 0 means the clamp ate the change (already 0 คงเหลือ) — not applied.
    if (res.ok && res.eff) { applied++; net += res.eff; } else skipped++;
  });
  return { ok: applied > 0, applied, skipped, net, results };
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

/* Append/update ONE order: optimistic local cache + single-row DB upsert.
   This is the convergence-safe writer — unlike saveOrders() it never upserts
   the whole list and never diffs-and-deletes, so two devices can't clobber
   each other's orders. Failed writes go to the offline queue. */
async function appendOrder(order) {
  if (!order || !order.id) return { ok: false };
  // If this id was previously deleted, drop the stale tombstone so the new order
  // isn't hidden by it (clearOrderOverride is a no-op for a fresh, never-used id).
  if (typeof clearOrderOverride === "function") clearOrderOverride(order.id);
  const next = [order, ...loadOrders().filter(o => o.id !== order.id)];
  try { localStorage.setItem("ims_orders", JSON.stringify(next)); } catch (e) {}
  window._DB_ORDERS = next;
  window.dispatchEvent(new CustomEvent("ims-orders-change"));
  if (typeof dbUpsertOrders !== "function") return { ok: true };
  try {
    const res = await dbUpsertOrders([order]);
    if (res && res.error && typeof enqueueOfflineWrite === "function") {
      enqueueOfflineWrite("orders", [order]);
    }
    return res || { ok: true };
  } catch (e) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("orders", [order]);
    return { error: String(e) };
  }
}

const INBOUND = [];

const OUTBOUND = [];

const TODAY_ISO = bangkokDateStr();

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

// Kept as an empty export for backward-compat (old code referenced LOCATIONS).
const LOCATIONS = [];

/* ── Storage-location store — hierarchical Building → Floor → Position ──
   Persisted as ONE cloud blob (app_state "locations") + a localStorage mirror,
   same pattern as categories. Shape:
     { buildings: [ { name, floors: [ { name, positions: ["A1", ...] } ] } ] }
   A product references a position by its full path string in p.loc, e.g.
   "สภ. › ชั้น 1 › A1". A floor may have zero positions (it still exists). */
const LOC_SEP = " › ";
const LOC_SEED = () => ({
  buildings: [
    { name: "สภ.",        floors: [ { name: "ชั้น 1", positions: [] }, { name: "ชั้น 2", positions: [] } ] },
    { name: "ตึกพาณิชย์", floors: [ { name: "ชั้น 1", positions: [] }, { name: "ชั้น 2", positions: [] } ] },
  ],
});
function locCode(building, floor, pos) { return [building, floor, pos].filter(Boolean).join(LOC_SEP); }

function loadLocTree() {
  let t = null;
  const cloud = window._DB_LOCATIONS;
  if (cloud && !Array.isArray(cloud) && Array.isArray(cloud.buildings)) t = cloud;
  if (!t) {
    try { const s = localStorage.getItem("ims_loc_tree"); if (s) { const o = JSON.parse(s); if (o && Array.isArray(o.buildings)) t = o; } } catch (e) {}
  }
  if (!t) t = LOC_SEED();
  return t;
}
function saveLocTree(tree) {
  try { localStorage.setItem("ims_loc_tree", JSON.stringify(tree)); } catch (e) {}
  window._DB_LOCATIONS = tree;
  window.dispatchEvent(new CustomEvent("ims-locations-change"));
  if (window.dbSaveState) dbSaveState("locations", tree).catch(() => {});
}

/* Capability: hard-delete of records. Defaults to admin/manager (mirrors the
   Supabase DELETE RLS policy) and is admin-tunable via canDo("deleteData").
   Locations live in the app_state blob, where a delete is persisted by
   dbSaveState as an UPDATE of the blob — which staff IS allowed to do — so the
   row-level DELETE policy can't stop them. The app must gate it instead. */
function canDeleteData() {
  return typeof canDo === "function" ? canDo("deleteData") : false;
}
/* Capability: manual stock adjustment (ปรับสต็อก). Defaults to the products
   UPDATE RLS + adjust_stock RPC gating (admin/manager/staff; viewer matches 0
   rows) so the UI and the server agree on who sees the buttons, and is
   admin-tunable via canDo("adjustStock") — but never grantable to viewer. */
function canAdjustStock() {
  return typeof canDo === "function" ? canDo("adjustStock") : false;
}
function _locDenyToast() {
  try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: "เฉพาะผู้ดูแลระบบหรือผู้จัดการเท่านั้นที่ลบตำแหน่งได้" })); } catch (e) {}
}
// When a building/floor/position is renamed, re-point any products that used the old code.
function _renameLocPointer(oldCode, newCode) {
  const affected = [];
  PRODUCTS.forEach(p => { if ((p.loc || "") === oldCode) { p.loc = newCode; affected.push(p.sku); } });
  if (affected.length) _syncManyFields(affected, { loc: newCode });
  // Location photo lives in a later-loaded file (product-images.jsx) — call
  // defensively. Single choke point: covers renameBuilding / renameFloor / renamePosition.
  if (typeof moveLocationImage === "function") moveLocationImage(oldCode, newCode);
}

// Clear location photos for a set of codes (e.g. after a floor/building removal
// wipes out every position under it). Guarded — product-images.jsx loads later.
function _clearLocImages(codes) {
  if (typeof setLocationImage === "function") codes.forEach(c => setLocationImage(c, null));
}

// Flat list of every position with its building/floor — for dropdowns, the map, counts.
function allPositions() {
  const out = [];
  loadLocTree().buildings.forEach(b => (b.floors || []).forEach(f => (f.positions || []).forEach(p => {
    out.push({ building: b.name, floor: f.name, pos: p, code: locCode(b.name, f.name, p) });
  })));
  return out;
}
function allLocationCodes() { return allPositions().map(p => p.code); }

// ── Tree mutators (each persists + broadcasts) ──
function addBuilding(name) {
  const n = String(name || "").trim(); if (!n) return false;
  const t = loadLocTree(); if (t.buildings.some(b => b.name === n)) return false;
  t.buildings.push({ name: n, floors: [] }); saveLocTree(t); return true;
}
function renameBuilding(oldName, newName) {
  const n = String(newName || "").trim(); if (!n) return false;
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === oldName); if (!b) return false;
  if (t.buildings.some(x => x.name === n && x !== b)) return false;
  (b.floors || []).forEach(f => (f.positions || []).forEach(p => _renameLocPointer(locCode(oldName, f.name, p), locCode(n, f.name, p))));
  b.name = n; saveLocTree(t); return true;
}
function removeBuilding(name) {
  if (!canDeleteData()) { _locDenyToast(); return false; }
  const t = loadLocTree();
  const b = t.buildings.find(x => x.name === name);
  const codes = b ? (b.floors || []).flatMap(f => (f.positions || []).map(p => locCode(name, f.name, p))) : [];
  t.buildings = t.buildings.filter(x => x.name !== name); saveLocTree(t);
  if (codes.length) _clearLocImages(codes);
  return true;
}
function addFloor(building, name) {
  const n = String(name || "").trim(); if (!n) return false;
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === building); if (!b) return false;
  b.floors = b.floors || []; if (b.floors.some(f => f.name === n)) return false;
  b.floors.push({ name: n, positions: [] }); saveLocTree(t); return true;
}
function renameFloor(building, oldName, newName) {
  const n = String(newName || "").trim(); if (!n) return false;
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === building); if (!b) return false;
  const f = (b.floors || []).find(x => x.name === oldName); if (!f) return false;
  if (b.floors.some(x => x.name === n && x !== f)) return false;
  (f.positions || []).forEach(p => _renameLocPointer(locCode(building, oldName, p), locCode(building, n, p)));
  f.name = n; saveLocTree(t); return true;
}
function removeFloor(building, name) {
  if (!canDeleteData()) { _locDenyToast(); return false; }
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === building); if (!b) return false;
  const f = (b.floors || []).find(x => x.name === name);
  const codes = f ? (f.positions || []).map(p => locCode(building, name, p)) : [];
  b.floors = (b.floors || []).filter(x => x.name !== name); saveLocTree(t);
  if (codes.length) _clearLocImages(codes);
  return true;
}
function addPosition(building, floor, name) {
  const n = String(name || "").trim(); if (!n) return false;
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === building); if (!b) return false;
  const f = (b.floors || []).find(x => x.name === floor); if (!f) return false;
  f.positions = f.positions || []; if (f.positions.includes(n)) return false;
  f.positions.push(n); saveLocTree(t); return true;
}
function renamePosition(building, floor, oldName, newName) {
  const n = String(newName || "").trim(); if (!n) return false;
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === building); if (!b) return false;
  const f = (b.floors || []).find(x => x.name === floor); if (!f) return false;
  const i = (f.positions || []).indexOf(oldName); if (i < 0) return false;
  if (f.positions.includes(n)) return false;
  _renameLocPointer(locCode(building, floor, oldName), locCode(building, floor, n));
  f.positions[i] = n; saveLocTree(t); return true;
}
function removePosition(building, floor, name) {
  if (!canDeleteData()) { _locDenyToast(); return false; }
  const t = loadLocTree(); const b = t.buildings.find(x => x.name === building); if (!b) return false;
  const f = (b.floors || []).find(x => x.name === floor); if (!f) return false;
  f.positions = (f.positions || []).filter(p => p !== name); saveLocTree(t);
  _clearLocImages([locCode(building, floor, name)]);
  return true;
}

/* ── Per-position stock split (table public.product_locations) ──────────
   p.loc holds exactly ONE position path, so a product physically kept in two
   places (zone A downstairs + a backup box upstairs) could only ever record
   one of them — the box quantity was invisible, and 102 pieces were filed on
   the wrong floor. The real distribution therefore lives in a side table,
   mirrored here as { [sku]: [{ loc, qty, note }] }.

   p.loc SURVIVES as the *primary* position (pick from here first), so every
   existing `p.loc` reader keeps working untouched. This map is additive:
   a sku with no rows returns [] and callers fall back to p.loc + p.qty.
   INVARIANT: the rows for a sku sum to p.qty (view product_location_audit
   reports any drift; only genuinely unstored products may be absent). */
function loadProductLocs() {
  const cloud = window._DB_PRODUCT_LOCS;
  if (cloud && typeof cloud === "object") return cloud;
  try { const s = localStorage.getItem("ims_product_locs"); if (s) { const o = JSON.parse(s); if (o && typeof o === "object") return o; } } catch (e) {}
  return {};
}
function _mirrorProductLocs(map) {
  window._DB_PRODUCT_LOCS = map;
  try { localStorage.setItem("ims_product_locs", JSON.stringify(map)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-product-locs-change"));
}
/* Rows for one sku, biggest pile first so "where do I actually go" reads top-down.
   The primary position (p.loc) is pinned first regardless of size. */
function locSplitFor(sku, primaryLoc) {
  const rows = loadProductLocs()[sku];
  if (!Array.isArray(rows) || !rows.length) return [];
  const out = rows.map(r => ({ loc: r.loc, qty: Number(r.qty) || 0, note: r.note || "" }));
  out.sort((a, b) => (a.loc === primaryLoc ? -1 : b.loc === primaryLoc ? 1 : b.qty - a.qty));
  return out;
}
// True only when the product really is in more than one place.
function hasLocSplit(sku) { return locSplitFor(sku).length > 1; }
function locSplitTotal(sku) { return locSplitFor(sku).reduce((n, r) => n + r.qty, 0); }
/* Display list for any product: the recorded split when there is one, otherwise
   a single synthetic row from p.loc/p.qty. Always safe to map over. */
function productPositions(p) {
  if (!p) return [];
  const rows = locSplitFor(p.sku, p.loc);
  if (rows.length) return rows;
  return p.loc ? [{ loc: p.loc, qty: Number(p.qty) || 0, note: "" }] : [];
}
/* Pieces of this sku at one position — used by pick lists so staff are sent to
   the shelf that can actually fill the order. Falls back to the whole qty when
   no split is recorded and the position is the product's own loc. */
function qtyAtLocation(sku, code) {
  const rows = loadProductLocs()[sku];
  if (Array.isArray(rows) && rows.length) {
    const hit = rows.find(r => r.loc === code);
    return hit ? Number(hit.qty) || 0 : 0;
  }
  const p = PRODUCTS.find(x => x.sku === sku);
  return p && (p.loc || "") === code ? Number(p.qty) || 0 : 0;
}

/* Live SKU count for a position code. Counts a product when EITHER its primary
   loc matches or it has split stock parked there — otherwise the four boxes that
   only ever appear in the split (กล่อง 3–6) would render as empty shelves. */
function skusInLocation(code) {
  const map = loadProductLocs();
  return PRODUCTS.filter(p => {
    if ((p.loc || "") === code) return true;
    const rows = map[p.sku];
    return Array.isArray(rows) && rows.some(r => r.loc === code && (Number(r.qty) || 0) > 0);
  }).length;
}
// Products physically present at a position (primary or split), for the drill-down.
function productsInLocation(code) {
  const map = loadProductLocs();
  return PRODUCTS.filter(p => {
    if ((p.loc || "") === code) return true;
    const rows = map[p.sku];
    return Array.isArray(rows) && rows.some(r => r.loc === code && (Number(r.qty) || 0) > 0);
  });
}

/* Record the real distribution for one sku. rows = [{ loc, qty }].
   Enforces the invariant HERE rather than trusting callers: the pieces you place
   must add up to the stock you have, or the split would quietly contradict
   p.qty and every downstream total. Positions at 0 are dropped, not stored.
   Optimistic — mirrors locally first, rolls back if the DB rejects the write
   (RLS: staff and up inside working hours). Returns { ok, error }. */
async function saveLocSplit(sku, rows) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return { ok: false, error: "ไม่พบสินค้า " + sku };
  const clean = (Array.isArray(rows) ? rows : [])
    .map(r => ({ loc: String(r.loc || "").trim(), qty: Math.max(0, Math.round(Number(r.qty) || 0)) }))
    .filter(r => r.loc && r.qty > 0);
  const seen = new Set();
  for (const r of clean) {
    if (seen.has(r.loc)) return { ok: false, error: "ตำแหน่งซ้ำ: " + r.loc };
    seen.add(r.loc);
  }
  const sum = clean.reduce((n, r) => n + r.qty, 0);
  const have = Number(p.qty) || 0;
  if (clean.length && sum !== have) {
    return { ok: false, error: `จำนวนรวมทุกตำแหน่ง (${sum}) ไม่เท่ากับสต็อกของ ${sku} (${have}) — แก้ให้ตรงกันก่อนบันทึก` };
  }
  const map = loadProductLocs();
  const prev = map[sku];
  const next = { ...map };
  if (clean.length) next[sku] = clean; else delete next[sku];
  _mirrorProductLocs(next);
  // Keep the primary position pointing at somewhere the stock actually is.
  const primaryStillValid = !clean.length || clean.some(r => r.loc === p.loc);
  const newPrimary = primaryStillValid ? p.loc : clean[0].loc;
  if (typeof dbSaveProductLocs !== "function") return { ok: true, error: "" };
  const res = await dbSaveProductLocs(sku, clean);
  if (res && res.error) {
    const back = { ...loadProductLocs() };
    if (prev) back[sku] = prev; else delete back[sku];
    _mirrorProductLocs(back);
    return { ok: false, error: res.error };
  }
  if (newPrimary !== p.loc && typeof updateProductInStore === "function") {
    updateProductInStore(sku, { loc: newPrimary });
  }
  return { ok: true, error: "" };
}

/* ── Position-aware stock movement (ตัดจากตำแหน่ง) ──────────────────────
   The qty writers (deductStockAndPersist / applyStockAdjustment / …) move
   products.qty and know nothing about the split. This re-balances
   product_locations so it sums to the NEW p.qty again, taking from — or adding
   to — the position the user picked first, then cascading in pick order.

   Difference-based ON PURPOSE: it reads p.qty as it stands NOW rather than
   taking a quantity, so (a) one helper serves sales, ตัดสต็อก and both signs of
   ปรับสต็อก, (b) it needs no requested-vs-clamped reconciliation, and (c) drift
   left by an older position-blind write is absorbed at the next pick instead of
   locking the split editor behind a mismatch error forever.

   MUST be called in the same tick as the qty writer, before any other await:
   saveLocSplit re-validates against the live p.qty. */
function _planLocRows(sku, preferLocs) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return { skip: true };
  const rows = locSplitFor(sku, p.loc);        // [] when no split is recorded
  if (!rows.length) return { skip: true };     // unsplit sku: products.qty is the whole truth
  const have = Math.max(0, Number(p.qty) || 0);
  const sum = rows.reduce((n, r) => n + r.qty, 0);
  const diff = have - sum;
  if (!diff) return { skip: true };
  const order = [];
  (preferLocs || []).forEach(l => { if (l && order.indexOf(l) < 0) order.push(l); });
  rows.forEach(r => { if (order.indexOf(r.loc) < 0) order.push(r.loc); });
  const out = rows.map(r => ({ loc: r.loc, qty: r.qty }));
  if (diff > 0) {
    const target = order[0];
    const hit = out.find(r => r.loc === target);
    if (hit) hit.qty += diff; else out.push({ loc: target, qty: diff });
  } else {
    let need = -diff;
    for (const loc of order) {
      if (need <= 0) break;
      const hit = out.find(r => r.loc === loc);
      if (!hit) continue;
      const take = Math.min(need, hit.qty);
      hit.qty -= take; need -= take;
    }
  }
  return { skip: false, rows: out.filter(r => r.qty > 0) };
}

/* picks = [{ sku, loc }] — the position each sku should be taken from (or added
   to). Returns { ok, offline, errors:[{sku,error}] }. Plans every sku BEFORE the
   first await so nothing can move p.qty underneath us. */
async function applyLocPicks(picks) {
  const list = Array.isArray(picks) ? picks : [];
  if (!list.length) return { ok: true, offline: false, errors: [] };
  const bySku = new Map();
  list.forEach(it => {
    if (!it || !it.sku) return;
    if (!bySku.has(it.sku)) bySku.set(it.sku, []);
    if (it.loc) bySku.get(it.sku).push(String(it.loc));
  });
  const plans = [];
  bySku.forEach((prefer, sku) => {
    const plan = _planLocRows(sku, prefer);
    if (!plan.skip) plans.push({ sku: sku, rows: plan.rows });
  });
  if (!plans.length) return { ok: true, offline: false, errors: [] };
  /* Offline: the qty write is already queued and will replay, but a split payload
     computed now would be stale by then — skip it and let the next pick's
     difference-based reconcile heal this sku. */
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, offline: true, errors: [] };
  }
  const errors = [];
  // Sequential: each saveLocSplit re-reads the shared mirror.
  for (const pl of plans) {
    const res = await saveLocSplit(pl.sku, pl.rows);
    if (res && res.ok === false) errors.push({ sku: pl.sku, error: res.error });
  }
  return { ok: errors.length === 0, offline: false, errors: errors };
}

/* Default shelf for a sku — the pick-first position, used to seed every picker. */
function defaultPickLoc(p) {
  if (!p) return "";
  const spots = productPositions(p);
  return (spots.length && spots[0].loc) || p.loc || "";
}

/* Move `pieces` of a sku TO one position — the write behind "เพิ่มสินค้า / สแกน
   เข้าตำแหน่ง". Writing p.loc alone is only correct for a sku with NO recorded
   split; since the 2026-07-26 seed every stored sku HAS rows, so a bare p.loc
   write left the pieces filed at the old shelf and the new box showed the
   product with 0 ชิ้น (and the next saveLocSplit snapped p.loc right back).
   Here the rows move too: take from the other positions in pick order
   (primary first, then biggest pile — same convention as _planLocRows),
   healing any recorded-vs-p.qty drift on the way. Async like saveLocSplit;
   returns { ok, moved, all, error }. */
async function moveStockToLocation(sku, code, pieces) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return { ok: false, error: "ไม่พบสินค้า " + sku };
  const target = String(code || "").trim();
  if (!target) return { ok: false, error: "ไม่มีรหัสตำแหน่ง" };
  const total = Math.max(0, Number(p.qty) || 0);
  const rows = locSplitFor(sku, p.loc);
  if (!rows.length) {
    // No split recorded: p.loc IS the whole truth, keep the legacy whole-move.
    updateProductInStore(sku, { loc: target });
    return { ok: true, moved: total, all: true };
  }
  let need = Math.min(total, Math.max(0, Math.round(Number(pieces) || 0)));
  if (!need) return { ok: false, error: "" };
  const out = rows.map(r => ({ loc: r.loc, qty: Math.max(0, Number(r.qty) || 0) }));
  let tgt = out.find(r => r.loc === target);
  if (!tgt) { tgt = { loc: target, qty: 0 }; out.push(tgt); }
  // Absorb drift BEFORE the transfer so the rows we save satisfy the
  // sum == p.qty invariant saveLocSplit enforces.
  const sum = out.reduce((n, r) => n + r.qty, 0);
  const diff = total - sum;
  if (diff > 0) tgt.qty += diff;
  else if (diff < 0) {
    let cut = -diff;
    for (const r of out) {
      if (cut <= 0) break;
      const t = Math.min(cut, r.qty);
      r.qty -= t; cut -= t;
    }
  }
  let moved = 0;
  for (const r of out) {
    if (need <= 0) break;
    if (r === tgt) continue;
    const take = Math.min(need, r.qty);
    r.qty -= take; tgt.qty += take; need -= take; moved += take;
  }
  const res = await saveLocSplit(sku, out.filter(r => r.qty > 0));
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || "บันทึกตำแหน่งไม่สำเร็จ" };
  return { ok: true, moved, all: tgt.qty >= total };
}

/* File a receiving batch into positions. lines = [{ sku, loc, qty }] — the
   position each received line should land on. MUST be called in the same tick
   as the adjustProductQty(+qty) writes (the _planLocRows contract): for a sku
   with split rows the received pieces surface as p.qty-vs-rows drift, and
   applyLocPicks absorbs that drift into the picked position. A sku without
   rows keeps p.loc as the whole truth — receiving to a NEW position while
   stock sits elsewhere opens a real split instead of overwriting p.loc.
   Returns { ok, offline, errors: [{ sku, error }] }. */
async function applyReceiveLocs(lines) {
  const picks = [];   // skus with split rows → difference-based reconcile
  const jobs = [];    // no-row skus that need a split created / primary set
  (Array.isArray(lines) ? lines : []).forEach(l => {
    if (!l || !l.sku || !l.loc || l.loc === "—") return;
    const p = PRODUCTS.find(x => x.sku === l.sku);
    if (!p) return;
    const rows = locSplitFor(l.sku, p.loc);
    if (rows.length) { picks.push({ sku: l.sku, loc: l.loc }); return; }
    const n = Math.max(0, Number(l.qty) || 0);
    const oldQty = Math.max(0, (Number(p.qty) || 0) - n);
    if (!p.loc || p.loc === l.loc || !locIsStored(p.loc) || oldQty === 0) {
      if ((p.loc || "") !== l.loc) updateProductInStore(l.sku, { loc: l.loc });
      return;
    }
    // Stock recorded elsewhere and this batch lands somewhere new → real split.
    jobs.push([l.sku, [{ loc: p.loc, qty: oldQty }, { loc: l.loc, qty: n }].filter(r => r.qty > 0)]);
  });
  const out = { ok: true, offline: false, errors: [] };
  if (picks.length) {
    const r = await applyLocPicks(picks);
    if (r && r.offline) out.offline = true;
    if (r && r.errors && r.errors.length) { out.ok = false; out.errors.push(...r.errors); }
  }
  for (const job of jobs) {
    const r = await saveLocSplit(job[0], job[1]);
    if (r && r.ok === false) { out.ok = false; out.errors.push({ sku: job[0], error: r.error }); }
  }
  return out;
}

/* Product-finder search (ตำแหน่งสินค้า): match by SKU or name — the SKU doubles
   as the barcode, so a keyboard-wedge scan into the input resolves too.
   Ranked exact SKU → prefix → substring. Returns { hits, total }. */
function searchProductsForLocation(query, limit = 12) {
  const lq = String(query || "").trim().toLowerCase();
  if (!lq) return { hits: [], total: 0 };
  const rank = (p) => {
    const sku = String(p.sku || "").toLowerCase();
    const name = String(p.name || "").toLowerCase();
    if (sku === lq) return 0;
    if (sku.startsWith(lq) || name.startsWith(lq)) return 1;
    return 2;
  };
  const all = PRODUCTS.filter(p =>
    String(p.sku || "").toLowerCase().includes(lq) ||
    String(p.name || "").toLowerCase().includes(lq)
  ).sort((a, b) => rank(a) - rank(b));
  return { hits: all.slice(0, limit), total: all.length };
}

/* Split a p.loc code back into { building, floor, pos, code }. Prefers the live
   tree (survives odd names containing the separator); falls back to splitting
   the string so stale codes that no longer exist in the tree still resolve. */
function locParts(code) {
  if (!code) return null;
  const hit = allPositions().find(x => x.code === code);
  if (hit) return hit;
  const seg = String(code).split(LOC_SEP);
  return { building: seg[0] || "", floor: seg[1] || "", pos: seg[2] || seg[seg.length - 1] || String(code), code };
}

/* "Stored" = the product's loc points at a REAL position in the live tree.
   An empty loc and a stale code (deleted position, or a legacy zone letter like
   "A" imported from CSV) both count as NOT stored — the UI shows a warning
   badge for them. Pass a prebuilt Set (storedLocSet()) when checking many rows. */
function storedLocSet() { return new Set(allLocationCodes()); }
function locIsStored(loc, set) { return !!loc && (set || storedLocSet()).has(String(loc)); }
function countUnstoredProducts() {
  const set = storedLocSet();
  return PRODUCTS.reduce((n, p) => n + (locIsStored(p.loc, set) ? 0 : 1), 0);
}

/* One-time migration to the Building→Floor→Position model: drop the old flat demo
   bins, seed the two real buildings, and clear product locations (the old "A-01-01"
   codes don't exist in the new tree) so the warehouse starts clean. Runs once per
   device; the product clear waits until products have actually loaded. */
(function migrateLocationsV2() {
  try { localStorage.removeItem("ims_locations"); } catch (e) {}
  // Seed LOCAL only (no cloud write) so a fresh device shows the two buildings without
  // clobbering an existing cloud tree — loadLocTree prefers the cloud copy once it loads,
  // and a real user edit is what first persists the tree to the cloud.
  try { if (!localStorage.getItem("ims_loc_tree")) localStorage.setItem("ims_loc_tree", JSON.stringify(LOC_SEED())); } catch (e) {}
  try { if (localStorage.getItem("ims_loc_cleared_v2") === "1") return; } catch (e) { return; }
  const clearOnce = () => {
    if (!Array.isArray(PRODUCTS) || !PRODUCTS.length) return;   // wait for products
    const affected = [];
    PRODUCTS.forEach(p => { if (p.loc) { p.loc = ""; affected.push(p.sku); } });
    try { localStorage.setItem("ims_loc_cleared_v2", "1"); } catch (e) {}
    window.removeEventListener("ims-products-change", clearOnce);
    if (affected.length && typeof _syncManyFields === "function") _syncManyFields(affected, { loc: "" });
  };
  window.addEventListener("ims-products-change", clearOnce);
  clearOnce();
})();

/* Sales channels — used for outbound deduction + per-channel stock tracking */
const CHANNEL_LIST = [
  { id: "shopee", name: "Shopee",        color: "oklch(0.62 0.2 30)",  short: "SP" },
  { id: "lazada", name: "Lazada",        color: "oklch(0.5 0.2 280)",  short: "LZ" },
  { id: "tiktok", name: "TikTok Shop",   color: "oklch(0.35 0.04 220)", short: "TT" },
  { id: "line",   name: "LINE Shopping", color: "oklch(0.6 0.18 145)", short: "LN" },
  { id: "web",    name: "เว็บไซต์",      color: "oklch(0.55 0.13 235)", short: "WB" },
  { id: "other",  name: "ออฟไลน์ / อื่นๆ", color: "oklch(0.55 0.01 80)", short: "OT" }
];

/* Reasons for a manual stock adjustment (ปรับสต็อก) — single source for the
   desktop modal AND mobile MAdjust so the taxonomy can't fork. External-sale
   reasons derive from CHANNEL_LIST; the channel is carried in the label text
   (stock_adjustments stores a reason string, not a channel column). */
const ADJUST_REASONS = [
  { id: "recount",      label: "นับสต็อกผิด / แก้ไขยอด" },
  { id: "damaged",      label: "สินค้าเสียหาย / ชำรุด" },
  { id: "lost",         label: "สินค้าสูญหาย" },
  ...CHANNEL_LIST.filter(c => c.id !== "other").map(c => ({ id: "sale-" + c.id, label: `ขายผ่าน ${c.name} (นอกระบบ)`, channel: c.id })),
  { id: "sale-offline", label: "ขายหน้าร้าน / ออฟไลน์", channel: "other" },
  { id: "other",        label: "อื่นๆ (ระบุ)", requireNote: true }
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

/* "adjust" is a mobile-menu-only id (no ALL_NAV entry, so it can never appear
   in the desktop sidebar) — it gates the MMore ปรับสต็อก row per role. */
const ROLE_NAV = {
  admin:   ["dashboard","inbound","outbound","finder","inventory","stocktake","adjust","locations","import","bundles","labels","tracking","analytics","handheld","users","layout","history","settings"],
  manager: ["dashboard","inbound","outbound","finder","inventory","stocktake","adjust","locations","import","bundles","labels","tracking","analytics","handheld","history","settings"],
  staff:   ["dashboard","inbound","outbound","finder","inventory","stocktake","adjust","locations","bundles","labels","tracking","handheld"],
  viewer:  ["dashboard","finder","inventory","locations","bundles","labels","tracking","analytics"]
};

/* ── Capabilities (admin-customizable per role) ──
   ROLE_NAV above and DEFAULT_ROLE_CAPS below are the DEFAULTS. An admin can
   override both, per role, from ผู้ใช้งานและสิทธิ์. The override lives in
   app_state key "role_perms" (one cloud blob shared by every device) with a
   localStorage mirror, shaped:
     { nav: { staff: [navId, …] }, caps: { staff: { viewCost: false, … } } }
   Only keys actually present in the override win, so a page or capability
   added in a later release starts from its own default instead of silently
   vanishing for every role.

   `server` on a capability lists the roles the DATABASE allows (see
   supabase/rls-policies.sql). Such a capability can be taken AWAY here but
   never granted — otherwise the UI would show a button whose every write RLS
   rejects. Capabilities without `server` are pure display gates. */
const CAPS = [
  { id: "viewCost",    label: "ดูราคาทุนและกำไร",   desc: "ราคาทุน กำไรต่อชิ้น มาร์จิ้น และคอลัมน์ต้นทุนในไฟล์ส่งออก" },
  { id: "viewSales",   label: "ดูยอดขายและรายได้",  desc: "ยอดขายรายวัน รายได้ กำไรรวม และสรุปยอดขายรายสินค้า" },
  { id: "sell",        label: "ขาย / ตัดสต็อก",      desc: "เปิดออร์เดอร์และตัดสต็อกออกจากคลัง", server: ["admin", "manager", "staff"] },
  { id: "adjustStock", label: "ปรับสต็อก",           desc: "แก้ยอดคงเหลือด้วยมือ (นับผิด เสียหาย ขายนอกระบบ)", server: ["admin", "manager", "staff"] },
  { id: "addProduct",  label: "เพิ่มสินค้าใหม่",     desc: "สร้าง SKU ใหม่ และนำเข้าจาก Excel", server: ["admin", "manager", "staff"] },
  { id: "editProduct", label: "แก้ไขข้อมูลสินค้า",   desc: "แก้ชื่อ ราคา หมวดหมู่ และตำแหน่งจัดเก็บ", server: ["admin", "manager", "staff"] },
  { id: "deleteData",  label: "ลบข้อมูล",            desc: "ลบสินค้า ออร์เดอร์ และอาคาร/ชั้น/ตำแหน่ง", server: ["admin", "manager"] },
  { id: "exportData",  label: "ส่งออก/พิมพ์รายงาน",  desc: "ดาวน์โหลด CSV รายงาน Excel และพิมพ์รายงาน" }
];

const DEFAULT_ROLE_CAPS = {
  admin:   { viewCost: true,  viewSales: true,  sell: true,  adjustStock: true,  addProduct: true,  editProduct: true,  deleteData: true,  exportData: true },
  manager: { viewCost: true,  viewSales: true,  sell: true,  adjustStock: true,  addProduct: true,  editProduct: true,  deleteData: true,  exportData: true },
  // Warehouse staff work the floor: they move stock but never see money.
  staff:   { viewCost: false, viewSales: false, sell: true,  adjustStock: true,  addProduct: true,  editProduct: true,  deleteData: false, exportData: true },
  viewer:  { viewCost: true,  viewSales: true,  sell: false, adjustStock: false, addProduct: false, editProduct: false, deleteData: false, exportData: true }
};

const ROLE_PERMS_KEY = "ims_role_perms";

function loadRolePerms() {
  const cloud = window._DB_ROLE_PERMS;
  if (cloud && typeof cloud === "object") return cloud;
  try {
    const s = localStorage.getItem(ROLE_PERMS_KEY);
    if (s) { const o = JSON.parse(s); if (o && typeof o === "object") return o; }
  } catch (e) {}
  return {};
}

/* Persist the override blob. ASYNC and awaited by both editors: dbSaveState
   RESOLVES with { error } instead of rejecting, so a swallowed failure would
   leave the admin's own screen restricted, a success toast on screen, and every
   other device untouched. On failure we roll the local copy back to what the
   cloud still holds, so what you see matches what everyone else sees. */
async function saveRolePerms(perms) {
  const prevLocal = (() => { try { return localStorage.getItem(ROLE_PERMS_KEY); } catch (e) { return null; } })();
  const prevCloud = window._DB_ROLE_PERMS;
  const clean = { nav: (perms && perms.nav) || {}, caps: (perms && perms.caps) || {} };

  try { localStorage.setItem(ROLE_PERMS_KEY, JSON.stringify(clean)); } catch (e) {}
  window._DB_ROLE_PERMS = clean;
  window.dispatchEvent(new CustomEvent("ims-perms-change"));

  if (!window.dbSaveState) return { ok: true, perms: clean, offline: true };
  let res;
  try { res = await dbSaveState("role_perms", clean); }
  catch (e) { res = { error: (e && e.message) || String(e) }; }

  if (res && res.error) {
    try {
      if (prevLocal === null) localStorage.removeItem(ROLE_PERMS_KEY);
      else localStorage.setItem(ROLE_PERMS_KEY, prevLocal);
    } catch (e) {}
    window._DB_ROLE_PERMS = prevCloud;
    window.dispatchEvent(new CustomEvent("ims-perms-change"));
    return { ok: false, error: res.error };
  }
  return { ok: true, perms: clean };
}

function currentRoleId() {
  return (window.__currentUser && window.__currentUser.role) || "viewer";
}

// Nav ids a role may open — the admin's override first, the built-in default
// otherwise. Used by the desktop sidebar AND the mobile "เพิ่มเติม" menu.
function roleNav(role) {
  const r = role || currentRoleId();
  const ov = loadRolePerms().nav;
  const list = ov && Array.isArray(ov[r]) ? ov[r] : ROLE_NAV[r];
  return Array.isArray(list) ? list : [];
}

/* Can the signed-in user open this page id? Any button that navigates to another
   top-level page must check this — the desktop shell bounces a disallowed page
   back to the first allowed one, so an ungated cross-page button would look like
   a dead link. Mobile uses it for the tab bar and the M_GATED_VIEWS guard. */
function canOpenPage(navId, role) {
  return roleNav(role).indexOf(navId) !== -1;
}

/* Capability check — canDo("viewCost") tests the signed-in user; pass a role to
   test someone else (the permission editor previews every role this way). */
function canDo(capId, role) {
  const r = role || currentRoleId();
  const def = DEFAULT_ROLE_CAPS[r] || DEFAULT_ROLE_CAPS.viewer;
  const ov = loadRolePerms().caps;
  const on = (ov && ov[r] && typeof ov[r][capId] === "boolean") ? ov[r][capId] : !!def[capId];
  if (!on) return false;
  return !capServerLocked(capId, r);
}

// True when the DB would reject this capability for the role whatever the
// override says — the editor renders those toggles locked with a hint.
function capServerLocked(capId, role) {
  const cap = CAPS.find(c => c.id === capId);
  return !!(cap && cap.server && cap.server.indexOf(role) === -1);
}

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
// LIVE Bangkok "today" — call this instead of the frozen TODAY_ISO const for
// anything that must roll over at midnight (order dateIso stamps, "today" filters).
// TODAY_ISO is evaluated once at page load, so an always-on PWA/tablet left open
// past midnight would otherwise stamp orders and filter with yesterday's date.
function todayIso() { return bangkokDateStr(); }
/* ── Backdated stock-out (ตัดสต็อกย้อนหลัง) ──
   The ตัดสต็อก forms carry a "วันเวลาที่ตัดสต็อก" field, a datetime-local value
   "YYYY-MM-DDTHH:MM" read as Bangkok wall-clock time ("" = now). Bangkok has no
   DST, so a fixed +07:00 offset is exact. */
function nowBkkLocal(nowMs) {
  const d = new Date((typeof nowMs === "number" ? nowMs : Date.now()) + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
// → { dateIso, ts, createdAt, backdated }. A future value clamps to now; an
// unparseable or empty one means now.
function stockOutStamp(local) {
  const now = Date.now();
  let t = (typeof local === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local))
    ? Date.parse(local.slice(0, 16) + ":00+07:00") : NaN;
  if (!Number.isFinite(t) || t > now) t = now;
  const wall = nowBkkLocal(t);
  // Backdated only if it lands at least a minute in the past — a form left open
  // for a while still stamps "now" when the user never touched the field.
  const backdated = now - t >= 60 * 1000;
  return { dateIso: wall.slice(0, 10), ts: wall.slice(11, 16), createdAt: new Date(t).toISOString(), backdated };
}
// "1 ต.ค. 2569 14:05" — for toasts / audit notes on a backdated stock-out.
function stockOutStampLabel(stamp) {
  return stamp ? `${isoToThai(stamp.dateIso)} ${stamp.ts}` : "";
}
// Convert a stored UTC ISO timestamp (e.g. label.created_at) to its Asia/Bangkok
// calendar date. A raw .slice(0,10) on the UTC string gives the WRONG day for
// anything created 00:00–06:59 Bangkok. Guards an unparseable input.
function bangkokDateOf(isoStr) {
  const t = Date.parse(isoStr || "");
  if (!Number.isFinite(t)) return (isoStr || "").slice(0, 10);
  return bangkokDateStr(t);
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
function snapLineItem(sku, name, qty, loc) {
  const p = PRODUCTS.find(x => x.sku === sku);
  const price = p ? (Number(p.price) || 0) : 0;
  const cost  = p ? (p.cost ?? Math.round(price * 0.6)) : 0;
  // loc = the shelf this line was picked from; optional so every existing
  // 3-arg caller is unaffected, and line_items is JSONB so no schema change.
  const row = { sku, name: name || (p ? p.name : sku), qty, price, cost };
  if (loc) row.loc = loc;
  return row;
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
  // Physical count = truth → write the counted skus' absolute qty (scoped rows),
  // not the whole catalog.
  if (changes.length) _syncProductRows(changes.map(c => c.sku));
  return changes;
}

/* ── WooCommerce reference catalog ───────────────────────────────────────
   A SKU-keyed master catalog imported from a WooCommerce product CSV export.
   Kept SEPARATE from PRODUCTS (live stock): scanning an unknown SKU looks it
   up here to auto-fill name / category / price / image instead of typing.
   Shape: { [skuLower]: { sku, name, cat, price, image } }. Synced cloud-wide
   via app_state key "woo_catalog" (same pattern as categories/locations), so a
   catalog imported on desktop is instantly available to mobile scanning. */
const WOO_CATALOG_KEY = "ims_woo_catalog";
function loadWooCatalog() {
  if (window._DB_WOO_CATALOG && typeof window._DB_WOO_CATALOG === "object") return window._DB_WOO_CATALOG;
  try { const o = JSON.parse(localStorage.getItem(WOO_CATALOG_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch (e) { return {}; }
}
function saveWooCatalog(map) {
  const m = (map && typeof map === "object") ? map : {};
  window._DB_WOO_CATALOG = m;
  try { localStorage.setItem(WOO_CATALOG_KEY, JSON.stringify(m)); } catch (e) {} // quota — cloud still has it
  if (typeof dbSaveState === "function") dbSaveState("woo_catalog", m).catch(() => {});
  window.dispatchEvent(new CustomEvent("ims-woo-catalog-change"));
}
// Case-insensitive lookup by SKU. Returns { sku, name, cat, price, image } or null.
function wooCatalogLookup(sku) {
  if (!sku) return null;
  const m = loadWooCatalog();
  return m[String(sku).trim().toLowerCase()] || null;
}
// Upsert imported entries (array of {sku,name,cat,price,image}) by SKU.
// Returns { added, updated, total }.
function upsertWooCatalog(entries) {
  const m = { ...loadWooCatalog() };
  let added = 0, updated = 0;
  (entries || []).forEach(e => {
    if (!e || !e.sku) return;
    const k = String(e.sku).trim().toLowerCase();
    if (!k) return;
    if (m[k]) updated++; else added++;
    m[k] = {
      sku:   String(e.sku).trim(),
      name:  e.name ? String(e.name).trim() : "",
      cat:   e.cat ? String(e.cat).trim() : "",
      brand: e.brand ? String(e.brand).trim() : "",
      price: Number(e.price) || 0,
      image: e.image ? String(e.image).trim() : "",
      // Kept for the future web-page image fallback (build /?p=<id> or use link).
      id:    e.id ? String(e.id).trim() : "",
      link:  e.link ? String(e.link).trim() : ""
    };
  });
  saveWooCatalog(m);
  return { added, updated, total: Object.keys(m).length };
}
function clearWooCatalog() { saveWooCatalog({}); }
function wooCatalogCount() { return Object.keys(loadWooCatalog()).length; }

// Search products by NAME (or SKU) across BOTH live stock and the WooCommerce
// reference catalog — powers the "create product" name autocomplete. Returns a
// deduped, relevance-ranked list of {sku,name,cat,price,brand,image,source,inStock}.
// source: "stock" (already in inventory) | "catalog" (reference only).
function searchProductCandidates(query, limit = 12) {
  const q = String(query == null ? "" : query).trim().toLowerCase();
  if (!q) return [];
  const out = [], seen = new Set();
  const push = (o) => { const k = (o.sku || "").toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push(o); };
  // 1) Live stock first (these are the real things you already handle).
  for (const p of PRODUCTS) {
    if (((p.name || "") + " " + (p.sku || "")).toLowerCase().includes(q)) {
      push({
        sku: p.sku, name: p.name, cat: p.cat, price: p.price, brand: p.brand || "",
        image: (typeof resolveProductImage === "function" ? resolveProductImage(p.sku) : "") || "",
        source: "stock", inStock: true
      });
    }
  }
  // 2) WooCommerce reference catalog (may not be stocked yet).
  const cat = typeof loadWooCatalog === "function" ? loadWooCatalog() : {};
  for (const key in cat) {
    const e = cat[key];
    if (!e) continue;
    if (((e.name || "") + " " + (e.sku || "")).toLowerCase().includes(q)) {
      push({
        sku: e.sku, name: e.name, cat: e.cat, price: e.price, brand: e.brand || "",
        image: e.image || "", source: "catalog",
        inStock: PRODUCTS.some(p => (p.sku || "").toLowerCase() === (e.sku || "").toLowerCase())
      });
    }
  }
  // Rank: name-prefix matches first, then stock before catalog, then shorter name.
  out.sort((a, b) => {
    const ap = (a.name || "").toLowerCase().startsWith(q) ? 0 : 1;
    const bp = (b.name || "").toLowerCase().startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    if (a.source !== b.source) return a.source === "stock" ? -1 : 1;
    return (a.name || "").length - (b.name || "").length;
  });
  return out.slice(0, limit);
}

/* ── Near-duplicate SKU detection (scan funnel) ───────────────────────────
   When a scanned code matches NO product/catalog SKU *exactly*, find SKUs that
   are *almost* the same so the operator reuses the existing item instead of
   forking a duplicate. Catches the common real cases:
     • a brand prefix/suffix added or dropped — VE-75-ACC-05-BLK vs WST-VE-75-ACC-05-BLK
     • different separators / spacing — VE_75_ACC_05_BLK, "VE 75 ACC 05 BLK"
     • a 1–2 char OCR/typo — ...ACC-O5... (letter O) vs ...ACC-05... (zero)
   Tuned for PRECISION (no alarm fatigue): a different colour/size variant is a
   legitimately new SKU, NOT a duplicate, so it is intentionally NOT flagged.
   Searches live stock AND the Woo catalog; ranks stock first (a split stock
   item is the worst duplicate). Returns [] when nothing is convincingly close. */
function _skuNorm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s\-_/.]+/g, ""); }

// Visually-confusable character buckets (scanner / OCR / manual-entry slips).
// Two chars are interchangeable iff they share a bucket. Crucially, a digit is
// NOT confusable with a *different* digit — so 05 vs 03 (different accessories)
// and 05 vs 15 (different variant) stay DISTINCT, while O↔0 / S↔5 / I↔1 (a
// look-alike mis-scan of the SAME product) are caught. Strings are already
// lowercased by _skuNorm, so we map lowercase letters to their digit twin.
const _SKU_CONFUSE = (() => {
  const m = {};
  ["0oq", "1il", "5s", "8b", "2z", "6g"].forEach(g => { for (const ch of g) m[ch] = g[0]; });
  return m;
})();
function _skuCanonChar(ch) { return _SKU_CONFUSE[ch] || ch; }

// Similarity of two ALREADY-normalized SKUs. { score: 0 } = not a likely dup.
function _skuSimilarity(codeNorm, candNorm) {
  if (!codeNorm || !candNorm) return { score: 0, reason: "" };
  if (codeNorm === candNorm) return { score: 1, reason: "same" };   // differ only by separators/case
  const short = codeNorm.length <= candNorm.length ? codeNorm : candNorm;
  const long  = short === codeNorm ? candNorm : codeNorm;
  // Containment → a brand prefix/suffix was added or dropped (the common case).
  const at = long.indexOf(short);
  if (short.length >= 4 && at !== -1) {
    const ratio = short.length / long.length;            // how much of the longer SKU is shared
    if (ratio >= 0.6) {
      const clean = at === 0 || at + short.length === long.length;  // shared part is a clean prefix/suffix
      return { score: 0.9 + (clean ? 0.04 : 0) - (1 - ratio) * 0.1, reason: "affix" };
    }
  }
  // Look-alike typo → SAME length, every differing position is a confusable
  // pair, and only a few positions differ. (Different length or a real digit
  // swap falls through to "not a duplicate" — a deliberately tight net.)
  if (codeNorm.length === candNorm.length && codeNorm.length >= 4) {
    let diff = 0, ok = true;
    for (let i = 0; i < codeNorm.length; i++) {
      if (codeNorm[i] === candNorm[i]) continue;
      diff++;
      if (_skuCanonChar(codeNorm[i]) !== _skuCanonChar(candNorm[i])) { ok = false; break; }
    }
    if (ok && diff > 0 && diff <= Math.max(1, Math.floor(codeNorm.length * 0.25))) {
      return { score: 0.84 - (diff - 1) * 0.06, reason: "typo" };
    }
  }
  return { score: 0, reason: "" };
}

// Returns ranked near-matches: [{ sku,name,cat,brand,price,image,source,inStock,score,reason }].
// source: "stock" (live inventory) | "catalog" (Woo reference). Empty when none are close.
function findSimilarSkus(code, limit = 6) {
  const codeNorm = _skuNorm(code);
  if (codeNorm.length < 4) return [];               // too short to judge confidently
  const codeLower = String(code == null ? "" : code).trim().toLowerCase();
  const out = [], seen = new Set();
  const consider = (sku, o, source, inStock) => {
    const k = String(sku || "").toLowerCase();
    if (!k || k === codeLower || seen.has(k)) return;  // skip the exact code + already-listed SKUs
    const sim = _skuSimilarity(codeNorm, _skuNorm(sku));
    if (sim.score <= 0) return;
    seen.add(k);
    out.push({
      sku, name: o.name || "", cat: o.cat || "", brand: o.brand || "",
      price: o.price || 0, image: o.image || "",
      source, inStock, score: sim.score, reason: sim.reason,
    });
  };
  // 1) Live stock first — a split stock item is the worst kind of duplicate.
  for (const p of PRODUCTS) {
    consider(p.sku, {
      name: p.name, cat: p.cat, brand: p.brand, price: p.price,
      image: (typeof resolveProductImage === "function" ? resolveProductImage(p.sku) : ""),
    }, "stock", true);
  }
  // 2) Woo reference catalog (stock entries already seen are skipped via `seen`).
  const cat = typeof loadWooCatalog === "function" ? loadWooCatalog() : {};
  for (const key in cat) {
    const e = cat[key];
    if (!e) continue;
    const inStock = PRODUCTS.some(p => (p.sku || "").toLowerCase() === (e.sku || "").toLowerCase());
    consider(e.sku, e, "catalog", inStock);
  }
  out.sort((a, b) => (a.source !== b.source) ? (a.source === "stock" ? -1 : 1) : (b.score - a.score));
  return out.slice(0, limit);
}

/* ── In-progress inbound receiving draft ──
   The scanned-but-not-committed receiving list lives in component state, so
   leaving the Inbound screen (or a reload) used to lose it. Persist it to
   localStorage keyed by device so navigating away and back restores the count.
   Cleared on "ปิดงาน" (commit). Desktop + mobile share the key on one device. */
const INBOUND_DRAFT_KEY = "ims_inbound_draft";
function loadInboundDraft() {
  try { const a = JSON.parse(localStorage.getItem(INBOUND_DRAFT_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function saveInboundDraft(list) {
  try { localStorage.setItem(INBOUND_DRAFT_KEY, JSON.stringify(Array.isArray(list) ? list : [])); } catch (e) {}
}

/* ── Thai address gazetteer — data-anchored address splitting (no AI) ──
   `thai-address.json` is a list of [tambon, amphoe, province, zip] tuples
   (also used by the screens.jsx autocomplete). We index it once, then anchor
   the recipient parser on real postcode/district/sub-district/province data
   instead of blind length/keyword heuristics. Fast, offline, deterministic —
   a hedge for when the AI parse-recipient call is laggy. */
const __BKK = "กรุงเทพมหานคร";
function thaiProvinceVariants(prov) {
  return prov === __BKK
    ? [__BKK, "กรุงเทพมหานคร", "กรุงเทพฯ", "กรุงเทพ", "กทม.", "กทม"]
    : [prov];
}
function buildThaiIndex(rows) {
  const byZip = new Map(), byProvince = new Map(), provSet = new Set();
  for (const r of rows) {
    let z = byZip.get(r.zip); if (!z) { z = []; byZip.set(r.zip, z); } z.push(r);
    let p = byProvince.get(r.province); if (!p) { p = []; byProvince.set(r.province, p); } p.push(r);
    provSet.add(r.province);
  }
  const provVariants = [];
  for (const prov of provSet) for (const v of thaiProvinceVariants(prov)) provVariants.push({ v, prov });
  provVariants.sort((a, b) => b.v.length - a.v.length); // longest first → prefer specific
  return { rows, byZip, byProvince, provVariants };
}

let __thaiIdx = null, __thaiIdxPromise = null;
function ensureThaiAddrIndex() {
  if (__thaiIdx) return Promise.resolve(__thaiIdx);
  if (__thaiIdxPromise) return __thaiIdxPromise;
  // Reuse the screens.jsx loader's mapped rows when present (single fetch);
  // otherwise fetch + map the raw tuples ourselves.
  const rowsP = (typeof window !== "undefined" && typeof window.loadThaiAddresses === "function")
    ? Promise.resolve(window.loadThaiAddresses())
    : fetch("thai-address.json").then(r => r.json())
        .then(rows => rows.map(r => ({ tambon: r[0], amphoe: r[1], province: r[2], zip: String(r[3]) })));
  __thaiIdxPromise = rowsP
    .then(rows => { __thaiIdx = buildThaiIndex(rows || []); return __thaiIdx; })
    .catch(() => { __thaiIdx = buildThaiIndex([]); return __thaiIdx; });
  return __thaiIdxPromise;
}
function getThaiAddrIndex() { return __thaiIdx; }

/* Split a one-line address tail into { addr1, addr2 } + structured fields by
   anchoring on the gazetteer. Returns null when it can't confidently anchor
   (caller then falls back to its own heuristic). */
function parseThaiAddrTail(addr) {
  const idx = __thaiIdx;
  if (!idx || !idx.rows.length) return null;
  const s = String(addr || "").replace(/\s+/g, " ").trim();
  if (!s) return null;

  // Postcode = last 5-digit group (addresses end with it).
  const zipRe = /(?<!\d)(\d{5})(?!\d)/g;
  let m, lastZip = null, lastZipIdx = -1;
  while ((m = zipRe.exec(s)) !== null) { lastZip = m[1]; lastZipIdx = m.index; }

  // Candidate rows: by zip (strongest), else by a detected province name.
  let candidates = (lastZip && idx.byZip.get(lastZip)) || null;
  if (!candidates) {
    for (const { v, prov } of idx.provVariants) {
      if (s.indexOf(v) !== -1) { candidates = idx.byProvince.get(prov) || null; break; }
    }
  }
  if (!candidates) return null;

  // Find a name, preferring a prefixed occurrence (ตำบล/ต./แขวง …). A prefixed
  // hit is a far stronger signal than a bare one — it disambiguates Bangkok
  // collisions where a sub-district and district share a name (e.g. แขวงจอมพล
  // เขตจตุจักร, where "จตุจักร" is also a valid แขวง). Bare names fall back to
  // the LAST occurrence so a road named after a tambon doesn't split too early.
  const findName = (name, prefixes) => {
    if (!name) return { idx: -1, prefixed: false };
    for (const pre of prefixes) {
      let i = s.indexOf(pre + name); if (i !== -1) return { idx: i, prefixed: true };
      i = s.indexOf(pre + " " + name); if (i !== -1) return { idx: i, prefixed: true };
    }
    return { idx: s.lastIndexOf(name), prefixed: false };
  };

  let best = null;
  for (const row of candidates) {
    const t = findName(row.tambon, ["ตำบล", "ต.", "แขวง"]);
    const a = findName(row.amphoe, ["อำเภอ", "อ.", "เขต"]);
    let pIdx = -1;
    for (const pv of thaiProvinceVariants(row.province)) { const i = s.lastIndexOf(pv); if (i !== -1) { pIdx = i; break; } }
    let score = 0;
    if (t.idx !== -1) score += t.prefixed ? 3 : 1;
    if (a.idx !== -1) score += a.prefixed ? 3 : 1;
    if (pIdx !== -1) score += 1;
    if (lastZip && row.zip === lastZip) score += 1;
    // Reward correct Thai ordering: tambon → amphoe → province.
    if (t.idx !== -1 && a.idx !== -1 && t.idx < a.idx) score += 1;
    if (a.idx !== -1 && pIdx !== -1 && a.idx < pIdx) score += 1;
    if (!best || score > best.score) best = { row, score, tIdx: t.idx, aIdx: a.idx, pIdx };
  }
  if (!best || best.score < 3) return null; // too weak to trust → heuristic fallback

  // Decide where addr1 ends. Robust to prefixes written with a dot ("ต."),
  // without a dot ("ต "), as full words ("ตำบล/เขต"), combined ("แขวง/เขตX"),
  // or omitted entirely (the gazetteer still anchors via zip + names).
  const row = best.row;
  let provIdx = -1;
  for (const pv of thaiProvinceVariants(row.province)) { const i = s.lastIndexOf(pv); if (i !== -1) { provIdx = i; break; } }

  // Earliest index where `name` sits right after a (dotted/dotless/word) prefix.
  const prefixedIdx = (name, pres) => {
    for (const pre of pres) { const i = s.indexOf(pre + name); if (i !== -1) return i; }
    return -1;
  };
  const tPre = prefixedIdx(row.tambon, ["ตำบล", "แขวง", "ต.", "ต "]);
  const aPre = prefixedIdx(row.amphoe, ["อำเภอ", "เขต", "อ.", "อ "]);

  const cands = [];
  const kw = s.match(/แขวง|ตำบล|เขต|อำเภอ/);   // first full-word marker
  if (kw && kw.index >= 1) cands.push(kw.index);
  if (tPre >= 1) cands.push(tPre);
  if (aPre >= 1) cands.push(aPre);
  let split = cands.length ? Math.min(...cands) : -1;

  // No prefix typed at all → locate by bare name, bounded right-to-left
  // (tambon before amphoe before province/zip) so repeated names like
  // "ตาคลี ตาคลี" still split at the tambon, not the amphoe.
  if (split < 1) {
    const bound = provIdx >= 0 ? provIdx : (lastZipIdx >= 0 ? lastZipIdx : s.length);
    const aBare = s.lastIndexOf(row.amphoe, Math.max(0, bound - 1));
    const tBound = aBare > 0 ? aBare : bound;
    const tBare = s.lastIndexOf(row.tambon, Math.max(0, tBound - 1));
    split = tBare >= 1 ? tBare : (aBare >= 1 ? aBare : (best.tIdx >= 1 ? best.tIdx : best.aIdx));
  }
  if (split == null || split < 1) return null;

  const confidence = (best.tIdx >= 0 && best.aIdx >= 0 && lastZip) ? "high"
    : (best.score >= 3 ? "medium" : "low");
  const addr1 = s.slice(0, split).trim();
  const addr2Raw = s.slice(split).trim();
  // On a confident, zip-anchored match, rewrite the tail to the canonical
  // form — fills in ต./อ./จ. (or แขวง/เขต for Bangkok) when the customer typed
  // them dotless or omitted them, and fixes any out-of-order zip/province.
  const addr2 = confidence === "high"
    ? (best.row.province === __BKK
        ? `แขวง${best.row.tambon} เขต${best.row.amphoe} กรุงเทพมหานคร ${best.row.zip}`
        : `ต.${best.row.tambon} อ.${best.row.amphoe} จ.${best.row.province} ${best.row.zip}`)
    : addr2Raw;
  return {
    addr1, addr2, addr2Raw,
    tambon: best.row.tambon, amphoe: best.row.amphoe, province: best.row.province, zip: best.row.zip,
    confidence,
  };
}

/* ── Brand auto-guess from SKU ──
   Brands usually lead the SKU (e.g. "AFG-HP005-SV-BK" → AFG). We first LEARN:
   the most common brand among existing products that share the same SKU prefix
   (so once a brand is tagged for "AFG-…", future "AFG-…" scans auto-fill it).
   If nothing is learned yet, we fall back to the leading SKU segment itself. */
function skuBrandPrefix(sku) {
  const s = String(sku || "").trim().toUpperCase();
  if (!s) return "";
  const seg = s.split(/[-_/\s]/)[0];           // part before first separator
  if (seg && seg.length >= 2 && seg !== s) return seg;
  const lead = s.match(/^[A-Z]+/);             // no separator → leading letters
  if (lead && lead[0].length >= 2) return lead[0];
  return seg || s;
}
function guessBrandFromSku(sku) {
  const pre = skuBrandPrefix(sku);
  if (!pre) return "";
  // 1) Learned: most common brand among products sharing this SKU prefix.
  const counts = {};
  for (const p of PRODUCTS) {
    if (p.brand && skuBrandPrefix(p.sku) === pre) counts[p.brand] = (counts[p.brand] || 0) + 1;
  }
  const learned = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  if (learned) return learned;
  // 2) Fallback: the prefix itself (brand usually leads the SKU).
  return pre;
}

/* ── Offline write queue ──────────────────────────────────────────────────
   Failed DB writes (network down / RLS block) are enqueued here and retried
   automatically on the next "online" event. Entry shape: { id, type, payload, ts }. */
const IMS_QUEUE_KEY = "ims_offline_queue_v1";
function loadOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(IMS_QUEUE_KEY) || "[]"); } catch (e) { return []; }
}
function _saveQueue(q) {
  try { localStorage.setItem(IMS_QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-queue-change", { detail: { count: q.length } }));
}
function enqueueOfflineWrite(type, payload) {
  const q = loadOfflineQueue();
  q.push({ id: "q" + Date.now(), type, payload, ts: new Date().toISOString() });
  _saveQueue(q);
}
// Remove ONE item from the stored queue by id. Re-reads first so items enqueued
// during a flush aren't clobbered.
function _removeQueueItem(id) {
  _saveQueue(loadOfflineQueue().filter(it => it.id !== id));
}
let __queueFlushing = false;                 // same-tab reentrancy guard
const IMS_QUEUE_LOCK_KEY = "ims_queue_lock"; // best-effort cross-tab lease
const QUEUE_LOCK_MS = 30000;
const QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // give up on an item after 7 days
async function flushOfflineQueue() {
  if (!navigator.onLine || __queueFlushing) return;
  // Cross-tab lease: if another tab/window claimed the queue within QUEUE_LOCK_MS,
  // skip so a PWA window + a browser tab don't both replay the same items.
  try { const lk = Number(localStorage.getItem(IMS_QUEUE_LOCK_KEY) || 0); if (lk && Date.now() - lk < QUEUE_LOCK_MS) return; } catch (e) {}
  const q = loadOfflineQueue();
  if (!q.length) return;
  __queueFlushing = true;
  try { localStorage.setItem(IMS_QUEUE_LOCK_KEY, String(Date.now())); } catch (e) {}
  let done = 0;
  try {
    for (const item of q) {
      let ok = false;
      try {
        if (item.type === "orders" && typeof dbUpsertOrders === "function") {
          const r = await dbUpsertOrders(item.payload);
          ok = !!(r && r.ok);
        } else if (item.type === "labels" && typeof dbUpsertLabels === "function") {
          const r = await dbUpsertLabels(item.payload);
          ok = !!(r && r.ok);
        } else if (item.type === "deduct" && typeof dbDeductStock === "function") {
          const r = await dbDeductStock(item.payload);
          if (r && r.ok) { _applyServerQty(r.rows); ok = true; }
          // A permission block won't fix itself by retrying — consume the item
          // (canonical state was already reloaded by the caller's error path).
          else if (r && r.error === "PERMISSION_OR_MISSING") ok = true;
        } else if (item.type === "adjust" && typeof dbAdjustStock === "function") {
          const r = await dbAdjustStock(item.payload);
          if (r && r.ok) { _applyServerQty(r.rows); ok = true; }
          else if (r && r.error === "PERMISSION_OR_MISSING") ok = true;
          // NOTE: do NOT consume on RPC_MISSING — that would drop the delta forever
          // (local-only, never reaches the DB). Leave it queued so it replays once
          // adjust-stock.sql is deployed (mirrors the "deduct" branch).
        } else if (item.type === "delete-order" && typeof dbDeleteOrder === "function") {
          let allOk = true;
          for (const id of (item.payload || [])) {
            const r = await dbDeleteOrder(id).catch(e => ({ error: String(e) }));
            if (r && r.error && r.error !== "PERMISSION_OR_MISSING") allOk = false; // 0-row = already gone
          }
          ok = allOk;
        } else if (item.type === "delete-label" && typeof dbDeleteLabel === "function") {
          let allOk = true;
          for (const lid of (item.payload || [])) {
            const r = await dbDeleteLabel(lid).catch(e => ({ error: String(e) }));
            if (r && r.error && r.error !== "PERMISSION_OR_MISSING") allOk = false;
          }
          ok = allOk;
        } else if (["orders", "labels", "deduct", "adjust", "delete-order", "delete-label"].includes(item.type)) {
          // The DB helper isn't loaded yet — DON'T consume (avoids silently
          // dropping a real write); leave it for the next flush.
          ok = false;
        } else {
          ok = true; // unknown/legacy type — consume so it can't loop forever
        }
      } catch (e) {}
      // Give up on an item that has been failing for too long (e.g. a sale a
      // genuinely-unauthorized account made, or an off-hours RLS block that never
      // clears) so it can't pin the pending-sync badge forever. Transient blocks
      // resolve well before this via the online/focus/visibility/startup triggers.
      let expired = false;
      if (!ok && item.ts) {
        const ageMs = Date.now() - Date.parse(item.ts);
        if (Number.isFinite(ageMs) && ageMs > QUEUE_MAX_AGE_MS) {
          expired = true;
          window.dispatchEvent(new CustomEvent("ims-toast", { detail: "มีข้อมูลค้างซิงค์เกิน 7 วันและถูกยกเลิก — โปรดตรวจสอบสิทธิ์/การเชื่อมต่อ" }));
        }
      }
      // Persist success IMMEDIATELY so a tab closed mid-flush can't replay an
      // already-applied write (the old code saved survivors only once, at the end).
      // An expired item is removed too, but NOT counted as a success (it was given
      // up on, not synced — so the "N synced ✓" toast can't misreport it).
      if (ok) { _removeQueueItem(item.id); done++; }
      else if (expired) { _removeQueueItem(item.id); }
    }
  } finally {
    __queueFlushing = false;
    try { localStorage.removeItem(IMS_QUEUE_LOCK_KEY); } catch (e) {}
  }
  if (done > 0) window.dispatchEvent(new CustomEvent("ims-toast", { detail: { msg: "ซิงค์ข้อมูลค้าง " + done + " รายการสำเร็จ ✓" } }));
}
// Retry triggers. The "online" event never fires on an already-online device, so
// a session closed offline and relaunched on Wi-Fi would otherwise never flush —
// hence the focus/visibility triggers and the post-dbInit flush (app.jsx).
window.addEventListener("online", function() { if (typeof flushOfflineQueue === "function") flushOfflineQueue(); });
window.addEventListener("focus", function() { if (typeof flushOfflineQueue === "function") flushOfflineQueue(); });
document.addEventListener("visibilitychange", function() { if (document.visibilityState === "visible" && typeof flushOfflineQueue === "function") flushOfflineQueue(); });

function printBarcodeLabels(items, pushToast) {
  const safe = (str) => String(str == null ? "" : str).replace(/[<>&]/g, "");
  const filtered = (items || []).filter(Boolean);
  if (!filtered.length) { if (typeof pushToast === "function") pushToast("ไม่มีสินค้าให้พิมพ์"); return; }
  const w = window.open("", "_blank", "width=480,height=320");
  if (!w) { if (typeof pushToast === "function") pushToast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปแล้วลองใหม่"); return; }
  const labels = filtered.map((item, idx) => {
    const svg = (typeof barcodeSvgMarkup === "function") ? barcodeSvgMarkup(item.sku, { height: 80, moduleWidth: 2 }) : "";
    const isLast = idx === filtered.length - 1;
    return `<div class="label${isLast ? " last" : ""}"><div class="name">${safe(item.name)}</div><div class="bc">${svg}</div><div class="sku">${safe(item.sku)}</div></div>`;
  }).join("");
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บาร์โค้ด</title>
<style>
@page{size:50mm 30mm;margin:0}
html,body{margin:0;padding:0}
body{font-family:'IBM Plex Mono',monospace}
.label{width:50mm;height:30mm;overflow:hidden;padding:2.5mm 2mm;box-sizing:border-box;text-align:center;page-break-after:always}
.label:last-child,.label.last{page-break-after:auto}
.name{font-size:10px;line-height:1.2;max-height:2.4em;overflow:hidden;margin-bottom:1mm}
.bc svg{width:auto;max-width:46mm;height:13mm;display:block;margin:0 auto}
.sku{font-size:13px;font-weight:600;letter-spacing:1px;margin-top:1mm}
</style></head>
<body onload="window.focus();window.print();">${labels}</body></html>`);
  w.document.close();
}

function openPickListWindow(orders, pushToast) {
  if (!orders || !orders.length) { if (typeof pushToast === "function") pushToast("ไม่มีออร์เดอร์ที่ต้องหยิบ"); return; }
  const safe = (str) => String(str == null ? "" : str).replace(/[<>&]/g, "");
  const w = window.open("", "_blank");
  if (!w) { if (typeof pushToast === "function") pushToast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปแล้วลองใหม่"); return; }
  const rows = orders.map((o, i) => `<tr><td class="mono">${i+1}</td><td class="mono">${safe(o.id)}</td><td>${safe(o.customer)||"—"}</td><td>${safe(o.channel)||"—"}</td><td style="text-align:center">${o.items||0}</td><td>${safe(o.carrier)||"—"}</td><td>${{picking:"กำลังหยิบ",packed:"พร้อมส่ง"}[o.status]||safe(o.status)}</td></tr>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><title>Pick List</title>
<style>*{box-sizing:border-box}body{font-family:sans-serif;padding:24px;color:#111;font-size:13px}h2{margin:0 0 2px;font-size:18px}p{margin:0 0 16px;color:#666}button{padding:8px 18px;cursor:pointer;margin-bottom:16px;font-size:13px}table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}td{padding:8px 10px;border-bottom:1px solid #eee}tr:hover td{background:#fafafa}.mono{font-family:monospace;font-size:12px}@media print{button{display:none!important}}</style>
</head><body onload="window.focus();window.print();">
<h2>Pick List</h2><p>${new Date().toLocaleDateString("th-TH",{dateStyle:"full"})} · ${orders.length} ออร์เดอร์</p>
<button onclick="window.print()">🖨 พิมพ์</button>
<table><thead><tr><th>#</th><th>เลขออร์เดอร์</th><th>ลูกค้า</th><th>ช่องทาง</th><th>รายการ</th><th>ขนส่ง</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`);
  w.document.close();
}

/* ── Daily stock report (Excel) ──
   Builds a real .xlsx snapshot of current stock for daily backup / quantity
   checking. Shared by the in-app "download today" button (desktop Inventory +
   mobile). The nightly Drive backup (backup-to-drive Edge Function) reimplements
   the SAME columns server-side in Deno — keep the two column lists in sync.

   The "เปลี่ยนจากเมื่อวาน" (change vs yesterday) column comes from a per-day qty
   snapshot stored in app_state under STOCK_SNAPSHOT_KEY as
   { date: "YYYY-MM-DD", map: { sku: qty } }. The nightly cron WRITES it; the
   in-app button only READS the latest one (= yesterday's end-of-day) so it can
   never race the cron. If no snapshot exists yet the delta shows "—". */
const STOCK_SNAPSHOT_KEY = "stock_snapshot_daily";
const STOCK_REPORT_HEADERS = ["SKU", "ชื่อสินค้า", "หมวดหมู่", "แบรนด์", "คงเหลือ", "จองแล้ว", "จุดสั่งซื้อ", "ตำแหน่ง", "ราคาขาย", "ต้นทุน", "มูลค่าสต็อก", "เปลี่ยนจากเมื่อวาน", "สถานะ"];

function stockReportRows(products, prevMap) {
  prevMap = prevMap || {};
  return (products || []).map(p => {
    const qty = Number(p.qty) || 0;
    const cost = Number(p.cost) || 0;
    const prev = prevMap[p.sku];
    const hasPrev = typeof prev === "number";
    const delta = hasPrev ? qty - prev : null;
    const s = (typeof stockStatus === "function") ? stockStatus(p) : { label: "" };
    return [
      p.sku, p.name || "", p.cat || "", p.brand || "",
      qty, Number(p.reserved) || 0, Number(p.reorder) || 0,
      p.loc || "", Number(p.price) || 0, cost, qty * cost,
      hasPrev ? (delta > 0 ? "+" + delta : String(delta)) : "—",
      s.label
    ];
  });
}

// Column indices of the two money columns (ต้นทุน, มูลค่าสต็อก) — stripped for
// roles without the viewCost capability.
const STOCK_REPORT_COST_COLS = [9, 10];

/* Assemble the two-sheet workbook (สรุป summary + สต็อก detail). Returns null if
   the XLSX library hasn't loaded yet. showCost === false drops both cost columns
   and the stock-value total, so a staff download carries no cost data at all —
   the nightly cron always passes the full set. */
function buildStockReportWorkbook(products, prevMap, dateStr, showCost) {
  if (typeof XLSX === "undefined") return null;
  const withCost = showCost !== false;
  const rows = stockReportRows(products, prevMap);
  // Totals read the FULL rows, so they stay correct whichever columns ship.
  const totalQty = rows.reduce((s, r) => s + (r[4] || 0), 0);
  const totalVal = rows.reduce((s, r) => s + (r[10] || 0), 0);
  const outCnt = rows.filter(r => r[4] === 0).length;
  const lowCnt = rows.filter(r => r[4] > 0 && r[4] <= r[6]).length;

  const keep = (arr) => withCost ? arr : arr.filter((_, i) => STOCK_REPORT_COST_COLS.indexOf(i) === -1);
  const ws = XLSX.utils.aoa_to_sheet([keep(STOCK_REPORT_HEADERS), ...rows.map(keep)]);
  ws["!cols"] = keep([{ wch: 16 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 15 }, { wch: 18 }]);

  const wsSum = XLSX.utils.aoa_to_sheet([
    ["รายงานสต็อกประจำวัน — คลังพร้อมส่ง (PS TACTICAL)"],
    ["วันที่", dateStr],
    [""],
    ["จำนวน SKU", rows.length],
    ["รวมจำนวนชิ้น", totalQty],
    ...(withCost ? [["มูลค่าสต็อกรวม (บาท)", totalVal]] : []),
    ["สินค้าหมดสต็อก", outCnt],
    ["ต่ำกว่าจุดสั่งซื้อ", lowCnt]
  ]);
  wsSum["!cols"] = [{ wch: 30 }, { wch: 22 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSum, "สรุป");
  XLSX.utils.book_append_sheet(wb, ws, "สต็อก");
  return wb;
}

// Build + download today's stock report. `products` defaults to the live PRODUCTS
// array. Reads yesterday's snapshot from app_state for the delta column.
async function downloadStockReport(products) {
  const toast = (m) => { if (typeof pushToast === "function") pushToast(m); };
  if (typeof XLSX === "undefined") { toast("ไลบรารี Excel ยังไม่พร้อม กรุณารอสักครู่"); return; }
  const list = products || (typeof PRODUCTS !== "undefined" ? PRODUCTS : []);
  if (!list.length) { toast("ยังไม่มีข้อมูลสินค้า"); return; }
  let prevMap = {};
  try {
    if (typeof dbLoadState === "function") {
      const snap = await dbLoadState(STOCK_SNAPSHOT_KEY);
      if (snap && snap.map && typeof snap.map === "object") prevMap = snap.map;
    }
  } catch (_) { /* offline / no snapshot yet — delta column just shows "—" */ }
  const dateStr = (typeof todayIso === "function") ? todayIso() : new Date().toISOString().slice(0, 10);
  const wb = buildStockReportWorkbook(list, prevMap, dateStr, typeof canDo !== "function" || canDo("viewCost"));
  if (!wb) { toast("สร้างไฟล์ Excel ไม่สำเร็จ"); return; }
  try { XLSX.writeFile(wb, `รายงานสต็อก_${dateStr}.xlsx`); }
  catch (e) { toast("บันทึกไฟล์ Excel ไม่สำเร็จ"); return; }
  toast(`ดาวน์โหลดรายงานสต็อก ${list.length} รายการแล้ว`);
}

Object.assign(window, {
  STOCK_SNAPSHOT_KEY, stockReportRows, buildStockReportWorkbook, downloadStockReport,
  skuBrandPrefix, guessBrandFromSku,
  ensureThaiAddrIndex, getThaiAddrIndex, parseThaiAddrTail,
  playScanBeep, playScanErrorBeep, genOrderId, snapLineItem,
  loadStockTake, saveStockTake, applyStockCounts,
  loadWooCatalog, saveWooCatalog, wooCatalogLookup, upsertWooCatalog, clearWooCatalog, wooCatalogCount, searchProductCandidates, findSimilarSkus,
  omit,
  PRODUCTS, stockStatus, INBOUND, OUTBOUND, ACTIVITY, LOCATIONS, CHANNELS, CHANNEL_LIST, channelSalesFor, LABEL_SIZES, SAMPLE_LABELS,
  USERS, ROLES, ROLE_NAV, CARRIERS, TODAY_ISO, todayIso, bangkokDateOf, isoToThai,
  nowBkkLocal, stockOutStamp, stockOutStampLabel,
  CAPS, DEFAULT_ROLE_CAPS, ROLE_PERMS_KEY, loadRolePerms, saveRolePerms, roleNav, canOpenPage, canDo, capServerLocked, currentRoleId,
  saveProductStore, addProductToStore, updateProductInStore, updateManyProducts, adjustProductQty, setProductAbsolute, importProductsBulk, removeProductsFromStore, resetProductStore,
  deductStockAndPersist, deductManyAndPersist,
  applyStockAdjustment, applyStockAdjustmentBatch, ADJUST_REASONS, canAdjustStock,
  loadOrders, saveOrders, appendOrder,
  loadLocTree, saveLocTree, locCode, allPositions, allLocationCodes, skusInLocation, canDeleteData, searchProductsForLocation, locParts,
  storedLocSet, locIsStored, countUnstoredProducts,
  loadProductLocs, locSplitFor, hasLocSplit, locSplitTotal, productPositions, qtyAtLocation, productsInLocation, saveLocSplit,
  applyLocPicks, defaultPickLoc, moveStockToLocation, applyReceiveLocs,
  addBuilding, renameBuilding, removeBuilding, addFloor, renameFloor, removeFloor,
  addPosition, renamePosition, removePosition,
  loadInboundDraft, saveInboundDraft,
  defaultWorkHours, workHoursStatus, workHoursMessage, hmToMinutes, bangkokParts, WORKHOURS_DAY_LABELS,
  bangkokDateStr, workHoursExceptionDate, hasActiveWorkHoursException, workHoursStatusForUser,
  loadOfflineQueue, enqueueOfflineWrite, flushOfflineQueue,
  printBarcodeLabels, openPickListWindow
});
