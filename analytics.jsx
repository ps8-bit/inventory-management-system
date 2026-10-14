/* Sales analytics — revenue / cost / profit / margin per period */

const { useState: useStateAn, useMemo: useMemoAn, useEffect: useEffectAn } = React;

const PERIODS = [
  { id: "today", label: "วันนี้",    barLabel: "ชั่วโมง" },
  { id: "week",  label: "สัปดาห์นี้", barLabel: "วัน" },
  { id: "month", label: "เดือนนี้",  barLabel: "วัน" },
  { id: "year",  label: "ปีนี้",      barLabel: "เดือน" }
];

const fmt = (n) => Math.round(n).toLocaleString("th-TH");
const fmtMoney = (n) => "฿" + Math.round(n).toLocaleString("th-TH");

/* ── Real date/time helpers (Bangkok-anchored) ───────────────────── */
const THAI_MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
function _todayBkkIso() {
  return (typeof bangkokDateStr === "function") ? bangkokDateStr() : new Date().toISOString().slice(0, 10);
}
function _addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function _hourFromTs(ts) {            // ts = "HH:MM" (Thai local) → 0..23 or -1
  const m = typeof ts === "string" ? ts.match(/(\d{1,2}):(\d{2})/) : null;
  if (!m) return -1;
  const h = parseInt(m[1], 10);
  return (h >= 0 && h < 24) ? h : -1;
}

/* Build the bucketing window for a period: bar count, labels, which bar an
   order falls in (by its real date/time), and whether it's in the previous
   period (for the vs-previous delta). All anchored to Bangkok-local "today". */
function buildAnalyticsWindow(period, todayIso) {
  const [Y, M, D] = todayIso.split("-").map(Number);
  if (period === "today") {
    const yest = _addDaysIso(todayIso, -1);
    return {
      bars: 24,
      labels: Array.from({ length: 24 }, (_, i) => i % 6 === 0 ? `${i}:00` : ""),
      barIndex: (o) => o.dateIso === todayIso ? _hourFromTs(o.ts) : -1,
      inPrev:   (o) => o.dateIso === yest
    };
  }
  if (period === "week") {
    const dow = (new Date(Date.UTC(Y, M - 1, D)).getUTCDay() + 6) % 7;   // 0=Mon … 6=Sun
    const monday = _addDaysIso(todayIso, -dow);
    const idx = new Map(Array.from({ length: 7 }, (_, i) => [_addDaysIso(monday, i), i]));
    const prevWeek = new Set(Array.from({ length: 7 }, (_, i) => _addDaysIso(monday, i - 7)));
    return {
      bars: 7,
      labels: ["จ","อ","พ","พฤ","ศ","ส","อา"],
      barIndex: (o) => idx.has(o.dateIso) ? idx.get(o.dateIso) : -1,
      inPrev:   (o) => prevWeek.has(o.dateIso)
    };
  }
  if (period === "month") {
    const days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
    const prefix = `${Y}-${String(M).padStart(2, "0")}`;
    const py = M === 1 ? Y - 1 : Y, pm = M === 1 ? 12 : M - 1;
    const prevPrefix = `${py}-${String(pm).padStart(2, "0")}`;
    return {
      bars: days,
      labels: Array.from({ length: days }, (_, i) => i % 5 === 0 ? `${i + 1}` : ""),
      barIndex: (o) => (o.dateIso && o.dateIso.startsWith(prefix)) ? Number(o.dateIso.slice(8, 10)) - 1 : -1,
      inPrev:   (o) => !!o.dateIso && o.dateIso.startsWith(prevPrefix)
    };
  }
  // year
  return {
    bars: 12,
    labels: THAI_MONTHS_SHORT.slice(),
    barIndex: (o) => (o.dateIso && o.dateIso.startsWith(`${Y}-`)) ? Number(o.dateIso.slice(5, 7)) - 1 : -1,
    inPrev:   (o) => !!o.dateIso && o.dateIso.startsWith(`${Y - 1}-`)
  };
}

/* ============ ANALYTICS PAGE ============ */

