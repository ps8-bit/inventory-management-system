/* Main app: AuthGate + sidebar + routing + tweaks + layout customization */

const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp, useMemo: useMemoApp } = React;

const ALL_NAV = [
  { id: "dashboard", label: "หน้าหลัก",       icon: Icons.Dash,    group: "main" },
  { id: "inbound",   label: "รับเข้าสินค้า",   icon: Icons.In,      group: "ops"   },
  { id: "outbound",  label: "จัดส่งสินค้า",    icon: Icons.Out,     group: "ops"   },
  { id: "inventory", label: "สินค้าคงคลัง",    icon: Icons.Box,     group: "stock" },
  { id: "stocktake", label: "ตรวจนับสต็อก",    icon: Icons.Scan,    group: "stock" },
  { id: "locations", label: "ตำแหน่งจัดเก็บ",  icon: Icons.Map,     group: "stock" },
  { id: "import",    label: "นำเข้า SKU",      icon: Icons.Pkg,     group: "stock" },
  { id: "labels",    label: "พิมพ์ฉลาก",       icon: Icons.Tag,     group: "ship"  },
  { id: "tracking",  label: "ติดตามพัสดุ",       icon: Icons.Truck,   group: "ship" },
  { id: "analytics", label: "วิเคราะห์ยอดขาย",     icon: Icons.Dash,    group: "stock" },
  { id: "history",   label: "ประวัติการแก้ไข", icon: Icons.History, group: "system" },
  { id: "handheld",  label: "โหมดมือถือ",      icon: Icons.Phone,   group: "ship" },
  { id: "users",     label: "ผู้ใช้งานและสิทธิ์", icon: Icons.Help,  group: "system" },
  { id: "layout",    label: "ปรับแต่งเลย์เอาต์",  icon: Icons.Edit,  group: "system" },
  { id: "bundles",   label: "ชุดสินค้า",          icon: Icons.Bundle,  group: "stock" },
  { id: "settings",  label: "ตั้งค่าร้านค้า",    icon: Icons.Setting, group: "system" }
];

const DEFAULT_NAV_STATE = ALL_NAV.map(n => ({ id: n.id, visible: true }));

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable"
}/*EDITMODE-END*/;

const CRUMB_MAP = {
  dashboard: "หน้าหลัก",
  inbound: "รับเข้าสินค้า",
  outbound: "จัดส่งสินค้า",
  inventory: "สินค้าคงคลัง",
  stocktake: "ตรวจนับสต็อก",
  locations: "ตำแหน่งจัดเก็บ",
  import: "นำเข้า SKU จำนวนมาก",
  labels: "พิมพ์ฉลาก",
  tracking: "ติดตามพัสดุ",
  analytics: "วิเคราะห์ยอดขาย",
  history: "ประวัติการแก้ไข",
  handheld: "โหมดมือถือ",
  users: "ผู้ใช้งานและสิทธิ์",
  layout: "ปรับแต่งเลย์เอาต์",
  bundles: "ชุดสินค้า (Bundles)",
  settings: "ตั้งค่าร้านค้า"
};

/* ======== LIVE BADGE COUNTS ========
   Each badge reflects real data so it updates the moment anything changes.
   - inbound  : products at or below their reorder point (need restocking)
   - outbound : orders still needing action (picking or packed)
   - labels   : total labels waiting in the print queue               */
function computeBadges() {
  // --- inbound: low-stock / out-of-stock products ---
  const inbound = PRODUCTS.filter(p => p.qty <= p.reorder).length;

  // --- outbound: orders not yet shipped (prefer Supabase cache) ---
  const outbound = loadOrders().filter(o => o.status === "picking" || o.status === "packed").length;

  // --- labels: items in print queue (prefer Supabase cache) ---
  let labelsArr = window._DB_LABELS || SAMPLE_LABELS;
  try {
    if (!window._DB_LABELS) {
      const raw = localStorage.getItem("ims_labels");
      if (raw !== null) { const a = JSON.parse(raw); if (Array.isArray(a)) labelsArr = a; }
    }
  } catch (e) {}
  const labels = labelsArr.length;

  return {
    inbound:  inbound  > 0 ? inbound  : null,
    outbound: outbound > 0 ? outbound : null,
    labels:   labels   > 0 ? labels   : null,
  };
}

function useBadges() {
  const [b, setB] = useStateApp(computeBadges);
  useEffectApp(() => {
    const refresh = () => setB(computeBadges());
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-orders-change",   refresh);
    window.addEventListener("ims-labels-change",   refresh);
    return () => {
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-orders-change",   refresh);
      window.removeEventListener("ims-labels-change",   refresh);
    };
  }, []);
  return b;
}

