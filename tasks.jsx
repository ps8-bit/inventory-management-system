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
const EMPTY_CNT = { good: "", dmg: "", ev: [], pp: "", ppw: "" };
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
  const rec = isTaskReportRecipient();   // report toasts follow the setting; the badge stays for every manager
  const seen = _tkSeenLoad();
  const next = {};
  list.forEach(t => { next[t.id] = t.status; });
  const msgs = [];
  if (seen) {
    list.forEach(t => {
      const prev = seen[t.id];
      if (prev === t.status) return;
      const mine = t.assignee === me.id;
      const d = t.data || {};
      if (mine && t.status === "todo" && prev === undefined) msgs.push(`งานใหม่: ${t.title}`);
      else if (mine && t.status === "back") msgs.push(`งานถูกส่งกลับ: ${t.title}`);
      else if (mine && prev === "blocked" && t.status !== "blocked" && TASK_OPEN.includes(t.status)) msgs.push(`แก้ปัญหาแล้ว ทำต่อได้: ${t.title}`);
      else if (rec && t.status === "review") msgs.push(`รออนุมัติ: ${t.title} · ${t.assigneeName}`);
      else if (rec && t.status === "blocked") msgs.push(`ติดปัญหา: ${t.title} — ${d.reason || ""}`);
      else if (rec && t.status === "done" && prev !== undefined && prev !== "done")
        msgs.push(t.type === "photo" ? `ถ่ายรูปเสร็จ: ${t.title}` : `ปิดงานแล้ว: ${t.title} · ${t.assigneeName}`);
    });
  }
  _tkSeenSave(next);
  // Milestones (50 / 100 %) of general/photo tasks for report recipients. First run only records.
  if (rec) {
    try {
      const k = "ims_task_seen_pct_v1:" + me.id;
      const raw = localStorage.getItem(k);
      const map = raw ? (JSON.parse(raw) || {}) : {};
      list.forEach(t => {
        if (!["general", "photo"].includes(t.type) || !TK_WORK_OPEN.includes(t.status)) return;
        const pct = taskProgress(t, false).pct;
        const b = pct >= 100 ? 100 : pct >= 50 ? 50 : 0;
        if (raw && b > (map[t.id] || 0)) msgs.push(b >= 100 ? `${t.assigneeName} ทำ “${t.title}” ครบ 100% แล้ว` : `${t.assigneeName} ทำ “${t.title}” ไปแล้ว ${pct}%`);
        map[t.id] = Math.max(b, map[t.id] || 0);
      });
      localStorage.setItem(k, JSON.stringify(map));
    } catch (e) {}
  }
  if (msgs.length > 3) _tkToast(`มีงานอัปเดต ${msgs.length} รายการ`, "info");
  else msgs.forEach(msg => _tkToast(msg, "info"));
  // Overdue push: whichever device sees it first asks the server once (server dedupes across devices).
  // At most 3 per refresh (Telegram group ≈20 msg/min); marked sent only once the server
  // handled it, so the rest — and anything sent before phase-3 SQL ran — go on later refreshes.
  try {
    const k = "ims_task_od_push:" + me.id;
    const loadSent = () => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } };
    const sent0 = loadSent();
    window.__tkOdBusy = window.__tkOdBusy || {};
    overdueTasks(mgr ? list : list.filter(t => t.assignee === me.id))
      .filter(t => sent0[t.id] !== t.due && !window.__tkOdBusy[t.id])
      .slice(0, 3)
      .forEach(t => {
        window.__tkOdBusy[t.id] = true;
        notifyTask(t, "overdue").then(ok => {
          delete window.__tkOdBusy[t.id];
          if (!ok) return;
          const s = loadSent(); s[t.id] = t.due;
          try { localStorage.setItem(k, JSON.stringify(s)); } catch (e) {}
        });
      });
  } catch (e) {}
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
  window.addEventListener("online", () => Object.keys(_tkWorkQ).forEach(_tkFlushWork));
  try { _tkSubscribe(); } catch (e) { console.warn("[tasks] realtime:", e && e.message); }
  if (canManageTasks()) loadTaskReportSettings().catch(() => {});
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
/* Returns a promise of "the server gave a final answer" — sent, dup, or a definite refusal
   such as "bad kind" (never rejects). false = unreachable, or skipped because the phase-3
   log table is missing → worth asking again later. */
function notifyTask(task, kind, extra) {
  if (!task || typeof sendOrderPush !== "function") return Promise.resolve(false);
  try {
    return Promise.resolve(sendOrderPush({ mode: "task", taskId: task.id, kind, ...(extra || {}) }))
      .then(r => !!(r && r.data && !r.data.skipped), () => false);
  } catch (e) { return Promise.resolve(false); }
}
/* 50 % / 100 % milestone of a general/photo task → report recipients (server dedupes). */
function _tkMilestone(before, t) {
  if (!t || !["general", "photo"].includes(t.type) || !TK_WORK_OPEN.includes(t.status)) return;
  const after = taskProgress(t, false).pct;
  const ms = before < 100 && after >= 100 ? 100 : before < 50 && after >= 50 ? 50 : 0;
  if (ms) notifyTask(t, "progress", { milestone: ms });
}
/* Realtime: its OWN channel — never add team_tasks to 'ims-sync': a binding to a table
   that isn't published (phase-3 SQL not run) silences the whole channel (2026-10-07). */
function _tkSubscribe() {
  if (!_tkDb() || !sb.channel) return;
  if (sb.getChannels && sb.getChannels().some(c => c.topic === "realtime:ims-tasks")) return;
  let t = null;
  sb.channel("ims-tasks")
    .on("postgres_changes", { event: "*", schema: "public", table: "team_tasks" }, () => { clearTimeout(t); t = setTimeout(refreshTasks, 1200); })
    .subscribe();
}

/* ── live worker progress: per-task coalescing queue (whole-row, updated_at-guarded) ── */
const TK_WORK_OPEN = ["todo", "doing", "back", "partial"];
const _tkWorkQ = {};                 // taskId → { local, timer, running, again }
function _tkWorkState(id, state) {
  window.__tkWork = { ...(window.__tkWork || {}), [id]: state };
  window.dispatchEvent(new CustomEvent("ims-task-work", { detail: { id, state } }));
}
function tkQueueWork(taskId, local) {
  const q = _tkWorkQ[taskId] || (_tkWorkQ[taskId] = {});
  q.local = local;
  q.fails = 0;
  clearTimeout(q.timer);
  q.timer = setTimeout(() => _tkFlushWork(taskId), 700);   // coalesce fast taps
  _tkWorkState(taskId, "pending");
}
function tkCancelWork(taskId) { const q = _tkWorkQ[taskId]; if (q) { clearTimeout(q.timer); q.local = null; q.fails = 0; } _tkWorkState(taskId, "idle"); }
const _tkNetErr = msg => /fetch|network|timeout|load failed|abort/i.test(String(msg || ""));
async function _tkFlushWork(taskId) {
  const q = _tkWorkQ[taskId];
  if (!q || !q.local) return;
  if (q.running) { q.again = true; return; }
  q.running = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const local = q.local;
      if (!local) return;
      const cur = loadTasks().find(t => t.id === taskId);
      if (!cur || !TK_WORK_OPEN.includes(cur.status)) { q.local = null; _tkWorkState(taskId, "idle"); return; }
      // The owner changed the checklist: GeneralWork remounts (key) and re-queues remapped state.
      if (((cur.data || {}).items || []).join("\u0001") !== local.sig) { q.local = null; _tkWorkState(taskId, "idle"); return; }
      const before = taskProgress(cur, false).pct;
      // Merge per slot with the server row: a stale device (or an old dirty draft) must never
      // erase photos another device already saved. `one`-mode ticks stay local (they can be unticked).
      const sd = cur.data || {};
      const srv = sd.itemPhotos || [];
      const ip = (sd.items || []).map((_, i) => {
        const a = srv[i] || {}, b = (local.itemPhotos || [])[i] || {};
        return (a.before || a.after || b.before || b.after) ? { ...a, ...b } : null;
      });
      const ev = sd.evidence || "one";
      const checked = ev === "one" ? local.checked : (sd.items || []).map((_, i) => _tkItemDone({ evidence: ev, itemPhotos: ip }, i));
      const r = await saveTask(cur, { status: cur.status === "todo" ? "doing" : cur.status,
        data: { checked, itemPhotos: ip, photo: local.photo || sd.photo || "" } }, null);
      if (r.ok) {
        q.fails = 0;
        if (q.local === local) q.local = null;   // edits made meanwhile stay queued
        _tkWorkState(taskId, q.local ? "pending" : "saved");
        _tkMilestone(before, r.task);
        return;
      }
      if (r.conflict) continue;                  // saveTask already refreshed the cache
      _tkWorkState(taskId, "offline");
      // A network error keeps retrying; a refusal (RLS / guard / SQL) stops after 3 tries.
      if (!_tkNetErr(r.error)) {
        q.fails = (q.fails || 0) + 1;
        if (q.fails >= 3) { clearTimeout(q.timer); _tkToast("บันทึกความคืบหน้าไม่สำเร็จ: " + r.error, "error"); return; }
      }
      clearTimeout(q.timer); q.timer = setTimeout(() => _tkFlushWork(taskId), 15000);
      return;
    }
    _tkWorkState(taskId, "offline");
    clearTimeout(q.timer); q.timer = setTimeout(() => _tkFlushWork(taskId), 15000);
  } finally {
    q.running = false;
    if (q.again) { q.again = false; if (q.local) { clearTimeout(q.timer); q.timer = setTimeout(() => _tkFlushWork(taskId), 300); } }
  }
}