function AnalyticsPage({ pushToast }) {
  const [period, setPeriod] = useStateAn("month");
  const [view, setView] = useStateAn("overview"); // overview | actions (ต้องจัดการ)
  const [open, setOpen] = useStateAn(null);
  const [metric, setMetric] = useStateAn("orders"); // chart metric: orders (real now) | revenue
  const [pv, setPv] = useStateAn(0); // bumps when the catalog OR orders change → recompute
  const def = PERIODS.find(p => p.id === period);

  // Recompute live when a product is edited (price/cost) OR any order changes.
  useEffectAn(() => {
    const refresh = () => setPv(v => v + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-orders-change", refresh);
    window.addEventListener("ims-sales-change", refresh);
    if (typeof refreshSaleMoves === "function") refreshSaleMoves();
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
      window.removeEventListener("ims-sales-change", refresh);
    };
  }, []);

  // Aggregate REAL orders in ONE pass → (1) order VOLUME per bucket + by channel
  // (works today, from every order's real date/time) and (2) per-product
  // revenue/units from lineItems (fills in once sales record full detail).
  // All bucketed in Bangkok-local time. Revenue uses each SKU's current price.
  const agg = useMemoAn(() => {
    const win = buildAnalyticsWindow(period, _todayBkkIso());
    const orders = (typeof loadSalesRecords === "function" ? loadSalesRecords() : (typeof loadOrders === "function" ? loadOrders() : [])) || [];
    const pmap = new Map(PRODUCTS.map(p => [p.sku, p]));
    const costOf = (p) => p ? (p.cost ?? Math.round((Number(p.price) || 0) * 0.6)) : 0;

    const perSku = new Map();
    const revChart = new Array(win.bars).fill(0);
    const ordChart = new Array(win.bars).fill(0);
    const channelMap = new Map();
    let prevRevenue = 0, totalOrders = 0, prevOrders = 0;

    for (const o of orders) {
      if (!o) continue;
      const bi = win.barIndex(o);
      const inCur = bi >= 0 && bi < win.bars;
      const inPrev = win.inPrev(o);

      // (1) order volume — every order counts, with or without line items
      if (inCur) {
        ordChart[bi] += 1;
        totalOrders += 1;
        const ch = (o.channel || "").trim() || "ไม่ระบุ";
        channelMap.set(ch, (channelMap.get(ch) || 0) + 1);
      }
      if (inPrev) prevOrders += 1;

      // (2) per-product revenue/units — only orders that carry line items
      if (!Array.isArray(o.lineItems) || !o.lineItems.length) continue;
      for (const li of o.lineItems) {
        const qty = Number(li && li.qty) || 0;
        if (!qty) continue;
        const p = pmap.get(li.sku);
        // Prefer the price/cost snapshotted at sale time; fall back to current catalog.
        const price = (li && li.price != null) ? (Number(li.price) || 0) : (p ? (Number(p.price) || 0) : 0);
        const unitCost = (li && li.cost != null) ? (Number(li.cost) || 0) : costOf(p);
        if (inPrev) prevRevenue += qty * price;
        if (!inCur) continue;
        let a = perSku.get(li.sku);
        if (!a) { a = { units: 0, revenue: 0, costTotal: 0, series: new Array(win.bars).fill(0) }; perSku.set(li.sku, a); }
        a.units += qty;
        a.revenue += qty * price;
        a.costTotal += qty * unitCost;
        a.series[bi] += qty;
        revChart[bi] += qty * price;
      }
    }

    const rows = PRODUCTS.map(p => {
      const a = perSku.get(p.sku) || { units: 0, revenue: 0, costTotal: 0, series: new Array(win.bars).fill(0) };
      const cost = costOf(p);
      const profit = a.revenue - a.costTotal;
      const margin = a.revenue > 0 ? profit / a.revenue : 0;
      return { ...p, costPrice: cost, series: a.series, units: a.units, revenue: a.revenue, costTotal: a.costTotal, profit, margin };
    }).sort((x, y) => y.revenue - x.revenue);

    const chMeta = (name) => (typeof CHANNEL_LIST !== "undefined" ? CHANNEL_LIST.find(c => c.name === name) : null);
    const channelRows = [...channelMap.entries()]
      .map(([name, count]) => ({ name, count, color: (chMeta(name) || {}).color || "var(--muted)" }))
      .sort((a, b) => b.count - a.count);

    return { data: rows, revChart, ordChart, prevRevenue, totalOrders, prevOrders, channelRows, barLabels: win.labels };
  }, [period, pv]);

  const { data, revChart, ordChart, prevRevenue, totalOrders, prevOrders, channelRows, barLabels } = agg;

  const total = data.reduce((acc, p) => ({
    units: acc.units + p.units,
    revenue: acc.revenue + p.revenue,
    cost: acc.cost + p.costTotal,
    profit: acc.profit + p.profit
  }), { units: 0, revenue: 0, cost: 0, profit: 0 });
  const totalMargin = total.revenue > 0 ? total.profit / total.revenue : 0;
  const revDelta = total.revenue - prevRevenue;
  const revPct = prevRevenue > 0 ? (revDelta / prevRevenue) * 100 : 0;
  const ordDelta = totalOrders - prevOrders;
  const ordPct = prevOrders > 0 ? (ordDelta / prevOrders) * 100 : 0;

  const isRev = metric === "revenue";
  const chart = isRev ? revChart : ordChart;
  const chartMax = Math.max(...chart, 1);

  /* This whole page IS the daily-sales view, so viewSales gates it outright —
     the page id and the capability are independent toggles in the permission
     editor, and granting the page alone must not hand over the money view.
     viewCost additionally controls the cost / profit / margin columns. */
  const showSales = typeof canDo !== "function" || canDo("viewSales");
  const showCost  = typeof canDo !== "function" || canDo("viewCost");
  if (!showSales) {
    return (
      <div className="stack" style={{ gap: 24 }}>
        <div className="page-head">
          <div>
            <h1 className="page-title">วิเคราะห์ยอดขาย</h1>
            <div className="page-sub">ต้องมีสิทธิ์ "ดูยอดขายและรายได้" จึงจะเปิดหน้านี้ได้</div>
          </div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ width: 56, height: 56, borderRadius: 999, background: "var(--warning-soft)", color: "var(--warning)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <Icons.Warn size={26}/>
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>ไม่มีสิทธิ์ดูยอดขายและรายได้</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>ติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์ให้ตำแหน่งของคุณ</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">วิเคราะห์ยอดขาย</h1>
          <div className="page-sub">ภาพรวมรายได้ ต้นทุน และกำไร — แยกตามช่วงเวลาและตามสินค้า</div>
        </div>
        <div className="row">
          <div className="seg">
            <button className={view === "overview" ? "on" : ""} onClick={() => setView("overview")}>ภาพรวม</button>
            <button className={view === "actions" ? "on" : ""} onClick={() => setView("actions")}>ต้องจัดการ</button>
          </div>
          {view === "overview" && <div className="seg">
            {PERIODS.map(p => (
              <button key={p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
            ))}
          </div>}
          {view === "overview" && canDo("exportData") && <button className="btn" onClick={() => { const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; const head = showCost ? "SKU,สินค้า,จำนวนขาย,ยอดขาย,ต้นทุน,กำไร,มาร์จิน%" : "SKU,สินค้า,จำนวนขาย,ยอดขาย"; const rows = data.map(p => (showCost ? [p.sku, p.name, p.units, p.revenue, p.costTotal, p.profit, (p.margin * 100).toFixed(1)] : [p.sku, p.name, p.units, p.revenue]).map(esc).join(",")); const totalRow = (showCost ? ["รวม", "", total.units, total.revenue, total.cost, total.profit, (totalMargin * 100).toFixed(1)] : ["รวม", "", total.units, total.revenue]).map(esc).join(","); const csv = [head, ...rows, totalRow].join("\n"); const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `analytics-${period}.csv`; a.click(); URL.revokeObjectURL(url); }}><Icons.Pkg size={14}/> ส่งออก CSV</button>}
        </div>
      </div>

      {view === "actions" ? <SkuActionBoard showCost={showCost}/> : <>
      {/* KPI cards */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">ออร์เดอร์</div>
          <div className="kpi-value" style={{ marginTop: 4 }}>{fmt(totalOrders)}</div>
          <div className="kpi-delta">
            <span className={ordDelta >= 0 ? "up" : "down"}>{ordDelta >= 0 ? "▲" : "▼"} {prevOrders > 0 ? Math.abs(ordPct).toFixed(0) + "%" : "—"}</span>
            <span>เทียบช่วงก่อน ({fmt(prevOrders)})</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ยอดขาย</div>
          <div className="kpi-value" style={{ marginTop: 4 }}>{fmtMoney(total.revenue)}</div>
          <div className="kpi-delta">
            {total.revenue > 0
              ? <><span className={revDelta >= 0 ? "up" : "down"}>{revDelta >= 0 ? "▲" : "▼"} {Math.abs(revPct).toFixed(1)}%</span><span>เทียบช่วงก่อน</span></>
              : <span style={{ color: "var(--muted)" }}>ยังไม่มีข้อมูลรายสินค้า</span>}
          </div>
        </div>
        {showCost && (
          <div className="kpi">
            <div className="kpi-label">กำไรขั้นต้น</div>
            <div className="kpi-value" style={{ marginTop: 4, color: total.profit > 0 ? "var(--success)" : "var(--fg)" }}>{fmtMoney(total.profit)}</div>
            <div className="kpi-delta">{total.revenue > 0 ? <><span className="up">{(totalMargin*100).toFixed(1)}%</span> มาร์จิ้น</> : <span style={{ color: "var(--muted)" }}>—</span>}</div>
          </div>
        )}
        <div className="kpi">
          <div className="kpi-label">จำนวนชิ้นที่ขาย</div>
          <div className="kpi-value" style={{ marginTop: 4 }}>{fmt(total.units)}</div>
          <div className="kpi-delta">{data.filter(p => p.units > 0).length} SKU มียอดขาย</div>
        </div>
      </div>

      {/* Chart — toggle between order volume (real now) and revenue */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{isRev ? "ยอดขาย" : "จำนวนออร์เดอร์"}ตาม{def.barLabel} · {def.label}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>หน่วย: {isRev ? "บาท" : "ออร์เดอร์"}</div>
          </div>
          <div className="seg">
            <button className={!isRev ? "on" : ""} onClick={() => setMetric("orders")}>ออร์เดอร์</button>
            <button className={isRev ? "on" : ""} onClick={() => setMetric("revenue")}>ยอดขาย</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 200, padding: "0 4px" }}>
          {chart.map((v, i) => {
            const h = (v / chartMax) * 166; // 166px = 200 - 14(label) - 4(gap) - 12(x-label) - 4(gap)
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "IBM Plex Sans, sans-serif", height: 14, opacity: v / chartMax > 0.4 ? 1 : 0 }} className="tnum">
                  {v > 0 ? (isRev ? fmt(v / 1000) + "K" : fmt(v)) : ""}
                </div>
                <div title={isRev ? fmtMoney(v) : `${fmt(v)} ออร์เดอร์`} style={{
                  width: "100%",
                  height: Math.max(2, h) + "px",
                  background: "linear-gradient(180deg, var(--accent), oklch(0.55 0.18 38))",
                  borderRadius: "4px 4px 0 0",
                  transition: "height 0.25s"
                }}/>
                <div style={{ fontSize: 9, color: "var(--muted)", height: 12 }} className="tnum">{barLabels[i] || ""}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Orders by channel (real now) */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>ออร์เดอร์ตามช่องทาง · {def.label}</div>
          <span className="badge badge-neutral">{fmt(totalOrders)} ออร์เดอร์</span>
        </div>
        {channelRows.length === 0
          ? <div style={{ padding: "18px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ยังไม่มีออร์เดอร์ในช่วงนี้</div>
          : <div className="stack" style={{ gap: 10 }}>
              {channelRows.map(c => {
                const pct = totalOrders > 0 ? (c.count / totalOrders) * 100 : 0;
                return (
                  <div key={c.name} className="row" style={{ gap: 12 }}>
                    <span className="row" style={{ gap: 7, width: 150, flexShrink: 0 }}>
                      <ChannelMark channel={c.name} size={16}/>
                      <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    </span>
                    <div className="prog" style={{ flex: 1 }}><span style={{ width: pct + "%" }}/></div>
                    <span className="tnum" style={{ fontSize: 13, fontWeight: 500, width: 36, textAlign: "right" }}>{c.count}</span>
                    <span className="tnum" style={{ fontSize: 11, color: "var(--muted)", width: 40, textAlign: "right" }}>{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>}
      </div>

      {/* Top sellers */}
      <div className="card card-tight">
        <div className="card-head">
          <div>
            <h3>สินค้าขายดี</h3>
            <div className="sub">เรียงตามยอดขายใน{def.label}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge badge-neutral">{data.filter(p => p.units > 0).length} / {data.length} SKU</span>
          </div>
        </div>
        <table className="t">
          <thead><tr>
            <th style={{ width: 36 }}>#</th>
            <th>สินค้า</th>
            <th className="t-num">ขายได้</th>
            {showCost && <th className="t-num">ราคาทุน</th>}
            <th className="t-num">ราคาขาย</th>
            <th className="t-num">ยอดขาย</th>
            {showCost && <th className="t-num">กำไร</th>}
            {showCost && <th className="t-num">มาร์จิ้น</th>}
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {data.map((p, i) => {
              const isOpen = open === p.sku;
              const margin = p.margin * 100;
              const marginTone = margin >= 50 ? "var(--success)" : margin >= 30 ? "var(--info)" : margin >= 15 ? "var(--warning)" : "var(--danger)";
              return (
                <React.Fragment key={p.sku}>
                  <tr style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : p.sku)}>
                    <td style={{ color: "var(--muted)", fontSize: 12, fontWeight: 500 }}>{i + 1}</td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <ProductImageThumb sku={p.sku} size={32} radius={6}/>
                        <div>
                          <div style={{ fontSize: 13 }}>{p.name}</div>
                          <div className="t-mono" style={{ marginTop: 2 }}>{p.sku} · {p.cat}</div>
                        </div>
                      </div>
                    </td>
                    <td className="t-num tnum">{p.units}</td>
                    {showCost && <td className="t-num tnum" style={{ color: "var(--muted)" }}>฿{fmt(p.cost ?? p.price * 0.6)}</td>}
                    <td className="t-num tnum">฿{fmt(p.price)}</td>
                    <td className="t-num tnum" style={{ fontWeight: 500 }}>{fmtMoney(p.revenue)}</td>
                    {showCost && <td className="t-num tnum" style={{ color: "var(--success)" }}>{fmtMoney(p.profit)}</td>}
                    {showCost && <td className="t-num tnum" style={{ color: marginTone, fontWeight: 500 }}>{margin.toFixed(1)}%</td>}
                    <td><Icons.Chev size={14} style={{ color: "var(--muted)", transform: isOpen ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}/></td>
                  </tr>
                  {isOpen && (
                    <tr style={{ background: "var(--surface-2)" }}>
                      <td colSpan="9" style={{ padding: 16 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 20 }}>
                          <div>
                            <div className="eyebrow" style={{ marginBottom: 8 }}>แนวโน้มยอดขาย ({def.barLabel})</div>
                            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
                              {p.series.map((v, j) => {
                                const max = Math.max(...p.series, 1);
                                return (
                                  <div key={j} title={`${v} ชิ้น`} style={{
                                    flex: 1,
                                    height: Math.max(2, (v / max) * 76) + "px",
                                    background: "var(--accent)",
                                    borderRadius: "2px 2px 0 0",
                                    opacity: v === 0 ? 0.15 : 1
                                  }}/>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <div className="eyebrow" style={{ marginBottom: 8 }}>สรุป</div>
                            <div className="grid-3" style={{ gap: 10 }}>
                              <SummaryCell label="ขาย" value={p.units + " ชิ้น"}/>
                              <SummaryCell label="สต็อกเหลือ" value={p.qty + " ชิ้น"}/>
                              {showCost && <SummaryCell label="กำไรต่อชิ้น" value={"฿" + fmt(p.price - (p.cost ?? p.price * 0.6))}/>}
                              <SummaryCell label="ยอดขาย" value={fmtMoney(p.revenue)}/>
                              {showCost && <SummaryCell label="ต้นทุน" value={fmtMoney(p.costTotal)}/>}
                              {showCost && <SummaryCell label="กำไร" value={fmtMoney(p.profit)} accent/>}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}

function SummaryCell({ label, value, accent }) {
  return (
    <div style={{ padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: accent ? "var(--success)" : "var(--fg)" }}>{value}</div>
    </div>
  );
}


/* ============ ต้องจัดการ — per-SKU action board ============ */
const BOARD_WINDOWS = [30, 60, 90];

/* Days of stock left, capped so a 12,000-day cover reads as "> 1 ปี". */
function fmtCover(c) { return !isFinite(c) ? "—" : c > 365 ? "> 1 ปี" : Math.round(c) + " วัน"; }

/* One-line "what to do" for a row; shared with the mobile fork. */
function skuInsightTip(r, showCost) {
  const bits = [];
  if (r.seg === "restock") bits.push(r.qty <= 0 ? "ของหมดแล้ว" : `เหลือพอขาย ~${Math.max(0, Math.round(r.cover))} วัน`, r.reorder > 0 ? `แนะนำสั่ง ${r.reorder} ชิ้น` : "");
  if (r.seg === "rising") bits.push(`ช่วงหลัง ${r.recent} ชิ้น vs ก่อนหน้า ${r.prev} ชิ้น`);
  if ((r.isStar || r.seg === "rising") && r.missingChannels && r.missingChannels.length) bits.push("ยังไม่มียอดบน " + r.missingChannels.join(", "));
  if (r.seg === "slow") bits.push("สต็อกพอขาย " + fmtCover(r.cover));
  if (r.seg === "dead" || r.seg === "slow") {
    if (!r.stored) bits.push("ยังไม่จัดเก็บ — หาของไม่เจอ = ขายไม่ได้");
    if (r.partner) bits.push("จัดชุดคู่กับ " + r.partner.sku);
    if (showCost && r.promoPrice) bits.push(`ลด ${r.discountPct}% → ฿${Math.round(r.promoPrice).toLocaleString("th-TH")}`);
  }
  if (r.seg === "new" && r.firstAge != null) bits.push(`รับเข้า ${r.firstAge} วันก่อน`);
  return bits.filter(Boolean).join(" · ");
}

function skuInsightsCsv(ins, showCost) {
  const segLabel = Object.fromEntries(SKU_SEGMENTS.map(s => [s.id, s.label]));
  const head = ["กลุ่ม", "SKU", "สินค้า", "หมวด", "คงเหลือ", `ขาย ${ins.observed} วัน`, "ขาย/วัน", "พอขาย (วัน)", "ขายล่าสุด (วันก่อน)", "แนะนำสั่ง", "คำแนะนำ"]
    .concat(showCost ? ["ทุนจม", "ราคาโปร"] : []);
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = ins.rows.map(r => [segLabel[r.seg], r.sku, r.name, r.cat, r.qty, r.units, r.perDay.toFixed(2),
    isFinite(r.cover) ? Math.round(r.cover) : "", r.lastSaleAge ?? "", r.reorder || "", skuInsightTip(r, showCost)]
    .concat(showCost ? [r.tiedUp != null ? Math.round(r.tiedUp) : "", r.promoPrice || ""] : []).map(esc).join(","));
  return "﻿" + [head.map(esc).join(","), ...lines].join("\n");
}


/* ── ต้องจัดการ actions (shared by desktop + mobile) ── */
function _insightToast(msg, type) { window.dispatchEvent(new CustomEvent("ims-toast", { detail: type ? { msg, type } : msg })); }
function _saveCsv(rows, filename) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + rows.map(r => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  if (typeof deliverFile === "function") { deliverFile(blob, filename); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
/* Who may create a bundle from the board — bundles are admin/manager writes in RLS. */
function canInsightBundle() {
  const role = window.__currentUser && window.__currentUser.role;
  return role === "admin" || role === "manager";
}
/* "สร้างชุด": slow/dead item + its suggested best-seller partner, priced at 90% of
   the two retail prices (editable). Writes ONE bundle via createBundle. */
async function insightCreateBundle(r) {
  if (!r || !r.partner) return;
  const partner = PRODUCTS.find(p => p.sku === r.partner.sku);
  if (!partner) return;
  const retail = (Number(r.price) || 0) + (Number(partner.price) || 0);
  const ans = await askForm({
    title: "สร้างชุดสินค้า",
    message: `${r.sku} + ${partner.sku} · ราคาปกติรวม ฿${Math.round(retail).toLocaleString("th-TH")}`,
    fields: [
      { key: "name", label: "ชื่อชุด", value: `${partner.name} + ${r.name}` },
      { key: "price", label: "ราคาชุด (บาท)", value: String(Math.round(retail * 0.9)), type: "number" }
    ],
    okLabel: "สร้างชุด"
  });
  if (!ans) return;
  const price = Number(ans.price);
  if (!(price > 0)) { _insightToast("ราคาชุดต้องมากกว่า 0", "error"); return; }
  if (typeof createBundle !== "function") return;
  const res = await createBundle({
    name: ans.name, desc: `จัดชุดระบายสต็อก ${r.sku}`, price,
    items: [{ sku: partner.sku, qty: 1 }, { sku: r.sku, qty: 1 }]
  });
  _insightToast(res.ok ? `สร้างชุด "${ans.name}" แล้ว (${res.bundle.id})` : res.error, res.ok ? undefined : "error");
}
/* Reorder list — the restock group with a suggested quantity. */
function exportReorderList(ins) {
  const rows = ins.rows.filter(r => r.seg === "restock" && r.reorder > 0);
  if (!rows.length) { _insightToast("ไม่มีสินค้าที่ต้องสั่งเพิ่ม"); return; }
  _saveCsv([["SKU", "สินค้า", "คงเหลือ", "ขาย/วัน", "พอขาย (วัน)", "แนะนำสั่ง"]]
    .concat(rows.map(r => [r.sku, r.name, r.qty, r.perDay.toFixed(2), Math.round(r.cover), r.reorder])),
    `reorder-${todayIso()}.csv`);
}
/* Promo list — slow/dead items with a cost-floored discounted price (viewCost only). */
function exportPromoList(ins) {
  const rows = ins.rows.filter(r => (r.seg === "dead" || r.seg === "slow") && r.promoPrice);
  if (!rows.length) { _insightToast("ยังไม่มีสินค้าที่ควรลดราคา"); return; }
  _saveCsv([["SKU", "สินค้า", "คงเหลือ", "ไม่มียอด (วัน)", "ราคาปัจจุบัน", "ลด %", "ราคาโปร"]]
    .concat(rows.map(r => [r.sku, r.name, r.qty, r.idleDays, r.price, r.discountPct, r.promoPrice])),
    `promo-${todayIso()}.csv`);
}

function SkuActionBoard({ showCost }) {
  const [days, setDays] = useStateAn(60);
  const [seg, setSeg] = useStateAn("restock");
  const [q, setQ] = useStateAn("");
  const [showN, setShowN] = useStateAn(60);
  const [pv, setPv] = useStateAn(0);
  useEffectAn(() => {
    const refresh = () => setPv(v => v + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-orders-change", refresh);
    window.addEventListener("ims-sales-change", refresh);
    if (typeof refreshReceiveDates === "function") refreshReceiveDates();
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
      window.removeEventListener("ims-sales-change", refresh);
    };
  }, []);
  const ins = useMemoAn(() => buildSkuInsights({ days }), [days, pv]);
  useEffectAn(() => setShowN(60), [seg, days, q]);

  const needle = q.trim().toLowerCase();
  const list = ins.rows.filter(r => r.seg === seg && (!needle || (r.sku + " " + r.name).toLowerCase().includes(needle)));
  const cur = ins.segs.find(s => s.id === seg) || ins.segs[0];
  const exportCsv = () => {
    const blob = new Blob([skuInsightsCsv(ins, showCost)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sku-actions-${days}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          คิดจากยอดขาย {ins.observed} วันล่าสุด{ins.startIso && ins.observed < days ? ` (มีข้อมูลตั้งแต่ ${ins.startIso})` : ""} · "ไม่มียอดขาย" = ไม่ขายเลยในช่วงนี้
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg">
            {BOARD_WINDOWS.map(d => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} วัน</button>)}
          </div>
          {canDo("exportData") && <button className="btn" onClick={exportCsv}><Icons.Pkg size={14}/> ส่งออก CSV</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {ins.segs.map(s => (
          <button key={s.id} onClick={() => setSeg(s.id)} className="card" style={{
            textAlign: "left", padding: "12px 14px", cursor: "pointer",
            outline: seg === s.id ? "2px solid var(--accent)" : "none", outlineOffset: -2
          }}>
            <div className="row" style={{ gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: `var(--${s.tone === "neutral" ? "muted" : s.tone})` }}/>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{s.label}</span>
            </div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{fmt(s.count)} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>SKU</span></div>
            <div className="tnum" style={{ fontSize: 11, color: "var(--muted)" }}>
              {fmt(s.qty)} ชิ้น{showCost && s.tiedUp > 0 ? ` · ทุน ${fmtMoney(s.tiedUp)}` : ""}
            </div>
          </button>
        ))}
      </div>

      <div className="card card-tight">
        <div className="card-head">
          <div>
            <h3>{cur.label} · {fmt(list.length)} SKU</h3>
            <div className="sub">{cur.action}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {seg === "restock" && canDo("exportData") && <button className="btn" onClick={() => exportReorderList(ins)}><Icons.Pkg size={14}/> รายการสั่งซื้อ</button>}
            {(seg === "dead" || seg === "slow") && showCost && canDo("exportData") && <button className="btn" onClick={() => exportPromoList(ins)}><Icons.Pkg size={14}/> รายการโปร</button>}
            <input className="input" placeholder="ค้นหา SKU / ชื่อ" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }}/>
          </div>
        </div>
        {list.length === 0
          ? <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่มีสินค้าในกลุ่มนี้</div>
          : <table className="t">
              <thead><tr>
                <th>สินค้า</th>
                <th className="t-num">คงเหลือ</th>
                <th className="t-num">ขาย {ins.observed} วัน</th>
                <th className="t-num">พอขาย</th>
                <th className="t-num">ขายล่าสุด</th>
                {showCost && <th className="t-num">ทุนจม</th>}
                <th>ควรทำ</th>
              </tr></thead>
              <tbody>
                {list.slice(0, showN).map(r => (
                  <tr key={r.sku}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <ProductImageThumb sku={r.sku} size={32} radius={6}/>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13 }}>{r.name}</div>
                          <div className="t-mono" style={{ marginTop: 2 }}>{r.sku} · {r.cat}</div>
                        </div>
                      </div>
                    </td>
                    <td className="t-num tnum">{fmt(r.qty)}</td>
                    <td className="t-num tnum">{fmt(r.units)}</td>
                    <td className="t-num tnum">{fmtCover(r.cover)}</td>
                    <td className="t-num tnum" style={{ color: "var(--muted)" }}>{r.lastSaleAge == null ? "ไม่เคย" : r.lastSaleAge === 0 ? "วันนี้" : r.lastSaleAge + " วันก่อน"}</td>
                    {showCost && <td className="t-num tnum">{r.tiedUp != null ? fmtMoney(r.tiedUp) : "—"}</td>}
                    <td style={{ fontSize: 12, maxWidth: 340 }}>
                      {skuInsightTip(r, showCost) || <span style={{ color: "var(--muted)" }}>—</span>}
                      {r.partner && canInsightBundle() && <div style={{ marginTop: 6 }}><button className="btn btn-sm" onClick={() => insightCreateBundle(r)}>สร้างชุดกับ {r.partner.sku}</button></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>}
        {list.length > showN && (
          <div style={{ padding: 12, textAlign: "center" }}>
            <button className="btn" onClick={() => setShowN(n => n + 60)}>ดูเพิ่ม ({fmt(list.length - showN)})</button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { AnalyticsPage, buildAnalyticsWindow, _todayBkkIso, SkuActionBoard, skuInsightTip, skuInsightsCsv, insightCreateBundle, canInsightBundle, exportReorderList, exportPromoList, fmtCover });
