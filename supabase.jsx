/* ══════════════════════════════════════════════════════════════
   Supabase client + all DB helpers for คลังพร้อมส่ง IMS
   Loaded AFTER data.jsx so PRODUCTS and isoToThai are in scope.
   ══════════════════════════════════════════════════════════════ */

const SUPABASE_URL  = 'https://eayufrfkmpeeeuaimvqw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVheXVmcmZrbXBlZWV1YWltdnF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyODA4MDcsImV4cCI6MjA5NDg1NjgwN30.tLlktiwI61LidG1Vz3tfZrfuor7rI7Wnyqhy7GJhihU';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

/* ═══════════════════════════════════════════
   PRODUCTS
   ═══════════════════════════════════════════ */
/* Reads go through products_v, NOT the products table: `authenticated` no
   longer holds SELECT on the cost column, and the view hands cost back only to
   admin/manager (NULL for everyone else) — so a role without viewCost never
   receives the number at all, not even in devtools. See
   supabase/protect-cost-column.sql. Writes still target the table; the
   products_guard_cost trigger there keeps a cost-blind client from writing the
   masked NULL over a real cost. */
async function dbLoadProducts() {
  const { data, error } = await sb.from('products_v').select('*').order('sku');
  if (error) { console.error('[DB] load products:', error.message); return null; }
  return data;
}
/* ── Why `cost` is NOT in the upsert payload ──
   protect-cost-column.sql revoked SELECT on products.cost from `authenticated`.
   PostgREST's upsert is INSERT … ON CONFLICT DO UPDATE, and Postgres refuses that
   unless the caller can SELECT every column the DO UPDATE writes — so including
   cost fails with "permission denied for table products" (42501) for EVERY user,
   admin included: admin/manager is a JWT claim, but the DB role is `authenticated`
   for everyone. (This silently broke every new-SKU create and stock-take apply
   from 2026-07-26 until it was caught on 2026-07-29.)
   So: upsert every other column, then set cost with a plain UPDATE, which needs
   only UPDATE(cost) — a privilege the role does hold. The products_guard_cost
   trigger still restores old.cost for anyone who isn't admin/manager, so this can
   neither leak cost nor let a cost-blind client wipe it.
   NOTE: cost is nullable DEFAULT 0, so an insert that omits it is safe. */
async function dbUpsertProducts(products) {
  if (!products || !products.length) return { ok: true };
  const stamp = new Date().toISOString();
  const rows = products.map(({ sku, name, cat, price, qty, reserved, reorder, loc, supplier, brand }) => ({
    sku, name, cat,
    price:    Number(price)    || 0,
    qty:      Number(qty)      || 0,
    reserved: Number(reserved) || 0,
    reorder:  Number(reorder)  || 0,
    loc:      loc      || '-',
    supplier: supplier || 'ไม่ระบุ',
    brand:    brand    || '',
    updated_at: stamp
  }));
  // .select() detects an RLS-blocked write (0 rows, no error) — e.g. a viewer
  // editing a product they have no permission to persist.
  const { data, error } = await sb.from('products').upsert(rows).select('sku');
  if (error) { console.error('[DB] upsert products:', error.message); return { error: error.message }; }
  if (!data || data.length < rows.length) {
    console.error('[DB] upsert products blocked (RLS): persisted', (data ? data.length : 0), 'of', rows.length);
    return { error: 'PERMISSION_OR_MISSING' };
  }
  const costError = await _dbWriteCosts(products);
  // The product itself saved — a cost-only failure must not be reported as a
  // total failure (that would trigger a full reload and discard nothing useful),
  // but it must not pass silently either.
  return costError ? { ok: true, costError } : { ok: true };
}

/* Set `cost` for the rows just written — see the note on dbUpsertProducts.
   Skipped outright for a cost-blind role: the trigger would revert it anyway, and
   that client's masked value must never be sent. Costs are diffed against
   products_v (which returns the real cost to admin/manager) so a re-import of
   unchanged costs writes nothing, then grouped by value so what remains is one
   scoped UPDATE per distinct cost rather than one per row. */
async function _dbWriteCosts(products) {
  if (typeof canDo === 'function' && !canDo('viewCost')) return null;
  const want = new Map();                       // sku -> cost
  products.forEach(p => {
    const sku = p && p.sku;
    if (sku) want.set(sku, Number(p.cost) || 0);
  });
  if (!want.size) return null;

  const skus = [...want.keys()];
  const CHUNK = 200;
  // Drop the skus whose stored cost already matches.
  for (let i = 0; i < skus.length; i += CHUNK) {
    const slice = skus.slice(i, i + CHUNK);
    const { data, error } = await sb.from('products_v').select('sku,cost').in('sku', slice);
    if (error) break;                            // can't diff → fall through and write them all
    (data || []).forEach(r => {
      if (want.has(r.sku) && (Number(r.cost) || 0) === want.get(r.sku)) want.delete(r.sku);
    });
  }
  if (!want.size) return null;

  const byCost = new Map();                      // cost -> [sku]
  want.forEach((cost, sku) => {
    if (!byCost.has(cost)) byCost.set(cost, []);
    byCost.get(cost).push(sku);
  });

  let firstErr = null;
  for (const [cost, list] of byCost) {
    for (let i = 0; i < list.length; i += CHUNK) {
      const { error } = await sb.from('products').update({ cost }).in('sku', list.slice(i, i + CHUNK));
      if (error && !firstErr) { firstErr = error.message; console.error('[DB] set product cost:', error.message); }
    }
  }
  if (firstErr) {
    try {
      window.dispatchEvent(new CustomEvent('ims-toast', {
        detail: 'บันทึกสินค้าแล้ว แต่บันทึกราคาทุนไม่สำเร็จ: ' + firstErr
      }));
    } catch (e) {}
  }
  return firstErr;
}

async function dbDeleteProducts(skus) {
  if (!skus) return { ok: true, deleted: 0 };
  const raw = Array.isArray(skus) ? skus : [...skus];
  if (!raw.length) return { ok: true, deleted: 0 };
  // PostgREST's in.() filter silently DROPS an empty string from its value list,
  // so a blank-sku row (bad import) can never match the normal path — the delete
  // no-ops and masquerades as an RLS block. Address blanks with an explicit
  // eq-empty filter instead.
  const arr = raw.filter(s => typeof s === 'string' && s.trim() !== '');
  const wantBlank = arr.length < raw.length;
  let blankDeleted = 0;
  if (wantBlank) {
    const { data: bd, error: be } = await sb.from('products').delete().eq('sku', '').select('sku');
    if (be) { console.error('[DB] delete blank-sku product:', be.message); return { error: be.message, deleted: 0 }; }
    blankDeleted = bd ? bd.length : 0;
  }
  let data = [];
  if (arr.length) {
    // .select() returns the rows actually deleted. Under RLS, a DELETE the caller
    // isn't allowed to perform succeeds with 0 rows and NO error — so we must
    // compare the deleted count to detect a silently-blocked delete.
    const res = await sb.from('products').delete().in('sku', arr).select('sku');
    if (res.error) { console.error('[DB] delete products:', res.error.message); return { error: res.error.message, deleted: blankDeleted }; }
    data = res.data || [];
  }
  // Which requested skus came back vs not — an RLS block skips ALL rows, while
  // a sku that matches no DB row (stale local copy, invisible characters) skips
  // just itself. Surfacing the misses makes the two failure modes tellable apart.
  const got = new Set(data.map(r => r.sku));
  const missing = arr.filter(s => !got.has(s));
  // Every local blank-sku row maps onto (at most) one DB row, so any eq-empty
  // hit clears them all; blank is "missing" only when nothing matched at all.
  if (wantBlank && blankDeleted === 0) missing.push('(SKU ว่าง)');
  const deleted = data.length + blankDeleted;
  if (missing.length) {
    console.error('[DB] delete products: only', deleted, 'of', raw.length, 'requested; missing:', JSON.stringify(missing));
    return { error: 'PERMISSION_OR_MISSING', deleted, missing };
  }
  return { ok: true, deleted };
}

/* Atomic server-side stock deduction (migration-atomic-stock.sql).
   One UPDATE per SKU with qty = GREATEST(0, qty - n) — concurrent sells on
   two devices serialize on the row lock instead of overwriting each other
   via the old read-modify-write full-catalog upsert.
   Returns { ok, rows: [{sku, qty}] } with the server-canonical quantities,
   { error: 'RPC_MISSING' } if the migration hasn't been applied yet, or
   { error: 'PERMISSION_OR_MISSING', rows } when RLS blocked some rows. */
