/* Authentication + user management + UI layout customization */

const { useState: useStateAuth, useEffect: useEffectAuth, useRef: useRefAuth } = React;

/* ============ LOGIN SCREEN ============ */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* Map Supabase auth errors to friendly Thai text. Never surface the raw
   (English / internal) message to the user — fall back to a generic line. */
function authErrorToThai(message) {
  const m = String(message || "");
  if (m === "Invalid login credentials")          return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (/email not confirmed/i.test(m))             return "อีเมลนี้ยังไม่ได้ยืนยัน กรุณาตรวจสอบกล่องจดหมาย";
  if (/rate|too many|429/i.test(m))               return "พยายามบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (/network|fetch|failed to fetch/i.test(m))   return "เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  return "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

function LoginScreen({ notice = "", onDismissNotice } = {}) {
  const [email,      setEmail]      = useStateAuth("");
  const [password,   setPassword]   = useStateAuth("");
  const [showPw,     setShowPw]     = useStateAuth(false);
  const [loading,    setLoading]    = useStateAuth(false);
  const [error,      setError]      = useStateAuth("");
  const [forgotSent, setForgotSent] = useStateAuth(false);

  const submit = async (e) => {
    e?.preventDefault();
    if (loading) return;                 // guard: ignore repeated Enter / clicks
    if (!email || !password) return;
    if (!EMAIL_RE.test(email)) { setError("รูปแบบอีเมลไม่ถูกต้อง"); return; }
    setLoading(true);
    setError("");
    const { error: err } = await authSignIn(email, password);
    if (err) {
      setError(authErrorToThai(err.message));
      setLoading(false);
    }
    // On success authOnChange in Root fires → user state updates automatically
  };

  const forgotPassword = async (e) => {
    e.preventDefault();
    if (loading) return;                 // guard: avoid concurrent reset requests
    if (!email)              { setError("ใส่อีเมลก่อน แล้วกดลืมรหัสผ่าน"); return; }
    if (!EMAIL_RE.test(email)) { setError("รูปแบบอีเมลไม่ถูกต้อง"); return; }
    setLoading(true);
    setError("");
    const { error: err } = await authResetPassword(email);
    setLoading(false);
    if (err) { setError(authErrorToThai(err.message)); return; }
    setForgotSent(true);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">ค</div>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>คลังพร้อมส่ง</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>ลงชื่อเข้าใช้ระบบบริหารคลังสินค้า</div>
        </div>

        {notice && (
          <div role="alert" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", marginBottom: 18,
                                     background: "var(--warning-soft)", color: "var(--warning)", borderRadius: 10, fontSize: 12.5, lineHeight: 1.55 }}>
            <Icons.Warn size={16} style={{ flexShrink: 0, marginTop: 1 }}/>
            <span style={{ flex: 1 }}>{notice}</span>
          </div>
        )}

        {forgotSent ? (
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ padding: "14px 16px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
              ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่<br/><strong>{email}</strong> แล้ว<br/>
              <span style={{ fontSize: 11, opacity: 0.8 }}>ตรวจสอบกล่องจดหมาย (และโฟลเดอร์ spam)</span>
            </div>
            <button type="button" className="btn" style={{ justifyContent: "center" }}
              onClick={() => { setForgotSent(false); setError(""); }}>
              ← กลับไปเข้าสู่ระบบ
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="login-email">อีเมล</label>
              <input
                id="login-email"
                className="input input-lg"
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); onDismissNotice && onDismissNotice(); }}
                placeholder="you@example.com"
                autoFocus
                autoComplete="email"
              />
            </div>
            <div className="field">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <label htmlFor="login-password">รหัสผ่าน</label>
                <a className="lnk" style={{ fontSize: 11, pointerEvents: loading ? "none" : "auto", opacity: loading ? 0.5 : 1 }} href="#" onClick={forgotPassword}>ลืมรหัสผ่าน?</a>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  id="login-password"
                  className="input input-lg"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="ใส่รหัสผ่านของคุณ"
                  autoComplete="current-password"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  aria-label={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  title={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  tabIndex={-1}
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                           background: "none", border: "none", cursor: "pointer", padding: 8,
                           color: "var(--muted)", display: "grid", placeItems: "center", lineHeight: 0 }}
                >
                  {showPw
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3.5 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/></svg>
                    : <Icons.Eye size={16}/>}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ padding: "10px 12px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 8, fontSize: 12 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-accent"
              disabled={loading || !email || !password}
              style={{ padding: "13px 16px", fontSize: 15, justifyContent: "center", marginTop: 6,
                       opacity: (!email || !password) ? 0.5 : 1 }}
            >
              {loading ? "กำลังเข้าสู่ระบบ…" : <>ลงชื่อเข้าใช้ <Icons.ArrowRight size={14}/></>}
            </button>
          </form>
        )}

        <div style={{ marginTop: 22, fontSize: 11, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>
          ระบบนี้เข้ารหัสด้วย TLS 1.3 · ปฏิบัติตาม PDPA
        </div>
      </div>
    </div>
  );
}

