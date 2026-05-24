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
      <Screen ctx={ctx}/>
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
  if (route.view === "locations") return <MLocations ctx={ctx}/>;
  if (route.view === "labels")    return <MLabels ctx={ctx}/>;
  if (route.view === "label-view")return <MLabelView ctx={ctx}/>;
  if (route.view === "tracking")  return <MTracking ctx={ctx}/>;
  if (route.view === "track-edit")return <MTrackEdit ctx={ctx}/>;
  if (route.view === "import")    return <MImport ctx={ctx}/>;
  if (route.view === "bundles")   return <MBundles ctx={ctx}/>;
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
  const firstName = (ctx.user?.name || "สมชาย").split(" ")[0];

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">สวัสดี, {firstName}</div>
        <button className="m-action" onClick={() => alert("ไม่มีการแจ้งเตือนใหม่")}><Icons.Bell size={16}/></button>
      </div>
      <div className="m-content">
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, marginTop: -4 }}>วันอังคารที่ 19 พฤษภาคม 2569</div>

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
            <div className="m-kpi-value">32</div>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
          <QuickTile icon={<Icons.In size={20}/>}  label="รับเข้า"  color="oklch(0.96 0.04 150)" fg="oklch(0.4 0.13 150)" onClick={() => ctx.switchTab("inbound")}/>
          <QuickTile icon={<Icons.Out size={20}/>} label="ตัดสต็อก" color="oklch(0.95 0.04 230)" fg="oklch(0.4 0.13 230)" onClick={() => ctx.push("issue")}/>
          <QuickTile icon={<Icons.Tag size={20}/>} label="ฉลาก"    color="oklch(0.96 0.03 310)" fg="oklch(0.4 0.13 310)" onClick={() => ctx.push("labels")}/>
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
  const [received, setReceived] = useStateM([
    { sku: "TH-APP-001", name: "เสื้อยืดคอกลม สีขาว", qty: 80, loc: "A-02-03", t: "09:24" },
    { sku: "TH-HOM-220", name: "หมอนรองคอ Memory Foam", qty: 50, loc: "C-03-02", t: "10:55" }
  ]);
  const [scan, setScan] = useStateM("");
  const [flash, setFlash] = useStateM(null);
  const [camOpen, setCamOpen] = useStateM(false);
  const inputRef = useRefM(null);

  const submit = (override) => {
    const code = (override ?? scan).trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase()) || PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
    setReceived(prev => {
      const i = prev.findIndex(r => r.sku === p.sku);
      const t = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
      if (i > -1) {
        const next = [...prev]; next[i] = { ...next[i], qty: next[i].qty + 1, t };
        return [next[i], ...next.filter((_, j) => j !== i)];
      }
      return [{ sku: p.sku, name: p.name, qty: 1, loc: p.loc, t }, ...prev];
    });
    setFlash(p);
    setTimeout(() => setFlash(null), 1500);
    setScan("");
  };

  const total = received.reduce((s, r) => s + r.qty, 0);

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">รับเข้าสินค้า</div>
        <button className="m-action" onClick={() => alert("ดูประวัติการรับเข้าทั้งหมด")}><Icons.History size={16}/></button>
      </div>
      <div className="m-content">
        <div className="m-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="eyebrow" style={{ fontSize: 10 }}>เอกสาร</div>
              <div className="mono" style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>GR-26051902</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Tech Wave Co.</div>
            </div>
            <span className="badge badge-info"><span className="dot"/>กำลังนับ</span>
          </div>
          <div className="prog" style={{ marginTop: 10 }}>
            <span style={{ width: Math.min(100, total/320*100) + "%", background: "var(--success)" }}/>
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
            <span>นับแล้ว <span className="tnum" style={{ color: "var(--fg)", fontWeight: 500 }}>{total}</span> / 320 ชิ้น</span>
            <span>{received.length} SKU</span>
          </div>
        </div>

        {/* Camera viewfinder — tap to open real camera scanner */}
        <button onClick={() => setCamOpen(true)} style={{ display:"block", width:"100%", background:"#111", borderRadius:16, padding:0, border:"none", cursor:"pointer", marginBottom:12, overflow:"hidden" }}>
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
        </button>
        {camOpen && <CameraScanner onScan={code => { submit(code); setCamOpen(false); }} onClose={() => setCamOpen(false)}/>}

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
          {received.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ยังไม่มีรายการ</div>}
        </div>
      </div>

      <style>{`@keyframes scanline { 0%, 100% { top: 14%; } 50% { top: 86%; } }`}</style>
    </>
  );
}