/* ── attention wiggle state (exported) ── */
const TK_ATTN = "ims_task_attn_ack:";   // + uid → [signature strings acknowledged]
function _tkAttnSet() {
  const me = _tkMe(); const list = loadTasks();
  const mine = canManageTasks()
    ? list.filter(t => t.status === "review" || t.status === "blocked" || taskOverdue(t))   // same set as taskBadgeCount
    : list.filter(t => t.assignee === me.id && TK_WORK_OPEN.includes(t.status));
  // A task turning overdue, or a new round of work (status change), counts as new.
  return mine.map(t => ({ t, sig: t.id + ":" + t.status + (taskOverdue(t) ? ":od" : "") }));
}
function taskAttention() {           // "" | "on" | "strong"
  const me = _tkMe(); if (!me.id) return "";
  let ack = [];
  try { ack = JSON.parse(localStorage.getItem(TK_ATTN + me.id) || "[]"); } catch (e) {}
  if (!Array.isArray(ack)) ack = [];
  const fresh = _tkAttnSet().filter(x => !ack.includes(x.sig));
  if (!fresh.length) return "";
  return fresh.some(x => taskOverdue(x.t) || x.t.status === "todo" || x.t.status === "back" || x.t.status === "blocked") ? "strong" : "on";
}
function ackTaskAttention() {
  const me = _tkMe(); if (!me.id) return;
  let prev = null;
  try { prev = localStorage.getItem(TK_ATTN + me.id); } catch (e) {}
  const next = JSON.stringify(_tkAttnSet().map(x => x.sig).slice(0, 300));
  if (prev === next) return;    // nothing new → no event (TaskList re-runs this on every list change)
  try { localStorage.setItem(TK_ATTN + me.id, next); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-tasks-change"));
}

/* ── who receives task reports (team_task_settings, phase-3 SQL) ── */
const TK_REPORT_DEFAULT = { roles: ["admin"], users: [], telegram: true };
let _tkReportCfg = null;
async function loadTaskReportSettings(force) {
  if (_tkReportCfg && !force) return _tkReportCfg;
  if (!_tkDb() || !canManageTasks()) return TK_REPORT_DEFAULT;
  const { data, error } = await sb.from("team_task_settings").select("*").eq("id", 1).maybeSingle();
  _tkReportCfg = (error || !data) ? { ...TK_REPORT_DEFAULT, missing: !!error }
    : { roles: data.report_roles || ["admin"], users: data.report_users || [], telegram: data.telegram !== false };
  return _tkReportCfg;
}
async function saveTaskReportSettings(cfg) {
  if (!cfg.roles.length && !cfg.users.length) return { error: "ต้องเลือกผู้รับอย่างน้อย 1 คน" };
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const { data, error } = await sb.from("team_task_settings").upsert({ id: 1, report_roles: cfg.roles, report_users: cfg.users,
    telegram: !!cfg.telegram, updated_by_name: _tkMe().name, updated_at: new Date().toISOString() }).select();
  if (error) return { error: /team_task_settings|does not exist|schema cache/i.test(error.message || "") ? "ต้องรัน supabase/team-tasks-phase3.sql ก่อน"
    : /row-level/i.test(error.message || "") ? "เฉพาะแอดมินเท่านั้น" : error.message };
  if (!data || !data.length) return { error: "เฉพาะแอดมินเท่านั้น" };     // verified save, never assumed
  _tkReportCfg = { roles: cfg.roles, users: cfg.users, telegram: !!cfg.telegram };
  return { ok: true };
}
function isTaskReportRecipient() {
  const me = _tkMe(); const c = _tkReportCfg || TK_REPORT_DEFAULT;
  return canManageTasks() && (c.roles.includes(me.role) || c.users.includes(me.id));
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
async function createTaskTemplate({ title, items, assignee, assigneeName, weekday, evidence }) {
  if (!_tkDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const row = {
    id: "P" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title, items, assignee, assignee_name: assigneeName, weekday, active: true, created_by_name: _tkMe().name,
    ...(evidence && evidence !== "one" ? { evidence } : {})
  };
  const { data, error } = await sb.from("team_task_templates").insert(row).select();
  if (error) {
    if (/evidence/i.test(error.message || "")) return { error: "ต้องรัน supabase/team-tasks-phase3.sql ก่อน" };
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
/* ── phase 3: watermarked, camera-first task photos ──
   Every task photo gets shop · task, label, SERVER date/time and the staff name
   burned in. Catalog photos (receive pp, photo-task shots) also go up clean. */
const TK_SHOP = () => {
  const n = window._DB_STORE && window._DB_STORE.name;
  return (n && n !== "ชื่อร้านค้า / คลังสินค้า") ? n : (window.__storeName || "PS TACTICAL");
};
const _tkFmt = ms => new Date(ms).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function _tkFit(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}
function _tkLoadImg(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => _tkLoadImgEl(file));
  }
  return _tkLoadImgEl(file);
}
function _tkLoadImgEl(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(i); };
    i.onerror = () => { URL.revokeObjectURL(url); rej(new Error("เปิดรูปภาพไม่ได้")); };
    i.src = url;
  });
}
/* Call the moment a file is picked; keep the result for retries so a retry
   doesn't restamp the time or mis-flag the file as old. */
