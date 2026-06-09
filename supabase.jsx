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
async function dbLoadProducts() {
  const { data, error } = await sb.from('products').select('*').order('sku');
  if (error) { console.error('[DB] load products:', error.message); return null; }
  return data;
}
async function dbUpsertProducts(products) {
  if (!products || !products.length) return { ok: true };
  const rows = products.map(({ sku, name, cat, cost, price, qty, reserved, reorder, loc, supplier, brand }) => ({
    sku, name, cat,
    cost:     Number(cost)     || 0,
    price:    Number(price)    || 0,
    qty:      Number(qty)      || 0,
    reserved: Number(reserved) || 0,
    reorder:  Number(reorder)  || 0,
    loc:      loc      || '-',
    supplier: supplier || 'ไม่ระบุ',
    brand:    brand    || '',
    updated_at: new Date().toISOString()
  }));
  // .select() detects an RLS-blocked write (0 rows, no error) — e.g. a viewer
  // editing a product they have no permission to persist.
  const { data, error } = await sb.from('products').upsert(rows).select('sku');
  if (error) { console.error('[DB] upsert products:', error.message); return { error: error.message }; }
  if (!data || data.length < rows.length) {
    console.error('[DB] upsert products blocked (RLS): persisted', (data ? data.length : 0), 'of', rows.length);
    return { error: 'PERMISSION_OR_MISSING' };
  }
  return { ok: true };
}
async function dbDeleteProducts(skus) {
  if (!skus) return { ok: true, deleted: 0 };
  const arr = Array.isArray(skus) ? skus : [...skus];
  if (!arr.length) return { ok: true, deleted: 0 };
  // .select() returns the rows actually deleted. Under RLS, a DELETE the caller
  // isn't allowed to perform succeeds with 0 rows and NO error — so we must
  // compare the deleted count to detect a silently-blocked delete.
  const { data, error } = await sb.from('products').delete().in('sku', arr).select('sku');
  if (error) { console.error('[DB] delete products:', error.message); return { error: error.message, deleted: 0 }; }
  const deleted = data ? data.length : 0;
  if (deleted < arr.length) {
    console.error('[DB] delete products: only', deleted, 'of', arr.length, 'rows deleted (RLS or already gone)');
    return { error: 'PERMISSION_OR_MISSING', deleted };
  }
  return { ok: true, deleted };
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
  const dateIso = row.date_iso || row.created_at?.slice(0, 10) || '';
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
  if (!orders || !orders.length) return;
  const { error } = await sb.from('orders').upsert(orders.map(_orderToRow));
  if (error) console.error('[DB] upsert orders:', error.message);
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
  if (!labels || !labels.length) return;
  const rows = labels.map(l => ({ id: l.id, so_id: l.soId || '', data: l }));
  const { error } = await sb.from('labels').upsert(rows);
  if (error) console.error('[DB] upsert labels:', error.message);
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
  const { data, error } = await sb.from('app_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }).select('key');
  if (error) { console.error('[DB] save app_state', key, ':', error.message); return { error: error.message }; }
  if (!data || !data.length) return { error: 'PERMISSION_OR_MISSING' };
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
    const { data, error } = await sb.rpc('server_now');
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

/* ═══════════════════════════════════════════
   AUDIT LOG
   ═══════════════════════════════════════════ */
async function dbInsertAuditEntry(entry) {
  const { error } = await sb.from('audit_log').insert({
    entity:    entry.entity    || '',
    entity_id: entry.entityId  || '',
    action:    entry.action    || '',
    summary:   entry.summary   || '',
    note:      entry.note      || '',
    user_name: entry.user?.name || 'ระบบ'
  });
  if (error) console.error('[DB] insert audit_log:', error.message);
}
async function dbLoadAuditLog(limit = 500) {
  const { data, error } = await sb
    .from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) { console.error('[DB] load audit_log:', error.message); return null; }
  return data.map(row => ({
    id:       String(row.id),
    ts:       row.created_at,
    user:     { name: row.user_name || 'ระบบ', role: '', avatar: (row.user_name || '?')[0], id: 0 },
    entity:   row.entity,
    entityId: row.entity_id,
    action:   row.action,
    summary:  row.summary,
    note:     row.note
  }));
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
function setupRealtimeSync() {
  sb.channel('ims-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
      const fresh = await dbLoadProducts();
      if (fresh) { PRODUCTS.length = 0; fresh.forEach(p => PRODUCTS.push(p)); }
      window.dispatchEvent(new CustomEvent('ims-products-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
      const fresh = await dbLoadOrders();
      if (fresh) window._DB_ORDERS = fresh;
      window.dispatchEvent(new CustomEvent('ims-orders-change'));
    })
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
      const fresh = await dbLoadLabels();
      if (fresh) window._DB_LABELS = fresh;
      window.dispatchEvent(new CustomEvent('ims-labels-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, async () => {
      const fresh = await dbLoadStoreSettings();
      if (fresh) window._DB_STORE = fresh;
      window.dispatchEvent(new CustomEvent('ims-store-change'));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_log' }, async () => {
      const fresh = await dbLoadAuditLog();
      if (fresh) window._DB_AUDIT_LOG = fresh;
      window.dispatchEvent(new CustomEvent('ims-audit-change'));
    })
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
      // Shared KV state (categories / locations / stock_adj / order_overrides).
      // Refresh only the changed key and fire its existing change event.
      const map = { categories: ['_DB_CATEGORIES', 'ims-categories-change'],
                    locations:  ['_DB_LOCATIONS',  'ims-locations-change'],
                    stock_adj:  ['_DB_STOCK_ADJ',  'ims-stock-adj-change'],
                    woo_catalog: ['_DB_WOO_CATALOG', 'ims-woo-catalog-change'],
                    order_overrides: ['_DB_ORDER_OVERRIDES', 'ims-orders-change'] };
      const keys = key && map[key] ? [key] : Object.keys(map).filter(k => map[k]);
      for (const k of keys) {
        const v = await dbLoadState(k);
        if (v != null) window[map[k][0]] = v;
        window.dispatchEvent(new CustomEvent(map[k][1]));
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[DB] ✓ Real-time sync active');
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
    const [products, orders, bundles, labels, storeSettings, auditLog, categories, locations, stockAdj, orderOverrides, wooCatalog] = await Promise.all([
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
      dbLoadState('woo_catalog')
    ]);

    /* Hydrate global PRODUCTS array (mutated in-place so existing
       PRODUCTS.find() / PRODUCTS.filter() calls stay valid) */
    if (products) {
      PRODUCTS.length = 0;
      products.forEach(p => PRODUCTS.push(p));
    }

    /* Store shared data in window globals so components can read
       after initialization without async calls */
    if (orders)        window._DB_ORDERS    = orders;
    if (bundles)       window._DB_BUNDLES   = bundles;
    if (storeSettings) window._DB_STORE     = storeSettings;
    if (auditLog)      window._DB_AUDIT_LOG = auditLog;
    if (Array.isArray(categories)) window._DB_CATEGORIES = categories;
    if (Array.isArray(locations))  window._DB_LOCATIONS  = locations;
    if (stockAdj && typeof stockAdj === 'object') window._DB_STOCK_ADJ = stockAdj;
    if (orderOverrides && typeof orderOverrides === 'object') window._DB_ORDER_OVERRIDES = orderOverrides;
    if (wooCatalog && typeof wooCatalog === 'object') window._DB_WOO_CATALOG = wooCatalog;

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
async function buildBackupSnapshot() {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    try {
      const { data, error } = await sb.from(t).select('*');
      tables[t] = (error || !data) ? [] : data;
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
  dbInit, setupRealtimeSync,
  dbLoadProducts,      dbUpsertProducts,     dbDeleteProducts,
  dbLoadOrders,        dbUpsertOrders,       dbDeleteOrder,
  dbLoadBundles,       dbUpsertBundles,      dbDeleteBundle,
  dbLoadLabels,        dbUpsertLabels,       dbDeleteLabel,
  dbLoadStoreSettings, dbSaveStoreSettings,
  dbLoadState,         dbSaveState,          dbLoadProductImages,
  dbServerTimeMs,
  dbInsertAuditEntry,  dbLoadAuditLog,    dbDeleteAuditLog,
  manageUsers,         lineTest,           lineBotPreview,
  // Auth helpers — thin wrappers so auth.jsx / app.jsx never import sb directly
  authSignIn:        (email, password) => sb.auth.signInWithPassword({ email, password }),
  authSignOut:       ()                => sb.auth.signOut(),
  authResetPassword: (email)           => sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
  authUpdatePassword:(password)        => sb.auth.updateUser({ password }),
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
  authOnChange:      (cb)              => sb.auth.onAuthStateChange(cb),
  // Base URL for Edge Functions
  SUPABASE_FUNC_URL: SUPABASE_URL + '/functions/v1',
});