/* ── Idempotent replay support ──
   The 2-arg deduct_stock(deductions, op_id) / adjust_stock(adjustments, op_id)
   record the op id and skip a movement they have already applied, which is what
   makes a retry after an uncertain failure safe (supabase/stock-op-idempotency.sql).
   The original 1-arg functions are left in place by that migration, so the two
   signatures never collide in PostgREST's overload resolution and an app
   deployed BEFORE the SQL simply falls back to the un-deduped call once. */
let _stockOpIdSupported = null;   // null = untested, false = SQL not deployed yet
async function _rpcStock(fn, argName, items, opId) {
  if (opId && _stockOpIdSupported !== false) {
    const res = await sb.rpc(fn, { [argName]: items, op_id: opId });
    const notFound = res.error && (res.error.code === 'PGRST202' || res.error.code === 'PGRST203');
    if (!notFound) { if (res.error == null) _stockOpIdSupported = true; return res; }
    // Migration not applied (or ambiguous) → remember and use the 1-arg form.
    _stockOpIdSupported = false;
    console.warn('[DB]', fn, 'has no op_id parameter — run supabase/stock-op-idempotency.sql to make retries duplicate-proof');
  }
  return sb.rpc(fn, { [argName]: items });
}

async function dbDeductStock(deductions, opId) {
  const items = (deductions || [])
    .filter(d => d && d.sku && Number(d.qty) > 0)
    .map(d => ({ sku: d.sku, qty: Number(d.qty) }));
  if (!items.length) return { ok: true, rows: [] };
  const { data, error } = await _rpcStock('deduct_stock', 'deductions', items, opId);
  if (error) {
    console.error('[DB] deduct_stock:', error.message);
    // PGRST202 = function not found → migration not applied; caller falls back
    const missing = (error.code === 'PGRST202') || /function|deduct_stock/i.test(error.message || '');
    return { error: missing ? 'RPC_MISSING' : error.message };
  }
  const rows = Array.isArray(data) ? data : [];
  // Distinct SKUs that came back vs requested (the same SKU may legitimately
  // appear twice in one cart — e.g. alone and inside a bundle).
  const got = new Set(rows.map(r => r.sku));
  const want = new Set(items.map(i => i.sku));
  if (got.size < want.size) {
    console.error('[DB] deduct_stock blocked/missing:', got.size, 'of', want.size, 'SKUs updated');
    return { error: 'PERMISSION_OR_MISSING', rows };
  }
  return { ok: true, rows };
}

/* Map only the product columns PRESENT in `changes` (coercing numerics the same
   way dbUpsertProducts does). Used for scoped single-/multi-row updates so a
   field edit never has to rewrite qty (or the whole catalog). */
const _PRODUCT_COL_MAP = {
  name:     v => v,
  cat:      v => v,
  cost:     v => Number(v) || 0,
  price:    v => Number(v) || 0,
  qty:      v => Number(v) || 0,
  reserved: v => Number(v) || 0,
  reorder:  v => Number(v) || 0,
  loc:      v => v || '-',
  supplier: v => v || 'ไม่ระบุ',
  brand:    v => v || '',
};
function _mapProductPatch(changes) {
  const patch = {};
  for (const k in _PRODUCT_COL_MAP) if (k in changes) patch[k] = _PRODUCT_COL_MAP[k](changes[k]);
  return patch;
}
/* Scoped update of ONE product's changed columns (never the whole catalog, and
   caller decides whether qty is included). .select() detects an RLS-blocked
   write (0 rows, no error), same as dbUpsertProducts. */
async function dbUpdateProduct(sku, changes) {
  const patch = _mapProductPatch(changes);
  if (!Object.keys(patch).length) return { ok: true };
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('products').update(patch).eq('sku', sku).select('sku');
  if (error) { console.error('[DB] update product', sku, ':', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
  return { ok: true };
}
/* Scoped update of the SAME columns across many skus (e.g. a category rename or
   a location re-point) — one UPDATE, no qty, no whole-catalog rewrite. */
async function dbUpdateProducts(skus, changes) {
  const arr = Array.isArray(skus) ? skus : [...skus];
  if (!arr.length) return { ok: true };
  const patch = _mapProductPatch(changes);
  if (!Object.keys(patch).length) return { ok: true };
  patch.updated_at = new Date().toISOString();
  const { data, error } = await sb.from('products').update(patch).in('sku', arr).select('sku');
  if (error) { console.error('[DB] update products:', error.message); return { error: error.message }; }
  if (!data || data.length < arr.length) {
    console.error('[DB] update products blocked (RLS): updated', (data ? data.length : 0), 'of', arr.length);
    return { error: 'PERMISSION_OR_MISSING' };
  }
  return { ok: true };
}
/* Rename a product's SKU (the primary key) — supabase/rename-sku-cascade.sql.
   Server-side RPC only: bundle_items/stock_adjustments/product_locations follow
   via ON UPDATE CASCADE, restricted to admin/manager (moves stock's own address,
   not a display field). Error codes map onto the same shape the rest of this
   file uses so the caller's toast logic doesn't need a special case. */
async function dbRenameSku(oldSku, newSku) {
  const from = String(oldSku || '').trim();
  const to = String(newSku || '').trim();
  if (!from || !to) return { error: 'INVALID' };
  if (from === to) return { ok: true, sku: to };
  const { data, error } = await sb.rpc('rename_product_sku', { p_old_sku: from, p_new_sku: to });
  if (error) {
    console.error('[DB] rename_product_sku:', error.message);
    if (error.code === 'PGRST202' || error.code === 'PGRST203') return { error: 'RPC_MISSING' };
    if (error.code === '42501') return { error: 'PERMISSION_OR_MISSING' };
    if (error.code === '23505') return { error: 'DUPLICATE' };
    if (error.code === 'P0002') return { error: 'NOT_FOUND' };
    return { error: error.message };
  }
  return { ok: true, sku: (data && data.sku) || to };
}

/* Atomic signed stock adjustment (adjust-stock.sql) — the inbound/adjust twin of
   deduct_stock. One UPDATE per sku with qty = GREATEST(0, qty + delta), so two
   devices receiving/adjusting the same sku serialize on the row lock instead of
   clobbering via a stale absolute write. Same return contract as dbDeductStock. */
async function dbAdjustStock(adjustments, opId) {
  const items = (adjustments || [])
    .filter(a => a && a.sku && Number.isFinite(Number(a.delta)) && Number(a.delta) !== 0)
    .map(a => ({ sku: a.sku, delta: Number(a.delta) }));
  if (!items.length) return { ok: true, rows: [] };
  const { data, error } = await _rpcStock('adjust_stock', 'adjustments', items, opId);
  if (error) {
    console.error('[DB] adjust_stock:', error.message);
    const missing = (error.code === 'PGRST202') || /function|adjust_stock/i.test(error.message || '');
    return { error: missing ? 'RPC_MISSING' : error.message };
  }
  const rows = Array.isArray(data) ? data : [];
  const got = new Set(rows.map(r => r.sku));
  const want = new Set(items.map(i => i.sku));
  if (got.size < want.size) {
    console.error('[DB] adjust_stock blocked/missing:', got.size, 'of', want.size, 'SKUs updated');
    return { error: 'PERMISSION_OR_MISSING', rows };
  }
  return { ok: true, rows };
}

/* ── stock_adjustments history ──
   Append-only log of reasoned manual adjustments (ปรับสต็อก) — schema in
   supabase-schema.sql §4, RLS insert = admin/manager/staff within work hours.
   Best-effort, mirroring dbInsertAuditEntry: the atomic adjust_stock write is
   the authoritative operation, and it already surfaces its own permission
   toast — a blocked history row must not toast a second error on top. */
async function dbInsertStockAdjustment(entries) {
  const rows = (entries || [])
    .filter(e => e && e.sku && Number(e.delta))
    .map(e => {
      const row = {
        sku: e.sku,
        delta: Number(e.delta),
        reason: e.reason || '',
        created_by: e.created_by || (window.__currentUser && window.__currentUser.name) || 'ระบบ'
      };
      // Backdated adjustment / ขายออก — date the history row when it really happened.
      if (e.createdAt) row.created_at = e.createdAt;
      return row;
    });
  if (!rows.length) return { ok: true };
  const { data, error } = await sb.from('stock_adjustments').insert(rows).select('id');
  if (error) { console.error('[DB] insert stock_adjustments:', error.message); return { error: error.message }; }
  if (!data || data.length < rows.length) {
    console.error('[DB] insert stock_adjustments blocked:', (data || []).length, 'of', rows.length, 'rows');
    return { error: 'PERMISSION_OR_MISSING' };
  }
  return { ok: true };
}
/* Sales recorded through ปรับสต็อก ("ขายผ่าน … (นอกระบบ)" / "ขายหน้าร้าน …") since
   `sinceIso`. Staff record almost every sale this way, so analytics and the
   per-channel cards read these alongside real orders (see saleMoveOrders in
   data.jsx). Read-only; null on error so callers keep the previous cache. */
async function dbLoadSaleAdjustments(sinceIso) {
  // ONLY the ปรับสต็อก sale reasons. ขายสินค้า / ตัดสต็อก / ขายชุดสินค้า also write
  // history rows ("ขายสินค้า · …", "ขายชุดสินค้า …") but they already exist as
  // orders — loading them here would count those sales twice.
  let q = sb.from('stock_adjustments').select('id, sku, delta, reason, created_at')
    .or('reason.like.ขายผ่าน*,reason.like.ขายหน้าร้าน*')
    .lt('delta', 0)
    .order('created_at', { ascending: false })
    .limit(10000);
  if (sinceIso) q = q.gte('created_at', sinceIso);
  const { data, error } = await q;
  if (error) { console.error('[DB] load sale adjustments:', error.message); return null; }
  return data || [];
}
/* Latest adjustments for one sku — feeds the ProductDrawer movement list. */
async function dbLoadStockAdjustments(sku, limit = 10) {
  const { data, error } = await sb
    .from('stock_adjustments').select('*')
    .eq('sku', sku)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.error('[DB] load stock_adjustments:', error.message); return null; }
  return data || [];
}

/* ═══════════════════════════════════════════
   PRODUCT LOCATIONS — quantity per storage position
   products.loc holds ONE position (the primary / pick-first shelf); this table
   holds the real distribution for stock kept in more than one place, so a
   product split between zone A and an upstairs box stops reporting all of it
   downstairs. See supabase/product-locations.sql.
   Shape returned to the app: { [sku]: [{ loc, qty, note }] }
   ═══════════════════════════════════════════ */
async function dbLoadProductLocs() {
  const { data, error } = await sb.from('product_locations').select('sku, loc, qty, note');
  if (error) {
    // Table not migrated yet → behave exactly as before rather than breaking boot.
    if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) return null;
    console.error('[DB] load product_locations:', error.message);
    return null;
  }
  const map = {};
  (data || []).forEach(r => {
    if (!r || !r.sku || !r.loc) return;
    (map[r.sku] = map[r.sku] || []).push({ loc: r.loc, qty: Number(r.qty) || 0, note: r.note || '' });
  });
  return map;
}