async function tkPrepShot(file) {
  if (!file || !/^image\//.test(file.type || "")) throw new Error("เลือกไฟล์รูปภาพเท่านั้น");
  if (file.size > 20 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 20 MB");
  const at = typeof dbServerTimeMs === "function" ? await dbServerTimeMs() : Date.now();
  const old = !!(file.lastModified && at - file.lastModified > 15 * 60000);
  return { file, at, old };
}
async function tkWatermark(shot, title, label) {
  const img = await _tkLoadImg(shot.file);
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
  const k = Math.min(1, 1600 / Math.max(iw, ih));
  const W = Math.max(1, Math.round(iw * k)), H = Math.max(1, Math.round(ih * k));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, W, H);
  try { if (img.close) img.close(); } catch (e) {}
  const me = _tkMe();
  const rows = [TK_SHOP() + " · " + title, label, _tkFmt(shot.at) + " · ถ่ายโดย " + me.name];
  if (shot.old) rows.push("⚠ ไฟล์รูปเดิมเมื่อ " + _tkFmt(shot.file.lastModified));
  const fs = Math.max(14, Math.round(Math.min(W, H) * 0.034));
  const lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.7);
  const bh = pad * 2 + rows.length * lh;
  try {
    if (document.fonts && document.fonts.load) await Promise.all([document.fonts.load(`600 ${fs}px "IBM Plex Sans Thai"`), document.fonts.load(`400 ${fs}px "IBM Plex Sans Thai"`)]);
  } catch (e) {}
  g.fillStyle = "rgba(0,0,0,.58)"; g.fillRect(0, H - bh, W, bh);
  g.fillStyle = "#e8650f"; g.fillRect(0, H - bh, Math.max(4, Math.round(fs * 0.3)), bh);
  g.fillStyle = "#fff"; g.textBaseline = "top";
  rows.forEach((t, i) => {
    g.font = `${i === 0 ? 600 : 400} ${fs}px "IBM Plex Sans Thai", "IBM Plex Sans", sans-serif`;
    g.fillText(_tkFit(g, String(t || ""), W - pad * 3), Math.round(pad * 1.6), H - bh + pad + i * lh);
  });
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  c.width = c.height = 0;
  if (!blob) throw new Error("แปลงรูปไม่สำเร็จ");
  return blob;
}
/* → { u, clean, at, by, old }. `clean` only when product:true. */
async function tkCapture(shot, opts) {
  const title = opts.title, label = opts.label, product = opts.product;
  if (typeof uploadTaskPhoto !== "function") throw new Error("อัปโหลดรูปไม่ได้");
  const blob = await tkWatermark(shot, title, label);
  const [u, clean] = await Promise.all([uploadTaskPhoto(blob, { raw: true }), product ? uploadTaskPhoto(shot.file) : Promise.resolve("")]);
  return { u, clean: clean || "", at: new Date(shot.at).toISOString(), by: _tkMe().name, old: shot.old };
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

/* ── phase 3: progress model + bars + ticks ──
   mgr=true → receive % by quantity (received+damaged ÷ expected); staff never see quantities. */
function taskProgress(t, mgr) {
  const d = (t && t.data) || {};
  if (!t) return { pct: 0, done: 0, total: 0, label: "" };
  if (t.type === "general") {
    const items = d.items || [];
    const done = items.filter((_, i) => _tkItemDone(d, i)).length;
    return { pct: items.length ? Math.round(100 * done / items.length) : 0, done, total: items.length, label: `ทำแล้ว ${done}/${items.length} ข้อ` };
  }
  if (t.type === "photo") {
    const lines = d.lines || [];
    const done = lines.filter(l => _tkPhotoDone(t, l.sku)).length;
    return { pct: lines.length ? Math.round(100 * done / lines.length) : 0, done, total: lines.length, label: `ถ่ายแล้ว ${done}/${lines.length}` };
  }
  const lines = d.lines || [];
  if (mgr) {
    const exp = lines.reduce((s, l) => s + (l.exp || 0), 0);
    const got = lines.reduce((s, l) => s + Math.min(l.exp || 0, (l.recv || 0) + (l.dmg || 0)), 0);
    const pend = d.round ? Object.values(d.round.lines || {}).reduce((s, x) => s + _tkN(x.good) + _tkN(x.dmg), 0) : 0;
    return { pct: exp ? Math.round(100 * got / exp) : 0, done: got, total: exp,
      label: `รับแล้ว ${got}/${exp} ชิ้น` + (pend ? ` · รออนุมัติ +${pend}` : "") };
  }
  // Staff: SKUs counted in the current round only — never quantities.
  let counted = 0;
  if (d.round) counted = Object.values(d.round.lines || {}).filter(x => _tkN(x.good) + _tkN(x.dmg) > 0).length;
  else {
    const dr = _tkDraftLoad(_tkDraftKey(t, "r" + ((d.rounds || []).length + 1)));
    if (dr && dr.cnt) counted = lines.filter(l => { const c = dr.cnt[l.sku]; return c && (_tkN(c.good) + _tkN(c.dmg) > 0); }).length;
  }
  return { pct: lines.length ? Math.round(100 * counted / lines.length) : 0, done: counted, total: lines.length, label: `นับแล้ว ${counted}/${lines.length} SKU` };
}
function TkTick({ ok, size = 26 }) {
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
    border: "2px solid " + (ok ? "var(--success)" : "var(--border)"), background: ok ? "var(--success)" : "transparent", color: "#fff", fontSize: size * 0.55, fontWeight: 700 }}>{ok ? "✓" : ""}</span>;
}
function TkProgress({ t, p, mini }) {
  const pr = p || taskProgress(t, canManageTasks());
  const full = pr.total > 0 && pr.done >= pr.total;
  const c = full ? "var(--success)" : "var(--accent)";
  return (
    <div style={{ marginTop: mini ? 4 : 0 }}>
      {!mini && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={tkMuted}>{full ? "✅ ครบแล้ว" : pr.label}</span>
        <b className="tnum" style={{ color: c, fontSize: 16 }}>{pr.pct}%</b></div>}
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pr.pct} aria-label={pr.label}
        style={{ height: mini ? 6 : 10, borderRadius: 999, background: "var(--border)", overflow: "hidden", marginTop: mini ? 0 : 6 }}>
        <i style={{ display: "block", height: "100%", width: Math.min(100, pr.pct) + "%", background: full ? "var(--success)" : "var(--brand-grad, var(--accent))", transition: "width .4s" }}/>
      </div>
    </div>
  );
}
/* One photo slot (camera-first). Empty = dashed accent box; filled = cover image;
   edit mode re-shoots on tap, readOnly opens the viewer. */
function TkShotSlot({ m, label, shot, busy, disabled, error, onPick, onRetry, readOnly, lockedText }) {
  const has = !!(shot && shot.u);
  const box = { position: "relative", display: "block", aspectRatio: "4 / 3", minHeight: 44, borderRadius: 12, overflow: "hidden",
    border: has ? "1px solid var(--border)" : "2px dashed " + (disabled ? "var(--border)" : "var(--accent)"),
    background: has ? "var(--surface-2)" : (disabled ? "var(--surface-2)" : "var(--accent-soft)"),
    cursor: disabled ? "not-allowed" : (readOnly ? (has ? "zoom-in" : "default") : "pointer"), opacity: disabled ? 0.6 : 1 };
  const inner = (
    <>
      {has ? <img src={shot.u} alt={label} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
        : <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 6, fontSize: 13, fontWeight: 600, color: disabled ? "var(--muted)" : "var(--accent)" }}>
            {readOnly ? "ไม่มีรูป" : disabled ? (lockedText || label) : "📷 " + label}
          </span>}
      {has && <span style={{ position: "absolute", left: 6, top: 6, fontSize: 11, padding: "2px 6px", borderRadius: 6, background: "rgba(0,0,0,.55)", color: "#fff" }}>{label}</span>}
      {has && shot.old && <span className="badge" style={{ position: "absolute", right: 6, top: 6, background: "var(--warning-soft)", color: "var(--warning)" }}>รูปจากคลังภาพ</span>}
      {busy && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.45)", color: "#fff", fontSize: 13 }}>กำลังอัปโหลด…</span>}
    </>
  );
  return (
    <div>
      {readOnly
        ? <div role={has ? "button" : undefined} tabIndex={has ? 0 : undefined} style={box}
            onClick={() => has && typeof openProductImageViewer === "function" && openProductImageViewer(shot.u, label)}>{inner}</div>
        : <label style={box} aria-label={label}>
            {inner}
            <input type="file" accept="image/*" capture="environment" disabled={disabled || busy} style={{ display: "none" }}
              onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) onPick(f); }}/>
          </label>}
      {has && shot.at && <div style={{ ...tkMuted, fontSize: 11.5, marginTop: 3 }}>{new Date(shot.at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })}{shot.by ? " · " + shot.by : ""}</div>}
      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 4 }}>
          {error} {onRetry && <button type="button" className={m ? "m-chip" : "btn btn-sm"} onClick={onRetry} style={{ minHeight: 32 }}>ลองอีกครั้ง</button>}
        </div>
      )}
    </div>
  );
}

