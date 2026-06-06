/* Dashboard — iOS-inspired widget board.
   Each card is a draggable, closeable Window.
   "Customize" toggle reveals drag handles + close buttons.
   Hidden widgets sit in a tray and can be re-added. */

const { useState: useStateDash, useEffect: useEffectDash, useRef: useRefDash, useMemo: useMemoDash } = React;

const DASH_LS_KEY = "ims_dashboard_layout_v1";

/* ===== Individual widget bodies ===== */

function KPIWidget({ goTo }) {
  // Re-render whenever the product catalog or orders change
  const [tick, setTick] = useStateDash(0);
  useEffectDash(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-orders-change",   refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change",   refresh);
    };
  }, []);

  const totalSkus   = PRODUCTS.length;
  const totalQty    = PRODUCTS.reduce((s, p) => s + p.qty, 0);
  const lowStock    = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder).length;
  const outOfStock  = PRODUCTS.filter(p => p.qty === 0).length;
  const allOrders   = typeof loadOrders === "function" ? loadOrders() : [];
  const pending     = allOrders.filter(o => o.status === "picking" || o.status === "packed").length;
  const todayOrders = allOrders.filter(o => o.dateIso === new Date().toISOString().slice(0, 10)).length;
  return (
    <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      <div>
        <div className="kpi-label">SKU ทั้งหมด</div>
        <div className="kpi-value" style={{ marginTop: 4 }}>{totalSkus}</div>
        <div className="kpi-delta" style={{ color: "var(--muted)" }}>{totalSkus} รายการในคลัง</div>
        <div className="bars" style={{ marginTop: 8 }}>
          {Array(12).fill(1).map((_, i) => <div key={i} className="bar" style={{ height: "30%" }}/>)}
        </div>
      </div>
      <div>
        <div className="kpi-label">สต็อกคงเหลือรวม</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
          <span className="kpi-value">{totalQty.toLocaleString()}</span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>ชิ้น</span>
        </div>
        <div className="kpi-delta" style={{ color: "var(--muted)" }}>ใน {totalSkus} SKU</div>
        <div className="bars" style={{ marginTop: 8 }}>
          {Array(12).fill(1).map((_, i) => <div key={i} className="bar" style={{ height: "30%" }}/>)}
        </div>
      </div>
      <div>
        <div className="kpi-label">สั่งซื้อค้างส่ง</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
          <span className="kpi-value">{pending}</span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>ออร์เดอร์</span>
        </div>
        <div className="kpi-delta" style={{ color: "var(--muted)" }}>
          {todayOrders > 0 ? `${todayOrders} ออร์เดอร์วันนี้` : "ไม่มีออร์เดอร์ใหม่วันนี้"}
        </div>
        <div className="bars" style={{ marginTop: 8 }}>
          {Array(12).fill(1).map((_, i) => <div key={i} className="bar" style={{ height: "30%" }}/>)}
        </div>
      </div>
      <div>
        <div className="kpi-label">ต้องสั่งซื้อ</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
          <span className="kpi-value" style={{ color: (lowStock + outOfStock) > 0 ? "var(--danger)" : "var(--fg)" }}>{lowStock + outOfStock}</span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>SKU</span>
        </div>
        <div className="kpi-delta">{outOfStock} หมด · {lowStock} ต่ำ</div>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => goTo("inventory")}>ดูรายการ <Icons.Chev size={12}/></button>
      </div>
    </div>
  );
}

function ActivityWidget() {
  const log = typeof loadAuditLog === "function" ? loadAuditLog().slice(0, 6) : [];
  if (!log.length) return (
    <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
      ยังไม่มีกิจกรรม — จะแสดงเมื่อเริ่มรับเข้า/ตัดสต็อก
    </div>
  );
  return (
    <div style={{ padding: "6px 12px 12px" }}>
      {log.map((e, i) => {
        const t = e.ts ? new Date(e.ts).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
        const type = e.action === "delete" ? "out" : e.entity === "inbound" ? "in" : "out";
        return (
          <div key={e.id || i} style={{ display: "grid", gridTemplateColumns: "52px 24px 1fr auto", gap: 10, alignItems: "center", padding: "9px 8px", borderBottom: i < log.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{t}</div>
            <ActivityDot type={type}/>
            <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.summary || e.entityId}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.user?.name || "ระบบ"}</div>
          </div>
        );
      })}
    </div>
  );
}

