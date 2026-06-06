/* Tracking & courier admin page + customer self-service lookup view */

const { useState: useStateTrk, useEffect: useEffectTrk, useRef: useRefTrk, useMemo: useMemoTrk } = React;

const ORDERS_KEY = "ims_orders_overrides";

function loadOrderOverrides() {
  // Cloud-synced map (app_state key 'order_overrides') is source of truth once
  // dbInit has hydrated it; localStorage is only an offline fallback / seed.
  if (window._DB_ORDER_OVERRIDES && typeof window._DB_ORDER_OVERRIDES === "object") return window._DB_ORDER_OVERRIDES;
  try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || "{}"); }
  catch { return {}; }
}

function setOrderField(id, changes) {
  const prev = loadOrderOverrides();
  // Fresh object reference so React state setters (setO/setOverrides) re-render.
  const m = { ...prev, [id]: { ...prev[id], ...changes } };
  window._DB_ORDER_OVERRIDES = m;
  try { localStorage.setItem(ORDERS_KEY, JSON.stringify(m)); } catch (e) {}
  if (typeof dbSaveState === "function") dbSaveState("order_overrides", m).catch(() => {});
  window.dispatchEvent(new CustomEvent("ims-orders-change"));
}

// A label's order id = its SO number, unless it's an auto-generated placeholder
// ("ฉลากใหม่ N"), in which case the label's own id is used. Single source of truth
// shared by labelToOrder / saveOrderEdit / recoverOrphanedOrders so the id rule
// can never drift between them (a drift would orphan a shipment from its edits).
function orderIdForLabel(l) {
  return (l.soId && !/^ฉลากใหม่/.test(l.soId)) ? l.soId : l.id;
}

// Resolve a carrier string to its CARRIERS entry (color/icon), format-agnostically.
// Empty/unknown carriers return {} so they don't accidentally match the first entry.
function carrierMetaFor(carrier) {
  const key = (carrier || "").toLowerCase().split(" ")[0];
  return (key && CARRIERS.find(c => c.name.toLowerCase().includes(key))) || {};
}

// Orders preserved when their source label was deleted (so they survive in ติดตามพัสดุ)
const PRESERVED_KEY = "ims_preserved_orders";
function loadPreservedOrders() {
  try { return Object.values(JSON.parse(localStorage.getItem(PRESERVED_KEY) || "{}")); }
  catch { return []; }
}
function savePreservedOrder(order) {
  try {
    const m = JSON.parse(localStorage.getItem(PRESERVED_KEY) || "{}");
    m[order.id] = order;
    localStorage.setItem(PRESERVED_KEY, JSON.stringify(m));
    window.dispatchEvent(new CustomEvent("ims-orders-change"));
  } catch (e) {}
  // Also persist to Supabase orders table so the track-lookup Edge Function
  // (used by anonymous customers) can find it even after the source label is gone.
  if (typeof dbUpsertOrders === "function") {
    dbUpsertOrders([order]).catch(() => {});
  }
}
// Sync all unsynced preserved orders to Supabase — called after auth is confirmed.
function syncPreservedOrdersToDb() {
  if (typeof dbUpsertOrders !== "function") return;
  const all = loadPreservedOrders();
  if (!all.length) return;
  dbUpsertOrders(all).catch(() => {});
}

// Full order edit: writes every editable field as an override, recomputes the
// Thai date display, and (for label-derived orders) mirrors name/phone/carrier/
// tracking back onto the underlying label so the คิวฉลาก stays in sync.
// Shared by the desktop drawer and the mobile editor.
function saveOrderEdit(order, fields) {
  const f = { ...fields };
  if (f.dateIso !== undefined) f.date = f.dateIso ? isoToThai(f.dateIso) : "";
  if (f.items !== undefined) f.items = parseInt(f.items) || 0;
  setOrderField(order.id, f);
  if (order.__fromLabel && typeof loadLabels === "function" && typeof saveLabels === "function") {
    const all = loadLabels();
    const next = all.map(l => {
      if (orderIdForLabel(l) !== order.id) return l;
      const recipient = { ...l.recipient };
      if (f.customer !== undefined) recipient.name = f.customer;
      if (f.phone !== undefined) recipient.phone = f.phone;
      return {
        ...l,
        recipient,
        carrier: f.carrier !== undefined ? f.carrier : l.carrier,
        tracking: f.tracking !== undefined ? f.tracking : l.tracking,
      };
    });
    saveLabels(next);
  }
}

// Phase B — a delete must REALLY remove the shipment from Supabase, not just hide
// it locally: the customer track page (track-lookup Edge Function) reads the
// `labels` and `orders` tables directly and knows nothing about order_overrides.
// RLS lets only admin/manager delete, so staff is blocked up front (matches the
// orders/labels DELETE policy) — we never leave a half-deleted row.
// NOTE: we delete labels directly and DO NOT route through saveLabels(), because
// saveLabels preserves any tracked label into the orders table (so the customer
// page keeps showing it) — the exact opposite of a delete.
async function deleteOrdersFromDb(ids) {
  const role = (window.__currentUser && window.__currentUser.role) || "staff";
  if (role !== "admin" && role !== "manager") return { blocked: true };

  const idSet = new Set(ids);
  const labels = (typeof loadLabels === "function") ? loadLabels() : [];
  const delLabelIds = new Set(labels.filter(l => idSet.has(orderIdForLabel(l))).map(l => l.id));

  // 1. Hard-delete the underlying label(s) from the cloud (best-effort: a 0-row
  //    result just means the row wasn't in the cloud — for admin/manager it can't
  //    be an RLS block since we gated on role above).
  for (const lid of delLabelIds) {
    if (typeof dbDeleteLabel === "function") await dbDeleteLabel(lid).catch(() => {});
  }
  // Remove them locally too, bypassing saveLabels' preserve-snapshot path.
  if (delLabelIds.size) {
    const next = labels.filter(l => !delLabelIds.has(l.id));
    try { localStorage.setItem("ims_labels", JSON.stringify(next)); } catch (e) {}
    window._DB_LABELS = next;
    window.dispatchEvent(new CustomEvent("ims-labels-change"));
  }
  // 2. Remove any orders-table row the customer page reads — including rows a
  //    previous saveLabels preserve had pushed up for this shipment.
  for (const id of ids) {
    if (typeof dbDeleteOrder === "function") await dbDeleteOrder(id).catch(() => {});
  }
  // 3. Drop local preserved copies so they can't re-sync the order back up.
  try {
    const m = JSON.parse(localStorage.getItem(PRESERVED_KEY) || "{}");
    let changed = false;
    ids.forEach(id => { if (m[id]) { delete m[id]; changed = true; } });
    if (changed) localStorage.setItem(PRESERVED_KEY, JSON.stringify(m));
  } catch (e) {}

  return { ok: true };
}

// One-time recovery: any entry in ims_orders_overrides whose source label was
// deleted before the preservation logic existed is rescued into ims_preserved_orders.
// Runs once at page load — safe to repeat, guarded by migration flag.
(function recoverOrphanedOrders() {
  try {
    if (localStorage.getItem("ims_orphan_migration_v1")) return;
    const overrides = loadOrderOverrides();
    const currentLabelIds = new Set(
      (typeof loadLabels === "function" ? loadLabels() : []).map(orderIdForLabel)
    );
    const baseIds = new Set((OUTBOUND || []).map(o => o.id));
    const preserved = JSON.parse(localStorage.getItem(PRESERVED_KEY) || "{}");
    let changed = false;
    Object.entries(overrides).forEach(([id, data]) => {
      if (currentLabelIds.has(id) || baseIds.has(id) || preserved[id] || data.deleted) return;
      // Orphaned override — reconstruct a minimal order row so tracking shows it
      preserved[id] = {
        id,
        channel:  data.channel  || "ฉลาก",
        customer: data.customer || "—",
        phone:    data.phone    || "",
        status:   data.status   || "shipped",
        carrier:  data.carrier  || "",
        tracking: data.tracking || "",
        items:    typeof data.items === "number" ? data.items : 0,
        dateIso:  data.dateIso  || "",
        date:     data.date     || "",
        ts:       data.ts       || "",
        __fromLabel: false,
        __recovered: true,
      };
      changed = true;
    });
    if (changed) localStorage.setItem(PRESERVED_KEY, JSON.stringify(preserved));
    localStorage.setItem("ims_orphan_migration_v1", "1");
  } catch (e) {}
})();

// Turn a label (คิวฉลาก) into an order-shaped row so the shop's real shipments
// show up on the tracking page. OUTBOUND is empty for this shop — labels ARE the
// shipments. Tracking/carrier saved by the slip scanner live on the label.
function labelToOrder(l) {
  const id = orderIdForLabel(l);
  const dateIso = (l.created_at || "").slice(0, 10);
  return {
    id,
    channel: "ฉลาก",
    customer: (l.recipient && l.recipient.name) || "ไม่ระบุชื่อ",
    phone: (l.recipient && l.recipient.phone) || "",
    status: l.tracking ? "shipped" : "packed",
    carrier: l.carrier || "",
    tracking: l.tracking || "",
    items: (l.items || []).length,
    dateIso,
    date: dateIso ? isoToThai(dateIso) : "",
    ts: "",
    __fromLabel: true,
  };
}

// Thai phone -> "national significant number" for format-agnostic matching:
// strip non-digits, drop the +66 country code and any leading zero, so a stored
// "+66 81 552 0917" and a typed "081-552-0917" compare equal.
function phoneNSN(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("66")) d = d.slice(2);
  return d.replace(/^0+/, "");
}

// Does an order match a customer's free-text query (phone / name / tracking / id)?
// Phone is matched format-agnostically; name matches as a full substring OR when
// every typed word appears in the stored name (handles reversed order, titles,
// and extra spaces). Shared by the customer lookup; mirrored in the track-lookup
// Edge Function so anon customers get identical results.
function orderMatchesQuery(o, raw) {
  const ql = String(raw || "").trim().toLowerCase();
  if (ql.length < 3) return false;
  const digits = ql.replace(/\D/g, "");
  if (digits.length >= 4) {
    const stored = String(o.phone || "").replace(/\D/g, "");
    if (stored.includes(digits)) return true;
    const ns = phoneNSN(stored), nq = phoneNSN(digits);
    if (ns && nq && ns.includes(nq)) return true;
  }
  const name = String(o.customer || "").toLowerCase().replace(/\s+/g, " ");
  if (name.includes(ql)) return true;
  const toks = ql.split(/\s+/).filter(t => t.length >= 2);
  if (toks.length && toks.every(t => name.includes(t))) return true;
  if (ql.length >= 4) {
    if (String(o.tracking || "").toLowerCase().includes(ql)) return true;
    if (String(o.id || "").toLowerCase().includes(ql)) return true;
  }
  return false;
}

