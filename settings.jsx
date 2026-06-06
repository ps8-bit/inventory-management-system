/* Store settings: logo upload, store info */

const { useState: useStateSet, useEffect: useEffectSet, useRef: useRefSet } = React;

function StoreSettings({ store, setStore, pushToast }) {
  const fileRef = useRefSet(null);
  const [drag, setDrag] = useStateSet(false);

  const readFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { pushToast("กรุณาเลือกไฟล์รูปภาพ"); return; }
    if (f.size > 2 * 1024 * 1024) { pushToast("ไฟล์ใหญ่เกิน 2 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setStore(s => ({ ...s, logo: reader.result }));
      pushToast("อัปโหลดโลโก้แล้ว");
    };
    reader.readAsDataURL(f);
  };

  const update = (key, value) => setStore(s => ({ ...s, [key]: value }));
  const updateSender = (key, value) => setStore(s => ({ ...s, sender: { ...s.sender, [key]: value } }));

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ตั้งค่าร้านค้า</h1>
          <div className="page-sub">โลโก้ ชื่อร้าน และข้อมูลผู้ส่งเริ่มต้นสำหรับฉลากจัดส่งทุกใบ</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setStore(DEFAULT_STORE)}>คืนค่าเริ่มต้น</button>
          <button className="btn btn-primary" onClick={() => pushToast("บันทึกการตั้งค่าแล้ว")}><Icons.Check size={14}/> บันทึก</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20 }}>
        {/* Logo upload */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>โลโก้ร้านค้า</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 18 }}>
            ใช้แสดงบนแถบนำทาง และเป็นหัวฉลากจัดส่งทุกใบ แนะนำรูปสี่เหลี่ยมจัตุรัส PNG / SVG พื้นหลังโปร่งใส
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files?.[0]); }}
            style={{
              border: "1.5px dashed " + (drag ? "var(--accent)" : "var(--border-strong)"),
              background: drag ? "var(--accent-soft)" : "var(--surface-2)",
              borderRadius: 14,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              cursor: "pointer",
              transition: "border-color 0.15s, background 0.15s"
            }}
          >
            {store.logo ? (
              <div style={{ display: "flex", alignItems: "center", gap: 20, width: "100%" }}>
                <div style={{
                  width: 96, height: 96,
                  borderRadius: 16,
                  background: "white",
                  border: "1px solid var(--border)",
                  display: "grid", placeItems: "center",
                  padding: 10,
                  flexShrink: 0
                }}>
                  <img src={store.logo} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>โลโก้พร้อมใช้งาน</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>คลิกหรือลากไฟล์มาวางเพื่อเปลี่ยน</div>
                  <div className="row" style={{ marginTop: 10, gap: 6 }}>
                    <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}><Icons.Refresh size={12}/> เปลี่ยนรูป</button>
                    <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); update("logo", null); pushToast("ลบโลโก้แล้ว"); }}><Icons.Trash size={12}/> ลบ</button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--muted)" }}>
                  <Icons.Plus size={22}/>
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 14 }}>คลิกเพื่ออัปโหลด หรือลากไฟล์มาวาง</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>PNG · JPG · SVG · ขนาดไม่เกิน 2 MB</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => readFile(e.target.files?.[0])} style={{ display: "none" }}/>

          <div style={{ marginTop: 18 }}>
            <SField label="ชื่อร้าน (แสดงคู่กับโลโก้)" value={store.name} onChange={(v) => update("name", v)}/>
            <SField label="คำอธิบายสั้น (อยู่ใต้ชื่อร้าน)" value={store.tagline} onChange={(v) => update("tagline", v)}/>
          </div>
        </div>

        {/* Sender info */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>ข้อมูลผู้ส่ง</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 18 }}>
            ใช้เป็นข้อมูลผู้ส่งเริ่มต้นเมื่อสร้างฉลากใหม่ (แก้ไขทีละใบได้บนหน้าพิมพ์ฉลาก)
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <SField label="ชื่อ / บริษัท" value={store.sender.name} onChange={(v) => updateSender("name", v)}/>
            <SField label="ที่อยู่ บรรทัด 1" value={store.sender.addr1} onChange={(v) => updateSender("addr1", v)}/>
            <SField label="ที่อยู่ บรรทัด 2" value={store.sender.addr2} onChange={(v) => updateSender("addr2", v)}/>
            <SField label="โทรศัพท์" value={store.sender.phone} onChange={(v) => updateSender("phone", v)}/>
          </div>
        </div>
      </div>

      {/* Live previews */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>ตัวอย่างการแสดงผล</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 18 }}>โลโก้และข้อมูลร้านจะปรากฏในตำแหน่งเหล่านี้</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>บนแถบนำทาง</div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, background: "var(--surface-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StoreLogoMark store={store} size={36}/>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{store.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{store.tagline}</div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>หัวฉลากจัดส่ง</div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 18, background: "var(--surface-2)" }}>
              <div style={{ background: "white", padding: 14, border: "1px solid #111" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8, borderBottom: "1px solid #111" }}>
                  <StoreLogoMark store={store} size={40} forLabel/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{store.name}</div>
                    <div style={{ fontSize: 9, color: "#666", marginTop: 1 }}>{store.tagline}</div>
                  </div>
                  <div style={{ fontSize: 9, color: "#666", textAlign: "right" }}>
                    <div>ฉลากจัดส่ง</div>
                    <div className="mono" style={{ fontWeight: 600, color: "#111" }}>SO-XXXXXXXX</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Working-hours access window */}
      <WorkHoursCard store={store} setStore={setStore} pushToast={pushToast}/>

      {/* LINE low-stock alerts */}
      <LineAlertCard pushToast={pushToast}/>
    </div>
  );
}