/* =============== OUTBOUND =============== */

function MOutbound({ ctx }) {
  const tabs = ["ทั้งหมด", "รอหยิบ", "พร้อมส่ง", "ส่งแล้ว"];
  const [tab, setTab] = useStateM(0);
  const [orders, setOrders] = useStateM(OUTBOUND);
  const [selecting, setSelecting] = useStateM(false);
  const [selected, setSelected] = useStateM({});
  const [bulkMenu, setBulkMenu] = useStateM(null);

  useEffectM(() => {
    const pending = window.__pendingSellOrders || [];
    if (pending.length > 0) {
      setOrders(prev => [...pending, ...prev]);
      window.__pendingSellOrders = [];
    }
    const handler = (e) => setOrders(prev => [e.detail, ...prev]);
    window.addEventListener("ims-sell-order", handler);
    return () => window.removeEventListener("ims-sell-order", handler);
  }, []);

  const filtered = tab === 0 ? orders :
    tab === 1 ? orders.filter(o => o.status === "picking") :
    tab === 2 ? orders.filter(o => o.status === "packed") :
    orders.filter(o => o.status === "shipped");

  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;
  const toggle = (id) => setSelected(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const clear = () => { setSelected({}); setSelecting(false); setBulkMenu(null); };

  const bulkStatus = (status) => {
    setOrders(prev => prev.map(o => selected[o.id] ? { ...o, status } : o));
    ctx.pushToast(`อัปเดต ${selectedCount} ออร์เดอร์`);
    clear();
  };
  const bulkDelete = () => {
    if (!confirm(`ลบ ${selectedCount} ออร์เดอร์ที่เลือก?`)) return;
    setOrders(prev => prev.filter(o => !selected[o.id]));
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
        {!selecting && <button className="m-action accent" onClick={() => ctx.push("issue")}><Icons.Plus size={18}/></button>}
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

        <div className="m-list">
          {filtered.map(o => {
            const chMeta = CHANNEL_LIST.find(c => c.name === o.channel);
            const stCls = o.status === "shipped" ? "badge-success" : o.status === "packed" ? "badge-info" : "badge-warning";
            const stLab = o.status === "shipped" ? "ส่งแล้ว" : o.status === "packed" ? "พร้อมส่ง" : "กำลังหยิบ";
            const isSelected = !!selected[o.id];
            return (
              <button key={o.id} className={"m-row" + (isSelected ? " selected" : "")} onClick={() => selecting ? toggle(o.id) : ctx.push("labels")}>
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                <div className="m-row-thumb" style={{ background: chMeta?.color, color: "white", fontSize: 11, fontWeight: 600 }}>{chMeta?.short || o.channel.slice(0,2)}</div>
                <div className="m-row-main">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{o.id}</span>
                    <span className={"badge " + stCls} style={{ fontSize: 10 }}><span className="dot"/>{stLab}</span>
                  </div>
                  <div className="m-row-sub">{o.customer} · {o.items} รายการ · {o.carrier}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {selecting && selectedCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "white", color: "var(--fg)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selectedCount}</span>
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

  const cats = useMemoM(() => ["ทั้งหมด", ...new Set(products.map(p => p.cat))], [products]);
  const filtered = products.filter(p => {
    if (cat !== "ทั้งหมด" && p.cat !== cat) return false;
    if (q && !(p.sku.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

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

        <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
          {cats.map(c => (
            <button key={c} className={"m-chip" + (cat === c ? " on" : "")} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, padding: "0 4px" }}>
          {filtered.length} จาก {products.length} รายการ
          {selecting && <span> · แตะเพื่อเลือก</span>}
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
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "white", color: "var(--fg)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selectedCount}</span>
          <span style={{ fontSize: 12, flex: 1 }}>เลือก {selectedCount} รายการ</span>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkOpen(true)}><Icons.Edit size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => ctx.pushToast("เพิ่มเข้าคิวพิมพ์บาร์โค้ด")}><Icons.Print size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={() => { if (!confirm(`ลบ ${selectedCount} รายการ?`)) return; const rm = [...selectedSkus]; removeProductsFromStore(rm); clear(); ctx.pushToast(`ลบ ${rm.length} รายการ`); }}><Icons.Trash size={14}/></button>
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
  const suppliers = useMemoM(() => [...new Set(products.map(p => p.supplier))], [products]);
  const [f, setF] = useStateM(() => editing ? {
    sku: editing.sku, name: editing.name, cat: editing.cat, supplier: editing.supplier,
    cost: String(editing.cost ?? ""), price: String(editing.price ?? ""),
    qty: String(editing.qty ?? ""), reorder: String(editing.reorder ?? "50"), loc: editing.loc
  } : {
    sku: "", name: "", cat: categories[0] || "", supplier: suppliers[0] || "",
    cost: "", price: "", qty: "", reorder: "50", loc: ""
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const skuTrim = f.sku.trim().toUpperCase();
  const dupe = !editing && skuTrim && products.some(p => p.sku.toUpperCase() === skuTrim);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const cost = num(f.cost), price = num(f.price), qty = num(f.qty), reorder = num(f.reorder);
  const canSave = skuTrim && !dupe && f.name.trim() && f.loc.trim() &&
    cost !== null && price !== null && qty !== null && reorder !== null;

  const save = () => {
    if (!canSave) return;
    onAdd({
      sku: skuTrim, name: f.name.trim(), cat: f.cat || "ทั่วไป",
      supplier: f.supplier || "ไม่ระบุ", cost, price,
      qty: Math.round(qty), reorder: Math.round(reorder),
      loc: f.loc.trim().toUpperCase()
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
            <input className="m-input mono" value={f.sku} disabled={!!editing} onChange={e => set("sku", e.target.value)} placeholder="เช่น TH-APP-003" style={{ textTransform: "uppercase", opacity: editing ? 0.6 : 1 }}/>
            {dupe && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>SKU นี้มีอยู่แล้ว</div>}
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ชื่อสินค้า *</div>
            <input className="m-input" value={f.name} onChange={e => set("name", e.target.value)} placeholder="ชื่อสินค้า"/>
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
              <input className="m-input" type="number" min="0" value={f.reorder} onChange={e => set("reorder", e.target.value)}/>
            </div>
            <div>
              <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ตำแหน่ง *</div>
              <input className="m-input mono" value={f.loc} onChange={e => set("loc", e.target.value)} placeholder="A-01-01" style={{ textTransform: "uppercase" }}/>
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
            <input className="m-input mono" placeholder="A-01-01" value={vals.loc} onChange={e => setVals(v => ({...v, loc: e.target.value}))}/>
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
  const channels = channelStockFor(p.sku);
  const cats = [...new Set(PRODUCTS.map(x => x.cat))];

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
          <MetaRow label="ผู้จัดส่ง" value={p.supplier}/>
          <MetaRow label="ราคา" value={`฿${p.price.toLocaleString()}`}/>
          <MetaRow label="จุดสั่งซื้อใหม่" value={`${p.reorder} ชิ้น`}/>
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>สต็อกตามช่องทาง · 30 วัน</div>
        <div className="m-card">
          {channels.map(c => {
            const totalSold = channels.reduce((s,x)=>s+x.sold30d,0) || 1;
            const pct = c.sold30d / totalSold * 100;
            return (
              <div key={c.id} style={{ padding: "6px 0" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="row" style={{ gap: 6, fontSize: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: c.color }}/>
                    {c.name}
                  </span>
                  <span className="tnum" style={{ fontSize: 12 }}>
                    <strong>{c.sold30d}</strong>
                    {c.reserved > 0 && <span style={{ color: "var(--muted)", marginLeft: 6 }}>· {c.reserved} จอง</span>}
                  </span>
                </div>
                <div className="prog" style={{ height: 4 }}><span style={{ width: pct + "%", background: c.color }}/></div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <button className="m-btn-big" onClick={() => setAdjOpen(true)}>
            <Icons.Refresh size={15}/> ปรับสต็อก
          </button>
          <button className="m-btn-big dark" onClick={() => ctx.push("issue", { sku: p.sku })}>
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

    const id = "SO-" + Math.floor(Math.random() * 90000000 + 10000000);
    const ts = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const order = {
      id, channel: "ขายตรง", customer: customer || "ลูกค้าใหม่",
      items: isBundle ? bundle.items.length : 1, status: "picking",
      carrier: "—", tracking: "—", ts,
      isBundle, bundleName: isBundle ? bundle.name : undefined,
      lineItems: isBundle
        ? bundle.items.map(it => {
            const p = PRODUCTS.find(x => x.sku === it.sku);
            return { sku: it.sku, name: p ? p.name : it.sku, qty: it.qty * total };
          })
        : [{ sku: skuId, name: product.name, qty: total }]
    };
    window.__pendingSellOrders = window.__pendingSellOrders || [];
    window.__pendingSellOrders.push(order);
    window.dispatchEvent(new CustomEvent("ims-sell-order", { detail: order }));

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
    { id: "bundles",   icon: Icons.Bundle, label: "ชุดสินค้า",       sub: "สร้างและจัดการชุดสินค้า" },
    { id: "tracking",  icon: Icons.Truck, label: "ติดตามพัสดุ",     sub: "เลขพัสดุ ขนส่ง และสถานะ" },
    { id: "locations", icon: Icons.Map,   label: "ตำแหน่งจัดเก็บ",  sub: "แผนผังคลังและการใช้พื้นที่" },
    { id: "labels",    icon: Icons.Tag,   label: "พิมพ์ฉลากจัดส่ง", sub: "สร้าง แก้ไข และพิมพ์ฉลาก" },
    { id: "import",    icon: Icons.Pkg,   label: "นำเข้า SKU",      sub: "อัปโหลดจาก Excel/CSV" },
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

/* =============== LOCATIONS =============== */

function MLocations({ ctx }) {
  const zones = {};
  LOCATIONS.forEach(l => { (zones[l.code[0]] ||= []).push(l); });

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ตำแหน่งจัดเก็บ</div>
        <button className="m-action" onClick={() => alert("เพิ่มตำแหน่งจัดเก็บใหม่")}><Icons.Plus size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-kpi-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="m-kpi" style={{ padding: 10 }}>
            <div className="m-kpi-label">ใช้งาน</div>
            <div className="m-kpi-value" style={{ fontSize: 18 }}>34/40</div>
          </div>
          <div className="m-kpi" style={{ padding: 10 }}>
            <div className="m-kpi-label">ใช้พื้นที่</div>
            <div className="m-kpi-value" style={{ fontSize: 18 }}>68%</div>
          </div>
          <div className="m-kpi" style={{ padding: 10 }}>
            <div className="m-kpi-label">ใกล้เต็ม</div>
            <div className="m-kpi-value" style={{ fontSize: 18, color: "var(--warning)" }}>4</div>
          </div>
        </div>

        {Object.entries(zones).map(([z, cells]) => (
          <div key={z} className="m-card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>โซน {z}</div>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{cells.length} ตำแหน่ง · เฉลี่ย {Math.round(cells.reduce((s,c)=>s+c.fill,0)/cells.length)}%</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5 }}>
              {cells.map(c => {
                let cls = "wh-cell";
                if (c.fill === 0) cls += " empty";
                else if (c.fill < 30) cls += " fill1";
                else if (c.fill < 70) cls += " fill2";
                else if (c.fill < 90) cls += " fill3";
                else cls += " fill4";
                return (
                  <div key={c.code} className={cls} style={{ aspectRatio: "1", padding: "5px 6px", fontSize: 9 }}>
                    <div className="lab" style={{ fontSize: 9 }}>{c.code.split("-").slice(0,2).join("-")}</div>
                    <div className="pct" style={{ fontSize: 11 }}>{c.fill}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 12, fontSize: 11, color: "var(--muted)", display: "flex", gap: 10, alignItems: "center" }}>
          <Icons.Refresh size={14}/>
          <span>ระบบติดตามอัตโนมัติ — ยอดอัปเดตทันทีเมื่อรับเข้า/จ่ายออก</span>
        </div>
      </div>
    </>
  );
}

/* =============== LABELS =============== */

function MLabels({ ctx }) {
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ฉลากจัดส่ง</div>
        <button className="m-action accent" onClick={() => alert("สร้างฉลากจัดส่งใหม่")}><Icons.Plus size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-card" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>คิวพิมพ์</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2 }} className="tnum">{SAMPLE_LABELS.length}</div>
          </div>
          <button className="m-btn-big" style={{ width: "auto", padding: "12px 16px" }} onClick={() => ctx.pushToast("ส่งออก PDF ทั้งหมด")}>
            <Icons.Print size={14}/> พิมพ์ทั้งหมด
          </button>
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>รายการฉลาก</div>
        <div className="m-list">
          {SAMPLE_LABELS.map(l => (
            <button key={l.id} className="m-row" onClick={() => ctx.push("label-view", l)}>
              <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--accent)" }}><Icons.Tag size={16}/></div>
              <div className="m-row-main">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{l.soId}</span>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{l.carrier.split(" ")[0]}</span>
                </div>
                <div className="m-row-sub">{l.recipient.name} · {l.items.length} รายการ · {l.weight}</div>
              </div>
              <Icons.Chev size={14} className="m-row-chev"/>
            </button>
          ))}
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
  const l = ctx.route.params;
  const store = (() => {
    try { return { ...DEFAULT_STORE, ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch { return DEFAULT_STORE; }
  })();
  const size = LABEL_SIZES[0]; // 100x150
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">{l.soId}</div>
        <button className="m-action" onClick={() => alert("แก้ไขฉลาก: " + l.soId)}><Icons.Edit size={14}/></button>
      </div>
      <div className="m-content">
        <div style={{ display: "grid", placeItems: "center", padding: "10px 0 18px" }}>
          <div style={{ transform: "scale(0.7)", transformOrigin: "center top" }}>
            <LabelPaper label={l} size={size} store={store}/>
          </div>
        </div>
        <div style={{ marginTop: -80 }}>
          <button className="m-btn-big" onClick={() => ctx.pushToast("ส่งออก PDF แล้ว")}>
            <Icons.Print size={16}/> ส่งออก PDF
          </button>
        </div>
      </div>
    </>
  );
}

/* =============== IMPORT =============== */

function MImport({ ctx }) {
  const fileRef = useRefM(null);
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    ctx.pushToast(`อ่านไฟล์ ${f.name}`);
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
    try { return { ...DEFAULT_STORE, ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch { return DEFAULT_STORE; }
  });
  const fileRef = useRefM(null);
  const save = (next) => {
    setStore(next);
    try { localStorage.setItem("ims_store", JSON.stringify(next)); } catch (e) {}
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
      </div>
    </>
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

  const filtered = orders.filter(o => {
    if (statusFilter !== "all" && o.status !== statusFilter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const match = (o.id + " " + o.customer + " " + o.phone + " " + o.tracking + " " + o.carrier).toLowerCase().includes(ql);
      if (!match) return false;
    }
    return true;
  });

  const selIds = Object.keys(selected).filter(k => selected[k]);
  const selCount = selIds.length;
  const toggle = (id) => setSelected(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const clear = () => { setSelected({}); setSelecting(false); setBulkMenu(null); };

  const bulkStatus = (status) => { selIds.forEach(id => setOrderField(id, { status })); ctx.pushToast(`อัปเดต ${selCount} ออร์เดอร์`); clear(); };
  const bulkCarrier = (carrier) => { selIds.forEach(id => setOrderField(id, { carrier })); ctx.pushToast(`เปลี่ยนขนส่ง ${selCount} ออร์เดอร์`); clear(); };
  const bulkDelete = () => { if (!confirm(`ลบ ${selCount} ออร์เดอร์ที่เลือก?`)) return; selIds.forEach(id => setOrderField(id, { deleted: true })); ctx.pushToast(`ลบ ${selCount} ออร์เดอร์`); clear(); };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ติดตามพัสดุ</div>
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)}>
          {selecting ? <Icons.X size={14}/> : <Icons.Check size={14}/>}
        </button>
        {!selecting && <button className="m-action accent" onClick={() => setShareOpen(true)}><Icons.Copy size={14}/></button>}
      </div>
      <div className="m-content">
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

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, padding: "0 4px" }}>
          {filtered.length} จาก {orders.length} ออร์เดอร์{selecting && " · แตะเพื่อเลือก"}
        </div>

        <div className="m-list">
          {filtered.map(o => {
            const idx = stageIndex(o.status);
            const stage = TRACK_STAGES[idx] || TRACK_STAGES[0];
            const carrierMeta = CARRIERS.find(c => c.name.toLowerCase().includes(o.carrier.toLowerCase().split(" ")[0])) || {};
            const isSelected = !!selected[o.id];
            return (
              <button key={o.id} className={"m-row" + (isSelected ? " selected" : "")} onClick={() => selecting ? toggle(o.id) : ctx.push("track-edit", o)}>
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                <div className="m-row-thumb" style={{ background: carrierMeta.color || "var(--surface-3)", color: "white" }}>
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
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "white", color: "var(--fg)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selCount}</span>
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
    </>
  );
}

/* =============== TRACKING EDIT (single order) =============== */

function MTrackEdit({ ctx }) {
  const o = ctx.route.params;
  const [carrier, setCarrier] = useStateM(o.carrier || "");
  const [tracking, setTracking] = useStateM(o.tracking || "");
  const [status, setStatus] = useStateM(o.status);

  const save = () => {
    setOrderField(o.id, { carrier, tracking, status });
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
        <div className="m-card">
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 2 }}>ลูกค้า</div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{o.customer}</div>
          <div className="row" style={{ gap: 10, marginTop: 6, fontSize: 12, color: "var(--muted)" }}>
            <span className="mono">{o.phone}</span>
            <span>{o.channel}</span>
          </div>
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>ขนส่ง</div>
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