/* Synchronous merged order list (labels-as-shipments + preserved + base, with
   overrides applied) for non-hook callers like badge counts. Mirrors useOrders'
   merge minus the async Supabase rows. */
function buildOrders() {
  const overrides = loadOrderOverrides();
  const out = [];
  const seen = new Set();
  const sources = [
    OUTBOUND,
    (typeof loadLabels === "function" ? loadLabels() : []).map(labelToOrder),
    loadPreservedOrders(),
  ];
  for (const src of sources) {
    for (const o of src) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push({ ...o, ...(overrides[o.id] || {}) });
    }
  }
  return out.filter(o => !o.deleted);
}

function useOrders() {
  const [overrides, setO] = useStateTrk(() => loadOrderOverrides());
  const [labelsTick, bumpLabels] = useStateTrk(0);
  const [dbOrders, setDbOrders] = useStateTrk(null); // orders synced to Supabase (e.g. preserved on another device)
  const dbTimer = useRefTrk(null);

  // Load the Supabase orders table so preserved/recovered shipments synced from
  // ANY device show up here too — local labels + localStorage alone miss them.
  // Debounced: a slip scan can fire many ims-orders-change events in a row
  // (one per parcel) — coalesce them into a single fetch.
  const reloadDbOrders = () => {
    if (typeof dbLoadOrders !== "function") return;
    if (dbTimer.current) clearTimeout(dbTimer.current);
    dbTimer.current = setTimeout(() => {
      dbLoadOrders().then(rows => { if (Array.isArray(rows)) setDbOrders(rows); }).catch(() => {});
    }, 250);
  };

  useEffectTrk(() => {
    const lh = () => bumpLabels(v => v + 1);
    const oh = () => { setO(loadOrderOverrides()); reloadDbOrders(); };
    window.addEventListener("ims-orders-change", oh);
    window.addEventListener("ims-labels-change", lh);
    // Push any local preserved orders up to Supabase, then pull the merged set down.
    if (typeof syncPreservedOrdersToDb === "function") syncPreservedOrdersToDb();
    reloadDbOrders();
    return () => {
      window.removeEventListener("ims-orders-change", oh);
      window.removeEventListener("ims-labels-change", lh);
      if (dbTimer.current) clearTimeout(dbTimer.current);
    };
  }, []);

  // Merge OUTBOUND + label-derived + preserved + remote orders, deduped by id with
  // user overrides applied. Memoized so typing in the tracking filter (which lives
  // in the same component) doesn't re-parse localStorage on every keystroke.
  return useMemoTrk(() => {
    const out = [];
    const seen = new Set();
    const sources = [
      OUTBOUND,
      (typeof loadLabels === "function" ? loadLabels() : []).map(labelToOrder),
      loadPreservedOrders(),
      dbOrders || [],
    ];
    for (const src of sources) {
      for (const o of src) {
        if (seen.has(o.id)) continue;
        seen.add(o.id);
        out.push({ ...o, ...(overrides[o.id] || {}) });
      }
    }
    return out.filter(o => !o.deleted);
  }, [overrides, labelsTick, dbOrders]);
}

/* Status pipeline order */
const TRACK_STAGES = [
  { id: "picking",   label: "กำลังจัดเตรียม", icon: Icons.Box },
  { id: "packed",    label: "พร้อมส่ง",       icon: Icons.Pkg },
  { id: "shipped",   label: "ส่งให้ขนส่ง",     icon: Icons.Truck },
  { id: "delivered", label: "ถึงปลายทาง",     icon: Icons.Door }
];

const stageIndex = (status) => TRACK_STAGES.findIndex(s => s.id === status);

/* Build + download a CSV of order rows. UTF-8 BOM so Excel reads Thai correctly;
   every field quoted with embedded quotes doubled so commas/newlines are safe. */