/* ── Working-hours access window ──
   Restricts the selected roles (default staff + viewer) to an admin-set,
   per-weekday open/close schedule. Enforcement lives in app.jsx Root (login
   gate + session poll) against server time; this card only edits the config,
   which syncs to every device via store_settings. */
function WorkHoursCard({ store, setStore, pushToast }) {
  const wh = store.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : { enabled: false, roles: [], days: {} });
  const dayLabels = (typeof WORKHOURS_DAY_LABELS !== "undefined") ? WORKHOURS_DAY_LABELS
    : ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

  const patchWH = (patch) => setStore(s => {
    const cur = s.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : { enabled: false, roles: [], days: {} });
    return { ...s, workHours: { ...cur, ...patch } };
  });
  const patchDay = (d, patch) => setStore(s => {
    const cur = s.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : { enabled: false, roles: [], days: {} });
    const prevDay = (cur.days && cur.days[d]) || { on: false, open: "08:00", close: "18:00" };
    return { ...s, workHours: { ...cur, days: { ...cur.days, [d]: { ...prevDay, ...patch } } } };
  });
  const toggleRole = (r) => setStore(s => {
    const cur = s.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : { enabled: false, roles: [], days: {} });
    const roles = cur.roles || [];
    const next = roles.includes(r) ? roles.filter(x => x !== r) : [...roles, r];
    return { ...s, workHours: { ...cur, roles: next } };
  });

  // Roles that can be restricted (admin is always exempt — never lock out the owner).
  const ROLE_CHOICES = (typeof ROLES !== "undefined" ? ROLES : []).filter(r => r.id !== "admin");
  const selRoles = wh.roles || [];

  // Live "open now?" preview for staff using device time (informational only;
  // real enforcement uses server time).
  let preview = null;
  if (wh.enabled && selRoles.length && typeof workHoursStatus === "function") {
    const st = workHoursStatus(store, selRoles[0], Date.now());
    preview = st.restricted ? (st.allowed ? "open" : "closed") : null;
  }

  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>เวลาทำการ (จำกัดเวลาเข้าใช้งาน)</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, maxWidth: 640, lineHeight: 1.6 }}>
            กำหนดวันและเวลาที่อนุญาตให้เข้าใช้งานระบบ เพื่อป้องกันการแอบเข้ามาคีย์ข้อมูลนอกเวลางาน
            — ผู้ที่อยู่ในบทบาทที่เลือกจะเข้าสู่ระบบได้เฉพาะในเวลาทำการ และจะถูกออกจากระบบอัตโนมัติเมื่อหมดเวลา
            (ผู้ดูแลระบบเข้าได้ตลอดเวลา)
          </div>
        </div>
        <span className={"switch" + (wh.enabled ? " on" : "")} onClick={() => { patchWH({ enabled: !wh.enabled }); pushToast(wh.enabled ? "ปิดการจำกัดเวลาทำการแล้ว" : "เปิดการจำกัดเวลาทำการแล้ว"); }} style={{ flexShrink: 0, marginTop: 2 }}/>
      </div>

      {wh.enabled && (
        <div className="stack" style={{ gap: 18, marginTop: 18 }}>
          {/* Which roles are restricted */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>บทบาทที่ถูกจำกัดเวลา</div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {ROLE_CHOICES.map(r => {
                const on = selRoles.includes(r.id);
                return (
                  <button key={r.id} type="button" onClick={() => toggleRole(r.id)}
                    className={"badge " + (on ? "badge-info" : "badge-neutral")}
                    style={{ cursor: "pointer", border: "1px solid " + (on ? "var(--accent)" : "var(--border)"), padding: "6px 12px", fontSize: 12 }}>
                    <span className={"check" + (on ? " on" : "")} style={{ marginRight: 6 }}/>{r.label}
                  </button>
                );
              })}
            </div>
            {selRoles.length === 0 && (
              <div className="hint" style={{ color: "var(--warning)", marginTop: 6 }}>ยังไม่ได้เลือกบทบาท — จะยังไม่มีผลกับใคร</div>
            )}
          </div>

          {/* Per-day schedule */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>ตารางเวลาทำการ (เขตเวลาไทย)</div>
            <div className="stack" style={{ gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 0].map(d => {            // Mon→Sun ordering
                const day = (wh.days && wh.days[d]) || { on: false, open: "08:00", close: "18:00" };
                return (
                  <div key={d} className="row" style={{ gap: 12, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                    <span className={"switch" + (day.on ? " on" : "")} onClick={() => patchDay(d, { on: !day.on })} style={{ flexShrink: 0 }}/>
                    <div style={{ width: 64, fontSize: 13, fontWeight: 500 }}>{dayLabels[d]}</div>
                    {day.on ? (
                      <div className="row" style={{ gap: 8, alignItems: "center" }}>
                        <input type="time" className="input" value={day.open} onChange={e => patchDay(d, { open: e.target.value })} style={{ width: 120 }}/>
                        <span style={{ color: "var(--muted)" }}>–</span>
                        <input type="time" className="input" value={day.close} onChange={e => patchDay(d, { close: e.target.value })} style={{ width: 120 }}/>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>วันหยุด (เข้าใช้งานไม่ได้)</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="hint" style={{ marginTop: 8, color: "var(--muted)" }}>
              ตั้งเวลาปิดให้น้อยกว่าเวลาเปิดได้สำหรับกะข้ามคืน (เช่น 22:00–06:00)
            </div>
          </div>

          {preview && (
            <div style={{ fontSize: 12, padding: "8px 12px", borderRadius: 8,
                          background: preview === "open" ? "var(--success-soft)" : "var(--warning-soft)",
                          color: preview === "open" ? "var(--success)" : "var(--warning)" }}>
              สถานะตอนนี้ (เวลาเครื่องนี้): {preview === "open" ? "อยู่ในเวลาทำการ — เข้าใช้งานได้" : "อยู่นอกเวลาทำการ — บทบาทที่จำกัดจะเข้าใช้งานไม่ได้"}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.7, padding: 12, background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
            <strong style={{ color: "var(--fg)" }}>หมายเหตุด้านความปลอดภัย:</strong> ระบบตรวจเวลาจากเซิร์ฟเวอร์เพื่อกันการแก้นาฬิกาเครื่อง
            — โปรดรันสคริปต์ <code>supabase/create-server-now.sql</code> ใน Supabase SQL Editor หนึ่งครั้ง
            หากยังไม่ได้รัน ระบบจะใช้เวลาจากเครื่องผู้ใช้แทนชั่วคราว
          </div>
        </div>
      )}
    </div>
  );
}

/* LINE integration: daily low-stock push (line-alert) + on-demand chatbot
   reports (line-bot). This card lets an admin test the push and preview the
   bot's report replies against real data. */
function LineAlertCard({ pushToast }) {
  const [testing, setTesting] = useStateSet(false);
  const [preview, setPreview] = useStateSet(null);   // { cmd, text } | { cmd, loading:true }
  const runTest = async () => {
    setTesting(true);
    const { data, error } = await lineTest();
    setTesting(false);
    if (error) { pushToast("LINE: " + error); return; }
    pushToast(data?.sent ? "ส่งข้อความทดสอบไป LINE แล้ว ✓" : "เชื่อมต่อ LINE สำเร็จ");
  };
  const runPreview = async (cmd, label) => {
    setPreview({ cmd: label, loading: true });
    const { data, error } = await lineBotPreview(cmd);
    if (error) { setPreview({ cmd: label, text: "⚠️ " + error }); return; }
    setPreview({ cmd: label, text: data?.text || "(ไม่มีข้อมูล)" });
  };
  const CMDS = [
    { cmd: "ของต่ำ",  label: "ของต่ำ" },
    { cmd: "สต็อก",   label: "สต็อกรวม" },
    { cmd: "ออเดอร์", label: "ออเดอร์ค้างส่ง" },
    { cmd: "ยอดขาย",  label: "ยอดขาย" },
  ];
  return (
    <div className="card" style={{ padding: 24 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>รายงานผ่าน LINE</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, maxWidth: 640 }}>
            แจ้งเตือนสต็อกต่ำอัตโนมัติทุกวัน (broadcast) + แชตบอตถามรายงานได้ทันที (พิมพ์คำสั่งใน LINE — ตอบกลับฟรี)
            — ใช้ LINE Messaging API (LINE Notify ปิดบริการแล้ว)
          </div>
        </div>
        <button className="btn" onClick={runTest} disabled={testing}>
          <Icons.Bell size={14}/> {testing ? "กำลังส่ง…" : "ทดสอบ push"}
        </button>
      </div>

      {/* Bot report preview — runs the same logic the LINE bot uses, on real data */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>ดูตัวอย่างรายงานของบอท</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {CMDS.map(c => (
            <button key={c.cmd} className="btn btn-sm" onClick={() => runPreview(c.cmd, c.label)}>{c.label}</button>
          ))}
        </div>
        {preview && (
          <pre style={{ marginTop: 12, padding: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "var(--fg)" }}>
            {preview.loading ? "กำลังโหลด…" : preview.text}
          </pre>
        )}
      </div>

      <div style={{ marginTop: 16, padding: 14, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>การตั้งค่า (ทำครั้งเดียว)</div>
        1. สร้าง LINE Official Account + Messaging API channel ที่ developers.line.biz<br/>
        2. ใส่ Secrets ใน Supabase → Edge Functions: <code>LINE_CHANNEL_ACCESS_TOKEN</code>, <code>LINE_CHANNEL_SECRET</code>, <code>CRON_SECRET</code><br/>
        3. ตั้ง Webhook URL ของ channel = <code>…/functions/v1/line-bot</code> แล้วเปิด “Use webhook”<br/>
        4. ทีมงานเพิ่มเพื่อน LINE OA → กด “ทดสอบ push” และพิมพ์ “เมนู” ในแชตเพื่อยืนยัน
      </div>
    </div>
  );
}

function SField({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)}/>
    </div>
  );
}

/* Shared brand-mark component — works for both sidebar and label */
function StoreLogoMark({ store, size = 32, forLabel = false }) {
  if (store.logo) {
    return (
      <div style={{
        width: size, height: size,
        borderRadius: forLabel ? 4 : 8,
        background: "white",
        border: forLabel ? "1px solid #ddd" : "1px solid var(--border)",
        display: "grid", placeItems: "center",
        padding: 3,
        flexShrink: 0,
        overflow: "hidden"
      }}>
        <img src={store.logo} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
      </div>
    );
  }
  // fallback: first letter of store name
  const ch = (store.name || "?").trim()[0] || "?";
  return (
    <div style={{
      width: size, height: size,
      borderRadius: forLabel ? 4 : 8,
      background: forLabel ? "#111" : "var(--fg)",
      color: forLabel ? "white" : "var(--bg)",
      display: "grid", placeItems: "center",
      fontWeight: 600,
      fontSize: size * 0.45,
      letterSpacing: "-0.02em",
      flexShrink: 0
    }}>{ch}</div>
  );
}

const DEFAULT_STORE = {
  logo: null,
  name: "ชื่อร้านค้า / คลังสินค้า",
  tagline: "",
  sender: {
    name: "",
    addr1: "",
    addr2: "",
    phone: ""
  },
  // Working-hours access window (off by default; configured on this page).
  workHours: (typeof defaultWorkHours === "function") ? defaultWorkHours() : { enabled: false, roles: ["staff", "viewer"], days: {} }
};

/* ── Category Manager ── */
function CategoryManager({ pushToast }) {
  const [cats, setCats] = useStateSet(() => loadCategories());
  const [newName, setNewName] = useStateSet("");
  const [editing, setEditing] = useStateSet(null); // { name, draft }

  useEffectSet(() => {
    const refresh = () => setCats(loadCategories());
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
    if (!addCategory(name)) { pushToast("หมวดหมู่นี้มีอยู่แล้ว"); return; }
    setCats(loadCategories());
    setNewName("");
    pushToast(`เพิ่มหมวดหมู่ "${name}" แล้ว`);
  };

  const handleRename = (oldName) => {
    const newN = editing.draft.trim();
    if (!newN) return;
    if (newN === oldName) { setEditing(null); return; }
    if (!renameCategory(oldName, newN)) { pushToast("ชื่อนี้มีอยู่แล้ว"); return; }
    setCats(loadCategories());
    setEditing(null);
    pushToast(`เปลี่ยนชื่อเป็น "${newN}" แล้ว — อัปเดตสินค้าในหมวดนี้ทั้งหมด`);
  };

  const handleDelete = (cat) => {
    const count = countProducts(cat);
    const msg = count > 0
      ? `ลบหมวดหมู่ "${cat}"?\nสินค้า ${count} รายการจะถูกย้ายไปหมวด "ทั่วไป"`
      : `ลบหมวดหมู่ "${cat}"?`;
    if (!confirm(msg)) return;
    deleteCategory(cat);
    setCats(loadCategories());
    pushToast(`ลบหมวดหมู่ "${cat}" แล้ว`);
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>หมวดหมู่สินค้า</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16 }}>จัดการหมวดหมู่ที่ใช้จัดกลุ่มสินค้าในคลัง</div>

      {/* Add new */}
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
          placeholder="ชื่อหมวดหมู่ใหม่ เช่น เฟอร์นิเจอร์"
        />
        <button className="btn btn-accent" onClick={handleAdd} disabled={!newName.trim()}>
          <Icons.Plus size={14}/> เพิ่ม
        </button>
      </div>

      {/* List */}
      <div className="card card-tight" style={{ overflow: "hidden" }}>
        {cats.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ยังไม่มีหมวดหมู่</div>
        )}
        {cats.map((cat, i) => {
          const count = countProducts(cat);
          const isEditing = editing?.name === cat;
          return (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: i ? "1px solid var(--border)" : "none" }}>
              {isEditing ? (
                <>
                  <input
                    className="input"
                    style={{ flex: 1, height: 34 }}
                    value={editing.draft}
                    autoFocus
                    onChange={e => setEditing({ ...editing, draft: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleRename(cat);
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => handleRename(cat)}>
                    <Icons.Check size={13}/> บันทึก
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditing(null)}>ยกเลิก</button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{cat}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>{count} สินค้า</span>
                  </div>
                  <button className="btn btn-ghost btn-icon btn-sm" title="แก้ไข" onClick={() => setEditing({ name: cat, draft: cat })}>
                    <Icons.Edit size={13}/>
                  </button>
                  <button className="btn btn-ghost btn-icon btn-sm" title="ลบ"
                    style={{ color: "var(--danger)" }}
                    onClick={() => handleDelete(cat)}>
                    <Icons.Trash size={13}/>
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Backup panel: one-tap export of all data → .json (Tier 1) ── */
const BACKUP_LABELS = { products: "สินค้า", orders: "ออร์เดอร์", bundles: "ชุดสินค้า", bundle_items: "รายการในชุด", labels: "ฉลาก", store_settings: "ตั้งค่าร้าน", app_state: "ข้อมูลระบบ", audit_log: "ประวัติการแก้ไข" };
function BackupPanel({ pushToast }) {
  const [busy, setBusy] = useStateSet(false);
  const [last, setLast] = useStateSet(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof downloadBackup !== "function") throw new Error("ฟีเจอร์ยังไม่พร้อม");
      const counts = await downloadBackup();
      setLast(counts);
      const total = Object.values(counts).reduce((s, n) => s + n, 0);
      if (pushToast) pushToast(`ดาวน์โหลดไฟล์สำรองแล้ว · ${total.toLocaleString("th-TH")} รายการ`);
    } catch (e) {
      if (pushToast) pushToast("สำรองข้อมูลไม่สำเร็จ: " + ((e && e.message) || e));
    } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>สำรองข้อมูล (Backup)</h3>
        <div className="page-sub" style={{ marginTop: 2 }}>ดาวน์โหลดข้อมูลทั้งหมดเป็นไฟล์ .json — เก็บไว้ในเครื่องหรืออัปโหลดเข้า Google Drive</div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-accent" onClick={run} disabled={busy}>
          <Icons.Down size={14}/> {busy ? "กำลังสำรอง…" : "ดาวน์โหลดไฟล์สำรอง"}
        </button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>ได้ไฟล์: <span className="mono">ims-backup-วันที่.json</span></span>
      </div>
      {last && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 14 }}>
          {Object.entries(last).map(([k, n]) => (
            <div key={k} style={{ padding: "8px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{BACKUP_LABELS[k] || k}</div>
              <div className="tnum" style={{ fontWeight: 600 }}>{n.toLocaleString("th-TH")}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--info-soft)", borderRadius: 10, fontSize: 12, color: "var(--fg-2)" }}>
        <Icons.Refresh size={12} style={{ verticalAlign: "middle", marginRight: 6, color: "var(--info)" }}/>
        สำรองอัตโนมัติเข้า Google Drive ทุกคืน — วิธีตั้งค่าอยู่ในไฟล์ <span className="mono">SETUP-BACKUP.md</span>
      </div>
    </div>
  );
}

Object.assign(window, { StoreSettings, StoreLogoMark, DEFAULT_STORE, CategoryManager, BackupPanel });
