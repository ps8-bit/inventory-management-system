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

   Phase 2 (supabase/team-tasks-phase2.sql): photo — ถ่ายรูปสินค้า, closes itself
   once every line has a photo; weekly recurring general tasks (templates);
   targeted Web Push through order-push {mode:"task"}; in-app alerts; local
   drafts so a count survives a reload; the owner can edit a task before work
   starts and create a brand-new product while keying a delivery.

   Desktop page `TeamTasks` and mobile `MTasks` are thin shells around the same
   inner components (`m` prop picks the shell's classes) — the flows must not
   fork. */
const { useState: useStateTk, useEffect: useEffectTk, useRef: useRefTk, useMemo: useMemoTk } = React;

const TASK_TYPES = {
  receive: { label: "รับสินค้าเข้า", icon: "📦", approve: true },
  general: { label: "งานทั่วไป", icon: "📝", approve: true },
  photo:   { label: "ถ่ายรูปสินค้า", icon: "📷", approve: false }
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

const TK_SEEN = "ims_task_seen_v1:";          // + uid → { [taskId]: status }
const TK_OVERDUE_DAY = "ims_task_overdue_day:"; // + uid → "YYYY-MM-DD" of the last overdue toast
const TK_DRAFT = "ims_task_draft:";            // + taskId + ":" + slot
const EMPTY_CNT = { good: "", dmg: "", ev: [], pp: "" };
const TK_WEEKDAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const TK_CONFLICT = "งานนี้ถูกแก้จากอีกเครื่อง — โหลดข้อมูลล่าสุดแล้ว ลองอีกครั้ง";

/* ── data layer ── */
let _tasksCache = null;
let _tasksMissing = false;     // table not created yet (team-tasks.sql not run)
/* The cache is per signed-in user: a shared phone must never show the previous
   person's list, even offline. */
let _tkCacheUid = null;
const _tkLsKey = () => TASKS_LS + ":" + (_tkMe().id || "anon");
function loadTasks() {
  const uid = _tkMe().id;
  if (uid !== _tkCacheUid) {
    _tasksCache = null;
    _tkCacheUid = uid;
    if (uid) Promise.resolve().then(refreshTasks);
  }
  if (_tasksCache) return _tasksCache;
  try { const a = JSON.parse(localStorage.getItem(_tkLsKey()) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function _tkSetCache(list) {
  _tasksCache = list;
  _tkCacheUid = _tkMe().id;
  try { localStorage.setItem(_tkLsKey(), JSON.stringify(list.slice(0, 600))); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-tasks-change"));
}

/* ── local drafts: a count / checklist in progress survives reload, back, a
   discarded phone tab and the todo→doing remount. Cleared only after a
   successful submit. ── */
function _tkDraftKey(task, slot) { return TK_DRAFT + task.id + ":" + slot; }
function _tkDraftLoad(key) { try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
function _tkDraftSave(key, v) { try { localStorage.setItem(key, JSON.stringify({ ...v, at: Date.now() })); } catch (e) {} }
function _tkDraftClear(key) { try { localStorage.removeItem(key); } catch (e) {} }
function _tkDraftSweep() {
  try {
    const byId = {};
    loadTasks().forEach(t => { byId[t.id] = t.status; });
    const old = Date.now() - 14 * 86400000;
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(TK_DRAFT) !== 0) continue;
      const id = k.slice(TK_DRAFT.length).split(":")[0];
      const v = _tkDraftLoad(k);
      if (!v || !(v.at > old) || byId[id] === "done" || byId[id] === "cancel") drop.push(k);
    }
    drop.forEach(_tkDraftClear);
  } catch (e) {}
}

/* ── in-app alerts: diff the fetched list against what this device last saw ── */
function _tkSeenLoad() { const id = _tkMe().id; if (!id) return null; try { const v = JSON.parse(localStorage.getItem(TK_SEEN + id) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } }
function _tkSeenSave(map) { const id = _tkMe().id; if (!id) return; try { localStorage.setItem(TK_SEEN + id, JSON.stringify(map)); } catch (e) {} }
// Your own writes never toast back to you.
function _tkMarkSeen(t) { const m = _tkSeenLoad(); if (!m || !t) return; m[t.id] = t.status; _tkSeenSave(m); }
function _tkNotifyDiff(list) {
  const me = _tkMe();
  if (!me.id) return;
  const mgr = canManageTasks();
  const seen = _tkSeenLoad();
  const next = {};
  list.forEach(t => { next[t.id] = t.status; });
  if (seen) {
    const msgs = [];
    list.forEach(t => {
      const prev = seen[t.id];
      if (prev === t.status) return;
      const mine = t.assignee === me.id;
      const d = t.data || {};
      if (mine && t.status === "todo" && prev === undefined) msgs.push(`งานใหม่: ${t.title}`);
      else if (mine && t.status === "back") msgs.push(`งานถูกส่งกลับ: ${t.title}`);
      else if (mine && prev === "blocked" && t.status !== "blocked" && TASK_OPEN.includes(t.status)) msgs.push(`แก้ปัญหาแล้ว ทำต่อได้: ${t.title}`);
      else if (mgr && t.status === "review") msgs.push(`รออนุมัติ: ${t.title} · ${t.assigneeName}`);
      else if (mgr && t.status === "blocked") msgs.push(`ติดปัญหา: ${t.title} — ${d.reason || ""}`);
      else if (mgr && t.type === "photo" && t.status === "done" && prev !== undefined) msgs.push(`ถ่ายรูปเสร็จ: ${t.title}`);
    });
    if (msgs.length > 3) _tkToast(`มีงานอัปเดต ${msgs.length} รายการ`, "info");
    else msgs.forEach(msg => _tkToast(msg, "info"));
  }
  _tkSeenSave(next);
  // Overdue: once per day per device.
  try {
    const od = overdueTasks(mgr ? list : list.filter(t => t.assignee === me.id)).length;
    const k = TK_OVERDUE_DAY + me.id;
    if (od > 0 && localStorage.getItem(k) !== _tkToday()) {
      localStorage.setItem(k, _tkToday());
      _tkToast(`มีงานเลยกำหนด ${od} งาน`, "info");
    }
  } catch (e) {}
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

/* Every open task (an old one must never drop off) + the latest closed ones.
   A response older than one already applied is dropped. */
let _tkSeq = 0;
async function refreshTasks() {
  if (!_tkDb()) return;
  const seq = ++_tkSeq;
  const uid = _tkMe().id;
  const [a, b] = await Promise.all([
    sb.from("team_tasks").select("*").in("status", TASK_OPEN).order("created_at", { ascending: false }).limit(500),
    sb.from("team_tasks").select("*").in("status", ["done", "cancel"]).order("updated_at", { ascending: false }).limit(100)
  ]);
  if (seq !== _tkSeq) return;
  const error = a.error || b.error;
  if (error) {
    if (/team_tasks|does not exist|schema cache/i.test(error.message || "")) _tasksMissing = true;
    console.warn("[tasks] load:", error.message);
    return;
  }
  _tasksMissing = false;
  if (uid !== _tkMe().id) return;   // signed out / switched user mid-flight
  const ids = new Set();
  const list = [];
  [...(a.data || []), ...(b.data || [])].forEach(r => { if (!ids.has(r.id)) { ids.add(r.id); list.push(_tkRow(r)); } });
  _tkNotifyDiff(list);
  _tkSetCache(list);
}
/* Creates this week's instance of every recurring template whose day has come.
   Errors (function missing = phase-2 SQL not run) are ignored. */
async function spawnRecurringTasks() {
  if (!_tkDb()) return 0;
  try { const { data, error } = await sb.rpc("spawn_recurring_tasks"); return error ? 0 : (Number(data) || 0); } catch (e) { return 0; }
}
/* Opening a task from a push / a ?tk= link: whichever shell is mounted takes it. */
function openTaskFromAnywhere(id) {
  if (!id) return;
  window.__pendingTaskOpen = id;
  window.dispatchEvent(new CustomEvent("ims-open-task", { detail: { id } }));
}
function takePendingTaskOpen() { const id = window.__pendingTaskOpen; window.__pendingTaskOpen = null; return id || null; }
let _tkSyncStarted = false;
function startTaskSync() {
  if (_tkSyncStarted) return;
  _tkSyncStarted = true;
  try { localStorage.removeItem(TASKS_LS); } catch (e) {}   // legacy shared (not per-user) cache
  _tkDraftSweep();
  spawnRecurringTasks().then(refreshTasks, refreshTasks);
  setInterval(() => { if (document.visibilityState === "visible") refreshTasks(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshTasks(); });
  // Opened by tapping a task notification while the app was closed (sw.js → /?tk=<id>).
  try {
    const init = (window.__IMS_INIT && window.__IMS_INIT.search) || window.location.search || "";
    const id = new URLSearchParams(init).get("tk");
    if (id) {
      if (window.history && window.history.replaceState) {
        const u = new URL(window.location.href); u.searchParams.delete("tk");
        window.history.replaceState(null, "", u.pathname + u.search + u.hash);
      }
      openTaskFromAnywhere(id);
    }
  } catch (e) {}
  if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
    navigator.serviceWorker.addEventListener("message", e => {
      if (e.data && e.data.type === "ims-push-open" && e.data.taskId) openTaskFromAnywhere(e.data.taskId);
    });
  }
}
/* Targeted Web Push (order-push {mode:"task"}); fire-and-forget, never blocks. */
function notifyTask(task, kind) {
  if (!task || typeof sendOrderPush !== "function") return;
  try { sendOrderPush({ mode: "task", taskId: task.id, kind }); } catch (e) {}
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
  if (error) {
    if (/team_tasks_type_check/i.test(error.message || "")) return { error: "ต้องรัน supabase/team-tasks-phase2.sql ก่อน" };
    return { error: /row-level security/i.test(error.message) ? "ไม่มีสิทธิ์มอบหมายงาน" : error.message };
  }
  if (!data || !data.length) return { error: "ไม่มีสิทธิ์มอบหมายงาน" };
  const saved = _tkRow(data[0]);
  _tkMarkSeen(saved);
  _tkSetCache([saved, ...loadTasks().filter(x => x.id !== row.id)]);
  if (saved.assignee !== me.id) notifyTask(saved, "assigned");
  return { ok: true, task: saved };
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
  _tkMarkSeen(saved);
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
/* ── weekly recurring templates (manager only; phase-2 SQL) ── */
let _tplMissing = false;
async function loadTaskTemplates() {
  if (!_tkDb() || !canManageTasks()) return [];
  const { data, error } = await sb.from("team_task_templates").select("*").order("created_at", { ascending: false });
  if (error) {
    if (/team_task_templates|does not exist|schema cache/i.test(error.message || "")) _tplMissing = true;
    console.warn("[tasks] templates:", error.message);
    return [];
  }
  _tplMissing = false;
  return data || [];
}
async function createTaskTemplate({ title, items, assignee, assigneeName, weekday }) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const row = {
    id: "P" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title, items, assignee, assignee_name: assigneeName, weekday, active: true, created_by_name: _tkMe().name
  };
  const { data, error } = await sb.from("team_task_templates").insert(row).select();
  if (error) {
    if (/team_task_templates|does not exist|schema cache/i.test(error.message || "")) { _tplMissing = true; return { error: "ต้องรัน supabase/team-tasks-phase2.sql ก่อน" }; }
    return { error: /row-level security/i.test(error.message) ? "ไม่มีสิทธิ์ตั้งงานประจำ" : error.message };
  }
  if (!data || !data.length) return { error: "ไม่มีสิทธิ์ตั้งงานประจำ" };
  await spawnRecurringTasks();
  await refreshTasks();
  return { ok: true, template: data[0] };
}
async function setTaskTemplateActive(id, active) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const { data, error } = await sb.from("team_task_templates").update({ active: !!active, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "ไม่มีสิทธิ์แก้งานประจำ" };
  return { ok: true };
}
async function deleteTaskTemplate(id) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const { data, error } = await sb.from("team_task_templates").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data || !data.length) return { error: "ไม่มีสิทธิ์ลบงานประจำ" };
  return { ok: true };
}

/* Products this task created that never received anything: delete them again. Only when
   stock is 0, the task never received the sku, and the DB has no movement row for it. */
async function _tkCleanupNewProducts(lines) {
  const res = { removed: [], kept: [], noPerm: false };
  const cand = (lines || []).filter(l => l && l.isNew && _tkProduct(l.sku));
  if (!cand.length) return res;
  if (!(typeof canDo === "function" && canDo("deleteData"))) { res.kept = cand.map(l => l.sku); res.noPerm = true; return res; }
  const otherOpen = new Set();
  loadTasks().forEach(t => { if (TASK_OPEN.includes(t.status)) ((t.data && t.data.lines) || []).forEach(l => otherOpen.add(l.sku)); });
  const del = [];
  for (const l of cand) {
    const p = _tkProduct(l.sku);
    let ok = Number(p.qty) === 0 && !(l.recv || 0) && !otherOpen.has(l.sku);
    if (ok) {
      const rows = typeof dbLoadStockAdjustments === "function" ? await dbLoadStockAdjustments(l.sku, 1) : null;
      ok = Array.isArray(rows) && rows.length === 0;     // null = unknown → keep
    }
    (ok ? del : res.kept).push(l.sku);
  }
  if (del.length && typeof removeProductsFromStore === "function") {
    const r = await removeProductsFromStore(del);
    if (r && r.ok === false) { res.kept = [...res.kept, ...del]; res.error = r.error; return res; }
    del.forEach(sku => { if (typeof setProductImage === "function") { try { setProductImage(sku, null); } catch (e) {} } });
    if (typeof recordChange === "function") recordChange({ entity: "product", action: "bulk-delete",
      summary: "ลบสินค้าที่สร้างจากงานรับสินค้าที่ยกเลิก: " + del.join(", ") });
    res.removed = del;
  } else if (del.length) res.kept = [...res.kept, ...del];
  return res;
}
function _tkCleanupToast(res) {
  if (!res) return;
  if (res.removed.length) _tkToast(`ลบสินค้าใหม่ที่ยังไม่เคยรับเข้า ${res.removed.length} รายการ`);
  if (res.kept.length) _tkToast((res.noPerm ? "ไม่มีสิทธิ์ลบ — เก็บสินค้าใหม่ไว้: " : "เก็บไว้ (มีประวัติ/สต็อก): ") + res.kept.join(", "), "warn");
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
  if (canManageTasks()) return list.filter(t => t.status === "review" || t.status === "blocked" || taskOverdue(t)).length;
  return list.filter(t => t.assignee === me.id && ["todo", "doing", "back", "partial"].includes(t.status)).length;
}
const _tkToday = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const taskOverdue = t => TASK_OPEN.includes(t.status) && t.status !== "review" && t.due && t.due < _tkToday();
function overdueTasks(list) { return (list || []).filter(taskOverdue); }
/* Overdue tasks the signed-in person should care about (manager: all; else own). */
function taskOverdueCount() {
  const me = _tkMe();
  const list = loadTasks();
  return overdueTasks(canManageTasks() ? list : list.filter(t => t.assignee === me.id)).length;
}
function _tkDaysLate(due) {
  if (!due) return 0;
  const a = Date.parse(due + "T00:00:00Z"), b = Date.parse(_tkToday() + "T00:00:00Z");
  return isNaN(a) || isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86400000));
}
/* SKUs already on an open task (optionally of one type) — so "assign" buttons don't double up. */
function skusInOpenTasks(type) {
  const set = new Set();
  loadTasks().forEach(t => {
    if (!TASK_OPEN.includes(t.status) || (type && t.type !== type)) return;
    ((t.data && t.data.lines) || []).forEach(l => { if (l && l.sku) set.add(l.sku); });
  });
  return set;
}
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
        {taskOverdue(t) && <span className="badge" style={{ marginLeft: 6, background: "var(--danger-soft)", color: "var(--danger)" }}>เลยกำหนด · เลย {_tkDaysLate(t.due)} วัน</span>}
      </span>
      <TkPill status={t.status}/>
    </button>
  );
}

/* ── task list (both roles) ── */
const _tkSortGroup = arr => [...arr].sort((a, b) => {
  const da = a.due || "9999-99-99", db = b.due || "9999-99-99";
  if (da !== db) return da < db ? -1 : 1;
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
});
function TaskList({ m, onOpen, onNew }) {
  const list = useTasks();
  const me = _tkMe();
  const mgr = canManageTasks();
  const [filter, setFilter] = useStateTk("open");
  const mine = mgr ? list : list.filter(t => t.assignee === me.id);
  const shown = mine.filter(t => filter === "open" ? TASK_OPEN.includes(t.status) : !TASK_OPEN.includes(t.status));
  let groups = [[null, shown]];
  if (filter === "open") {
    const od = shown.filter(taskOverdue);
    const rest = shown.filter(t => !taskOverdue(t));
    groups = mgr
      ? [["เลยกำหนด", od],
         ["รอคุณ (อนุมัติ / ติดปัญหา)", rest.filter(t => t.status === "review" || t.status === "blocked")],
         ["กำลังดำเนินการ", rest.filter(t => t.status !== "review" && t.status !== "blocked")]]
      : [["เลยกำหนด", od], [od.length ? "งานอื่น" : null, rest]];
    groups = groups.map(([lab, arr]) => [lab, _tkSortGroup(arr)]);
  }
  const count = s => mine.filter(t => s.includes(t.status)).length;
  const kpis = [["รอทำ", count(["todo", "doing", "back", "partial"]), "var(--fg)"], ["รออนุมัติ", count(["review"]), "var(--accent)"],
    ["ติดปัญหา", count(["blocked"]), "var(--danger)"], ["เลยกำหนด", overdueTasks(mine).length, "var(--danger)"], ["เสร็จแล้ว", count(["done"]), "var(--success)"]];
  const filters = [["open", "งานที่ยังไม่ปิด"], ["closed", "ปิดแล้ว"]].concat(mgr ? [["tpl", "งานประจำ"]] : []);
  return (
    <div>
      {_tasksMissing && (
        <div style={{ ...tkCard, background: "var(--warning-soft)", borderColor: "var(--warning)", marginBottom: 12, fontSize: 13 }}>
          ยังไม่ได้สร้างตาราง team_tasks ในฐานข้อมูล — ให้ผู้ดูแลรัน supabase/team-tasks.sql ก่อน
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(" + (m ? 96 : 120) + "px, 1fr))", gap: 10, marginBottom: 12 }}>
        {kpis.map(([lab, n, c]) => (
          <div key={lab} className={m ? "m-kpi" : "kpi"} style={m ? {} : { padding: 14 }}>
            <div style={tkMuted}>{lab}</div>
            <div className="tnum" style={{ fontSize: 24, fontWeight: 700, color: c }}>{n}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        {filters.map(([id, lab]) => (
          <button key={id} type="button" className={"m-chip" + (filter === id ? " on" : "")} onClick={() => setFilter(id)}>{lab}</button>
        ))}
      </div>
      {filter === "tpl" ? <TemplateList m={m}/> : (
        <div style={tkCard}>
          {!shown.length && <div style={{ ...tkMuted, padding: "8px 0" }}>{filter === "open" ? (mgr ? "ยังไม่มีงานค้าง — กด “มอบหมายงาน” เพื่อเริ่ม" : "ไม่มีงานค้าง") : "ยังไม่มีงานที่ปิดแล้ว"}</div>}
          {groups.map(([lab, arr], gi) => arr.length ? (
            <div key={gi}>
              {lab && <div style={{ ...tkMuted, fontWeight: 600, marginTop: gi ? 12 : 0, marginBottom: 2, color: lab === "เลยกำหนด" ? "var(--danger)" : undefined }}>{lab} ({arr.length})</div>}
              {arr.map(t => <TaskRow key={t.id} t={t} onOpen={onOpen}/>)}
            </div>
          ) : null)}
        </div>
      )}
      {mgr && onNew && m && <div style={{ marginTop: 12 }}><TkBtn m primary onClick={onNew}>+ มอบหมายงาน</TkBtn></div>}
    </div>
  );
}

/* ── weekly recurring templates (manager) ── */
function TemplateList({ m }) {
  const [rows, setRows] = useStateTk(null);
  const [busy, setBusy] = useStateTk("");
  const reload = () => loadTaskTemplates().then(setRows);
  useEffectTk(() => { reload(); }, []);
  const toggle = async (t) => {
    setBusy(t.id);
    const r = await setTaskTemplateActive(t.id, !t.active);
    setBusy("");
    if (r.error) _tkToast(r.error, "error"); else reload();
  };
  const del = async (t) => {
    if (!confirm(`ลบงานประจำ "${t.title}"? (งานที่สร้างไปแล้วไม่ถูกลบ)`)) return;
    setBusy(t.id);
    const r = await deleteTaskTemplate(t.id);
    setBusy("");
    if (r.error) _tkToast(r.error, "error"); else { _tkToast("ลบงานประจำแล้ว"); reload(); }
  };
  return (
    <div style={tkCard}>
      {_tplMissing && (
        <div style={{ ...tkCard, background: "var(--warning-soft)", borderColor: "var(--warning)", marginBottom: 10, fontSize: 13 }}>
          ยังไม่ได้สร้างตารางงานประจำ — ให้ผู้ดูแลรัน supabase/team-tasks-phase2.sql ก่อน
        </div>
      )}
      {rows === null && <div style={tkMuted}>กำลังโหลด…</div>}
      {rows && !rows.length && !_tplMissing && <div style={{ ...tkMuted, padding: "8px 0" }}>ยังไม่มีงานประจำ — ตั้งได้ตอนมอบหมายงานทั่วไป (ติ๊ก “ทำซ้ำทุกสัปดาห์”)</div>}
      {(rows || []).map(t => (
        <div key={t.id} style={tkRow}>
          <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--accent-soft)", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }} aria-hidden="true">🔁</span>
          <span style={{ flex: 1, minWidth: 140 }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 14, opacity: t.active ? 1 : 0.55 }}>{t.title}</span>
            <span style={tkMuted}>ทุกวัน{TK_WEEKDAYS[t.weekday] || "?"} · {t.assignee_name || ""} · เช็กลิสต์ {(t.items || []).length} ข้อ</span>
          </span>
          <button type="button" className={m ? "m-chip" + (t.active ? " on" : "") : "btn btn-sm"} disabled={busy === t.id} onClick={() => toggle(t)}>{t.active ? "เปิด" : "ปิด"}</button>
          <button type="button" className={m ? "m-chip" : "btn btn-sm"} disabled={busy === t.id} style={{ color: "var(--danger)" }} onClick={() => del(t)}>ลบ</button>
        </div>
      ))}
    </div>
  );
}

/* ── create / edit form (manager) ──
   `edit` = an existing task to change before work starts (type + assignee are
   fixed then; reassign lives in TaskDetail). `preset` = { type, skus } from an
   "assign from" button. */
function _tkEditSummary(edit, next) {
  const out = [];
  const od = edit.data || {};
  if (next.title !== edit.title) out.push(`ชื่อ “${next.title}”`);
  if ((next.due || "") !== (edit.due || "")) out.push(`กำหนด ${next.due || "-"}`);
  const nd = next.data || {};
  if (edit.type === "receive" || edit.type === "photo") {
    const was = {}; (od.lines || []).forEach(l => { was[l.sku] = l; });
    const now = {}; (nd.lines || []).forEach(l => { now[l.sku] = l; });
    (nd.lines || []).forEach(l => {
      if (!was[l.sku]) out.push(`เพิ่ม ${l.sku}${edit.type === "receive" ? " ×" + l.exp : ""}`);
      else if (edit.type === "receive" && was[l.sku].exp !== l.exp) out.push(`แก้ ${l.sku} ${was[l.sku].exp}→${l.exp}`);
    });
    (od.lines || []).forEach(l => { if (!now[l.sku]) out.push(`ลบ ${l.sku}`); });
  }
  if (edit.type === "receive") {
    if ((nd.trk || "") !== (od.trk || "")) out.push(`เลขพัสดุ ${nd.trk || "-"}`);
    if ((nd.supplier || "") !== (od.supplier || "")) out.push(`ผู้ขาย ${nd.supplier || "-"}`);
  }
  if (edit.type === "general" && (nd.items || []).join("\n") !== (od.items || []).join("\n")) out.push(`เช็กลิสต์ ${(nd.items || []).length} ข้อ`);
  return out.join(", ") || "ไม่มีการเปลี่ยนแปลง";
}
function TkRoleWarn({ person }) {
  if (!person || typeof canOpenPage !== "function" || canOpenPage("tasks", person.role)) return null;
  return <div style={{ color: "var(--warning)", fontSize: 12.5, marginTop: 4 }}>บทบาท “{person.role}” ยังไม่เห็นหน้า งานของทีม — เปิดสิทธิ์ที่ ผู้ใช้งานและสิทธิ์ ก่อน ไม่งั้นเขาจะไม่เห็นงานนี้</div>;
}
function TaskCreate({ m, onDone, onCancel, edit: editLive, preset }) {
  // Snapshot at mount: the save is guarded on THIS updated_at, so a change made
  // meanwhile (staff submitted a round) comes back as a conflict, not an overwrite.
  const [edit] = useStateTk(() => editLive);
  const ed = edit ? (edit.data || {}) : null;
  const [type, setType] = useStateTk(() => edit ? edit.type : ((preset && preset.type) || "receive"));
  const [title, setTitle] = useStateTk(edit ? edit.title : "");
  const [trk, setTrk] = useStateTk(ed ? (ed.trk || "") : "");
  const [supplier, setSupplier] = useStateTk(ed ? (ed.supplier || "") : "");
  const [due, setDue] = useStateTk(edit ? (edit.due || "") : _tkToday());
  const [who, setWho] = useStateTk("");
  const [people, setPeople] = useStateTk([]);
  const [lines, setLines] = useStateTk(() => {
    if (ed) return (ed.lines || []).map(l => ({ ...l }));
    if (preset && preset.type === "photo" && Array.isArray(preset.skus)) return preset.skus.slice(0, 60).map(sku => ({ sku }));
    return [];
  });
  const [skuQ, setSkuQ] = useStateTk("");
  const [qty, setQty] = useStateTk("");
  const [items, setItems] = useStateTk(ed ? (ed.items || []).join("\n") : "");
  const [repeat, setRepeat] = useStateTk(false);
  const [weekday, setWeekday] = useStateTk(() => new Date().getDay());
  const [newOpen, setNewOpen] = useStateTk(false);
  const [err, setErr] = useStateTk("");
  const [busy, setBusy] = useStateTk(false);
  useEffectTk(() => { if (!edit) loadTaskAssignees().then(setPeople); }, []);
  const inp = m ? "m-input" : "input";
  const isPhoto = type === "photo";
  const matches = useMemoTk(() => {
    const q = skuQ.trim().toLowerCase();
    if (!q) return [];
    return PRODUCTS.filter(p => p.sku.toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q)).slice(0, 6);
  }, [skuQ]);
  const canAddProduct = type === "receive" && typeof canDo === "function" && canDo("addProduct") && typeof QuickAddInboundModal === "function";
  const pickType = (id) => { if (id === type) return; setType(id); setLines([]); setErr(""); };
  const addLine = (sku) => {
    if (lines.some(l => l.sku === sku)) { setErr(sku + " อยู่ในรายการแล้ว"); return; }
    if (isPhoto) {
      if (lines.length >= 60) { setErr("งานถ่ายรูปได้สูงสุด 60 รายการต่อครั้ง"); return; }
      setLines([...lines, { sku }]); setSkuQ(""); setErr(""); return;
    }
    const n = _tkN(qty);
    if (!n) { setErr("ใส่จำนวนที่จะเข้าก่อน แล้วเลือกสินค้า"); return; }
    setLines([...lines, { sku, exp: n, recv: 0, dmg: 0 }]); setSkuQ(""); setQty(""); setErr("");
  };
  const onNewProduct = (product, n) => {
    setNewOpen(false);
    if (lines.some(l => l.sku === product.sku)) { setErr(product.sku + " อยู่ในรายการแล้ว"); return; }
    const ok = typeof addProductToStore === "function" && addProductToStore({ ...product, loc: "—", qty: 0 });   // not here yet → not stored, stock 0
    if (!ok) return;
    if (typeof recordChange === "function") recordChange({ entity: "product", entityId: product.sku, action: "add",
      summary: `เพิ่มสินค้าใหม่ ${product.sku} — ${product.name} (สร้างจากงานรับสินค้า)` });
    setLines(ls => [...ls, { sku: product.sku, exp: _tkN(n) || 1, recv: 0, dmg: 0, isNew: true }]);
    setSkuQ(""); setErr("");
  };
  const setExp = (i, v) => setLines(lines.map((l, j) => j === i ? { ...l, exp: _tkN(v) } : l));
  const submit = async () => {
    const list = items.split("\n").map(s => s.trim()).filter(Boolean);
    if ((type === "receive" || isPhoto) && !lines.length) return setErr(isPhoto ? "เพิ่มสินค้าที่จะถ่ายรูปอย่างน้อย 1 รายการ" : "เพิ่มสินค้าที่จะเข้าอย่างน้อย 1 รายการ");
    if (isPhoto && lines.length > 60) return setErr("งานถ่ายรูปได้สูงสุด 60 รายการต่อครั้ง");
    if (type === "receive" && lines.some(l => !_tkN(l.exp))) return setErr("จำนวนที่จะเข้าต้องมากกว่า 0");
    if (type === "general" && !title.trim()) return setErr("ใส่ชื่องาน");
    if (type === "general" && !list.length) return setErr("ใส่เช็กลิสต์อย่างน้อย 1 ข้อ");
    const autoTitle = type === "receive" ? `รับเข้า ${trk.trim() || lines.length + " รายการ"}` : isPhoto ? `ถ่ายรูปสินค้า ${lines.length} รายการ` : "";
    const finalTitle = title.trim() || (edit ? edit.title : autoTitle);
    const data = type === "receive" ? { trk: trk.trim(), supplier: supplier.trim(), lines }
      : isPhoto ? { lines: lines.map(l => ({ sku: l.sku })) }
      : { items: list, checked: edit ? list.map(() => false) : [] };

    if (edit) {
      const cur = loadTasks().find(t => t.id === edit.id) || edit;
      const cd = cur.data || {};
      if (cur.updatedAt !== edit.updatedAt || (cur.type === "receive" && !(["todo", "doing"].includes(cur.status) && !(cd.rounds || []).length && !cd.round)))
        return setErr("งานนี้เปลี่ยนไปแล้ว (พนักงานส่งรายงาน/แก้จากอีกเครื่อง) — ปิดแล้วเปิดแก้ใหม่");
      const patch = { title: finalTitle, due, data };
      setBusy(true);
      const r = await saveTask(edit, patch, "แก้ไขรายละเอียดงาน: " + _tkEditSummary(edit, patch));
      setBusy(false);
      if (r.conflict) { _tkToast(TK_CONFLICT, "warn"); return; }
      if (r.error) return setErr(r.error);
      _tkToast("บันทึกการแก้ไขแล้ว");
      if (edit.type === "receive") {
        const keep = new Set(lines.map(l => l.sku));
        const gone = (ed.lines || []).filter(l => l.isNew && !keep.has(l.sku));
        if (gone.length) _tkCleanupToast(await _tkCleanupNewProducts(gone));
      }
      onDone && onDone(edit.id);
      return;
    }

    const person = people.find(p => p.id === who);
    if (!person) return setErr("เลือกผู้รับผิดชอบ");
    if (type === "general" && repeat) {
      setBusy(true);
      const r = await createTaskTemplate({ title: finalTitle, items: list, assignee: person.id, assigneeName: person.name, weekday: Number(weekday) });
      setBusy(false);
      if (r.error) return setErr(r.error);
      _tkToast(`ตั้งงานประจำทุกวัน${TK_WEEKDAYS[Number(weekday)]}ให้ ${person.name} แล้ว`);
      onCancel && onCancel();
      return;
    }
    setBusy(true);
    const r = await createTask({ type, title: finalTitle, data, assignee: person.id, assigneeName: person.name, due });
    setBusy(false);
    if (r.error) return setErr(r.error);
    _tkToast(`มอบหมาย "${finalTitle}" ให้ ${person.name} แล้ว`);
    onDone && onDone(r.task.id);
  };
  const person = people.find(p => p.id === who);
  return (
    <div style={tkCard}>
      <div style={{ display: "grid", gap: 10 }}>
        {edit && <div style={{ fontWeight: 600 }}>แก้ไขงาน · {(TASK_TYPES[type] || TASK_TYPES.general).label}</div>}
        {!edit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(TASK_TYPES).map(([id, ty]) => (
              <button key={id} type="button" className={"m-chip" + (type === id ? " on" : "")} onClick={() => pickType(id)}>{ty.icon} {ty.label}</button>
            ))}
          </div>
        )}
        {!edit && (
          <label style={tkMuted}>ผู้รับผิดชอบ
            <select className={inp} value={who} onChange={e => setWho(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
              <option value="">เลือกพนักงาน…</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <TkRoleWarn person={person}/>
          </label>
        )}
        {type === "general" && !edit && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)}/> ทำซ้ำทุกสัปดาห์
            </label>
            {repeat && (
              <select className={inp} value={weekday} onChange={e => setWeekday(Number(e.target.value))} style={{ minWidth: 140 }}>
                {TK_WEEKDAYS.map((w, i) => <option key={i} value={i}>ทุกวัน{w}</option>)}
              </select>
            )}
          </div>
        )}
        {!(type === "general" && repeat && !edit) && (
          <label style={tkMuted}>กำหนดเสร็จ
            <input className={inp} type="date" value={due} onChange={e => setDue(e.target.value)} style={{ width: "100%", marginTop: 4 }}/>
          </label>
        )}
        <input className={inp} placeholder={type === "receive" ? "ชื่องาน (ไม่ใส่ = ตั้งจากเลขพัสดุ)" : isPhoto ? "ชื่องาน (ไม่ใส่ = ถ่ายรูปสินค้า N รายการ)" : "ชื่องาน เช่น ทำความสะอาดโซนแพ็ค"} value={title} onChange={e => setTitle(e.target.value)}/>
        {type === "receive" && (
          <>
            <input className={inp + " mono"} placeholder="เลขพัสดุ เช่น TH1234567890" value={trk} onChange={e => setTrk(e.target.value)}/>
            <input className={inp} placeholder="ผู้ขาย / ร้านที่สั่ง (ถ้ามี)" value={supplier} onChange={e => setSupplier(e.target.value)}/>
          </>
        )}
        {(type === "receive" || isPhoto) && (
          <>
            <div style={{ ...tkMuted, fontWeight: 600 }}>{isPhoto ? `สินค้าที่จะถ่ายรูป (${lines.length}/60)` : "สินค้าที่จะเข้า"}</div>
            {lines.map((l, i) => {
              const p = _tkProduct(l.sku);
              const shelf = p ? ((typeof productHomeLoc === "function" && productHomeLoc(p)) || "ยังไม่จัดเก็บ") : "";
              return (
                <div key={l.sku} style={tkRow}>
                  <TkProductPic sku={l.sku} size={40}/>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: 13 }}>{l.sku}</span>{l.isNew && <span className="badge" style={{ marginLeft: 6, background: "var(--accent-soft)", color: "var(--accent)" }}>ใหม่</span>}<br/>
                    <span style={tkMuted}>{p ? p.name : "ไม่พบสินค้า"}{isPhoto && p ? " · " + shelf : ""}</span>
                  </span>
                  {type === "receive" && (edit
                    ? <input className={inp + " tnum"} type="number" inputMode="numeric" min="1" value={l.exp} onChange={e => setExp(i, e.target.value)} style={{ width: 76 }} aria-label={"จำนวน " + l.sku}/>
                    : <span className="tnum" style={{ fontWeight: 600 }}>× {l.exp}</span>)}
                  <button type="button" className={m ? "m-chip" : "btn btn-sm"} aria-label="ลบ" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {type === "receive" && <input className={inp} type="number" inputMode="numeric" min="1" placeholder="จำนวน" value={qty} onChange={e => setQty(e.target.value)} style={{ width: 96 }}/>}
              <input className={inp} placeholder="พิมพ์ SKU หรือชื่อสินค้า แล้วเลือก" value={skuQ} onChange={e => setSkuQ(e.target.value)} style={{ flex: 1, minWidth: 0 }}/>
              {canAddProduct && <button type="button" className={m ? "m-chip" : "btn"} onClick={() => setNewOpen(true)}>+ สินค้าใหม่</button>}
            </div>
            {matches.map(p => (
              <button key={p.sku} type="button" onClick={() => addLine(p.sku)}
                style={{ ...tkRow, width: "100%", background: "none", border: "none", borderTop: "1px solid var(--border)", textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--fg)" }}>
                <TkProductPic sku={p.sku} size={36}/>
                <span style={{ flex: 1, minWidth: 0 }}><span className="mono" style={{ fontSize: 13 }}>{p.sku}</span><br/><span style={tkMuted}>{p.name}{isPhoto ? " · " + ((typeof productHomeLoc === "function" && productHomeLoc(p)) || "ยังไม่จัดเก็บ") : ""}</span></span>
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>+ เพิ่ม</span>
              </button>
            ))}
            {skuQ.trim() && !matches.length && (canAddProduct
              ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={tkMuted}>ไม่พบสินค้า</span><button type="button" className={m ? "m-chip" : "btn btn-sm"} onClick={() => setNewOpen(true)}>+ สินค้าใหม่ “{skuQ.trim()}”</button></div>
              : <div style={tkMuted}>ไม่พบสินค้า{type === "receive" ? " — สินค้าใหม่ให้เพิ่มที่หน้า สินค้าคงคลัง ก่อน แล้วค่อยใส่ในรายการนี้" : ""}</div>)}
          </>
        )}
        {type === "general" && (
          <textarea className={inp} rows={4} placeholder={"เช็กลิสต์ บรรทัดละ 1 ข้อ\nเช่น เช็ดโต๊ะแพ็ค\nเก็บกล่องเปล่า"} value={items} onChange={e => setItems(e.target.value)} style={{ width: "100%", resize: "vertical" }}/>
        )}
        {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <TkBtn m={m} primary disabled={busy} onClick={submit} style={m ? { flex: 1 } : {}}>{busy ? "กำลังบันทึก…" : edit ? "บันทึกการแก้ไข" : (type === "general" && repeat ? "ตั้งงานประจำ" : "มอบหมาย")}</TkBtn>
          {onCancel && <TkBtn m={m} onClick={onCancel} style={m ? { flex: 1 } : {}}>ยกเลิก</TkBtn>}
        </div>
      </div>
      {newOpen && typeof QuickAddInboundModal === "function" && (
        <QuickAddInboundModal sku={skuQ.trim()} mobile={!!m} qtyLabel="จำนวนที่จะเข้า (ตามที่สั่ง)" hideLoc
          onClose={() => setNewOpen(false)} onConfirm={onNewProduct}/>
      )}
    </div>
  );
}

/* ── receive: counting screen (assignee, or a manager counting it themself) ── */
function ReceiveCount({ m, task, onSubmit, selfApprove }) {
  const d = task.data || {};
  const lines = d.lines || [];
  const draftKey = _tkDraftKey(task, "r" + ((d.rounds || []).length + 1));
  const [draft0] = useStateTk(() => _tkDraftLoad(draftKey));
  const [cnt, setCnt] = useStateTk(() => Object.fromEntries(lines.map(l => [l.sku, (draft0 && draft0.cnt && draft0.cnt[l.sku]) || EMPTY_CNT])));
  const cntRef = useRefTk(cnt);
  const updateCnt = fn => { cntRef.current = fn(cntRef.current); setCnt(cntRef.current); };
  const [pkg, setPkg] = useStateTk(() => (draft0 && Array.isArray(draft0.pkg)) ? draft0.pkg : []);
  const [extras, setExtras] = useStateTk(() => (draft0 && Array.isArray(draft0.extras)) ? draft0.extras : []);
  const [extraDraft, setExtraDraft] = useStateTk(null);
  const [shelf, setShelf] = useStateTk(() => (draft0 && draft0.shelf) || (typeof lastReceiveLoc === "function" && lastReceiveLoc()) || "");
  const [note, setNote] = useStateTk(() => (draft0 && draft0.note) || "");
  useEffectTk(() => {
    const any = Object.values(cnt).some(c => c && (c.good !== "" || c.dmg !== "" || (c.ev || []).length || c.pp)) || pkg.length || extras.length || note.trim();
    if (!any) { _tkDraftClear(draftKey); return; }
    _tkDraftSave(draftKey, { cnt, pkg, extras, shelf, note });
  }, [cnt, pkg, extras, shelf, note]);
  const cOf = sku => cnt[sku] || EMPTY_CNT;
  const [scan, setScan] = useStateTk("");
  const [camOpen, setCamOpen] = useStateTk(false);
  const [busyKey, setBusyKey] = useStateTk("");
  const [err, setErr] = useStateTk("");
  const [ok, setOk] = useStateTk("");
  const scanRef = useRefTk(null);
  const sending = useRefTk(false);
  const inp = m ? "m-input" : "input";
  const positions = useMemoTk(() => (typeof allPositions === "function" ? allPositions().map(p => p.code) : []), []);
  const setLine = (sku, k, v) => updateCnt(c => ({ ...c, [sku]: { ...(c[sku] || EMPTY_CNT), [k]: v } }));
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
    const n = _tkN((cntRef.current[sku] || EMPTY_CNT).good) + 1;
    updateCnt(c => ({ ...c, [sku]: { ...(c[sku] || EMPTY_CNT), good: String(n) } }));
    setOk(`✓ ${sku} = ${n}`); setErr("");
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
    const cnt = cntRef.current;
    const cOf = sku => cnt[sku] || EMPTY_CNT;
    const anyCount = lines.some(l => _tkN(cOf(l.sku).good) + _tkN(cOf(l.sku).dmg) > 0) || extras.length;
    if (!anyCount) return setErr("ยังไม่ได้นับอะไรเลยในรอบนี้");
    if (!pkg.length) return setErr("ถ่ายรูปพัสดุอย่างน้อย 1 รูป");
    const noPic = lines.find(l => _tkN(cOf(l.sku).good) > 0 && !(typeof resolveProductImage === "function" && resolveProductImage(l.sku)) && !cOf(l.sku).pp);
    if (noPic) return setErr(`${noPic.sku} ยังไม่มีรูปสินค้า — ถ่ายรูปสินค้าก่อนส่ง`);
    const dmgNoPic = lines.find(l => _tkN(cOf(l.sku).dmg) > 0 && !(cOf(l.sku).ev || []).length);
    if (dmgNoPic) return setErr(`${dmgNoPic.sku} มีของเสีย — ถ่ายรูปหลักฐานก่อน`);
    if (lines.some(l => _tkN(cOf(l.sku).dmg) > 0) && !note.trim()) return setErr("มีของเสีย — ใส่หมายเหตุว่าเสียอย่างไร");
    if (lines.some(l => _tkN(cOf(l.sku).good) > 0) && !shelf) return setErr("เลือกชั้นที่วางสินค้า");
    sending.current = true;
    const me = _tkMe();
    const round = {
      by: me.id, byName: me.name, at: new Date().toISOString(), shelf, note: note.trim(), pkg, extras,
      lines: Object.fromEntries(lines.map(l => [l.sku, { good: _tkN(cOf(l.sku).good), dmg: _tkN(cOf(l.sku).dmg), ev: cOf(l.sku).ev || [], pp: cOf(l.sku).pp || "" }]))
    };
    try { const ok = await onSubmit(round, approveNow); if (ok) _tkDraftClear(draftKey); } finally { sending.current = false; }
  };
  return (
    <div>
      {draft0 && <div style={{ ...tkMuted, marginBottom: 8 }}>กู้คืนการนับที่ค้างไว้บนเครื่องนี้แล้ว</div>}
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
          const c = cOf(l.sku);
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
                <TkPhotoBtn m={m} label="หลักฐาน" done={(c.ev || []).length > 0} busy={busyKey === "ev" + l.sku} onPick={f => upload("ev" + l.sku, f, u => setLine(l.sku, "ev", [...((cntRef.current[l.sku] || EMPTY_CNT).ev || []), u]))}/>
                {!hasPic && <TkPhotoBtn m={m} label="ถ่ายรูปสินค้า" done={!!c.pp} busy={busyKey === "pp" + l.sku} onPick={f => upload("pp" + l.sku, f, u => setLine(l.sku, "pp", u))}/>}
              </div>
              <TkThumbs urls={[c.pp, ...(c.ev || [])]} size={48}/>
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
  const anyLeft = lines.some(l => _tkLeft({ ...l, recv: (l.recv || 0) + _tkN(((r.lines || {})[l.sku] || {}).good), dmg: (l.dmg || 0) + _tkN(((r.lines || {})[l.sku] || {}).dmg) }) > 0);
  return (
    <div>
      <div style={{ ...tkMuted, marginBottom: 6 }}>รอบที่ {(d.rounds || []).length + 1} · นับโดย {r.byName} · ชั้น {r.shelf || "-"}</div>
      {lines.map(l => {
        const x = (r.lines || {})[l.sku] || { good: 0, dmg: 0, ev: [] };
        const rem = (l.exp || 0) - (l.recv || 0) - (l.dmg || 0) - _tkN(x.good) - _tkN(x.dmg);
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
  const draftKey = _tkDraftKey(task, "g");
  const [draft0] = useStateTk(() => editable ? _tkDraftLoad(draftKey) : null);
  const [checked, setChecked] = useStateTk(() => (d.items || []).map((_, i) =>
    (draft0 && Array.isArray(draft0.checked) && draft0.checked.length === (d.items || []).length) ? !!draft0.checked[i] : !!(d.checked || [])[i]));
  const [photo, setPhoto] = useStateTk(() => (draft0 && draft0.photo) || d.photo || "");
  const [note, setNote] = useStateTk(() => (draft0 && draft0.note) || "");
  useEffectTk(() => {
    if (!editable) return;
    if (!checked.some(Boolean) && !photo && !note.trim()) { _tkDraftClear(draftKey); return; }
    _tkDraftSave(draftKey, { checked, photo, note });
  }, [checked, photo, note, editable]);
  const [busy, setBusy] = useStateTk(false);
  const [err, setErr] = useStateTk("");
  const sending = useRefTk(false);
  const submit = async () => {
    if (sending.current) return;
    if ((d.items || []).some((_, i) => !checked[i])) return setErr("ติ๊กให้ครบทุกข้อก่อนส่ง");
    if (!photo) return setErr("ถ่ายรูปหลังทำ 1 รูป");
    sending.current = true;
    try { const ok = await onSubmit({ checked, photo, note: note.trim() }); if (ok) _tkDraftClear(draftKey); } finally { sending.current = false; }
  };
  return (
    <div>
      {task.status === "back" && d.comment && <div style={{ ...tkCard, background: "var(--danger-soft)", borderColor: "var(--danger)", fontSize: 13, marginBottom: 10 }}>ส่งกลับแก้ไข: {d.comment}</div>}
      {(d.items || []).map((it, i) => (
        <label key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)", fontSize: 14 }}>
          <input type="checkbox" style={{ width: 20, height: 20 }} checked={!!checked[i]} disabled={!editable} onChange={e => setChecked(checked.map((c, j) => j === i ? e.target.checked : c))}/> {it}
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

/* ── photo task: one photo per line; closes itself when every line has one ── */
const _tkResumeStatus = s => ["todo", "doing", "back", "partial"].includes(s) ? s : "doing";
const _tkPhotoDone = (t, sku) => !!((((t && t.data) || {}).shots || {})[sku] || (typeof resolveProductImage === "function" && resolveProductImage(sku)));
function PhotoWork({ m, task, editable, onShot, onFinish, busySku, pending }) {
  const d = task.data || {};
  const lines = d.lines || [];
  const shots = d.shots || {};
  const done = lines.filter(l => _tkPhotoDone(task, l.sku)).length;
  const allDone = lines.length > 0 && done === lines.length;
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>ถ่ายแล้ว <span className="tnum">{done}/{lines.length}</span></div>
      {lines.map(l => {
        const p = _tkProduct(l.sku);
        const shelf = p ? ((typeof productHomeLoc === "function" && productHomeLoc(p)) || "ยังไม่จัดเก็บ") : "";
        const ok = _tkPhotoDone(task, l.sku);
        const pend = pending && pending[l.sku];
        return (
          <div key={l.sku} style={tkRow}>
            <TkProductPic sku={l.sku} size={m ? 56 : 48}/>
            <span style={{ flex: 1, minWidth: 140 }}>
              <span className="mono" style={{ fontSize: 13 }}>{l.sku}</span><br/>
              <span style={tkMuted}>{p ? p.name : "ไม่พบสินค้า"}{shelf ? " · " + shelf : ""}</span>
            </span>
            {ok ? <span style={{ color: "var(--success)", fontWeight: 600, fontSize: 13 }}>✓ ถ่ายแล้ว</span>
              : editable ? (pend
                ? <button type="button" className={m ? "m-chip" : "btn btn-sm"} disabled={!!busySku} onClick={() => onShot(l.sku, null)}>{busySku === l.sku ? "กำลังบันทึก…" : "บันทึกรูปอีกครั้ง"}</button>
                : <TkPhotoBtn m={m} label="ถ่ายรูป" busy={!!busySku} onPick={f => onShot(l.sku, f)}/>)
              : <span style={tkMuted}>ยังไม่มีรูป</span>}
            {!editable && shots[l.sku] && <div style={{ width: "100%" }}><TkThumbs urls={[shots[l.sku]]} size={56}/></div>}
          </div>
        );
      })}
      {editable && allDone && ["todo", "doing", "back", "partial"].includes(task.status) && (
        <div style={{ marginTop: 12 }}><TkBtn m={m} primary onClick={onFinish}>ปิดงาน (ทุกรายการมีรูปแล้ว)</TkBtn></div>
      )}
      {task.status === "done" && <div style={{ ...tkMuted, marginTop: 8 }}>ปิดงานแล้ว</div>}
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
  const [editing, setEditing] = useStateTk(false);
  const [shotBusy, setShotBusy] = useStateTk("");
  const [pendingShot, setPendingShot] = useStateTk({});   // sku → uploaded url not yet saved (retry without re-shooting)
  const approving = useRefTk(false);
  const shooting = useRefTk(false);
  useEffectTk(() => { if (mgr) loadTaskAssignees().then(setPeople); }, [mgr]);
  // Opening your own task marks it started.
  useEffectTk(() => {
    if (task && task.assignee === me.id && task.status === "todo") saveTask(task, { status: "doing" }, "เริ่มทำงาน");
  }, [task && task.id, task && task.status]);
  const canEditNow = !!task && mgr && (task.type === "receive"
    ? ["todo", "doing"].includes(task.status) && !((task.data || {}).rounds || []).length && !(task.data || {}).round
    : ["todo", "doing", "back"].includes(task.status));
  useEffectTk(() => { if (editing && !canEditNow) setEditing(false); }, [canEditNow]);
  if (!task) return <div style={tkCard}><div style={tkMuted}>ไม่พบงานนี้ (อาจถูกลบหรือไม่ได้มอบหมายให้คุณ)</div><div style={{ marginTop: 10 }}><TkBtn m={m} onClick={onBack}>กลับ</TkBtn></div></div>;
  const d = task.data || {};
  const ty = TASK_TYPES[task.type] || TASK_TYPES.general;
  const mine = task.assignee === me.id;
  const selfMode = mgr && d.selfBy === me.id;
  const workOpen = ["todo", "doing", "back", "partial"].includes(task.status);
  const canWork = workOpen && (mine || selfMode);
  const inp = m ? "m-input" : "input";
  const canEdit = mgr && (task.type === "receive"
    ? ["todo", "doing"].includes(task.status) && !(d.rounds || []).length && !d.round
    : ["todo", "doing", "back"].includes(task.status));

  const save = async (patch, logText, okMsg) => {
    setErr("");
    const r = await saveTask(task, patch, logText);
    if (r.conflict) { _tkToast(TK_CONFLICT, "warn"); return null; }
    if (r.error) { setErr(r.error); return null; }
    if (okMsg) _tkToast(okMsg);
    return r.task;
  };

  /* Approve one receive round. Order matters: the task row is saved FIRST with
     the updated_at guard — only the device that wins that write moves stock, so
     a second approver, a retry or a double tap can never receive it twice.
     Returns true when the round was approved. */
  const approveRound = async (cur, round, opts) => {
    if (approving.current) return false;
    approving.current = true;
    try {
      const rows = (cur.data.lines || []).map(l => ({ sku: l.sku, qty: _tkN((round.lines[l.sku] || {}).good), loc: round.shelf })).filter(x => x.qty > 0 && _tkProduct(x.sku));
      const key = typeof commitFingerprint === "function" ? commitFingerprint("task:" + cur.id + ":" + ((cur.data.rounds || []).length + 1), rows) : null;
      if (key && typeof claimCommit === "function" && !claimCommit(key)) { _tkToast("กำลังบันทึกรอบนี้อยู่แล้ว"); return false; }
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
        return false;
      }
      const reason = `รับเข้าตามงาน ${cur.data.trk || cur.title}`;
      if (rows.length && typeof receiveStockAndRecord === "function") receiveStockAndRecord(rows, reason, { audit: true });
      if (rows.length && typeof applyReceiveLocs === "function") {
        applyReceiveLocs(rows).then(res => { if (res && res.errors && res.errors.length) _tkToast(`รับเข้าแล้ว แต่บันทึกตำแหน่งไม่สำเร็จ ${res.errors.length} SKU — แก้ได้ที่หน้าสินค้า`, "warn"); }).catch(() => {});
      }
      if (round.shelf && typeof rememberReceiveLoc === "function") rememberReceiveLoc(round.shelf);
      (cur.data.lines || []).forEach(l => {
        const x = round.lines[l.sku] || {};
        if (x.pp && opts.usePP && opts.usePP[l.sku] !== false && typeof setProductImage === "function"
            && !(typeof resolveProductImage === "function" && resolveProductImage(l.sku))) setProductImage(l.sku, x.pp);
      });
      _tkToast(rows.length ? `รับเข้าแล้ว ${rows.reduce((s, r) => s + r.qty, 0)} ชิ้น` + (done ? " · ปิดงาน" : " · ที่เหลือค้างรับ") : "บันทึกแล้ว");
      return true;
    } finally { approving.current = false; }
  };

  const submitReceive = async (round, approveNow) => {
    const saved = await save({ status: approveNow ? task.status : "review", data: { round, comment: "" } },
      `ส่งรายงานรอบ ${(d.rounds || []).length + 1}: ` + Object.entries(round.lines).map(([s, x]) => `${s} ดี ${x.good}${x.dmg ? " เสีย " + x.dmg : ""}`).join(", ") + (round.extras.length ? ` · ของเกิน ${round.extras.length} รายการ` : ""),
      approveNow ? null : "ส่งรายงานแล้ว รอเจ้าของอนุมัติ");
    if (!saved) return false;
    if (approveNow) return await approveRound(saved, round, { usePP: {}, extraAct: [], close: false });
    if (!selfMode) notifyTask(saved, "review");
    return true;
  };
  const submitGeneral = async (res) => {
    if (selfMode) return !!(await save({ status: "done", data: { ...res, selfBy: null } }, "ทำเองและปิดงาน", "ปิดงานแล้ว"));
    const saved = await save({ status: "review", data: { ...res, comment: "" } }, "ส่งรายงาน", "ส่งรายงานแล้ว รอเจ้าของอนุมัติ");
    if (saved) notifyTask(saved, "review");
    return !!saved;
  };

  /* Photo task: save the shot on the task first, then show it on the product,
     then close the task once every line has a photo. */
  const finishPhoto = async (cur) => {
    const r = await saveTask(cur, { status: "done" }, "ถ่ายรูปครบ ปิดงานอัตโนมัติ");
    if (r.conflict) { _tkToast(TK_CONFLICT, "warn"); return false; }
    if (r.error) { setErr(r.error); return false; }
    notifyTask(r.task, "done");
    _tkToast("ถ่ายรูปครบแล้ว ปิดงาน");
    return true;
  };
  const shoot = async (sku, file) => {
    if (shooting.current) { _tkToast("รอให้รูปก่อนหน้าบันทึกเสร็จก่อน", "warn"); return; }
    shooting.current = true;
    setShotBusy(sku); setErr("");
    try {
      let url = pendingShot[sku];
      if (file) { url = await _tkUpload(file); setPendingShot(p => ({ ...p, [sku]: url })); }
      if (!url) return;
      const cur = loadTasks().find(t => t.id === task.id) || task;
      const cd = cur.data || {};
      const r = await saveTask(cur, { status: cur.status === "todo" ? "doing" : cur.status, data: { shots: { ...(cd.shots || {}), [sku]: url } } }, "ถ่ายรูป " + sku);
      if (r.conflict) { _tkToast(TK_CONFLICT, "warn"); return; }
      if (r.error) { setErr(r.error); return; }
      setPendingShot(p => omit(p, sku));
      if (typeof setProductImage === "function" && !(typeof resolveProductImage === "function" && resolveProductImage(sku))) setProductImage(sku, url);
      const all = ((r.task.data || {}).lines || []).every(l => _tkPhotoDone(r.task, l.sku));
      if (all) await finishPhoto(r.task);
    } catch (e) {
      setErr("อัปโหลดรูปไม่สำเร็จ: " + ((e && e.message) || e));
    } finally { shooting.current = false; setShotBusy(""); }
  };

  const cancelTask = async () => {
    const hasNew = task.type === "receive" && (d.lines || []).some(l => l.isNew);
    if (hasNew && !confirm("ยกเลิกงานนี้? สินค้าใหม่ที่สร้างจากงานนี้และยังไม่เคยรับเข้าจะถูกลบ")) return;
    const saved = await save({ status: "cancel" }, "ยกเลิกงาน" + (reason.trim() ? ": " + reason.trim() : ""), "ยกเลิกงานแล้ว");
    if (saved && saved.type === "receive") _tkCleanupToast(await _tkCleanupNewProducts((saved.data || {}).lines));
  };

  const reassignPerson = people.find(x => x.id === reassignTo);
  return (
    <div>
      <div style={tkCard}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 22 }} aria-hidden="true">{ty.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{task.title}</div>
            <div style={tkMuted}>{ty.label} · {task.assigneeName}{d.selfBy ? " (เจ้าของทำเอง)" : ""}{task.due ? " · กำหนด " + task.due : ""}{taskOverdue(task) ? " · เลยกำหนด " + _tkDaysLate(task.due) + " วัน" : ""}{d.recurringId ? " · งานประจำ" : ""}</div>
            {task.type === "receive" && (d.trk || d.supplier) && <div style={tkMuted}>{d.trk ? <>เลขพัสดุ <span className="mono">{d.trk}</span></> : null}{d.trk && d.supplier ? " · " : ""}{d.supplier || ""}</div>}
          </div>
          <TkPill status={task.status}/>
        </div>
        {canEdit && !editing && (
          <div style={{ marginTop: 10 }}>
            <button type="button" className={m ? "m-chip" : "btn btn-sm"} onClick={() => setEditing(true)}>แก้ไขงาน</button>
          </div>
        )}
        {task.status === "blocked" && <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>ติดปัญหา: {d.reason}</div>}
        {task.type === "receive" && mgr && <div style={{ marginTop: 10 }}><ReceiveProgress task={task}/></div>}
      </div>

      {editing ? (
        <div style={{ marginTop: 12 }}>
          <TaskCreate m={m} edit={task} onDone={() => setEditing(false)} onCancel={() => setEditing(false)}/>
        </div>
      ) : (
        <div style={{ ...tkCard, marginTop: 12 }}>
          {task.type === "receive" && canWork && <ReceiveCount key={task.id + ":" + (d.rounds || []).length} m={m} task={task} selfApprove={selfMode} onSubmit={submitReceive}/>}
          {task.type === "receive" && task.status === "review" && mgr && d.round && (
            <ReceiveReview m={m} task={task}
              onApprove={opts => approveRound(task, d.round, opts)}
              onBack={c => save({ status: "back", data: { round: null, comment: c } }, "ส่งกลับให้นับใหม่: " + c, "ส่งกลับแล้ว").then(s => { if (s) notifyTask(s, "back"); })}/>
          )}
          {task.type === "receive" && task.status === "review" && !mgr && <div style={tkMuted}>ส่งรายงานแล้ว รอเจ้าของอนุมัติ</div>}
          {task.type === "receive" && !canWork && workOpen && mgr && <div style={tkMuted}>รอ {task.assigneeName} นับ{task.status === "partial" ? "กล่องถัดไป" : ""}</div>}
          {task.type === "receive" && ["done", "cancel"].includes(task.status) && <div style={tkMuted}>{task.status === "done" ? "ปิดงานแล้ว" : "ยกเลิกแล้ว"}</div>}
          {task.type === "general" && (
            <GeneralWork key={task.id + ":" + (d.items || []).join("\u0001")} m={m} task={task} editable={canWork} onSubmit={submitGeneral}/>
          )}
          {task.type === "general" && task.status === "review" && mgr && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <TkBtn m={m} primary onClick={() => save({ status: "done" }, "อนุมัติ · ปิดงาน", "ปิดงานแล้ว")}>อนุมัติ</TkBtn>
              <TkBtn m={m} onClick={() => { const c = reason.trim(); if (!c) return setErr("ใส่คอมเมนต์ในช่องด้านล่างก่อนส่งกลับ"); save({ status: "back", data: { comment: c } }, "ส่งกลับแก้ไข: " + c, "ส่งกลับแล้ว").then(s => { if (s) notifyTask(s, "back"); }); setReason(""); }}>ส่งกลับแก้ไข</TkBtn>
            </div>
          )}
          {task.type === "photo" && (
            <PhotoWork m={m} task={task} editable={canWork} onShot={shoot} onFinish={() => finishPhoto(task)} busySku={shotBusy} pending={pendingShot}/>
          )}
          {task.type === "photo" && task.status === "cancel" && <div style={{ ...tkMuted, marginTop: 8 }}>ยกเลิกแล้ว</div>}
        </div>
      )}

      {(canWork || (mgr && TASK_OPEN.includes(task.status))) && (
        <div style={{ ...tkCard, marginTop: 12 }}>
          <input className={inp} placeholder={mgr ? "เหตุผล / คอมเมนต์" : "ติดปัญหาอะไร? (เช่น ของยังไม่มา ไม่มีถุงขยะ)"} value={reason} onChange={e => { setReason(e.target.value); setErr(""); }} style={{ width: "100%" }}/>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {canWork && task.status !== "blocked" && (
              <TkBtn m={m} danger onClick={() => reason.trim() ? save({ status: "blocked", data: { reason: reason.trim(), prevStatus: task.status } }, "แจ้งติดปัญหา: " + reason.trim(), "แจ้งเจ้าของแล้ว").then(s => { if (s) { notifyTask(s, "blocked"); setReason(""); } }) : setErr("ใส่เหตุผลที่ติดปัญหา")}>ติดปัญหา</TkBtn>
            )}
            {mgr && task.status === "blocked" && <TkBtn m={m} primary onClick={() => save({ status: _tkResumeStatus(d.prevStatus), data: { reason: "" } }, "แก้ปัญหาแล้ว ให้ทำต่อ", "ส่งกลับให้ทำต่อแล้ว").then(s => { if (s) notifyTask(s, "resume"); })}>แก้แล้ว ให้ทำต่อ</TkBtn>}
            {mgr && workOpen && !selfMode && <TkBtn m={m} onClick={() => save({ status: task.status === "todo" ? "doing" : task.status, data: { selfBy: me.id } }, "เจ้าของรับไปทำเอง")}>ทำเอง</TkBtn>}
            {mgr && TASK_OPEN.includes(task.status) && <TkBtn m={m} danger onClick={cancelTask}>ยกเลิกงาน</TkBtn>}
          </div>
          {mgr && TASK_OPEN.includes(task.status) && task.status !== "review" && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                <select className={inp} value={reassignTo} onChange={e => setReassignTo(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
                  <option value="">เปลี่ยนผู้รับผิดชอบเป็น…</option>
                  {people.filter(p => p.id !== task.assignee).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <TkBtn m={false} onClick={() => {
                  const p = people.find(x => x.id === reassignTo);
                  if (!p) return setErr("เลือกคนที่จะมอบหมายให้");
                  save({ assignee: p.id, assigneeName: p.name, status: task.status === "blocked" ? _tkResumeStatus(d.prevStatus || "todo") : task.status, data: { selfBy: null } }, `เปลี่ยนผู้รับผิดชอบเป็น ${p.name}`, `มอบหมายให้ ${p.name} แล้ว`)
                    .then(s => { if (s) { setReassignTo(""); if (s.assignee !== me.id) notifyTask(s, "assigned"); } });
                }}>เปลี่ยน</TkBtn>
              </div>
              <TkRoleWarn person={reassignPerson}/>
            </>
          )}
          {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{err}</div>}
        </div>
      )}
      {!canWork && !(mgr && TASK_OPEN.includes(task.status)) && err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{err}</div>}

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
function _tkInitialView() {
  const id = takePendingTaskOpen();
  if (id) return { v: "task", id };
  const pre = window.__pendingTaskNew;
  if (pre) { window.__pendingTaskNew = null; return { v: "new", preset: pre }; }
  return { v: "list" };
}
function TeamTasks({ pushToast }) {
  const [view, setView] = useStateTk(_tkInitialView);
  const mgr = canManageTasks();
  useEffectTk(() => {
    const onOpen = e => { const id = takePendingTaskOpen() || (e.detail && e.detail.id); if (id) setView({ v: "task", id }); };
    const onNew = e => { const pre = window.__pendingTaskNew || (e && e.detail) || null; window.__pendingTaskNew = null; if (pre) setView({ v: "new", preset: pre }); };
    window.addEventListener("ims-open-task", onOpen);
    window.addEventListener("ims-open-task-new", onNew);
    return () => { window.removeEventListener("ims-open-task", onOpen); window.removeEventListener("ims-open-task-new", onNew); };
  }, []);
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
        {view.v === "new" && <TaskCreate key={view.preset ? "preset" + (view.preset.skus || []).length : "new"} preset={view.preset} onDone={id => setView({ v: "task", id })} onCancel={() => setView({ v: "list" })}/>}
        {view.v === "task" && <TaskDetail key={view.id} id={view.id} onBack={() => setView({ v: "list" })}/>}
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
  const preset = (ctx.route && ctx.route.params && ctx.route.params.preset) || null;
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back} aria-label="กลับ"><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">มอบหมายงาน</div>
      </div>
      <div className="m-content">
        <TaskCreate m preset={preset} onDone={id => { ctx.back(); ctx.push("task", { id }); }} onCancel={ctx.back}/>
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
        <TaskDetail key={id} m id={id} onBack={ctx.back}/>
      </div>
    </>
  );
}

Object.assign(window, {
  TASK_TYPES, TASK_STATUS, loadTasks, refreshTasks, startTaskSync, createTask, saveTask, deleteTask,
  canManageTasks, taskBadgeCount, taskOverdueCount, overdueTasks, skusInOpenTasks, useTasks,
  notifyTask, openTaskFromAnywhere, takePendingTaskOpen, spawnRecurringTasks,
  loadTaskTemplates, createTaskTemplate, setTaskTemplateActive, deleteTaskTemplate,
  TeamTasks, MTasks, MTaskNew, MTaskDetail
});