/* ======== GLOBAL SEARCH OVERLAY ======== */
function SearchOverlay({ q, setQ, onClose, goTo }) {
  const inputRef = useRefApp(null);
  useEffectApp(() => { inputRef.current?.focus(); }, []);

  const results = useMemoApp(() => {
    const lq = q.trim().toLowerCase();
    if (!lq) return { products: [], orders: [] };
    return {
      products: PRODUCTS.filter(p =>
        p.sku.toLowerCase().includes(lq) ||
        p.name.toLowerCase().includes(lq) ||
        p.supplier.toLowerCase().includes(lq)
      ).slice(0, 6),
      orders: loadOrders().filter(o =>
        o.id.toLowerCase().includes(lq) ||
        (o.customer || "").toLowerCase().includes(lq) ||
        (o.channel || "").toLowerCase().includes(lq)
      ).slice(0, 4)
    };
  }, [q]);

  const hasResults = results.products.length > 0 || results.orders.length > 0;

  return (
    <>
      <div style={{ position:"fixed", inset:0, zIndex:200, background:"rgba(0,0,0,0.4)", backdropFilter:"blur(2px)" }} onClick={onClose}/>
      <div style={{ position:"fixed", top:72, left:"50%", transform:"translateX(-50%)", width:"100%", maxWidth:640, zIndex:201, padding:"0 16px" }}>
        <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:16, boxShadow:"var(--shadow-lg)", overflow:"hidden" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 18px", borderBottom:"1px solid var(--border)" }}>
            <Icons.Search size={16} style={{ color:"var(--muted)", flexShrink:0 }}/>
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="ค้นหา SKU, ชื่อสินค้า, เลขออร์เดอร์, ลูกค้า..."
              style={{ flex:1, border:"none", outline:"none", background:"transparent", fontSize:15, color:"var(--fg)", fontFamily:"inherit" }}
            />
            <span className="kbd" style={{ cursor:"pointer" }} onClick={onClose}>Esc</span>
          </div>

          {!q.trim() ? (
            <div style={{ padding:"28px 18px", color:"var(--muted)", fontSize:13, textAlign:"center" }}>
              พิมพ์เพื่อค้นหา SKU, ชื่อสินค้า, เลขออร์เดอร์ หรือชื่อลูกค้า
            </div>
          ) : !hasResults ? (
            <div style={{ padding:"28px 18px", color:"var(--muted)", fontSize:13, textAlign:"center" }}>
              ไม่พบผลลัพธ์สำหรับ "<strong>{q}</strong>"
            </div>
          ) : (
            <div style={{ maxHeight:420, overflowY:"auto" }}>
              {results.products.length > 0 && (<>
                <div style={{ padding:"8px 18px 4px", fontSize:11, fontWeight:600, color:"var(--muted)", letterSpacing:"0.06em", textTransform:"uppercase" }}>สินค้า</div>
                {results.products.map(p => {
                  const st = stockStatus(p);
                  return (
                    <div key={p.sku} className="search-hit" onClick={() => { goTo("inventory"); onClose(); }}>
                      <Icons.Box size={14} style={{ color:"var(--muted)", flexShrink:0 }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                        <div style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace" }}>{p.sku} · {p.supplier}</div>
                      </div>
                      <span className={"badge " + st.cls} style={{ fontSize:10, flexShrink:0 }}>{p.qty} ชิ้น</span>
                    </div>
                  );
                })}
              </>)}
              {results.orders.length > 0 && (<>
                <div style={{ padding:"8px 18px 4px", fontSize:11, fontWeight:600, color:"var(--muted)", letterSpacing:"0.06em", textTransform:"uppercase", marginTop:4 }}>ออร์เดอร์</div>
                {results.orders.map(o => {
                  const stCls = { picking:"badge-warning", packed:"badge-info", shipped:"badge-success", delivered:"badge-neutral" }[o.status] || "badge-neutral";
                  const stLab = { picking:"กำลังหยิบ", packed:"พร้อมส่ง", shipped:"ส่งแล้ว", delivered:"จัดส่งสำเร็จ" }[o.status] || o.status;
                  return (
                    <div key={o.id} className="search-hit" onClick={() => { goTo("outbound"); onClose(); }}>
                      <Icons.Truck size={14} style={{ color:"var(--muted)", flexShrink:0 }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>{o.customer}</div>
                        <div style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace" }}>{o.id} · {o.channel}</div>
                      </div>
                      <span className={"badge " + stCls} style={{ fontSize:10, flexShrink:0 }}>{stLab}</span>
                    </div>
                  );
                })}
              </>)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ======== NOTIFICATION POPOVER ======== */
function NotifPopover({ onClose, goTo }) {
  const outOfStock = PRODUCTS.filter(p => p.qty === 0);
  const lowStock   = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder);
  const pending    = loadOrders().filter(o => o.status === "picking" || o.status === "packed");
  const nothing    = outOfStock.length === 0 && lowStock.length === 0 && pending.length === 0;

  return (
    <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, width:320, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:14, boxShadow:"var(--shadow-lg)", zIndex:60, overflow:"hidden" }}>
      <div style={{ padding:"12px 16px 8px", fontSize:13, fontWeight:600, borderBottom:"1px solid var(--border)" }}>การแจ้งเตือน</div>

      {nothing && (
        <div style={{ padding:"24px 16px", textAlign:"center", color:"var(--muted)", fontSize:13 }}>✅ ไม่มีการแจ้งเตือนใหม่</div>
      )}

      {outOfStock.length > 0 && (
        <div style={{ padding:"8px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"var(--danger)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>
            หมดสต็อก ({outOfStock.length})
          </div>
          {outOfStock.slice(0, 4).map(p => (
            <div key={p.sku} className="notif-row" onClick={() => { goTo("inventory"); onClose(); }}>
              <span style={{ width:7, height:7, borderRadius:999, background:"var(--danger)", flexShrink:0 }}/>
              <span style={{ flex:1, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</span>
              <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace", flexShrink:0 }}>{p.sku}</span>
            </div>
          ))}
        </div>
      )}

      {lowStock.length > 0 && (
        <div style={{ padding:"8px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"var(--warning)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>
            ใกล้หมด ({lowStock.length})
          </div>
          {lowStock.slice(0, 5).map(p => (
            <div key={p.sku} className="notif-row" onClick={() => { goTo("inventory"); onClose(); }}>
              <span style={{ width:7, height:7, borderRadius:999, background:"var(--warning)", flexShrink:0 }}/>
              <span style={{ flex:1, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</span>
              <span style={{ fontSize:11, fontWeight:600, color:"var(--warning)", fontFamily:"IBM Plex Mono, monospace", flexShrink:0 }} className="tnum">{p.qty}</span>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ padding:"8px 16px 4px" }}>
          <div style={{ fontSize:11, fontWeight:700, color:"var(--info)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>
            ออร์เดอร์ค้างส่ง ({pending.length})
          </div>
          {pending.slice(0, 4).map(o => (
            <div key={o.id} className="notif-row" onClick={() => { goTo("outbound"); onClose(); }}>
              <span style={{ width:7, height:7, borderRadius:999, background:"var(--info)", flexShrink:0 }}/>
              <span style={{ flex:1, fontSize:12 }}>{o.customer}</span>
              <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace", flexShrink:0 }}>{o.id}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:"8px 16px 10px", borderTop:"1px solid var(--border)", display:"flex", justifyContent:"space-between", marginTop:4 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => { goTo("inventory"); onClose(); }}>ดูสินค้า →</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { goTo("outbound"); onClose(); }}>ดูออร์เดอร์ →</button>
      </div>
    </div>
  );
}

/* Map a Supabase Auth session to the app's user shape.
   Role + display name come from user_metadata (set when creating the user
   in the Supabase dashboard) with a fallback to the USERS constant so
   existing demo accounts still work during the transition. */
function mapSessionToUser(session) {
  const su   = session.user;
  const meta = su.user_metadata || {};
  const app  = su.app_metadata  || {};
  const email  = su.email || "";
  const found = USERS.find(u => u.email === email);
  const name   = meta.name   || found?.name   || (email ? email.split("@")[0] : "ผู้ใช้");
  // Authz role comes from app_metadata (tamper-proof, matches RLS). Fall back to
  // user_metadata/USERS only for accounts created before the app_metadata migration.
  const role   = app.role    || meta.role   || found?.role || "staff";
  const avatar = meta.avatar || found?.avatar || name.slice(0, 2);
  return { id: su.id, email, name, role, avatar, active: true };
}

/* ======== ROOT WITH AUTH GATE ======== */

/* Detect mobile/tablet via viewport width OR coarse pointer (real touch device).
   Tablets in landscape can have >1024px viewports but are still touch — pointer:coarse
   catches those, while max-width handles narrow desktop windows that the desktop
   layout (designed for 1280px+) would not fit. */
function useIsMobile() {
  const [mobile, setMobile] = useStateApp(() => {
    if (typeof window === "undefined") return false;
    const mq = window.matchMedia("(max-width: 1024px), (pointer: coarse)");
    return mq.matches;
  });
  useEffectApp(() => {
    const mq = window.matchMedia("(max-width: 1024px), (pointer: coarse)");
    const handler = (e) => setMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else mq.removeListener(handler);
    };
  }, []);
  return mobile;
}

/* ── Loading screen shown while dbInit() fetches data from Supabase ── */
function DBLoadingScreen() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh", gap: 16,
      background: "var(--bg, #f5f5f5)", color: "var(--fg, #111)"
    }}>
      <div style={{ fontSize: 40 }}>📦</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>คลังพร้อมส่ง</div>
      <div style={{ fontSize: 14, opacity: 0.6 }}>กำลังเชื่อมต่อฐานข้อมูล...</div>
    </div>
  );
}

function Root() {
  const [authReady, setAuthReady] = useStateApp(false);
  const [user,      setUser]      = useStateApp(null);
  const [dbReady,   setDbReady]   = useStateApp(false);
  // Set when the session is force-ended (account suspended / token revoked) so
  // the login screen can explain *why* the user was kicked out.
  const [lockoutMsg, setLockoutMsg] = useStateApp("");
  // Distinguishes a user-initiated logout from one Supabase forces on us when a
  // background token refresh is rejected (e.g. the account was just suspended).
  const intentionalLogoutRef = useRefApp(false);
  // Gates rendering of the app until the first access check (suspension +
  // working-hours window) has run — so a blocked user never even flashes the UI.
  const [gateReady, setGateReady] = useStateApp(false);
  // Set when the user arrived via an email link that requires setting a
  // password: "recovery" (forgot password) or "invite"/"signup" (new member).
  // Detected synchronously from the URL so we never flash the app first.
  const [authFlow,  setAuthFlow]  = useStateApp(() => {
    if (typeof window === "undefined") return null;
    const s = (window.location.hash || "") + " " + (window.location.search || "");
    if (/type=recovery/.test(s))         return "recovery";
    if (/type=(invite|signup)/.test(s))  return "invite";
    return null;
  });

  const [view, setView] = useStateApp(() => window.location.hash.replace("#", "") || "app");
  useEffectApp(() => {
    const h = () => setView(window.location.hash.replace("#", "") || "app");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  // Supabase Auth — restore session on load, listen for sign-in / sign-out
  useEffectApp(() => {
    authGetSession().then(({ data: { session } }) => {
      setUser(session ? mapSessionToUser(session) : null);
      setAuthReady(true);
    });
    const { data: { subscription } } = authOnChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setAuthFlow("recovery");
      // Supabase signed us out without the user asking → a forced end-of-session
      // (suspended account / revoked or expired refresh token). Explain why.
      if (event === "SIGNED_OUT" && !intentionalLogoutRef.current) {
        setLockoutMsg("เซสชันสิ้นสุดลง — บัญชีของคุณอาจถูกระงับการใช้งาน หากใช้งานต่อไม่ได้ กรุณาติดต่อผู้ดูแลระบบ");
      }
      intentionalLogoutRef.current = false;
      setUser(session ? mapSessionToUser(session) : null);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Enforce two things on an already-open session, then unlock the gate:
  //  1. Account suspension — a Supabase ban blocks new logins + token refresh,
  //     but the access token the tab already holds stays valid until it expires
  //     (~1h), so a suspended user could keep working. We re-validate against
  //     GoTrue (which rejects a banned user with 401/403).
  //  2. Working-hours window — restricted roles (e.g. staff/viewer) may only be
  //     in during the admin-configured schedule, checked against SERVER time so
  //     a changed device clock can't bypass it.
  // Runs immediately, every 60s, and whenever the tab regains focus — so a
  // mid-session window close or suspension kicks the user out within ~1 minute
  // (or instantly on focus), with a clear notice on the login screen.
  const userId = user ? user.id : null;
  const userRole = user ? user.role : null;
  useEffectApp(() => {
    if (!userId) { setGateReady(false); return; }
    let alive = true;
    const forceOut = async (msg) => {
      setLockoutMsg(msg);
      intentionalLogoutRef.current = true;   // keep SIGNED_OUT from overwriting msg
      try { await authSignOut(); } catch (e) {}
      if (alive) setUser(null);
    };
    const check = async () => {
      if (!alive || document.hidden) return;

      // (1) Working-hours window — only when the role is actually governed.
      const store = window._DB_STORE ? { ...DEFAULT_STORE, ...window._DB_STORE } : DEFAULT_STORE;
      const wh = store.workHours;
      const governed = wh && wh.enabled && Array.isArray(wh.roles) && wh.roles.includes(userRole)
                       && typeof workHoursStatus === "function";
      if (governed) {
        const nowMs = window.dbServerTimeMs ? await dbServerTimeMs() : Date.now();
        if (!alive) return;
        // Per-user resolver so a today-only "allow outside hours" pass lets the
        // user in even when the shared window is closed.
        const st = (typeof workHoursStatusForUser === "function")
          ? workHoursStatusForUser(store, userRole, userId, nowMs)
          : workHoursStatus(store, userRole, nowMs);
        if (st.restricted && !st.allowed) { await forceOut(workHoursMessage(st)); return; }
      }

      // (2) Suspension / token validity.
      if (window.authGetUser) {
        let res;
        try { res = await authGetUser(); } catch (e) { res = null; }  // network blip → keep session
        if (!alive) return;
        if (res) {
          const err = res.error;
          const noUser = res.data && !res.data.user;
          const status = err ? (err.status || 0) : 0;
          const banned = status === 403 || /ban|suspend|disabled|not allowed/i.test((err && err.message) || "");
          if (banned) {
            // A real admin suspension → end the session immediately.
            await forceOut("บัญชีของคุณถูกระงับการใช้งานโดยผู้ดูแลระบบ หากต้องการใช้งานต่อ กรุณาติดต่อผู้ดูแล");
            return;
          }
          if (status === 401 || noUser) {
            // 401 / no-user usually just means the access token expired (e.g. the
            // tab was asleep/backgrounded). Try to refresh BEFORE signing out, so
            // a still-valid session isn't needlessly bounced to the login screen.
            let recovered = false;
            if (window.authRefresh) {
              try { const r = await authRefresh(); recovered = !!(r && r.data && r.data.session && !r.error); }
              catch (e) { recovered = false; }
            }
            if (!alive) return;
            if (!recovered) { await forceOut("เซสชันหมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่"); return; }
            // Refreshed successfully — keep the user signed in.
          }
        }
      }

      // Only open the gate once the store (schedule) is actually loaded, so the
      // first authoritative work-hours decision uses the real config — not the
      // default (feature-off) store that exists before dbInit finishes.
      if (alive && dbReady) setGateReady(true);
    };
    const id = setInterval(check, 60000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    check();                                                      // run once on mount
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [userId, userRole, dbReady]);

  // Load DB data only after a user is authenticated (userId declared above)
  useEffectApp(() => {
    if (!authReady || !userId) return;
    setDbReady(false);
    if (window.dbInit) {
      window.dbInit().then(() => setDbReady(true)).catch(() => setDbReady(true));
    } else {
      setDbReady(true);
    }
  }, [authReady, userId]);

  const isMobile = useIsMobile();
  const logout   = async () => { intentionalLogoutRef.current = true; setLockoutMsg(""); await authSignOut(); };

  // Waiting for Supabase to confirm session status
  if (!authReady) return <DBLoadingScreen/>;

  // Arrived via a password-reset or invite email link → let the user set their
  // password. Takes priority over everything: the email token already created a
  // session, so without this we would drop them into the app with no setup UI.
  if (authFlow) return (
    <ResetPasswordScreen
      mode={authFlow}
      onDone={() => {
        // Clean the token out of the URL, then continue into the app
        // (the new password's session is already active).
        history.replaceState(null, "", window.location.pathname);
        setAuthFlow(null);
      }}
      onCancel={async () => {
        await authSignOut();
        history.replaceState(null, "", window.location.pathname);
        setAuthFlow(null);
      }}
    />
  );

  // Public customer-lookup route bypasses auth entirely
  if (view === "track" || view.startsWith("track/")) return <CustomerLookup/>;

  if (!user) return <LoginScreen notice={lockoutMsg} onDismissNotice={() => setLockoutMsg("")}/>;

  // Hold rendering until the first access check (suspension + working-hours)
  // passes, so a blocked user is bounced to the login notice without ever
  // seeing the app. If blocked, the effect signs them out → user becomes null.
  if (!gateReady) return <DBLoadingScreen/>;

  // Logged in but DB data not ready yet
  if (!dbReady) return <DBLoadingScreen/>;

  if (isMobile) return <MobileFullscreen user={user} onLogout={logout} onSwitchUser={() => {}}/>;
  return <App user={user} onLogout={logout} onSwitchUser={() => {}}/>;
}

/* ======== MOBILE FULLSCREEN WRAPPER ========
   The MobileApp component normally lives inside a 360×740 phone frame.
   When the user is actually on a phone/tablet we drop the frame and
   let it fill the viewport with safe-area insets. */
function MobileFullscreen({ user, onLogout, onSwitchUser }) {
  const [toast, setToast] = useStateApp(null);
  const pushToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  useEffectApp(() => { window.__currentUser = user; }, [user]);

  // Global toast bridge: lets non-React code (e.g. saveProductStore in data.jsx)
  // surface a message without a pushToast prop in scope.
  useEffectApp(() => {
    const h = (e) => pushToast(e.detail);
    window.addEventListener("ims-toast", h);
    return () => window.removeEventListener("ims-toast", h);
  }, []);

  // Lock body so the mobile shell controls scrolling
  useEffectApp(() => {
    const prev = {
      overflow: document.body.style.overflow,
      bg: document.body.style.background
    };
    document.body.style.overflow = "hidden";
    document.body.style.background = "var(--bg)";
    document.documentElement.setAttribute("data-mobile", "1");
    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.background = prev.bg;
      document.documentElement.removeAttribute("data-mobile");
    };
  }, []);

  return (
    <div
      className="mobile-fullscreen"
      data-screen-label="00 Mobile App"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)"
      }}>
      <MobileApp pushToast={pushToast} user={user} onLogout={onLogout} onSwitchUser={onSwitchUser} fullscreen/>
      {toast && <div className="toast"><Icons.Check size={14}/> {toast}</div>}
    </div>
  );
}

/* ======== APP ======== */

function App({ user, onLogout, onSwitchUser }) {
  const [page, setPage] = useStateApp("dashboard");
  const [toast, setToast] = useStateApp(null);
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [sellOpen, setSellOpen] = useStateApp(false);
  const [searchOpen, setSearchOpen] = useStateApp(false);
  const [searchQ, setSearchQ] = useStateApp("");
  const [notifOpen, setNotifOpen] = useStateApp(false);
  const notifRef = useRefApp(null);

  // Expose current user for audit log
  useEffectApp(() => { window.__currentUser = user; }, [user]);

  const badges = useBadges();

  const [store, setStoreRaw] = useStateApp(() => {
    if (window._DB_STORE) return { ...DEFAULT_STORE, ...window._DB_STORE };
    try {
      const saved = localStorage.getItem("ims_store");
      if (saved) return { ...DEFAULT_STORE, ...JSON.parse(saved) };
    } catch (e) {}
    return DEFAULT_STORE;
  });
  const setStore = (updater) => {
    setStoreRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("ims_store", JSON.stringify(next)); } catch (e) {}
      if (window.dbSaveStoreSettings) dbSaveStoreSettings(next).catch(() => {});
      return next;
    });
  };

  useEffectApp(() => {
    const h = () => {
      if (!window._DB_STORE) return;
      const next = { ...DEFAULT_STORE, ...window._DB_STORE };
      try { localStorage.setItem("ims_store", JSON.stringify(next)); } catch (e) {}
      setStoreRaw(next);
    };
    window.addEventListener("ims-store-change", h);
    return () => window.removeEventListener("ims-store-change", h);
  }, []);

  /* Nav customization state */
  const [navItems, setNavItemsRaw] = useStateApp(() => {
    try {
      const saved = localStorage.getItem("ims_nav_layout");
      if (saved) {
        const parsed = JSON.parse(saved);
        const known = new Set(parsed.map(i => i.id));
        return [...parsed, ...DEFAULT_NAV_STATE.filter(i => !known.has(i.id))];
      }
    } catch (e) {}
    return DEFAULT_NAV_STATE;
  });
  const setNavItems = (updater) => {
    setNavItemsRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("ims_nav_layout", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  useEffectApp(() => {
    document.documentElement.setAttribute("data-density", t.density);
  }, [t.density]);

  // ⌘K / Ctrl+K → open search; Escape → close overlays
  useEffectApp(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchQ("");
        setSearchOpen(true);
      }
      if (e.key === "Escape") { setSearchOpen(false); setNotifOpen(false); }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  // Close notif popover on outside click
  useEffectApp(() => {
    if (!notifOpen) return;
    const h = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [notifOpen]);

  const notifCount = PRODUCTS.filter(p => p.qty <= p.reorder).length +
    loadOrders().filter(o => o.status === "picking" || o.status === "packed").length;

  const pushToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // Global toast bridge: lets non-React code (e.g. saveProductStore in data.jsx)
  // surface a message without a pushToast prop in scope.
  useEffectApp(() => {
    const h = (e) => pushToast(e.detail);
    window.addEventListener("ims-toast", h);
    return () => window.removeEventListener("ims-toast", h);
  }, []);

  const goTo = (p) => { setPage(p); window.scrollTo(0, 0); };

  /* Build the visible NAV: filter by role + visibility + order */
  const allowed = new Set(ROLE_NAV[user.role] || []);
  const visibleNav = navItems
    .filter(i => i.visible)
    .map(i => ALL_NAV.find(n => n.id === i.id))
    .filter(n => n && allowed.has(n.id));

  // group by group
  const navByGroup = {};
  visibleNav.forEach(n => { (navByGroup[n.group] ||= []).push(n); });

  // If current page is not allowed for this role, redirect to dashboard
  useEffectApp(() => {
    if (!allowed.has(page)) setPage("dashboard");
  }, [user.role]);

  // Capability check: only admins see users/layout
  const isAdmin = user.role === "admin";

  return (
    <div className="app" data-screen-label={"01 " + (CRUMB_MAP[page] || "หน้าหลัก")}>
      {/* Sidebar */}
      <aside className="sidebar no-print">
        <div className="brand" onClick={() => allowed.has("settings") && goTo("settings")} style={{ cursor: allowed.has("settings") ? "pointer" : "default" }} title={allowed.has("settings") ? "ตั้งค่าร้านค้า" : ""}>
          <StoreLogoMark store={store} size={32}/>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="brand-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{store.name}</div>
            <div className="brand-sub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{store.tagline}</div>
          </div>
        </div>

        {["main", "ops", "stock", "ship", "system"].map(group => {
          const items = navByGroup[group];
          if (!items || items.length === 0) return null;
          return (
            <React.Fragment key={group}>
              <div className="nav-group">{NAV_GROUP_LABELS[group]}</div>
              {items.map(n => (
                <NavItem key={n.id} item={n} active={page === n.id} onClick={() => goTo(n.id)} badge={badges[n.id]}/>
              ))}
            </React.Fragment>
          );
        })}

        <UserDock user={user} onLogout={onLogout} onSwitchUser={onSwitchUser} goTo={goTo} canSeeUsers={isAdmin}/>
      </aside>

      {/* Main */}
      <main className="main">
        <header className="topbar no-print">
          <div className="crumb">
            <span>WMS</span> <span style={{ margin: "0 8px", color: "var(--faint)" }}>/</span> <strong>{CRUMB_MAP[page]}</strong>
          </div>
          <div className="topbar-right">
            <div className="search" onClick={() => { setSearchQ(""); setSearchOpen(true); }} style={{ cursor:"pointer", userSelect:"none" }}>
              <Icons.Search size={14}/>
              <span style={{ fontSize:13, color:"var(--muted)", flex:1 }}>ค้นหา SKU, ออร์เดอร์, ลูกค้า...</span>
              <span className="kbd">⌘K</span>
            </div>
            <button className="btn btn-primary" onClick={() => setSellOpen(true)} style={{ gap: 7 }}>
              <Icons.Cart size={14}/> ขายสินค้า
            </button>
            <button className="btn btn-ghost btn-icon" title="ช่วยเหลือ" onClick={() => alert("สำหรับคำถามเพิ่มเติม ติดต่อ admin@bangkokfulfill.co")}><Icons.Help size={16}/></button>
            <div ref={notifRef} style={{ position:"relative" }}>
              <button className="btn btn-ghost btn-icon" style={{ position:"relative" }} onClick={() => setNotifOpen(o => !o)}>
                <Icons.Bell size={16}/>
                {notifCount > 0 && <span style={{ position:"absolute", top:5, right:5, width:7, height:7, borderRadius:999, background:"var(--danger)" }}/>}
              </button>
              {notifOpen && <NotifPopover onClose={() => setNotifOpen(false)} goTo={goTo}/>}
            </div>
          </div>
        </header>

        <div className="content">
          <ErrorBoundary key={page}>
          {page === "dashboard" && <Dashboard density={t.density} goTo={goTo}/>}
          {page === "inbound"   && <Inbound goTo={goTo} pushToast={pushToast}/>}
          {page === "outbound"  && <Outbound goTo={goTo} pushToast={pushToast}/>}
          {page === "inventory" && <Inventory pushToast={pushToast} density={t.density} goTo={goTo}/>}
          {page === "stocktake" && <StockTake pushToast={pushToast}/>}
          {page === "locations" && <Locations/>}
          {page === "import"    && <ImportPage pushToast={pushToast} goTo={goTo}/>}
          {page === "labels"    && <Labels pushToast={pushToast} store={store}/>}
          {page === "tracking"  && <TrackingPage pushToast={pushToast} store={store}/>}
          {page === "analytics" && <AnalyticsPage pushToast={pushToast}/>}
          {page === "history"   && <HistoryPage pushToast={pushToast}/>}
          {page === "handheld"  && <Handheld pushToast={pushToast}/>}
          {page === "users"     && <UserManagement currentUser={user} pushToast={pushToast} store={store} setStore={setStore}/>}
          {page === "layout"    && <LayoutCustomize navItems={navItems} setNavItems={setNavItems} pushToast={pushToast} allNavItems={ALL_NAV}/>}
          {page === "bundles"   && <BundlePage pushToast={pushToast}/>}
          {page === "settings"  && (
            <div className="stack" style={{ gap: 24 }}>
              <StoreSettings store={store} setStore={setStore} pushToast={pushToast}/>
              <CategoryManager pushToast={pushToast}/>
              <BackupPanel pushToast={pushToast}/>
            </div>
          )}
          </ErrorBoundary>
        </div>
      </main>

      {toast && <div className="toast"><Icons.Check size={14}/> {toast}</div>}

      {sellOpen && (
        <SellProductModal
          onClose={() => setSellOpen(false)}
          onSellComplete={({ orderId, customerName, itemCount }) => {
            pushToast(`สร้างออร์เดอร์ ${orderId} — ${itemCount} รายการ สำหรับ ${customerName}`);
            setSellOpen(false);
            goTo("outbound");
          }}
        />
      )}

      {searchOpen && <SearchOverlay q={searchQ} setQ={setSearchQ} onClose={() => setSearchOpen(false)} goTo={goTo}/>}

      <TweaksPanel title="ปรับแต่งหน้าจอ">
        <TweakSection label="การแสดงผล">
          <TweakRadio label="ความหนาแน่น" value={t.density} onChange={v => setTweak("density", v)} options={["comfortable", "compact"]}/>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function NavItem({ item, active, onClick, badge }) {
  const Icon = item.icon;
  return (
    <div className={"nav-item" + (active ? " active" : "")} onClick={onClick}>
      <Icon className="nav-icon" size={16}/>
      <span>{item.label}</span>
      {badge != null && <span className="nav-badge">{badge}</span>}
    </div>
  );
}

/* ======== USER DOCK (sidebar footer with logout / switch role) ======== */

function UserDock({ user, onLogout, onSwitchUser, goTo, canSeeUsers }) {
  const [open, setOpen] = useStateApp(false);
  const ref = useRefApp(null);
  const role = ROLES.find(r => r.id === user.role);

  useEffectApp(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)", position: "relative" }}>
      {open && (
        <div className="popover" style={{ left: 4, right: 4 }}>
          <div style={{ padding: "8px 10px 4px", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>เข้าสู่ระบบในฐานะ</div>
          <div style={{ padding: "0 10px 8px" }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{user.name}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{user.email}</div>
          </div>
          <div className="popover-divider"/>
          {canSeeUsers && (
            <>
              <button className="popover-item" onClick={() => { goTo("users"); setOpen(false); }}>
                <Icons.Help size={14}/> จัดการสมาชิก
              </button>
              <button className="popover-item" onClick={() => { goTo("layout"); setOpen(false); }}>
                <Icons.Edit size={14}/> ปรับแต่งเลย์เอาต์
              </button>
              <div className="popover-divider"/>
            </>
          )}
          <button className="popover-item danger" onClick={() => { onLogout(); setOpen(false); }}>
            <Icons.Door size={14}/> ออกจากระบบ
          </button>
        </div>
      )}

      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 8px 4px", cursor: "pointer", borderRadius: 10 }}>
        <div className="avatar" style={{ background: role.color }}>{user.avatar}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
          <div className="row" style={{ gap: 6, marginTop: 1 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: role.color, flexShrink: 0 }}/>
            <span style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{role.label}</span>
          </div>
        </div>
        <Icons.Setting size={14} style={{ color: "var(--muted)" }}/>
      </div>
    </div>
  );
}

/* ======== UPDATE NOTIFIER ========
   Installed PWAs (and long-open tabs) keep running the version they launched
   with — a new deploy won't refresh them on its own, so users get "stuck" on
   the old build. This polls the freshly-served HTML (everything is no-store) and
   reads its app.jsx `?v=` stamp. When that stamp differs from the one THIS page
   booted with, a "รีเฟรช" banner appears in both desktop and mobile. No extra
   file to maintain: the existing per-deploy version stamp IS the signal. */
function UpdateNotifier() {
  const [latest, setLatest]  = useStateApp(null);   // newer version string, once found
  const runningRef   = useRefApp(null);
  const dismissedRef = useRefApp(null);

  const readStamp = (src) => {
    const m = /[?&]v=([^"'&\s>]+)/.exec(src || "");
    return m ? m[1] : null;
  };

  useEffectApp(() => {
    const tag = document.querySelector('script[src*="app.jsx"]');
    runningRef.current = readStamp(tag && tag.getAttribute("src"));
    if (!runningRef.current) return;   // no version stamp → nothing to compare against

    let alive = true;
    const check = async () => {
      if (!alive || document.hidden) return;
      try {
        const res = await fetch("/", { cache: "no-store" });
        if (!res.ok) return;
        const html = await res.text();
        const m = /app\.jsx\?v=([^"'&\s>]+)/.exec(html);
        const v = m ? m[1] : null;
        if (alive && v && v !== runningRef.current && v !== dismissedRef.current) {
          setLatest(v);
        }
      } catch (e) { /* offline / network blip — try again next tick */ }
    };
    const id = setInterval(check, 90000);                 // every 90s
    const onVis = () => { if (!document.hidden) check(); }; // and whenever the app regains focus
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    check();
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  const refresh = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
    } catch (e) {}
    window.location.reload();   // pulls the new no-store HTML + new ?v= asset URLs
  };

  const dismiss = () => { dismissedRef.current = latest; setLatest(null); };

  if (!latest) return null;
  return (
    <div role="alert" style={{
      position: "fixed",
      top: "max(12px, env(safe-area-inset-top))",
      left: "50%", transform: "translateX(-50%)",
      zIndex: 100000, maxWidth: "92vw",
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 8px 8px 16px",
      background: "var(--fg, #1a1a1a)", color: "var(--bg, #ffffff)",
      borderRadius: 999, boxShadow: "0 10px 34px rgba(0,0,0,0.28)",
      fontSize: 14, fontWeight: 500, fontFamily: "inherit",
    }}>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        มีเวอร์ชันใหม่พร้อมใช้งาน
      </span>
      <button onClick={refresh} style={{
        flexShrink: 0, border: "none", cursor: "pointer",
        background: "var(--accent, #2563eb)", color: "#ffffff",
        fontWeight: 600, fontSize: 14, fontFamily: "inherit",
        padding: "7px 16px", borderRadius: 999,
      }}>รีเฟรช</button>
      <button onClick={dismiss} aria-label="ปิด" title="ปิด" style={{
        flexShrink: 0, border: "none", cursor: "pointer",
        background: "transparent", color: "var(--bg, #ffffff)",
        opacity: 0.65, fontSize: 20, lineHeight: 1, padding: "2px 8px",
      }}>×</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.Fragment><Root/><UpdateNotifier/></React.Fragment>
);
