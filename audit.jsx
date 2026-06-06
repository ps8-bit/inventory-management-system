/* Change confirmation + audit log */

const { useState: useStateAud, useEffect: useEffectAud, useMemo: useMemoAud } = React;

const AUDIT_KEY = "ims_audit_log";

function loadAuditLog() {
  if (window._DB_AUDIT_LOG) return window._DB_AUDIT_LOG;
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]"); }
  catch { return []; }
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
    window._DB_AUDIT_LOG = [row, ...window._DB_AUDIT_LOG].slice(0, 500);
  } else {
    const log = (() => { try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]"); } catch { return []; } })();
    log.unshift(row);
    if (log.length > 500) log.length = 500;
    try { localStorage.setItem(AUDIT_KEY, JSON.stringify(log)); } catch (e) {}
  }

  window.dispatchEvent(new CustomEvent("ims-audit-change"));
  if (window.dbInsertAuditEntry) dbInsertAuditEntry(row).catch(() => {});
}

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
  "bulk-update": "แก้ไขกลุ่ม",
  "bulk-delete": "ลบกลุ่ม"
};

const ACTION_TONES = {
  update: "badge-info",
  create: "badge-success",
  delete: "badge-danger",
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

  const filtered = log.filter(e => {
    if (entityFilter !== "all" && e.entity !== entityFilter) return false;
    if (actionFilter !== "all" && e.action !== actionFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const match = ((e.entityId || "") + " " + (e.user?.name || "") + " " + (e.note || "")).toLowerCase().includes(ql);
      if (!match) return false;
    }
    return true;
  });

  // Group by date
  const groupKey = (iso) => iso.slice(0, 10);
  const groups = useMemoAud(() => {
    const map = new Map();
    filtered.forEach(e => {
      const k = groupKey(e.ts);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    });
    return Array.from(map.entries());
  }, [filtered]);

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
          <button className="btn" onClick={() => { const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; const csv = "Date,User,Action,Entity,Details\n" + filtered.map(e => [new Date(e.ts).toLocaleString("th-TH"), e.user?.name || "ระบบ", e.action, e.entity, e.summary].map(esc).join(",")).join("\n"); const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "audit.csv"; a.click(); URL.revokeObjectURL(url); }}><Icons.Pkg size={14}/> ส่งออก CSV</button>
          <button className="btn btn-danger" onClick={clearLog}><Icons.Trash size={14}/> ล้างประวัติ</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="เปลี่ยนแปลงทั้งหมด" value={log.length} tone="info" hint="500 รายการล่าสุด"/>
        <SmallStat label="วันนี้" value={log.filter(e => formatTime(e.ts).startsWith("วันนี้")).length} tone="success" hint="กิจกรรมในวันที่ปัจจุบัน"/>
        <SmallStat label="ผู้ใช้งานที่แก้ไข" value={new Set(log.map(e => e.user?.id)).size} tone="info" hint="ผู้ใช้ที่มีบันทึก"/>
      </div>

      <div className="card" style={{ padding: 14 }}>
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
            <button className={actionFilter === "bulk-update" ? "on" : ""} onClick={() => setActionFilter("bulk-update")}>แก้ไขกลุ่ม</button>
            <button className={actionFilter === "delete" ? "on" : ""} onClick={() => setActionFilter("delete")}>ลบ</button>
          </div>
        </div>
      </div>

      {groups.length === 0 && (
        <div className="card" style={{ padding: 60, textAlign: "center" }}>
          <Icons.History size={32} style={{ color: "var(--muted)", opacity: 0.4, marginBottom: 10 }}/>
          <div style={{ fontWeight: 600, fontSize: 14 }}>ยังไม่มีประวัติ</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>การเปลี่ยนแปลงในระบบจะถูกบันทึกที่นี่</div>
        </div>
      )}

      <div className="stack" style={{ gap: 20 }}>
        {groups.map(([date, entries]) => {
          const display = formatTime(date + "T12:00:00").split(" · ")[0];
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
                          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(e.ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</div>
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
    </div>
  );
}

Object.assign(window, { ConfirmDialog, recordChange, useAuditLog, HistoryPage, loadAuditLog, formatTime: formatTime });
