/* ======== งานของทีม (team tasks) — 2026-10-30 ========
   The owner/manager assigns a task to one person, that person does it on the
   floor and reports, the owner approves. Phase 1 types:
     receive — รายการรอรับเข้า: tracking no. + SKU × qty keyed in advance; staff
               count BLIND (never see the expected qty), split good / damaged,
               photograph the parcel, damage and photo-less products, pick the
               shelf; the owner approves each round. Stock moves ONLY at approval,
               through receiveStockAndRecord + applyReceiveLocs (the Inbound path),
               so history, opId idempotency and the offline queue all apply.
               A short round leaves the task "partial" (ค้างรับ) for the next box.
     general — free text + checklist + an after photo, owner approves.

   Storage: one public.team_tasks row per task (supabase/team-tasks.sql), all
   type-specific state in `data`. Every write sends the whole row guarded by
   `updated_at = <what I read>`; 0 rows back means someone else changed it first
   → reload + toast, never a blind overwrite. The approve path saves the task
   FIRST and only moves stock once that save won, so a retry or a second device
   can't receive the same round twice; claimCommit covers the double-tap.

   Desktop page `TeamTasks` and mobile `MTasks` are thin shells around the same
   inner components (`m` prop picks the shell's classes) — the flows must not
   fork. */
const { useState: useStateTk, useEffect: useEffectTk, useRef: useRefTk, useMemo: useMemoTk } = React;

const TASK_TYPES = {
  receive: { label: "รับสินค้าเข้า", icon: "📦", approve: true },
  general: { label: "งานทั่วไป", icon: "📝", approve: true }
};
const TASK_STATUS = {
  todo:    { label: "รอทำ",           tone: "warning" },
  doing:   { label: "กำลังทำ",         tone: "info" },
  review:  { label: "รออนุมัติ",       tone: "accent" },
  back:    { label: "ส่งกลับแก้ไข",    tone: "danger" },
  partial: { label: "ค้างรับ",          tone: "warning" },
  blocked: { label: "ติดปัญหา",        tone: "danger" },
  done:    { label: "เสร็จแล้ว",        tone: "success" },
  cancel:  { label: "ยกเลิก",          tone: "muted" }
};
const TASK_OPEN = ["todo", "doing", "back", "partial", "blocked", "review"];
const TASKS_LS = "ims_team_tasks_v1";

/* ── data layer ── */
let _tasksCache = null;
let _tasksMissing = false;     // table not created yet (team-tasks.sql not run)
function loadTasks() {
  if (_tasksCache) return _tasksCache;
  try { const a = JSON.parse(localStorage.getItem(TASKS_LS) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function _tkSetCache(list) {
  _tasksCache = list;
  try { localStorage.setItem(TASKS_LS, JSON.stringify(list.slice(0, 200))); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-tasks-change"));
}
function _tkRow(r) {
  return { id: r.id, type: r.type, status: r.status, title: r.title, assignee: r.assignee, assigneeName: r.assignee_name || "",
    createdBy: r.created_by, createdByName: r.created_by_name || "", due: r.due || "", data: r.data || {},
    createdAt: r.created_at, updatedAt: r.updated_at };
}
const _tkDb = () => typeof sb !== "undefined" && sb && sb.from;
function _tkToast(msg, type) { try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: type ? { msg, type } : msg })); } catch (e) {} }
function _tkMe() { const u = window.__currentUser || {}; return { id: u.id || null, name: u.name || "ผู้ใช้", role: u.role || "viewer" }; }
function canManageTasks() { return typeof canDo === "function" ? canDo("manageTasks") : ["admin", "manager"].includes(_tkMe().role); }

async function refreshTasks() {
  if (!_tkDb()) return;
  const { data, error } = await sb.from("team_tasks").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) {
    if (/team_tasks|does not exist|schema cache/i.test(error.message || "")) _tasksMissing = true;
    console.warn("[tasks] load:", error.message);
    return;
  }
  _tasksMissing = false;
  _tkSetCache((data || []).map(_tkRow));
}
let _tkSyncStarted = false;
function startTaskSync() {
  if (_tkSyncStarted) return;
  _tkSyncStarted = true;
  refreshTasks();
  setInterval(() => { if (document.visibilityState === "visible") refreshTasks(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshTasks(); });
}
function _tkLog(task, text) {
  const me = _tkMe();
  return [...((task.data && task.data.log) || []), { at: new Date().toISOString(), by: me.name, text }];
}
async function createTask(t) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const me = _tkMe();
  const row = {
    id: "T" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: t.type, status: "todo", title: t.title, assignee: t.assignee, assignee_name: t.assigneeName,
    created_by_name: me.name, due: t.due || null,
    data: { ...t.data, log: [{ at: new Date().toISOString(), by: me.name, text: `มอบหมายให้ ${t.assigneeName}` }] }
  };
  const { data, error } = await sb.from("team_tasks").insert(row).select();
  if (error) return { error: /row-level security/i.test(error.message) ? "ไม่มีสิทธิ์มอบหมายงาน" : error.message };
  if (!data || !data.length) return { error: "ไม่มีสิทธิ์มอบหมายงาน" };
  _tkSetCache([_tkRow(data[0]), ...loadTasks().filter(x => x.id !== row.id)]);
  return { ok: true, task: _tkRow(data[0]) };
}
/* Whole-row write guarded by updated_at. Returns {ok, task} | {conflict} | {error}. */
async function saveTask(task, patch, logText) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const next = { ...task, ...patch, data: { ...task.data, ...(patch.data || {}) } };
  if (logText) next.data.log = _tkLog(task, logText);
  const { data, error } = await sb.from("team_tasks")
    .update({ status: next.status, title: next.title, assignee: next.assignee, assignee_name: next.assigneeName, due: next.due || null, data: next.data })
    .eq("id", task.id).eq("updated_at", task.updatedAt).select();
  if (error) return { error: /row-level security/i.test(error.message) ? "ไม่มีสิทธิ์แก้ไขงานนี้" : error.message };
  if (!data || !data.length) { await refreshTasks(); return { conflict: true }; }
  const saved = _tkRow(data[0]);
  _tkSetCache(loadTasks().map(x => x.id === saved.id ? saved : x));
  return { ok: true, task: saved };
}
async function deleteTask(id) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const { data, error } = await sb.from("team_tasks").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "ไม่มีสิทธิ์ลบงาน" };
  _tkSetCache(loadTasks().filter(x => x.id !== id));
  return { ok: true };
}
let _tkAssignees = null;
async function loadTaskAssignees() {
  if (_tkAssignees) return _tkAssignees;
  if (!_tkDb()) return [];
  const { data, error } = await sb.rpc("task_assignees");
  if (error) { console.warn("[tasks] assignees:", error.message); return []; }
  _tkAssignees = data || [];
  return _tkAssignees;
}
function useTasks() {
  const [list, setList] = useStateTk(loadTasks);
  useEffectTk(() => {
    startTaskSync();
    const h = () => setList(loadTasks());
    window.addEventListener("ims-tasks-change", h);
    return () => window.removeEventListener("ims-tasks-change", h);
  }, []);
  return list;
}
/* Work waiting on the signed-in person: for a manager, reports to approve and
   blocked tasks; for everyone else, their own open tasks. Feeds both badges. */