/* ============ RESET PASSWORD SCREEN ============
   Shown when the user arrives via the "ลืมรหัสผ่าน" email link. Supabase
   parses the recovery token from the URL, establishes a temporary session,
   and fires a PASSWORD_RECOVERY event — Root catches it and renders this so
   the user can actually set a new password (authUpdatePassword). */
function ResetPasswordScreen({ onDone, onCancel, mode = "recovery" }) {
  const isInvite = mode === "invite";
  const ui = isInvite
    ? { title: "ตั้งรหัสผ่านเพื่อเริ่มใช้งาน", sub: "ยินดีต้อนรับ! ตั้งรหัสผ่านสำหรับบัญชีของคุณเพื่อเข้าใช้งาน",
        doneMsg: "ตั้งรหัสผ่านเรียบร้อยแล้ว ✓", doneSub: "บัญชีของคุณพร้อมใช้งานแล้ว" }
    : { title: "ตั้งรหัสผ่านใหม่", sub: "กรอกรหัสผ่านใหม่สำหรับบัญชีของคุณ",
        doneMsg: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว ✓", doneSub: "ใช้รหัสผ่านใหม่นี้ในการเข้าสู่ระบบครั้งต่อไป" };
  const [password, setPassword] = useStateAuth("");
  const [confirm,  setConfirm]  = useStateAuth("");
  const [showPw,   setShowPw]   = useStateAuth(false);
  const [loading,  setLoading]  = useStateAuth(false);
  const [error,    setError]    = useStateAuth("");
  const [done,     setDone]     = useStateAuth(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid    = password.length >= 8 && confirm === password;

  const submit = async (e) => {
    e?.preventDefault();
    if (loading) return;
    if (password.length < 8) { setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"); return; }
    if (password !== confirm) { setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    setLoading(true);
    setError("");
    const { error: err } = await authUpdatePassword(password);
    setLoading(false);
    if (err) { setError(authErrorToThai(err.message)); return; }
    setDone(true);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">ค</div>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>{ui.title}</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{ui.sub}</div>
        </div>

        {done ? (
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ padding: "14px 16px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
              {ui.doneMsg}<br/>
              <span style={{ fontSize: 11, opacity: 0.8 }}>{ui.doneSub}</span>
            </div>
            <button type="button" className="btn btn-accent" style={{ justifyContent: "center" }}
              onClick={() => onDone && onDone()}>
              เข้าสู่ระบบ <Icons.ArrowRight size={14}/>
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="reset-password">รหัสผ่านใหม่</label>
              <div style={{ position: "relative" }}>
                <input
                  id="reset-password"
                  className="input input-lg"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  autoFocus
                  autoComplete="new-password"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  aria-label={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  title={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  tabIndex={-1}
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                           background: "none", border: "none", cursor: "pointer", padding: 8,
                           color: "var(--muted)", display: "grid", placeItems: "center", lineHeight: 0 }}
                >
                  {showPw
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3.5 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/></svg>
                    : <Icons.Eye size={16}/>}
                </button>
              </div>
              {tooShort && <span className="hint" style={{ color: "var(--danger)" }}>ต้องมีอย่างน้อย 8 ตัวอักษร</span>}
            </div>

            <div className="field">
              <label htmlFor="reset-confirm">ยืนยันรหัสผ่านใหม่</label>
              <input
                id="reset-confirm"
                className="input input-lg"
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(""); }}
                placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                autoComplete="new-password"
              />
              {mismatch && <span className="hint" style={{ color: "var(--danger)" }}>รหัสผ่านทั้งสองช่องไม่ตรงกัน</span>}
            </div>

            {error && (
              <div style={{ padding: "10px 12px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 8, fontSize: 12 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-accent"
              disabled={loading || !valid}
              style={{ padding: "13px 16px", fontSize: 15, justifyContent: "center", marginTop: 6,
                       opacity: (!valid) ? 0.5 : 1 }}
            >
              {loading ? "กำลังบันทึก…" : <>บันทึกรหัสผ่านใหม่ <Icons.Check size={14}/></>}
            </button>

            {onCancel && (
              <a className="lnk" style={{ fontSize: 11, textAlign: "center" }} href="#"
                onClick={(e) => { e.preventDefault(); if (!loading) onCancel(); }}>
                ยกเลิก กลับไปหน้าเข้าสู่ระบบ
              </a>
            )}
          </form>
        )}

        <div style={{ marginTop: 22, fontSize: 11, color: "var(--muted)", textAlign: "center", lineHeight: 1.5 }}>
          ระบบนี้เข้ารหัสด้วย TLS 1.3 · ปฏิบัติตาม PDPA
        </div>
      </div>
    </div>
  );
}

/* ============ USER MANAGEMENT PAGE ============ */

/* Format a user row from the manage-users function into the table's shape. */
function fmtUser(u) {
  const name = u.name || (u.email ? u.email.split("@")[0] : "ผู้ใช้");
  return {
    id: u.id, email: u.email || "", name, role: u.role || "viewer",
    avatar: u.avatar || name.slice(0, 2),
    active: u.active !== false,
    joined:   u.created_at      ? isoToThai(u.created_at.slice(0, 10))      : "-",
    lastSeen: u.last_sign_in_at ? isoToThai(u.last_sign_in_at.slice(0, 10)) : "ยังไม่เคยเข้าสู่ระบบ",
    invited:  !!u.invited,
  };
}

function UserManagement({ currentUser, pushToast, store, setStore }) {
  const [users, setUsers] = useStateAuth([]);
  const [loadingUsers, setLoadingUsers] = useStateAuth(true);
  const [loadError, setLoadError] = useStateAuth("");
  const [inviteOpen, setInviteOpen] = useStateAuth(false);
  const [schedOpen, setSchedOpen] = useStateAuth(false);   // shared schedule editor modal
  const [q, setQ] = useStateAuth("");
  const [roleFilter, setRoleFilter] = useStateAuth("all");
  const [openMenu, setOpenMenu] = useStateAuth(null);
  const [busyId, setBusyId] = useStateAuth(null);

  // ── Working-hours: shared schedule + per-user today-only exceptions ──
  const wh = store && store.workHours;
  const whEnabled = !!(wh && wh.enabled);
  const governedRoles = (wh && wh.roles) || [];
  const isGoverned = (role) => whEnabled && governedRoles.includes(role);
  const today = (typeof bangkokDateStr === "function") ? bangkokDateStr(Date.now()) : "";
  const exceptionActive = (id) =>
    (typeof workHoursExceptionDate === "function") && workHoursExceptionDate(store, id) === today;

  const grantException = (id) => {
    setOpenMenu(null);
    if (!setStore) return;
    setStore(s => {
      const cur = s.workHours || (typeof defaultWorkHours === "function" ? defaultWorkHours() : { exceptions: {} });
      return { ...s, workHours: { ...cur, exceptions: { ...(cur.exceptions || {}), [id]: today } } };
    });
    pushToast("อนุญาตให้เข้าใช้งานนอกเวลาได้ถึงสิ้นวันนี้");
  };
  const revokeException = (id) => {
    setOpenMenu(null);
    if (!setStore) return;
    setStore(s => {
      const cur = s.workHours || { exceptions: {} };
      const ex = { ...(cur.exceptions || {}) };
      delete ex[id];
      return { ...s, workHours: { ...cur, exceptions: ex } };
    });
    pushToast("ยกเลิกการอนุญาตนอกเวลาแล้ว");
  };

  // Load the real user list from Supabase Auth (admin-only Edge Function).
  useEffectAuth(() => {
    let alive = true;
    (async () => {
      setLoadingUsers(true);
      setLoadError("");
      const { data, error } = await manageUsers("list");
      if (!alive) return;
      if (error) { setLoadError(error); setLoadingUsers(false); return; }
      setUsers((data.users || []).map(fmtUser));
      setLoadingUsers(false);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = users.filter(u => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (q && !(u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const inviteUser = async (newUser) => {
    const { data, error } = await manageUsers("invite", {
      ...newUser,
      redirectTo: window.location.origin,
    });
    if (error) return { error };
    if (data.user) setUsers(us => [...us, fmtUser(data.user)]);
    pushToast(`ส่งอีเมลเชิญไปที่ ${newUser.email} แล้ว`);
    setInviteOpen(false);
    return null;
  };

  const updateRole = async (id, role) => {
    setOpenMenu(null);
    setBusyId(id);
    const { data, error } = await manageUsers("setRole", { id, role });
    setBusyId(null);
    if (error) { pushToast(error); return; }
    setUsers(us => us.map(u => u.id === id ? { ...u, role: data.user?.role || role } : u));
    pushToast("อัปเดตสิทธิ์การใช้งานแล้ว");
  };

  const toggleActive = async (id) => {
    setOpenMenu(null);
    const target = users.find(u => u.id === id);
    if (!target) return;
    const next = !target.active;
    setBusyId(id);
    const { error } = await manageUsers("setActive", { id, active: next });
    setBusyId(null);
    if (error) { pushToast(error); return; }
    setUsers(us => us.map(u => u.id === id ? { ...u, active: next } : u));
    pushToast(next ? "เปิดใช้งานบัญชีแล้ว" : "ระงับบัญชีแล้ว");
  };

  const removeUser = async (id) => {
    setOpenMenu(null);
    if (id === currentUser.id) { pushToast("ไม่สามารถลบบัญชีของตัวเองได้"); return; }
    if (!confirm("ลบผู้ใช้งานนี้ออกจากองค์กร?")) return;
    setBusyId(id);
    const { error } = await manageUsers("delete", { id });
    setBusyId(null);
    if (error) { pushToast(error); return; }
    setUsers(us => us.filter(u => u.id !== id));
    pushToast("ลบผู้ใช้งานแล้ว");
  };

  const counts = {
    total: users.length,
    active: users.filter(u => u.active).length,
    admin: users.filter(u => u.role === "admin").length,
    pending: users.filter(u => u.invited).length
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ผู้ใช้งานและสิทธิ์</h1>
          <div className="page-sub">จัดการสมาชิกในองค์กรและกำหนดสิทธิ์การเข้าถึง</div>
        </div>
        <div className="row">
          {setStore && <button className="btn" onClick={() => setSchedOpen(true)}><Icons.History size={14}/> แก้ไขเวลาทำการ</button>}
          <button className="btn" onClick={() => { const csv = "Name,Email,Role,Status\n" + users.map(u => `${u.name},${u.email},${u.role},${u.active ? "Active" : "Inactive"}`).join("\n"); const blob = new Blob([csv], {type: "text/csv"}); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "users.csv"; a.click(); URL.revokeObjectURL(url); }}><Icons.Pkg size={14}/> ส่งออกรายชื่อ</button>
          <button className="btn btn-accent" onClick={() => setInviteOpen(true)}><Icons.Plus/> เชิญสมาชิกใหม่</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="สมาชิกทั้งหมด" value={counts.total} tone="info" hint={`ใช้งานอยู่ ${counts.active} คน`}/>
        <SmallStat label="ผู้ดูแลระบบ" value={counts.admin} tone="warning" hint="แนะนำให้มี admin อย่างน้อย 2 คน"/>
        <SmallStat label="คำเชิญที่รออยู่" value={counts.pending} tone="success" hint={counts.pending ? "ยังไม่ได้เข้าใช้งานครั้งแรก" : "ไม่มีคำเชิญค้าง"}/>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="search" style={{ width: 320 }}>
            <Icons.Search size={14}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาชื่อหรืออีเมล"/>
          </div>
          <div className="seg">
            <button className={roleFilter === "all" ? "on" : ""} onClick={() => setRoleFilter("all")}>ทุกบทบาท</button>
            {ROLES.map(r => (
              <button key={r.id} className={roleFilter === r.id ? "on" : ""} onClick={() => setRoleFilter(r.id)}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-tight">
        <table className="t">
          <thead><tr>
            <th>สมาชิก</th>
            <th>บทบาท</th>
            <th>สถานะ</th>
            <th>เวลาทำการ</th>
            <th>เข้าใช้ล่าสุด</th>
            <th>เริ่มใช้งาน</th>
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {filtered.map(u => {
              const r = ROLES.find(x => x.id === u.role);
              const isMe = u.id === currentUser.id;
              return (
                <tr key={u.id} style={{ opacity: busyId === u.id ? 0.4 : (u.active ? 1 : 0.55), pointerEvents: busyId === u.id ? "none" : "auto" }}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <div className="user-avatar" style={{ background: r.color }}>{u.avatar}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                          {u.name} {isMe && <span className="badge badge-neutral" style={{ marginLeft: 6, fontSize: 9 }}>คุณ</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={"badge " + r.badge} title={r.desc}>
                      <span className="dot" style={{ background: r.color }}/>{r.label}
                    </span>
                  </td>
                  <td>
                    {!u.active ? (
                      <span className="badge badge-neutral"><span className="dot"/>ระงับ</span>
                    ) : u.invited ? (
                      <span className="badge badge-warning" title="ส่งคำเชิญแล้ว รอผู้ใช้ตั้งรหัสผ่านและเข้าใช้งานครั้งแรก">
                        <span className="dot"/>รอเข้าใช้งาน
                      </span>
                    ) : (
                      <span className="badge badge-success"><span className="dot"/>ใช้งานอยู่</span>
                    )}
                  </td>
                  <td><WorkHoursBadge user={u} governed={isGoverned(u.role)} store={store} exceptionToday={exceptionActive(u.id)}/></td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{u.lastSeen}</td>
                  <td style={{ fontSize: 12, color: "var(--muted)" }}>{u.joined}</td>
                  <td style={{ position: "relative" }}>
                    <button className="btn btn-ghost btn-icon" onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === u.id ? null : u.id); }}>
                      <span style={{ fontSize: 16, lineHeight: 0.5 }}>···</span>
                    </button>
                    {openMenu === u.id && (
                      <UserMenu user={u} onChangeRole={(r) => updateRole(u.id, r)} onToggleActive={() => toggleActive(u.id)} onRemove={() => removeUser(u.id)} onClose={() => setOpenMenu(null)}
                        governed={isGoverned(u.role)} exceptionActive={exceptionActive(u.id)}
                        onGrantException={() => grantException(u.id)} onRevokeException={() => revokeException(u.id)}/>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan="7" style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                {loadingUsers ? "กำลังโหลดรายชื่อผู้ใช้…"
                  : loadError ? <span style={{ color: "var(--danger)" }}>โหลดรายชื่อไม่สำเร็จ: {loadError}</span>
                  : "ไม่พบผู้ใช้งาน"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Role reference */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>คำอธิบายสิทธิ์การใช้งาน</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {ROLES.map(r => (
            <div key={r.id} style={{ padding: 14, background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
              <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: r.color }}/>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>{r.desc}</div>
              <div style={{ fontSize: 11, color: "var(--fg-2)", marginTop: 8 }}>
                เข้าถึง: {ROLE_NAV[r.id].length} หน้า
              </div>
            </div>
          ))}
        </div>
      </div>

      {inviteOpen && <InviteUserModal onClose={() => setInviteOpen(false)} onSubmit={inviteUser}/>}
      {schedOpen && setStore && (
        <>
          <div className="drawer-backdrop" onClick={() => setSchedOpen(false)}/>
          <div className="modal" style={{ maxWidth: 680, width: "92%" }}>
            <div className="modal-head">
              <div>
                <h3>เวลาทำการ (ใช้ร่วมกันทุกคน)</h3>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ตารางนี้ใช้กับทุกคนในบทบาทที่เลือก — ยกเว้นรายบุคคลที่ได้รับอนุญาตให้ใช้นอกเวลา</div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setSchedOpen(false)}><Icons.X/></button>
            </div>
            <div className="modal-body">
              <WorkHoursCard store={store} setStore={setStore} pushToast={pushToast}/>
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" onClick={() => setSchedOpen(false)}>เสร็จสิ้น</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* Per-user working-hours status shown in the User Management table. Uses device
   time (informational); real enforcement uses server time elsewhere. */
function WorkHoursBadge({ user, governed, store, exceptionToday }) {
  if (!governed) return <span style={{ fontSize: 12, color: "var(--muted)" }}>ไม่จำกัดเวลา</span>;
  if (exceptionToday) return <span className="badge badge-info" title="ได้รับอนุญาตให้ใช้นอกเวลาถึงสิ้นวันนี้"><span className="dot"/>ใช้นอกเวลา (วันนี้)</span>;
  const st = (typeof workHoursStatusForUser === "function")
    ? workHoursStatusForUser(store, user.role, user.id, Date.now())
    : { allowed: true };
  return st.allowed
    ? <span className="badge badge-success" title="ขณะนี้อยู่ในเวลาทำการ"><span className="dot"/>ในเวลาทำการ</span>
    : <span className="badge badge-warning" title="ขณะนี้อยู่นอกเวลาทำการ"><span className="dot"/>นอกเวลา</span>;
}

function UserMenu({ user, onChangeRole, onToggleActive, onRemove, onClose, governed, exceptionActive, onGrantException, onRevokeException }) {
  const ref = useRefAuth(null);
  useEffectAuth(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)", padding: 6, zIndex: 30, minWidth: 220, animation: "modalin 0.14s ease-out" }}>
      <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 10px 4px", fontWeight: 500 }}>เปลี่ยนบทบาท</div>
      {ROLES.map(r => (
        <button key={r.id} className="popover-item" onClick={() => onChangeRole(r.id)}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: r.color }}/>
          <span style={{ flex: 1 }}>{r.label}</span>
          {user.role === r.id && <Icons.Check size={12} style={{ color: "var(--accent)" }}/>}
        </button>
      ))}
      {governed && (
        <>
          <div className="popover-divider"/>
          <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 10px 4px", fontWeight: 500 }}>เวลาทำการ</div>
          {exceptionActive ? (
            <button className="popover-item" onClick={onRevokeException}>
              <Icons.History size={13}/> ยกเลิกอนุญาตใช้นอกเวลา (วันนี้)
            </button>
          ) : (
            <button className="popover-item" onClick={onGrantException}>
              <Icons.History size={13}/> อนุญาตให้ใช้นอกเวลา (วันนี้)
            </button>
          )}
        </>
      )}
      <div className="popover-divider"/>
      <button className="popover-item" onClick={onToggleActive}>
        <Icons.Refresh size={13}/> {user.active ? "ระงับการใช้งาน" : "เปิดใช้งาน"}
      </button>
      <button className="popover-item danger" onClick={onRemove}>
        <Icons.Trash size={13}/> ลบสมาชิก
      </button>
    </div>
  );
}

function InviteUserModal({ onClose, onSubmit }) {
  const [name,     setName]     = useStateAuth("");
  const [email,    setEmail]    = useStateAuth("");
  const [role,     setRole]     = useStateAuth("staff");
  const [loading,  setLoading]  = useStateAuth(false);
  const [error,    setError]    = useStateAuth("");

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const valid = name.trim() && emailOk;

  const handleSubmit = async () => {
    if (!valid || loading) return;
    setLoading(true);
    setError("");
    const result = await onSubmit({ name: name.trim(), email: email.trim(), role, avatar: name.trim().slice(0, 2) });
    if (result?.error) { setError(result.error); setLoading(false); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h3>เชิญสมาชิกใหม่</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ระบบจะส่งอีเมลเชิญให้สมาชิกตั้งรหัสผ่านเองและเข้าใช้งาน</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} disabled={loading}><Icons.X/></button>
        </div>
        <div className="modal-body">
          <div className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label>ชื่อ-นามสกุล</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="เช่น สมศักดิ์ ใจดี" autoFocus/>
            </div>
            <div className="field">
              <label>อีเมล</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="somsak@example.com"/>
              {email.length > 0 && !emailOk && (
                <span className="hint" style={{ color: "var(--danger)" }}>รูปแบบอีเมลไม่ถูกต้อง</span>
              )}
            </div>
            <div className="field">
              <label>บทบาท</label>
              <div className="stack" style={{ gap: 6 }}>
                {ROLES.map(r => (
                  <div key={r.id}
                    onClick={() => setRole(r.id)}
                    style={{
                      padding: 12,
                      background: role === r.id ? "var(--accent-soft)" : "var(--surface-2)",
                      border: "1px solid " + (role === r.id ? "var(--accent)" : "var(--border)"),
                      borderRadius: 10,
                      cursor: "pointer"
                    }}
                  >
                    <div className="row" style={{ gap: 10 }}>
                      <span className={"check" + (role === r.id ? " on" : "")}/>
                      <span style={{ width: 10, height: 10, borderRadius: 999, background: r.color }}/>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, marginLeft: 42 }}>{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            {error && (
              <div style={{ padding: "10px 12px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 8, fontSize: 12 }}>
                {error}
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={loading}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!valid || loading} onClick={handleSubmit}
            style={(!valid || loading) ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            {loading ? "กำลังส่งคำเชิญ…" : <><Icons.ArrowRight size={14}/> ส่งคำเชิญ</>}
          </button>
        </div>
      </div>
    </>
  );
}

/* ============ LAYOUT CUSTOMIZE PAGE ============ */

function LayoutCustomize({ navItems, setNavItems, pushToast, allNavItems }) {
  const [dragId, setDragId] = useStateAuth(null);
  const [hoverId, setHoverId] = useStateAuth(null);

  const onDragOver = (id) => { if (dragId && dragId !== id) setHoverId(id); };
  const onDrop = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); setHoverId(null); return; }
    setNavItems(items => {
      const next = [...items];
      const fromIdx = next.findIndex(i => i.id === dragId);
      const toIdx = next.findIndex(i => i.id === targetId);
      const [moved] = next.splice(fromIdx, 1);
      const adj = fromIdx < toIdx ? toIdx - 1 : toIdx;
      next.splice(adj + 1, 0, moved);
      return next;
    });
    setDragId(null);
    setHoverId(null);
  };

  const toggle = (id) => setNavItems(items => items.map(i => i.id === id ? { ...i, visible: !i.visible } : i));
  const reset = () => {
    if (!confirm("คืนค่าการจัดเรียงเมนูเป็นค่าเริ่มต้น?")) return;
    setNavItems(allNavItems.map(n => ({ id: n.id, visible: true })));
    pushToast("คืนค่าเริ่มต้นแล้ว");
  };

  const visible = navItems.filter(i => i.visible).length;

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ปรับแต่งเลย์เอาต์</h1>
          <div className="page-sub">เลือกว่าจะให้เมนูใดปรากฏในแถบนำทาง และจัดเรียงตามที่ใช้บ่อย</div>
        </div>
        <div className="row">
          <button className="btn" onClick={reset}><Icons.Refresh size={14}/> คืนค่าเริ่มต้น</button>
          <button className="btn btn-primary" onClick={() => pushToast("บันทึกการตั้งค่าแล้ว")}><Icons.Check size={14}/> บันทึก</button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center" }}>
            <Icons.Check size={20}/>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 600 }} className="tnum">{visible} / {navItems.length}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>เมนูที่แสดงในแถบนำทาง</div>
          </div>
        </div>
        <div className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--info-soft)", color: "var(--info)", display: "grid", placeItems: "center" }}>
            <Icons.Help size={20}/>
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5 }}>
            ลากที่จับด้านซ้ายเพื่อจัดลำดับ ปิดสวิตช์เพื่อซ่อนเมนู<br/>
            การเปลี่ยนแปลงจะบันทึกอัตโนมัติและใช้กับทุกอุปกรณ์
          </div>
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>เมนูในแถบนำทาง</div>
        {navItems.map(item => {
          const def = allNavItems.find(n => n.id === item.id);
          if (!def) return null;
          const Icon = def.icon;
          return (
            <div
              key={item.id}
              className={"reorder-row" + (dragId === item.id ? " dragging" : "") + (hoverId === item.id && dragId !== item.id ? " drop-target" : "")}
              draggable={true}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(item.id); }}
              onDragOver={(e) => { if (dragId && dragId !== item.id) { e.preventDefault(); onDragOver(item.id); } }}
              onDragEnd={() => { setDragId(null); setHoverId(null); }}
              onDrop={(e) => { e.preventDefault(); onDrop(item.id); }}
            >
              <span className="drag-handle">
                <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
                  <circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/>
                  <circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/>
                  <circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/>
                </svg>
              </span>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--surface-2)", color: "var(--fg-2)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon size={16}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{def.label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>หมวด: {NAV_GROUP_LABELS[def.group] || "ทั่วไป"}</div>
              </div>
              <span className={"switch" + (item.visible ? " on" : "")} onClick={() => toggle(item.id)}/>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--warning-soft)", color: "var(--warning)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icons.Warn size={16}/>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>หมายเหตุเรื่องสิทธิ์</div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              การปรับแต่งนี้กำหนดเฉพาะการแสดงผลเท่านั้น สิทธิ์การเข้าถึงจริงจะถูกควบคุมโดยบทบาทของผู้ใช้แต่ละคน — ผู้ใช้บทบาท <strong>พนักงานคลัง</strong> หรือ <strong>ดูเท่านั้น</strong> จะไม่สามารถเข้าถึงเมนูที่อยู่นอกเหนือสิทธิ์ของตน แม้จะเปิดให้แสดง
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const NAV_GROUP_LABELS = {
  main: "ภาพรวม",
  ops: "การดำเนินงาน",
  stock: "สต็อก",
  ship: "การจัดส่ง",
  system: "ระบบ"
};

Object.assign(window, { LoginScreen, ResetPasswordScreen, UserManagement, LayoutCustomize, NAV_GROUP_LABELS });
