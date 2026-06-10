/* ============================================================
   MOBILE APP — Full feature parity with desktop, rendered
   inside a phone frame. 5-tab bottom nav with stack history.
   ============================================================ */

const { useState: useStateM, useEffect: useEffectM, useRef: useRefM, useMemo: useMemoM } = React;

function Handheld({ pushToast }) {
  return (
    <div style={{ display: "flex", gap: 60, alignItems: "flex-start", padding: "16px 0 80px", justifyContent: "center" }}>
      <div style={{ maxWidth: 380 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>โหมดมือถือ · Mobile App</div>
        <h1 className="page-title" style={{ marginBottom: 8 }}>มุมมองสำหรับสมาร์ทโฟน</h1>
        <div className="page-sub" style={{ marginBottom: 24, lineHeight: 1.6 }}>
          แอปบนมือถือรองรับ <strong style={{ color: "var(--fg)" }}>ทุกฟีเจอร์</strong> เทียบเท่าเดสก์ท็อป — ปรับแต่งหน้าหลัก สแกนรับเข้า ตัดสต็อกแยกช่องทาง เลือกสินค้าหลายรายการพร้อมแก้ไข พิมพ์ฉลาก นำเข้า SKU และตั้งค่าร้านได้จากเครื่องเดียวกัน
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>เทียบฟีเจอร์</div>
          {[
            "หน้าหลักปรับแต่งวิดเจ็ตได้",
            "สแกนรับเข้าด้วยกล้อง / เครื่องสแกน",
            "ตัดสต็อกแยกตามช่องทาง (Shopee, Lazada, …)",
            "เลือกสินค้าหลายรายการพร้อมกัน + แก้ไขกลุ่ม",
            "สร้างและพิมพ์ฉลากจัดส่ง (PDF)",
            "นำเข้า SKU จาก Excel",
            "ตั้งค่าโลโก้และข้อมูลร้านค้า"
          ].map((f, i) => (
            <div key={i} className="row" style={{ padding: "8px 0", gap: 10, fontSize: 13, borderTop: i ? "1px solid var(--border)" : "none" }}>
              <span style={{ width: 18, height: 18, borderRadius: 999, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icons.Check size={11} stroke={2.4}/>
              </span>
              <span style={{ flex: 1 }}>{f}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>เดสก์ท็อป + มือถือ</span>
            </div>
          ))}
        </div>
      </div>

      <PhoneFrame>
        <MobileApp pushToast={pushToast}/>
      </PhoneFrame>
    </div>
  );
}

function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 360, height: 740,
      background: "#1a1a1a",
      borderRadius: 48,
      padding: 12,
      boxShadow: "0 40px 80px oklch(0.2 0.01 250 / 0.22), 0 12px 24px oklch(0.2 0.01 250 / 0.08), inset 0 0 0 1px oklch(0.4 0.005 250)",
      flexShrink: 0
    }}>
      <div style={{
        width: "100%", height: "100%",
        borderRadius: 36,
        overflow: "hidden",
        position: "relative",
        background: "var(--bg)"
      }}>
        {/* notch */}
        <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", width: 110, height: 28, background: "#1a1a1a", borderRadius: 16, zIndex: 50 }}/>
        {children}
      </div>
    </div>
  );
}

/* =============== MAIN MOBILE APP =============== */

function MobileApp({ pushToast, user, onLogout, onSwitchUser, fullscreen }) {
  const [route, setRouteRaw] = useStateM({ tab: "home", view: null, params: null, history: [] });
  const setRoute = (r) => setRouteRaw(r);
  const switchTab = (tab) => setRoute({ tab, view: null, params: null, history: [] });
  const push = (view, params) => setRoute(r => ({ ...r, history: [...r.history, { view: r.view, params: r.params }], view, params }));
  const back = () => setRoute(r => {
    const h = [...r.history];
    const prev = h.pop() || { view: null, params: null };
    return { ...r, view: prev.view, params: prev.params, history: h };
  });

  const ctx = { route, switchTab, push, back, pushToast, user, onLogout, onSwitchUser, fullscreen };

  return (
    <div className="m-app">
      <StatusBar/>
      <ErrorBoundary key={(route.view || "") + ":" + (route.tab || "")} mobile>
        <Screen ctx={ctx}/>
      </ErrorBoundary>
      <TabBar tab={route.tab} onSwitch={switchTab}/>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="m-statusbar">
      <span>9:41</span>
      <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <span style={{ fontSize: 10 }}>●●●●●</span>
        <span style={{ fontSize: 11 }}>5G</span>
        <span style={{ width: 22, height: 11, border: "1.5px solid currentColor", borderRadius: 2, position: "relative", display: "inline-block" }}>
          <span style={{ position: "absolute", inset: 1.5, width: "70%", background: "currentColor", borderRadius: 1 }}/>
        </span>
      </span>
    </div>
  );
}

function TabBar({ tab, onSwitch }) {
  const tabs = [
    { id: "home",      label: "หน้าหลัก", icon: Icons.Dash },
    { id: "inbound",   label: "รับเข้า",  icon: Icons.In },
    { id: "outbound",  label: "จัดส่ง",   icon: Icons.Out },
    { id: "inventory", label: "สินค้า",   icon: Icons.Box },
    { id: "more",      label: "เพิ่มเติม", icon: Icons.Setting }
  ];
  return (
    <div className="m-tabbar">
      {tabs.map(t => {
        const I = t.icon;
        const on = tab === t.id;
        return (
          <button key={t.id} className={"m-tab" + (on ? " on" : "")} onClick={() => onSwitch(t.id)}>
            <div className="m-tab-icon"><I size={22} stroke={on ? 2 : 1.6}/></div>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* Screen dispatcher */
function Screen({ ctx }) {
  const { route } = ctx;
  // sub-views
  if (route.view === "product")   return <MProductDetail ctx={ctx}/>;
  if (route.view === "issue")     return <MIssue ctx={ctx}/>;
  if (route.view === "sell")      return <MSell ctx={ctx}/>;
  if (route.view === "locations") return <MLocations ctx={ctx}/>;
  if (route.view === "labels")    return <MLabels ctx={ctx}/>;
  if (route.view === "label-view")return <MLabelView ctx={ctx}/>;
  if (route.view === "label-edit")return <MLabelEdit ctx={ctx}/>;
  if (route.view === "tracking")  return <MTracking ctx={ctx}/>;
  if (route.view === "track-edit")return <MTrackEdit ctx={ctx}/>;
  if (route.view === "import")    return <MImport ctx={ctx}/>;
  if (route.view === "catalog")   return <MCatalog ctx={ctx}/>;
  if (route.view === "bundles")   return <MBundles ctx={ctx}/>;
  if (route.view === "analytics") return <MAnalytics ctx={ctx}/>;
  if (route.view === "stocktake") return <MStockTake ctx={ctx}/>;
  if (route.view === "history")   return <MHistory ctx={ctx}/>;
  if (route.view === "users")     return <MUsers ctx={ctx}/>;
  if (route.view === "settings")  return <MSettings ctx={ctx}/>;
  // tabs
  if (route.tab === "home")      return <MHome ctx={ctx}/>;
  if (route.tab === "inbound")   return <MInbound ctx={ctx}/>;
  if (route.tab === "outbound")  return <MOutbound ctx={ctx}/>;
  if (route.tab === "inventory") return <MInventory ctx={ctx}/>;
  if (route.tab === "more")      return <MMore ctx={ctx}/>;
  return null;
}

/* =============== HOME =============== */

function MHome({ ctx }) {
  const totalSkus = PRODUCTS.length;
  const totalQty = PRODUCTS.reduce((s, p) => s + p.qty, 0);
  const lowStock = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder).length;
  const outOfStock = PRODUCTS.filter(p => p.qty === 0).length;
  const pendingOrders = (typeof buildOrders === "function" ? buildOrders() : [])
    .filter(o => o.status === "picking" || o.status === "packed").length;
  const firstName = (ctx.user?.name || "สมชาย").split(" ")[0];
  const [notifOpen, setNotifOpen] = useStateM(false);
  const notifCount = lowStock + outOfStock + pendingOrders;

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">สวัสดี, {firstName}</div>
        <button className="m-action" style={{ position: "relative" }} onClick={() => setNotifOpen(true)}>
          <Icons.Bell size={16}/>
          {notifCount > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 999, background: "var(--danger)" }}/>}
        </button>
      </div>
      <div className="m-content">
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, marginTop: -4 }}>{(() => { const d=new Date(); const days=["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"]; const months=["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"]; return `วัน${days[d.getDay()]}ที่ ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()+543}`; })()}</div>

        {/* KPI grid 2x2 */}
        <div className="m-kpi-row">
          <div className="m-kpi">
            <div className="m-kpi-label">SKU ทั้งหมด</div>
            <div className="m-kpi-value">{totalSkus}</div>
          </div>
          <div className="m-kpi">
            <div className="m-kpi-label">สต็อกรวม</div>
            <div className="m-kpi-value">{totalQty.toLocaleString()}</div>
          </div>
          <div className="m-kpi">
            <div className="m-kpi-label">ออร์เดอร์ค้าง</div>
            <div className="m-kpi-value">{pendingOrders}</div>
          </div>
          <div className="m-kpi" style={{ background: outOfStock + lowStock > 0 ? "var(--danger-soft)" : "var(--surface)" }}>
            <div className="m-kpi-label">ต้องสั่งซื้อ</div>
            <div className="m-kpi-value" style={{ color: "var(--danger)" }}>{lowStock + outOfStock}</div>
          </div>
        </div>

        {/* Channels */}
        <div className="m-card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>ออร์เดอร์ตามช่องทาง</div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>วันนี้ • 295</span>
          </div>
          {CHANNELS.slice(0, 4).map(c => {
            const meta = CHANNEL_LIST.find(x => x.id === c.id) || {};
            return (
              <div key={c.id} style={{ padding: "6px 0" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="row" style={{ gap: 6, fontSize: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.color }}/>
                    {c.name}
                  </span>
                  <span className="tnum" style={{ fontSize: 12, fontWeight: 500 }}>{c.today}</span>
                </div>
                <div className="prog" style={{ height: 4 }}><span style={{ width: c.pct + "%", background: meta.color }}/></div>
              </div>
            );
          })}
        </div>

        {/* Quick actions */}
        <div className="m-section-label" style={{ padding: "8px 4px 8px" }}>ทางลัด</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 14 }}>
          <QuickTile icon={<Icons.Cart size={20}/>} label="ขายสินค้า" color="oklch(0.95 0.05 50)"  fg="oklch(0.5 0.16 40)"  onClick={() => ctx.push("sell")}/>
          <QuickTile icon={<Icons.In size={20}/>}   label="รับเข้า"   color="oklch(0.96 0.04 150)" fg="oklch(0.4 0.13 150)" onClick={() => ctx.switchTab("inbound")}/>
          <QuickTile icon={<Icons.Out size={20}/>}  label="ตัดสต็อก"  color="oklch(0.95 0.04 230)" fg="oklch(0.4 0.13 230)" onClick={() => ctx.push("issue")}/>
          <QuickTile icon={<Icons.Tag size={20}/>}  label="ฉลาก"     color="oklch(0.96 0.03 310)" fg="oklch(0.4 0.13 310)" onClick={() => ctx.push("labels")}/>
        </div>

        {/* Recent activity */}
        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>กิจกรรมล่าสุด</div>
        <div className="m-list">
          {ACTIVITY.slice(0, 5).map((a, i) => (
            <div key={i} className="m-row" style={{ cursor: "default" }}>
              <ActivityDot type={a.type}/>
              <div className="m-row-main">
                <div className="m-row-title" style={{ fontSize: 13, fontWeight: 400 }}>{a.text}</div>
                <div className="m-row-sub">{a.t} · {a.who}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {notifOpen && <MNotifSheet ctx={ctx} onClose={() => setNotifOpen(false)}/>}
    </>
  );
}

/* Mobile notification sheet — mirrors the desktop NotifPopover: low/out-of-stock
   products + pending orders, each tappable to jump to the relevant tab. */
function MNotifSheet({ ctx, onClose }) {
  const outOfStock = PRODUCTS.filter(p => p.qty === 0);
  const lowStock   = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder);
  const pending    = (typeof buildOrders === "function" ? buildOrders() : [])
    .filter(o => o.status === "picking" || o.status === "packed");
  const nothing = !outOfStock.length && !lowStock.length && !pending.length;
  const go = (tab) => { onClose(); ctx.switchTab(tab); };
  const Row = ({ color, title, sub, onClick }) => (
    <button className="m-row" onClick={onClick} style={{ width: "100%", textAlign: "left", background: "none", border: "none", fontFamily: "inherit", cursor: "pointer" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }}/>
      <div className="m-row-main">
        <div className="m-row-title" style={{ fontSize: 13 }}>{title}</div>
        {sub && <div className="m-row-sub">{sub}</div>}
      </div>
      <Icons.Chev size={14} style={{ color: "var(--muted)", flexShrink: 0 }}/>
    </button>
  );
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "80%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>การแจ้งเตือน</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>สต็อกและออร์เดอร์ที่ต้องดำเนินการ</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {nothing && <div style={{ padding: "28px 8px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>✅ ไม่มีการแจ้งเตือนใหม่</div>}
          {outOfStock.length > 0 && <div className="m-section-label" style={{ color: "var(--danger)", padding: "4px 2px" }}>หมดสต็อก ({outOfStock.length})</div>}
          {outOfStock.slice(0, 6).map(p => <Row key={"o" + p.sku} color="var(--danger)" title={p.name} sub={p.sku} onClick={() => go("inventory")}/>)}
          {lowStock.length > 0 && <div className="m-section-label" style={{ color: "var(--warning)", padding: "4px 2px" }}>ใกล้หมด ({lowStock.length})</div>}
          {lowStock.slice(0, 6).map(p => <Row key={"l" + p.sku} color="var(--warning)" title={p.name} sub={p.sku + " · เหลือ " + p.qty} onClick={() => go("inventory")}/>)}
          {pending.length > 0 && <div className="m-section-label" style={{ padding: "4px 2px" }}>ออร์เดอร์ค้าง ({pending.length})</div>}
          {pending.slice(0, 6).map(o => <Row key={"p" + o.id} color="var(--accent)" title={o.customer || o.id} sub={o.id + " · " + (o.status === "picking" ? "กำลังหยิบ" : "พร้อมส่ง")} onClick={() => go("outbound")}/>)}
        </div>
      </div>
    </>
  );
}