function ChannelsWidget() {
  return (
    <div style={{ padding: "12px 18px 18px" }}>
      {CHANNELS.slice(0, 5).map(c => {
        const meta = CHANNEL_LIST.find(x => x.id === c.id) || {};
        return (
          <div key={c.id} style={{ padding: "9px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 13 }}>
              <span className="row" style={{ gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.color }}/>
                {c.name}
              </span>
              <span>
                <span className="tnum" style={{ fontWeight: 500 }}>{c.today}</span>
                <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 5 }}>({c.pct}%)</span>
              </span>
            </div>
            <div className="prog" style={{ height: 5 }}><span style={{ width: c.pct + "%", background: meta.color }}/></div>
          </div>
        );
      })}
      <div className="divider"/>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
        <span>ออร์เดอร์ที่ต้องส่งวันนี้</span>
        <span style={{ color: "var(--muted)" }}>—</span>
      </div>
    </div>
  );
}

function LowStockWidget({ goTo }) {
  const items = PRODUCTS.filter(p => p.qty <= p.reorder).slice(0, 6);
  return (
    <table className="t">
      <thead><tr><th>สินค้า</th><th className="t-num">คงเหลือ</th><th>สถานะ</th></tr></thead>
      <tbody>
        {items.map(p => {
          const s = stockStatus(p);
          return (
            <tr key={p.sku} onClick={() => goTo("inventory")} style={{ cursor: "pointer" }}>
              <td>
                <div style={{ fontSize: 13 }}>{p.name}</div>
                <div className="t-mono" style={{ marginTop: 2 }}>{p.sku} · {p.loc}</div>
              </td>
              <td className="t-num tnum">{p.qty} <span style={{ color: "var(--muted)", fontSize: 11 }}>/ {p.reorder}</span></td>
              <td><span className={"badge " + s.cls}><span className="dot"/>{s.label}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WarehouseWidget({ goTo }) {
  return (
    <div style={{ padding: 16 }}>
      <MiniWarehouse/>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 11 }}>
        <Legend color="var(--surface-2)" label="ว่าง"/>
        <Legend color="oklch(0.97 0.02 150)" label="< 30%"/>
        <Legend color="oklch(0.93 0.05 150)" label="30–70%"/>
        <Legend color="oklch(0.87 0.08 75)"  label="70–90%"/>
        <Legend color="oklch(0.82 0.12 30)"  label="เต็ม"/>
      </div>
    </div>
  );
}

function QuickActionsWidget({ goTo }) {
  const actions = [
    { id: "inbound",  icon: Icons.In,   label: "รับเข้าสินค้า",   tone: "oklch(0.96 0.04 150)", fg: "oklch(0.4 0.13 150)" },
    { id: "outbound", icon: Icons.Out,  label: "ตัดสต็อก",        tone: "oklch(0.95 0.04 230)", fg: "oklch(0.4 0.13 230)" },
    { id: "labels",   icon: Icons.Tag,  label: "พิมพ์ฉลาก",      tone: "oklch(0.96 0.03 310)", fg: "oklch(0.4 0.13 310)" },
    { id: "import",   icon: Icons.Pkg,  label: "นำเข้า SKU",     tone: "oklch(0.96 0.025 60)", fg: "oklch(0.4 0.13 60)" },
    { id: "locations",icon: Icons.Map,  label: "ตำแหน่งจัดเก็บ", tone: "oklch(0.95 0.04 270)", fg: "oklch(0.4 0.13 270)" },
    { id: "handheld", icon: Icons.Phone,label: "โหมดมือถือ",     tone: "oklch(0.95 0.04 200)", fg: "oklch(0.4 0.13 200)" }
  ];
  return (
    <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {actions.map(a => {
        const I = a.icon;
        return (
          <button key={a.id} className="btn" onClick={() => goTo(a.id)} style={{
            flexDirection: "column", alignItems: "center", gap: 8,
            padding: "16px 8px", background: a.tone, border: "1px solid var(--border)",
            borderRadius: 14, boxShadow: "none"
          }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.6)", display: "grid", placeItems: "center", color: a.fg }}>
              <I size={18}/>
            </div>
            <span style={{ fontSize: 12, fontWeight: 500 }}>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function TasksWidget() {
  const tasks = [
    { done: true,  text: "ตรวจนับ GR-26051901 — 320 ชิ้น", time: "09:24" },
    { done: true,  text: "ส่งมอบให้ไปรษณีย์ไทย 8 ออร์เดอร์", time: "09:44" },
    { done: false, text: "ตรวจนับ GR-26051902 — Tech Wave", time: "10:55", active: true },
    { done: false, text: "พิมพ์ฉลากชุด 14 ใบ", time: "11:30" },
    { done: false, text: "ปิดยอดประจำกะ", time: "16:00" }
  ];
  const doneCount = tasks.filter(t => t.done).length;
  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>เสร็จแล้ว {doneCount} จาก {tasks.length}</span>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>กะเช้า • 8:00 – 17:00</span>
      </div>
      <div className="prog" style={{ marginBottom: 14 }}><span style={{ width: (doneCount/tasks.length*100)+"%", background: "var(--success)" }}/></div>
      <div className="stack" style={{ gap: 6 }}>
        {tasks.map((t, i) => (
          <div key={i} className="row" style={{
            padding: "8px 10px",
            background: t.active ? "var(--accent-soft)" : "var(--surface-2)",
            border: "1px solid " + (t.active ? "var(--accent)" : "var(--border)"),
            borderRadius: 10
          }}>
            <span className={"check" + (t.done ? " on" : "")}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--muted)" : "var(--fg)" }}>{t.text}</div>
            </div>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{t.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarWidget() {
  const now   = new Date();
  const today = now.getDate();
  const year  = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const thaiMonths = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const thaiDays   = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
  const dayName = thaiDays[now.getDay()];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
  return (
    <div style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", fontFamily: "IBM Plex Sans, sans-serif" }}>{thaiMonths[month]} {year + 543}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>วัน{dayName}ที่ {today} {thaiMonths[month]}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 6 }}>
        {days.map(d => (
          <div key={d} style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", padding: "4px 0", fontWeight: 500 }}>{d}</div>
        ))}
        {[...Array(daysInMonth)].map((_, i) => {
          const d = i + 1;
          const isToday = d === today;
          return (
            <div key={d} style={{
              aspectRatio: "1",
              display: "grid", placeItems: "center",
              fontSize: 12,
              color: isToday ? "white" : (d > today ? "var(--faint)" : "var(--fg-2)"),
              background: isToday ? "var(--accent)" : "transparent",
              borderRadius: 999,
              fontWeight: isToday ? 600 : 400
            }} className="tnum">{d}</div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Widget registry ===== */
const WIDGET_DEFS = {
  kpi:          { title: "ภาพรวมวันนี้",         sub: "KPI หลัก",                 defaultSpan: 12, render: (p) => <KPIWidget {...p}/> },
  channels:     { title: "ออร์เดอร์ตามช่องทาง", sub: "แบ่งตามช่องทาง",           defaultSpan: 4, render: (p) => <ChannelsWidget {...p}/> },
  activity:     { title: "กิจกรรมล่าสุด",       sub: "ความเคลื่อนไหวของสต็อก",  defaultSpan: 8, render: (p) => <ActivityWidget {...p}/> },
  lowstock:     { title: "ต้องสั่งซื้อเพิ่ม",   sub: "ต่ำกว่าจุดสั่งซื้อ",       defaultSpan: 7, render: (p) => <LowStockWidget {...p}/> },
  warehouse:    { title: "การใช้พื้นที่คลัง",   sub: "โซน A – E",                defaultSpan: 5, render: (p) => <WarehouseWidget {...p}/> },
  quickactions: { title: "ทางลัด",              sub: "งานที่ใช้บ่อย",            defaultSpan: 4, render: (p) => <QuickActionsWidget {...p}/> },
  tasks:        { title: "งานวันนี้",           sub: "Checklist ของฉัน",        defaultSpan: 5, render: (p) => <TasksWidget {...p}/> },
  calendar:     { title: "ปฏิทิน",              sub: "",                        defaultSpan: 4, render: (p) => <CalendarWidget {...p}/> }
};

const DEFAULT_LAYOUT = [
  { id: "kpi",       visible: true,  span: 12 },
  { id: "activity",  visible: true,  span: 8 },
  { id: "channels",  visible: true,  span: 4 },
  { id: "lowstock",  visible: true,  span: 7 },
  { id: "warehouse", visible: true,  span: 5 },
  { id: "quickactions", visible: false, span: 4 },
  { id: "tasks",        visible: false, span: 5 },
  { id: "calendar",     visible: false, span: 4 }
];

/* ===== Window component ===== */
function Window({ id, def, span, edit, dragId, hoverId, onClose, onSpanChange, onDragStart, onDragOver, onDragEnd, onDrop, children }) {
  return (
    <div
      className={"win span-" + span + (dragId === id ? " dragging" : "") + (hoverId === id && dragId && dragId !== id ? " drop-target" : "")}
      draggable={edit}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(id); }}
      onDragOver={(e) => { if (dragId && dragId !== id) { e.preventDefault(); onDragOver(id); } }}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop(id); }}
    >
      <div className="win-head">
        <span className="win-grip">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/>
            <circle cx="2.5" cy="7" r="1.2"/><circle cx="7.5" cy="7" r="1.2"/>
            <circle cx="2.5" cy="11.5" r="1.2"/><circle cx="7.5" cy="11.5" r="1.2"/>
          </svg>
        </span>
        <div>
          <h4>{def.title}</h4>
        </div>
        {def.sub && <span className="sub">{def.sub}</span>}
        <div className="win-controls">
          {edit && (
            <div className="seg" style={{ padding: 2 }}>
              {[4, 6, 8, 12].map(s => (
                <button key={s} className={span === s ? "on" : ""} onClick={(e) => { e.stopPropagation(); onSpanChange(id, s); }} style={{ fontSize: 10, padding: "2px 7px" }}>{s}</button>
              ))}
            </div>
          )}
          <button className="win-close" onClick={() => onClose(id)} title="ปิด"><Icons.X size={11}/></button>
        </div>
      </div>
      <div className="win-body">{children}</div>
    </div>
  );
}

/* ===== Dashboard ===== */
function Dashboard({ goTo }) {
  const [layout, setLayoutRaw] = useStateDash(() => {
    try {
      const saved = localStorage.getItem(DASH_LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // merge with defaults to catch new widgets
        const known = new Set(parsed.map(w => w.id));
        return [...parsed, ...DEFAULT_LAYOUT.filter(w => !known.has(w.id))];
      }
    } catch (e) {}
    return DEFAULT_LAYOUT;
  });
  const setLayout = (updater) => setLayoutRaw(prev => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    try { localStorage.setItem(DASH_LS_KEY, JSON.stringify(next)); } catch(e) {}
    return next;
  });

  const [edit, setEdit] = useStateDash(false);
  const [dragId, setDragId] = useStateDash(null);
  const [hoverId, setHoverId] = useStateDash(null);

  const visible = layout.filter(w => w.visible);
  const hidden = layout.filter(w => !w.visible);

  const onClose = (id) => setLayout(L => L.map(w => w.id === id ? { ...w, visible: false } : w));
  const onReopen = (id) => setLayout(L => L.map(w => w.id === id ? { ...w, visible: true } : w));
  const onSpanChange = (id, span) => setLayout(L => L.map(w => w.id === id ? { ...w, span } : w));

  const onDragStart = (id) => setDragId(id);
  const onDragOver = (id) => setHoverId(id);
  const onDragEnd = () => { setDragId(null); setHoverId(null); };
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { onDragEnd(); return; }
    setLayout(L => {
      const next = [...L];
      const fromIdx = next.findIndex(w => w.id === dragId);
      const toIdx = next.findIndex(w => w.id === targetId);
      const [moved] = next.splice(fromIdx, 1);
      // reinsert at toIdx (now adjusted if from < to)
      const adj = fromIdx < toIdx ? toIdx - 1 : toIdx;
      next.splice(adj + 1, 0, moved);
      return next;
    });
    onDragEnd();
  };

  const resetLayout = () => {
    if (confirm("คืนค่าหน้าหลักให้เป็นค่าเริ่มต้น?")) {
      setLayout(DEFAULT_LAYOUT);
    }
  };

  return (
    <div>
      {/* Page header — iOS large title style */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 2 }}>{(() => { const d=new Date(); const days=["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"]; const months=["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]; return `วัน${days[d.getDay()]}ที่ ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()+543}`; })()}</div>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
          <h1 className="page-title" style={{ fontSize: 32, marginBottom: 0 }}>หน้าหลัก</h1>
          <div className="dash-toolbar" style={{ marginBottom: 0 }}>
            {edit && <button className="btn btn-sm" onClick={resetLayout}><Icons.Refresh size={12}/> คืนค่าเริ่มต้น</button>}
            <button
              className={"btn btn-sm" + (edit ? " btn-edit-on" : "")}
              onClick={() => setEdit(e => !e)}
            >
              {edit ? <><Icons.Check size={12}/> เสร็จสิ้น</> : <><Icons.Edit size={12}/> ปรับแต่งหน้าจอ</>}
            </button>
            <button className="btn btn-sm btn-accent" onClick={() => goTo("inbound")}><Icons.Plus size={12}/> รับเข้าสินค้า</button>
          </div>
        </div>
      </div>

      {edit && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--accent-soft)", border: "1px solid var(--accent-ring)", borderRadius: 12, fontSize: 12, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
          <Icons.Edit size={14}/>
          <span><strong>โหมดปรับแต่ง</strong> — ลากการ์ดเพื่อจัดเรียงใหม่ ปรับขนาดด้วยตัวเลข 4/6/8/12 ปิดด้วยปุ่ม × หรือดึงกลับมาจากด้านล่าง</span>
        </div>
      )}

      <div className={"widget-grid" + (edit ? " edit" : "")}>
        {visible.map(w => {
          const def = WIDGET_DEFS[w.id];
          if (!def) return null;
          return (
            <Window
              key={w.id}
              id={w.id}
              def={def}
              span={w.span}
              edit={edit}
              dragId={dragId}
              hoverId={hoverId}
              onClose={onClose}
              onSpanChange={onSpanChange}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
            >
              {def.render({ goTo })}
            </Window>
          );
        })}
      </div>

      {/* Hidden widget tray — visible only in edit mode */}
      {edit && (
        <div className="widget-tray">
          <div className="widget-tray-title">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>วิดเจ็ตที่ซ่อนอยู่ ({hidden.length})</span>
              {hidden.length === 0 && <span style={{ color: "var(--muted)" }}>— ไม่มีวิดเจ็ตที่ซ่อน —</span>}
            </div>
          </div>
          <div>
            {hidden.map(w => {
              const def = WIDGET_DEFS[w.id];
              if (!def) return null;
              return (
                <button key={w.id} className="widget-pill" onClick={() => onReopen(w.id)}>
                  <Icons.Plus size={11}/> {def.title}
                </button>
              );
            })}
            {hidden.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>วิดเจ็ตทั้งหมดถูกแสดงอยู่บนหน้าหลักแล้ว</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Dashboard });