function exportOrdersCsv(rows, filename) {
  const stageLabel = (s) => (TRACK_STAGES.find(t => t.id === s) || {}).label || s || "";
  const headers = ["เลขออร์เดอร์", "ลูกค้า", "เบอร์โทร", "ช่องทาง", "จำนวน", "ขนส่ง", "เลขพัสดุ", "สถานะ", "วันที่"];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  rows.forEach(o => {
    lines.push([o.id, o.customer, o.phone, o.channel, o.items, o.carrier, o.tracking, stageLabel(o.status), o.date || o.dateIso]
      .map(esc).join(","));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ============ ADMIN: Tracking page ============ */

function TrackingPage({ pushToast, store }) {
  const orders = useOrders();
  const [q, setQ] = useStateTrk("");
  const [statusFilter, setStatusFilter] = useStateTrk("all");
  const [shareOpen, setShareOpen] = useStateTrk(false);
  const [edit, setEdit] = useStateTrk(null);
  const [selected, setSelected] = useStateTrk({});
  const [bulkMenu, setBulkMenu] = useStateTrk(null);
  const [bulkConfirm, setBulkConfirm] = useStateTrk(null);
  const [slipOpen, setSlipOpen] = useStateTrk(false);
  const [sortDir, setSortDir] = useStateTrk("desc"); // วันที่: desc = ใหม่สุดก่อน

  const filtered = orders.filter(o => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const match = (o.id + " " + o.customer + " " + o.phone + " " + o.tracking + " " + o.carrier).toLowerCase().includes(ql);
      if (!match) return false;
    }
    return true;
  });

  // Sort by date/time. Orders with no date sort to the bottom (desc) / top (asc).
  const sorted = [...filtered].sort((a, b) => {
    const ka = (a.dateIso || "") + " " + (a.ts || "");
    const kb = (b.dateIso || "") + " " + (b.ts || "");
    if (ka === kb) return 0;
    if (ka < kb) return sortDir === "asc" ? -1 : 1;
    return sortDir === "asc" ? 1 : -1;
  });
  const toggleSort = () => setSortDir(d => d === "asc" ? "desc" : "asc");

  const filteredIds = filtered.map(o => o.id);
  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected[id]);
  const someFilteredSelected = !allFilteredSelected && filteredIds.some(id => selected[id]);

  const toggleOne = (id) => setSelected(s => {
    const n = { ...s };
    if (n[id]) delete n[id]; else n[id] = true;
    return n;
  });
  const toggleAll = () => {
    if (allFilteredSelected) {
      setSelected(s => { const n = { ...s }; filteredIds.forEach(id => delete n[id]); return n; });
    } else {
      setSelected(s => { const n = { ...s }; filteredIds.forEach(id => { n[id] = true; }); return n; });
    }
  };
  const clearSelection = () => { setSelected({}); setBulkMenu(null); };

  const bulkStatus = (status) => {
    const stageLabel = TRACK_STAGES.find(s => s.id === status)?.label || status;
    setBulkConfirm({
      title: "ยืนยันการแก้ไขสถานะ",
      description: `อัปเดตสถานะของ ${selectedCount} ออร์เดอร์เป็น \"${stageLabel}\"`,
      count: selectedCount,
      changes: [{ label: "สถานะ", from: "หลายสถานะ", to: stageLabel }],
      action: "อัปเดต",
      onConfirm: () => {
        selectedIds.forEach(id => setOrderField(id, { status }));
        recordChange({
          entity: "order", action: "bulk-update",
          summary: `เปลี่ยนสถานะ ${selectedCount} ออร์เดอร์เป็น ยลยสถานะ: ${stageLabel}`,
          count: selectedCount,
          changes: [{ label: "สถานะใหม่", to: stageLabel }],
          note: `ออร์เดอร์: ${selectedIds.join(", ")}`
        });
        pushToast(`อัปเดตสถานะ ${selectedCount} ออร์เดอร์`);
        setBulkConfirm(null);
        clearSelection();
      }
    });
  };
  const bulkCarrier = (carrier) => {
    setBulkConfirm({
      title: "ยืนยันการเปลี่ยนขนส่ง",
      description: `เปลี่ยนขนส่งของ ${selectedCount} ออร์เดอร์`,
      count: selectedCount,
      changes: [{ label: "ขนส่ง", from: "หลายราย", to: carrier }],
      action: "อัปเดต",
      onConfirm: () => {
        selectedIds.forEach(id => setOrderField(id, { carrier }));
        recordChange({
          entity: "order", action: "bulk-update",
          summary: `เปลี่ยนขนส่ง ${selectedCount} ออร์เดอร์เป็น ${carrier}`,
          count: selectedCount,
          changes: [{ label: "ขนส่งใหม่", to: carrier }],
          note: `ออร์เดอร์: ${selectedIds.join(", ")}`
        });
        pushToast(`เปลี่ยนขนส่ง ${selectedCount} ออร์เดอร์`);
        setBulkConfirm(null);
        clearSelection();
      }
    });
  };
  const bulkDelete = () => {
    setBulkConfirm({
      title: "ยืนยันการลบออร์เดอร์",
      description: `ลบ ${selectedCount} ออร์เดอร์ออกจากระบบติดตาม — จะหายจากตารางและหน้าลูกค้า`,
      count: selectedCount,
      action: "ลบออร์เดอร์",
      danger: true,
      onConfirm: async () => {
        const res = await deleteOrdersFromDb(selectedIds);
        if (res.blocked) {
          pushToast("ลบไม่ได้ — เฉพาะแอดมิน/ผู้จัดการเท่านั้น");
          setBulkConfirm(null);
          return;
        }
        // Tombstone too, so other devices hide it instantly via the synced
        // order_overrides even before the labels/orders deletes reach them.
        selectedIds.forEach(id => setOrderField(id, { deleted: true }));
        recordChange({
          entity: "order", action: "bulk-delete",
          summary: `ลบ ${selectedCount} ออร์เดอร์จากระบบ`,
          count: selectedCount,
          note: `ออร์เดอร์: ${selectedIds.join(", ")}`
        });
        pushToast(`ลบ ${selectedCount} ออร์เดอร์แล้ว`);
        setBulkConfirm(null);
        clearSelection();
      }
    });
  };

  const counts = {
    total: orders.length,
    waiting: orders.filter(o => !o.tracking || o.tracking === "").length,
    shipped: orders.filter(o => o.status === "shipped" || o.status === "delivered").length,
    delivered: orders.filter(o => o.status === "delivered").length
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ติดตามพัสดุ</h1>
          <div className="page-sub">ระบุเลขพัสดุและขนส่งของออร์เดอร์ที่จัดส่ง ลูกค้าใช้ลิงก์เดียวกันค้นหาเองได้</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => {
            if (!sorted.length) { pushToast("ไม่มีออร์เดอร์ให้ส่งออก"); return; }
            exportOrdersCsv(sorted, `tracking-${TODAY_ISO}.csv`);
            pushToast(`ส่งออก ${sorted.length} ออร์เดอร์`);
          }}><Icons.Pkg size={14}/> ส่งออก CSV</button>
          <button className="btn btn-primary" onClick={() => setSlipOpen(true)}><Icons.Camera size={14}/> สแกนสลิป</button>
          <button className="btn btn-accent" onClick={() => setShareOpen(true)}><Icons.Copy size={14}/> ลิงก์ค้นหาของลูกค้า</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="ออร์เดอร์ทั้งหมด" value={counts.total} tone="info" hint="ในระบบติดตาม"/>
        <SmallStat label="รอใส่เลขพัสดุ" value={counts.waiting} tone={counts.waiting > 0 ? "warning" : "success"} hint={counts.waiting > 0 ? "ต้องเพิ่มเลขพัสดุ" : "ครบถ้วน"}/>
        <SmallStat label="ส่งให้ขนส่งแล้ว" value={counts.shipped} tone="success" hint={`ถึงปลายทาง ${counts.delivered} ออร์เดอร์`}/>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="search" style={{ width: 380 }}>
            <Icons.Search size={14}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาออร์เดอร์ ลูกค้า โทรศัพท์ เลขพัสดุ"/>
            {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
          </div>
          <div className="seg">
            <button className={statusFilter === "all" ? "on" : ""} onClick={() => setStatusFilter("all")}>ทุกสถานะ</button>
            {TRACK_STAGES.map(s => (
              <button key={s.id} className={statusFilter === s.id ? "on" : ""} onClick={() => setStatusFilter(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div style={{
          position: "sticky", top: 70, zIndex: 9,
          background: "var(--fg)", color: "oklch(0.99 0.003 250)",
          padding: "10px 18px",
          borderRadius: 14,
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "var(--shadow-lg)",
          animation: "modalin 0.18s cubic-bezier(0.2, 0.8, 0.3, 1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 999, background: "oklch(0.99 0.003 250)", color: "var(--fg)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }} className="tnum">{selectedCount}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>เลือก {selectedCount} ออร์เดอร์</span>
            <button onClick={clearSelection} style={{ background: "transparent", border: "none", color: "oklch(0.85 0.005 250)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>ล้างการเลือก</button>
          </div>
          <div className="spacer"/>
          <div className="row" style={{ gap: 6, position: "relative" }}>
            <BulkBtn icon={<Icons.Truck size={13}/>} label="อัปเดตสถานะ" onClick={() => setBulkMenu(bulkMenu === "status" ? null : "status")}/>
            <BulkBtn icon={<Icons.Tag size={13}/>}   label="เปลี่ยนขนส่ง" onClick={() => setBulkMenu(bulkMenu === "carrier" ? null : "carrier")}/>
            <BulkBtn icon={<Icons.Pkg size={13}/>}   label="ส่งออก" onClick={() => {
              const rows = sorted.filter(o => selected[o.id]);
              if (!rows.length) return;
              exportOrdersCsv(rows, `tracking-selected-${TODAY_ISO}.csv`);
              pushToast(`ส่งออก ${rows.length} ออร์เดอร์`);
            }}/>
            <BulkBtn icon={<Icons.Trash size={13}/>} label="ลบ" onClick={bulkDelete} danger/>

            {bulkMenu === "status" && (
              <BulkPopover onClose={() => setBulkMenu(null)} title="เปลี่ยนสถานะเป็น">
                {TRACK_STAGES.map(s => {
                  const I = s.icon;
                  return (
                    <button key={s.id} className="popover-item" onClick={() => bulkStatus(s.id)}>
                      <I size={13} style={{ color: "var(--muted)" }}/>
                      <span style={{ flex: 1 }}>{s.label}</span>
                    </button>
                  );
                })}
              </BulkPopover>
            )}

            {bulkMenu === "carrier" && (
              <BulkPopover onClose={() => setBulkMenu(null)} title="เปลี่ยนขนส่งเป็น">
                {CARRIERS.map(c => (
                  <button key={c.id} className="popover-item" onClick={() => bulkCarrier(c.name)}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color, flexShrink: 0 }}/>
                    <span style={{ flex: 1 }}>{c.name}</span>
                  </button>
                ))}
              </BulkPopover>
            )}
          </div>
        </div>
      )}

      <div className="card card-tight">
        <table className="t">
          <thead><tr>
            <th style={{ width: 36 }}>
              <span
                className={"check" + (allFilteredSelected || someFilteredSelected ? " on" : "")}
                onClick={toggleAll}
                style={someFilteredSelected && !allFilteredSelected ? { background: "var(--accent-soft)", borderColor: "var(--accent)" } : {}}
              />
            </th>
            <th>ออร์เดอร์</th>
            <th>ลูกค้า</th>
            <th>ขนส่ง</th>
            <th>เลขพัสดุ</th>
            <th>สถานะ</th>
            <th onClick={toggleSort} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }} title="คลิกเพื่อสลับลำดับวันที่">
              วันที่ <span style={{ color: "var(--accent)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>
            </th>
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {sorted.map(o => {
              const carrierMeta = carrierMetaFor(o.carrier);
              const idx = stageIndex(o.status);
              const stageLabel = TRACK_STAGES[idx]?.label || o.status;
              const isSelected = !!selected[o.id];
              return (
                <tr key={o.id} style={{ cursor: "pointer", background: isSelected ? "var(--accent-soft)" : undefined }}>
                  <td onClick={(e) => { e.stopPropagation(); toggleOne(o.id); }}>
                    <span className={"check" + (isSelected ? " on" : "")}/>
                  </td>
                  <td className="t-mono" style={{ color: "var(--fg)", fontWeight: 500 }} onClick={() => setEdit(o)}>{o.id}</td>
                  <td onClick={() => setEdit(o)}>
                    <div style={{ fontSize: 13 }}>{o.customer}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{o.phone}</div>
                  </td>
                  <td onClick={() => setEdit(o)}>
                    {o.carrier ? (
                      <span className="ch-chip">
                        <span className="swatch" style={{ background: carrierMeta.color || "var(--muted)" }}/>
                        {o.carrier}
                      </span>
                    ) : <span style={{ color: "var(--faint)", fontSize: 12 }}>—</span>}
                  </td>
                  <td onClick={() => setEdit(o)}>
                    {o.tracking ? (
                      <span className="mono" style={{ fontSize: 12, color: "var(--fg)", fontWeight: 500 }}>{o.tracking}</span>
                    ) : (
                      <span className="badge badge-warning"><span className="dot"/>ยังไม่ได้ระบุ</span>
                    )}
                  </td>
                  <td onClick={() => setEdit(o)}>
                    <span className={"badge " + (idx === 3 ? "badge-success" : idx === 2 ? "badge-info" : idx === 1 ? "badge-info" : "badge-warning")}>
                      <span className="dot"/>{stageLabel}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }} onClick={() => setEdit(o)}>{o.date} {o.ts}</td>
                  <td onClick={() => setEdit(o)}><Icons.Edit size={14} style={{ color: "var(--muted)" }}/></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan="8" style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                ไม่พบออร์เดอร์
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--info-soft)", color: "var(--info)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icons.Help size={18}/>
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, color: "var(--fg)", fontSize: 13, marginBottom: 4 }}>วิธีให้ลูกค้าใช้งาน</div>
          ส่งลิงก์ <strong style={{ color: "var(--accent)" }}>ค้นหาของลูกค้า</strong> ไปทาง LINE, SMS หรือแนบในอีเมลยืนยันคำสั่งซื้อ ลูกค้าสามารถใส่เบอร์โทรหรือชื่อเพื่อดูสถานะพัสดุของตัวเองได้โดยไม่ต้องเข้าสู่ระบบ
        </div>
      </div>

      {edit && <OrderEditDrawer order={edit} onClose={() => setEdit(null)} pushToast={pushToast}/>}
      {shareOpen && <ShareLinkModal store={store} onClose={() => setShareOpen(false)} pushToast={pushToast}/>}
      {slipOpen && <SlipScanModal onClose={() => setSlipOpen(false)} pushToast={pushToast}/>}
      <ConfirmDialog open={!!bulkConfirm} {...(bulkConfirm || {})} onCancel={() => setBulkConfirm(null)}/>
    </div>
  );
}

function BulkBtn({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 10px",
        background: danger ? "oklch(0.42 0.16 25)" : "oklch(0.3 0.01 250)",
        color: "oklch(0.99 0.003 250)",
        border: "none",
        borderRadius: 8,
        fontSize: 12, fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit"
      }}
    >
      {icon} {label}
    </button>
  );
}

