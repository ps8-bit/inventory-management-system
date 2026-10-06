/* Main app: AuthGate + sidebar + routing + tweaks + layout customization */

const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp, useMemo: useMemoApp } = React;

const ALL_NAV = [
  { id: "dashboard", label: "หน้าหลัก",       icon: Icons.Dash,    group: "main" },
  { id: "inbound",   label: "รับเข้าสินค้า",   icon: Icons.In,      group: "ops"   },
  { id: "outbound",  label: "จัดส่งสินค้า",    icon: Icons.Out,     group: "ops"   },
  { id: "pack",      label: "แพ็คสินค้า",      icon: Icons.Pack,    group: "ops"   },
  { id: "finder",    label: "ค้นหาสินค้า",     icon: Icons.Search,  group: "ops"   },
  { id: "inventory", label: "สินค้าคงคลัง",    icon: Icons.Box,     group: "stock" },
  { id: "stocktake", label: "ตรวจนับสต็อก",    icon: Icons.Clipboard, group: "stock" },
  { id: "locations", label: "ตำแหน่งจัดเก็บ",  icon: Icons.Map,     group: "stock" },
  { id: "import",    label: "นำเข้า SKU",      icon: Icons.Pkg,     group: "stock" },
  { id: "labels",    label: "พิมพ์ฉลาก",       icon: Icons.Tag,     group: "ship"  },
  { id: "tracking",  label: "ติดตามพัสดุ",       icon: Icons.Truck,   group: "ship" },
  { id: "analytics", label: "วิเคราะห์ยอดขาย",     icon: Icons.Chart,   group: "main" },
  { id: "history",   label: "ประวัติการแก้ไข", icon: Icons.History, group: "system" },
  { id: "users",     label: "ผู้ใช้งานและสิทธิ์", icon: Icons.Users, group: "system" },
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
  pack: "แพ็คสินค้า",
  finder: "ค้นหาสินค้า",
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
/* Orders for badge / notification / search surfaces — the Tracking model
   (labels-as-shipments + preserved + DB rows, overrides applied) so counts
   match what the Outbound / Tracking screens actually display. Falls back to
   the raw orders cache if tracking.jsx didn't load. */
function ordersSnapshot() {
  return (typeof buildOrders === "function") ? buildOrders() : loadOrders();
}

function computeBadges() {
  // --- inbound: low-stock / out-of-stock products ---
  const inbound = PRODUCTS.filter(p => p.qty <= p.reorder).length;
  const pendingOf = (o) => (typeof isPendingOrder === "function") ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed");

  // --- outbound: orders not yet shipped (Tracking-model view) ---
  const snap = ordersSnapshot();
  // Blank label drafts (no name, no items) are not work waiting — they only
  // made this badge say "16" for months.
  const outbound = snap.filter(pendingOf).length;

  // --- pack: orders whose stock is cut but nothing has been fetched off the shelf yet ---
  const pack = snap.filter(o => o.status === "picking" && pendingOf(o)).length;

  // --- labels: items in print queue (prefer Supabase cache) ---
  let labelsArr = window._DB_LABELS || SAMPLE_LABELS;
  try {
    if (!window._DB_LABELS) {
      const raw = localStorage.getItem("ims_labels");
      if (raw !== null) { const a = JSON.parse(raw); if (Array.isArray(a)) labelsArr = a; }
    }
  } catch (e) {}
  // Only labels still waiting for a tracking number — the badge used to count
  // every label ever made (271, of which 213 were long shipped).
  const labels = labelsArr.filter(l => !(l && (l.tracking || (l.data && l.data.tracking)))).length;

  return {
    inbound:  inbound  > 0 ? inbound  : null,
    outbound: outbound > 0 ? outbound : null,
    pack:     pack     > 0 ? pack     : null,
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
function SearchOverlay({ q, setQ, onClose, goToProduct, goToOrder }) {
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
      orders: ordersSnapshot().filter(o =>
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
                    <div key={p.sku} className="search-hit" onClick={() => { goToProduct(p.sku); onClose(); }}>
                      {typeof ProductImageThumb === "function"
                        ? <ProductImageThumb sku={p.sku} size={34} radius={8}/>
                        : <Icons.Box size={14} style={{ color:"var(--muted)", flexShrink:0 }}/>}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name}</div>
                        <div style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.sku} · {p.loc || p.supplier}</div>
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
                  const stLab = (typeof ORDER_STATUS_TH !== "undefined" && ORDER_STATUS_TH[o.status]) || o.status;
                  return (
                    <div key={o.id} className="search-hit" onClick={() => { goToOrder(o.id); onClose(); }}>
                      <Icons.Truck size={14} style={{ color:"var(--muted)", flexShrink:0 }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>{o.customer || "ไม่ระบุชื่อ"}</div>
                        <div style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace" }}>{typeof orderShortId === "function" ? orderShortId(o) : o.id} · {typeof orderChannelLabel === "function" ? orderChannelLabel(o) : o.channel}</div>
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
function NotifPopover({ onClose, goTo, goToProduct, goToOrder }) {
  const outOfStock = PRODUCTS.filter(p => p.qty === 0);
  const lowStock   = PRODUCTS.filter(p => p.qty > 0 && p.qty <= p.reorder);
  const pending    = ordersSnapshot().filter(o => (typeof isPendingOrder === "function") ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed"));
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
            <div key={p.sku} className="notif-row" onClick={() => { goToProduct(p.sku); onClose(); }}>
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
            <div key={p.sku} className="notif-row" onClick={() => { goToProduct(p.sku); onClose(); }}>
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
            <div key={o.id} className="notif-row" onClick={() => { goToOrder(o.id); onClose(); }}>
              <span style={{ width:7, height:7, borderRadius:999, background:"var(--info)", flexShrink:0 }}/>
              <span style={{ flex:1, fontSize:12 }}>{o.customer}</span>
              <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"IBM Plex Mono, monospace", flexShrink:0 }}>{o.id}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding:"8px 16px 10px", borderTop:"1px solid var(--border)", display:"flex", justifyContent:"space-between", marginTop:4 }}>
        {/* No id → plain navigation, but still routed to a page this role can open. */}
        <button className="btn btn-ghost btn-sm" onClick={() => { goToProduct(null); onClose(); }}>ดูสินค้า →</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { goToOrder(null); onClose(); }}>ดูออร์เดอร์ →</button>
      </div>
    </div>
  );
}