function taskBadgeCount() {
  const me = _tkMe();
  const list = loadTasks();
  if (canManageTasks()) return list.filter(t => t.status === "review" || t.status === "blocked").length;
  return list.filter(t => t.assignee === me.id && ["todo", "doing", "back", "partial"].includes(t.status)).length;
}
const _tkToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const taskOverdue = t => TASK_OPEN.includes(t.status) && t.status !== "review" && t.due && t.due < _tkToday();
const _tkN = v => Math.max(0, Math.round(Number(v) || 0));
const _tkProduct = sku => PRODUCTS.find(p => p.sku === sku);
const _tkLeft = l => Math.max(0, (l.exp || 0) - (l.recv || 0) - (l.dmg || 0));
function _tkMatchCode(code, lines) {
  const c = String(code || "").trim().toLowerCase();
  if (!c) return -1;
  return lines.findIndex(l => {
    const p = _tkProduct(l.sku);
    return l.sku.toLowerCase() === c || (p && p.barcode && String(p.barcode).toLowerCase() === c);
  });
}
async function _tkUpload(file) {
  if (typeof uploadTaskPhoto !== "function") throw new Error("อัปโหลดรูปไม่ได้");
  return uploadTaskPhoto(file);
}

/* ── small shared UI ── */
function TkPill({ status }) {
  const s = TASK_STATUS[status] || TASK_STATUS.todo;
  const bg = s.tone === "muted" ? "var(--surface-3)" : `var(--${s.tone}-soft)`;
  const fg = s.tone === "muted" ? "var(--muted)" : `var(--${s.tone})`;
  return <span className="badge" style={{ background: bg, color: fg, fontWeight: 600 }}>{s.label}</span>;
}
function TkBtn(props) {
  // omit(), never `{ ...rest }` destructuring — see CLAUDE.md (_excluded collision).
  const { m, primary, danger, children, style } = props;
  const rest = omit(props, "m", "primary", "danger", "children", "style");
  const cls = m ? ("m-btn-big" + (primary ? "" : " outline")) : ("btn" + (primary ? " btn-primary" : ""));
  const st = { ...(m ? { marginBottom: 0 } : {}), ...(danger ? { color: "var(--danger)" } : {}), ...style };
  return <button type="button" className={cls} style={st} {...rest}>{children}</button>;
}
function TkPhotoBtn({ m, label, done, onPick, busy }) {
  const ref = useRefTk(null);
  return (
    <>
      <button type="button" className={m ? "m-chip" : "btn btn-sm"} disabled={busy} onClick={() => ref.current && ref.current.click()}
        style={done ? { borderColor: "var(--success)", color: "var(--success)" } : {}}>
        {busy ? "กำลังอัปโหลด…" : (done ? "✓ " : "📷 ") + label}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
        onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) onPick(f); }}/>
    </>
  );
}
function TkThumbs({ urls, size = 56 }) {
  const list = (urls || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
      {list.map((u, i) => (
        <img key={i} src={u} alt="" width={size} height={size} loading="lazy"
          onClick={() => typeof openProductImageViewer === "function" && openProductImageViewer(u)}
          style={{ width: size, height: size, objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)", cursor: "zoom-in" }}/>
      ))}
    </div>
  );
}
function TkProductPic({ sku, size = 48 }) {
  if (typeof ProductImageThumb === "function") return <ProductImageThumb sku={sku} size={size} radius={10} zoom/>;
  return <div style={{ width: size, height: size, borderRadius: 10, background: "var(--surface-2)" }}/>;
}
function TkSection({ title, children, right }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, letterSpacing: ".04em", flex: 1 }}>{title}</div>{right}
      </div>
      {children}
    </div>
  );
}
const tkCard = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 14 };
const tkRow = { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border)", flexWrap: "wrap" };
const tkMuted = { fontSize: 12.5, color: "var(--muted)" };

/* ── list row ── */
function TaskRow({ t, onOpen }) {
  const ty = TASK_TYPES[t.type] || TASK_TYPES.general;
  const sub = [ty.label, t.assigneeName, t.due ? "กำหนด " + t.due : ""].filter(Boolean).join(" · ");
  return (
    <button type="button" onClick={() => onOpen(t.id)}
      style={{ ...tkRow, width: "100%", background: "none", border: "none", borderTop: "1px solid var(--border)", textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--fg)" }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--accent-soft)", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }} aria-hidden="true">{ty.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{t.title}</span>
        <span style={tkMuted}>{sub}</span>
        {taskOverdue(t) && <span className="badge" style={{ marginLeft: 6, background: "var(--danger-soft)", color: "var(--danger)" }}>เลยกำหนด</span>}
      </span>
      <TkPill status={t.status}/>
    </button>
  );
}