function BulkPopover({ title, onClose, children }) {
  const ref = useRefTrk(null);
  useEffectTrk(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    setTimeout(() => document.addEventListener("mousedown", h), 0);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={ref} style={{
      position: "absolute",
      top: "calc(100% + 8px)",
      right: 0,
      background: "var(--surface)",
      color: "var(--fg)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      boxShadow: "var(--shadow-lg)",
      padding: 6,
      minWidth: 220,
      zIndex: 30,
      animation: "modalin 0.14s ease-out"
    }}>
      <div style={{ padding: "6px 10px 4px", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{title}</div>
      {children}
    </div>
  );
}

/* ============ ORDER EDIT DRAWER (tracking + carrier) ============ */

function OrderEditDrawer({ order, onClose, pushToast }) {
  const [customer, setCustomer] = useStateTrk(order.customer || "");
  const [phone, setPhone] = useStateTrk(order.phone || "");
  const [channel, setChannel] = useStateTrk(order.channel || "");
  const [items, setItems] = useStateTrk(order.items != null ? String(order.items) : "");
  const [dateIso, setDateIso] = useStateTrk(order.dateIso || "");
  const [ts, setTs] = useStateTrk(order.ts || "");
  const [carrier, setCarrier] = useStateTrk(order.carrier || "");
  const [tracking, setTracking] = useStateTrk(order.tracking || "");
  const [status, setStatus] = useStateTrk(order.status);
  const [confirmOpen, setConfirmOpen] = useStateTrk(false);

  const STATUS_LABEL = Object.fromEntries(TRACK_STAGES.map(s => [s.id, s.label]));
  const itemsNum = parseInt(items) || 0;
  const changes = [
    customer !== (order.customer || "") && { label: "ชื่อลูกค้า / ผู้รับ", from: order.customer || "—", to: customer || "—" },
    phone !== (order.phone || "") && { label: "เบอร์โทร", from: order.phone || "—", to: phone || "—" },
    channel !== (order.channel || "") && { label: "ช่องทาง", from: order.channel || "—", to: channel || "—" },
    itemsNum !== (order.items || 0) && { label: "จำนวนรายการ", from: String(order.items || 0), to: String(itemsNum) },
    dateIso !== (order.dateIso || "") && { label: "วันที่", from: order.dateIso ? isoToThai(order.dateIso) : "—", to: dateIso ? isoToThai(dateIso) : "—" },
    ts !== (order.ts || "") && { label: "เวลา", from: order.ts || "—", to: ts || "—" },
    carrier !== (order.carrier || "") && { label: "ผู้ให้บริการขนส่ง", from: order.carrier || "", to: carrier || "—" },
    tracking !== (order.tracking || "") && { label: "เลขพัสดุ", from: order.tracking || "", to: tracking || "—" },
    status !== order.status && { label: "สถานะการจัดส่ง", from: STATUS_LABEL[order.status], to: STATUS_LABEL[status] }
  ].filter(Boolean);

  const requestSave = () => {
    if (changes.length === 0) { onClose(); return; }
    setConfirmOpen(true);
  };

  const doSave = () => {
    saveOrderEdit(order, { customer, phone, channel, items: itemsNum, dateIso, ts, carrier, tracking, status });
    recordChange({
      entity: "order",
      entityId: order.id,
      action: "update",
      summary: `แก้ไขข้อมูลออร์เดอร์ ${order.id}`,
      changes
    });
    pushToast(`อัปเดต ${order.id} แล้ว`);
    setConfirmOpen(false);
    onClose();
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">แก้ไขข้อมูลจัดส่ง</div>
            <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{order.id}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="drawer-body">
          <div className="eyebrow" style={{ marginBottom: 8 }}>ข้อมูลลูกค้า / ออร์เดอร์</div>
          <div className="stack" style={{ gap: 10, marginBottom: 18 }}>
            <div className="field">
              <label>ชื่อลูกค้า / ผู้รับ</label>
              <input className="input" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="ชื่อผู้รับ"/>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>เบอร์โทร</label>
                <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="08xxxxxxxx" style={{ fontFamily: "IBM Plex Mono, monospace" }}/>
              </div>
              <div className="field">
                <label>ช่องทาง</label>
                <input className="input" value={channel} onChange={e => setChannel(e.target.value)} placeholder="เช่น ฉลาก, Shopee" list="trk-channels"/>
                <datalist id="trk-channels">{(typeof CHANNELS !== "undefined" ? CHANNELS : []).map(c => <option key={c.id || c.name} value={c.name}/>)}</datalist>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>จำนวนรายการ</label>
                <input className="input" type="number" min="0" value={items} onChange={e => setItems(e.target.value)} placeholder="0"/>
              </div>
              <div className="field">
                <label>วันที่</label>
                <input className="input" type="date" value={dateIso} onChange={e => setDateIso(e.target.value)}/>
              </div>
              <div className="field">
                <label>เวลา</label>
                <input className="input" type="time" value={ts} onChange={e => setTs(e.target.value)}/>
              </div>
            </div>
          </div>

          <div className="eyebrow" style={{ marginBottom: 8 }}>ขนส่ง</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 18 }}>
            {CARRIERS.map(c => (
              <button
                key={c.id}
                onClick={() => setCarrier(c.name)}
                className="btn"
                style={{
                  justifyContent: "flex-start",
                  padding: "10px 12px",
                  background: carrier === c.name ? "var(--accent-soft)" : "var(--surface)",
                  borderColor: carrier === c.name ? "var(--accent)" : "var(--border)"
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color, flexShrink: 0 }}/>
                <span style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</span>
                {carrier === c.name && <Icons.Check size={12} style={{ marginLeft: "auto", color: "var(--accent)" }}/>}
              </button>
            ))}
          </div>

          <div className="field" style={{ marginBottom: 18 }}>
            <label>เลขพัสดุ / Tracking Number</label>
            <input
              className="input"
              value={tracking}
              onChange={e => setTracking(e.target.value)}
              placeholder="เช่น TH8842919012"
              style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 14, letterSpacing: "0.04em" }}
            />
            <span className="hint">รหัสที่ขนส่งให้สำหรับติดตามพัสดุ</span>
          </div>

          <div className="eyebrow" style={{ marginBottom: 8 }}>สถานะการจัดส่ง</div>
          <div className="stack" style={{ gap: 6 }}>
            {TRACK_STAGES.map((s, i) => {
              const I = s.icon;
              const isCurrent = s.id === status;
              return (
                <div
                  key={s.id}
                  onClick={() => setStatus(s.id)}
                  style={{
                    padding: 12,
                    background: isCurrent ? "var(--accent-soft)" : "var(--surface-2)",
                    border: "1px solid " + (isCurrent ? "var(--accent)" : "var(--border)"),
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10
                  }}
                >
                  <span className={"check" + (isCurrent ? " on" : "")}/>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface)", display: "grid", placeItems: "center", color: isCurrent ? "var(--accent)" : "var(--muted)" }}>
                    <I size={14}/>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>ขั้นที่ {i + 1}</span>
                </div>
              );
            })}
          </div>

          {tracking && carrier && (
            <div style={{ marginTop: 18, padding: 12, background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 12 }}>
              <div className="row" style={{ gap: 8 }}>
                <Icons.Check size={14}/>
                <span><strong>พร้อมแชร์ให้ลูกค้า</strong> — ลูกค้าค้นหาด้วยเบอร์ <span className="mono" style={{ color: "var(--fg)" }}>{phone || order.phone}</span> จะเห็นเลข <span className="mono" style={{ color: "var(--fg)" }}>{tracking}</span></span>
              </div>
            </div>
          )}
        </div>
        <div className="drawer-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={requestSave} disabled={changes.length === 0} style={changes.length === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> บันทึก{changes.length > 0 ? ` (${changes.length} เปลี่ยน)` : ""}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการแก้ไขข้อมูลจัดส่ง"
        description={`การเปลี่ยนแปลงนี้จะมีผลกับออร์เดอร์ ${order.id}`}
        changes={changes}
        action="บันทึก"
        onConfirm={doSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

/* ============ SLIP SCANNER (AI OCR + fuzzy customer match) ============ */

// Downscale a captured photo to a JPEG base64 string (48MP phone photos are far
// bigger than the model needs and slow to upload). Returns base64 + a preview URL.
async function slipFileToBase64(file, maxDim = 2048, quality = 0.92) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { base64: dataUrl.split(",")[1], dataUrl };
}

// Map a free-text courier name (TH or EN, possibly garbled) onto a known CARRIER.
function slipMatchCarrier(courier) {
  if (!courier) return "";
  const s = courier.toLowerCase();
  const table = [
    { keys: ["flash", "แฟลช"],                              name: "Flash Express" },
    { keys: ["kex", "kerry", "เคอรี", "เคอร์รี"],            name: "KEX" },
    { keys: ["j&t", "jt", "j and t", "เจแอนด์ที", "เจแอนด"], name: "J&T Express" },
    { keys: ["ไปรษณีย", "thai post", "thailand post", "ems"], name: "Thai Post (EMS)" },
    { keys: ["ninja", "นินจา"],                             name: "Ninja Van" },
    { keys: ["shopee", "ช้อปปี้", "spx"],                   name: "Shopee Express" },
    { keys: ["best", "เบสท์"],                              name: "Best Express" },
  ];
  for (const m of table) if (m.keys.some(k => s.includes(k))) return m.name;
  return courier.trim();
}