/* Map a Supabase Auth session to the app's user shape.
   Role + display name come from user_metadata (set when creating the user
   in the Supabase dashboard) with a fallback to the USERS constant so
   existing demo accounts still work during the transition. */
let _roleMismatchWarned = false;
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
  // The role RLS enforces (app_metadata, from the JWT) and the role the UI shows
  // (user_metadata) can drift apart — the account then sees admin buttons but the
  // database refuses admin writes with a confusing per-action toast. Surface the
  // drift once, right after login, instead of letting it hide until a write fails.
  // (Delayed so the shell has mounted its ims-toast listener; string detail only.)
  if (meta.role && (app.role || "viewer") !== meta.role && !_roleMismatchWarned) {
    _roleMismatchWarned = true;
    const msg = "คำเตือน: สิทธิ์บัญชีไม่ตรงกับฐานข้อมูล (แอปเห็น '" + meta.role +
      "' แต่ฐานข้อมูลใช้ '" + (app.role || "viewer") +
      "') — การบันทึก/ลบอาจถูกปฏิเสธ ให้ผู้ดูแลระบบตั้งบทบาทใหม่ในหน้า ผู้ใช้และสิทธิ์";
    setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: msg })); } catch (e) {}
    }, 1800);
  }
  return { id: su.id, email, name, role, avatar, active: true };
}

/* ======== TOASTS ========
   One implementation for both shells. A toast may arrive as a plain string OR
   as { msg, type } (several data.jsx paths send the object form). Rendering the
   raw object used to throw outside every ErrorBoundary and blank the whole app
   — e.g. right after the offline queue synced. Errors get their own look and
   stay up longer; a new toast restarts the timer instead of being cut short by
   the previous one's. */