/* Replace the whole split for ONE sku: delete the rows it no longer occupies,
   then upsert the rest. Deleting first (rather than upserting and pruning after)
   keeps a failed second step from leaving stock double-counted across a position
   the product has actually left.
   RLS-aware like the rest of this file: an upsert that returns 0 rows without an
   error means the policy silently refused the write, so surface it as an error
   instead of reporting success. DELETE is admin/manager only — a staff user
   moving stock OUT of a position hits that, so treat a blocked delete as fatal
   too rather than leaving a phantom pile behind. */
async function dbSaveProductLocs(sku, rows) {
  if (!sku) return { error: 'NO_SKU' };
  const keep = (rows || [])
    .filter(r => r && r.loc && (Number(r.qty) || 0) > 0)
    .map(r => ({ sku, loc: String(r.loc), qty: Math.max(0, Math.round(Number(r.qty) || 0)),
                 note: r.note || '', updated_at: new Date().toISOString() }));
  const keepLocs = keep.map(r => r.loc);

  /* Read first, then delete exactly the rows that should go, WITH .select() —
     a delete without it returns no rows and no error when RLS refuses, so a
     staff user emptying a shelf used to look like success while the row lived
     on and the next realtime refetch resurrected it. */
  const { data: cur, error: curErr } = await sb.from('product_locations').select('loc').eq('sku', sku);
  if (curErr) { console.error('[DB] read product_locations:', curErr.message); return { error: curErr.message }; }
  const toDelete = (cur || []).map(r => r.loc).filter(l => keepLocs.indexOf(l) < 0);
  if (toDelete.length) {
    const { data: del, error: delErr } = await sb.from('product_locations')
      .delete().eq('sku', sku).in('loc', toDelete).select('loc');
    if (delErr) { console.error('[DB] delete product_locations:', delErr.message); return { error: delErr.message }; }
    if (!del || del.length < toDelete.length) {
      console.error('[DB] delete product_locations blocked:', (del || []).length, 'of', toDelete.length, 'rows');
      return { error: 'PERMISSION_OR_MISSING' };
    }
  }

  if (!keep.length) return { ok: true };
  const { data, error } = await sb.from('product_locations')
    .upsert(keep, { onConflict: 'sku,loc' }).select('sku');
  if (error) { console.error('[DB] save product_locations:', error.message); return { error: error.message }; }
  if (!data || data.length < keep.length) {
    console.error('[DB] save product_locations blocked:', (data || []).length, 'of', keep.length, 'rows');
    return { error: 'PERMISSION_OR_MISSING' };
  }
  return { ok: true };
}

/* ═══════════════════════════════════════════
   ORDERS
   ═══════════════════════════════════════════ */