/* ── task list (both roles) ── */
function TaskList({ m, onOpen, onNew }) {
  const list = useTasks();
  const me = _tkMe();
  const mgr = canManageTasks();
  const [filter, setFilter] = useStateTk("open");
  const mine = mgr ? list : list.filter(t => t.assignee === me.id);
  const shown = mine.filter(t => filter === "open" ? TASK_OPEN.includes(t.status) : !TASK_OPEN.includes(t.status));
  const groups = mgr && filter === "open"
    ? [["รอคุณ (อนุมัติ / ติดปัญหา)", shown.filter(t => t.status === "review" || t.status === "blocked")],
       ["กำลังดำเนินการ", shown.filter(t => t.status !== "review" && t.status !== "blocked")]]
    : [[null, shown]];
  const count = s => mine.filter(t => s.includes(t.status)).length;
  return (
    <div>
      {_tasksMissing && (
        <div style={{ ...tkCard, background: "var(--warning-soft)", borderColor: "var(--warning)", marginBottom: 12, fontSize: 13 }}>
          ยังไม่ได้สร้างตาราง team_tasks ในฐานข้อมูล — ให้ผู้ดูแลรัน supabase/team-tasks.sql ก่อน
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 12 }}>
        {[["รอทำ", ["todo", "doing", "back", "partial"], "var(--fg)"], ["รออนุมัติ", ["review"], "var(--accent)"], ["ติดปัญหา", ["blocked"], "var(--danger)"], ["เสร็จแล้ว", ["done"], "var(--success)"]].map(([lab, st, c]) => (
          <div key={lab} className={m ? "m-kpi" : "kpi"} style={m ? {} : { padding: 14 }}>
            <div style={tkMuted}>{lab}</div>
            <div className="tnum" style={{ fontSize: 24, fontWeight: 700, color: c }}>{count(st)}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {[["open", "งานที่ยังไม่ปิด"], ["closed", "ปิดแล้ว"]].map(([id, lab]) => (
          <button key={id} type="button" className={"m-chip" + (filter === id ? " on" : "")} onClick={() => setFilter(id)}>{lab}</button>
        ))}
      </div>
      <div style={tkCard}>
        {!shown.length && <div style={{ ...tkMuted, padding: "8px 0" }}>{filter === "open" ? (mgr ? "ยังไม่มีงานค้าง — กด “มอบหมายงาน” เพื่อเริ่ม" : "ไม่มีงานค้าง") : "ยังไม่มีงานที่ปิดแล้ว"}</div>}
        {groups.map(([lab, arr], gi) => arr.length ? (
          <div key={gi}>
            {lab && <div style={{ ...tkMuted, fontWeight: 600, marginTop: gi ? 12 : 0, marginBottom: 2 }}>{lab} ({arr.length})</div>}
            {arr.map(t => <TaskRow key={t.id} t={t} onOpen={onOpen}/>)}
          </div>
        ) : null)}
      </div>
      {mgr && onNew && m && <div style={{ marginTop: 12 }}><TkBtn m primary onClick={onNew}>+ มอบหมายงาน</TkBtn></div>}
    </div>
  );
}

/* ── create form (manager) ── */
function TaskCreate({ m, onDone, onCancel }) {
  const [type, setType] = useStateTk("receive");
  const [title, setTitle] = useStateTk("");
  const [trk, setTrk] = useStateTk("");
  const [supplier, setSupplier] = useStateTk("");
  const [due, setDue] = useStateTk(_tkToday());
  const [who, setWho] = useStateTk("");
  const [people, setPeople] = useStateTk([]);
  const [lines, setLines] = useStateTk([]);
  const [skuQ, setSkuQ] = useStateTk("");
  const [qty, setQty] = useStateTk("");
  const [items, setItems] = useStateTk("");
  const [err, setErr] = useStateTk("");
  const [busy, setBusy] = useStateTk(false);
  useEffectTk(() => { loadTaskAssignees().then(setPeople); }, []);
  const inp = m ? "m-input" : "input";
  const matches = useMemoTk(() => {
    const q = skuQ.trim().toLowerCase();
    if (!q) return [];
    return PRODUCTS.filter(p => p.sku.toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q)).slice(0, 6);
  }, [skuQ]);
  const addLine = (sku) => {
    const n = _tkN(qty);
    if (!n) { setErr("ใส่จำนวนที่จะเข้าก่อน แล้วเลือกสินค้า"); return; }
    if (lines.some(l => l.sku === sku)) { setErr(sku + " อยู่ในรายการแล้ว"); return; }
    setLines([...lines, { sku, exp: n, recv: 0, dmg: 0 }]); setSkuQ(""); setQty(""); setErr("");
  };
  const submit = async () => {
    const person = people.find(p => p.id === who);
    if (!person) return setErr("เลือกผู้รับผิดชอบ");
    const list = items.split("\n").map(s => s.trim()).filter(Boolean);
    if (type === "receive" && !lines.length) return setErr("เพิ่มสินค้าที่จะเข้าอย่างน้อย 1 รายการ");
    if (type === "general" && !title.trim()) return setErr("ใส่ชื่องาน");
    if (type === "general" && !list.length) return setErr("ใส่เช็กลิสต์อย่างน้อย 1 ข้อ");
    const t = type === "receive"
      ? { type, title: title.trim() || `รับเข้า ${trk.trim() || lines.length + " รายการ"}`, data: { trk: trk.trim(), supplier: supplier.trim(), lines } }
      : { type, title: title.trim(), data: { items: list, checked: [] } };
    setBusy(true);
    const r = await createTask({ ...t, assignee: person.id, assigneeName: person.name, due });
    setBusy(false);
    if (r.error) return setErr(r.error);
    _tkToast(`มอบหมาย "${t.title}" ให้ ${person.name} แล้ว`);
    onDone && onDone(r.task.id);
  };
  return (
    <div style={tkCard}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(TASK_TYPES).map(([id, ty]) => (
            <button key={id} type="button" className={"m-chip" + (type === id ? " on" : "")} onClick={() => setType(id)}>{ty.icon} {ty.label}</button>
          ))}
        </div>
        <label style={tkMuted}>ผู้รับผิดชอบ
          <select className={inp} value={who} onChange={e => setWho(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
            <option value="">เลือกพนักงาน…</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={tkMuted}>กำหนดเสร็จ
          <input className={inp} type="date" value={due} onChange={e => setDue(e.target.value)} style={{ width: "100%", marginTop: 4 }}/>
        </label>
        <input className={inp} placeholder={type === "receive" ? "ชื่องาน (ไม่ใส่ = ตั้งจากเลขพัสดุ)" : "ชื่องาน เช่น ทำความสะอาดโซนแพ็ค"} value={title} onChange={e => setTitle(e.target.value)}/>
        {type === "receive" && (
          <>
            <input className={inp + " mono"} placeholder="เลขพัสดุ เช่น TH1234567890" value={trk} onChange={e => setTrk(e.target.value)}/>
            <input className={inp} placeholder="ผู้ขาย / ร้านที่สั่ง (ถ้ามี)" value={supplier} onChange={e => setSupplier(e.target.value)}/>
            <div style={{ ...tkMuted, fontWeight: 600 }}>สินค้าที่จะเข้า</div>
            {lines.map((l, i) => {
              const p = _tkProduct(l.sku);
              return (
                <div key={l.sku} style={tkRow}>
                  <TkProductPic sku={l.sku} size={40}/>
                  <span style={{ flex: 1, minWidth: 0 }}><span className="mono" style={{ fontSize: 13 }}>{l.sku}</span><br/><span style={tkMuted}>{p ? p.name : ""}</span></span>
                  <span className="tnum" style={{ fontWeight: 600 }}>× {l.exp}</span>
                  <button type="button" className={m ? "m-chip" : "btn btn-sm"} aria-label="ลบ" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8 }}>
              <input className={inp} type="number" inputMode="numeric" min="1" placeholder="จำนวน" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 96 }}/>
              <input className={inp} placeholder="พิมพ์ SKU หรือชื่อสินค้า แล้วเลือก" value={skuQ} onChange={e => setSkuQ(e.target.value)} style={{ flex: 1, minWidth: 0 }}/>
            </div>
            {matches.map(p => (
              <button key={p.sku} type="button" onClick={() => addLine(p.sku)}
                style={{ ...tkRow, width: "100%", background: "none", border: "none", borderTop: "1px solid var(--border)", textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--fg)" }}>
                <TkProductPic sku={p.sku} size={36}/>
                <span style={{ flex: 1, minWidth: 0 }}><span className="mono" style={{ fontSize: 13 }}>{p.sku}</span><br/><span style={tkMuted}>{p.name}</span></span>
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>+ เพิ่ม</span>
              </button>
            ))}
            {skuQ.trim() && !matches.length && <div style={tkMuted}>ไม่พบสินค้า — สินค้าใหม่ให้เพิ่มที่หน้า สินค้าคงคลัง ก่อน แล้วค่อยใส่ในรายการนี้</div>}
          </>
        )}
        {type === "general" && (
          <textarea className={inp} rows={4} placeholder={"เช็กลิสต์ บรรทัดละ 1 ข้อ\nเช่น เช็ดโต๊ะแพ็ค\nเก็บกล่องเปล่า"} value={items} onChange={e => setItems(e.target.value)} style={{ width: "100%", resize: "vertical" }}/>
        )}
        {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TkBtn m={m} primary disabled={busy} onClick={submit} style={m ? { flex: 1 } : {}}>{busy ? "กำลังบันทึก…" : "มอบหมาย"}</TkBtn>
          {onCancel && <TkBtn m={m} onClick={onCancel} style={m ? { flex: 1 } : {}}>ยกเลิก</TkBtn>}
        </div>
      </div>
    </div>
  );
}

/* ── receive: counting screen (assignee, or a manager counting it themself) ── */
function ReceiveCount({ m, task, onSubmit, selfApprove }) {
  const d = task.data || {};
  const lines = d.lines || [];
  const [cnt, setCnt] = useStateTk(() => Object.fromEntries(lines.map(l => [l.sku, { good: "", dmg: "", ev: [], pp: "" }])));
  const [pkg, setPkg] = useStateTk([]);
  const [extras, setExtras] = useStateTk([]);
  const [extraDraft, setExtraDraft] = useStateTk(null);
  const [shelf, setShelf] = useStateTk(() => (typeof lastReceiveLoc === "function" && lastReceiveLoc()) || "");
  const [note, setNote] = useStateTk("");
  const [scan, setScan] = useStateTk("");
  const [camOpen, setCamOpen] = useStateTk(false);
  const [busyKey, setBusyKey] = useStateTk("");
  const [err, setErr] = useStateTk("");
  const [ok, setOk] = useStateTk("");
  const scanRef = useRefTk(null);
  const sending = useRefTk(false);
  const inp = m ? "m-input" : "input";
  const positions = useMemoTk(() => (typeof allPositions === "function" ? allPositions().map(p => p.code) : []), []);
  const setLine = (sku, k, v) => setCnt(c => ({ ...c, [sku]: { ...c[sku], [k]: v } }));
  const upload = async (key, file, apply) => {
    setBusyKey(key); setErr("");
    try { apply(await _tkUpload(file)); }
    catch (e) { setErr("อัปโหลดรูปไม่สำเร็จ: " + (e && e.message || e)); }
    finally { setBusyKey(""); }
  };
  const onCode = (raw) => {
    const code = String(raw || "").trim();
    if (!code) return;
    const i = _tkMatchCode(code, lines);
    if (i < 0) { setExtraDraft({ code, name: "", qty: "1", photo: "" }); setOk(""); setErr(`${code} ไม่อยู่ในรายการนี้ — แจ้งเป็นของเกินได้ด้านล่าง`); return; }
    const sku = lines[i].sku;
    setCnt(c => { const n = _tkN(c[sku].good) + 1; setOk(`✓ ${sku} = ${n}`); return { ...c, [sku]: { ...c[sku], good: String(n) } }; });
    setErr("");
  };
  const addExtra = () => {
    const x = extraDraft;
    if (!x.name.trim()) return setErr("ใส่ชื่อหรือลักษณะของที่เกินมา");
    if (!_tkN(x.qty)) return setErr("ใส่จำนวนของที่เกิน");
    if (!x.photo) return setErr("ถ่ายรูปของที่เกินก่อน");
    setExtras([...extras, { ...x, qty: _tkN(x.qty), action: "hold" }]); setExtraDraft(null); setErr("");
  };
  const submit = async (approveNow) => {
    if (sending.current) return;
    const anyCount = lines.some(l => _tkN(cnt[l.sku].good) + _tkN(cnt[l.sku].dmg) > 0) || extras.length;
    if (!anyCount) return setErr("ยังไม่ได้นับอะไรเลยในรอบนี้");
    if (!pkg.length) return setErr("ถ่ายรูปพัสดุอย่างน้อย 1 รูป");
    const noPic = lines.find(l => _tkN(cnt[l.sku].good) > 0 && !(typeof resolveProductImage === "function" && resolveProductImage(l.sku)) && !cnt[l.sku].pp);
    if (noPic) return setErr(`${noPic.sku} ยังไม่มีรูปสินค้า — ถ่ายรูปสินค้าก่อนส่ง`);
    const dmgNoPic = lines.find(l => _tkN(cnt[l.sku].dmg) > 0 && !cnt[l.sku].ev.length);
    if (dmgNoPic) return setErr(`${dmgNoPic.sku} มีของเสีย — ถ่ายรูปหลักฐานก่อน`);
    if (lines.some(l => _tkN(cnt[l.sku].dmg) > 0) && !note.trim()) return setErr("มีของเสีย — ใส่หมายเหตุว่าเสียอย่างไร");
    if (lines.some(l => _tkN(cnt[l.sku].good) > 0) && !shelf) return setErr("เลือกชั้นที่วางสินค้า");
    sending.current = true;
    const me = _tkMe();
    const round = {
      by: me.id, byName: me.name, at: new Date().toISOString(), shelf, note: note.trim(), pkg, extras,
      lines: Object.fromEntries(lines.map(l => [l.sku, { good: _tkN(cnt[l.sku].good), dmg: _tkN(cnt[l.sku].dmg), ev: cnt[l.sku].ev, pp: cnt[l.sku].pp }]))
    };
    try { await onSubmit(round, approveNow); } finally { sending.current = false; }
  };
  return (
    <div>
      {task.status === "back" && d.comment && <div style={{ ...tkCard, background: "var(--danger-soft)", borderColor: "var(--danger)", fontSize: 13, marginBottom: 10 }}>ส่งกลับให้นับใหม่: {d.comment}</div>}
      {(d.rounds || []).length > 0 && <div style={{ ...tkMuted, marginBottom: 8 }}>กล่อง/รอบที่ {(d.rounds || []).length + 1} — นับเฉพาะของที่มาถึงรอบนี้</div>}
      <div style={{ ...tkCard, background: "var(--surface-2)" }}>
        <div style={tkMuted}>สแกนบาร์โค้ด หรือพิมพ์รหัสแล้วกด Enter · +1 ชิ้นดี</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input ref={scanRef} className={inp + " mono"} value={scan} placeholder="สแกน / พิมพ์ SKU" style={{ flex: 1, minWidth: 0 }}
            onChange={e => setScan(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onCode(scan); setScan(""); } }}/>
          {typeof CameraScanner === "function" && <button type="button" className={m ? "m-chip" : "btn"} onClick={() => setCamOpen(true)}>📷 สแกน</button>}
        </div>
        {ok && <div style={{ color: "var(--success)", fontSize: 13, marginTop: 6 }}>{ok}</div>}
        {extraDraft && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", display: "grid", gap: 8 }}>
            <div style={{ fontSize: 13, color: "var(--danger)" }}>รหัส <span className="mono">{extraDraft.code}</span> ไม่อยู่ในรายการ — แจ้งเป็นของเกิน?</div>
            <input className={inp} placeholder="ชื่อ/ลักษณะสินค้า" value={extraDraft.name} onChange={e => setExtraDraft({ ...extraDraft, name: e.target.value })}/>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input className={inp} type="number" inputMode="numeric" min="1" value={extraDraft.qty} onChange={e => setExtraDraft({ ...extraDraft, qty: e.target.value })} style={{ width: 90 }}/>
              <TkPhotoBtn m={m} label="รูป" done={!!extraDraft.photo} busy={busyKey === "x"} onPick={f => upload("x", f, u => setExtraDraft(x => ({ ...x, photo: u })))}/>
              <TkBtn m={false} primary onClick={addExtra}>แจ้งของเกิน</TkBtn>
              <TkBtn m={false} onClick={() => { setExtraDraft(null); setErr(""); }}>ไม่ใช่</TkBtn>
            </div>
          </div>
        )}
      </div>
      <TkSection title="นับจำนวน · ดี = เข้าสต็อก · เสีย = ไม่เข้าสต็อก (รอเคลม)">
        {lines.map(l => {
          const p = _tkProduct(l.sku);
          const c = cnt[l.sku];
          const hasPic = typeof resolveProductImage === "function" && resolveProductImage(l.sku);
          return (
            <div key={l.sku} style={tkRow}>
              <TkProductPic sku={l.sku} size={m ? 56 : 52}/>
              <span style={{ flex: 1, minWidth: 140 }}>
                <span className="mono" style={{ fontSize: 13 }}>{l.sku}</span><br/>
                <span style={tkMuted}>{p ? p.name : ""}{l.recv ? ` · รับแล้วรอบก่อน ${l.recv}` : ""}</span>
              </span>
              <label style={tkMuted}>ดี <input className={inp + " tnum"} type="number" inputMode="numeric" min="0" placeholder="0" value={c.good} onChange={e => setLine(l.sku, "good", e.target.value)} style={{ width: 76 }}/></label>
              <label style={tkMuted}>เสีย <input className={inp + " tnum"} type="number" inputMode="numeric" min="0" placeholder="0" value={c.dmg} onChange={e => setLine(l.sku, "dmg", e.target.value)} style={{ width: 76 }}/></label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%" }}>
                <TkPhotoBtn m={m} label="หลักฐาน" done={c.ev.length > 0} busy={busyKey === "ev" + l.sku} onPick={f => upload("ev" + l.sku, f, u => setLine(l.sku, "ev", [...c.ev, u]))}/>
                {!hasPic && <TkPhotoBtn m={m} label="ถ่ายรูปสินค้า" done={!!c.pp} busy={busyKey === "pp" + l.sku} onPick={f => upload("pp" + l.sku, f, u => setLine(l.sku, "pp", u))}/>}
              </div>
              <TkThumbs urls={[c.pp, ...c.ev]} size={48}/>
            </div>
          );
        })}
      </TkSection>
      {extras.length > 0 && (
        <TkSection title="ของเกินที่แจ้งรอบนี้">
          {extras.map((x, i) => (
            <div key={i} style={tkRow}><TkThumbs urls={[x.photo]} size={40}/><span style={{ flex: 1 }}>{x.name} <span className="mono" style={tkMuted}>{x.code}</span></span><span className="tnum">× {x.qty}</span></div>
          ))}
        </TkSection>
      )}
      <TkSection title="รูปพัสดุ · ชั้นที่วาง · หมายเหตุ">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <TkPhotoBtn m={m} label="รูปพัสดุ" done={pkg.length > 0} busy={busyKey === "pkg"} onPick={f => upload("pkg", f, u => setPkg(a => [...a, u]))}/>
          <select className={inp} value={shelf} onChange={e => setShelf(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
            <option value="">เลือกชั้นที่วาง…</option>
            {positions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <TkThumbs urls={pkg}/>
        <input className={inp} placeholder="หมายเหตุ เช่น กล่องบุบ 2 ชิ้น / กล่องที่ 2 ยังไม่มา" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%", marginTop: 8 }}/>
      </TkSection>
      {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {selfApprove && <TkBtn m={m} primary onClick={() => submit(true)} style={m ? { flex: 1 } : {}}>ส่งและอนุมัติทันที</TkBtn>}
        <TkBtn m={m} primary={!selfApprove} onClick={() => submit(false)} style={m ? { flex: 1 } : {}}>ส่งรายงาน</TkBtn>
      </div>
      {camOpen && typeof CameraScanner === "function" && <CameraScanner continuous onScan={code => onCode(code)} onClose={() => setCamOpen(false)}/>}
    </div>
  );
}

/* Progress table — the owner's view of expected vs received (staff count blind). */
function ReceiveProgress({ task }) {
  const lines = (task.data && task.data.lines) || [];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        <thead><tr style={{ color: "var(--muted)" }}>{["SKU", "สั่ง", "รับแล้ว", "เสีย", "ค้าง"].map((h, i) => <th key={h} style={{ textAlign: i ? "right" : "left", padding: "6px 4px", fontWeight: 500 }}>{h}</th>)}</tr></thead>
        <tbody>{lines.map(l => (
          <tr key={l.sku} style={{ borderTop: "1px solid var(--border)" }}>
            <td className="mono" style={{ padding: "6px 4px" }}>{l.sku}</td>
            <td style={{ textAlign: "right", padding: "6px 4px" }}>{l.exp}</td>
            <td style={{ textAlign: "right", padding: "6px 4px" }}>{l.recv || 0}</td>
            <td style={{ textAlign: "right", padding: "6px 4px", color: l.dmg ? "var(--danger)" : undefined }}>{l.dmg || 0}</td>
            <td style={{ textAlign: "right", padding: "6px 4px", color: _tkLeft(l) ? "var(--warning)" : "var(--success)", fontWeight: 600 }}>{_tkLeft(l)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ── receive: owner review of a submitted round ── */
function ReceiveReview({ m, task, onApprove, onBack }) {
  const d = task.data || {};
  const r = d.round || {};
  const lines = d.lines || [];
  const [usePP, setUsePP] = useStateTk(() => Object.fromEntries(lines.map(l => [l.sku, true])));
  const [extraAct, setExtraAct] = useStateTk(() => (r.extras || []).map(() => "hold"));
  const [comment, setComment] = useStateTk("");
  const [err, setErr] = useStateTk("");
  const inp = m ? "m-input" : "input";
  const anyLeft = lines.some(l => _tkLeft({ ...l, recv: (l.recv || 0) + ((r.lines || {})[l.sku] || {}).good, dmg: (l.dmg || 0) + ((r.lines || {})[l.sku] || {}).dmg }) > 0);
  return (
    <div>
      <div style={{ ...tkMuted, marginBottom: 6 }}>รอบที่ {(d.rounds || []).length + 1} · นับโดย {r.byName} · ชั้น {r.shelf || "-"}</div>
      {lines.map(l => {
        const x = (r.lines || {})[l.sku] || { good: 0, dmg: 0, ev: [] };
        const rem = (l.exp || 0) - (l.recv || 0) - (l.dmg || 0) - x.good - x.dmg;
        const [lab, tone] = rem === 0 ? ["ครบ", "success"] : rem > 0 ? ["ค้าง " + rem, "warning"] : ["เกิน " + (-rem), "danger"];
        return (
          <div key={l.sku} style={tkRow}>
            <TkProductPic sku={l.sku} size={48}/>
            <span style={{ flex: 1, minWidth: 140 }}>
              <span className="mono" style={{ fontSize: 13 }}>{l.sku}</span><br/>
              <span style={tkMuted}>สั่ง {l.exp} · รับแล้ว {l.recv || 0} · รอบนี้ ดี {x.good}{x.dmg ? <span style={{ color: "var(--danger)" }}> · เสีย {x.dmg}</span> : null}</span>
            </span>
            <span className="badge" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})`, fontWeight: 600 }}>{lab}</span>
            <TkThumbs urls={[x.pp, ...(x.ev || [])]} size={48}/>
            {x.pp && (
              <label style={{ ...tkMuted, display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
                <input type="checkbox" checked={!!usePP[l.sku]} onChange={e => setUsePP({ ...usePP, [l.sku]: e.target.checked })}/> ใช้รูปที่พนักงานถ่ายเป็นรูปสินค้า
              </label>
            )}
          </div>
        );
      })}
      {(r.extras || []).length > 0 && (
        <TkSection title="ของเกิน (ไม่อยู่ในรายการ)">
          {r.extras.map((x, i) => (
            <div key={i} style={tkRow}>
              <TkThumbs urls={[x.photo]} size={40}/>
              <span style={{ flex: 1, minWidth: 120 }}>{x.name} <span className="mono" style={tkMuted}>{x.code}</span> × {x.qty}</span>
              <select className={inp} value={extraAct[i]} onChange={e => setExtraAct(extraAct.map((a, j) => j === i ? e.target.value : a))}>
                <option value="hold">พักไว้ ยังไม่เข้าสต็อก</option>
                <option value="return">ส่งคืนผู้ขาย</option>
              </select>
            </div>
          ))}
        </TkSection>
      )}
      <TkThumbs urls={r.pkg} size={72}/>
      {r.note && <div style={{ ...tkMuted, marginTop: 6 }}>หมายเหตุ: {r.note}</div>}
      <input className={inp} placeholder="คอมเมนต์ (ใช้ตอนส่งกลับให้นับใหม่)" value={comment} onChange={e => { setComment(e.target.value); setErr(""); }} style={{ width: "100%", marginTop: 10 }}/>
      {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <TkBtn m={m} primary onClick={() => onApprove({ usePP, extraAct, close: false })} style={m ? { width: "100%" } : {}}>อนุมัติรับเข้ารอบนี้{anyLeft ? " (ที่เหลือค้างรับ)" : ""}</TkBtn>
        {anyLeft && <TkBtn m={m} onClick={() => onApprove({ usePP, extraAct, close: true })} style={m ? { flex: 1 } : {}}>อนุมัติ + ปิดงาน</TkBtn>}
        <TkBtn m={m} onClick={() => comment.trim() ? onBack(comment.trim()) : setErr("ใส่คอมเมนต์ก่อนส่งกลับ")} style={m ? { flex: 1 } : {}}>ส่งกลับนับใหม่</TkBtn>
      </div>
      <div style={{ ...tkMuted, marginTop: 6 }}>ของดีเข้าสต็อก · ของเสียบันทึกไว้รอเคลม ไม่เข้าสต็อก</div>
    </div>
  );
}

/* ── general task: checklist + after photo ── */
function GeneralWork({ m, task, editable, onSubmit }) {
  const d = task.data || {};
  const [checked, setChecked] = useStateTk(() => (d.items || []).map((_, i) => !!(d.checked || [])[i]));
  const [photo, setPhoto] = useStateTk(d.photo || "");
  const [note, setNote] = useStateTk("");
  const [busy, setBusy] = useStateTk(false);
  const [err, setErr] = useStateTk("");
  const sending = useRefTk(false);
  const submit = async () => {
    if (sending.current) return;
    if (checked.some(c => !c)) return setErr("ติ๊กให้ครบทุกข้อก่อนส่ง");
    if (!photo) return setErr("ถ่ายรูปหลังทำ 1 รูป");
    sending.current = true;
    try { await onSubmit({ checked, photo, note: note.trim() }); } finally { sending.current = false; }
  };
  return (
    <div>
      {task.status === "back" && d.comment && <div style={{ ...tkCard, background: "var(--danger-soft)", borderColor: "var(--danger)", fontSize: 13, marginBottom: 10 }}>ส่งกลับแก้ไข: {d.comment}</div>}
      {(d.items || []).map((it, i) => (
        <label key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 14 }}>
          <input type="checkbox" style={{ width: 20, height: 20 }} checked={checked[i]} disabled={!editable} onChange={e => setChecked(checked.map((c, j) => j === i ? e.target.checked : c))}/> {it}
        </label>
      ))}
      <TkThumbs urls={[photo]} size={96}/>
      {d.note && <div style={{ ...tkMuted, marginTop: 6 }}>หมายเหตุ: {d.note}</div>}
      {editable && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <TkPhotoBtn m={m} label="รูปหลังทำ" done={!!photo} busy={busy} onPick={async f => { setBusy(true); try { setPhoto(await _tkUpload(f)); } catch (e) { setErr("อัปโหลดรูปไม่สำเร็จ"); } setBusy(false); }}/>
          </div>
          <input className={m ? "m-input" : "input"} placeholder="หมายเหตุ (ถ้ามี)" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%", marginTop: 8 }}/>
          {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{err}</div>}
          <div style={{ marginTop: 10 }}><TkBtn m={m} primary onClick={submit}>ส่งรายงาน</TkBtn></div>
        </>
      )}
    </div>
  );
}

/* ── task detail: routes to the right work/review screen + owner controls ── */
function TaskDetail({ m, id, onBack }) {
  const list = useTasks();
  const task = list.find(t => t.id === id);
  const me = _tkMe();
  const mgr = canManageTasks();
  const [people, setPeople] = useStateTk([]);
  const [reassignTo, setReassignTo] = useStateTk("");
  const [reason, setReason] = useStateTk("");
  const [err, setErr] = useStateTk("");
  const approving = useRefTk(false);
  useEffectTk(() => { if (mgr) loadTaskAssignees().then(setPeople); }, [mgr]);
  // Opening your own task marks it started.
  useEffectTk(() => {
    if (task && task.assignee === me.id && task.status === "todo") saveTask(task, { status: "doing" }, "เริ่มทำงาน");
  }, [task && task.id, task && task.status]);
  if (!task) return <div style={tkCard}><div style={tkMuted}>ไม่พบงานนี้ (อาจถูกลบหรือไม่ได้มอบหมายให้คุณ)</div><div style={{ marginTop: 10 }}><TkBtn m={m} onClick={onBack}>กลับ</TkBtn></div></div>;
  const d = task.data || {};
  const ty = TASK_TYPES[task.type] || TASK_TYPES.general;
  const mine = task.assignee === me.id;
  const selfMode = mgr && d.selfBy === me.id;
  const workOpen = ["todo", "doing", "back", "partial"].includes(task.status);
  const canWork = workOpen && (mine || selfMode);
  const inp = m ? "m-input" : "input";

  const save = async (patch, logText, okMsg) => {
    setErr("");
    const r = await saveTask(task, patch, logText);
    if (r.conflict) { _tkToast("งานนี้ถูกแก้จากอีกเครื่อง — โหลดข้อมูลล่าสุดแล้ว ลองอีกครั้ง", "warn"); return null; }
    if (r.error) { setErr(r.error); return null; }
    if (okMsg) _tkToast(okMsg);
    return r.task;
  };

  /* Approve one receive round. Order matters: the task row is saved FIRST with
     the updated_at guard — only the device that wins that write moves stock, so
     a second approver, a retry or a double tap can never receive it twice. */
  const approveRound = async (cur, round, opts) => {
    if (approving.current) return;
    approving.current = true;
    try {
      const rows = (cur.data.lines || []).map(l => ({ sku: l.sku, qty: _tkN((round.lines[l.sku] || {}).good), loc: round.shelf })).filter(x => x.qty > 0 && _tkProduct(x.sku));
      const key = typeof commitFingerprint === "function" ? commitFingerprint("task:" + cur.id + ":" + ((cur.data.rounds || []).length + 1), rows) : null;
      if (key && typeof claimCommit === "function" && !claimCommit(key)) { _tkToast("กำลังบันทึกรอบนี้อยู่แล้ว"); return; }
      const lines = (cur.data.lines || []).map(l => {
        const x = round.lines[l.sku] || {};
        return { ...l, recv: (l.recv || 0) + _tkN(x.good), dmg: (l.dmg || 0) + _tkN(x.dmg) };
      });
      const left = lines.some(l => _tkLeft(l) > 0);
      const done = !left || opts.close;
      const extras = (round.extras || []).map((x, i) => ({ ...x, action: (opts.extraAct || [])[i] || "hold" }));
      const summary = lines.map(l => { const x = round.lines[l.sku] || {}; return `${l.sku} ดี ${_tkN(x.good)}${_tkN(x.dmg) ? " เสีย " + _tkN(x.dmg) : ""}`; }).join(", ");
      const saved = await saveTask(cur, {
        status: done ? "done" : "partial",
        data: { lines, round: null, comment: "", selfBy: null, rounds: [...(cur.data.rounds || []), { ...round, extras, approvedBy: me.name, approvedAt: new Date().toISOString() }] }
      }, `อนุมัติรอบ ${(cur.data.rounds || []).length + 1}: ${summary}` + (done ? (left ? " · ปิดงาน (ของที่ค้างบันทึกเป็นขาดส่ง)" : " · ครบ ปิดงาน") : " · ที่เหลือค้างรับ"));
      if (saved.conflict || saved.error) {
        if (key && typeof releaseCommit === "function") releaseCommit(key);
        _tkToast(saved.error || "งานนี้ถูกแก้จากอีกเครื่อง — ยังไม่ได้รับเข้า ลองอีกครั้ง", "error");
        return;
      }
      const reason = `รับเข้าตามงาน ${cur.data.trk || cur.title}`;
      if (rows.length && typeof receiveStockAndRecord === "function") receiveStockAndRecord(rows, reason, { audit: true });
      if (rows.length && typeof applyReceiveLocs === "function") {
        applyReceiveLocs(rows).then(res => { if (res && res.errors && res.errors.length) _tkToast(`รับเข้าแล้ว แต่บันทึกตำแหน่งไม่สำเร็จ ${res.errors.length} SKU — แก้ได้ที่หน้าสินค้า`, "warn"); }).catch(() => {});
      }
      (cur.data.lines || []).forEach(l => {
        const x = round.lines[l.sku] || {};
        if (x.pp && opts.usePP && opts.usePP[l.sku] !== false && typeof setProductImage === "function"
            && !(typeof resolveProductImage === "function" && resolveProductImage(l.sku))) setProductImage(l.sku, x.pp);
      });
      _tkToast(rows.length ? `รับเข้าแล้ว ${rows.reduce((s, r) => s + r.qty, 0)} ชิ้น` + (done ? " · ปิดงาน" : " · ที่เหลือค้างรับ") : "บันทึกแล้ว");
    } finally { approving.current = false; }
  };

  const submitReceive = async (round, approveNow) => {
    const saved = await save({ status: approveNow ? task.status : "review", data: { round, comment: "" } },
      `ส่งรายงานรอบ ${(d.rounds || []).length + 1}: ` + Object.entries(round.lines).map(([s, x]) => `${s} ดี ${x.good}${x.dmg ? " เสีย " + x.dmg : ""}`).join(", ") + (round.extras.length ? ` · ของเกิน ${round.extras.length} รายการ` : ""),
      approveNow ? null : "ส่งรายงานแล้ว รอเจ้าของอนุมัติ");
    if (saved && approveNow) await approveRound(saved, round, { usePP: {}, extraAct: [], close: false });
  };
  const submitGeneral = async (res) => {
    if (selfMode) await save({ status: "done", data: { ...res, selfBy: null } }, "ทำเองและปิดงาน", "ปิดงานแล้ว");
    else await save({ status: "review", data: { ...res, comment: "" } }, "ส่งรายงาน", "ส่งรายงานแล้ว รอเจ้าของอนุมัติ");
  };

  return (
    <div>
      <div style={tkCard}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 22 }} aria-hidden="true">{ty.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{task.title}</div>
            <div style={tkMuted}>{ty.label} · {task.assigneeName}{d.selfBy ? " (เจ้าของทำเอง)" : ""}{task.due ? " · กำหนด " + task.due : ""}{taskOverdue(task) ? " · เลยกำหนด" : ""}</div>
            {task.type === "receive" && (d.trk || d.supplier) && <div style={tkMuted}>{d.trk ? <>เลขพัสดุ <span className="mono">{d.trk}</span></> : null}{d.trk && d.supplier ? " · " : ""}{d.supplier || ""}</div>}
          </div>
          <TkPill status={task.status}/>
        </div>
        {task.status === "blocked" && <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>ติดปัญหา: {d.reason}</div>}
        {task.type === "receive" && mgr && <div style={{ marginTop: 10 }}><ReceiveProgress task={task}/></div>}
      </div>

      <div style={{ ...tkCard, marginTop: 12 }}>
        {task.type === "receive" && canWork && <ReceiveCount m={m} task={task} selfApprove={selfMode} onSubmit={submitReceive}/>}
        {task.type === "receive" && task.status === "review" && mgr && d.round && (
          <ReceiveReview m={m} task={task}
            onApprove={opts => approveRound(task, d.round, opts)}
            onBack={c => save({ status: "back", data: { round: null, comment: c } }, "ส่งกลับให้นับใหม่: " + c, "ส่งกลับแล้ว")}/>
        )}
        {task.type === "receive" && task.status === "review" && !mgr && <div style={tkMuted}>ส่งรายงานแล้ว รอเจ้าของอนุมัติ</div>}
        {task.type === "receive" && !canWork && workOpen && mgr && <div style={tkMuted}>รอ {task.assigneeName} นับ{task.status === "partial" ? "กล่องถัดไป" : ""}</div>}
        {task.type === "receive" && ["done", "cancel"].includes(task.status) && <div style={tkMuted}>{task.status === "done" ? "ปิดงานแล้ว" : "ยกเลิกแล้ว"}</div>}
        {task.type === "general" && (
          <GeneralWork m={m} task={task} editable={canWork} onSubmit={submitGeneral}/>
        )}
        {task.type === "general" && task.status === "review" && mgr && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <TkBtn m={m} primary onClick={() => save({ status: "done" }, "อนุมัติ · ปิดงาน", "ปิดงานแล้ว")}>อนุมัติ</TkBtn>
            <TkBtn m={m} onClick={() => { const c = reason.trim(); if (!c) return setErr("ใส่คอมเมนต์ในช่องด้านล่างก่อนส่งกลับ"); save({ status: "back", data: { comment: c } }, "ส่งกลับแก้ไข: " + c, "ส่งกลับแล้ว"); setReason(""); }}>ส่งกลับแก้ไข</TkBtn>
          </div>
        )}
      </div>

      {(canWork || (mgr && TASK_OPEN.includes(task.status))) && (
        <div style={{ ...tkCard, marginTop: 12 }}>
          <input className={inp} placeholder={mgr ? "เหตุผล / คอมเมนต์" : "ติดปัญหาอะไร? (เช่น ของยังไม่มา ไม่มีถุงขยะ)"} value={reason} onChange={e => { setReason(e.target.value); setErr(""); }} style={{ width: "100%" }}/>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {canWork && task.status !== "blocked" && (
              <TkBtn m={m} danger onClick={() => reason.trim() ? save({ status: "blocked", data: { reason: reason.trim(), prevStatus: task.status } }, "แจ้งติดปัญหา: " + reason.trim(), "แจ้งเจ้าของแล้ว").then(() => setReason("")) : setErr("ใส่เหตุผลที่ติดปัญหา")}>ติดปัญหา</TkBtn>
            )}
            {mgr && task.status === "blocked" && <TkBtn m={m} primary onClick={() => save({ status: d.prevStatus || "doing", data: { reason: "" } }, "แก้ปัญหาแล้ว ให้ทำต่อ", "ส่งกลับให้ทำต่อแล้ว")}>แก้แล้ว ให้ทำต่อ</TkBtn>}
            {mgr && workOpen && !selfMode && <TkBtn m={m} onClick={() => save({ status: task.status === "todo" ? "doing" : task.status, data: { selfBy: me.id } }, "เจ้าของรับไปทำเอง")}>ทำเอง</TkBtn>}
            {mgr && TASK_OPEN.includes(task.status) && <TkBtn m={m} danger onClick={() => save({ status: "cancel" }, "ยกเลิกงาน" + (reason.trim() ? ": " + reason.trim() : ""), "ยกเลิกงานแล้ว")}>ยกเลิกงาน</TkBtn>}
          </div>
          {mgr && TASK_OPEN.includes(task.status) && task.status !== "review" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <select className={inp} value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
                <option value="">เปลี่ยนผู้รับผิดชอบเป็น…</option>
                {people.filter(p => p.id !== task.assignee).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <TkBtn m={false} onClick={() => {
                const p = people.find(x => x.id === reassignTo);
                if (!p) return setErr("เลือกคนที่จะมอบหมายให้");
                save({ assignee: p.id, assigneeName: p.name, status: task.status === "blocked" ? (d.prevStatus || "todo") : task.status, data: { selfBy: null } }, `เปลี่ยนผู้รับผิดชอบเป็น ${p.name}`, `มอบหมายให้ ${p.name} แล้ว`).then(() => setReassignTo(""));
              }}>เปลี่ยน</TkBtn>
            </div>
          )}
          {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{err}</div>}
        </div>
      )}

      <div style={{ ...tkCard, marginTop: 12 }}>
        <div style={{ ...tkMuted, fontWeight: 600, marginBottom: 4 }}>ไทม์ไลน์</div>
        {[...(d.log || [])].reverse().map((e, i) => (
          <div key={i} style={{ fontSize: 12.5, color: "var(--fg-2)", padding: "4px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <span className="tnum" style={{ color: "var(--muted)" }}>{new Date(e.at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> · {e.by} · {e.text}
          </div>
        ))}
      </div>
      {!m && <div style={{ marginTop: 12 }}><TkBtn onClick={onBack}>← กลับไปรายการงาน</TkBtn></div>}
    </div>
  );
}

/* ── desktop page ── */
function TeamTasks({ pushToast }) {
  const [view, setView] = useStateTk({ v: "list" });
  const mgr = canManageTasks();
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{mgr ? "งานของทีม" : "งานของฉัน"}</h1>
          <div className="page-sub">{mgr ? "มอบหมายงาน ติดตามผล และอนุมัติรายงานของพนักงาน" : "งานที่ได้รับมอบหมาย — ทำแล้วส่งรายงานให้เจ้าของอนุมัติ"}</div>
        </div>
        <div className="row">
          {view.v !== "list" && <button className="btn" onClick={() => setView({ v: "list" })}>← รายการงาน</button>}
          {mgr && view.v === "list" && <button className="btn btn-primary" onClick={() => setView({ v: "new" })}>+ มอบหมายงาน</button>}
        </div>
      </div>
      <div style={{ maxWidth: 860 }}>
        {view.v === "list" && <TaskList onOpen={id => setView({ v: "task", id })} onNew={mgr ? () => setView({ v: "new" }) : null}/>}
        {view.v === "new" && <TaskCreate onDone={id => setView({ v: "task", id })} onCancel={() => setView({ v: "list" })}/>}
        {view.v === "task" && <TaskDetail id={view.id} onBack={() => setView({ v: "list" })}/>}
      </div>
    </div>
  );
}

/* ── mobile screens (handheld.jsx routes view "tasks" / "task" / "task-new") ── */
function MTasks({ ctx }) {
  const mgr = canManageTasks();
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back} aria-label="กลับ"><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">{mgr ? "งานของทีม" : "งานของฉัน"}</div>
        {mgr && <button className="m-action accent" onClick={() => ctx.push("task-new")} aria-label="มอบหมายงาน"><Icons.Plus size={16}/></button>}
      </div>
      <div className="m-content">
        <TaskList m onOpen={id => ctx.push("task", { id })} onNew={mgr ? () => ctx.push("task-new") : null}/>
      </div>
    </>
  );
}
function MTaskNew({ ctx }) {
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back} aria-label="กลับ"><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">มอบหมายงาน</div>
      </div>
      <div className="m-content">
        <TaskCreate m onDone={id => { ctx.back(); ctx.push("task", { id }); }} onCancel={ctx.back}/>
      </div>
    </>
  );
}
function MTaskDetail({ ctx }) {
  const id = ctx.route && (ctx.route.id || (ctx.route.params && ctx.route.params.id));
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back} aria-label="กลับ"><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">รายละเอียดงาน</div>
      </div>
      <div className="m-content">
        <TaskDetail m id={id} onBack={ctx.back}/>
      </div>
    </>
  );
}

Object.assign(window, {
  TASK_TYPES, TASK_STATUS, loadTasks, refreshTasks, startTaskSync, createTask, saveTask, deleteTask,
  canManageTasks, taskBadgeCount, useTasks, TeamTasks, MTasks, MTaskNew, MTaskDetail
});
