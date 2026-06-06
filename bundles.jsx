/* Bundle management — create bundles from inventory items; selling deducts each component from shared stock */

const { useState: useBndState, useEffect: useBndEffect, useRef: useBndRef, useMemo: useBndMemo } = React;

/* ── stock adjustment layer ── */
function getStockAdj() {
  // Cloud copy (synced via app_state) wins so concurrent sellers see the same
  // effective stock; fall back to localStorage when offline / pre-hydration.
  if (window._DB_STOCK_ADJ && typeof window._DB_STOCK_ADJ === "object") return window._DB_STOCK_ADJ;
  try { return JSON.parse(localStorage.getItem("ims_stock_adj") || "{}"); } catch { return {}; }
}
function applyStockAdj(adj) {
  try { localStorage.setItem("ims_stock_adj", JSON.stringify(adj)); } catch {}
  window._DB_STOCK_ADJ = adj;
  window.dispatchEvent(new CustomEvent("ims-stock-adj-change"));
  if (window.dbSaveState) dbSaveState("stock_adj", adj).catch(() => {});
}
function getEffectiveQty(sku) {
  const base = PRODUCTS.find(p => p.sku === sku)?.qty ?? 0;
  const adj  = getStockAdj()[sku] ?? 0;
  return Math.max(0, base + adj);
}

/* ── bundle storage ── */
const DEFAULT_BUNDLES = [];

function loadBundles() {
  if (window._DB_BUNDLES) return window._DB_BUNDLES;
  try {
    const raw = localStorage.getItem("ims_bundles");
    return raw ? JSON.parse(raw) : DEFAULT_BUNDLES;
  } catch { return DEFAULT_BUNDLES; }
}
async function saveBundles(bundles) {
  const prev = window._DB_BUNDLES;
  // Optimistic local update (instant UI)
  try { localStorage.setItem("ims_bundles", JSON.stringify(bundles)); } catch {}
  window._DB_BUNDLES = bundles;
  window.dispatchEvent(new CustomEvent("ims-bundles-change"));

  // Persist: delete removed bundles, then upsert the rest. Check each result so
  // an RLS-blocked write (staff/viewer) doesn't silently revert on next sync.
  let err = null;
  if (prev && window.dbDeleteBundle) {
    const newIds = new Set(bundles.map(b => b.id));
    for (const b of prev.filter(b => !newIds.has(b.id))) {
      const r = await dbDeleteBundle(b.id);
      if (r && r.error) err = r.error;
    }
  }
  if (!err && window.dbUpsertBundles && bundles.length) {
    const r = await dbUpsertBundles(bundles);
    if (r && r.error) err = r.error;
  }

  if (err) {
    // Roll back to canonical server state so the UI doesn't lie.
    if (window.dbLoadBundles) {
      const fresh = await dbLoadBundles();
      if (fresh) { window._DB_BUNDLES = fresh; try { localStorage.setItem("ims_bundles", JSON.stringify(fresh)); } catch {} }
    }
    window.dispatchEvent(new CustomEvent("ims-bundles-change"));
    return { ok: false, error: err === 'PERMISSION_OR_MISSING'
      ? 'ไม่มีสิทธิ์แก้ไข/ลบชุดสินค้า (ต้องเป็นผู้ดูแลระบบหรือผู้จัดการ)'
      : 'บันทึกชุดสินค้าไม่สำเร็จ: ' + err };
  }
  return { ok: true };
}