function _orderToRow(o) {
  return {
    id:            o.id,
    channel:       o.channel    || '',
    customer:      o.customer   || '',
    phone:         o.phone      || '',
    status:        o.status     || 'picking',
    carrier:       o.carrier    || '',
    tracking:      o.tracking   || '',
    item_count:    typeof o.items === 'number' ? o.items
                   : (Array.isArray(o.items) ? o.items.length : 0),
    is_bundle:     o.isBundle   || false,
    bundle_name:   o.bundleName || '',
    line_items:    o.lineItems  || null,
    deductions:    o.deductions || null,
    shipping_addr: o.shippingAddr || '',
    cod_amount:    Number(o.codAmount) || 0,
    note:          o.note       || '',
    date_iso:      o.dateIso    || new Date().toISOString().slice(0, 10)
  };
}
function _rowToOrder(row) {
  const dateIso = row.date_iso || ((typeof bangkokDateOf === "function") ? bangkokDateOf(row.created_at) : row.created_at?.slice(0, 10)) || '';
  const ts = row.created_at
    ? new Date(row.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
    : (row.ts || '');
  return {
    id:           row.id,
    channel:      row.channel    || '',
    customer:     row.customer   || '',
    phone:        row.phone      || '',
    status:       row.status     || 'picking',
    // Normalize the legacy "—" sentinel (older sell/issue orders stored it as a
    // literal value) to empty so the waiting count + customer page treat it as
    // "no tracking yet" rather than a real tracking number.
    carrier:      (row.carrier  === '—' ? '' : (row.carrier  || '')),
    tracking:     (row.tracking === '—' ? '' : (row.tracking || '')),
    items:        row.item_count ?? 0,
    isBundle:     row.is_bundle  || false,
    bundleName:   row.bundle_name || '',
    lineItems:    row.line_items  || [],
    deductions:   row.deductions  || [],
    shippingAddr: row.shipping_addr || '',
    codAmount:    row.cod_amount || 0,
    note:         row.note       || '',
    dateIso,
    date: isoToThai(dateIso),
    ts
  };
}
async function dbLoadOrders() {
  const { data, error } = await sb
    .from('orders').select('*').order('created_at', { ascending: false });
  if (error) { console.error('[DB] load orders:', error.message); return null; }
  return data.map(_rowToOrder);
}
// All columns now present after 2026-06-01 migration:
// item_count, bundle_name, line_items, deductions, date_iso added via Management API.
async function dbUpsertOrders(orders) {
  if (!orders || !orders.length) return { ok: true };
  const rows = orders.map(_orderToRow);
  const { data, error } = await sb.from('orders').upsert(rows).select('id');
  if (error) { console.error('[DB] upsert orders:', error.message); return { error: error.message }; }
  if (!data || data.length < rows.length) {
    console.error('[DB] upsert orders blocked (RLS) —', data?.length ?? 0, 'of', rows.length);
    return { error: 'PERMISSION_OR_MISSING' };
  }
  // Backdated stock-out: stamp created_at so the order's time survives a reload
  // (_rowToOrder derives ts from created_at). A scoped UPDATE rather than a column
  // in _orderToRow, whose shape the public track-lookup function depends on.
  // Best-effort — the date already persisted via date_iso.
  for (const o of orders) {
    if (!o || !o.createdAt) continue;
    const { error: e2 } = await sb.from('orders').update({ created_at: o.createdAt }).eq('id', o.id);
    if (e2) console.error('[DB] set order created_at:', e2.message);
  }
  return { ok: true };
}
async function dbDeleteOrder(id) {
  // .select() lets us detect an RLS-blocked delete (0 rows, no error).
  const { data, error } = await sb.from('orders').delete().eq('id', id).select('id');
  if (error) { console.error('[DB] delete order:', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
  return { ok: true };
}

/* ═══════════════════════════════════════════
   BUNDLES
   ═══════════════════════════════════════════ */
async function dbLoadBundles() {
  const { data, error } = await sb
    .from('bundles').select('*, bundle_items(sku, qty)').order('id');
  if (error) { console.error('[DB] load bundles:', error.message); return null; }
  return data.map(b => ({
    id:        b.id,
    name:      b.name,
    desc:      b.descr || '',
    descr:     b.descr || '',
    price:     b.price || 0,
    items:     (b.bundle_items || []).map(i => ({ sku: i.sku, qty: i.qty })),
    createdAt: b.created_at?.slice(0, 10) || ''
  }));
}
async function dbUpsertBundles(bundles) {
  if (!bundles || !bundles.length) return { ok: true };
  for (const b of bundles) {
    // .select() detects an RLS-blocked write (0 rows, no error).
    const { data, error: e1 } = await sb.from('bundles').upsert({
      id: b.id, name: b.name,
      descr: b.desc || b.descr || '',
      price: b.price || 0
    }).select('id');
    if (e1) { console.error('[DB] upsert bundle:', e1.message); return { error: e1.message }; }
    if (!data || !data.length) { console.error('[DB] upsert bundle blocked (RLS)'); return { error: 'PERMISSION_OR_MISSING' }; }
    await sb.from('bundle_items').delete().eq('bundle_id', b.id);
    if (b.items && b.items.length > 0) {
      const { error: e2 } = await sb.from('bundle_items').insert(
        b.items.map(i => ({ bundle_id: b.id, sku: i.sku, qty: i.qty }))
      );
      if (e2) { console.error('[DB] insert bundle_items:', e2.message); return { error: e2.message }; }
    }
  }
  return { ok: true };
}
async function dbDeleteBundle(bundleId) {
  const { data, error } = await sb.from('bundles').delete().eq('id', bundleId).select('id');
  if (error) { console.error('[DB] delete bundle:', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
  return { ok: true };
}

/* ═══════════════════════════════════════════
   LABELS
   ═══════════════════════════════════════════ */
async function dbLoadLabels() {
  const { data, error } = await sb
    .from('labels').select('*').order('created_at', { ascending: false });
  if (error) { console.error('[DB] load labels:', error.message); return null; }
  return data.map(l => ({ ...l.data, id: l.id }));
}
async function dbUpsertLabels(labels) {
  if (!labels || !labels.length) return { ok: true };
  const rows = labels.map(l => ({ id: l.id, so_id: l.soId || '', data: l }));
  const { data, error } = await sb.from('labels').upsert(rows).select('id');
  if (error) { console.error('[DB] upsert labels:', error.message); return { error: error.message }; }
  if (!data || data.length < rows.length) {
    console.error('[DB] upsert labels blocked (RLS) —', data?.length ?? 0, 'of', rows.length);
    return { error: 'PERMISSION_OR_MISSING' };
  }
  return { ok: true };
}
async function dbDeleteLabel(id) {
  const { data, error } = await sb.from('labels').delete().eq('id', id).select('id');
  if (error) { console.error('[DB] delete label:', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
  return { ok: true };
}

/* ═══════════════════════════════════════════
   STORE SETTINGS
   ═══════════════════════════════════════════ */
async function dbLoadStoreSettings() {
  const { data, error } = await sb
    .from('store_settings').select('value').eq('key', 'main').maybeSingle();
  if (error) { console.error('[DB] load store_settings:', error.message); return null; }
  return data?.value || null;
}
async function dbSaveStoreSettings(store) {
  const { data, error } = await sb.from('store_settings').upsert({ key: 'main', value: store }).select('key');
  if (error) { console.error('[DB] save store_settings:', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
  return { ok: true };
}

/* ═══════════════════════════════════════════
   APP STATE (key-value) — shared data that used to be localStorage-only:
   categories, locations, stock_adj. One table, realtime-synced like the rest.
   ═══════════════════════════════════════════ */
async function dbLoadState(key) {
  const { data, error } = await sb.from('app_state').select('value').eq('key', key).maybeSingle();
  if (error) { console.error('[DB] load app_state', key, ':', error.message); return null; }
  return data ? data.value : null;
}
async function dbSaveState(key, value) {
  // Clearing a key: `value` is `jsonb NOT NULL`, so upserting null violates the
  // constraint. Delete the row instead — this fires a realtime DELETE whose
  // payload.old.key lets listeners (img:/locimg: handlers) treat the key as
  // cleared, and returns null from dbLoadState on reload. DELETE RLS is
  // admin/manager only (same as the app's canDeleteData gate).
  if (value === null || value === undefined) {
    const { error } = await sb.from('app_state').delete().eq('key', key);
    if (error) { console.error('[DB] clear app_state', key, ':', error.message); return { error: error.message }; }
    return { ok: true };
  }
  const { data, error } = await sb.from('app_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }).select('key');
  if (error) { console.error('[DB] save app_state', key, ':', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
  return { ok: true };
}

/* Server-side MERGE of a partial jsonb patch into an app_state map (see
   supabase/merge-app-state.sql). Used for order_overrides so concurrent edits to
   different orders don't clobber each other via a whole-map upsert. Returns null
   when the merge_app_state function isn't deployed yet, so the caller can fall
   back to the (racy) whole-map dbSaveState — mirrors the server_now/deduct_stock
   RPC-with-fallback pattern. */
async function dbMergeState(key, patch) {
  const { data, error } = await sb.rpc('merge_app_state', { k: key, patch });
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202' || /merge_app_state|function .* does not exist/i.test(error.message || ''))
      return null; // function not deployed → signal fallback
    console.error('[DB] merge app_state', key, ':', error.message);
    return { error: error.message };
  }
  return { ok: true };
}
/* Authoritative server wall-clock (epoch ms), used by the working-hours access
   gate so a staff member can't bypass it by changing their device clock. Reads
   it from a tiny SQL function (server_now → see supabase/create-server-now.sql).
   Falls back to the device clock if the function isn't deployed or the call
   fails, so the app never breaks — it just loses tamper-resistance until the
   one-line migration is applied. Result is cached briefly to avoid per-check
   round-trips. */
let __serverTimeCache = { atDeviceMs: 0, offsetMs: 0, ok: false };
async function dbServerTimeMs() {
  // Reuse a recent sync (<30s) by projecting the measured offset onto the clock.
  const nowDev = Date.now();
  if (__serverTimeCache.ok && nowDev - __serverTimeCache.atDeviceMs < 30000) {
    return nowDev + __serverTimeCache.offsetMs;
  }
  try {
    // Capped at 6 s: a hung request here used to hold the whole app on the
    // loading screen (the access check awaits it before opening the gate).
    const { data, error } = await Promise.race([
      sb.rpc('server_now'),
      new Promise(res => setTimeout(() => res({ data: null, error: 'timeout' }), 6000))
    ]);
    const serverMs = data ? Date.parse(data) : NaN;
    if (!error && !isNaN(serverMs)) {
      __serverTimeCache = { atDeviceMs: Date.now(), offsetMs: serverMs - Date.now(), ok: true };
      return serverMs;
    }
  } catch (e) { /* fall through to device clock */ }
  return Date.now();
}
// Product images live in app_state too — one row per SKU, key "img:<sku>", value
// is the WebP data-URL string. Stored per-SKU (not one giant blob) so each row
// stays small. A removed image is stored as null and filtered out on load.
async function dbLoadProductImages() {
  const { data, error } = await sb.from('app_state').select('key, value').like('key', 'img:%');
  if (error) { console.error('[DB] load product images:', error.message); return null; }
  const m = {};
  (data || []).forEach(r => { if (r && r.value != null) m[r.key.slice(4)] = r.value; });
  return m;
}
// Location (bin/shelf) photos live in app_state too — one row per position code,
// key "locimg:<code>", value is the WebP data-URL string. Same shape as product
// images above, just keyed by the position's full locCode() string.
async function dbLoadLocationImages() {
  const { data, error } = await sb.from('app_state').select('key, value').like('key', 'locimg:%');
  if (error) { console.error('[DB] load location images:', error.message); return null; }
  const m = {};
  (data || []).forEach(r => { if (r && r.value != null) m[r.key.slice(7)] = r.value; });
  return m;
}

/* ═══════════════════════════════════════════
   AUDIT LOG
   ═══════════════════════════════════════════ */
/* Accepts one entry or an ARRAY of them. A batch (a 5-sku ปรับสต็อก, a stock
   take, a receiving job) MUST go in as one insert: created_at is assigned by the
   server on arrival, so N parallel single-row inserts land in race order and the
   history then reads out of sequence — "0 → 30" printed below "30 → 60" for the
   same sku, which looks exactly like a duplicated entry even when it isn't.
   One statement = one created_at + sequential ids, and the list's
   `created_at desc, id desc` sort replays the batch in true order. */
/* audit_log has no column for the per-field / per-SKU `changes` list, so it used
   to stay on the device that made the change — every other device saw only
   "ปิดงานรับเข้า — เพิ่มสต็อก 2 SKU รวม 40 ชิ้น" with no idea WHICH SKUs. Fold
   the list into the stored note (local display is unchanged: it still has
   `changes` itself). Capped so a huge batch can't produce a giant row. */
function _auditNoteForDb(e) {
  const base = String(e.note || '');
  const ch = Array.isArray(e.changes) ? e.changes : [];
  if (!ch.length) return base;
  const detail = ch.map(c => {
    if (!c) return '';
    const lab = c.label != null ? String(c.label) : '';
    const from = (c.from != null && c.from !== '') ? `${c.from} → ` : '';
    const to = c.to != null ? String(c.to) : '';
    return lab + (from || to ? `: ${from}${to}` : '');
  }).filter(Boolean).join(' · ');
  if (!detail) return base;
  const out = base ? `${base} | ${detail}` : detail;
  return out.length > 3000 ? out.slice(0, 2990) + ' …' : out;
}
async function dbInsertAuditEntry(entry) {
  const list = Array.isArray(entry) ? entry : [entry];
  const rows = list.filter(Boolean).map(e => ({
    entity:    e.entity    || '',
    entity_id: e.entityId  || '',
    action:    e.action    || '',
    summary:   e.summary   || '',
    note:      _auditNoteForDb(e),
    user_name: e.user?.name || 'ระบบ'
  }));
  if (!rows.length) return;
  const { error } = await sb.from('audit_log').insert(rows);
  if (error) console.error('[DB] insert audit_log:', error.message);
}
function _auditRowToEntry(row) {
  return {
    id:       String(row.id),
    ts:       row.created_at,
    user:     { name: row.user_name || 'ระบบ', role: '', avatar: (row.user_name || '?')[0], id: 0 },
    entity:   row.entity,
    entityId: row.entity_id,
    action:   row.action,
    summary:  row.summary,
    note:     row.note
  };
}
// `before` pages FURTHER BACK than the newest `limit` rows. Pass the oldest
// entry already held as { id } — the identity column is unique, so no row is
// skipped or repeated even when several share a timestamp — or { ts } when the
// caller only has a local (not-yet-synced) entry to anchor on.
async function dbLoadAuditLog(limit = 500, before) {
  let q = sb.from('audit_log').select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before && before.id != null)  q = q.lt('id', before.id);
  else if (before && before.ts)     q = q.lt('created_at', before.ts);
  const { data, error } = await q;
  if (error) { console.error('[DB] load audit_log:', error.message); return null; }
  return data.map(_auditRowToEntry);
}
// One Bangkok calendar day, however deep it sits in the log — jumping to an old
// day costs a single query instead of paging back to it row by row.
async function dbLoadAuditDay(dateKey, limit = 2000) {
  const start = new Date(String(dateKey || '') + 'T00:00:00+07:00');
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 86400000);
  const { data, error } = await sb.from('audit_log').select('*')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (error) { console.error('[DB] load audit_log day:', error.message); return null; }
  return data.map(_auditRowToEntry);
}
// Total rows kept, so the UI can say "showing X of Y" instead of implying the
// loaded page is the whole history. HEAD request — no rows transferred.
async function dbCountAuditLog() {
  const { count, error } = await sb.from('audit_log').select('id', { count: 'exact', head: true });
  if (error) { console.error('[DB] count audit_log:', error.message); return null; }
  return typeof count === 'number' ? count : null;
}
async function dbDeleteAuditLog() {
  // audit_log DELETE is admin-only under RLS; a non-admin gets 0 rows + no error.
  // gte('id', 0) matches every row (PostgREST requires a filter on bulk delete);
  // .select() returns the rows actually removed so we can detect a silent block.
  const { data, error } = await sb.from('audit_log').delete().gte('id', 0).select('id');
  if (error) { console.error('[DB] delete audit_log:', error.message); return { error: error.message }; }
  return { ok: true, deleted: data ? data.length : 0 };
}

/* ═══════════════════════════════════════════
   REAL-TIME SYNC
   Fires custom events so every open browser tab
   and all team members' browsers stay in sync.
   ═══════════════════════════════════════════ */
/* Every realtime handler refetches a whole list. Two events arriving close
   together put two requests in flight, and the one that RESPONDS last used to
   win — so an older snapshot could overwrite newer rows and the entry someone
   had just made appeared to vanish until the next event. _rtClaim/_rtStale give
   each list a monotonic ticket: a response older than one already applied is
   dropped. (PRODUCTS has its own version of this in data.jsx, which also folds
   queued offline writes back in.) */
const _rtSeq = {};      // list key → last ticket handed out
const _rtDone = {};     // list key → last ticket applied
function _rtClaim(key) { return (_rtSeq[key] = (_rtSeq[key] || 0) + 1); }
function _rtStale(key, seq) {
  if (seq < (_rtDone[key] || 0)) return true;
  _rtDone[key] = seq;
  return false;
}

/* ── Live stock across devices (2026-09-30) ──
   `products` is deliberately NOT in the realtime publication: staff have no
   SELECT on products.cost, and a postgres_changes payload carries the whole row,
   so publishing it could push cost to a staff phone. Stock movements are seen
   through `stock_adjustments` instead — every movement writes exactly one row
   there (recordStockMoves), with no cost in it — and the handler reloads the
   catalog through products_v, which masks cost per role.
   Every reload is COALESCED: one ปรับสต็อก batch inserts one row per SKU, and a
   full 424-row reload per row would hammer every open phone. A burst becomes
   one fetch ~0.7 s after the last event. */
const _rtTimers = {};
function _rtSoon(key, fn, ms) {
  clearTimeout(_rtTimers[key]);
  _rtTimers[key] = setTimeout(() => { fn().catch(() => {}); }, ms || 700);
}
let _lastLiveSync = Date.now();
async function _rtReloadProducts() {
  // Two responses in flight used to race: whichever landed last won, so a stale
  // snapshot could overwrite newer stock. hydrateProductsFromServer drops an
  // out-of-order response and folds queued-but-unsynced deltas back in.
  const seq = (typeof beginProductsFetch === 'function') ? beginProductsFetch() : null;
  const fresh = await dbLoadProducts();
  if (!fresh) return;
  _lastLiveSync = Date.now();
  if (typeof hydrateProductsFromServer === 'function') {
    if (!hydrateProductsFromServer(fresh, seq)) return;   // superseded by a newer fetch
  } else { PRODUCTS.length = 0; fresh.forEach(p => PRODUCTS.push(p)); }
  window.dispatchEvent(new CustomEvent('ims-products-change'));
}
async function _rtReloadProductLocs() {
  const seq = _rtClaim('product_locs');
  const fresh = await dbLoadProductLocs();
  if (_rtStale('product_locs', seq)) return;
  if (fresh) {
    window._DB_PRODUCT_LOCS = fresh;
    try { localStorage.setItem('ims_product_locs', JSON.stringify(fresh)); } catch (e) {}
  }
  window.dispatchEvent(new CustomEvent('ims-product-locs-change'));
}
async function _rtReloadOrders() {
  const seq = _rtClaim('orders');
  const fresh = await dbLoadOrders();
  if (_rtStale('orders', seq)) return;
  if (fresh) window._DB_ORDERS = fresh;
  window.dispatchEvent(new CustomEvent('ims-orders-change'));
}
async function _rtReloadAudit() {
  // Reload at least as deep as the user has already paged back with
  // "โหลดเพิ่ม", or every extra page would vanish on the next write.
  const depth = Math.max(500, (window._DB_AUDIT_LOG || []).length);
  const seq = _rtClaim('audit');
  const fresh = await dbLoadAuditLog(depth);
  if (_rtStale('audit', seq)) return;
  if (fresh) window._DB_AUDIT_LOG = fresh;
  window.dispatchEvent(new CustomEvent('ims-audit-change'));
}
/* Stock moved somewhere (any device): catalog + shelves (+ sales cards). */
function _rtStockMoved() {
  _rtSoon('products', _rtReloadProducts);
  _rtSoon('product_locs', _rtReloadProductLocs);
  if (typeof refreshSaleMovesSoon === 'function') refreshSaleMovesSoon();
}
/* Catch-up for everything realtime can miss: product edits that move no stock
   (name, price, reorder), a phone that slept through events, a dropped socket.
   Runs when the app returns to the foreground after 2+ minutes away, and right
   after the channel RE-subscribes. */
function refreshLiveData() {
  _rtStockMoved();
  _rtSoon('orders', _rtReloadOrders);
  // The activity feeds (กิจกรรมล่าสุด, ประวัติการแก้ไข) read this cache too — a
  // receive made on the phone while this screen slept never appeared here.
  _rtSoon('audit', _rtReloadAudit);
}
let _liveFocusHooked = false;
function _hookLiveFocusRefresh() {
  if (_liveFocusHooked) return;
  _liveFocusHooked = true;
  const onBack = () => {
    if (document.visibilityState === 'visible' && Date.now() - _lastLiveSync > 120000) refreshLiveData();
  };
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);
}

function setupRealtimeSync() {
  _hookLiveFocusRefresh();
  let wasSubscribed = false;
  sb.channel('ims-sync')
    // Not published (see above); kept so it works if products is ever added
    // behind a cost-safe mechanism. Coalesced either way.
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => _rtStockMoved())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_adjustments' }, () => { _rtStockMoved(); window.dispatchEvent(new CustomEvent('ims-ledger-change')); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => _rtSoon('orders', _rtReloadOrders))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bundles' }, async () => {
      const fresh = await dbLoadBundles();
      if (fresh) window._DB_BUNDLES = fresh;
      window.dispatchEvent(new CustomEvent('ims-bundles-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bundle_items' }, async () => {
      const fresh = await dbLoadBundles();
      if (fresh) window._DB_BUNDLES = fresh;
      window.dispatchEvent(new CustomEvent('ims-bundles-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'labels' }, async () => {
      const seq = _rtClaim('labels');
      const fresh = await dbLoadLabels();
      if (_rtStale('labels', seq)) return;
      if (fresh) window._DB_LABELS = fresh;
      window.dispatchEvent(new CustomEvent('ims-labels-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, async () => {
      const fresh = await dbLoadStoreSettings();
      if (fresh) window._DB_STORE = fresh;
      window.dispatchEvent(new CustomEvent('ims-store-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'product_locations' }, () => _rtSoon('product_locs', _rtReloadProductLocs))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_log' }, () => _rtSoon('audit', _rtReloadAudit, 900))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, async (payload) => {
      // Shared KV state (categories / locations / stock_adj). Refresh only the
      // changed key and fire its existing change event so listeners re-render.
      const key = (payload && payload.new && payload.new.key) || (payload && payload.old && payload.old.key);
      // Product image rows (key "img:<sku>") — refresh just that one image and
      // fire ims-images-change with a fresh object ref so React re-renders.
      if (key && key.indexOf('img:') === 0) {
        const sku = key.slice(4);
        const v = await dbLoadState(key);
        const next = { ...(window._DB_PRODUCT_IMAGES || {}) };
        if (v == null) delete next[sku]; else next[sku] = v;
        window._DB_PRODUCT_IMAGES = next;
        window.dispatchEvent(new CustomEvent('ims-images-change'));
        return;
      }
      // Location (bin/shelf) photo rows (key "locimg:<code>") — refresh just that
      // one photo and fire ims-location-images-change with a fresh object ref.
      // ('locimg:' does not match the img: check above — it starts with 'l' — so
      // ordering vs that branch doesn't matter.)
      if (key && key.indexOf('locimg:') === 0) {
        const code = key.slice(7);
        const v = await dbLoadState(key);
        const next = { ...(window._DB_LOCATION_IMAGES || {}) };
        if (v == null) delete next[code]; else next[code] = v;
        window._DB_LOCATION_IMAGES = next;
        window.dispatchEvent(new CustomEvent('ims-location-images-change'));
        return;
      }
      // Shared KV state (categories / locations / stock_adj / order_overrides).
      // Refresh only the changed key and fire its existing change event.
      const map = { categories: ['_DB_CATEGORIES', 'ims-categories-change'],
                    locations:  ['_DB_LOCATIONS',  'ims-locations-change'],
                    stock_adj:  ['_DB_STOCK_ADJ',  'ims-stock-adj-change'],
                    woo_catalog: ['_DB_WOO_CATALOG', 'ims-woo-catalog-change'],
                    role_perms: ['_DB_ROLE_PERMS', 'ims-perms-change'],
                    pack_progress: ['_DB_PACK_PROGRESS', 'ims-pack-change'],
                    order_overrides: ['_DB_ORDER_OVERRIDES', 'ims-orders-change'] };
      const keys = key && map[key] ? [key] : Object.keys(map).filter(k => map[k]);
      for (const k of keys) {
        const v = await dbLoadState(k);
        if (v != null) window[map[k][0]] = v;
        // Keep the permission mirror in step with the cloud on every push, so an
        // offline relaunch enforces the CURRENT rules (see dbInit for why).
        if (k === 'role_perms') {
          try {
            if (v == null) localStorage.removeItem('ims_role_perms');
            else localStorage.setItem('ims_role_perms', JSON.stringify(v));
          } catch (e) {}
        }
        window.dispatchEvent(new CustomEvent(map[k][1]));
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[DB] ✓ Real-time sync active');
        // A RE-subscribe means the socket dropped (phone slept, network blip)
        // and events were lost meanwhile — catch up once.
        if (wasSubscribed) refreshLiveData();
        wasSubscribed = true;
      }
    });
}

/* ═══════════════════════════════════════════
   ADMIN USER MANAGEMENT
   Thin client for the manage-users Edge Function. Every call carries the
   caller's access token so the function can verify they're an admin; all the
   privileged work (invite email, role change, suspend, delete) happens
   server-side with the service role.
   ═══════════════════════════════════════════ */
async function manageUsers(action, payload = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/manage-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ action, ...payload }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'เกิดข้อผิดพลาด' };
    return { data: json };
  } catch (e) {
    return { error: e.message };
  }
}

// New employee redeems an admin-issued invite code to create their own account
// (public redeem-invite Edge Function — no session exists yet).
async function redeemInviteCode(payload) {
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/redeem-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'เกิดข้อผิดพลาด' };
    return { data: json };
  } catch (e) {
    return { error: 'เชื่อมต่อไม่ได้ — ตรวจสอบอินเทอร์เน็ต' };
  }
}

// Send a LINE test broadcast via the line-alert Edge Function (admin-only).
// Confirms the LINE Messaging API wiring once LINE_CHANNEL_ACCESS_TOKEN is set.
async function lineTest() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: 'กรุณาเข้าสู่ระบบใหม่' };
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/line-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ mode: 'test' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || json.detail || 'ส่งทดสอบไม่สำเร็จ' };
    return { data: json };
  } catch (e) {
    return { error: e.message };
  }
}

// Trigger the backup-to-drive Edge Function manually (admin-only — the function
// verifies the role server-side). Uploads the JSON snapshot + today's stock
// Excel to Drive, same as the nightly cron. Can take ~10-30s on a big catalog.
async function runCloudBackup() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: 'กรุณาเข้าสู่ระบบใหม่' };
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/backup-to-drive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'สำรองเข้า Drive ไม่สำเร็จ' };
    return { data: json };
  } catch (e) {
    return { error: e.message };
  }
}