/* ── list row ── */
const TK_BACK_REASONS = ["รูปไม่ชัด ถ่ายใหม่", "ถ่ายรูปไม่ครบ", "ยังทำไม่เสร็จ", "จำนวนไม่ตรง นับใหม่", "ผิดตำแหน่ง/ผิดสินค้า"];
function TaskRow({ t, onOpen }) {
  const ty = TASK_TYPES[t.type] || TASK_TYPES.general;
  const sub = [ty.label, t.assigneeName, t.due ? "กำหนด " + t.due : ""].filter(Boolean).join(" · ");
  const mgrView = canManageTasks();
  const pr = taskProgress(t, mgrView);
  const prFull = pr.total > 0 && pr.done >= pr.total;
  const staffRecv = t.type === "receive" && !mgrView;
  return (
    <button type="button" onClick={() => onOpen(t.id)}
      style={{ ...tkRow, width: "100%", background: "none", border: "none", borderTop: "1px solid var(--border)", textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--fg)" }}>
      <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--accent-soft)", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }} aria-hidden="true">{ty.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{t.title}</span>
        <span style={tkMuted}>{sub}</span>
        {t.data && t.data.urgent && TASK_OPEN.includes(t.status) && <span className="badge" style={{ marginLeft: 6, background: "var(--danger)", color: "#fff" }}>🔥 ด่วน</span>}
        {taskOverdue(t) && <span className="badge" style={{ marginLeft: 6, background: "var(--danger-soft)", color: "var(--danger)" }}>เลยกำหนด · เลย {_tkDaysLate(t.due)} วัน</span>}
        {t.status !== "cancel" && <TkProgress p={pr} mini/>}
      </span>
      {t.status !== "cancel" && (staffRecv
        ? <span style={{ ...tkMuted, flexShrink: 0 }}>{pr.label}</span>
        : <b className="tnum" style={{ color: prFull ? "var(--success)" : "var(--accent)", flexShrink: 0 }}>{pr.pct}%</b>)}
      <TkPill status={t.status}/>
    </button>
  );
}

/* ── suggested tasks (manager only) ──
   Built from data the app already has. Nothing is created until the owner taps
   "สร้างงาน", which opens the normal create form prefilled. A dismissed card is
   remembered with its count, so it comes back only when the count changes. */