/* ── helpers ── */
function bundleAvail(bundle) {
  if (!bundle.items.length) return 0;
  return bundle.items.reduce((min, item) => {
    const avail = Math.floor(getEffectiveQty(item.sku) / item.qty);
    return Math.min(min, avail);
  }, Infinity);
}
function bundleStatus(avail) {
  if (avail <= 0) return { key: "out", label: "หมดสต็อก",      cls: "badge-danger" };
  if (avail <= 5) return { key: "low", label: "เหลือน้อย",      cls: "badge-warning" };
  return             { key: "ok",  label: "พร้อมขาย",           cls: "badge-success" };
}
function calcBundleCost(bundle) {
  return bundle.items.reduce((s, item) => {
    const p = PRODUCTS.find(x => x.sku === item.sku);
    return s + (p ? p.cost * item.qty : 0);
  }, 0);
}
function calcBundleRetail(bundle) {
  return bundle.items.reduce((s, item) => {
    const p = PRODUCTS.find(x => x.sku === item.sku);
    return s + (p ? p.price * item.qty : 0);
  }, 0);
}
function newBundleId(bundles) {
  const nums = bundles.map(b => parseInt(b.id.replace("BND-", "")) || 0);
  return "BND-" + String((Math.max(0, ...nums) + 1)).padStart(3, "0");
}

/* ── inventory sync verification ── */
// Items in a bundle whose SKU no longer maps to a real inventory product
function bundleLinkErrors(bundle) {
  return bundle.items.filter(item => !PRODUCTS.some(p => p.sku === item.sku));
}
// Components that are out of stock or short for the requested number of sets
function bundleStockIssues(bundle, sets = 1) {
  const n = Math.max(1, sets);
  return bundle.items.map(item => {
    const p = PRODUCTS.find(x => x.sku === item.sku);
    const have = getEffectiveQty(item.sku);
    const need = item.qty * n;
    return {
      sku: item.sku, name: p ? p.name : item.sku,
      missing: !p, have, need, perSet: item.qty,
      out: have <= 0, short: have < need
    };
  }).filter(x => x.missing || x.out || x.short);
}

