/* Dashboard — iOS-inspired widget board.
   Each card is a draggable, closeable Window.
   "Customize" toggle reveals drag handles + close buttons.
   Hidden widgets sit in a tray and can be re-added. */

const { useState: useStateDash, useEffect: useEffectDash, useRef: useRefDash, useMemo: useMemoDash } = React;

const DASH_LS_KEY = "ims_dashboard_layout_v1";

/* ===== Individual widget bodies ===== */

function KPIWidget({ goTo }) {
  // Re-render whenever the catalog, orders, labels or ปรับสต็อก sales change
  const [tick, setTick] = useStateDash(0);
  useEffectDash(() => {
    const refresh = () => setTick(t => t + 1);
    const evs = ["ims-products-change", "ims-orders-change", "ims-labels-change", "ims-sales-change"];
    evs.forEach(e => window.addEventListener(e, refresh));
    return () => evs.forEach(e => window.removeEventListener(e, refresh));
  }, []);

  const totalSkus   = PRODUCTS.length;
  const totalQty    = PRODUCTS.reduce((s, p) => s + p.qty, 0);
  const lowStock    = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder).length;
  const outOfStock  = PRODUCTS.filter(p => p.qty === 0).length;
  // Same order model as the sidebar badge and the phone (was the raw orders
  // table, so this said 0 while the badge said 16). Blank label drafts excluded.
  const shipments   = typeof buildOrders === "function" ? buildOrders() : (typeof loadOrders === "function" ? loadOrders() : []);
  const pending     = shipments.filter(o => typeof isPendingOrder === "function" ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed")).length;
  const today       = typeof todayIso === "function" ? todayIso() : new Date().toISOString().slice(0, 10);
  const sales       = typeof loadSalesRecords === "function" ? loadSalesRecords() : [];
  const todaySales  = sales.filter(o => o.dateIso === today && (o.channel || "") !== "ฉลาก");
  const todayUnits  = todaySales.reduce((n, o) => n + (Array.isArray(o.lineItems) && o.lineItems.length ? o.lineItems.reduce((m, li) => m + (Number(li.qty) || 0), 0) : (Number(o.items) || 0)), 0);
  const can = (id) => typeof canOpenPage !== "function" || canOpenPage(id);
  // Staff never see per-day sales — that slot shows the catalog size instead.
  const canSales = typeof canDo !== "function" || canDo("viewSales");
  const inStockSkus = PRODUCTS.filter(p => p.qty > 0).length;

  const tile = (label, value, unit, sub, color, onClick) => (
    <button type="button" onClick={onClick || undefined} disabled={!onClick}
      style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: onClick ? "pointer" : "default" }}>
      <div className="kpi-label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
        <span className="kpi-value" style={color ? { color } : undefined}>{value}</span>
        {unit && <span style={{ color: "var(--muted)", fontSize: 12 }}>{unit}</span>}
      </div>
      <div className="kpi-delta" style={{ color: "var(--muted)" }}>{sub}</div>
      {onClick && <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 8, fontWeight: 500 }}>ดูรายการ →</div>}
    </button>
  );

  return (
    <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
      {tile("สต็อกคงเหลือรวม", totalQty.toLocaleString(), "ชิ้น", `ใน ${totalSkus} SKU`, null,
        can("inventory") ? () => goTo("inventory") : null)}
      {canSales
        ? tile("ขายวันนี้", todayUnits.toLocaleString(), "ชิ้น",
            todaySales.length ? `${todaySales.length} รายการขาย (รวมที่บันทึกผ่านปรับสต็อก)` : "ยังไม่มีการขายวันนี้", null,
            can("analytics") ? () => goTo("analytics") : null)
        : tile("SKU ทั้งหมด", totalSkus.toLocaleString(), "SKU", `${inStockSkus} SKU มีสต็อก`, null,
            can("inventory") ? () => goTo("inventory") : null)}
      {tile("ออร์เดอร์รอส่ง", pending, "ออร์เดอร์", pending ? "รอแพ็ค / พร้อมส่ง" : "ไม่มีงานค้าง", null,
        can("outbound") ? () => goTo("outbound") : null)}
      {tile("ต้องสั่งซื้อ", lowStock + outOfStock, "SKU", `${outOfStock} หมด · ${lowStock} ต่ำกว่าจุดสั่งซื้อ`,
        (lowStock + outOfStock) > 0 ? "var(--danger)" : null,
        can("inventory") ? () => goTo("inventory") : null)}
    </div>
  );
}

