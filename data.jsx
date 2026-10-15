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
    const seq = beginProductsFetch();
    dbLoadProducts().then(fresh => hydrateProductsFromServer(fresh, seq)).catch(() => {});
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
/* Resolves with what the SERVER actually did, so callers can record the truth
   instead of the value this device predicted:
     { ok:true, before, after }  — applied; before/after are server-canonical
     { queued:true }             — offline/failed, replays later, outcome unknown
     { blocked:true }            — RLS refused it; nothing moved, log nothing
     { ok:false }                — no answer (RPC missing → absolute fallback wrote it)
   `before` needs the 2-arg RPC from supabase/stock-rpc-return-before.sql; without
   it the field is simply absent and the caller falls back to its own estimate. */
async function _syncQtyDelta(sku, delta) {
  if (!delta) return { ok: false };
  if (typeof dbAdjustStock !== "function") { _syncProductRows([sku]); return { ok: false }; }
  // ONE op id for this write and every retry of it — a request that timed out
  // after the server committed is recognised on replay instead of applied twice.
  const opId = genOpId();
  if (!navigator.onLine) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("adjust", [{ sku, delta }], opId);
    return { queued: true };
  }
  try {
    const res = await dbAdjustStock([{ sku, delta }], opId);
    if (res && res.ok) { _applyServerQty(res.rows); return _serverMove(res.rows, sku); }
    if (res && res.error === "RPC_MISSING") { _syncProductRows([sku]); return { ok: false }; }
    if (res && res.error === "PERMISSION_OR_MISSING") {
      _applyServerQty(res.rows); _onProductWriteResult(res);
      // If this sku came back it DID move; otherwise RLS refused it and nothing
      // happened — which must not be logged as a movement.
      const m = _serverMove(res.rows, sku);
      return m.ok ? m : { blocked: true };
    }
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("adjust", [{ sku, delta }], opId);
    return { queued: true };
  } catch (e) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("adjust", [{ sku, delta }], opId);
    return { queued: true };
  }
}
// Pull one sku's server-canonical before/after out of an RPC result.
function _serverMove(rows, sku) {
  const row = (Array.isArray(rows) ? rows : []).find(r => r && r.sku === sku);
  if (!row || typeof row.qty !== "number") return { ok: false };
  const out = { ok: true, after: row.qty };
  if (typeof row.before === "number") out.before = row.before;
  return out;
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
/* Rename a product's SKU (the primary key) — a rare, deliberate admin/manager
   action to correct a wrong code, not a routine field edit. Goes through the
   rename_product_sku RPC (supabase/rename-sku-cascade.sql): bundle_items,
   stock_adjustments and product_locations follow via ON UPDATE CASCADE, so
   this function only has to fix up the client-side state that ISN'T FK-linked —
   the in-memory PRODUCTS row (mutated in place, same object) and the per-sku
   product photo (app_state key "img:<sku>"). A sku that only exists as a
   historical SNAPSHOT (orders.lineItems, past audit entries) is left alone on
   purpose — those describe what happened under the old code, not live state. */
async function renameProductSku(oldSku, newSku) {
  const from = String(oldSku || "").trim();
  const to = String(newSku || "").trim();
  if (!from || !to || from === to) return { ok: false, error: "INVALID" };
  if (PRODUCTS.some(p => p.sku === to)) {
    try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: `รหัส ${to} มีอยู่แล้ว` })); } catch (e) {}
    return { ok: false, error: "DUPLICATE" };
  }
  if (typeof dbRenameSku !== "function") return { ok: false, error: "OFFLINE" };

  const res = await dbRenameSku(from, to);
  if (!res || !res.ok) {
    const err = res && res.error;
    const msg = err === "DUPLICATE" ? `รหัส ${to} มีอยู่แล้ว`
      : err === "PERMISSION_OR_MISSING" ? "ไม่มีสิทธิ์เปลี่ยนรหัส SKU (ต้องเป็นผู้ดูแลระบบหรือผู้จัดการ)"
      : err === "NOT_FOUND" ? `ไม่พบสินค้า ${from}`
      : err === "RPC_MISSING" ? "ยังไม่ได้ติดตั้งฟังก์ชันเปลี่ยน SKU บนเซิร์ฟเวอร์ (rename-sku-cascade.sql)"
      : "เปลี่ยนรหัส SKU ไม่สำเร็จ";
    try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: msg })); } catch (e) {}
    return { ok: false, error: err || "UNKNOWN" };
  }

  const finalSku = res.sku || to;
  const p = PRODUCTS.find(x => x.sku === from);
  if (p) p.sku = finalSku;
  /* The shelf rows followed on the server (ON UPDATE CASCADE) but this device's
     cached split was still keyed by the OLD sku — so the renamed product looked
     shelf-less here, and a receive right after the rename never reached its
     shelf (AFG-VT36/37-C-BK-M, 23 Sep: stock 22/28 vs shelf 2/10). */
  if (typeof loadProductLocs === "function" && typeof _mirrorProductLocs === "function") {
    const locMap = loadProductLocs();
    if (locMap && locMap[from]) {
      const next = { ...locMap };
      next[finalSku] = next[from];
      delete next[from];
      _mirrorProductLocs(next);
    }
  }
  // The photo is keyed by sku in app_state, not FK-linked — carry it across by hand.
  if (typeof loadProductImages === "function" && typeof setProductImage === "function") {
    const img = loadProductImages()[from];
    if (img) { setProductImage(finalSku, img); setProductImage(from, null); }
  }
  _persistProductsLocal();   // also fires ims-products-change
  return { ok: true, sku: finalSku };
}
// Apply a RELATIVE stock change (inbound receive, manual adjust) as an atomic
// server-side delta. Callers pass the RAW delta — no absolute round-trip for the
// client to reverse-engineer, so a pending display overlay (ims_stock_adj) or a
// stale local qty can't corrupt the amount applied to the server.
function adjustProductQty(sku, delta) {
  const d = Number(delta) || 0;
  if (!d) return Promise.resolve({ ok: false });
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return Promise.resolve({ ok: false });
  p.qty = Math.max(0, (Number(p.qty) || 0) + d);
  _persistProductsLocal();
  // Returns the server's verdict (see _syncQtyDelta). Callers that only move
  // stock can ignore it; callers that RECORD the move must not.
  return _syncQtyDelta(sku, d);
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
      const seq = beginProductsFetch();
      const fresh = await dbLoadProducts();
      hydrateProductsFromServer(fresh, seq);
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
  const prev = window._DB_CATEGORIES;
  const prevMirror = (() => { try { return localStorage.getItem("ims_categories"); } catch (e) { return null; } })();
  try { localStorage.setItem("ims_categories", JSON.stringify(cats)); } catch (e) {}
  window._DB_CATEGORIES = cats;
  window.dispatchEvent(new CustomEvent("ims-categories-change"));
  if (!window.dbSaveState) return;
  dbSaveState("categories", cats).then(res => {
    if (!res || !res.error) return;
    window._DB_CATEGORIES = prev;
    try {
      if (prevMirror == null) localStorage.removeItem("ims_categories");
      else localStorage.setItem("ims_categories", prevMirror);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("ims-categories-change"));
    _blobWriteFailed("หมวดหมู่", res.error);
  }).catch(e => _blobWriteFailed("หมวดหมู่", String(e && e.message || e)));
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

/* ══════════════════════════════════════════════════════════════════════
   STOCK WRITE INTEGRITY — "บันทึกซ้ำ / รายการหาย" (2026-09-19)

   Three distinct failure modes produced the same symptom (a movement counted
   twice, or one that vanished and got re-entered by hand):

   1. RETRY AFTER AN UNCERTAIN FAILURE. deduct_stock/adjust_stock apply a
      DELTA. When a request timed out after the server had already committed,
      the offline queue replayed it and moved the stock a second time. Every
      call now carries an operation id (genOpId) which the server records once
      — a replay of the same id returns the current qty instead of re-applying.
      Before the SQL is deployed the id is simply ignored, so this is safe to
      ship first (see supabase/stock-op-idempotency.sql).

   2. DOUBLE COMMIT. The count / receive / adjust confirmations had no
      in-flight latch: a double-tap, or a reload that restored the draft after
      the write landed, ran the same batch twice. claimCommit() is a
      synchronous, localStorage-backed latch — immune to React batching and to
      a page reload — keyed by a fingerprint of the payload.

   3. A PENDING WRITE WIPED OFF THE SCREEN. Every server snapshot replaced
      PRODUCTS wholesale, so a change still sitting in the offline queue
      disappeared from the display; staff then entered it again and the queue
      later replayed the first copy too. hydrateProductsFromServer() re-applies
      queued deltas on top of the snapshot and refuses an out-of-order response.
   ══════════════════════════════════════════════════════════════════════ */

/* Operation id for ONE stock write. Generated before the first attempt and
   reused by every retry of that same write — that is what makes the retry
   idempotent server-side. */
function genOpId() {
  return "op" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* ── Duplicate-commit latch ──
   claimCommit(key) returns true at most once per COMMIT_GUARD_MS for a given
   key. Synchronous (a double-tap can't slip between two React renders) and
   mirrored in localStorage (a reload that restores an inbound draft can't
   re-commit a batch that already landed). Callers pass a key built from the
   flow + the payload, so a genuinely different batch is never blocked. */
const COMMIT_GUARD_KEY = "ims_commit_guard_v1";
/* Long enough to swallow a double-tap, a double-fired confirm and a reload that
   races the draft clear; short enough that a deliberate repeat of an identical
   batch (scan one more of the same sku, close again) just works. */
const COMMIT_GUARD_MS = 8000;
const COMMIT_GUARD_MAX = 40;
function _loadCommitGuard() {
  try { const o = JSON.parse(localStorage.getItem(COMMIT_GUARD_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch (e) { return {}; }
}
/* Stable short fingerprint of a commit payload — same items, same amounts,
   same key, regardless of row order. */
function commitFingerprint(flow, rows) {
  const parts = (Array.isArray(rows) ? rows : [])
    .map(r => [r && (r.sku || r.id || ""), r && (r.qty != null ? r.qty : r.delta != null ? r.delta : r.to), r && r.ch ? r.ch : ""].join("~"))
    .sort();
  let h = 5381;
  const str = String(flow) + "|" + parts.join("|");
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return String(flow) + ":" + h.toString(36) + ":" + parts.length;
}
function claimCommit(key) {
  const now = Date.now();
  const g = _loadCommitGuard();
  const last = Number(g[key]) || 0;
  if (last && now - last < COMMIT_GUARD_MS) return false;
  g[key] = now;
  // Prune expired/oldest so the blob can't grow without bound.
  const live = Object.keys(g).filter(k => now - (Number(g[k]) || 0) < COMMIT_GUARD_MS)
    .sort((a, b) => g[b] - g[a]).slice(0, COMMIT_GUARD_MAX);
  const next = {};
  live.forEach(k => { next[k] = g[k]; });
  try { localStorage.setItem(COMMIT_GUARD_KEY, JSON.stringify(next)); } catch (e) {}
  return true;
}
// Release a claim that turned out not to have committed (validation refused it),
// so the user can correct the batch and submit it straight away.
function releaseCommit(key) {
  const g = _loadCommitGuard();
  if (!(key in g)) return;
  delete g[key];
  try { localStorage.setItem(COMMIT_GUARD_KEY, JSON.stringify(g)); } catch (e) {}
}
function duplicateCommitToast() {
  window.dispatchEvent(new CustomEvent("ims-toast", {
    detail: "รายการนี้เพิ่งถูกบันทึกไปเมื่อสักครู่ — ระบบกันบันทึกซ้ำไว้ให้ (ถ้าต้องการบันทึกซ้ำจริง รออีก 8 วินาที)"
  }));
}

/* ── Pending (not-yet-synced) stock deltas ──
   Sum of every queued deduct/adjust, per sku. A server snapshot knows nothing
   about them, so it must not be shown raw or the staff member sees their own
   work disappear. */
function pendingStockDeltas() {
  const out = {};
  (typeof loadOfflineQueue === "function" ? loadOfflineQueue() : []).forEach(it => {
    if (!it || !Array.isArray(it.payload)) return;
    if (it.type === "deduct") it.payload.forEach(d => {
      if (d && d.sku) out[d.sku] = (out[d.sku] || 0) - (Number(d.qty) || 0);
    });
    else if (it.type === "adjust") it.payload.forEach(a => {
      if (a && a.sku) out[a.sku] = (out[a.sku] || 0) + (Number(a.delta) || 0);
    });
  });
  return out;
}
function applyPendingStockDeltas() {
  const pend = pendingStockDeltas();
  let n = 0;
  Object.keys(pend).forEach(sku => {
    if (!pend[sku]) return;
    const p = PRODUCTS.find(x => x.sku === sku);
    if (!p) return;
    p.qty = Math.max(0, (Number(p.qty) || 0) + pend[sku]);
    n++;
  });
  return n;
}

/* ── Server snapshot → PRODUCTS, safely ──
   beginProductsFetch() before the request, hydrateProductsFromServer(rows, seq)
   with the result. An older response that lands after a newer one is dropped
   (two realtime events in flight used to leave the stale snapshot winning), and
   queued-but-unsynced deltas are folded back in so nothing vanishes. */
let _prodFetchSeq = 0;
let _prodAppliedSeq = 0;
function beginProductsFetch() { return ++_prodFetchSeq; }
function hydrateProductsFromServer(rows, seq) {
  if (!Array.isArray(rows)) return false;
  if (seq != null) {
    if (seq < _prodAppliedSeq) return false;   // a newer snapshot already landed
    _prodAppliedSeq = seq;
  }
  PRODUCTS.length = 0;
  rows.forEach(r => PRODUCTS.push(r));
  applyPendingStockDeltas();
  _persistProductsLocal();
  return true;
}

/* ── One movement ledger for every stock write ──
   stock_adjustments started life as the ปรับสต็อก-only history, which is why
   the product drawer could show a correction but never the receive or the sale
   that actually moved the stock — the "รายการหายไป" half of the complaint.
   Every flow now appends here: รับเข้า, ตัดสต็อก, ตรวจนับ and ปรับสต็อก.
   Best-effort (the atomic qty write is the authoritative one) and silent on
   failure: the write path it follows has already surfaced its own toast.
   entries = [{ sku, delta, reason }] */
function recordStockMoves(entries, reason) {
  if (typeof dbInsertStockAdjustment !== "function") return;
  const rows = (Array.isArray(entries) ? entries : [])
    .map(e => ({ sku: e && e.sku, delta: Math.trunc(Number(e && e.delta) || 0), reason: (e && e.reason) || reason || "",
                  before: e && e.before, after: e && e.after, createdAt: (e && e.createdAt) || undefined }))
    .filter(e => e.sku && e.delta);
  if (!rows.length) return;
  writeLedgerRows(rows);
}
/* Insert movement-history rows, and KEEP them if the insert can't land.
   The qty write behind a movement is queued when the phone is offline and
   replays later — but the history row used to be tried once and dropped, so a
   stock change made with no signal reached the server with no record of it
   ("ปรับสต็อกในมือถือ แต่รายงานไม่ครบ"). A failed insert now joins the same
   offline queue. An RLS refusal is not retried (it won't fix itself). The
   author is captured NOW so a replay can't credit whoever is logged in later.
   Returns a promise of the first attempt's result. */
// Only a transport failure is worth retrying. Anything the database answered
// (RLS refusal, unknown sku FK, bad value) will fail the same way forever.
function _ledgerRefused(err) {
  return !/fetch|network|timeout|timed out|abort|offline|ECONN|5\d\d|gateway|unavailable/i.test(String(err || ""));
}
function writeLedgerRows(rows) {
  if (typeof dbInsertStockAdjustment !== "function") return Promise.resolve({ ok: false });
  const by = (window.__currentUser && window.__currentUser.name) || "ระบบ";
  const at = new Date().toISOString();
  const list = (Array.isArray(rows) ? rows : []).filter(r => r && r.sku && Number(r.delta))
    .map(r => ({ sku: r.sku, delta: Math.trunc(Number(r.delta)), reason: r.reason || "", created_by: r.created_by || by,
                 createdAt: r.createdAt || undefined, at: r.createdAt || r.at || at,
                 // Server-reported stock around the move; omitted when unknown (queued).
                 ...(Number.isFinite(r.before) && Number.isFinite(r.after) ? { before: r.before, after: r.after } : {}),
                 // Actual sale price per piece (ขายออก) — survives the offline queue with the row.
                 ...(Number.isFinite(r.unitPrice) ? { unitPrice: r.unitPrice } : {}) }));
  if (!list.length) return Promise.resolve({ ok: true });
  const keep = () => { if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("ledger", list); };
  if (typeof navigator !== "undefined" && navigator.onLine === false) { keep(); return Promise.resolve({ queued: true }); }
  return dbInsertStockAdjustment(list).then(res => {
    if (res && res.error && !_ledgerRefused(res.error)) keep();
    // Open movement-history lists re-read now that the row really exists
    // (they used to guess with a 900 ms timer and miss slow inserts).
    if (res && res.ok) { try { window.dispatchEvent(new CustomEvent("ims-ledger-change", { detail: { skus: list.map(r => r.sku) } })); } catch (e) {} }
    return res || { ok: true };
  }).catch(e => { keep(); return { error: String(e) }; });
}

/* Same contract as _syncQtyDelta: resolves with what the SERVER did, so the
   movement ledger records the real quantity rather than the requested one.
     { ok:true, rows }          — applied; rows carry sku/qty/before
     { ok:true, rows, partial } — RLS let some rows through, blocked the rest
     { queued:true }            — offline/failed, replays later
     { ok:false }               — no usable answer */
async function _deductRemote(deductions) {
  if (typeof dbDeductStock !== "function") { saveProductStore(); return { ok: false }; }
  // ONE op id for this deduction and every retry of it (see _syncQtyDelta).
  const opId = genOpId();
  if (!navigator.onLine) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("deduct", deductions, opId);
    return { queued: true };
  }
  try {
    const res = await dbDeductStock(deductions, opId);
    if (res && res.ok) { _applyServerQty(res.rows); return { ok: true, rows: res.rows }; }
    if (res && res.error === "PERMISSION_OR_MISSING") {
      _applyServerQty(res.rows); // rows RLS did allow are still canonical
      window.dispatchEvent(new CustomEvent("ims-toast", {
        detail: "ตัดสต็อกไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์แก้ไขสินค้า"
      }));
      // Reload canonical server state so the UI stops showing a deduction
      // that didn't persist (mirrors saveProductStore's perm-block path).
      if (window.dbLoadProducts) {
        const seq = beginProductsFetch();
        dbLoadProducts().then(fresh => hydrateProductsFromServer(fresh, seq)).catch(() => {});
      }
      // Whatever came back DID move; anything missing was blocked and must not
      // be written into the ledger as if it had happened.
      return { ok: true, rows: res.rows, partial: true };
    }
    if (res && res.error === "RPC_MISSING") { saveProductStore(); return { ok: false }; }
    // Other failure (likely transient network/server) → queue for retry.
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("deduct", deductions, opId);
    return { queued: true };
  } catch (e) {
    if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("deduct", deductions, opId);
    return { queued: true };
  }
}

/* ── Turning an RPC answer into "what actually moved, per sku" ──
   One sku may appear twice in a single cart (sold alone AND inside a bundle), so
   the RPC returns a row per request entry: first {before:10, qty:8}, then
   {before:8, qty:5}. The real net movement is the FIRST before to the LAST qty. */
function _serverMoveMap(rows) {
  const m = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r || !r.sku || typeof r.qty !== "number") return;
    const cur = m.get(r.sku);
    if (cur) cur.after = r.qty;                       // later entry extends the same move
    else m.set(r.sku, { before: (typeof r.before === "number") ? r.before : null, after: r.qty });
  });
  return m;
}
/* The signed delta to record for one sku. `requested` is the sign-correct amount
   this device asked for, used only when the server can't tell us better (legacy
   1-arg RPC, or the write is still queued). Returns null = record NOTHING:
   either the server moved nothing (idempotent replay) or RLS blocked this sku. */
function _movedDelta(res, sku, requested) {
  if (res && res.blocked) return null;              // refused — nothing moved
  if (res && res.ok) {
    const m = _serverMoveMap(res.rows).get(sku);
    if (!m) return res.partial ? null : requested;    // blocked → no row; otherwise trust the request
    if (m.before == null) return requested;           // pre-`before` RPC: best available
    const d = m.after - m.before;
    return d === 0 ? null : d;                        // 0 = replay recognised, nothing happened
  }
  return requested;                                   // queued / unknown — the move is real, flag it
}
function _pendingSuffix(res) { return (res && res.queued) ? " · รอซิงค์" : ""; }

/* `reason` is what the product's movement history will show for this deduction
   ("ตัดสต็อก · ออร์เดอร์ SO-…", "ขายชุดสินค้า …"). Logging here rather than at
   each call site means no sell path can forget to leave a trace — that gap is
   why a sale used to be invisible in the product drawer. */
function deductStockAndPersist(sku, qty, reason) {
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return;
  p.qty = Math.max(0, p.qty - qty);
  _persistProductsLocal();
  _recordDeduction(_deductRemote([{ sku, qty }]), new Map([[sku, Number(qty) || 0]]), reason || "ตัดสต็อก");
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  if (sku in adj) { delete adj[sku]; if (typeof applyStockAdj === "function") applyStockAdj(adj); }
}
/* opts.at = ISO time the sale really happened (a backdated วันเวลา pick) — the
   history row is dated then, like a backdated ปรับสต็อก, so the product's
   timeline sorts it onto the day it sold. Stock still moves now. */
function deductManyAndPersist(deductions, reason, opts) {
  deductions.forEach(({ sku, qty }) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (p) p.qty = Math.max(0, p.qty - qty);
  });
  _persistProductsLocal();
  // Total asked per sku — a sku can legitimately appear twice in one cart.
  const wanted = new Map();
  deductions.forEach(d => {
    if (!d || !d.sku) return;
    wanted.set(d.sku, (wanted.get(d.sku) || 0) + (Number(d.qty) || 0));
  });
  _recordDeduction(_deductRemote(deductions), wanted, reason || "ตัดสต็อก", opts && opts.at);
  const adj = (typeof getStockAdj === "function") ? { ...getStockAdj() } : {};
  let changed = false;
  deductions.forEach(({ sku }) => { if (sku in adj) { delete adj[sku]; changed = true; } });
  if (changed && typeof applyStockAdj === "function") applyStockAdj(adj);
}
/* Write the movement ledger once the server has said what really left the shelf.
   Recording the REQUESTED quantity was wrong in two ways: an oversell that the
   server floors at 0 removed fewer pieces than asked, and an RLS-blocked sku
   removed none at all — both used to be logged as if they had gone through. */
function _recordDeduction(write, wanted, reason, at) {
  Promise.resolve(write).then(res => {
    const suffix = _pendingSuffix(res);
    const moves = (res && res.ok) ? _serverMoveMap(res.rows) : new Map();
    const rows = [];
    wanted.forEach((qty, sku) => {
      const d = _movedDelta(res, sku, -(Number(qty) || 0));
      if (!d) return;
      const m = moves.get(sku);
      rows.push(m && m.before != null ? { sku, delta: d, reason: reason + suffix, before: m.before, after: m.after, createdAt: at }
                                      : { sku, delta: d, reason: reason + suffix, createdAt: at });
    });
    recordStockMoves(rows, reason);
  }).catch(() => {
    const rows = [];
    wanted.forEach((qty, sku) => rows.push({ sku, delta: -(Number(qty) || 0), reason, createdAt: at }));
    recordStockMoves(rows, reason);
  });
}

/* ── Receiving (+qty) with the same guarantee ──
   Both Inbound forks used to loop adjustProductQty and then log the quantity
   they had asked for. This applies the batch SYNCHRONOUSLY (applyReceiveLocs
   must still see the new p.qty in the same tick — see the _planLocRows
   contract) and records each line only once the server confirms what it added.
   `qty` is a SIGNED delta: the receiving screens always pass positives, but the
   product edit sheet uses this too and can lower a count, so never clamp it to 0.
   lines = [{ sku, qty, loc }] */
/* opts.audit = true also writes ONE activity (audit_log) entry per received
   product. The activity feed (กิจกรรมล่าสุด, desktop dashboard + mobile home)
   reads audit_log, and a receive used to leave only the batch line "ปิดงาน
   รับเข้า — 2 SKU รวม 40 ชิ้น" there — no product, no quantity, so a receive
   looked unreported. Like ปรับสต็อก, the entry carries the SERVER's before →
   after once it answers. The product edit sheet records its own audit, so it
   leaves this off. */
function receiveStockAndRecord(lines, reason, opts) {
  const audit = !!(opts && opts.audit);
  const jobs = [];
  (Array.isArray(lines) ? lines : []).forEach(l => {
    const qty = Math.round(Number(l && l.qty) || 0);
    if (!l || !l.sku || !qty) return;
    if (!PRODUCTS.some(p => p.sku === l.sku)) return;
    // The shelf the batch really lands on (the line's pick, else the product's own
    // shelf — what applyReceiveLocs files it under), so the history names it.
    const loc = ("loc" in l) ? (receiveLineShelf(l) || "") : "";
    jobs.push({ sku: l.sku, qty, loc, write: adjustProductQty(l.sku, qty) });
  });
  if (!jobs.length) return Promise.resolve();
  return Promise.all(jobs.map(j =>
    Promise.resolve(j.write)
      .then(res => ({ job: j, res }))
      .catch(() => ({ job: j, res: null }))
  )).then(results => {
    const rows = [];
    results.forEach(({ job, res }) => {
      // adjust_stock answers per sku, so wrap it in the same shape _movedDelta reads.
      const d = _movedDelta(
        (res && res.ok) ? { ok: true, rows: [{ sku: job.sku, qty: res.after, before: res.before }] } : res,
        job.sku, job.qty
      );
      if (!d) return;
      const where = (job.loc && job.loc !== "—") ? ` → ${job.loc}` : "";
      const ba = (res && res.ok && typeof res.after === "number" && typeof res.before === "number") ? { before: res.before, after: res.after } : {};
      rows.push({ sku: job.sku, delta: d, reason: reason + where + _pendingSuffix(res), ...ba });
      if (audit && typeof recordChange === "function") {
        const p = PRODUCTS.find(x => x.sku === job.sku);
        const known = res && res.ok && typeof res.after === "number";
        const after = known ? res.after : Math.max(0, Number(p && p.qty) || 0);
        const before = known && typeof res.before === "number" ? res.before : after - d;
        recordChange({
          entity: "product", entityId: job.sku, action: "receive",
          summary: `${reason} ${(p && p.name) || job.sku} (${job.sku}) ${d > 0 ? "+" : ""}${d} ชิ้น (${before} → ${after})`,
          note: (job.loc && job.loc !== "—" ? `ตำแหน่ง: ${job.loc}` : "ไม่ระบุตำแหน่ง") + _pendingSuffix(res)
        });
      }
    });
    recordStockMoves(rows, reason);
  });
}

/* ── Reasoned stock adjustment (ปรับสต็อก) ──
   One choke point for a stock correction with a recorded reason — miscount,
   damaged/lost item, or a sale made outside the system (Shopee/Lazada/หน้าร้าน).
   Desktop (StockAdjustModal) and mobile (MAdjust) BOTH call this; the UIs are
   forked but the logic must not be. Distinct from the sell/ตัดสต็อก flows: it
   never creates an order. External sales recorded here ("ขายผ่าน …") DO feed
   analytics and the channel cards via saleMoveOrders() — staff record almost
   every sale this way. */
function applyStockAdjustment({ sku, delta, reason, note, source, when, unitPrice, detail }) {
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
  // Keep the promise: the RPC reports the server's REAL before/after, and that —
  // not this device's arithmetic — is what the history must show.
  const write = applied ? adjustProductQty(sku, applied) : Promise.resolve({ ok: false });
  if (sku in adj) { delete adj[sku]; if (typeof applyStockAdj === "function") applyStockAdj(adj); }
  const to = Math.max(0, Number(p.qty) || 0);            // overlay cleared → raw IS the displayed qty
  const eff = to - from;
  const reasonLabel = (reason && reason.label) || String(reason || "");
  const noteText = String(note || "").trim();
  // Backdated (ย้อนหลัง): the stock moves now, but the history row is dated when
  // it really happened — which also files a ขายผ่าน… sale under that day in
  // analytics (saleMoveOrders reads created_at). The reason keeps its prefix, so
  // isAdjustSaleReason / saleChannelOfReason still match. The audit-log row
  // keeps its real time: it records when someone keyed it in.
  const back = when ? stockOutStamp(when) : null;
  const backAt = back && back.backdated ? back.createdAt : undefined;
  // `detail` = this SKU's own explanation (ตั้งค่าเป็น: "นับได้ X − รอแพ็ค Y = Z"),
  // so the history says why the stock didn't land on the typed number.
  const fullReason = [noteText ? `${reasonLabel} — ${noteText}` : reasonLabel,
    String(detail || "").trim(),
    backAt ? `ย้อนหลัง ${stockOutStampLabel(back)}` : ""].filter(Boolean).join(" · ");

  /* ── Why the history is written AFTER the server answers ──
     from/to above are computed from THIS DEVICE's copy of qty, and the server
     applies the delta to ITS own value. When the local copy is stale (another
     device just sold some, or a realtime push hasn't landed) the two disagree —
     and the old code wrote the local guess into the log immediately. Live
     example: AFG-OT33-BK 2026-09-01 12:11 was recorded as "30 → 29" while the
     real stock went 60 → 59, so the trail jumped from 29 to 59 with nothing in
     between. The stock itself was always right (the RPC is atomic); only the
     RECORD lied, which is what made the history unreadable.
     Now the row carries the server's own before/after. If the server can't be
     reached the local estimate is still recorded — the movement is real and
     queued — but marked "รอซิงค์" so a number that may shift is visible as such. */
  if (eff) {
    const writeHistory = (rFrom, rTo, rEff, pendingNote, exact) => {
      const noteOut = pendingNote ? `${fullReason} · ${pendingNote}` : fullReason;
      // Audit trail: only summary/note survive to the DB (changes[] stays local),
      // so sku, ±delta, from→to and the reason are all packed into them.
      if (typeof recordChange === "function") {
        recordChange({
          entity: "product", entityId: sku, action: "adjust",
          summary: `ปรับสต็อก ${p.name} (${sku}) ${rEff > 0 ? "+" : ""}${rEff} ชิ้น (${rFrom} → ${rTo})${source === "mobile" ? " (มือถือ)" : ""}`,
          changes: [{ label: "จำนวน", from: `${rFrom} ชิ้น`, to: `${rTo} ชิ้น` }],
          note: noteOut
        });
      }
      // Structured, queryable history (stock_adjustments table). Best-effort like
      // dbInsertAuditEntry — the atomic stock write above is the authoritative one.
      writeLedgerRows([{ sku, delta: rEff, reason: noteOut, createdAt: backAt,
                         ...(exact ? { before: rFrom, after: rTo } : {}),
                         ...(rEff < 0 && Number.isFinite(unitPrice) ? { unitPrice } : {}) }])
        .then(() => { if (rEff < 0 && isAdjustSaleReason(noteOut)) refreshSaleMovesSoon(); })
        .catch(() => {});
    };
    Promise.resolve(write).then(res => {
      if (res && res.ok && typeof res.after === "number") {
        const sTo = res.after;
        const sFrom = (typeof res.before === "number") ? res.before : (sTo - applied);
        const sEff = sTo - sFrom;
        // 0 = the server recognised an already-applied operation and moved
        // nothing. Recording it would invent a movement that never happened.
        if (sEff) writeHistory(sFrom, sTo, sEff, "", typeof res.before === "number");
        return;
      }
      writeHistory(from, to, eff, (res && res.queued) ? "รอซิงค์" : "");
    }).catch(() => writeHistory(from, to, eff, ""));
  }
  return { ok: true, from, to, eff };
}

/* The SALE reason picked last time on this device — most batches are the same
   kind of sale, so both forks preselect it. Only "ขายผ่าน …" reasons are
   remembered: preselecting นับผิด/เสียหาย would silently mislabel the next sale. */
const ADJ_REASON_KEY = "ims_last_adjust_reason";
function lastAdjustReason() {
  try { const id = localStorage.getItem(ADJ_REASON_KEY); return (/^sale-/.test(id || "") && ADJUST_REASONS.some(r => r.id === id)) ? id : ""; } catch (e) { return ""; }
}
function rememberAdjustReason(id) { try { if (/^sale-/.test(id || "")) localStorage.setItem(ADJ_REASON_KEY, id); } catch (e) {} }

/* ── ขายออก (quick sale) ────────────────────────────────────────────────────
   The fast way to record a Shopee / Facebook / หน้าร้าน sale: pick products,
   pick the channel, confirm. It is deliberately the SAME write the team already
   uses every day (ปรับสต็อก with a "ขายผ่าน …" reason → applyStockAdjustmentBatch
   → one stock_adjustments row per SKU), so it inherits the atomic RPC, opId
   idempotency and server-reported history, and the sales show up in analytics
   and the channel cards through saleMoveOrders() with no new data model.
   Both forks (desktop QuickSellModal, mobile MQuickSell) call this one function.
   lines = [{ sku, qty, loc }] → { ok, pieces, applied, error?, duplicate?, locWarning? } */
function quickSaleChannels() {
  return ADJUST_REASONS.filter(r => r.channel).map(r => {
    const ch = CHANNEL_LIST.find(c => c.id === r.channel) || {};
    return { id: r.id, ch: r.channel, label: r.id === "sale-offline" ? "หน้าร้าน / ออฟไลน์" : (ch.name || r.label), color: ch.color || "var(--muted)" };
  });
}
function _saleEffQty(sku) {
  if (typeof getEffectiveQty === "function") return getEffectiveQty(sku);
  const p = PRODUCTS.find(x => x.sku === sku);
  return p ? Math.max(0, Number(p.qty) || 0) : 0;
}
async function commitQuickSale({ lines, reasonId, note, source, when }) {
  const reason = ADJUST_REASONS.find(r => r.id === reasonId && r.channel);
  if (!reason) return { ok: false, error: "เลือกช่องทางขายก่อน" };
  // One entry per SKU — the same product added twice (scan + tap) is one sale line.
  const bySku = new Map();
  (Array.isArray(lines) ? lines : []).forEach(l => {
    if (!l || !l.sku) return;
    const q = Math.max(0, Math.round(Number(l.qty) || 0));
    if (!q) return;
    const cur = bySku.get(l.sku);
    // Price actually charged per piece; blank / invalid = not recorded (analytics then uses the catalog price).
    const up = l.price === "" || l.price == null ? NaN : Number(l.price);
    const price = Number.isFinite(up) && up >= 0 ? up : undefined;
    if (cur) { cur.qty += q; if (price !== undefined) cur.price = price; }
    else bySku.set(l.sku, { sku: l.sku, qty: q, loc: l.loc || "", price });
  });
  const want = [...bySku.values()];
  if (!want.length) return { ok: false, error: "ยังไม่ได้เลือกสินค้า" };
  // Validate against stock BEFORE anything moves — never sell what isn't there.
  const short = want.find(w => w.qty > _saleEffQty(w.sku));
  if (short) return { ok: false, error: `สต็อกไม่พอ: ${short.sku} เหลือ ${_saleEffQty(short.sku)} ชิ้น` };
  const changes = want.map(w => ({ sku: w.sku, delta: -w.qty }));
  const priced = changes.map((c, i) => Object.assign({}, c, want[i].price !== undefined ? { unitPrice: want[i].price } : {}));
  // The picked date is part of the key: the same sale keyed for two different
  // days back-to-back is two sales, not a double-click.
  const guardKey = commitFingerprint("quicksale-" + reasonId + (when ? "@" + when : ""), changes);
  if (!claimCommit(guardKey)) { duplicateCommitToast(); return { ok: false, duplicate: true }; }
  const res = applyStockAdjustmentBatch(priced, { reason, note, source, when });
  if (!res.applied) {
    releaseCommit(guardKey);
    return { ok: false, error: "บันทึกการขายไม่สำเร็จ" };
  }
  rememberAdjustReason(reasonId);
  // Take the pieces off the shelf the seller picked (same tick as the qty write).
  let locWarning = "";
  const locBySku = {};
  want.forEach(w => { locBySku[w.sku] = w.loc; });
  const picks = (res.results || changes).filter(r => r.ok !== false).map(r => ({ sku: r.sku, loc: locBySku[r.sku] }));
  const locRes = await applyLocPicks(picks);
  if (locRes && locRes.offline) locWarning = "จำนวนตามตำแหน่งจะอัปเดตเมื่อออนไลน์";
  else if (locRes && locRes.errors && locRes.errors.length) locWarning = "ปรับตำแหน่งไม่สำเร็จ: " + locRes.errors[0].error;
  return { ok: true, pieces: -res.net, applied: res.applied, skipped: res.skipped, locWarning };
}

/* Multi-SKU version of the above — one shared reason/note, many products.
   Both ปรับสต็อก UIs (desktop StockAdjustModal, mobile MAdjust) select several
   items at once, and both must stay on the single choke point above, so this
   only loops it and aggregates: per-SKU audit rows + stock_adjustments history
   stay granular (the ProductDrawer history panel reads them per product).
   items = [{ sku, delta, detail? }] → { ok, applied, skipped, net, results }. */
function applyStockAdjustmentBatch(items, opts) {
  const { reason, note, source, when } = opts || {};
  const list = Array.isArray(items) ? items : [];
  const results = [];
  let applied = 0, skipped = 0, net = 0;
  list.forEach(it => {
    if (!it || !it.sku) { skipped++; return; }
    const res = applyStockAdjustment({ sku: it.sku, delta: it.delta, reason, note, source, when, unitPrice: it.unitPrice, detail: it.detail }) || { ok: false };
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

/* Orders THIS device just wrote. The order-alert watcher (tracking.jsx) skips
   them when a realtime reload lands, so nobody is told to re-check an edit they
   made themselves — the server echo of our own write arrives as a remote event. */
function markOrderTouched(id) {
  if (!id) return;
  const m = window.__orderTouch || (window.__orderTouch = {});
  m[id] = Date.now();
}
function orderTouchedRecently(id, ms) {
  const t = window.__orderTouch && window.__orderTouch[id];
  return !!t && Date.now() - t < (ms || 15000);
}

/* Append/update ONE order: optimistic local cache + single-row DB upsert.
   This is the convergence-safe writer — unlike saveOrders() it never upserts
   the whole list and never diffs-and-deletes, so two devices can't clobber
   each other's orders. Failed writes go to the offline queue. */
async function appendOrder(order) {
  if (!order || !order.id) return { ok: false };
  markOrderTouched(order.id);
  // If this id was previously deleted, drop the stale tombstone so the new order
  // isn't hidden by it (clearOrderOverride is a no-op for a fresh, never-used id).
  if (typeof clearOrderOverride === "function") clearOrderOverride(order.id);
  const next = [order, ...loadOrders().filter(o => o.id !== order.id)];
  try { localStorage.setItem("ims_orders", JSON.stringify(next)); } catch (e) {}
  window._DB_ORDERS = next;
  window.dispatchEvent(new CustomEvent("ims-orders-change"));
  // A brand-new order → the "ส่งให้คนแพ็ค" prompt (pack-docs.jsx) offers to
  // attach the courier label / address right away.
  window.dispatchEvent(new CustomEvent("ims-order-created", { detail: { id: order.id, status: order.status } }));
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

/* Channel / carrier marks — a small brand-coloured tile with a short code,
   shown next to every channel or carrier name. Self-drawn (no logo files):
   the CSP blocks third-party img-src and the stored values are free text
   ("ไปรษณีย์ไทย", "Kerry Express", "J&T"), so lookup is alias-based. */
const CARRIER_MARKS = [
  { short: "KEX", bg: "#F26B21", keys: ["kex", "kerry", "เคอรี่"] },
  { short: "FL",  bg: "#FFC20E", fg: "#1a1a1a", keys: ["flash", "แฟลช"] },
  { short: "J&T", bg: "#D71920", keys: ["j&t", "j & t", "jt ", "เจแอนด์ที"] },
  { short: "TP",  bg: "#E30613", keys: ["thai post", "thaipost", "ไปรษณีย์", "ems"] },
  { short: "NV",  bg: "#C8102E", keys: ["ninja", "นินจา"] },
  { short: "SPX", bg: "#EE4D2D", keys: ["shopee", "spx"] },
  { short: "BE",  bg: "#1F3E8C", keys: ["best"] },
  { short: "DHL", bg: "#FFCC00", fg: "#D40511", keys: ["dhl"] },
  { short: "SCG", bg: "#E2231A", keys: ["scg"] },
  { short: "AF",  bg: "#0B6E4F", keys: ["alpha"] },
  { short: "LLM", bg: "#F16622", keys: ["lalamove", "ลาล่ามูฟ"] },
  { short: "LEX", bg: "#0F146D", keys: ["lazada express", "lex "] },
  { short: "GRB", bg: "#00B14F", keys: ["grab"] },
];
const CHANNEL_MARKS = {
  shopee: "#EE4D2D", lazada: "#0F146D", tiktok: "#111111", line: "#06C755",
  web: "#2F6FDB", facebook: "#1877F2", other: "#7A7A7A",
};
function carrierMark(name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  const padded = n + " ";
  const hit = CARRIER_MARKS.find(c => c.keys.some(k => padded.includes(k)));
  return hit ? { short: hit.short, bg: hit.bg, fg: hit.fg || "#fff" }
             : { short: n.replace(/\s+/g, "").slice(0, 2).toUpperCase() || "?", bg: "#8A8F98", fg: "#fff" };
}
function channelMark(ch) {
  const v = String(ch || "").trim();
  if (!v) return null;
  const low = v.toLowerCase();
  const c = CHANNEL_LIST.find(x => x.id === low || x.name.toLowerCase() === low)
         || CHANNEL_LIST.find(x => x.id !== "other" && (low.includes(x.id) || low.includes(x.name.toLowerCase())));
  if (c) return { short: c.short, bg: CHANNEL_MARKS[c.id] || "#7A7A7A", fg: "#fff", name: c.name };
  return { short: v.replace(/\s+/g, "").slice(0, 2).toUpperCase(), bg: "#8A8F98", fg: "#fff", name: v };
}
function MarkTile({ m, size = 18, title }) {
  if (!m) return null;
  const fs = Math.max(7, Math.round(size * (m.short.length > 2 ? 0.36 : 0.46)));
  return (
    <span className="mark-tile" title={title} style={{ width: size, height: size, background: m.bg, color: m.fg, fontSize: fs, borderRadius: Math.round(size * 0.28) }}>{m.short}</span>
  );
}
/* <ChannelMark channel="Shopee" label/> → tile, plus the name when `label`. */
function ChannelMark({ channel, size, label }) {
  const m = channelMark(channel);
  if (!m) return label ? <span style={{ color: "var(--faint)" }}>—</span> : null;
  if (!label) return <MarkTile m={m} size={size} title={m.name}/>;
  return <span className="mark-chip"><MarkTile m={m} size={size}/>{channel}</span>;
}
function CarrierMark({ carrier, size, label }) {
  const m = carrierMark(carrier);
  if (!m) return label ? <span style={{ color: "var(--faint)" }}>—</span> : null;
  if (!label) return <MarkTile m={m} size={size} title={carrier}/>;
  return <span className="mark-chip"><MarkTile m={m} size={size}/>{carrier}</span>;
}

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
/* ── Shared-blob writers: optimistic, but NEVER fire-and-forget ──
   Both of these used to `.catch(() => {})` the DB write. app_state INSERT/UPDATE
   is admin/manager/staff only, so for a viewer — or on any network failure — the
   rename/add landed in localStorage and on screen, the cloud never got it, and
   the change silently reverted at the next reload or realtime push. That is the
   "I saved it but it didn't change" report. Now the local mirror is rolled back
   to exactly what it was and the user is told, so what is on screen is always
   what is actually stored. */
function _blobWriteFailed(what, err) {
  window.dispatchEvent(new CustomEvent("ims-toast", {
    detail: err === "PERMISSION_OR_MISSING"
      ? `บันทึก${what}ไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์แก้ไข — ระบบย้อนกลับให้แล้ว`
      : `บันทึก${what}ไม่สำเร็จ: ${err || "เชื่อมต่อไม่ได้"} — ระบบย้อนกลับให้แล้ว`
  }));
}
function saveLocTree(tree) {
  const prev = window._DB_LOCATIONS;
  const prevMirror = (() => { try { return localStorage.getItem("ims_loc_tree"); } catch (e) { return null; } })();
  try { localStorage.setItem("ims_loc_tree", JSON.stringify(tree)); } catch (e) {}
  window._DB_LOCATIONS = tree;
  window.dispatchEvent(new CustomEvent("ims-locations-change"));
  if (!window.dbSaveState) return;
  dbSaveState("locations", tree).then(res => {
    if (!res || !res.error) return;
    window._DB_LOCATIONS = prev;
    try {
      if (prevMirror == null) localStorage.removeItem("ims_loc_tree");
      else localStorage.setItem("ims_loc_tree", prevMirror);
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("ims-locations-change"));
    _blobWriteFailed("ตำแหน่งจัดเก็บ", res.error);
  }).catch(e => _blobWriteFailed("ตำแหน่งจัดเก็บ", String(e && e.message || e)));
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
    /* Added pieces land on a REAL position only. A "-" / stale preference (or a
       fake row sorted first) used to create or grow a shelf no picker can find;
       with no real shelf at all they join an existing row, never a new fake one. */
    const stored = storedLocSet();
    const target = order.find(l => locIsStored(l, stored)) || productHomeLoc(p, stored) || rows[0].loc;
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
  // First REAL shelf — locSplitFor pins the row equal to p.loc, and p.loc "-"
  // sent pickers to a "-" row. Falls back to the old choice when none is real.
  const stored = storedLocSet();
  const real = spots.find(s => locIsStored(s.loc, stored));
  return (real && real.loc) || (spots.length && spots[0].loc) || p.loc || "";
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
    // No split recorded: p.loc IS the whole truth, keep the legacy whole-move —
    // and record the shelf row too, or the pieces show as ยังไม่จัดเก็บ (001-HC).
    updateProductInStore(sku, { loc: target });
    if (total > 0 && locIsStored(target)) {
      const res = await saveLocSplit(sku, [{ loc: target, qty: total }]);
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || "บันทึกตำแหน่งไม่สำเร็จ" };
    }
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
  const stored = storedLocSet();
  (Array.isArray(lines) ? lines : []).forEach(l => {
    if (!l || !l.sku) return;
    const p = PRODUCTS.find(x => x.sku === l.sku);
    if (!p) return;
    /* Never file under a code that isn't a real position ("-" was, and became a
       fake pick-first shelf). Use the product's real shelf instead — skipping a
       sku WITH rows would leave them summing short of p.qty. */
    const loc = locIsStored(l.loc, stored) ? String(l.loc) : productHomeLoc(p, stored);
    const rows = locSplitFor(l.sku, p.loc);
    if (rows.length) { picks.push({ sku: l.sku, loc: loc }); return; }
    if (!loc) return;   // no real shelf and no rows: nothing to file
    const n = Math.max(0, Number(l.qty) || 0);
    const oldQty = Math.max(0, (Number(p.qty) || 0) - n);
    if (!p.loc || p.loc === loc || !locIsStored(p.loc, stored) || oldQty === 0) {
      if ((p.loc || "") !== loc) updateProductInStore(l.sku, { loc: loc });
      // Also create the shelf row: without it the stock has no product_locations
      // row and shows as ยังไม่จัดเก็บ (001-HC). Once per sku per batch.
      const q = Math.max(0, Number(p.qty) || 0);
      if (q > 0 && locIsStored(loc, stored) && !jobs.some(j => j[0] === l.sku)) jobs.push([l.sku, [{ loc: loc, qty: q }], true]);
      return;
    }
    // Stock recorded elsewhere and this batch lands somewhere new → real split.
    jobs.push([l.sku, [{ loc: p.loc, qty: oldQty }, { loc: loc, qty: n }].filter(r => r.qty > 0)]);
  });
  const out = { ok: true, offline: false, errors: [] };
  if (picks.length) {
    const r = await applyLocPicks(picks);
    if (r && r.offline) out.offline = true;
    if (r && r.errors && r.errors.length) { out.ok = false; out.errors.push(...r.errors); }
  }
  for (const job of jobs) {
    if (job[2]) {
      // Single-row job: re-read the CURRENT qty (the server may have landed since).
      const cur = Math.max(0, Number((PRODUCTS.find(x => x.sku === job[0]) || {}).qty) || 0);
      if (!cur) continue;
      job[1][0].qty = cur;
    }
    const r = await saveLocSplit(job[0], job[1]);
    if (r && r.ok === false) { out.ok = false; out.errors.push({ sku: job[0], error: r.error }); }
  }
  /* The new rows used the LOCAL p.qty; the server's qty may have landed after.
     applyLocPicks is difference-based, so it reconciles the rows to the final qty. */
  if (jobs.length && typeof applyLocPicks === "function") {
    try {
      const fix = jobs.map(j => ({ sku: j[0], loc: (j[1][j[1].length - 1] || {}).loc })).filter(x => x.loc);
      if (fix.length) {
        const r = await applyLocPicks(fix);
        if (r && r.offline) out.offline = true;
      }
    } catch (e) {}
  }
  return out;
}

/* ── Receiving: never close a batch without knowing where it went ──
   The shelf picker on a receive line is optional, and a product created by the
   scan (quick-add) has no shelf to default to — so a whole batch could be
   committed with nowhere recorded: the history said "รับเข้าสินค้า" with no
   "→ shelf" and the product sat as ยังไม่จัดเก็บ (2026-10-02 audit: 72 of 76
   receive lines since 19 Sep, 123 products / 706 pieces). Both Inbound forks use
   these to warn before ปิดงาน and to fill every empty line in one pick. */
function receiveLineShelf(line, set) {
  if (!line || !line.sku) return "";
  const s = set || storedLocSet();
  if (locIsStored(line.loc, s)) return String(line.loc);
  const p = PRODUCTS.find(x => x.sku === line.sku);
  return p ? productHomeLoc(p, s) : "";
}
function receiveLinesWithoutShelf(lines) {
  const s = storedLocSet();
  return (Array.isArray(lines) ? lines : []).filter(l => l && l.sku && !receiveLineShelf(l, s));
}
/* What a receive batch did, for the on-screen report after ปิดงาน. Call BEFORE
   the qty writes: `before` is the stock this device held, `after` = before + qty
   (the server applies the same atomic delta). Lines for the same sku merge.
   → { lines: [{ sku, name, qty, shelf, before, after }], skus, pieces } */
function buildReceiveReport(lines) {
  const s = storedLocSet();
  const bySku = new Map();
  (Array.isArray(lines) ? lines : []).forEach(l => {
    const qty = Math.round(Number(l && l.qty) || 0);
    if (!l || !l.sku || !qty) return;
    const cur = bySku.get(l.sku);
    if (cur) { cur.qty += qty; return; }
    const p = PRODUCTS.find(x => x.sku === l.sku);
    const before = p ? Math.max(0, Number(p.qty) || 0) : 0;
    bySku.set(l.sku, { sku: l.sku, name: (p && p.name) || l.name || "", qty, shelf: receiveLineShelf(l, s), before });
  });
  const out = [...bySku.values()].map(r => ({ ...r, after: Math.max(0, r.before + r.qty) }));
  return { lines: out, skus: out.length, pieces: out.reduce((n, r) => n + r.qty, 0) };
}
// The shelf picked last on this device — a receiving session usually lands in one place.
const RECV_LOC_KEY = "ims_last_receive_loc";
function lastReceiveLoc() {
  try { const v = localStorage.getItem(RECV_LOC_KEY) || ""; return locIsStored(v) ? v : ""; } catch (e) { return ""; }
}
function rememberReceiveLoc(loc) {
  try { if (locIsStored(loc)) localStorage.setItem(RECV_LOC_KEY, String(loc)); } catch (e) {}
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
  return PRODUCTS.reduce((n, p) => n + (productIsStored(p, set) ? 0 : 1), 0);
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
  /* RETIRED 2026-09-30. This used to blank EVERY product's loc — locally AND in
     the cloud — the first time any new device/browser opened the app (the "run
     once" flag lived in that device's localStorage, so every fresh phone, private
     tab or cleared cache re-ran it). That is how all 424 products ended up with
     loc "-" while their real shelves survived in product_locations. The v2 move
     finished long ago; never write product data from a per-device migration. */
  try { localStorage.setItem("ims_loc_cleared_v2", "1"); } catch (e) {}
})();

/* Where a product lives, for DISPLAY. products.loc is only the pick-first
   position and can be blank/stale, while product_locations holds the real
   shelves — so fall back to the recorded split before calling it unstored.
   Returns a live position code or "" when the product truly has no shelf. */
function productHomeLoc(p, set) {
  if (!p) return "";
  const s = set || storedLocSet();
  if (locIsStored(p.loc, s)) return p.loc;
  const rows = locSplitFor(p.sku, p.loc);
  const hit = rows.find(r => r.qty > 0 && s.has(String(r.loc))) || rows.find(r => s.has(String(r.loc)));
  return hit ? hit.loc : "";
}
function productIsStored(p, set) { return !!productHomeLoc(p, set); }

/* Sales channels — used for outbound deduction + per-channel stock tracking */
const CHANNEL_LIST = [
  { id: "shopee", name: "Shopee",        color: "oklch(0.62 0.2 30)",  short: "SP" },
  { id: "lazada", name: "Lazada",        color: "oklch(0.5 0.2 280)",  short: "LZ" },
  { id: "tiktok", name: "TikTok Shop",   color: "oklch(0.35 0.04 220)", short: "TT" },
  { id: "line",   name: "LINE Shopping", color: "oklch(0.6 0.18 145)", short: "LN" },
  { id: "web",    name: "เว็บไซต์",      color: "oklch(0.55 0.13 235)", short: "WB" },
  { id: "facebook", name: "Facebook",    color: "oklch(0.52 0.19 260)", short: "FB" },
  { id: "other",  name: "ออฟไลน์ / อื่นๆ", color: "oklch(0.55 0.01 80)", short: "OT" }
];

/* Reasons for a manual stock adjustment (ปรับสต็อก) — single source for the
   desktop modal AND mobile MAdjust so the taxonomy can't fork. External-sale
   reasons derive from CHANNEL_LIST; the channel is carried in the label text
   (stock_adjustments stores a reason string, not a channel column).
   `dir` = which mode the reason makes sense for: "add" (เพิ่มเข้า), "remove"
   (หักออก) or "both". ตั้งค่าเป็น can move either way, so it lists everything. */
const ADJUST_REASONS = [
  { id: "restock",      label: "รับสินค้าเข้า / เติมสต็อก", dir: "add" },
  { id: "recount",      label: "นับสต็อกผิด / แก้ไขยอด", dir: "both" },
  { id: "damaged",      label: "สินค้าเสียหาย / ชำรุด", dir: "remove" },
  { id: "lost",         label: "สินค้าสูญหาย", dir: "remove" },
  ...CHANNEL_LIST.filter(c => c.id !== "other").map(c => ({ id: "sale-" + c.id, label: `ขายผ่าน ${c.name} (นอกระบบ)`, channel: c.id, dir: "remove" })),
  { id: "sale-offline", label: "ขายหน้าร้าน / ออฟไลน์", channel: "other", dir: "remove" },
  { id: "other",        label: "อื่นๆ (ระบุ)", requireNote: true, dir: "both" }
];
/* Reasons shown for a ปรับสต็อก mode (add | remove | set) — both forks use it,
   and resolve the picked reason through it so one picked under หักออก can't
   ride along after switching to เพิ่มเข้า. */
function adjustReasonsFor(mode) {
  if (mode !== "add" && mode !== "remove") return ADJUST_REASONS;
  return ADJUST_REASONS.filter(r => r.dir === "both" || r.dir === mode);
}

const CHANNELS = [
  { id: "shopee", name: "Shopee",          today: 0, pct: 0 },
  { id: "lazada", name: "Lazada",          today: 0, pct: 0 },
  { id: "tiktok", name: "TikTok Shop",     today: 0, pct: 0 },
  { id: "web",    name: "เว็บไซต์",        today: 0, pct: 0 },
  { id: "line",   name: "LINE Shopping",   today: 0, pct: 0 },
  { id: "facebook", name: "Facebook",      today: 0, pct: 0 },
  { id: "other",  name: "ออฟไลน์ / อื่นๆ", today: 0, pct: 0 }
];

/* Per-SKU sales by channel over the last N days — REAL, derived from orders.
   Each order's matching-SKU units are attributed to the order's channel(s):
   via `deductions` (per-channel split) when present, else the order's channel
   name. Returns [{ ...channel, sold }] for every channel (0 when none). */
const channelSalesFor = (sku, days = 30) => {
  const orders = loadSalesRecords();
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
    /* A multi-item ตัดสต็อก tags every line with its OWN channel (buildIssuePlan),
       so those units are attributed exactly instead of prorated across the whole
       order — otherwise "3 ชิ้น A ทาง Shopee + 2 ชิ้น B ทาง Lazada" would smear
       both channels over both SKUs. Untagged units keep the legacy split path. */
    let units = 0;
    o.lineItems.forEach(li => {
      if (!li || li.sku !== sku) return;
      const q = Number(li.qty) || 0;
      if (!q) return;
      if (li.ch && Object.prototype.hasOwnProperty.call(byId, li.ch)) byId[li.ch] += q;
      else units += q;
    });
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

/* ── Sales entered through ปรับสต็อก ──────────────────────────────────────────
   Staff record nearly every Shopee / Facebook / หน้าร้าน sale with a ปรับสต็อก
   reason "ขายผ่าน … (นอกระบบ)" rather than as an order, so everything that
   reads orders only (analytics, channel cards, per-SKU channel sales) showed 0.
   These rows are loaded read-only from stock_adjustments and turned into
   order-shaped records so every sales surface counts them. Label-born orders
   (channel "ฉลาก") are shipments, not sales, and are left out of channel stats. */
const SALE_MOVES_DAYS = 400;
let _saleMovesInflight = null;
function refreshSaleMoves() {
  if (typeof dbLoadSaleAdjustments !== "function") return Promise.resolve();
  if (_saleMovesInflight) return _saleMovesInflight;
  const since = new Date(Date.now() - SALE_MOVES_DAYS * 86400000).toISOString();
  _saleMovesInflight = dbLoadSaleAdjustments(since).then(rows => {
    if (Array.isArray(rows)) {
      window._DB_SALE_MOVES = rows;
      _saleMoveCache = null;
      window.dispatchEvent(new CustomEvent("ims-sales-change"));
    }
  }).catch(() => {}).then(() => { _saleMovesInflight = null; });
  return _saleMovesInflight;
}
let _saleMoveTimer = null;
function refreshSaleMovesSoon() {
  clearTimeout(_saleMoveTimer);
  _saleMoveTimer = setTimeout(refreshSaleMoves, 2500);
}
/* True only for the ปรับสต็อก sale reasons (ADJUST_REASONS "sale-*"). The sell
   flows' own history rows ("ขายสินค้า · …", "ขายชุดสินค้า …") are NOT sales to
   add — their orders are already counted. */
function isAdjustSaleReason(reason) {
  const r = String(reason || "");
  return r.indexOf("ขายผ่าน ") === 0 || r.indexOf("ขายหน้าร้าน") === 0;
}
function saleChannelOfReason(reason) {
  const r = String(reason || "");
  if (/^ขายหน้าร้าน/.test(r)) return CHANNEL_LIST.find(c => c.id === "other");
  return CHANNEL_LIST.find(c => c.id !== "other" && r.indexOf("ขายผ่าน " + c.name) === 0)
      || CHANNEL_LIST.find(c => c.id === "other");
}
let _saleMoveCache = null;
function saleMoveOrders() {
  const rows = window._DB_SALE_MOVES;
  if (!Array.isArray(rows) || !rows.length) return [];
  if (_saleMoveCache && _saleMoveCache.src === rows) return _saleMoveCache.list;
  const priceOf = new Map(PRODUCTS.map(p => [p.sku, Number(p.price) || 0]));
  /* One ปรับสต็อก confirm = one sale. Its rows share the reason text but are
     inserted one per SKU after each stock RPC answers, so they can straddle a
     second boundary — group consecutive rows with the same reason that land
     within 20 s of each other instead of by exact timestamp. */
  const sorted = rows
    .filter(r => r && r.sku && Number(r.delta) < 0 && isAdjustSaleReason(r.reason))
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const groups = new Map();
  let cur = null, curKey = "", curReason = null, lastMs = 0, seq = 0;
  for (const r of sorted) {
    const ms = Date.parse(r.created_at) || 0;
    if (!cur || r.reason !== curReason || ms - lastMs > 20000) {
      curKey = "g" + (seq++); curReason = r.reason; cur = null;
    }
    lastMs = ms;
    const key = curKey;
    let g = groups.get(key);
    if (!g) {
      const ch = saleChannelOfReason(r.reason);
      g = {
        id: "ADJ-" + r.id, source: "adjust", status: "shipped",
        channel: ch ? ch.name : "ออฟไลน์ / อื่นๆ", customer: "",
        dateIso: bangkokDateOf(r.created_at), ts: bangkokTimeOf(r.created_at),
        lineItems: [], items: 0
      };
      groups.set(key, g);
    }
    cur = g;
    const qty = -Number(r.delta);
    // The price really charged when ขายออก recorded it; otherwise today's catalog price.
    const charged = r.unit_price != null && Number.isFinite(Number(r.unit_price)) ? Number(r.unit_price) : null;
    g.lineItems.push({ sku: r.sku, qty, price: charged != null ? charged : (priceOf.has(r.sku) ? priceOf.get(r.sku) : null), ...(charged != null ? { charged: true } : {}) });
    g.items += qty;
  }
  const list = [...groups.values()];
  _saleMoveCache = { src: rows, list };
  return list;
}
/* Every sale the shop recorded: real orders + ปรับสต็อก sales. */
function loadSalesRecords() {
  const orders = (typeof loadOrders === "function" ? loadOrders() : []) || [];
  return orders.concat(saleMoveOrders());
}
/* ── ต้องจัดการ: per-SKU action board (วิเคราะห์ยอดขาย) ─────────────────────────
   Turns sales history into ONE segment + action per SKU: restock the sellers
   that are about to run out, push the rising ones, bundle/discount the slow and
   dead ones. Plain arithmetic over loadSalesRecords() (orders + ปรับสต็อก sales)
   and receive dates — no schema. History only exists since the shop started
   recording, so velocity divides by the days actually OBSERVED (never the full
   window) and stock received recently is "new", not dead. */
let _receiveDates = null;          // sku → { first, last } (ms)
let _receiveInflight = null;
function refreshReceiveDates() {
  if (typeof dbLoadReceiveDates !== "function") return Promise.resolve();
  if (_receiveInflight) return _receiveInflight;
  const since = new Date(Date.now() - SALE_MOVES_DAYS * 86400000).toISOString();
  _receiveInflight = dbLoadReceiveDates(since).then(rows => {
    if (!Array.isArray(rows)) return;
    const m = new Map();
    for (const r of rows) {
      const ms = Date.parse(r && r.created_at) || 0;
      if (!r || !r.sku || !ms) continue;
      const e = m.get(r.sku);
      if (!e) m.set(r.sku, { first: ms, last: ms });
      else { if (ms < e.first) e.first = ms; if (ms > e.last) e.last = ms; }
    }
    _receiveDates = m;
    window.dispatchEvent(new CustomEvent("ims-sales-change"));
  }).catch(() => {}).then(() => { _receiveInflight = null; });
  return _receiveInflight;
}

const SKU_SEGMENTS = [
  { id: "restock", label: "ขายดี · ใกล้หมด", tone: "danger",  action: "สั่งเพิ่มก่อนของขาด — ของขาดคือยอดขายที่หายไปทันที" },
  { id: "rising",  label: "กำลังมาแรง",      tone: "info",    action: "เร่งโปรโมต และกันสต็อกไว้ให้พอ" },
  { id: "star",    label: "ขายดี",            tone: "success", action: "ลงขายให้ครบทุกช่องทาง และใช้เป็นตัวหลักในชุดสินค้า" },
  { id: "ok",      label: "ปกติ",             tone: "neutral", action: "ขายสม่ำเสมอ สต็อกพอดี" },
  { id: "slow",    label: "ขายช้า",           tone: "warning", action: "จัดชุดคู่กับสินค้าขายดี หรือทำโปรเล็กน้อย" },
  { id: "dead",    label: "ไม่มียอดขาย",      tone: "danger",  action: "เช็กรูป / ที่จัดเก็บ / การลงขาย แล้วลดราคาเป็นขั้น หรือจัดชุด" },
  { id: "new",     label: "สินค้าใหม่",       tone: "neutral", action: "เพิ่งรับเข้า ยังเร็วเกินไปที่จะตัดสิน" }
];

function buildSkuInsights(opts) {
  const o = Object.assign({ days: 60, coverLow: 14, coverHigh: 90, newDays: 30, targetCover: 30 }, opts || {});
  const DAY = 86400000;
  const today = todayIso();
  const todayMs = Date.parse(today + "T00:00:00+07:00");
  const ageOf = (iso) => Math.round((todayMs - Date.parse(iso + "T00:00:00+07:00")) / DAY); // 0 = today

  const records = (loadSalesRecords() || []).filter(r => r && r.dateIso && r.status !== "cancelled");
  let oldest = 0;
  for (const r of records) { const a = ageOf(r.dateIso); if (a > oldest) oldest = a; }
  const observed = Math.max(1, Math.min(o.days, oldest + 1));   // days of history inside the window
  const half = Math.min(30, Math.floor(observed / 2));           // recent vs previous block for the trend

  const per = new Map();
  const chTotals = new Map();
  for (const r of records) {
    const age = ageOf(r.dateIso);
    if (!Array.isArray(r.lineItems) || !(age >= 0)) continue;
    for (const li of r.lineItems) {
      const qty = Number(li && li.qty) || 0;
      if (!li || !li.sku || qty <= 0) continue;
      let a = per.get(li.sku);
      if (!a) { a = { win: 0, revenue: 0, priced: false, recent: 0, prev: 0, lastAge: Infinity, ch: new Map() }; per.set(li.sku, a); }
      if (age < a.lastAge) a.lastAge = age;
      if (age >= observed) continue;
      a.win += qty;
      if (li.price != null) { a.revenue += qty * (Number(li.price) || 0); a.priced = true; }
      if (age < half) a.recent += qty; else if (age < half * 2) a.prev += qty;
      // Lines carry the channel ID ("facebook"), orders the display name — fold both to the name.
      const raw = String(li.ch || r.channel || "").trim();
      const meta = CHANNEL_LIST.find(c => c.id === raw || c.name.toLowerCase() === raw.toLowerCase());
      const ch = meta ? meta.name : raw;
      if (ch && ch !== "ฉลาก") { a.ch.set(ch, (a.ch.get(ch) || 0) + qty); chTotals.set(ch, (chTotals.get(ch) || 0) + qty); }
    }
  }
  // Channels that carry real volume — a best seller missing from one of them is a listing gap.
  const allUnits = [...chTotals.values()].reduce((s, v) => s + v, 0);
  // Offline / other isn't a storefront you can list on, so it never counts as a gap.
  const otherCh = CHANNEL_LIST.find(c => c.id === "other");
  const mainChannels = [...chTotals.entries()]
    .filter(([k, v]) => v >= allUnits * 0.1 && !(otherCh && k === otherCh.name)).map(([k]) => k);

  const rows = [];
  for (const p of PRODUCTS) {
    const a = per.get(p.sku);
    const qty = Math.max(0, Number(p.qty) || 0);
    if (qty <= 0 && !(a && a.win >= 3)) continue;               // out of stock and not really selling — nothing to act on
    const units = a ? a.win : 0;
    const price = Number(p.price) || 0;
    const revenue = a ? (a.priced ? a.revenue : units * price) : 0;
    const perDay = units / observed;
    const cover = perDay > 0 ? qty / perDay : Infinity;
    const rec = _receiveDates && _receiveDates.get(p.sku);
    const firstAge = rec ? Math.floor((Date.now() - rec.first) / DAY) : null;
    const lastSaleAge = a && a.lastAge !== Infinity ? a.lastAge : null;
    const cost = p.cost != null && p.cost !== "" ? Number(p.cost) : null;
    // Supplier lead time (products.lead_days); null = unknown → the fixed defaults.
    const lead = p.lead_days != null && p.lead_days !== "" && Number.isFinite(Number(p.lead_days)) ? Number(p.lead_days) : null;
    rows.push({
      sku: p.sku, name: p.name, cat: p.cat, supplier: p.supplier, qty, price, cost, lead,
      units, revenue, perDay, cover, lastSaleAge, firstAge,
      recent: a ? a.recent : 0, prev: a ? a.prev : 0,
      channels: a ? [...a.ch.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k) : [],
      tiedUp: cost != null ? qty * cost : null,
      stockValue: qty * price,
      stored: typeof productIsStored === "function" ? productIsStored(p) : true
    });
  }

  // Best sellers = the SKUs that together make 80% of revenue in the window.
  const byRev = rows.filter(r => r.revenue > 0).sort((x, y) => y.revenue - x.revenue);
  const totalRev = byRev.reduce((s, r) => s + r.revenue, 0);
  const stars = new Set();
  let cum = 0;
  for (const r of byRev) { if (cum >= totalRev * 0.8) break; stars.add(r.sku); cum += r.revenue; }

  for (const r of rows) {
    const isNew = r.firstAge != null && r.firstAge < o.newDays;
    // With a known lead time, "about to run out" = less stock than the delivery
    // takes plus a week's buffer; the reorder covers delivery + 3 more weeks.
    r.coverLow = r.lead != null ? Math.max(7, r.lead + 7) : o.coverLow;
    r.target = r.lead != null ? r.lead + 21 : o.targetCover;
    // Restock needs a real selling rate — 1 piece in 60 days that happens to be at 0 is not a reorder.
    if (r.units >= 3 && r.cover < r.coverLow) r.seg = "restock";
    else if (r.units === 0) r.seg = isNew ? "new" : "dead";
    else if (stars.has(r.sku)) r.seg = "star";
    // Rising: a clear jump on a non-trivial base, so a SKU going 1 → 3 isn't "trending".
    else if (half >= 7 && r.recent >= 5 && r.recent >= Math.max(r.prev, 1) * 1.5) r.seg = "rising";
    else if (r.cover > o.coverHigh) r.seg = isNew ? "new" : "slow";
    else r.seg = "ok";
    r.isStar = stars.has(r.sku);
    r.reorder = r.perDay > 0 ? Math.max(0, Math.ceil(r.perDay * r.target - r.qty)) : 0;
    r.missingChannels = (r.isStar || r.seg === "rising") ? mainChannels.filter(c => !r.channels.includes(c)) : [];
    // Discount ladder for stock that isn't moving — never below cost + 5% when cost is known.
    const idle = r.lastSaleAge != null ? r.lastSaleAge : Math.max(observed, r.firstAge || 0);
    r.idleDays = idle;
    r.discountPct = (r.seg === "dead" || r.seg === "slow") ? (idle >= 90 ? 20 : idle >= 45 ? 10 : 0) : 0;
    r.promoPrice = r.discountPct && r.price > 0
      ? Math.max(Math.round(r.price * (1 - r.discountPct / 100)), r.cost != null ? Math.ceil(r.cost * 1.05) : 0)
      : null;
    if (r.promoPrice != null && r.promoPrice >= r.price) r.promoPrice = null;  // no room above cost
  }
  // Bundle partner for slow/dead items: the best seller in the same category.
  const topByCat = new Map();
  for (const r of byRev) if (r.cat && !topByCat.has(r.cat)) topByCat.set(r.cat, r);
  for (const r of rows) {
    if (r.seg !== "slow" && r.seg !== "dead") continue;
    const t = topByCat.get(r.cat) || byRev[0];
    r.partner = t && t.sku !== r.sku ? { sku: t.sku, name: t.name } : null;
    // A few more candidates for the bundle dialog: same-category sellers first, then overall.
    const seen = new Set([r.sku]);
    r.partners = byRev.filter(x => x.cat === r.cat).concat(byRev)
      .filter(x => !seen.has(x.sku) && seen.add(x.sku)).slice(0, 6).map(x => ({ sku: x.sku, name: x.name }));
  }

  const segs = SKU_SEGMENTS.map(s => {
    const list = rows.filter(r => r.seg === s.id);
    return Object.assign({}, s, {
      count: list.length,
      qty: list.reduce((n, r) => n + r.qty, 0),
      tiedUp: list.reduce((n, r) => n + (r.tiedUp || 0), 0),
      stockValue: list.reduce((n, r) => n + r.stockValue, 0)
    });
  });
  const key = {
    restock: (r) => -r.perDay, rising: (r) => -(r.recent - r.prev), star: (r) => -r.revenue, ok: (r) => -r.revenue,
    slow: (r) => -(r.tiedUp != null ? r.tiedUp : r.stockValue), dead: (r) => -(r.tiedUp != null ? r.tiedUp : r.stockValue),
    new: (r) => (r.firstAge || 0)
  };
  const segOrder = Object.fromEntries(SKU_SEGMENTS.map((s, i) => [s.id, i]));
  rows.sort((x, y) => (segOrder[x.seg] - segOrder[y.seg]) || (key[x.seg](x) - key[y.seg](y)));
  const startIso = records.length ? new Date(todayMs - oldest * DAY + 7 * 3600000).toISOString().slice(0, 10) : null;
  return { rows, segs, observed, startIso, mainChannels, opts: o };
}

/* Lead time for one product, or every product of the same supplier. Goes through
   updateManyProducts (scoped column update, RLS-checked). Returns how many were set. */
function hasLeadDaysColumn() { return PRODUCTS.some(p => p && Object.prototype.hasOwnProperty.call(p, "lead_days")); }
function setLeadDays(skus, days) {
  const v = days === "" || days == null ? null : Math.max(0, Math.min(365, Math.round(Number(days) || 0)));
  const list = (Array.isArray(skus) ? skus : [skus]).filter(Boolean);
  if (!list.length) return 0;
  updateManyProducts(list, { lead_days: v });
  window.dispatchEvent(new CustomEvent("ims-products-change"));
  return list.length;
}

/* ── ติดตามผล: what was done to push a SKU, and did it work ─────────────────────
   app_state "sales_actions" = { "<id>": { id, sku, kind, note, price, at, by } | null }.
   merge_app_state can only ADD keys, so a removed action is a null tombstone,
   filtered on read (same contract as pack_progress). Writes go one record at a
   time through dbMergeState and roll the local mirror back when refused. */
const SALES_ACTIONS_KEY = "sales_actions";
const SALES_ACTIONS_LS = "ims_sales_actions";
const SALES_ACTION_KINDS = [
  { id: "promo",   label: "ลดราคา / โปร" },
  { id: "bundle",  label: "จัดชุด" },
  { id: "listing", label: "ลงขายช่องทางใหม่" },
  { id: "ads",     label: "ยิงแอด / โพสต์" },
  { id: "photo",   label: "ปรับรูป / รายละเอียด" },
  { id: "other",   label: "อื่นๆ" }
];
function salesActionKindLabel(id) { const k = SALES_ACTION_KINDS.find(x => x.id === id); return k ? k.label : (id || "อื่นๆ"); }
function _salesActionsRaw() {
  let m = window._DB_SALES_ACTIONS;
  if (!m || typeof m !== "object") {
    try { m = JSON.parse(localStorage.getItem(SALES_ACTIONS_LS) || "null"); } catch (e) { m = null; }
  }
  return (m && typeof m === "object") ? m : {};
}
function loadSalesActions() {
  const m = _salesActionsRaw();
  return Object.keys(m).map(k => m[k]).filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
function _salesActionsMirror(m) {
  window._DB_SALES_ACTIONS = m;
  try { localStorage.setItem(SALES_ACTIONS_LS, JSON.stringify(m)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-sales-actions-change"));
}
let _salesActionsInflight = null;
function refreshSalesActions() {
  if (typeof dbLoadState !== "function") return Promise.resolve();
  if (_salesActionsInflight) return _salesActionsInflight;
  _salesActionsInflight = dbLoadState(SALES_ACTIONS_KEY).then(v => {
    if (v && typeof v === "object") _salesActionsMirror(v);
  }).catch(() => {}).then(() => { _salesActionsInflight = null; });
  return _salesActionsInflight;
}
async function _salesActionPush(id, value) {
  let res;
  try {
    if (typeof dbMergeState === "function") res = await dbMergeState(SALES_ACTIONS_KEY, { [id]: value });
    if ((res === null || res === undefined) && typeof dbSaveState === "function") {
      const full = Object.assign({}, _salesActionsRaw(), { [id]: value });
      res = await dbSaveState(SALES_ACTIONS_KEY, full);
    }
  } catch (e) { res = { error: String(e) }; }
  return res && !res.error ? { ok: true } : { ok: false, error: (res && res.error) || "เชื่อมต่อไม่ได้" };
}
/* Record one action. Resolves { ok, action } or { ok:false } (already rolled back + toasted). */
async function addSalesAction(a) {
  if (!a || !a.sku) return { ok: false };
  const rec = {
    id: "SA-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
    sku: a.sku, kind: a.kind || "other", note: String(a.note || "").slice(0, 200),
    price: a.price != null && a.price !== "" ? Number(a.price) || null : null,
    at: a.at || new Date().toISOString(),
    by: (window.__currentUser && window.__currentUser.name) || ""
  };
  const prev = _salesActionsRaw();
  _salesActionsMirror(Object.assign({}, prev, { [rec.id]: rec }));
  const r = await _salesActionPush(rec.id, rec);
  if (!r.ok) { _salesActionsMirror(prev); _blobWriteFailed("การติดตามผล", r.error); return { ok: false }; }
  return { ok: true, action: rec };
}
async function removeSalesAction(id) {
  const prev = _salesActionsRaw();
  if (!prev[id]) return { ok: true };
  _salesActionsMirror(Object.assign({}, prev, { [id]: null }));
  const r = await _salesActionPush(id, null);
  if (!r.ok) { _salesActionsMirror(prev); _blobWriteFailed("การติดตามผล", r.error); return { ok: false }; }
  return { ok: true };
}

/* Before / after for every action: units per day in the `win` days before the
   action vs the days since (capped at `win`). Verdict needs at least 7 days
   after — a promo judged on day 2 is noise. */
function buildActionResults(opts) {
  const o = Object.assign({ win: 14, minDays: 7 }, opts || {});
  const DAY = 86400000;
  const daily = new Map();   // sku → Map(dateIso → units)
  for (const r of (loadSalesRecords() || [])) {
    if (!r || !r.dateIso || r.status === "cancelled" || !Array.isArray(r.lineItems)) continue;
    for (const li of r.lineItems) {
      const q = Number(li && li.qty) || 0;
      if (!li || !li.sku || q <= 0) continue;
      let m = daily.get(li.sku); if (!m) { m = new Map(); daily.set(li.sku, m); }
      m.set(r.dateIso, (m.get(r.dateIso) || 0) + q);
    }
  }
  const isoOf = (ms) => new Date(ms + 7 * 3600000).toISOString().slice(0, 10);   // Bangkok date
  const sum = (sku, fromMs, days) => {
    const m = daily.get(sku); if (!m || days <= 0) return 0;
    let s = 0;
    for (let i = 0; i < days; i++) s += m.get(isoOf(fromMs + i * DAY)) || 0;
    return s;
  };
  const today0 = Date.parse(todayIso() + "T00:00:00+07:00");
  return loadSalesActions().map(a => {
    const start0 = Date.parse(isoOf(Date.parse(a.at) || Date.now()) + "T00:00:00+07:00");
    const afterDays = Math.max(0, Math.min(o.win, Math.round((today0 - start0) / DAY) + 1));
    const before = sum(a.sku, start0 - o.win * DAY, o.win);
    const after = sum(a.sku, start0, afterDays);
    const bRate = before / o.win, aRate = afterDays ? after / afterDays : 0;
    let verdict = "wait";
    if (afterDays >= o.minDays) {
      if (aRate > bRate * 1.5 && after - before * afterDays / o.win >= 2) verdict = "up";
      else if (aRate < bRate * 0.75) verdict = "down";
      else verdict = "flat";
    }
    const p = PRODUCTS.find(x => x.sku === a.sku);
    return Object.assign({}, a, { name: p ? p.name : a.sku, qtyNow: p ? Number(p.qty) || 0 : null,
      before, after, afterDays, bRate, aRate, verdict, win: o.win });
  });
}
const ACTION_VERDICTS = {
  up:   { label: "ได้ผล",       tone: "success" },
  flat: { label: "ยังไม่ต่าง",   tone: "warning" },
  down: { label: "ยอดลดลง",     tone: "danger"  },
  wait: { label: "รอผล",        tone: "neutral" }
};

/* Today's sales per channel — what the "ออร์เดอร์ตามช่องทาง" cards show.
   Returns CHANNEL_LIST rows with { sales, units, pct } (pct of today's units). */
function channelToday() {
  const today = todayIso();
  const byId = {};
  CHANNEL_LIST.forEach(c => { byId[c.id] = { sales: 0, units: 0 }; });
  const nameToId = {};
  CHANNEL_LIST.forEach(c => { nameToId[c.name] = c.id; });
  for (const o of loadSalesRecords()) {
    if (!o || o.dateIso !== today) continue;
    const chName = (o.channel || "").trim();
    if (chName === "ฉลาก") continue;
    const id = nameToId[chName] || "other";
    const units = Array.isArray(o.lineItems) && o.lineItems.length
      ? o.lineItems.reduce((s, li) => s + (Number(li && li.qty) || 0), 0)
      : (Number(o.items) || 0);
    byId[id].sales += 1;
    byId[id].units += units;
  }
  const totalUnits = Object.values(byId).reduce((s, v) => s + v.units, 0);
  return CHANNEL_LIST.map(c => ({
    ...c, sales: byId[c.id].sales, units: byId[c.id].units,
    pct: totalUnits ? Math.round(byId[c.id].units * 100 / totalUnits) : 0
  }));
}

/* A label-born "order" that is really an empty draft (no name, no items, no
   tracking) — kept on the label queue, but it must not count as work waiting. */
function isBlankDraftOrder(o) {
  if (!o || o.tracking) return false;
  const noName = !o.customer || o.customer === "ไม่ระบุชื่อ" || /^ฉลากใหม่/.test(o.customer);
  const noItems = !(Number(o.items) > 0) && !(Array.isArray(o.lineItems) && o.lineItems.length);
  return noName && noItems;
}
/* Orders that genuinely need action (รอแพ็ค / พร้อมส่ง), blank drafts excluded. */
function isPendingOrder(o) {
  return !!o && (o.status === "picking" || o.status === "packed") && !isBlankDraftOrder(o);
}

/* One Thai name per order status, used by every screen (desktop + mobile). */
const ORDER_STATUS_TH = { picking: "รอแพ็ค", packed: "พร้อมส่ง", shipped: "ส่งแล้ว", delivered: "จัดส่งสำเร็จ" };

/* Human-readable order reference: label drafts carry ids like
   "LBL-NEW-1781451656731-762" — show "ฉลาก #762" instead. */
function orderShortId(o) {
  const id = String((o && o.id) || "");
  const m = /^LBL-(?:NEW-)?\d+-(\d+)$/.exec(id);
  return m ? "ฉลาก #" + m[1] : id;
}
/* Channel for display — label-born orders have no sales channel. */
function orderChannelLabel(o) {
  const ch = ((o && o.channel) || "").trim();
  return ch === "ฉลาก" ? "จากฉลาก" : (ch || "ไม่ระบุ");
}

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
  { id: "packer",  label: "พนักงานแพ็ค", desc: "เห็นเฉพาะหน้าแพ็คสินค้า: หยิบ ติ๊ก แพ็คเสร็จ และพิมพ์ใบปะหน้า", color: "oklch(0.62 0.17 55)", badge: "badge-warning" },
  { id: "viewer",  label: "ดูเท่านั้น",   desc: "ดูข้อมูลและรายงานได้ ไม่สามารถแก้ไข",         color: "oklch(0.55 0.01 80)",  badge: "badge-neutral" }
];

/* "adjust" is a mobile-menu-only id (no ALL_NAV entry, so it can never appear
   in the desktop sidebar) — it gates the MMore ปรับสต็อก row per role. */
const ROLE_NAV = {
  admin:   ["dashboard","inbound","outbound","pack","finder","inventory","stocktake","adjust","locations","import","bundles","labels","tracking","analytics","handheld","users","layout","history","settings"],
  manager: ["dashboard","inbound","outbound","pack","finder","inventory","stocktake","adjust","locations","import","bundles","labels","tracking","analytics","handheld","history","settings"],
  staff:   ["dashboard","inbound","outbound","pack","finder","inventory","stocktake","adjust","locations","bundles","labels","tracking","handheld"],
  // พนักงานแพ็ค — the แพ็คสินค้า page only (desktop sidebar AND mobile: no home/tabs).
  packer:  ["pack"],
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
  { id: "renameSku",   label: "แก้ไขรหัส SKU",       desc: "เปลี่ยนรหัส SKU ของสินค้าเดิม (ย้ายสต็อก ตำแหน่ง และชุดสินค้าไปรหัสใหม่ทันที)", server: ["admin", "manager"] },
  { id: "deleteData",  label: "ลบข้อมูล",            desc: "ลบสินค้า ออร์เดอร์ และอาคาร/ชั้น/ตำแหน่ง", server: ["admin", "manager"] },
  { id: "exportData",  label: "ส่งออก/พิมพ์รายงาน",  desc: "ดาวน์โหลด CSV รายงาน Excel และพิมพ์รายงาน" }
];

const DEFAULT_ROLE_CAPS = {
  admin:   { viewCost: true,  viewSales: true,  sell: true,  adjustStock: true,  addProduct: true,  editProduct: true,  renameSku: true,  deleteData: true,  exportData: true },
  manager: { viewCost: true,  viewSales: true,  sell: true,  adjustStock: true,  addProduct: true,  editProduct: true,  renameSku: true,  deleteData: true,  exportData: true },
  // Warehouse staff work the floor: they move stock but never see money.
  staff:   { viewCost: false, viewSales: false, sell: true,  adjustStock: true,  addProduct: true,  editProduct: true,  renameSku: false, deleteData: false, exportData: true },
  packer:  { viewCost: false, viewSales: false, sell: false, adjustStock: false, addProduct: false, editProduct: false, renameSku: false, deleteData: false, exportData: false },
  viewer:  { viewCost: true,  viewSales: true,  sell: false, adjustStock: false, addProduct: false, editProduct: false, renameSku: false, deleteData: false, exportData: true }
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
  return { enabled: false, roles: ["staff", "packer", "viewer"], days, exceptions: {} };
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
// Convert a stored UTC ISO timestamp (e.g. label.created_at) to its Asia/Bangkok
// calendar date. A raw .slice(0,10) on the UTC string gives the WRONG day for
// anything created 00:00–06:59 Bangkok. Guards an unparseable input.
function bangkokDateOf(isoStr) {
  const t = Date.parse(isoStr || "");
  if (!Number.isFinite(t)) return (isoStr || "").slice(0, 10);
  return bangkokDateStr(t);
}
// "HH:MM" in Asia/Bangkok for a stored UTC timestamp. Pairs with bangkokDateOf
// so the clock time always belongs to the day header printed above it — a plain
// toLocaleTimeString() would drift onto another day on a device set to another
// time zone, which is exactly what makes an activity feed unreadable.
function bangkokTimeOf(isoStr) {
  const t = Date.parse(isoStr || "");
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(t));
  } catch (e) {
    return new Date(t).toTimeString().slice(0, 5);
  }
}
// Bangkok "YYYY-MM-DD" shifted by whole days — powers the ◀ ▶ day steppers.
function shiftDayKey(dateKey, delta) {
  const t = Date.parse(String(dateKey || "") + "T12:00:00+07:00");
  if (!Number.isFinite(t)) return bangkokDateStr();
  return bangkokDateStr(t + delta * 86400000);
}
// "วันนี้" / "เมื่อวาน" / "30 ก.ค. 2569" for a Bangkok day key.
function thaiDayLabel(dateKey) {
  if (!dateKey) return "";
  const today = bangkokDateStr();
  if (dateKey === today) return "วันนี้";
  if (dateKey === shiftDayKey(today, -1)) return "เมื่อวาน";
  return isoToThai(dateKey);
}
// [[dayKey, entries], ...] — newest day first, entries newest first inside it.
// Grouping is by BANGKOK day, not by the UTC prefix of the timestamp: anything
// logged 00:00–06:59 local carries the previous UTC date and would otherwise be
// filed under the wrong heading.
function groupAuditByDay(list) {
  const map = new Map();
  (list || []).forEach(e => {
    const k = bangkokDateOf(e && e.ts);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  });
  return Array.from(map.entries());
}
// Direction of an audit entry, for the coloured dot: stock in / stock out /
// neutral edit. Quantity deltas are written into the summary as "-2 ชิ้น".
function auditTone(e) {
  const m = /([+-]\d+)\s*ชิ้น/.exec(String((e && e.summary) || ""));
  if (m) return Number(m[1]) >= 0 ? "in" : "out";
  const action = (e && e.action) || "";
  if (action === "create") return "in";
  if (action === "delete" || action === "bulk-delete") return "out";
  return "move";
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

/* ── ตัดสต็อก cart → one write plan ──────────────────────────────────────
   The stock-out flow takes SEVERAL lines at once (desktop IssueModal, mobile
   MIssue). Both forks funnel their cart through here so the deduction list,
   shelf picks, line items and per-channel split can't diverge.

   lines = [
     { type: "product", sku, name?, qty, loc?, ch? },
     { type: "bundle",  id, name, items: [{sku, qty}], qty, ch? }
   ]
   `ch` is a CHANNEL_LIST id and is per LINE — the same sku may appear twice on
   two channels (that's how the old single-sku multi-channel split survives a
   multi-item cart). Returns:
     skuDeducts   [{sku, qty}]  — aggregated per sku, for deductManyAndPersist
     locPicks     [{sku, loc}]  — for applyLocPicks (duplicates are fine)
     lineItems    snapLineItem rows, each tagged with its own `ch`
     channelSplit [{id,name,color,qty}] — the order's `deductions` field
     channelLabel / totalQty / lineCount / hasBundle / bundleNames */
function buildIssuePlan(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const skuMap = new Map();     // sku → total pieces
  const chMap = new Map();      // channel id → units entered (ชิ้น or ชุด)
  const locPicks = [];
  const lineItems = [];
  const bundleNames = [];
  let totalQty = 0, lineCount = 0;

  list.forEach(line => {
    const n = Math.max(0, Math.round(Number(line && line.qty) || 0));
    if (!line || !n) return;
    lineCount++;
    totalQty += n;
    const ch = line.ch || "";
    if (ch) chMap.set(ch, (chMap.get(ch) || 0) + n);
    if (line.type === "bundle") {
      bundleNames.push(line.name || line.id);
      (line.items || []).forEach(ci => {
        const need = (Number(ci.qty) || 0) * n;
        if (!ci.sku || !need) return;
        skuMap.set(ci.sku, (skuMap.get(ci.sku) || 0) + need);
        // Bundle components take their own default shelf — no per-component picker.
        const cp = PRODUCTS.find(x => x.sku === ci.sku);
        locPicks.push({ sku: ci.sku, loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(cp) : (cp && cp.loc) || "" });
        const row = snapLineItem(ci.sku, null, need);
        if (ch) row.ch = ch;
        lineItems.push(row);
      });
    } else {
      if (!line.sku) return;
      skuMap.set(line.sku, (skuMap.get(line.sku) || 0) + n);
      locPicks.push({ sku: line.sku, loc: line.loc || "" });
      const row = snapLineItem(line.sku, line.name || null, n, line.loc || "");
      if (ch) row.ch = ch;
      lineItems.push(row);
    }
  });

  const skuDeducts = [];
  skuMap.forEach((qty, sku) => skuDeducts.push({ sku, qty }));
  const channelSplit = CHANNEL_LIST
    .filter(c => (chMap.get(c.id) || 0) > 0)
    .map(c => ({ id: c.id, name: c.name, color: c.color, qty: chMap.get(c.id) }));
  const channelLabel = channelSplit.length === 1 ? channelSplit[0].name
    : channelSplit.length > 1 ? `${channelSplit.length} ช่องทาง`
    : "ตัดสต็อก";

  return {
    skuDeducts, locPicks, lineItems, channelSplit, channelLabel,
    totalQty, lineCount, hasBundle: bundleNames.length > 0, bundleNames
  };
}

/* ตัดสต็อก opens on the channel this device last used — most manual cuts in a
   row come from the same place (e.g. a run of Facebook chat sales). Per device
   on purpose: two staff on two channels shouldn't fight over one shared value. */
const ISSUE_CH_KEY = "ims_issue_last_ch";
function lastIssueChannel() {
  let v = "";
  try { v = localStorage.getItem(ISSUE_CH_KEY) || ""; } catch (e) {}
  return CHANNEL_LIST.some(c => c.id === v) ? v : "shopee";
}
function rememberIssueChannel(ch) {
  if (!CHANNEL_LIST.some(c => c.id === ch)) return;
  try { localStorage.setItem(ISSUE_CH_KEY, ch); } catch (e) {}
}

/* Optional shipping details typed at ตัดสต็อก time. A tracking number means the
   parcel is already handed to the courier, so the order starts as "shipped"
   instead of entering the pack queue. */
/* Order date for ตัดสต็อก — staff often key in yesterday's sales, and the order
   must be filed under the day it was SOLD, not the day it was typed. A future
   date is refused (clamped to today). Returns { dateIso, ts, createdAt, backdated }:
   a backdated order gets no clock time (unknown) and a label timestamp of noon
   Bangkok so bangkokDateOf() lands on the chosen day. */
function issueOrderDate(picked) {
  // "YYYY-MM-DDTHH:MM" (the วันเวลา picker) or "" → exact moment, time kept.
  if (!picked || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(picked))) {
    const st = stockOutStamp(picked);
    return { dateIso: st.dateIso, backdated: st.backdated, ts: st.ts, createdAt: st.createdAt };
  }
  const today = (typeof todayIso === "function") ? todayIso() : new Date().toISOString().slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(picked || "")) ? String(picked) : today;
  const dateIso = d > today ? today : d;
  const backdated = dateIso !== today;
  return {
    dateIso, backdated,
    ts: backdated ? "" : new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
    createdAt: backdated ? new Date(dateIso + "T12:00:00+07:00").toISOString() : new Date().toISOString()
  };
}
/* ── วันเวลา picker for every stock-out (ตัดสต็อก, ปรับสต็อก, ขายออก, ขาย+จัดส่ง,
   ขายชุด) ── value is a datetime-local "YYYY-MM-DDTHH:MM" read as Bangkok
   wall-clock time; "" = now. Bangkok has no DST, so a fixed +07:00 is exact. */
function nowBkkLocal(nowMs) {
  const d = new Date((typeof nowMs === "number" ? nowMs : Date.now()) + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
// → { dateIso, ts, createdAt, backdated }. A future value clamps to now; an
// unparseable or empty one means now. Backdated = at least a minute in the past.
function stockOutStamp(local) {
  const now = Date.now();
  let t = (typeof local === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local))
    ? Date.parse(local.slice(0, 16) + ":00+07:00") : NaN;
  if (!Number.isFinite(t) || t > now) t = now;
  const wall = nowBkkLocal(t);
  return { dateIso: wall.slice(0, 10), ts: wall.slice(11, 16), createdAt: new Date(t).toISOString(), backdated: now - t >= 60 * 1000 };
}
// The ISO time a backdated pick dates its history row to; undefined = now.
function stockOutAt(local) {
  const st = local ? stockOutStamp(local) : null;
  return st && st.backdated ? st.createdAt : undefined;
}
// "30 ก.ย. 2569 14:30" — for toasts / audit notes / history reasons.
function stockOutStampLabel(stamp) {
  return stamp ? `${isoToThai(stamp.dateIso)} ${stamp.ts}`.trim() : "";
}
const ISSUE_CARRIERS = ["KEX", "Flash Express", "J&T Express", "ไปรษณีย์ไทย", "Ninja Van", "DHL", "Best Express", "SCG Express", "Alpha Fast", "Lalamove"];
function issueShipFields(ship) {
  const s = ship || {};
  const tracking = String(s.tracking || "").trim();
  const carrier = String(s.carrier || "").trim();
  const phone = String(s.phone || "").trim();
  return { tracking, carrier, phone, status: tracking ? "shipped" : "picking" };
}

/* ── ยกเลิกออร์เดอร์ + คืนสต็อก ──
   The reverse of a ตัดสต็อก: every piece goes back to the SHELF the sale took
   it from (packLinesForOrder prefers lineItems[].loc — the same resolver the
   packer uses), through the receive choke point so the movement ledger records
   what the server really added. Then the order is removed exactly like the
   existing delete, so analytics stop counting the sale.
   Only admin/manager may delete orders (RLS), so the delete runs FIRST and a
   blocked delete aborts before any stock moves — otherwise staff could put
   stock back while the sale stayed on the books. An override `restockedAt`
   stamp plus the commit latch make a second tap / second device a no-op.
   Returns { ok, restocked:[ids], skipped:[ids], blocked?, pieces }. */
/* What a cancel may put back: only lines a sale really debited — the order's own
   lineItems (each carries the shelf it left) plus เพิ่มรายการ lines. A label-only
   order (typed in the label editor) never moved stock, so restocking its label
   items would create stock out of nothing; it gets no lines and is skipped. */
function restockLinesForOrder(order) {
  if (!order) return [];
  const own = Array.isArray(order.lineItems) ? order.lineItems.filter(li => li && li.sku) : [];
  const extra = Array.isArray(order.addedItems) ? order.addedItems.filter(li => li && li.sku) : [];
  if (!own.length && !extra.length) return [];
  // Label-born order + เพิ่มรายการ: only the added lines were cut; without own
  // lineItems the resolver would fall back to the label's (never debited) items.
  if (!own.length) return packLinesForOrder(Object.assign({}, order, { lineItems: extra, addedItems: [] }));
  return packLinesForOrder(order);
}

async function cancelOrdersAndRestock(orders, reasonNote) {
  const list = (Array.isArray(orders) ? orders : []).filter(Boolean);
  const out = { ok: true, restocked: [], skipped: [], pieces: 0 };
  if (!list.length) return out;
  const overrides = (typeof loadOrderOverrides === "function") ? loadOrderOverrides() : {};
  // An order with no resolvable lines (custom sku-less items only) is left alone:
  // deleting it would drop the sale without anything to put back.
  const lines = [];
  const todo = [];
  list.forEach(o => {
    if (overrides[o.id] && overrides[o.id].restockedAt) { out.skipped.push(o.id); return; }
    const got = restockLinesForOrder(o);
    if (!got.length) { out.skipped.push(o.id); return; }
    got.forEach(l => lines.push({ sku: l.sku, qty: l.qty, loc: l.loc }));
    todo.push(o);
  });
  if (!todo.length) return out;

  const ids = todo.map(o => o.id);
  const key = commitFingerprint("cancel-restock", ids.map(id => ({ id, qty: 1 })));
  if (!claimCommit(key)) { duplicateCommitToast(); return { ...out, ok: false }; }

  if (typeof deleteOrdersFromDb === "function") {
    const res = await deleteOrdersFromDb(ids);
    if (res && res.blocked) { releaseCommit(key); return { ...out, ok: false, blocked: true }; }
  }
  out.restocked = ids.slice();
  out.pieces = lines.reduce((s, l) => s + l.qty, 0);

  const at = new Date().toISOString();
  if (typeof setOrderField === "function") {
    ids.forEach(id => setOrderField(id, { deleted: true, restockedAt: at }));
  }
  if (lines.length) {
    const note = String(reasonNote || "").trim();
    const reason = `ยกเลิกออร์เดอร์ ${out.restocked.join(", ")} — คืนสต็อก${note ? " · " + note : ""}`;
    // Same tick: applyReceiveLocs must see the new p.qty (the _planLocRows contract).
    receiveStockAndRecord(lines, reason);
    const r = await applyReceiveLocs(lines);
    if (r && r.errors && r.errors.length) out.locError = r.errors[0].error;
  }
  // The order is gone — drop its label file + attachments too (pack-docs.jsx),
  // or they stay in the DB forever with nothing pointing at them.
  if (typeof deleteOrderDocs === "function") deleteOrderDocs(out.restocked).catch(() => {});
  if (typeof recordChange === "function") {
    recordChange({
      entity: "order", action: "cancel-restock",
      summary: `ยกเลิก ${ids.length} ออร์เดอร์ และคืนสต็อก ${out.pieces} ชิ้น`,
      count: ids.length,
      changes: lines.map(l => ({ label: l.sku, to: `+${l.qty} ชิ้น${l.loc ? " → " + l.loc : ""}` })),
      note: `ออร์เดอร์: ${ids.join(", ")}`
    });
  }
  return out;
}

/* ── เพิ่มรายการ into an order already waiting in the pack queue ──
   The customer adds something after the sale ("เอาเพิ่มอีกตัว"). Stock leaves at
   ตัดสต็อก time, so the ADDED lines are cut here exactly like a sale — same plan
   builder, same deduction + shelf choke points — and only the added lines move
   stock; the original lines were already debited.
   Where the added lines live:
     • order with an `orders` row (ตัดสต็อก / สั่งแพ็คใหม่ / ขาย) → appended to its
       lineItems and the row re-upserted, so analytics count the extra units.
       Not through appendOrder: that wipes the override entry (status, shipTo,
       packedBy …) and re-fires the "new order" prompt.
     • label-born order (no row; detail lives on the label) → override
       `addedItems`, which _packSourceItems reads on top of the label items.
   Every added row carries `added: <iso>` so the pick list can flag it, and the
   override `addedLog` keeps who/when/what for the "มีการเพิ่มรายการ" banner.
   Returns { ok, pieces, lineCount } | { ok:false, error }. */
function _orderChannelId(order) {
  const li = (order && Array.isArray(order.lineItems)) ? order.lineItems.find(x => x && x.ch) : null;
  if (li && CHANNEL_LIST.some(c => c.id === li.ch)) return li.ch;
  const byName = CHANNEL_LIST.find(c => c.name === (order && order.channel));
  return byName ? byName.id : "other";
}
async function addItemsToPackOrder(order, lines, who) {
  if (!order || !order.id) return { ok: false, error: "ไม่พบออร์เดอร์" };
  const ch = _orderChannelId(order);
  const plan = buildIssuePlan((lines || []).map(l => ({ ...l, ch })));
  if (!plan.skuDeducts.length) return { ok: false, error: "ยังไม่ได้เลือกสินค้า" };
  // Whole-cart stock check per sku (bundles expanded) — never drive stock negative.
  const avail = (sku) => (typeof getEffectiveQty === "function") ? getEffectiveQty(sku) : ((PRODUCTS.find(p => p.sku === sku) || {}).qty || 0);
  const short = plan.skuDeducts.filter(d => d.qty > avail(d.sku)).map(d => d.sku);
  if (short.length) return { ok: false, error: "สต็อกไม่พอ: " + short.join(", ") };

  const key = commitFingerprint("pack-add:" + order.id, plan.skuDeducts);
  if (!claimCommit(key)) { duplicateCommitToast(); return { ok: false, error: "" }; }

  const at = new Date().toISOString();
  const added = plan.lineItems.map(li => ({ ...li, added: at }));
  const pieces = plan.skuDeducts.reduce((s, d) => s + d.qty, 0);

  deductManyAndPersist(plan.skuDeducts, `เพิ่มรายการ · ออร์เดอร์ ${order.id} (${plan.channelLabel})`);
  // Same tick as the qty write, before any other await — applyLocPicks re-reads p.qty.
  let locError = "";
  const r = await applyLocPicks(plan.locPicks);
  if (r && r.errors && r.errors.length) locError = r.errors[0].error;

  const overrides = (typeof loadOrderOverrides === "function") ? loadOrderOverrides() : {};
  const ov = overrides[order.id] || {};
  const logEntry = {
    at, by: who || "", pieces,
    items: plan.lineItems.map(li => ({ sku: li.sku, name: li.name, qty: li.qty }))
  };
  const patch = { addedLog: (Array.isArray(ov.addedLog) ? ov.addedLog : []).concat([logEntry]) };

  const row = loadOrders().find(o => o.id === order.id);
  if (row) {
    const deductions = (Array.isArray(row.deductions) ? row.deductions : []).map(d => ({ ...d }));
    plan.channelSplit.forEach(c => {
      const hit = deductions.find(d => d.id === c.id);
      if (hit) hit.qty = (Number(hit.qty) || 0) + c.qty; else deductions.push({ ...c });
    });
    const next = {
      ...row,
      lineItems: (Array.isArray(row.lineItems) ? row.lineItems : []).concat(added),
      items: (Number(row.items) || 0) + plan.lineCount,
      deductions,
      isBundle: !!(row.isBundle || plan.hasBundle),
      bundleName: [row.bundleName].concat(plan.bundleNames).filter(Boolean).join(", ") || undefined
    };
    const list = [next, ...loadOrders().filter(o => o.id !== order.id)];
    try { localStorage.setItem("ims_orders", JSON.stringify(list)); } catch (e) {}
    window._DB_ORDERS = list;
    if (typeof dbUpsertOrders === "function") {
      try {
        const res = await dbUpsertOrders([next]);
        if (res && res.error && typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("orders", [next]);
      } catch (e) {
        if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("orders", [next]);
      }
    }
  } else {
    patch.addedItems = (Array.isArray(ov.addedItems) ? ov.addedItems : []).concat(added);
  }
  // setOrderField fires ims-orders-change, so every screen re-reads both writes.
  if (typeof setOrderField === "function") setOrderField(order.id, patch);

  if (typeof recordChange === "function") {
    recordChange({
      entity: "order", entityId: order.id, action: "update",
      summary: `เพิ่มรายการเข้าออร์เดอร์ ${order.id} — ${plan.lineCount} รายการ (${pieces} ชิ้น)`,
      count: plan.lineCount,
      changes: (lines || []).filter(l => l && l.qty > 0).map(l => ({
        label: l.type === "bundle" ? `ชุด: ${l.name}` : (l.name || l.sku),
        to: `+${l.qty} ${l.type === "bundle" ? "ชุด" : "ชิ้น"}`
      })),
      note: `ออร์เดอร์ ${order.id} · ${plan.channelLabel}`
    });
  }
  return { ok: true, pieces, lineCount: plan.lineCount, locError };
}
/* ── ลบรายการ that was keyed into an order by mistake ──
   The reverse of addItemsToPackOrder for ONE pick line (sku × shelf): every
   source row behind that line is dropped from the order, and its pieces go back
   to the shelf the sale took them from through the receive choke point, so the
   ledger records what the server really added. Only rows a sale really debited
   are removable — the orders row's lineItems and override addedItems. Items that
   live only on a label never moved stock, so there is nothing to put back.
   The last line can't be removed: that is ยกเลิกออร์เดอร์ + คืนสต็อก.
   Returns { ok, pieces, locError? } | { ok:false, error }. */
async function removeItemFromPackOrder(order, line, who) {
  if (!order || !order.id || !line || !line.key) return { ok: false, error: "ไม่พบรายการ" };
  const keyOf = (li) => {
    const p = PRODUCTS.find(x => x.sku === li.sku);
    return packKey(li.sku, li.loc || defaultPickLoc(p) || "");
  };
  const hit = (li) => li && li.sku && keyOf(li) === line.key;
  const row = loadOrders().find(o => o.id === order.id);
  const overrides = (typeof loadOrderOverrides === "function") ? loadOrderOverrides() : {};
  const ov = overrides[order.id] || {};
  const rowItems = row && Array.isArray(row.lineItems) ? row.lineItems : [];
  const addItems = Array.isArray(ov.addedItems) ? ov.addedItems : [];
  const removed = rowItems.filter(hit).concat(addItems.filter(hit));
  if (!removed.length) return { ok: false, error: "รายการนี้มาจากฉลาก ไม่ได้ตัดสต็อก — แก้ที่หน้าฉลากแทน" };
  if (packLinesForOrder(order).filter(l => l.key !== line.key).length === 0) {
    return { ok: false, error: "เป็นรายการสุดท้ายของออร์เดอร์ — ใช้ ยกเลิกออร์เดอร์ + คืนสต็อก แทน" };
  }
  const pieces = removed.reduce((s, li) => s + Math.max(0, Math.round(Number(li.qty) || 0)), 0);
  const ckey = commitFingerprint("pack-remove:" + order.id + ":" + line.key, [{ sku: line.sku, qty: pieces }]);
  if (!claimCommit(ckey)) { duplicateCommitToast(); return { ok: false, error: "" }; }

  const at = new Date().toISOString();
  const patch = {
    removedLog: (Array.isArray(ov.removedLog) ? ov.removedLog : []).concat([{ at, by: who || "", sku: line.sku, loc: line.loc || "", qty: pieces }])
  };
  if (addItems.some(hit)) patch.addedItems = addItems.filter(li => !hit(li));

  if (row && rowItems.some(hit)) {
    const gone = rowItems.filter(hit);
    const deductions = (Array.isArray(row.deductions) ? row.deductions : []).map(d => ({ ...d }));
    gone.forEach(li => {
      const d = li.ch && deductions.find(x => x.id === li.ch);
      if (d) d.qty = Math.max(0, (Number(d.qty) || 0) - (Number(li.qty) || 0));
    });
    const next = {
      ...row,
      lineItems: rowItems.filter(li => !hit(li)),
      items: Math.max(0, (Number(row.items) || 0) - gone.length),
      deductions: deductions.filter(d => (Number(d.qty) || 0) > 0)
    };
    const list = [next, ...loadOrders().filter(o => o.id !== order.id)];
    try { localStorage.setItem("ims_orders", JSON.stringify(list)); } catch (e) {}
    window._DB_ORDERS = list;
    if (typeof dbUpsertOrders === "function") {
      try {
        const res = await dbUpsertOrders([next]);
        if (res && res.error && typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("orders", [next]);
      } catch (e) {
        if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("orders", [next]);
      }
    }
  }
  if (typeof setOrderField === "function") setOrderField(order.id, patch);

  // Same tick: applyReceiveLocs must see the new p.qty (the _planLocRows contract).
  const back = [{ sku: line.sku, qty: pieces, loc: line.loc || "" }];
  receiveStockAndRecord(back, `ลบรายการออกจากออร์เดอร์ ${order.id} — คืนสต็อก`);
  let locError = "";
  const r = await applyReceiveLocs(back);
  if (r && r.errors && r.errors.length) locError = r.errors[0].error;

  if (typeof recordChange === "function") {
    recordChange({
      entity: "order", entityId: order.id, action: "update",
      summary: `ลบรายการออกจากออร์เดอร์ ${order.id} — ${line.sku} ${pieces} ชิ้น (คืนสต็อก)`,
      count: 1,
      changes: [{ label: line.name || line.sku, to: `-${pieces} ชิ้น · คืน${line.loc ? " → " + line.loc : "สต็อก"}` }],
      note: `ออร์เดอร์ ${order.id}`
    });
  }
  return { ok: true, pieces, locError };
}
/* Summary for the "มีการเพิ่มรายการ" banner: total added pieces + the latest add. */
function packOrderAdds(order) {
  const log = (order && Array.isArray(order.addedLog)) ? order.addedLog.filter(Boolean) : [];
  if (!log.length) return null;
  const last = log[log.length - 1];
  const when = last.at ? new Date(last.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return {
    times: log.length,
    pieces: log.reduce((s, e) => s + (Number(e.pieces) || 0), 0),
    by: last.by || "", when,
    names: log.flatMap(e => (e.items || []).map(i => `${i.name || i.sku} ×${i.qty}`))
  };
}

/* ── แพ็คสินค้า — pick & pack work lists ────────────────────────────────
   Stock leaves the system at ตัดสต็อก time (commitIssueOrder / MSell / MIssue),
   so by the time an order reaches a packer the pieces are ALREADY debited from
   one specific shelf. These helpers answer exactly one question — "what do I
   fetch, and from which position" — and never move stock themselves.

   WHY the shelf must come from the ORDER and not from the product: applyLocPicks
   debited ONE position per sku at sell time. Re-deriving "where does this sku
   live" at pack time could send the packer to a different pile, and the recorded
   split would then disagree with the physical shelves forever. So `li.loc` wins;
   only lines that never carried one (bundle components — buildIssuePlan
   snapshots them with 3 args) fall back to defaultPickLoc, which is the same
   choice applyLocPicks made for them.

   Progress lives in ONE app_state blob ("pack_progress", localStorage mirror
   ims_pack_v1) keyed by order id, with wave/batch records under a "batch:"
   prefix so both share one hydration path and one realtime subscription:
     { "SO-X": { done:{ "sku|loc": qty }, short:{ "sku|loc": reason }, by, startedAt },
       "batch:ABC": { orderIds:[…], stage:"pick"|"sort", done:{…}, by, startedAt },
       "SO-OLD": null }
   merge_app_state is a shallow `||` that can ADD keys but never delete them, so
   a finished record is tombstoned with null and filtered on read. */
const PACK_KEY = "ims_pack_v1";
const PACK_STATE_KEY = "pack_progress";

// One pick line = one (sku, shelf) pair. Same sku on two shelves is two lines;
// same sku twice on ONE shelf (two channels of the same order) is one line.
function packKey(sku, loc) { return String(sku || "") + "|" + String(loc || ""); }

/* Walk order: the position's index in the live location tree, which is the
   physical layout the admin arranged — a far better route than alphabetical.
   Codes missing from the tree (stale/blank) sort last so they can't send
   someone to a shelf that no longer exists mid-walk. */
function packLocRank() {
  const idx = new Map();
  allPositions().forEach((p, i) => idx.set(p.code, i));
  return idx;
}
function _packSortLines(lines) {
  const idx = packLocRank();
  const rank = (l) => (idx.has(l) ? idx.get(l) : Number.MAX_SAFE_INTEGER);
  return lines.sort((a, b) => rank(a.loc) - rank(b.loc) || String(a.sku).localeCompare(String(b.sku)));
}

/* The raw {sku, qty, loc} rows to pick for one order. Orders born from
   ตัดสต็อก/ขาย carry lineItems; label-born orders keep their detail on the LABEL
   (labelToOrder reduces it to a count), so fall back to that. Custom label lines
   have no sku — there is nothing in the warehouse to fetch, so they're dropped. */
function _packSourceItems(order) {
  if (!order) return [];
  // เพิ่มรายการ on a label-born order (no orders row) — see addItemsToPackOrder.
  const extra = Array.isArray(order.addedItems) ? order.addedItems.filter(li => li && li.sku) : [];
  const own = Array.isArray(order.lineItems) ? order.lineItems.filter(li => li && li.sku) : [];
  if (own.length) return own.concat(extra);
  const labels = (typeof loadLabels === "function") ? loadLabels() : [];
  const idOf = (l) => (typeof orderIdForLabel === "function") ? orderIdForLabel(l) : (l.soId || l.id);
  const hit = labels.find(l => idOf(l) === order.id);
  return (hit ? (hit.items || []).filter(it => it && it.sku) : []).concat(extra);
}

/* Shelf-sorted pick lines for one order. `shelfQty` is what the split says is
   at that position — the number that exposes a physical mismatch before the
   packer has walked anywhere. */
function packLinesForOrder(order) {
  const merged = new Map();
  _packSourceItems(order).forEach(li => {
    const sku = li.sku;
    const qty = Math.max(0, Math.round(Number(li.qty) || 0));
    if (!sku || !qty) return;
    const p = PRODUCTS.find(x => x.sku === sku);
    const loc = li.loc || defaultPickLoc(p) || "";
    const key = packKey(sku, loc);
    // addedQty = pieces that came in through เพิ่มรายการ — flagged on the line.
    const add = li.added ? qty : 0;
    const prev = merged.get(key);
    if (prev) { prev.qty += qty; prev.addedQty += add; return; }
    merged.set(key, {
      key, sku, loc,
      name: (p && p.name) || li.name || sku,
      qty, addedQty: add,
      shelfQty: qtyAtLocation(sku, loc),
      parts: locParts(loc)
    });
  });
  return _packSortLines(Array.from(merged.values()));
}

/* Combined wave list for several orders: one row per (sku, shelf) summed across
   the whole wave, each carrying `per` = [{orderId, qty}] so the picker can split
   the pile into parcels at the packing table afterwards. */
function packLinesForOrders(orders) {
  const merged = new Map();
  (orders || []).forEach(o => {
    packLinesForOrder(o).forEach(l => {
      const prev = merged.get(l.key);
      if (prev) { prev.qty += l.qty; prev.addedQty += l.addedQty || 0; prev.per.push({ orderId: o.id, qty: l.qty }); return; }
      merged.set(l.key, {
        key: l.key, sku: l.sku, loc: l.loc, name: l.name, qty: l.qty, addedQty: l.addedQty || 0,
        shelfQty: l.shelfQty, parts: l.parts,
        per: [{ orderId: o.id, qty: l.qty }]
      });
    });
  });
  return _packSortLines(Array.from(merged.values()));
}

/* Orders waiting to be packed, oldest first so the queue is FIFO. Reads the
   Tracking model (buildOrders) so it sees exactly what Outbound/Tracking show;
   falls back to the raw cache if tracking.jsx hasn't loaded. */
function packQueue(mode) {
  const list = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
  return packSortOrders((list || []).filter(o => o && o.status === "picking"), mode || packSortMode());
}

/* Orders marked packed in the last `days` days, newest first — so a packer who hit
   แพ็คเสร็จ before downloading / copying / printing the label can reopen it. Only
   still-"packed" orders (shipped ones are out of the packer's hands). */
function packedRecent(days) {
  const list = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
  const since = Date.now() - (days || 3) * 86400000;
  return (list || [])
    .filter(o => o && o.status === "packed" && o.packedAt && Date.parse(o.packedAt) >= since)
    .sort((a, b) => Date.parse(b.packedAt) - Date.parse(a.packedAt));
}

/* Orders packed on the local day of `day` (default today), newest first — every
   one packed that day whatever happened next, so shipping a parcel doesn't take
   it off the day's count. Packed is NOT shipped: callers show o.status as-is.
   Team-wide (not per packer). Cancelled orders are left out. */
function packedOnDay(day) {
  const key = (day ? new Date(day) : new Date()).toDateString();
  const list = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
  return (list || [])
    .filter(o => o && o.packedAt && o.status !== "cancelled" && new Date(o.packedAt).toDateString() === key)
    .sort((a, b) => Date.parse(b.packedAt) - Date.parse(a.packedAt));
}

/* ── Pack home (พนักงานแพ็ค) — shared by desktop PackHome (screens.jsx) and
   mobile MPackHome (handheld.jsx) so the two can never show different numbers.
   Read-only: it moves no stock and changes no order. */
const PACK_HOME_DAYS = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const PACK_HOME_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function packHomeThaiDate(d) { return `วัน${PACK_HOME_DAYS[d.getDay()]}ที่ ${d.getDate()} ${PACK_HOME_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`; }
// Avatar text: two letters for a Latin name ("PS"), else the first character
// cluster (a Thai consonant with its marks — never a dangling vowel/tone mark).
function packHomeInitials(name) {
  const n = String(name || "").trim();
  if (!n) return "?";
  if (/^[A-Za-z0-9]/.test(n)) return n.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const it = new Intl.Segmenter("th", { granularity: "grapheme" }).segment(n)[Symbol.iterator]().next();
      if (!it.done) return it.value.segment;
    }
  } catch (e) {}
  return Array.from(n)[0];
}
// "loading" | "ok" | "failed" — set by dbInit / retryOrdersLoad (supabase.jsx).
function packHomeLoadState() {
  const s = window._DB_ORDERS_LOAD;
  if (s === "loading" || s === "ok" || s === "failed") return s;
  return Array.isArray(window._DB_ORDERS) ? "ok" : "loading";
}
function usePackHomeStats() {
  const [tick, setTick] = React.useState(0);
  const [load, setLoad] = React.useState(packHomeLoadState);
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const refresh = () => setTick(t => t + 1);
    const onLoad = () => { setLoad(packHomeLoadState()); refresh(); };
    const evs = ["ims-orders-change", "ims-labels-change", "ims-pack-change", "ims-products-change"];
    evs.forEach(e => window.addEventListener(e, refresh));
    window.addEventListener("ims-orders-load", onLoad);
    // Roll "today" over at midnight / when the device wakes the app the next day.
    const tickDay = () => setNow(prev => { const n = new Date(); return n.toDateString() === prev.toDateString() ? prev : n; });
    const iv = setInterval(tickDay, 60000);
    document.addEventListener("visibilitychange", tickDay);
    return () => {
      evs.forEach(e => window.removeEventListener(e, refresh));
      window.removeEventListener("ims-orders-load", onLoad);
      clearInterval(iv);
      document.removeEventListener("visibilitychange", tickDay);
    };
  }, []);
  const orders = React.useMemo(() => packQueue(), [tick]);
  const progress = React.useMemo(() => loadPackProgress(), [tick]);
  const packedToday = React.useMemo(() => packedOnDay(now).length, [tick, now]);
  // Pieces still to pick — lines already ticked are in hand.
  const pieces = React.useMemo(() => orders.reduce((n, o) =>
    n + packLineTotals(packLinesForOrder(o), progress[o.id]).remaining, 0), [orders, progress]);
  const late = React.useMemo(() => orders.filter(o => typeof packLateDays === "function" && packLateDays(o) > 0).length, [orders, now]);
  const waves = Object.keys(progress).filter(k => k.indexOf("batch:") === 0);
  // An order already in an open wave is picked there — opening it alone would
  // fetch the same pieces twice (same rule as the pack screens).
  const waveOf = {};
  waves.forEach(id => ((progress[id] || {}).orderIds || []).forEach(oid => { waveOf[oid] = id; }));
  return { load, known: load === "ok", now, orders, progress, packedToday, pieces, late, waves, waveOf };
}

/* Queue order — picked by the packer, remembered per device (two packers may
   work the queue differently). Every mode falls back to oldest-first so ties
   never shuffle between renders. */
const PACK_SORTS = [
  { id: "old",      label: "เก่าสุดก่อน" },
  { id: "new",      label: "ใหม่สุดก่อน" },
  { id: "channel",  label: "ตามช่องทาง" },
  { id: "customer", label: "ตามชื่อลูกค้า" },
  { id: "pieces",   label: "ชิ้นน้อยก่อน" }
];
const PACK_SORT_KEY = "ims_pack_sort";
function packSortMode() {
  let v = "";
  try { v = localStorage.getItem(PACK_SORT_KEY) || ""; } catch (e) {}
  return PACK_SORTS.some(x => x.id === v) ? v : "old";
}
function setPackSortMode(id) {
  if (!PACK_SORTS.some(x => x.id === id)) return;
  try { localStorage.setItem(PACK_SORT_KEY, id); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-pack-change"));
}
function _packTimeKey(o) { return String(o.dateIso || "") + " " + String(o.ts || "") + " " + String(o.id || ""); }
function _packPieces(o) { return packLinesForOrder(o).reduce((n, l) => n + l.qty, 0); }
function packSortOrders(list, mode) {
  const old = (a, b) => _packTimeKey(a).localeCompare(_packTimeKey(b));
  const arr = (list || []).slice();
  if (mode === "new") return arr.sort((a, b) => old(b, a));
  if (mode === "channel") return arr.sort((a, b) => String(a.channel || "").localeCompare(String(b.channel || ""), "th") || old(a, b));
  if (mode === "customer") return arr.sort((a, b) => String(a.customer || "").localeCompare(String(b.customer || ""), "th") || old(a, b));
  if (mode === "pieces") {
    const n = new Map(arr.map(o => [o.id, _packPieces(o)]));
    return arr.sort((a, b) => n.get(a.id) - n.get(b.id) || old(a, b));
  }
  return arr.sort(old);
}
// "7 ต.ค. 69 · 14:05" for a queue row.
function packOrderTime(o) {
  const d = o.date || (o.dateIso && typeof isoToThai === "function" ? isoToThai(o.dateIso) : (o.dateIso || ""));
  return [d, o.ts].filter(Boolean).join(" · ");
}

// Other positions that still hold this sku — offered when a shelf comes up short.
function packAltPositions(sku, excludeLoc) {
  const p = PRODUCTS.find(x => x.sku === sku);
  return productPositions(p)
    .filter(r => r.loc && r.loc !== excludeLoc && (Number(r.qty) || 0) > 0)
    .sort((a, b) => b.qty - a.qty);
}

function loadPackProgress() {
  let m = null;
  const cloud = window._DB_PACK_PROGRESS;
  if (cloud && typeof cloud === "object") m = cloud;
  if (!m) {
    try { const s = localStorage.getItem(PACK_KEY); if (s) { const o = JSON.parse(s); if (o && typeof o === "object") m = o; } } catch (e) {}
  }
  if (!m) return {};
  const out = {};
  Object.keys(m).forEach(id => { if (m[id]) out[id] = m[id]; });  // drop tombstones
  return out;
}
// Always returns a usable shape, so callers never guard for a first-time record.
function packEntry(id) {
  const e = loadPackProgress()[id] || {};
  return {
    done: e.done || {}, short: e.short || {},
    by: e.by || "", startedAt: e.startedAt || "",
    orderIds: e.orderIds || null, stage: e.stage || ""
  };
}

const _packSyncTimers = {};
function _packMirror(map) {
  window._DB_PACK_PROGRESS = map;
  try { localStorage.setItem(PACK_KEY, JSON.stringify(map)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-pack-change"));
}
/* Write one record. localStorage + the in-memory mirror update synchronously so a
   tap survives an instant refresh; the cloud write is debounced per id because a
   packer ticks a dozen lines in a few seconds. The patch sends the COMPLETE
   record — merge_app_state is a shallow merge, so a partial one would replace it. */
function savePackEntry(id, entry) {
  if (!id) return;
  const map = { ...loadPackProgress() };
  map[id] = entry;
  _packMirror(map);
  if (_packSyncTimers[id]) clearTimeout(_packSyncTimers[id]);
  _packSyncTimers[id] = setTimeout(() => {
    delete _packSyncTimers[id];
    const cur = loadPackProgress()[id];
    if (!cur) return;
    _packPush(id, cur);
  }, 800);
}
/* Cloud write for one pack record (null = finished tombstone). dbMergeState
   resolves {error} rather than throwing, so failures used to vanish: the ticks
   reverted at the next reload and on every other device. A failed id is kept in
   ims_pack_unsynced and re-sent on reconnect / foreground with its CURRENT value. */
const PACK_UNSYNCED_KEY = "ims_pack_unsynced";
function _packUnsynced() { try { return JSON.parse(localStorage.getItem(PACK_UNSYNCED_KEY) || "{}") || {}; } catch (e) { return {}; } }
function _packMarkUnsynced(id, on) {
  const u = _packUnsynced();
  if (on) u[id] = 1; else delete u[id];
  try { Object.keys(u).length ? localStorage.setItem(PACK_UNSYNCED_KEY, JSON.stringify(u)) : localStorage.removeItem(PACK_UNSYNCED_KEY); } catch (e) {}
}
async function _packPush(id, value) {
  let res;
  try {
    if (typeof dbMergeState === "function") res = await dbMergeState(PACK_STATE_KEY, { [id]: value });
    if ((res === null || res === undefined) && typeof dbSaveState === "function") {
      const full = { ...loadPackProgress() };
      if (value === null) full[id] = null; else full[id] = value;
      res = await dbSaveState(PACK_STATE_KEY, full);
    }
  } catch (e) { res = { error: String(e) }; }
  const failed = !res || !!res.error;
  _packMarkUnsynced(id, failed);
  if (failed && typeof cloudWriteFailed === "function") cloudWriteFailed(res, "ความคืบหน้าการแพ็ค");
  return !failed;
}
let _packRetrying = false;
async function _packRetryUnsynced() {
  if (_packRetrying || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  const ids = Object.keys(_packUnsynced());
  if (!ids.length) return;
  _packRetrying = true;
  try {
    const map = loadPackProgress();
    for (const id of ids) await _packPush(id, map[id] || null);
  } finally { _packRetrying = false; }
}
window.addEventListener("online", () => { _packRetryUnsynced(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") _packRetryUnsynced(); });
setTimeout(() => { _packRetryUnsynced(); }, 9000);
/* Finish with a null tombstone rather than a delete: merge_app_state can only add
   keys, so deleting locally then merging would let the stale record come straight
   back from another device. loadPackProgress filters nulls out on read. */
function clearPackEntry(id) {
  if (!id) return;
  if (_packSyncTimers[id]) { clearTimeout(_packSyncTimers[id]); delete _packSyncTimers[id]; }
  const map = { ...loadPackProgress() };
  delete map[id];
  _packMirror(map);
  _packPush(id, null);
}
function newPackBatchId() { return "batch:" + Date.now().toString(36).toUpperCase(); }

/* Per-shelf reminder notes ("ช่องนี้ของแตกง่าย", "ดูสีให้ดี") shown at that stop of
   every pick walk, on the desktop queue and on the printed label.
   OWNER (admin) ONLY to write — enforced by app_state RLS on the dedicated key
   "pack_loc_notes" (supabase/pack-loc-notes-owner-only.sql); packers/staff only
   read. They used to live in pack_progress, which packers must be able to write,
   so the DB could not stop them — don't move them back.
   Shape { "<loc>": { text, by, at } | null }. merge_app_state can only add keys,
   so a removed note is a null tombstone, filtered on read. */
const PACK_NOTES_KEY = "pack_loc_notes";
const PACK_NOTES_LS = "ims_pack_loc_notes";
function loadPackLocNotes() {
  let m = window._DB_PACK_LOC_NOTES;
  if (!m || typeof m !== "object") {
    try { m = JSON.parse(localStorage.getItem(PACK_NOTES_LS) || "null"); } catch (e) { m = null; }
  }
  return (m && typeof m === "object") ? m : {};
}
function _packNotesMirror(map) {
  window._DB_PACK_LOC_NOTES = map;
  try { localStorage.setItem(PACK_NOTES_LS, JSON.stringify(map)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-pack-change"));
}
function canEditPackLocNotes() {
  const u = window.__currentUser;
  return !!u && u.role === "admin";
}
/* A note belongs to a REAL shelf. "-", "—", "–" or blank all mean "no shelf yet",
   and every unshelved line of every order shares that value — a note keyed on
   it leaked onto all of them (2026-10-07: a one-order POLICE patch text showed
   on every order with an unshelved item). Such keys are never written, and any
   already stored are ignored on read. */
function packNoteLocOk(loc) {
  return !!loc && !/^[\s\-–—]*$/.test(String(loc));
}
function packLocNote(loc) {
  if (!packNoteLocOk(loc)) return null;
  const e = loadPackLocNotes()[loc];
  return e && e.text ? e : null;
}
/* Optimistic write verified against the server: a rejected or failed save rolls
   the mirror back to exactly what it was and says so (same rule as saveLocTree). */
async function setPackLocNote(loc, text, by) {
  if (!packNoteLocOk(loc)) return { ok: false };
  if (!canEditPackLocNotes()) {
    window.dispatchEvent(new CustomEvent("ims-toast", { detail: "เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขโน้ตประจำช่องได้" }));
    return { ok: false };
  }
  const t = String(text || "").trim();
  // Multi-line allowed: normalise line endings, cap blank runs at one empty line.
  const clean = t.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 500);
  const rec = t ? { text: clean, by: by || "", at: new Date().toISOString() } : null;
  const prev = loadPackLocNotes();
  _packNotesMirror({ ...prev, [loc]: rec });
  let res = null;
  try {
    if (typeof dbMergeState === "function") res = await dbMergeState(PACK_NOTES_KEY, { [loc]: rec });
    if (res === null && typeof dbSaveState === "function") res = await dbSaveState(PACK_NOTES_KEY, { ...prev, [loc]: rec });
  } catch (e) { res = { error: String((e && e.message) || e) }; }
  if (!res || res.error) {
    _packNotesMirror(prev);
    _blobWriteFailed("โน้ตประจำช่อง", (res && res.error) || "");
    return { ok: false };
  }
  // Like order notes: the blob holds only the current text, so each version is
  // logged — a packing check can then see what this shelf said at the time.
  const was = prev[loc] && prev[loc].text ? prev[loc].text : "";
  if (typeof recordChange === "function" && was !== (rec ? rec.text : "")) {
    recordChange({
      entity: "location", entityId: loc, action: "note",
      summary: rec ? (was ? `แก้ไขโน้ตประจำช่อง ${loc}` : `เพิ่มโน้ตประจำช่อง ${loc}`) : `ลบโน้ตประจำช่อง ${loc}`,
      note: rec ? rec.text : (was ? "เดิม: " + was : "")
    });
  }
  return { ok: true };
}
/* The ONE add/edit/remove dialog for a shelf note — mobile MPackLocNote and the
   desktop PackQueue both call it. required:false because a blank answer is how a
   note is removed (askText would block it). askForm lives in screens.jsx, which
   loads later, so it is looked up at call time. */
async function editPackLocNote(loc, by) {
  if (!packNoteLocOk(loc) || typeof askForm !== "function" || !canEditPackLocNotes()) return;
  const note = packLocNote(loc);
  const r = await askForm({
    title: "โน้ตประจำช่อง " + loc,
    // Shelf notes were mistaken for order notes (2026-10-12) — say the scope up front.
    message: "⚠️ โน้ตนี้จะขึ้นในทุกออร์เดอร์ที่หยิบจากช่องนี้ (หน้าแพ็คและใบปะหน้า) — ถ้าเป็นรายละเอียดของออร์เดอร์เดียว ให้ใช้ \"โน้ตออร์เดอร์\" แทน",
    fields: [{ key: "v", label: "ข้อความเตือนพนักงาน (เว้นว่าง = ลบโน้ต)", value: note ? note.text : "", placeholder: "เช่น ของแตกง่าย ห่อบับเบิ้ล 2 ชั้น\nกด Enter เพื่อขึ้นบรรทัดใหม่", required: false, type: "textarea", rows: 4, maxLength: 500 }],
    okLabel: note ? "บันทึก / ลบ" : "บันทึก"
  });
  if (!r) return;
  await setPackLocNote(loc, r.v, by || "");
}

/* Per-ORDER notes (โน้ตออร์เดอร์) — work details that belong to ONE parcel
   (patch text, gift wrap, "ส่งด่วน"), which a shelf note must never carry.
   Same rules as shelf notes: OWNER (admin) only, enforced by app_state RLS on the
   key "pack_order_notes" (supabase/pack-loc-notes-owner-only.sql). NOT stored in
   order_overrides — packers can write that key, so the DB couldn't stop them.
   Shape { "<orderId>": { text, by, at } | null } (null = removed, merge can't delete). */
const PACK_ORDER_NOTES_KEY = "pack_order_notes";
const PACK_ORDER_NOTES_LS = "ims_pack_order_notes";
function loadPackOrderNotes() {
  let m = window._DB_PACK_ORDER_NOTES;
  if (!m || typeof m !== "object") {
    try { m = JSON.parse(localStorage.getItem(PACK_ORDER_NOTES_LS) || "null"); } catch (e) { m = null; }
  }
  return (m && typeof m === "object") ? m : {};
}
function _packOrderNotesMirror(map) {
  window._DB_PACK_ORDER_NOTES = map;
  try { localStorage.setItem(PACK_ORDER_NOTES_LS, JSON.stringify(map)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-pack-change"));
}
function packOrderNote(orderId) {
  if (!orderId) return null;
  const e = loadPackOrderNotes()[orderId];
  return e && e.text ? e : null;
}
async function setPackOrderNote(orderId, text, by) {
  if (!orderId) return { ok: false };
  if (!canEditPackLocNotes()) {
    window.dispatchEvent(new CustomEvent("ims-toast", { detail: "เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขโน้ตออร์เดอร์ได้" }));
    return { ok: false };
  }
  const t = String(text || "").trim();
  const clean = t.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 500);
  const rec = t ? { text: clean, by: by || "", at: new Date().toISOString() } : null;
  const prev = loadPackOrderNotes();
  markOrderTouched(orderId);
  _packOrderNotesMirror({ ...prev, [orderId]: rec });
  let res = null;
  try {
    if (typeof dbMergeState === "function") res = await dbMergeState(PACK_ORDER_NOTES_KEY, { [orderId]: rec });
    if (res === null && typeof dbSaveState === "function") res = await dbSaveState(PACK_ORDER_NOTES_KEY, { ...prev, [orderId]: rec });
  } catch (e) { res = { error: String((e && e.message) || e) }; }
  if (!res || res.error) {
    _packOrderNotesMirror(prev);
    _blobWriteFailed("โน้ตออร์เดอร์", (res && res.error) || "");
    return { ok: false };
  }
  // The blob keeps only the CURRENT note, so every version is also written to the
  // activity log — the order's history can then show exactly what the packer was
  // told and when, which is what a packing dispute needs.
  const before = prev[orderId] && prev[orderId].text ? prev[orderId].text : "";
  if (typeof recordChange === "function" && before !== (rec ? rec.text : "")) {
    recordChange({
      entity: "order", entityId: orderId, action: "note",
      summary: rec ? (before ? `แก้ไขโน้ตออร์เดอร์ ${orderId}` : `เพิ่มโน้ตออร์เดอร์ ${orderId}`) : `ลบโน้ตออร์เดอร์ ${orderId}`,
      note: rec ? rec.text : (before ? "เดิม: " + before : "")
    });
  }
  return { ok: true };
}
async function editPackOrderNote(orderId, by) {
  if (!orderId || typeof askForm !== "function" || !canEditPackLocNotes()) return;
  const note = packOrderNote(orderId);
  const r = await askForm({
    title: "โน้ตออร์เดอร์ " + orderId,
    message: "ขึ้นเฉพาะออร์เดอร์นี้ — ในหน้าแพ็คและบนใบปะหน้า",
    fields: [{ key: "v", label: "รายละเอียดงาน / ข้อความถึงคนแพ็ค (เว้นว่าง = ลบโน้ต)", value: note ? note.text : "", placeholder: "เช่น ปักชื่อ ATHIP T. / กรุ๊ปเลือด Rh.B\nกด Enter เพื่อขึ้นบรรทัดใหม่", required: false, type: "textarea", rows: 6, maxLength: 500 }],
    okLabel: note ? "บันทึก / ลบ" : "บันทึก"
  });
  if (!r) return;
  await setPackOrderNote(orderId, r.v, by || "");
}

/* Shared progress math so the phone, the wave view and the desktop queue can't
   report different numbers for the same order. A line counts as settled when the
   picked qty covers it OR it has been marked short (a short line is resolved —
   there is nothing more to fetch — so it must not block completion). */
function packLineTotals(lines, entry) {
  const done = (entry && entry.done) || {};
  const short = (entry && entry.short) || {};
  let need = 0, got = 0, lineDone = 0, shortLines = 0;
  (lines || []).forEach(l => {
    const picked = Math.max(0, Math.min(Number(done[l.key]) || 0, l.qty));
    need += l.qty; got += picked;
    if (short[l.key]) shortLines++;
    if (picked >= l.qty || short[l.key]) lineDone++;
  });
  const lineCount = (lines || []).length;
  return {
    need, got, lineCount, lineDone, shortLines,
    remaining: Math.max(0, need - got),
    pct: need ? Math.round((got / need) * 100) : 0,
    complete: lineCount > 0 && lineDone >= lineCount
  };
}

/* Correct the recorded split when a packer had to take a line from a DIFFERENT
   shelf than the one the sale debited.

   Only the DISTRIBUTION is wrong here, never the total: products.qty was already
   reduced correctly at sell time. That is precisely why applyLocPicks cannot be
   used — it is difference-based and no-ops when p.qty already matches the
   recorded sum, which it does. saveLocSplit is the right writer: give `fromLoc`
   its pieces back (they were never taken) and take them off `toLoc` (which
   really lost them), leaving the sum untouched.

   If toLoc has fewer pieces recorded than were physically taken, that is a real
   count discrepancy — move what we can and report the shortfall so the UI can
   point at ปรับสต็อก instead of silently inventing stock. */
async function repointPackLine(sku, fromLoc, toLoc, qty) {
  const n = Math.max(0, Math.round(Number(qty) || 0));
  if (!sku || !toLoc || toLoc === fromLoc || !n) return { ok: false, error: "ข้อมูลไม่ครบ" };
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return { ok: false, error: "ไม่พบสินค้า " + sku };
  const rows = locSplitFor(sku, p.loc);
  // No recorded split → products.qty is the whole truth and there is no
  // distribution to correct.
  if (!rows.length) return { ok: true, moved: 0, shortfall: 0, skipped: true };

  const out = rows.map(r => ({ loc: r.loc, qty: r.qty }));
  const src = out.find(r => r.loc === toLoc);
  const moved = Math.min(n, src ? src.qty : 0);
  const shortfall = n - moved;
  if (moved > 0) {
    src.qty -= moved;
    if (fromLoc) {
      const dst = out.find(r => r.loc === fromLoc);
      if (dst) dst.qty += moved; else out.push({ loc: fromLoc, qty: moved });
    } else {
      // No original shelf on the line (legacy order): park the pieces on the
      // product's primary position so the sum still reconciles.
      const dst = out.find(r => r.loc === p.loc);
      if (dst) dst.qty += moved; else out.push({ loc: p.loc || toLoc, qty: moved });
    }
    const res = await saveLocSplit(sku, out.filter(r => r.qty > 0));
    if (!res.ok) return { ok: false, error: res.error, moved: 0, shortfall: n };
  }
  return { ok: true, moved, shortfall };
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
/* ── Pieces cut but not yet packed ──────────────────────────────────────
   ตัดสต็อก debits products.qty the moment the order is made, but the pieces sit
   on the shelf until แพ็คสินค้า takes them (pack never moves stock). A count taken
   in between sees those pieces and — applied as-is — puts them back into stock:
   2026-10-10 AFG-OT21-BK was counted 0 → 9 while three cut orders still had their
   pieces on the shelf, leaving the system 3 above reality for good.
   Returns { sku: { qty, orders: [orderId…] } } over every order still รอแพ็ค
   (status "picking"; a packed → picking revert counts again) whose sale really
   debited stock (restockLinesForOrder — label-only orders never did), minus
   pieces the packer already took off the shelf (pack progress, per order and
   per wave; shorted lines are off the shelf too). */
function pendingPackReserved() {
  const list = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
  const prog = (typeof loadPackProgress === "function") ? loadPackProgress() : {};
  const pending = [];
  (list || []).forEach(o => {
    if (!o || o.deleted || o.status !== "picking") return;
    if (isBlankDraftOrder(o)) return;
    const lines = restockLinesForOrder(o).map(l => ({ sku: l.sku, key: l.key || packKey(l.sku, l.loc), qty: Math.max(0, Number(l.qty) || 0) }));
    if (!lines.length) return;
    const own = (prog[o.id] && prog[o.id].done) || {};
    const ownShort = (prog[o.id] && prog[o.id].short) || {};
    lines.forEach(l => { l.left = ownShort[l.key] ? 0 : Math.max(0, l.qty - Math.min(Number(own[l.key]) || 0, l.qty)); });
    pending.push({ id: o.id, lines });
  });
  const byId = {};
  pending.forEach(e => { byId[e.id] = e; });
  Object.keys(prog).forEach(k => {
    if (k.indexOf("batch:") !== 0) return;
    const w = prog[k] || {};
    const members = (w.orderIds || []).map(id => byId[id]).filter(Boolean);
    // Shorted pieces are not on the shelf; unpicked ones are (even at stage "sort").
    const wShort = w.short || {};
    members.forEach(e => e.lines.forEach(l => { if (wShort[l.key]) l.left = 0; }));
    const done = w.done || {};
    Object.keys(done).forEach(key => {
      let take = Math.max(0, Number(done[key]) || 0);
      members.forEach(e => e.lines.forEach(l => {
        if (take <= 0 || l.key !== key) return;
        const t = Math.min(take, l.left);
        l.left -= t; take -= t;
      }));
    });
  });
  const out = {};
  pending.forEach(e => e.lines.forEach(l => {
    if (l.left <= 0) return;
    const r = out[l.sku] || (out[l.sku] = { qty: 0, orders: [] });
    r.qty += l.left;
    if (!r.orders.includes(e.id)) r.orders.push(e.id);
  }));
  return out;
}

/* Count-time snapshot of pendingPackReserved per counted SKU + the "pulled"
   choices, so a count applied later still subtracts what was on the shelf when
   it was counted (packing doesn't move stock). Cleared with the counts. */
const STOCKTAKE_META_KEY = "ims_stocktake_meta_v1";
function loadStockTakeMeta() {
  try {
    const o = JSON.parse(localStorage.getItem(STOCKTAKE_META_KEY) || "{}") || {};
    return { reserved: (o.reserved && typeof o.reserved === "object") ? o.reserved : {}, pulled: (o.pulled && typeof o.pulled === "object") ? o.pulled : {} };
  } catch (e) { return { reserved: {}, pulled: {} }; }
}
function saveStockTakeMeta(meta) {
  try { localStorage.setItem(STOCKTAKE_META_KEY, JSON.stringify({ reserved: (meta && meta.reserved) || {}, pulled: (meta && meta.pulled) || {} })); } catch (e) {}
}
// Reserved map to plan with: the count-time snapshot where one exists, else current.
function stockTakeReserved(current, snap) {
  const out = Object.assign({}, current || {});
  Object.keys(snap || {}).forEach(sku => { out[sku] = snap[sku]; });
  return out;
}

/* The count → stock plan shared by both forks' confirm list and applyStockCounts,
   so what the user approves is exactly what gets written.
   counts   = { sku: countedQty }
   reserved = pendingPackReserved() (or null)
   pulled   = { sku: true } — the user confirmed those รอแพ็ค pieces are already
              off the shelf, so the counted number is the free stock as-is.
   Default (not pulled): the counted pile still holds them → subtract.
   Returns [{ sku, name, from, counted, reserved, subtracted, orders, to, delta }]
   for SKUs that actually change. */
function stockCountPlan(counts, reserved, pulled) {
  const out = [];
  Object.keys(counts || {}).forEach(sku => {
    const raw = counts[sku];
    if (raw === "" || raw == null) return;          // not counted → skip
    const p = PRODUCTS.find(x => x.sku === sku);
    if (!p) return;
    const counted = Math.max(0, Math.round(Number(raw) || 0));
    const r = (reserved && reserved[sku]) || null;
    const res = r ? r.qty : 0;
    const subtracted = res > 0 && !(pulled && pulled[sku]);
    const to = Math.max(0, counted - (subtracted ? res : 0));
    if (to === p.qty) return;                        // no change
    out.push({ sku, name: p.name, from: p.qty, counted, reserved: res, subtracted, orders: r ? r.orders : [], to, delta: to - p.qty });
  });
  return out;
}

/* Why a count landed where it did — written into the ledger reason so the
   product history explains a count that isn't simply "what was counted".
   Shared by ตรวจนับ (_countNote) and ปรับสต็อก ตั้งค่าเป็น (adjustSetTarget). */
function pendingPackNote(c) {
  if (!c || !c.reserved) return "";
  // No order ids here: an SO-… id in a ledger reason makes loadAuditEntryMoves
  // read the count row as that order's sale.
  const k = (c.orders || []).length;
  return c.subtracted
    ? `นับได้ ${c.counted} − รอแพ็ค ${c.reserved} ชิ้น${k ? ` · ${k} ออร์เดอร์` : ""} = ${c.to}`
    : `นับได้ ${c.counted} (รอแพ็ค ${c.reserved} ชิ้นหยิบออกจากชั้นแล้ว — ไม่หัก)`;
}
function _countNote(c) {
  const n = pendingPackNote(c);
  return n ? " · " + n : "";
}

/* ── ปรับสต็อก ตั้งค่าเป็น = a count too ─────────────────────────────────
   ตั้งค่าเป็น is a number read off the shelf, so it has the same hole the
   ตรวจนับ screen had: pieces cut (ตัดสต็อก) but still รอแพ็ค sit on the shelf
   while the system has already taken them off. 3 of the 6 bad corrections
   since 2026-10-06 came through here (นับสต็อกผิด / แก้ไขยอด → ตั้งค่าเป็น),
   e.g. AFG-OT21-BK 0 → 9 with 4 pieces still waiting to be packed.
   Same rule and the same choice as stockCountPlan: by default the typed number
   still includes them → subtract; pulled = the user says they are already off
   the shelf → write the number as typed.
   Returns { counted, reserved, orders, subtracted, to }. */
function adjustSetTarget(sku, typed, reserved, pulled) {
  const counted = Math.max(0, Math.round(Number(typed) || 0));
  const r = (reserved && reserved[sku]) || null;
  const res = r ? r.qty : 0;
  const subtracted = res > 0 && !pulled;
  return { counted, reserved: res, orders: r ? r.orders : [], subtracted, to: Math.max(0, counted - (subtracted ? res : 0)) };
}

/* ── Backdated movement vs the SKU's latest count ──────────────────────
   A count (ตรวจนับสต็อก…) or correction (นับสต็อกผิด…) sets stock to what was
   physically there at that moment, so every movement that happened BEFORE it is
   already inside the number. A ปรับสต็อก entered later but dated before that
   count moves the stock a second time: 10 SKUs drifted this way by 2026-10-15
   (AFG-OT21-BK: a +30 receive dated 09-24, entered after the 09-28 count).
   loadLatestCounts(skus) → { sku: latest such ledger row } (null = couldn't check).
   backdateCountConflicts(latest, whenIso, skus) → [{ sku, row }] for the SKUs
   whose latest count is dated after the movement. */
const COUNT_REASON_RE = /^(ตรวจนับสต็อก|นับสต็อกผิด)/;
function isCountReason(reason) { return COUNT_REASON_RE.test(String(reason || "")); }
async function loadLatestCounts(skus) {
  if (typeof dbLoadLatestCounts !== "function") return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  // A hung request (Wi-Fi with no internet keeps onLine true) must not hold the
  // confirm button for minutes — after 6 s it becomes the "failed" state.
  let timer;
  try {
    return await Promise.race([
      dbLoadLatestCounts(skus),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 6000); })
    ]);
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
function backdateCountConflicts(latest, whenIso, skus) {
  const at = Date.parse(whenIso || "");
  if (!latest || !Number.isFinite(at)) return [];
  const out = [];
  [...new Set(skus || [])].forEach(sku => {
    const row = latest[sku];
    if (row && isCountReason(row.reason) && Date.parse(row.created_at) > at) out.push({ sku, row });
  });
  return out;
}
// "28 ก.ย. 2569 14:30" (Bangkok) for a stored ledger timestamp.
function ledgerStampLabel(iso) {
  const d = bangkokDateOf(iso);
  return d ? `${isoToThai(d)} ${bangkokTimeOf(iso)}`.trim() : "";
}
/* Both ปรับสต็อก forks: the latest count per selected SKU, fetched only while
   the picked date is ย้อนหลัง. { latest, loading, failed }.
   nonce: bump it to force a refetch for the same SKU set (e.g. after a batch
   that may itself have written a count). A failed result retries on "online". */
function useLatestCounts(skus, active, nonce) {
  const key = active ? [...new Set((skus || []).filter(Boolean))].sort().join("\n") : "";
  const fullKey = key ? key + "#" + (nonce || 0) : "";
  const [st, setSt] = React.useState({ key: "", latest: null, failed: false, at: 0 });
  const [retry, setRetry] = React.useState(0);
  // A cached result goes stale: refetch after 60 s (the old one stays on screen
  // meanwhile, so confirm isn't blocked again). Re-activation changes fullKey
  // ("" → key), which reruns the fetch effect too.
  React.useEffect(() => {
    if (!fullKey || st.key !== fullKey || !st.at) return;
    const t = setTimeout(() => setRetry(n => n + 1), Math.max(0, 60000 - (Date.now() - st.at)));
    return () => clearTimeout(t);
  }, [fullKey, st.key, st.at]);
  React.useEffect(() => {
    if (!fullKey) return;
    let alive = true;
    const t = setTimeout(() => {
      loadLatestCounts(key.split("\n")).then(latest => {
        if (alive) setSt(prev => {
          if (latest) return { key: fullKey, latest: latest, failed: false, at: Date.now() };
          // A failed refresh must not erase a conflict already loaded for this key.
          if (prev && prev.key === fullKey && prev.latest) return Object.assign({}, prev, { failed: false, at: Date.now() });
          return { key: fullKey, latest: null, failed: true, at: Date.now() };
        });
      });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [fullKey, retry]);
  React.useEffect(() => {
    if (!fullKey || st.key !== fullKey || !st.failed) return;
    const on = () => setRetry(n => n + 1);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [fullKey, st.key, st.failed]);
  if (!fullKey) return { latest: null, loading: false, failed: false };
  if (st.key !== fullKey) return { latest: null, loading: true, failed: false };
  return { latest: st.latest, loading: false, failed: st.failed };
}

/* The same guard for the sell screens (ขายออก, ตัดสต็อก) — a backdated sale
   entered after a count double-deducts exactly like a backdated ปรับสต็อก.
   skus = the SKUs that will move; when = the picker value.
   → { ok, loading, failed, conflicts, acked, setAcked, remove? } — `ok` gates submit. */
function useBackdateGuard(skus, when) {
  const st = (when && typeof stockOutStamp === "function") ? stockOutStamp(when) : null;
  const backdated = !!(st && st.backdated);
  const lc = useLatestCounts(skus, backdated);
  const conflicts = backdated ? backdateCountConflicts(lc.latest, st.createdAt, skus) : [];
  const key = conflicts.length ? st.createdAt + "|" + conflicts.map(c => c.sku).sort().join(",") : "";
  const [ackKey, setAckKey] = React.useState("");
  const acked = !!key && ackKey === key;
  return {
    backdated, loading: backdated && lc.loading, failed: backdated && lc.failed, conflicts, acked,
    setAcked: (v) => setAckKey(v ? key : ""),
    ok: !(backdated && lc.loading) && (!conflicts.length || acked)
  };
}
/* Warning panel for useBackdateGuard — shared by desktop and mobile sell screens.
   onRemove(skus) drops the conflicting lines from the cart. */
function BackdateCountWarning({ guard, onRemove, mobile }) {
  if (!guard || !guard.backdated) return null;
  if (guard.loading) return <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>กำลังตรวจการนับสต็อกล่าสุด…</div>;
  if (guard.failed) return (
    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", lineHeight: 1.5 }}>
      ตรวจไม่ได้ว่ามีการนับสต็อกหลังวันที่นี้หรือไม่ (ออฟไลน์?) — ถ้านับไปแล้วหลังวันนั้น ยอดที่นับได้รวมรายการนี้ไว้แล้ว อย่าบันทึกซ้ำ
    </div>
  );
  if (!guard.conflicts.length) return null;
  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: mobile ? 12 : 10, background: "var(--danger-soft)", border: "1px solid var(--danger)", fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--danger)", display: "flex", alignItems: "flex-start", gap: 6 }}>
        {typeof Icons !== "undefined" && Icons.Warn && <Icons.Warn size={14} style={{ flexShrink: 0, marginTop: 3 }}/>}
        <span>วันที่ย้อนหลังนี้อยู่ก่อนการนับสต็อกครั้งล่าสุด — สต็อกจะถูกหักซ้ำ</span>
      </div>
      <div style={{ marginTop: 4 }}>
        การนับครั้งนั้นเห็นของจริงบนชั้นหลังจากขายไปแล้ว จำนวนที่นับได้จึงหักชิ้นที่ขายไว้แล้ว ถ้าบันทึกตอนนี้ สต็อกจะถูกหักซ้ำอีกรอบ (ระบบจะต่ำกว่าของจริง)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
        {guard.conflicts.map(c => (
          <div key={c.sku} style={{ padding: "6px 8px", borderRadius: 8, background: "var(--surface)" }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: 11.5 }}>{c.sku}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}> · นับล่าสุด {ledgerStampLabel(c.row.created_at)} · {c.row.reason}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        {onRemove && (
          <button type="button" className={mobile ? "m-chip" : "btn btn-sm"} style={mobile ? { width: "100%", justifyContent: "center" } : undefined}
                  onClick={() => onRemove(guard.conflicts.map(c => c.sku))}>
            เอา {guard.conflicts.length} รายการนี้ออก
          </button>
        )}
        <label style={{ display: "flex", gap: 6, cursor: "pointer", alignItems: "flex-start" }}>
          <input type="checkbox" style={{ marginTop: 2 }} checked={guard.acked} onChange={e => guard.setAcked(e.target.checked)}/>
          <span>การนับครั้งนั้นยังไม่รวมการขายนี้ — บันทึกต่อ</span>
        </label>
      </div>
    </div>
  );
}

/* ── Movement history in entry order ───────────────────────────────────
   The product history lists stock_adjustments by id (the order rows were
   entered), so qty_before → qty_after reads as one unbroken chain. A row dated
   ย้อนหลัง then sits where it was entered, with a date older than the rows
   below it — this returns the ids to label, so that date doesn't look like a
   sorting bug. rows = any order; a row counts as backdated when its reason says
   so or an earlier-entered row carries a later date (10-minute slack for rows
   that only waited in the offline queue). */
function ledgerBackdatedIds(rows) {
  const out = new Set();
  let maxSeen = -Infinity;
  (rows || []).slice().sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)).forEach(r => {
    const t = Date.parse(r && r.created_at);
    if (/ย้อนหลัง/.test(String((r && r.reason) || "")) || (Number.isFinite(t) && maxSeen - t > 10 * 60 * 1000)) out.add(r.id);
    if (Number.isFinite(t) && t > maxSeen) maxSeen = t;
  });
  return out;
}

/* ── Product stock timeline, in the order things REALLY happened ──
   The ledger's own before/after belong to ENTRY order (the server stamps them
   when the row is written), so a sale keyed in today but dated yesterday chains
   only where it was typed. The owner reads the history as a timeline, so the
   forks sort by event time and RE-DERIVE before → after from the deltas,
   anchored on the newest-entered row's server qty_after (= stock right now).
   Event time = created_at (backdated rows are written with the picked moment),
   or — for ตัดสต็อก rows written before they were dated — the "ขายวันที่ …"
   their reason carries. When the fetch hit its limit (opts.complete false), rows
   whose event time is older than the oldest row fetched are dropped: an
   unfetched row could belong between them. */
const _LEDGER_TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function ledgerEventTime(r) {
  const t = Date.parse(r && r.created_at);
  const m = /ขายวันที่ (\d{1,2}) (\S+) (\d{4})(?: (\d{2}):(\d{2}))?/.exec(String((r && r.reason) || ""));
  if (m) {
    const mi = _LEDGER_TH_MONTHS.indexOf(m[2]);
    const pad = (n) => String(n).padStart(2, "0");
    // Date-only (older desktop cuts): the sale time is unknown, so place it at the
    // END of that day — before it, a same-day receive could look like it came
    // after the sale and the re-derived stock would dip below zero.
    const e = mi < 0 ? NaN : Date.parse(`${Number(m[3]) - 543}-${pad(mi + 1)}-${pad(m[1])}T${m[4] ? m[4] + ":" + m[5] + ":00" : "23:59:59"}+07:00`);
    if (Number.isFinite(e) && (!Number.isFinite(t) || e < t)) return e;
  }
  return t;
}
// rows = stock_adjustments for ONE sku, any order. nowQty = fallback anchor.
// opts.complete = rows is the sku's whole history (fewer than the fetch limit).
// → [{ ...row, eventAt (ms), backdated, runBefore, runAfter }] newest event first.
function ledgerTimeline(rows, nowQty, opts) {
  const list = (rows || []).filter(r => r && Number.isFinite(Number(r.delta)));
  if (!list.length) return [];
  const byId = list.slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  const newest = byId[0];
  let after = newest.qty_after != null && Number.isFinite(Number(newest.qty_after)) ? Number(newest.qty_after) : (Number(nowQty) || 0);
  const back = ledgerBackdatedIds(list);
  const enteredFloor = (opts && opts.complete) ? NaN : Date.parse(byId[byId.length - 1].created_at);
  return list
    .map(r => { const ev = ledgerEventTime(r); return Object.assign({}, r, { eventAt: ev, backdated: back.has(r.id) || ev < Date.parse(r.created_at) - 60 * 1000 }); })
    .filter(r => !Number.isFinite(enteredFloor) || !Number.isFinite(r.eventAt) || r.eventAt >= enteredFloor)
    .sort((a, b) => ((b.eventAt || 0) - (a.eventAt || 0)) || ((Number(b.id) || 0) - (Number(a.id) || 0)))
    .map(r => { const d = Math.trunc(Number(r.delta)); const o = Object.assign(r, { runAfter: after, runBefore: after - d }); after -= d; return o; });
}

/* Reconcile system stock to the physical count. counts = { sku: countedQty }.
   opts = { reserved, pulled } — see stockCountPlan; omitted = no รอแพ็ค adjustment.
   Returns the list of actual changes [{ sku, name, from, to, delta, … }].

   Three things must happen together, or a count leaves the data worse than it
   found it — this is the ONE choke point for both forks (StockTake desktop /
   MStockTake mobile), so keep them here rather than in either UI:
     1. products.qty ← the counted number (absolute, scoped row write).
     2. product_locations re-balanced to the new qty. A count used to move
        products.qty ONLY, so for a split sku the per-shelf rows kept summing to
        the OLD total: the ตำแหน่งสินค้า page then showed stock that wasn't
        there, and the split editor refused every later save with
        "จำนวนรวมทุกตำแหน่ง ไม่เท่ากับสต็อก". applyLocPicks is
        difference-based and plans before its first await, so calling it here —
        same tick as the qty write — absorbs the count into the pick-first shelf.
     3. A movement row per sku, so the count shows up in the product's history
        next to receives, sales and corrections instead of only as one lumped
        line in ประวัติการแก้ไข. */
function applyStockCounts(counts, opts) {
  if (!counts) return [];
  const o = opts || {};
  const changes = stockCountPlan(counts, o.reserved || null, o.pulled || null);
  changes.forEach(c => {
    const p = PRODUCTS.find(x => x.sku === c.sku);
    if (p) p.qty = c.to;
  });
  if (!changes.length) return changes;
  // Physical count = truth. The server lands on the counted number; HOW is in
  // _commitCountsToServer (after applyLocPicks has planned, below).
  const toServer = changes.map(c => ({ sku: c.sku, from: c.from, to: c.to, note: _countNote(c) }));
  if (typeof applyLocPicks === "function") {
    const picks = changes.map(c => {
      const p = PRODUCTS.find(x => x.sku === c.sku);
      return { sku: c.sku, loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(p) : (p && p.loc) || "" };
    });
    applyLocPicks(picks).then(res => {
      if (res && res.errors && res.errors.length) {
        window.dispatchEvent(new CustomEvent("ims-toast", {
          detail: `ปรับสต็อกแล้ว แต่ปรับจำนวนตามตำแหน่งไม่สำเร็จ ${res.errors.length} SKU — แก้ได้ที่หน้าสินค้า`
        }));
      }
    }).catch(() => {});
  }
  _commitCountsToServer(toServer);
  return changes;
}
/* Land a count on the server and record what REALLY moved.
   The count used to upsert the absolute qty and log `from` = this device's copy.
   With a stale copy (another phone sold one a minute ago) both the logged
   "before" and the delta were fiction, and the movement history stopped adding
   up. Now: read the server's current qty for these skus, apply the difference
   through the atomic adjust_stock RPC, and log the RPC's own before → after —
   the same rule every other movement follows. The read→adjust gap is a few ms
   instead of however old the phone's copy was; a sale landing inside it simply
   counts as happening after the count.
   No connection / no RPC → the old absolute upsert, logged with the device's
   numbers (no before/after) so nothing pretends to be exact. */
async function _commitCountsToServer(list) {
  const skus = list.map(c => c.sku);
  _persistProductsLocal();   // the counted numbers are on screen + in the local cache now
  const legacy = () => {
    _syncProductRows(skus);
    recordStockMoves(list.map(c => ({ sku: c.sku, delta: c.to - c.from, reason: `ตรวจนับสต็อก (${c.from} → ${c.to})${c.note || ""}` })));
  };
  if (!navigator.onLine || typeof dbLoadQtys !== "function" || typeof dbAdjustStock !== "function") { legacy(); return; }
  let server = null;
  try { server = await dbLoadQtys(skus); } catch (e) { server = null; }
  if (!server) { legacy(); return; }
  const adj = list.map(c => ({ sku: c.sku, to: c.to, note: c.note || "", delta: c.to - (Number.isFinite(server[c.sku]) ? server[c.sku] : c.from) }))
    .filter(a => a.delta);
  if (!adj.length) { _persistProductsLocal(); return; }   // server already holds the counted numbers
  let res = null;
  try { res = await dbAdjustStock(adj.map(a => ({ sku: a.sku, delta: a.delta })), genOpId()); } catch (e) { res = null; }
  if (!res || res.error === "RPC_MISSING" || (!res.ok && res.error !== "PERMISSION_OR_MISSING")) { legacy(); return; }
  _applyServerQty(res.rows);
  const moves = _serverMoveMap(res.rows);
  const rows = [];
  adj.forEach(a => {
    const m = moves.get(a.sku);
    if (!m) return;                                    // RLS-blocked sku: nothing moved
    const before = m.before != null ? m.before : m.after - a.delta;
    const d = m.after - before;
    if (!d) return;
    rows.push(m.before != null
      ? { sku: a.sku, delta: d, reason: `ตรวจนับสต็อก (${before} → ${m.after})${a.note}`, before, after: m.after }
      : { sku: a.sku, delta: d, reason: `ตรวจนับสต็อก (${before} → ${m.after})${a.note}` });
  });
  recordStockMoves(rows);
  if (res.error === "PERMISSION_OR_MISSING") {
    window.dispatchEvent(new CustomEvent("ims-toast", { detail: "ปรับสต็อกจากการตรวจนับไม่สำเร็จบางรายการ: บัญชีนี้ไม่มีสิทธิ์" }));
  }
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

/* ── Mouse wheel must never change a number ──────────────────────────────
   A focused <input type="number"> increments/decrements on wheel. Scrolling a
   long list with the cursor over a qty field therefore changed it silently —
   reported on ปรับสต็อก 2026-09-19, but the app has ~35 number inputs (stock
   take counts, receiving amounts, sell quantities, bundle quantities …) and
   every one of them had the same hazard.

   Guarded at the document, in the CAPTURE phase, so it applies to inputs in
   both forks without touching 35 call sites — including any added later.
   We BLUR instead of preventDefault: dropping focus stops the value change
   (the wheel only steps a FOCUSED field) while letting the list underneath
   scroll normally, which preventDefault would freeze. ปรับสต็อก goes further
   and uses QtyStepper (type="text" + − / + buttons), so there is nothing for
   the wheel to grab in the first place. */
(function guardNumberInputsFromWheel() {
  if (typeof document === "undefined") return;
  document.addEventListener("wheel", function (e) {
    const el = document.activeElement;
    if (!el || el.tagName !== "INPUT" || el.type !== "number") return;
    // Only when the pointer is actually over the focused field — scrolling
    // elsewhere on the page is none of our business.
    if (el !== e.target && !(el.contains && el.contains(e.target))) return;
    el.blur();
  }, { capture: true, passive: true });
})();

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
function enqueueOfflineWrite(type, payload, opId) {
  const q = loadOfflineQueue();
  // opId travels WITH the item so the retry replays the SAME operation id the
  // first attempt used — the server then recognises an already-applied write
  // instead of moving stock a second time (see supabase/stock-op-idempotency.sql).
  q.push({ id: "q" + Date.now() + Math.random().toString(36).slice(2, 6), type, payload, opId: opId || "", ts: new Date().toISOString() });
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
          const r = await dbDeductStock(item.payload, item.opId);
          if (r && r.ok) { _applyServerQty(r.rows); ok = true; }
          // A permission block won't fix itself by retrying — consume the item
          // (canonical state was already reloaded by the caller's error path).
          else if (r && r.error === "PERMISSION_OR_MISSING") ok = true;
        } else if (item.type === "adjust" && typeof dbAdjustStock === "function") {
          const r = await dbAdjustStock(item.payload, item.opId);
          if (r && r.ok) { _applyServerQty(r.rows); ok = true; }
          else if (r && r.error === "PERMISSION_OR_MISSING") ok = true;
          // NOTE: do NOT consume on RPC_MISSING — that would drop the delta forever
          // (local-only, never reaches the DB). Leave it queued so it replays once
          // adjust-stock.sql is deployed (mirrors the "deduct" branch).
        } else if (item.type === "ledger" && typeof dbInsertStockAdjustment === "function") {
          // A history row that couldn't be written when its movement happened —
          // dated when it HAPPENED, not when the phone got signal back.
          const rows = (item.payload || []).map(r => ({ sku: r.sku, delta: r.delta, reason: r.reason || "",
                                                       created_by: r.created_by, createdAt: r.at,
                                                       before: r.before, after: r.after, unitPrice: r.unitPrice }));
          const r = await dbInsertStockAdjustment(rows);
          ok = !!(r && (r.ok || _ledgerRefused(r.error)));
          if (ok && typeof refreshSaleMovesSoon === "function") refreshSaleMovesSoon();
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
        } else if (["orders", "labels", "deduct", "adjust", "ledger", "delete-order", "delete-label"].includes(item.type)) {
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
  const rows = orders.map((o, i) => `<tr><td class="mono">${i+1}</td><td class="mono">${safe(o.id)}</td><td>${safe(o.customer)||"—"}</td><td>${safe(o.channel)||"—"}</td><td style="text-align:center">${o.items||0}</td><td>${safe(o.carrier)||"—"}</td><td>${ORDER_STATUS_TH[o.status]||safe(o.status)}</td></tr>`).join("");
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

/* ── PDF / file hand-off on iOS ──
   jsPDF's save() and window.open(blob) make an INSTALLED iOS app navigate its own
   page to the file (Quick Look). Leaving the PDF then reloads the whole app from
   scratch — staff lost their place after every label. On iOS the file goes to
   the share sheet instead (opens OVER the app; "พิมพ์" = AirPrint, "บันทึกไปยัง
   ไฟล์", label-printer apps). navigator.share needs a fresh tap: if the work
   before it (rasterising labels) used up the tap, a one-button sheet asks for
   one more. Everything else keeps the plain download. */
function isIOSDevice() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function _plainDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let _fileSheet = null;
function _fileShareSheet(file, onFail) {
  if (_fileSheet) _fileSheet.remove();
  const wrap = document.createElement("div");
  _fileSheet = wrap;
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center";
  const card = document.createElement("div");
  card.style.cssText = "width:100%;max-width:520px;background:var(--surface,#fff);color:var(--fg,#111);border-radius:16px 16px 0 0;padding:18px 16px calc(16px + env(safe-area-inset-bottom));box-shadow:0 -8px 30px rgba(0,0,0,.25);font-family:inherit";
  const title = document.createElement("div");
  title.textContent = "ไฟล์พร้อมแล้ว";
  title.style.cssText = "font-weight:700;font-size:16px";
  const name = document.createElement("div");
  name.textContent = file.name;
  name.style.cssText = "font-size:12.5px;color:var(--muted,#666);margin:4px 0 14px;word-break:break-all";
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "เปิดเพื่อพิมพ์ / บันทึก";
  go.style.cssText = "width:100%;min-height:52px;border:none;border-radius:12px;background:var(--accent,#f60);color:#fff;font-size:16px;font-weight:700;font-family:inherit";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "ยกเลิก";
  cancel.style.cssText = "width:100%;min-height:46px;margin-top:8px;border:1px solid var(--border,#ddd);border-radius:12px;background:transparent;color:inherit;font-size:15px;font-family:inherit";
  const close = () => { wrap.remove(); if (_fileSheet === wrap) _fileSheet = null; };
  go.onclick = () => {
    close();
    navigator.share({ files: [file] }).catch(e => { if (!e || e.name !== "AbortError") onFail(); });
  };
  cancel.onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
  card.append(title, name, go, cancel);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
}
/* blob → the device. Returns "share" (iOS) | "download". */
function deliverFile(blob, filename) {
  const name = String(filename || "file").replace(/[\/\\:*?"<>|]+/g, "_");
  if (isIOSDevice() && typeof File === "function" && navigator.share && navigator.canShare) {
    let file = null;
    try { file = new File([blob], name, { type: blob.type || "application/pdf" }); } catch (e) {}
    if (file && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(e => {
        if (e && e.name === "AbortError") return;             // closed the share sheet
        _fileShareSheet(file, () => _plainDownload(blob, name));   // tap used up → ask for one
      });
      return "share";
    }
  }
  _plainDownload(blob, name);
  return "download";
}
/* Drop-in for jsPDF's pdf.save(filename). On iOS the PDF opens in the in-app
   viewer (pack-docs.jsx openFileViewer) — staff want to SEE it, then พิมพ์ /
   แชร์ from there; the share sheet alone read as "save the file". */
function savePdf(pdf, filename) {
  if (!isIOSDevice()) { pdf.save(filename); return "download"; }
  const blob = pdf.output("blob");
  if (typeof openFileViewer === "function") { openFileViewer(blob, filename); return "view"; }
  return deliverFile(blob, filename);
}

/* dbSaveState / dbMergeState RESOLVE with {error} instead of throwing, so a
   `.catch(() => {})` never sees a failure — the save looked done and was gone at
   the next reload. Writers check the result and call this: one toast per kind
   per minute, so a dead connection doesn't flood the screen. Returns true when
   the write failed. */
const _cloudFailAt = {};
function cloudWriteFailed(res, what) {
  if (res && !res.error) return false;
  const now = Date.now();
  if (!_cloudFailAt[what] || now - _cloudFailAt[what] > 60000) {
    _cloudFailAt[what] = now;
    window.dispatchEvent(new CustomEvent("ims-toast", { detail: { msg: "⚠️ บันทึก" + what + "ขึ้นระบบไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่", type: "error" } }));
  }
  return true;
}

Object.assign(window, {
  cloudWriteFailed,
  refreshReceiveDates, buildSkuInsights, SKU_SEGMENTS, hasLeadDaysColumn, setLeadDays,
  SALES_ACTION_KINDS, salesActionKindLabel, loadSalesActions, refreshSalesActions, addSalesAction, removeSalesAction, buildActionResults, ACTION_VERDICTS,
  isIOSDevice, deliverFile, savePdf,
  STOCK_SNAPSHOT_KEY, stockReportRows, buildStockReportWorkbook, downloadStockReport,
  skuBrandPrefix, guessBrandFromSku,
  ensureThaiAddrIndex, getThaiAddrIndex, parseThaiAddrTail,
  playScanBeep, playScanErrorBeep, genOrderId, snapLineItem, buildIssuePlan,
  lastIssueChannel, rememberIssueChannel, issueShipFields, cancelOrdersAndRestock, addItemsToPackOrder, removeItemFromPackOrder, packOrderAdds, ISSUE_CARRIERS, issueOrderDate,
  nowBkkLocal, stockOutStamp, stockOutAt, stockOutStampLabel, ledgerEventTime, ledgerTimeline,
  genOpId, claimCommit, releaseCommit, commitFingerprint, duplicateCommitToast,
  pendingStockDeltas, applyPendingStockDeltas, beginProductsFetch, hydrateProductsFromServer,
  recordStockMoves, writeLedgerRows, receiveStockAndRecord,
  loadStockTake, saveStockTake, loadStockTakeMeta, saveStockTakeMeta, stockTakeReserved, applyStockCounts, pendingPackReserved, stockCountPlan,
  pendingPackNote, adjustSetTarget, isCountReason, loadLatestCounts, backdateCountConflicts, ledgerStampLabel, useLatestCounts, ledgerBackdatedIds, useBackdateGuard, BackdateCountWarning,
  loadWooCatalog, saveWooCatalog, wooCatalogLookup, upsertWooCatalog, clearWooCatalog, wooCatalogCount, searchProductCandidates, findSimilarSkus,
  omit,
  PRODUCTS, stockStatus, INBOUND, OUTBOUND, ACTIVITY, LOCATIONS, CHANNELS, CHANNEL_LIST, channelSalesFor, LABEL_SIZES, SAMPLE_LABELS,
  USERS, ROLES, ROLE_NAV, CARRIERS, TODAY_ISO, todayIso, bangkokDateOf, isoToThai,
  CAPS, DEFAULT_ROLE_CAPS, ROLE_PERMS_KEY, loadRolePerms, saveRolePerms, roleNav, canOpenPage, canDo, capServerLocked, currentRoleId,
  saveProductStore, addProductToStore, updateProductInStore, updateManyProducts, adjustProductQty, setProductAbsolute, importProductsBulk, removeProductsFromStore, resetProductStore, renameProductSku,
  deductStockAndPersist, deductManyAndPersist,
  applyStockAdjustment, applyStockAdjustmentBatch, ADJUST_REASONS, adjustReasonsFor, canAdjustStock, lastAdjustReason, rememberAdjustReason, quickSaleChannels, commitQuickSale,
  loadOrders, saveOrders, appendOrder,
  loadLocTree, saveLocTree, locCode, allPositions, allLocationCodes, skusInLocation, canDeleteData, searchProductsForLocation, locParts,
  storedLocSet, locIsStored, countUnstoredProducts, productHomeLoc, productIsStored,
  refreshSaleMoves, refreshSaleMovesSoon, isAdjustSaleReason, saleChannelOfReason, saleMoveOrders, loadSalesRecords, channelToday,
  isBlankDraftOrder, isPendingOrder, ORDER_STATUS_TH, orderShortId, orderChannelLabel,
  carrierMark, channelMark, MarkTile, ChannelMark, CarrierMark,
  loadProductLocs, locSplitFor, hasLocSplit, locSplitTotal, productPositions, qtyAtLocation, productsInLocation, saveLocSplit,
  applyLocPicks, defaultPickLoc, moveStockToLocation, applyReceiveLocs,
  receiveLineShelf, receiveLinesWithoutShelf, buildReceiveReport, lastReceiveLoc, rememberReceiveLoc,
  addBuilding, renameBuilding, removeBuilding, addFloor, renameFloor, removeFloor,
  addPosition, renamePosition, removePosition,
  packKey, packLocRank, packLinesForOrder, restockLinesForOrder, packLinesForOrders, packQueue, packedRecent, packedOnDay, usePackHomeStats, packHomeThaiDate, packHomeInitials, packHomeLoadState, packAltPositions, PACK_SORTS, packSortMode, setPackSortMode, packSortOrders, packOrderTime,
  loadPackProgress, packEntry, savePackEntry, clearPackEntry, newPackBatchId, packLocNote, packNoteLocOk, setPackLocNote, editPackLocNote, loadPackOrderNotes, packOrderNote, setPackOrderNote, markOrderTouched, orderTouchedRecently, editPackOrderNote, canEditPackLocNotes, loadPackLocNotes, packLineTotals, repointPackLine,
  PACK_KEY, PACK_STATE_KEY,
  loadInboundDraft, saveInboundDraft,
  defaultWorkHours, workHoursStatus, workHoursMessage, hmToMinutes, bangkokParts, WORKHOURS_DAY_LABELS,
  bangkokDateStr, workHoursExceptionDate, hasActiveWorkHoursException, workHoursStatusForUser,
  bangkokTimeOf, shiftDayKey, thaiDayLabel, groupAuditByDay, auditTone,
  loadOfflineQueue, enqueueOfflineWrite, flushOfflineQueue,
  printBarcodeLabels, openPickListWindow
});
