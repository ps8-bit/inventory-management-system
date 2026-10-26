/* Change confirmation + audit log */

const { useState: useStateAud, useEffect: useEffectAud, useMemo: useMemoAud } = React;

const AUDIT_KEY = "ims_audit_log";

const AUDIT_PAGE = 200;          // rows pulled per "โหลดเพิ่ม"
let _auditPageBusy = false;      // one in-flight page at a time

function loadAuditLog() {
  if (window._DB_AUDIT_LOG) return window._DB_AUDIT_LOG;
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]"); }
  catch { return []; }
}

/* ---- Paging further back than the newest page ----
   dbInit loads the newest 500 rows into window._DB_AUDIT_LOG. Everything older
   still lives in the DB, so the history screens page back on demand:
     loadMoreAuditLog()  appends the next 200 older rows to the shared cache
     loadAuditDay(key)   fetches ONE Bangkok day, however deep it sits
   _AUDIT_END marks "the bottom of the log is loaded"; _AUDIT_TOTAL is the row
   count in the DB, used for the "แสดง X จาก Y" hint. */

function auditHasMore() {
  if (!window._DB_AUDIT_LOG) return false;   // offline/localStorage-only — nothing to page
  if (window._AUDIT_END) return false;
  if (typeof window._AUDIT_TOTAL === "number") return window._DB_AUDIT_LOG.length < window._AUDIT_TOTAL;
  return true;
}

async function loadMoreAuditLog(n) {
  const cur = window._DB_AUDIT_LOG;
  const want = n || AUDIT_PAGE;
  if (_auditPageBusy || !cur || window._AUDIT_END || typeof dbLoadAuditLog !== "function") return 0;
  _auditPageBusy = true;
  try {
    // Anchor on the oldest DB-backed id (numeric); entries recorded locally but
    // not yet synced carry a random string id and can't be used as a cursor.
    let before = null;
    for (let i = cur.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(String(cur[i].id))) { before = { id: Number(cur[i].id) }; break; }
    }
    if (!before && cur.length) before = { ts: cur[cur.length - 1].ts };
    const older = await dbLoadAuditLog(want, before);
    if (!older) return 0;                              // network/RLS error — don't claim the end
    if (older.length < want) window._AUDIT_END = true;
    const seen = new Set(cur.map(e => String(e.id)));
    const fresh = older.filter(e => !seen.has(String(e.id)));
    if (fresh.length) {
      window._DB_AUDIT_LOG = cur.concat(fresh);
      window.dispatchEvent(new CustomEvent("ims-audit-change"));
    }
    return fresh.length;
  } finally { _auditPageBusy = false; }
}

// A single day's entries. Kept OUT of the shared cache on purpose — that array
// must stay a contiguous newest-first run, or the realtime refresh would drop
// the merged-in old day anyway.
async function loadAuditDay(dateKey) {
  if (typeof dbLoadAuditDay === "function") {
    const rows = await dbLoadAuditDay(dateKey);
    if (rows) return rows;
  }
  return loadAuditLog().filter(e => bangkokDateOf(e.ts) === dateKey);
}

// The DB row count for display — never smaller than what's already in hand. A
// count that failed or came back RLS-filtered would otherwise render the
// nonsense "แสดง 5 รายการ จากทั้งหมด 0". null = unknown, so show nothing.
function auditTotal(loaded) {
  const t = window._AUDIT_TOTAL;
  if (typeof t !== "number") return null;
  return Math.max(t, loaded || 0);
}

async function refreshAuditTotal() {
  if (typeof dbCountAuditLog !== "function") return null;
  const n = await dbCountAuditLog();
  if (typeof n === "number") {
    window._AUDIT_TOTAL = n;
    window.dispatchEvent(new CustomEvent("ims-audit-change"));
  }
  return n;
}

function recordChange(entry) {
  const user = window.__currentUser || { name: "ระบบ", role: "system", avatar: "?", id: 0 };
  const row = {
    id: Math.random().toString(36).slice(2, 11),
    ts: new Date().toISOString(),
    user: { id: user.id, name: user.name, role: user.role, avatar: user.avatar },
    // The database stamps the same login (auth.uid()) — mirror it so this
    // device's own new entries show the verified name before the next reload.
    actorId: /^[0-9a-f-]{36}$/i.test(String(user.id || "")) ? String(user.id) : null,
    ...entry
  };

  /* Update in-memory cache immediately so the UI reflects the change before
     the Supabase real-time event arrives */
  if (window._DB_AUDIT_LOG) {
    // Never trim below what's already loaded — the user may have paged back
    // through several hundred older rows that must survive this insert.
    const cap = Math.max(500, window._DB_AUDIT_LOG.length + 1);
    window._DB_AUDIT_LOG = [row, ...window._DB_AUDIT_LOG].slice(0, cap);
    if (typeof window._AUDIT_TOTAL === "number") window._AUDIT_TOTAL += 1;
  } else {
    const log = (() => { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]"); } catch { return []; } })();
    log.unshift(row);
    if (log.length > 500) log.length = 500;
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(log)); } catch (e) {}
  }

  window.dispatchEvent(new CustomEvent("ims-audit-change"));
  _queueAuditInsert(row);
}

/* ── Batched insert ──
   applyStockAdjustmentBatch (and the stock take / receiving loops) call
   recordChange once per sku in a tight loop. Firing one HTTP insert each meant N
   requests racing, and the server stamps created_at on arrival — so the history
   showed a batch shuffled, which reads like a duplicate even when the numbers
   are right. Coalescing a burst into ONE insert keeps the batch in order (and
   turns N requests into 1). The in-memory cache above is already updated, so
   deferring by a tick costs the UI nothing. */
let _auditQueue = [];
let _auditTimer = null;
function _flushAuditInserts() {
  _auditTimer = null;
  const batch = _auditQueue;
  _auditQueue = [];
  if (!batch.length || !window.dbInsertAuditEntry) return;
  dbInsertAuditEntry(batch).catch(() => {});
}
/* Window, not a microtask: a multi-sku ปรับสต็อก now records each row when ITS
   RPC answers (so the numbers are the server's, not the device's guess), and
   those answers land tens to hundreds of ms apart. A short window still gathers
   the whole batch into one ordered insert. The local cache is updated
   synchronously by recordChange, so nothing is delayed on screen. */
const AUDIT_BATCH_MS = 400;
function _queueAuditInsert(row) {
  if (!window.dbInsertAuditEntry) return;
  _auditQueue.push(row);
  if (_auditTimer) return;
  _auditTimer = setTimeout(_flushAuditInserts, AUDIT_BATCH_MS);
}
// A tab closing mid-window would drop the pending rows — flush them first.
window.addEventListener("pagehide", () => { if (_auditTimer) { clearTimeout(_auditTimer); _flushAuditInserts(); } });