function QuickTile({ icon, label, color, fg, onClick }) {
  return (
    <button onClick={onClick} style={{ background: color, border: "1px solid var(--border)", borderRadius: 14, padding: "14px 8px", color: "var(--fg)", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,255,255,0.6)", display: "grid", placeItems: "center", color: fg }}>{icon}</div>
      <span style={{ fontSize: 11, fontWeight: 500 }}>{label}</span>
    </button>
  );
}

/* =============== INBOUND =============== */

function MInbound({ ctx }) {
  // Restore in-progress receiving draft (survives leaving the screen / reload).
  const [received, setReceived] = useStateM(() => typeof loadInboundDraft === "function" ? loadInboundDraft() : []);
  const [scan, setScan] = useStateM("");
  const [flash, setFlash] = useStateM(null);
  const [camOpen, setCamOpen] = useStateM(false);
  const [quickAdd, setQuickAdd] = useStateM(null); // null | { sku }
  const [similar, setSimilar] = useStateM(null); // null | { code, candidates } — near-duplicate prompt
  const [closed, setClosed] = useStateM(false);
  const [grQueue, setGRQueue] = useStateM(() => typeof loadGRQueue === "function" ? loadGRQueue() : []);
  const inputRef = useRefM(null);
  // Persist the receiving draft on every change; clear it once the job is committed.
  useEffectM(() => { if (typeof saveInboundDraft === "function") saveInboundDraft(closed ? [] : received); }, [received, closed]);

  // Active GR = first in-progress or scheduled document in the queue
  const activeGR = grQueue.find(r => r.status !== "received") || grQueue[0] || null;
  const lowStock = PRODUCTS.filter(p => p.qty <= p.reorder);

  const addReceived = (p, qty = 1) => {
    setReceived(prev => {
      const i = prev.findIndex(r => r.sku === p.sku);
      const t = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
      if (i > -1) {
        const next = [...prev]; next[i] = { ...next[i], qty: next[i].qty + qty, t };
        return [next[i], ...next.filter((_, j) => j !== i)];
      }
      return [{ sku: p.sku, name: p.name, qty, loc: p.loc || "", t }, ...prev];
    });
    setFlash(p);
    setTimeout(() => setFlash(null), 1500);
  };

  const submit = (override) => {
    if (closed) return;
    const code = (override ?? scan).trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase());
    setScan("");
    if (!p) {
      // Unknown SKU → exact WooCommerce catalog match prefills the form.
      const hit = typeof wooCatalogLookup === "function" ? wooCatalogLookup(code) : null;
      if (hit) { if (typeof playScanBeep === "function") playScanBeep(); setQuickAdd({ sku: code, prefill: hit }); return; }
      // No exact match → warn on a near-duplicate (brand prefix/typo/separators)
      // so we reuse the existing item instead of forking a duplicate.
      const near = typeof findSimilarSkus === "function" ? findSimilarSkus(code) : [];
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      if (near.length) setSimilar({ code, candidates: near });
      else setQuickAdd({ sku: code });
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    addReceived(p, 1);
  };

  // Near-duplicate prompt → reuse an existing item: receive a stocked SKU now,
  // or open the prefilled quick-add for a catalog-only SKU.
  const useExistingNear = (cand) => {
    setSimilar(null);
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === cand.sku.toLowerCase());
    if (p) { if (typeof playScanBeep === "function") playScanBeep(); addReceived(p, 1); }
    else setQuickAdd({ sku: cand.sku, prefill: cand });
  };

  const closeGR = () => {
    if (received.length === 0) {
      ctx.pushToast("ยังไม่มีรายการที่สแกน");
      return;
    }
    const totalQty = received.reduce((s, r) => s + r.qty, 0);
    if (!confirm(`ยืนยันปิดงานรับเข้า?\nจะเพิ่มสต็อก ${totalQty} ชิ้น ใน ${received.length} SKU เข้าระบบทันที`)) return;
    received.forEach(r => {
      const p = PRODUCTS.find(x => x.sku === r.sku);
      if (!p) return;
      updateProductInStore(r.sku, { qty: p.qty + r.qty });
    });
    if (typeof recordChange === "function") {
      recordChange({
        entity: "inbound", action: "close",
        summary: `ปิดงานรับเข้า (มือถือ) — เพิ่มสต็อก ${received.length} SKU รวม ${totalQty} ชิ้น`,
        changes: received.map(r => ({ label: r.sku, to: `+${r.qty} ชิ้น` }))
      });
    }
    setClosed(true);
    ctx.pushToast(`ปิดงานแล้ว — อัปเดตสต็อก ${received.length} SKU`);
  };

  const total = received.reduce((s, r) => s + r.qty, 0);

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">รับเข้าสินค้า</div>
        {!closed && received.length > 0 && (
          <button className="m-action accent" onClick={closeGR} style={{ fontSize: 11, padding: "0 10px", width: "auto", borderRadius: 10 }}>
            ปิดงาน
          </button>
        )}
      </div>
      <div className="m-content">
        {/* Low-stock alert — same logic as desktop badge */}
        {lowStock.length > 0 && (
          <div style={{ padding: "10px 14px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: 12, marginBottom: 4 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <Icons.Warn size={14} style={{ color: "var(--warning)", flexShrink: 0 }}/>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warning)" }}>
                สต็อกต่ำ {lowStock.length} รายการ — ควรรับเข้าเพิ่ม
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {lowStock.slice(0, 5).map(p => (
                <div key={p.sku} style={{ fontSize: 11, padding: "2px 8px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
                  <span className="mono" style={{ color: "var(--muted)" }}>{p.sku}</span>
                  {" · "}
                  <span style={{ fontWeight: 600, color: p.qty === 0 ? "var(--danger)" : "var(--warning)" }}>
                    {p.qty === 0 ? "หมด" : `${p.qty} ชิ้น`}
                  </span>
                </div>
              ))}
              {lowStock.length > 5 && <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>+{lowStock.length - 5}</span>}
            </div>
          </div>
        )}

        {/* Active GR document — reads from the shared GR queue */}
        <div className="m-card">
          {activeGR ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>เอกสาร</div>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{activeGR.id}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{activeGR.supplier}{activeGR.po ? ` · ${activeGR.po}` : ""}</div>
                </div>
                <span className={`badge ${activeGR.status === "received" ? "badge-success" : activeGR.status === "in-progress" ? "badge-info" : "badge-neutral"}`}>
                  <span className="dot"/>
                  {activeGR.status === "received" ? "รับเข้าแล้ว" : activeGR.status === "in-progress" ? "กำลังนับ" : "รอเข้า"}
                </span>
              </div>
              <div className="prog" style={{ marginTop: 10 }}>
                <span style={{ width: Math.min(100, activeGR.qty > 0 ? total / activeGR.qty * 100 : 0) + "%", background: "var(--success)" }}/>
              </div>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                <span>นับแล้ว <span className="tnum" style={{ color: "var(--fg)", fontWeight: 500 }}>{total}</span> / {activeGR.qty} ชิ้น</span>
                <span>{received.length} SKU</span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "12px 0", color: "var(--muted)", fontSize: 12 }}>
              ไม่มีเอกสารรับเข้าในคิว — เพิ่มได้ที่หน้าเดสก์ท็อป
            </div>
          )}
        </div>

        {/* Camera viewfinder — tap to open real camera scanner */}
        {!closed && <button onClick={() => setCamOpen(true)} style={{ display:"block", width:"100%", background:"#111", borderRadius:16, padding:0, border:"none", cursor:"pointer", marginBottom:12, overflow:"hidden" }}>
          <div style={{ aspectRatio:"16/9", background:"linear-gradient(45deg,#181818,#252525)", borderRadius:16, display:"grid", placeItems:"center", position:"relative" }}>
            <div style={{ position:"absolute", left:16, right:16, height:2, background:"rgba(255,80,80,0.8)", boxShadow:"0 0 8px rgba(255,80,80,0.6)", animation:"scanline 2s ease-in-out infinite" }}/>
            {[
              { top:10, left:10, borderTop:"2.5px solid white", borderLeft:"2.5px solid white", borderRadius:"3px 0 0 0" },
              { top:10, right:10, borderTop:"2.5px solid white", borderRight:"2.5px solid white", borderRadius:"0 3px 0 0" },
              { bottom:10, left:10, borderBottom:"2.5px solid white", borderLeft:"2.5px solid white", borderRadius:"0 0 0 3px" },
              { bottom:10, right:10, borderBottom:"2.5px solid white", borderRight:"2.5px solid white", borderRadius:"0 0 3px 0" }
            ].map((s, i) => <div key={i} style={{ position:"absolute", width:24, height:24, ...s }}/>)}
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
              <Icons.Camera size={32} style={{ color:"rgba(255,255,255,0.5)" }}/>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:12, fontWeight:500 }}>แตะเพื่อสแกนบาร์โค้ด</div>
            </div>
          </div>
        </button>}
        {camOpen && <CameraScanner continuous onScan={code => { submit(code); }} onClose={() => setCamOpen(false)}/>}
        {similar && (
          <ScanSimilarModal
            mobile
            code={similar.code}
            candidates={similar.candidates}
            onUseExisting={useExistingNear}
            onCreateNew={() => { setSimilar(null); setQuickAdd({ sku: similar.code }); }}
            onClose={() => setSimilar(null)}
          />
        )}
        {quickAdd && (
          <QuickAddInboundModal
            mobile
            sku={quickAdd.sku}
            prefill={quickAdd.prefill}
            onClose={() => setQuickAdd(null)}
            onConfirm={(product, qty) => {
              addProductToStore(product);
              addReceived(product, qty);
              if (typeof recordChange === "function") {
                recordChange({
                  entity: "product", action: "add",
                  summary: `เพิ่มสินค้าใหม่ ${product.sku} — ${product.name} (สร้างจากการสแกนรับเข้า)`,
                });
              }
              setQuickAdd(null);
            }}
          />
        )}

        {closed ? (
          <div style={{ padding: "12px 14px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 14, fontSize: 13, fontWeight: 500, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.Check size={16}/>
            <div>
              <div>ปิดงานแล้ว — อัปเดตสต็อก {received.length} SKU</div>
              <div style={{ fontSize: 11, fontWeight: 400, color: "var(--success)", opacity: 0.8, marginTop: 2 }}>ตรวจสอบยอดได้ที่แท็บ สินค้า</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input
                ref={inputRef}
                className="m-input mono"
                style={{ fontFamily: "IBM Plex Mono, monospace", flex: 1 }}
                value={scan}
                onChange={e => setScan(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") submit(); }}
                placeholder="พิมพ์ SKU แล้วกด Enter"
              />
              <button className="m-action accent" style={{ width: 44, height: 44 }} onClick={() => submit()}>
                <Icons.Plus size={18}/>
              </button>
            </div>
            <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>ทดลอง:</span>
              {PRODUCTS.slice(0, 3).map(p => (
                <button key={p.sku} className="m-chip" onClick={() => submit(p.sku)}>
                  <span className="mono" style={{ fontSize: 10 }}>{p.sku}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {flash && (
          <div style={{ padding: "10px 12px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 12, fontSize: 12, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.Check size={14}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 10 }}>{flash.sku}</div>
              <div style={{ fontSize: 12, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{flash.name}</div>
            </div>
          </div>
        )}

        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>นับแล้ว · {received.length} SKU</div>
        <div className="m-list">
          {received.map((r, i) => (
            <div key={i} className="m-row" style={{ cursor: "default" }}>
              <div className="m-row-thumb mono" style={{ fontSize: 10, fontWeight: 600 }}>{r.sku.slice(-3)}</div>
              <div className="m-row-main">
                <div className="m-row-title">{r.name}</div>
                <div className="m-row-sub mono">{r.sku} · {r.loc} · {r.t}</div>
              </div>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 15 }}>×{r.qty}</div>
            </div>
          ))}
          {received.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>สแกนบาร์โค้ดหรือพิมพ์ SKU เพื่อเริ่มนับ</div>}
        </div>

        {!closed && received.length > 0 && (
          <button className="m-btn-big dark" style={{ marginTop: 16 }} onClick={closeGR}>
            <Icons.Check size={16}/> ปิดงานรับเข้า — เพิ่มสต็อก {total} ชิ้น
          </button>
        )}
      </div>

      <style>{`@keyframes scanline { 0%, 100% { top: 14%; } 50% { top: 86%; } }`}</style>
    </>
  );
}

/* =============== OUTBOUND =============== */

function MOutbound({ ctx }) {
  const tabs = ["ทั้งหมด", "รอหยิบ", "พร้อมส่ง", "ส่งแล้ว"];
  const [tab, setTab] = useStateM(0);
  // Single source of truth shared with ติดตามพัสดุ: labels-as-shipments + overrides.
  const orders = useOrders();
  const [selecting, setSelecting] = useStateM(false);
  const [selected, setSelected] = useStateM({});
  const [bulkMenu, setBulkMenu] = useStateM(null);

  const filtered = tab === 0 ? orders :
    tab === 1 ? orders.filter(o => o.status === "picking") :
    tab === 2 ? orders.filter(o => o.status === "packed") :
    orders.filter(o => o.status === "shipped");

  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;
  const toggle = (id) => setSelected(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const clear = () => { setSelected({}); setSelecting(false); setBulkMenu(null); };

  // Open the shipping label that backs this order so it can be viewed / saved as PDF.
  // labelToOrder ids: soId unless it's a "ฉลากใหม่ N" placeholder, then the label id.
  const openLabel = (o) => {
    const labels = (typeof loadLabels === "function") ? loadLabels() : [];
    const idFor = (x) => (x.soId && !/^ฉลากใหม่/.test(x.soId)) ? x.soId : x.id;
    const lbl = labels.find(x => idFor(x) === o.id);
    if (lbl) ctx.push("label-view", lbl);
    else ctx.push("labels");
  };

  const bulkStatus = (status) => {
    if (typeof setOrderField === "function") selectedIds.forEach(id => setOrderField(id, { status }));
    ctx.pushToast(`อัปเดต ${selectedCount} ออร์เดอร์`);
    clear();
  };
  const bulkDelete = async () => {
    if (!confirm(`ลบ ${selectedCount} ออร์เดอร์ที่เลือก?`)) return;
    if (typeof deleteOrdersFromDb === "function") {
      const res = await deleteOrdersFromDb(selectedIds);
      if (res.blocked) { ctx.pushToast("ลบไม่ได้ — เฉพาะแอดมิน/ผู้จัดการเท่านั้น"); return; }
    }
    if (typeof setOrderField === "function") selectedIds.forEach(id => setOrderField(id, { deleted: true }));
    ctx.pushToast(`ลบ ${selectedCount} ออร์เดอร์`);
    clear();
  };

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">จัดส่งสินค้า</div>
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)}>
          {selecting ? <Icons.X size={16}/> : <Icons.Check size={16}/>}
        </button>
        {!selecting && <button className="m-action accent" onClick={() => ctx.push("sell")}><Icons.Cart size={18}/></button>}
      </div>
      <div className="m-content">
        {!selecting && (
          <div className="m-card">
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginBottom: 8 }}>ตามช่องทาง วันนี้</div>
            <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "0 -14px", padding: "0 14px", scrollbarWidth: "none" }}>
              {CHANNELS.map(c => {
                const meta = CHANNEL_LIST.find(x => x.id === c.id) || {};
                return (
                  <div key={c.id} style={{ flexShrink: 0, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)", minWidth: 96 }}>
                    <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.color }}/>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>{c.name}</span>
                    </div>
                    <div className="tnum" style={{ fontSize: 20, fontWeight: 600 }}>{c.today}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
          {tabs.map((t, i) => (
            <button key={t} className={"m-chip" + (tab === i ? " on" : "")} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>

        {selecting && (
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, padding: "0 4px" }}>
            แตะเพื่อเลือกออร์เดอร์ที่ต้องการแก้ไข
          </div>
        )}

        {(() => {
          const isUnnamed = (o) => { const c = (o.customer || "").trim(); return !c || c === "ไม่ระบุชื่อ"; };
          const byNewest = (a, b) => ((b.dateIso || "") + " " + (b.ts || "")).localeCompare((a.dateIso || "") + " " + (a.ts || ""));
          const named = filtered.filter(o => !isUnnamed(o)).sort(byNewest);
          const unnamed = filtered.filter(isUnnamed).sort(byNewest);
          const renderRow = (o) => {
            const chMeta = CHANNEL_LIST.find(c => c.name === o.channel);
            const stCls = o.status === "shipped" ? "badge-success" : o.status === "packed" ? "badge-info" : "badge-warning";
            const stLab = o.status === "shipped" ? "ส่งแล้ว" : o.status === "packed" ? "พร้อมส่ง" : "กำลังหยิบ";
            const isSelected = !!selected[o.id];
            const when = [o.date || o.dateIso || "", o.ts || ""].filter(Boolean).join(" · ");
            return (
              <button key={o.id} className={"m-row" + (isSelected ? " selected" : "")} onClick={() => selecting ? toggle(o.id) : openLabel(o)}>
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                <div className="m-row-thumb" style={{ background: chMeta?.color || "var(--surface-2)", color: chMeta?.color ? "white" : "var(--fg-2)", fontSize: 11, fontWeight: 600 }}>{chMeta?.short || (o.channel || "?").slice(0,2)}</div>
                <div className="m-row-main">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{o.id}</span>
                    <span className={"badge " + stCls} style={{ fontSize: 10 }}><span className="dot"/>{stLab}</span>
                  </div>
                  <div className="m-row-sub">{(o.customer || "").trim() || "ไม่ระบุชื่อ"} · {o.items} รายการ{o.carrier ? " · " + o.carrier : ""}</div>
                  {when && <div className="m-row-sub" style={{ fontSize: 11, color: "var(--faint)", marginTop: 1 }}>{when}</div>}
                </div>
              </button>
            );
          };
          if (!filtered.length) return <div className="m-list"><div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่มีออร์เดอร์</div></div>;
          return (
            <>
              {named.length > 0 && (<>
                {unnamed.length > 0 && <div className="m-section-label" style={{ padding: "0 4px 6px" }}>มีชื่อผู้รับ ({named.length})</div>}
                <div className="m-list">{named.map(renderRow)}</div>
              </>)}
              {unnamed.length > 0 && (<>
                <div className="m-section-label" style={{ padding: "12px 4px 6px" }}>ฉลากไม่ระบุชื่อ ({unnamed.length})</div>
                <div className="m-list">{unnamed.map(renderRow)}</div>
              </>)}
            </>
          );
        })()}
      </div>

      {selecting && selectedCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selectedCount}</span>
          <span style={{ fontSize: 12, flex: 1 }}>เลือก {selectedCount} ออร์เดอร์</span>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkMenu(bulkMenu === "status" ? null : "status")}><Icons.Truck size={14}/></button>
          <button className="m-action" style={{ background: "rgba(90,180,255,0.3)", color: "white", width: 36, height: 36 }} onClick={() => { ctx.push("labels"); }}><Icons.Tag size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={bulkDelete}><Icons.Trash size={14}/></button>
          {bulkMenu === "status" && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 8px)", right: 12,
              background: "var(--surface)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 12,
              boxShadow: "var(--shadow-lg)", padding: 6, minWidth: 180, zIndex: 30
            }}>
              <div style={{ padding: "6px 10px 4px", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>เปลี่ยนสถานะเป็น</div>
              {[
                { id: "picking", label: "กำลังหยิบ" },
                { id: "packed",  label: "พร้อมส่ง" },
                { id: "shipped", label: "ส่งแล้ว" }
              ].map(s => (
                <button key={s.id} className="popover-item" onClick={() => bulkStatus(s.id)}>
                  <span style={{ flex: 1 }}>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* =============== INVENTORY =============== */

function MInventory({ ctx }) {
  const [q, setQ] = useStateM("");
  const [cat, setCat] = useStateM("ทั้งหมด");
  const [statusFilter, setStatusFilter] = useStateM("all"); // all | ok | low | out
  const [selecting, setSelecting] = useStateM(false);
  const [selected, setSelected] = useStateM({});
  const [bulkOpen, setBulkOpen] = useStateM(false);
  const [addOpen, setAddOpen] = useStateM(false);
  const [stockKey, setStockKey] = useStateM(0);

  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-stock-adj-change", refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-stock-adj-change", refresh);
    };
  }, []);

  const products = useMemoM(() => {
    const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
    return PRODUCTS.map(p => ({ ...p, qty: Math.max(0, p.qty + (adj[p.sku] || 0)) }));
  }, [stockKey]);

  const cats = useMemoM(() => ["ทั้งหมด", ...(typeof loadCategories === "function" ? loadCategories() : [...new Set(products.map(p => p.cat))])], [products]);
  const filtered = products.filter(p => {
    if (cat !== "ทั้งหมด" && p.cat !== cat) return false;
    if (statusFilter !== "all" && stockStatus(p).key !== statusFilter) return false;
    if (q && !(p.sku.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  const STATUS_TABS = [
    { id: "all", label: "ทุกสถานะ" },
    { id: "ok",  label: "พร้อมขาย" },
    { id: "low", label: "ต่ำ" },
    { id: "out", label: "หมด" }
  ];

  const selectedSkus = Object.keys(selected).filter(s => selected[s]);
  const selectedCount = selectedSkus.length;
  const toggleSku = (sku) => setSelected(s => { const n = { ...s }; if (n[sku]) delete n[sku]; else n[sku] = true; return n; });
  const clear = () => { setSelected({}); setSelecting(false); };

  const applyBulk = (changes) => {
    updateManyProducts(selectedSkus, changes);
    ctx.pushToast(`อัปเดต ${selectedCount} รายการ`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", action: "bulk-update",
        summary: `แก้ไข ${selectedCount} SKU พร้อมกัน (มือถือ)`,
        count: selectedCount,
        changes: Object.entries(changes).map(([k, v]) => ({ label: k, to: String(v) }))
      });
    }
    setBulkOpen(false);
  };

  const addProduct = (p) => {
    addProductToStore({ ...p, reserved: 0 });
    ctx.pushToast(`เพิ่ม SKU ${p.sku} แล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: p.sku, action: "create",
        summary: `เพิ่มสินค้าใหม่ ${p.name} (${p.sku}) (มือถือ)`,
        changes: [{ label: "จำนวนเริ่มต้น", to: String(p.qty) }, { label: "ตำแหน่ง", to: p.loc }]
      });
    }
    setAddOpen(false);
  };

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">สินค้าคงคลัง</div>
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)}>
          {selecting ? <Icons.X size={16}/> : <Icons.Check size={16}/>}
        </button>
        {!selecting && <button className="m-action accent" onClick={() => setAddOpen(true)}><Icons.Plus size={18}/></button>}
      </div>
      <div className="m-content">
        <div className="m-search">
          <Icons.Search size={14}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา SKU, ชื่อสินค้า, ผู้จัดส่ง"/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>

        <div className="m-chips-scroll" style={{ marginBottom: 8 }}>
          {cats.map(c => (
            <button key={c} className={"m-chip" + (cat === c ? " on" : "")} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>

        {/* Stock-status filter (mirrors desktop): พร้อมขาย / ต่ำ / หมด */}
        <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
          {STATUS_TABS.map(s => {
            const dot = s.id === "ok" ? "var(--success)" : s.id === "low" ? "var(--warning)" : s.id === "out" ? "var(--danger)" : null;
            return (
              <button key={s.id} className={"m-chip" + (statusFilter === s.id ? " on" : "")} onClick={() => setStatusFilter(s.id)}>
                {dot && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: dot, marginRight: 5, verticalAlign: "middle" }}/>}
                {s.label}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, padding: "0 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{filtered.length} จาก {products.length} รายการ{selecting && <span> · แตะเพื่อเลือก</span>}</span>
          {(cat !== "ทั้งหมด" || statusFilter !== "all" || q) && (
            <button onClick={() => { setCat("ทั้งหมด"); setStatusFilter("all"); setQ(""); }}
              style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}>ล้างตัวกรอง</button>
          )}
        </div>

        <div className="m-list">
          {filtered.map(p => {
            const s = stockStatus(p);
            const isSelected = !!selected[p.sku];
            return (
              <button
                key={p.sku}
                className={"m-row" + (isSelected ? " selected" : "")}
                onClick={() => selecting ? toggleSku(p.sku) : ctx.push("product", p)}
              >
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                <ProductImageThumb sku={p.sku} size={40} radius={8}/>
                <div className="m-row-main">
                  <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                    <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>{s.label}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="tnum" style={{ fontSize: 15, fontWeight: 600 }}>{p.qty}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>คงเหลือ</div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
              <div>ไม่พบสินค้า</div>
            </div>
          )}
        </div>
      </div>

      {selecting && selectedCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selectedCount}</span>
          <span style={{ fontSize: 12, flex: 1 }}>เลือก {selectedCount} รายการ</span>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkOpen(true)}><Icons.Edit size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => ctx.pushToast("เพิ่มเข้าคิวพิมพ์บาร์โค้ด")}><Icons.Print size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={async () => { if (!confirm(`ลบ ${selectedCount} รายการ?`)) return; const rm = [...selectedSkus]; clear(); const res = await removeProductsFromStore(rm); if (res && res.ok === false) { ctx.pushToast(res.error); return; } ctx.pushToast(`ลบ ${rm.length} รายการ`); }}><Icons.Trash size={14}/></button>
        </div>
      )}

      {bulkOpen && (
        <MBulkEdit count={selectedCount} categories={cats.filter(c => c !== "ทั้งหมด")} products={products} onClose={() => setBulkOpen(false)} onApply={applyBulk}/>
      )}
      {addOpen && (
        <MAddSku categories={cats.filter(c => c !== "ทั้งหมด")} products={products} onClose={() => setAddOpen(false)} onAdd={addProduct}/>
      )}
    </>
  );
}

/* Mobile Add-SKU bottom sheet (also used for editing when `editing` product is passed) */
function MAddSku({ categories, products, onClose, onAdd, editing }) {
  const suppliers = useMemoM(() => [...new Set(products.map(p => p.supplier))].filter(Boolean), [products]);
  const brands    = useMemoM(() => [...new Set(products.map(p => p.brand))].filter(Boolean), [products]);
  const [f, setF] = useStateM(() => editing ? {
    sku: editing.sku, name: editing.name, cat: editing.cat, brand: editing.brand || "", supplier: editing.supplier || "",
    cost: String(editing.cost ?? ""), price: String(editing.price ?? ""),
    qty: String(editing.qty ?? ""), reorder: String(editing.reorder ?? "50"), loc: editing.loc
  } : {
    sku: "", name: "", cat: categories[0] || "", brand: "", supplier: "",
    cost: "", price: "", qty: "", reorder: "50", loc: ""
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const [pickedImage, setPickedImage] = useStateM("");
  // Picked a stock/catalog match from the name search → auto-fill the rest.
  const pickCandidate = (c) => {
    setF(prev => ({
      ...prev,
      name:  c.name || prev.name,
      sku:   c.sku || prev.sku,
      cat:   c.cat || prev.cat,
      brand: c.brand || prev.brand || (typeof guessBrandFromSku === "function" ? guessBrandFromSku(c.sku) : ""),
      price: c.price ? String(c.price) : prev.price,
      cost:  prev.cost || (c.price ? String(Math.round(c.price * 0.6)) : prev.cost)
    }));
    setPickedImage(c.image || "");
  };
  const skuTrim = f.sku.trim().toUpperCase();
  const dupe = !editing && skuTrim && products.some(p => p.sku.toUpperCase() === skuTrim);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const cost = num(f.cost), price = num(f.price), qty = num(f.qty), reorder = num(f.reorder);
  const canSave = skuTrim && !dupe && f.name.trim() &&
    cost !== null && price !== null && qty !== null && reorder !== null;

  const save = () => {
    if (!canSave) return;
    const catVal = (f.cat || "ทั่วไป").trim();
    // Register a brand-new category typed here so it persists + syncs.
    if (typeof addCategory === "function") { try { addCategory(catVal); } catch (e) {} }
    // Carry over the picked stock/catalog image so the new product shows it.
    if (!editing && pickedImage && typeof setProductImage === "function") {
      try { setProductImage(skuTrim, pickedImage); } catch (e) {}
    }
    onAdd({
      sku: skuTrim, name: f.name.trim(), cat: catVal,
      brand: (f.brand || "").trim(),
      supplier: (f.supplier || "").trim(), cost, price,
      qty: Math.round(qty), reorder: Math.round(reorder),
      loc: f.loc.trim()
    });
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "88%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>{editing ? "แก้ไขสินค้า" : "เพิ่ม SKU ใหม่"}</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>กรอกข้อมูลสินค้าเพื่อบันทึกเข้าคลัง</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>รหัส SKU *</div>
            <input className="m-input mono" value={f.sku} disabled={!!editing} onChange={e => { const v = e.target.value; setF(prev => ({ ...prev, sku: v, brand: prev.brand || (typeof guessBrandFromSku === "function" ? guessBrandFromSku(v) : "") })); }} placeholder="เช่น TH-APP-003" style={{ textTransform: "uppercase", opacity: editing ? 0.6 : 1 }}/>
            {dupe && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>SKU นี้มีอยู่แล้ว</div>}
          </div>
          <div>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", padding: "0 2px 4px" }}>
              <div className="m-section-label" style={{ padding: 0 }}>ชื่อสินค้า *</div>
              {typeof OcrNameButton === "function" && <OcrNameButton mobile onResult={r => set("name", r.name)}/>}
            </div>
            {!editing && typeof ProductNameSearchField === "function"
              ? <ProductNameSearchField mobile value={f.name} onChange={v => set("name", v)} onPick={pickCandidate}
                  placeholder="พิมพ์ชื่อเพื่อค้นหาจากคลัง/แคตตาล็อก…"/>
              : <input className="m-input" value={f.name} onChange={e => set("name", e.target.value)} placeholder="ชื่อสินค้า"/>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>หมวดหมู่</div>
              <input className="m-input" value={f.cat} onChange={e => set("cat", e.target.value)} placeholder="หมวดหมู่" list="m-cats"/>
              <datalist id="m-cats">{categories.map(c => <option key={c} value={c}/>)}</datalist>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ผู้จัดส่ง</div>
              <input className="m-input" value={f.supplier} onChange={e => set("supplier", e.target.value)} placeholder="ผู้จัดส่ง" list="m-sups"/>
              <datalist id="m-sups">{suppliers.map(s => <option key={s} value={s}/>)}</datalist>
            </div>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>แบรนด์</div>
            <input className="m-input" value={f.brand} onChange={e => set("brand", e.target.value)} placeholder="แบรนด์ (เช่น 5.11)" list="m-brands"/>
            <datalist id="m-brands">{brands.map(b => <option key={b} value={b}/>)}</datalist>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ต้นทุน (฿) *</div>
              <input className="m-input" type="number" min="0" value={f.cost} onChange={e => set("cost", e.target.value)} placeholder="0"/>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ราคาขาย (฿) *</div>
              <input className="m-input" type="number" min="0" value={f.price} onChange={e => set("price", e.target.value)} placeholder="0"/>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>จำนวน *</div>
              <input className="m-input" type="number" min="0" value={f.qty} disabled={!!editing} onChange={e => set("qty", e.target.value)} placeholder="0" style={{ opacity: editing ? 0.6 : 1 }}/>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>จุดสั่งซื้อ</div>
              <input className="m-input" type="number" min="0" value={f.reorder} onChange={e => set("reorder", e.target.value)}
                list="m-reorder-presets" placeholder="พิมพ์เอง หรือเลือก"/>
              <datalist id="m-reorder-presets">
                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(n => <option key={n} value={n}/>)}
              </datalist>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ตำแหน่ง</div>
              <input className="m-input" value={f.loc} onChange={e => set("loc", e.target.value)} list="m-loc-positions" placeholder="เลือกตำแหน่ง (ไม่บังคับ)"/>
              <datalist id="m-loc-positions">
                {(typeof allLocationCodes === "function" ? allLocationCodes() : []).map(c => <option key={c} value={c}/>)}
              </datalist>
            </div>
          </div>
          {editing && <div style={{ fontSize: 11, color: "var(--muted)" }}>หมายเหตุ: รหัส SKU และจำนวนคงเหลือแก้ไขที่นี่ไม่ได้ — ใช้ "ปรับสต็อก" สำหรับจำนวน</div>}
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn-big" onClick={save} disabled={!canSave} style={!canSave ? { opacity: 0.5 } : {}}>
            <Icons.Check size={16}/> {editing ? "บันทึกการแก้ไข" : "เพิ่ม SKU"}
          </button>
        </div>
      </div>
    </>
  );
}

function MBulkEdit({ count, categories, products, onClose, onApply }) {
  const [enabled, setEnabled] = useStateM({ cat: false, loc: false, supplier: false, reorder: false });
  const [vals, setVals] = useStateM({ cat: categories[0] || "", loc: "", supplier: "", reorder: 50 });
  const suppliers = useMemoM(() => [...new Set(products.map(p => p.supplier))], [products]);
  const has = Object.values(enabled).some(Boolean);
  const apply = () => {
    const c = {};
    if (enabled.cat) c.cat = vals.cat;
    if (enabled.loc) c.loc = vals.loc;
    if (enabled.supplier) c.supplier = vals.supplier;
    if (enabled.reorder) c.reorder = parseInt(vals.reorder) || 0;
    onApply(c);
  };
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet">
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>แก้ไข {count} รายการ</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>เปิดสวิตช์เฉพาะฟิลด์ที่ต้องการเปลี่ยน</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body">
          <BulkField label="หมวดหมู่" on={enabled.cat} onToggle={() => setEnabled(e => ({...e, cat: !e.cat}))} hint="">
            <select className="m-input" value={vals.cat} onChange={e => setVals(v => ({...v, cat: e.target.value}))}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </BulkField>
          <BulkField label="ตำแหน่งจัดเก็บ" on={enabled.loc} onToggle={() => setEnabled(e => ({...e, loc: !e.loc}))} hint="">
            <input className="m-input" placeholder="เลือกตำแหน่ง" value={vals.loc} onChange={e => setVals(v => ({...v, loc: e.target.value}))} list="m-loc-positions-bulk"/>
            <datalist id="m-loc-positions-bulk">
              {(typeof allLocationCodes === "function" ? allLocationCodes() : []).map(c => <option key={c} value={c}/>)}
            </datalist>
          </BulkField>
          <BulkField label="ผู้จัดส่ง" on={enabled.supplier} onToggle={() => setEnabled(e => ({...e, supplier: !e.supplier}))} hint="">
            <select className="m-input" value={vals.supplier || suppliers[0]} onChange={e => setVals(v => ({...v, supplier: e.target.value}))}>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </BulkField>
          <BulkField label="จุดสั่งซื้อใหม่" on={enabled.reorder} onToggle={() => setEnabled(e => ({...e, reorder: !e.reorder}))} hint="">
            <input className="m-input" type="number" value={vals.reorder} onChange={e => setVals(v => ({...v, reorder: e.target.value}))}/>
          </BulkField>
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn-big" onClick={apply} disabled={!has}>
            <Icons.Check size={16}/> บันทึก {count} รายการ
          </button>
        </div>
      </div>
    </>
  );
}

/* =============== PRODUCT DETAIL =============== */

function MProductDetail({ ctx }) {
  const [stockKey, setStockKey] = useStateM(0);
  const [editOpen, setEditOpen] = useStateM(false);
  const [adjOpen, setAdjOpen] = useStateM(false);
  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-stock-adj-change", refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-stock-adj-change", refresh);
    };
  }, []);

  const base = PRODUCTS.find(x => x.sku === ctx.route.params?.sku) || ctx.route.params;
  if (!base) { ctx.back(); return null; }
  const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
  const p = { ...base, qty: Math.max(0, base.qty + (adj[base.sku] || 0)) };
  const s = stockStatus(p);
  const channels = (typeof channelSalesFor === "function") ? channelSalesFor(p.sku) : [];
  const cats = typeof loadCategories === "function" ? loadCategories() : [...new Set(PRODUCTS.map(x => x.cat))];

  const doEdit = (changes) => {
    updateProductInStore(p.sku, changes);
    ctx.pushToast(`บันทึกการแก้ไข ${p.sku} แล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: p.sku, action: "update",
        summary: `แก้ไขข้อมูลสินค้า ${changes.name || p.name} (${p.sku}) (มือถือ)`,
        changes: Object.entries(changes).map(([k, v]) => ({ label: k, to: String(v) }))
      });
    }
    setEditOpen(false);
  };
  const doAdjust = (delta, reason) => {
    updateProductInStore(p.sku, { qty: Math.max(0, p.qty + delta) });
    try {
      const a = JSON.parse(localStorage.getItem("ims_stock_adj") || "{}");
      delete a[p.sku];
      localStorage.setItem("ims_stock_adj", JSON.stringify(a));
    } catch (e) {}
    ctx.pushToast(`ปรับสต็อก ${p.sku} ${delta > 0 ? "+" : ""}${delta} ชิ้น`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: p.sku, action: "update",
        summary: `ปรับสต็อก ${p.name} (${p.sku}) ${delta > 0 ? "+" : ""}${delta} ชิ้น (มือถือ)`,
        changes: [{ label: "ปรับจำนวน", to: `${delta > 0 ? "+" : ""}${delta} ชิ้น` }],
        note: reason || ""
      });
    }
    setAdjOpen(false);
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub" style={{ fontSize: 14 }}>{p.sku}</div>
        <button className="m-action" onClick={() => setEditOpen(true)}><Icons.Edit size={14}/></button>
      </div>
      <div className="m-content">
        <div style={{ marginBottom: 14, padding: "4px 4px 0" }}>
          <ProductImageUpload sku={p.sku} productName={p.name} pushToast={ctx.pushToast} size="lg"/>
        </div>
        <div style={{ marginBottom: 16, padding: "4px 4px" }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}>{p.name}</div>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <span className="badge badge-neutral">{p.cat}</span>
            <span className={"badge " + s.cls}><span className="dot"/>{s.label}</span>
          </div>
        </div>

        <div className="m-card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, textAlign: "center" }}>
            <div>
              <div className="tnum" style={{ fontSize: 24, fontWeight: 600 }}>{p.qty}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>คงเหลือ</div>
            </div>
            <div style={{ borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}>
              <div className="tnum" style={{ fontSize: 24, fontWeight: 600, color: "var(--muted)" }}>{p.reserved}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>จอง</div>
            </div>
            <div>
              <div className="tnum" style={{ fontSize: 24, fontWeight: 600, color: "var(--success)" }}>{p.qty - p.reserved}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>พร้อมขาย</div>
            </div>
          </div>
          <div className="prog" style={{ marginTop: 12 }}>
            <span style={{ width: Math.min(100, p.qty/(p.reorder*3)*100) + "%", background: s.key === "out" ? "var(--danger)" : s.key === "low" ? "var(--warning)" : "var(--success)" }}/>
          </div>
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>ข้อมูล</div>
        <div className="m-list">
          <MetaRow label="SKU" value={p.sku} mono/>
          <MetaRow label="ตำแหน่ง" value={p.loc} mono/>
          <MetaRow label="แบรนด์" value={p.brand || "—"}/>
          <MetaRow label="ผู้จัดส่ง" value={p.supplier}/>
          <MetaRow label="ราคา" value={`฿${p.price.toLocaleString()}`}/>
          <MetaRow label="จุดสั่งซื้อใหม่" value={`${p.reorder} ชิ้น`}/>
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>ยอดขายตามช่องทาง · 30 วัน</div>
        <div className="m-card">
          {(() => {
            const totalSold = channels.reduce((s, x) => s + x.sold, 0);
            if (!totalSold) return <div style={{ padding: "8px 0", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ยังไม่มียอดขายในช่วงนี้</div>;
            return channels.filter(c => c.sold > 0).map(c => {
              const pct = c.sold / totalSold * 100;
              return (
                <div key={c.id} style={{ padding: "6px 0" }}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                    <span className="row" style={{ gap: 6, fontSize: 12 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: c.color }}/>
                      {c.name}
                    </span>
                    <span className="tnum" style={{ fontSize: 12 }}><strong>{c.sold}</strong> ชิ้น</span>
                  </div>
                  <div className="prog" style={{ height: 4 }}><span style={{ width: pct + "%", background: c.color }}/></div>
                </div>
              );
            });
          })()}
        </div>

        <button className="m-btn-big success" style={{ marginTop: 8 }} disabled={(p.qty - (p.reserved || 0)) <= 0} onClick={() => ctx.push("sell", { sku: p.sku })}>
          <Icons.Cart size={16}/> ขายสินค้า
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <button className="m-btn-big outline" onClick={() => setAdjOpen(true)}>
            <Icons.Refresh size={15}/> ปรับสต็อก
          </button>
          <button className="m-btn-big warn" onClick={() => ctx.push("issue", { sku: p.sku })}>
            <Icons.Out size={15}/> ตัดสต็อก
          </button>
        </div>
      </div>
      {editOpen && (
        <MAddSku categories={cats} products={PRODUCTS} editing={base} onClose={() => setEditOpen(false)} onAdd={doEdit}/>
      )}
      {adjOpen && (
        <MStockAdjust product={p} onClose={() => setAdjOpen(false)} onApply={doAdjust}/>
      )}
    </>
  );
}

/* Mobile quick stock-adjustment sheet */
function MStockAdjust({ product, onClose, onApply }) {
  const [mode, setMode] = useStateM("add"); // add | remove | set
  const [amount, setAmount] = useStateM("");
  const [reason, setReason] = useStateM("");
  const eff = product.qty;
  const n = parseInt(amount);
  const valid = Number.isFinite(n) && n >= 0;
  let delta = 0;
  if (valid) {
    if (mode === "add") delta = n;
    else if (mode === "remove") delta = -Math.min(n, eff);
    else delta = n - eff;
  }
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet">
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>ปรับสต็อก</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{product.name} · คงเหลือ {eff} ชิ้น</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="seg" style={{ width: "100%" }}>
            <button className={mode === "add" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("add")}>เพิ่มเข้า</button>
            <button className={mode === "remove" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("remove")}>หักออก</button>
            <button className={mode === "set" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("set")}>ตั้งค่าเป็น</button>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>{mode === "set" ? "จำนวนคงเหลือใหม่" : "จำนวน (ชิ้น)"}</div>
            <input className="m-input" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>เหตุผล (ไม่จำเป็น)</div>
            <input className="m-input" value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ตรวจนับสต็อก"/>
          </div>
          {valid && (
            <div className="m-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: 0 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>คงเหลือหลังปรับ</span>
              <span className="tnum" style={{ fontSize: 20, fontWeight: 600 }}>{eff} → {Math.max(0, eff + delta)}</span>
            </div>
          )}
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn-big" onClick={() => onApply(delta, reason)} disabled={!valid || delta === 0} style={(!valid || delta === 0) ? { opacity: 0.5 } : {}}>
            <Icons.Check size={16}/> ยืนยันปรับสต็อก
          </button>
        </div>
      </div>
    </>
  );
}

function MetaRow({ label, value, mono }) {
  return (
    <div className="m-row" style={{ cursor: "default" }}>
      <div className="m-row-main">
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
        <div className={"m-row-title" + (mono ? " mono" : "")} style={{ marginTop: 2, fontWeight: 500 }}>{value}</div>
      </div>
    </div>
  );
}

/* =============== ISSUE (stock-out) FULL-SCREEN VIEW =============== */

function MIssue({ ctx }) {
  const presetBundle = ctx.route.params?.bundleId;
  const [mode, setMode] = useStateM(presetBundle ? "bundle" : "single"); // single | bundle
  const [skuId, setSkuId] = useStateM(ctx.route.params?.sku || PRODUCTS[0].sku);
  const bundles = useMemoM(() => (typeof loadBundles === "function" ? loadBundles() : []), []);
  const [bundleId, setBundleId] = useStateM(presetBundle || bundles[0]?.id || "");
  const [customer, setCustomer] = useStateM("");
  const [channels, setChannels] = useStateM(() =>
    Object.fromEntries(CHANNEL_LIST.map(c => [c.id, { on: c.id === "shopee", qty: c.id === "shopee" ? 1 : 0 }]))
  );

  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));
  const product = PRODUCTS.find(p => p.sku === skuId) || PRODUCTS[0];
  const bundle = bundles.find(b => b.id === bundleId);
  const bundleMax = bundle && typeof bundleAvail === "function" ? bundleAvail(bundle) : 0;
  const isBundle = mode === "bundle";
  const unit = isBundle ? "ชุด" : "ชิ้น";
  const noBundles = isBundle && bundles.length === 0;

  const total = Object.values(channels).reduce((s, c) => s + (c.on ? c.qty : 0), 0);
  const selectedCount = Object.values(channels).filter(c => c.on && c.qty > 0).length;
  const stockCap = isBundle ? bundleMax : effQty(skuId);
  const overStock = total > stockCap;
  const canSubmit = total > 0 && !overStock && !noBundles && (isBundle ? !!bundle : true);

  const submit = () => {
    if (!canSubmit) return;
    if (isBundle) {
      deductManyAndPersist(bundle.items.map(it => ({ sku: it.sku, qty: it.qty * total })));
    } else {
      deductStockAndPersist(skuId, total);
    }

    const id = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
    const lineItems = isBundle
      ? bundle.items.map(it => snapLineItem(it.sku, null, it.qty * total))
      : [snapLineItem(skuId, product.name, total)];

    // The stock-out is a shipment too → create its label (single source of truth
    // for ติดตามพัสดุ / จัดส่ง). No customer address here, so recipient is name-only.
    if (typeof createSaleLabel === "function") {
      try {
        createSaleLabel({ orderId: id, name: customer || "ลูกค้าใหม่", items: lineItems });
      } catch (e) {}
    }

    // Also persist an orders-table row so it shows in the desktop จัดส่ง (Outbound)
    // queue — mirrors the desktop stock-out (submitIssue). Synced via the orders
    // realtime arm; track-lookup dedups id|tracking so no double-show for customers.
    if (typeof dbUpsertOrders === "function") {
      dbUpsertOrders([{
        id,
        channel: "ตัดสต็อก",
        customer: customer || "ลูกค้าใหม่",
        status: "picking",
        carrier: "",
        tracking: "",
        items: lineItems.length,
        dateIso: (typeof TODAY_ISO !== "undefined") ? TODAY_ISO : new Date().toISOString().slice(0, 10),
        isBundle,
        bundleName: isBundle ? bundle.name : "",
        lineItems,
      }]).catch(() => {});
    }

    if (typeof recordChange === "function") {
      recordChange({
        entity: isBundle ? "bundle" : "product",
        entityId: isBundle ? bundle.id : skuId, action: "update",
        summary: isBundle
          ? `ตัดสต็อกชุด "${bundle.name}" ${total} ชุด (มือถือ)`
          : `ตัดสต็อก ${product.name} (${skuId}) ${total} ชิ้น (มือถือ)`,
        changes: isBundle
          ? bundle.items.map(it => ({ label: it.sku, to: `−${it.qty * total} ชิ้น` }))
          : [{ label: skuId, to: `−${total} ชิ้น` }],
        note: `ออร์เดอร์ ${id}`
      });
    }
    ctx.pushToast(`ตัดสต็อก${isBundle ? `ชุด "${bundle.name}"` : ` ${skuId}`} ${total} ${unit}`);
    ctx.back();
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.X size={14}/></button>
        <div className="m-title-sub">ตัดสต็อก / ขาย</div>
        <button className="m-action accent" disabled={!canSubmit} onClick={submit} style={!canSubmit ? { opacity: 0.4 } : {}}>
          <Icons.Check size={14}/>
        </button>
      </div>
      <div className="m-content">
        <div className="seg" style={{ width: "100%", marginBottom: 12 }}>
          <button className={mode === "single" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("single")}>
            <Icons.Box size={13}/> สินค้าเดี่ยว
          </button>
          <button className={mode === "bundle" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("bundle")}>
            <Icons.Bundle size={13}/> ชุดสินค้า
          </button>
        </div>

        {!isBundle && (
          <>
            <div className="m-section-label" style={{ padding: "0 4px 8px" }}>สินค้า</div>
            <MSkuPicker value={skuId} onChange={setSkuId}/>
            <div style={{ fontSize: 11, color: "var(--muted)", margin: "8px 4px 0" }}>
              คงเหลือ <strong style={{ color: "var(--fg)" }}>{effQty(skuId)}</strong> ชิ้น · ตำแหน่ง <span className="mono">{product.loc}</span> · ราคา ฿{product.price.toLocaleString()}
            </div>
          </>
        )}

        {isBundle && (
          noBundles ? (
            <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 20 }}>
              <Icons.Bundle size={22} style={{ opacity: 0.4, marginBottom: 6 }}/>
              <div>ยังไม่มีชุดสินค้า</div>
            </div>
          ) : (
            <>
              <div className="m-section-label" style={{ padding: "0 4px 8px" }}>ชุดสินค้า</div>
              <select className="m-input" value={bundleId} onChange={e => setBundleId(e.target.value)}>
                {bundles.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {bundle && (
                <div className="m-card" style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                    ขายได้สูงสุด <strong style={{ color: bundleMax === 0 ? "var(--danger)" : "var(--fg)" }}>{bundleMax}</strong> ชุด · ราคา ฿{bundle.price.toLocaleString()}
                  </div>
                  {bundle.items.map(it => {
                    const p = PRODUCTS.find(x => x.sku === it.sku);
                    const eq = effQty(it.sku);
                    const need = it.qty * total;
                    return (
                      <div key={it.sku} className="row" style={{ gap: 8, fontSize: 12, padding: "3px 0" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: eq < need ? "var(--danger)" : "var(--success)", flexShrink: 0 }}/>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name || it.sku}</span>
                        <span className="mono" style={{ color: "var(--muted)" }}>×{it.qty}</span>
                        <span className="tnum" style={{ color: "var(--muted)" }}>เหลือ {eq}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )
        )}

        <div className="m-section-label" style={{ padding: "8px 4px 8px" }}>ลูกค้า / อ้างอิง (ไม่จำเป็น)</div>
        <input className="m-input" placeholder="เช่น คุณ ปวีณา / Shopee #2025-119283" value={customer} onChange={e => setCustomer(e.target.value)} style={{ marginBottom: 8 }}/>

        <div className="m-section-label" style={{ padding: "8px 4px 8px" }}>ตัดสต็อกตามช่องทาง ({unit})</div>
        <div className="m-list">
          {CHANNEL_LIST.map(c => {
            const v = channels[c.id];
            const toggle = () => setChannels(s => ({ ...s, [c.id]: { ...s[c.id], on: !s[c.id].on, qty: !s[c.id].on && s[c.id].qty === 0 ? 1 : s[c.id].qty } }));
            const setQ = (q) => setChannels(s => ({ ...s, [c.id]: { ...s[c.id], qty: Math.max(0, q), on: q > 0 ? true : s[c.id].on } }));
            return (
              <div key={c.id} className="m-row" style={{ cursor: "default", background: v.on ? "var(--accent-soft)" : undefined }}>
                <span className={"check" + (v.on ? " on" : "")} onClick={toggle}/>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color }}/>
                <span style={{ flex: 1, fontSize: 13, fontWeight: v.on ? 500 : 400 }}>{c.name}</span>
                <div className="qty-stepper">
                  <button onClick={() => setQ(v.qty - 1)} disabled={v.qty <= 0}>−</button>
                  <input value={v.qty} onChange={e => setQ(parseInt(e.target.value) || 0)} style={{ width: 36, fontSize: 12 }}/>
                  <button onClick={() => setQ(v.qty + 1)}>+</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="m-card" style={{ background: overStock ? "var(--danger-soft)" : "var(--surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: overStock ? "var(--danger)" : "var(--fg-2)" }}>
            <div>รวมตัดสต็อก</div>
            {overStock && <div style={{ fontSize: 10, marginTop: 2 }}>เกินจำนวนที่ขายได้ ({stockCap} {unit})</div>}
          </div>
          <div className="tnum" style={{ fontSize: 22, fontWeight: 600, color: overStock ? "var(--danger)" : "var(--fg)" }}>
            {total} <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>{unit}</span>
          </div>
        </div>

        <button className="m-btn-big" onClick={submit} disabled={!canSubmit}>
          <Icons.Check size={16}/> ยืนยันตัดสต็อก {total} {unit}
        </button>
      </div>
    </>
  );
}

/* =============== SELL PRODUCT (3-step POS wizard) =============== */

function MSell({ ctx }) {
  const [step, setStep] = useStateM(1); // 1 cart · 2 shipping · 3 confirm
  const [cart, setCart] = useStateM(() => {
    // Pre-add a product when opened from the product detail page ("ขาย")
    const presetSku = ctx.route.params?.sku;
    const p = presetSku && PRODUCTS.find(x => x.sku === presetSku);
    return p ? [{ type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: p.loc, qty: 1 }] : [];
  });
  const [q, setQ] = useStateM("");
  const [ship, setShipState] = useStateM({
    name: "", phone: "", addr1: "", addr2: "",
    tambon: "", amphoe: "", province: "", postal: "",
    carrier: "", cod: false, codAmt: "", notes: ""
  });
  const setShip = (k, v) => setShipState(s => ({ ...s, [k]: v }));

  // Paste-and-auto-split recipient block (same parser as the label editor)
  const [pasteText, setPasteText] = useStateM("");
  const [pasteOpen, setPasteOpen] = useStateM(false);
  const [aiLoading, setAiLoading] = useStateM(false);

  const applyParse = async () => {
    if (typeof ensureThaiAddrIndex === "function") { try { await ensureThaiAddrIndex(); } catch (e) {} }
    const parsed = (typeof parseRecipientBlob === "function") ? parseRecipientBlob(pasteText) : null;
    if (!parsed || (!parsed.name && !parsed.phone && !parsed.addr1)) { ctx.pushToast("ไม่พบข้อมูลที่จะคัดแยก"); return; }
    setShipState(s => ({ ...s,
      name:  parsed.name  || s.name,
      phone: parsed.phone || s.phone,
      addr1: parsed.addr1 || s.addr1,
      addr2: parsed.addr2 || s.addr2,
    }));
    setPasteText(""); setPasteOpen(false);
    const hasAddr = parsed.addr1 || parsed.addr2;
    ctx.pushToast(!hasAddr ? "คัดแยกข้อมูลแล้ว"
      : parsed.addrConfidence === "high" ? "คัดแยกแล้ว · ✓ ตรงรหัสไปรษณีย์"
      : "คัดแยกแล้ว · ที่อยู่อาจไม่ครบ ลอง AI");
  };

  const applyPasteAI = async () => {
    if (!pasteText.trim()) return;
    setAiLoading(true);
    try {
      const { data: { session } } = await authGetSession();
      if (!session) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const r = await fetch(SUPABASE_FUNC_URL + "/parse-recipient", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
        body: JSON.stringify({ text: pasteText })
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "parse failed");
      setShipState(s => ({ ...s,
        name:  j.name  || s.name,
        phone: j.phone || s.phone,
        addr1: j.addr1 || s.addr1,
        addr2: j.addr2 || s.addr2,
      }));
      setPasteText(""); setPasteOpen(false);
      ctx.pushToast("AI คัดแยกข้อมูลแล้ว");
    } catch (e) {
      ctx.pushToast("AI คัดแยกไม่สำเร็จ: " + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  // Keep stock/bundle data live while the wizard is open (mirrors desktop SellProductModal)
  const [stockKey, setStockKey] = useStateM(0);
  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change",  refresh);
    window.addEventListener("ims-bundles-change",   refresh);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change",  refresh);
      window.removeEventListener("ims-bundles-change",   refresh);
    };
  }, []);

  const bundles = useMemoM(() => (typeof loadBundles === "function" ? loadBundles() : []), [stockKey]);
  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));
  const bMax = (b) => (typeof bundleAvail === "function" ? bundleAvail(b) : 0);

  const liveProducts = useMemoM(() => {
    const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
    return PRODUCTS.map(p => ({ ...p, qty: Math.max(0, p.qty + (adj[p.sku] || 0)) }));
  }, [stockKey]);

  const qL = q.toLowerCase();
  const prodMatches = liveProducts.filter(p =>
    !q || p.sku.toLowerCase().includes(qL) || p.name.toLowerCase().includes(qL) || (p.cat || "").toLowerCase().includes(qL)
  );
  const bundleMatches = bundles.filter(b =>
    !q || b.name.toLowerCase().includes(qL) || b.id.toLowerCase().includes(qL)
  );

  const cartValue = cart.reduce((s, i) => s + (i.price || 0) * i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.qty, 0);

  const addProduct = (p) => setCart(prev => {
    const idx = prev.findIndex(i => i.type === "product" && i.sku === p.sku);
    if (idx > -1) { const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n; }
    return [...prev, { type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: p.loc, qty: 1 }];
  });
  const addBundle = (b) => setCart(prev => {
    const idx = prev.findIndex(i => i.type === "bundle" && i.id === b.id);
    if (idx > -1) { const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n; }
    return [...prev, { type: "bundle", id: b.id, name: b.name, price: b.price, items: b.items, qty: 1 }];
  });
  const removeItem = (idx) => setCart(prev => prev.filter((_, i) => i !== idx));
  const updateQty = (idx, qty) => {
    if (qty <= 0) { removeItem(idx); return; }
    setCart(prev => { const n = [...prev]; n[idx] = { ...n[idx], qty }; return n; });
  };

  // Scan a barcode/SKU → add the matching product to the cart (same beep feedback as Inbound)
  const [camOpen, setCamOpen] = useStateM(false);
  const addByScan = (code) => {
    const sku = String(code || "").trim();
    if (!sku) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === sku.toLowerCase());
    if (!p) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      ctx.pushToast(`ไม่พบสินค้า SKU ${sku}`);
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    addProduct(p);
    ctx.pushToast(`เพิ่ม ${p.name} ลงตะกร้า`);
  };

  const cartErrors = cart.map(item => {
    const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
    if (item.qty > avail) return `${item.name}: ต้องการ ${item.qty} แต่มีเพียง ${avail}`;
    return null;
  }).filter(Boolean);

  const shipValid = ship.name.trim() && ship.phone.trim() && ship.addr1.trim();
  const cartReady = cart.length > 0 && cartErrors.length === 0;

  const submitOrder = () => {
    // Re-validate against live stock at submit time (stock may have changed mid-wizard)
    const liveErrors = cart.map(item => {
      const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
      return item.qty > avail ? item.name : null;
    }).filter(Boolean);
    if (cart.length === 0 || liveErrors.length > 0) { ctx.pushToast("สต็อกไม่พอ — ตรวจสอบรายการอีกครั้ง"); return; }
    const allDeductions = [];
    cart.forEach(item => {
      if (item.type === "product") allDeductions.push({ sku: item.sku, qty: item.qty });
      else item.items.forEach(ci => allDeductions.push({ sku: ci.sku, qty: ci.qty * item.qty }));
    });
    if (typeof deductManyAndPersist === "function") deductManyAndPersist(allDeductions);

    const orderId = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));

    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", action: "create",
        summary: `ขายสินค้า ${cart.length} รายการ → ${ship.name} (${ship.carrier}) (มือถือ)`,
        count: cartTotal,
        changes: cart.map(item => ({
          label: item.type === "bundle" ? `ชุด: ${item.name}` : item.name,
          to: `−${item.qty} ${item.type === "bundle" ? "ชุด" : "ชิ้น"}`
        })),
        note: `ผู้รับ: ${ship.name} · ${ship.addr1} · ${ship.carrier}`
      });
    }

    const lineItems = cart.flatMap(item => item.type === "product"
      ? [snapLineItem(item.sku, item.name, item.qty)]
      : item.items.map(ci => snapLineItem(ci.sku, null, ci.qty * item.qty))
    );

    // A sale is a shipment → create the label, which is the single source of truth
    // that feeds คิวฉลาก + ติดตามพัสดุ + จัดส่ง (no separate orders store needed).
    let createdLabel = null;
    if (typeof createSaleLabel === "function") {
      try {
        createdLabel = createSaleLabel({
          orderId,
          name: ship.name,
          phone: ship.phone,
          addr1: ship.addr1,
          addr2: [ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "),
          carrier: ship.carrier,
          cod: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
          items: lineItems,
        });
      } catch (e) { createdLabel = null; }
    }

    // Also persist an orders-table row so the sale shows in the desktop จัดส่ง
    // (Outbound) queue, which reads the orders store — mirrors the desktop sell.
    // The orders table has a realtime arm, so it syncs to open desktops. The
    // customer track-lookup dedups by id|tracking, so this won't double-show.
    if (typeof dbUpsertOrders === "function") {
      const hasBundle = cart.some(i => i.type === "bundle");
      dbUpsertOrders([{
        id: orderId,
        channel: "ขายตรง",
        customer: ship.name,
        phone: ship.phone,
        status: "picking",
        carrier: ship.carrier,
        tracking: "",
        items: cart.length,
        dateIso: (typeof TODAY_ISO !== "undefined") ? TODAY_ISO : new Date().toISOString().slice(0, 10),
        isSellOrder: true,
        isBundle: hasBundle,
        bundleName: hasBundle ? cart.filter(i => i.type === "bundle").map(i => i.name).join(", ") : "",
        shippingAddr: [ship.addr1, ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "),
        codAmount: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
        lineItems,
        deductions: [{ id: "direct", name: "ขายตรง", color: "#8B5CF6", qty: cartTotal }],
      }]).catch(() => {});
    }

    ctx.pushToast(`ขายสำเร็จ ${orderId} · สร้างฉลากแล้ว`);
    if (createdLabel) ctx.push("label-view", createdLabel);
    else ctx.switchTab("outbound");
  };

  const STEPS = ["เลือกสินค้า", "จัดส่ง", "ยืนยัน"];

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.X size={14}/></button>
        <div className="m-title-sub"><Icons.Cart size={14} style={{ verticalAlign: "middle", marginRight: 5 }}/>ขายสินค้า</div>
        <div style={{ width: 32 }}/>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", padding: "4px 16px 10px", flexShrink: 0 }}>
        {STEPS.map((label, i) => (
          <React.Fragment key={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                background: step > i + 1 ? "var(--success)" : step === i + 1 ? "var(--accent)" : "var(--surface-3)",
                color: step >= i + 1 ? "white" : "var(--muted)",
                display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600
              }}>{step > i + 1 ? <Icons.Check size={10}/> : i + 1}</div>
              <span style={{ fontSize: 11, fontWeight: step === i + 1 ? 600 : 400, color: step === i + 1 ? "var(--fg)" : "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: step > i + 1 ? "var(--success)" : "var(--border)", margin: "0 8px" }}/>}
          </React.Fragment>
        ))}
      </div>

      <div className="m-content" style={{ paddingTop: 0 }}>

        {/* ─── STEP 1: CART ─── */}
        {step === 1 && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div className="m-search" style={{ flex: 1, marginBottom: 0 }}>
                <Icons.Search size={14}/>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา / สแกน SKU, ชื่อ, ชุดสินค้า..."/>
                {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}><Icons.X size={12}/></span>}
              </div>
              <button className="m-btn-big" style={{ width: "auto", flexShrink: 0, padding: "0 14px" }} onClick={() => setCamOpen(true)} title="สแกนบาร์โค้ด">
                <Icons.Scan size={18}/>
              </button>
            </div>
            {camOpen && <CameraScanner onScan={code => { addByScan(code); setCamOpen(false); }} onClose={() => setCamOpen(false)}/>}

            {cart.length > 0 && (
              <>
                <div className="m-section-label" style={{ padding: "4px 4px 6px", display: "flex", justifyContent: "space-between" }}>
                  <span>ตะกร้า ({cart.length} รายการ)</span>
                  <span className="tnum" style={{ fontWeight: 600, color: "var(--fg)" }}>฿{cartValue.toLocaleString()}</span>
                </div>
                <div className="m-list" style={{ marginBottom: 12 }}>
                  {cart.map((item, idx) => {
                    const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
                    const over = item.qty > avail;
                    return (
                      <div key={idx} className="m-row" style={{ cursor: "default", background: over ? "var(--danger-soft)" : undefined }}>
                        {item.type === "bundle" && <Icons.Bundle size={13} style={{ color: "var(--info)", flexShrink: 0 }}/>}
                        <div className="m-row-main">
                          <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
                          <div className="m-row-sub" style={{ color: over ? "var(--danger)" : "var(--muted)" }}>
                            {over ? `มีเพียง ${avail} ${item.type === "bundle" ? "ชุด" : "ชิ้น"}` : `฿${(item.price * item.qty).toLocaleString()}`}
                          </div>
                        </div>
                        <div className="qty-stepper">
                          <button onClick={() => updateQty(idx, item.qty - 1)}>−</button>
                          <input inputMode="numeric" value={item.qty} onChange={e => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) updateQty(idx, v); }} style={{ width: 34, fontSize: 12 }}/>
                          <button onClick={() => updateQty(idx, item.qty + 1)}>+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            <div className="m-section-label" style={{ padding: "4px 4px 6px" }}>สินค้าเดี่ยว ({prodMatches.length})</div>
            <div className="m-list" style={{ marginBottom: 12 }}>
              {prodMatches.length === 0 && <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่พบสินค้า</div>}
              {prodMatches.slice(0, 60).map(p => {
                const avail = effQty(p.sku);
                const inCart = cart.find(i => i.type === "product" && i.sku === p.sku);
                return (
                  <button key={p.sku} className="m-row" onClick={() => addProduct(p)} style={{ background: inCart ? "var(--accent-soft)" : undefined }}>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13 }}>{p.name}</div>
                      <div className="m-row-sub"><span className="mono">{p.sku}</span> · ฿{p.price.toLocaleString()} · เหลือ {avail}</div>
                    </div>
                    {inCart
                      ? <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{inCart.qty}</span>
                      : <Icons.Plus size={16} style={{ color: "var(--muted)", flexShrink: 0 }}/>}
                  </button>
                );
              })}
            </div>

            {bundles.length > 0 && (
              <>
                <div className="m-section-label" style={{ padding: "4px 4px 6px" }}><Icons.Bundle size={12} style={{ verticalAlign: "middle", marginRight: 4 }}/>ชุดสินค้า ({bundleMatches.length})</div>
                <div className="m-list" style={{ marginBottom: 12 }}>
                  {bundleMatches.length === 0 && <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่พบชุดสินค้า</div>}
                  {bundleMatches.map(b => {
                    const avail = bMax(b);
                    const inCart = cart.find(i => i.type === "bundle" && i.id === b.id);
                    return (
                      <button key={b.id} className="m-row" disabled={avail === 0} onClick={() => avail > 0 && addBundle(b)} style={{ background: inCart ? "var(--accent-soft)" : undefined, opacity: avail === 0 ? 0.5 : 1 }}>
                        <Icons.Bundle size={13} style={{ color: "var(--info)", flexShrink: 0 }}/>
                        <div className="m-row-main">
                          <div className="m-row-title" style={{ fontSize: 13 }}>{b.name}</div>
                          <div className="m-row-sub">฿{b.price.toLocaleString()} · {b.items.length} ชิ้น/ชุด · {avail === 0 ? "หมด" : `ขายได้ ${avail}`}</div>
                        </div>
                        {inCart
                          ? <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{inCart.qty}</span>
                          : <Icons.Plus size={16} style={{ color: "var(--muted)", flexShrink: 0 }}/>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {cart.length === 0 && (
              <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, border: "1px dashed var(--border)" }}>
                <Icons.Cart size={22} style={{ opacity: 0.35, marginBottom: 6 }}/>
                <div>แตะสินค้าด้านบนเพื่อเพิ่มในตะกร้า</div>
              </div>
            )}
          </>
        )}

        {/* ─── STEP 2: SHIPPING ─── */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Paste & auto-split recipient */}
            <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 12, border: "1px dashed var(--border)" }}>
              <button onClick={() => setPasteOpen(o => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--fg)", fontFamily: "inherit" }}>
                <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--fg-2)" }}><Icons.Spark size={13}/> วางที่อยู่ → คัดแยกอัตโนมัติ</span>
                <Icons.Chev size={14} style={{ transform: pasteOpen ? "rotate(90deg)" : "none", color: "var(--muted)" }}/>
              </button>
              {pasteOpen && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    placeholder={"วางที่อยู่ทั้งก้อนที่นี่ เช่น\nคุณสมชาย ใจดี 081-234-5678\n123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110"}
                    style={{ width: "100%", minHeight: 78, padding: 10, marginTop: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", fontFamily: "inherit", fontSize: 13, resize: "vertical", color: "var(--fg)", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn btn-sm btn-primary" style={{ flex: 1, justifyContent: "center", ...(!pasteText.trim() ? { opacity: 0.5 } : {}) }} onClick={applyParse} disabled={!pasteText.trim()}>
                      <Icons.Spark size={13}/> คัดแยก
                    </button>
                    <button className="btn btn-sm" style={{ flex: 1, justifyContent: "center", ...((!pasteText.trim() || aiLoading) ? { opacity: 0.5 } : {}) }} onClick={applyPasteAI} disabled={!pasteText.trim() || aiLoading}>
                      <Icons.Spark size={13}/> {aiLoading ? "กำลังคัดแยก..." : "ด้วย AI"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ชื่อผู้รับ *</div>
              <input className="m-input" value={ship.name} onChange={e => setShip("name", e.target.value)} placeholder="เช่น คุณ สมศรี ใจดี"/>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>เบอร์โทรศัพท์ *</div>
              <input className="m-input" type="tel" value={ship.phone} onChange={e => setShip("phone", e.target.value)} placeholder="เช่น 089-123-4567"/>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ที่อยู่ *</div>
              <input className="m-input" value={ship.addr1} onChange={e => setShip("addr1", e.target.value)} placeholder="บ้านเลขที่ ถนน ซอย หมู่บ้าน"/>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ที่อยู่เพิ่มเติม</div>
              <input className="m-input" value={ship.addr2} onChange={e => setShip("addr2", e.target.value)} placeholder="อาคาร ชั้น ห้อง (ถ้ามี)"/>
            </div>
            {typeof ThaiAddrAutocomplete === "function" && (
              <ThaiAddrAutocomplete
                value={{ tambon: ship.tambon, amphoe: ship.amphoe, province: ship.province, postal: ship.postal }}
                onChange={(partial) => setShipState(s => ({ ...s, ...partial }))}
              />
            )}
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 6px" }}>บริษัทขนส่ง</div>
              {(() => {
                const CARRIERS = ["KEX","Flash Express","J&T Express","ไปรษณีย์ไทย","Ninja Van","DHL","Best Express","SCG Express","Alpha Fast","Lalamove"];
                const isOther = !CARRIERS.includes(ship.carrier);
                return (
                  <div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {CARRIERS.map(c => {
                        const on = ship.carrier === c;
                        return (
                          <button key={c} type="button" onClick={() => setShip("carrier", c)}
                            style={{ padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer", lineHeight: 1.4,
                              border: "1px solid " + (on ? "var(--fg)" : "var(--border)"), background: on ? "var(--fg)" : "transparent",
                              color: on ? "var(--surface)" : "var(--fg-2)", fontWeight: on ? 500 : 400, fontFamily: "inherit" }}>{c}</button>
                        );
                      })}
                      <button type="button" onClick={() => { if (!isOther) setShip("carrier", ""); }}
                        style={{ padding: "5px 11px", borderRadius: 999, fontSize: 12, cursor: "pointer", lineHeight: 1.4,
                          border: "1px solid " + (isOther ? "var(--fg)" : "var(--border)"), background: isOther ? "var(--fg)" : "transparent",
                          color: isOther ? "var(--surface)" : "var(--fg-2)", fontWeight: isOther ? 500 : 400, fontFamily: "inherit" }}>อื่นๆ</button>
                    </div>
                    {isOther && (
                      <input className="m-input" autoFocus value={ship.carrier} onChange={e => setShip("carrier", e.target.value)}
                        placeholder="ระบุชื่อบริษัทขนส่ง เช่น TP Logistics" style={{ marginTop: 8 }}/>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="m-row" style={{ cursor: "pointer", border: "1px solid " + (ship.cod ? "var(--accent)" : "var(--border)"), borderRadius: 12, background: "var(--surface-2)" }} onClick={() => setShip("cod", !ship.cod)}>
              <span className={"check" + (ship.cod ? " on" : "")}/>
              <div className="m-row-main">
                <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>เก็บเงินปลายทาง (COD)</div>
                <div className="m-row-sub">ลูกค้าชำระเมื่อรับสินค้า</div>
              </div>
              {ship.cod && (
                <input className="m-input" type="number" style={{ width: 110, textAlign: "right" }} value={ship.codAmt}
                  placeholder="฿ จำนวน" onChange={e => { e.stopPropagation(); setShip("codAmt", e.target.value); }} onClick={e => e.stopPropagation()}/>
              )}
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>หมายเหตุ</div>
              <input className="m-input" value={ship.notes} onChange={e => setShip("notes", e.target.value)} placeholder="เช่น วางหน้าบ้าน, โทรก่อนส่ง..."/>
            </div>
          </div>
        )}

        {/* ─── STEP 3: CONFIRM ─── */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="m-section-label" style={{ padding: "0 4px" }}>สินค้าในออร์เดอร์</div>
            <div className="m-list">
              {cart.map((item, idx) => (
                <div key={idx} className="m-row" style={{ cursor: "default" }}>
                  {item.type === "bundle" && <Icons.Bundle size={13} style={{ color: "var(--info)", flexShrink: 0 }}/>}
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
                    {item.type === "bundle" && <div className="m-row-sub">{item.items.length} ชิ้นต่อชุด</div>}
                  </div>
                  <span className="tnum" style={{ fontSize: 12, color: "var(--muted)" }}>×{item.qty}</span>
                  <span className="tnum" style={{ fontSize: 13, fontWeight: 600, minWidth: 64, textAlign: "right" }}>฿{(item.price * item.qty).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="m-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-2)" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>รวมทั้งหมด</span>
              <span className="tnum" style={{ fontSize: 18, fontWeight: 700 }}>฿{cartValue.toLocaleString()}</span>
            </div>

            <div className="m-section-label" style={{ padding: "0 4px" }}>ข้อมูลการจัดส่ง</div>
            <div className="m-card" style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 13 }}>
              {[
                ["ผู้รับ", ship.name, true],
                ["โทร", ship.phone, false],
                ["ที่อยู่", [ship.addr1, ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "), false],
                ["ขนส่ง", ship.carrier, false],
                ship.cod ? ["COD", `฿${parseFloat(ship.codAmt || 0).toLocaleString()}`, false] : null,
                ship.notes ? ["หมายเหตุ", ship.notes, false] : null
              ].filter(Boolean).map(([label, val, bold]) => (
                <div key={label} className="row" style={{ justifyContent: "space-between", gap: 14 }}>
                  <span style={{ color: "var(--muted)", flexShrink: 0 }}>{label}</span>
                  <span style={{ fontWeight: bold ? 600 : 400, textAlign: "right" }}>{val}</span>
                </div>
              ))}
            </div>

            <div className="m-card" style={{ background: "var(--info-soft)", color: "var(--info)", fontSize: 12 }}>
              <div className="row" style={{ gap: 6, fontWeight: 600, marginBottom: 4 }}><Icons.Check size={13}/>พร้อมยืนยัน</div>
              <div>การยืนยันจะตัดสต็อกทันที และสร้างออร์เดอร์ใหม่ในหน้าจัดส่ง</div>
            </div>
          </div>
        )}

        {/* Footer nav */}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {step > 1 && (
            <button className="m-btn-big" style={{ flex: "0 0 auto", width: "auto", padding: "0 18px", background: "var(--surface-2)", color: "var(--fg)" }} onClick={() => setStep(step - 1)}>
              <Icons.Chev size={15} style={{ transform: "rotate(180deg)" }}/> ย้อนกลับ
            </button>
          )}
          {step === 1 && (
            <button className="m-btn-big" style={{ flex: 1, ...(cartReady ? {} : { opacity: 0.5 }) }} disabled={!cartReady} onClick={() => setStep(2)}>
              ข้อมูลจัดส่ง <Icons.Chev size={15}/>
            </button>
          )}
          {step === 2 && (
            <button className="m-btn-big" style={{ flex: 1, ...(shipValid ? {} : { opacity: 0.5 }) }} disabled={!shipValid} onClick={() => setStep(3)}>
              ตรวจสอบออร์เดอร์ <Icons.Chev size={15}/>
            </button>
          )}
          {step === 3 && (
            <button className="m-btn-big success" style={{ flex: 1, ...(cartReady ? {} : { opacity: 0.5 }) }} disabled={!cartReady} onClick={submitOrder}>
              <Icons.Check size={16}/> ยืนยันการขาย
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* =============== BUNDLES =============== */

function MBundles({ ctx }) {
  const [bundles, setBundlesRaw] = useStateM(() => (typeof loadBundles === "function" ? loadBundles() : []));
  const [q, setQ] = useStateM("");
  const [stockKey, setStockKey] = useStateM(0);
  const [formBundle, setFormBundle] = useStateM(null); // null=closed, false=new, obj=edit
  const [detail, setDetail] = useStateM(null);

  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
    };
  }, []);

  const setBundles = (next) => {
    setBundlesRaw(next);
    if (typeof saveBundles === "function") saveBundles(next);
  };

  const avail = (b) => (typeof bundleAvail === "function" ? bundleAvail(b) : 0);
  const lq = q.toLowerCase();
  const filtered = bundles.filter(b =>
    !lq || b.name.toLowerCase().includes(lq) || (b.desc || "").toLowerCase().includes(lq) ||
    b.items.some(it => it.sku.toLowerCase().includes(lq))
  );

  const handleSave = (data) => {
    if (formBundle) {
      setBundles(bundles.map(b => b.id === formBundle.id ? { ...b, ...data } : b));
      ctx.pushToast("บันทึกการแก้ไขชุดสินค้าแล้ว");
      if (typeof recordChange === "function") {
        recordChange({ entity: "bundle", entityId: formBundle.id, action: "update",
          summary: `แก้ไขชุดสินค้า "${data.name}" (มือถือ)` });
      }
    } else {
      const id = (typeof newBundleId === "function") ? newBundleId(bundles) : "BND-" + Date.now();
      const nb = { id, ...data, createdAt: new Date().toISOString().slice(0, 10) };
      setBundles([...bundles, nb]);
      ctx.pushToast(`สร้างชุดสินค้า "${nb.name}" สำเร็จ`);
      if (typeof recordChange === "function") {
        recordChange({ entity: "bundle", entityId: id, action: "create",
          summary: `สร้างชุดสินค้าใหม่ "${nb.name}" (มือถือ)`,
          changes: [{ label: "จำนวนสินค้าในชุด", to: String(data.items.length) }] });
      }
    }
    setFormBundle(null);
  };
  const handleDelete = (b) => {
    if (!confirm(`ลบชุดสินค้า "${b.name}"?`)) return;
    setBundles(bundles.filter(x => x.id !== b.id));
    setDetail(null);
    ctx.pushToast("ลบชุดสินค้าแล้ว");
    if (typeof recordChange === "function") {
      recordChange({ entity: "bundle", entityId: b.id, action: "delete", summary: `ลบชุดสินค้า "${b.name}" (มือถือ)` });
    }
  };

  const totalAvail = bundles.filter(b => avail(b) > 0).length;

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ชุดสินค้า</div>
        <button className="m-action accent" onClick={() => setFormBundle(false)}><Icons.Plus size={18}/></button>
      </div>
      <div className="m-content">
        <div className="m-kpi-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="m-kpi">
            <div className="m-kpi-label">ชุดทั้งหมด</div>
            <div className="m-kpi-value">{bundles.length}</div>
          </div>
          <div className="m-kpi">
            <div className="m-kpi-label">พร้อมขาย</div>
            <div className="m-kpi-value" style={{ color: "var(--success)" }}>{totalAvail}</div>
          </div>
        </div>

        <div className="m-search">
          <Icons.Search size={14}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาชื่อชุด หรือ SKU"/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>

        <div className="m-list">
          {filtered.map(b => {
            const a = avail(b);
            const st = (typeof bundleStatus === "function") ? bundleStatus(a) : { label: a > 0 ? "พร้อมขาย" : "หมด", cls: a > 0 ? "badge-success" : "badge-danger" };
            return (
              <button key={b.id} className="m-row" onClick={() => setDetail(b)}>
                <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--info)" }}><Icons.Bundle size={18}/></div>
                <div className="m-row-main">
                  <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span className={"badge " + st.cls} style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>{st.label}</span>
                    <span style={{ fontSize: 10, color: "var(--muted)" }}>{b.items.length} ชิ้น · ฿{b.price.toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div className="tnum" style={{ fontSize: 15, fontWeight: 600, color: a === 0 ? "var(--danger)" : "var(--fg)" }}>{a}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>ขายได้</div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <Icons.Bundle size={22} style={{ opacity: 0.4, marginBottom: 6 }}/>
              <div>{bundles.length === 0 ? "ยังไม่มีชุดสินค้า — แตะ + เพื่อสร้าง" : "ไม่พบชุดสินค้า"}</div>
            </div>
          )}
        </div>
      </div>

      {detail && (
        <MBundleSheet
          bundle={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setFormBundle(detail); setDetail(null); }}
          onDelete={() => handleDelete(detail)}
          onSell={() => { const id = detail.id; setDetail(null); ctx.push("issue", { bundleId: id }); }}
        />
      )}
      {formBundle !== null && (
        <MBundleForm
          initial={formBundle || null}
          onClose={() => setFormBundle(null)}
          onSave={handleSave}
        />
      )}
    </>
  );
}

function MBundleSheet({ bundle, onClose, onEdit, onDelete, onSell }) {
  const a = (typeof bundleAvail === "function") ? bundleAvail(bundle) : 0;
  const issues = (typeof bundleStockIssues === "function") ? bundleStockIssues(bundle, 1) : [];
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "85%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bundle.name}</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{bundle.desc || bundle.id} · ฿{bundle.price.toLocaleString()}</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="m-card" style={{ margin: 0, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>ขายได้สูงสุด</span>
            <span className="tnum" style={{ fontSize: 22, fontWeight: 600, color: a === 0 ? "var(--danger)" : "var(--success)" }}>{a} ชุด</span>
          </div>
          {issues.length > 0 && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12 }}>
              <div className="row" style={{ gap: 6, fontWeight: 600, marginBottom: 4 }}><Icons.Warn size={13}/> สต็อกไม่พอ</div>
              {issues.map(x => (
                <div key={x.sku} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
                  <span style={{ flexShrink: 0 }}>{x.missing ? "ไม่พบ SKU" : x.out ? "หมด" : `เหลือ ${x.have}`}</span>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>สินค้าในชุด ({bundle.items.length})</div>
            <div className="m-list">
              {bundle.items.map(it => {
                const p = PRODUCTS.find(x => x.sku === it.sku);
                const eq = (typeof getEffectiveQty === "function") ? getEffectiveQty(it.sku) : 0;
                return (
                  <div key={it.sku} className="m-row" style={{ cursor: "default" }}>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13 }}>{p?.name || it.sku}</div>
                      <div className="m-row-sub"><span className="mono">{it.sku}</span> · คงเหลือ {eq}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>×{it.qty}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="m-sheet-foot" style={{ display: "flex", gap: 8 }}>
          <button className="m-action" style={{ width: 48, height: 48, background: "var(--danger-soft)", color: "var(--danger)" }} onClick={onDelete}>
            <Icons.Trash size={16}/>
          </button>
          <button className="m-btn-big" style={{ flex: 1 }} onClick={onEdit}>
            <Icons.Edit size={15}/> แก้ไข
          </button>
          <button className="m-btn-big dark" style={{ flex: 1, opacity: a === 0 ? 0.4 : 1 }} disabled={a === 0} onClick={onSell}>
            <Icons.Out size={15}/> ขายชุดนี้
          </button>
        </div>
      </div>
    </>
  );
}

function MBundleForm({ initial, onClose, onSave }) {
  const isEdit = !!initial;
  const [name, setName] = useStateM(initial?.name || "");
  const [desc, setDesc] = useStateM(initial?.desc || "");
  const [price, setPrice] = useStateM(initial?.price != null ? String(initial.price) : "");
  const [items, setItems] = useStateM(
    initial?.items?.length ? initial.items.map(it => ({ ...it })) : [{ sku: PRODUCTS[0]?.sku || "", qty: 1 }]
  );

  const addItem = () => setItems(prev => [...prev, { sku: PRODUCTS[0]?.sku || "", qty: 1 }]);
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const updateItem = (i, field, val) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it));

  const retailTotal = items.reduce((s, it) => {
    const p = PRODUCTS.find(x => x.sku === it.sku);
    return s + (p ? p.price * it.qty : 0);
  }, 0);
  const discount = retailTotal > 0 && Number(price) > 0 ? Math.round((1 - Number(price) / retailTotal) * 100) : 0;
  const canSave = name.trim() && items.length > 0 && items.every(it => it.sku && it.qty > 0) && Number(price) > 0;

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "90%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>{isEdit ? "แก้ไขชุดสินค้า" : "สร้างชุดสินค้าใหม่"}</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>เลือกสินค้าจากคลังและกำหนดราคาชุด</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ชื่อชุดสินค้า *</div>
            <input className="m-input" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น ชุดสกินแคร์ยอดนิยม"/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>คำอธิบาย</div>
            <input className="m-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="อธิบายสั้นๆ"/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>สินค้าในชุด ({items.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item, i) => {
                const eq = (typeof getEffectiveQty === "function") ? getEffectiveQty(item.sku) : 0;
                return (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--surface-2)" }}>
                    <select className="m-input" value={item.sku} onChange={e => updateItem(i, "sku", e.target.value)} style={{ marginBottom: 8, fontSize: 12 }}>
                      {PRODUCTS.map(p => <option key={p.sku} value={p.sku}>{p.name}</option>)}
                    </select>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>คงเหลือ <strong style={{ color: eq === 0 ? "var(--danger)" : "var(--fg)" }}>{eq}</strong> ชิ้น</span>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="qty-stepper">
                          <button onClick={() => updateItem(i, "qty", Math.max(1, item.qty - 1))}>−</button>
                          <input value={item.qty} onChange={e => updateItem(i, "qty", Math.max(1, parseInt(e.target.value) || 1))} style={{ width: 34, fontSize: 12 }}/>
                          <button onClick={() => updateItem(i, "qty", item.qty + 1)}>+</button>
                        </div>
                        <button className="m-action" style={{ width: 34, height: 34, background: "var(--danger-soft)", color: "var(--danger)", opacity: items.length === 1 ? 0.4 : 1 }} disabled={items.length === 1} onClick={() => removeItem(i)}>
                          <Icons.Trash size={13}/>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="m-btn-big" style={{ marginTop: 8, background: "var(--surface-2)", color: "var(--fg)" }} onClick={addItem}>
              <Icons.Plus size={15}/> เพิ่มสินค้าในชุด
            </button>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ราคาขายชุด (฿) *</div>
            <input className="m-input" type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="เช่น 1180"/>
            {retailTotal > 0 && Number(price) > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                ราคาปกติรวม ฿{retailTotal.toLocaleString()}
                {discount > 0
                  ? <span style={{ color: "var(--success)", marginLeft: 6 }}>ลด {discount}%</span>
                  : <span style={{ color: "var(--warning)", marginLeft: 6 }}>สูงกว่าราคาแยกชิ้น</span>}
              </div>
            )}
          </div>
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn-big" disabled={!canSave} style={!canSave ? { opacity: 0.5 } : {}}
            onClick={() => canSave && onSave({ name: name.trim(), desc: desc.trim(), price: Number(price), items })}>
            <Icons.Check size={16}/> {isEdit ? "บันทึกการแก้ไข" : "สร้างชุดสินค้า"}
          </button>
        </div>
      </div>
    </>
  );
}

/* =============== MORE =============== */

function MMore({ ctx }) {
  const items = [
    { id: "analytics", icon: Icons.Dash,  label: "วิเคราะห์ยอดขาย", sub: "รายได้ ต้นทุน กำไร และสินค้าขายดี" },
    { id: "stocktake", icon: Icons.Scan,  label: "ตรวจนับสต็อก",    sub: "นับสินค้าจริงเทียบกับระบบ แล้วปรับให้ตรง" },
    { id: "bundles",   icon: Icons.Bundle, label: "ชุดสินค้า",       sub: "สร้างและจัดการชุดสินค้า" },
    { id: "tracking",  icon: Icons.Truck, label: "ติดตามพัสดุ",     sub: "เลขพัสดุ ขนส่ง และสถานะ" },
    { id: "locations", icon: Icons.Map,   label: "ตำแหน่งจัดเก็บ",  sub: "แผนผังคลังและการใช้พื้นที่" },
    { id: "labels",    icon: Icons.Tag,   label: "พิมพ์ฉลากจัดส่ง", sub: "สร้าง แก้ไข และพิมพ์ฉลาก" },
    { id: "import",    icon: Icons.Pkg,   label: "นำเข้า SKU",      sub: "อัปโหลดจาก Excel/CSV" },
    { id: "catalog",   icon: Icons.Scan,  label: "แคตตาล็อกอ้างอิง", sub: "ดูสินค้าทั้งหมด แยกตามแบรนด์" },
    { id: "history",   icon: Icons.History, label: "ประวัติการแก้ไข", sub: "บันทึกการเปลี่ยนแปลงทั้งหมด" },
    { id: "users",     icon: Icons.Help,  label: "ผู้ใช้งานและสิทธิ์", sub: "จัดการบัญชีผู้ใช้และบทบาท" },
    { id: "settings",  icon: Icons.Setting, label: "ตั้งค่าร้านค้า",  sub: "โลโก้ ข้อมูลผู้ส่ง" }
  ];
  const user = ctx.user || { name: "สมชาย ภูมิดี", avatar: "สม", role: "manager" };
  const role = (typeof ROLES !== "undefined" ? ROLES.find(r => r.id === user.role) : null) || { label: "หัวหน้าคลัง", color: "oklch(0.7 0.05 250)" };
  return (
    <>
      <div className="m-topbar">
        <div className="m-title">เพิ่มเติม</div>
      </div>
      <div className="m-content">
        <div className="m-card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: role.color, color: "white", display: "grid", placeItems: "center", fontWeight: 600, flexShrink: 0 }}>{user.avatar || user.name?.slice(0,2)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{role.label}{user.email ? " · " + user.email : ""}</div>
          </div>
        </div>

        <div className="m-list">
          {items.map(it => {
            const I = it.icon;
            return (
              <button key={it.id} className="m-row" onClick={() => ctx.push(it.id)}>
                <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--accent)" }}><I size={18}/></div>
                <div className="m-row-main">
                  <div className="m-row-title">{it.label}</div>
                  <div className="m-row-sub">{it.sub}</div>
                </div>
                <Icons.Chev size={14} className="m-row-chev"/>
              </button>
            );
          })}
        </div>

        {ctx.onLogout && (
          <>
            <div className="m-section-label" style={{ padding: "8px 4px" }}>บัญชี</div>
            <div className="m-list">
              <button className="m-row" onClick={() => { if (confirm("ออกจากระบบ?")) ctx.onLogout(); }}>
                <div className="m-row-thumb" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icons.Door size={16}/></div>
                <div className="m-row-main">
                  <div className="m-row-title" style={{ color: "var(--danger)" }}>ออกจากระบบ</div>
                  <div className="m-row-sub">{user.email}</div>
                </div>
              </button>
            </div>
          </>
        )}

        <div className="m-section-label" style={{ padding: "8px 4px" }}>เกี่ยวกับ</div>
        <div className="m-list">
          <div className="m-row" style={{ cursor: "default" }}>
            <div className="m-row-main">
              <div className="m-row-title" style={{ fontSize: 13 }}>เวอร์ชัน</div>
              <div className="m-row-sub">2.6.0 (Build 2026.05.19)</div>
            </div>
          </div>
          <div className="m-row" style={{ cursor: "default" }}>
            <div className="m-row-main">
              <div className="m-row-title" style={{ fontSize: 13 }}>การซิงค์</div>
              <div className="m-row-sub">เชื่อมต่อกับคลังเดียวกับเดสก์ท็อป</div>
            </div>
            <span className="badge badge-success"><span className="dot"/>ออนไลน์</span>
          </div>
        </div>
      </div>
    </>
  );
}

/* =============== REFERENCE CATALOG (browse by brand) =============== */

function MCatalog({ ctx }) {
  const [catalog, setCatalog] = useStateM(() => typeof loadWooCatalog === "function" ? loadWooCatalog() : {});
  const [q, setQ] = useStateM("");
  const [brandFilter, setBrandFilter] = useStateM(""); // "" = all
  const [showN, setShowN] = useStateM(60);
  useEffectM(() => {
    const h = () => setCatalog(typeof loadWooCatalog === "function" ? loadWooCatalog() : {});
    window.addEventListener("ims-woo-catalog-change", h);
    return () => window.removeEventListener("ims-woo-catalog-change", h);
  }, []);

  const catList = useMemoM(() => Object.keys(catalog).map(k => catalog[k]), [catalog]);
  // Brand of an entry: stored brand wins, else guess from SKU prefix. "อื่นๆ" = unknown.
  const brandOf = (e) => (e.brand && e.brand.trim())
    || (typeof guessBrandFromSku === "function" ? guessBrandFromSku(e.sku) : "")
    || "อื่นๆ";
  const brands = useMemoM(() => {
    const m = {};
    catList.forEach(e => { const b = brandOf(e); m[b] = (m[b] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a]).map(name => ({ name, count: m[name] }));
  }, [catList]);
  const filtered = useMemoM(() => {
    const s = q.trim().toLowerCase();
    return catList.filter(e => {
      if (brandFilter && brandOf(e) !== brandFilter) return false;
      if (s && !((e.sku || "").toLowerCase().includes(s) || (e.name || "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [catList, q, brandFilter]);

  const resetPage = () => setShowN(60);

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">แคตตาล็อกอ้างอิง</div>
        <div style={{ width: 32 }}/>
      </div>
      <div className="m-content">
        {catList.length === 0 ? (
          <div className="m-card" style={{ padding: 28, textAlign: "center" }}>
            <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              ยังไม่มีแคตตาล็อกอ้างอิง<br/>นำเข้าไฟล์ WooCommerce จากหน้าเดสก์ท็อปก่อน
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "0 4px 8px" }}>
              <strong className="tnum" style={{ color: "var(--fg)" }}>{catList.length.toLocaleString()}</strong> รายการ
              {brandFilter && <> · กรอง <strong style={{ color: "var(--fg)" }}>{brandFilter}</strong> ({filtered.length.toLocaleString()})</>}
            </div>

            {/* Brand filter chips — horizontally scrollable */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0 0 10px", WebkitOverflowScrolling: "touch" }}>
              {[{ name: "", count: catList.length }, ...brands].map(b => {
                const active = brandFilter === b.name;
                return (
                  <button key={b.name || "__all"} onClick={() => { setBrandFilter(b.name); resetPage(); }}
                    style={{
                      fontSize: 12, padding: "6px 12px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                      border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
                      background: active ? "var(--accent)" : "var(--surface-2)",
                      color: active ? "#fff" : "var(--fg-2)", fontWeight: active ? 600 : 500
                    }}>
                    {b.name || "ทั้งหมด"} <span style={{ opacity: 0.7 }}>({b.count.toLocaleString()})</span>
                  </button>
                );
              })}
            </div>

            <div className="m-search">
              <Icons.Search size={16} style={{ color: "var(--muted)" }}/>
              <input value={q} onChange={e => { setQ(e.target.value); resetPage(); }} placeholder="ค้นหา SKU หรือชื่อสินค้า..."/>
            </div>

            <div className="m-list">
              {filtered.slice(0, showN).map((e, i) => {
                const inStock = PRODUCTS.some(p => p.sku.toLowerCase() === (e.sku || "").toLowerCase());
                return (
                  <div key={e.sku || i} className="m-row" style={{ cursor: "default" }}>
                    <ProductImageThumb sku={e.sku} size={40} radius={8}/>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name || "—"}</div>
                      <div className="m-row-sub mono">{e.sku} · {brandOf(e)}{e.price ? " · ฿" + e.price.toLocaleString() : ""}</div>
                    </div>
                    {inStock
                      ? <span className="badge badge-success" style={{ flexShrink: 0 }}>ในคลัง</span>
                      : <span className="badge badge-neutral" style={{ flexShrink: 0 }}>อ้างอิง</span>}
                  </div>
                );
              })}
              {filtered.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่พบรายการที่ตรงกับเงื่อนไข</div>}
            </div>

            {filtered.length > showN && (
              <button className="m-btn-big" style={{ marginTop: 12 }} onClick={() => setShowN(n => n + 60)}>
                ดูเพิ่ม — แสดง {Math.min(showN, filtered.length).toLocaleString()} จาก {filtered.length.toLocaleString()}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* =============== LOCATIONS =============== */

function MLocations({ ctx }) {
  const [tree, setTree] = useStateM(loadLocTree);
  useEffectM(() => {
    const h = () => setTree(loadLocTree());
    window.addEventListener("ims-locations-change", h);
    window.addEventListener("ims-products-change", h);
    return () => {
      window.removeEventListener("ims-locations-change", h);
      window.removeEventListener("ims-products-change", h);
    };
  }, []);

  const buildings = (tree && tree.buildings) || [];
  const allowDelete = typeof canDeleteData === "function" ? canDeleteData() : true;
  const posCount = buildings.reduce((s, b) => s + (b.floors || []).reduce((t, f) => t + (f.positions || []).length, 0), 0);

  const addBtn = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--accent)", fontWeight: 600 };
  const delBtn = { display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)" };

  const askB = () => { const n = prompt("ชื่ออาคาร / โซน (เช่น สภ.)"); if (n && n.trim()) addBuilding(n.trim()); };
  const askF = (b) => { const n = prompt(`เพิ่มชั้นใน "${b}" (เช่น ชั้น 3)`); if (n && n.trim()) addFloor(b, n.trim()); };
  const askP = (b, f) => { const n = prompt(`เพิ่มตำแหน่งใน ${b} · ${f} (เช่น A1)`); if (n && n.trim()) addPosition(b, f, n.trim()); };
  const editB = (b) => { const n = prompt("เปลี่ยนชื่ออาคาร", b); if (n && n.trim() && n.trim() !== b) renameBuilding(b, n.trim()); };
  const tapPos = (b, f, p) => {
    if (!allowDelete) return;
    if (confirm(`ลบตำแหน่ง ${p}?`)) removePosition(b, f, p);
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ตำแหน่งจัดเก็บ</div>
        <button className="m-action accent" onClick={askB} title="เพิ่มอาคาร"><Icons.Plus size={14}/></button>
      </div>
      <div className="m-content">
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "2px 2px 8px" }}>
          {buildings.length} อาคาร · {posCount} ตำแหน่ง
        </div>

        {buildings.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            <Icons.Map size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
            <div>ยังไม่มีอาคาร — แตะ + เพื่อเพิ่ม</div>
          </div>
        )}

        {buildings.map(b => (
          <div key={b.name} className="m-card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="row" style={{ gap: 6 }} onClick={() => editB(b.name)}>
                <Icons.Map size={14}/>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{b.name}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button style={addBtn} onClick={() => askF(b.name)}><Icons.Plus size={12}/> ชั้น</button>
                {allowDelete && <button style={delBtn} onClick={() => { if (confirm(`ลบอาคาร "${b.name}" และทุกชั้น/ตำแหน่ง?`)) removeBuilding(b.name); }}><Icons.Trash size={13}/></button>}
              </div>
            </div>
            {(b.floors || []).length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>ยังไม่มีชั้น</div>}
            {(b.floors || []).map(f => (
              <div key={f.name} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{f.name} <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}>· {(f.positions || []).length} ตำแหน่ง</span></div>
                  <div className="row" style={{ gap: 6 }}>
                    <button style={addBtn} onClick={() => askP(b.name, f.name)}><Icons.Plus size={12}/> ตำแหน่ง</button>
                    {allowDelete && <button style={delBtn} onClick={() => { if (confirm(`ลบ ${f.name}?`)) removeFloor(b.name, f.name); }}><Icons.Trash size={12}/></button>}
                  </div>
                </div>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {(f.positions || []).length === 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>— ยังไม่มีตำแหน่ง —</span>}
                  {(f.positions || []).map(p => {
                    const code = locCode(b.name, f.name, p);
                    const n = typeof skusInLocation === "function" ? skusInLocation(code) : 0;
                    return (
                      <div key={p} onClick={() => tapPos(b.name, f.name, p)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}>
                        <span className="mono" style={{ fontWeight: 600 }}>{p}</span>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{n} SKU</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}

        <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 12, fontSize: 11, color: "var(--muted)", display: "flex", gap: 10, alignItems: "center" }}>
          <Icons.Refresh size={14}/>
          <span>แตะตำแหน่งเพื่อลบ · แตะชื่ออาคารเพื่อแก้ไข · SKU คำนวณจากสินค้าจริง</span>
        </div>
      </div>
    </>
  );
}

/* =============== LABELS =============== */

function MLabels({ ctx }) {
  const [labels, setLabels] = useStateM(() => typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS);
  useEffectM(() => {
    const refresh = () => setLabels(typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS);
    window.addEventListener("ims-labels-change", refresh);
    return () => window.removeEventListener("ims-labels-change", refresh);
  }, []);

  const createLabel = () => {
    const fresh = (typeof blankLabel === "function") ? blankLabel() : { id: "L" + Date.now(), soId: "", recipient: { name: "", addr1: "", addr2: "", phone: "" }, items: [], weight: "", carrier: "", box: "" };
    const next = [...labels, fresh];
    if (typeof saveLabels === "function") saveLabels(next); else setLabels(next);
    ctx.push("label-edit", fresh);
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ฉลากจัดส่ง</div>
        <button className="m-action accent" onClick={createLabel}><Icons.Plus size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-card" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>คิวพิมพ์</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2 }} className="tnum">{labels.length}</div>
          </div>
          <button className="m-btn-big" style={{ width: "auto", padding: "12px 16px" }} onClick={createLabel}>
            <Icons.Plus size={14}/> สร้างฉลาก
          </button>
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>รายการฉลาก</div>
        <div className="m-list">
          {labels.map(l => (
            <button key={l.id} className="m-row" onClick={() => ctx.push("label-view", l)}>
              <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--accent)" }}><Icons.Tag size={16}/></div>
              <div className="m-row-main">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{l.soId || "ฉลากใหม่"}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{(l.carrier || "").split(" ")[0]}</span>
                </div>
                <div className="m-row-sub">{l.recipient.name || "ยังไม่ระบุผู้รับ"} · {l.items.length} รายการ · {l.weight || "—"}</div>
              </div>
              <Icons.Chev size={14} className="m-row-chev"/>
            </button>
          ))}
          {labels.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <Icons.Tag size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
              <div>ยังไม่มีฉลาก — แตะ + เพื่อสร้าง</div>
            </div>
          )}
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>ขนาดฉลาก</div>
        <div className="m-list">
          {LABEL_SIZES.map(s => (
            <div key={s.id} className="m-row" style={{ cursor: "default" }}>
              <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--fg-2)", fontSize: 9, fontWeight: 600, lineHeight: 1.1, textAlign: "center" }}>{s.w}<br/>×{s.h}</div>
              <div className="m-row-main">
                <div className="m-row-title">{s.label}</div>
                <div className="m-row-sub">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function MLabelView({ ctx }) {
  const [tick, setTick] = useStateM(0);
  const [pdfLoading, setPdfLoading] = useStateM(false);
  const paperRef = useRefM(null);
  useEffectM(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener("ims-labels-change", refresh);
    return () => window.removeEventListener("ims-labels-change", refresh);
  }, []);
  const param = ctx.route.params;
  const all = useMemoM(() => typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS, [tick]);
  const l = all.find(x => x.id === param.id) || param;
  const store = (() => {
    if (window._DB_STORE) return { ...DEFAULT_STORE, ...window._DB_STORE };
    try { return { ...DEFAULT_STORE, ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch { return DEFAULT_STORE; }
  })();
  const size = LABEL_SIZES[0]; // 100x150

  const downloadPDF = async () => {
    if (typeof exportLabelPDF !== "function") { ctx.pushToast("ฟังก์ชัน PDF ยังไม่พร้อม"); return; }
    const el = paperRef.current ? paperRef.current.querySelector(".label-paper") : null;
    setPdfLoading(true);
    try {
      await exportLabelPDF(el, size, l.soId, ctx.pushToast, 4);
    } catch (e) {
      ctx.pushToast("สร้าง PDF ไม่สำเร็จ: " + (e.message || e));
    }
    setPdfLoading(false);
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">{l.soId || "ฉลากใหม่"}</div>
        <button className="m-action" onClick={() => ctx.push("label-edit", l)}><Icons.Edit size={14}/></button>
      </div>
      <div className="m-content">
        <div style={{ display: "grid", placeItems: "center", padding: "10px 0 18px" }}>
          <div ref={paperRef} style={{ transform: "scale(0.7)", transformOrigin: "center top" }}>
            <LabelPaper label={l} size={size} store={store}/>
          </div>
        </div>
        <div style={{ marginTop: -80 }}>
          <button className="m-btn-big" onClick={downloadPDF} disabled={pdfLoading} style={pdfLoading ? { opacity: 0.7 } : {}}>
            <Icons.Print size={16}/> {pdfLoading ? "กำลังสร้าง PDF…" : "ส่งออก PDF"}
          </button>
        </div>
      </div>
    </>
  );
}

/* =============== LABEL EDITOR (mobile) =============== */

function MLabelEdit({ ctx }) {
  const param = ctx.route.params;
  const [label, setLabel] = useStateM(() => {
    const all = typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS;
    const found = all.find(x => x.id === param.id);
    return found ? { ...found, recipient: { ...found.recipient } } : { ...param, recipient: { ...param.recipient } };
  });
  const [pasteText, setPasteText] = useStateM("");
  const [pasteOpen, setPasteOpen] = useStateM(false);
  const [aiLoading, setAiLoading] = useStateM(false);

  const setRecip = (k, v) => setLabel(l => ({ ...l, recipient: { ...l.recipient, [k]: v } }));
  const setField = (k, v) => setLabel(l => ({ ...l, [k]: v }));
  const setSender = (k, v) => setLabel(l => ({ ...l, sender: { ...(l.sender || {}), [k]: v } }));

  /* paste auto-split — local gazetteer parser (same parser as desktop) */
  const applyParse = async () => {
    if (typeof ensureThaiAddrIndex === "function") { try { await ensureThaiAddrIndex(); } catch (e) {} }
    const parsed = (typeof parseRecipientBlob === "function") ? parseRecipientBlob(pasteText) : {};
    if (!parsed.name && !parsed.phone && !parsed.addr1) { ctx.pushToast("ไม่พบข้อมูลที่จะคัดแยก"); return; }
    setLabel(l => ({ ...l, recipient: {
      name: parsed.name || l.recipient.name,
      phone: parsed.phone || l.recipient.phone,
      addr1: parsed.addr1 || l.recipient.addr1,
      addr2: parsed.addr2 || l.recipient.addr2,
    }}));
    setPasteText(""); setPasteOpen(false);
    const hasAddr = parsed.addr1 || parsed.addr2;
    ctx.pushToast(!hasAddr ? "คัดแยกข้อมูลแล้ว"
      : parsed.addrConfidence === "high" ? "คัดแยกแล้ว · ✓ ตรงรหัสไปรษณีย์"
      : "คัดแยกแล้ว · ที่อยู่อาจไม่ครบ ลอง AI");
  };

  /* paste auto-split — AI (Edge Function, same as desktop) */
  const applyPasteAI = async () => {
    if (!pasteText.trim()) return;
    setAiLoading(true);
    try {
      const { data: { session } } = await authGetSession();
      if (!session) throw new Error("กรุณาเข้าสู่ระบบใหม่");
      const r = await fetch(SUPABASE_FUNC_URL + "/parse-recipient", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
        body: JSON.stringify({ text: pasteText })
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "parse failed");
      setLabel(l => ({ ...l, recipient: {
        name: j.name || l.recipient.name,
        phone: j.phone || l.recipient.phone,
        addr1: j.addr1 || l.recipient.addr1,
        addr2: j.addr2 || l.recipient.addr2,
      }}));
      setPasteText(""); setPasteOpen(false);
      ctx.pushToast("AI คัดแยกข้อมูลแล้ว");
    } catch (e) {
      ctx.pushToast("AI คัดแยกไม่สำเร็จ: " + e.message);
    } finally {
      setAiLoading(false);
    }
  };

  const save = () => {
    if (!label.recipient.name.trim()) { ctx.pushToast("ยังไม่ได้ระบุชื่อผู้รับ"); return; }
    const all = typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS;
    const exists = all.some(x => x.id === label.id);
    const next = exists ? all.map(x => x.id === label.id ? label : x) : [...all, label];
    if (typeof saveLabels === "function") saveLabels(next);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "label", entityId: label.soId || label.id, action: exists ? "update" : "create",
        summary: `${exists ? "แก้ไข" : "สร้าง"}ฉลากจัดส่ง ${label.soId || label.id} (มือถือ)`,
        changes: [{ label: "ผู้รับ", to: label.recipient.name }, { label: "ขนส่ง", to: label.carrier || "—" }]
      });
    }
    ctx.pushToast(`บันทึกฉลาก ${label.soId || label.recipient.name} แล้ว`);
    ctx.back();
  };

  const del = () => {
    if (!confirm("ลบฉลากนี้?")) return;
    const all = typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS;
    const next = all.filter(x => x.id !== label.id);
    if (typeof saveLabels === "function") saveLabels(next);
    ctx.pushToast("ลบฉลากแล้ว");
    ctx.switchTab("more");
    ctx.push("labels");
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.X size={14}/></button>
        <div className="m-title-sub">{label.soId || "ฉลากใหม่"}</div>
        <button className="m-action accent" onClick={save}><Icons.Check size={14}/></button>
      </div>
      <div className="m-content">
        {/* SO number */}
        <div className="m-section-label" style={{ padding: "0 4px 6px" }}>เลขออร์เดอร์ (SO)</div>
        <input className="m-input mono" value={label.soId} onChange={e => setField("soId", e.target.value)} placeholder="เช่น SO-2024-1140" style={{ marginBottom: 12 }}/>

        {/* paste auto-split */}
        <div style={{ marginBottom: 12, padding: 12, background: "var(--surface-2)", borderRadius: 12, border: "1px dashed var(--border)" }}>
          <button onClick={() => setPasteOpen(o => !o)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--fg)", fontFamily: "inherit" }}>
            <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--fg-2)" }}><Icons.Spark size={13}/> วางข้อมูลผู้รับ</span>
            <Icons.Chev size={14} style={{ transform: pasteOpen ? "rotate(90deg)" : "none", color: "var(--muted)" }}/>
          </button>
          {pasteOpen && (
            <>
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={"วางที่อยู่ทั้งก้อนที่นี่ เช่น\nคุณสมชาย ใจดี 081-234-5678\n123/45 ถนนสุขุมวิท แขวงคลองเตย..."}
                style={{ width: "100%", minHeight: 78, padding: 10, marginTop: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", fontFamily: "inherit", fontSize: 13, resize: "vertical", color: "var(--fg)", boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" style={{ flex: 1, justifyContent: "center", ...(!pasteText.trim() ? { opacity: 0.5 } : {}) }} onClick={applyParse} disabled={!pasteText.trim()}>
                  <Icons.Spark size={13}/> คัดแยก
                </button>
                <button className="btn btn-sm" style={{ flex: 1, justifyContent: "center", ...((!pasteText.trim() || aiLoading) ? { opacity: 0.5 } : {}) }} onClick={applyPasteAI} disabled={!pasteText.trim() || aiLoading}>
                  <Icons.Spark size={13}/> {aiLoading ? "กำลังคัดแยก..." : "ด้วย AI"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* recipient fields */}
        <div className="m-section-label" style={{ padding: "0 4px 6px" }}>ผู้รับ</div>
        <input className="m-input" value={label.recipient.name} onChange={e => setRecip("name", e.target.value)} placeholder="ชื่อ-นามสกุล" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={label.recipient.addr1} onChange={e => setRecip("addr1", e.target.value)} placeholder="ที่อยู่ (บรรทัด 1)" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={label.recipient.addr2} onChange={e => setRecip("addr2", e.target.value)} placeholder="ที่อยู่ (บรรทัด 2)" style={{ marginBottom: 8 }}/>
        <input className="m-input mono" value={label.recipient.phone} onChange={e => setRecip("phone", e.target.value)} placeholder="โทรศัพท์" style={{ marginBottom: 12 }}/>

        {/* sender (ผู้ส่ง) — defaults to store settings; pick/save profiles */}
        <div className="m-section-label" style={{ padding: "0 4px 6px" }}>ผู้ส่ง</div>
        {typeof SenderPicker === "function" && <SenderPicker mobile current={label.sender || {}} onPick={s => setLabel(l => ({ ...l, sender: { ...(l.sender || {}), ...s } }))}/>}
        <input className="m-input" value={(label.sender || {}).name || ""} onChange={e => setSender("name", e.target.value)} placeholder="ชื่อ / บริษัท (ผู้ส่ง)" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={(label.sender || {}).addr1 || ""} onChange={e => setSender("addr1", e.target.value)} placeholder="ที่อยู่ผู้ส่ง (บรรทัด 1)" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={(label.sender || {}).addr2 || ""} onChange={e => setSender("addr2", e.target.value)} placeholder="ที่อยู่ผู้ส่ง (บรรทัด 2)" style={{ marginBottom: 8 }}/>
        <input className="m-input mono" value={(label.sender || {}).phone || ""} onChange={e => setSender("phone", e.target.value)} placeholder="โทรศัพท์ผู้ส่ง" style={{ marginBottom: 12 }}/>

        {/* weight + box */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>น้ำหนัก</div>
            <input className="m-input" value={label.weight} onChange={e => setField("weight", e.target.value)} placeholder="0.45 กก."/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>กล่อง</div>
            <input className="m-input" value={label.box || ""} onChange={e => setField("box", e.target.value)} placeholder="กล่อง A"/>
          </div>
        </div>

        {/* carrier */}
        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>ขนส่ง</div>
        <div className="m-list" style={{ marginBottom: 12 }}>
          {CARRIERS.map(c => (
            <button key={c.id} className={"m-row" + (label.carrier === c.name ? " selected" : "")} onClick={() => setField("carrier", c.name)}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color, flexShrink: 0 }}/>
              <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
              {label.carrier === c.name && <Icons.Check size={14} style={{ color: "var(--accent)" }}/>}
            </button>
          ))}
        </div>

        <button className="m-btn-big" onClick={save} style={{ marginBottom: 8 }}><Icons.Check size={16}/> บันทึกฉลาก</button>
        <button className="m-btn-big" onClick={del} style={{ background: "var(--danger-soft)", color: "var(--danger)" }}><Icons.Trash size={16}/> ลบฉลาก</button>
      </div>
    </>
  );
}

/* =============== IMPORT =============== */

function MImport({ ctx }) {
  const fileRef = useRefM(null);
  const [preview, setPreview] = useStateM(null); // null | { fileName, rows:[{sku,name,...,_existing}] }

  // field → keywords used to fuzzy-match the spreadsheet header (mirrors desktop IMPORT_FIELDS)
  const FIELDS = [
    { key: "sku",      kw: ["sku", "รหัส"] },
    { key: "name",     kw: ["ชื่อสินค้า", "ชื่อ", "name"] },
    { key: "cat",      kw: ["หมวดหมู่", "หมวด", "cat"] },
    { key: "loc",      kw: ["ตำแหน่ง", "loc"] },
    { key: "price",    kw: ["ราคาขาย", "ราคา", "price"] },
    { key: "qty",      kw: ["จำนวน", "qty"] },
    { key: "reorder",  kw: ["จุดสั่งซื้อ", "reorder"] },
    { key: "supplier", kw: ["ผู้จัดส่ง", "supplier"] },
    { key: "cost",     kw: ["ต้นทุน", "cost"] }
  ];

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (typeof XLSX === "undefined") { ctx.pushToast("ไลบรารี Excel ยังไม่พร้อม"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (json.length < 2) { ctx.pushToast("ไฟล์ว่างเปล่าหรือไม่มีข้อมูล"); return; }
        const hdrs = json[0].map(h => String(h).trim().toLowerCase());
        const map = {};
        FIELDS.forEach(field => {
          const idx = hdrs.findIndex(h => field.kw.some(k => h.includes(k.toLowerCase())));
          if (idx >= 0) map[field.key] = idx;
        });
        if (map.sku === undefined || map.name === undefined) {
          ctx.pushToast("ไม่พบคอลัมน์ SKU หรือชื่อสินค้า"); return;
        }
        const rows = json.slice(1)
          .filter(r => r.some(c => String(c).trim() !== ""))
          .map(r => {
            const o = {};
            FIELDS.forEach(field => { if (map[field.key] !== undefined) o[field.key] = r[map[field.key]]; });
            return o;
          })
          .filter(o => String(o.sku || "").trim() && String(o.name || "").trim())
          .map(o => {
            const sku = String(o.sku).trim().toUpperCase();
            return {
              sku, name: String(o.name).trim(),
              cat: String(o.cat || "ทั่วไป").trim(),
              loc: String(o.loc || "").trim().toUpperCase(),
              price: parseFloat(o.price) || 0,
              qty: parseInt(o.qty) || 0,
              reorder: parseInt(o.reorder) || 0,
              supplier: String(o.supplier || "").trim(),
              cost: parseFloat(o.cost) || 0,
              _existing: PRODUCTS.some(p => p.sku.toUpperCase() === sku)
            };
          });
        if (!rows.length) { ctx.pushToast("ไม่พบแถวที่นำเข้าได้"); return; }
        setPreview({ fileName: f.name, rows });
      } catch (err) {
        ctx.pushToast("อ่านไฟล์ไม่สำเร็จ: " + err.message);
      }
    };
    reader.readAsArrayBuffer(f);
    e.target.value = ""; // allow re-selecting the same file
  };

  const doImport = () => {
    if (!preview) return;
    let added = 0, updated = 0;
    preview.rows.forEach(r => {
      const { _existing, ...product } = r;
      if (_existing) { updateProductInStore(product.sku, product); updated++; }
      else { addProductToStore({ ...product, reserved: 0 }); added++; }
    });
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", action: "import",
        summary: `นำเข้าสินค้าจากไฟล์ ${preview.fileName} (มือถือ) — เพิ่ม ${added}, อัปเดต ${updated}`,
      });
    }
    ctx.pushToast(`นำเข้าสำเร็จ — เพิ่ม ${added}, อัปเดต ${updated} รายการ`);
    setPreview(null);
  };

  const downloadTemplate = () => {
    if (typeof XLSX === "undefined") { ctx.pushToast("ไลบรารี Excel ยังไม่พร้อม"); return; }
    const wb = XLSX.utils.book_new();
    const aoa = [
      ["SKU *", "ชื่อสินค้า *", "หมวดหมู่", "ตำแหน่ง", "ราคา", "จำนวน", "จุดสั่งซื้อ", "ผู้จัดส่ง"],
      ["TH-NEW-101", "ตัวอย่างสินค้า", "เสื้อผ้า", "A-01-01", 290, 100, 30, "ผู้จัดส่ง A"]
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, "สินค้า");
    XLSX.writeFile(wb, "เทมเพลตนำเข้าสินค้า.xlsx");
    ctx.pushToast("ดาวน์โหลดเทมเพลตแล้ว");
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">นำเข้า SKU</div>
        <div style={{ width: 30 }}/>
      </div>
      <div className="m-content">
        <div className="m-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 999, background: "var(--fg)", color: "var(--bg)", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 13 }}>1</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>ดาวน์โหลดเทมเพลต</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>เทมเพลต Excel มาพร้อมแถวตัวอย่าง</div>
          <button className="m-btn-big dark" onClick={downloadTemplate}>
            <Icons.Pkg size={16}/> ดาวน์โหลด .xlsx
          </button>
        </div>

        <div className="m-card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 999, background: "var(--fg)", color: "var(--bg)", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 13 }}>2</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>อัปโหลดไฟล์</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>รองรับ .xlsx และ .csv</div>
          <div onClick={() => fileRef.current?.click()} style={{ border: "1.5px dashed var(--border-strong)", borderRadius: 12, padding: 20, textAlign: "center", cursor: "pointer", background: "var(--surface-2)" }}>
            <Icons.Pkg size={28} style={{ color: "var(--muted)", marginBottom: 8 }}/>
            <div style={{ fontSize: 13, fontWeight: 500 }}>คลิกเพื่อเลือกไฟล์</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>หรือถ่ายรูปบันทึก SKU ใหม่</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} style={{ display: "none" }}/>
        </div>

        {preview && (
          <div className="m-card" style={{ borderColor: "var(--accent)" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="row" style={{ gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 999, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 13 }}>3</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>ตรวจสอบและยืนยัน</div>
              </div>
              <button className="m-action" onClick={() => setPreview(null)}><Icons.X size={14}/></button>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              {preview.fileName} · พบ {preview.rows.length} รายการ ·
              เพิ่มใหม่ {preview.rows.filter(r => !r._existing).length} · อัปเดต {preview.rows.filter(r => r._existing).length}
            </div>
            <div className="m-list" style={{ maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
              {preview.rows.slice(0, 30).map((r, i) => (
                <div key={i} className="m-row" style={{ cursor: "default" }}>
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                    <div className="m-row-sub mono">{r.sku} · {r.qty} ชิ้น · ฿{r.price}</div>
                  </div>
                  <span className={"badge " + (r._existing ? "badge-info" : "badge-success")} style={{ fontSize: 9 }}><span className="dot"/>{r._existing ? "อัปเดต" : "ใหม่"}</span>
                </div>
              ))}
              {preview.rows.length > 30 && <div style={{ padding: "8px 4px", textAlign: "center", color: "var(--muted)", fontSize: 11 }}>และอีก {preview.rows.length - 30} รายการ</div>}
            </div>
            <button className="m-btn-big" onClick={doImport}>
              <Icons.Check size={16}/> นำเข้า {preview.rows.length} รายการ
            </button>
          </div>
        )}

        <div style={{ padding: 14, background: "var(--info-soft)", color: "var(--info)", borderRadius: 12, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>💡 เคล็ดลับ</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--fg-2)" }}>
            <li>ใช้เทมเพลตเพื่อความถูกต้อง</li>
            <li>SKU ห้ามซ้ำกับที่มีอยู่</li>
            <li>นำเข้าครั้งละไม่เกิน 5,000 แถว</li>
          </ul>
        </div>
      </div>
    </>
  );
}

/* =============== SETTINGS =============== */

function MSettings({ ctx }) {
  const [store, setStore] = useStateM(() => {
    // Cloud copy (synced via store_settings) wins so mobile + desktop share one set.
    if (window._DB_STORE) return { ...DEFAULT_STORE, ...window._DB_STORE };
    try { return { ...DEFAULT_STORE, ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch { return DEFAULT_STORE; }
  });
  const fileRef = useRefM(null);
  const save = (next) => {
    setStore(next);
    try { localStorage.setItem("ims_store", JSON.stringify(next)); } catch (e) {}
    // Sync to Supabase so desktop + other devices pick it up. Write is admin/manager
    // only under RLS; fire-and-forget, mirrors the desktop store save in app.jsx.
    if (window.dbSaveStoreSettings) dbSaveStoreSettings(next).catch(() => {});
  };
  // Re-render when another device saves store settings (realtime → ims-store-change).
  useEffectM(() => {
    const h = () => { if (window._DB_STORE) setStore({ ...DEFAULT_STORE, ...window._DB_STORE }); };
    window.addEventListener("ims-store-change", h);
    return () => window.removeEventListener("ims-store-change", h);
  }, []);
  const [soundOn, setSoundOn] = useStateM(() => {
    try { return localStorage.getItem("ims_scan_sound") !== "off"; } catch (e) { return true; }
  });
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem("ims_scan_sound", next ? "on" : "off"); } catch (e) {}
    if (next && typeof playScanBeep === "function") playScanBeep(); // preview the beep when turning on
  };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith("image/")) return;
    const r = new FileReader();
    r.onload = () => { save({ ...store, logo: r.result }); ctx.pushToast("อัปโหลดโลโก้แล้ว"); };
    r.readAsDataURL(f);
  };
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ตั้งค่าร้านค้า</div>
        <button className="m-action accent" onClick={() => ctx.pushToast("บันทึกแล้ว")}><Icons.Check size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>โลโก้</div>
        <div className="m-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 16 }}>
          <StoreLogoMark store={store} size={56}/>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{store.logo ? "โลโก้พร้อมใช้งาน" : "ยังไม่มีโลโก้"}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>PNG, JPG, SVG · สูงสุด 2 MB</div>
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><Icons.Refresh size={11}/> {store.logo ? "เปลี่ยน" : "อัปโหลด"}</button>
              {store.logo && <button className="btn btn-sm btn-danger" onClick={() => save({ ...store, logo: null })}><Icons.Trash size={11}/></button>}
            </div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }}/>

        <div className="m-section-label" style={{ padding: "8px 4px 8px" }}>สำรองข้อมูล</div>
        <button className="m-btn-big outline" onClick={async () => {
          try {
            if (typeof downloadBackup !== "function") throw new Error("ยังไม่พร้อม");
            const counts = await downloadBackup();
            const total = Object.values(counts).reduce((s, n) => s + n, 0);
            ctx.pushToast(`ดาวน์โหลดไฟล์สำรองแล้ว · ${total} รายการ`);
          } catch (e) { ctx.pushToast("สำรองไม่สำเร็จ: " + ((e && e.message) || e)); }
        }}><Icons.Down size={16}/> ดาวน์โหลดไฟล์สำรอง (.json)</button>
        <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 4px 0" }}>เก็บไฟล์ไว้ หรืออัปโหลดเข้า Google Drive · ตั้งค่าสำรองอัตโนมัติได้ที่เดสก์ท็อป</div>

        <div className="m-section-label" style={{ padding: "8px 4px 8px" }}>ข้อมูลร้าน</div>
        <div className="stack" style={{ gap: 8 }}>
          <SettingField label="ชื่อร้าน" value={store.name} onChange={v => save({ ...store, name: v })}/>
          <SettingField label="คำอธิบายสั้น" value={store.tagline} onChange={v => save({ ...store, tagline: v })}/>
        </div>

        <div className="m-section-label" style={{ padding: "16px 4px 8px" }}>ที่อยู่ผู้ส่ง</div>
        <div className="stack" style={{ gap: 8 }}>
          <SettingField label="ชื่อ / บริษัท" value={store.sender.name} onChange={v => save({ ...store, sender: { ...store.sender, name: v } })}/>
          <SettingField label="บรรทัด 1" value={store.sender.addr1} onChange={v => save({ ...store, sender: { ...store.sender, addr1: v } })}/>
          <SettingField label="บรรทัด 2" value={store.sender.addr2} onChange={v => save({ ...store, sender: { ...store.sender, addr2: v } })}/>
          <SettingField label="โทรศัพท์" value={store.sender.phone} onChange={v => save({ ...store, sender: { ...store.sender, phone: v } })}/>
        </div>

        <div className="m-section-label" style={{ padding: "16px 4px 8px" }}>เสียง</div>
        <div className="m-row" style={{ cursor: "pointer", border: "1px solid " + (soundOn ? "var(--accent)" : "var(--border)"), borderRadius: 12, background: "var(--surface)" }} onClick={toggleSound}>
          <div className="m-row-thumb" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icons.Scan size={16}/></div>
          <div className="m-row-main">
            <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>เสียงบี๊บเมื่อสแกนสินค้า</div>
            <div className="m-row-sub">{soundOn ? "เปิดอยู่ — มีเสียงยืนยันตอนสแกน" : "ปิดอยู่ — สแกนแบบเงียบ"}</div>
          </div>
          <span className={"check" + (soundOn ? " on" : "")} style={{ flexShrink: 0 }}/>
        </div>

        <div className="m-section-label" style={{ padding: "16px 4px 8px" }}>เวลาทำการ</div>
        <MWorkHoursCard store={store} save={save}/>

        <div className="m-section-label" style={{ padding: "16px 4px 8px" }}>แจ้งเตือน LINE</div>
        <MLineAlertRow ctx={ctx}/>
      </div>
    </>
  );
}

/* Mobile working-hours config — mirrors the desktop WorkHoursCard. Restricts the
   selected roles to a per-weekday schedule; enforcement lives in app.jsx Root. */
function MWorkHoursCard({ store, save }) {
  const fallback = { enabled: false, roles: ["staff", "viewer"], days: {} };
  const wh = store.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : fallback);
  const dayLabels = (typeof WORKHOURS_DAY_LABELS !== "undefined") ? WORKHOURS_DAY_LABELS
    : ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const cur = () => store.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : fallback);
  const patchWH = (patch) => save({ ...store, workHours: { ...cur(), ...patch } });
  const patchDay = (d, patch) => {
    const c = cur();
    const prev = (c.days && c.days[d]) || { on: false, open: "08:00", close: "18:00" };
    save({ ...store, workHours: { ...c, days: { ...c.days, [d]: { ...prev, ...patch } } } });
  };
  const toggleRole = (r) => {
    const c = cur();
    const roles = c.roles || [];
    save({ ...store, workHours: { ...c, roles: roles.includes(r) ? roles.filter(x => x !== r) : [...roles, r] } });
  };
  const ROLE_CHOICES = (typeof ROLES !== "undefined" ? ROLES : []).filter(r => r.id !== "admin");
  const selRoles = wh.roles || [];

  return (
    <div className="m-card" style={{ padding: 14 }}>
      <div className="m-row" style={{ cursor: "pointer", padding: 0 }} onClick={() => patchWH({ enabled: !wh.enabled })}>
        <div className="m-row-thumb" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icons.Refresh size={16}/></div>
        <div className="m-row-main">
          <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>จำกัดเวลาเข้าใช้งาน</div>
          <div className="m-row-sub">{wh.enabled ? "เปิดอยู่ — บทบาทที่เลือกเข้าได้เฉพาะเวลาทำการ" : "ปิดอยู่ — เข้าใช้งานได้ตลอดเวลา"}</div>
        </div>
        <span className={"check" + (wh.enabled ? " on" : "")} style={{ flexShrink: 0 }}/>
      </div>

      {wh.enabled && (
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>บทบาทที่ถูกจำกัด (ผู้ดูแลระบบเข้าได้เสมอ)</div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {ROLE_CHOICES.map(r => {
                const on = selRoles.includes(r.id);
                return (
                  <button key={r.id} type="button" onClick={() => toggleRole(r.id)}
                    className={"badge " + (on ? "badge-info" : "badge-neutral")}
                    style={{ cursor: "pointer", border: "1px solid " + (on ? "var(--accent)" : "var(--border)"), padding: "6px 10px", fontSize: 12 }}>
                    {on ? "✓ " : ""}{r.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 0].map(d => {
              const day = (wh.days && wh.days[d]) || { on: false, open: "08:00", close: "18:00" };
              return (
                <div key={d} className="row" style={{ gap: 8, padding: "8px 10px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <span className={"check" + (day.on ? " on" : "")} onClick={() => patchDay(d, { on: !day.on })} style={{ flexShrink: 0 }}/>
                  <div style={{ width: 52, fontSize: 12.5, fontWeight: 500 }}>{dayLabels[d]}</div>
                  {day.on ? (
                    <div className="row" style={{ gap: 6, alignItems: "center", flex: 1 }}>
                      <input type="time" value={day.open} onChange={e => patchDay(d, { open: e.target.value })}
                        style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", background: "var(--surface)", color: "var(--fg)", fontFamily: "inherit", fontSize: 13 }}/>
                      <span style={{ color: "var(--muted)" }}>–</span>
                      <input type="time" value={day.close} onChange={e => patchDay(d, { close: e.target.value })}
                        style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", background: "var(--surface)", color: "var(--fg)", fontFamily: "inherit", fontSize: 13 }}/>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", flex: 1 }}>วันหยุด</div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
            ตรวจเวลาจากเซิร์ฟเวอร์เพื่อกันการแก้นาฬิกาเครื่อง — รัน <code>supabase/create-server-now.sql</code> หนึ่งครั้งใน Supabase
          </div>
        </div>
      )}
    </div>
  );
}

/* Mobile LINE integration — test the daily push (line-alert) and preview the
   chatbot reports (line-bot) against real data. Admin only. */
function MLineAlertRow({ ctx }) {
  const [testing, setTesting] = useStateM(false);
  const [preview, setPreview] = useStateM(null);
  const run = async () => {
    setTesting(true);
    const { data, error } = await lineTest();
    setTesting(false);
    if (error) { ctx.pushToast("LINE: " + error); return; }
    ctx.pushToast(data?.sent ? "ส่งข้อความทดสอบไป LINE แล้ว ✓" : "เชื่อมต่อ LINE สำเร็จ");
  };
  const runPreview = async (cmd, label) => {
    setPreview({ cmd: label, loading: true });
    const { data, error } = await lineBotPreview(cmd);
    setPreview({ cmd: label, text: error ? "⚠️ " + error : (data?.text || "(ไม่มีข้อมูล)") });
  };
  const CMDS = [
    { cmd: "ของต่ำ", label: "ของต่ำ" },
    { cmd: "สต็อก", label: "สต็อกรวม" },
    { cmd: "ออเดอร์", label: "ออเดอร์" },
    { cmd: "ยอดขาย", label: "ยอดขาย" },
  ];
  return (
    <div className="m-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>รายงานผ่าน LINE</div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, lineHeight: 1.6 }}>
        แจ้งเตือนสต็อกต่ำอัตโนมัติทุกวัน + แชตบอตถามรายงานได้ทันที (ตอบกลับฟรี)
      </div>
      <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={run} disabled={testing}>
        <Icons.Bell size={12}/> {testing ? "กำลังส่ง…" : "ทดสอบ push"}
      </button>
      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 14, marginBottom: 6 }}>ดูตัวอย่างรายงานของบอท</div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {CMDS.map(c => (
          <button key={c.cmd} className="btn btn-sm" onClick={() => runPreview(c.cmd, c.label)}>{c.label}</button>
        ))}
      </div>
      {preview && (
        <pre style={{ marginTop: 10, padding: 12, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "var(--fg)" }}>
          {preview.loading ? "กำลังโหลด…" : preview.text}
        </pre>
      )}
    </div>
  );
}

function SettingField({ label, value, onChange }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", border: "none", outline: "none", background: "transparent", fontSize: 14, marginTop: 2, fontFamily: "inherit", color: "var(--fg)" }}/>
    </div>
  );
}

/* =============== ANALYTICS (mobile) =============== */

const M_PERIODS = [
  { id: "today", label: "วันนี้",     barLabel: "ชั่วโมง" },
  { id: "week",  label: "สัปดาห์นี้", barLabel: "วัน" },
  { id: "month", label: "เดือนนี้",   barLabel: "วัน" },
  { id: "year",  label: "ปีนี้",      barLabel: "เดือน" }
];
const mFmt = (n) => Math.round(n).toLocaleString("th-TH");
const mMoney = (n) => "฿" + Math.round(n).toLocaleString("th-TH");

function MAnalytics({ ctx }) {
  const [period, setPeriod] = useStateM("month");
  const [open, setOpen] = useStateM(null);
  const [metric, setMetric] = useStateM("orders"); // orders (real now) | revenue
  const [pv, setPv] = useStateM(0);
  const def = M_PERIODS.find(p => p.id === period);

  // Live recompute when products OR orders change (mirrors desktop AnalyticsPage).
  useEffectM(() => {
    const refresh = () => setPv(v => v + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-orders-change", refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
    };
  }, []);

  // Aggregate REAL orders — same logic as the desktop วิเคราะห์ยอดขาย page:
  // order volume per bucket + by channel (works now) and per-product
  // revenue/units from lineItems (sale-time price snapshot). Bucketed by each
  // order's real date/time (Bangkok local) via the shared buildAnalyticsWindow.
  const agg = useMemoM(() => {
    const todayIso = (typeof _todayBkkIso === "function") ? _todayBkkIso()
      : (typeof bangkokDateStr === "function" ? bangkokDateStr() : new Date().toISOString().slice(0, 10));
    const win = (typeof buildAnalyticsWindow === "function")
      ? buildAnalyticsWindow(period, todayIso)
      : { bars: 1, labels: [""], barIndex: () => 0, inPrev: () => false };
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
      if (inCur) {
        ordChart[bi] += 1; totalOrders += 1;
        const ch = (o.channel || "").trim() || "ไม่ระบุ";
        channelMap.set(ch, (channelMap.get(ch) || 0) + 1);
      }
      if (inPrev) prevOrders += 1;
      if (!Array.isArray(o.lineItems) || !o.lineItems.length) continue;
      for (const li of o.lineItems) {
        const qty = Number(li && li.qty) || 0;
        if (!qty) continue;
        const p = pmap.get(li.sku);
        const price = (li && li.price != null) ? (Number(li.price) || 0) : (p ? (Number(p.price) || 0) : 0);
        const unitCost = (li && li.cost != null) ? (Number(li.cost) || 0) : costOf(p);
        if (inPrev) prevRevenue += qty * price;
        if (!inCur) continue;
        let a = perSku.get(li.sku);
        if (!a) { a = { units: 0, revenue: 0, costTotal: 0, series: new Array(win.bars).fill(0) }; perSku.set(li.sku, a); }
        a.units += qty; a.revenue += qty * price; a.costTotal += qty * unitCost; a.series[bi] += qty;
        revChart[bi] += qty * price;
      }
    }

    const rows = PRODUCTS.map(p => {
      const a = perSku.get(p.sku) || { units: 0, revenue: 0, costTotal: 0, series: new Array(win.bars).fill(0) };
      const profit = a.revenue - a.costTotal;
      const margin = a.revenue > 0 ? profit / a.revenue : 0;
      return { ...p, costPrice: costOf(p), series: a.series, units: a.units, revenue: a.revenue, costTotal: a.costTotal, profit, margin };
    }).sort((x, y) => y.revenue - x.revenue);

    const chMeta = (name) => (typeof CHANNEL_LIST !== "undefined" ? CHANNEL_LIST.find(c => c.name === name) : null);
    const channelRows = [...channelMap.entries()]
      .map(([name, count]) => ({ name, count, color: (chMeta(name) || {}).color || "var(--muted)" }))
      .sort((a, b) => b.count - a.count);

    return { data: rows, revChart, ordChart, prevRevenue, totalOrders, prevOrders, channelRows, barLabels: win.labels };
  }, [period, pv]);

  const { data, revChart, ordChart, prevRevenue, totalOrders, prevOrders, channelRows, barLabels } = agg;

  const total = data.reduce((acc, p) => ({
    units: acc.units + p.units, revenue: acc.revenue + p.revenue,
    cost: acc.cost + p.costTotal, profit: acc.profit + p.profit
  }), { units: 0, revenue: 0, cost: 0, profit: 0 });
  const totalMargin = total.revenue > 0 ? total.profit / total.revenue : 0;
  const revDelta = total.revenue - prevRevenue;
  const revPct = prevRevenue > 0 ? (revDelta / prevRevenue) * 100 : 0;
  const ordDelta = totalOrders - prevOrders;
  const ordPct = prevOrders > 0 ? (ordDelta / prevOrders) * 100 : 0;
  const isRev = metric === "revenue";
  const chart = isRev ? revChart : ordChart;
  const chartMax = Math.max(...chart, 1);

  const exportCsv = () => {
    const rows = [["สินค้า", "SKU", "ขายได้", "ยอดขาย", "กำไร", "มาร์จิ้น%"]];
    data.forEach(p => rows.push([p.name, p.sku, p.units, Math.round(p.revenue), Math.round(p.profit), (p.margin * 100).toFixed(1)]));
    const csv = "﻿" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "analytics.csv"; a.click();
    URL.revokeObjectURL(url);
    ctx.pushToast("ส่งออก CSV แล้ว");
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">วิเคราะห์ยอดขาย</div>
        <button className="m-action" onClick={exportCsv}><Icons.Pkg size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
          {M_PERIODS.map(p => (
            <button key={p.id} className={"m-chip" + (period === p.id ? " on" : "")} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>

        <div className="m-kpi-row">
          <div className="m-kpi">
            <div className="m-kpi-label">ออร์เดอร์</div>
            <div className="m-kpi-value" style={{ fontSize: 18 }}>{mFmt(totalOrders)}</div>
            <div style={{ fontSize: 10, marginTop: 2, color: ordDelta >= 0 ? "var(--success)" : "var(--danger)" }}>
              {ordDelta >= 0 ? "▲" : "▼"} {prevOrders > 0 ? Math.abs(ordPct).toFixed(0) + "%" : "—"} · ก่อนหน้า {mFmt(prevOrders)}
            </div>
          </div>
          <div className="m-kpi">
            <div className="m-kpi-label">ยอดขาย</div>
            <div className="m-kpi-value" style={{ fontSize: 18 }}>{mMoney(total.revenue)}</div>
            <div style={{ fontSize: 10, marginTop: 2, color: total.revenue > 0 ? (revDelta >= 0 ? "var(--success)" : "var(--danger)") : "var(--muted)" }}>
              {total.revenue > 0 ? `${revDelta >= 0 ? "▲" : "▼"} ${Math.abs(revPct).toFixed(1)}% เทียบช่วงก่อน` : "ยังไม่มีข้อมูลรายสินค้า"}
            </div>
          </div>
          <div className="m-kpi">
            <div className="m-kpi-label">กำไรขั้นต้น</div>
            <div className="m-kpi-value" style={{ fontSize: 18, color: total.profit > 0 ? "var(--success)" : "var(--fg)" }}>{mMoney(total.profit)}</div>
            <div style={{ fontSize: 10, marginTop: 2, color: "var(--muted)" }}>{total.revenue > 0 ? `มาร์จิ้น ${(totalMargin * 100).toFixed(1)}%` : "—"}</div>
          </div>
          <div className="m-kpi">
            <div className="m-kpi-label">จำนวนที่ขาย</div>
            <div className="m-kpi-value" style={{ fontSize: 18 }}>{mFmt(total.units)}</div>
            <div style={{ fontSize: 10, marginTop: 2, color: "var(--muted)" }}>{data.filter(p => p.units > 0).length} SKU มียอดขาย</div>
          </div>
        </div>

        <div className="m-card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{isRev ? "ยอดขาย" : "จำนวนออร์เดอร์"}ตาม{def.barLabel}</div>
            <div className="seg" style={{ transform: "scale(0.88)", transformOrigin: "right center" }}>
              <button className={!isRev ? "on" : ""} onClick={() => setMetric("orders")}>ออร์เดอร์</button>
              <button className={isRev ? "on" : ""} onClick={() => setMetric("revenue")}>ยอดขาย</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>{def.label} · หน่วย: {isRev ? "บาท" : "ออร์เดอร์"}</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120 }}>
            {chart.map((v, i) => (
              <div key={i} title={isRev ? mMoney(v) : `${mFmt(v)} ออร์เดอร์`} style={{
                flex: 1,
                height: Math.max(2, (v / chartMax) * 100) + "%",
                background: "linear-gradient(180deg, var(--accent), oklch(0.55 0.18 38))",
                borderRadius: "3px 3px 0 0"
              }}/>
            ))}
          </div>
        </div>

        <div className="m-card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>ออร์เดอร์ตามช่องทาง</div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{mFmt(totalOrders)} ออร์เดอร์</span>
          </div>
          {channelRows.length === 0
            ? <div style={{ padding: "10px 0", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ยังไม่มีออร์เดอร์ในช่วงนี้</div>
            : channelRows.map(c => {
                const pct = totalOrders > 0 ? (c.count / totalOrders) * 100 : 0;
                return (
                  <div key={c.name} className="row" style={{ gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color, flexShrink: 0 }}/>
                    <span style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <div className="prog" style={{ width: 70 }}><span style={{ width: pct + "%" }}/></div>
                    <span className="tnum" style={{ fontSize: 12, fontWeight: 600, width: 26, textAlign: "right" }}>{c.count}</span>
                  </div>
                );
              })}
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>สินค้าขายดี</div>
        <div className="m-list">
          {data.map((p, i) => {
            const isOpen = open === p.sku;
            const margin = p.margin * 100;
            const tone = margin >= 50 ? "var(--success)" : margin >= 30 ? "var(--info)" : margin >= 15 ? "var(--warning)" : "var(--danger)";
            return (
              <div key={p.sku} style={{ borderTop: i ? "1px solid var(--border)" : "none" }}>
                <button className="m-row" style={{ borderTop: "none", width: "100%" }} onClick={() => setOpen(isOpen ? null : p.sku)}>
                  <span style={{ width: 20, textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--muted)", flexShrink: 0 }}>{i + 1}</span>
                  <ProductImageThumb sku={p.sku} size={34} radius={7}/>
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="m-row-sub mono">{p.sku} · ขาย {p.units} ชิ้น</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{mMoney(p.revenue)}</div>
                    <div className="tnum" style={{ fontSize: 10, color: tone, fontWeight: 500 }}>{margin.toFixed(1)}%</div>
                  </div>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 14px 12px", background: "var(--surface-2)" }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56, padding: "10px 0 8px" }}>
                      {p.series.map((v, j) => {
                        const max = Math.max(...p.series, 1);
                        return <div key={j} title={`${v} ชิ้น`} style={{ flex: 1, height: Math.max(2, v / max * 100) + "%", background: "var(--accent)", borderRadius: "2px 2px 0 0", opacity: v === 0 ? 0.15 : 1 }}/>;
                      })}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                      <MSumCell label="สต็อกเหลือ" value={p.qty + " ชิ้น"}/>
                      <MSumCell label="กำไร/ชิ้น" value={"฿" + mFmt(p.price - p.costPrice)}/>
                      <MSumCell label="กำไรรวม" value={mMoney(p.profit)} accent/>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function MSumCell({ label, value, accent }) {
  return (
    <div style={{ padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 9 }}>
      <div style={{ fontSize: 9, color: "var(--muted)" }}>{label}</div>
      <div className="tnum" style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: accent ? "var(--success)" : "var(--fg)" }}>{value}</div>
    </div>
  );
}

/* =============== STOCK TAKE / CYCLE COUNT (mobile) =============== */
function MStockTake({ ctx }) {
  const [counts, setCounts] = useStateM(loadStockTake);
  const [q, setQ] = useStateM("");
  const [camOpen, setCamOpen] = useStateM(false);
  const [tick, setTick] = useStateM(0);

  useEffectM(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener("ims-products-change", refresh);
    return () => window.removeEventListener("ims-products-change", refresh);
  }, []);

  const setCount = (sku, val) => {
    setCounts(prev => {
      const next = { ...prev };
      if (val === "" || val == null) delete next[sku];
      else next[sku] = String(val).replace(/[^\d]/g, "");
      saveStockTake(next);
      return next;
    });
  };
  const bump = (sku, d) => {
    const cur = parseInt(counts[sku] || "0", 10) || 0;
    setCount(sku, Math.max(0, cur + d));
  };

  const submit = (override) => {
    const code = (override ?? "").trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast("ไม่พบ SKU: " + code); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    const cur = parseInt(counts[p.sku] || "0", 10) || 0;
    setCount(p.sku, cur + 1);
    setQ(p.sku);
    ctx.pushToast(`${p.sku} · นับ ${cur + 1}`);
  };

  const rows = useMemoM(() => {
    const lq = q.trim().toLowerCase();
    return PRODUCTS.filter(p => !lq || p.sku.toLowerCase().includes(lq) || (p.name || "").toLowerCase().includes(lq));
  }, [q, tick]);

  const summary = useMemoM(() => {
    let counted = 0, disc = 0, net = 0;
    Object.keys(counts).forEach(sku => {
      const p = PRODUCTS.find(x => x.sku === sku);
      if (!p || counts[sku] === "") return;
      counted++; const v = (parseInt(counts[sku], 10) || 0) - p.qty;
      if (v !== 0) disc++; net += v;
    });
    return { counted, disc, net };
  }, [counts, tick]);

  const changeList = useMemoM(() => {
    const list = [];
    Object.keys(counts).forEach(sku => {
      const p = PRODUCTS.find(x => x.sku === sku);
      if (!p || counts[sku] === "") return;
      const to = parseInt(counts[sku], 10) || 0;
      if (to !== p.qty) list.push({ sku, name: p.name, from: p.qty, to, delta: to - p.qty });
    });
    return list;
  }, [counts, tick]);

  const save = () => {
    if (!changeList.length) { ctx.pushToast("ไม่มีส่วนต่าง — สต็อกตรงกับระบบ"); return; }
    const net = changeList.reduce((s, c) => s + c.delta, 0);
    if (!confirm(`ยืนยันปรับสต็อก ${changeList.length} SKU?\nสุทธิ ${net >= 0 ? "+" : ""}${net} ชิ้น`)) return;
    const changes = (typeof applyStockCounts === "function") ? applyStockCounts(counts) : [];
    if (typeof recordChange === "function" && changes.length) {
      recordChange({
        entity: "product", action: "update",
        summary: `ตรวจนับสต็อก (มือถือ) — ปรับ ${changes.length} SKU (สุทธิ ${net >= 0 ? "+" : ""}${net} ชิ้น)`,
        count: changes.length,
        changes: changes.map(c => ({ label: c.sku, to: `${c.from} → ${c.to} ชิ้น (${c.delta >= 0 ? "+" : ""}${c.delta})` }))
      });
    }
    setCounts({}); saveStockTake({});
    ctx.pushToast(`ปรับสต็อกแล้ว ${changes.length} SKU`);
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ตรวจนับสต็อก</div>
        <button className="m-action accent" onClick={save} disabled={!changeList.length} style={!changeList.length ? { opacity: 0.4 } : {}}><Icons.Check size={16}/></button>
      </div>
      <div className="m-content">
        <div className="m-kpi-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="m-kpi"><div className="m-kpi-label">นับแล้ว</div><div className="m-kpi-value" style={{ fontSize: 18 }}>{summary.counted}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">ส่วนต่าง</div><div className="m-kpi-value" style={{ fontSize: 18, color: summary.disc ? "var(--warning)" : "var(--success)" }}>{summary.disc}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">สุทธิ</div><div className="m-kpi-value" style={{ fontSize: 18, color: summary.net > 0 ? "var(--info)" : summary.net < 0 ? "var(--danger)" : "var(--fg)" }}>{summary.net > 0 ? "+" : ""}{summary.net}</div></div>
        </div>

        {!camOpen && <button className="m-btn-big dark" style={{ marginBottom: 12 }} onClick={() => setCamOpen(true)}><Icons.Camera size={18}/> สแกนเพื่อนับ +1</button>}
        {camOpen && <CameraScanner onScan={code => { submit(code); }} onClose={() => setCamOpen(false)}/>}

        <div className="m-search">
          <Icons.Search size={16} style={{ color: "var(--muted)" }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา SKU หรือชื่อสินค้า..."/>
        </div>

        <div className="m-list">
          {rows.map(p => {
            const raw = counts[p.sku];
            const has = raw !== undefined && raw !== "";
            const v = has ? (parseInt(raw, 10) || 0) - p.qty : null;
            const tone = v === null ? "var(--muted)" : v === 0 ? "var(--success)" : v > 0 ? "var(--info)" : "var(--danger)";
            return (
              <div key={p.sku} style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, background: (v !== null && v !== 0) ? "var(--warning-soft)" : undefined }}>
                <div className="row" style={{ gap: 10 }}>
                  <ProductImageThumb sku={p.sku} size={34} radius={7}/>
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="m-row-sub mono">{p.sku} · ระบบ {p.qty}</div>
                  </div>
                  <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: tone, flexShrink: 0 }}>{v === null ? "" : (v > 0 ? "+" + v : v)}</span>
                </div>
                <div className="row" style={{ gap: 10, justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>นับได้</span>
                  <div className="qty-stepper">
                    <button onClick={() => bump(p.sku, -1)} disabled={!has}>−</button>
                    <input type="number" inputMode="numeric" value={raw ?? ""} onChange={e => setCount(p.sku, e.target.value)} placeholder="—"/>
                    <button onClick={() => bump(p.sku, 1)}>+</button>
                  </div>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่พบสินค้า</div>}
        </div>

        {changeList.length > 0 && <button className="m-btn-big success" style={{ marginTop: 14 }} onClick={save}><Icons.Check size={18}/> บันทึกผลการนับ ({changeList.length} SKU)</button>}
      </div>
    </>
  );
}

/* =============== EDIT HISTORY / AUDIT LOG (mobile) =============== */

function mFormatTime(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

function MHistory({ ctx }) {
  const [logKey, setLogKey] = useStateM(0);
  const [filter, setFilter] = useStateM("all");
  const [q, setQ] = useStateM("");

  const log = useMemoM(() => (typeof loadAuditLog === "function" ? loadAuditLog() : []), [logKey]);
  useEffectM(() => {
    const refresh = () => setLogKey(k => k + 1);
    window.addEventListener("ims-audit-change", refresh);
    return () => window.removeEventListener("ims-audit-change", refresh);
  }, []);

  const entts = ["all", "product", "bundle", "order", "user"];
  const entLabel = { all: "ทั้งหมด", product: "สินค้า", bundle: "ชุดสินค้า", order: "ออร์เดอร์", user: "ผู้ใช้" };

  const filtered = log.filter(e => {
    if (filter !== "all" && e.entity !== filter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const hay = ((e.summary || "") + " " + (e.entityId || "") + " " + (e.user?.name || "")).toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });

  const clearAll = async () => {
    if (!confirm("ล้างประวัติทั้งหมด?")) return;
    // audit_log DELETE is admin-only under RLS — block others so the DB rows
    // don't survive and re-sync after we clear the local cache.
    const role = (window.__currentUser && window.__currentUser.role) || "staff";
    if (role !== "admin") { ctx.pushToast("ล้างประวัติได้เฉพาะผู้ดูแลระบบ"); return; }
    if (window.dbDeleteAuditLog) {
      const res = await dbDeleteAuditLog();
      if (res && res.error) { ctx.pushToast("ล้างประวัติไม่สำเร็จ"); return; }
    }
    try { localStorage.removeItem("ims_audit_log"); } catch (e) {}
    window._DB_AUDIT_LOG = [];
    window.dispatchEvent(new CustomEvent("ims-audit-change"));
    setLogKey(k => k + 1);
    ctx.pushToast("ล้างประวัติแล้ว");
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ประวัติการแก้ไข</div>
        <button className="m-action" style={{ color: "var(--danger)" }} onClick={clearAll}><Icons.Trash size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-search">
          <Icons.Search size={14}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาในประวัติ..."/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>
        <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
          {entts.map(e => (
            <button key={e} className={"m-chip" + (filter === e ? " on" : "")} onClick={() => setFilter(e)}>{entLabel[e]}</button>
          ))}
        </div>

        <div className="m-list">
          {filtered.map((e, i) => (
            <div key={e.id || i} className="m-row" style={{ cursor: "default", alignItems: "flex-start" }}>
              <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--fg-2)" }}><Icons.History size={15}/></div>
              <div className="m-row-main">
                <div className="m-row-title" style={{ fontSize: 13, whiteSpace: "normal" }}>{e.summary || (e.entityId ? "แก้ไข " + e.entityId : "เปลี่ยนแปลง")}</div>
                {e.changes && e.changes.length > 0 && (
                  <div className="m-row-sub" style={{ whiteSpace: "normal" }}>{e.changes.map(c => c.label + (c.to ? `: ${c.to}` : "")).join(" · ")}</div>
                )}
                {e.note && <div className="m-row-sub" style={{ whiteSpace: "normal", fontStyle: "italic" }}>{e.note}</div>}
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{mFormatTime(e.ts)} · {e.user?.name || "ระบบ"}</div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <Icons.History size={22} style={{ opacity: 0.4, marginBottom: 6 }}/>
              <div>ยังไม่มีประวัติการแก้ไข</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* =============== USERS & PERMISSIONS (mobile) =============== */

function MUsers({ ctx }) {
  // Real users come from Supabase Auth via the admin-only manage-users Edge Function
  // (same source as the desktop "ผู้ใช้งานและสิทธิ์" page) — no more localStorage demo data.
  const [users, setUsers] = useStateM([]);
  const [loading, setLoading] = useStateM(true);
  const [loadError, setLoadError] = useStateM("");
  const [form, setForm] = useStateM(null);  // null=closed, false=invite, obj=edit
  const [busyId, setBusyId] = useStateM(null);
  const [schedOpen, setSchedOpen] = useStateM(false);   // shared schedule editor sheet
  const isAdmin = ctx.user?.role === "admin";

  // ── Working-hours: shared schedule (edited in Settings) + per-user today-only
  //    exceptions, toggled right here. Store is read from the synced cloud copy.
  const [store, setStoreM] = useStateM(() => window._DB_STORE ? { ...DEFAULT_STORE, ...window._DB_STORE } : DEFAULT_STORE);
  useEffectM(() => {
    const h = () => { if (window._DB_STORE) setStoreM({ ...DEFAULT_STORE, ...window._DB_STORE }); };
    window.addEventListener("ims-store-change", h);
    return () => window.removeEventListener("ims-store-change", h);
  }, []);
  const saveStore = (next) => {
    setStoreM(next);
    try { localStorage.setItem("ims_store", JSON.stringify(next)); } catch (e) {}
    if (window.dbSaveStoreSettings) dbSaveStoreSettings(next).catch(() => {});
  };
  const wh = store.workHours;
  const whEnabled = !!(wh && wh.enabled);
  const governedRoles = (wh && wh.roles) || [];
  const isGoverned = (role) => whEnabled && governedRoles.includes(role);
  const today = (typeof bangkokDateStr === "function") ? bangkokDateStr(Date.now()) : "";
  const exceptionActive = (id) => (typeof workHoursExceptionDate === "function") && workHoursExceptionDate(store, id) === today;
  const toggleException = (u) => {
    const cur = store.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : { exceptions: {} });
    const ex = { ...(cur.exceptions || {}) };
    if (ex[u.id] === today) { delete ex[u.id]; ctx.pushToast("ยกเลิกการอนุญาตนอกเวลาแล้ว"); }
    else { ex[u.id] = today; ctx.pushToast("อนุญาตให้ใช้นอกเวลาถึงสิ้นวันนี้"); }
    saveStore({ ...store, workHours: { ...cur, exceptions: ex } });
  };

  const reload = async () => {
    setLoading(true);
    setLoadError("");
    const { data, error } = await manageUsers("list");
    if (error) { setLoadError(error); setLoading(false); return; }
    setUsers(data.users || []);
    setLoading(false);
  };
  useEffectM(() => { reload(); }, []);

  const roleMeta = (rid) => ROLES.find(r => r.id === rid) || ROLES[0];

  // Invite (create) a new member — email invite, role from picker.
  const handleInvite = async (u) => {
    const { data, error } = await manageUsers("invite", {
      name: u.name, email: u.email, role: u.role,
      avatar: u.avatar, redirectTo: window.location.origin,
    });
    if (error) return { error };
    if (data.user) setUsers(us => [...us, data.user]);
    ctx.pushToast(`ส่งอีเมลเชิญไปที่ ${u.email} แล้ว`);
    if (typeof recordChange === "function") recordChange({ entity: "user", entityId: String(data.user?.id || ""), action: "create", summary: `เชิญผู้ใช้ใหม่ ${u.name} (มือถือ)` });
    setForm(null);
    return null;
  };

  // Edit an existing member — only the role can change (name/email are fixed in Auth).
  const handleSetRole = async (u) => {
    const { data, error } = await manageUsers("setRole", { id: u.id, role: u.role });
    if (error) return { error };
    setUsers(us => us.map(x => x.id === u.id ? { ...x, role: data.user?.role || u.role } : x));
    ctx.pushToast("อัปเดตสิทธิ์การใช้งานแล้ว");
    if (typeof recordChange === "function") recordChange({ entity: "user", entityId: String(u.id), action: "update", summary: `แก้ไขสิทธิ์ ${u.name} → ${u.role} (มือถือ)` });
    setForm(null);
    return null;
  };

  const toggleActive = async (u) => {
    if (u.id === ctx.user?.id) { ctx.pushToast("ระงับบัญชีของตัวเองไม่ได้"); return; }
    const next = !u.active;
    setBusyId(u.id);
    const { error } = await manageUsers("setActive", { id: u.id, active: next });
    setBusyId(null);
    if (error) { ctx.pushToast(error); return; }
    setUsers(us => us.map(x => x.id === u.id ? { ...x, active: next } : x));
    ctx.pushToast(next ? "เปิดใช้งานบัญชีแล้ว" : "ระงับบัญชีแล้ว");
  };

  const handleDelete = async (u) => {
    if (u.id === ctx.user?.id) { ctx.pushToast("ลบบัญชีของตัวเองไม่ได้"); return; }
    if (!confirm(`ลบผู้ใช้ ${u.name} ออกจากองค์กร?`)) return;
    setBusyId(u.id);
    const { error } = await manageUsers("delete", { id: u.id });
    setBusyId(null);
    if (error) { ctx.pushToast(error); return; }
    setUsers(us => us.filter(x => x.id !== u.id));
    ctx.pushToast("ลบผู้ใช้แล้ว");
    if (typeof recordChange === "function") recordChange({ entity: "user", entityId: String(u.id), action: "delete", summary: `ลบผู้ใช้ ${u.name} (มือถือ)` });
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ผู้ใช้งานและสิทธิ์</div>
        {isAdmin
          ? <button className="m-action accent" onClick={() => setForm(false)}><Icons.Plus size={18}/></button>
          : <span style={{ width: 36 }}/>}
      </div>
      <div className="m-content">
        <div className="m-kpi-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {ROLES.map(r => (
            <div key={r.id} className="m-kpi">
              <div className="row" style={{ gap: 6, marginBottom: 2 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: r.color }}/>
                <span className="m-kpi-label" style={{ margin: 0 }}>{r.label}</span>
              </div>
              <div className="m-kpi-value" style={{ fontSize: 20 }}>{users.filter(u => u.role === r.id).length}</div>
            </div>
          ))}
        </div>

        {isAdmin && (
          <button className="m-row" style={{ cursor: "pointer", width: "100%", textAlign: "left", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 4 }} onClick={() => setSchedOpen(true)}>
            <div className="m-row-thumb" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icons.History size={16}/></div>
            <div className="m-row-main">
              <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>แก้ไขเวลาทำการ</div>
              <div className="m-row-sub">{whEnabled ? "ตารางใช้ร่วมกัน — ยกเว้นรายคนได้ที่ปุ่มนาฬิกา" : "ปิดอยู่ — แตะเพื่อตั้งเวลาทำการ"}</div>
            </div>
            <Icons.Chev size={16} style={{ color: "var(--muted)", flexShrink: 0 }}/>
          </button>
        )}

        {loadError ? (
          <div className="m-card" style={{ textAlign: "center", color: "var(--danger)", fontSize: 13, padding: 20 }}>
            <div style={{ marginBottom: 10 }}>{loadError}</div>
            <button className="m-action" style={{ width: "auto", padding: "6px 16px", display: "inline-flex", gap: 6, alignItems: "center" }} onClick={reload}>ลองใหม่</button>
          </div>
        ) : loading ? (
          <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 24 }}>กำลังโหลดรายชื่อผู้ใช้…</div>
        ) : (
          <>
            <div className="m-section-label" style={{ padding: "8px 4px" }}>รายชื่อผู้ใช้ · {users.length}</div>
            <div className="m-list">
              {users.map(u => {
                const r = roleMeta(u.role);
                const isBusy = busyId === u.id;
                return (
                  <div key={u.id} className="m-row" style={{ cursor: "default", opacity: isBusy ? 0.5 : (u.active ? 1 : 0.55) }}>
                    <div className="m-row-thumb" style={{ background: r.color, color: "white", fontWeight: 600, fontSize: 12 }}>{u.avatar || u.name.slice(0, 2)}</div>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</div>
                      <div className="row" style={{ gap: 6, marginTop: 2 }}>
                        <span className="badge" style={{ fontSize: 9, padding: "1px 6px", background: r.color + "20", color: r.color }}>{r.label}</span>
                        {!u.active && <span className="badge" style={{ fontSize: 9, padding: "1px 6px", background: "var(--danger-soft)", color: "var(--danger)" }}>ระงับ</span>}
                        {u.invited && u.active && <span className="badge" style={{ fontSize: 9, padding: "1px 6px", background: "var(--warning-soft, #fff3cd)", color: "var(--warning, #997404)" }}>รอเข้าใช้</span>}
                        {isGoverned(u.role) && (exceptionActive(u.id)
                          ? <span className="badge" style={{ fontSize: 9, padding: "1px 6px", background: "var(--info-soft, #e7f0ff)", color: "var(--info, #1d4ed8)" }}>นอกเวลา·วันนี้</span>
                          : <span className="badge" style={{ fontSize: 9, padding: "1px 6px", background: "var(--surface-2)", color: "var(--muted)" }}>จำกัดเวลา</span>)}
                        <span style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
                      </div>
                    </div>
                    {isAdmin && isGoverned(u.role) && (
                      <button className="m-action" style={{ width: 32, height: 32, flexShrink: 0, ...(exceptionActive(u.id) ? { background: "var(--info-soft, #e7f0ff)", color: "var(--info, #1d4ed8)" } : {}) }} disabled={isBusy} onClick={() => toggleException(u)} title="อนุญาต/ยกเลิกการใช้นอกเวลา (วันนี้)">
                        <Icons.History size={13}/>
                      </button>
                    )}
                    {isAdmin && u.id !== ctx.user?.id && (
                      <>
                        <button className="m-action" style={{ width: 32, height: 32, flexShrink: 0 }} disabled={isBusy} onClick={() => toggleActive(u)} title={u.active ? "ระงับบัญชี" : "เปิดใช้งาน"}>
                          <Icons.Lock size={13}/>
                        </button>
                        <button className="m-action" style={{ width: 32, height: 32, flexShrink: 0 }} disabled={isBusy} onClick={() => setForm(u)}><Icons.Edit size={13}/></button>
                        <button className="m-action" style={{ width: 32, height: 32, flexShrink: 0, background: "var(--danger-soft)", color: "var(--danger)" }} disabled={isBusy} onClick={() => handleDelete(u)}><Icons.Trash size={13}/></button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {!isAdmin && (
              <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "12px 4px" }}>
                เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่จัดการผู้ใช้ได้
              </div>
            )}
          </>
        )}
      </div>

      {form !== null && (
        <MUserForm initial={form || null} onClose={() => setForm(null)} onSubmit={form ? handleSetRole : handleInvite}/>
      )}

      {schedOpen && (
        <>
          <div className="m-sheet-backdrop" onClick={() => setSchedOpen(false)}/>
          <div className="m-sheet">
            <div className="m-sheet-grabber"/>
            <div className="m-sheet-head">
              <div>
                <h3>เวลาทำการ</h3>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>ตารางนี้ใช้ร่วมกันทุกคนในบทบาทที่เลือก — ยกเว้นรายบุคคลได้ที่ปุ่มนาฬิกาในรายชื่อ</div>
              </div>
              <button className="m-action" onClick={() => setSchedOpen(false)}><Icons.X size={14}/></button>
            </div>
            <div className="m-sheet-body">
              <MWorkHoursCard store={store} save={saveStore}/>
            </div>
            <div className="m-sheet-foot">
              <button className="m-btn-big" onClick={() => setSchedOpen(false)}><Icons.Check size={16}/> เสร็จสิ้น</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MUserForm({ initial, onClose, onSubmit }) {
  const isEdit = !!initial;
  const [name, setName] = useStateM(initial?.name || "");
  const [email, setEmail] = useStateM(initial?.email || "");
  const [role, setRole] = useStateM(initial?.role || "staff");
  const [loading, setLoading] = useStateM(false);
  const [error, setError] = useStateM("");

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSave = isEdit ? !!role : (name.trim() && emailOk);

  const save = async () => {
    if (!canSave || loading) return;
    setLoading(true);
    setError("");
    const payload = isEdit
      ? { ...initial, role }
      : { name: name.trim(), email: email.trim(), role, avatar: name.trim().slice(0, 2) };
    const result = await onSubmit(payload);
    if (result?.error) { setError(result.error); setLoading(false); }
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={loading ? undefined : onClose}/>
      <div className="m-sheet">
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>{isEdit ? "แก้ไขสิทธิ์ผู้ใช้" : "เชิญสมาชิกใหม่"}</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              {isEdit ? "เปลี่ยนบทบาทการเข้าถึงของสมาชิก" : "ระบบจะส่งอีเมลเชิญให้ตั้งรหัสผ่านและเข้าใช้งานเอง"}
            </div>
          </div>
          <button className="m-action" onClick={onClose} disabled={loading}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ชื่อ-นามสกุล{isEdit ? "" : " *"}</div>
            <input className="m-input" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น สมชาย ภูมิดี" disabled={isEdit} style={isEdit ? { opacity: 0.6 } : {}}/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>อีเมล{isEdit ? "" : " *"}</div>
            <input className="m-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@warehouse.co.th" disabled={isEdit} style={isEdit ? { opacity: 0.6 } : {}}/>
            {!isEdit && email.length > 0 && !emailOk && (
              <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>รูปแบบอีเมลไม่ถูกต้อง</div>
            )}
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>บทบาท</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ROLES.map(r => (
                <button key={r.id} type="button" onClick={() => setRole(r.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                    background: role === r.id ? "var(--accent-soft)" : "var(--surface-2)",
                    border: "1px solid " + (role === r.id ? "var(--accent)" : "var(--border)") }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: r.color, flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)" }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{r.desc}</div>
                  </div>
                  <span className={"check" + (role === r.id ? " on" : "")} style={{ flexShrink: 0 }}/>
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div style={{ padding: "10px 12px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 8, fontSize: 12 }}>{error}</div>
          )}
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn-big" onClick={save} disabled={!canSave || loading} style={(!canSave || loading) ? { opacity: 0.5 } : {}}>
            <Icons.Check size={16}/> {loading ? "กำลังบันทึก…" : (isEdit ? "บันทึกสิทธิ์" : "ส่งคำเชิญ")}
          </button>
        </div>
      </div>
    </>
  );
}

/* Searchable SKU picker for mobile — opens as a bottom sheet */
function MSkuPicker({ value, onChange }) {
  const [open, setOpen] = useStateM(false);
  const [q, setQ] = useStateM("");
  const inputRef = useRefM(null);

  useEffectM(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
    else setQ("");
  }, [open]);

  const current = PRODUCTS.find(p => p.sku === value);
  const filtered = PRODUCTS.filter(p =>
    !q ||
    p.sku.toLowerCase().includes(q.toLowerCase()) ||
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.cat.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          color: "var(--fg)"
        }}
      >
        <div className="m-row-thumb" style={{ fontSize: 10, fontWeight: 600 }}>{current.sku.slice(-3)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.name}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{current.sku} · {current.cat}</div>
        </div>
        <Icons.Search size={14} style={{ color: "var(--muted)", flexShrink: 0 }}/>
      </button>

      {open && (
        <>
          <div className="m-sheet-backdrop" onClick={() => setOpen(false)}/>
          <div className="m-sheet" style={{ maxHeight: "85%" }}>
            <div className="m-sheet-grabber"/>
            <div className="m-sheet-head">
              <h3>เลือกสินค้า</h3>
              <button className="m-action" onClick={() => setOpen(false)}><Icons.X size={14}/></button>
            </div>
            <div style={{ padding: "12px 16px 8px", flexShrink: 0 }}>
              <div className="m-search" style={{ marginBottom: 0 }}>
                <Icons.Search size={14}/>
                <input
                  ref={inputRef}
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder="พิมพ์ SKU, ชื่อ, หรือหมวด"
                />
                {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
              <div className="m-list" style={{ marginBottom: 8 }}>
                {filtered.map(p => {
                  const s = stockStatus(p);
                  const isCurrent = p.sku === value;
                  return (
                    <button
                      key={p.sku}
                      className={"m-row" + (isCurrent ? " selected" : "")}
                      onClick={() => { onChange(p.sku); setOpen(false); }}
                    >
                      <div className="m-row-thumb" style={{ fontSize: 10, fontWeight: 600 }}>{p.sku.slice(-3)}</div>
                      <div className="m-row-main">
                        <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div className="row" style={{ gap: 6, marginTop: 2 }}>
                          <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                          <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>{s.label}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{p.qty}</div>
                        {isCurrent && <Icons.Check size={12} style={{ color: "var(--accent)", marginTop: 2 }}/>}
                      </div>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
                    <div>ไม่พบสินค้าที่ตรงกับ "{q}"</div>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", padding: "4px 0 8px" }}>
                {filtered.length} จาก {PRODUCTS.length} รายการ
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

Object.assign(window, { Handheld, MobileApp });

/* =============== TRACKING (admin sub-view) =============== */

function MTracking({ ctx }) {
  const orders = useOrders();
  const [q, setQ] = useStateM("");
  const [statusFilter, setStatusFilter] = useStateM("all");
  const [selecting, setSelecting] = useStateM(false);
  const [selected, setSelected] = useStateM({});
  const [shareOpen, setShareOpen] = useStateM(false);
  const [bulkMenu, setBulkMenu] = useStateM(null);
  const [slipOpen, setSlipOpen] = useStateM(false);
  const [sortDir, setSortDir] = useStateM("desc"); // วันที่: desc = ใหม่สุดก่อน

  const filtered = orders.filter(o => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const match = (o.id + " " + o.customer + " " + o.phone + " " + o.tracking + " " + o.carrier).toLowerCase().includes(ql);
      if (!match) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const ka = (a.dateIso || "") + " " + (a.ts || "");
    const kb = (b.dateIso || "") + " " + (b.ts || "");
    if (ka === kb) return 0;
    if (ka < kb) return sortDir === "asc" ? -1 : 1;
    return sortDir === "asc" ? 1 : -1;
  });

  const selIds = Object.keys(selected).filter(k => selected[k]);
  const selCount = selIds.length;
  const toggle = (id) => setSelected(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const clear = () => { setSelected({}); setSelecting(false); setBulkMenu(null); };

  const bulkStatus = (status) => { selIds.forEach(id => setOrderField(id, { status })); ctx.pushToast(`อัปเดต ${selCount} ออร์เดอร์`); clear(); };
  const bulkCarrier = (carrier) => { selIds.forEach(id => setOrderField(id, { carrier })); ctx.pushToast(`เปลี่ยนขนส่ง ${selCount} ออร์เดอร์`); clear(); };
  const bulkDelete = async () => { if (!confirm(`ลบ ${selCount} ออร์เดอร์ที่เลือก?`)) return; if (typeof deleteOrdersFromDb === "function") { const res = await deleteOrdersFromDb(selIds); if (res.blocked) { ctx.pushToast("ลบไม่ได้ — เฉพาะแอดมิน/ผู้จัดการเท่านั้น"); return; } } selIds.forEach(id => setOrderField(id, { deleted: true })); ctx.pushToast(`ลบ ${selCount} ออร์เดอร์`); clear(); };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ติดตามพัสดุ</div>
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)}>
          {selecting ? <Icons.X size={14}/> : <Icons.Check size={14}/>}
        </button>
        {!selecting && <button className="m-action accent" onClick={() => setSlipOpen(true)}><Icons.Camera size={14}/></button>}
        {!selecting && <button className="m-action accent" onClick={() => setShareOpen(true)}><Icons.Copy size={14}/></button>}
      </div>
      <div className="m-content">
        <button className="btn btn-primary" style={{ width: "100%", marginBottom: 12, justifyContent: "center", padding: "11px" }} onClick={() => setSlipOpen(true)}>
          <Icons.Camera size={16}/> สแกนสลิปขนส่ง
        </button>
        <div className="m-search">
          <Icons.Search size={14}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ออร์เดอร์ ลูกค้า เบอร์ เลขพัสดุ"/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>

        <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
          <button className={"m-chip" + (statusFilter === "all" ? " on" : "")} onClick={() => setStatusFilter("all")}>ทุกสถานะ</button>
          {TRACK_STAGES.map(s => (
            <button key={s.id} className={"m-chip" + (statusFilter === s.id ? " on" : "")} onClick={() => setStatusFilter(s.id)}>{s.label}</button>
          ))}
        </div>

        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, padding: "0 4px" }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {filtered.length} จาก {orders.length} ออร์เดอร์{selecting && " · แตะเพื่อเลือก"}
          </div>
          <button
            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, color: "var(--accent)", fontWeight: 500 }}
          >
            วันที่ {sortDir === "asc" ? "เก่าสุด ↑" : "ใหม่สุด ↓"}
          </button>
        </div>

        <div className="m-list">
          {sorted.map(o => {
            const idx = stageIndex(o.status);
            const stage = TRACK_STAGES[idx] || TRACK_STAGES[0];
            const carrierMeta = carrierMetaFor(o.carrier);
            const isSelected = !!selected[o.id];
            return (
              <button key={o.id} className={"m-row" + (isSelected ? " selected" : "")} onClick={() => selecting ? toggle(o.id) : ctx.push("track-edit", o)}>
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                <div className="m-row-thumb" style={{ background: carrierMeta.color || "var(--surface-2)", color: carrierMeta.color ? "white" : "var(--fg-2)" }}>
                  <Icons.Truck size={16}/>
                </div>
                <div className="m-row-main">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{o.id}</span>
                    <span className={"badge " + (idx === 3 ? "badge-success" : idx === 2 ? "badge-info" : "badge-warning")} style={{ fontSize: 10 }}>
                      <span className="dot"/>{stage.label}
                    </span>
                  </div>
                  <div className="m-row-sub">{o.customer}</div>
                  <div className="row" style={{ gap: 6, marginTop: 2 }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{o.phone}</span>
                    {o.tracking && <><span style={{ fontSize: 10, color: "var(--muted)" }}>·</span><span className="mono" style={{ fontSize: 10, color: "var(--fg-2)" }}>{o.tracking}</span></>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selecting && selCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selCount}</span>
          <span style={{ fontSize: 12, flex: 1 }}>เลือก {selCount}</span>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkMenu(bulkMenu === "status" ? null : "status")}><Icons.Truck size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkMenu(bulkMenu === "carrier" ? null : "carrier")}><Icons.Tag size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={bulkDelete}><Icons.Trash size={14}/></button>
          {bulkMenu && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 8px)", right: 12, left: 12,
              background: "var(--surface)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 12,
              boxShadow: "var(--shadow-lg)", padding: 6, maxHeight: 260, overflowY: "auto", zIndex: 30
            }}>
              <div style={{ padding: "6px 10px 4px", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>
                {bulkMenu === "status" ? "เปลี่ยนสถานะเป็น" : "เปลี่ยนขนส่งเป็น"}
              </div>
              {bulkMenu === "status" && TRACK_STAGES.map(s => {
                const I = s.icon;
                return (
                  <button key={s.id} className="popover-item" onClick={() => bulkStatus(s.id)}>
                    <I size={13} style={{ color: "var(--muted)" }}/>
                    <span style={{ flex: 1 }}>{s.label}</span>
                  </button>
                );
              })}
              {bulkMenu === "carrier" && CARRIERS.map(c => (
                <button key={c.id} className="popover-item" onClick={() => bulkCarrier(c.name)}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/>
                  <span style={{ flex: 1 }}>{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {shareOpen && <MShareSheet onClose={() => setShareOpen(false)} ctx={ctx}/>}
      {slipOpen && <SlipScanModal onClose={() => setSlipOpen(false)} pushToast={ctx.pushToast}/>}
    </>
  );
}

/* =============== TRACKING EDIT (single order) =============== */

function MTrackEdit({ ctx }) {
  const o = ctx.route.params;
  const [customer, setCustomer] = useStateM(o.customer || "");
  const [phone, setPhone] = useStateM(o.phone || "");
  const [channel, setChannel] = useStateM(o.channel || "");
  const [items, setItems] = useStateM(o.items != null ? String(o.items) : "");
  const [dateIso, setDateIso] = useStateM(o.dateIso || "");
  const [ts, setTs] = useStateM(o.ts || "");
  const [carrier, setCarrier] = useStateM(o.carrier || "");
  const [tracking, setTracking] = useStateM(o.tracking || "");
  const [status, setStatus] = useStateM(o.status);

  const save = () => {
    const fields = { customer, phone, channel, items: parseInt(items) || 0, dateIso, ts, carrier, tracking, status };
    if (typeof saveOrderEdit === "function") saveOrderEdit(o, fields);
    else setOrderField(o.id, fields);
    if (typeof recordChange === "function") {
      recordChange({ entity: "order", entityId: o.id, action: "update", summary: `แก้ไขข้อมูลออร์เดอร์ ${o.id} (มือถือ)` });
    }
    ctx.pushToast(`อัปเดต ${o.id}`);
    ctx.back();
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.X size={14}/></button>
        <div className="m-title-sub mono" style={{ fontSize: 14 }}>{o.id}</div>
        <button className="m-action accent" onClick={save}><Icons.Check size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-section-label" style={{ padding: "0 4px 6px" }}>ข้อมูลลูกค้า / ออร์เดอร์</div>
        <input className="m-input" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="ชื่อลูกค้า / ผู้รับ" style={{ marginBottom: 8 }}/>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <input className="m-input mono" value={phone} onChange={e => setPhone(e.target.value)} placeholder="เบอร์โทร"/>
          <input className="m-input" value={channel} onChange={e => setChannel(e.target.value)} placeholder="ช่องทาง"/>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 4 }}>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>จำนวน</div>
            <input className="m-input" type="number" min="0" value={items} onChange={e => setItems(e.target.value)} placeholder="0"/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>วันที่</div>
            <input className="m-input" type="date" value={dateIso} onChange={e => setDateIso(e.target.value)}/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>เวลา</div>
            <input className="m-input" type="time" value={ts} onChange={e => setTs(e.target.value)}/>
          </div>
        </div>

        <div className="m-section-label" style={{ padding: "12px 4px 8px" }}>ขนส่ง</div>
        <div className="m-list">
          {CARRIERS.map(c => (
            <button key={c.id} className={"m-row" + (carrier === c.name ? " selected" : "")} onClick={() => setCarrier(c.name)}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color, flexShrink: 0 }}/>
              <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
              {carrier === c.name && <Icons.Check size={14} style={{ color: "var(--accent)" }}/>}
            </button>
          ))}
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>เลขพัสดุ</div>
        <input className="m-input mono" value={tracking} onChange={e => setTracking(e.target.value)} placeholder="เช่น TH8842919012" style={{ marginBottom: 6 }}/>

        <div className="m-section-label" style={{ padding: "12px 4px 8px" }}>สถานะการจัดส่ง</div>
        <div className="m-list">
          {TRACK_STAGES.map((s, i) => {
            const I = s.icon;
            const isCurrent = s.id === status;
            return (
              <button key={s.id} className={"m-row" + (isCurrent ? " selected" : "")} onClick={() => setStatus(s.id)}>
                <span className={"check" + (isCurrent ? " on" : "")}/>
                <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: isCurrent ? "var(--accent)" : "var(--muted)" }}>
                  <I size={14}/>
                </div>
                <div className="m-row-main">
                  <div className="m-row-title" style={{ fontSize: 13 }}>{s.label}</div>
                  <div className="m-row-sub">ขั้นที่ {i + 1}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* =============== SHARE-LINK BOTTOM SHEET (mobile) =============== */

function MShareSheet({ onClose, ctx }) {
  const [dateMode, setDateMode] = useStateM("all");
  const [customDate, setCustomDate] = useStateM(TODAY_ISO);
  const [copied, setCopied] = useStateM(false);

  const dateForUrl = dateMode === "today" ? TODAY_ISO : dateMode === "custom" ? customDate : null;
  const url = window.location.origin + window.location.pathname + "#track" + (dateForUrl ? "/" + dateForUrl : "");

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); ctx.pushToast("คัดลอกแล้ว"); setTimeout(() => setCopied(false), 2000); }
    catch (e) { ctx.pushToast("คัดลอกไม่ได้"); }
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "85%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <h3>ลิงก์ค้นหาของลูกค้า</h3>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body">
          <div className="m-section-label" style={{ padding: "0 0 8px" }}>ขอบเขตของลิงก์</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
            {[
              { id: "all", label: "ทุกออร์เดอร์", icon: <Icons.Pkg size={13}/> },
              { id: "today", label: "วันนี้", icon: <Icons.Dot size={13}/> },
              { id: "custom", label: "ระบุวัน", icon: <Icons.Calendar size={13}/> }
            ].map(m => (
              <button key={m.id} className={"m-chip" + (dateMode === m.id ? " on" : "")} onClick={() => setDateMode(m.id)} style={{ justifyContent: "center", padding: "10px 8px", fontSize: 11 }}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
          {dateMode === "custom" && (
            <input type="date" className="m-input" value={customDate} onChange={e => setCustomDate(e.target.value)} style={{ marginBottom: 12 }}/>
          )}

          <div className="m-section-label" style={{ padding: "8px 0" }}>ลิงก์</div>
          <div className="mono" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", fontSize: 11, wordBreak: "break-all", marginBottom: 12 }}>{url}</div>

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
              <QR value={url} size={120}/>
            </div>
          </div>
        </div>
        <div className="m-sheet-foot">
          <button className="m-btn-big" onClick={copy}>
            {copied ? <><Icons.Check size={16}/> คัดลอกแล้ว</> : <><Icons.Copy size={16}/> คัดลอกลิงก์</>}
          </button>
        </div>
      </div>
    </>
  );
}
