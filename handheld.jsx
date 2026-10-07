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
  const [route, setRouteRaw] = useStateM(() => mStartRoute(user && user.role));
  const setRoute = (r) => setRouteRaw(r);
  /* switchTab("inventory") — plain tab switch (every existing caller).
     switchTab("inventory", { status: "low" }) — switch AND hand the tab screen a
     preset (read once from ctx.route.params when it mounts), so a KPI tile can
     land on the filtered list instead of the raw one. */
  const switchTab = (tab, params) => setRoute({ tab, view: null, params: params || null, history: [] });
  const push = (view, params) => setRoute(r => ({ ...r, history: [...r.history, { view: r.view, params: r.params }], view, params }));
  const back = () => setRoute(r => {
    const h = [...r.history];
    const prev = h.pop() || { view: null, params: null };
    return { ...r, view: prev.view, params: prev.params, history: h };
  });

  const [pendingSync, setPendingSync] = useStateM(() =>
    typeof loadOfflineQueue === "function" ? loadOfflineQueue().length : 0
  );
  useEffectM(() => {
    const h = (e) => setPendingSync(e.detail.count);
    window.addEventListener("ims-queue-change", h);
    return () => window.removeEventListener("ims-queue-change", h);
  }, []);

  /* Role permissions changed (edited here, or pushed from another device via
     realtime) → re-render so the menu and every canDo() gate re-resolve. */
  const [permTick, setPermTick] = useStateM(0);
  useEffectM(() => {
    const h = () => setPermTick(t => t + 1);
    window.addEventListener("ims-perms-change", h);
    return () => window.removeEventListener("ims-perms-change", h);
  }, []);
  // A tab revoked by an admin (or a role switch) → move to the role's start route.
  useEffectM(() => {
    const role = user && user.role;
    if (!route.view && !mTabAllowed(route.tab, role)) setRouteRaw(mStartRoute(role));
  }, [permTick, user && user.role]);

  const ctx = { route, switchTab, push, back, pushToast, user, onLogout, onSwitchUser, fullscreen, pendingSync };

  return (
    <div className="m-app">
      <StatusBar/>
      <ErrorBoundary key={(route.view || "") + ":" + (route.tab || "")} mobile>
        <Screen ctx={ctx}/>
      </ErrorBoundary>
      <TabBar tab={route.tab} onSwitch={switchTab} role={user && user.role}/>
      {typeof PackSendPrompt === "function" && <PackSendPrompt pushToast={pushToast} mobile/>}
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

/* Bottom tabs → the nav id each one maps to. "more" is always available (it's
   how you reach everything else and holds logout); the others are real nav ids
   and must honour the role's page list, or the permission editor's chips would
   be a no-op on the phone. "home" is the dashboard — a role without it (the
   pack-only พนักงานแพ็ค) gets no home screen at all.
   `role` is passed explicitly where known: window.__currentUser is set by a
   parent effect, which runs AFTER this subtree's first render. */
const M_TAB_NAV_ID = { home: "dashboard", inbound: "inbound", outbound: "outbound", inventory: "inventory" };
function mTabAllowed(tabId, role) {
  const navId = M_TAB_NAV_ID[tabId];
  if (!navId) return true;
  return typeof canOpenPage !== "function" || canOpenPage(navId, role);
}
/* Where the phone app opens: the first allowed tab, else straight into
   แพ็คสินค้า when that's the role's page, else the More menu. */
function mStartRoute(role) {
  const tab = ["home", "inbound", "outbound", "inventory"].find(t => mTabAllowed(t, role));
  if (tab) return { tab, view: null, params: null, history: [] };
  if (typeof canOpenPage === "function" && canOpenPage("pack", role)) return { tab: "more", view: "pack", params: null, history: [] };
  return { tab: "more", view: null, params: null, history: [] };
}

function TabBar({ tab, onSwitch, role }) {
  const tabs = [
    { id: "home",      label: "หน้าหลัก", icon: Icons.Dash },
    { id: "inbound",   label: "รับเข้า",  icon: Icons.In },
    { id: "outbound",  label: "จัดส่ง",   icon: Icons.Out },
    { id: "inventory", label: "สินค้า",   icon: Icons.Box },
    { id: "more",      label: "เพิ่มเติม", icon: Icons.Menu }
  ].filter(t => mTabAllowed(t.id, role));
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

/* Views that map 1:1 onto a nav id — reachable only when the signed-in role has
   that page. The desktop shell redirects a revoked page; mobile shows a notice
   instead, because a deep link (a saved route, an old back-stack entry) can
   still point at a screen an admin has since taken away. */
const M_GATED_VIEWS = ["locations", "labels", "tracking", "import", "bundles", "analytics", "stocktake", "adjust", "history", "users", "settings", "finder", "pack"];

/* Screen dispatcher */
function Screen({ ctx }) {
  const { route } = ctx;
  const role = ctx.user && ctx.user.role;
  if (route.view && M_GATED_VIEWS.indexOf(route.view) !== -1
      && typeof canOpenPage === "function" && !canOpenPage(route.view, role)) {
    return <MNoAccess ctx={ctx}/>;
  }
  // Tab screens are dispatched from route.tab, so they need their own check —
  // the tab bar hides a revoked tab, but a route saved before the change can
  // still land here.
  if (!route.view && !mTabAllowed(route.tab, role)) return <MNoAccess ctx={ctx}/>;
  // Selling / issuing stock is a capability, not a page — MSell and MIssue have
  // several entry points, so the guard lives here rather than on each button.
  if ((route.view === "sell" || route.view === "issue" || route.view === "quicksell" || route.view === "pack-new" || route.view === "pack-add") && typeof canDo === "function" && !canDo("sell")) {
    return <MNoAccess ctx={ctx}/>;
  }
  if (route.view === "adjust" && typeof canAdjustStock === "function" && !canAdjustStock()) {
    return <MNoAccess ctx={ctx}/>;
  }
  // The pack sub-views (one order / one wave) are not nav ids of their own, so the
  // M_GATED_VIEWS loop above can't see them — gate them on the แพ็คสินค้า page.
  if ((route.view === "pack-order" || route.view === "pack-wave" || route.view === "pack-add")
      && typeof canOpenPage === "function" && !canOpenPage("pack", role)) {
    return <MNoAccess ctx={ctx}/>;
  }
  // sub-views
  if (route.view === "product")   return <MProductDetail ctx={ctx}/>;
  if (route.view === "finder")    return <MFinder ctx={ctx}/>;
  if (route.view === "issue")     return <MIssue ctx={ctx}/>;
  if (route.view === "pack")      return <MPack ctx={ctx}/>;
  if (route.view === "pack-order")return <MPackOrder ctx={ctx}/>;
  if (route.view === "pack-wave") return <MPackWave ctx={ctx}/>;
  if (route.view === "sell")      return <MSell ctx={ctx}/>;
  if (route.view === "quicksell") return <MQuickSell ctx={ctx}/>;
  if (route.view === "pack-new" && typeof MPackNew === "function") return <MPackNew ctx={ctx}/>;
  if (route.view === "pack-add" && typeof MPackAdd === "function") return <MPackAdd ctx={ctx}/>;
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
  if (route.view === "adjust")    return <MAdjust ctx={ctx}/>;
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

/* Shown when a role opens a screen its permissions no longer include. */
function MNoAccess({ ctx }) {
  return (
    <>
      <div className="m-topbar">
        <button className="m-action" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title">ไม่มีสิทธิ์เข้าถึง</div>
      </div>
      <div className="m-content" style={{ textAlign: "center", paddingTop: 48 }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: "var(--warning-soft)", color: "var(--warning)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <Icons.Warn size={26}/>
        </div>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>หน้านี้ไม่เปิดให้ตำแหน่งของคุณ</div>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          หากต้องใช้งาน กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์ให้ตำแหน่งของคุณ
        </div>
        <button className="m-btn-big outline" style={{ marginTop: 20 }} onClick={() => ctx.switchTab("home")}>กลับหน้าหลัก</button>
      </div>
    </>
  );
}

/* =============== HOME =============== */

// A .m-kpi rendered as a <button> needs the button chrome reset to keep the tile look.
const KPI_TAP = { textAlign: "left", font: "inherit", fontFamily: "inherit", cursor: "pointer", width: "100%", display: "block" };

function MHome({ ctx }) {
  const totalSkus = PRODUCTS.length;
  const totalQty = PRODUCTS.reduce((s, p) => s + p.qty, 0);
  const lowStock = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder).length;
  const outOfStock = PRODUCTS.filter(p => p.qty === 0).length;
  const pendingOrders = (typeof buildOrders === "function" ? buildOrders() : [])
    .filter(o => typeof isPendingOrder === "function" ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed")).length;
  const firstName = (ctx.user?.name || "สมชาย").split(" ")[0];
  const [notifOpen, setNotifOpen] = useStateM(false);
  const notifCount = lowStock + outOfStock + pendingOrders;

  // Recent activity comes from the real audit log (the old static ACTIVITY
  // array is empty, so this section used to render nothing at all).
  const [auditTick, setAuditTick] = useStateM(0);
  useEffectM(() => {
    const refresh = () => setAuditTick(t => t + 1);
    window.addEventListener("ims-audit-change", refresh);
    return () => window.removeEventListener("ims-audit-change", refresh);
  }, []);
  const recentActivity = useMemoM(
    () => (typeof loadAuditLog === "function" ? loadAuditLog() : []).slice(0, 6),
    [auditTick]
  );
  const [, setSalesTick] = useStateM(0);
  useEffectM(() => {
    const h = () => setSalesTick(t => t + 1);
    window.addEventListener("ims-sales-change", h);
    window.addEventListener("ims-products-change", h);
    return () => { window.removeEventListener("ims-sales-change", h); window.removeEventListener("ims-products-change", h); };
  }, []);
  const chToday = typeof channelToday === "function" ? channelToday() : [];
  const chShown = chToday.filter(c => c.units > 0).sort((a, b) => b.units - a.units);
  const soldToday = chToday.reduce((n, c) => n + c.units, 0);

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

        {/* Product finder entry — tap opens the search screen (photo + storage position) */}
        <button onClick={() => ctx.push("finder")}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", marginBottom: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, color: "var(--muted)", fontSize: 13, fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}>
          <Icons.Search size={16} style={{ flexShrink: 0 }}/>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>ค้นหาสินค้า — ดูรูปและตำแหน่งจัดเก็บ...</span>
          <Icons.Camera size={16} style={{ flexShrink: 0, color: "var(--accent)" }}/>
        </button>

        {/* KPI grid 2x2 — each tile opens the list it counts (the two action
            tiles land pre-filtered; the two totals just open the plain list). */}
        <div className="m-kpi-row">
          <button className="m-kpi" style={KPI_TAP} onClick={() => ctx.switchTab("inventory")}>
            <div className="m-kpi-label">SKU ทั้งหมด</div>
            <div className="m-kpi-value">{totalSkus}</div>
          </button>
          <button className="m-kpi" style={KPI_TAP} onClick={() => ctx.switchTab("inventory")}>
            <div className="m-kpi-label">สต็อกรวม</div>
            <div className="m-kpi-value">{totalQty.toLocaleString()}</div>
          </button>
          <button className="m-kpi" style={KPI_TAP} onClick={() => ctx.switchTab("outbound", { pending: true })}>
            <div className="m-kpi-label">ออร์เดอร์ค้าง</div>
            <div className="m-kpi-value">{pendingOrders}</div>
          </button>
          <button className="m-kpi" style={{ ...KPI_TAP, background: outOfStock + lowStock > 0 ? "var(--danger-soft)" : "var(--surface)" }}
            onClick={() => ctx.switchTab("inventory", { status: outOfStock > 0 && lowStock === 0 ? "out" : "low" })}>
            <div className="m-kpi-label">ต้องสั่งซื้อ</div>
            <div className="m-kpi-value" style={{ color: "var(--danger)" }}>{lowStock + outOfStock}</div>
          </button>
        </div>

        {/* Quick actions */}
        <div className="m-section-label" style={{ padding: "8px 4px 8px" }}>ทางลัด</div>
        {/* Each shortcut is dropped when its capability/page is revoked — the
            Screen guard would otherwise bounce the tap to "ไม่มีสิทธิ์เข้าถึง". */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 14 }}>
          {/* ปรับสต็อก first — it is how the team records Shopee / Facebook / หน้าร้าน sales. */}
          {canDo("sell") && <QuickTile icon={<Icons.Cart size={20}/>} label="ขายออก" color="oklch(0.95 0.05 50)" fg="oklch(0.5 0.16 40)" onClick={() => ctx.push("quicksell")}/>}
          {typeof canAdjustStock === "function" && canAdjustStock() && canOpenPage("adjust") && <QuickTile icon={<Icons.Refresh size={20}/>} label="ปรับสต็อก" color="oklch(0.96 0.03 90)" fg="oklch(0.45 0.1 80)" onClick={() => ctx.push("adjust")}/>}
          {canDo("sell") && <QuickTile icon={<Icons.Truck size={20}/>} label="ขาย + จัดส่ง" color="oklch(0.95 0.03 250)"  fg="oklch(0.42 0.12 250)"  onClick={() => ctx.push("sell")}/>}
          {canOpenPage("inbound") && <QuickTile icon={<Icons.In size={20}/>}   label="รับเข้า"   color="oklch(0.96 0.04 150)" fg="oklch(0.4 0.13 150)" onClick={() => ctx.switchTab("inbound")}/>}
          {canDo("sell") && <QuickTile icon={<Icons.Out size={20}/>}  label="ตัดสต็อก"  color="oklch(0.95 0.04 230)" fg="oklch(0.4 0.13 230)" onClick={() => ctx.push("issue")}/>}
          {canOpenPage("labels") && <QuickTile icon={<Icons.Tag size={20}/>}  label="ฉลาก"     color="oklch(0.96 0.03 310)" fg="oklch(0.4 0.13 310)" onClick={() => ctx.push("labels")}/>}
        </div>

        {/* Today's sales by channel — real orders + ปรับสต็อก "ขายผ่าน …" sales
            (was a constant list that always read 0). Hidden from roles
            without viewSales, like every other sales figure. */}
        {(typeof canDo !== "function" || canDo("viewSales")) && (
          <div className="m-card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: chShown.length ? 10 : 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>ขายวันนี้ตามช่องทาง</div>
              <span className="tnum" style={{ fontSize: 13, color: "var(--muted)" }}>{soldToday} ชิ้น</span>
            </div>
            {chShown.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>ยังไม่มีการขายวันนี้</div>}
            {chShown.map(c => (
              <div key={c.id} style={{ padding: "6px 0" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="row" style={{ gap: 6, fontSize: 13 }}>
                    <ChannelMark channel={c.id} size={16}/>
                    {c.name}
                  </span>
                  <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{c.units} ชิ้น</span>
                </div>
                <div className="prog" style={{ height: 4 }}><span style={{ width: c.pct + "%", background: c.color }}/></div>
              </div>
            ))}
          </div>
        )}

        {/* Recent activity — each row carries its day, so an entry from an
            earlier day can't be misread as today's. ดูทั้งหมด opens the full
            log, where older days can be paged in or jumped to by date. */}
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", padding: "0 4px 8px" }}>
          <div className="m-section-label" style={{ padding: 0 }}>กิจกรรมล่าสุด</div>
          {canOpenPage("history") && (
            <button onClick={() => ctx.push("history")}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", fontFamily: "inherit", fontSize: 12, color: "var(--accent)", cursor: "pointer" }}>
              ดูทั้งหมด <Icons.Chev size={11}/>
            </button>
          )}
        </div>
        <div className="m-list">
          {recentActivity.map((e, i) => (
            <div key={e.id || i} className="m-row" style={{ cursor: "default" }}>
              <ActivityDot type={auditTone(e)}/>
              <div className="m-row-main">
                <div className="m-row-title" style={{ fontSize: 13, fontWeight: 400, whiteSpace: "normal" }}>{e.summary || e.entityId || "เปลี่ยนแปลง"}</div>
                <div className="m-row-sub">{thaiDayLabel(bangkokDateOf(e.ts))} {bangkokTimeOf(e.ts)} · {e.user?.name || "ระบบ"}</div>
              </div>
            </div>
          ))}
          {recentActivity.length === 0 && (
            <div style={{ padding: "22px 8px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
              ยังไม่มีกิจกรรม — จะแสดงเมื่อเริ่มรับเข้า/ตัดสต็อก
            </div>
          )}
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
    .filter(o => typeof isPendingOrder === "function" ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed"));
  const nothing = !outOfStock.length && !lowStock.length && !pending.length;
  const go = (tab) => { onClose(); ctx.switchTab(tab); };
  /* Tapping a row must land on the THING that was tapped, not just its tab —
     otherwise the tap looks like it did nothing when that tab is already open. */
  const goProduct = (sku) => { onClose(); ctx.push("product", { sku }); };
  // "track-edit" is the mobile per-order detail (it takes the whole order object).
  const goOrder = (o) => { onClose(); ctx.push("track-edit", o); };
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
          {outOfStock.slice(0, 6).map(p => <Row key={"o" + p.sku} color="var(--danger)" title={p.name} sub={p.sku} onClick={() => goProduct(p.sku)}/>)}
          {lowStock.length > 0 && <div className="m-section-label" style={{ color: "var(--warning)", padding: "4px 2px" }}>ใกล้หมด ({lowStock.length})</div>}
          {lowStock.slice(0, 6).map(p => <Row key={"l" + p.sku} color="var(--warning)" title={p.name} sub={p.sku + " · เหลือ " + p.qty} onClick={() => goProduct(p.sku)}/>)}
          {pending.length > 0 && <div className="m-section-label" style={{ padding: "4px 2px" }}>ออร์เดอร์ค้าง ({pending.length})</div>}
          {pending.slice(0, 6).map(o => <Row key={"p" + o.id} color="var(--accent)" title={o.customer || o.id} sub={(typeof orderShortId === "function" ? orderShortId(o) : o.id) + " · " + (ORDER_STATUS_TH[o.status] || o.status)} onClick={() => goOrder(o)}/>)}
        </div>
      </div>
    </>
  );
}

function QuickTile({ icon, label, color, fg, onClick }) {
  return (
    <button onClick={onClick} style={{ background: color, border: "1px solid var(--border)", borderRadius: 14, padding: "14px 8px", color: "var(--fg)", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(255,255,255,0.6)", display: "grid", placeItems: "center", color: fg }}>{icon}</div>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: "center", lineHeight: 1.3 }}>{label}</span>
    </button>
  );
}

/* =============== INBOUND =============== */

function MInbound({ ctx }) {
  // Restore in-progress receiving draft (survives leaving the screen / reload).
  const [received, setReceived] = useStateM(() => typeof loadInboundDraft === "function" ? loadInboundDraft() : []);
  const [scan, setScan] = useStateM("");
  const [flash, setFlash] = useStateM(null);
  const [report, setReport] = useStateM(null); // what the closed batch did (buildReceiveReport)
  const [camOpen, setCamOpen] = useStateM(false);
  const lastScanRef = useRefM(null);
  const [quickAdd, setQuickAdd] = useStateM(null); // null | { sku }
  const [similar, setSimilar] = useStateM(null); // null | { code, candidates } — near-duplicate prompt
  const [closed, setClosed] = useStateM(false);
  const [grQueue, setGRQueue] = useStateM(() => typeof loadGRQueue === "function" ? loadGRQueue() : []);
  const [qtyEdit, setQtyEdit] = useStateM(null); // null | { sku, val } — raw text while a count is being typed
  const inputRef = useRefM(null);
  // Persist the receiving draft on every change; clear it once the job is committed.
  useEffectM(() => { if (typeof saveInboundDraft === "function") saveInboundDraft(closed ? [] : received); }, [received, closed]);
  useEffectM(() => () => setCamOpen(false), []);

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
      // Default to the REAL shelf — p.loc is "-" on live data, and filing a batch
      // under "-" created a fake pick-first shelf.
      return [{ sku: p.sku, name: p.name, qty, loc: (typeof productHomeLoc === "function" ? productHomeLoc(p) : ""), t }, ...prev];
    });
    setFlash(p);
    setTimeout(() => setFlash(null), 1500);
  };
  // Per-line "จัดเก็บที่" — where this batch physically lands when the job closes.
  const setReceivedLoc = (idx, locV) => {
    if (typeof rememberReceiveLoc === "function") rememberReceiveLoc(locV);
    setReceived(prev => prev.map((r, i) => (i === idx ? { ...r, loc: locV } : r)));
  };
  // Lines that would be committed with NO shelf (none picked, none on the product)
  // — the FG-ELWEB-BK case: 30 pieces received, filed nowhere, no warning.
  const noShelf = (typeof receiveLinesWithoutShelf === "function") ? receiveLinesWithoutShelf(received) : [];
  const noShelfSet = new Set(noShelf.map(r => r.sku));
  const fillEmptyShelves = (locV) => {
    if (!locV) return;
    if (typeof rememberReceiveLoc === "function") rememberReceiveLoc(locV);
    setReceived(prev => prev.map(r => (noShelfSet.has(r.sku) ? { ...r, loc: locV } : r)));
    ctx.pushToast(`ตั้งตำแหน่ง ${noShelf.length} รายการแล้ว`);
  };
  // Manual qty correction for an already-scanned line — keyed by sku, not index,
  // since `received` reorders on every new scan (most-recent first).
  const setReceivedQty = (sku, n) =>
    setReceived(prev => prev.map(r => (r.sku === sku ? { ...r, qty: n } : r)));
  // Drop a line from this round's draft — a mis-scan, or a stale entry left over
  // from a job that never got closed. Only touches the in-memory draft.
  const removeReceived = (idx) => {
    setReceived(prev => {
      const r = prev[idx];
      if (r && ctx && ctx.pushToast) ctx.pushToast(`ลบ ${r.sku} ออกจากรายการแล้ว`);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const submit = (override) => {
    if (closed) return;
    const code = (override ?? scan).trim();
    if (!code) return;
    if (lastScanRef.current === code) return;
    lastScanRef.current = code;
    setTimeout(() => { if (lastScanRef.current === code) lastScanRef.current = null; }, 300);
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
    if (noShelf.length) {
      const list = noShelf.slice(0, 8).map(r => `• ${r.sku}`).join("\n") + (noShelf.length > 8 ? `\n…อีก ${noShelf.length - 8} รายการ` : "");
      if (!confirm(`⚠ ยังไม่ได้เลือกตำแหน่งจัดเก็บ ${noShelf.length} รายการ:\n${list}\n\nถ้าปิดงานตอนนี้ สินค้าจะขึ้นว่า "ยังไม่จัดเก็บ"\nกด ยกเลิก เพื่อกลับไปเลือกตำแหน่ง (แนะนำ)\nกด ตกลง เพื่อปิดงานโดยไม่ระบุตำแหน่ง`)) return;
    }
    if (!confirm(`ยืนยันปิดงานรับเข้า?\nจะเพิ่มสต็อก ${totalQty} ชิ้น ใน ${received.length} SKU เข้าระบบทันที`)) return;
    /* confirm() blocks the thread, so a second tap queues behind it and used to
       run the whole batch again with the stale `closed` closure — every sku
       received twice. The latch is synchronous and survives a reload, and the
       draft is retired right here so a reload can't restore a committed batch.
       Mirrors the desktop Inbound ปิดงาน guard. */
    const guardKey = (typeof commitFingerprint === "function")
      ? commitFingerprint("inbound-close", received) : null;
    if (guardKey && typeof claimCommit === "function" && !claimCommit(guardKey)) {
      if (typeof duplicateCommitToast === "function") duplicateCommitToast();
      setClosed(true);
      return;
    }
    if (typeof saveInboundDraft === "function") saveInboundDraft([]);
    // Snapshot BEFORE the writes so the report can show stock before → after.
    const rep = (typeof buildReceiveReport === "function") ? buildReceiveReport(received) : null;
    // Apply + ledger in one shared helper (see the desktop twin): the recorded
    // quantity is the one the server confirms, and the loop stays synchronous so
    // applyReceiveLocs below still runs in the same tick as the qty writes.
    if (typeof receiveStockAndRecord === "function") {
      receiveStockAndRecord(received, "รับเข้าสินค้า (มือถือ)", { audit: true });
    } else {
      received.forEach(r => { if (PRODUCTS.some(p => p.sku === r.sku)) adjustProductQty(r.sku, r.qty); });
    }
    // Same tick as the qty writes (see applyReceiveLocs): file each batch at
    // its picked position so the split rows follow the new stock.
    if (typeof applyReceiveLocs === "function") {
      applyReceiveLocs(received).then(res => {
        if (res && res.errors && res.errors.length) {
          ctx.pushToast(`รับเข้าแล้ว แต่บันทึกตำแหน่งไม่สำเร็จ ${res.errors.length} SKU — แก้ได้ที่หน้าสินค้า`);
        }
      }).catch(() => {});
    }
    if (typeof recordChange === "function") {
      recordChange({
        entity: "inbound", action: "close",
        summary: `ปิดงานรับเข้า (มือถือ) — เพิ่มสต็อก ${received.length} SKU รวม ${totalQty} ชิ้น`,
        changes: received.map(r => {
          const sh = (typeof receiveLineShelf === "function") ? receiveLineShelf(r) : (r.loc || "");
          return { label: r.sku, to: `+${r.qty} ชิ้น → ${sh || "ไม่ระบุตำแหน่ง"}` };
        })
      });
    }
    setReport(rep);
    setClosed(true);
    ctx.pushToast(`รับเข้าแล้ว ${received.length} SKU รวม ${totalQty} ชิ้น`);
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

        {/* Active GR document — reads from the shared GR queue. Hidden when the
            queue is empty: receiving works without a document, and an empty card
            telling staff to "go to the desktop" was just noise on the phone. */}
        {activeGR && <div className="m-card">
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
            null
          )}
        </div>}

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
                  entity: "product", entityId: product.sku, action: "add",
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
              <div>รับเข้าเรียบร้อย — {received.length} SKU รวม {total} ชิ้น</div>
              <div style={{ fontSize: 11, fontWeight: 400, color: "var(--success)", opacity: 0.8, marginTop: 2 }}>จำนวนที่รับเข้าและสต็อกก่อน → หลัง แสดงในรายการด้านล่าง</div>
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
          </>
        )}

        {flash && (
          <div style={{ padding: "10px 12px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 12, fontSize: 12, marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.Check size={14}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 10 }}>{flash.sku}</div>
              <div style={{ fontSize: 12, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{flash.name}</div>
            </div>
            {(() => {
              const line = received.find(r => r.sku === flash.sku);
              return line ? <div className="tnum" style={{ fontWeight: 700, fontSize: 13, flexShrink: 0, textAlign: "right" }}>
                รวม {line.qty} ชิ้น
              </div> : null;
            })()}
          </div>
        )}

        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>{closed ? "รับเข้าแล้ว" : "นับแล้ว"} · {received.length} SKU · {total} ชิ้น</div>
        {!closed && noShelf.length > 0 && (
          <div style={{ padding: "10px 12px", background: "var(--warning-soft)", color: "var(--warning)", borderRadius: 12, fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}><Icons.Warn size={14}/> ยังไม่ได้เลือกตำแหน่ง {noShelf.length} รายการ</div>
            <LocationSelect mobile value="" onChange={fillEmptyShelves} noneLabel="ใส่ตำแหน่งให้ทุกรายการที่ว่าง…"
              style={{ marginTop: 8, height: 38, fontSize: 13 }}/>
          </div>
        )}
        <div className="m-list">
          {received.map((r, i) => (
            <div key={i} className="m-row" style={{ cursor: "default", alignItems: "flex-start" }}>
              <div className="m-row-thumb mono" style={{ fontSize: 10, fontWeight: 600 }}>{r.sku.slice(-3)}</div>
              <div className="m-row-main">
                <div className="m-row-title">{r.name}</div>
                <div className="m-row-sub mono">{r.sku} · {r.t}</div>
                {closed
                  ? (() => {
                      const rr = report && report.lines.find(x => x.sku === r.sku);
                      return <>
                        <div className="m-row-sub mono">{(rr && rr.shelf) || r.loc || "ไม่ระบุตำแหน่ง"}</div>
                        {rr && <div className="m-row-sub tnum">คงเหลือ {rr.before} → <b style={{ color: "var(--fg)" }}>{rr.after}</b> ชิ้น</div>}
                      </>;
                    })()
                  : <LocationSelect mobile value={r.loc && r.loc !== "—" ? r.loc : ""} onChange={v => setReceivedLoc(i, v)}
                      noneLabel="— จัดเก็บที่… —" style={{ marginTop: 4, height: 34, fontSize: 12, padding: "0 8px",
                               ...(noShelfSet.has(r.sku) ? { borderColor: "var(--danger)", boxShadow: "0 0 0 1px var(--danger)" } : {}) }}/>}
              </div>
              {closed
                ? <div className="tnum" style={{ fontWeight: 700, fontSize: 15, color: "var(--success)" }}>+{r.qty}</div>
                : <QtyStepper small min={1}
                    value={qtyEdit && qtyEdit.sku === r.sku ? qtyEdit.val : String(r.qty)}
                    onChange={v => {
                      setQtyEdit({ sku: r.sku, val: v });
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n) && n >= 1) setReceivedQty(r.sku, n);
                    }}
                    onBlur={() => setQtyEdit(null)}
                    title={`จำนวน ${r.sku}`}/>}
              {!closed && (
                <button
                  className="m-action"
                  style={{ width: 30, height: 30, flexShrink: 0, background: "var(--danger-soft)", color: "var(--danger)", marginLeft: 4 }}
                  title={`ลบ ${r.sku} ออกจากรายการ`}
                  onClick={() => { if (!confirm(`ลบ ${r.sku} ออกจากรายการรับเข้ารอบนี้?`)) return; removeReceived(i); }}
                >
                  <Icons.Trash size={13}/>
                </button>
              )}
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
  // "ค้างส่ง" = รอแพ็ค + พร้อมส่ง, minus blank label drafts — the work that is
  // actually waiting. Status names come from ORDER_STATUS_TH so every screen
  // uses the same words (this tab used to say รอหยิบ, desktop กำลังหยิบ).
  const tabs = ["ทั้งหมด", "ค้างส่ง", ORDER_STATUS_TH.picking, ORDER_STATUS_TH.packed, ORDER_STATUS_TH.shipped];
  // Single source of truth shared with ติดตามพัสดุ: labels-as-shipments + overrides.
  const orders = useOrders();
  const pendingOf = (o) => typeof isPendingOrder === "function" ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed");
  // Opens on the work that is waiting (or everything when nothing is).
  const [tab, setTab] = useStateM(() => ((ctx.route.params && ctx.route.params.pending) || orders.some(pendingOf)) ? 1 : 0);
  const [q, setQ] = useStateM("");
  const [chanFilter, setChanFilter] = useStateM("all");
  const [showN, setShowN] = useStateM(60);
  useEffectM(() => { setShowN(60); }, [tab, q, chanFilter]);
  const [selecting, setSelecting] = useStateM(false);
  const [selected, setSelected] = useStateM({});
  const [bulkMenu, setBulkMenu] = useStateM(null);
  // Switching tab / search / channel drops the ticks (selecting mode stays on),
  // so a bulk ลบ / ยกเลิก / status change can't hit orders no longer on screen.
  useEffectM(() => {
    setSelected(s => (Object.keys(s).length ? {} : s));
    setBulkMenu(null);
  }, [tab, q, chanFilter]);

  const channels = useMemoM(() => {
    const set = new Set(orders.map(o => (o.channel || "").trim()).filter(Boolean));
    return ["all", ...set];
  }, [orders.length]);

  const filtered = useMemoM(() => {
    const lq = q.trim().toLowerCase();
    const byStatus = tab === 0 ? orders :
      tab === 1 ? orders.filter(pendingOf) :
      tab === 2 ? orders.filter(o => o.status === "picking") :
      tab === 3 ? orders.filter(o => o.status === "packed") :
      orders.filter(o => o.status === "shipped" || o.status === "delivered");
    return byStatus
      .filter(o => chanFilter === "all" || (o.channel || "").trim() === chanFilter)
      .filter(o => !lq || (o.id || "").toLowerCase().includes(lq) || (o.customer || "").toLowerCase().includes(lq));
  }, [orders, tab, q, chanFilter]);

  // Orders still waiting to be packed — drives the แพ็คสินค้า shortcut below.
  const pickingCount = useMemoM(() => orders.filter(o => o.status === "picking").length, [orders]);

  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;
  const toggle = (id) => setSelected(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const clear = () => { setSelected({}); setSelecting(false); setBulkMenu(null); setQ(""); setChanFilter("all"); };

  // Open the shipping label that backs this order so it can be viewed / saved as PDF.
  // labelToOrder ids: soId unless it's a "ฉลากใหม่ N" placeholder, then the label id.
  const openLabel = (o) => {
    const labels = (typeof loadLabels === "function") ? loadLabels() : [];
    const idFor = (x) => (x.soId && !/^ฉลากใหม่/.test(x.soId)) ? x.soId : x.id;
    const lbl = labels.find(x => idFor(x) === o.id);
    if (lbl) ctx.push("label-view", lbl);
    // No label yet → show the order itself rather than dumping the user in the
    // full label queue, which reads as "my tap opened the wrong thing".
    else ctx.push("track-edit", o);
  };

  /* Bulk ฉลาก: carry the selection into the label queue instead of opening the
     unfiltered list (which ignored what the user had just selected). One order
     opens its label directly; several arrive pre-selected, ready to batch-print. */
  const openSelectedLabels = () => {
    const labels = (typeof loadLabels === "function") ? loadLabels() : [];
    const idFor = (x) => (x.soId && !/^ฉลากใหม่/.test(x.soId)) ? x.soId : x.id;
    const picked = labels.filter(l => selectedIds.includes(idFor(l)));
    if (!picked.length) { ctx.pushToast("ออร์เดอร์ที่เลือกยังไม่มีฉลาก"); return; }
    if (picked.length < selectedIds.length) ctx.pushToast(`มีฉลาก ${picked.length} จาก ${selectedIds.length} ออร์เดอร์ที่เลือก`);
    if (picked.length === 1) ctx.push("label-view", picked[0]);
    else ctx.push("labels", { labelIds: picked.map(l => l.id) });
  };

  const bulkStatus = (status) => {
    if (typeof setOrderField === "function") selectedIds.forEach(id => setOrderField(id, { status }));
    ctx.pushToast(`อัปเดต ${selectedCount} ออร์เดอร์`);
    clear();
  };
  // Cancel = delete + put every piece back on the shelf the sale took it from.
  const bulkCancelRestock = async () => {
    const sel = orders.filter(o => selected[o.id]);
    const pieces = sel.reduce((s, o) => s + ((typeof packLinesForOrder === "function") ? packLinesForOrder(o) : []).reduce((n, l) => n + l.qty, 0), 0);
    if (!confirm(`ยกเลิก ${selectedCount} ออร์เดอร์ และคืนสต็อก ${pieces} ชิ้นกลับเข้าตำแหน่งเดิม?`)) return;
    const r = await cancelOrdersAndRestock(sel);
    if (r.blocked) { ctx.pushToast("ยกเลิกไม่ได้ — ต้องมีสิทธิ์ลบข้อมูล"); return; }
    if (!r.ok) return;
    let msg = `ยกเลิก ${r.restocked.length} ออร์เดอร์ — คืน ${r.pieces} ชิ้น`;
    if (r.skipped.length) msg += ` · ข้าม ${r.skipped.length}`;
    if (r.locError) msg += " · ปรับตำแหน่งไม่สำเร็จ";
    ctx.pushToast(msg);
    clear();
  };
  const bulkDelete = async () => {
    if (!confirm(`ลบ ${selectedCount} ออร์เดอร์ที่เลือก?`)) return;
    let res = null;
    if (typeof deleteOrdersFromDb === "function") {
      res = await deleteOrdersFromDb(selectedIds);
      if (res.blocked) { ctx.pushToast("ลบไม่ได้ — เฉพาะแอดมิน/ผู้จัดการเท่านั้น"); return; }
    }
    if (typeof setOrderField === "function") selectedIds.forEach(id => setOrderField(id, { deleted: true }));
    ctx.pushToast((res && res.ok === false && res.failedIds && res.failedIds.length)
      ? `ลบแล้ว — ${res.failedIds.length} รายการจะลบให้เสร็จเมื่อออนไลน์`
      : `ลบ ${selectedCount} ออร์เดอร์`);
    clear();
  };

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">จัดส่งสินค้า</div>
        <button className="m-action" onClick={() => {
          let list;
          if (selecting && selectedCount > 0) {
            list = selectedIds.map(id => filtered.find(o => o.id === id)).filter(Boolean);
          } else {
            list = filtered.filter(o => o.status === "picking");
          }
          if (!list.length) { ctx.pushToast("ไม่มีออร์เดอร์ที่ต้องหยิบ"); return; }
          if (typeof openPickListWindow === "function") openPickListWindow(list, ctx.pushToast);
        }}><Icons.Print size={14}/></button>
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)}>
          {selecting ? <Icons.X size={16}/> : <Icons.Check size={16}/>}
        </button>
        {!selecting && canDo("sell") && <button className="m-action accent" onClick={() => ctx.push("sell")}><Icons.Cart size={18}/></button>}
      </div>
      <div className="m-content">
        {/* Jump straight to the packer's work list. Wrapped in canOpenPage because
            goTo/Screen refuse a page the role no longer has. */}
        {!selecting && pickingCount > 0 && (typeof canOpenPage !== "function" || canOpenPage("pack")) && (
          <button className="m-card" onClick={() => ctx.push("pack")}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left", font: "inherit", cursor: "pointer", border: "1px solid var(--accent)", background: "var(--accent-soft)" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icons.Box size={18}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--accent)" }}>มี {pickingCount} ออร์เดอร์รอแพ็ค</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>เปิดรายการหยิบของตามชั้นวาง</div>
            </div>
            <Icons.Chev size={15} style={{ color: "var(--accent)", flexShrink: 0 }}/>
          </button>
        )}
        {/* Today's sales by channel — real, and only when there is something to show. */}
        {!selecting && (typeof canDo !== "function" || canDo("viewSales")) && (() => {
          const rows = (typeof channelToday === "function" ? channelToday() : []).filter(c => c.units > 0);
          if (!rows.length) return null;
          return (
            <div className="m-card">
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginBottom: 8 }}>ขายวันนี้ตามช่องทาง (ชิ้น)</div>
              <div style={{ display: "flex", gap: 8, overflowX: "auto", margin: "0 -14px", padding: "0 14px", scrollbarWidth: "none" }}>
                {rows.map(c => (
                  <div key={c.id} style={{ flexShrink: 0, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)", minWidth: 96 }}>
                    <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                      <ChannelMark channel={c.id} size={14}/>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{c.name}</span>
                    </div>
                    <div className="tnum" style={{ fontSize: 20, fontWeight: 600 }}>{c.units}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="m-search" style={{ marginBottom: 8 }}>
          <Icons.Search size={14} style={{ color: "var(--muted)" }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา ออร์เดอร์ หรือชื่อลูกค้า..."/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>

        <div className="m-chips-scroll" style={{ marginBottom: 6 }}>
          {tabs.map((t, i) => (
            <button key={t} className={"m-chip" + (tab === i ? " on" : "")} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>

        {channels.length > 1 && (
          <div className="m-chips-scroll" style={{ marginBottom: 12 }}>
            {channels.map(ch => {
              const meta = ch !== "all" ? CHANNEL_LIST.find(c => c.name === ch) : null;
              return (
                <button key={ch} className={"m-chip" + (chanFilter === ch ? " on" : "")} onClick={() => setChanFilter(ch)}
                  style={chanFilter === ch && meta ? { background: meta.color, borderColor: meta.color, color: "#fff" } : {}}>
                  {ch === "all" ? "ทุกช่องทาง" : ch === "ฉลาก" ? "จากฉลาก" : ch}
                </button>
              );
            })}
          </div>
        )}

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
            const stCls = (o.status === "shipped" || o.status === "delivered") ? "badge-success" : o.status === "packed" ? "badge-info" : "badge-warning";
            const stLab = ORDER_STATUS_TH[o.status] || o.status;
            const nm = (o.customer || "").trim();
            const isSelected = !!selected[o.id];
            const when = [o.date || o.dateIso || "", o.ts || ""].filter(Boolean).join(" · ");
            return (
              <button key={o.id} className={"m-row" + (isSelected ? " selected" : "")} onClick={() => selecting ? toggle(o.id) : openLabel(o)}>
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                {chMeta ? <MarkTile m={channelMark(o.channel)} size={36} title={o.channel}/> : <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--fg-2)", fontSize: 11, fontWeight: 600 }}>{(o.channel || "?").slice(0,2)}</div>}
                <div className="m-row-main">
                  {/* Customer first — a person reads "who", not "LBL-NEW-1781451656731-762". */}
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: nm && nm !== "ไม่ระบุชื่อ" ? "var(--fg)" : "var(--muted)" }}>{nm && nm !== "ไม่ระบุชื่อ" ? nm : "ไม่ระบุชื่อผู้รับ"}</span>
                    <span className={"badge " + stCls} style={{ flexShrink: 0 }}><span className="dot"/>{stLab}</span>
                  </div>
                  <div className="m-row-sub">
                    <span className="mono">{typeof orderShortId === "function" ? orderShortId(o) : o.id}</span>
                    {Number(o.items) > 0 ? ` · ${o.items} ชิ้น` : ""}{o.carrier && <> · <CarrierMark carrier={o.carrier} size={13}/> {o.carrier}</>}{o.tracking ? " · " + o.tracking : ""}
                  </div>
                  {when && <div className="m-row-sub" style={{ fontSize: 11, color: "var(--faint)", marginTop: 1 }}>{when}</div>}
                </div>
              </button>
            );
          };
          if (!filtered.length) return (
            <div className="m-list"><div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              {tab === 1 ? "ไม่มีออร์เดอร์ค้างส่ง" : "ไม่มีออร์เดอร์"}
              {tab !== 0 && <div><button className="m-chip" style={{ marginTop: 10 }} onClick={() => setTab(0)}>ดูทั้งหมด</button></div>}
            </div></div>
          );
          return (
            <>
              {/* Rendered in pages — drawing all 265 rows at once made the tab slow on phones. */}
              {named.length > 0 && (<>
                {unnamed.length > 0 && <div className="m-section-label" style={{ padding: "0 4px 6px" }}>มีชื่อผู้รับ ({named.length})</div>}
                <div className="m-list">{named.slice(0, showN).map(renderRow)}</div>
              </>)}
              {unnamed.length > 0 && showN >= named.length && (<>
                <div className="m-section-label" style={{ padding: "12px 4px 6px" }}>ฉลากไม่ระบุชื่อ ({unnamed.length})</div>
                <div className="m-list">{unnamed.slice(0, Math.max(0, showN - named.length)).map(renderRow)}</div>
              </>)}
              {filtered.length > showN && (
                <button className="m-btn-big outline" style={{ marginTop: 10 }} onClick={() => setShowN(n => n + 60)}>
                  ดูเพิ่ม — แสดง {showN} จาก {filtered.length}
                </button>
              )}
            </>
          );
        })()}
      </div>

      {selecting && selectedCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selectedCount}</span>
          <span style={{ fontSize: 12, flex: 1 }}>เลือก {selectedCount} ออร์เดอร์</span>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkMenu(bulkMenu === "status" ? null : "status")}><Icons.Truck size={14}/></button>
          <button className="m-action" style={{ background: "rgba(90,180,255,0.3)", color: "white", width: 36, height: 36 }} title="ฉลากของออร์เดอร์ที่เลือก" onClick={openSelectedLabels}><Icons.Tag size={14}/></button>
          {canDeleteData() && <button className="m-action" style={{ background: "rgba(255,170,60,0.35)", color: "white", width: 36, height: 36 }} title="ยกเลิก + คืนสต็อก" onClick={bulkCancelRestock}><Icons.Refresh size={14}/></button>}
          {canDeleteData() && <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={bulkDelete}><Icons.Trash size={14}/></button>}
          {bulkMenu === "status" && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 8px)", right: 12,
              background: "var(--surface)", color: "var(--fg)",
              border: "1px solid var(--border)", borderRadius: 12,
              boxShadow: "var(--shadow-lg)", padding: 6, minWidth: 180, zIndex: 30
            }}>
              <div style={{ padding: "6px 10px 4px", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>เปลี่ยนสถานะเป็น</div>
              {["picking", "packed", "shipped"].map(id => ({ id, label: ORDER_STATUS_TH[id] })).map(s => (
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
  // all | ok | low | out — preset when opened from the home "ต้องสั่งซื้อ" tile.
  const [statusFilter, setStatusFilter] = useStateM(() => (ctx.route.params && ctx.route.params.status) || "all");
  const [locFilter, setLocFilter] = useStateM(false); // true = only products not stored in a real position
  // Rendered in pages: all 424 rows (with photos) on every tab switch was slow on phones.
  const [showN, setShowN] = useStateM(50);
  useEffectM(() => { setShowN(50); }, [q, cat, statusFilter, locFilter]);
  const [selecting, setSelecting] = useStateM(false);
  const [selected, setSelected] = useStateM({});
  const [bulkOpen, setBulkOpen] = useStateM(false);
  const [addOpen, setAddOpen] = useStateM(false);
  const [stockKey, setStockKey] = useStateM(0);

  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-locations-change", refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-locations-change", refresh);
    };
  }, []);

  const products = useMemoM(() => {
    const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
    return PRODUCTS.map(p => ({ ...p, qty: Math.max(0, p.qty + (adj[p.sku] || 0)) }));
  }, [stockKey]);

  // Loc codes that are real positions — stale codes (e.g. legacy "A") count as unstored.
  const storedCodes = useMemoM(() => storedLocSet(), [stockKey]);
  const unstoredCount = useMemoM(() => products.reduce((n, p) => n + (productIsStored(p, storedCodes) ? 0 : 1), 0), [products, storedCodes]);

  const cats = useMemoM(() => ["ทั้งหมด", ...(typeof loadCategories === "function" ? loadCategories() : [...new Set(products.map(p => p.cat))])], [products]);
  const filtered = products.filter(p => {
    if (cat !== "ทั้งหมด" && p.cat !== cat) return false;
    if (statusFilter !== "all" && stockStatus(p).key !== statusFilter) return false;
    if (locFilter && productIsStored(p, storedCodes)) return false;
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

  const exportInventoryCsv = () => {
    // Same rule as desktop: no viewCost → the ต้นทุน column never reaches the file.
    const showCost = canDo("viewCost");
    const csvRows = [["SKU", "ชื่อสินค้า", "หมวด", "คงเหลือ", "จุดสั่ง", "ราคา", ...(showCost ? ["ต้นทุน"] : [])]];
    filtered.forEach(p => {
      csvRows.push([p.sku, `"${(p.name || "").replace(/"/g, '""')}"`, p.cat || "", p.qty, p.reorder || 0, p.price || 0, ...(showCost ? [p.cost || 0] : [])]);
    });
    const csv = "﻿" + csvRows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "inventory.csv"; a.click();
    URL.revokeObjectURL(url);
    ctx.pushToast(`ส่งออก CSV ${filtered.length} รายการ`);
  };

  const addProduct = (p) => {
    // _locRows = the multi-position split from the sheet. Strip with omit() —
    // object-rest would collide with another file's Babel temp (see CLAUDE.md).
    const rows = p._locRows;
    const clean = (typeof omit === "function") ? omit(p, "_locRows") : p;
    addProductToStore({ ...clean, reserved: 0 });
    if (rows && rows.length > 1 && typeof saveLocSplit === "function") {
      saveLocSplit(p.sku, rows).then(res => {
        if (res && res.ok === false) ctx.pushToast(res.error || "บันทึกการแบ่งตำแหน่งไม่สำเร็จ");
      }).catch(() => {});
    }
    ctx.pushToast(`เพิ่ม SKU ${p.sku} แล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: p.sku, action: "create",
        summary: `เพิ่มสินค้าใหม่ ${p.name} (${p.sku}) (มือถือ)`,
        changes: [{ label: "จำนวนเริ่มต้น", to: String(p.qty) },
                  { label: "ตำแหน่ง", to: rows && rows.length > 1 ? rows.map(r => `${locParts(r.loc).pos} ×${r.qty}`).join(" · ") : p.loc }]
      });
    }
    setAddOpen(false);
  };

  return (
    <>
      <div className="m-topbar">
        <div className="m-title">สินค้าคงคลัง</div>
        {!selecting && canDo("exportData") && <button className="m-action" title="รายงานสต็อก Excel" onClick={() => { if (typeof downloadStockReport === "function") downloadStockReport(products); }}><Icons.Dash size={14}/></button>}
        {!selecting && canDo("exportData") && <button className="m-action" title="ส่งออก CSV" onClick={exportInventoryCsv}><Icons.Pkg size={14}/></button>}
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)}>
          {selecting ? <Icons.X size={16}/> : <Icons.Check size={16}/>}
        </button>
        {!selecting && canDo("addProduct") && <button className="m-action accent" onClick={() => setAddOpen(true)}><Icons.Plus size={18}/></button>}
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

        {/* Stock-status filter (mirrors desktop): พร้อมขาย / ต่ำ / หมด + ยังไม่จัดเก็บ */}
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
          {(unstoredCount > 0 || locFilter) && (
            <button
              className={"m-chip" + (locFilter ? " on" : "")}
              onClick={() => setLocFilter(v => !v)}
              style={!locFilter ? { background: "var(--warning-soft)", color: "oklch(0.5 0.13 65)", borderColor: "transparent", fontWeight: 600 } : {}}>
              <Icons.Warn size={11} style={{ marginRight: 4, verticalAlign: "-1px" }}/>ยังไม่จัดเก็บ {unstoredCount}
            </button>
          )}
        </div>

        <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, padding: "0 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{filtered.length} จาก {products.length} รายการ{selecting && <span> · แตะเพื่อเลือก</span>}</span>
          {(cat !== "ทั้งหมด" || statusFilter !== "all" || locFilter || q) && (
            <button onClick={() => { setCat("ทั้งหมด"); setStatusFilter("all"); setLocFilter(false); setQ(""); }}
              style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}>ล้างตัวกรอง</button>
          )}
        </div>

        <div className="m-list">
          {filtered.slice(0, showN).map(p => {
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
                  <div className="row" style={{ gap: 6, marginTop: 2, flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                    <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>{s.label}</span>
                    {!productIsStored(p, storedCodes) && <span className="badge badge-warning" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }}><Icons.Warn size={9}/> ยังไม่จัดเก็บ</span>}
                  </div>
                  {/* Every shelf this SKU sits on, with the pieces at each — the list
                      used to name only the primary one, hiding split stock entirely. */}
                  {productIsStored(p, storedCodes) && (() => {
                    const spots = (typeof productPositions === "function") ? productPositions(p) : [];
                    if (!spots.length) return null;
                    // A row filed under "-" / a deleted shelf reads as unplaced, not "-".
                    const anyFake = spots.some(s2 => !locIsStored(s2.loc, storedCodes));
                    const label = spots.map(s2 => {
                      const lp = locIsStored(s2.loc, storedCodes) ? locParts(s2.loc) : null;
                      return (lp && lp.pos ? lp.pos : "ยังไม่ระบุตำแหน่ง") + (spots.length > 1 ? " ×" + s2.qty : "");
                    }).join(" · ");
                    return (
                      <div className="row" style={{ gap: 4, marginTop: 2, minWidth: 0 }}>
                        <Icons.Map size={10} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                        <span className={anyFake ? undefined : "mono"} style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                      </div>
                    );
                  })()}
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
        {filtered.length > showN && (
          <button className="m-btn-big outline" style={{ marginTop: 10 }} onClick={() => setShowN(n => n + 50)}>
            ดูเพิ่ม — แสดง {showN} จาก {filtered.length}
          </button>
        )}
      </div>

      {selecting && selectedCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600 }} className="tnum">{selectedCount}</span>
          <span style={{ fontSize: 12, flex: 1 }}>เลือก {selectedCount} รายการ</span>
          {canDo("editProduct") && <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => setBulkOpen(true)}><Icons.Edit size={14}/></button>}
          <button className="m-action" style={{ background: "rgba(255,255,255,0.15)", color: "white", width: 36, height: 36 }} onClick={() => { const items = [...selectedSkus].map(s => products.find(p => p.sku === s)).filter(Boolean); if (typeof printBarcodeLabels === "function") printBarcodeLabels(items, ctx.pushToast); }}><Icons.Print size={14}/></button>
          {canDeleteData() && <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={async () => { if (!confirm(`ลบ ${selectedCount} รายการ?`)) return; const rm = [...selectedSkus]; clear(); const res = await removeProductsFromStore(rm); if (res && res.ok === false) { ctx.pushToast(res.error); return; } ctx.pushToast(`ลบ ${rm.length} รายการ`); }}><Icons.Trash size={14}/></button>}
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
    cost: "", price: "", qty: "", reorder: "2", loc: ""
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const [pickedImage, setPickedImage] = useStateM("");
  /* Storage positions (add mode). Row 0 = primary/pick-first = products.loc;
     2+ rows become the product_locations split and must sum to the opening qty. */
  const [locRows, setLocRows] = useStateM(() => [{ loc: editing ? (editing.loc || "") : "", qty: "" }]);
  const filledLocRows = locRows.filter(r => (r.loc || "").trim());
  const multiLoc = !editing && filledLocRows.length > 1;
  const splitSum = filledLocRows.reduce((n, r) => n + (parseInt(r.qty, 10) || 0), 0);
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
  /* No viewCost → the ต้นทุน field is hidden, so it can't be required: keep the
     product's existing cost when editing, else fall back to 60% of price (the
     same estimate the CSV importer uses). Mirrors the desktop modals. */
  const showCost = canDo("viewCost");
  const price = num(f.price), qty = num(f.qty), reorder = num(f.reorder);
  const cost = showCost ? num(f.cost)
    : (editing && Number.isFinite(Number(editing.cost)) ? Number(editing.cost)
      : (price === null ? null : Math.round(price * 0.6)));
  const splitOk = !multiLoc || (qty !== null && splitSum === Math.round(qty));
  const canSave = skuTrim && !dupe && f.name.trim() &&
    cost !== null && price !== null && qty !== null && reorder !== null && splitOk;

  const save = () => {
    if (!canSave) return;
    const catVal = (f.cat || "ทั่วไป").trim();
    // Register a brand-new category typed here so it persists + syncs.
    if (typeof addCategory === "function") { try { addCategory(catVal); } catch (e) {} }
    // Carry over the picked stock/catalog image so the new product shows it.
    if (!editing && pickedImage && typeof setProductImage === "function") {
      try { setProductImage(skuTrim, pickedImage); } catch (e) {}
    }
    const rows = filledLocRows.map(r => ({
      loc: r.loc.trim(),
      qty: multiLoc ? (parseInt(r.qty, 10) || 0) : Math.round(qty)
    }));
    const common = {
      sku: skuTrim, name: f.name.trim(), cat: catVal,
      brand: (f.brand || "").trim(),
      supplier: (f.supplier || "").trim(), cost, price,
      reorder: Math.round(reorder),
      loc: rows.length ? rows[0].loc : ""
    };
    // Only ever attach on ADD, and only when there IS a split — an unknown key
    // reaching updateProductInStore would be sent to the DB as a column.
    if (!editing && rows.length > 1) common._locRows = rows;
    // Edit mode: send qty as a CHANGE relative to what the sheet was opened
    // showing (editing.qty), not an absolute value. So an untouched qty writes
    // nothing, and a real edit becomes an atomic ±delta that can't clobber a sale
    // another device made while the sheet was open. Add mode keeps absolute qty.
    if (editing) onAdd({ ...common, _qtyDelta: Math.round(qty) - Number(editing.qty ?? 0) });
    else onAdd({ ...common, qty: Math.round(qty) });
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
          <div style={{ display: "grid", gridTemplateColumns: showCost ? "1fr 1fr" : "1fr", gap: 10 }}>
            {showCost && (
              <div>
                <div className="m-section-label" style={{ padding: "0 2px 4px" }}>ต้นทุน (฿) *</div>
                <input className="m-input" type="number" min="0" value={f.cost} onChange={e => set("cost", e.target.value)} placeholder="0"/>
              </div>
            )}
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
          </div>

          {/* ── Storage positions — mirrors the desktop add form: row 0 is the
                pick-first shelf, extra rows split the opening stock. Editing keeps
                the single field (quantities move through ปรับสต็อก). ── */}
          <div>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", padding: "0 2px 4px" }}>
              <div className="m-section-label" style={{ padding: 0 }}>ตำแหน่งจัดเก็บ</div>
              {!editing && (
                <button type="button" onClick={() => setLocRows(rs => [...rs, { loc: "", qty: "" }])}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "4px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--accent)", fontWeight: 600, fontFamily: "inherit" }}>
                  <Icons.Plus size={11}/> เพิ่มตำแหน่ง
                </button>
              )}
            </div>
            {locRows.map((r, i) => (
              <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
                <LocationSelect mobile style={{ flex: 1 }} value={r.loc}
                  noneLabel={i === 0 ? "— เลือกตำแหน่ง (ไม่บังคับ) —" : "— เลือกตำแหน่งเพิ่ม —"}
                  onChange={v => setLocRows(rs => rs.map((x, j) => j === i ? { ...x, loc: v } : x))}/>
                {multiLoc && (
                  <input className="m-input tnum" type="number" min="0" style={{ width: 72, textAlign: "right" }}
                    value={r.qty} placeholder="0"
                    onChange={e => { const v = e.target.value; setLocRows(rs => rs.map((x, j) => j === i ? { ...x, qty: v } : x)); }}/>
                )}
                {i > 0 && (
                  <button type="button" onClick={() => setLocRows(rs => rs.filter((_, j) => j !== i))}
                    style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)", flexShrink: 0 }}>
                    <Icons.X size={13}/>
                  </button>
                )}
              </div>
            ))}
            {multiLoc && (
              <div style={{ fontSize: 11, color: splitOk ? "var(--muted)" : "var(--danger)", padding: "0 2px" }}>
                {splitOk ? `แบ่งครบ ${splitSum} ชิ้น (ตำแหน่งแรก = หยิบก่อน)` : `รวม ${splitSum} ชิ้น — ต้องเท่ากับจำนวนเริ่มต้น ${qty === null ? 0 : Math.round(qty)} ชิ้น`}
              </div>
            )}
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
  const [vals, setVals] = useStateM({ cat: categories[0] || "", loc: "", supplier: "", reorder: 2 });
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
  const [renameOpen, setRenameOpen] = useStateM(false);
  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-stock-adj-change", refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-stock-adj-change", refresh);
    };
  }, []);

  const locImages = useLocationImages();

  /* Movement history (stock_adjustments) — the same ledger the desktop product
     drawer reads. Mobile never had one, so a picker standing at the shelf could
     not tell whether the piece they were missing had been sold, received or
     counted. Re-fetched a beat after any stock change so a correction made here
     shows up instead of looking like it wasn't saved. */
  const [moves, setMoves] = useStateM(null);
  const [movesTick, setMovesTick] = useStateM(0);
  useEffectM(() => {
    let t = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => setMovesTick(v => v + 1), 900); };
    window.addEventListener("ims-products-change", bump);
    // Fired once a history row has actually been written (this device), and on
    // a realtime stock event from another one — no more racing the insert.
    const now = () => setMovesTick(v => v + 1);
    window.addEventListener("ims-ledger-change", now);
    return () => { if (t) clearTimeout(t); window.removeEventListener("ims-products-change", bump); window.removeEventListener("ims-ledger-change", now); };
  }, []);
  const moveSku = ctx.route.params?.sku;
  useEffectM(() => {
    let dead = false;
    if (typeof dbLoadStockAdjustments === "function" && moveSku) {
      dbLoadStockAdjustments(moveSku, 12)
        .then(rows => { if (!dead) setMoves(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (!dead) setMoves([]); });
    } else setMoves([]);
    return () => { dead = true; };
  }, [moveSku, movesTick]);

  const base = PRODUCTS.find(x => x.sku === ctx.route.params?.sku) || ctx.route.params;
  if (!base) { ctx.back(); return null; }
  const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
  const p = { ...base, qty: Math.max(0, base.qty + (adj[base.sku] || 0)) };
  const s = stockStatus(p);
  const channels = (typeof channelSalesFor === "function") ? channelSalesFor(p.sku) : [];
  const cats = typeof loadCategories === "function" ? loadCategories() : [...new Set(PRODUCTS.map(x => x.cat))];

  const doEdit = (changes) => {
    const _qtyDelta = changes._qtyDelta;
    const fields = omit(changes, "_qtyDelta");
    updateProductInStore(p.sku, fields);                 // catalog fields — scoped, no qty
    if (_qtyDelta) {
      // qty edit → atomic delta, never an absolute clobber. Routed through the
      // shared helper so the history row carries the SERVER's confirmed amount.
      if (typeof receiveStockAndRecord === "function") {
        receiveStockAndRecord([{ sku: p.sku, qty: _qtyDelta }], "แก้ไขจำนวนจากหน้าสินค้า (มือถือ)");
      } else {
        adjustProductQty(p.sku, _qtyDelta);
      }
    }
    ctx.pushToast(`บันทึกการแก้ไข ${p.sku} แล้ว`);
    if (typeof recordChange === "function") {
      const auditChanges = Object.entries(fields).map(([k, v]) => ({ label: k, to: String(v) }));
      if (_qtyDelta) auditChanges.push({ label: "qty", to: `${_qtyDelta > 0 ? "+" : ""}${_qtyDelta} ชิ้น` });
      recordChange({
        entity: "product", entityId: p.sku, action: "update",
        // The quantity goes in the summary — it is all the activity feed shows.
        summary: `แก้ไขข้อมูลสินค้า ${fields.name || p.name} (${p.sku})${_qtyDelta ? ` จำนวน ${_qtyDelta > 0 ? "+" : ""}${_qtyDelta} ชิ้น` : ""} (มือถือ)`,
        changes: auditChanges
      });
    }
    setEditOpen(false);
  };
  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub" style={{ fontSize: 14 }}>{p.sku}</div>
        {canDo("renameSku") && <button className="m-action" title="แก้ไขรหัส SKU" onClick={() => setRenameOpen(true)}><Icons.Tag size={14}/></button>}
        {canDo("editProduct") && <button className="m-action" onClick={() => setEditOpen(true)}><Icons.Edit size={14}/></button>}
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

        {/* ── Storage position: photo + big position code — visual confirmation for pickers ── */}
        <div className="m-section-label" style={{ padding: "8px 4px" }}>ตำแหน่งจัดเก็บ</div>
        <div className="m-card" style={{ padding: 12 }}>
          {(() => {
            const home = productHomeLoc(p);
            const parts = home ? locParts(home) : null;
            if (!parts) return (
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "8px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span className="badge badge-warning" style={{ fontSize: 10 }}><Icons.Warn size={10}/> ยังไม่จัดเก็บ</span>
                <span>แก้ไขสินค้าเพื่อกำหนดตำแหน่งจัดเก็บ</span>
              </div>
            );
            const photo = typeof getLocationImage === "function" ? getLocationImage(home, locImages) : "";
            /* Stock kept in more than one place: p.loc is only the FIRST shelf to
               try. Showing it alone sent pickers to zone A for 83 pieces when 51
               of them were upstairs — so list every position with its own count. */
            const split = typeof productPositions === "function" ? productPositions(p) : [];
            const isSplit = split.length > 1;
            const here = isSplit ? (split.find(r => r.loc === home) || {}).qty : null;
            return (
              <>
              <div className="row" style={{ gap: 12 }}>
                {photo ? (
                  <img src={photo} alt="" loading="lazy" decoding="async" style={{ width: 76, height: 76, borderRadius: 10, objectFit: "cover", border: "1px solid var(--border)", flexShrink: 0 }}/>
                ) : (
                  <div style={{ width: 76, height: 76, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--accent)", flexShrink: 0 }}>
                    <Icons.Map size={24}/>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mono" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>{parts.pos}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{parts.building}{parts.floor ? " · " + parts.floor : ""}</div>
                  {isSplit && here != null && (
                    <div style={{ fontSize: 12, marginTop: 4 }}>
                      <strong className="tnum" style={{ fontSize: 15 }}>{here}</strong>
                      <span style={{ color: "var(--muted)" }}> ชิ้นที่นี่ · หยิบก่อน</span>
                    </div>
                  )}
                </div>
              </div>
              {isSplit && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                    อีก {split.length - 1} ตำแหน่ง (รวม {p.qty} ชิ้น)
                  </div>
                  {split.filter(r => r.loc !== home).map((r, i) => {
                    // A row filed under "-" / a deleted shelf reads as unplaced, not "-".
                    const real = locIsStored(r.loc);
                    const lp = real && typeof locParts === "function" ? locParts(r.loc) : null;
                    return (
                      <div key={r.loc + i} className="row" style={{ justifyContent: "space-between", padding: "5px 0" }}>
                        <div style={{ minWidth: 0 }}>
                          {real
                            ? <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{lp ? lp.pos : r.loc}</span>
                            : <span style={{ fontSize: 13, fontWeight: 600, color: "var(--warning)" }}>ยังไม่ระบุตำแหน่ง</span>}
                          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>
                            {lp ? lp.building + (lp.floor ? " · " + lp.floor : "") : ""}
                          </span>
                        </div>
                        <span className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{r.qty}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              </>
            );
          })()}
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>ข้อมูล</div>
        <div className="m-list">
          <MetaRow label="SKU" value={p.sku} mono/>
          <MetaRow label="แบรนด์" value={p.brand || "—"}/>
          <MetaRow label="ผู้จัดส่ง" value={p.supplier}/>
          <MetaRow label="ราคา" value={`฿${p.price.toLocaleString()}`}/>
          <MetaRow label="จุดสั่งซื้อใหม่" value={`${p.reorder} ชิ้น`}/>
        </div>

        {canDo("viewSales") && <>
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
                      <ChannelMark channel={c.id} size={14}/>
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
        </>}

        <div className="m-section-label" style={{ padding: "8px 4px" }}>ความเคลื่อนไหวสต็อกล่าสุด</div>
        <div className="m-card" style={{ padding: "6px 10px" }}>
          {moves === null && (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0", textAlign: "center" }}>กำลังโหลด…</div>
          )}
          {moves && moves.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0", textAlign: "center" }}>ยังไม่มีการเคลื่อนไหวสต็อก</div>
          )}
          {(moves || []).map(m => (
            <div key={m.id} className="row" style={{ gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: m.delta > 0 ? "var(--success)" : "var(--danger)" }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.reason || "ปรับสต็อก"}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                  {new Date(m.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {m.created_by || "ระบบ"}
                </div>
              </div>
              <div className="tnum" style={{ fontSize: 13, fontWeight: 600, color: m.delta > 0 ? "var(--success)" : "var(--danger)" }}>
                {m.delta > 0 ? "+" : ""}{m.delta}
              </div>
            </div>
          ))}
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px" }}>บาร์โค้ดสินค้า</div>
        <div className="m-card" style={{ textAlign: "center", padding: "14px 12px" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>บาร์โค้ดสินค้า</div>
            <button className="btn btn-sm" onClick={() => { if (typeof printBarcodeLabels === "function") printBarcodeLabels([p], ctx.pushToast); }}><Icons.Print size={13}/> พิมพ์</button>
          </div>
          <Barcode value={p.sku} height={50}/>
          <div className="mono" style={{ fontSize: 12, marginTop: 4, letterSpacing: "0.06em" }}>{p.sku}</div>
        </div>

        {canDo("sell") && (
          <button className="m-btn-big success" style={{ marginTop: 8 }} disabled={(p.qty - (p.reserved || 0)) <= 0} onClick={() => ctx.push("sell", { sku: p.sku })}>
            <Icons.Cart size={16}/> ขายสินค้า
          </button>
        )}
        <div style={{ display: "grid", gridTemplateColumns: (canAdjustStock() && canDo("sell")) ? "1fr 1fr" : "1fr", gap: 8, marginTop: 8 }}>
          {canAdjustStock() && (
            <button className="m-btn-big outline" onClick={() => ctx.push("adjust", { sku: p.sku })}>
              <Icons.Refresh size={15}/> ปรับสต็อก
            </button>
          )}
          {canDo("sell") && (
            <button className="m-btn-big warn" onClick={() => ctx.push("issue", { sku: p.sku })}>
              <Icons.Out size={15}/> ตัดสต็อก
            </button>
          )}
        </div>
      </div>
      {editOpen && (
        <MAddSku categories={cats} products={PRODUCTS} editing={base} onClose={() => setEditOpen(false)} onAdd={doEdit}/>
      )}
      {renameOpen && typeof RenameSkuModal === "function" && (
        <RenameSkuModal
          sku={p.sku}
          pushToast={ctx.pushToast}
          onClose={() => setRenameOpen(false)}
          onRenamed={(newSku) => {
            if (typeof recordChange === "function") {
              recordChange({
                entity: "product", entityId: newSku, action: "update",
                summary: `เปลี่ยนรหัส SKU ${p.sku} → ${newSku} (มือถือ)`,
                changes: [{ label: "sku", from: p.sku, to: newSku }]
              });
            }
            setRenameOpen(false);
            ctx.back();
          }}
        />
      )}
    </>
  );
}

/* =============== STOCK ADJUST (ปรับสต็อก — full-screen) ===============
   Reasoned adjustment for miscounts / damaged items / sales made outside the
   system (Shopee, Lazada, หน้าร้าน …). Mirrors the desktop StockAdjustModal —
   MULTI-SKU with product photos, per-row จำนวน and one shared
   รูปแบบ/เหตุผล/หมายเหตุ — and both funnel through applyStockAdjustmentBatch →
   applyStockAdjustment (data.jsx) so the forks can't diverge. Never creates an
   order — that's MIssue (ตัดสต็อก)'s job. */
/* =============== ขายออก (quick sale) — mobile twin of QuickSellModal ===============
   Scan / search → quantity → channel → confirm, through commitQuickSale (data.jsx):
   the same write as ปรับสต็อก "ขายผ่าน …", so analytics counts it. The screen stays
   open with the channel kept after each sale, ready for the next one. */
function MQuickSell({ ctx }) {
  const channels = useMemoM(() => (typeof quickSaleChannels === "function" ? quickSaleChannels() : []), []);
  const [reasonId, setReasonId] = useStateM(() => (typeof lastAdjustReason === "function" ? lastAdjustReason() : ""));
  const [lines, setLines] = useStateM(() => {
    const want = ctx.route.params && ctx.route.params.sku;
    const p = want && PRODUCTS.find(x => x.sku === want);
    return p ? [{ sku: p.sku, qty: "1", loc: typeof defaultPickLoc === "function" ? defaultPickLoc(p) : "" }] : [];
  });
  const [q, setQ] = useStateM("");
  const [note, setNote] = useStateM("");
  const [when, setWhen] = useStateM(""); // "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM"
  const [camOpen, setCamOpen] = useStateM(false);
  const [busy, setBusy] = useStateM(false);
  const busyRef = useRefM(false);
  const [, setTick] = useStateM(0);
  useEffectM(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener("ims-products-change", h);
    window.addEventListener("ims-stock-adj-change", h);
    return () => { window.removeEventListener("ims-products-change", h); window.removeEventListener("ims-stock-adj-change", h); setCamOpen(false); };
  }, []);
  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : ((PRODUCTS.find(p => p.sku === sku) || {}).qty || 0));

  const add = (sku) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (!p) return;
    if (effQty(sku) <= 0) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast(`${p.sku} หมดสต็อก`); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    setLines(ls => {
      const hit = ls.find(l => l.sku === sku);
      if (hit) return ls.map(l => l.sku === sku ? { ...l, qty: String(Math.min(effQty(sku), (parseInt(l.qty, 10) || 0) + 1)) } : l);
      return [...ls, { sku, qty: "1", loc: typeof defaultPickLoc === "function" ? defaultPickLoc(p) : "" }];
    });
    setQ("");
  };
  const lq = q.trim().toLowerCase();
  const hits = !lq ? [] : PRODUCTS.filter(p => p.sku.toLowerCase().includes(lq) || String(p.name || "").toLowerCase().includes(lq))
    .sort((a, b) => (a.sku.toLowerCase() === lq ? -1 : b.sku.toLowerCase() === lq ? 1 : 0))
    .slice(0, 8);
  const onSearchKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = PRODUCTS.find(p => p.sku.toLowerCase() === lq);
    if (exact) { add(exact.sku); return; }
    if (hits.length === 1) { add(hits[0].sku); return; }
    if (lq && !hits.length) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast("ไม่พบสินค้า: " + q.trim()); }
  };
  const onCamScan = (code) => {
    const c = String(code || "").trim();
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === c.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast("ไม่พบ SKU: " + c); return; }
    add(p.sku);
  };
  const setLine = (sku, patch) => setLines(ls => ls.map(l => l.sku === sku ? { ...l, ...patch } : l));
  const pieces = lines.reduce((n, l) => n + (parseInt(l.qty, 10) || 0), 0);
  const overStock = lines.find(l => (parseInt(l.qty, 10) || 0) > effQty(l.sku));
  const canSubmit = !!reasonId && pieces > 0 && !overStock && !busy;

  const submit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true; setBusy(true);   // synchronous latch — a double-tap must not sell twice
    const res = await commitQuickSale({ lines: lines.map(l => ({ sku: l.sku, qty: parseInt(l.qty, 10) || 0, loc: l.loc })), reasonId, note: note.trim(), source: "mobile", when });
    busyRef.current = false; setBusy(false);
    if (!res.ok) { if (res.error) ctx.pushToast(res.error); return; }
    const ch = channels.find(c => c.id === reasonId);
    const st = when && typeof stockOutStamp === "function" ? stockOutStamp(when) : null;
    const backTxt = st && st.backdated ? ` (ย้อนหลัง ${stockOutStampLabel(st)})` : "";
    ctx.pushToast(`ขายออก ${res.pieces} ชิ้น · ${ch ? ch.label : ""}${backTxt}` + (res.locWarning ? " — " + res.locWarning : ""));
    setLines([]); setNote("");
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ขายออก</div>
        <button className="m-action" onClick={() => setCamOpen(o => !o)} aria-label="สแกน"><Icons.Camera size={16}/></button>
      </div>
      <div className="m-content">
        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>ช่องทางขาย</div>
        <div className="adj-reasons" style={{ marginBottom: 14 }}>
          {channels.map(c => (
            <button key={c.id} type="button" className={"adj-reason" + (reasonId === c.id ? " on" : "")} onClick={() => setReasonId(c.id)}>
              <ChannelMark channel={c.ch} size={16}/> {c.label}
            </button>
          ))}
        </div>

        {camOpen && <div style={{ marginBottom: 10 }}><CameraScanner continuous onScan={onCamScan} onClose={() => setCamOpen(false)}/></div>}
        <div className="m-search" style={{ marginBottom: hits.length ? 6 : 12 }}>
          <Icons.Search size={14}/>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="สแกน / พิมพ์ SKU หรือชื่อสินค้า"/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>
        {hits.length > 0 && (
          <div className="m-list" style={{ marginBottom: 12 }}>
            {hits.map(p => {
              const left = effQty(p.sku);
              return (
                <button key={p.sku} className="m-row" style={{ opacity: left > 0 ? 1 : 0.5 }} onClick={() => add(p.sku)}>
                  <ProductImageThumb sku={p.sku} size={40} radius={8}/>
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="m-row-sub"><span className="mono">{p.sku}</span> · {left > 0 ? `เหลือ ${left}` : "หมด"}</div>
                  </div>
                  <Icons.Plus size={18} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                </button>
              );
            })}
          </div>
        )}

        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>สินค้าที่ขาย {lines.length > 0 && <span style={{ color: "var(--accent)" }}>({lines.length})</span>}</div>
        {lines.length === 0 ? (
          <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, border: "1px dashed var(--border)" }}>
            สแกนหรือค้นหาด้านบน — สแกนซ้ำ = +1 ชิ้น
          </div>
        ) : (
          <div className="m-list">
            {lines.map(l => {
              const p = PRODUCTS.find(x => x.sku === l.sku) || { sku: l.sku, name: l.sku };
              const left = effQty(l.sku);
              const n = parseInt(l.qty, 10) || 0;
              return (
                <div key={l.sku} className="m-row" style={{ cursor: "default", alignItems: "flex-start" }}>
                  <ProductImageThumb sku={l.sku} size={40} radius={8}/>
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="m-row-sub" style={{ color: n > left ? "var(--danger)" : undefined }}>
                      <span className="mono">{l.sku}</span> · เหลือ {left}{n > left ? " — เกินสต็อก" : ""}
                    </div>
                    <MLocPickChips sku={l.sku} value={l.loc} need={n} onChange={loc => setLine(l.sku, { loc })}/>
                  </div>
                  <QtyStepper small value={l.qty} min={1} max={left} onChange={v => setLine(l.sku, { qty: v })} title={`จำนวน ${l.sku}`}/>
                  <button onClick={() => setLines(ls => ls.filter(x => x.sku !== l.sku))} aria-label="เอาออก"
                    style={{ display: "grid", placeItems: "center", width: 36, height: 36, border: "none", background: "transparent", color: "var(--muted)", flexShrink: 0 }}>
                    <Icons.X size={15}/>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="m-section-label" style={{ padding: "14px 4px 8px" }}>หมายเหตุ (ไม่จำเป็น)</div>
        <input className="m-input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เลขออร์เดอร์ Shopee, ชื่อลูกค้า"/>

        <MStockOutWhen value={when} onChange={setWhen} label="วันเวลาที่ขาย" hint="ขายย้อนหลัง? เลือกวันเวลาที่ขายจริง — ยอดขายจะนับเป็นวันนั้น"/>

        <button className="m-btn-big" style={{ marginTop: 14 }} disabled={!canSubmit} onClick={submit}>
          <Icons.Check size={16}/> {busy ? "กำลังบันทึก…" : !reasonId ? "เลือกช่องทางขายก่อน" : `ยืนยันขาย${pieces ? " " + pieces + " ชิ้น" : ""}`}
        </button>
      </div>
    </>
  );
}

function MAdjust({ ctx }) {
  const [rows, setRows] = useStateM(() => {
    const want = ctx.route.params?.sku;
    return (want && PRODUCTS.some(p => p.sku === want)) ? [{ sku: want, amount: "" }] : [];
  });
  const [pickOpen, setPickOpen] = useStateM(false);
  const [q, setQ] = useStateM("");
  const [showN, setShowN] = useStateM(40);
  const [camOpen, setCamOpen] = useStateM(false);
  const [mode, setMode] = useStateM("remove"); // add | remove | set
  const [reasonId, setReasonIdRaw] = useStateM(() => (typeof lastAdjustReason === "function" ? lastAdjustReason() : ""));
  const setReasonId = (id) => { setReasonIdRaw(id); if (typeof rememberAdjustReason === "function") rememberAdjustReason(id); };
  const [busy, setBusy] = useStateM(false);
  const [fillValue, setFillValue] = useStateM("");   // "ใส่เท่ากันทุกแถว" box
  const busyRef = useRefM(false);
  const [note, setNote] = useStateM("");
  const [when, setWhen] = useStateM(""); // "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM"
  useEffectM(() => () => setCamOpen(false), []);

  // Same mode filter as the desktop modal (adjustReasonsFor in data.jsx).
  const modeReasons = typeof adjustReasonsFor === "function" ? adjustReasonsFor(mode) : ADJUST_REASONS;
  const reason = modeReasons.find(r => r.id === reasonId) || null;
  const effQty = (sku) => (typeof getEffectiveQty === "function"
    ? getEffectiveQty(sku)
    : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));

  // Each row carries its own shelf — two SKUs in one batch live in different places.
  const newRow = (sku) => ({ sku, amount: "", loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(PRODUCTS.find(p => p.sku === sku)) : "" });
  const picked = (sku) => rows.some(r => r.sku === sku);
  const addSku = (sku) => setRows(rs => (rs.some(r => r.sku === sku) ? rs : [...rs, newRow(sku)]));
  const removeSku = (sku) => setRows(rs => rs.filter(r => r.sku !== sku));
  const toggleSku = (sku) => setRows(rs => (rs.some(r => r.sku === sku) ? rs.filter(r => r.sku !== sku) : [...rs, newRow(sku)]));
  const setAmount = (sku, v) => setRows(rs => rs.map(r => (r.sku === sku ? { ...r, amount: v } : r)));
  const setRowLoc = (sku, loc) => setRows(rs => rs.map(r => (r.sku === sku ? { ...r, loc } : r)));
  const fillAll = (v) => setRows(rs => rs.map(r => ({ ...r, amount: v })));

  // Per-row delta from the shared mode — identical rules to the desktop modal.
  const deltaOf = (row) => {
    const n = parseInt(row.amount, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    const cur = effQty(row.sku);
    if (mode === "add") return n;
    if (mode === "remove") return -Math.min(n, cur);
    return n - cur;
  };
  const changes = rows.map(r => ({ sku: r.sku, delta: deltaOf(r) })).filter(c => c.delta !== 0);
  const net = changes.reduce((s, c) => s + c.delta, 0);
  const canSubmit = changes.length > 0 && !!reason && (!reason.requireNote || note.trim());

  // Camera selection funnel — exact-match + beeps, same pattern as MStockTake.
  // Continuous mode: the scanner stays up so a whole batch is one session.
  const pick = (code) => {
    const s = String(code || "").trim();
    if (!s) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === s.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast("ไม่พบ SKU: " + s); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    if (picked(p.sku)) { ctx.pushToast(`${p.sku} เลือกไว้แล้ว`); return; }
    addSku(p.sku);
    ctx.pushToast(`เพิ่ม ${p.name}`);
  };

  const submit = async () => {
    if (!canSubmit || busyRef.current) return;
    // Synchronous latch + payload fingerprint — the desktop StockAdjustModal twin.
    // A double-tap used to apply the same correction twice.
    busyRef.current = true;
    setBusy(true);
    const guardKey = (typeof commitFingerprint === "function")
      ? commitFingerprint("adjust-" + mode + "-" + reasonId + (when ? "@" + when : ""), changes) : null;
    if (guardKey && typeof claimCommit === "function" && !claimCommit(guardKey)) {
      if (typeof duplicateCommitToast === "function") duplicateCommitToast();
      busyRef.current = false; setBusy(false);
      return;
    }
    const res = (typeof applyStockAdjustmentBatch === "function")
      ? applyStockAdjustmentBatch(changes, { reason, note, source: "mobile", when })
      : { applied: 0, net: 0 };
    if (!res.applied) {
      ctx.pushToast("ปรับสต็อกไม่สำเร็จ");
      if (guardKey && typeof releaseCommit === "function") releaseCommit(guardKey);
      busyRef.current = false; setBusy(false);
      return;
    }
    // Re-balance the split from the applied results (a clamped row contributes nothing).
    if (typeof applyLocPicks === "function") {
      const locBySku = {};
      rows.forEach(r => { locBySku[r.sku] = r.loc; });
      const picks = (res.results || changes).filter(r => r.ok !== false).map(r => ({ sku: r.sku, loc: locBySku[r.sku] }));
      const locRes = await applyLocPicks(picks);
      if (locRes && locRes.errors && locRes.errors.length) ctx.pushToast("ปรับสต็อกสำเร็จ แต่ปรับตำแหน่งไม่สำเร็จ — แก้ที่หน้าสินค้าบนเดสก์ท็อป");
    }
    const backSt = when && typeof stockOutStamp === "function" ? stockOutStamp(when) : null;
    const backTxt = backSt && backSt.backdated ? ` (ย้อนหลัง ${stockOutStampLabel(backSt)})` : "";
    ctx.pushToast((changes.length === 1
      ? `ปรับสต็อก ${changes[0].sku} ${res.net > 0 ? "+" : ""}${res.net} ชิ้น — ${reason.label}`
      : `ปรับสต็อก ${res.applied} รายการ (สุทธิ ${res.net > 0 ? "+" : ""}${res.net} ชิ้น)`) + backTxt);
    ctx.back();
  };

  const filtered = PRODUCTS.filter(p =>
    !q ||
    p.sku.toLowerCase().includes(q.toLowerCase()) ||
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    (p.cat || "").toLowerCase().includes(q.toLowerCase())
  );

  if (!PRODUCTS.length) {
    return (
      <>
        <div className="m-topbar">
          <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
          <div className="m-title-sub">ปรับสต็อก</div>
        </div>
        <div className="m-content">
          <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 20 }}>ยังไม่มีสินค้าในคลัง</div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.X size={14}/></button>
        <div className="m-title-sub">ปรับสต็อก</div>
        <button className="m-action accent" disabled={!canSubmit || busy} onClick={submit} style={(!canSubmit || busy) ? { opacity: 0.4 } : {}}>
          <Icons.Check size={14}/>
        </button>
      </div>
      <div className="m-content">
        <div style={{ fontSize: 11, color: "var(--muted)", margin: "0 4px 10px" }}>
          สำหรับนับสต็อกผิด สินค้าเสียหาย หรือขายนอกระบบ (Shopee / Lazada / หน้าร้าน) — ไม่สร้างออร์เดอร์
        </div>

        <div className="m-section-label" style={{ padding: "0 4px 8px", display: "flex", justifyContent: "space-between" }}>
          <span>สินค้า {rows.length > 0 && <span style={{ color: "var(--accent)" }}>({rows.length})</span>}</span>
          {rows.length > 0 && (
            <button onClick={() => setRows([])} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}>ล้างทั้งหมด</button>
          )}
        </div>

        <button className="m-btn-big" style={{ background: "var(--surface)", color: "var(--fg)", border: "1px solid var(--border)", marginBottom: 8 }}
          onClick={() => { setQ(""); setShowN(40); setPickOpen(true); }}>
          <Icons.Search size={16}/> {rows.length ? `เลือกสินค้าเพิ่ม (เลือกแล้ว ${rows.length})` : "เลือกสินค้า — เลือกได้หลายรายการ"}
        </button>

        {!camOpen && (
          <button className="m-btn-big dark" style={{ marginTop: 0, marginBottom: 0 }} onClick={() => setCamOpen(true)}>
            <Icons.Camera size={18}/> สแกนบาร์โค้ดเพิ่มรายการ
          </button>
        )}
        {camOpen && <CameraScanner continuous onScan={code => pick(code)} onClose={() => setCamOpen(false)}/>}

        {rows.length === 0 && (
          <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, border: "1px dashed var(--border)", marginTop: 10 }}>
            ยังไม่ได้เลือกสินค้า — แตะ “เลือกสินค้า” หรือสแกนบาร์โค้ด
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="m-section-label" style={{ padding: "12px 4px 8px" }}>รูปแบบ</div>
            <div className="seg" style={{ width: "100%" }}>
              <button className={mode === "add" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("add")}>เพิ่มเข้า</button>
              <button className={mode === "remove" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("remove")}>หักออก</button>
              <button className={mode === "set" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("set")}>ตั้งค่าเป็น</button>
            </div>

            <div className="m-section-label" style={{ padding: "12px 4px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{mode === "set" ? "จำนวนคงเหลือใหม่ (ต่อรายการ)" : "จำนวน (ชิ้น) ต่อรายการ"}</span>
              {rows.length > 1 && (
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>ใส่เท่ากันทุกแถว</span>
                  {typeof QtyStepper === "function"
                    ? <QtyStepper small value={fillValue}
                        onChange={v => { setFillValue(v); fillAll(v); }} title="ใส่จำนวนเท่ากันทุกแถว"/>
                    : <input className="m-input" type="text" inputMode="numeric" placeholder="0"
                        style={{ width: 64, padding: "6px 8px", fontSize: 13, textAlign: "right", marginBottom: 0 }}
                        onChange={e => fillAll(e.target.value.replace(/[^\d]/g, ""))}/>}
                </span>
              )}
            </div>

            <div className="m-list">
              {rows.map(r => {
                const p = PRODUCTS.find(x => x.sku === r.sku);
                const cur = effQty(r.sku);
                const d = deltaOf(r);
                return (
                  <div key={r.sku} className="m-row" style={{ cursor: "default" }}>
                    <ProductImageThumb sku={r.sku} size={40} radius={8}/>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p ? p.name : r.sku}</div>
                      <div className="row" style={{ gap: 6, marginTop: 2 }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{r.sku}</span>
                        <span className="tnum" style={{ fontSize: 10, color: d === 0 ? "var(--muted)" : d > 0 ? "var(--success)" : "var(--danger)" }}>
                          {d === 0 ? `คงเหลือ ${cur}` : `${cur} → ${Math.max(0, cur + d)}`}
                        </span>
                      </div>
                      {/* Neutral label — the delta can be positive. */}
                      <MLocPickChips sku={r.sku} value={r.loc} need={d < 0 ? -d : 0} label="ตำแหน่ง" onChange={loc => setRowLoc(r.sku, loc)}/>
                    </div>
                    {/* Typed or − / + only. A number input increments on wheel/scroll,
                        which quietly corrupted counts — see QtyStepper in screens.jsx. */}
                    {typeof QtyStepper === "function"
                      ? <QtyStepper small value={r.amount} onChange={v => setAmount(r.sku, v)}
                          max={mode === "remove" ? cur : undefined} title={`จำนวนสำหรับ ${r.sku}`}/>
                      : <input className="m-input" type="text" inputMode="numeric" value={r.amount} placeholder="0"
                          onChange={e => setAmount(r.sku, e.target.value.replace(/[^\d]/g, ""))}
                          style={{ width: 66, padding: "8px 10px", fontSize: 14, textAlign: "right", marginBottom: 0, flexShrink: 0 }}/>}
                    <button onClick={() => removeSku(r.sku)} title="เอาออก"
                      style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--muted)", flexShrink: 0, cursor: "pointer" }}>
                      <Icons.X size={14}/>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="m-section-label" style={{ padding: "4px 4px 8px" }}>เหตุผล (จำเป็น)</div>
            <div className="adj-reasons">
              {modeReasons.map(r => (
                <button key={r.id} type="button" className={"adj-reason" + (reasonId === r.id ? " on" : "")} onClick={() => setReasonId(r.id)}>{r.label}</button>
              ))}
            </div>

            <div className="m-section-label" style={{ padding: "12px 4px 8px" }}>หมายเหตุ {reason && reason.requireNote ? "(จำเป็น)" : "(ไม่จำเป็น)"}</div>
            <input className="m-input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เลขออร์เดอร์ Shopee, อ้างอิงการนับ"/>

            <MStockOutWhen value={when} onChange={setWhen} label="วันเวลาที่ปรับสต็อก" hint="ปรับย้อนหลัง? เลือกวันเวลาที่เกิดขึ้นจริง"/>

            {changes.length > 0 && (
              <div className="m-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>จะปรับ {changes.length} รายการ</span>
                <span className="tnum" style={{ fontSize: 20, fontWeight: 600, color: net > 0 ? "var(--success)" : "var(--danger)" }}>สุทธิ {net > 0 ? "+" : ""}{net} ชิ้น</span>
              </div>
            )}

            <button className="m-btn-big" style={{ marginTop: 12 }} onClick={submit} disabled={!canSubmit}>
              <Icons.Check size={16}/> ยืนยันปรับสต็อก{changes.length > 1 ? ` (${changes.length})` : ""}
            </button>
          </>
        )}
      </div>

      {/* Multi-select product sheet — photos + checkboxes, stays open so several
          products can be ticked in one go. */}
      {pickOpen && (
        <>
          <div className="m-sheet-backdrop" onClick={() => setPickOpen(false)}/>
          <div className="m-sheet" style={{ maxHeight: "85%" }}>
            <div className="m-sheet-grabber"/>
            <div className="m-sheet-head">
              <h3>เลือกสินค้า {rows.length > 0 && <span style={{ color: "var(--accent)" }}>({rows.length})</span>}</h3>
              <button className="m-action" onClick={() => setPickOpen(false)}><Icons.X size={14}/></button>
            </div>
            <div style={{ padding: "12px 16px 8px", flexShrink: 0 }}>
              <div className="m-search" style={{ marginBottom: 0 }}>
                <Icons.Search size={14}/>
                <input autoFocus value={q} onChange={e => { setQ(e.target.value); setShowN(40); }} placeholder="พิมพ์ SKU, ชื่อ, หรือหมวด"/>
                {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => { setQ(""); setShowN(40); }}/>}
              </div>
            </div>
            <div className="m-sheet-body" style={{ padding: "0 12px 12px" }}>
              <div className="m-list" style={{ marginBottom: 8 }}>
                {filtered.slice(0, showN).map(p => {
                  const s = stockStatus(p);
                  const on = picked(p.sku);
                  return (
                    <button key={p.sku} className={"m-row" + (on ? " selected" : "")} onClick={() => toggleSku(p.sku)}>
                      <span className={"check" + (on ? " on" : "")} style={{ flexShrink: 0 }}/>
                      <ProductImageThumb sku={p.sku} size={40} radius={8}/>
                      <div className="m-row-main">
                        <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div className="row" style={{ gap: 6, marginTop: 2 }}>
                          <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                          <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>{s.label}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{effQty(p.sku)}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>คงเหลือ</div>
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
              {filtered.length > showN && (
                <button className="m-btn-big" style={{ background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={() => setShowN(n => n + 40)}>
                  ดูเพิ่ม — แสดง {showN} จาก {filtered.length} รายการ
                </button>
              )}
              <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", padding: "8px 0" }}>
                {filtered.length} จาก {PRODUCTS.length} รายการ
              </div>
            </div>
            <div className="m-sheet-foot">
              <button className="m-btn-big" onClick={() => setPickOpen(false)}>
                <Icons.Check size={16}/> เสร็จแล้ว{rows.length ? ` (${rows.length})` : ""}
              </button>
            </div>
          </div>
        </>
      )}
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

/* MULTI-ITEM — mobile twin of the desktop IssueModal. A cart of products AND
   bundles, each line with its own จำนวน, ช่องทาง and (for a split sku) shelf,
   confirmed once into ONE order. buildIssuePlan (data.jsx) turns the cart into
   deductions/shelf picks/line items so the two forks can't diverge.
   Deep links still work: push("issue", {sku}) / push("issue", {bundleId}) just
   seed the cart with that one line. */
const M_ISSUE_DEFAULT_CH = "shopee";
function MIssue({ ctx }) {
  const bundles = useMemoM(() => (typeof loadBundles === "function" ? loadBundles() : []), []);
  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));

  const lineIdOf = (l) => (l.type === "bundle" ? l.id : l.sku);
  const mkKey = (type, id, ch) => `${type}:${id}:${ch}`;
  const productLine = (p, ch) => ({
    key: mkKey("product", p.sku, ch), type: "product", sku: p.sku, name: p.name,
    price: p.price, qty: 1, ch,
    loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(p) : (p.loc || "")
  });
  const bundleLine = (b, ch) => ({
    key: mkKey("bundle", b.id, ch), type: "bundle", id: b.id, name: b.name,
    price: b.price, items: b.items, qty: 1, ch
  });

  const [startCh] = useStateM(() => (typeof lastIssueChannel === "function") ? lastIssueChannel() : M_ISSUE_DEFAULT_CH);
  const [cart, setCart] = useStateM(() => {
    const wantSku = ctx.route.params?.sku;
    const wantBundle = ctx.route.params?.bundleId;
    const b = wantBundle && bundles.find(x => x.id === wantBundle);
    if (b) return [bundleLine(b, startCh)];
    const p = wantSku && PRODUCTS.find(x => x.sku === wantSku);
    return p ? [productLine(p, startCh)] : [];
  });
  const [defCh, setDefChRaw] = useStateM(startCh);
  const setDefCh = (ch) => { setDefChRaw(ch); if (typeof rememberIssueChannel === "function") rememberIssueChannel(ch); };
  const [customer, setCustomer] = useStateM("");
  const [ship, setShip] = useStateM({ phone: "", carrier: "", tracking: "" });
  const [shipOpen, setShipOpen] = useStateM(false);
  const todayStr = (typeof todayIso === "function") ? todayIso() : new Date().toISOString().slice(0, 10);
  // วันเวลาที่ขาย — "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM" (issueOrderDate).
  const [orderDate, setOrderDate] = useStateM("");
  const [pickOpen, setPickOpen] = useStateM(false);
  const [tab, setTab] = useStateM("product");   // picker tab: product | bundle
  const [q, setQ] = useStateM("");
  const [showN, setShowN] = useStateM(40);
  const [camOpen, setCamOpen] = useStateM(false);
  const [submitting, setSubmitting] = useStateM(false);
  const submitRef = useRefM(false);
  useEffectM(() => () => setCamOpen(false), []);

  const addProduct = (p) => setCart(prev => {
    const k = mkKey("product", p.sku, defCh);
    const idx = prev.findIndex(l => l.key === k);
    if (idx > -1) { const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n; }
    return [...prev, productLine(p, defCh)];
  });
  const addBundle = (b) => setCart(prev => {
    const k = mkKey("bundle", b.id, defCh);
    const idx = prev.findIndex(l => l.key === k);
    if (idx > -1) { const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n; }
    return [...prev, bundleLine(b, defCh)];
  });
  const removeLine = (key) => setCart(prev => prev.filter(l => l.key !== key));
  const setLineQty = (key, qty) => {
    if (qty <= 0) { removeLine(key); return; }
    setCart(prev => prev.map(l => (l.key === key ? { ...l, qty } : l)));
  };
  const setLineLoc = (key, loc) => setCart(prev => prev.map(l => (l.key === key ? { ...l, loc } : l)));
  // Moving a line onto a channel that already holds the same item merges the two.
  const setLineCh = (key, ch) => setCart(prev => {
    const row = prev.find(l => l.key === key);
    if (!row || row.ch === ch) return prev;
    const twin = prev.find(l => l.key !== key && l.type === row.type && lineIdOf(l) === lineIdOf(row) && l.ch === ch);
    if (twin) return prev.filter(l => l.key !== key).map(l => (l.key === twin.key ? { ...l, qty: l.qty + row.qty } : l));
    return prev.map(l => (l.key === key ? { ...l, ch, key: mkKey(row.type, lineIdOf(row), ch) } : l));
  });
  const applyChToAll = () => setCart(prev => {
    const out = [];
    prev.forEach(l => {
      const hit = out.find(x => x.type === l.type && lineIdOf(x) === lineIdOf(l));
      if (hit) hit.qty += l.qty;
      else out.push({ ...l, ch: defCh, key: mkKey(l.type, lineIdOf(l), defCh) });
    });
    return out;
  });

  // Camera selection funnel — exact-match + beeps, same pattern as MAdjust.
  const pick = (code) => {
    const s = String(code || "").trim();
    if (!s) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === s.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast("ไม่พบ SKU: " + s); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    addProduct(p);
    ctx.pushToast(`เพิ่ม ${p.name}`);
  };

  /* Stock is validated per SKU across the WHOLE cart (bundle components folded
     in) — two lines of the same sku on different channels must not each pass. */
  const needBySku = {};
  cart.forEach(l => {
    if (l.type === "bundle") (l.items || []).forEach(ci => { needBySku[ci.sku] = (needBySku[ci.sku] || 0) + (Number(ci.qty) || 0) * l.qty; });
    else needBySku[l.sku] = (needBySku[l.sku] || 0) + l.qty;
  });
  const shortages = Object.keys(needBySku)
    .filter(s => needBySku[s] > effQty(s))
    .map(s => {
      const p = PRODUCTS.find(x => x.sku === s);
      return `${p ? p.name : s}: ต้องการ ${needBySku[s]} แต่มี ${effQty(s)}`;
    });
  const shortSku = (sku) => needBySku[sku] > effQty(sku);
  const totalPieces = Object.keys(needBySku).reduce((s, k) => s + needBySku[k], 0);
  const chSummary = CHANNEL_LIST
    .map(c => ({ ...c, qty: cart.filter(l => l.ch === c.id).reduce((s, l) => s + l.qty, 0) }))
    .filter(c => c.qty > 0);
  const canSubmit = cart.length > 0 && totalPieces > 0 && shortages.length === 0;

  const qL = q.toLowerCase();
  const prodMatches = PRODUCTS.filter(p =>
    !q || p.sku.toLowerCase().includes(qL) || p.name.toLowerCase().includes(qL) || (p.cat || "").toLowerCase().includes(qL)
  );
  const bundleMatches = bundles.filter(b => !q || b.name.toLowerCase().includes(qL) || b.id.toLowerCase().includes(qL));

  const submit = async () => {
    // Ref, not just the `submitting` state: this handler awaits applyLocPicks
    // before ctx.back(), so on a slow connection the button stays live long
    // enough for a second tap to land before React re-renders it disabled.
    if (!canSubmit || submitting || submitRef.current) return;
    if (!navigator.onLine) { ctx.pushToast("ไม่มีการเชื่อมต่ออินเทอร์เน็ต — กรุณาตรวจสอบเครือข่าย"); return; }
    const plan = (typeof buildIssuePlan === "function") ? buildIssuePlan(cart) : null;
    if (!plan || !plan.skuDeducts.length) return;
    submitRef.current = true;
    setSubmitting(true);

    // The order id is minted BEFORE the stock write so the movement ledger row
    // can name the order it belongs to (same order as desktop commitIssueOrder).
    const id = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
    const pieces = plan.skuDeducts.reduce((s, d) => s + d.qty, 0);
    const sf = (typeof issueShipFields === "function")
      ? issueShipFields(ship)
      : { tracking: "", carrier: "", phone: "", status: "picking" };
    const od = (typeof issueOrderDate === "function")
      ? issueOrderDate(orderDate)
      : { dateIso: todayStr, ts: "", backdated: false, createdAt: new Date().toISOString() };
    const dateNote = od.backdated ? ` · ขายวันที่ ${typeof isoToThai === "function" ? isoToThai(od.dateIso) : od.dateIso}${od.ts ? " " + od.ts : ""}` : "";

    deductManyAndPersist(plan.skuDeducts, `ตัดสต็อก (มือถือ) · ออร์เดอร์ ${id} (${plan.channelLabel})${dateNote}`);
    // Same tick as the qty write — applyLocPicks re-reads the new p.qty.
    if (typeof applyLocPicks === "function") {
      const r = await applyLocPicks(plan.locPicks);
      if (r && r.errors && r.errors.length) ctx.pushToast("ตัดสต็อกสำเร็จ แต่ปรับตำแหน่งไม่สำเร็จ — แก้ที่หน้าสินค้าบนเดสก์ท็อป");
    }

    // The stock-out is a shipment too → create its label (single source of truth
    // for ติดตามพัสดุ / จัดส่ง). No customer address here, so recipient is name-only.
    if (typeof createSaleLabel === "function") {
      try {
        createSaleLabel({ orderId: id, name: customer || "ลูกค้าใหม่", items: plan.lineItems, phone: sf.phone, carrier: sf.carrier, tracking: sf.tracking, created_at: od.createdAt });
      } catch (e) {}
    }

    // One order row via appendOrder — the convergence-safe writer (optimistic
    // local cache + single-row upsert + offline queue), same as desktop.
    const res = await appendOrder({
      id,
      channel: plan.channelLabel,
      customer: customer || "ลูกค้าใหม่",
      items: plan.lineCount,
      status: sf.status,
      carrier: sf.carrier,
      tracking: sf.tracking,
      ...(sf.phone ? { phone: sf.phone } : {}),
      ts: od.ts,
      dateIso: od.dateIso,
      ...(od.backdated && od.createdAt ? { createdAt: od.createdAt } : {}),
      deductions: plan.channelSplit,
      isBundle: plan.hasBundle,
      bundleName: plan.hasBundle ? plan.bundleNames.join(", ") : "",
      lineItems: plan.lineItems
    });
    if (res && res.error) ctx.pushToast("⚠️ ออร์เดอร์จะซิงค์อัตโนมัติเมื่อออนไลน์");

    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", entityId: id, action: "create",
        summary: `ตัดสต็อก ${plan.lineCount} รายการ (${pieces} ชิ้น) (มือถือ)`,
        count: plan.lineCount,
        changes: cart.map(l => ({
          label: l.type === "bundle" ? `ชุด: ${l.name}` : l.name,
          to: `−${l.qty} ${l.type === "bundle" ? "ชุด" : "ชิ้น"}`
        })),
        note: `ออร์เดอร์ ${id} · ${plan.channelLabel}${dateNote}`
      });
    }
    ctx.pushToast((plan.lineCount === 1
      ? `ตัดสต็อก ${cart[0].name} ${pieces} ชิ้น — ${plan.channelLabel}`
      : `ตัดสต็อก ${plan.lineCount} รายการ (${pieces} ชิ้น) — ${plan.channelLabel}`)
      + (od.backdated ? ` (ย้อนหลัง ${typeof isoToThai === "function" ? isoToThai(od.dateIso) : od.dateIso}${od.ts ? " " + od.ts : ""})` : ""));
    ctx.back();
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.X size={14}/></button>
        <div className="m-title-sub">ตัดสต็อก / ขาย</div>
        <button className="m-action accent" disabled={!canSubmit || submitting} onClick={submit} style={(!canSubmit || submitting) ? { opacity: 0.4 } : {}}>
          <Icons.Check size={14}/>
        </button>
      </div>
      <div className="m-content">
        <div style={{ fontSize: 11, color: "var(--muted)", margin: "0 4px 10px" }}>
          เลือกได้หลายรายการพร้อมกัน — สินค้าเดี่ยวและชุดสินค้า ตัดพร้อมกันในออร์เดอร์เดียว
        </div>

        {/* Default channel — new lines inherit it, so a whole batch is one tap */}
        <div className="m-section-label" style={{ padding: "0 4px 8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>ช่องทาง <span style={{ fontWeight: 400, color: "var(--muted)" }}>(รายการใหม่)</span></span>
          {cart.length > 0 && (
            <button onClick={applyChToAll} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}>ใช้กับทุกแถว</button>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "0 4px 12px" }}>
          {CHANNEL_LIST.map(c => (
            <button key={c.id} onClick={() => setDefCh(c.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 999,
                border: "1px solid " + (defCh === c.id ? "var(--accent)" : "var(--border)"),
                background: defCh === c.id ? "var(--accent-soft)" : "var(--surface)",
                color: defCh === c.id ? "var(--accent)" : "var(--fg-2)",
                fontSize: 12, fontWeight: defCh === c.id ? 600 : 400, fontFamily: "inherit", cursor: "pointer"
              }}>
              <ChannelMark channel={c.id} size={16}/>{c.name}
            </button>
          ))}
        </div>

        <button className="m-btn-big" style={{ background: "var(--surface)", color: "var(--fg)", border: "1px solid var(--border)", marginBottom: 8 }}
          onClick={() => { setQ(""); setShowN(40); setPickOpen(true); }}>
          <Icons.Search size={16}/> {cart.length ? `เลือกสินค้าเพิ่ม (เลือกแล้ว ${cart.length})` : "เลือกสินค้า — เลือกได้หลายรายการ"}
        </button>

        {!camOpen && (
          <button className="m-btn-big dark" style={{ marginTop: 0, marginBottom: 0 }} onClick={() => setCamOpen(true)}>
            <Icons.Camera size={18}/> สแกนบาร์โค้ดเพิ่มรายการ
          </button>
        )}
        {camOpen && <CameraScanner continuous onScan={code => pick(code)} onClose={() => setCamOpen(false)}/>}

        {cart.length === 0 && (
          <div className="m-card" style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, border: "1px dashed var(--border)", marginTop: 10 }}>
            ยังไม่ได้เลือกสินค้า — แตะ “เลือกสินค้า” หรือสแกนบาร์โค้ด
          </div>
        )}

        {cart.length > 0 && (
          <>
            <div className="m-section-label" style={{ padding: "12px 4px 8px", display: "flex", justifyContent: "space-between" }}>
              <span>รายการที่จะตัด <span style={{ color: "var(--accent)" }}>({cart.length})</span></span>
              <button onClick={() => setCart([])} style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 11, cursor: "pointer", padding: 0 }}>ล้างทั้งหมด</button>
            </div>
            <div className="m-list">
              {cart.map(l => {
                const isB = l.type === "bundle";
                const short = isB ? (l.items || []).some(ci => shortSku(ci.sku)) : shortSku(l.sku);
                return (
                  <div key={l.key} className="m-row" style={{ cursor: "default", alignItems: "flex-start", background: short ? "var(--danger-soft)" : undefined }}>
                    {isB ? (
                      <span style={{ width: 40, height: 40, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Icons.Bundle size={18}/>
                      </span>
                    ) : <ProductImageThumb sku={l.sku} size={40} radius={8}/>}
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isB && <span className="badge badge-neutral" style={{ fontSize: 9, marginRight: 5 }}>ชุด</span>}{l.name}
                      </div>
                      <div className="row" style={{ gap: 6, marginTop: 2 }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{isB ? l.id : l.sku}</span>
                        <span className="tnum" style={{ fontSize: 10, color: short ? "var(--danger)" : "var(--muted)" }}>
                          {isB ? `${(l.items || []).length} รายการ/ชุด` : `${effQty(l.sku)} → ${Math.max(0, effQty(l.sku) - (needBySku[l.sku] || 0))}`}
                        </span>
                      </div>
                      <select className="m-input" value={l.ch} onChange={e => setLineCh(l.key, e.target.value)}
                        style={{ marginTop: 6, marginBottom: 0, padding: "6px 8px", fontSize: 12, height: "auto" }}>
                        {CHANNEL_LIST.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {!isB && <MLocPickChips sku={l.sku} value={l.loc} need={l.qty} onChange={loc => setLineLoc(l.key, loc)}/>}
                    </div>
                    <div className="qty-stepper" style={{ flexShrink: 0 }}>
                      <button onClick={() => setLineQty(l.key, l.qty - 1)}>−</button>
                      <input value={l.qty} onChange={e => setLineQty(l.key, Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ width: 34, fontSize: 12 }}/>
                      <button onClick={() => setLineQty(l.key, l.qty + 1)}>+</button>
                    </div>
                    <button onClick={() => removeLine(l.key)} title="เอาออก"
                      style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 8, border: "none", background: "transparent", color: "var(--muted)", flexShrink: 0, cursor: "pointer" }}>
                      <Icons.X size={13}/>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Sale date/time — backdating files a late-keyed order under the moment it sold. */}
        <MStockOutWhen value={orderDate} onChange={setOrderDate} label="วันเวลาที่ขาย" hint="ตัดสต็อกย้อนหลัง? เลือกวันเวลาที่ขายจริง"/>

        <div className="m-section-label" style={{ padding: "12px 4px 8px" }}>ลูกค้า / อ้างอิง (ไม่จำเป็น)</div>
        <input className="m-input" placeholder="เช่น คุณ ปวีณา / Shopee #2025-119283" value={customer} onChange={e => setCustomer(e.target.value)} style={{ marginBottom: 8 }}/>

        {/* Optional shipping details — collapsed so a quick cut stays one screen. */}
        {!shipOpen && !ship.tracking ? (
          <button onClick={() => setShipOpen(true)}
            style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: "0 4px 10px", fontFamily: "inherit" }}>
            + เบอร์โทร / ขนส่ง / เลขพัสดุ
          </button>
        ) : (
          <div className="m-card" style={{ marginBottom: 8 }}>
            <input className="m-input" inputMode="tel" placeholder="เบอร์โทร (ไม่จำเป็น)" value={ship.phone}
              onChange={e => setShip(s => ({ ...s, phone: e.target.value }))} style={{ marginBottom: 8 }}/>
            <select className="m-input" value={ship.carrier} onChange={e => setShip(s => ({ ...s, carrier: e.target.value }))} style={{ marginBottom: 8 }}>
              <option value="">ขนส่ง — ไม่ระบุ</option>
              {(typeof ISSUE_CARRIERS !== "undefined" ? ISSUE_CARRIERS : []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className="m-input mono" placeholder="เลขพัสดุ (ใส่แล้ว = ส่งแล้ว)" value={ship.tracking}
              onChange={e => setShip(s => ({ ...s, tracking: e.target.value }))} style={{ marginBottom: 0 }}/>
          </div>
        )}

        {shortages.length > 0 && (
          <div className="m-card" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>สต็อกไม่พอ</div>
            {shortages.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <div className="m-card" style={{ background: "var(--surface-2)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--fg-2)" }}>
              <div>รวมตัดสต็อก</div>
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{cart.length} รายการ</div>
            </div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 600 }}>
              {totalPieces} <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>ชิ้น</span>
            </div>
          </div>
          {chSummary.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {chSummary.map(c => (
                <span key={c.id} className="ch-chip" style={{ fontSize: 11 }}>
                  <ChannelMark channel={c.id} size={16}/>{c.name} <strong className="tnum" style={{ marginLeft: 4 }}>{c.qty}</strong>
                </span>
              ))}
            </div>
          )}
        </div>

        <button className="m-btn-big" onClick={submit} disabled={!canSubmit || submitting}>
          <Icons.Check size={16}/> ยืนยันตัดสต็อก {totalPieces} ชิ้น
        </button>
      </div>

      {/* Product / bundle sheet — stays open so several items go in one pass. */}
      {pickOpen && (
        <>
          <div className="m-sheet-backdrop" onClick={() => setPickOpen(false)}/>
          <div className="m-sheet" style={{ maxHeight: "85%" }}>
            <div className="m-sheet-grabber"/>
            <div className="m-sheet-head">
              <h3>เลือกสินค้า {cart.length > 0 && <span style={{ color: "var(--accent)" }}>({cart.length})</span>}</h3>
              <button className="m-action" onClick={() => setPickOpen(false)}><Icons.X size={14}/></button>
            </div>
            <div style={{ padding: "12px 16px 8px", flexShrink: 0 }}>
              <div className="seg" style={{ width: "100%", marginBottom: 8 }}>
                <button className={tab === "product" ? "on" : ""} style={{ flex: 1 }} onClick={() => { setTab("product"); setShowN(40); }}>
                  <Icons.Box size={13}/> สินค้าเดี่ยว
                </button>
                <button className={tab === "bundle" ? "on" : ""} style={{ flex: 1 }} onClick={() => { setTab("bundle"); setShowN(40); }}>
                  <Icons.Bundle size={13}/> ชุดสินค้า
                </button>
              </div>
              <div className="m-search" style={{ marginBottom: 0 }}>
                <Icons.Search size={14}/>
                <input autoFocus value={q} onChange={e => { setQ(e.target.value); setShowN(40); }} placeholder="พิมพ์ SKU, ชื่อ, หรือหมวด"/>
                {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => { setQ(""); setShowN(40); }}/>}
              </div>
            </div>
            <div className="m-sheet-body" style={{ padding: "0 12px 12px" }}>
              <div className="m-list" style={{ marginBottom: 8 }}>
                {tab === "product" && prodMatches.slice(0, showN).map(p => {
                  const s = stockStatus(p);
                  const inCart = cart.filter(l => l.type === "product" && l.sku === p.sku).reduce((n, l) => n + l.qty, 0);
                  return (
                    <button key={p.sku} className={"m-row" + (inCart ? " selected" : "")} onClick={() => addProduct(p)}>
                      <ProductImageThumb sku={p.sku} size={40} radius={8}/>
                      <div className="m-row-main">
                        <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div className="row" style={{ gap: 6, marginTop: 2 }}>
                          <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                          <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 6px" }}><span className="dot"/>{s.label}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{effQty(p.sku)}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>คงเหลือ</div>
                      </div>
                      {inCart > 0 && <span className="badge badge-info" style={{ fontSize: 10, flexShrink: 0 }}>×{inCart}</span>}
                      <Icons.Plus size={14} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                    </button>
                  );
                })}
                {tab === "bundle" && bundleMatches.map(b => {
                  const max = (typeof bundleAvail === "function") ? bundleAvail(b) : 0;
                  const inCart = cart.filter(l => l.type === "bundle" && l.id === b.id).reduce((n, l) => n + l.qty, 0);
                  return (
                    <button key={b.id} className={"m-row" + (inCart ? " selected" : "")} onClick={() => addBundle(b)}>
                      <span style={{ width: 40, height: 40, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Icons.Bundle size={18}/>
                      </span>
                      <div className="m-row-main">
                        <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{b.items.length} รายการ/ชุด · ฿{(b.price || 0).toLocaleString()}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="tnum" style={{ fontSize: 14, fontWeight: 600, color: max === 0 ? "var(--danger)" : "var(--fg)" }}>{max}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>ชุดที่ทำได้</div>
                      </div>
                      {inCart > 0 && <span className="badge badge-info" style={{ fontSize: 10, flexShrink: 0 }}>×{inCart}</span>}
                      <Icons.Plus size={14} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                    </button>
                  );
                })}
                {((tab === "product" && prodMatches.length === 0) || (tab === "bundle" && bundleMatches.length === 0)) && (
                  <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                    <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
                    <div>{tab === "bundle" && bundles.length === 0 ? "ยังไม่มีชุดสินค้า" : `ไม่พบรายการที่ตรงกับ "${q}"`}</div>
                  </div>
                )}
              </div>
              {tab === "product" && prodMatches.length > showN && (
                <button className="m-btn-big" style={{ background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={() => setShowN(n => n + 40)}>
                  ดูเพิ่ม — แสดง {showN} จาก {prodMatches.length} รายการ
                </button>
              )}
            </div>
            <div className="m-sheet-foot">
              <button className="m-btn-big" onClick={() => setPickOpen(false)}>
                <Icons.Check size={16}/> เสร็จแล้ว{cart.length ? ` (${cart.length})` : ""}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* Mobile twin of StockOutWhenField (screens.jsx) — วันเวลา for a backdated
   stock-out. "" = now. */
function MStockOutWhen({ value, onChange, label, hint }) {
  const maxLocal = (typeof nowBkkLocal === "function") ? nowBkkLocal() : "";
  const stamp = value && typeof stockOutStamp === "function" ? stockOutStamp(value) : null;
  const backdated = !!(stamp && stamp.backdated);
  const setYesterday = () => {
    const base = value || maxLocal;
    const d = new Date(Date.parse(base.slice(0, 10) + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    onChange(d + "T" + (base.slice(11, 16) || "12:00"));
  };
  return (
    <>
      <div className="m-section-label" style={{ padding: "12px 4px 8px" }}>{label || "วันเวลาที่ตัดสต็อก"}</div>
      <input
        type="datetime-local" className="m-input"
        value={value || maxLocal} max={maxLocal}
        onChange={e => onChange(e.target.value && e.target.value < maxLocal ? e.target.value : "")}
        style={backdated ? { borderColor: "var(--warning)" } : undefined}
      />
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button type="button" className="btn" style={{ flex: 1, justifyContent: "center" }} onClick={setYesterday}>เมื่อวาน</button>
        <button type="button" className={"btn" + (!value ? " btn-primary" : "")} style={{ flex: 1, justifyContent: "center" }} onClick={() => onChange("")}>ตอนนี้</button>
      </div>
      {backdated ? (
        <div style={{ margin: "6px 0 8px", padding: "6px 10px", borderRadius: 8, background: "var(--warning-soft)", color: "oklch(0.5 0.13 65)", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Icons.Calendar size={13}/> ย้อนหลัง · <strong>{stockOutStampLabel(stamp)}</strong>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--muted)", margin: "4px 4px 8px" }}>{hint || "ทำย้อนหลัง? เลือกวันเวลาที่เกิดขึ้นจริง"}</div>
      )}
    </>
  );
}

/* Mobile twin of LocPickSelect — chips instead of a select, because a phone
   picker inside a cart row must be one tap. Hidden for single-position products. */
function MLocPickChips({ sku, value, onChange, need, label }) {
  const [, setTick] = useStateM(0);
  useEffectM(() => {
    const h = () => setTick(n => n + 1);
    window.addEventListener("ims-product-locs-change", h);
    return () => window.removeEventListener("ims-product-locs-change", h);
  }, []);
  const p = PRODUCTS.find(x => x.sku === sku);
  if (!p) return null;
  const spots = (typeof productPositions === "function") ? productPositions(p) : [];
  if (spots.length <= 1) return null;
  const here = (typeof qtyAtLocation === "function") ? qtyAtLocation(sku, value) : 0;
  const short = Number(need) > 0 && here < Number(need);
  // "-" / deleted-shelf rows read as unplaced and are never tagged หยิบก่อน.
  const stored = storedLocSet();
  const first = defaultPickLoc(p);
  return (
    <div style={{ marginTop: 4 }}>
      <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <Icons.Map size={10} style={{ color: "var(--accent)", flexShrink: 0 }}/>
        <span style={{ fontSize: 10, color: "var(--muted)" }}>{label || "ตัดจากตำแหน่ง"}</span>
        {spots.map(s => {
          const on = (value || "") === s.loc;
          return (
            <button key={s.loc} disabled={s.qty <= 0}
              onClick={e => { e.stopPropagation(); onChange(s.loc); }}
              style={{
                border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
                background: on ? "var(--accent-soft)" : "transparent",
                color: on ? "var(--accent)" : "var(--muted)",
                borderRadius: 999, padding: "2px 8px", fontSize: 10.5,
                fontFamily: "inherit", opacity: s.qty <= 0 ? 0.4 : 1
              }}>
              {locIsStored(s.loc, stored) ? <span className="mono">{locParts(s.loc).pos}</span> : "ยังไม่ระบุตำแหน่ง"} ×{s.qty}{s.loc === first ? " · หยิบก่อน" : ""}
            </button>
          );
        })}
      </div>
      {short && <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 2 }}>ตำแหน่งนี้มีแค่ {here} ชิ้น — ที่เหลือหยิบจากตำแหน่งถัดไป</div>}
    </div>
  );
}

/* =============== SELL PRODUCT (3-step POS wizard) =============== */

function MSell({ ctx }) {
  const [step, setStep] = useStateM(1); // 1 cart · 2 shipping · 3 confirm
  const [when, setWhen] = useStateM(""); // วันเวลาที่ขาย — "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM"
  const [cart, setCart] = useStateM(() => {
    // Pre-add a product when opened from the product detail page ("ขาย")
    const presetSku = ctx.route.params?.sku;
    const p = presetSku && PRODUCTS.find(x => x.sku === presetSku);
    return p ? [{ type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: defaultPickLoc(p), qty: 1 }] : [];
  });
  const [q, setQ] = useStateM("");
  // Paging for the product list — it used to render a hard .slice(0, 60) with no
  // way forward, so anything past the 60th SKU was simply unreachable however
  // far you scrolled. Grows on demand and resets whenever the query changes.
  const [showN, setShowN] = useStateM(60);
  useEffectM(() => { setShowN(60); }, [q]);
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
  const [pasteNote, setPasteNote] = useStateM(null);

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
    const hasAddr = parsed.addr1 || parsed.addr2;
    const got = [parsed.name && "ชื่อ", parsed.phone && "เบอร์", hasAddr && "ที่อยู่"].filter(Boolean).join(" · ");
    const tail = !hasAddr ? "" : parsed.addrConfidence === "high" ? " · ✓ ตรงรหัสไปรษณีย์" : " · ที่อยู่อาจไม่ครบ ลอง AI";
    setPasteNote({ summary: "คัดแยกแล้ว: " + (got || "—") + tail, leftover: parsed.leftover || "", original: pasteText });
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
      const got = [j.name && "ชื่อ", j.phone && "เบอร์", (j.addr1 || j.addr2) && "ที่อยู่"].filter(Boolean).join(" · ");
      const aiLeftover = (typeof computeRecipientLeftover === "function")
        ? computeRecipientLeftover(pasteText, { name: j.name, phone: j.phone, addr1: j.addr1, addr2: j.addr2, tambon: "", amphoe: "", province: "", zip: "" })
        : "";
      setPasteNote({ summary: "AI คัดแยกข้อมูลแล้ว: " + (got || "—"), leftover: aiLeftover, original: pasteText });
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

  const cartValue = cart.reduce((s, i) => s + (i.price || 0) * (i.qty || 0), 0);
  const cartTotal = cart.reduce((s, i) => s + i.qty, 0);

  const addProduct = (p) => setCart(prev => {
    const idx = prev.findIndex(i => i.type === "product" && i.sku === p.sku);
    if (idx > -1) { const n = [...prev]; n[idx] = { ...n[idx], qty: n[idx].qty + 1 }; return n; }
    return [...prev, { type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: defaultPickLoc(p), qty: 1 }];
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
  // Which shelf this line is taken from (split products only). Editable from the
  // cart row because a scanned line is added with the default and never asks.
  const updateLoc = (idx, loc) => setCart(prev => { const n = [...prev]; n[idx] = { ...n[idx], loc }; return n; });

  // Scan a barcode/SKU → add the matching product to the cart (same beep feedback as Inbound)
  const [camOpen, setCamOpen] = useStateM(false);
  const [submitting, setSubmitting] = useStateM(false);
  const submitRef = useRefM(false);
  useEffectM(() => () => setCamOpen(false), []);
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

  const submitOrder = async () => {
    if (submitting || submitRef.current) return;   // ref = same-tick double-tap (see MIssue)
    submitRef.current = true;
    if (!navigator.onLine) { ctx.pushToast("ไม่มีการเชื่อมต่ออินเทอร์เน็ต — กรุณาตรวจสอบเครือข่าย"); return; }
    setSubmitting(true);
    // Re-validate against live stock at submit time (stock may have changed mid-wizard)
    const liveErrors = cart.map(item => {
      const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
      return item.qty > avail ? item.name : null;
    }).filter(Boolean);
    if (cart.length === 0 || liveErrors.length > 0) { setSubmitting(false); submitRef.current = false; ctx.pushToast("สต็อกไม่พอ — ตรวจสอบรายการอีกครั้ง"); return; }
    const allDeductions = [];
    // Shelf per sku, carried beside the deduction (never inside it — the offline
    // queue replays {sku,qty} only).
    const locPicks = [];
    cart.forEach(item => {
      if (item.type === "product") {
        allDeductions.push({ sku: item.sku, qty: item.qty });
        locPicks.push({ sku: item.sku, loc: item.loc });
      } else {
        item.items.forEach(ci => {
          allDeductions.push({ sku: ci.sku, qty: ci.qty * item.qty });
          const cp = PRODUCTS.find(x => x.sku === ci.sku);
          locPicks.push({ sku: ci.sku, loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(cp) : (cp && cp.loc) || "" });
        });
      }
    });
    if (typeof deductManyAndPersist === "function") deductManyAndPersist(allDeductions, "ขายสินค้า (มือถือ) · " + (ship.name || "ลูกค้าใหม่"));
    // Same tick as the qty write — applyLocPicks re-reads the new p.qty.
    if (typeof applyLocPicks === "function") {
      const locRes = await applyLocPicks(locPicks);
      if (locRes && locRes.errors && locRes.errors.length) {
        ctx.pushToast("ตัดสต็อกสำเร็จ แต่ปรับตำแหน่งไม่สำเร็จ — แก้ที่หน้าสินค้าบนเดสก์ท็อป");
      }
    }

    const orderId = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
    const stamp = (typeof stockOutStamp === "function") ? stockOutStamp(when) : null;
    const createdAt = stamp && stamp.backdated ? stamp.createdAt : undefined;
    const backLabel = createdAt ? stockOutStampLabel(stamp) : "";

    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", action: "create",
        summary: `ขายสินค้า ${cart.length} รายการ → ${ship.name} (${ship.carrier}) (มือถือ)`,
        count: cartTotal,
        changes: cart.map(item => ({
          label: item.type === "bundle" ? `ชุด: ${item.name}` : item.name,
          to: `−${item.qty} ${item.type === "bundle" ? "ชุด" : "ชิ้น"}`
        })),
        note: `ผู้รับ: ${ship.name} · ${ship.addr1} · ${ship.carrier}${backLabel ? ` · ย้อนหลัง ${backLabel}` : ""}`
      });
    }

    const lineItems = cart.flatMap(item => item.type === "product"
      ? [snapLineItem(item.sku, item.name, item.qty, item.loc)]
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
          addr2: ship.addr2,
          tambon: ship.tambon, amphoe: ship.amphoe, province: ship.province, postal: ship.postal,
          carrier: ship.carrier,
          cod: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
          items: lineItems,
          created_at: createdAt,
        });
      } catch (e) { createdLabel = null; }
    }

    // Also persist an orders-table row so the sale shows in the desktop จัดส่ง
    // (Outbound) queue, which reads the orders store — mirrors the desktop sell.
    // The orders table has a realtime arm, so it syncs to open desktops. The
    // customer track-lookup dedups by id|tracking, so this won't double-show.
    if (typeof dbUpsertOrders === "function") {
      const hasBundle = cart.some(i => i.type === "bundle");
      const sellRow = [{
        id: orderId,
        channel: "ขายตรง",
        customer: ship.name,
        phone: ship.phone,
        status: "picking",
        carrier: ship.carrier,
        tracking: "",
        items: cart.length,
        dateIso: stamp ? stamp.dateIso : ((typeof todayIso === "function") ? todayIso() : new Date().toISOString().slice(0, 10)),
        ...(createdAt ? { createdAt } : {}),
        isSellOrder: true,
        isBundle: hasBundle,
        bundleName: hasBundle ? cart.filter(i => i.type === "bundle").map(i => i.name).join(", ") : "",
        shippingAddr: [ship.addr1, ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "),
        codAmount: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
        lineItems,
        deductions: [{ id: "direct", name: "ขายตรง", color: "#8B5CF6", qty: cartTotal }],
      }];
      const dbRes = await dbUpsertOrders(sellRow);
      if (dbRes && dbRes.error) {
        if (typeof enqueueOfflineWrite === "function") enqueueOfflineWrite("orders", sellRow);
        ctx.pushToast("⚠️ ออร์เดอร์จะซิงค์อัตโนมัติเมื่อออนไลน์");
      }
    }

    ctx.pushToast(`ขายสำเร็จ ${orderId} · สร้างฉลากแล้ว${backLabel ? ` (ย้อนหลัง ${backLabel})` : ""}`);
    // Opened from แพ็คสินค้า's "สั่งแพ็คใหม่" → go straight back to the pack queue
    // (the "ส่งให้คนแพ็ค" popup then offers the label file).
    if (ctx.route.params && ctx.route.params.from === "pack") ctx.back();
    else if (createdLabel) ctx.push("label-view", createdLabel);
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
                          {item.type === "product" && (
                            <MLocPickChips sku={item.sku} value={item.loc} need={item.qty} onChange={loc => updateLoc(idx, loc)}/>
                          )}
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
              {prodMatches.slice(0, showN).map(p => {
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
            {prodMatches.length > showN && (
              <button className="m-btn-big" style={{ marginBottom: 12, background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={() => setShowN(n => n + 60)}>
                ดูเพิ่ม — แสดง {showN} จาก {prodMatches.length} รายการ
              </button>
            )}

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
                  {pasteNote && typeof RecipientParseNote === "function" && (() => {
                    const sc = (typeof scoreRecipientParse === "function")
                      ? scoreRecipientParse({ name: ship.name, phone: ship.phone, addr1: ship.addr1, addr2: ship.addr2, tambon: ship.tambon, amphoe: ship.amphoe, province: ship.province, zip: ship.postal }, pasteNote.leftover, pasteNote.original)
                      : { percent: null, missing: [] };
                    return <RecipientParseNote
                      summary={pasteNote.summary} percent={sc.percent} missing={sc.missing} leftover={pasteNote.leftover}
                      onAppend={lo => { setShipState(s => ({ ...s, addr2: (s.addr2 ? s.addr2 + " " : "") + lo })); setPasteNote(n => n && ({ ...n, leftover: "" })); }}
                      onSkip={() => setPasteNote(n => n && ({ ...n, leftover: "" }))}
                      onDismiss={() => { setPasteNote(null); setPasteText(""); setPasteOpen(false); }}
                      mobile={true}
                    />;
                  })()}
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

            <MStockOutWhen value={when} onChange={setWhen} label="วันเวลาที่ขาย" hint="ขายย้อนหลัง? เลือกวันเวลาที่ขายจริง"/>

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
            <button className="m-btn-big success" style={{ flex: 1, ...(!cartReady || submitting ? { opacity: 0.5 } : {}) }} disabled={!cartReady || submitting} onClick={submitOrder}>
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
    /* saveBundles writes the WHOLE list and deletes every bundle missing from it.
       This screen had no ims-bundles-change listener (desktop Bundles does), so it
       held whatever list it loaded at mount — and the next edit saved that stale
       list back, deleting any bundle another device had created in the meantime.
       Staying in sync is what makes the full-list write safe. */
    const reloadBundles = () => {
      if (window._DB_BUNDLES) setBundlesRaw(window._DB_BUNDLES);
      else if (typeof loadBundles === "function") setBundlesRaw(loadBundles());
    };
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-bundles-change", reloadBundles);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-bundles-change", reloadBundles);
    };
  }, []);

  const setBundles = (next) => {
    setBundlesRaw(next);
    // Surface a rejected/rolled-back save instead of leaving the screen showing
    // a change the database refused.
    if (typeof saveBundles === "function") {
      Promise.resolve(saveBundles(next)).then(res => {
        if (res && res.ok === false) {
          ctx.pushToast(res.error || "บันทึกชุดสินค้าไม่สำเร็จ");
          if (window._DB_BUNDLES) setBundlesRaw(window._DB_BUNDLES);
        }
      }).catch(() => {});
    }
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

/* =============== PRODUCT FINDER (ค้นหาสินค้า) ===============
   Staff visual lookup: search or scan → big product photo + storage position,
   then tap through to the product page to sell / issue / adjust the CONFIRMED
   item. Desktop fork: ProductFinder in screens.jsx. */
function MFinder({ ctx }) {
  const [q, setQ] = useStateM("");
  const [camOpen, setCamOpen] = useStateM(false);
  const [, setStockKey] = useStateM(0);
  const inputRef = useRefM(null);
  const images = useProductImages();

  useEffectM(() => {
    const refresh = () => setStockKey(k => k + 1);
    const evs = ["ims-products-change", "ims-stock-adj-change", "ims-locations-change"];
    evs.forEach(ev => window.addEventListener(ev, refresh));
    return () => evs.forEach(ev => window.removeEventListener(ev, refresh));
  }, []);
  useEffectM(() => { inputRef.current && inputRef.current.focus(); }, []);
  useEffectM(() => () => setCamOpen(false), []);

  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));
  const res = typeof searchProductsForLocation === "function" ? searchProductsForLocation(q, 20) : { hits: [], total: 0 };

  // Camera funnel: exact SKU (= barcode) → straight to the product page; a miss
  // beeps so the picker knows the scan didn't land.
  const onScan = (code) => {
    const s = String(code || "").trim();
    setCamOpen(false);
    if (!s) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === s.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); ctx.pushToast("ไม่พบสินค้า: " + s); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    ctx.push("product", { sku: p.sku });
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ค้นหาสินค้า</div>
        <button className="m-action" onClick={() => setCamOpen(true)}><Icons.Camera size={16}/></button>
      </div>
      <div className="m-content">
        <div className="m-search">
          <Icons.Search size={16} style={{ color: "var(--muted)" }}/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="ชื่อสินค้า / SKU / สแกนบาร์โค้ด..."/>
          {q && <button onClick={() => { setQ(""); inputRef.current && inputRef.current.focus(); }} style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", padding: 2, display: "grid", placeItems: "center" }}><Icons.X size={14}/></button>}
        </div>

        {!q.trim() ? (
          <div className="m-card" style={{ padding: "36px 20px", textAlign: "center" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--surface-2)", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
              <Icons.Search size={22}/>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>ค้นหาเพื่อยืนยันสินค้าก่อนหยิบ</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>พิมพ์ชื่อ / SKU หรือกดกล้องมุมขวาบนเพื่อสแกน<br/>ระบบจะแสดงรูปสินค้าและตำแหน่งจัดเก็บ เพื่อไม่ให้หยิบผิดตัว</div>
          </div>
        ) : res.hits.length === 0 ? (
          <div className="m-card" style={{ padding: "28px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            ไม่พบสินค้า "{q}"
          </div>
        ) : (
          <>
            {res.hits.map(p => {
              const eq = effQty(p.sku);
              const st = stockStatus({ ...p, qty: eq });
              const parts = ((h) => h ? locParts(h) : null)(productHomeLoc(p));
              const url = typeof resolveProductImage === "function" ? resolveProductImage(p.sku, images) : "";
              return (
                <button key={p.sku} className="m-card" onClick={() => ctx.push("product", { sku: p.sku })}
                  style={{ display: "flex", gap: 12, alignItems: "stretch", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", padding: 10 }}>
                  <div style={{ width: 84, height: 84, borderRadius: 10, overflow: "hidden", background: "#fff", border: "1px solid var(--border)", flexShrink: 0, display: "grid", placeItems: "center" }}>
                    {url
                      ? <img src={url} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
                      : <Icons.Box size={26} style={{ color: "var(--muted)", opacity: 0.5 }}/>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "2px 0" }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</div>
                      <div className="row" style={{ gap: 8, marginTop: 3 }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</span>
                        <span className={"badge " + st.cls} style={{ fontSize: 10 }}>{eq} ชิ้น</span>
                      </div>
                    </div>
                    {parts ? (
                      <div className="row" style={{ gap: 6, marginTop: 6, minWidth: 0 }}>
                        <Icons.Map size={13} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                        <span className="mono" style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{parts.pos}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parts.building}{parts.floor ? " · " + parts.floor : ""}</span>
                        {/* This is the "where do I find it" screen — if the rest of
                            the stock is upstairs, say so HERE, not one tap deeper. */}
                        {typeof hasLocSplit === "function" && hasLocSplit(p.sku) && (
                          <span className="badge badge-neutral" style={{ fontSize: 9.5, flexShrink: 0 }}>
                            +{productPositions(p).length - 1} ที่
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: 10, alignSelf: "flex-start", marginTop: 6 }}><Icons.Warn size={10}/> ยังไม่จัดเก็บ</span>
                    )}
                  </div>
                  <Icons.Chev size={14} style={{ alignSelf: "center", color: "var(--muted)", flexShrink: 0 }}/>
                </button>
              );
            })}
            {res.total > res.hits.length && (
              <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "4px 0 10px" }}>
                แสดง {res.hits.length} จาก {res.total} รายการ — พิมพ์เพิ่มเพื่อค้นหาให้แคบลง
              </div>
            )}
          </>
        )}
      </div>
      {camOpen && <CameraScanner onScan={onScan} onClose={() => setCamOpen(false)}/>}
    </>
  );
}

function MMore({ ctx }) {
  const items = [
    { id: "pack",      icon: Icons.Box,   label: "แพ็คสินค้า",      sub: "รายการหยิบของตามชั้นวาง ติ๊กทีละชิ้น แล้วปิดเป็นพร้อมส่ง" },
    { id: "finder",    icon: Icons.Search, label: "ค้นหาสินค้า",    sub: "ค้นหา/สแกน ดูรูปสินค้าและตำแหน่งจัดเก็บ" },
    { id: "analytics", icon: Icons.Dash,  label: "วิเคราะห์ยอดขาย", sub: "รายได้ ต้นทุน กำไร และสินค้าขายดี" },
    { id: "stocktake", icon: Icons.Scan,  label: "ตรวจนับสต็อก",    sub: "นับสินค้าจริงเทียบกับระบบ แล้วปรับให้ตรง" },
    { id: "adjust",    icon: Icons.Refresh, label: "ปรับสต็อก",      sub: "นับผิด เสียหาย หรือขายนอกระบบ (Shopee/หน้าร้าน)" },
    { id: "bundles",   icon: Icons.Bundle, label: "ชุดสินค้า",       sub: "สร้างและจัดการชุดสินค้า" },
    { id: "tracking",  icon: Icons.Truck, label: "ติดตามพัสดุ",     sub: "เลขพัสดุ ขนส่ง และสถานะ" },
    { id: "locations", icon: Icons.Map,   label: "ตำแหน่งจัดเก็บ",  sub: "แผนผังคลังและการใช้พื้นที่" },
    { id: "labels",    icon: Icons.Tag,   label: "พิมพ์ฉลากจัดส่ง", sub: "สร้าง แก้ไข และพิมพ์ฉลาก" },
    { id: "import",    icon: Icons.Pkg,   label: "นำเข้าสินค้า",    sub: "อัปโหลด CSV / Excel เพิ่มหรืออัปเดต" },
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
      {ctx.pendingSync > 0 && (
        <div style={{ background: "var(--warning)", color: "#000", fontSize: 12, padding: "6px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <Icons.Refresh size={12}/>
          <span>{ctx.pendingSync} รายการรอซิงค์ — จะอัปโหลดอัตโนมัติเมื่อออนไลน์</span>
        </div>
      )}
      <div className="m-content">
        <div className="m-card" style={{ display: "flex", gap: 12, alignItems: "center", padding: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: role.color, color: "white", display: "grid", placeItems: "center", fontWeight: 600, flexShrink: 0 }}>{user.avatar || user.name?.slice(0,2)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{role.label}{user.email ? " · " + user.email : ""}</div>
          </div>
        </div>

        <div className="m-list">
          {items.filter(it =>
            // the reference catalog is a product view — not for a pack-only role
            (it.id === "catalog" && (typeof canOpenPage !== "function" || canOpenPage("inventory", user.role))) ||
            ((typeof canOpenPage !== "function" || canOpenPage(it.id, user.role))
              // ปรับสต็อก is a page id AND a capability — both must hold, or the
              // row would open a screen the Screen guard immediately blocks.
              && (it.id !== "adjust" || typeof canAdjustStock !== "function" || canAdjustStock()))
          ).map(it => {
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
              <div className="m-row-sub">2.7.0 (Build 2026.06.12)</div>
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
                // A row badged ในคลัง has a real SKU behind it — open it. Reference-only
                // rows stay inert (there is no product page to show).
                const stockSku = (PRODUCTS.find(p => p.sku.toLowerCase() === (e.sku || "").toLowerCase()) || {}).sku;
                const inStock = !!stockSku;
                const Row = inStock ? "button" : "div";
                return (
                  <Row key={e.sku || i} className="m-row"
                    onClick={inStock ? (() => ctx.push("product", { sku: stockSku })) : undefined}
                    style={inStock
                      ? { cursor: "pointer", width: "100%", textAlign: "left", font: "inherit", fontFamily: "inherit" }
                      : { cursor: "default" }}>
                    <ProductImageThumb sku={e.sku} size={40} radius={8}/>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name || "—"}</div>
                      <div className="m-row-sub mono">{e.sku} · {brandOf(e)}{e.price ? " · ฿" + e.price.toLocaleString() : ""}</div>
                    </div>
                    {inStock
                      ? <span className="badge badge-success" style={{ flexShrink: 0 }}>ในคลัง</span>
                      : <span className="badge badge-neutral" style={{ flexShrink: 0 }}>อ้างอิง</span>}
                  </Row>
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
    // Shallow-copy: once the cloud tree is loaded, loadLocTree() returns the same
    // object reference every time, and setState would bail out — freezing SKU counts.
    const h = () => setTree({ ...loadLocTree() });
    window.addEventListener("ims-locations-change", h);
    window.addEventListener("ims-products-change", h);
    // Split rows move without touching products (partial ย้าย/แก้การแบ่ง) —
    // the SKU badges and the open sheet must follow those too.
    window.addEventListener("ims-product-locs-change", h);
    return () => {
      window.removeEventListener("ims-locations-change", h);
      window.removeEventListener("ims-products-change", h);
      window.removeEventListener("ims-product-locs-change", h);
    };
  }, []);

  const buildings = (tree && tree.buildings) || [];
  const [selectedPos, setSelectedPos] = useStateM(null); // { b, f, p, code, highlightSku? }
  const [q, setQ] = useStateM("");
  const allowDelete = typeof canDeleteData === "function" ? canDeleteData() : true;
  const posCount = buildings.reduce((s, b) => s + (b.floors || []).reduce((t, f) => t + (f.positions || []).length, 0), 0);
  const locImages = useLocationImages();
  // tree state refreshes on both products- and locations-change, so this stays live
  const unstored = useMemoM(() => countUnstoredProducts(), [tree]);

  const addBtn = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--accent)", fontWeight: 600 };
  const delBtn = { display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)" };

  // In-app dialogs (askText, screens.jsx) instead of the browser's prompt() box.
  const askB = async () => { const n = await askText("เพิ่มอาคาร / โซน", "", { label: "ชื่ออาคาร / โซน", placeholder: "เช่น สภ., ตึกพาณิชย์" }); if (n) addBuilding(n); };
  const askF = async (b) => { const n = await askText(`เพิ่มชั้นใน "${b}"`, "", { label: "ชื่อชั้น", placeholder: "เช่น ชั้น 3" }); if (n) addFloor(b, n); };
  const askP = async (b, f) => { const n = await askText(`เพิ่มตำแหน่งใน ${b} · ${f}`, "", { label: "ชื่อตำแหน่ง", placeholder: "เช่น A1, กล่อง 12" }); if (n) addPosition(b, f, n); };
  const editB = async (b) => { const n = await askText("เปลี่ยนชื่ออาคาร", b, { okLabel: "เปลี่ยนชื่อ" }); if (n && n !== b) renameBuilding(b, n); };

  // Assign products to a position straight from the sheet — no trip to the
  // product edit screen. Gated like every other product UPDATE (viewer sees no UI).
  const canAssign = typeof canAdjustStock === "function" ? canAdjustStock() : true;
  const [addingProd, setAddingProd] = useStateM(false);
  const [addQ, setAddQ] = useStateM("");
  const [camPick, setCamPick] = useStateM(false);
  const [showNPick, setShowNPick] = useStateM(8);
  // Products shown inside an open position. Was a hard .slice(0, 40): a shelf
  // holding more than 40 SKUs silently ended there with nothing to scroll to.
  const [showNItems, setShowNItems] = useStateM(40);
  const toast = (m) => (ctx && ctx.pushToast ? ctx.pushToast(m) : window.dispatchEvent(new CustomEvent("ims-toast", { detail: m })));
  const openPos = (sel) => { setAddingProd(false); setAddQ(""); setCamPick(false); setShowNPick(8); setShowNItems(40); setSelectedPos(sel); };
  const closeSheet = () => { setAddingProd(false); setAddQ(""); setCamPick(false); setShowNPick(8); setShowNItems(40); setSelectedPos(null); };
  // "Already here" = pieces filed at this shelf (product_locations), not p.loc —
  // p.loc is "-" on live data, which listed shelved products as addable.
  const isHereAt = (p, code) => (p.loc || "") === code
    || ((typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, code) : 0) > 0;
  const assignToPos = async (p) => {
    const sel = selectedPos; if (!sel) return;
    const home = productHomeLoc(p);
    const from = home && home !== sel.code && typeof locParts === "function" ? locParts(home) : null;
    const rows = (typeof locSplitFor === "function") ? locSplitFor(p.sku, p.loc) : [];
    if (rows.length && typeof moveStockToLocation === "function") {
      /* Recorded split → the rows must move, not just p.loc (a bare p.loc write
         showed 0 ชิ้น here and the pieces stayed filed at the old shelf).
         Multi-position sku: ask how many pieces come here (default = the
         primary pile); single-position sku moves whole, no question. */
      let pieces = Number(p.qty) || 0;
      if (rows.length > 1) {
        const atPrimary = (typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, home || p.loc) : 0;
        const ans = await askText(`ย้ายมา ${sel.p} กี่ชิ้น?`, String(atPrimary > 0 ? atPrimary : pieces), {
          label: "จำนวนชิ้น", type: "number", okLabel: "ย้าย",
          message: `${p.name} แยกเก็บ ${rows.length} ตำแหน่ง (รวม ${pieces} ชิ้น)`
        });
        if (ans === null) return;
        pieces = Math.round(Number(ans));
        if (!pieces || pieces <= 0 || isNaN(pieces)) return;
      }
      const res = await moveStockToLocation(p.sku, sel.code, pieces);
      if (!res || !res.ok) { if (res && res.error) toast(res.error); return; }
      toast(res.all
        ? (from ? `ย้าย ${p.name} จาก ${from.pos} มา ${sel.p} แล้ว` : `เพิ่ม ${p.name} เข้า ${sel.p} แล้ว`)
        : `ย้าย ${p.name} มา ${sel.p} ${res.moved} ชิ้นแล้ว`);
      return;
    }
    updateProductInStore(p.sku, { loc: sel.code });
    toast(from ? `ย้าย ${p.name} จาก ${from.pos} มา ${sel.p} แล้ว` : `เพิ่ม ${p.name} เข้า ${sel.p} แล้ว`);
  };
  // Camera scan → assign to the open position. Resolves like the desktop wedge
  // path (exact SKU, else a single search hit). Continuous mode keeps the
  // scanner up so a whole shelf can be filled in one session.
  const scanIntoPos = (code) => {
    const sel = selectedPos; if (!sel) return;
    const q = String(code || "").trim(); if (!q) return;
    const exact = PRODUCTS.find(x => String(x.sku || "").toLowerCase() === q.toLowerCase());
    const res = (typeof searchProductsForLocation === "function") ? searchProductsForLocation(q, 2) : { hits: [] };
    const p = exact || (res.hits.length === 1 ? res.hits[0] : null);
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); toast("ไม่พบ SKU: " + q); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    if (isHereAt(p, sel.code) && !(typeof hasLocSplit === "function" && hasLocSplit(p.sku))) {
      toast(`${p.name} อยู่ใน ${sel.p} อยู่แล้ว`);
      return;
    }
    assignToPos(p);
  };
  const unassignFromPos = async (p) => {
    const sel = selectedPos; if (!sel) return;
    const rows = (typeof locSplitFor === "function") ? locSplitFor(p.sku, p.loc) : [];
    if (rows.length > 1) { toast(`${p.name} แยกเก็บหลายตำแหน่ง — แตะที่สินค้าเพื่อแก้การแบ่งตำแหน่ง`); return; }
    if (rows.length === 1 && typeof saveLocSplit === "function") {
      const res = await saveLocSplit(p.sku, []);
      if (!res || !res.ok) { toast((res && res.error) || "นำออกไม่สำเร็จ"); return; }
    }
    updateProductInStore(p.sku, { loc: "" });
    toast(`นำ ${p.name} ออกจาก ${sel.p} แล้ว`);
  };

  const tapPos = (b, f, p) => {
    const code = locCode(b, f, p);
    openPos({ b, f, p, code });
  };
  const printPosQr = (sel) => {
    const svg = (typeof qrSvgMarkup === "function") ? qrSvgMarkup(sel.code, 360) : "";
    const w = window.open("", "_blank", "width=420,height=470");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ป้าย ${sel.p}</title>
      <style>
        @page{size:50mm 50mm;margin:0}html,body{margin:0;padding:0}
        body{font-family:'IBM Plex Sans Thai','IBM Plex Mono',monospace;text-align:center;padding:4mm}
        .qr{width:30mm;height:30mm;margin:0 auto 2mm}.qr svg{width:100%;height:100%;display:block}
        .pos{font-size:20px;font-weight:700}.path{font-size:11px;color:#555;margin-top:1mm}
      </style></head>
      <body onload="window.focus();window.print();">
        <div class="qr">${svg}</div><div class="pos">${sel.p}</div>
        <div class="path">${sel.b} · ${sel.f}</div>
      </body></html>`);
    w.document.close();
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ตำแหน่งจัดเก็บ</div>
        <button className="m-action accent" onClick={askB} title="เพิ่มอาคาร"><Icons.Plus size={14}/></button>
      </div>
      <div className="m-content">
        <div className="m-search">
          <Icons.Search size={14}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาสินค้าเพื่อเช็คตำแหน่ง (ชื่อ / SKU)"/>
          {q && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}/>}
        </div>

        {q.trim() && (() => {
          const res = typeof searchProductsForLocation === "function" ? searchProductsForLocation(q, 10) : { hits: [], total: 0 };
          return (
            <div className="m-card" style={{ marginBottom: 12 }}>
              {res.hits.length === 0 && (
                <div style={{ padding: 14, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่พบสินค้า "{q}"</div>
              )}
              {res.hits.map((p, i) => {
                const parts = ((h) => h ? locParts(h) : null)(productHomeLoc(p));
                return (
                  <div key={p.sku} className="row"
                    onClick={() => parts
                      ? openPos({ b: parts.building, f: parts.floor, p: parts.pos, code: parts.code, highlightSku: p.sku })
                      : ctx.push("product", { sku: p.sku })}
                    style={{ gap: 10, padding: "8px 2px", borderBottom: i < res.hits.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <ProductImageThumb sku={p.sku} size={40} radius={8}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div className="row" style={{ gap: 6, marginTop: 2 }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>· {p.qty} ชิ้น</span>
                      </div>
                    </div>
                    {parts ? (
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{parts.pos}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>{parts.building} · {parts.floor}</div>
                      </div>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: 9, flexShrink: 0 }}><Icons.Warn size={9}/> ยังไม่จัดเก็บ</span>
                    )}
                  </div>
                );
              })}
              {res.total > res.hits.length && (
                <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", padding: "6px 0 2px" }}>แสดง {res.hits.length} จาก {res.total} รายการ</div>
              )}
            </div>
          );
        })()}

        {/* ── Warning: products not yet stored in any real position ── */}
        {unstored > 0 && (
          <div className="row" style={{ gap: 10, padding: "10px 12px", background: "var(--warning-soft)", borderRadius: 12, marginBottom: 10, fontSize: 12, color: "oklch(0.5 0.13 65)", alignItems: "center" }}>
            <Icons.Warn size={14} style={{ flexShrink: 0 }}/>
            <span style={{ flex: 1 }}>สินค้า <strong className="tnum">{unstored}</strong> รายการยังไม่ได้จัดเก็บเข้าตำแหน่ง — เปิดตำแหน่งแล้วกด “เพิ่มสินค้า”</span>
            <button onClick={() => ctx.switchTab("inventory")}
              style={{ flexShrink: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "var(--fg)", fontFamily: "inherit" }}>
              ไปที่คลัง
            </button>
          </div>
        )}

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
                    const hasPhoto = typeof getLocationImage === "function" && getLocationImage(code, locImages);
                    return (
                      <div key={p} onClick={() => tapPos(b.name, f.name, p)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}>
                        <span className="mono" style={{ fontWeight: 600 }}>{p}</span>
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{n} SKU</span>
                        {hasPhoto && typeof LocationImageThumb === "function" && <LocationImageThumb code={code} size={18} radius={6}/>}
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
          <span>แตะตำแหน่งเพื่อดูรายละเอียด · แตะชื่ออาคารเพื่อแก้ไข</span>
        </div>
      </div>

      {selectedPos && (() => {
        /* Everything physically here — primary loc OR split stock parked here
           (same rule the SKU-count badge uses, so the count and the list agree). */
        const items = (typeof productsInLocation === "function")
          ? productsInLocation(selectedPos.code)
          : PRODUCTS.filter(p => (p.loc || "") === selectedPos.code);
        // The product the user searched for floats to the top of the shelf list.
        if (selectedPos.highlightSku) items.sort((a, b) => (b.sku === selectedPos.highlightSku) - (a.sku === selectedPos.highlightSku));
        return (
          <>
            <div className="m-sheet-backdrop" onClick={closeSheet}/>
            <div className="m-sheet">
              <div className="m-sheet-grabber"/>
              <div className="m-sheet-head">
                <div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{selectedPos.b} · {selectedPos.f}</div>
                  <h3 className="mono" style={{ marginTop: 2 }}>{selectedPos.p}</h3>
                </div>
                <button style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }} onClick={closeSheet}><Icons.X size={18}/></button>
              </div>
              <div className="m-sheet-body">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>สินค้าในตำแหน่งนี้ ({items.length})</div>
                  {canAssign && (
                    <button style={addBtn} onClick={() => { setAddingProd(a => !a); setAddQ(""); setCamPick(false); setShowNPick(8); }}>
                      {addingProd ? "เสร็จแล้ว" : <><Icons.Plus size={12}/> เพิ่มสินค้า</>}
                    </button>
                  )}
                </div>

                {addingProd && (() => {
                  // One row of the picker — used by both search results and the browse list.
                  const pickRowM = (p) => {
                    const here = isHereAt(p, selectedPos.code);
                    const home = here ? "" : productHomeLoc(p);
                    const from = home && home !== selectedPos.code ? locParts(home) : null;
                    return (
                      <div key={p.sku} className="row" onClick={() => { if (!here) assignToPos(p); }}
                        style={{ gap: 10, padding: "8px 10px", background: here ? "var(--accent-soft)" : "var(--surface-2)", borderRadius: 8, marginBottom: 6 }}>
                        <ProductImageThumb sku={p.sku} size={36} radius={7}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{p.sku} · {p.qty} ชิ้น{from ? " · อยู่ที่ " + from.pos : ""}</div>
                        </div>
                        {here
                          ? <span className="row" style={{ gap: 3, fontSize: 11, color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}><Icons.Check size={12}/> อยู่ที่นี่</span>
                          : <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}>{from ? "ย้ายมาที่นี่" : "+ เพิ่ม"}</span>}
                      </div>
                    );
                  };
                  return (
                    <div style={{ marginBottom: 12 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="m-search" style={{ flex: 1, marginBottom: 0 }}>
                          <Icons.Search size={14}/>
                          <input autoFocus value={addQ} onChange={e => setAddQ(e.target.value)} placeholder="ค้นหาสินค้า (ชื่อ / SKU)..."/>
                          {addQ && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setAddQ("")}/>}
                        </div>
                        <button style={{ ...addBtn, flexShrink: 0 }} onClick={() => setCamPick(true)} title="สแกนบาร์โค้ดด้วยกล้อง">
                          <Icons.Camera size={14}/> สแกน
                        </button>
                      </div>
                      {addQ.trim() ? (() => {
                        const res = typeof searchProductsForLocation === "function" ? searchProductsForLocation(addQ, 20) : { hits: [], total: 0 };
                        return (
                          <div style={{ marginTop: 8 }}>
                            {res.hits.length === 0 && <div style={{ padding: 12, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่พบสินค้า "{addQ}"</div>}
                            {res.hits.map(pickRowM)}
                            {res.total > res.hits.length && (
                              <div style={{ fontSize: 10, color: "var(--muted)", textAlign: "center", padding: "4px 0 2px" }}>แสดง {res.hits.length} จาก {res.total} รายการ — พิมพ์ให้ละเอียดขึ้นเพื่อจำกัดผลลัพธ์</div>
                            )}
                          </div>
                        );
                      })() : (() => {
                        // No query → browse the whole catalog right here; unplaced products first
                        // (stale codes count as unplaced, same as the ยังไม่จัดเก็บ badge).
                        const stored = storedLocSet();
                        const browse = PRODUCTS.filter(p => !isHereAt(p, selectedPos.code))
                          .sort((a, b) => ((productIsStored(a, stored) ? 1 : 0) - (productIsStored(b, stored) ? 1 : 0)) || String(a.name || "").localeCompare(String(b.name || ""), "th"));
                        return (
                          <div style={{ marginTop: 8 }}>
                            {browse.length === 0
                              ? <div style={{ padding: 12, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>สินค้าทุกรายการอยู่ในตำแหน่งนี้แล้ว</div>
                              : <div style={{ fontSize: 10.5, color: "var(--muted)", padding: "0 2px 6px" }}>เลือกจากรายการ (สินค้าที่ยังไม่มีตำแหน่งขึ้นก่อน) หรือค้นหา / สแกน</div>}
                            {browse.slice(0, showNPick).map(pickRowM)}
                            {browse.length > showNPick && (
                              <button className="m-btn-big" style={{ marginTop: 4, background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={() => setShowNPick(n => n + 12)}>
                                ดูเพิ่ม — แสดง {Math.min(showNPick, browse.length)} จาก {browse.length}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                      {camPick && <CameraScanner continuous onScan={scanIntoPos} onClose={() => setCamPick(false)}/>}
                    </div>
                  );
                })()}

                {items.length === 0
                  ? <div style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: 8 }}>ยังไม่มีสินค้าในตำแหน่งนี้{canAssign ? " — แตะ “เพิ่มสินค้า” เพื่อเลือกสินค้าเข้าตำแหน่ง" : ""}</div>
                  : items.slice(0, showNItems).map(p => {
                    const hl = p.sku === selectedPos.highlightSku;
                    // Pieces AT THIS POSITION, not the product's grand total.
                    const here = (typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, selectedPos.code) : p.qty;
                    // Primary / "หลักอยู่" from the real home shelf — p.loc is "-" on live data.
                    const home = productHomeLoc(p);
                    const isPrimary = home === selectedPos.code;
                    const main = home && home !== selectedPos.code ? locParts(home) : null;
                    const split = typeof hasLocSplit === "function" && hasLocSplit(p.sku);
                    return (
                      <div key={p.sku} className="row" onClick={() => { closeSheet(); ctx.push("product", { sku: p.sku }); }}
                        style={{ gap: 10, padding: "8px 10px", background: hl ? "var(--accent-soft)" : "var(--surface-2)", border: hl ? "1.5px solid var(--accent)" : "1px solid transparent", borderRadius: 8, marginBottom: 6, cursor: "pointer" }}>
                        <ProductImageThumb sku={p.sku} size={40} radius={8}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                            {p.sku}{main ? <span style={{ fontFamily: "inherit" }}> · หลักอยู่ {main.pos}</span> : null}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="tnum" style={{ fontSize: 14, fontWeight: 500 }}>{here} ชิ้น</div>
                          {here !== p.qty && <div style={{ fontSize: 10, color: "var(--muted)" }}>รวม {p.qty}</div>}
                        </div>
                        {/* Multi-position sku is rebalanced in its split panel (tap the
                            row), not blanked with one X. */}
                        {canAssign && isPrimary && !split && <button style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--muted)", flexShrink: 0, cursor: "pointer" }} title="นำออกจากตำแหน่งนี้" onClick={(e) => { e.stopPropagation(); unassignFromPos(p); }}><Icons.X size={14}/></button>}
                      </div>
                    );
                  })
                }
                {items.length > showNItems && (
                  <button className="m-btn-big" style={{ marginTop: 4, background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={() => setShowNItems(n => n + 40)}>
                    ดูเพิ่ม — แสดง {showNItems} จาก {items.length} รายการ
                  </button>
                )}
                <div style={{ marginTop: 16, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>ภาพตำแหน่ง</div>
                {typeof LocationImageUpload === "function" ? <LocationImageUpload code={selectedPos.code}/> : null}

                <button className="m-btn-big" style={{ marginTop: 16, background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={() => printPosQr(selectedPos)}><Icons.Print size={15}/> พิมพ์ป้าย QR</button>
              </div>
              <div className="m-sheet-foot" style={{ display: "flex", gap: 8 }}>
                {allowDelete && (
                  <button className="m-btn-big" style={{ flex: 1, background: "var(--danger-soft)", color: "var(--danger)", border: "none" }} onClick={() => { if (confirm(`ลบตำแหน่ง ${selectedPos.p}?`)) { removePosition(selectedPos.b, selectedPos.f, selectedPos.p); closeSheet(); } }}>
                    <Icons.Trash size={14}/> ลบ
                  </button>
                )}
                <button className="m-btn-big" style={{ flex: 1, background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={async () => { const n = await askText("เปลี่ยนชื่อตำแหน่ง", selectedPos.p, { okLabel: "เปลี่ยนชื่อ" }); if (n && n !== selectedPos.p) { renamePosition(selectedPos.b, selectedPos.f, selectedPos.p, n); closeSheet(); } }}>
                  <Icons.Edit size={14}/> เปลี่ยนชื่อ
                </button>
                <button className="m-btn-big accent" style={{ flex: 1 }} onClick={closeSheet}>เสร็จสิ้น</button>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}

/* =============== LABELS =============== */

function MLabels({ ctx }) {
  const [labels, setLabels] = useStateM(() => typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS);
  // Arrived from จัดส่งสินค้า with a selection (push("labels", { labelIds })) →
  // open straight into select-mode with those labels ticked, ready to print.
  const initialIds = (ctx.route.params && Array.isArray(ctx.route.params.labelIds)) ? ctx.route.params.labelIds : null;
  const [selecting, setSelecting] = useStateM(!!initialIds);
  const [selected, setSelected] = useStateM(() => {
    const o = {};
    if (initialIds) initialIds.forEach(id => { o[id] = true; });
    return o;
  });
  const [dateFilter, setDateFilter] = useStateM(""); // "" = all days; else a YYYY-MM-DD key
  const [batchLabels, setBatchLabels] = useStateM([]);
  const [batchLoading, setBatchLoading] = useStateM(false);
  const batchContainerRef = useRefM(null);

  useEffectM(() => {
    const refresh = () => setLabels(typeof loadLabels === "function" ? loadLabels() : SAMPLE_LABELS);
    window.addEventListener("ims-labels-change", refresh);
    return () => window.removeEventListener("ims-labels-change", refresh);
  }, []);

  const [store, setStore] = useStateM(() => {
    if (window._DB_STORE) return { ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...window._DB_STORE };
    try { return { ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch (e) { return typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}; }
  });
  useEffectM(() => {
    const h = () => {
      if (window._DB_STORE) setStore({ ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...window._DB_STORE });
    };
    window.addEventListener("ims-store-change", h);
    return () => window.removeEventListener("ims-store-change", h);
  }, []);

  // The list shows only labels for the active date filter ("" = every day).
  const lblDateKey = (l) => (typeof labelDateKey === "function" ? labelDateKey(l) : "none");
  const visibleLabels = dateFilter ? labels.filter(l => lblDateKey(l) === dateFilter) : labels;
  // Reset a stale day filter once that day has no labels left (delete / reload)
  // so the list can't get stuck on an empty filtered view after the chip is gone.
  useEffectM(() => {
    if (dateFilter && !labels.some(l => lblDateKey(l) === dateFilter)) setDateFilter("");
  }, [labels, dateFilter]);

  const selectedIds = Object.keys(selected).filter(k => selected[k]);
  const selectedCount = selectedIds.length;
  const allSelected = visibleLabels.length > 0 && visibleLabels.every(l => selected[l.id]);
  const toggle = (id) => setSelected(s => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = true; return n; });
  const toggleAll = () => setSelected(s => {
    const n = { ...s };
    if (allSelected) visibleLabels.forEach(l => { delete n[l.id]; });
    else visibleLabels.forEach(l => { n[l.id] = true; });
    return n;
  });
  const clearSelect = () => { setSelected({}); setSelecting(false); };

  const createLabel = () => {
    const fresh = (typeof blankLabel === "function") ? blankLabel() : { id: "L" + Date.now(), soId: "", recipient: { name: "", addr1: "", addr2: "", phone: "" }, sender: {}, items: [], cod: 0, tracking: "", weight: "", carrier: "", box: "" };
    const next = [...labels, fresh];
    if (typeof saveLabels === "function") saveLabels(next); else setLabels(next);
    ctx.push("label-edit", fresh);
  };

  // Render the selected labels into the hidden batch container, then hand the
  // live .label-paper nodes to `fn` (PDF export or native print) — shared so the
  // bulk bar offers the same actions (พิมพ์ + PDF) as the single-label view.
  const withBatchEls = async (fn) => {
    const sel = labels.filter(l => selected[l.id]);
    if (!sel.length) { ctx.pushToast("ไม่ได้เลือกฉลาก"); return; }
    setBatchLoading(true);
    setBatchLabels(sel);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80))));
    const container = batchContainerRef.current;
    const els = container ? [...container.querySelectorAll(".label-paper")] : [];
    if (els.length) {
      try { await fn(els, sel); }
      catch (e) { console.error("batch label action failed:", e); ctx.pushToast("ทำรายการไม่สำเร็จ — ลองอีกครั้ง"); }
    } else {
      ctx.pushToast("สร้างไม่สำเร็จ — ลองอีกครั้ง");
    }
    setBatchLabels([]);
    setBatchLoading(false);
    clearSelect();
  };

  // Save the selection as a multi-page PDF (one label per page).
  const printSelected = () => withBatchEls(async (els, sel) => {
    if (typeof labelsToPDF !== "function") { ctx.pushToast("ฟังก์ชัน PDF ยังไม่พร้อม"); return; }
    await labelsToPDF(els, LABEL_SIZES[0], sel.length > 1 ? "batch" : (sel[0].soId || sel[0].id), ctx.pushToast);
  });

  // Send the selection straight to the browser's print sheet (no file).
  const printSelectedNative = () => withBatchEls(async (els) => {
    if (typeof printLabels !== "function") { ctx.pushToast("ฟังก์ชันพิมพ์ยังไม่พร้อม"); return; }
    printLabels(els, LABEL_SIZES[0], ctx.pushToast);
  });

  // Delete the selected labels. saveLabels handles the cloud delete + snapshots
  // any label that still has a tracking number into ติดตามพัสดุ first.
  const deleteSelected = () => {
    const sel = labels.filter(l => selected[l.id]);
    if (!sel.length) { ctx.pushToast("ไม่ได้เลือกฉลาก"); return; }
    if (!confirm(`ลบฉลาก ${sel.length} ใบที่เลือก?`)) return;
    const remaining = labels.filter(l => !selected[l.id]);
    if (typeof saveLabels === "function") saveLabels(remaining); else setLabels(remaining);
    ctx.pushToast(`ลบฉลาก ${sel.length} ใบแล้ว`);
    clearSelect();
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">ฉลากจัดส่ง</div>
        <button className="m-action" onClick={() => selecting ? clearSelect() : setSelecting(true)}>
          {selecting ? <Icons.X size={16}/> : <Icons.Check size={16}/>}
        </button>
        {!selecting && <button className="m-action accent" onClick={createLabel}><Icons.Plus size={14}/></button>}
      </div>
      <div className="m-content">
        <div className="m-card" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>คิวพิมพ์</div>
            <div style={{ fontSize: 24, fontWeight: 600, marginTop: 2 }} className="tnum">{labels.length}</div>
          </div>
          {!selecting && (
            <button className="m-btn-big" style={{ width: "auto", padding: "12px 16px" }} onClick={createLabel}>
              <Icons.Plus size={14}/> สร้างฉลาก
            </button>
          )}
        </div>

        <div className="m-section-label" style={{ padding: "8px 4px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span>รายการฉลาก{selecting && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 400 }}> · {selectedCount > 0 ? `เลือกแล้ว ${selectedCount}` : "แตะเพื่อเลือก"}</span>}</span>
          {selecting ? (
            visibleLabels.length > 0 && (
              <button onClick={toggleAll}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: "2px 2px", cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                <span className={"check" + (allSelected ? " on" : "")} style={{ flexShrink: 0 }}/>
                {allSelected ? "ล้างทั้งหมด" : "เลือกทั้งหมด"}
              </button>
            )
          ) : (
            labels.length > 1 && (
              <button onClick={() => setSelecting(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", padding: "2px 2px", cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>
                <Icons.Check size={13}/> เลือกหลายใบ
              </button>
            )
          )}
        </div>
        {typeof LabelDateFilter === "function" && (
          <LabelDateFilter labels={labels} value={dateFilter} onChange={setDateFilter} mobile/>
        )}
        <div className="m-list">
          {dateFilter && visibleLabels.length === 0 && labels.length > 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่มีฉลากในวันที่เลือก</div>
          )}
          {visibleLabels.map(l => {
            const isSelected = !!selected[l.id];
            return (
              <button key={l.id} className={"m-row" + (isSelected ? " selected" : "")} onClick={() => selecting ? toggle(l.id) : ctx.push("label-view", l)}>
                {selecting && <span className={"check" + (isSelected ? " on" : "")} style={{ flexShrink: 0 }}/>}
                <div className="m-row-thumb" style={{ background: isSelected ? "var(--accent)" : "var(--surface-2)", color: isSelected ? "white" : "var(--accent)" }}><Icons.Tag size={16}/></div>
                <div className="m-row-main">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{l.soId || "ฉลากใหม่"}</span>
                    <span className="row" style={{ gap: 4, fontSize: 10, color: "var(--muted)" }}><CarrierMark carrier={l.carrier} size={14}/>{(l.carrier || "").split(" ")[0]}</span>
                  </div>
                  {/* Guarded: one partial label row (no recipient / no items) used to
                      throw here and white-screen the whole ฉลาก list. */}
                  <div className="m-row-sub">{(l.recipient && l.recipient.name) || "ยังไม่ระบุผู้รับ"} · {(l.items || []).length} รายการ · {l.weight || "—"}</div>
                </div>
                {!selecting && <Icons.Chev size={14} className="m-row-chev"/>}
              </button>
            );
          })}
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

      {selecting && selectedCount > 0 && (
        <div className="m-bulk-bar">
          <span style={{ width: 26, height: 26, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 600, flexShrink: 0 }} className="tnum">{selectedCount}</span>
          <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>เลือก {selectedCount} ฉลาก</span>
          <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36, flexShrink: 0 }} onClick={deleteSelected} disabled={batchLoading} title="ลบฉลากที่เลือก"><Icons.Trash size={14}/></button>
          <button className="m-action" style={{ background: "rgba(255,255,255,0.16)", color: "#fff", width: "auto", padding: "0 12px", borderRadius: 10, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={printSelectedNative} disabled={batchLoading}>
            <Icons.Print size={14}/> พิมพ์
          </button>
          <button className="m-action" style={{ background: "var(--accent)", color: "white", width: "auto", padding: "0 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={printSelected} disabled={batchLoading}>
            <Icons.Print size={14}/> {batchLoading ? "กำลังสร้าง…" : "PDF"}
          </button>
        </div>
      )}

      {/* Hidden container for batch PDF rendering */}
      {batchLabels.length > 0 && (
        <div ref={batchContainerRef} style={{ position: "fixed", left: -9999, top: 0, pointerEvents: "none", zIndex: -1 }}>
          {batchLabels.map(l => (
            <LabelPaper key={l.id} label={l} size={LABEL_SIZES[0]} store={store}/>
          ))}
        </div>
      )}
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
  const [store, setStoreV] = useStateM(() => {
    if (window._DB_STORE) return { ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...window._DB_STORE };
    try { return { ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...JSON.parse(localStorage.getItem("ims_store") || "{}") }; }
    catch (e) { return typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}; }
  });
  useEffectM(() => {
    const h = () => {
      if (window._DB_STORE) setStoreV({ ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...window._DB_STORE });
    };
    window.addEventListener("ims-store-change", h);
    return () => window.removeEventListener("ims-store-change", h);
  }, []);
  const size = LABEL_SIZES[0]; // 100x150

  // Exact-size PDF (SVG→jsPDF) so the label fills a real 100×150mm page with
  // correct Thai. Falls back to native print if rasterising isn't supported
  // (e.g. some iOS Safari builds choke on SVG <foreignObject>).
  const downloadPDF = async () => {
    const el = paperRef.current ? paperRef.current.querySelector(".label-paper") : null;
    if (!el) { ctx.pushToast("ไม่พบฉลาก"); return; }
    setPdfLoading(true);
    try {
      if (typeof labelsToPDF === "function") {
        await labelsToPDF([el], size, l.soId, ctx.pushToast);
      } else if (typeof printLabels === "function") {
        printLabels([el], size, ctx.pushToast);
      } else {
        ctx.pushToast("ฟังก์ชัน PDF ยังไม่พร้อม");
      }
    } catch (e) {
      console.error("PDF failed, native print fallback:", e);
      try { printLabels([el], size, ctx.pushToast); } catch (e2) { ctx.pushToast("ทำ PDF ไม่สำเร็จ"); }
    }
    setPdfLoading(false);
  };

  // Send straight to a printer via the browser print dialog (no file download).
  const printNative = () => {
    const el = paperRef.current ? paperRef.current.querySelector(".label-paper") : null;
    if (!el) { ctx.pushToast("ไม่พบฉลาก"); return; }
    if (typeof printLabels !== "function") { ctx.pushToast("ฟังก์ชันพิมพ์ยังไม่พร้อม"); return; }
    try { printLabels([el], size, ctx.pushToast); }
    catch (e) { ctx.pushToast("เปิดหน้าต่างพิมพ์ไม่สำเร็จ"); }
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
        <div style={{ marginTop: -80, display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="m-btn-big" onClick={downloadPDF} disabled={pdfLoading} style={pdfLoading ? { opacity: 0.7 } : {}}>
            <Icons.Print size={16}/> {pdfLoading ? "กำลังสร้าง PDF…" : "บันทึก PDF"}
          </button>
          <button className="m-btn-big" onClick={printNative} disabled={pdfLoading} style={{ background: "var(--surface-2, #f1f1f3)", color: "var(--fg, #111)", border: "1px solid var(--border, #ddd)" }}>
            <Icons.Print size={16}/> พิมพ์
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
  const [pasteNote, setPasteNote] = useStateM(null);
  const [skuPickerOpen, setSkuPickerOpen] = useStateM(false);
  const [skuPickerQ, setSkuPickerQ] = useStateM("");
  const skuPickerInputRef = useRefM(null);

  useEffectM(() => {
    if (skuPickerOpen) setTimeout(() => skuPickerInputRef.current && skuPickerInputRef.current.focus(), 80);
    else setSkuPickerQ("");
  }, [skuPickerOpen]);

  const setRecip = (k, v) => setLabel(l => ({ ...l, recipient: { ...l.recipient, [k]: v } }));
  const setField = (k, v) => setLabel(l => ({ ...l, [k]: v }));
  const setSender = (k, v) => setLabel(l => ({ ...l, sender: { ...(l.sender || {}), [k]: v } }));

  const addLabelItem = (sku) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (!p) return;
    setLabel(l => {
      const items = l.items || [];
      const idx = items.findIndex(it => it.sku === sku);
      if (idx > -1) {
        const next = [...items];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return { ...l, items: next };
      }
      return { ...l, items: [...items, { sku: p.sku, name: p.name, qty: 1 }] };
    });
    setSkuPickerOpen(false);
  };

  const addCustomLabelItem = (name) => {
    const nm = (name || "").trim();
    setLabel(l => ({ ...l, items: [...(l.items || []), { sku: "", name: nm, qty: 1, custom: true }] }));
    setSkuPickerOpen(false);
  };

  const removeLabelItem = (idx) => setLabel(l => ({ ...l, items: (l.items || []).filter((_, i) => i !== idx) }));
  const setLabelItemName = (idx, value) => setLabel(l => {
    const items = (l.items || []).slice();
    items[idx] = { ...items[idx], name: value };
    return { ...l, items };
  });
  const stepLabelItemQty = (idx, delta) => setLabel(l => {
    const items = (l.items || []).slice();
    const next = Math.max(1, (items[idx].qty || 1) + delta);
    items[idx] = { ...items[idx], qty: next };
    return { ...l, items };
  });

  const skuPickerFiltered = PRODUCTS.filter(p =>
    !skuPickerQ ||
    p.sku.toLowerCase().includes(skuPickerQ.toLowerCase()) ||
    p.name.toLowerCase().includes(skuPickerQ.toLowerCase()) ||
    (p.cat || "").toLowerCase().includes(skuPickerQ.toLowerCase())
  );

  /* paste auto-split — local gazetteer parser (same parser as desktop) */
  const applyParse = async () => {
    if (typeof ensureThaiAddrIndex === "function") { try { await ensureThaiAddrIndex(); } catch (e) {} }
    const parsed = (typeof parseRecipientBlob === "function") ? parseRecipientBlob(pasteText) : {};
    if (!parsed || (!parsed.name && !parsed.phone && !parsed.addr1)) { ctx.pushToast("ไม่พบข้อมูลที่จะคัดแยก"); return; }
    setLabel(l => ({ ...l, recipient: {
      ...l.recipient,
      name:    parsed.name    || l.recipient.name,
      phone:   parsed.phone   || l.recipient.phone,
      addr1:   parsed.addr1   || l.recipient.addr1,
      addr2:    parsed.tambon ? "" : (parsed.addr2 || l.recipient.addr2),
      tambon:   parsed.tambon   || l.recipient.tambon   || "",
      amphoe:   parsed.amphoe   || l.recipient.amphoe   || "",
      province: parsed.province || l.recipient.province || "",
      postal:   parsed.zip      || l.recipient.postal   || "",
    }}));
    const hasAddr = parsed.addr1 || parsed.addr2;
    const got = [parsed.name && "ชื่อ", parsed.phone && "เบอร์", hasAddr && "ที่อยู่"].filter(Boolean).join(" · ");
    const tail = !hasAddr ? "" : parsed.addrConfidence === "high" ? " · ✓ ตรงรหัสไปรษณีย์" : " · ที่อยู่อาจไม่ครบ ลอง AI";
    setPasteNote({ summary: "คัดแยกแล้ว: " + (got || "—") + tail, leftover: parsed.leftover || "", original: pasteText });
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
      if (typeof ensureThaiAddrIndex === "function") { try { await ensureThaiAddrIndex(); } catch (e) {} }
      let aiTambon = "", aiAmphoe = "", aiProvince = "", aiPostal = "";
      const aiFullAddr = [j.addr1, j.addr2].filter(Boolean).join(" ");
      if (aiFullAddr && typeof getThaiAddrIndex === "function" && getThaiAddrIndex() && typeof parseThaiAddrTail === "function") {
        const g = parseThaiAddrTail(aiFullAddr);
        if (g && g.tambon) { aiTambon = g.tambon; aiAmphoe = g.amphoe; aiProvince = g.province; aiPostal = g.zip || ""; }
      }
      setLabel(l => ({ ...l, recipient: {
        ...l.recipient,
        name:     j.name     || l.recipient.name,
        phone:    j.phone    || l.recipient.phone,
        addr1:    j.addr1    || l.recipient.addr1,
        addr2:    aiTambon ? "" : (j.addr2 || l.recipient.addr2),
        tambon:   aiTambon   || l.recipient.tambon   || "",
        amphoe:   aiAmphoe   || l.recipient.amphoe   || "",
        province: aiProvince || l.recipient.province || "",
        postal:   aiPostal   || l.recipient.postal   || "",
      }}));
      const got = [j.name && "ชื่อ", j.phone && "เบอร์", (j.addr1 || j.addr2) && "ที่อยู่", aiTambon && "✓ ตรงรหัสไปรษณีย์"].filter(Boolean).join(" · ");
      const aiLeftover = (typeof computeRecipientLeftover === "function")
        ? computeRecipientLeftover(pasteText, { name: j.name, phone: j.phone, addr1: j.addr1, addr2: j.addr2, tambon: aiTambon, amphoe: aiAmphoe, province: aiProvince, zip: aiPostal })
        : "";
      setPasteNote({ summary: "AI คัดแยกแล้ว: " + (got || "—"), leftover: aiLeftover, original: pasteText });
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
              {pasteNote && typeof RecipientParseNote === "function" && (() => {
                const sc = (typeof scoreRecipientParse === "function")
                  ? scoreRecipientParse({ name: label.recipient.name, phone: label.recipient.phone, addr1: label.recipient.addr1, addr2: label.recipient.addr2, tambon: label.recipient.tambon, amphoe: label.recipient.amphoe, province: label.recipient.province, zip: label.recipient.postal }, pasteNote.leftover, pasteNote.original)
                  : { percent: null, missing: [] };
                return <RecipientParseNote
                  summary={pasteNote.summary} percent={sc.percent} missing={sc.missing} leftover={pasteNote.leftover}
                  onAppend={lo => { setRecip("addr2", (label.recipient.addr2 ? label.recipient.addr2 + " " : "") + lo); setPasteNote(n => n && ({ ...n, leftover: "" })); }}
                  onSkip={() => setPasteNote(n => n && ({ ...n, leftover: "" }))}
                  onDismiss={() => { setPasteNote(null); setPasteText(""); setPasteOpen(false); }}
                  mobile={true}
                />;
              })()}
            </>
          )}
        </div>

        {/* recipient fields */}
        <div className="m-section-label" style={{ padding: "0 4px 6px" }}>ผู้รับ</div>
        <input className="m-input" value={label.recipient.name} onChange={e => setRecip("name", e.target.value)} placeholder="ชื่อ-นามสกุล" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={label.recipient.addr1} onChange={e => setRecip("addr1", e.target.value)} placeholder="บ้านเลขที่ ถนน ซอย หมู่บ้าน" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={label.recipient.addr2 || ""} onChange={e => setRecip("addr2", e.target.value)} placeholder="อาคาร ชั้น ห้อง (ถ้ามี)" style={{ marginBottom: 8 }}/>
        {typeof ThaiAddrAutocomplete === "function" && (
          <div style={{ marginBottom: 8 }}>
            <ThaiAddrAutocomplete
              value={{ tambon: label.recipient.tambon || "", amphoe: label.recipient.amphoe || "", province: label.recipient.province || "", postal: label.recipient.postal || "" }}
              onChange={partial => setLabel(l => ({ ...l, recipient: { ...l.recipient, ...partial } }))}
            />
          </div>
        )}
        <input className="m-input mono" value={label.recipient.phone} onChange={e => setRecip("phone", e.target.value)} placeholder="โทรศัพท์" style={{ marginBottom: 12 }}/>

        {/* sender (ผู้ส่ง) — defaults to store settings; pick/save profiles */}
        <div className="m-section-label" style={{ padding: "0 4px 6px" }}>ผู้ส่ง</div>
        {typeof SenderPicker === "function" && <SenderPicker mobile current={label.sender || {}} onPick={s => setLabel(l => ({ ...l, sender: { ...(l.sender || {}), ...s } }))}/>}
        <input className="m-input" value={(label.sender || {}).name || ""} onChange={e => setSender("name", e.target.value)} placeholder="ชื่อ / บริษัท (ผู้ส่ง)" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={(label.sender || {}).addr1 || ""} onChange={e => setSender("addr1", e.target.value)} placeholder="ที่อยู่ผู้ส่ง (บรรทัด 1)" style={{ marginBottom: 8 }}/>
        <input className="m-input" value={(label.sender || {}).addr2 || ""} onChange={e => setSender("addr2", e.target.value)} placeholder="ที่อยู่ผู้ส่ง (บรรทัด 2)" style={{ marginBottom: 8 }}/>
        <input className="m-input mono" value={(label.sender || {}).phone || ""} onChange={e => setSender("phone", e.target.value)} placeholder="โทรศัพท์ผู้ส่ง" style={{ marginBottom: 12 }}/>

        {/* line items */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 6px" }}>
          <div className="m-section-label" style={{ padding: 0 }}>รายการสินค้า</div>
          <button
            onClick={() => setSkuPickerOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", fontFamily: "inherit" }}
          >
            <Icons.Plus size={13}/> เพิ่มสินค้า
          </button>
        </div>
        <div className="m-list" style={{ marginBottom: 12 }}>
          {(label.items || []).length === 0 && (
            <div style={{ padding: "18px 12px", textAlign: "center", fontSize: 12, color: "var(--muted)", border: "1.5px dashed var(--border)", borderRadius: 10 }}>
              ยังไม่มีรายการ — แตะเพิ่มสินค้า
            </div>
          )}
          {(label.items || []).map((it, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {it.custom ? (
                    <>
                      <input
                        className="m-input"
                        value={it.name}
                        onChange={e => setLabelItemName(i, e.target.value)}
                        placeholder="ชื่อรายการนอกคลัง (พิมพ์เอง)"
                        style={{ fontSize: 13, marginBottom: 4 }}
                      />
                      <span className="m-badge" style={{ fontSize: 10, background: "var(--warning-soft,var(--surface))", color: "var(--warning,var(--muted))", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icons.Tag size={10}/> รายการนอกคลัง
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{it.sku}</div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => removeLabelItem(i)}
                  style={{ flexShrink: 0, width: 28, height: 28, display: "grid", placeItems: "center", background: "var(--danger-soft)", color: "var(--danger)", border: "none", borderRadius: 8, cursor: "pointer" }}
                >
                  <Icons.Trash size={13}/>
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>จำนวน</span>
                <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                  <button
                    onClick={() => stepLabelItemQty(i, -1)}
                    style={{ width: 32, height: 32, fontSize: 16, background: "var(--surface)", border: "none", cursor: "pointer", color: "var(--fg)", display: "grid", placeItems: "center" }}
                  >−</button>
                  <span className="tnum" style={{ width: 32, textAlign: "center", fontSize: 14, fontWeight: 600, userSelect: "none" }}>{it.qty}</span>
                  <button
                    onClick={() => stepLabelItemQty(i, 1)}
                    style={{ width: 32, height: 32, fontSize: 16, background: "var(--surface)", border: "none", cursor: "pointer", color: "var(--accent)", display: "grid", placeItems: "center", fontWeight: 700 }}
                  >+</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* SKU picker sheet */}
        {skuPickerOpen && (
          <>
            <div className="m-sheet-backdrop" onClick={() => setSkuPickerOpen(false)}/>
            <div className="m-sheet" style={{ maxHeight: "85%" }}>
              <div className="m-sheet-grabber"/>
              <div className="m-sheet-head">
                <h3>เลือกสินค้า</h3>
                <button className="m-action" onClick={() => setSkuPickerOpen(false)}><Icons.X size={14}/></button>
              </div>
              <div style={{ padding: "12px 16px 8px", flexShrink: 0 }}>
                <div className="m-search" style={{ marginBottom: 0 }}>
                  <Icons.Search size={14}/>
                  <input
                    ref={skuPickerInputRef}
                    value={skuPickerQ}
                    onChange={e => setSkuPickerQ(e.target.value)}
                    placeholder="พิมพ์ SKU, ชื่อ, หรือหมวด"
                  />
                  {skuPickerQ && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setSkuPickerQ("")}/>}
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
                <div className="m-list" style={{ marginBottom: 8 }}>
                  <button
                    className="m-row"
                    onClick={() => addCustomLabelItem(skuPickerQ)}
                  >
                    <div className="m-row-thumb" style={{ background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}><Icons.Plus size={15}/></div>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {skuPickerQ.trim() ? `เพิ่ม "${skuPickerQ.trim()}" เป็นรายการนอกคลัง` : "เพิ่มรายการนอกคลัง (พิมพ์เอง)"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>ไม่มีในคลัง · กรอกชื่อเอง</div>
                    </div>
                  </button>
                  {skuPickerFiltered.map(p => (
                    <button
                      key={p.sku}
                      className="m-row"
                      onClick={() => addLabelItem(p.sku)}
                    >
                      <div className="m-row-thumb" style={{ fontSize: 10, fontWeight: 600 }}>{p.sku.slice(-3)}</div>
                      <div className="m-row-main">
                        <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{p.sku}</div>
                      </div>
                    </button>
                  ))}
                  {skuPickerFiltered.length === 0 && (
                    <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                      <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
                      <div>ไม่พบสินค้าที่ตรงกับ "{skuPickerQ}"</div>
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", padding: "4px 0 8px" }}>
                  {skuPickerFiltered.length} จาก {PRODUCTS.length} รายการ
                </div>
              </div>
            </div>
          </>
        )}

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

        {/* tracking + COD */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>เลขพัสดุ</div>
            <input className="m-input mono" value={label.tracking || ""} onChange={e => setField("tracking", e.target.value)} placeholder="TH123456789"/>
          </div>
          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>COD (บาท)</div>
            <input className="m-input" type="number" inputMode="numeric" value={label.cod || ""} onChange={e => setField("cod", parseInt(e.target.value, 10) || 0)} placeholder="0"/>
          </div>
        </div>

        {/* carrier */}
        <div className="m-section-label" style={{ padding: "0 4px 8px" }}>ขนส่ง</div>
        <div className="m-list" style={{ marginBottom: 12 }}>
          {CARRIERS.map(c => (
            <button key={c.id} className={"m-row" + (label.carrier === c.name ? " selected" : "")} onClick={() => setField("carrier", c.name)}>
              <CarrierMark carrier={c.name} size={22}/>
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

/* Mobile product import — same parsing/validation engine as the desktop wizard
   (IMPORT_FIELDS / autoMapColumns / validateImportRows / importProductsBulk, all
   exported from import.jsx). That file loads AFTER this one, so every reference
   goes through window at render time and falls back gracefully. */
function MImport({ ctx }) {
  const fileRef = useRefM(null);
  const [stage, setStage]       = useStateM("idle");    // idle | map | review | done
  const [fileName, setFileName] = useStateM("");
  const [headers, setHeaders]   = useStateM([]);
  const [body, setBody]         = useStateM([]);
  const [map, setMap]           = useStateM({});
  const [raws, setRaws]         = useStateM([]);
  const [dupMode, setDupMode]   = useStateM("keepQty");
  const [filter, setFilter]     = useStateM("all");
  const [showN, setShowN]       = useStateM(40);
  const [busy, setBusy]         = useStateM(false);
  const [prog, setProg]         = useStateM({ done: 0, total: 0 });
  const [result, setResult]     = useStateM(null);

  const cap     = (id) => (typeof canDo === "function" ? canDo(id) : true);
  const canAdd  = cap("addProduct");
  const canEdit = cap("editProduct");
  const fields  = (window.IMPORT_FIELDS || []).filter(f => !f.cap || cap(f.cap));
  const dupModes = window.DUP_MODES || [];
  const maxRows = window.IMPORT_MAX_ROWS || 5000;

  const mappedKeys = fields.filter(f => map[f.key] != null && map[f.key] >= 0).map(f => f.key);
  const mappedSig  = mappedKeys.join(",");

  const rows = useMemoM(() => {
    if (typeof window.validateImportRows !== "function") return [];
    return window.validateImportRows(raws, { mapped: new Set(mappedKeys), dupMode, canAdd, canEdit, normSku: true });
  }, [raws, mappedSig, dupMode, canAdd, canEdit]);

  const nNew  = rows.filter(r => r._state === "new").length;
  const nUpd  = rows.filter(r => r._state === "update").length;
  const nSkip = rows.filter(r => r._state === "skip").length;
  const nErr  = rows.filter(r => r._state === "error").length;
  const importable = rows.filter(r => r._state === "new" || r._state === "update");

  const reset = () => {
    setStage("idle"); setFileName(""); setHeaders([]); setBody([]); setRaws([]);
    setMap({}); setResult(null); setFilter("all"); setShowN(40); setProg({ done: 0, total: 0 });
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";                                  // allow re-picking the same file
    if (!f) return;
    if (typeof XLSX === "undefined") { ctx.pushToast("ไลบรารี Excel ยังไม่พร้อม"); return; }
    if (typeof window.readSheetToAoA !== "function") { ctx.pushToast("ระบบนำเข้ายังไม่พร้อม ลองรีเฟรชหน้า"); return; }
    if (f.size > 8 * 1024 * 1024) { ctx.pushToast("ไฟล์ใหญ่เกิน 8 MB — แบ่งไฟล์ก่อนนำเข้า"); return; }

    window.readSheetToAoA(f).then(aoa => {
      const head = (aoa[0] || []).map(h => String(h == null ? "" : h).trim());
      if (!head.some(h => h)) { ctx.pushToast("แถวแรกของไฟล์ต้องเป็นชื่อคอลัมน์"); return; }
      const rest = aoa.slice(1).filter(r => r && r.some(c => c !== "" && c != null));
      if (!rest.length) { ctx.pushToast("ไม่พบข้อมูลในไฟล์ (มีแต่หัวตาราง)"); return; }

      const m = typeof window.autoMapColumns === "function" ? window.autoMapColumns(head, fields) : {};
      setFileName(f.name); setHeaders(head); setBody(rest); setMap(m);

      // On a phone, skip the mapping step when both required columns were found —
      // it's still reachable from the review screen.
      if (m.sku != null && m.name != null) {
        setRaws(window.buildImportRaws(rest, m, fields));
        setStage("review");
        ctx.pushToast("อ่านไฟล์สำเร็จ " + rest.length.toLocaleString() + " แถว");
      } else {
        setStage("map");
        ctx.pushToast("จับคู่คอลัมน์ SKU และชื่อสินค้าก่อน");
      }
    }).catch(err => {
      console.error(err);
      ctx.pushToast("อ่านไฟล์ไม่ได้ — ตรวจสอบว่าเป็น .csv หรือ .xlsx ที่ไม่เสียหาย");
    });
  };

  const goReview = () => {
    if (map.sku == null || map.sku < 0)   { ctx.pushToast("ต้องจับคู่คอลัมน์ SKU ก่อน"); return; }
    if (map.name == null || map.name < 0) { ctx.pushToast("ต้องจับคู่คอลัมน์ชื่อสินค้าก่อน"); return; }
    setRaws(window.buildImportRaws(body, map, fields));
    setFilter("all"); setShowN(40);
    setStage("review");
  };

  const downloadTemplate = (kind) => {
    const head = fields.map(f => f.label + (f.required ? " *" : ""));
    const idx = fields.map(f => (window.IMPORT_FIELDS || []).findIndex(x => x.key === f.key));
    const aoa = [head, ...(window.SAMPLE_ROWS || []).map(sr => idx.map(i => sr[i]))];
    if (kind === "csv") {
      if (typeof window.downloadCsvFile !== "function") { ctx.pushToast("ระบบยังไม่พร้อม ลองรีเฟรชหน้า"); return; }
      window.downloadCsvFile(aoa, "เทมเพลตนำเข้าสินค้า.csv");
    } else {
      if (typeof XLSX === "undefined") { ctx.pushToast("ไลบรารี Excel ยังไม่พร้อม"); return; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "สินค้า");
      XLSX.writeFile(wb, "เทมเพลตนำเข้าสินค้า.xlsx");
    }
    ctx.pushToast("ดาวน์โหลดเทมเพลตแล้ว");
  };

  const runImport = async () => {
    if (busy || !importable.length) return;
    if (typeof importProductsBulk !== "function") { ctx.pushToast("ระบบนำเข้ายังไม่พร้อม ลองรีเฟรชหน้า"); return; }
    setBusy(true); setProg({ done: 0, total: importable.length });

    const defaults = typeof window.importRowDefaults === "function" ? window.importRowDefaults(fields) : {};
    const items = importable.map(r => ({
      sku: r._sku,
      mode: r._exists ? dupMode : "add",
      values: r._exists ? r._values : { ...defaults, ...r._values }
    }));

    let res;
    try { res = await importProductsBulk(items, (done, total) => setProg({ done, total })); }
    catch (err) { res = { added: 0, updated: 0, error: (err && err.message) || String(err) }; }

    let imgN = 0;
    if (!res.error && typeof setProductImagesBulk === "function") {
      const m = {};
      importable.forEach(r => { if (r._image && /^https?:\/\//i.test(r._image)) m[r._sku] = r._image; });
      imgN = setProductImagesBulk(m);
    }
    if (!res.error && typeof addCategory === "function") {
      const known = new Set(typeof loadCategories === "function" ? loadCategories() : []);
      importable.forEach(r => { const c = r._values.cat; if (c && !known.has(c)) { addCategory(c); known.add(c); } });
    }
    if (!res.error && typeof recordChange === "function" && (res.added || res.updated)) {
      recordChange({
        entity: "product", action: "import",
        summary: "นำเข้าสินค้าจากไฟล์ " + fileName + " (มือถือ) — เพิ่ม " + res.added + ", อัปเดต " + res.updated,
        count: res.added + res.updated
      });
    }

    setResult({ ...res, images: imgN, skipped: nSkip, errors: nErr });
    setBusy(false);
    setStage("done");
    if (res.error) ctx.pushToast("นำเข้าไม่สำเร็จ: " + (res.error === "PERMISSION_OR_MISSING" ? "ไม่มีสิทธิ์บันทึกสินค้า" : res.error));
    else ctx.pushToast("นำเข้าสำเร็จ — เพิ่ม " + res.added + ", อัปเดต " + res.updated);
  };

  const head = (
    <div className="m-topbar">
      <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
      <div className="m-title-sub">นำเข้าสินค้า</div>
      {stage === "idle"
        ? <div style={{ width: 30 }}/>
        : <button className="m-action" onClick={reset} title="เริ่มใหม่"><Icons.Refresh size={15}/></button>}
    </div>
  );

  if (!canAdd && !canEdit) {
    return (
      <>
        {head}
        <div className="m-content">
          <div className="m-card" style={{ textAlign: "center", padding: 28 }}>
            <Icons.Lock size={26} style={{ color: "var(--muted)", marginBottom: 10 }}/>
            <div style={{ fontWeight: 600, fontSize: 14 }}>บัญชีนี้ไม่มีสิทธิ์นำเข้าสินค้า</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>
              ต้องมีสิทธิ์ “เพิ่มสินค้าใหม่” หรือ “แก้ไขข้อมูลสินค้า” — ติดต่อผู้ดูแลระบบ
            </div>
          </div>
        </div>
      </>
    );
  }

  const stepDot = (n, label, on) => (
    <div className="row" style={{ gap: 10, marginBottom: 8 }}>
      <div style={{ width: 30, height: 30, borderRadius: 999, background: on ? "var(--accent)" : "var(--fg)", color: on ? "#fff" : "var(--bg)", display: "grid", placeItems: "center", fontWeight: 600, fontSize: 13 }}>{n}</div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
    </div>
  );

  return (
    <>
      {head}
      <div className="m-content">

        {stage === "idle" && (
          <>
            <div className="m-card">
              {stepDot(1, "ดาวน์โหลดเทมเพลต")}
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
                ไม่ใช้เทมเพลตก็ได้ — ไฟล์เรียงคอลัมน์อย่างไรก็ได้ ระบบจับคู่ให้เอง
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="m-btn-big dark" style={{ flex: 1 }} onClick={() => downloadTemplate("csv")}><Icons.Down size={15}/> .csv</button>
                <button className="m-btn-big" style={{ flex: 1 }} onClick={() => downloadTemplate("xlsx")}><Icons.Down size={15}/> .xlsx</button>
              </div>
            </div>

            <div className="m-card">
              {stepDot(2, "เลือกไฟล์")}
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>รองรับ .csv (ภาษาไทยทุกการเข้ารหัส) และ .xlsx</div>
              <div onClick={() => fileRef.current && fileRef.current.click()}
                style={{ border: "1.5px dashed var(--border-strong)", borderRadius: 12, padding: 20, textAlign: "center", cursor: "pointer", background: "var(--surface-2)" }}>
                <Icons.Pkg size={28} style={{ color: "var(--muted)", marginBottom: 8 }}/>
                <div style={{ fontSize: 13, fontWeight: 500 }}>แตะเพื่อเลือกไฟล์</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>สูงสุด {maxRows.toLocaleString()} แถวต่อครั้ง</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: "none" }}/>
            </div>

            <div style={{ padding: 14, background: "var(--info-soft)", borderRadius: 12, fontSize: 12, lineHeight: 1.6, color: "var(--fg-2)" }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "var(--info)" }}>💡 เคล็ดลับ</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>เว้นช่องว่างไว้ = ไม่แก้ค่าเดิมของสินค้านั้น</li>
                <li>SKU ที่มีอยู่แล้วจะถูกอัปเดต ไม่ใช่ปฏิเสธ</li>
                <li>ระบบตรวจทุกแถวให้ก่อน แล้วค่อยยืนยัน</li>
              </ul>
            </div>
          </>
        )}

        {stage === "map" && (
          <>
            <div className="m-card">
              {stepDot(3, "จับคู่คอลัมน์", true)}
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                {fileName} · {body.length.toLocaleString()} แถว · {headers.length} คอลัมน์
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {fields.map(f => {
                  const ci = map[f.key];
                  const on = ci != null && ci >= 0;
                  return (
                    <div key={f.key}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        {f.label}{f.required && <span style={{ color: "var(--danger)" }}> *</span>}
                        {f.required && !on && <span className="badge badge-danger" style={{ marginLeft: 6, fontSize: 9 }}>ต้องจับคู่</span>}
                      </div>
                      <select className="input" value={on ? ci : -1} style={{ fontSize: 13, padding: "8px 10px" }}
                        onChange={e => {
                          const v = parseInt(e.target.value, 10);
                          setMap(prev => {
                            const next = { ...prev };
                            if (v >= 0) Object.keys(next).forEach(k => { if (k !== f.key && next[k] === v) delete next[k]; });
                            if (v < 0) delete next[f.key]; else next[f.key] = v;
                            return next;
                          });
                        }}>
                        <option value={-1}>— ไม่ใช้ —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || "(คอลัมน์ที่ " + (i + 1) + ")"}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
            <button className="m-btn-big dark" onClick={goReview}>ตรวจสอบข้อมูล <Icons.ArrowRight size={15}/></button>
          </>
        )}

        {stage === "review" && (
          <>
            <div className="m-card">
              {stepDot(3, "ตรวจสอบและยืนยัน", true)}
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{fileName} · {rows.length.toLocaleString()} แถว</div>
              <div className="row" style={{ gap: 6, marginBottom: 12 }}>
                {[["เพิ่มใหม่", nNew, "var(--success)"], ["อัปเดต", nUpd, "var(--info)"], ["ผิดพลาด", nErr, nErr ? "var(--danger)" : "var(--muted)"]].map(([l, v, c]) => (
                  <div key={l} style={{ flex: 1, padding: "8px 6px", borderRadius: 10, background: "var(--surface-2)", textAlign: "center" }}>
                    <div className="tnum" style={{ fontSize: 17, fontWeight: 700, color: c }}>{v.toLocaleString()}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{l}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>SKU ที่มีอยู่แล้ว</div>
              <div className="stack" style={{ gap: 6 }}>
                {dupModes.map(m => {
                  const on = dupMode === m.id;
                  const locked = !canEdit && m.id !== "skip";
                  return (
                    <button key={m.id} disabled={locked} onClick={() => setDupMode(m.id)}
                      style={{
                        textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: locked ? "not-allowed" : "pointer",
                        border: "1.5px solid " + (on ? "var(--accent)" : "var(--border)"),
                        background: on ? "var(--accent-soft)" : "var(--surface)", opacity: locked ? 0.5 : 1
                      }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: on ? "var(--accent)" : "var(--fg)" }}>{m.label}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, lineHeight: 1.45 }}>{m.desc}</div>
                    </button>
                  );
                })}
              </div>

              <button className="m-action" style={{ width: "100%", marginTop: 10, fontSize: 12 }} onClick={() => setStage("map")}>
                <Icons.Edit size={13}/> แก้การจับคู่คอลัมน์
              </button>
            </div>

            <div className="m-card">
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {[["all", "ทั้งหมด", rows.length], ["new", "ใหม่", nNew], ["update", "อัปเดต", nUpd], ["skip", "ข้าม", nSkip], ["error", "ผิดพลาด", nErr]].map(([id, label, n]) => {
                  const on = filter === id;
                  return (
                    <button key={id} onClick={() => { setFilter(id); setShowN(40); }}
                      style={{
                        fontSize: 11.5, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
                        border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
                        background: on ? "var(--accent)" : "var(--surface-2)",
                        color: on ? "#fff" : "var(--fg-2)", fontWeight: on ? 600 : 500
                      }}>{label} ({n.toLocaleString()})</button>
                  );
                })}
              </div>
              <MImportRows rows={rows} filter={filter} showN={showN} onMore={() => setShowN(n => n + 40)}/>
            </div>

            <button className="m-btn-big dark" disabled={busy || !importable.length}
              style={(busy || !importable.length) ? { opacity: 0.5 } : {}} onClick={runImport}>
              <Icons.Check size={16}/> {busy
                ? "กำลังนำเข้า… " + prog.done.toLocaleString() + "/" + prog.total.toLocaleString()
                : "ยืนยันนำเข้า " + importable.length.toLocaleString() + " รายการ"}
            </button>
            {nErr > 0 && (
              <div style={{ fontSize: 11.5, color: "var(--danger)", textAlign: "center", marginTop: -4 }}>
                {nErr.toLocaleString()} แถวมีข้อผิดพลาดและจะไม่ถูกนำเข้า — แก้ในไฟล์ต้นทางแล้วอัปโหลดใหม่
              </div>
            )}
          </>
        )}

        {stage === "done" && result && (
          <div className="m-card" style={{ textAlign: "center", padding: 26 }}>
            <div style={{
              width: 54, height: 54, borderRadius: 999, margin: "0 auto 12px", display: "grid", placeItems: "center",
              background: result.error ? "var(--danger-soft)" : "var(--success-soft)",
              color: result.error ? "var(--danger)" : "var(--success)"
            }}>{result.error ? <Icons.Warn size={24}/> : <Icons.Check size={24} stroke={2}/>}</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{result.error ? "นำเข้าไม่สำเร็จ" : "นำเข้าสำเร็จ"}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.7 }}>
              {result.error
                ? (result.error === "PERMISSION_OR_MISSING" ? "บัญชีนี้ไม่มีสิทธิ์บันทึกสินค้าลงฐานข้อมูล" : result.error)
                : <>
                    เพิ่มใหม่ <strong style={{ color: "var(--fg)" }}>{(result.added || 0).toLocaleString()}</strong> ·
                    อัปเดต <strong style={{ color: "var(--fg)" }}>{(result.updated || 0).toLocaleString()}</strong>
                    {result.images > 0 && <><br/>ใส่รูปจากลิงก์ {result.images} รายการ</>}
                    {(result.skipped > 0 || result.errors > 0) && <><br/>ข้าม {result.skipped.toLocaleString()} แถว{result.errors > 0 && <> · ไม่ผ่านการตรวจ {result.errors.toLocaleString()} แถว</>}</>}
                  </>}
            </div>
            <button className="m-btn-big dark" style={{ marginTop: 18 }} onClick={reset}>นำเข้าไฟล์อื่นต่อ</button>
          </div>
        )}
      </div>
    </>
  );
}

function MImportRows({ rows, filter, showN, onMore }) {
  const shown = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (filter === "all" || r._state === filter) shown.push(r);
  }
  if (!shown.length) return <div style={{ padding: 18, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่มีแถวที่ตรงกับตัวกรองนี้</div>;

  const BADGE = { new: ["badge-success", "ใหม่"], update: ["badge-info", "อัปเดต"], skip: ["badge-neutral", "ข้าม"], error: ["badge-danger", "ผิดพลาด"] };
  return (
    <>
      <div className="m-list" style={{ maxHeight: 300, overflowY: "auto" }}>
        {shown.slice(0, showN).map((r, i) => {
          const b = BADGE[r._state] || BADGE.skip;
          return (
            <div key={i} className="m-row" style={{ cursor: "default", alignItems: "flex-start" }}>
              <div className="m-row-main">
                <div className="m-row-title" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name || <span style={{ color: "var(--faint)" }}>(ไม่มีชื่อ)</span>}
                </div>
                <div className="m-row-sub mono">
                  แถว {r._row} · {r._sku || "—"}
                  {r._values.qty != null && <> · {r._values.qty} ชิ้น</>}
                  {r._values.price != null && <> · ฿{r._values.price.toLocaleString()}</>}
                </div>
                {r._errors.map((e, k) => <div key={"e" + k} style={{ fontSize: 10.5, color: "var(--danger)", marginTop: 2 }}>{e}</div>)}
                {r._warns.map((w, k)  => <div key={"w" + k} style={{ fontSize: 10.5, color: "var(--warning)", marginTop: 2 }}>{w}</div>)}
              </div>
              <span className={"badge " + b[0]} style={{ fontSize: 9, flexShrink: 0 }}><span className="dot"/>{b[1]}</span>
            </div>
          );
        })}
      </div>
      {shown.length > showN && (
        <button className="m-action" style={{ width: "100%", marginTop: 8, fontSize: 12 }} onClick={onMore}>
          ดูเพิ่ม — แสดง {showN.toLocaleString()} จาก {shown.length.toLocaleString()} แถว
        </button>
      )}
    </>
  );
}

/* =============== CATEGORY MANAGER (used inside MSettings) =============== */

function MCategoryManagerSection({ pushToast }) {
  const [cats, setCats] = useStateM(() => (typeof loadCategories === "function" ? loadCategories() : []));
  const [newName, setNewName] = useStateM("");

  useEffectM(() => {
    const refresh = () => setCats(typeof loadCategories === "function" ? loadCategories() : []);
    window.addEventListener("ims-categories-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    return () => {
      window.removeEventListener("ims-categories-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
    };
  }, []);

  const countProducts = (cat) => PRODUCTS.filter(p => p.cat === cat).length;

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    if (typeof addCategory === "function") {
      if (!addCategory(name)) { pushToast("หมวดหมู่นี้มีอยู่แล้ว"); return; }
    }
    setCats(typeof loadCategories === "function" ? loadCategories() : []);
    setNewName("");
    pushToast(`เพิ่มหมวดหมู่ "${name}" แล้ว`);
  };

  const handleRename = async (oldName) => {
    const n = await askText("เปลี่ยนชื่อหมวดหมู่", oldName, { okLabel: "เปลี่ยนชื่อ" });
    if (!n || !n.trim() || n.trim() === oldName) return;
    if (typeof renameCategory === "function") {
      if (!renameCategory(oldName, n.trim())) { pushToast("ชื่อนี้มีอยู่แล้ว"); return; }
    }
    setCats(typeof loadCategories === "function" ? loadCategories() : []);
    pushToast(`เปลี่ยนชื่อเป็น "${n.trim()}" แล้ว`);
  };

  const handleDelete = (cat) => {
    const count = countProducts(cat);
    const msg = count > 0
      ? `ลบหมวดหมู่ "${cat}"?\nสินค้า ${count} รายการจะถูกย้ายไปหมวด "ทั่วไป"`
      : `ลบหมวดหมู่ "${cat}"?`;
    if (!confirm(msg)) return;
    if (typeof deleteCategory === "function") deleteCategory(cat);
    setCats(typeof loadCategories === "function" ? loadCategories() : []);
    pushToast(`ลบหมวดหมู่ "${cat}" แล้ว`);
  };

  return (
    <>
      <div className="m-section-label" style={{ padding: "16px 4px 8px" }}>หมวดหมู่สินค้า</div>
      <div className="m-card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input
            className="m-input"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", fontSize: 13 }}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="ชื่อหมวดหมู่ใหม่"
          />
          <button className="btn btn-sm btn-accent" onClick={handleAdd}><Icons.Plus size={12}/> เพิ่ม</button>
        </div>
        <div className="m-list" style={{ margin: "0 -14px -14px" }}>
          {cats.map(cat => (
            <div key={cat} className="m-row" style={{ cursor: "default" }}>
              <div className="m-row-main">
                <div className="m-row-title" style={{ fontSize: 13 }}>{cat}</div>
                <div className="m-row-sub">{countProducts(cat)} รายการ</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => handleRename(cat)}><Icons.Edit size={12}/></button>
                <button className="btn btn-sm btn-ghost" style={{ color: "var(--danger)" }} onClick={() => handleDelete(cat)}><Icons.Trash size={12}/></button>
              </div>
            </div>
          ))}
          {cats.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--muted)" }}>ยังไม่มีหมวดหมู่</div>}
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
        <button className="m-btn-big outline" style={{ marginTop: 8 }} onClick={async () => {
          try {
            if (typeof runCloudBackup !== "function") throw new Error("ยังไม่พร้อม");
            ctx.pushToast("กำลังสำรองเข้า Google Drive…");
            const r = await runCloudBackup();
            if (r.error) throw new Error(r.error);
            const d = r.data || {};
            ctx.pushToast(`สำรองเข้า Drive แล้ว${d.stockFile ? " + รายงานสต็อก Excel" : ""}`);
            if (d.stockError) ctx.pushToast("แต่รายงานสต็อก Excel ไม่สำเร็จ");
          } catch (e) { ctx.pushToast("สำรองเข้า Drive ไม่สำเร็จ: " + ((e && e.message) || e)); }
        }}><Icons.Refresh size={16}/> สำรองเข้า Drive ตอนนี้ (JSON + Excel)</button>
        <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 4px 0" }}>เก็บไฟล์ไว้ หรืออัปโหลดเข้า Google Drive · สำรองอัตโนมัติทุกคืน (เฉพาะแอดมิน)</div>

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

        <MCategoryManagerSection pushToast={ctx.pushToast}/>

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
  const fallback = { enabled: false, roles: ["staff", "packer", "viewer"], days: {} };
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
    window.addEventListener("ims-sales-change", refresh);
    if (typeof refreshSaleMoves === "function") refreshSaleMoves();
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
      window.removeEventListener("ims-sales-change", refresh);
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
    // Profit/margin are cost-derived — drop the columns for roles without viewCost.
    const withCost = canDo("viewCost");
    const rows = [withCost ? ["สินค้า", "SKU", "ขายได้", "ยอดขาย", "กำไร", "มาร์จิ้น%"] : ["สินค้า", "SKU", "ขายได้", "ยอดขาย"]];
    data.forEach(p => rows.push(withCost
      ? [p.name, p.sku, p.units, Math.round(p.revenue), Math.round(p.profit), (p.margin * 100).toFixed(1)]
      : [p.name, p.sku, p.units, Math.round(p.revenue)]));
    const csv = "﻿" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "analytics.csv"; a.click();
    URL.revokeObjectURL(url);
    ctx.pushToast("ส่งออก CSV แล้ว");
  };

  // Mirror of the desktop rule: this whole screen is the sales view, so the
  // page id alone must not grant it — viewSales does.
  if (!canDo("viewSales")) return <MNoAccess ctx={ctx}/>;

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">วิเคราะห์ยอดขาย</div>
        {canDo("exportData") && <button className="m-action" onClick={exportCsv}><Icons.Pkg size={14}/></button>}
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
          {canDo("viewCost") && (
            <div className="m-kpi">
              <div className="m-kpi-label">กำไรขั้นต้น</div>
              <div className="m-kpi-value" style={{ fontSize: 18, color: total.profit > 0 ? "var(--success)" : "var(--fg)" }}>{mMoney(total.profit)}</div>
              <div style={{ fontSize: 10, marginTop: 2, color: "var(--muted)" }}>{total.revenue > 0 ? `มาร์จิ้น ${(totalMargin * 100).toFixed(1)}%` : "—"}</div>
            </div>
          )}
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
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 160, position: "relative" }}>
            {chart.map((v, i) => {
              const pct = Math.max(2, (v / chartMax) * 100);
              const showLabel = v > 0 && pct >= 35;
              return (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  {showLabel && <div style={{ fontSize: 9, color: "var(--fg)", marginBottom: 2, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", maxWidth: "100%", textAlign: "center" }}>{isRev ? mMoney(v).replace("฿","") : v}</div>}
                  <div title={isRev ? mMoney(v) : `${mFmt(v)} ออร์เดอร์`} style={{
                    width: "100%",
                    height: pct + "%",
                    background: "linear-gradient(180deg, var(--accent), oklch(0.55 0.18 38))",
                    borderRadius: "3px 3px 0 0"
                  }}/>
                </div>
              );
            })}
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
                    <ChannelMark channel={c.name} size={16}/>
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
                      {canDo("viewCost") && <MSumCell label="กำไร/ชิ้น" value={"฿" + mFmt(p.price - p.costPrice)}/>}
                      {canDo("viewCost") && <MSumCell label="กำไรรวม" value={mMoney(p.profit)} accent/>}
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
  const [cat, setCat] = useStateM("all");
  const [onlyCounted, setOnlyCounted] = useStateM(false);
  const [camOpen, setCamOpen] = useStateM(false);
  const [tick, setTick] = useStateM(0);

  useEffectM(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener("ims-products-change", refresh);
    return () => window.removeEventListener("ims-products-change", refresh);
  }, []);
  useEffectM(() => () => setCamOpen(false), []);

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

  const cats = useMemoM(() => ["all", ...Array.from(new Set(PRODUCTS.map(p => p.cat).filter(Boolean)))], [tick]);

  const fillSystem = () => {
    setCounts(prev => {
      const next = { ...prev };
      rows.forEach(p => { next[p.sku] = String(p.qty); });
      saveStockTake(next);
      return next;
    });
  };

  const exportCsv = () => {
    const csvRows = [["SKU", "ชื่อสินค้า", "สต็อกระบบ", "นับได้", "ส่วนต่าง"]];
    PRODUCTS.forEach(p => {
      const raw = counts[p.sku];
      const counted = (raw !== undefined && raw !== "") ? (parseInt(raw, 10) || 0) : "";
      const delta = counted !== "" ? counted - p.qty : "";
      csvRows.push([p.sku, `"${(p.name || "").replace(/"/g, '""')}"`, p.qty, counted, delta]);
    });
    const csv = "﻿" + csvRows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "stocktake.csv"; a.click();
    URL.revokeObjectURL(url);
    ctx.pushToast("ส่งออก CSV แล้ว");
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
    return PRODUCTS.filter(p => {
      if (cat !== "all" && p.cat !== cat) return false;
      if (onlyCounted && counts[p.sku] === undefined) return false;
      if (!lq) return true;
      return p.sku.toLowerCase().includes(lq) || (p.name || "").toLowerCase().includes(lq);
    });
  }, [q, cat, onlyCounted, counts, tick]);

  const summary = useMemoM(() => {
    let counted = 0, disc = 0, net = 0;
    Object.keys(counts).forEach(sku => {
      const p = PRODUCTS.find(x => x.sku === sku);
      if (!p || counts[sku] === "") return;
      counted++; const v = (parseInt(counts[sku], 10) || 0) - p.qty;
      if (v !== 0) disc++; net += v;
    });
    const uncounted = PRODUCTS.length - counted;
    return { counted, uncounted, disc, net };
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
    // Same duplicate-commit latch as desktop ตรวจนับสต็อก.
    const guardKey = (typeof commitFingerprint === "function")
      ? commitFingerprint("stocktake-apply", changeList) : null;
    if (guardKey && typeof claimCommit === "function" && !claimCommit(guardKey)) {
      if (typeof duplicateCommitToast === "function") duplicateCommitToast();
      // The identical count DID just apply — clear the sheet (desktop twin).
      setCounts({}); saveStockTake({});
      return;
    }
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
        {canDo("exportData") && <button className="m-action" title="ส่งออก CSV" onClick={exportCsv}><Icons.Pkg size={14}/></button>}
        <button className="m-action accent" onClick={save} disabled={!changeList.length} style={!changeList.length ? { opacity: 0.4 } : {}}><Icons.Check size={16}/></button>
      </div>
      <div className="m-content">
        <div className="m-kpi-row">
          <div className="m-kpi"><div className="m-kpi-label">นับแล้ว</div><div className="m-kpi-value" style={{ fontSize: 18 }}>{summary.counted}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">ยังไม่นับ</div><div className="m-kpi-value" style={{ fontSize: 18, color: summary.uncounted > 0 ? "var(--warning)" : "var(--success)" }}>{summary.uncounted}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">ส่วนต่าง</div><div className="m-kpi-value" style={{ fontSize: 18, color: summary.disc ? "var(--warning)" : "var(--success)" }}>{summary.disc}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">สุทธิ</div><div className="m-kpi-value" style={{ fontSize: 18, color: summary.net > 0 ? "var(--info)" : summary.net < 0 ? "var(--danger)" : "var(--fg)" }}>{summary.net > 0 ? "+" : ""}{summary.net}</div></div>
        </div>

        {!camOpen && (
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <button className="m-btn-big dark" style={{ flex: 1, marginBottom: 0 }} onClick={() => setCamOpen(true)}><Icons.Camera size={18}/> สแกนเพื่อนับ +1</button>
            <button style={{ padding: "0 14px", height: 48, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--fg)", fontSize: 12, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }} onClick={fillSystem} title="ใส่จำนวนในระบบให้ทุกแถวที่แสดงอยู่"><Icons.Refresh size={13}/> ใส่ค่าระบบ</button>
          </div>
        )}
        {camOpen && <CameraScanner onScan={code => { submit(code); }} onClose={() => setCamOpen(false)}/>}

        <div className="m-search">
          <Icons.Search size={16} style={{ color: "var(--muted)" }}/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา SKU หรือชื่อสินค้า..."/>
        </div>

        <div className="m-chips-scroll" style={{ marginBottom: 10 }}>
          {cats.map(c => (
            <button key={c} className={"m-chip" + (cat === c ? " on" : "")} onClick={() => setCat(c)}>{c === "all" ? "ทุกหมวด" : c}</button>
          ))}
          <button className={"m-chip" + (onlyCounted ? " on" : "")} onClick={() => setOnlyCounted(v => !v)}>นับแล้วเท่านั้น</button>
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

/* =============== แพ็คสินค้า — PICK & PACK (mobile) ===============
   The packer's screen. Stock is already deducted by the time an order lands here
   (see the pack helpers in data.jsx), so nothing here moves stock: it tells staff
   which shelf to walk to, tracks tick-off, and flips picking → packed at the end.
   The ONE exception is the shortage flow, which repairs a wrong-shelf pick via
   repointPackLine — a redistribution, not a stock change.

   Two modes share every helper: one order at a time (MPackOrder) and a wave of
   several orders merged into one walk (MPackWave). */

// Shelf path rendered compactly: position badge + the building/floor it sits in.
function MPackLoc({ parts, loc }) {
  if (!loc) return <span style={{ fontSize: 11, color: "var(--danger)" }}>ยังไม่ระบุตำแหน่ง</span>;
  const p = parts || (typeof locParts === "function" ? locParts(loc) : null);
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", padding: "1px 7px", borderRadius: 6, flexShrink: 0 }}>
        {(p && p.pos) || loc}
      </span>
      {p && (p.building || p.floor) && (
        <span style={{ fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.building}{p.floor ? " · " + p.floor : ""}
        </span>
      )}
    </span>
  );
}

/* Reminder note pinned to a shelf — shown at that stop of every walk. Tap to
   add/edit; saving blank removes it. Re-renders with the parent's pack tick. */
function MPackLocNote({ loc, user }) {
  // "-" / blank = no shelf; a note there would land on every unshelved item.
  if (typeof packNoteLocOk !== "function" || !packNoteLocOk(loc) || typeof packLocNote !== "function") return null;
  const note = packLocNote(loc);
  // Owner-only (RLS enforces it too): packers see the note, never edit it.
  const canEdit = typeof canEditPackLocNotes === "function" && canEditPackLocNotes();
  const edit = () => editPackLocNote(loc, (user && user.name) || "");
  if (!note) {
    if (!canEdit) return null;
    return (
      <button onClick={edit} style={{ background: "none", border: "none", padding: "0 2px 6px", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>
        + เพิ่มโน้ตช่องนี้
      </button>
    );
  }
  return (
    // Loud on purpose: a reminder the packer must not miss mid-walk.
    <div onClick={canEdit ? edit : undefined} role={canEdit ? "button" : undefined} style={{ margin: "0 0 8px", padding: "10px 12px", background: "var(--warning-soft)", borderLeft: "5px solid var(--warning)", borderRadius: 10, cursor: canEdit ? "pointer" : "default", lineHeight: 1.5 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--warning)" }}>📌 โน้ตช่องนี้</span>
        {canEdit && <span style={{ fontSize: 10.5, color: "var(--muted)", flexShrink: 0 }}>แตะเพื่อแก้ไข ✎</span>}
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--fg)", whiteSpace: "pre-line", wordBreak: "break-word" }}>{note.text}</div>
      {note.by && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>— {note.by}</div>}
    </div>
  );
}

/* Owner's note for ONE order (โน้ตออร์เดอร์) — work details for this parcel.
   Packers read it; only the owner gets the add/edit affordance (RLS enforces it). */
function MPackOrderNote({ orderId, user, compact }) {
  if (!orderId || typeof packOrderNote !== "function") return null;
  const note = packOrderNote(orderId);
  const canEdit = typeof canEditPackLocNotes === "function" && canEditPackLocNotes();
  const edit = () => editPackOrderNote(orderId, (user && user.name) || "");
  if (!note) {
    if (!canEdit) return null;
    return (
      <button onClick={edit} style={{ background: "none", border: "1px dashed var(--border)", borderRadius: 10, padding: "8px 12px", color: "var(--muted)", fontSize: 12, cursor: "pointer", width: "100%", textAlign: "left", marginTop: compact ? 0 : 10 }}>
        + เพิ่มโน้ตออร์เดอร์ (รายละเอียดงานของออร์เดอร์นี้)
      </button>
    );
  }
  return (
    <div onClick={canEdit ? edit : undefined} role={canEdit ? "button" : undefined} style={{ marginTop: compact ? 0 : 10, padding: "10px 12px", background: "var(--accent-soft)", borderLeft: "5px solid var(--accent)", borderRadius: 10, cursor: canEdit ? "pointer" : "default", lineHeight: 1.5 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent)" }}>📝 โน้ตออร์เดอร์</span>
        {canEdit && <span style={{ fontSize: 10.5, color: "var(--muted)", flexShrink: 0 }}>แตะเพื่อแก้ไข ✎</span>}
      </div>
      <div style={{ fontSize: compact ? 14 : 15.5, fontWeight: 700, color: "var(--fg)", whiteSpace: "pre-line", wordBreak: "break-word" }}>{note.text}</div>
      {note.by && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>— {note.by}</div>}
    </div>
  );
}

/* One pick line. `picked` / `short` come from the caller's progress record so the
   same row serves a single order and a wave without owning any state itself. */
function MPackLine({ line, picked, short, onSet, onShort, sub }) {
  const full = picked >= line.qty;
  const tone = short ? "var(--warning)" : full ? "var(--success)" : "var(--fg)";
  // The split says this shelf holds fewer than the line needs — surface it BEFORE
  // the walk, which is the whole point of showing shelfQty.
  const thin = !short && !full && line.shelfQty < line.qty;
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", background: short ? "var(--warning-soft)" : full ? "var(--success-soft)" : undefined }}>
      <div className="row" style={{ gap: 10 }}>
        <button
          onClick={() => onSet(full ? 0 : line.qty)}
          title={full ? "ยกเลิกการหยิบ" : "หยิบครบตามจำนวน"}
          style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: "1.5px solid " + (full ? "var(--success)" : "var(--border)"), background: full ? "var(--success)" : "transparent", color: full ? "#fff" : "var(--muted)", display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}>
          {full ? <Icons.Check size={19}/> : short ? <Icons.Warn size={16}/> : null}
        </button>
        <ProductImageThumb sku={line.sku} size={34} radius={7}/>
        <div className="m-row-main" style={{ minWidth: 0 }}>
          <div className="m-row-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: tone, textDecoration: full ? "line-through" : "none" }}>{line.name}</div>
          <div className="m-row-sub mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.sku}</div>
          {line.addedQty > 0 && (
            <span style={{ display: "inline-block", marginTop: 3, fontSize: 10.5, fontWeight: 700, color: "#fff", background: "var(--info)", borderRadius: 999, padding: "1px 8px" }}>
              ＋ เพิ่มใหม่ {line.addedQty < line.qty ? line.addedQty + " ชิ้น" : ""}
            </span>
          )}
        </div>
        <span className="tnum" style={{ fontSize: 15, fontWeight: 700, flexShrink: 0, color: tone }}>{picked}/{line.qty}</span>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 8, justifyContent: "space-between" }}>
        <MPackLoc parts={line.parts} loc={line.loc}/>
        <div className="qty-stepper" style={{ flexShrink: 0 }}>
          <button onClick={() => onSet(Math.max(0, picked - 1))} disabled={picked <= 0}>−</button>
          <input type="number" inputMode="numeric" value={picked || ""} placeholder="0"
                 onChange={e => onSet(Math.max(0, Math.min(line.qty, parseInt(e.target.value || "0", 10) || 0)))}/>
          <button onClick={() => onSet(Math.min(line.qty, picked + 1))} disabled={full}>+</button>
        </div>
      </div>

      {sub}

      {(thin || short) && (
        <div className="row" style={{ gap: 8, marginTop: 8, justifyContent: "space-between" }}>
          <span style={{ fontSize: 11, color: short ? "var(--warning)" : "var(--danger)", flex: 1, minWidth: 0 }}>
            {short ? "บันทึกว่าของขาด: " + short : `ตำแหน่งนี้มีในระบบ ${line.shelfQty} ชิ้น (ต้องใช้ ${line.qty})`}
          </span>
          <button className="btn btn-sm" style={{ flexShrink: 0, fontSize: 11 }} onClick={onShort}>หาที่อื่น</button>
        </div>
      )}
      {/* Secondary escape hatch, but still a real thumb target on a phone. */}
      {!thin && !short && !full && (
        <button onClick={onShort} style={{ marginTop: 2, background: "none", border: "none", padding: "9px 2px", color: "var(--muted)", fontSize: 11, textDecoration: "underline", cursor: "pointer", textAlign: "left" }}>
          หยิบไม่ครบ / ไม่พบของที่ตำแหน่งนี้
        </button>
      )}
    </div>
  );
}

/* Shortage resolution. Two honest outcomes:
   1. The pieces are on another shelf → repointPackLine repairs the recorded
      split (the sale debited the wrong position) and the line completes.
   2. They genuinely aren't in the building → record the shortage; the order can
      still be finished, and the audit trail points at ปรับสต็อก. */
function MPackShortSheet({ line, picked, onClose, onResolve, pushToast }) {
  const [busy, setBusy] = useStateM(false);
  const busyRef = useRefM(false);   // sync latch — a state flag alone can let a double-tap through
  const missing = Math.max(0, line.qty - picked);
  const alts = useMemoM(() => (typeof packAltPositions === "function") ? packAltPositions(line.sku, line.loc) : [], [line.sku, line.loc]);

  const takeFrom = async (alt) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const want = Math.min(missing, alt.qty);
    const res = (typeof repointPackLine === "function")
      ? await repointPackLine(line.sku, line.loc, alt.loc, want)
      : { ok: false, error: "ไม่พร้อมใช้งาน" };
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) { pushToast(res.error || "ย้ายตำแหน่งไม่สำเร็จ"); return; }
    onResolve({ picked: picked + want, short: res.shortfall > 0 ? `ขาด ${res.shortfall} ชิ้น` : "", movedFrom: alt.loc, moved: want });
    pushToast(res.skipped
      ? `หยิบจาก ${(locParts(alt.loc) || {}).pos || alt.loc} แล้ว`
      : `ย้าย ${want} ชิ้นไปที่ ${(locParts(alt.loc) || {}).pos || alt.loc} แล้ว${res.shortfall > 0 ? ` — ยังขาด ${res.shortfall}` : ""}`);
    onClose();
  };

  const markShort = (reason) => {
    onResolve({ picked, short: reason });
    pushToast(`บันทึกว่าของขาด ${missing} ชิ้น — ตรวจนับ ${line.sku} อีกครั้ง`);
    onClose();
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "80%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{line.name}</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              <span className="mono">{line.sku}</span> · ยังขาด {missing} ชิ้น
            </div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            ระบบตัดของออกจาก <strong style={{ color: "var(--fg)" }}>{(line.parts && line.parts.pos) || line.loc || "—"}</strong> ไปแล้ว
            ถ้าหยิบจากตำแหน่งอื่น ระบบจะแก้จำนวนตามตำแหน่งให้ตรงกับของจริง
          </div>

          <div>
            <div className="m-section-label" style={{ padding: "0 2px 6px" }}>ตำแหน่งอื่นที่มีสินค้านี้ ({alts.length})</div>
            {alts.length === 0 && (
              <div style={{ padding: "14px 12px", textAlign: "center", color: "var(--muted)", fontSize: 12, background: "var(--surface-2)", borderRadius: 10 }}>
                ไม่มีตำแหน่งอื่นที่บันทึกว่ามีสินค้านี้
              </div>
            )}
            <div className="m-list">
              {alts.map(alt => {
                const ap = (typeof locParts === "function") ? locParts(alt.loc) : null;
                const can = Math.min(missing, alt.qty);
                return (
                  <button key={alt.loc} className="m-row" disabled={busy} onClick={() => takeFrom(alt)}>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13 }}>{(ap && ap.pos) || alt.loc}</div>
                      <div className="m-row-sub">{ap ? `${ap.building}${ap.floor ? " · " + ap.floor : ""}` : ""} · มี {alt.qty} ชิ้น</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}>หยิบ {can}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="m-sheet-foot" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button className="m-btn-big" style={{ marginBottom: 0, background: "var(--warning-soft)", color: "var(--warning)", border: "1px solid var(--warning)" }} onClick={() => markShort("ไม่พบของที่ตำแหน่ง")}>
            <Icons.Warn size={16}/> ไม่พบของ — บันทึกว่าขาด {missing} ชิ้น
          </button>
          <button className="m-btn-big outline" style={{ marginBottom: 0 }} onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </>
  );
}

/* Queue of orders waiting to be packed. Doubles as the wave builder: tick several
   orders and start one merged walk. */
function MPack({ ctx }) {
  const [tick, setTick] = useStateM(0);
  const [selecting, setSelecting] = useStateM(false);
  const [sel, setSel] = useStateM({});
  const [labelCfg, setLabelCfg] = useStateM(false);   // ⚙ ตั้งค่าใบปะหน้า — shop-wide

  useEffectM(() => {
    const refresh = () => setTick(t => t + 1);
    window.addEventListener("ims-orders-change", refresh);
    window.addEventListener("ims-labels-change", refresh);
    window.addEventListener("ims-pack-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    return () => {
      window.removeEventListener("ims-orders-change", refresh);
      window.removeEventListener("ims-labels-change", refresh);
      window.removeEventListener("ims-pack-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
    };
  }, []);

  const orders = useMemoM(() => (typeof packQueue === "function") ? packQueue() : [], [tick]);
  const progress = useMemoM(() => (typeof loadPackProgress === "function") ? loadPackProgress() : {}, [tick]);

  // Waves still open, so a picker who backgrounded the app can rejoin one.
  const waves = useMemoM(() => Object.keys(progress)
    .filter(k => k.indexOf("batch:") === 0)
    .map(k => ({ id: k, rec: progress[k] })), [progress]);
  // An order already in an open wave is being picked there — opening it alone or
  // adding it to a second wave would fetch the same pieces twice.
  const waveOf = useMemoM(() => {
    const m = {};
    waves.forEach(w => (w.rec.orderIds || []).forEach(id => { m[id] = w.id; }));
    return m;
  }, [waves]);

  const rows = useMemoM(() => orders.map(o => {
    const lines = (typeof packLinesForOrder === "function") ? packLinesForOrder(o) : [];
    const totals = (typeof packLineTotals === "function") ? packLineTotals(lines, progress[o.id]) : { pct: 0, need: 0, lineCount: 0 };
    const shelves = new Set(lines.map(l => l.loc).filter(Boolean));
    return { o, lines, totals, shelves: shelves.size, started: !!progress[o.id] };
  }), [orders, progress]);

  const selIds = Object.keys(sel).filter(id => sel[id]);
  const totalPieces = rows.reduce((s, r) => s + r.totals.need, 0);
  const inProgress = rows.filter(r => r.started).length;

  const clear = () => { setSel({}); setSelecting(false); };

  const startWave = () => {
    if (selIds.length < 2) { ctx.pushToast("เลือกอย่างน้อย 2 ออร์เดอร์เพื่อหยิบรวม"); return; }
    const id = (typeof newPackBatchId === "function") ? newPackBatchId() : "batch:" + Date.now();
    const who = (ctx.user && ctx.user.name) || "";
    savePackEntry(id, { done: {}, short: {}, by: who, startedAt: new Date().toISOString(), orderIds: selIds, stage: "pick" });
    clear();
    ctx.push("pack-wave", { batchId: id });
  };

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">แพ็คสินค้า</div>
        <button className="m-action" onClick={() => selecting ? clear() : setSelecting(true)} title="หยิบรวมหลายออร์เดอร์">
          {selecting ? <Icons.X size={16}/> : <Icons.Check size={16}/>}
        </button>
      </div>
      <div className="m-content">
        {canDo("sell") && !selecting && (
          <button className="m-btn-big" style={{ marginBottom: 12 }} onClick={() => ctx.push("pack-new")}>
            <Icons.Plus size={18}/> สั่งแพ็คใหม่
          </button>
        )}
        {!selecting && typeof PackLabelSettings === "function" && canEditPackLabel() && (labelCfg
          ? <PackLabelSettings mobile pushToast={ctx.pushToast} onClose={() => setLabelCfg(false)}/>
          : <button className="btn" style={{ width: "100%", justifyContent: "center", marginBottom: 12 }} onClick={() => setLabelCfg(true)}>⚙ ตั้งค่าใบปะหน้า (ทุกใบ)</button>)}
        <div className="m-kpi-row">
          <div className="m-kpi"><div className="m-kpi-label">รอแพ็ค</div><div className="m-kpi-value" style={{ fontSize: 18 }}>{rows.length}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">รวมชิ้น</div><div className="m-kpi-value" style={{ fontSize: 18 }}>{totalPieces}</div></div>
          <div className="m-kpi"><div className="m-kpi-label">กำลังแพ็ค</div><div className="m-kpi-value" style={{ fontSize: 18, color: inProgress ? "var(--info)" : "var(--fg)" }}>{inProgress}</div></div>
        </div>

        {waves.length > 0 && !selecting && (
          <>
            <div className="m-section-label" style={{ padding: "8px 4px" }}>หยิบรวมที่ค้างอยู่</div>
            <div className="m-list" style={{ marginBottom: 12 }}>
              {waves.map(w => (
                <button key={w.id} className="m-row" onClick={() => ctx.push("pack-wave", { batchId: w.id })}>
                  <div className="m-row-thumb" style={{ background: "var(--info-soft)", color: "var(--info)" }}><Icons.Box size={16}/></div>
                  <div className="m-row-main">
                    <div className="m-row-title">หยิบรวม {(w.rec.orderIds || []).length} ออร์เดอร์</div>
                    <div className="m-row-sub">{w.rec.stage === "sort" ? "ขั้นตอน: แยกลงออร์เดอร์" : "ขั้นตอน: เดินหยิบ"}{w.rec.by ? " · " + w.rec.by : ""}</div>
                  </div>
                  <Icons.Chev size={14} className="m-row-chev"/>
                </button>
              ))}
            </div>
          </>
        )}

        {selecting && (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12, marginBottom: 10 }}>
            เลือกออร์เดอร์ที่จะเดินหยิบรวมรอบเดียว แล้วกดปุ่มด้านล่าง
          </div>
        )}

        {rows.length > 1 && typeof PACK_SORTS !== "undefined" && (
          <div className="m-chips-scroll" style={{ marginBottom: 10 }}>
            {PACK_SORTS.map(x => (
              <button key={x.id} className={"m-chip" + (packSortMode() === x.id ? " on" : "")} onClick={() => setPackSortMode(x.id)}>{x.label}</button>
            ))}
          </div>
        )}

        <div className="m-list">
          {rows.map(r => (
            <button key={r.o.id} className="m-row" style={selecting && waveOf[r.o.id] ? { opacity: 0.45 } : undefined} onClick={() => {
              const w = waveOf[r.o.id];
              if (selecting) {
                if (w) { ctx.pushToast("ออร์เดอร์นี้อยู่ในรอบหยิบรวมอื่นแล้ว"); return; }
                setSel(prev => { const n = { ...prev }; if (n[r.o.id]) delete n[r.o.id]; else n[r.o.id] = true; return n; }); return;
              }
              if (w) { ctx.push("pack-wave", { batchId: w }); return; }
              ctx.push("pack-order", { id: r.o.id });
            }}>
              {selecting && (
                <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: "1.5px solid " + (sel[r.o.id] ? "var(--accent)" : "var(--border)"), background: sel[r.o.id] ? "var(--accent)" : "transparent", color: "#fff", display: "grid", placeItems: "center" }}>
                  {sel[r.o.id] ? <Icons.Check size={13}/> : null}
                </div>
              )}
              <div className="m-row-main">
                <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                  <div className="m-row-title mono" style={{ fontSize: 13 }}>{r.o.id}</div>
                  {typeof packOrderTime === "function" && <span style={{ fontSize: 10.5, color: "var(--muted)", flexShrink: 0 }}>{packOrderTime(r.o)}</span>}
                </div>
                <div className="m-row-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.o.customer || "—"} · {r.totals.lineCount} รายการ · {r.totals.need} ชิ้น · {r.shelves} ตำแหน่ง
                </div>
                {waveOf[r.o.id] && <div style={{ fontSize: 10.5, color: "var(--info)", fontWeight: 600, marginTop: 3 }}>กำลังหยิบรวมอยู่ — แตะเพื่อเปิดรอบนั้น</div>}
                {typeof PackAddedBanner === "function" && <PackAddedBanner order={r.o} compact/>}
                {!selecting && typeof PackDocChip === "function" && <PackDocChip order={r.o}/>}
                {r.started && (
                  <div className="row" style={{ gap: 6, marginTop: 5 }}>
                    <div className="prog" style={{ flex: 1, height: 4 }}><span style={{ width: r.totals.pct + "%" }}/></div>
                    <span className="tnum" style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>{r.totals.got}/{r.totals.need}</span>
                  </div>
                )}
              </div>
              {!selecting && <Icons.Chev size={14} className="m-row-chev"/>}
            </button>
          ))}
          {rows.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              <Icons.Check size={26} style={{ marginBottom: 8, color: "var(--success)" }}/>
              <div>ไม่มีออร์เดอร์รอแพ็ค</div>
              <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.7, textAlign: "left", display: "inline-block" }}>
                กดปุ่ม <b>สั่งแพ็คใหม่</b> ด้านบน<br/>
                → เลือกสินค้า + แนบใบปะหน้าหรือวางที่อยู่<br/>
                → ส่งให้คนแพ็ค
              </div>
            </div>
          )}
        </div>

        {selecting && selIds.length > 0 && (
          <button className="m-btn-big dark" style={{ marginTop: 14 }} onClick={startWave}>
            <Icons.Box size={18}/> เริ่มหยิบรวม {selIds.length} ออร์เดอร์
          </button>
        )}
      </div>
    </>
  );
}

/* Per-order pack station. */
function MPackOrder({ ctx }) {
  const orderId = (ctx.route.params && ctx.route.params.id) || "";
  const [tick, setTick] = useStateM(0);
  const [entry, setEntry] = useStateM(() => (typeof packEntry === "function") ? packEntry(orderId) : { done: {}, short: {} });
  const [camOpen, setCamOpen] = useStateM(false);
  const [shortLine, setShortLine] = useStateM(null);

  useEffectM(() => {
    const refresh = () => { setTick(t => t + 1); setEntry(packEntry(orderId)); };
    window.addEventListener("ims-pack-change", refresh);
    window.addEventListener("ims-orders-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    return () => {
      window.removeEventListener("ims-pack-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
    };
  }, [orderId]);
  useEffectM(() => () => setCamOpen(false), []);

  const order = useMemoM(() => {
    const all = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
    return (all || []).find(o => o.id === orderId) || null;
  }, [orderId, tick]);
  const lines = useMemoM(() => (order && typeof packLinesForOrder === "function") ? packLinesForOrder(order) : [], [order, tick]);
  const totals = useMemoM(() => packLineTotals(lines, entry), [lines, entry]);

  // Every write goes through here so `by`/`startedAt` are stamped once and the
  // record we hand to savePackEntry is always complete (shallow cloud merge).
  const write = (done, short) => {
    const next = {
      done: done || entry.done,
      short: short || entry.short,
      by: entry.by || (ctx.user && ctx.user.name) || "",
      startedAt: entry.startedAt || new Date().toISOString(),
      orderIds: null, stage: ""
    };
    setEntry(next);
    savePackEntry(orderId, next);
  };
  const setPicked = (line, v) => {
    const done = { ...entry.done };
    const n = Math.max(0, Math.min(line.qty, Math.round(Number(v) || 0)));
    if (n) done[line.key] = n; else delete done[line.key];
    // Reaching the full qty resolves any recorded shortage for that line.
    const short = { ...entry.short };
    if (n >= line.qty && short[line.key]) delete short[line.key];
    write(done, short);
  };
  const resolveShort = (line, out) => {
    const done = { ...entry.done };
    const short = { ...entry.short };
    const n = Math.max(0, Math.min(line.qty, Math.round(Number(out.picked) || 0)));
    if (n) done[line.key] = n; else delete done[line.key];
    if (out.short) short[line.key] = out.short; else delete short[line.key];
    write(done, short);
  };

  const onScan = (code) => {
    const c = String(code || "").trim();
    if (!c) return;
    const hits = lines.filter(l => l.sku.toLowerCase() === c.toLowerCase());
    if (!hits.length) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      ctx.pushToast("ไม่อยู่ในออร์เดอร์นี้: " + c);
      return;
    }
    // Same sku on two shelves → fill the first line that still needs pieces.
    const target = hits.find(l => (entry.done[l.key] || 0) < l.qty) || hits[0];
    const cur = entry.done[target.key] || 0;
    if (cur >= target.qty) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      ctx.pushToast(`${target.sku} หยิบครบแล้ว (${target.qty})`);
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    setPicked(target, cur + 1);
    ctx.pushToast(`${target.sku} · ${cur + 1}/${target.qty} · ${(target.parts && target.parts.pos) || target.loc || "—"}`);
  };

  const finish = () => {
    if (!order) return;
    const shortList = Object.keys(entry.short || {});
    const msg = totals.complete
      ? `ยืนยันแพ็คเสร็จ ${order.id}?`
      : `ยังหยิบไม่ครบ (${totals.got}/${totals.need} ชิ้น)\nยืนยันแพ็คเสร็จ ${order.id}?`;
    if (!confirm(msg)) return;
    const who = (ctx.user && ctx.user.name) || "";
    if (typeof setOrderField === "function") {
      setOrderField(order.id, { status: "packed", packedAt: new Date().toISOString(), packedBy: who });
    }
    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", entityId: order.id, action: "update",
        summary: `แพ็คสินค้าเสร็จ ${order.id} (${totals.got}/${totals.need} ชิ้น)`,
        count: totals.lineCount,
        changes: [{ label: "สถานะ", from: "กำลังจัดเตรียม", to: "พร้อมส่ง" }].concat(
          shortList.length ? [{ label: "ของขาด", to: shortList.length + " รายการ" }] : []
        ),
        note: shortList.length ? "ของขาด: " + shortList.map(k => k.split("|")[0]).join(", ") : ""
      });
    }
    if (typeof clearPackEntry === "function") clearPackEntry(order.id);
    ctx.pushToast(shortList.length
      ? `แพ็คเสร็จ ${order.id} — มีของขาด ${shortList.length} รายการ ตรวจนับด้วย`
      : `แพ็คเสร็จ ${order.id} · พร้อมส่ง`);
    ctx.back();
  };

  if (!order) {
    return (
      <>
        <div className="m-topbar">
          <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
          <div className="m-title-sub">แพ็คสินค้า</div>
        </div>
        <div className="m-content" style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่พบออร์เดอร์นี้</div>
      </>
    );
  }

  // Group the (already shelf-sorted) lines so one shelf is one stop on the walk.
  const groups = [];
  lines.forEach(l => {
    const last = groups[groups.length - 1];
    if (last && last.loc === l.loc) last.lines.push(l);
    else groups.push({ loc: l.loc, parts: l.parts, lines: [l] });
  });

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub mono">{order.id}</div>
        <button className={"m-action" + (camOpen ? " accent" : "")} onClick={() => setCamOpen(v => !v)} title="สแกนเพื่อหยิบ"><Icons.Camera size={15}/></button>
      </div>
      <div className="m-content">
        <div className="m-card" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.customer || "—"}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {order.channel || "—"}{order.date ? " · " + order.date : ""}{order.ts ? " " + order.ts : ""}
              </div>
            </div>
            <span className="tnum" style={{ fontSize: 20, fontWeight: 700, flexShrink: 0, color: totals.complete ? "var(--success)" : "var(--accent)" }}>
              {totals.got}/{totals.need}
            </span>
          </div>
          <div className="prog" style={{ marginTop: 10 }}><span style={{ width: totals.pct + "%" }}/></div>
          <div className="row" style={{ gap: 10, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
            <span>{totals.lineDone}/{totals.lineCount} รายการ</span>
            <span>·</span>
            <span>{groups.length} ตำแหน่ง</span>
            {totals.shortLines > 0 && <><span>·</span><span style={{ color: "var(--warning)" }}>ของขาด {totals.shortLines}</span></>}
          </div>
          {order.note && <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--warning-soft)", color: "var(--warning)", borderRadius: 8, fontSize: 11.5 }}>โน้ต: {order.note}</div>}
          <MPackOrderNote orderId={order.id} user={ctx.user}/>
          {typeof PackAddedBanner === "function" && <PackAddedBanner order={order}/>}
          {typeof canDo === "function" && canDo("sell") && order.status === "picking" && (
            <button className="btn" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={() => ctx.push("pack-add", { id: order.id })}>
              <Icons.Plus size={14}/> เพิ่มรายการ
            </button>
          )}
        </div>

        {camOpen && <CameraScanner continuous onScan={onScan} onClose={() => setCamOpen(false)}/>}

        {lines.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12.5, background: "var(--surface-2)", borderRadius: 10, lineHeight: 1.7 }}>
            ออร์เดอร์นี้ไม่มีรายการสินค้าที่ระบุ SKU<br/>
            <span style={{ fontSize: 11 }}>(ออร์เดอร์เก่าหรือฉลากที่พิมพ์ชื่อสินค้าเอง)</span>
          </div>
        )}

        {groups.map((g, gi) => (
          <div key={g.loc + gi} style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 8, padding: "0 2px 6px", justifyContent: "space-between" }}>
              <MPackLoc parts={g.parts} loc={g.loc}/>
              <span style={{ fontSize: 10.5, color: "var(--muted)", flexShrink: 0 }}>{g.lines.length} รายการ</span>
            </div>
            <MPackLocNote loc={g.loc} user={ctx.user}/>
            <div className="m-list">
              {g.lines.map(l => (
                <MPackLine key={l.key} line={l}
                  picked={entry.done[l.key] || 0}
                  short={entry.short[l.key] || ""}
                  onSet={v => setPicked(l, v)}
                  onShort={() => setShortLine(l)}/>
              ))}
            </div>
          </div>
        ))}

        {/* ใบปะหน้า + ที่อยู่ + ไฟล์แนบ + (owner) ยกเลิก — AFTER the pick list:
            the packer picks first, then prints the label right above แพ็คเสร็จ. */}
        <div className="m-section-label" style={{ padding: "18px 4px 0" }}>ใบปะหน้าและที่อยู่</div>
        {typeof PackShipDocs === "function" && <PackShipDocs order={order} lines={lines} pushToast={ctx.pushToast} mobile onCancelled={ctx.back}/>}

        {lines.length > 0 && (
          <button className={"m-btn-big " + (totals.complete ? "success" : "outline")} style={{ marginTop: 16 }} onClick={finish}>
            <Icons.Check size={18}/> {totals.complete ? "แพ็คเสร็จ — พร้อมส่ง" : `แพ็คเสร็จทั้งที่ยังขาด (${totals.remaining} ชิ้น)`}
          </button>
        )}
      </div>

      {shortLine && (
        <MPackShortSheet line={shortLine} picked={entry.done[shortLine.key] || 0}
          pushToast={ctx.pushToast}
          onClose={() => setShortLine(null)}
          onResolve={out => resolveShort(shortLine, out)}/>
      )}
    </>
  );
}

/* Wave (batch) picking: several orders merged into ONE shelf-sorted walk, then a
   sort stage that splits the pile into parcels.

   Stage 1 "pick" ticks the MERGED line (sku, shelf) across the whole wave.
   Stage 2 "sort" is a per-ORDER checklist — the tick that matters there is "this
   parcel is complete", not another per-piece count, so it is stored in the same
   `done` map under a "sort:<orderId>" key. Those keys can never collide with a
   line key ("sku|loc") and packLineTotals only ever looks up keys it was given,
   so the extra entries are inert. Finishing marks ONLY the ticked orders packed;
   anything untouched drops back into the queue rather than being quietly shipped. */
function MPackWave({ ctx }) {
  const batchId = (ctx.route.params && ctx.route.params.batchId) || "";
  const [tick, setTick] = useStateM(0);
  const [entry, setEntry] = useStateM(() => (typeof packEntry === "function") ? packEntry(batchId) : { done: {}, short: {}, orderIds: [], stage: "pick" });
  const [camOpen, setCamOpen] = useStateM(false);
  const [shortLine, setShortLine] = useStateM(null);
  const [expanded, setExpanded] = useStateM({});

  useEffectM(() => {
    const refresh = () => { setTick(t => t + 1); setEntry(packEntry(batchId)); };
    window.addEventListener("ims-pack-change", refresh);
    window.addEventListener("ims-orders-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    return () => {
      window.removeEventListener("ims-pack-change", refresh);
      window.removeEventListener("ims-orders-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
    };
  }, [batchId]);
  useEffectM(() => () => setCamOpen(false), []);

  const stage = entry.stage === "sort" ? "sort" : "pick";

  /* Only orders still waiting to be packed belong in the wave — another device may
     have finished one while this walk was in progress. `dropped` tells the picker
     instead of silently shrinking the list under them. */
  const orders = useMemoM(() => {
    const all = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
    const ids = entry.orderIds || [];
    return ids.map(id => (all || []).find(o => o.id === id)).filter(o => o && o.status === "picking");
  }, [entry.orderIds, tick]);
  const dropped = (entry.orderIds || []).length - orders.length;

  const lines = useMemoM(() => (typeof packLinesForOrders === "function") ? packLinesForOrders(orders) : [], [orders, tick]);
  const totals = useMemoM(() => packLineTotals(lines, entry), [lines, entry]);

  const write = (done, short, nextStage) => {
    const next = {
      done: done || entry.done,
      short: short || entry.short,
      by: entry.by || (ctx.user && ctx.user.name) || "",
      startedAt: entry.startedAt || new Date().toISOString(),
      orderIds: entry.orderIds || [],
      stage: nextStage || stage
    };
    setEntry(next);
    savePackEntry(batchId, next);
  };
  const setPicked = (line, v) => {
    const done = { ...entry.done };
    const n = Math.max(0, Math.min(line.qty, Math.round(Number(v) || 0)));
    if (n) done[line.key] = n; else delete done[line.key];
    const short = { ...entry.short };
    if (n >= line.qty && short[line.key]) delete short[line.key];
    write(done, short);
  };
  const resolveShort = (line, out) => {
    const done = { ...entry.done };
    const short = { ...entry.short };
    const n = Math.max(0, Math.min(line.qty, Math.round(Number(out.picked) || 0)));
    if (n) done[line.key] = n; else delete done[line.key];
    if (out.short) short[line.key] = out.short; else delete short[line.key];
    write(done, short);
  };
  const toggleSorted = (orderId) => {
    const done = { ...entry.done };
    const k = "sort:" + orderId;
    if (done[k]) delete done[k]; else done[k] = 1;
    write(done, null);
  };

  const onScan = (code) => {
    const c = String(code || "").trim();
    if (!c) return;
    const hits = lines.filter(l => l.sku.toLowerCase() === c.toLowerCase());
    if (!hits.length) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      ctx.pushToast("ไม่อยู่ในรอบหยิบนี้: " + c);
      return;
    }
    const target = hits.find(l => (entry.done[l.key] || 0) < l.qty) || hits[0];
    const cur = entry.done[target.key] || 0;
    if (cur >= target.qty) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      ctx.pushToast(`${target.sku} หยิบครบแล้ว (${target.qty})`);
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    setPicked(target, cur + 1);
    ctx.pushToast(`${target.sku} · ${cur + 1}/${target.qty} · ${(target.parts && target.parts.pos) || target.loc || "—"}`);
  };

  const sortedIds = orders.filter(o => entry.done["sort:" + o.id]).map(o => o.id);

  const closeWave = () => {
    if (!sortedIds.length) { ctx.pushToast("ยังไม่มีออร์เดอร์ที่แยกครบ"); return; }
    const rest = orders.length - sortedIds.length;
    if (!confirm(`ปิดงานหยิบรวมนี้?\nพร้อมส่ง ${sortedIds.length} ออร์เดอร์${rest ? `\nอีก ${rest} ออร์เดอร์จะกลับไปรอแพ็ค` : ""}`)) return;
    const who = (ctx.user && ctx.user.name) || "";
    const at = new Date().toISOString();
    sortedIds.forEach(id => {
      if (typeof setOrderField === "function") setOrderField(id, { status: "packed", packedAt: at, packedBy: who });
    });
    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", action: "bulk-update",
        summary: `แพ็คสินค้าแบบหยิบรวม — พร้อมส่ง ${sortedIds.length} ออร์เดอร์ (${totals.got} ชิ้น)`,
        count: sortedIds.length,
        changes: [{ label: "สถานะ", from: "กำลังจัดเตรียม", to: "พร้อมส่ง" }],
        note: "ออร์เดอร์: " + sortedIds.join(", ")
      });
    }
    if (typeof clearPackEntry === "function") clearPackEntry(batchId);
    ctx.pushToast(`ปิดงานแล้ว — พร้อมส่ง ${sortedIds.length} ออร์เดอร์`);
    ctx.back();
  };

  const abandon = () => {
    if (!confirm("ยกเลิกรอบหยิบรวมนี้?\nออร์เดอร์ทั้งหมดจะกลับไปรอแพ็ค (ที่ติ๊กไว้จะหาย)")) return;
    if (typeof clearPackEntry === "function") clearPackEntry(batchId);
    ctx.pushToast("ยกเลิกรอบหยิบรวมแล้ว");
    ctx.back();
  };

  if (!entry.orderIds || !entry.orderIds.length) {
    return (
      <>
        <div className="m-topbar">
          <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
          <div className="m-title-sub">หยิบรวม</div>
        </div>
        <div className="m-content" style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่พบรอบหยิบรวมนี้ (อาจถูกปิดไปแล้ว)</div>
      </>
    );
  }

  const groups = [];
  lines.forEach(l => {
    const last = groups[groups.length - 1];
    if (last && last.loc === l.loc) last.lines.push(l);
    else groups.push({ loc: l.loc, parts: l.parts, lines: [l] });
  });

  return (
    <>
      <div className="m-topbar">
        <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
        <div className="m-title-sub">หยิบรวม {orders.length} ออร์เดอร์</div>
        {stage === "pick" && <button className={"m-action" + (camOpen ? " accent" : "")} onClick={() => setCamOpen(v => !v)} title="สแกนเพื่อหยิบ"><Icons.Camera size={15}/></button>}
        <button className="m-action" onClick={abandon} title="ยกเลิกรอบนี้"><Icons.Trash size={14}/></button>
      </div>
      <div className="m-content">
        {/* Stage indicator */}
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          {[{ id: "pick", label: "1 · เดินหยิบ" }, { id: "sort", label: "2 · แยกลงออร์เดอร์" }].map(s => (
            <div key={s.id} style={{ flex: 1, padding: "8px 10px", borderRadius: 10, textAlign: "center", fontSize: 11.5, fontWeight: 600,
              background: stage === s.id ? "var(--accent)" : "var(--surface-2)",
              color: stage === s.id ? "#fff" : "var(--muted)",
              border: "1px solid " + (stage === s.id ? "var(--accent)" : "var(--border)") }}>
              {s.label}
            </div>
          ))}
        </div>

        {dropped > 0 && (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 11.5, marginBottom: 10 }}>
            {dropped} ออร์เดอร์ในรอบนี้ถูกแพ็คจากเครื่องอื่นแล้ว — ตัดออกจากรายการให้แล้ว
          </div>
        )}

        {stage === "pick" && (
          <>
            <div className="m-card" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>หยิบแล้ว</span>
                <span className="tnum" style={{ fontSize: 20, fontWeight: 700, color: totals.complete ? "var(--success)" : "var(--accent)" }}>{totals.got}/{totals.need}</span>
              </div>
              <div className="prog" style={{ marginTop: 10 }}><span style={{ width: totals.pct + "%" }}/></div>
              <div className="row" style={{ gap: 10, marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
                <span>{groups.length} ตำแหน่ง</span><span>·</span><span>{totals.lineCount} รายการ</span>
                {totals.shortLines > 0 && <><span>·</span><span style={{ color: "var(--warning)" }}>ของขาด {totals.shortLines}</span></>}
              </div>
            </div>

            {camOpen && <CameraScanner continuous onScan={onScan} onClose={() => setCamOpen(false)}/>}

            {groups.map((g, gi) => (
              <div key={g.loc + gi} style={{ marginTop: 12 }}>
                <div className="row" style={{ gap: 8, padding: "0 2px 6px", justifyContent: "space-between" }}>
                  <MPackLoc parts={g.parts} loc={g.loc}/>
                  <span style={{ fontSize: 10.5, color: "var(--muted)", flexShrink: 0 }}>{g.lines.length} รายการ</span>
                </div>
                <MPackLocNote loc={g.loc} user={ctx.user}/>
                <div className="m-list">
                  {g.lines.map(l => (
                    <MPackLine key={l.key} line={l}
                      picked={entry.done[l.key] || 0}
                      short={entry.short[l.key] || ""}
                      onSet={v => setPicked(l, v)}
                      onShort={() => setShortLine(l)}
                      sub={
                        <div style={{ marginTop: 8 }}>
                          <button onClick={() => setExpanded(p => { const n = { ...p }; if (n[l.key]) delete n[l.key]; else n[l.key] = true; return n; })}
                            style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontSize: 11, cursor: "pointer" }}>
                            {expanded[l.key] ? "ซ่อน" : "ดู"} {l.per.length} ออร์เดอร์ที่ใช้ชิ้นนี้
                          </button>
                          {expanded[l.key] && (
                            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                              {l.per.map(pr => {
                                const o = orders.find(x => x.id === pr.orderId);
                                return (
                                  <div key={pr.orderId} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 11, color: "var(--muted)" }}>
                                    <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.orderId}{o && o.customer ? " · " + o.customer : ""}</span>
                                    <span className="tnum" style={{ flexShrink: 0, fontWeight: 600 }}>×{pr.qty}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      }/>
                  ))}
                </div>
              </div>
            ))}

            <button className={"m-btn-big " + (totals.complete ? "dark" : "outline")} style={{ marginTop: 16 }}
              onClick={() => {
                if (!totals.complete && !confirm(`ยังหยิบไม่ครบ (${totals.got}/${totals.need} ชิ้น)\nไปขั้นตอนแยกลงออร์เดอร์เลยไหม?`)) return;
                write(null, null, "sort");
              }}>
              แยกลงออร์เดอร์ <Icons.Chev size={16}/>
            </button>
          </>
        )}

        {stage === "sort" && (
          <>
            <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.6 }}>
              แบ่งของที่หยิบมาลงแต่ละออร์เดอร์ แล้วติ๊กออร์เดอร์ที่แยกครบ
              <br/><span style={{ fontSize: 11 }}>ออร์เดอร์ที่ไม่ติ๊กจะกลับไปรอแพ็ค</span>
            </div>

            {orders.map(o => {
              const oLines = (typeof packLinesForOrder === "function") ? packLinesForOrder(o) : [];
              const on = !!entry.done["sort:" + o.id];
              return (
                <div key={o.id} className="m-card" style={{ padding: 0, overflow: "hidden", marginBottom: 10, border: "1px solid " + (on ? "var(--success)" : "var(--border)") }}>
                  <button onClick={() => toggleSorted(o.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: on ? "var(--success-soft)" : "transparent", border: "none", cursor: "pointer", textAlign: "left", font: "inherit" }}>
                    <div style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 7, border: "1.5px solid " + (on ? "var(--success)" : "var(--border)"), background: on ? "var(--success)" : "transparent", color: "#fff", display: "grid", placeItems: "center" }}>
                      {on ? <Icons.Check size={14}/> : null}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{o.id}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {o.customer || "—"} · {oLines.reduce((s, l) => s + l.qty, 0)} ชิ้น
                      </div>
                      {typeof PackAddedBanner === "function" && <PackAddedBanner order={o} compact/>}
                    </div>
                  </button>
                  {typeof packOrderNote === "function" && (packOrderNote(o.id) || (typeof canEditPackLocNotes === "function" && canEditPackLocNotes())) && (
                    <div style={{ padding: "0 14px 10px" }}><MPackOrderNote orderId={o.id} user={ctx.user} compact/></div>
                  )}
                  {typeof PackLabelButton === "function" && (
                    <div style={{ padding: "0 14px 10px" }}><PackLabelButton order={o} lines={oLines} pushToast={ctx.pushToast}/></div>
                  )}
                  <div style={{ borderTop: "1px solid var(--border)" }}>
                    {oLines.map(l => (
                      <div key={l.key} className="row" style={{ gap: 10, padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                        <ProductImageThumb sku={l.sku} size={28} radius={6}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</div>
                          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{l.sku}</div>
                        </div>
                        <span className="tnum" style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>×{l.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <button className="m-btn-big outline" style={{ flex: 1, marginBottom: 0 }} onClick={() => write(null, null, "pick")}>
                <Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/> กลับไปหยิบ
              </button>
              <button className="m-btn-big success" style={{ flex: 1, marginBottom: 0 }} onClick={closeWave} disabled={!sortedIds.length}>
                <Icons.Check size={16}/> ปิดงาน ({sortedIds.length})
              </button>
            </div>
          </>
        )}
      </div>

      {shortLine && (
        <MPackShortSheet line={shortLine} picked={entry.done[shortLine.key] || 0}
          pushToast={ctx.pushToast}
          onClose={() => setShortLine(null)}
          onResolve={out => resolveShort(shortLine, out)}/>
      )}
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
  const [day, setDay] = useStateM(null);          // null = ล่าสุด (ทุกวัน)
  const [dayRows, setDayRows] = useStateM(null);
  const [busy, setBusy] = useStateM(false);

  const today = todayIso();
  const log = useMemoM(() => (typeof loadAuditLog === "function" ? loadAuditLog() : []), [logKey]);
  useEffectM(() => {
    const refresh = () => setLogKey(k => k + 1);
    window.addEventListener("ims-audit-change", refresh);
    return () => window.removeEventListener("ims-audit-change", refresh);
  }, []);
  useEffectM(() => { if (typeof refreshAuditTotal === "function") refreshAuditTotal(); }, []);

  // A picked day is one DB query — no paging back through the days between.
  useEffectM(() => {
    if (!day) { setDayRows(null); return; }
    let alive = true;
    setBusy(true);
    Promise.resolve(loadAuditDay(day))
      .then(rows => { if (alive) setDayRows(rows || []); })
      .catch(() => { if (alive) setDayRows([]); })
      .then(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [day]);

  const jumpDay = (delta) => {
    const next = shiftDayKey(day || today, delta);
    if (next > today) return;
    setDay(next);
  };

  const loadMore = async () => {
    setBusy(true);
    const got = await loadMoreAuditLog();
    setBusy(false);
    if (!got) ctx.pushToast("โหลดครบทุกรายการแล้ว");
  };

  const entts = ["all", "inbound", "product", "bundle", "order", "user"];
  const entLabel = { all: "ทั้งหมด", inbound: "รับเข้า", product: "สินค้า", bundle: "ชุดสินค้า", order: "ออร์เดอร์", user: "ผู้ใช้" };

  /* Return a handler that opens the record an entry changed, or null when there
     is nothing to open (no entityId, bulk entry, deleted record, or an entity
     with no mobile detail screen) — the row then stays inert instead of
     pretending to be tappable. */
  const openTarget = (e) => {
    const id = e && e.entityId;
    if (!id) return null;
    if (e.entity === "product") {
      return PRODUCTS.some(p => p.sku === id) ? (() => ctx.push("product", { sku: id })) : null;
    }
    if (e.entity === "order") {
      const orders = (typeof buildOrders === "function") ? buildOrders() : [];
      const hit = orders.find(o => o.id === id);
      return hit ? (() => ctx.push("track-edit", hit)) : null;
    }
    return null;
  };

  const source = day ? (dayRows || []) : log;
  const filtered = source.filter(e => {
    // "รับเข้า" = the batch close AND the per-product receive entries.
    if (filter === "inbound") { if (e.entity !== "inbound" && e.action !== "receive") return false; }
    else if (filter !== "all" && e.entity !== filter) return false;
    if (q) {
      const ql = q.toLowerCase();
      const hay = ((e.summary || "") + " " + (e.entityId || "") + " " + (e.user?.name || "") + " " + (e.note || "")).toLowerCase();
      if (!hay.includes(ql)) return false;
    }
    return true;
  });
  const dayGroups = groupAuditByDay(filtered);

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
    window._AUDIT_END = true;
    window._AUDIT_TOTAL = 0;
    setDay(null); setDayRows(null);
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
        <div className="m-chips-scroll" style={{ marginBottom: 10 }}>
          {entts.map(e => (
            <button key={e} className={"m-chip" + (filter === e ? " on" : "")} onClick={() => setFilter(e)}>{entLabel[e]}</button>
          ))}
        </div>

        {/* Day picker — ◀ ▶ step one day, the date box jumps to any past day
            (fetched from the DB, so it isn't limited to what's cached). */}
        <div className="row" style={{ gap: 6, marginBottom: 10, alignItems: "center" }}>
          <button className="m-chip" onClick={() => jumpDay(-1)} style={{ padding: "0 10px" }}>
            <Icons.Chev size={12} style={{ transform: "rotate(180deg)" }}/>
          </button>
          <input className="m-input" type="date" value={day || ""} max={today}
            onChange={e => setDay(e.target.value || null)}
            style={{ flex: 1, minWidth: 0, height: 34, fontSize: 13 }}/>
          <button className="m-chip" onClick={() => jumpDay(1)} disabled={!day || day >= today} style={{ padding: "0 10px", opacity: (!day || day >= today) ? 0.4 : 1 }}>
            <Icons.Chev size={12}/>
          </button>
          {day && <button className="m-chip on" onClick={() => setDay(null)}>ล่าสุด</button>}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", padding: "0 2px 8px" }}>
          {busy ? "กำลังโหลด…"
            : day ? `${thaiDayLabel(day)} · ${filtered.length} รายการ`
            : `แสดง ${filtered.length} รายการ${auditTotal(log.length) != null ? " จากทั้งหมด " + auditTotal(log.length) : ""}`}
        </div>

        {dayGroups.map(([dayKey, entries]) => (
          <div key={dayKey}>
            <div className="row" style={{ gap: 8, alignItems: "center", padding: "8px 2px 6px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-2)" }}>{thaiDayLabel(dayKey)}</span>
              <span style={{ flex: 1, height: 1, background: "var(--border)" }}/>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{entries.length} รายการ</span>
            </div>
            <div className="m-list">
              {entries.map((e, i) => {
                // Entries that name a record they changed become tappable and open it.
                const open = openTarget(e);
                const Row = open ? "button" : "div";
                return (
                  <Row key={e.id || (dayKey + i)} className="m-row"
                    onClick={open || undefined}
                    style={open
                      ? { alignItems: "flex-start", cursor: "pointer", width: "100%", textAlign: "left", font: "inherit", fontFamily: "inherit" }
                      : { cursor: "default", alignItems: "flex-start" }}>
                    <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--fg-2)" }}><Icons.History size={15}/></div>
                    <div className="m-row-main">
                      <div className="m-row-title" style={{ fontSize: 13, whiteSpace: "normal" }}>{e.summary || (e.entityId ? "แก้ไข " + e.entityId : "เปลี่ยนแปลง")}</div>
                      {e.changes && e.changes.length > 0 && (
                        <div className="m-row-sub" style={{ whiteSpace: "normal" }}>{e.changes.map(c => c.label + (c.to ? `: ${c.to}` : "")).join(" · ")}</div>
                      )}
                      {e.note && <div className="m-row-sub" style={{ whiteSpace: "normal", fontStyle: "italic" }}>{e.note}</div>}
                      {/* The day header above carries the date, so today's rows
                          show the friendlier relative time and older ones the clock. */}
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                        {dayKey === today ? mFormatTime(e.ts) : bangkokTimeOf(e.ts)} · {e.user?.name || "ระบบ"}
                      </div>
                    </div>
                    {open && <Icons.Chev size={14} style={{ color: "var(--muted)", flexShrink: 0, alignSelf: "center" }}/>}
                  </Row>
                );
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            <Icons.History size={22} style={{ opacity: 0.4, marginBottom: 6 }}/>
            <div>{busy ? "กำลังโหลด…" : day ? `ไม่มีกิจกรรมใน${thaiDayLabel(day)}` : "ยังไม่มีประวัติการแก้ไข"}</div>
          </div>
        )}

        {/* Older rows stay in the DB until asked for. */}
        {!day && auditHasMore() && (
          <button className="m-btn-big outline" style={{ marginTop: 12 }} onClick={loadMore} disabled={busy}>
            {busy ? "กำลังโหลด…" : "โหลดประวัติเก่ากว่านี้"}
          </button>
        )}
      </div>
    </>
  );
}

/* =============== USERS & PERMISSIONS (mobile) =============== */

/* Mobile twin of the desktop RolePermissions card (auth.jsx). Same data path —
   loadRolePerms/saveRolePerms in data.jsx — so an edit made on either surface
   syncs to the other through app_state "role_perms". */
function MRolePerms({ ctx, onClose }) {
  const [role, setRole] = useStateM("staff");
  const [draft, setDraft] = useStateM(() => {
    const p = typeof loadRolePerms === "function" ? loadRolePerms() : {};
    return { nav: { ...(p.nav || {}) }, caps: { ...(p.caps || {}) } };
  });
  const [dirty, setDirty] = useStateM(false);
  const [saving, setSaving] = useStateM(false);

  const roleMeta = ROLES.find(r => r.id === role) || ROLES[0];
  const locked = role === "admin";
  const navCatalog = [
    ...(typeof ALL_NAV !== "undefined" ? ALL_NAV : []),
    ...(typeof MOBILE_ONLY_NAV !== "undefined" ? MOBILE_ONLY_NAV : [])
  ];

  const capOn = (id) => {
    const ov = draft.caps[role];
    if (ov && typeof ov[id] === "boolean") return ov[id];
    return !!((DEFAULT_ROLE_CAPS[role] || {})[id]);
  };
  const navList = () => Array.isArray(draft.nav[role]) ? draft.nav[role] : (ROLE_NAV[role] || []);

  const toggleCap = (id) => {
    if (locked || (typeof capServerLocked === "function" && capServerLocked(id, role))) return;
    const next = !capOn(id);
    setDraft(d => ({ ...d, caps: { ...d.caps, [role]: { ...(d.caps[role] || {}), [id]: next } } }));
    setDirty(true);
  };
  const toggleNav = (id) => {
    if (locked) return;
    const cur = navList();
    const next = cur.indexOf(id) === -1 ? [...cur, id] : cur.filter(x => x !== id);
    setDraft(d => ({ ...d, nav: { ...d.nav, [role]: next } }));
    setDirty(true);
  };
  const save = async () => {
    if (typeof saveRolePerms !== "function" || saving) return;
    setSaving(true);
    const res = await saveRolePerms(draft);
    setSaving(false);
    // Failed write → saveRolePerms already rolled the local copy back; keep the
    // sheet open with the edits intact rather than claiming success.
    if (res && res.ok === false) {
      ctx.pushToast("บันทึกไม่สำเร็จ: " + (res.error || "ไม่ทราบสาเหตุ"));
      return;
    }
    setDirty(false);
    ctx.pushToast(res && res.offline ? "บันทึกในเครื่องแล้ว (ยังไม่ซิงค์)" : "บันทึกสิทธิ์ตามตำแหน่งแล้ว");
    if (typeof recordChange === "function") {
      recordChange({ entity: "settings", action: "update", summary: `แก้ไขสิทธิ์ของตำแหน่ง ${roleMeta.label} (มือถือ)` });
    }
    onClose();
  };

  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ maxHeight: "90%" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head">
          <div>
            <h3>ปรับสิทธิ์ตามตำแหน่ง</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>มีผลกับทุกคนในตำแหน่งนั้น ทั้งมือถือและเดสก์ท็อป</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="m-chips-scroll">
            {ROLES.map(r => (
              <button key={r.id} className={"m-chip" + (role === r.id ? " on" : "")} onClick={() => setRole(r.id)}>{r.label}</button>
            ))}
          </div>

          {locked && (
            <div style={{ padding: "9px 11px", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 10, fontSize: 11.5, lineHeight: 1.5 }}>
              ผู้ดูแลระบบมีสิทธิ์ทั้งหมดเสมอ และแก้ไขไม่ได้
            </div>
          )}

          <div className="m-section-label" style={{ padding: "2px 2px" }}>ทำอะไรได้บ้าง</div>
          {CAPS.map(c => {
            const srvLocked = typeof capServerLocked === "function" && capServerLocked(c.id, role);
            const on = capOn(c.id) && !srvLocked;
            const disabled = locked || srvLocked;
            return (
              <button key={c.id} onClick={() => toggleCap(c.id)} disabled={disabled}
                style={{ display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", width: "100%",
                  padding: "11px 12px", borderRadius: 12, fontFamily: "inherit", color: "var(--fg)",
                  background: on ? "var(--accent-soft)" : "var(--surface-2)",
                  border: "1px solid " + (on ? "var(--accent-ring)" : "var(--border)"),
                  opacity: disabled ? 0.6 : 1 }}>
                <span className={"check" + (on ? " on" : "")} style={{ flexShrink: 0, marginTop: 1 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45, marginTop: 2 }}>{c.desc}</div>
                  {srvLocked && <div style={{ fontSize: 10.5, color: "var(--warning)", marginTop: 4 }}>ฐานข้อมูลไม่อนุญาตให้ตำแหน่งนี้ (RLS)</div>}
                </div>
              </button>
            );
          })}

          <div className="m-section-label" style={{ padding: "6px 2px 2px" }}>เข้าหน้าไหนได้บ้าง · {navList().length} หน้า</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {navCatalog.map(n => {
              const on = navList().indexOf(n.id) !== -1;
              return (
                <button key={n.id} onClick={() => toggleNav(n.id)} disabled={locked}
                  style={{ display: "flex", gap: 6, alignItems: "center", padding: "7px 11px", borderRadius: 999, fontSize: 12, fontFamily: "inherit",
                    background: on ? "var(--accent-soft)" : "var(--surface-2)",
                    border: "1px solid " + (on ? "var(--accent-ring)" : "var(--border)"),
                    color: on ? "var(--accent)" : "var(--muted)", opacity: locked ? 0.6 : 1 }}>
                  <span className={"check" + (on ? " on" : "")} style={{ flexShrink: 0 }}/>
                  {n.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="m-sheet-foot" style={{ display: "flex", gap: 8 }}>
          <button className="m-btn-big outline" style={{ flex: 1 }} onClick={onClose}>ยกเลิก</button>
          <button className="m-btn-big" style={{ flex: 1, opacity: (dirty && !saving) ? 1 : 0.5 }} disabled={!dirty || saving} onClick={save}>
            <Icons.Check size={15}/> {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </>
  );
}

function MUsers({ ctx }) {
  // Real users come from Supabase Auth via the admin-only manage-users Edge Function
  // (same source as the desktop "ผู้ใช้งานและสิทธิ์" page) — no more localStorage demo data.
  const [users, setUsers] = useStateM([]);
  const [loading, setLoading] = useStateM(true);
  const [loadError, setLoadError] = useStateM("");
  const [form, setForm] = useStateM(null);  // null=closed, false=invite, obj=edit
  const [busyId, setBusyId] = useStateM(null);
  const [schedOpen, setSchedOpen] = useStateM(false);   // shared schedule editor sheet
  const [permOpen, setPermOpen] = useStateM(false);     // per-role permission editor sheet
  const [codesOpen, setCodesOpen] = useStateM(false);   // invite-code sheet
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

        {isAdmin && typeof InviteCodesPanel === "function" && (
          <button className="m-row" style={{ cursor: "pointer", width: "100%", textAlign: "left", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 4 }} onClick={() => setCodesOpen(true)}>
            <div className="m-row-thumb" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icons.Plus size={16}/></div>
            <div className="m-row-main">
              <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>รหัสเชิญพนักงานใหม่</div>
              <div className="m-row-sub">สร้างรหัสให้พนักงานสมัครบัญชีของตัวเอง</div>
            </div>
            <Icons.Chev size={16} style={{ color: "var(--muted)", flexShrink: 0 }}/>
          </button>
        )}

        {isAdmin && (
          <button className="m-row" style={{ cursor: "pointer", width: "100%", textAlign: "left", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 4 }} onClick={() => setPermOpen(true)}>
            <div className="m-row-thumb" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icons.Lock size={16}/></div>
            <div className="m-row-main">
              <div className="m-row-title" style={{ fontSize: 13, fontWeight: 500 }}>ปรับสิทธิ์ตามตำแหน่ง</div>
              <div className="m-row-sub">กำหนดว่าตำแหน่งไหนเห็นหน้าใด และทำอะไรได้บ้าง</div>
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

      {permOpen && <MRolePerms ctx={ctx} onClose={() => setPermOpen(false)}/>}
      {codesOpen && (
        <>
          <div className="m-sheet-backdrop" onClick={() => setCodesOpen(false)}/>
          <div className="m-sheet" style={{ maxHeight: "90%" }}>
            <div className="m-sheet-grabber"/>
            <div className="m-sheet-head">
              <div>
                <h3>รหัสเชิญพนักงานใหม่</h3>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>ใช้ได้ 1 คนต่อรหัส — พนักงานตั้งอีเมลและรหัสผ่านเอง</div>
              </div>
              <button className="m-action" onClick={() => setCodesOpen(false)}><Icons.X size={14}/></button>
            </div>
            <div className="m-sheet-body">
              <InviteCodesPanel pushToast={ctx.pushToast}/>
            </div>
          </div>
        </>
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
        {/* current can be undefined (sku deleted mid-session, catalog not yet
            hydrated) — guard like the desktop SkuPicker instead of crashing. */}
        <div className="m-row-thumb" style={{ fontSize: 10, fontWeight: 600 }}>{current ? current.sku.slice(-3) : "?"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {current ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.name}</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{current.sku} · {current.cat}</div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>เลือกสินค้า…</div>
          )}
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
  const bulkDelete = async () => { if (!confirm(`ลบ ${selCount} ออร์เดอร์ที่เลือก?`)) return; let res = null; if (typeof deleteOrdersFromDb === "function") { res = await deleteOrdersFromDb(selIds); if (res.blocked) { ctx.pushToast("ลบไม่ได้ — เฉพาะแอดมิน/ผู้จัดการเท่านั้น"); return; } } selIds.forEach(id => setOrderField(id, { deleted: true })); ctx.pushToast((res && res.ok === false && res.failedIds && res.failedIds.length) ? `ลบแล้ว — ${res.failedIds.length} รายการจะลบให้เสร็จเมื่อออนไลน์` : `ลบ ${selCount} ออร์เดอร์`); clear(); };

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
                {o.carrier ? <MarkTile m={carrierMark(o.carrier)} size={36} title={o.carrier}/> : (
                  <div className="m-row-thumb" style={{ background: "var(--surface-2)", color: "var(--fg-2)" }}><Icons.Truck size={16}/></div>
                )}
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
          {canDeleteData() && <button className="m-action" style={{ background: "rgba(255,90,90,0.3)", color: "white", width: 36, height: 36 }} onClick={bulkDelete}><Icons.Trash size={14}/></button>}
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
                  <CarrierMark carrier={c.name} size={16}/>
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
              <CarrierMark carrier={c.name} size={22}/>
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

  const dateForUrl = dateMode === "today" ? (typeof todayIso === "function" ? todayIso() : TODAY_ISO) : dateMode === "custom" ? customDate : null;
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