/* Recent activity, day-aware.
   Two modes: "ล่าสุด" walks back through the loaded log grouped by Bangkok day
   (โหลดเพิ่ม pulls the next page of older rows out of the DB), and a day mode
   where ◀ ▶ / the date box open ONE past day — fetched with a single query, so
   a day from months ago costs the same as yesterday. */
const ACTIVITY_STEP = 12;

function ActivityWidget({ goTo }) {
  const [tick, setTick]     = useStateDash(0);
  const [shown, setShown]   = useStateDash(ACTIVITY_STEP);
  const [day, setDay]       = useStateDash(null);      // null = ล่าสุด (ทุกวัน)
  const [dayRows, setDayRows] = useStateDash(null);
  const [busy, setBusy]     = useStateDash(false);

  const today = typeof todayIso === "function" ? todayIso() : new Date().toISOString().slice(0, 10);

  useEffectDash(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener("ims-audit-change", refresh);
    // Knowing the DB row count keeps "โหลดเพิ่ม" honest about what's left.
    if (typeof refreshAuditTotal === "function") refreshAuditTotal();
    return () => window.removeEventListener("ims-audit-change", refresh);
  }, []);

  useEffectDash(() => {
    if (!day) { setDayRows(null); return; }
    let alive = true;
    setBusy(true);
    Promise.resolve(typeof loadAuditDay === "function" ? loadAuditDay(day) : [])
      .then(rows => { if (alive) setDayRows(rows || []); })
      .catch(() => { if (alive) setDayRows([]); })
      .then(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [day]);

  const full = useMemoDash(() => (typeof loadAuditLog === "function" ? loadAuditLog() : []), [tick]);
  const list = day ? (dayRows || []) : full.slice(0, shown);
  const groups = groupAuditByDay(list);
  const hasMore = !day && (shown < full.length || (typeof auditHasMore === "function" && auditHasMore()));

  const jumpDay = (delta) => {
    const next = shiftDayKey(day || today, delta);
    if (next > today) return;                          // no future days
    setDay(next);
  };

  const showMore = async () => {
    if (shown + ACTIVITY_STEP <= full.length) { setShown(shown + ACTIVITY_STEP); return; }
    if (typeof loadMoreAuditLog === "function") {      // cache exhausted — page the DB
      setBusy(true);
      await loadMoreAuditLog();
      setBusy(false);
    }
    setShown(s => s + ACTIVITY_STEP);
  };

  const navBtn = { height: 28, padding: "0 8px" };

  return (
    <div>
      <div className="row" style={{ gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <button className="btn btn-sm" style={navBtn} onClick={() => jumpDay(-1)} title="วันก่อนหน้า">
          <Icons.Chev size={11} style={{ transform: "rotate(180deg)" }}/>
        </button>
        <input className="input" type="date" value={day || ""} max={today}
          onChange={e => setDay(e.target.value || null)}
          style={{ width: 150, height: 28, padding: "0 8px", fontSize: 12 }}/>
        <button className="btn btn-sm" style={navBtn} disabled={!day || day >= today} onClick={() => jumpDay(1)} title="วันถัดไป">
          <Icons.Chev size={11}/>
        </button>
        {day && <button className="btn btn-sm" style={navBtn} onClick={() => setDay(null)}>ล่าสุด</button>}
        <div className="spacer"/>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {busy ? "กำลังโหลด…" : day ? `${thaiDayLabel(day)} · ${list.length} รายการ` : `${list.length} รายการล่าสุด`}
        </span>
        {typeof canOpenPage === "function" && canOpenPage("history") && (
          <button className="btn btn-sm" style={navBtn} onClick={() => goTo && goTo("history")}>ดูทั้งหมด <Icons.Chev size={11}/></button>
        )}
      </div>

      <div style={{ maxHeight: 340, overflowY: "auto", padding: "4px 12px 8px" }}>
        {list.length === 0 && (
          <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            {busy ? "กำลังโหลด…"
              : day ? `ไม่มีกิจกรรมใน${thaiDayLabel(day)}`
              : "ยังไม่มีกิจกรรม — จะแสดงเมื่อเริ่มรับเข้า/ตัดสต็อก"}
          </div>
        )}
        {groups.map(([dayKey, entries]) => (
          <div key={dayKey}>
            {/* The date header is what makes an old entry readable — without it
                a 00:01 row from last week looks like it happened today. */}
            <div className="row" style={{ gap: 8, alignItems: "center", padding: "10px 4px 6px", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-2)" }}>{thaiDayLabel(dayKey)}</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }}/>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{entries.length} รายการ</span>
            </div>
            {entries.map((e, i) => (
              <div key={e.id || (dayKey + i)} style={{ display: "grid", gridTemplateColumns: "48px 24px 1fr auto", gap: 10, alignItems: "center", padding: "9px 4px", borderBottom: i < entries.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{bangkokTimeOf(e.ts)}</div>
                <ActivityDot type={auditTone(e)}/>
                <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.summary || e.entityId}>{e.summary || e.entityId}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{e.user?.name || "ระบบ"}</div>
              </div>
            ))}
          </div>
        ))}
        {hasMore && (
          <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
            <button className="btn btn-sm" onClick={showMore} disabled={busy}>{busy ? "กำลังโหลด…" : "โหลดเพิ่ม"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* Today's sales per channel — real orders AND sales recorded through ปรับสต็อก
   ("ขายผ่าน Shopee (นอกระบบ)" …), which is how the shop records most sales.
   Used to read a constant list that was always 0. */
function ChannelsWidget() {
  const [, setTick] = useStateDash(0);
  useEffectDash(() => {
    const refresh = () => setTick(t => t + 1);
    const evs = ["ims-orders-change", "ims-sales-change", "ims-products-change"];
    evs.forEach(e => window.addEventListener(e, refresh));
    return () => evs.forEach(e => window.removeEventListener(e, refresh));
  }, []);
  const rows = typeof channelToday === "function" ? channelToday() : [];
  const totalUnits = rows.reduce((n, c) => n + c.units, 0);
  const shown = rows.filter(c => c.units > 0).sort((a, b) => b.units - a.units);
  return (
    <div style={{ padding: "12px 18px 18px" }}>
      {shown.length === 0 && (
        <div style={{ padding: "24px 4px", textAlign: "center", color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
          ยังไม่มีการขายวันนี้<br/>
          <span style={{ fontSize: 12 }}>นับจากการตัดสต็อก และการปรับสต็อกด้วยเหตุผล “ขายผ่าน …”</span>
        </div>
      )}
      {shown.map(c => (
        <div key={c.id} style={{ padding: "9px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 13 }}>
            <span className="row" style={{ gap: 7 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/>
              {c.name}
            </span>
            <span>
              <span className="tnum" style={{ fontWeight: 600 }}>{c.units}</span>
              <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 4 }}>ชิ้น · {c.pct}%</span>
            </span>
          </div>
          <div className="prog" style={{ height: 5 }}><span style={{ width: c.pct + "%", background: c.color }}/></div>
        </div>
      ))}
      {shown.length > 0 && <>
        <div className="divider"/>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
          <span>ขายวันนี้ทั้งหมด</span>
          <span className="tnum" style={{ color: "var(--fg)", fontWeight: 600 }}>{totalUnits} ชิ้น</span>
        </div>
      </>}
    </div>
  );
}

function LowStockWidget({ goTo }) {
  const all = PRODUCTS.filter(p => p.qty <= p.reorder).sort((a, b) => a.qty - b.qty);
  const items = all.slice(0, 6);
  if (!items.length) {
    return <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>สต็อกทุกรายการสูงกว่าจุดสั่งซื้อ</div>;
  }
  const where = (p) => {
    const code = typeof productHomeLoc === "function" ? productHomeLoc(p) : p.loc;
    if (!code) return "ยังไม่จัดเก็บ";
    const lp = typeof locParts === "function" ? locParts(code) : null;
    return lp && lp.pos ? lp.pos : code;
  };
  return (
    <>
    <table className="t">
      <thead><tr><th>สินค้า</th><th className="t-num">คงเหลือ</th><th>สถานะ</th></tr></thead>
      <tbody>
        {items.map(p => {
          const s = stockStatus(p);
          return (
            <tr key={p.sku} onClick={() => goTo("inventory", { sku: p.sku })} style={{ cursor: "pointer" }}>
              <td>
                <div style={{ fontSize: 13 }}>{p.name}</div>
                <div className="t-mono" style={{ marginTop: 2 }}>{p.sku} · {where(p)}</div>
              </td>
              <td className="t-num tnum">{p.qty} <span style={{ color: "var(--muted)", fontSize: 11 }}>/ {p.reorder}</span></td>
              <td><span className={"badge " + s.cls}><span className="dot"/>{s.label}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {all.length > items.length && (
      <div style={{ padding: "10px 18px", borderTop: "1px solid var(--border)", textAlign: "right" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => goTo("inventory")}>ดูทั้งหมด {all.length} รายการ <Icons.Chev size={12}/></button>
      </div>
    )}
    </>
  );
}

function WarehouseWidget({ goTo }) {
  // The old colour legend (ว่าง / <30% / … / เต็ม) described a fill scale no
  // chip ever used — each chip is a position, the number is how many SKUs sit there.
  return (
    <div style={{ padding: 16 }}>
      <MiniWarehouse/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 12, color: "var(--muted)" }}>
        <span>ตัวเลข = จำนวน SKU ในตำแหน่งนั้น</span>
        {(typeof canOpenPage !== "function" || canOpenPage("locations")) &&
          <button className="btn btn-ghost btn-sm" onClick={() => goTo("locations")}>ดูผังคลัง <Icons.Chev size={12}/></button>}
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
    { id: "finder",   icon: Icons.Search,label: "ค้นหาสินค้า",   tone: "oklch(0.95 0.04 200)", fg: "oklch(0.4 0.13 200)" }
  ];
  // Drop shortcuts to pages this role can't open — goTo would refuse them anyway.
  const visible = actions.filter(a => typeof canOpenPage !== "function" || canOpenPage(a.id));
  return (
    <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {visible.map(a => {
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
  kpi:          { title: "ภาพรวมวันนี้",         sub: "แตะเพื่อดูรายการ",          defaultSpan: 12, render: (p) => <KPIWidget {...p}/> },
  channels:     { title: "ขายวันนี้ตามช่องทาง", sub: "ชิ้น",                     defaultSpan: 4, render: (p) => <ChannelsWidget {...p}/> },
  activity:     { title: "กิจกรรมล่าสุด",       sub: "ความเคลื่อนไหวของสต็อก",  defaultSpan: 8, render: (p) => <ActivityWidget {...p}/> },
  lowstock:     { title: "ต้องสั่งซื้อเพิ่ม",   sub: "ต่ำกว่าจุดสั่งซื้อ",       defaultSpan: 7, render: (p) => <LowStockWidget {...p}/> },
  warehouse:    { title: "ตำแหน่งจัดเก็บ",      sub: "SKU ต่อตำแหน่ง",           defaultSpan: 5, render: (p) => <WarehouseWidget {...p}/> },
  quickactions: { title: "ทางลัด",              sub: "งานที่ใช้บ่อย",            defaultSpan: 4, render: (p) => <QuickActionsWidget {...p}/> },
  calendar:     { title: "ปฏิทิน",              sub: "",                        defaultSpan: 4, render: (p) => <CalendarWidget {...p}/> }
};

const DEFAULT_LAYOUT = [
  { id: "kpi",       visible: true,  span: 12 },
  { id: "activity",  visible: true,  span: 8 },
  { id: "channels",  visible: true,  span: 4 },
  { id: "lowstock",  visible: true,  span: 7 },
  { id: "warehouse", visible: true,  span: 5 },
  { id: "quickactions", visible: false, span: 4 },
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

  // The channels widget is per-day sales — gone (board AND tray) without viewSales.
  const canSales = typeof canDo !== "function" || canDo("viewSales");
  const allowed = (w) => canSales || w.id !== "channels";
  const visible = layout.filter(w => w.visible && allowed(w));
  const hidden = layout.filter(w => !w.visible && allowed(w));

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