// Preview what the LINE chatbot would reply for a command, against real data
// (admin-only). Lets the team test report output without wiring up the webhook.
async function lineBotPreview(command) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { error: 'กรุณาเข้าสู่ระบบใหม่' };
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/line-bot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ mode: 'preview', command }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'ดูตัวอย่างไม่สำเร็จ' };
    return { data: json };
  } catch (e) {
    return { error: e.message };
  }
}

/* ═══════════════════════════════════════════
   INIT — called once on app startup
   Loads all data from Supabase into global
   window._DB_* caches and PRODUCTS array.
   ═══════════════════════════════════════════ */
async function dbInit() {
  try {
    const [products, orders, bundles, labels, storeSettings, auditLog, categories, locations, stockAdj, orderOverrides, wooCatalog, rolePerms, productLocs, packProgress] = await Promise.all([
      dbLoadProducts(),
      dbLoadOrders(),
      dbLoadBundles(),
      dbLoadLabels(),
      dbLoadStoreSettings(),
      dbLoadAuditLog(),
      dbLoadState('categories'),
      dbLoadState('locations'),
      dbLoadState('stock_adj'),
      dbLoadState('order_overrides'),
      dbLoadState('woo_catalog'),
      dbLoadState('role_perms'),
      dbLoadProductLocs(),
      dbLoadState('pack_progress')
    ]);

    /* Hydrate global PRODUCTS array (mutated in-place so existing
       PRODUCTS.find() / PRODUCTS.filter() calls stay valid) */
    if (products) {
      // Same guard as the realtime path: a relaunch must not hide stock writes
      // that are still sitting in the offline queue waiting to sync.
      if (typeof hydrateProductsFromServer === 'function') {
        hydrateProductsFromServer(products, (typeof beginProductsFetch === 'function') ? beginProductsFetch() : null);
      } else {
        PRODUCTS.length = 0;
        products.forEach(p => PRODUCTS.push(p));
      }
    }

    /* Store shared data in window globals so components can read
       after initialization without async calls */
    if (orders)        window._DB_ORDERS    = orders;
    if (bundles)       window._DB_BUNDLES   = bundles;
    if (storeSettings) window._DB_STORE     = storeSettings;
    if (auditLog)      window._DB_AUDIT_LOG = auditLog;
    // A short first page means the whole log fits in it — no "โหลดเพิ่ม" needed.
    if (auditLog && auditLog.length < 500) { window._AUDIT_END = true; window._AUDIT_TOTAL = auditLog.length; }
    if (Array.isArray(categories)) window._DB_CATEGORIES = categories;
    /* Locations is an OBJECT ({ buildings: [...] }) since the Building→Floor→
       Position model replaced the old flat array. The previous Array.isArray
       guard here is a leftover from that array era and silently dropped the
       cloud tree on every boot, so a device with no ims_loc_tree mirror fell
       back to the empty seed and showed no positions at all. Accept whatever
       the cloud has — loadLocTree() already validates the shape and ignores a
       legacy array. (The realtime path never had this bug, which is why the
       tree looked fine on any tab that stayed open.) */
    if (locations != null) window._DB_LOCATIONS = locations;
    if (productLocs && typeof productLocs === 'object') {
      window._DB_PRODUCT_LOCS = productLocs;
      // Mirror so an offline relaunch still knows which shelf holds what.
      try { localStorage.setItem('ims_product_locs', JSON.stringify(productLocs)); } catch (e) {}
      window.dispatchEvent(new CustomEvent('ims-product-locs-change'));
    }
    if (stockAdj && typeof stockAdj === 'object') window._DB_STOCK_ADJ = stockAdj;
    /* In-progress แพ็คสินค้า records (per-order tick-off + wave batches). Mirrored
       locally so a packer who loses signal mid-walk keeps their ticked lines, and
       announced so an already-mounted pack screen picks up another device's work. */
    if (packProgress && typeof packProgress === 'object') {
      window._DB_PACK_PROGRESS = packProgress;
      try { localStorage.setItem('ims_pack_v1', JSON.stringify(packProgress)); } catch (e) {}
      window.dispatchEvent(new CustomEvent('ims-pack-change'));
    }
    if (orderOverrides && typeof orderOverrides === 'object') window._DB_ORDER_OVERRIDES = orderOverrides;
    if (wooCatalog && typeof wooCatalog === 'object') window._DB_WOO_CATALOG = wooCatalog;
    /* Per-role permission overrides (nav + capabilities). Absent = every role
       keeps its built-in defaults, so a fresh install needs no seeding.
       MIRROR IT LOCALLY on every load: saveRolePerms only ever runs on the
       admin's device, so without this a restricted user whose next launch can't
       reach Supabase would fall back to {} — i.e. the permissive built-in
       defaults — instead of the rules the admin set. Fire the change event so
       anything already mounted re-reads the gates. */
    if (rolePerms && typeof rolePerms === 'object') {
      window._DB_ROLE_PERMS = rolePerms;
      try { localStorage.setItem('ims_role_perms', JSON.stringify(rolePerms)); } catch (e) {}
      window.dispatchEvent(new CustomEvent('ims-perms-change'));
    } else if (rolePerms === null) {
      // Cloud says "no overrides" — clear a stale mirror so a reverted setup
      // doesn't keep restricting this device forever.
      try { localStorage.removeItem('ims_role_perms'); } catch (e) {}
    }

    /* One-time seed: if the cloud has no copy yet but this device has local
       data, push it up so categories/locations/stock_adj start syncing. */
    try {
      if (categories == null) {
        const raw = localStorage.getItem('ims_categories');
        const a = raw && JSON.parse(raw);
        if (Array.isArray(a) && a.length) { window._DB_CATEGORIES = a; dbSaveState('categories', a).catch(() => {}); }
      }
      if (locations == null) {
        const raw = localStorage.getItem('ims_locations');
        const a = raw && JSON.parse(raw);
        if (Array.isArray(a) && a.length) { window._DB_LOCATIONS = a; dbSaveState('locations', a).catch(() => {}); }
      }
      if (stockAdj == null) {
        const raw = localStorage.getItem('ims_stock_adj');
        const o = raw && JSON.parse(raw);
        if (o && typeof o === 'object' && Object.keys(o).length) { window._DB_STOCK_ADJ = o; dbSaveState('stock_adj', o).catch(() => {}); }
      }
      if (orderOverrides == null) {
        const raw = localStorage.getItem('ims_orders_overrides');
        const o = raw && JSON.parse(raw);
        if (o && typeof o === 'object' && Object.keys(o).length) { window._DB_ORDER_OVERRIDES = o; dbSaveState('order_overrides', o).catch(() => {}); }
      }
    } catch (e) {}

    /* Product images can be large (per-SKU WebP data-URLs), so load them in the
       BACKGROUND — localStorage serves them instantly on first paint and the
       cloud copy merges in when ready (then ims-images-change re-renders). Seeds
       the cloud from this device's localStorage if the cloud has none yet. */
    dbLoadProductImages().then(imgs => {
      if (!imgs) return;
      if (Object.keys(imgs).length) {
        window._DB_PRODUCT_IMAGES = imgs;
        window.dispatchEvent(new CustomEvent('ims-images-change'));
      } else {
        const raw = localStorage.getItem('ims_product_images');
        const o = raw && JSON.parse(raw);
        if (o && typeof o === 'object' && Object.keys(o).length) {
          window._DB_PRODUCT_IMAGES = o;
          Object.entries(o).forEach(([sku, url]) => { if (url) dbSaveState('img:' + sku, url).catch(() => {}); });
        }
      }
    }).catch(() => {});

    /* Location (bin/shelf) photos — same background-load / seed pattern as
       product images above, just keyed by locCode() instead of SKU. */
    dbLoadLocationImages().then(imgs => {
      if (!imgs) return;
      if (Object.keys(imgs).length) {
        window._DB_LOCATION_IMAGES = imgs;
        window.dispatchEvent(new CustomEvent('ims-location-images-change'));
      } else {
        const raw = localStorage.getItem('ims_location_images');
        const o = raw && JSON.parse(raw);
        if (o && typeof o === 'object' && Object.keys(o).length) {
          window._DB_LOCATION_IMAGES = o;
          Object.entries(o).forEach(([code, url]) => { if (url) dbSaveState('locimg:' + code, url).catch(() => {}); });
        }
      }
    }).catch(() => {});

    /* Sales entered through ปรับสต็อก — background, feeds analytics + channel cards. */
    if (typeof refreshSaleMoves === 'function') refreshSaleMoves();

    /* Labels: reconcile local ↔ cloud. This device may hold labels in
       localStorage that never reached the cloud (created before the table
       existed, or saved while another device owned the cloud copy). Merge by id,
       and for ids present on BOTH sides keep the newer copy by `updatedAt`
       (falling back to created_at) — so a fresh local edit no longer loses to an
       older cloud row. Any local copy that wins (or is cloud-missing) is pushed
       up, so every shipment becomes findable by customers on the public #track page. */
    {
      let local = [];
      try {
        const raw = localStorage.getItem('ims_labels');
        if (raw) { const a = JSON.parse(raw); if (Array.isArray(a)) local = a; }
      } catch (e) {}
      const cloud = Array.isArray(labels) ? labels : [];
      const stamp = (l) => (l && (l.updatedAt || l.created_at)) || '';
      const byId = {};
      cloud.forEach(l => { if (l && l.id != null) byId[l.id] = l; });
      const localWon = [];
      local.forEach(l => {
        if (!l || l.id == null) return;
        const c = byId[l.id];
        if (!c || stamp(l) > stamp(c)) { byId[l.id] = l; localWon.push(l); }
      });
      const merged = Object.values(byId);
      if (localWon.length) {
        await dbUpsertLabels(localWon);
        console.log('[DB] synced', localWon.length, 'newer/local-only labels → cloud');
      }
      window._DB_LABELS = merged;
      try { localStorage.setItem('ims_labels', JSON.stringify(merged)); } catch (e) {}
    }

    setupRealtimeSync();
    console.log('[DB] ✓ Initialized —',
      (products?.length  ?? 0), 'products,',
      (orders?.length    ?? 0), 'orders,',
      (bundles?.length   ?? 0), 'bundles,',
      (labels?.length    ?? 0), 'labels,',
      (auditLog?.length  ?? 0), 'audit entries');
    return true;
  } catch (err) {
    console.error('[DB] init failed:', err);
    return false;
  }
}