/* ──────────────────────────────────────
   STOCK WARNING BANNER (out-of-stock alert)
────────────────────────────────────── */
function BundleStockAlert({ issues, title }) {
  if (!issues || !issues.length) return null;
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", marginBottom: 12, fontSize: 12 }}>
      <div className="row" style={{ gap: 6, fontWeight: 600, marginBottom: 6 }}>
        <Icons.Warn size={14}/> {title || "สต็อกไม่พอ — ตรวจสอบสินค้าคงคลังทันที"}
      </div>
      <div className="stack" style={{ gap: 3 }}>
        {issues.map(x => (
          <div key={x.sku} className="row" style={{ gap: 8, justifyContent: "space-between" }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span className="mono" style={{ opacity: 0.7, marginRight: 4 }}>{x.sku}</span>{x.name}
            </span>
            <span style={{ flexShrink: 0, fontWeight: 500 }}>
              {x.missing ? "ไม่พบใน SKU คลัง" : x.out ? "หมดสต็อก" : `เหลือ ${x.have} · ต้องใช้ ${x.need}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   SELL CONFIRMATION MODAL
────────────────────────────────────── */
function SellConfirmModal({ bundle, qty, channels, onConfirm, onCancel }) {
  const totalItems = bundle.items.map(item => {
    const p = PRODUCTS.find(x => x.sku === item.sku);
    return { ...item, name: p?.name || item.sku, deduct: item.qty * qty };
  });
  return (
    <>
      <div className="drawer-backdrop" onClick={onCancel} style={{ zIndex: 80 }}/>
      <div className="modal" style={{ zIndex: 81, maxWidth: 440 }}>
        <div className="modal-head">
          <div>
            <h3>ยืนยันการขายชุดสินค้า</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>การเปลี่ยนแปลงนี้จะถูกบันทึกในประวัติ</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onCancel}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>ชุดสินค้า</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{bundle.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>จำนวน: <strong style={{ color: "var(--fg)" }}>{qty} ชุด</strong> · ราคา ฿{(bundle.price * qty).toLocaleString()}</div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500, marginBottom: 8 }}>สินค้าที่จะถูกตัดสต็อก</div>
            <div className="stack" style={{ gap: 6 }}>
              {totalItems.map(item => {
                const after = getEffectiveQty(item.sku) - item.deduct;
                return (
                  <div key={item.sku} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div className="row" style={{ gap: 4, marginTop: 2 }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{item.sku}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        <span className="tnum">{getEffectiveQty(item.sku)}</span>
                        {" → "}
                        <strong style={{ color: after < 0 ? "var(--danger)" : "var(--fg)" }} className="tnum">{Math.max(0, after)}</strong>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 1 }}>−{item.deduct} ชิ้น</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {channels && channels.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500, marginBottom: 6 }}>ช่องทางการขาย</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {channels.map(c => (
                  <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/>
                    {c.name}: {c.qty} ชุด
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: "12px 20px 18px", display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onCancel}>ยกเลิก</button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={onConfirm}>
            <Icons.Check size={14}/> ยืนยันตัดสต็อก
          </button>
        </div>
      </div>
    </>
  );
}

/* ──────────────────────────────────────
   BUNDLE FORM MODAL (create / edit)
────────────────────────────────────── */
function BundleFormModal({ initial, onSave, onClose }) {
  const isEdit = !!initial;
  const [name, setName]  = useBndState(initial?.name || "");
  const [desc, setDesc]  = useBndState(initial?.desc || "");
  const [price, setPrice] = useBndState(initial?.price ?? "");
  const [items, setItems] = useBndState(
    initial?.items?.length ? [...initial.items] : [{ sku: PRODUCTS[0].sku, qty: 1 }]
  );

  const addItem = () => setItems(prev => [...prev, { sku: PRODUCTS[0].sku, qty: 1 }]);
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i, field, val) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it));

  const usedSkus = items.map(it => it.sku);
  const canSave = name.trim() && items.length > 0 && items.every(it => it.qty > 0) && Number(price) > 0;

  const retailTotal = items.reduce((s, it) => {
    const p = PRODUCTS.find(x => x.sku === it.sku);
    return s + (p ? p.price * it.qty : 0);
  }, 0);
  const discount = retailTotal > 0 ? Math.round((1 - Number(price) / retailTotal) * 100) : 0;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 70 }}/>
      <div className="modal" style={{ zIndex: 71, maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>{isEdit ? "แก้ไขชุดสินค้า" : "สร้างชุดสินค้าใหม่"}</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>เพิ่มสินค้าจากคลังและกำหนดราคาชุด</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Name */}
          <div className="field">
            <label>ชื่อชุดสินค้า <span style={{ color: "var(--danger)" }}>*</span></label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น ชุดสกินแคร์ยอดนิยม"/>
          </div>
          {/* Desc */}
          <div className="field">
            <label>คำอธิบาย</label>
            <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="อธิบายสั้นๆ เกี่ยวกับชุดนี้"/>
          </div>

          {/* Items */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", marginBottom: 8 }}>
              สินค้าในชุด <span style={{ color: "var(--muted)", fontWeight: 400 }}>({items.length} รายการ)</span>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {items.map((item, i) => {
                const product = PRODUCTS.find(p => p.sku === item.sku);
                const effQty = getEffectiveQty(item.sku);
                return (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--surface-2)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <select
                        className="input"
                        style={{ marginBottom: 6, fontSize: 12 }}
                        value={item.sku}
                        onChange={e => updateItem(i, "sku", e.target.value)}
                      >
                        {PRODUCTS.map(p => (
                          <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>
                        ))}
                      </select>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>คงเหลือ <strong className="tnum" style={{ color: effQty === 0 ? "var(--danger)" : "var(--fg)" }}>{effQty}</strong> ชิ้น</span>
                        {product && <span style={{ fontSize: 11, color: "var(--muted)" }}>·  ฿{product.price.toLocaleString()} / ชิ้น</span>}
                      </div>
                    </div>
                    <div className="qty-stepper" style={{ flexShrink: 0 }}>
                      <button onClick={() => updateItem(i, "qty", Math.max(1, item.qty - 1))}>−</button>
                      <input
                        value={item.qty}
                        onChange={e => updateItem(i, "qty", Math.max(1, parseInt(e.target.value) || 1))}
                        style={{ width: 36 }}
                      />
                      <button onClick={() => updateItem(i, "qty", item.qty + 1)}>+</button>
                    </div>
                    <button
                      className="btn btn-ghost btn-icon"
                      style={{ flexShrink: 0, color: "var(--danger)" }}
                      onClick={() => removeItem(i)}
                      disabled={items.length === 1}
                    >
                      <Icons.Trash size={14}/>
                    </button>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-ghost" style={{ marginTop: 8, width: "100%", justifyContent: "center" }} onClick={addItem}>
              <Icons.Plus size={14}/> เพิ่มสินค้าในชุด
            </button>
          </div>

          {/* Price */}
          <div className="field">
            <label>ราคาขายชุด (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
            <input
              className="input"
              type="number"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="เช่น 1180"
            />
            {retailTotal > 0 && Number(price) > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                ราคาปกติรวม ฿{retailTotal.toLocaleString()}
                {discount > 0
                  ? <span style={{ color: "var(--success)", marginLeft: 6 }}>ลด {discount}% จากราคาแยกชิ้น</span>
                  : <span style={{ color: "var(--warning)", marginLeft: 6 }}>สูงกว่าราคาแยกชิ้น</span>
                }
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 20px 18px", display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>ยกเลิก</button>
          <button
            className="btn btn-primary"
            style={{ flex: 2, ...(canSave ? {} : { opacity: 0.5, cursor: "not-allowed" }) }}
            disabled={!canSave}
            onClick={() => canSave && onSave({ name: name.trim(), desc: desc.trim(), price: Number(price), items })}
          >
            <Icons.Check size={14}/> {isEdit ? "บันทึกการแก้ไข" : "สร้างชุดสินค้า"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ──────────────────────────────────────
   BUNDLE DETAIL DRAWER
────────────────────────────────────── */
function BundleDrawer({ bundle, onClose, onEdit, onDelete, onSell, pushToast }) {
  const [qty, setQty] = useBndState(1);
  const [channels, setChannels] = useBndState(() =>
    Object.fromEntries(CHANNEL_LIST.map(c => [c.id, { on: c.id === "shopee", qty: c.id === "shopee" ? 1 : 0 }]))
  );
  const [showConfirm, setShowConfirm] = useBndState(false);
  const [stockKey, setStockKey] = useBndState(0);

  useBndEffect(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change",  refresh);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change",  refresh);
    };
  }, []);

  const avail = useBndMemo(() => bundleAvail(bundle), [bundle, stockKey]);
  const status = bundleStatus(avail);
  const linkErrors = useBndMemo(() => bundleLinkErrors(bundle), [bundle, stockKey]);
  const cost = calcBundleCost(bundle);
  const retail = calcBundleRetail(bundle);
  const margin = bundle.price > 0 ? Math.round((1 - cost / bundle.price) * 100) : 0;

  const totalChannelQty = Object.values(channels).reduce((s, c) => s + (c.on ? c.qty : 0), 0);
  const sellQty = totalChannelQty > 0 ? totalChannelQty : qty;
  const overStock = sellQty > avail;
  const stockIssues = bundleStockIssues(bundle, sellQty);

  const toggleCh = (id) => setChannels(c => ({ ...c, [id]: { ...c[id], on: !c[id].on, qty: !c[id].on && c[id].qty === 0 ? 1 : c[id].qty } }));
  const setChQty = (id, q) => setChannels(c => ({ ...c, [id]: { ...c[id], qty: Math.max(0, q), on: q > 0 ? true : c[id].on } }));

  const selectedChannels = CHANNEL_LIST.filter(c => channels[c.id].on && channels[c.id].qty > 0)
    .map(c => ({ ...c, qty: channels[c.id].qty }));

  const confirmSell = () => {
    deductManyAndPersist(bundle.items.map(item => ({ sku: item.sku, qty: item.qty * sellQty })));
    if (typeof recordChange === "function") {
      recordChange({
        entity: "bundle",
        entityId: bundle.id,
        action: "update",
        summary: `ขาย "${bundle.name}" ${sellQty} ชุด`,
        diffs: bundle.items.map(item => ({
          field: item.sku,
          before: getEffectiveQty(item.sku) + item.qty * sellQty,
          after: getEffectiveQty(item.sku)
        }))
      });
    }
    setShowConfirm(false);
    pushToast(`ตัดสต็อกชุด "${bundle.name}" ${sellQty} ชุดสำเร็จ`);
    setStockKey(k => k + 1);
    setQty(1);
    setChannels(Object.fromEntries(CHANNEL_LIST.map(c => [c.id, { on: c.id === "shopee", qty: c.id === "shopee" ? 1 : 0 }])));
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>{bundle.id}</div>
            <h3 style={{ margin: 0 }}>{bundle.name}</h3>
            {bundle.desc && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{bundle.desc}</div>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-icon" onClick={onEdit} title="แก้ไขชุดสินค้า"><Icons.Edit size={15}/></button>
            <button className="btn btn-ghost btn-icon" style={{ color: "var(--danger)" }} onClick={onDelete} title="ลบชุดสินค้า"><Icons.Trash size={15}/></button>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
          </div>
        </div>

        <div className="drawer-body">
          {linkErrors.length > 0 && (
            <BundleStockAlert
              title="ลิงก์สินค้าผิดพลาด — สินค้าในชุดนี้ไม่ตรงกับ SKU ในคลัง"
              issues={linkErrors.map(it => ({ sku: it.sku, name: it.sku, missing: true }))}
            />
          )}

          {/* Status + pricing */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 18 }}>
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>พร้อมขาย</div>
              <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: avail === 0 ? "var(--danger)" : "var(--fg)" }}>{avail}</div>
              <div style={{ marginTop: 4 }}><span className={"badge " + status.cls}><span className="dot"/>{status.label}</span></div>
            </div>
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>ราคาขายชุด</div>
              <div className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>฿{bundle.price.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>ปกติ ฿{retail.toLocaleString()}</div>
            </div>
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>กำไรต่อชุด</div>
              <div className="tnum" style={{ fontSize: 18, fontWeight: 700, color: "var(--success)" }}>฿{(bundle.price - cost).toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>มาร์จิ้น {margin}%</div>
            </div>
          </div>

          {/* Component items */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", marginBottom: 10 }}>สินค้าในชุด ({bundle.items.length} รายการ)</div>
            <div className="stack" style={{ gap: 8 }}>
              {bundle.items.map(item => {
                const p = PRODUCTS.find(x => x.sku === item.sku);
                const effQty = getEffectiveQty(item.sku);
                const maxSets = Math.floor(effQty / item.qty);
                const s = stockStatus(p || { qty: effQty, reorder: p?.reorder || 0 });
                const img = (typeof getProductImage === "function") ? getProductImage(item.sku) : null;
                return (
                  <div key={item.sku} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
                    {img
                      ? <img src={img} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}/>
                      : <div className="sku-thumb mono" style={{ width: 40, height: 40, borderRadius: 8, background: "var(--surface-3)", display: "grid", placeItems: "center", fontSize: 10, flexShrink: 0 }}>{item.sku.slice(-3)}</div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p?.name || item.sku}</div>
                      <div className="row" style={{ gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{item.sku}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>· ใช้ {item.qty} ชิ้น/ชุด</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div className="tnum" style={{ fontSize: 14, fontWeight: 600, color: effQty === 0 ? "var(--danger)" : "var(--fg)" }}>{effQty}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>ชุดได้ {maxSets}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Sell section */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", background: "var(--surface-2)" }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>ขายชุดสินค้า</div>

            <BundleStockAlert issues={stockIssues}/>

            {avail === 0 ? (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                <Icons.Warn size={16} style={{ marginBottom: 6, opacity: 0.5 }}/>
                <div>สต็อกไม่พอสำหรับชุดนี้</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500, marginBottom: 8 }}>ช่องทางการขาย</div>
                <div className="stack" style={{ gap: 6, marginBottom: 14 }}>
                  {CHANNEL_LIST.map(c => {
                    const v = channels[c.id];
                    return (
                      <div key={c.id} className={"ch-row" + (v.on ? " on" : "")} style={{ borderRadius: 8, padding: "8px 10px" }}>
                        <span className={"check" + (v.on ? " on" : "")} onClick={() => toggleCh(c.id)}/>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color }}/>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: v.on ? 500 : 400, color: v.on ? "var(--fg)" : "var(--fg-2)" }}>{c.name}</span>
                        <div className="qty-stepper" style={{ opacity: v.on ? 1 : 0.4 }}>
                          <button onClick={() => setChQty(c.id, v.qty - 1)} disabled={v.qty <= 0}>−</button>
                          <input value={v.qty} onChange={e => setChQty(c.id, parseInt(e.target.value) || 0)} style={{ width: 36 }}/>
                          <button onClick={() => setChQty(c.id, v.qty + 1)}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--surface-3)", borderRadius: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>รวมตัดสต็อก</span>
                  <strong className="tnum" style={{ fontSize: 16 }}>{sellQty} ชุด</strong>
                </div>

                {overStock && (
                  <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12, marginBottom: 10, display: "flex", gap: 6, alignItems: "center" }}>
                    <Icons.Warn size={14}/>
                    สต็อกไม่พอ (มีแค่ {avail} ชุด)
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: "100%", justifyContent: "center", ...(sellQty === 0 || overStock ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                  disabled={sellQty === 0 || overStock}
                  onClick={() => setShowConfirm(true)}
                >
                  <Icons.Out size={14}/> ยืนยันขาย {sellQty} ชุด · ฿{(bundle.price * sellQty).toLocaleString()}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {showConfirm && (
        <SellConfirmModal
          bundle={bundle}
          qty={sellQty}
          channels={selectedChannels}
          onConfirm={confirmSell}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

/* ──────────────────────────────────────
   BUNDLES PAGE
────────────────────────────────────── */
function BundlePage({ pushToast }) {
  const [bundles, setBundlesRaw] = useBndState(loadBundles);
  const [q, setQ] = useBndState("");
  const [activeId, setActiveId] = useBndState(null);
  const [formBundle, setFormBundle] = useBndState(null); // null=closed, false=new, obj=edit
  const [stockKey, setStockKey] = useBndState(0);

  useBndEffect(() => {
    const refresh = () => setStockKey(k => k + 1);
    // Also reload bundle list from DB cache when a remote change arrives
    const reloadBundles = () => {
      setStockKey(k => k + 1);
      if (window._DB_BUNDLES) setBundlesRaw(window._DB_BUNDLES);
    };
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change",  refresh);
    window.addEventListener("ims-bundles-change",   reloadBundles);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change",  refresh);
      window.removeEventListener("ims-bundles-change",   reloadBundles);
    };
  }, []);

  const setBundles = (next) => { setBundlesRaw(next); return saveBundles(next); };

  const filtered = useBndMemo(() => {
    const lq = q.toLowerCase();
    return bundles.filter(b =>
      !lq || b.name.toLowerCase().includes(lq) || b.desc.toLowerCase().includes(lq) ||
      b.items.some(it => it.sku.toLowerCase().includes(lq))
    );
  }, [bundles, q]);

  const activeBundle = bundles.find(b => b.id === activeId) || null;

  const handleCreate = async (data) => {
    const nb = { id: newBundleId(bundles), ...data, createdAt: new Date().toISOString().slice(0, 10) };
    setFormBundle(null);
    const res = await setBundles([...bundles, nb]);
    if (res && res.ok === false) { pushToast(res.error); return; }
    pushToast("สร้างชุดสินค้า \"" + nb.name + "\" สำเร็จ");
  };
  const handleEdit = async (data) => {
    const id = formBundle.id;
    setFormBundle(null);
    const res = await setBundles(bundles.map(b => b.id === id ? { ...b, ...data } : b));
    if (res && res.ok === false) { pushToast(res.error); return; }
    pushToast("บันทึกการแก้ไขชุดสินค้าสำเร็จ");
  };
  const handleDelete = async (id) => {
    if (!confirm("ลบชุดสินค้านี้?")) return;
    if (activeId === id) setActiveId(null);
    const res = await setBundles(bundles.filter(b => b.id !== id));
    if (res && res.ok === false) { pushToast(res.error); return; }
    pushToast("ลบชุดสินค้าสำเร็จ");
  };

  // KPI summary
  const totalBundles = bundles.length;
  const availableBundles = bundles.filter(b => bundleAvail(b) > 0).length;
  const totalRevenuePotential = bundles.reduce((s, b) => s + b.price * bundleAvail(b), 0);

  // Inventory sync verification — bundles with broken SKU links or out-of-stock components
  const brokenBundles = useBndMemo(
    () => bundles.filter(b => bundleLinkErrors(b).length > 0),
    [bundles, stockKey]
  );
  const oosBundles = useBndMemo(
    () => bundles.filter(b => bundleLinkErrors(b).length === 0 && bundleAvail(b) <= 0),
    [bundles, stockKey]
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Page header */}
      <div className="page-head">
        <div>
          <h1 className="page-title">ชุดสินค้า (Bundles)</h1>
          <div className="page-sub">จัดชุดสินค้าจากคลัง · ขายชุดตัดสต็อกอัตโนมัติ</div>
        </div>
        <button className="btn btn-primary" onClick={() => setFormBundle(false)}>
          <Icons.Plus size={14}/> สร้างชุดสินค้า
        </button>
      </div>

      {/* KPI strip */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="kpi">
          <div className="kpi-label">ชุดสินค้าทั้งหมด</div>
          <div className="kpi-value">{totalBundles}</div>
          <div className="kpi-delta">{availableBundles} ชุดพร้อมขาย</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">พร้อมขาย</div>
          <div className="kpi-value">{availableBundles}</div>
          <div className="kpi-delta">{totalBundles - availableBundles} ชุดสต็อกหมด</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">มูลค่าที่ขายได้</div>
          <div className="kpi-value tnum">฿{totalRevenuePotential.toLocaleString()}</div>
          <div className="kpi-delta">จากทุกชุดที่มีสต็อก</div>
        </div>
      </div>

      {/* Inventory sync verification banner */}
      {(brokenBundles.length > 0 || oosBundles.length > 0) && (
        <div className="card" style={{ padding: "12px 16px", background: brokenBundles.length ? "var(--danger-soft)" : "var(--warning-soft)", border: "none" }}>
          <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <Icons.Warn size={16} style={{ color: brokenBundles.length ? "var(--danger)" : "var(--warning)", flexShrink: 0, marginTop: 1 }}/>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              {brokenBundles.length > 0 && (
                <div style={{ color: "var(--danger)", fontWeight: 500 }}>
                  {brokenBundles.length} ชุดมีสินค้าที่ไม่ตรงกับ SKU ในคลัง — แก้ไขชุดเพื่อเชื่อมโยงสินค้าใหม่: {brokenBundles.map(b => b.name).join(", ")}
                </div>
              )}
              {oosBundles.length > 0 && (
                <div style={{ color: "var(--warning)", fontWeight: 500, marginTop: brokenBundles.length ? 4 : 0 }}>
                  {oosBundles.length} ชุดขายไม่ได้เพราะสินค้าในชุดหมดสต็อก — ตรวจสอบสินค้าคงคลังทันที
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="card" style={{ padding: "14px 16px" }}>
        <div className="search" style={{ maxWidth: 400 }}>
          <Icons.Search size={14}/>
          <input
            placeholder="ค้นหาชื่อชุด, คำอธิบาย, หรือ SKU..."
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}><Icons.X size={12}/></span>}
        </div>
        {q && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{filtered.length} จาก {bundles.length} รายการ</div>}
      </div>

      {/* Bundle list */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          <Icons.Pkg size={28} style={{ opacity: 0.3, marginBottom: 10 }}/>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{q ? "ไม่พบชุดสินค้าที่ตรงกัน" : "ยังไม่มีชุดสินค้า"}</div>
          {!q && <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setFormBundle(false)}>สร้างชุดสินค้าแรก</button>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {filtered.map(bundle => {
            const avail = bundleAvail(bundle);
            const st = bundleStatus(avail);
            const cost = calcBundleCost(bundle);
            const margin = bundle.price > 0 ? Math.round((1 - cost / bundle.price) * 100) : 0;
            const isActive = activeId === bundle.id;
            return (
              <div
                key={bundle.id}
                className="card"
                onClick={() => setActiveId(isActive ? null : bundle.id)}
                style={{
                  cursor: "pointer",
                  border: isActive ? "2px solid var(--accent)" : "1px solid var(--border)",
                  transition: "box-shadow 0.15s, border-color 0.15s",
                  userSelect: "none"
                }}
              >
                {/* Card header */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)", marginBottom: 2 }}>{bundle.id}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{bundle.name}</div>
                    {bundle.desc && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bundle.desc}</div>}
                  </div>
                  <span className={"badge " + st.cls} style={{ flexShrink: 0, marginTop: 2 }}><span className="dot"/>{st.label}</span>
                </div>

                {/* Items preview */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>ประกอบด้วย</div>
                  <div className="stack" style={{ gap: 4 }}>
                    {bundle.items.map(item => {
                      const p = PRODUCTS.find(x => x.sku === item.sku);
                      const effQty = getEffectiveQty(item.sku);
                      return (
                        <div key={item.sku} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: effQty === 0 ? "var(--danger)" : effQty <= 10 ? "var(--warning)" : "var(--success)", flexShrink: 0 }}/>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name || item.sku}</span>
                          <span className="mono" style={{ color: "var(--muted)", flexShrink: 0 }}>×{item.qty}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <div>
                    <div className="tnum" style={{ fontSize: 16, fontWeight: 700 }}>฿{bundle.price.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: "var(--success)", marginTop: 1 }}>กำไร {margin}% · มีสต็อก {avail} ชุด</div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={e => { e.stopPropagation(); setActiveId(bundle.id); }}
                  >
                    <Icons.Out size={13}/> ขาย
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer */}
      {activeBundle && (
        <BundleDrawer
          bundle={activeBundle}
          onClose={() => setActiveId(null)}
          onEdit={() => { setFormBundle(activeBundle); setActiveId(null); }}
          onDelete={() => handleDelete(activeBundle.id)}
          onSell={() => {}}
          pushToast={pushToast}
        />
      )}

      {/* Form modal */}
      {formBundle !== null && (
        <BundleFormModal
          initial={formBundle || null}
          onSave={formBundle ? handleEdit : handleCreate}
          onClose={() => setFormBundle(null)}
        />
      )}
    </div>
  );
}

Object.assign(window, {
  BundlePage, BundleStockAlert,
  loadBundles, bundleAvail, bundleStatus,
  bundleLinkErrors, bundleStockIssues,
  getStockAdj, applyStockAdj, getEffectiveQty
});