function useAuditLog() {
  const [log, setLog] = useStateAud(() => loadAuditLog());
  useEffectAud(() => {
    const h = () => setLog(loadAuditLog());
    window.addEventListener("ims-audit-change", h);
    return () => window.removeEventListener("ims-audit-change", h);
  }, []);
  return log;
}

/* ============ CONFIRM DIALOG ============ */
function ConfirmDialog({ open, title, description, changes, count, action, danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onCancel} style={{ zIndex: 70 }}/>
      <div className="modal" style={{ width: 480, zIndex: 71 }}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, whiteSpace: "pre-line" }}>{description}</div>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onCancel}><Icons.X/></button>
        </div>
        <div className="modal-body">
          {count != null && (
            <div style={{ padding: 18, background: "var(--surface-2)", borderRadius: 12, marginBottom: 14, textAlign: "center" }}>
              <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em" }} className="tnum">{count}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>รายการที่จะถูกเปลี่ยน</div>
            </div>
          )}
          {changes && changes.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>การเปลี่ยนแปลง</div>
              <div className="stack" style={{ gap: 8 }}>
                {changes.map((c, i) => (
                  <div key={i} style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{c.label}</div>
                    <div className="row" style={{ gap: 10, fontSize: 13, alignItems: "center" }}>
                      <span style={{ flex: 1, color: "var(--muted)", textDecoration: c.from ? "line-through" : "none" }}>{c.from || <span style={{ fontStyle: "italic" }}>(ว่าง)</span>}</span>
                      <Icons.ArrowRight size={12} style={{ color: "var(--muted)" }}/>
                      <span style={{ flex: 1, fontWeight: 500, color: danger ? "var(--danger)" : "var(--fg)" }}>{c.to}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--info-soft)", color: "var(--info)", borderRadius: 10, fontSize: 11, display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.History size={13}/>
            <span>การเปลี่ยนแปลงจะถูกบันทึกในประวัติพร้อมชื่อผู้ใช้และเวลา</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>ยกเลิก</button>
          <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} onClick={onConfirm} style={danger ? { background: "var(--danger)", color: "white", borderColor: "var(--danger)" } : {}}>
            <Icons.Check size={14}/> {action || "ยืนยัน"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ============ HISTORY PAGE ============ */

const ENTITY_LABELS = {
  order: "ออร์เดอร์",
  product: "สินค้า",
  user: "ผู้ใช้งาน",
  settings: "ตั้งค่าร้าน",
  layout: "เลย์เอาต์",
  label: "ฉลาก",
  inbound: "รับเข้า",
  bundle: "ชุดสินค้า",
  location: "ตำแหน่ง"
};

const ACTION_LABELS = {
  update: "แก้ไข",
  create: "สร้าง",
  delete: "ลบ",
  adjust: "ปรับสต็อก",
  receive: "รับเข้า",
  close: "ปิดงาน",
  add: "เพิ่ม",
  "bulk-update": "แก้ไขกลุ่ม",
  "bulk-delete": "ลบกลุ่ม",
  note: "โน้ต",
  "cancel-restock": "ยกเลิก/คืนสต็อก"
};

const ACTION_TONES = {
  update: "badge-info",
  create: "badge-success",
  delete: "badge-danger",
  adjust: "badge-warning",
  receive: "badge-success",
  close: "badge-success",
  add: "badge-success",
  "bulk-update": "badge-info",
  "bulk-delete": "badge-danger",
  note: "badge-info",
  "cancel-restock": "badge-warning"
};

function formatTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const t = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, today)) return "วันนี้ · " + t;
  if (sameDay(d, yest)) return "เมื่อวาน · " + t;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + " · " + t;
}