/* ── Product-name OCR ── downscale a product photo client-side, then call the
   extract-product Edge Function (Gemini key stays server-side). → { name, code } */
async function _ocrImgToBase64(file, maxDim = 1600, quality = 0.9) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}
async function readProductNameFromImage(file) {
  const base64 = await _ocrImgToBase64(file);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const res = await fetch(SUPABASE_URL + '/functions/v1/extract-product', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({ image_base64: base64, mime_type: 'image/jpeg' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) throw new Error(j.error || ('เกิดข้อผิดพลาด (' + res.status + ')'));
  return { name: String(j.name || '').trim(), code: String(j.code || '').trim() };
}

// Resolve product images from their web pages (the extract-og-image function
// fetches each page server-side and returns its og:image). Pass an array of page
// URLs; returns [{ url, image|null, error? }]. Used to backfill catalog photos for
// products with no image in the CSV. Needs a PUBLIC store URL — localhost/private
// hosts are rejected server-side.
async function resolveWebImages(urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(u => typeof u === 'string' && u.trim());
  if (!list.length) return { results: [] };
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const res = await fetch(SUPABASE_URL + '/functions/v1/extract-og-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({ urls: list }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.success) throw new Error(j.error || ('เกิดข้อผิดพลาด (' + res.status + ')'));
  return { results: Array.isArray(j.results) ? j.results : [], found: j.found || 0 };
}

/* ── Full-data backup ── a raw snapshot of every table, for manual export and
   (server-side) the nightly Google Drive backup. RLS-scoped to the caller. */
const BACKUP_TABLES = ['products', 'orders', 'bundles', 'bundle_items', 'labels', 'store_settings', 'app_state', 'audit_log'];
// Stable sort key per table so paging past PostgREST's 1000-row cap is exact
// (an un-paged select('*') silently returned only the first 1000 rows).
const BACKUP_ORDER = { products: 'sku', orders: 'id', bundles: 'id', bundle_items: 'bundle_id,sku', labels: 'id', store_settings: 'key', app_state: 'key', audit_log: 'id' };
async function buildBackupSnapshot() {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    try {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        let q = sb.from(t).select('*');
        (BACKUP_ORDER[t] || '').split(',').filter(Boolean).forEach(c => { q = q.order(c); });
        const { data, error } = await q.range(from, from + 999);
        if (error || !data) break;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      tables[t] = rows;
    } catch (e) { tables[t] = []; }
  }
  return {
    app: 'PS TACTICAL — คลังพร้อมส่ง (IMS)',
    kind: 'ims-backup', version: 1,
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries(BACKUP_TABLES.map(t => [t, (tables[t] || []).length])),
    tables,
  };
}
async function downloadBackup() {
  const snap = await buildBackupSnapshot();
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
  a.href = url; a.download = `ims-backup-${stamp}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return snap.counts;
}

Object.assign(window, {
  sb, readProductNameFromImage, resolveWebImages, buildBackupSnapshot, downloadBackup,
  dbInit, setupRealtimeSync, refreshLiveData,
  dbLoadProducts,      dbUpsertProducts,     dbDeleteProducts,    dbDeductStock,
  dbUpdateProduct,     dbUpdateProducts,     dbAdjustStock,     dbRenameSku,
  dbInsertStockAdjustment, dbLoadStockAdjustments, dbLoadSaleAdjustments,
  dbLoadProductLocs,   dbSaveProductLocs,
  dbLoadOrders,        dbUpsertOrders,       dbDeleteOrder,
  dbLoadBundles,       dbUpsertBundles,      dbDeleteBundle,
  dbLoadLabels,        dbUpsertLabels,       dbDeleteLabel,
  dbLoadStoreSettings, dbSaveStoreSettings,
  dbLoadState,         dbSaveState,          dbLoadProductImages,  dbLoadLocationImages,
  dbServerTimeMs,
  dbInsertAuditEntry,  dbLoadAuditLog,    dbDeleteAuditLog,  dbLoadAuditDay,  dbCountAuditLog,
  manageUsers,         redeemInviteCode,    lineTest,           lineBotPreview,      runCloudBackup,
  // Auth helpers — thin wrappers so auth.jsx / app.jsx never import sb directly
  authSignIn:        (email, password) => sb.auth.signInWithPassword({ email, password }),
  // scope:'local' clears only this device's persisted session (used by the
  // mid-session force-out so an OFFLINE kick still lands on a clean login
  // screen); no arg = default global scope (used by the deliberate logout
  // button so it revokes the refresh token server-side on shared devices).
  authSignOut:       (scope)           => sb.auth.signOut(scope ? { scope } : undefined),
  authResetPassword: (email)           => sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
  authUpdatePassword:(password)        => sb.auth.updateUser({ password }),
  // Consume a token_hash carried by a recovery/invite email link. Newer Supabase
  // email templates send ?token_hash=…&type=recovery instead of the implicit
  // #access_token hash, and supabase-js does NOT auto-consume token_hash — we
  // must verifyOtp here to establish the temporary session BEFORE the user can
  // set a new password (otherwise authUpdatePassword fails "Auth session missing").
  authVerifyOtp:     (params)          => sb.auth.verifyOtp(params),
  authGetSession:    ()                => sb.auth.getSession(),
  // Re-validates the current access token against GoTrue. A suspended (banned)
  // user is rejected here (403) even while their cached JWT is still unexpired —
  // this is how we enforce a mid-session lockout. Pass a token to validate it
  // explicitly; with no args it uses the stored session.
  authGetUser:       ()                => sb.auth.getUser(),
  // Force a token refresh using the stored refresh token. Used to recover a
  // session whose access token merely expired (e.g. tab was backgrounded) before
  // deciding it's really dead — so users aren't bounced to login needlessly.
  authRefresh:       ()                => sb.auth.refreshSession(),
  // The role claim RLS actually enforces: app_metadata.role inside the CURRENT
  // access token. A role changed in the DB does not reach RLS until the token is
  // re-minted (refresh or re-login), so this can lag both the DB and the UI role.
  authTokenRole: async () => {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session || !session.access_token) return null;
      const b64 = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(b64));
      return (payload.app_metadata && payload.app_metadata.role) || null;
    } catch (e) { return null; }
  },
  authOnChange:      (cb)              => sb.auth.onAuthStateChange(cb),
  // Base URL for Edge Functions
  SUPABASE_FUNC_URL: SUPABASE_URL + '/functions/v1',
});