const TK_SUGGEST_MAX = 40;
function _tkSkuLine(p) { return `${p.sku} — ${p.name || ""}`.trim(); }
function buildTaskSuggestions() {
  const out = [];
  const prods = typeof PRODUCTS !== "undefined" ? PRODUCTS : [];
  if (typeof productIsStored === "function") {
    const un = prods.filter(p => (Number(p.qty) || 0) > 0 && !productIsStored(p)).sort((a, b) => (Number(b.qty) || 0) - (Number(a.qty) || 0));
    if (un.length) out.push({ id: "unshelved", icon: "📦", n: un.length, text: `สินค้ามีสต็อกแต่ยังไม่จัดเก็บ ${un.length} SKU`,
      preset: { type: "general", title: `เก็บสินค้าเข้าชั้น ${Math.min(un.length, TK_SUGGEST_MAX)} รายการ`, items: un.slice(0, TK_SUGGEST_MAX).map(_tkSkuLine) } });
  }
  if (typeof buildOrders === "function" && typeof isPendingOrder === "function" && typeof packLateDays === "function") {
    let late = [];
    try { late = buildOrders().filter(o => isPendingOrder(o) && o.status === "picking" && packLateDays(o) > 0); } catch (e) {}
    if (late.length) out.push({ id: "latepack", icon: "⏰", n: late.length, text: `ออร์เดอร์รอแพ็คเกินกำหนด ${late.length} ออร์เดอร์`,
      preset: { type: "general", urgent: true, title: `แพ็คออร์เดอร์ค้าง ${Math.min(late.length, TK_SUGGEST_MAX)} ออร์เดอร์`,
        items: late.slice(0, TK_SUGGEST_MAX).map(o => (typeof orderShortId === "function" ? orderShortId(o) : o.id) + (o.customer ? " · " + o.customer : "")) } });
  }
  // Same rule as the dashboard "ต้องสั่งซื้อ" tile (out of stock, or at/below the reorder point); emptiest first.
  const low = prods.filter(p => { const q = Number(p.qty) || 0; return q === 0 || q <= (Number(p.reorder) || 0); })
    .sort((a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0));
  if (low.length) out.push({ id: "lowstock", icon: "🛒", n: low.length, text: `สต็อกต่ำกว่าจุดสั่งซื้อ ${low.length} SKU`,
    preset: { type: "general", title: `เช็คสต็อก / สั่งซื้อ ${Math.min(low.length, TK_SUGGEST_MAX)} SKU`,
      items: low.slice(0, TK_SUGGEST_MAX).map(p => `${_tkSkuLine(p)} (เหลือ ${Number(p.qty) || 0})`) } });
  return out;
}
const TK_SUGGEST_KEY = "ims_task_suggest_hide_v1";
const TK_SUGGEST_EVENTS = ["ims-products-change", "ims-orders-change", "ims-labels-change"];
function TaskSuggestions({ onCreate }) {
  const [, bump] = useStateTk(0);
  useEffectTk(() => {
    const f = () => bump(x => x + 1);
    TK_SUGGEST_EVENTS.forEach(e => window.addEventListener(e, f));
    return () => TK_SUGGEST_EVENTS.forEach(e => window.removeEventListener(e, f));
  }, []);
  let hidden = {};
  try { hidden = JSON.parse(localStorage.getItem(TK_SUGGEST_KEY) || "{}") || {}; } catch (e) {}
  const list = buildTaskSuggestions().filter(x => hidden[x.id] !== x.n);
  if (!list.length) return null;
  const hide = x => { try { localStorage.setItem(TK_SUGGEST_KEY, JSON.stringify({ ...hidden, [x.id]: x.n })); } catch (e) {} bump(v => v + 1); };
  return (
    <div style={{ ...tkCard, marginBottom: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>💡 งานที่ระบบแนะนำ</div>
      <div style={tkMuted}>จากข้อมูลคลังตอนนี้ — กดสร้างงานเพื่อตรวจ/แก้ก่อนมอบหมาย</div>
      {list.map(x => (
        <div key={x.id} style={tkRow}>
          <span style={{ fontSize: 18 }} aria-hidden="true">{x.icon}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{x.text}</span>
          <button type="button" className="m-chip on" onClick={() => onCreate(x.preset)}>สร้างงาน</button>
          <button type="button" className="m-chip" onClick={() => hide(x)}>ซ่อน</button>
        </div>
      ))}
    </div>
  );
}

/* ── task list (both roles) ── */
const _tkSortGroup = arr => [...arr].sort((a, b) => {
  const ua = a.data && a.data.urgent ? 0 : 1, ub = b.data && b.data.urgent ? 0 : 1;
  if (ua !== ub) return ua - ub;
  const da = a.due || "9999-99-99", db = b.due || "9999-99-99";
  if (da !== db) return da < db ? -1 : 1;
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
});
function TaskList({ m, onOpen, onNew }) {
  const list = useTasks();
  const me = _tkMe();
  const mgr = canManageTasks();
  const [filter, setFilter] = useStateTk("open");
  // Opening the list acknowledges the attention wiggle (and again on new arrivals while visible).
  useEffectTk(() => { ackTaskAttention(); }, [list.length]);
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
  const filters = [["open", "งานที่ยังไม่ปิด"], ["closed", "ปิดแล้ว"]].concat(mgr ? [["tpl", "งานประจำ"]] : []).concat(me.role === "admin" ? [["notify", "การแจ้งเตือน"]] : []);
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
      {mgr && onNew && filter === "open" && <TaskSuggestions onCreate={onNew}/>}
      {filter === "notify" ? <TaskReportSettings m={m}/> : filter === "tpl" ? <TemplateList m={m}/> : (
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
            <span style={tkMuted}>ทุกวัน{TK_WEEKDAYS[t.weekday] || "?"} · {t.assignee_name || ""} · เช็กลิสต์ {(t.items || []).length} ข้อ{t.evidence === "item" ? " · รูปทุกข้อ" : t.evidence === "item2" ? " · รูปก่อน+หลัง" : ""}</span>
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
const TK_EVIDENCE = { one: "รูปหลังทำ 1 รูป", item: "รูปทุกข้อ", item2: "รูปก่อน + หลัง ทุกข้อ" };
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
  if (edit.type === "general" && (nd.evidence || "one") !== (od.evidence || "one")) out.push("รูป: " + (TK_EVIDENCE[nd.evidence || "one"] || nd.evidence));
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
  const [title, setTitle] = useStateTk(edit ? edit.title : ((preset && preset.title) || ""));
  const [trk, setTrk] = useStateTk(ed ? (ed.trk || "") : "");
  const [supplier, setSupplier] = useStateTk(ed ? (ed.supplier || "") : "");
  const [due, setDue] = useStateTk(edit ? (edit.due || "") : _tkToday());
  const [urgent, setUrgent] = useStateTk(!!(edit ? edit.data && edit.data.urgent : preset && preset.urgent));
  const [who, setWho] = useStateTk("");
  const [people, setPeople] = useStateTk([]);
  const [lines, setLines] = useStateTk(() => {
    if (ed) return (ed.lines || []).map(l => ({ ...l }));
    if (preset && preset.type === "photo" && Array.isArray(preset.skus)) return preset.skus.slice(0, 60).map(sku => ({ sku }));
    return [];
  });
  const [skuQ, setSkuQ] = useStateTk("");
  const [qty, setQty] = useStateTk("");
  const [items, setItems] = useStateTk(ed ? (ed.items || []).join("\n") : ((preset && Array.isArray(preset.items)) ? preset.items.join("\n") : ""));
  const [evidence, setEvidence] = useStateTk(() => {
    if (ed) return ed.evidence || "one";
    let v = null; try { v = localStorage.getItem("ims_task_evidence_last"); } catch (e) {}
    return TK_EVIDENCE[v] ? v : "one";
  });
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
      : { items: list, checked: [], evidence, itemPhotos: [] };
    data.urgent = urgent;

    if (edit) {
      const stale = "งานนี้เปลี่ยนไปแล้ว (พนักงานส่งรายงาน/แก้จากอีกเครื่อง) — ปิดแล้วเปิดแก้ใหม่";
      let r = null;
      setBusy(true);
      try {
        if (edit.type === "general") {
          // Staff save ticks/photos live, so updated_at moves while they work: refuse only when
          // an OWNER field changed meanwhile, then save against the fresh row (retry on a race).
          for (let attempt = 0; attempt < 3; attempt++) {
            const cur = loadTasks().find(t => t.id === edit.id) || edit;
            const cd = cur.data || {};
            const sameOwner = cur.title === edit.title && (cur.due || "") === (edit.due || "") && cur.assignee === edit.assignee
              && JSON.stringify(cd.items || []) === JSON.stringify(ed.items || []) && (cd.evidence || "one") === (ed.evidence || "one");
            if (!sameOwner || !["todo", "doing", "back"].includes(cur.status)) { setBusy(false); return setErr(stale); }
            const gdata = { items: list, evidence, urgent,
              checked: _tkRemap(cd.items, cd.checked, list, false),
              itemPhotos: _tkRemap(cd.items, cd.itemPhotos, list, null) };
            const patch = { title: finalTitle, due, data: gdata };
            r = await saveTask(cur, patch, "แก้ไขรายละเอียดงาน: " + _tkEditSummary(edit, patch));
            if (!r.conflict) break;
          }
        } else {
          const cur = loadTasks().find(t => t.id === edit.id) || edit;
          const cd = cur.data || {};
          if (cur.updatedAt !== edit.updatedAt || (cur.type === "receive" && !(["todo", "doing"].includes(cur.status) && !(cd.rounds || []).length && !cd.round))) { setBusy(false); return setErr(stale); }
          const patch = { title: finalTitle, due, data };
          r = await saveTask(edit, patch, "แก้ไขรายละเอียดงาน: " + _tkEditSummary(edit, patch));
        }
      } finally { setBusy(false); }
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
      try { localStorage.setItem("ims_task_evidence_last", evidence); } catch (e) {}
      const r = await createTaskTemplate({ title: finalTitle, items: list, assignee: person.id, assigneeName: person.name, weekday: Number(weekday), evidence });
      setBusy(false);
      if (r.error) return setErr(r.error);
      _tkToast(`ตั้งงานประจำทุกวัน${TK_WEEKDAYS[Number(weekday)]}ให้ ${person.name} แล้ว`);
      onCancel && onCancel();
      return;
    }
    if (type === "general") { try { localStorage.setItem("ims_task_evidence_last", evidence); } catch (e) {} }
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
        {!(type === "general" && repeat && !edit) && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)}/>
            <span>🔥 งานด่วน <span style={tkMuted}>(ขึ้นบนสุดของรายการ)</span></span>
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
        {type === "general" && (
          <div>
            <div style={{ ...tkMuted, fontWeight: 600, marginBottom: 6 }}>รูปจากเช็กลิสต์</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["one", "item", "item2"].map(id => (
                <button key={id} type="button" className={"m-chip" + (evidence === id ? " on" : "")} aria-pressed={evidence === id} onClick={() => setEvidence(id)}>{TK_EVIDENCE[id]}</button>
              ))}
            </div>
            <div style={{ ...tkMuted, marginTop: 6 }}>พนักงานต้องถ่ายรูปตามนี้ก่อนส่งรายงาน — รูปจะประทับวันเวลาและชื่อผู้ถ่าย</div>
          </div>
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
  const upload = async (key, file, title, label, product, apply) => {
    setBusyKey(key); setErr("");
    try { const shot = await tkPrepShot(file); apply(await tkCapture(shot, { title, label, product })); }
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
      lines: Object.fromEntries(lines.map(l => [l.sku, { good: _tkN(cOf(l.sku).good), dmg: _tkN(cOf(l.sku).dmg), ev: cOf(l.sku).ev || [], pp: cOf(l.sku).pp || "", ppw: cOf(l.sku).ppw || "" }]))
    };
    try { const ok = await onSubmit(round, approveNow); if (ok) _tkDraftClear(draftKey); } finally { sending.current = false; }
  };
  const countedN = lines.filter(l => _tkN(cOf(l.sku).good) + _tkN(cOf(l.sku).dmg) > 0).length;
  return (
    <div>
      <div style={{ marginBottom: 10 }}><TkProgress p={{ pct: lines.length ? Math.round(100 * countedN / lines.length) : 0, done: countedN, total: lines.length, label: `นับแล้ว ${countedN}/${lines.length} SKU` }}/></div>
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
              <TkPhotoBtn m={m} label="รูป" done={!!extraDraft.photo} busy={busyKey === "x"} onPick={f => upload("x", f, task.title, "ของเกิน " + extraDraft.code, false, r => setExtraDraft(x => ({ ...x, photo: r.u })))}/>
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
              <TkTick ok={_tkN(c.good) + _tkN(c.dmg) > 0} size={22}/>
              <TkProductPic sku={l.sku} size={m ? 56 : 52}/>
              <span style={{ flex: 1, minWidth: 140 }}>
                <span className="mono" style={{ fontSize: 13 }}>{l.sku}</span><br/>
                <span style={tkMuted}>{p ? p.name : ""}{l.recv ? ` · รับแล้วรอบก่อน ${l.recv}` : ""}</span>
              </span>
              <label style={tkMuted}>ดี <input className={inp + " tnum"} type="number" inputMode="numeric" min="0" placeholder="0" value={c.good} onChange={e => setLine(l.sku, "good", e.target.value)} style={{ width: 76 }}/></label>
              <label style={tkMuted}>เสีย <input className={inp + " tnum"} type="number" inputMode="numeric" min="0" placeholder="0" value={c.dmg} onChange={e => setLine(l.sku, "dmg", e.target.value)} style={{ width: 76 }}/></label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%" }}>
                <TkPhotoBtn m={m} label="หลักฐาน" done={(c.ev || []).length > 0} busy={busyKey === "ev" + l.sku} onPick={f => upload("ev" + l.sku, f, task.title, l.sku + " · หลักฐาน/ของเสีย", false, r => setLine(l.sku, "ev", [...((cntRef.current[l.sku] || EMPTY_CNT).ev || []), r.u]))}/>
                {!hasPic && <TkPhotoBtn m={m} label="ถ่ายรูปสินค้า" done={!!c.pp} busy={busyKey === "pp" + l.sku} onPick={f => upload("pp" + l.sku, f, task.title, l.sku + " · รูปสินค้า", true, r => updateCnt(cc => ({ ...cc, [l.sku]: { ...(cc[l.sku] || EMPTY_CNT), pp: r.clean || r.u, ppw: r.u } })))}/>}
              </div>
              <TkThumbs urls={[c.ppw || c.pp, ...(c.ev || [])]} size={48}/>
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
          <TkPhotoBtn m={m} label="รูปพัสดุ" done={pkg.length > 0} busy={busyKey === "pkg"} onPick={f => upload("pkg", f, task.title, "รูปพัสดุ", false, r => setPkg(a => [...a, r.u]))}/>
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
      <div style={{ marginBottom: 8 }}><TkProgress p={taskProgress(task, true)}/></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        <thead><tr style={{ color: "var(--muted)" }}><th aria-label="ครบ" style={{ width: 24 }}/>{["SKU", "สั่ง", "รับแล้ว", "เสีย", "ค้าง"].map((h, i) => <th key={h} style={{ textAlign: i ? "right" : "left", padding: "6px 4px", fontWeight: 500 }}>{h}</th>)}</tr></thead>
        <tbody>{lines.map(l => (
          <tr key={l.sku} style={{ borderTop: "1px solid var(--border)" }}>
            <td style={{ padding: "6px 2px" }}>{_tkLeft(l) === 0 ? <TkTick ok size={18}/> : null}</td>
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
            <TkThumbs urls={[x.ppw || x.pp, ...(x.ev || [])]} size={48}/>
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
  const items = d.items || [];
  const ev = d.evidence || "one";
  const sig = items.join("\u0001");
  const draftKey = _tkDraftKey(task, "g");
  // Draft = the offline safety net: { items, checked, itemPhotos, photo, note, dirty }.
  const [init] = useStateTk(() => {
    const draft = editable ? _tkDraftLoad(draftKey) : null;
    const pad = arr => items.map((_, i) => (arr || [])[i] || null);
    // Item modes: the tick is derived from the photos from the start, so opening never writes.
    const derive = (st) => ev === "one" ? st : { ...st, checked: items.map((_, i) => _tkItemDone({ evidence: ev, itemPhotos: st.itemPhotos }, i)) };
    // A phase-2 draft ({checked, photo, note}, no `dirty`/`items`) held unsent ticks + the
    // after-photo: treat it as dirty and assume its items are the current ones.
    const legacy = !!(draft && draft.dirty === undefined && (Array.isArray(draft.checked) || draft.photo));
    if (draft && (draft.dirty || legacy)) {
      const dItems = draft.items || (legacy && (!Array.isArray(draft.checked) || draft.checked.length === items.length) ? items : null);
      const same = !!dItems && JSON.stringify(dItems) === JSON.stringify(items);
      const ch = same ? (draft.checked || []) : _tkRemap(dItems, draft.checked, items, false);
      return derive({ dirty: true, checked: items.map((_, i) => !!ch[i]),
        itemPhotos: pad(same ? draft.itemPhotos : _tkRemap(dItems, draft.itemPhotos, items, null)),
        photo: draft.photo || "", note: draft.note || "" });
    }
    return derive({ dirty: false, checked: items.map((_, i) => !!(d.checked || [])[i]), itemPhotos: pad(d.itemPhotos),
      photo: d.photo || "", note: (draft && draft.note) || "" });
  });
  const [checked, setChecked] = useStateTk(init.checked);
  const [itemPhotos, setItemPhotos] = useStateTk(init.itemPhotos);
  const [photo, setPhoto] = useStateTk(init.photo);
  const [note, setNote] = useStateTk(init.note);
  const [busy, setBusy] = useStateTk({});       // slot key → true
  const [failed, setFailed] = useStateTk({});   // slot key → { shot, msg } (retry re-uses the prepared shot)
  const [err, setErr] = useStateTk("");
  const [sync, setSync] = useStateTk(() => ((window.__tkWork || {})[task.id]) || "");
  const sending = useRefTk(false);
  const dirtyRef = useRefTk(init.dirty);
  const lastWork = useRefTk(null);
  const stRef = useRefTk(null);
  stRef.current = { checked, itemPhotos, photo, note };

  // Item modes: the tick follows the photos, so legacy readers of `checked` stay consistent.
  useEffectTk(() => {
    if (ev === "one") return;
    const nc = items.map((_, i) => _tkItemDone({ evidence: ev, itemPhotos }, i));
    if (JSON.stringify(nc) !== JSON.stringify(checked)) setChecked(nc);
  }, [itemPhotos]);
  // Every local change: draft first (survives reload), then the live server queue.
  useEffectTk(() => {
    if (!editable) return;
    const work = JSON.stringify([checked, itemPhotos, photo]);
    const firstRun = lastWork.current === null;
    const changed = !firstRun && lastWork.current !== work;
    lastWork.current = work;
    if (changed) dirtyRef.current = true;
    if (changed || (firstRun && init.dirty)) tkQueueWork(task.id, { sig, checked, itemPhotos, photo });
    if (!dirtyRef.current && !note.trim()) return;
    _tkDraftSave(draftKey, { items, checked, itemPhotos, photo, note, dirty: dirtyRef.current });
  }, [checked, itemPhotos, photo, note, editable]);
  useEffectTk(() => {
    const h = e => {
      if (!e.detail || e.detail.id !== task.id) return;
      setSync(e.detail.state);
      if (e.detail.state === "saved" && editable) {
        dirtyRef.current = false;
        const s = stRef.current;
        _tkDraftSave(draftKey, { items, checked: s.checked, itemPhotos: s.itemPhotos, photo: s.photo, note: s.note, dirty: false });
      }
    };
    window.addEventListener("ims-task-work", h);
    return () => window.removeEventListener("ims-task-work", h);
  }, []);

  const local = editable ? { ...d, checked, itemPhotos, photo } : d;
  const pr = taskProgress({ ...task, data: local }, false);
  const complete = pr.total > 0 && pr.done >= pr.total && (ev !== "one" || !!local.photo);

  const shootSlot = async (key, file, retryShot) => {
    setBusy(b => ({ ...b, [key]: true })); setFailed(f => omit(f, key)); setErr("");
    let shot = retryShot;
    try {
      if (!shot) shot = await tkPrepShot(file);
      const parts = key.split(":");                 // "photo" → parts[1] undefined
      const is = parts[0], k = parts[1];
      const label = key === "photo" ? "รูปหลังทำ" : `ข้อ ${Number(is) + 1} ${items[Number(is)]} · ${k === "before" ? "ก่อน" : "หลัง"}`;
      const cap = await tkCapture(shot, { title: task.title, label });
      const s = { u: cap.u, at: cap.at, by: cap.by, old: cap.old };
      if (key === "photo") setPhoto(cap.u);
      else setItemPhotos(arr => { const n = [...arr]; const i = Number(is); n[i] = { ...(n[i] || {}), [k]: s }; return n; });
    } catch (e) { setFailed(f => ({ ...f, [key]: { shot, msg: (e && e.message) || "อัปโหลดไม่สำเร็จ" } })); }
    finally { setBusy(b => omit(b, key)); }
  };
  const slot = (key, label, shotObj, extra) => {
    const f = failed[key];
    return (
      <TkShotSlot key={key} m={m} label={label} shot={shotObj} busy={!!busy[key]} readOnly={!editable}
        disabled={!!(extra && extra.disabled)} lockedText={extra && extra.lockedText}
        error={f ? f.msg : ""} onPick={file => shootSlot(key, file)} onRetry={f && f.shot ? () => shootSlot(key, null, f.shot) : null}/>
    );
  };

  const submit = async () => {
    if (sending.current) return;
    if (Object.keys(busy).length) return setErr("รอให้รูปอัปโหลดเสร็จก่อน");
    if (ev === "one") {
      if (items.some((_, i) => !checked[i])) return setErr("ติ๊กให้ครบทุกข้อก่อนส่ง");
      if (!photo) return setErr("ถ่ายรูปหลังทำ 1 รูป");
    } else {
      const miss = items.findIndex((_, i) => !_tkItemDone(local, i));
      if (miss >= 0) return setErr("ข้อ " + (miss + 1) + " ยังไม่มีรูป" + (ev === "item2" ? "ก่อน/หลัง" : ""));
    }
    sending.current = true;
    tkCancelWork(task.id);
    const ch = ev === "one" ? checked : items.map((_, i) => _tkItemDone(local, i));
    try {
      const ok = await onSubmit({ checked: ch, photo, itemPhotos, note: note.trim() });
      if (ok) _tkDraftClear(draftKey);
      else tkQueueWork(task.id, { sig, checked, itemPhotos, photo });   // not sent → keep the live progress flowing
    } finally { sending.current = false; }
  };

  const syncText = sync === "pending" ? "กำลังบันทึก…" : sync === "saved" ? "บันทึกแล้ว ✓" : sync === "offline" ? "ยังไม่ได้ส่งขึ้นระบบ — จะลองใหม่อัตโนมัติ" : "";
  const ro = local.itemPhotos || [];
  return (
    <div>
      {task.status === "back" && d.comment && <div style={{ ...tkCard, background: "var(--danger-soft)", borderColor: "var(--danger)", fontSize: 13, marginBottom: 10 }}>ส่งกลับแก้ไข: {d.comment}</div>}
      {editable && (
        <div style={{ marginBottom: 10 }}>
          {syncText && <div role="status" style={{ ...tkMuted, fontSize: 11.5, textAlign: "right", color: sync === "offline" ? "var(--warning)" : "var(--muted)" }}>{syncText}</div>}
          <TkProgress p={pr}/>
        </div>
      )}
      {ev !== "one" && editable && <div style={{ ...tkMuted, marginBottom: 6 }}>ติ๊กเขียวอัตโนมัติเมื่อถ่ายรูปครบ</div>}
      {items.map((it, i) => {
        if (ev === "one") {
          return (
            <button key={i} type="button" role="checkbox" aria-checked={!!(local.checked || [])[i]} disabled={!editable}
              onClick={() => setChecked(checked.map((c, j) => j === i ? !c : c))}
              style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", minHeight: 44, padding: "8px 0", border: "none", borderTop: "1px solid var(--border)", background: "none", font: "inherit", fontSize: 14, color: "var(--fg)", textAlign: "left", cursor: editable ? "pointer" : "default" }}>
              <TkTick ok={!!(local.checked || [])[i]}/> <span style={{ flex: 1, minWidth: 0 }}>{it}</span>
            </button>
          );
        }
        const p = ro[i] || {};
        const ok = _tkItemDone(local, i);
        return (
          <div key={i} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, marginBottom: 8 }}>
              <TkTick ok={ok}/> <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{`${i + 1}. ${it}`}</span>
            </div>
            {ev === "item2" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 420 }}>
                {slot(i + ":before", editable ? "ก่อนทำ" : "ก่อน", p.before)}
                {slot(i + ":after", editable ? "หลังทำ" : "หลัง", p.after, { disabled: editable && !(p.before && p.before.u), lockedText: "ถ่าย “ก่อนทำ” ก่อน" })}
              </div>
            ) : (
              <div style={{ maxWidth: m ? "100%" : 260 }}>{slot(i + ":after", "รูปงาน", p.after)}</div>
            )}
          </div>
        );
      })}
      {ev === "one" && (editable
        ? <div style={{ maxWidth: m ? "100%" : 260, marginTop: 10 }}>{slot("photo", "รูปหลังทำ", photo ? { u: photo } : null)}</div>
        : <TkThumbs urls={[local.photo]} size={96}/>)}
      {d.note && <div style={{ ...tkMuted, marginTop: 6 }}>หมายเหตุ: {d.note}</div>}
      {editable && (
        <>
          <input className={m ? "m-input" : "input"} placeholder="หมายเหตุ (ถ้ามี)" value={note} onChange={e => setNote(e.target.value)} style={{ width: "100%", marginTop: 10 }}/>
          {err && <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{err}</div>}
          <div style={{ marginTop: 10 }}><TkBtn m={m} primary disabled={!complete} onClick={submit}>{complete ? "ส่งรายงาน" : "ถ่ายรูปให้ครบก่อนส่ง"}</TkBtn></div>
        </>
      )}
    </div>
  );
}

/* ── photo task: one photo per line; closes itself when every line has one ── */
const _tkResumeStatus = s => ["todo", "doing", "back", "partial"].includes(s) ? s : "doing";
const _tkPhotoDone = (t, sku) => !!((((t && t.data) || {}).shots || {})[sku] || (typeof resolveProductImage === "function" && resolveProductImage(sku)));
function _tkItemDone(d, i) {
  const ev = d.evidence || "one";
  const p = (d.itemPhotos || [])[i] || {};
  if (ev === "one") return !!(d.checked || [])[i];
  return !!(p.after && p.after.u) && (ev !== "item2" || !!(p.before && p.before.u));
}
/* Keep per-item state attached to the item's TEXT when the owner edits the list. */
function _tkRemap(oldItems, arr, newItems, empty) {
  const used = new Set();
  return (newItems || []).map(txt => {
    const j = (oldItems || []).findIndex((o, k) => o === txt && !used.has(k));
    if (j < 0) return empty;
    used.add(j);
    const v = (arr || [])[j];
    return v === undefined ? empty : v;
  });
}
function PhotoWork({ m, task, editable, onShot, onFinish, busySku, pending }) {
  const d = task.data || {};
  const lines = d.lines || [];
  const shots = d.shots || {};
  const done = lines.filter(l => _tkPhotoDone(task, l.sku)).length;
  const allDone = lines.length > 0 && done === lines.length;
  return (
    <div>
      <TkProgress t={task}/>
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
            {ok ? <TkTick ok/>
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
      if (done) notifyTask(saved.task, "done");
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
  /* Saved against the FRESH row (live progress saves move updated_at); one retry on a
     race is safe because the patch carries only worker fields. */
  const submitGeneral = async (res) => {
    setErr("");
    const patch = selfMode ? { status: "done", data: { ...res, selfBy: null } } : { status: "review", data: { ...res, comment: "" } };
    let r = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = loadTasks().find(t => t.id === task.id) || task;
      r = await saveTask(cur, patch, selfMode ? "ทำเองและปิดงาน" : "ส่งรายงาน");
      if (!r.conflict) break;
    }
    if (r.conflict) { _tkToast(TK_CONFLICT, "warn"); return false; }
    if (r.error) { setErr(r.error); return false; }
    _tkToast(selfMode ? "ปิดงานแล้ว" : "ส่งรายงานแล้ว รอเจ้าของอนุมัติ");
    notifyTask(r.task, selfMode ? "done" : "review");
    return true;
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
      let cap = pendingShot[sku];
      if (file) { cap = await tkCapture(await tkPrepShot(file), { title: task.title, label: sku + " · รูปสินค้า", product: true }); setPendingShot(p => ({ ...p, [sku]: cap })); }
      if (!cap) return;
      const cur = loadTasks().find(t => t.id === task.id) || task;
      const cd = cur.data || {};
      const before = taskProgress(cur, false).pct;
      const r = await saveTask(cur, { status: cur.status === "todo" ? "doing" : cur.status,
        data: { shots: { ...(cd.shots || {}), [sku]: cap.u }, shotsClean: { ...(cd.shotsClean || {}), [sku]: cap.clean } } }, "ถ่ายรูป " + sku);
      if (r.conflict) { _tkToast(TK_CONFLICT, "warn"); return; }
      if (r.error) { setErr(r.error); return; }
      setPendingShot(p => omit(p, sku));
      if (typeof setProductImage === "function" && !(typeof resolveProductImage === "function" && resolveProductImage(sku))) setProductImage(sku, cap.clean || cap.u);
      const all = ((r.task.data || {}).lines || []).every(l => _tkPhotoDone(r.task, l.sku));
      if (!all) _tkMilestone(before, r.task);   // the last shot closes the task → "done" is the one report
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
        {task.status !== "cancel" && !(task.type === "general" && canWork) && !(task.type === "receive" && mgr) && <div style={{ marginTop: 10 }}><TkProgress t={task}/></div>}
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
            <GeneralWork key={task.id + ":" + (d.items || []).join("\u0001") + ":" + (d.evidence || "one")} m={m} task={task} editable={canWork} onSubmit={submitGeneral}/>
          )}
          {task.type === "general" && task.status === "review" && mgr && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <TkBtn m={m} primary onClick={() => save({ status: "done" }, "อนุมัติ · ปิดงาน", "ปิดงานแล้ว").then(s => { if (s) notifyTask(s, "done"); })}>อนุมัติ</TkBtn>
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
          {mgr && task.status === "review" && task.type !== "receive" && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {TK_BACK_REASONS.map(r => (
                <button key={r} type="button" className="m-chip" onClick={() => { setReason(r); setErr(""); }}>{r}</button>
              ))}
            </div>
          )}
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

/* ── who receives task reports (admin only; shared by both shells) ── */
function TaskReportSettings({ m }) {
  const [cfg, setCfg] = useStateTk(null);
  const [people, setPeople] = useStateTk([]);
  const [busy, setBusy] = useStateTk(false);
  const [test, setTest] = useStateTk(null);
  const [testing, setTesting] = useStateTk(false);
  useEffectTk(() => {
    loadTaskReportSettings(true).then(c => setCfg({ roles: [...c.roles], users: [...c.users], telegram: c.telegram !== false, missing: !!c.missing }));
    loadTaskAssignees().then(list => setPeople((list || []).filter(p => p.role === "admin" || p.role === "manager")));
  }, []);
  if (!cfg) return <div style={tkCard}><div style={tkMuted}>กำลังโหลด…</div></div>;
  const toggleIn = (key, v) => setCfg(c => ({ ...c, [key]: c[key].includes(v) ? c[key].filter(x => x !== v) : [...c[key], v] }));
  const save = async () => {
    setBusy(true);
    const r = await saveTaskReportSettings(cfg);
    setBusy(false);
    if (r.error) _tkToast(r.error, "error"); else _tkToast("บันทึกผู้รับรายงานแล้ว");
  };
  const runTest = async () => {
    if (typeof sendOrderPush !== "function") return setTest({ error: "ส่งไม่ได้" });
    setTesting(true); setTest(null);
    const r = await sendOrderPush({ mode: "task-tg-test" });
    setTesting(false);
    setTest(r && r.data ? r.data : { error: (r && r.error && (r.error.message || String(r.error))) || "ส่งไม่สำเร็จ" });
  };
  const chk = { display: "flex", gap: 8, alignItems: "center", minHeight: 40, fontSize: 14 };
  return (
    <div style={tkCard}>
      {cfg.missing && (
        <div style={{ ...tkCard, background: "var(--warning-soft)", borderColor: "var(--warning)", marginBottom: 10, fontSize: 13 }}>
          ต้องรัน supabase/team-tasks-phase3.sql ก่อน — ตอนนี้ส่งให้แอดมินเท่านั้น
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 15 }}>ใครได้รับรายงานงาน</div>
      <div style={{ ...tkMuted, marginBottom: 8 }}>ส่งรายงาน, เสร็จ/ปิดงาน, ติดปัญหา, เลยกำหนด, ความคืบหน้า 50%/100%</div>
      <label style={chk}><input type="checkbox" checked={cfg.roles.includes("admin")} onChange={() => toggleIn("roles", "admin")}/> แอดมิน (เจ้าของร้าน)</label>
      <label style={chk}><input type="checkbox" checked={cfg.roles.includes("manager")} onChange={() => toggleIn("roles", "manager")}/> ผู้จัดการทุกคน</label>
      <TkSection title="หรือเลือกเฉพาะคน">
        {!people.length && <div style={tkMuted}>ไม่มีรายชื่อ</div>}
        {people.map(p => (
          <label key={p.id} style={chk}><input type="checkbox" checked={cfg.users.includes(p.id)} onChange={() => toggleIn("users", p.id)}/> {p.name} <span style={tkMuted}>· {p.role}</span></label>
        ))}
      </TkSection>
      <TkSection title="Telegram">
        <label style={chk}><input type="checkbox" checked={!!cfg.telegram} onChange={e => setCfg(c => ({ ...c, telegram: e.target.checked }))}/> ส่ง Telegram ส่วนตัวถึงเจ้าของพร้อมรูป</label>
        <div style={{ marginTop: 6 }}>
          <button type="button" className={m ? "m-chip" : "btn btn-sm"} disabled={testing} onClick={runTest}>{testing ? "กำลังทดสอบ…" : "ทดสอบ Telegram เจ้าของ"}</button>
        </div>
        {test && (
          <div role="status" style={{ ...tkCard, background: "var(--surface-2)", marginTop: 8, fontSize: 13 }}>
            {test.result === "sent" ? <span style={{ color: "var(--success)" }}>ส่งแล้ว — ดูในแชตส่วนตัวกับบอท</span>
              : test.result === "no-owner-chat" ? (
                <div>
                  <div style={{ fontWeight: 600 }}>ยังไม่ได้ตั้ง TELEGRAM_OWNER_CHAT_ID</div>
                  {(test.candidates || []).map(c => <div key={c.id} className="mono">{(c.name || "-") + " — " + c.id}</div>)}
                  <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                    <li>ทักบอทในแชตส่วนตัว (กด Start)</li>
                    <li>กดทดสอบอีกครั้งเพื่อดู id</li>
                    <li>ใส่ id ใน Supabase secret TELEGRAM_OWNER_CHAT_ID</li>
                  </ol>
                </div>
              ) : <span style={{ color: "var(--danger)" }}>{test.error || "ส่งไม่สำเร็จ"}</span>}
          </div>
        )}
      </TkSection>
      <div style={{ marginTop: 14 }}><TkBtn m={m} primary disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</TkBtn></div>
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
        {view.v === "list" && <TaskList onOpen={id => setView({ v: "task", id })} onNew={mgr ? pre => setView({ v: "new", preset: pre && pre.type ? pre : null }) : null}/>}
        {view.v === "new" && <TaskCreate key={view.preset ? "preset" + (view.preset.title || "") + (view.preset.skus || []).length : "new"} preset={view.preset} onDone={id => setView({ v: "task", id })} onCancel={() => setView({ v: "list" })}/>}
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
        <TaskList m onOpen={id => ctx.push("task", { id })} onNew={mgr ? pre => ctx.push("task-new", pre && pre.type ? { preset: pre } : undefined) : null}/>
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
  TeamTasks, MTasks, MTaskNew, MTaskDetail,
  taskProgress, TkProgress, TkTick, taskAttention, ackTaskAttention, loadTaskReportSettings, saveTaskReportSettings,
  isTaskReportRecipient, tkPrepShot, tkCapture, tkQueueWork, tkCancelWork
});