function SlipScanModal({ onClose, pushToast }) {
  // Match target = the label queue (คิวฉลาก). Each label awaiting a tracking
  // number is a pending shipment with a recipient name/phone + a linked order (soId).
  const pendingLabels = useMemoTrk(() => {
    const all = (typeof loadLabels === "function" ? loadLabels() : []);
    return all
      .filter(l => !l.tracking || l.tracking === "")
      .map(l => ({
        id: l.id,
        soId: l.soId || "",
        name: ((l.recipient && l.recipient.name) || "").trim(),
        phone: ((l.recipient && l.recipient.phone) || "").replace(/\D/g, ""),
      }))
      .filter(l => l.name);
  }, []);

  const [step, setStep] = useStateTrk("capture"); // capture | loading | result | error | done
  const [preview, setPreview] = useStateTrk("");
  const [statusMsg, setStatusMsg] = useStateTrk("");
  const [rows, setRows] = useStateTrk([]); // one row per detected parcel
  const [errMsg, setErrMsg] = useStateTrk("");
  const [saved, setSaved] = useStateTrk([]); // summary shown on the success screen
  const fileRef = useRefTrk(null);        // camera (capture)
  const galleryRef = useRefTrk(null);     // import from photo library / files

  // Resolve which pending label a parcel belongs to (matched name → exact, then phone).
  const resolveLabel = (p) => {
    if (p.matched_customer_name) {
      const byName = pendingLabels.find(l => l.name === p.matched_customer_name.trim());
      if (byName) return byName;
    }
    if (p.customer_phone && p.customer_phone.length >= 9) {
      const byPhone = pendingLabels.find(l => l.phone && l.phone.includes(p.customer_phone));
      if (byPhone) return byPhone;
    }
    return null;
  };

  const runScan = async (file) => {
    setStep("loading");
    setErrMsg("");
    try {
      setStatusMsg("กำลังย่อรูปภาพ…");
      const { base64, dataUrl } = await slipFileToBase64(file);
      setPreview(dataUrl);

      const { data: { session } } = await authGetSession();
      if (!session) { setErrMsg("กรุณาเข้าสู่ระบบใหม่"); setStep("error"); return; }

      setStatusMsg("AI กำลังอ่านสลิป…");
      const res = await fetch(SUPABASE_FUNC_URL + "/extract-slip", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
        body: JSON.stringify({
          image_base64: base64,
          mime_type: "image/jpeg",
          pending_customers: pendingLabels.map(l => ({ name: l.name, phone: l.phone })),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrMsg(json.error || `เกิดข้อผิดพลาด (${res.status})`);
        setStep("error");
        return;
      }
      const parcels = Array.isArray(json.parcels) ? json.parcels : [];
      setRows(parcels.map(p => {
        const match = resolveLabel(p);
        // Best-known phone: from the slip, else from the matched label.
        const phone = p.customer_phone || (match ? match.phone : "") || "";
        return {
          extractedName: p.extracted_name_from_slip || "",
          matchedName: p.matched_customer_name || null,
          confidence: p.confidence_score || 0,
          phone,                       // editable; flagged when empty
          courierRaw: p.courier || "",
          // No match in the คิวฉลาก → default to creating a new customer from the slip.
          labelId: match ? match.id : "__new__",
          newName: p.extracted_name_from_slip || "",
          carrier: slipMatchCarrier(p.courier),
          tracking: p.tracking_number || "",
          include: true,
        };
      }));
      setStep("result");
    } catch (e) {
      setErrMsg(e.message || "อ่านสลิปไม่สำเร็จ");
      setStep("error");
    }
  };

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (file) runScan(file);
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  // A row applies if it has a tracking number and either matches an existing
  // label or is set to create a new customer (with a name).
  const rowReady = (r) => r.include && r.tracking.trim() && (
    (r.labelId && r.labelId !== "__new__") ||
    (r.labelId === "__new__" && (r.newName || "").trim())
  );
  const applicable = rows.filter(rowReady);

  const applyAll = () => {
    if (!applicable.length) return;
    try {
      const all = (typeof loadLabels === "function" ? loadLabels() : []);
      const existingUpdates = {}; // existing labelId -> { tracking, carrier }
      const newLabels = [];
      const senderTemplate = (all[0] && all[0].sender) ? { ...all[0].sender } : { name: "", addr1: "", addr2: "", phone: "" };

      const summary = applicable.map((r, i) => {
        const tracking = r.tracking.trim();
        const phone = (r.phone || "").replace(/\D/g, "");
        if (r.labelId === "__new__") {
          // Create a brand-new label + order from the slip data.
          const id = "LBL-SCAN-" + Date.now() + "-" + i;
          const soId = "SO-" + Math.random().toString(36).slice(2, 8).toUpperCase();
          newLabels.push({
            id, soId,
            sender: senderTemplate,
            recipient: { name: (r.newName || "").trim(), addr1: "", addr2: "", phone },
            carrier: r.carrier || "Flash Express",
            tracking,
            cod: 0, weight: "0.5 kg", items: [],
          });
          setOrderField(soId, { carrier: r.carrier, tracking, status: "shipped", phone });
          recordChange({
            entity: "order", entityId: soId, action: "create",
            summary: `สแกนสลิป — สร้างลูกค้าใหม่ ${(r.newName || "").trim()}`.trim(),
            changes: [{ label: "เลขพัสดุ", to: tracking }, { label: "ขนส่ง", to: r.carrier || "—" }],
          });
          return { name: (r.newName || "").trim() || "(ลูกค้าใหม่)", tracking, carrier: r.carrier, phone, isNew: true };
        }
        // Existing label → update its tracking + carrier (+ phone if added) and mirror onto the order.
        const lbl = pendingLabels.find(l => l.id === r.labelId);
        const soId = lbl ? lbl.soId : "";
        const name = (lbl && lbl.name) || r.matchedName || r.extractedName || "";
        existingUpdates[r.labelId] = { tracking, carrier: r.carrier, phone };
        if (soId) setOrderField(soId, { carrier: r.carrier, tracking, status: "shipped", phone });
        recordChange({
          entity: "order", entityId: soId || r.labelId, action: "update",
          summary: `สแกนสลิป — ใส่เลขพัสดุ ${name}`.trim(),
          changes: [{ label: "เลขพัสดุ", to: tracking }, { label: "ขนส่ง", to: r.carrier || "—" }],
        });
        return { name, tracking, carrier: r.carrier, phone, isNew: false };
      });

      const updated = all.map(l => existingUpdates[l.id]
        ? {
            ...l,
            tracking: existingUpdates[l.id].tracking,
            carrier: existingUpdates[l.id].carrier || l.carrier,
            recipient: existingUpdates[l.id].phone
              ? { ...l.recipient, phone: existingUpdates[l.id].phone }
              : l.recipient,
          }
        : l).concat(newLabels);
      if (typeof saveLabels === "function") saveLabels(updated);

      pushToast(`บันทึกเลขพัสดุ ${summary.length} ชิ้นแล้ว`);
      setSaved(summary);
      setStep("done");
    } catch (e) {
      setErrMsg("บันทึกไม่สำเร็จ: " + (e.message || e));
      setStep("error");
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ width: "min(580px, 94vw)" }}>
        <div className="modal-head">
          <div>
            <h3>สแกนสลิปขนส่ง</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ถ่ายรูปสลิป/ใบเสร็จ — AI อ่านได้ทุกพัสดุในใบเดียว แล้วจับคู่ลูกค้าจากคิวฉลากให้อัตโนมัติ</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ maxHeight: "62vh", overflowY: "auto" }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPick} style={{ display: "none" }}/>
          <input ref={galleryRef} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }}/>

          {step === "capture" && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                <Icons.Camera size={28}/>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>สแกนสลิปขนส่ง</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
                จับคู่กับ <strong style={{ color: "var(--fg)" }}>{pendingLabels.length}</strong> ฉลากที่รอใส่เลขพัสดุ<br/>
                ถ่ายรูปหรือเลือกรูปสลิปจากเครื่อง — ให้เห็นชื่อผู้รับ เบอร์โทร และเลขพัสดุชัดเจน
              </div>
              <div className="row" style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={() => fileRef.current?.click()} style={{ padding: "10px 18px" }}>
                  <Icons.Camera size={15}/> ถ่ายรูป
                </button>
                <button className="btn" onClick={() => galleryRef.current?.click()} style={{ padding: "10px 18px" }}>
                  <Icons.Scan size={15}/> เลือกรูปจากเครื่อง
                </button>
              </div>
            </div>
          )}

          {step === "loading" && (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              {preview && <img src={preview} alt="" style={{ maxWidth: 200, maxHeight: 200, borderRadius: 12, marginBottom: 16, border: "1px solid var(--border)" }}/>}
              <div className="row" style={{ justifyContent: "center", gap: 10, color: "var(--muted)", fontSize: 13 }}>
                <style>{`@keyframes slipspin{to{transform:rotate(360deg)}}`}</style>
                <span style={{ width: 16, height: 16, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "slipspin 0.7s linear infinite", display: "inline-block" }}/> {statusMsg}
              </div>
            </div>
          )}

          {step === "error" && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--danger-soft)", color: "var(--danger)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
                <Icons.X size={26}/>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>อ่านสลิปไม่สำเร็จ</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 18 }}>{errMsg}</div>
              <button className="btn" onClick={() => { setStep("capture"); setPreview(""); }}>ลองใหม่</button>
            </div>
          )}

          {step === "done" && (
            <div style={{ padding: "20px 0" }}>
              <div style={{ textAlign: "center", marginBottom: 18 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
                  <Icons.Check size={28}/>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>บันทึกสำเร็จ {saved.length} ชิ้น</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>เลขพัสดุถูกบันทึกลงฉลาก (คิวฉลาก) และออร์เดอร์แล้ว</div>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {saved.map((s, i) => (
                  <div key={i} className="row" style={{ gap: 10, padding: 10, background: "var(--surface-2)", borderRadius: 10, alignItems: "center" }}>
                    <Icons.Check size={14} style={{ color: "var(--success)", flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{s.name || "—"}</span>
                        {s.isNew && <span className="badge badge-info" style={{ fontSize: 10 }}>ใหม่</span>}
                      </div>
                      <div className="row" style={{ gap: 6, fontSize: 12, color: "var(--muted)" }}>
                        <span>{s.carrier || "—"}</span><span>·</span><span className="mono">{s.tracking}</span>
                        {!s.phone && <span style={{ color: "var(--danger)", fontWeight: 600 }}>· * ตรวจไม่พบเบอร์</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "result" && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="row" style={{ gap: 14, alignItems: "center" }}>
                {preview && <img src={preview} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)", flexShrink: 0 }}/>}
                <div style={{ fontSize: 13 }}>
                  พบ <strong style={{ color: "var(--fg)" }}>{rows.length}</strong> พัสดุในสลิปนี้
                  {rows.length > 0 && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ตรวจสอบการจับคู่ แก้ไขได้ก่อนบันทึก</div>}
                </div>
              </div>

              {rows.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", background: "var(--surface-2)", borderRadius: 10, fontSize: 13, color: "var(--muted)" }}>
                  ไม่พบพัสดุในสลิป — ลองถ่ายให้ชัดและใกล้ขึ้น
                  <div style={{ marginTop: 12 }}><button className="btn btn-sm" onClick={() => { setStep("capture"); setPreview(""); }}>ถ่ายใหม่</button></div>
                </div>
              )}

              {rows.map((r, i) => {
                const conf = r.confidence || 0;
                const tone = conf >= 0.85 ? "success" : conf >= 0.6 ? "warning" : "danger";
                return (
                  <div key={i} style={{
                    padding: 12, borderRadius: 10,
                    background: r.include ? "var(--surface-2)" : "var(--surface)",
                    border: "1px solid " + (r.include ? "var(--border)" : "var(--border)"),
                    opacity: r.include ? 1 : 0.55,
                  }}>
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="badge badge-info" style={{ fontSize: 11 }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{r.extractedName || "ไม่ทราบชื่อ"}</span>
                      </div>
                      <label className="row" style={{ gap: 6, cursor: "pointer", fontSize: 12, color: "var(--muted)" }}>
                        <input type="checkbox" checked={r.include} onChange={e => setRow(i, { include: e.target.checked })}/>
                        บันทึก
                      </label>
                    </div>

                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                      <span className="eyebrow">จับคู่ลูกค้า (คิวฉลาก)</span>
                      {r.labelId === "__new__"
                        ? <span className="badge badge-info" style={{ fontSize: 11 }}><span className="dot"/>สร้างลูกค้าใหม่</span>
                        : r.labelId
                          ? <span className={"badge badge-" + (r.matchedName ? tone : "success")} style={{ fontSize: 11 }}><span className="dot"/>{r.matchedName ? "มั่นใจ " + Math.round(conf * 100) + "%" : "เลือกแล้ว"}</span>
                          : <span className="badge badge-danger" style={{ fontSize: 11 }}><span className="dot"/>ยังไม่เลือก</span>}
                    </div>
                    <select className="input" value={r.labelId} onChange={e => setRow(i, { labelId: e.target.value })} style={{ width: "100%", marginBottom: 8 }}>
                      <option value="">— ข้าม (ไม่บันทึก) —</option>
                      <option value="__new__">➕ สร้างลูกค้าใหม่จากสลิป</option>
                      {pendingLabels.length > 0 && <option disabled>──── ลูกค้าในคิวฉลาก ────</option>}
                      {pendingLabels.map(l => (
                        <option key={l.id} value={l.id}>{l.name}{l.phone ? " · " + l.phone : ""}{l.soId ? " · " + l.soId : ""}</option>
                      ))}
                    </select>

                    {r.labelId === "__new__" && (
                      <input className="input" value={r.newName} onChange={e => setRow(i, { newName: e.target.value })}
                        placeholder="ชื่อลูกค้าใหม่" style={{ width: "100%", marginBottom: 8, fontSize: 13 }}/>
                    )}

                    {/* Phone — editable; flag when the slip had none */}
                    <div style={{ marginBottom: 8 }}>
                      {!(r.phone || "").trim() && (
                        <div style={{ fontSize: 11, color: "var(--danger)", fontWeight: 600, marginBottom: 4 }}>* ตรวจไม่พบเบอร์ — กรุณากรอกเอง</div>
                      )}
                      <input className="input" value={r.phone} onChange={e => setRow(i, { phone: e.target.value })}
                        placeholder="เบอร์โทรผู้รับ"
                        style={{ width: "100%", fontFamily: "IBM Plex Mono, monospace", fontSize: 13, borderColor: !(r.phone || "").trim() ? "var(--danger)" : undefined }}/>
                    </div>

                    <div className="row" style={{ gap: 6 }}>
                      <select className="input" value={r.carrier} onChange={e => setRow(i, { carrier: e.target.value })} style={{ flex: "0 0 44%" }}>
                        <option value="">ขนส่ง…</option>
                        {CARRIERS.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                      <input className="input" value={r.tracking} onChange={e => setRow(i, { tracking: e.target.value })}
                        placeholder="เลขพัสดุ" style={{ flex: 1, fontFamily: "IBM Plex Mono, monospace", fontSize: 13, letterSpacing: "0.03em" }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-foot">
          {step === "done" ? (
            <button className="btn btn-primary" onClick={onClose} style={{ marginLeft: "auto" }}>
              <Icons.Check size={14}/> เสร็จสิ้น
            </button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>ยกเลิก</button>
              {step === "result" && rows.length > 0 && (
                <button className="btn btn-primary" onClick={applyAll} disabled={!applicable.length} style={!applicable.length ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
                  <Icons.Check size={14}/> บันทึกเลขพัสดุ ({applicable.length})
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ============ SHARE LINK MODAL ============ */

function ShareLinkModal({ store, onClose, pushToast }) {
  const [dateMode, setDateMode] = useStateTrk("all"); // all | today | custom
  const [customDate, setCustomDate] = useStateTrk(TODAY_ISO);
  const [copied, setCopied] = useStateTrk(false);

  const dateForUrl =
    dateMode === "today" ? TODAY_ISO :
    dateMode === "custom" ? customDate :
    null;

  const base = window.location.origin + window.location.pathname;
  const url = base + "#track" + (dateForUrl ? "/" + dateForUrl : "");

  // Count orders for the chosen date (live preview)
  const orders = useOrders();
  const matchingCount =
    !dateForUrl ? orders.length :
    orders.filter(o => o.dateIso === dateForUrl).length;

  // Reset copied flag whenever the URL changes
  useEffectTrk(() => { setCopied(false); }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      pushToast("คัดลอกลิงก์แล้ว");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      pushToast("กรุณาคัดลอกลิงก์ด้วยตัวเอง");
    }
  };

  const openPreview = () => window.open(url, "_blank", "noopener");

  // Print the tracking QR at A6 so it can go on a poster / parcel. Uses the real
  // qrSvgMarkup encoder (icons.jsx) so the printed code actually scans to `url`.
  const printQr = () => {
    const svg = (typeof qrSvgMarkup === "function") ? qrSvgMarkup(url, 480) : "";
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) { pushToast("เบราว์เซอร์บล็อกหน้าต่างพิมพ์"); return; }
    const name = (store && store.name) || "คลังพร้อมส่ง";
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>QR ${name}</title>
      <style>
        @page { size: A6; margin: 6mm; }
        html,body { margin:0; padding:0; }
        body { font-family:'IBM Plex Sans Thai',system-ui,sans-serif; text-align:center; padding:8mm 6mm; color:#111; }
        h1 { font-size:18px; margin:0 0 5mm; }
        .qr { width:72mm; height:72mm; margin:0 auto 4mm; }
        .qr svg { width:100%; height:100%; display:block; }
        .hint { font-size:13px; color:#444; margin-bottom:3mm; }
        .url { font-family:'IBM Plex Mono',monospace; font-size:10px; word-break:break-all; color:#666; }
      </style></head>
      <body onload="window.focus();window.print();">
        <h1>${name}</h1>
        <div class="qr">${svg}</div>
        <div class="hint">สแกนเพื่อติดตามพัสดุของคุณ</div>
        <div class="url">${url}</div>
      </body></html>`);
    w.document.close();
  };

  const dateLabel =
    dateMode === "today" ? `วันนี้ (${isoToThai(TODAY_ISO)})` :
    dateMode === "custom" ? isoToThai(customDate) :
    "ทุกออร์เดอร์";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ width: 580 }}>
        <div className="modal-head">
          <div>
            <h3>ลิงก์ค้นหาของลูกค้า</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ส่งลิงก์นี้ให้ลูกค้าเพื่อให้ค้นหาสถานะพัสดุของตัวเอง</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body">

          {/* Date scope picker */}
          <div className="eyebrow" style={{ marginBottom: 10 }}>ขอบเขตของลิงก์</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            <DateModeBtn icon={<Icons.Pkg size={14}/>}     label="ทุกออร์เดอร์" sub="ไม่จำกัดวัน" active={dateMode === "all"}    onClick={() => setDateMode("all")}/>
            <DateModeBtn icon={<Icons.Dot size={14}/>}     label="วันนี้"       sub={isoToThai(TODAY_ISO)} active={dateMode === "today"}  onClick={() => setDateMode("today")}/>
            <DateModeBtn icon={<Icons.Calendar size={14}/>}label="ระบุวัน"     sub={dateMode === "custom" ? isoToThai(customDate) : "เลือกวันที่"} active={dateMode === "custom"} onClick={() => setDateMode("custom")}/>
          </div>

          {dateMode === "custom" && (
            <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 12, marginBottom: 14, border: "1px solid var(--border)" }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <Icons.Calendar size={16} style={{ color: "var(--muted)" }}/>
                <input
                  type="date"
                  value={customDate}
                  onChange={e => setCustomDate(e.target.value)}
                  className="input"
                  style={{ flex: 1, padding: "8px 12px", fontSize: 14 }}
                />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{isoToThai(customDate)}</span>
              </div>
              <div className="row" style={{ gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--muted)", marginRight: 4 }}>เลือกด่วน:</span>
                {[
                  { iso: TODAY_ISO, label: "วันนี้" },
                  { iso: "2026-05-18", label: "เมื่อวาน" },
                  { iso: "2026-05-16", label: "16 พ.ค." }
                ].map(d => (
                  <button key={d.iso} className={"btn btn-sm" + (customDate === d.iso ? " btn-primary" : "")} style={{ padding: "3px 9px", fontSize: 11 }} onClick={() => setCustomDate(d.iso)}>{d.label}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>ลิงก์นี้ครอบคลุม: <strong style={{ color: "var(--fg)" }}>{dateLabel}</strong></span>
            <span><strong className="tnum" style={{ color: "var(--fg)" }}>{matchingCount}</strong> ออร์เดอร์</span>
          </div>

          {/* URL row */}
          <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 14, marginBottom: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>ลิงก์ของคุณ</div>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="mono" style={{
                flex: 1,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 12,
                color: "var(--fg)",
                wordBreak: "break-all",
                userSelect: "all"
              }}>{url}</div>
              <button className="btn btn-primary" onClick={copy} style={{ flexShrink: 0 }}>
                {copied ? <><Icons.Check size={14}/> คัดลอกแล้ว</> : <><Icons.Copy size={14}/> คัดลอก</>}
              </button>
            </div>
          </div>

          {/* QR + tips */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, marginBottom: 18, alignItems: "center" }}>
            <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
              <QR value={url} size={120}/>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>QR Code สำหรับโปสเตอร์หรือซองพัสดุ</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                พิมพ์ QR ไว้บนซองสินค้าหรือใส่ในข้อความขอบคุณ ลูกค้าสแกนแล้วเข้าหน้าค้นหาได้ทันที — ไม่ต้องล็อกอิน
              </div>
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={printQr}><Icons.Print size={12}/> พิมพ์ QR ขนาด A6</button>
            </div>
          </div>

          <div className="eyebrow" style={{ marginBottom: 8 }}>ตัวอย่างข้อความที่ส่งให้ลูกค้า</div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.7 }}>
            สวัสดีค่ะ {dateForUrl ? "ออร์เดอร์ที่จัดส่งวัน" + isoToThai(dateForUrl) : "ออร์เดอร์ของคุณจาก"} <strong>{store?.name || "คลังพร้อมส่ง"}</strong> 🎉<br/>
            ติดตามสถานะพัสดุของคุณได้ที่:<br/>
            <span className="mono" style={{ color: "var(--accent)", fontSize: 12 }}>{url}</span><br/>
            กรอกชื่อหรือเบอร์โทรที่ใช้สั่งซื้อเพื่อดูสถานะการจัดส่งได้ตลอด 24 ชม.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={openPreview}><Icons.Eye size={14}/> ดูตัวอย่างหน้าจริง</button>
          <button className="btn btn-primary" onClick={copy}>
            {copied ? <><Icons.Check size={14}/> คัดลอกแล้ว</> : <><Icons.Copy size={14}/> คัดลอกลิงก์</>}
          </button>
        </div>
      </div>
    </>
  );
}

function DateModeBtn({ icon, label, sub, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="btn"
      style={{
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
        padding: "10px 12px",
        background: active ? "var(--accent-soft)" : "var(--surface)",
        borderColor: active ? "var(--accent)" : "var(--border)",
        lineHeight: 1.2
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: active ? "var(--accent)" : "var(--fg-2)" }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--accent)" : "var(--fg)" }}>{label}</span>
        {active && <Icons.Check size={11} style={{ marginLeft: "auto" }}/>}
      </span>
      <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>{sub}</span>
    </button>
  );
}

/* ============ CUSTOMER LOOKUP (public, no login) ============ */

function CustomerLookup() {
  const [store, setStore] = useStateTrk(() => {
    if (window._DB_STORE) return { ...DEFAULT_STORE, ...window._DB_STORE };
    try { return { ...DEFAULT_STORE, ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch { return DEFAULT_STORE; }
  });

  // Public store branding — anon customers have no localStorage copy of the store
  // settings, so fetch the public-safe fields (name/logo/tagline/phone, no address)
  // from the store-info Edge Function so the page shows real branding, not defaults.
  useEffectTrk(() => {
    if (typeof SUPABASE_FUNC_URL !== "string") return;
    fetch(SUPABASE_FUNC_URL + "/store-info")
      .then(r => r.json())
      .then(j => {
        if (j && j.success && j.store && j.store.name) {
          setStore(prev => ({
            ...prev,
            name: j.store.name || prev.name,
            logo: j.store.logo || prev.logo,
            tagline: j.store.tagline || prev.tagline,
            sender: { ...prev.sender, phone: j.store.phone || prev.sender?.phone },
          }));
        }
      })
      .catch(() => {});
  }, []);

  const [q, setQ] = useStateTrk("");
  const [searched, setSearched] = useStateTrk(false);
  const [selected, setSelected] = useStateTrk(null);
  const [overrides, setOverrides] = useStateTrk(() => loadOrderOverrides());
  const inputRef = useRefTrk(null);

  // Parse date from URL hash (#track/2026-05-19)
  const parseDateFromHash = () => {
    const parts = window.location.hash.replace("#", "").split("/");
    const candidate = parts[1];
    if (candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
    return null;
  };
  const [dateFilter, setDateFilter] = useStateTrk(() => parseDateFromHash());

  const [dbOrders, setDbOrders] = useStateTrk(null); // null = not loaded yet
  const [dbLabels, setDbLabels] = useStateTrk(null);  // shipments from the label queue
  const [, bumpLabelsCL] = useStateTrk(0);

  useEffectTrk(() => {
    inputRef.current?.focus();
    const h = () => setOverrides(loadOrderOverrides());
    window.addEventListener("ims-orders-change", h);
    const lh = () => bumpLabelsCL(v => v + 1);
    window.addEventListener("ims-labels-change", lh);
    const hh = () => setDateFilter(parseDateFromHash());
    window.addEventListener("hashchange", hh);

    // Sync any preserved orders to Supabase once auth is available so the
    // track-lookup Edge Function can serve them to anonymous customers too.
    syncPreservedOrdersToDb();

    // Load real orders from Supabase (anon read — no login needed)
    if (window.sb) {
      window.sb.from("orders")
        .select("*")
        .order("created_at", { ascending: false })
        .then(({ data, error }) => {
          if (!error && data) {
            setDbOrders(data.map(row => ({
              id: row.id, channel: row.channel || "", customer: row.customer || "",
              phone: row.phone || "", status: row.status || "picking",
              carrier: row.carrier || "", tracking: row.tracking || "",
              items: row.item_count ?? 0, isBundle: row.is_bundle || false,
              bundleName: row.bundle_name || "", note: row.note || "",
              dateIso: row.date_iso || row.created_at?.slice(0, 10) || "",
              date: isoToThai(row.date_iso || row.created_at?.slice(0, 10) || ""),
              ts: row.created_at
                ? new Date(row.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
                : ""
            })));
          }
        });

      // Load shipments from the label queue (so customers can track label-only orders).
      // Returns [] for anon unless the labels table allows anon read.
      window.sb.from("labels").select("data").then(({ data, error }) => {
        if (!error && data) setDbLabels(data.map(r => r.data).filter(Boolean));
      });
    }

    return () => {
      window.removeEventListener("ims-orders-change", h);
      window.removeEventListener("ims-labels-change", lh);
      window.removeEventListener("hashchange", hh);
    };
  }, []);

  // Use real Supabase orders when loaded, fall back to bundled OUTBOUND demo data
  const baseOrders = dbOrders !== null ? dbOrders : OUTBOUND;
  // Merge in label-queue shipments (local labels + any loaded from Supabase), deduped.
  const labelObjs = [];
  const labelSeen = new Set();
  [(typeof loadLabels === "function" ? loadLabels() : []), dbLabels || []].forEach(arr =>
    arr.forEach(l => { if (l && l.id && !labelSeen.has(l.id)) { labelSeen.add(l.id); labelObjs.push(l); } }));
  const orderSeen = new Set(baseOrders.map(o => o.id));
  const labelOrders = labelObjs.map(labelToOrder).filter(o => {
    if (orderSeen.has(o.id)) return false; orderSeen.add(o.id); return true;
  });
  // Include orders whose source label was deleted — they exist only in localStorage /
  // Supabase orders table; they must not be lost from the customer-facing search.
  const preservedSeen = new Set(orderSeen);
  const preservedOrders = loadPreservedOrders().filter(o => {
    if (preservedSeen.has(o.id)) return false; preservedSeen.add(o.id); return true;
  });
  const orders = [...baseOrders, ...labelOrders, ...preservedOrders].map(o => ({ ...o, ...(overrides[o.id] || {}) }));
  const dateFilteredOrders = dateFilter ? orders.filter(o => o.dateIso === dateFilter) : orders;

  // Results from the public track-lookup Edge Function (works for anon customers
  // who have no direct DB access). Server-side filtered + phone-masked.
  const [apiResults, setApiResults] = useStateTrk(null);

  const search = () => {
    setSearched(true);
    setSelected(null);
    const query = q.trim();
    if (query.length >= 3 && typeof SUPABASE_FUNC_URL === "string") {
      fetch(SUPABASE_FUNC_URL + "/track-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      })
        .then(r => r.json())
        .then(j => {
          if (j && j.success && Array.isArray(j.results)) {
            setApiResults(j.results.map(o => ({ ...o, date: o.dateIso ? isoToThai(o.dateIso) : "", ts: "" })));
          } else setApiResults([]);
        })
        .catch(() => setApiResults([]));
    }
  };

  const clearDateFilter = () => {
    setDateFilter(null);
    window.history.replaceState(null, "", window.location.pathname + "#track");
  };

  const matches = useMemoTrk(() => {
    if (!searched || !q.trim()) return [];
    const local = dateFilteredOrders.filter(o => orderMatchesQuery(o, q));
    // Merge Edge-Function results (deduped) so anon customers see their parcels too.
    const seen = new Set(local.map(o => o.id + "|" + o.tracking));
    const merged = [...local];
    (apiResults || []).forEach(o => {
      const key = o.id + "|" + o.tracking;
      if (seen.has(key)) return;
      if (dateFilter && o.dateIso && o.dateIso !== dateFilter) return;
      seen.add(key);
      merged.push(o);
    });
    return merged;
  }, [q, searched, overrides, dateFilter, apiResults]);

  if (selected) return <CustomerOrderDetail order={selected} store={store} onBack={() => setSelected(null)}/>;

  const isToday = dateFilter === TODAY_ISO;

  return (
    <div className="auth-page" style={{ alignItems: "flex-start", paddingTop: 60, paddingBottom: 40 }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        {/* Branded header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <StoreLogoMark store={store} size={56}/>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "8px 0 4px" }}>{store.name}</h1>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>ติดตามสถานะพัสดุของคุณได้ตลอด 24 ชม.</div>
        </div>

        {/* Date scope banner */}
        {dateFilter && (
          <div style={{
            background: isToday ? "linear-gradient(135deg, var(--accent), oklch(0.45 0.22 252))" : "linear-gradient(135deg, var(--fg), oklch(0.16 0.01 250))",
            color: "white",
            borderRadius: 14,
            padding: "14px 18px",
            marginBottom: 16,
            display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 12px 28px oklch(0.3 0.1 252 / 0.18)"
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "oklch(1 0 0 / 0.2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icons.Calendar size={18}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: "0.06em", textTransform: "uppercase" }}>สรุปการจัดส่งประจำวัน</div>
              <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", marginTop: 1 }}>
                {isToday ? "วันนี้ · " : ""}{isoToThai(dateFilter)}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                {dateFilteredOrders.length === 0 ? "ไม่มีออร์เดอร์ในวันนี้" : `${dateFilteredOrders.length} ออร์เดอร์ในวันที่นี้ — ค้นหาด้วยเบอร์หรือชื่อด้านล่าง`}
              </div>
            </div>
            <button onClick={clearDateFilter} className="btn btn-sm" style={{ background: "oklch(1 0 0 / 0.15)", color: "white", border: "1px solid oklch(1 0 0 / 0.2)", flexShrink: 0 }}>
              ดูทุกวัน
            </button>
          </div>
        )}

        <div className="auth-card" style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>ค้นหาพัสดุของคุณ</h2>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>กรอก <strong>เบอร์โทรศัพท์</strong> หรือ <strong>ชื่อ</strong> ที่ใช้สั่งซื้อ</div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); search(); }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div className="search" style={{ flex: 1, width: "auto", padding: "12px 16px" }}>
                <Icons.Search size={16}/>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="เช่น 081-552-0917 หรือ ปิยะนุช"
                  style={{ fontSize: 15 }}
                />
                {q && <Icons.X size={14} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => { setQ(""); setSearched(false); inputRef.current?.focus(); }}/>}
              </div>
              <button type="submit" className="btn btn-accent" disabled={!q.trim()} style={{ padding: "12px 22px", fontSize: 14 }}>
                ค้นหา
              </button>
            </div>
          </form>

          {!searched && (
            <div style={{ marginTop: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>ตัวอย่างรูปแบบการค้นหา</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* Mock format hints only — must NOT expose real customer data on this public page */}
                {[
                  { icon: <Icons.Search size={11}/>, text: "08X-XXX-XXXX" },
                  { icon: <Icons.Search size={11}/>, text: "ชื่อ-นามสกุล" },
                ].map(s => (
                  <span key={s.text} className="btn btn-sm" style={{ cursor: "default", opacity: 0.7 }}>
                    {s.icon} {s.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          {searched && (
            <div style={{ marginTop: 24 }}>
              {matches.length === 0 ? (
                <div style={{ padding: 36, textAlign: "center", background: "var(--surface-2)", borderRadius: 14 }}>
                  <Icons.Search size={32} style={{ color: "var(--muted)", opacity: 0.5, marginBottom: 10 }}/>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>ไม่พบพัสดุที่ตรงกับ "{q}"{dateFilter && " ในวันที่ " + isoToThai(dateFilter)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
                    ตรวจสอบเบอร์โทรหรือชื่อให้ตรงกับที่ใช้ตอนสั่งซื้อ<br/>
                    หากต้องการความช่วยเหลือ ติดต่อ <a className="lnk" href="#">{store.sender?.phone || "02-555-0188"}</a>
                  </div>
                  {dateFilter && (
                    <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={clearDateFilter}>
                      <Icons.Refresh size={12}/> ค้นหาในทุกวัน
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>พบพัสดุ <strong style={{ color: "var(--fg)" }}>{matches.length}</strong> รายการที่ตรงกับ "{q}"{dateFilter && ` (วันที่ ${isoToThai(dateFilter)})`}</div>
                  <div className="stack" style={{ gap: 10 }}>
                    {matches.map(o => <CustomerOrderCard key={o.id} order={o} onOpen={() => setSelected(o)}/>)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ marginTop: 28, textAlign: "center", fontSize: 12, color: "var(--muted)" }}>
          <div>หากต้องการความช่วยเหลือ ติดต่อ <a className="lnk" href={`tel:${store.sender?.phone}`}>{store.sender?.phone || "02-555-0188"}</a></div>
          <div style={{ marginTop: 8 }}>© {new Date().getFullYear()} {store.name}</div>
        </div>
      </div>
    </div>
  );
}

function CustomerOrderCard({ order, onOpen }) {
  const idx = stageIndex(order.status);
  const stage = TRACK_STAGES[idx] || TRACK_STAGES[0];
  const Icon = stage.icon;
  const carrierMeta = carrierMetaFor(order.carrier);
  return (
    <button onClick={onOpen} style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 14,
      padding: 16,
      width: "100%",
      cursor: "pointer",
      textAlign: "left",
      fontFamily: "inherit",
      color: "var(--fg)",
      display: "flex", alignItems: "center", gap: 14,
      transition: "transform 0.08s, box-shadow 0.12s"
    }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: carrierMeta.color || "var(--surface-2)", color: carrierMeta.color ? "white" : "var(--fg-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon size={20}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8, justifyContent: "space-between" }}>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{order.id}</span>
          <span className={"badge " + (idx === 3 ? "badge-success" : idx === 2 ? "badge-info" : "badge-warning")} style={{ fontSize: 11 }}>
            <span className="dot"/>{stage.label}
          </span>
        </div>
        <div style={{ fontSize: 13, marginTop: 4 }}>{order.customer}</div>
        <div className="row" style={{ gap: 8, marginTop: 4, fontSize: 11, color: "var(--muted)" }}>
          <span>{order.carrier}</span>
          {order.tracking && <><span>·</span><span className="mono">{order.tracking}</span></>}
          <span>·</span><span>{order.date}</span>
        </div>
      </div>
      <Icons.Chev size={14} style={{ color: "var(--muted)", flexShrink: 0 }}/>
    </button>
  );
}

function CustomerOrderDetail({ order, store, onBack }) {
  const idx = stageIndex(order.status);
  const carrierMeta = carrierMetaFor(order.carrier);

  const baseDate = order.date || "—";
  // Estimate delivery 2 calendar days after the ship date
  const estimatedDelivery = (() => {
    if (!order.dateIso) return "—";
    const [y, m, d] = order.dateIso.split("-").map(Number);
    const dt = new Date(y, m - 1, d + 2);
    return "ประมาณ " + isoToThai([dt.getFullYear(), String(dt.getMonth()+1).padStart(2,"0"), String(dt.getDate()).padStart(2,"0")].join("-"));
  })();
  const timeline = [
    { stage: 0, time: "",             date: baseDate,          note: "ได้รับคำสั่งซื้อจาก " + (order.channel || "ฉลาก") },
    { stage: 1, time: "",             date: baseDate,          note: "พนักงานหยิบสินค้าเสร็จ" },
    { stage: 2, time: order.ts || "", date: baseDate,          note: "ส่งมอบให้ " + (order.carrier || "ขนส่ง") },
    { stage: 3, time: "",             date: estimatedDelivery, note: "อยู่ระหว่างนำส่งโดยผู้จัดส่ง" }
  ];

  // Carrier tracking deep-link map
  const CARRIER_URLS = {
    "KEX":             t => `https://th.kex-express.com/th/track/?track=${t}`,
    "Flash Express":   t => `https://www.flashexpress.co.th/fle/tracking/?se=${t}`,
    "J&T Express":     t => `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${t}`,
    "Thai Post (EMS)": t => `https://track.thailandpost.co.th/?trackNumber=${t}`,
    "Ninja Van":       t => `https://www.ninjavan.co/th-th/tracking?id=${t}`,
    "Shopee Express":  t => `https://spx.co.th/`,
    "Best Express":    t => `https://www.best-inc-th.com/track/defaultSearch?logisticNo=${t}`,
    "DHL":             t => `https://www.dhl.com/th-th/home/tracking.html?tracking-id=${t}`,
    "Alpha Fast":      t => `https://www.alphafast.com/`,
  };
  const trackUrl = order.tracking && order.carrier && CARRIER_URLS[order.carrier]
    ? CARRIER_URLS[order.carrier](encodeURIComponent(order.tracking))
    : null;

  return (
    <div className="auth-page" style={{ alignItems: "flex-start", paddingTop: 40, paddingBottom: 40 }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <button onClick={onBack} className="btn" style={{ marginBottom: 18, background: "oklch(1 0 0 / 0.7)", backdropFilter: "blur(10px)" }}>
          <Icons.Chev size={14} style={{ transform: "rotate(180deg)" }}/> กลับไปค้นหา
        </button>

        <div className="auth-card" style={{ maxWidth: 640, padding: 32 }}>
          <div className="row" style={{ gap: 14, marginBottom: 20 }}>
            <StoreLogoMark store={store} size={44}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{store.name}</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{order.id}</div>
            </div>
            <span className={"badge " + (idx === 3 ? "badge-success" : "badge-info")} style={{ fontSize: 12, padding: "4px 10px" }}>
              <span className="dot"/>{TRACK_STAGES[idx].label}
            </span>
          </div>

          {/* Tracking number prominent */}
          <div style={{ padding: 20, background: "linear-gradient(135deg, var(--fg), oklch(0.12 0.01 250))", color: "oklch(0.99 0.003 250)", borderRadius: 16, marginBottom: 20 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase" }}>เลขพัสดุ</span>
              {order.carrier && <span className="row" style={{ gap: 6, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: carrierMeta.color || "white" }}/>
                {order.carrier}
              </span>}
            </div>
            {order.tracking ? (
              <div className="mono" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "0.04em" }}>{order.tracking}</div>
            ) : (
              <div style={{ fontSize: 14, opacity: 0.7 }}>ยังไม่ได้ระบุเลขพัสดุ — กำลังจัดเตรียม</div>
            )}
            {order.tracking && (
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-sm" style={{ background: "oklch(1 0 0 / 0.15)", color: "white", border: "1px solid oklch(1 0 0 / 0.2)" }} onClick={() => navigator.clipboard?.writeText(order.tracking)}>
                  <Icons.Copy size={12}/> คัดลอกเลขพัสดุ
                </button>
                {trackUrl && (
                  <a href={trackUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "var(--accent)", color: "white", borderRadius: 8, fontSize: 12, fontWeight: 500, textDecoration: "none", fontFamily: "inherit" }}>
                    <Icons.Truck size={12}/> ติดตามที่ {order.carrier}
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="eyebrow" style={{ marginBottom: 14 }}>ไทม์ไลน์การจัดส่ง</div>
          <div style={{ position: "relative" }}>
            {timeline.map((step, i) => {
              const past = step.stage <= idx;
              const isCurrent = step.stage === idx;
              const StageIcon = TRACK_STAGES[step.stage].icon;
              return (
                <div key={i} style={{ display: "flex", gap: 14, marginBottom: i < timeline.length - 1 ? 16 : 0, position: "relative" }}>
                  {i < timeline.length - 1 && (
                    <div style={{
                      position: "absolute",
                      left: 17, top: 36, bottom: -16,
                      width: 2,
                      background: past ? "var(--success)" : "var(--border)"
                    }}/>
                  )}
                  <div style={{
                    width: 36, height: 36,
                    borderRadius: 999,
                    background: past ? (isCurrent ? "var(--accent)" : "var(--success)") : "var(--surface-3)",
                    color: past ? "white" : "var(--muted)",
                    display: "grid", placeItems: "center",
                    flexShrink: 0,
                    boxShadow: isCurrent ? "0 0 0 4px var(--accent-ring)" : "none",
                    zIndex: 1
                  }}>
                    {past ? <Icons.Check size={14} stroke={2.2}/> : <StageIcon size={14}/>}
                  </div>
                  <div style={{ flex: 1, paddingTop: 6 }}>
                    <div style={{ fontWeight: isCurrent ? 600 : 500, fontSize: 14, color: past ? "var(--fg)" : "var(--muted)" }}>
                      {TRACK_STAGES[step.stage].label}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{step.note}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{step.date}{step.time ? " · " + step.time : ""}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Order summary */}
          <div className="divider" style={{ margin: "24px 0" }}/>
          <div className="eyebrow" style={{ marginBottom: 10 }}>สรุปคำสั่งซื้อ</div>
          <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>ชื่อผู้รับ</span>
              <span style={{ fontWeight: 500 }}>{order.customer}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>เบอร์ติดต่อ</span>
              <span className="mono">{order.phone}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>ช่องทางสั่งซื้อ</span>
              <span>{order.channel}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", padding: "4px 0", fontSize: 13 }}>
              <span style={{ color: "var(--muted)" }}>จำนวนสินค้า</span>
              <span><strong className="tnum">{order.items}</strong> รายการ</span>
            </div>
          </div>

          {/* Help footer */}
          <div style={{ marginTop: 20, padding: 14, background: "var(--info-soft)", color: "var(--fg-2)", borderRadius: 12, fontSize: 12, lineHeight: 1.6 }}>
            มีคำถามเกี่ยวกับพัสดุนี้? ติดต่อ {store.name} ที่ <a className="lnk" href={`tel:${store.sender?.phone}`}>{store.sender?.phone || "02-555-0188"}</a>
            {trackUrl
              ? <><br/>หรือ <a className="lnk" href={trackUrl} target="_blank" rel="noopener noreferrer">ตรวจสอบสถานะที่เว็บไซต์ {order.carrier}</a></>
              : order.carrier ? <><br/>หรือนำเลขพัสดุไปตรวจสอบที่เว็บไซต์ของ {order.carrier}</> : null
            }
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TrackingPage, CustomerLookup, useOrders, buildOrders, setOrderField, saveOrderEdit, deleteOrdersFromDb, SlipScanModal, labelToOrder, loadPreservedOrders, savePreservedOrder });
