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
            {description && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{description}</div>}
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
  label: "ฉลาก"
};

const ACTION_LABELS = {
  update: "แก้ไข",
  create: "สร้าง",
  delete: "ลบ",
  adjust: "ปรับสต็อก",
  "bulk-update": "แก้ไขกลุ่ม",
  "bulk-delete": "ลบกลุ่ม"
};

const ACTION_TONES = {
  update: "badge-info",
  create: "badge-success",
  delete: "badge-danger",
  adjust: "badge-warning",
  "bulk-update": "badge-info",
  "bulk-delete": "badge-danger"
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

function HistoryPage({ pushToast }) {
  const log = useAuditLog();
  const [q, setQ] = useStateAud("");
  const [entityFilter, setEntityFilter] = useStateAud("all");
  const [actionFilter, setActionFilter] = useStateAud("all");
  const [expanded, setExpanded] = useStateAud(new Set());
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
    if (entityFilter !== "all" && e.entity !== entityFilter) return false;
    if (actionFilter !== "all" && e.action !== actionFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const match = ((e.entityId || "") + " " + (e.user?.name || "") + " " + (e.note || "")).toLowerCase().includes(ql);
      if (!match) return false;
    }
    return true;
  });

  // Group by BANGKOK day (see groupAuditByDay — a raw .slice(0,10) files
  // anything logged before 07:00 local under the previous day).
  const groups = useMemoAud(() => groupAuditByDay(filtered), [filtered]);

  const toggleExpand = (id) => setExpanded(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

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
          {canDo("exportData") && <button className="btn" onClick={() => { const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; const csv = "Date,User,Action,Entity,Details\n" + filtered.map(e => [new Date(e.ts).toLocaleString("th-TH"), e.user?.name || "ระบบ", e.action, e.entity, e.summary].map(esc).join(",")).join("\n"); const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "audit.csv"; a.click(); URL.revokeObjectURL(url); }}><Icons.Pkg size={14}/> ส่งออก CSV</button>}
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
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาออร์เดอร์ ผู้ใช้ หรือบันทึก"/>
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
                {entries.map((e, i) => {
                  const isExpanded = expanded.has(e.id);
                  const hasDetails = (e.changes && e.changes.length > 0) || e.note;
                  return (
                    <div key={e.id} style={{ borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <div
                        style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start", cursor: hasDetails ? "pointer" : "default" }}
                        onClick={() => hasDetails && toggleExpand(e.id)}
                      >
                        <div className="user-avatar" style={{ background: "oklch(0.55 0.15 " + ((e.user?.name?.charCodeAt(0) || 0) * 4 % 360) + ")", width: 32, height: 32, fontSize: 11, flexShrink: 0 }}>{e.user?.avatar || "?"}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{e.user?.name || "ระบบ"}</span>
                            <span className={"badge " + (ACTION_TONES[e.action] || "badge-neutral")} style={{ fontSize: 10 }}>
                              {ACTION_LABELS[e.action] || e.action}
                            </span>
                            <span className="badge badge-neutral" style={{ fontSize: 10 }}>{ENTITY_LABELS[e.entity] || e.entity}</span>
                          </div>
                          <div style={{ fontSize: 13 }}>
                            {e.summary || (e.entityId ? <>แก้ไข <span className="mono">{e.entityId}</span></> : "เปลี่ยนแปลง")}
                          </div>
                          {!isExpanded && hasDetails && (
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                              {e.changes?.length ? `${e.changes.length} ฟิลด์เปลี่ยน` : ""}{e.note ? " · " + e.note : ""}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{bangkokTimeOf(e.ts)}</div>
                          {hasDetails && (
                            <Icons.Chev size={12} style={{ color: "var(--muted)", marginTop: 2, transform: isExpanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}/>
                          )}
                        </div>
                      </div>
                      {isExpanded && hasDetails && (
                        <div style={{ padding: "0 18px 16px 64px", background: "var(--surface-2)" }}>
                          {e.note && (
                            <div style={{ fontSize: 12, color: "var(--fg-2)", padding: "12px 0 8px", fontStyle: "italic" }}>{e.note}</div>
                          )}
                          {e.changes?.map((c, j) => (
                            <div key={j} style={{ padding: "8px 12px", background: "var(--surface)", borderRadius: 8, marginTop: 8, border: "1px solid var(--border)" }}>
                              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{c.label}</div>
                              <div className="row" style={{ gap: 10, fontSize: 12 }}>
                                <span style={{ color: "var(--muted)", textDecoration: c.from ? "line-through" : "none" }}>{c.from || "—"}</span>
                                <Icons.ArrowRight size={11} style={{ color: "var(--muted)" }}/>
                                <span style={{ fontWeight: 500 }}>{c.to || "—"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
    </div>
  );
}

Object.assign(window, {
  ConfirmDialog, recordChange, useAuditLog, HistoryPage, loadAuditLog, formatTime: formatTime,
  loadMoreAuditLog, loadAuditDay, auditHasMore, refreshAuditTotal, auditTotal, AUDIT_PAGE
});