const TOAST_ERROR_RE = /ไม่สำเร็จ|ไม่ได้|ไม่มีสิทธิ์|ไม่พบ|ผิดพลาด|ล้มเหลว|ถูกปฏิเสธ|ถูกยกเลิก|error/i;
const TOAST_WARN_RE  = /คำเตือน|รอซิงค์|กันบันทึกซ้ำ|โปรดตรวจสอบ/;
function normalizeToast(detail) {
  let msg = detail, type = null;
  if (detail && typeof detail === "object") { msg = detail.msg != null ? detail.msg : (detail.message || ""); type = detail.type || null; }
  msg = msg == null ? "" : String(msg);
  if (!type) type = TOAST_ERROR_RE.test(msg) ? "error" : TOAST_WARN_RE.test(msg) ? "warn" : "ok";
  return { msg, type };
}
function useToast() {
  const [toast, setToast] = useStateApp(null);
  const timerRef = useRefApp(null);
  const push = (detail) => {
    const t = normalizeToast(detail);
    if (!t.msg) return;
    setToast({ ...t, key: Date.now() });
    clearTimeout(timerRef.current);
    const ms = t.type === "error" ? 5500 : t.type === "warn" ? 4500 : Math.min(6000, 2600 + t.msg.length * 25);
    timerRef.current = setTimeout(() => setToast(null), ms);
  };
  useEffectApp(() => () => clearTimeout(timerRef.current), []);
  return [toast, push, () => setToast(null)];
}
function ToastView({ toast, onClose }) {
  if (!toast) return null;
  const Icon = toast.type === "error" ? Icons.X : toast.type === "warn" ? Icons.Warn : Icons.Check;
  return (
    <div key={toast.key} className={"toast toast-" + toast.type} role={toast.type === "error" ? "alert" : "status"} onClick={onClose}>
      <span className="toast-icon"><Icon size={13}/></span>
      <span>{toast.msg}</span>
    </div>
  );
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

/* ── Loading screen shown while dbInit() fetches data from Supabase ──
   Same look as the HTML boot splash so the hand-off is seamless. On a bad
   connection dbInit can hang with no answer at all, so after a while offer a
   retry — and, when this device already has cached data, a way in with it
   (dbInit keeps running and refreshes every screen when it lands). */
function DBLoadingScreen({ onUseCache, sub }) {
  const [slow, setSlow] = useStateApp(false);
  useEffectApp(() => {
    if (!onUseCache) return;
    const id = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(id);
  }, [!!onUseCache]);
  const hasCache = (() => { try { return !!localStorage.getItem("ims_products"); } catch (e) { return false; } })();
  return (
    <div className="boot-splash">
      <div className="boot-mark">PS</div>
      <div className="boot-title">PS STOCK</div>
      <div className="boot-sub">{slow ? "การเชื่อมต่อช้ากว่าปกติ…" : (sub || "กำลังโหลดข้อมูล…")}</div>
      {!slow && <div className="boot-bar"/>}
      {slow && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", padding: "0 16px" }}>
          <button className="btn" onClick={() => window.location.reload()}>ลองใหม่</button>
          {hasCache && <button className="btn btn-primary" onClick={onUseCache}>เปิดด้วยข้อมูลล่าสุดในเครื่อง</button>}
        </div>
      )}
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
    // Use the URL captured at first-script time (data.jsx) — by the time React
    // mounts, supabase-js may have already stripped the recovery/invite token.
    const init = window.__IMS_INIT || { hash: window.location.hash || "", search: window.location.search || "" };
    const s = (init.hash || "") + " " + (init.search || "");
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

  // Robustly handle landing from a password-reset / invite email link — the
  // synchronous authFlow detection above only catches the implicit-hash flow,
  // which silently strands the user on the login screen for the other cases:
  //  • implicit #access_token=…&type=recovery and PKCE ?code=… are consumed by
  //    supabase-js (detectSessionInUrl) → it fires PASSWORD_RECOVERY (handled
  //    above). We deliberately DON'T touch those here — re-consuming a ?code
  //    would fail "code already used".
  //  • ?token_hash=…&type=recovery|invite (newer templates) is NOT auto-consumed
  //    → verifyOtp to establish the temporary session, else the reset screen
  //    shows but "save" fails with no session.
  //  • An expired / already-used / rejected link returns error=… in the hash or
  //    query with no session → surface WHY on the login screen instead of a
  //    silent bounce.
  useEffectApp(() => {
    // Parse the URL captured at first-script time — supabase-js may have already
    // stripped a ?token_hash / #error before this effect runs.
    const init = window.__IMS_INIT || { hash: window.location.hash || "", search: window.location.search || "" };
    const hp  = new URLSearchParams((init.hash || "").replace(/^#/, ""));
    const qp  = new URLSearchParams(init.search || "");
    const get = (k) => hp.get(k) || qp.get(k);
    const cleanUrl = () => { try { history.replaceState(null, "", window.location.pathname); } catch (e) {} };
    const showLinkError = (code, desc) => {
      if (typeof recoveryLinkErrorMsg === "function") setLockoutMsg(recoveryLinkErrorMsg(code, desc));
    };

    const errCode = get("error_code") || get("error");
    if (errCode) {
      setAuthFlow(null);   // a stray sync type=recovery match must not keep the reset UI up
      showLinkError(errCode, get("error_description"));
      cleanUrl();
      return;
    }

    const tokenHash = get("token_hash");
    const type      = get("type");
    if (tokenHash && type && window.authVerifyOtp) {
      authVerifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
        cleanUrl();
        if (error) { setAuthFlow(null); showLinkError("verify_failed", error.message); }
        else       { setAuthFlow(type === "recovery" ? "recovery" : "invite"); }
      }).catch(() => {});
    }
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
    let checking = false;   // single-flight: focus + visibilitychange can fire together
    const forceOut = async (msg) => {
      setLockoutMsg(msg);
      intentionalLogoutRef.current = true;   // keep SIGNED_OUT from overwriting msg
      // scope:'local' clears the persisted session WITHOUT depending on a server
      // round-trip, so a user forced out while OFFLINE still lands on a clean
      // login screen and can sign in again the moment connectivity returns.
      try { await authSignOut("local"); } catch (e) {}
      if (alive) setUser(null);
    };
    // A transient network/gateway failure must NEVER end the session. supabase-js
    // does NOT throw on a network failure — getUser()/refreshSession() RETURN
    // { data:{user:null}, error } with error.name === "AuthRetryableFetchError"
    // (status 0 for offline/DNS/CORS, 502/503/504 for a bad gateway). We also
    // treat 408/429/5xx as transient. Everything else (401/403 and other 4xx
    // AuthApiError, or a genuine AuthSessionMissingError) is a DEFINITIVE
    // rejection. Classify on the error NAME + numeric STATUS only — never on the
    // message text, which a real rejection could coincidentally contain.
    const isRetryableAuthErr = (err) => {
      if (!err) return false;
      if (err.name === "AuthRetryableFetchError") return true;
      const s = err.status || 0;
      return s === 0 || s === 408 || s === 429 || s >= 500;
    };
    const check = async () => {
      if (!alive || document.hidden || checking) return;
      // While a password-set flow is active (in-app OTP "forgot", or an email-link
      // "recovery"/"invite"), the session that verifyOtp / the link just created is
      // a transient recovery session — suspension/work-hours enforcement must NOT
      // run against it and force-sign-out before the new password is saved (it would
      // surface a confusing "session missing" error on a correct code+password). The
      // effect re-runs when authFlow clears (it's in the dep array), opening the gate.
      if (authFlow) return;
      checking = true;
      try {
        // (1) Working-hours window — only when the role is actually governed.
        // Fall back to the last store settings this device saw — someone who
        // opens with cached data (slow network) must still get the work-hours rule.
        let cachedStore = null;
        if (!window._DB_STORE) { try { const raw = localStorage.getItem("ims_store"); cachedStore = raw ? JSON.parse(raw) : null; } catch (e) {} }
        const store = window._DB_STORE ? { ...DEFAULT_STORE, ...window._DB_STORE }
                    : cachedStore ? { ...DEFAULT_STORE, ...cachedStore } : DEFAULT_STORE;
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
          try { res = await authGetUser(); } catch (e) { res = null; }  // unexpected throw → keep session
          if (!alive) return;
          if (res) {
            const err = res.error;
            // Transient network/gateway failure → keep the session and retry next
            // cycle. (Old bug: getUser() RETURNS user:null on a blip — that was
            // mistaken for an expiry and force-signed-out a healthy user, who then
            // couldn't re-login on the same dead network but recovered on F5.)
            if (!isRetryableAuthErr(err)) {
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
                let recovered = false, refreshRetryable = false;
                if (window.authRefresh) {
                  try {
                    const r = await authRefresh();
                    recovered = !!(r && r.data && r.data.session && !r.error);
                    if (!recovered) refreshRetryable = isRetryableAuthErr(r && r.error);
                  } catch (e) { refreshRetryable = true; }  // unexpected throw → keep session
                }
                if (!alive) return;
                // Only end the session on a DEFINITIVE refresh failure — a network
                // blip during refresh keeps the session for the next cycle.
                if (!recovered && !refreshRetryable) {
                  await forceOut("เซสชันหมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่");
                  return;
                }
                // Refreshed (or transient failure) — keep the user signed in.
              }
            }
          }
        }

        // Only open the gate once the store (schedule) is actually loaded, so the
        // first authoritative work-hours decision uses the real config — not the
        // default (feature-off) store that exists before dbInit finishes.
        if (alive && dbReady) setGateReady(true);
      } finally {
        checking = false;
      }
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
  }, [userId, userRole, dbReady, authFlow]);

  // Load DB data only after a user is authenticated (userId declared above)
  useEffectApp(() => {
    if (!authReady || !userId) return;
    setDbReady(false);
    if (window.dbInit) {
      window.dbInit().then(() => setDbReady(true)).catch(() => setDbReady(true))
        // Flush any writes queued while offline in a previous session. The "online"
        // event never fires on an already-online relaunch, so without this a queued
        // sale/deduction could sit stranded until an unrelated connectivity blip.
        .finally(() => { if (typeof flushOfflineQueue === "function") flushOfflineQueue(); });
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
  if (!gateReady) return <DBLoadingScreen onUseCache={!dbReady ? () => setDbReady(true) : null}/>;

  // Logged in but DB data not ready yet
  if (!dbReady) return <DBLoadingScreen onUseCache={() => setDbReady(true)}/>;

  /* Publish the signed-in user BEFORE the shell's first render. canDo() /
     canOpenPage() read window.__currentUser; when it was only set in a child
     useEffect, the first paint resolved every gate as "viewer" — an admin's
     phone opened without the รับเข้า/จัดส่ง tabs and 3 of 4 home shortcuts
     until something else re-rendered. */
  window.__currentUser = user;

  if (isMobile) return <MobileFullscreen user={user} onLogout={logout} onSwitchUser={() => {}}/>;
  return <App user={user} onLogout={logout} onSwitchUser={() => {}}/>;
}

/* ======== MOBILE FULLSCREEN WRAPPER ========
   The MobileApp component normally lives inside a 360×740 phone frame.
   When the user is actually on a phone/tablet we drop the frame and
   let it fill the viewport with safe-area insets. */
function MobileFullscreen({ user, onLogout, onSwitchUser }) {
  const [toast, pushToast, closeToast] = useToast();

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
      <ToastView toast={toast} onClose={closeToast}/>
    </div>
  );
}

/* ======== APP ======== */

function App({ user, onLogout, onSwitchUser }) {
  const [page, setPage] = useStateApp("dashboard");
  /* Optional "open this exact thing" payload handed to the destination screen by
     goTo(page, focus) — e.g. the global search opening the product you clicked.
     Shape: { page, sku?, orderId?, n }. `n` is a nonce so clicking the SAME hit
     twice (or clicking a hit for the page you are already on) still fires the
     screen's effect — without it a repeat click would be a silent no-op. */
  const [pageFocus, setPageFocus] = useStateApp(null);
  const focusSeqRef = useRefApp(0);
  const [toast, pushToast, closeToast] = useToast();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [sellOpen, setSellOpen] = useStateApp(false);
  const [quickSellOpen, setQuickSellOpen] = useStateApp(false);
  const [searchOpen, setSearchOpen] = useStateApp(false);
  const [searchQ, setSearchQ] = useStateApp("");
  const [notifOpen, setNotifOpen] = useStateApp(false);
  const notifRef = useRefApp(null);
  const [pendingSync, setPendingSync] = useStateApp(() =>
    typeof loadOfflineQueue === "function" ? loadOfflineQueue().length : 0
  );

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
      if (window.dbSaveStoreSettings) dbSaveStoreSettings(next).then(res => {
        if (res && res.error) window.dispatchEvent(new CustomEvent("ims-toast", { detail: { msg: "บันทึกการตั้งค่าไม่สำเร็จ — ตรวจสอบสิทธิ์การใช้งาน", type: "error" } }));
      }).catch(() => {});
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
    ordersSnapshot().filter(o => (typeof isPendingOrder === "function") ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed")).length;

  // Global toast bridge: lets non-React code (e.g. saveProductStore in data.jsx)
  // surface a message without a pushToast prop in scope.
  useEffectApp(() => {
    const h = (e) => pushToast(e.detail);
    window.addEventListener("ims-toast", h);
    return () => window.removeEventListener("ims-toast", h);
  }, []);

  useEffectApp(() => {
    const h = (e) => setPendingSync(e.detail.count);
    window.addEventListener("ims-queue-change", h);
    return () => window.removeEventListener("ims-queue-change", h);
  }, []);

  /* Role permissions changed (admin edited them here, or realtime pushed
     another device's edit) → re-render so the sidebar and every canDo() gate
     inside the screens pick up the new rules without a reload. */
  const [permTick, setPermTick] = useStateApp(0);
  useEffectApp(() => {
    const h = () => setPermTick(t => t + 1);
    window.addEventListener("ims-perms-change", h);
    return () => window.removeEventListener("ims-perms-change", h);
  }, []);

  /* goTo("inventory") — plain navigation (every existing caller).
     goTo("inventory", { sku }) / goTo("outbound", { orderId }) — navigate AND
     tell that screen which record to open. Screens read it via the `focus` prop. */
  const goTo = (p, focus) => {
    /* Single choke point for cross-page navigation: a page this role may not
       open would otherwise be bounced straight back by the guard below, which
       reads as a dead button. Refuse it here and say why instead. Call sites
       that can predict this (the Excel-import / history / analytics buttons)
       hide themselves with canOpenPage() — this catches the rest. */
    if (typeof canOpenPage === "function" && !canOpenPage(p)) {
      pushToast("ไม่มีสิทธิ์เข้าถึงหน้านี้ — ติดต่อผู้ดูแลระบบ");
      return;
    }
    setPage(p);
    focusSeqRef.current += 1;
    setPageFocus(focus ? { ...focus, page: p, n: focusSeqRef.current } : null);
    window.scrollTo(0, 0);
  };
  const focusFor = (p) => (pageFocus && pageFocus.page === p ? pageFocus : null);

  /* Build the visible NAV: filter by role + visibility + order.
     roleNav() honours the admin's per-role override (app_state "role_perms")
     and falls back to the built-in ROLE_NAV defaults. */
  const allowed = new Set(typeof roleNav === "function" ? roleNav(user.role) : (ROLE_NAV[user.role] || []));
  // Global search + notifications surface products and orders — hide them from a
  // role that can't open any of those pages (the pack-only พนักงานแพ็ค).
  const canLookup = ["inventory", "finder", "outbound", "tracking", "dashboard"].some(id => allowed.has(id));
  const visibleNav = navItems
    .filter(i => i.visible)
    .map(i => ALL_NAV.find(n => n.id === i.id))
    .filter(n => n && allowed.has(n.id));

  // group by group
  const navByGroup = {};
  visibleNav.forEach(n => { (navByGroup[n.group] ||= []).push(n); });

  /* If the current page is not allowed for this role, bounce to the first page
     that IS allowed — "dashboard" itself can be revoked, and hard-coding it as
     the target parked the user on the very page just taken away.
     permTick re-runs this when an admin edits permissions (own tab or another
     device via realtime), so a page just revoked closes instead of lingering.
     `page` is a dep so an in-app goTo() to a revoked page can't slip through —
     every button that navigates to a page must therefore be nav-gated too. */
  const firstAllowedPage = () => {
    if (allowed.has("dashboard")) return "dashboard";
    const first = visibleNav[0];
    return first ? first.id : "dashboard";
  };
  useEffectApp(() => {
    if (!allowed.has(page)) setPage(firstAllowedPage());
  }, [user.role, permTick, page]);

  /* Open one specific record from the global search / notifications, on a page
     THIS role is actually allowed to see — the page guard above silently bounces
     a disallowed page to the dashboard, which is how a viewer clicking an order
     hit used to end up on the dashboard instead of the order.
     Products → สินค้าคงคลัง (drawer), falling back to ค้นหาสินค้า.
     Orders   → ติดตามพัสดุ, the only screen with a per-order detail drawer
                (Outbound has none), falling back to จัดส่งสินค้า. */
  const pickPage = (...candidates) => candidates.find(p => allowed.has(p)) || "dashboard";
  const goToProduct = (sku) => goTo(pickPage("inventory", "finder"), sku ? { sku } : undefined);
  const goToOrder   = (orderId) => goTo(pickPage("tracking", "outbound"), orderId ? { orderId } : undefined);

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
            {canLookup && (
            <div className="search" onClick={() => { setSearchQ(""); setSearchOpen(true); }} style={{ cursor:"pointer", userSelect:"none" }}>
              <Icons.Search size={14}/>
              <span style={{ fontSize:13, color:"var(--muted)", flex:1 }}>ค้นหา SKU, ออร์เดอร์, ลูกค้า...</span>
              <span className="kbd">{/Mac|iPhone|iPad/.test(navigator.platform || "") ? "⌘K" : "Ctrl K"}</span>
            </div>
            )}
            {/* ขายออก = the everyday sale (scan → qty → channel). ขาย + จัดส่ง keeps the
                full flow with a shipping address for orders that need a label. */}
            {canDo("sell") && (
              <button className="btn" onClick={() => setSellOpen(true)} style={{ gap: 7 }} title="ขายพร้อมที่อยู่จัดส่งและฉลาก">
                <Icons.Truck size={14}/> ขาย + จัดส่ง
              </button>
            )}
            {canDo("sell") && (
              <button className="btn btn-primary" onClick={() => setQuickSellOpen(true)} style={{ gap: 7 }}>
                <Icons.Cart size={14}/> ขายออก
              </button>
            )}
            {pendingSync > 0 && (
              <div title={`${pendingSync} รายการรอซิงค์`} style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, color:"var(--warning)", cursor:"default", whiteSpace:"nowrap" }}>
                <Icons.Refresh size={14}/>
                <span>{pendingSync} รอซิงค์</span>
              </div>
            )}
            {canLookup && <div ref={notifRef} style={{ position:"relative" }}>
              <button className="btn btn-ghost btn-icon" style={{ position:"relative" }} onClick={() => setNotifOpen(o => !o)}>
                <Icons.Bell size={16}/>
                {notifCount > 0 && <span style={{ position:"absolute", top:5, right:5, width:7, height:7, borderRadius:999, background:"var(--danger)" }}/>}
              </button>
              {notifOpen && <NotifPopover onClose={() => setNotifOpen(false)} goTo={goTo} goToProduct={goToProduct} goToOrder={goToOrder}/>}
            </div>}
          </div>
        </header>

        <div className="content">
          <ErrorBoundary key={page}>
          {page === "dashboard" && <Dashboard density={t.density} goTo={goTo}/>}
          {page === "inbound"   && <Inbound goTo={goTo} pushToast={pushToast}/>}
          {page === "outbound"  && <Outbound goTo={goTo} pushToast={pushToast} focus={focusFor("outbound")}/>}
          {page === "pack"      && <PackQueue pushToast={pushToast} goTo={goTo} user={user}/>}
          {page === "finder"    && <ProductFinder pushToast={pushToast} goTo={goTo} focus={focusFor("finder")}/>}
          {page === "inventory" && <Inventory pushToast={pushToast} density={t.density} goTo={goTo} focus={focusFor("inventory")}/>}
          {page === "stocktake" && <StockTake pushToast={pushToast}/>}
          {page === "locations" && <Locations goTo={goTo}/>}
          {page === "import"    && <ImportPage pushToast={pushToast} goTo={goTo}/>}
          {page === "labels"    && <Labels pushToast={pushToast} store={store}/>}
          {page === "tracking"  && <TrackingPage pushToast={pushToast} store={store} focus={focusFor("tracking")}/>}
          {page === "analytics" && <AnalyticsPage pushToast={pushToast}/>}
          {page === "history"   && <HistoryPage pushToast={pushToast}/>}
          {page === "users"     && <UserManagement currentUser={user} pushToast={pushToast} store={store} setStore={setStore} allNav={ALL_NAV}/>}
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

      <ToastView toast={toast} onClose={closeToast}/>

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

      {quickSellOpen && typeof QuickSellModal === "function" && <QuickSellModal onClose={() => setQuickSellOpen(false)} pushToast={pushToast}/>}

      {searchOpen && canLookup && <SearchOverlay q={searchQ} setQ={setSearchQ} onClose={() => setSearchOpen(false)} goToProduct={goToProduct} goToOrder={goToOrder}/>}

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
                <Icons.Users size={14}/> จัดการสมาชิก
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