function HistoryPage({ pushToast, goToProduct, goToOrder }) {
  const log = useAuditLog();
  const [q, setQ] = useStateAud("");
  // "ประวัติการรับเข้า" on the Inbound page opens this list pre-filtered.
  const [entityFilter, setEntityFilter] = useStateAud(() => {
    try { const v = sessionStorage.getItem("ims_history_filter"); sessionStorage.removeItem("ims_history_filter"); return v || "all"; } catch (e) { return "all"; }
  });
  const [actionFilter, setActionFilter] = useStateAud("all");
  const [sel, setSel] = useStateAud(null);       // entry open in the detail panel
  const [openRounds, setOpenRounds] = useStateAud({});   // ปรับสต็อก rounds expanded
  const [day, setDay] = useStateAud(null);        // null = ทุกวันที่โหลดไว้
  const [dayRows, setDayRows] = useStateAud(null);
  const [busy, setBusy] = useStateAud(false);

  const today = todayIso();

  // Row count in the DB — tells the user how much history is still below.
  useEffectAud(() => { if (typeof refreshAuditTotal === "function") refreshAuditTotal(); }, []);

  // A picked day is fetched straight from the DB, so an old day opens in one
  // query instead of paging back through everything in between.
  useEffectAud(() => {
    if (!day) { setDayRows(null); return; }
    let alive = true;
    setBusy(true);
    Promise.resolve(loadAuditDay(day))
      .then(rows => { if (alive) setDayRows(rows || []); })
      .catch(() => { if (alive) setDayRows([]); })
      .then(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [day]);

  const jumpDay = (delta) => {
    const next = shiftDayKey(day || today, delta);
    if (next > today) return;                     // no future days to show
    setDay(next);
  };

  const loadMore = async () => {
    if (typeof loadMoreAuditLog !== "function") return;
    setBusy(true);
    const got = await loadMoreAuditLog();
    setBusy(false);
    if (!got) pushToast("โหลดครบทุกรายการแล้ว");
  };

  const source = day ? (dayRows || []) : log;
  const filtered = source.filter(e => {
    // "รับเข้า" = the batch close AND the per-product receive entries.
    if (entityFilter === "inbound") { if (e.entity !== "inbound" && e.action !== "receive") return false; }
    else if (entityFilter !== "all" && e.entity !== entityFilter) return false;
    if (actionFilter !== "all" && e.action !== actionFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      // The summary is where the product name / SKU usually is (a batch or a
      // product created by scan has no entityId) — searching without it missed them.
      const match = ((e.summary || "") + " " + (e.entityId || "") + " " + (e.user?.name || "") + " " + (e.note || "")).toLowerCase().includes(ql);
      if (!match) return false;
    }
    return true;
  });

  // Group by BANGKOK day (see groupAuditByDay — a raw .slice(0,10) files
  // anything logged before 07:00 local under the previous day).
  const groups = useMemoAud(() => groupAuditByDay(filtered), [filtered]);


  const clearLog = async () => {
    if (!confirm("ลบประวัติทั้งหมดออกจากระบบ?")) return;
    // RLS allows clearing audit_log for admins only — block others up front so we
    // don't wipe the local cache while the DB rows survive and re-sync on reload.
    const role = (window.__currentUser && window.__currentUser.role) || "staff";
    if (role !== "admin") { pushToast("ล้างประวัติได้เฉพาะผู้ดูแลระบบ"); return; }
    if (window.dbDeleteAuditLog) {
      const res = await dbDeleteAuditLog();
      if (res && res.error) { pushToast("ล้างประวัติไม่สำเร็จ: " + res.error); return; }
    }
    try { localStorage.removeItem(AUDIT_KEY); } catch (e) {}
    window._DB_AUDIT_LOG = [];
    window._AUDIT_END = true;      // nothing left below — hide "โหลดเพิ่ม"
    window._AUDIT_TOTAL = 0;
    setDay(null); setDayRows(null);
    window.dispatchEvent(new CustomEvent("ims-audit-change"));
    pushToast("ล้างประวัติแล้ว");
  };

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ประวัติการแก้ไข</h1>
          <div className="page-sub">บันทึกการเปลี่ยนแปลงทั้งหมด — ใครเปลี่ยนอะไร เมื่อไหร่</div>
        </div>
        <div className="row">
          {canDo("exportData") && <button className="btn" onClick={() => { const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; const csv = "Date,User,Account,Action,Entity,Details\n" + filtered.map(e => [new Date(e.ts).toLocaleString("th-TH"), e.user?.name || "ระบบ", (e.actorId && _actorNames[e.actorId]) || "", e.action, e.entity, e.summary].map(esc).join(",")).join("\n"); const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "audit.csv"; a.click(); URL.revokeObjectURL(url); }}><Icons.Pkg size={14}/> ส่งออก CSV</button>}
          {currentRoleId() === "admin" && <button className="btn btn-danger" onClick={clearLog}><Icons.Trash size={14}/> ล้างประวัติ</button>}
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="เปลี่ยนแปลงทั้งหมด"
          value={auditTotal(log.length) ?? log.length}
          tone="info"
          hint={(auditTotal(log.length) ?? log.length) > log.length
            ? `โหลดแล้ว ${log.length} รายการ` : "โหลดครบทุกรายการ"}/>
        <SmallStat label="วันนี้" value={log.filter(e => bangkokDateOf(e.ts) === today).length} tone="success" hint="กิจกรรมในวันที่ปัจจุบัน"/>
        <SmallStat label="ผู้ใช้งานที่แก้ไข" value={new Set(log.map(e => e.user?.name)).size} tone="info" hint="ผู้ใช้ที่มีบันทึก"/>
      </div>

      <div className="card" style={{ padding: 14 }}>
        {/* Day picker — ◀ ▶ walk one day at a time, the date box jumps straight
            to any past day (fetched from the DB, not just what's cached). */}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button className="btn btn-sm" onClick={() => jumpDay(-1)} title="วันก่อนหน้า">
            <Icons.Chev size={12} style={{ transform: "rotate(180deg)" }}/> วันก่อนหน้า
          </button>
          <input className="input" type="date" value={day || ""} max={today}
            onChange={e => setDay(e.target.value || null)}
            style={{ width: 168, height: 32, padding: "0 10px" }}/>
          <button className="btn btn-sm" disabled={!day || day >= today} onClick={() => jumpDay(1)} title="วันถัดไป">
            วันถัดไป <Icons.Chev size={12}/>
          </button>
          {day && <button className="btn btn-sm btn-primary" onClick={() => setDay(null)}>ดูล่าสุดทั้งหมด</button>}
          <div className="spacer"/>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {busy ? "กำลังโหลด…"
              : day ? `${thaiDayLabel(day)} · ${filtered.length} รายการ`
              : `แสดง ${filtered.length} รายการ${auditTotal(log.length) != null ? " จาก " + auditTotal(log.length) : ""}`}
          </span>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="search" style={{ width: 320 }}>
            <Icons.Search size={14}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาสินค้า / SKU ออร์เดอร์ ผู้ใช้ หรือบันทึก"/>
          </div>
          <div className="seg">
            <button className={entityFilter === "all" ? "on" : ""} onClick={() => setEntityFilter("all")}>ทั้งหมด</button>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <button key={k} className={entityFilter === k ? "on" : ""} onClick={() => setEntityFilter(k)}>{v}</button>
            ))}
          </div>
          <div className="spacer"/>
          <div className="seg">
            <button className={actionFilter === "all" ? "on" : ""} onClick={() => setActionFilter("all")}>ทุกการกระทำ</button>
            <button className={actionFilter === "update" ? "on" : ""} onClick={() => setActionFilter("update")}>แก้ไข</button>
            <button className={actionFilter === "adjust" ? "on" : ""} onClick={() => setActionFilter("adjust")}>ปรับสต็อก</button>
            <button className={actionFilter === "bulk-update" ? "on" : ""} onClick={() => setActionFilter("bulk-update")}>แก้ไขกลุ่ม</button>
            <button className={actionFilter === "delete" ? "on" : ""} onClick={() => setActionFilter("delete")}>ลบ</button>
          </div>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="card" style={{ padding: 60, textAlign: "center" }}>
          <Icons.History size={32} style={{ color: "var(--muted)", opacity: 0.4, marginBottom: 10 }}/>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{day ? `ไม่มีกิจกรรมใน${thaiDayLabel(day)}` : "ยังไม่มีประวัติ"}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {day ? "ลองเลือกวันอื่น หรือกดดูล่าสุดทั้งหมด" : "การเปลี่ยนแปลงในระบบจะถูกบันทึกที่นี่"}
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 20 }}>
        {groups.map(([date, entries]) => {
          const display = thaiDayLabel(date);
          return (
            <div key={date}>
              <div style={{ position: "sticky", top: 60, zIndex: 5, padding: "8px 0", background: "var(--bg)", marginBottom: 4 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-2)", letterSpacing: "0.02em" }}>{display}</span>
                  <span style={{ flex: 1, height: 1, background: "var(--border)" }}/>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{entries.length} รายการ</span>
                </div>
              </div>

              <div className="card card-tight">
                {groupAuditRounds(entries).map((item, i, items) => {
                  const last = i === items.length - 1;
                  if (item.round) {
                    const isOpen = !!openRounds[item.id];
                    return (
                      <div key={item.id} style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}>
                        <div style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start", cursor: "pointer" }}
                          onClick={() => setOpenRounds(s => ({ ...s, [item.id]: !s[item.id] }))}>
                          <div className="user-avatar" style={{ background: "oklch(0.55 0.15 " + ((item.user?.name?.charCodeAt(0) || 0) * 4 % 360) + ")", width: 32, height: 32, fontSize: 11, flexShrink: 0 }}>{item.user?.avatar || "?"}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                              <ActorName entry={item} style={{ fontSize: 13, fontWeight: 500 }}/>
                              <span className={"badge " + (ACTION_TONES.adjust || "badge-neutral")} style={{ fontSize: 10 }}>{ACTION_LABELS.adjust || "adjust"}</span>
                              <span className="badge badge-neutral" style={{ fontSize: 10 }}>รอบเดียวกัน</span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{auditRoundTitle(item)}</div>
                            {item.note && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{item.note}</div>}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{bangkokTimeOf(item.ts)}</div>
                            <span style={{ display: "inline-flex", color: "var(--muted)", marginTop: 2, transform: isOpen ? "rotate(90deg)" : "none" }}><Icons.Chev size={12}/></span>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ margin: "0 18px 12px 64px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-2)" }}>
                            {item.entries.map((c, j) => (
                              <div key={c.id} onClick={() => setSel(c)}
                                style={{ padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", cursor: "pointer", borderBottom: j < item.entries.length - 1 ? "1px solid var(--border)" : "none" }}>
                                {typeof ProductImageThumb === "function" && <ProductImageThumb sku={c.entityId} size={30} radius={6}/>}
                                <span style={{ flex: 1, minWidth: 0, fontSize: 12 }}>{String(c.summary || "").replace(/^ปรับสต็อก\s*/, "")}</span>
                                <Icons.Chev size={11} style={{ color: "var(--muted)" }}/>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                  const e = item;
                  const hasDetails = (e.changes && e.changes.length > 0) || e.note || auditEntryMovesStock(e);
                  return (
                    <div key={e.id} style={{ borderBottom: last ? "none" : "1px solid var(--border)" }}>
                      <div
                        style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start", cursor: hasDetails ? "pointer" : "default" }}
                        onClick={() => hasDetails && setSel(e)}
                      >
                        <div className="user-avatar" style={{ background: "oklch(0.55 0.15 " + ((e.user?.name?.charCodeAt(0) || 0) * 4 % 360) + ")", width: 32, height: 32, fontSize: 11, flexShrink: 0 }}>{e.user?.avatar || "?"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                            <ActorName entry={e} style={{ fontSize: 13, fontWeight: 500 }}/>
                            <span className={"badge " + (ACTION_TONES[e.action] || "badge-neutral")} style={{ fontSize: 10 }}>
                              {ACTION_LABELS[e.action] || e.action}
                            </span>
                            <span className="badge badge-neutral" style={{ fontSize: 10 }}>{ENTITY_LABELS[e.entity] || e.entity}</span>
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {e.summary || (e.entityId ? <>แก้ไข <span className="mono">{e.entityId}</span></> : "เปลี่ยนแปลง")}
                          </div>
                          {hasDetails && (e.changes?.length || e.note) && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              {e.changes?.length ? `${e.changes.length} ฟิลด์เปลี่ยน` : ""}{e.note ? " · " + e.note : ""}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{bangkokTimeOf(e.ts)}</div>
                          {hasDetails && (
                            <Icons.Chev size={12} style={{ color: "var(--muted)", marginTop: 2, }}/>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Older rows live in the DB, not in memory — pull the next page on demand.
          Hidden in day mode: that view already queried the whole day. */}
      {!day && auditHasMore() && (
        <div style={{ textAlign: "center" }}>
          <button className="btn" onClick={loadMore} disabled={busy}>
            {busy ? "กำลังโหลด…" : <><Icons.History size={14}/> โหลดประวัติเก่ากว่านี้</>}
          </button>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            โหลดแล้ว {log.length} รายการ{auditTotal(log.length) != null ? ` จากทั้งหมด ${auditTotal(log.length)}` : ""}
          </div>
        </div>
      )}

      <AuditDetailDrawer entry={sel} onClose={() => setSel(null)}
        // Only ติดตามพัสดุ has the order drawer (and its history); a role without it
        // still sees the order card + timeline inside this panel.
        onOpenOrder={goToOrder && canOpenAny(["tracking"]) ? (o => { setSel(null); goToOrder(o.id); }) : null}
        onOpenProduct={goToProduct && canOpenAny(["inventory", "finder"]) ? (sku => { setSel(null); goToProduct(sku); }) : null}/>
    </div>
  );
}
// Any of these pages open for the current role (goTo* picks the first allowed).
function canOpenAny(ids) {
  return typeof canOpenPage !== "function" || ids.some(id => canOpenPage(id));
}

/* ════════════════════════════════════════════════════════════════════════
   Activity detail — what one ประวัติการแก้ไข entry actually moved.
   audit_log keeps only text, so the stock side is read from the movement
   ledger (stock_adjustments), which since 2026-10-12 carries the server's
   qty_before / qty_after per row (backfilled exactly from the pack launch,
   2026-10-07 — see supabase/ledger-before-after.sql). Older rows have no
   before/after and show only the current stock.
   How an entry is matched to its ledger rows: see loadAuditEntryMoves.
   ════════════════════════════════════════════════════════════════════════ */
/* ── Who REALLY wrote an entry ──
   entry.user.name is whatever the writing device sent; entry.actorId is the
   login the database stamped (auth.uid(), supabase/ledger-before-after.sql).
   Names for those ids are fetched once per id through actor_names() and kept
   for the session. Rows from before 2026-10-12 have no actorId and simply show
   the sent name. */
const _actorNames = {};            // id → name, or null = no such account
let _actorAsk = new Set();
let _actorTimer = null;
function _requestActorNames(ids) {
  let added = false;
  (ids || []).forEach(id => { if (id && !(id in _actorNames) && !_actorAsk.has(id)) { _actorAsk.add(id); added = true; } });
  if (!added || _actorTimer || typeof dbActorNames !== "function") return;
  _actorTimer = setTimeout(async () => {
    _actorTimer = null;
    const batch = [..._actorAsk];
    _actorAsk = new Set();
    const got = await dbActorNames(batch).catch(() => null);
    if (!got) return;                                // error: leave unknown, retry on next render
    batch.forEach(id => { _actorNames[id] = (id in got) ? got[id] : null; });
    window.dispatchEvent(new CustomEvent("ims-actors-change"));
  }, 60);
}
function useActorNames(ids) {
  const [, setTick] = useStateAud(0);
  const key = (ids || []).filter(Boolean).join(",");
  useEffectAud(() => {
    const on = () => setTick(n => n + 1);
    window.addEventListener("ims-actors-change", on);
    return () => window.removeEventListener("ims-actors-change", on);
  }, []);
  useEffectAud(() => { _requestActorNames(key ? key.split(",") : []); }, [key]);
  return _actorNames;
}
/* The author line for one entry: the account's real name (✓ when it matches
   what the device sent), or both names, flagged, when they disagree. */
function ActorName({ entry: e, style }) {
  const names = useActorNames(e && e.actorId ? [e.actorId] : []);
  const sent = (e && e.user && e.user.name) || "ระบบ";
  if (!e || !e.actorId || !(e.actorId in names)) return <span style={style}>{sent}</span>;
  const real = names[e.actorId];
  if (real == null) return <span style={style} title="บัญชีนี้ไม่มีในระบบแล้ว">{sent} <span style={{ color: "var(--muted)" }}>(บัญชีถูกลบ)</span></span>;
  if (real === sent) return <span style={style} title="ยืนยันจากบัญชีที่ล็อกอินบันทึก">{real} <span style={{ color: "var(--success)" }}>✓</span></span>;
  return (
    <span style={style} title="ชื่อที่แอปส่งมาไม่ตรงกับบัญชีที่ล็อกอินบันทึกจริง">
      {real} <span style={{ color: "var(--danger)" }}>(ชื่อที่ส่งมา: {sent})</span>
    </span>
  );
}

/* What kind of stock movement an entry stands for — null when it moved none.
   Drives both the matcher and whether the detail shows a movement section. */
function auditMoveKind(e) {
  if (!e) return null;
  if (e.entity === "order") {
    if (e.action === "create") return "order-sale";       // ตัดสต็อก / ขาย+จัดส่ง (a slip-scan create moves none → section hides)
    if (e.action === "cancel-restock") return "order-cancel";
    return null;                                         // status / tracking / note edits never move stock
  }
  if (e.entity === "bundle" && /^ขาย "/.test(e.summary || "")) return "bundle-sale";
  if (e.entity === "inbound") return "inbound";
  if (e.entity === "product") {
    if (e.action === "adjust") return "adjust";
    if (e.action === "receive") return "receive";
    if (e.action === "add" || e.action === "create") return "add";
  }
  return null;
}
function auditEntryMovesStock(e) { return !!auditMoveKind(e); }

// Orders an entry belongs to: its own id, else the SO numbers its note names
// (cancel-restock and bundle-sale entries carry "ออร์เดอร์: SO-…" in the note).
function auditOrderIds(e) {
  if (!e) return [];
  if (e.entity === "order" && e.entityId && e.action !== "bulk-update" && e.action !== "bulk-delete") return [e.entityId];
  const kind = auditMoveKind(e);
  if (kind !== "order-cancel" && kind !== "bundle-sale") return [];
  return [...new Set(String(e.note || "").match(/\bSO-[A-Za-z0-9]+\b/g) || [])];
}

/* The note's own text vs. the change list the DB folded onto it.
   audit_log has no changes[] column, so dbInsertAuditEntry appends them as
   "note | label: a → b · label: …". Split only at the LAST " | " and only when
   what follows looks like that list — a note the user typed with " | " in it,
   or an order/shelf note (action "note"), is shown whole. */
function auditNoteParts(e) {
  const note = String((e && e.note) || "");
  if (!note || (e && e.action === "note")) return { text: note, detail: "" };
  const i = note.lastIndexOf(" | ");
  if (i < 0) return { text: note, detail: "" };
  const tail = note.slice(i + 3);
  return /^[^|:]{1,120}: /.test(tail) ? { text: note.slice(0, i), detail: tail } : { text: note, detail: "" };
}

// "+3 ชิ้น (12 → 15)" in an adjust/receive summary → 3.
function _auditSummaryDelta(e) {
  const m = /([+-]\d+) ชิ้น/.exec((e && e.summary) || "");
  return m ? Number(m[1]) : null;
}
function _auditWindow(e, ms) {
  const t = new Date(e.ts).getTime();
  return isFinite(t) ? { from: new Date(t - ms).toISOString(), to: new Date(t + ms).toISOString(), t } : null;
}
function _closestTo(rows, t) {
  return rows.slice().sort((a, b) => Math.abs(new Date(a.created_at) - t) - Math.abs(new Date(b.created_at) - t))[0];
}

/* Ledger rows behind one entry → { rows, cancelled:Set<orderId> }.
   Every rule here was checked against live data (2026-10-12):
     order sale / cancel / bundle sale → by the order number in the movement
       reason — exact. Older ขาย+จัดส่ง and ขายชุด rows predate the number, so
       they fall back to the same person ±3 min with that flow's reason prefix
       (and the recipient's name for ขาย+จัดส่ง).
     inbound close → ±3 min, same person, +qty, ONLY the skus the close lists
       (a neighbouring receive used to leak in: 4 of 15 closes).
     ปรับสต็อก → the row whose reason IS the entry's note and whose qty matches
       the summary; a backdated one is dated in the past, so it is looked up by
       sku, not time (a time match used to grab a neighbouring row: 2 of 150).
     รับเข้า (per product) → same sku ±3 min, +qty, same quantity, nearest. */
async function loadAuditEntryMoves(e) {
  const out = { rows: [], cancelled: new Set() };
  const kind = auditMoveKind(e);
  if (!kind || typeof dbLoadLedgerFor !== "function") return out;
  const ids = auditOrderIds(e);
  const user = e.user && e.user.name && e.user.name !== "ระบบ" ? e.user.name : null;
  const win = _auditWindow(e, 180000);
  const sortById = (rows) => rows.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

  if ((kind === "order-sale" || kind === "order-cancel" || kind === "bundle-sale") && ids.length) {
    const lists = await Promise.all(ids.map(id => dbLoadLedgerFor({ order: id })));
    lists.forEach((list, k) => (list || []).forEach(r => {
      if (!String(r.reason || "").includes(ids[k])) return;
      const restock = /คืนสต็อก/.test(r.reason || "");
      if (restock) out.cancelled.add(ids[k]);
      if (kind === "order-cancel" ? restock : (!restock && r.delta < 0)) out.rows.push(r);
    }));
    out.rows = sortById(out.rows);
    return out;
  }
  if (!win) return out;

  if (kind === "order-sale" || kind === "bundle-sale" || kind === "order-cancel") {
    let rows = (await dbLoadLedgerFor({ from: win.from, to: win.to, user })) || [];
    if (kind === "order-cancel") rows = rows.filter(r => /คืนสต็อก/.test(r.reason || ""));
    else if (kind === "bundle-sale") rows = rows.filter(r => r.delta < 0 && /^ขายชุดสินค้า/.test(r.reason || ""));
    else {
      const who = (/ผู้รับ: ([^·]+?) ·/.exec(e.note || "") || [])[1];
      rows = rows.filter(r => r.delta < 0 && /^ขายสินค้า/.test(r.reason || "") && (!who || String(r.reason).includes(who.trim())));
    }
    out.rows = sortById(rows);
    return out;
  }

  if (kind === "inbound") {
    const listed = new Set((String(e.note || "").match(/([^\s·|:]+): \+\d+ ชิ้น/g) || []).map(s => s.split(":")[0]));
    let rows = (await dbLoadLedgerFor({ from: win.from, to: win.to, user })) || [];
    rows = rows.filter(r => r.delta > 0 && (!listed.size || listed.has(r.sku)));
    out.rows = sortById(rows);
    return out;
  }

  const sku = e.entityId;
  if (!sku) return out;
  const want = _auditSummaryDelta(e);

  if (kind === "adjust") {
    const key = String(e.note || "").replace(/ \| จำนวน: [^|]*$/, "").trim();
    const fits = (r) => (!key || r.reason === key) && (want == null || r.delta === want);
    let rows = ((await dbLoadLedgerFor({ from: win.from, to: win.to, skus: [sku], user })) || []).filter(fits);
    if (!rows.length && typeof dbLoadStockAdjustments === "function") {
      rows = ((await dbLoadStockAdjustments(sku, 200)) || []).filter(fits);   // backdated: dated in the past
    }
    const pick = rows.length > 1 ? _closestTo(rows, win.t) : rows[0];
    out.rows = pick ? [pick] : [];
    return out;
  }

  // receive / add: same sku, +qty, ±3 min, the same quantity when the summary says it.
  let rows = ((await dbLoadLedgerFor({ from: win.from, to: win.to, skus: [sku], user })) || []).filter(r => r.delta > 0);
  if (want != null && rows.some(r => r.delta === want)) rows = rows.filter(r => r.delta === want);
  const pick = rows.length > 1 ? _closestTo(rows, win.t) : rows[0];
  out.rows = pick ? [pick] : [];
  return out;
}

function useAuditEntryDetail(e) {
  const [st, setSt] = useStateAud({ loading: true, rows: [], cancelled: new Set() });
  useEffectAud(() => {
    if (!e) return;
    const moves = auditEntryMovesStock(e);
    setSt({ loading: moves, rows: [], cancelled: new Set() });
    if (!moves) return;
    let alive = true;
    loadAuditEntryMoves(e)
      .then(r => { if (alive) setSt({ loading: false, rows: r.rows, cancelled: r.cancelled }); })
      .catch(() => { if (alive) setSt({ loading: false, rows: [], cancelled: new Set(), error: true }); });
    return () => { alive = false; };
  }, [e && e.id]);
  const orders = useMemoAud(() => {
    const ids = auditOrderIds(e);
    if (!ids.length) return [];
    let all = [];
    try { all = typeof buildOrders === "function" ? buildOrders() : []; } catch (x) { all = []; }
    return ids.map(id => ({ id, order: all.find(o => o.id === id) || null }));
  }, [e && e.id]);
  return { ...st, orders };
}

// The shelf a row moved: "… → ตึก › ชั้น" on receives, else the order line's loc.
function auditRowShelf(r, order) {
  const m = /→ ([^·]+?)(?: · |$)/.exec(r.reason || "");
  if (m && !/^\d/.test(m[1])) return m[1].trim();
  const real = (l) => l && l.loc && !/^[-—–\s]*$/.test(String(l.loc));   // "-" = never shelved
  const li = order && Array.isArray(order.lineItems) ? order.lineItems.find(l => l && l.sku === r.sku && real(l)) : null;
  return li ? li.loc : "";
}

// Movement kinds that ALWAYS move stock — an empty match there is worth saying.
const AUDIT_MOVE_EXPECTED = { adjust: 1, receive: 1, inbound: 1, "order-cancel": 1 };

function AuditOrderCard({ id, order, cancelled, onOpenOrder, nested, compact }) {
  const [showTl, setShowTl] = useStateAud(false);
  const fs = compact ? 12 : 13;
  const lab = { fontSize: 11, color: "var(--muted)" };
  const statusTh = (order && typeof ORDER_STATUS_TH === "object" && ORDER_STATUS_TH[order.status]) || (order && order.status) || "";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: compact ? 10 : 12 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={lab}>ออร์เดอร์</div>
          <div className="mono" style={{ fontSize: fs, fontWeight: 600 }}>{id}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {!nested && <button className="btn btn-sm" onClick={() => setShowTl(v => !v)}>{showTl ? "ซ่อนไทม์ไลน์" : "ไทม์ไลน์"}</button>}
          {order && onOpenOrder && <button className="btn btn-sm" onClick={() => onOpenOrder(order)}>เปิดออร์เดอร์ <Icons.Chev size={11}/></button>}
        </div>
      </div>
      {order ? (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginTop: 8, fontSize: 12 }}>
          <span style={lab}>ช่องทาง</span><span>{typeof orderChannelLabel === "function" ? orderChannelLabel(order) : order.channel}</span>
          {order.customer && <><span style={lab}>ลูกค้า</span><span>{order.customer}</span></>}
          <span style={lab}>สถานะ</span><span>{statusTh || "—"}</span>
          {order.tracking && <><span style={lab}>เลขพัสดุ</span><span className="mono">{order.tracking}</span></>}
        </div>
      ) : (
        <div style={{ ...lab, marginTop: 6, color: cancelled ? "var(--danger)" : "var(--muted)" }}>
          {cancelled ? "ออร์เดอร์นี้ถูกยกเลิกและคืนสต็อกแล้ว" : "ไม่พบออร์เดอร์นี้ในระบบแล้ว (ถูกลบ)"}
        </div>
      )}
      {showTl && !nested && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <OrderHistory order={order || { id }} compact={compact} nested/>
        </div>
      )}
    </div>
  );
}

function AuditEntryDetail({ entry: e, onOpenOrder, onOpenProduct, compact, nested }) {
  const { loading, rows, orders, cancelled, error } = useAuditEntryDetail(e);
  const fs = compact ? 12 : 13;
  const box = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: compact ? 10 : 12 };
  const lab = { fontSize: 11, color: "var(--muted)" };
  const kind = auditMoveKind(e);
  const hasBA = rows.some(r => r.qty_after != null);
  const { text: noteText, detail: noteDetail } = auditNoteParts(e);
  const firstOrder = orders.find(o => o.order) ? orders.find(o => o.order).order : null;
  const productHere = e.entity === "product" && e.entityId && typeof PRODUCTS !== "undefined" && PRODUCTS.some(p => p.sku === e.entityId);
  const showMoves = !!kind && (loading || error || rows.length > 0 || AUDIT_MOVE_EXPECTED[kind]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      {!nested && (
        <div style={box}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div style={{ fontSize: fs, fontWeight: 500, minWidth: 0 }}>{e.summary || "เปลี่ยนแปลง"}</div>
            {productHere && onOpenProduct && (
              <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => onOpenProduct(e.entityId)}>เปิดสินค้า <Icons.Chev size={11}/></button>
            )}
          </div>
          <div style={{ ...lab, marginTop: 4 }}>
            {new Date(e.ts).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" })} · <ActorName entry={e}/>
          </div>
          {noteText && <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 6, whiteSpace: "pre-wrap" }}>{noteText}</div>}
        </div>
      )}

      {!nested && orders.map(({ id, order }) => (
        <AuditOrderCard key={id} id={id} order={order} cancelled={cancelled.has(id) || e.action === "cancel-restock"}
          onOpenOrder={onOpenOrder} compact={compact}/>
      ))}

      {showMoves && (
        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>การเคลื่อนไหวสต็อก</div>
            {!loading && rows.length > 0 && <div style={lab}>{rows.length} รายการ</div>}
          </div>
          {loading ? <div style={{ ...lab, padding: 12 }}>กำลังโหลด…</div>
          : error ? <div style={{ ...lab, padding: 12 }}>โหลดไม่สำเร็จ</div>
          : !rows.length ? <div style={{ ...lab, padding: 12 }}>ไม่พบรายการเคลื่อนไหวสต็อกของกิจกรรมนี้</div>
          : (
            <div className="stack" style={{ gap: 8 }}>
              {rows.map(r => {
                const p = (typeof PRODUCTS !== "undefined") ? PRODUCTS.find(x => x.sku === r.sku) : null;
                const shelf = auditRowShelf(r, firstOrder);
                const neg = r.delta < 0;
                const canOpen = p && onOpenProduct;
                return (
                  <div key={r.id} style={box}>
                    <div className="row" style={{ justifyContent: "space-between", gap: compact ? 10 : 12, alignItems: "flex-start" }}>
                      {typeof ProductImageThumb === "function" && (
                        <div style={{ flexShrink: 0, cursor: canOpen ? "pointer" : "default" }}
                          onClick={canOpen ? () => onOpenProduct(r.sku) : undefined}>
                          <ProductImageThumb sku={r.sku} size={compact ? 48 : 56} radius={10}/>
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: fs, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: compact ? "normal" : "nowrap" }}>{p ? p.name : r.sku}</div>
                        <div style={lab}>
                          {canOpen
                            ? <a className="mono" style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => onOpenProduct(r.sku)}>{r.sku}</a>
                            : <span className="mono">{r.sku}</span>}
                          {shelf ? " · " + shelf : ""}
                        </div>
                      </div>
                      <span className="tnum" style={{ fontSize: fs + 1, fontWeight: 600, color: neg ? "var(--danger)" : "var(--success)", flexShrink: 0 }}>
                        {neg ? "−" : "+"}{Math.abs(r.delta)}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      <div>
                        <div style={lab}>{neg ? "สต็อก ก่อน → หลังตัด" : "สต็อก ก่อน → หลังเพิ่ม"}</div>
                        <div className="tnum" style={{ fontSize: fs, fontWeight: 600 }}>
                          {r.qty_after != null
                            ? <>{r.qty_before} <span style={{ color: "var(--muted)", fontWeight: 400 }}>→</span> {r.qty_after}</>
                            : <span style={{ color: "var(--muted)", fontWeight: 400 }}>ไม่มีข้อมูล</span>}
                        </div>
                      </div>
                      <div>
                        <div style={lab}>คงเหลือตอนนี้</div>
                        <div className="tnum" style={{ fontSize: fs, fontWeight: 600 }}>{p ? p.qty : "—"}</div>
                      </div>
                    </div>
                    {/รอซิงค์/.test(r.reason || "") && r.qty_after == null && <div style={{ ...lab, marginTop: 6 }}>บันทึกตอนออฟไลน์</div>}
                  </div>
                );
              })}
              {!hasBA && <div style={lab}>รายการนี้ไม่มีบันทึกจำนวนก่อน/หลัง (บันทึกได้ตั้งแต่ 7 ต.ค. 2569) — แสดงเฉพาะคงเหลือปัจจุบัน</div>}
            </div>
          )}
        </div>
      )}

      {!kind && e.changes && e.changes.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {e.changes.map((c, j) => (
            <div key={j} style={box}>
              <div style={lab}>{c.label}</div>
              <div style={{ fontSize: 12 }}>{c.from ? `${c.from} → ` : ""}{c.to || "—"}</div>
            </div>
          ))}
        </div>
      )}
      {!kind && !(e.changes && e.changes.length) && noteDetail && (
        <div style={{ ...box, fontSize: 12, color: "var(--fg-2)" }}>{noteDetail}</div>
      )}
    </div>
  );
}

/* ── Order history (ประวัติออร์เดอร์) ──
   Everything that happened to ONE order, oldest first, for checking a packing
   problem after the fact: the note the packer was given (current + every
   version since 2026-10-12 — setPackOrderNote logs each one), the shelf notes
   on the shelves it is picked from, who is packing / finished and what came up
   short (its own pack record OR the หยิบรวม wave it is in), status and tracking
   edits, and the stock it cut. Re-renders on ims-pack-change (notes, progress)
   and reloads the timeline on ims-audit-change. */
function OrderHistory({ order, compact, nested }) {
  const [rows, setRows] = useStateAud(null);
  const [open, setOpen] = useStateAud(null);     // timeline entry expanded inline
  const [, setTick] = useStateAud(0);
  const id = order && order.id;
  useEffectAud(() => {
    if (!id || typeof dbLoadAuditForOrder !== "function") { setRows([]); return; }
    let alive = true;
    const load = () => dbLoadAuditForOrder(id).then(r => { if (alive) setRows(r || []); }).catch(() => { if (alive) setRows([]); });
    load();
    let t = null;
    const soon = () => { clearTimeout(t); t = setTimeout(load, 1500); };
    const repaint = () => setTick(n => n + 1);
    window.addEventListener("ims-audit-change", soon);
    window.addEventListener("ims-pack-change", repaint);
    return () => {
      alive = false; clearTimeout(t);
      window.removeEventListener("ims-audit-change", soon);
      window.removeEventListener("ims-pack-change", repaint);
    };
  }, [id]);
  if (!order) return null;

  const fs = compact ? 12 : 13;
  const lab = { fontSize: 11, color: "var(--muted)" };
  const card = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: compact ? 10 : 12 };
  const note = typeof packOrderNote === "function" ? packOrderNote(id) : null;
  // Its own pack record, or the wave (batch:…) that holds it.
  const prog = typeof loadPackProgress === "function" ? loadPackProgress() : {};
  let pe = prog[id] || null, wave = null;
  if (!pe) {
    const hit = Object.keys(prog).find(k => /^batch:/.test(k) && prog[k] && Array.isArray(prog[k].orderIds) && prog[k].orderIds.includes(id));
    if (hit) { pe = prog[hit]; wave = hit; }
  }
  const shorts = pe && pe.short ? Object.keys(pe.short).map(k => k.split("|")[0]) : [];
  // Shelf notes the packer sees on this order's pick lines.
  let shelfNotes = [];
  try {
    const lines = (order.lineItems || order.items) && typeof packLinesForOrder === "function" ? packLinesForOrder(order) : [];
    const seen = new Set();
    lines.forEach(l => {
      if (!l || !l.loc || seen.has(l.loc)) return;
      seen.add(l.loc);
      const n = typeof packLocNote === "function" ? packLocNote(l.loc) : null;
      if (n && n.text) shelfNotes.push({ loc: l.loc, ...n });
    });
  } catch (x) { shelfNotes = []; }
  const fmt = (iso) => iso ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const dot = (tone) => ({ width: 10, height: 10, borderRadius: 99, background: tone, flexShrink: 0, marginTop: 4, boxShadow: "0 0 0 3px var(--surface)" });
  const toneOf = (e) => e.action === "note" ? "var(--info)"
    : /แพ็ค/.test(e.summary || "") ? "var(--success)"
    : (e.action === "cancel-restock" || e.action === "delete" || e.action === "bulk-delete") ? "var(--danger)"
    : "var(--accent)";

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div style={card}>
        <div style={lab}>โน้ตถึงคนแพ็ค (ปัจจุบัน)</div>
        {note
          ? <><div style={{ fontSize: fs, whiteSpace: "pre-wrap", marginTop: 4 }}>{note.text}</div>
              <div style={{ ...lab, marginTop: 4 }}>{[note.by, fmt(note.at)].filter(Boolean).join(" · ")}</div></>
          : <div style={{ fontSize: fs, color: "var(--muted)", marginTop: 4 }}>ไม่มีโน้ต</div>}
      </div>

      {shelfNotes.length > 0 && (
        <div style={card}>
          <div style={lab}>โน้ตประจำช่องที่คนแพ็คเห็น (ปัจจุบัน)</div>
          {shelfNotes.map(n => (
            <div key={n.loc} style={{ marginTop: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{n.loc}</div>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{n.text}</div>
            </div>
          ))}
        </div>
      )}

      {(pe || order.packedAt) && (
        <div style={{ ...card, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
          {pe && pe.by && <><span style={lab}>{wave ? "กำลังหยิบรวมโดย" : "กำลังแพ็คโดย"}</span><span>{pe.by}{pe.startedAt ? " · เริ่ม " + fmt(pe.startedAt) : ""}{wave && pe.orderIds ? ` · ${pe.orderIds.length} ออร์เดอร์` : ""}</span></>}
          {pe && shorts.length > 0 && <><span style={lab}>ของขาด{wave ? " (ทั้งรอบ)" : ""}</span><span style={{ color: "var(--danger)" }}>{[...new Set(shorts)].join(", ")}</span></>}
          {order.packedAt && <><span style={lab}>แพ็คเสร็จ</span><span>{fmt(order.packedAt)}{order.packedBy ? " · " + order.packedBy : ""}</span></>}
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>ไทม์ไลน์ {rows && rows.length ? <span style={lab}>· {rows.length} รายการ</span> : null}</div>
        {rows === null ? <div style={{ ...lab, padding: 8 }}>กำลังโหลด…</div>
        : !rows.length ? <div style={{ ...lab, padding: 8 }}>ยังไม่มีประวัติของออร์เดอร์นี้</div>
        : (
          <div style={{ position: "relative", paddingLeft: 4 }}>
            <div style={{ position: "absolute", left: 8, top: 8, bottom: 8, width: 2, background: "var(--border)" }}/>
            {rows.map(e => {
              const { text } = auditNoteParts(e);
              const expandable = auditEntryMovesStock(e);
              const isOpen = open && open.id === e.id;
              return (
                <div key={e.id} className="row" style={{ gap: 10, alignItems: "flex-start", padding: "6px 0", position: "relative", cursor: expandable ? "pointer" : "default" }}
                  onClick={expandable ? () => setOpen(isOpen ? null : e) : undefined}>
                  <span style={dot(toneOf(e))}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      <span className={"badge " + (ACTION_TONES[e.action] || "badge-neutral")} style={{ fontSize: 10 }}>{ACTION_LABELS[e.action] || e.action}</span>
                      <span style={lab}>{fmt(e.ts)} · <ActorName entry={e}/></span>
                      {expandable && <span style={{ ...lab, color: "var(--accent)" }}>{isOpen ? "ซ่อนรายการ" : "ดูรายการสินค้า"}</span>}
                    </div>
                    <div style={{ fontSize: fs, marginTop: 2 }}>{e.summary}</div>
                    {text && (
                      <div style={{ fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap",
                        ...(e.action === "note"
                          ? { background: "var(--info-soft, var(--surface-2))", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }
                          : { color: "var(--fg-2)" }) }}>{text}</div>
                    )}
                    {isOpen && (
                      <div style={{ marginTop: 8 }} onClick={ev => ev.stopPropagation()}>
                        <AuditEntryDetail entry={e} compact nested/>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ ...lab, marginTop: 6 }}>โน้ตที่แก้ก่อน 12 ต.ค. 2569 เก็บไว้เฉพาะฉบับล่าสุด</div>
      </div>
    </div>
  );
}

/* Desktop side panel with just an order's history — the แพ็คสินค้า queue opens
   it, since that is where a packing problem is noticed. */
function OrderHistoryDrawer({ order, onClose }) {
  useEffectAud(() => {
    if (!order) return;
    const k = (ev) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [order]);
  if (!order) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>ประวัติออร์เดอร์ / งานที่สั่ง</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{order.id}{order.customer ? " · " + order.customer : ""}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="drawer-body" style={{ background: "var(--surface-2)" }}>
          <OrderHistory order={order}/>
        </div>
      </div>
    </>
  );
}

/* Desktop side panel around AuditEntryDetail. */
function AuditDetailDrawer({ entry, onClose, onOpenOrder, onOpenProduct }) {
  useEffectAud(() => {
    if (!entry) return;
    const k = (ev) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [entry]);
  if (!entry) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>รายละเอียดกิจกรรม</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{ACTION_LABELS[entry.action] || entry.action} · {ENTITY_LABELS[entry.entity] || entry.entity}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="drawer-body" style={{ background: "var(--surface-2)" }}>
          <AuditEntryDetail entry={entry} onOpenOrder={onOpenOrder} onOpenProduct={onOpenProduct}/>
        </div>
      </div>
    </>
  );
}

Object.assign(window, {
  ConfirmDialog, recordChange, useAuditLog, HistoryPage, AuditEntryDetail, AuditDetailDrawer, auditEntryMovesStock, ActorName, useActorNames, OrderHistory, OrderHistoryDrawer, auditMoveKind, auditOrderIds, loadAuditEntryMoves, loadAuditLog, formatTime: formatTime,
  loadMoreAuditLog, loadAuditDay, auditHasMore, refreshAuditTotal, auditTotal, AUDIT_PAGE
});
