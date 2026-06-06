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
  const [open, setOpen] = useStateAn(null);
  const [metric, setMetric] = useStateAn("orders"); // chart metric: orders (real now) | revenue
  const [pv, setPv] = useStateAn(0); // bumps when the catalog OR orders change → recompute
  const def = PERIODS.find(p => p.id === period);

  // Recompute live when a product is edited (price/cost) OR any order changes.
  useEffectAn(() => {
    const refresh = () => setPv(v => v + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-orders-change", refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
    };
  }, []);

  // Aggregate REAL orders in ONE pass → (1) order VOLUME per bucket + by channel
  // (works today, from every order's real date/time) and (2) per-product
  // revenue/units from lineItems (fills in once sales record full detail).
  // All bucketed in Bangkok-local time. Revenue uses each SKU's current price.
  const agg = useMemoAn(() => {
    const win = buildAnalyticsWindow(period, _todayBkkIso());
    const orders = (typeof loadOrders === "function" ? loadOrders() : []) || [];
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

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">วิเคราะห์ยอดขาย</h1>
          <div className="page-sub">ภาพรวมรายได้ ต้นทุน และกำไร — แยกตามช่วงเวลาและตามสินค้า</div>
        </div>
        <div className="row">
          <div className="seg">
            {PERIODS.map(p => (
              <button key={p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
            ))}
          </div>
          <button className="btn" onClick={() => { const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; const head = "SKU,สินค้า,จำนวนขาย,ยอดขาย,ต้นทุน,กำไร,มาร์จิน%"; const rows = data.map(p => [p.sku, p.name, p.units, p.revenue, p.costTotal, p.profit, (p.margin * 100).toFixed(1)].map(esc).join(",")); const totalRow = ["รวม", "", total.units, total.revenue, total.cost, total.profit, (totalMargin * 100).toFixed(1)].map(esc).join(","); const csv = [head, ...rows, totalRow].join("\n"); const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `analytics-${period}.csv`; a.click(); URL.revokeObjectURL(url); }}><Icons.Pkg size={14}/> ส่งออก CSV</button>
        </div>
      </div>

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
        <div className="kpi">
          <div className="kpi-label">กำไรขั้นต้น</div>
          <div className="kpi-value" style={{ marginTop: 4, color: total.profit > 0 ? "var(--success)" : "var(--fg)" }}>{fmtMoney(total.profit)}</div>
          <div className="kpi-delta">{total.revenue > 0 ? <><span className="up">{(totalMargin*100).toFixed(1)}%</span> มาร์จิ้น</> : <span style={{ color: "var(--muted)" }}>—</span>}</div>
        </div>
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
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color, flexShrink: 0 }}/>
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
            <th className="t-num">ราคาทุน</th>
            <th className="t-num">ราคาขาย</th>
            <th className="t-num">ยอดขาย</th>
            <th className="t-num">กำไร</th>
            <th className="t-num">มาร์จิ้น</th>
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
                    <td className="t-num tnum" style={{ color: "var(--muted)" }}>฿{fmt(p.cost ?? p.price * 0.6)}</td>
                    <td className="t-num tnum">฿{fmt(p.price)}</td>
                    <td className="t-num tnum" style={{ fontWeight: 500 }}>{fmtMoney(p.revenue)}</td>
                    <td className="t-num tnum" style={{ color: "var(--success)" }}>{fmtMoney(p.profit)}</td>
                    <td className="t-num tnum" style={{ color: marginTone, fontWeight: 500 }}>{margin.toFixed(1)}%</td>
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
                              <SummaryCell label="กำไรต่อชิ้น" value={"฿" + fmt(p.price - (p.cost ?? p.price * 0.6))}/>
                              <SummaryCell label="ยอดขาย" value={fmtMoney(p.revenue)}/>
                              <SummaryCell label="ต้นทุน" value={fmtMoney(p.costTotal)}/>
                              <SummaryCell label="กำไร" value={fmtMoney(p.profit)} accent/>
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

Object.assign(window, { AnalyticsPage, buildAnalyticsWindow, _todayBkkIso });
