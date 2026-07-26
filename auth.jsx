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
  if (/token.*expired|expired.*token|invalid.*token/i.test(m)) return "ลิงก์ตั้งรหัสผ่านหมดอายุ กรุณาขอลิงก์ใหม่";
  if (/session.*missing|auth session|missing.*session/i.test(m)) return "เซสชันสำหรับตั้งรหัสผ่านหมดอายุหรือไม่ถูกต้อง กรุณากด “ลืมรหัสผ่าน?” เพื่อขอลิงก์ใหม่";
  if (/network|fetch|failed to fetch/i.test(m))   return "เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  return "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

/* Friendly Thai message for an auth email-link failure carried back in the URL.
   When a recovery / invite link is expired, already-used, or rejected, Supabase
   redirects with ?error=… / #error=… (error_code + description) and NO session —
   without this the app would silently strand the user on the login screen with
   no idea why and no way to set a password. Surfaced via the login notice. */
function recoveryLinkErrorMsg(code, description) {
  const s = (String(code || "") + " " + String(description || "")).toLowerCase();
  if (/otp_expired|expired|verify_failed/.test(s))
    return "ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว — กรุณากด “ลืมรหัสผ่าน?” เพื่อขอลิงก์ใหม่ (ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด)";
  if (/access_denied|otp_disabled|unauthorized|forbidden/.test(s))
    return "ลิงก์ตั้งรหัสผ่านใช้งานไม่ได้ — กรุณากด “ลืมรหัสผ่าน?” เพื่อขอลิงก์ใหม่อีกครั้ง";
  return "ไม่สามารถเปิดลิงก์ตั้งรหัสผ่านได้ — กรุณากด “ลืมรหัสผ่าน?” เพื่อขอลิงก์ใหม่อีกครั้ง";
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
    // Email a reset LINK; the user clicks it and lands on ResetPasswordScreen to
    // set a new password (Root's recovery-link detection in app.jsx handles it).
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
              <span style={{ fontSize: 11, opacity: 0.8 }}>กดลิงก์ในอีเมลเพื่อตั้งรหัสผ่านใหม่ (ตรวจสอบโฟลเดอร์ spam ด้วย)</span>
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

/* Map a verifyOtp (recovery-code) failure to friendly Thai. Supabase returns
   "Token has expired or is invalid" for BOTH a wrong code and an expired one,
   so the combined case gets a message that covers both. */
function otpErrorToThai(message) {
  const m = String(message || "");
  if (/expired.*invalid|invalid.*expired|token has expired or is invalid/i.test(m))
    return "รหัสไม่ถูกต้องหรือหมดอายุ — ตรวจสอบรหัส OTP ในอีเมล หรือกด “ส่งรหัสอีกครั้ง”";
  if (/expired/i.test(m))                       return "รหัสหมดอายุแล้ว กรุณากด “ส่งรหัสอีกครั้ง” เพื่อขอรหัสใหม่";
  if (/rate|too many|429/i.test(m))             return "ขอรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (/invalid|incorrect|not found|otp|token/i.test(m)) return "รหัสไม่ถูกต้อง ตรวจสอบรหัส OTP ในอีเมลแล้วลองใหม่";
  if (/network|fetch|failed to fetch/i.test(m)) return "เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  return "ยืนยันรหัสไม่สำเร็จ กรุณาตรวจสอบรหัสแล้วลองใหม่อีกครั้ง";
}

/* ============ FORGOT-PASSWORD (OTP CODE) SCREEN ============
   The robust, link-free reset path. The user lands here from the login screen's
   "ลืมรหัสผ่าน?" (which already sent the email). They read the 6-digit code from
   the email and, in one form, enter code + new password: we verifyOtp (type
   "recovery") to establish a session, then updateUser to set the password — no
   email link needed, so nothing breaks if the link expires or is pre-consumed.
   Rendered by Root ABOVE the user/app gate so the session that verifyOtp creates
   can't yank the user into the app before the new password is actually saved. */
function ForgotPasswordScreen({ initialEmail = "", onDone, onCancel }) {
  const email = String(initialEmail || "").trim();
  const [code,     setCode]     = useStateAuth("");
  const [password, setPassword] = useStateAuth("");
  const [confirm,  setConfirm]  = useStateAuth("");
  const [showPw,   setShowPw]   = useStateAuth(false);
  const [loading,  setLoading]  = useStateAuth(false);
  const [error,    setError]    = useStateAuth("");
  const [info,     setInfo]     = useStateAuth("");
  const [done,     setDone]     = useStateAuth(false);
  const [cooldown, setCooldown] = useStateAuth(60);   // a code was just sent on the way in
  const verifiedRef = useRefAuth(false);              // OTP already consumed → don't re-verify on a password-only retry

  // Supabase OTP length is a project setting (6–10 digits) — this project emits
  // 8. Don't hardcode 6: accept the configured length so we never truncate the
  // user's real code (the original bug: an 8-digit code was sliced to 6 → wrong).
  const codeClean = code.replace(/\D/g, "").slice(0, 10);
  const tooShort  = password.length > 0 && password.length < 8;
  const mismatch  = confirm.length > 0 && confirm !== password;
  const valid     = codeClean.length >= 6 && password.length >= 8 && confirm === password;

  // Resend cooldown ticker (Supabase rate-limits recovery emails to 1 / 60s).
  useEffectAuth(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const resend = async () => {
    if (loading || cooldown > 0) return;
    setError(""); setInfo("");
    const { error: err } = await authResetPassword(email);
    if (err) { setError(authErrorToThai(err.message)); return; }
    verifiedRef.current = false;     // a new code invalidates any prior verify
    setInfo("ส่งรหัสใหม่ไปที่อีเมลแล้ว");
    setCooldown(60);
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (loading) return;
    if (codeClean.length < 6) { setError("กรอกรหัส OTP จากอีเมลให้ครบ"); return; }
    if (password.length < 8)    { setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"); return; }
    if (password !== confirm)   { setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน"); return; }
    setLoading(true);
    setError("");
    setInfo("");
    // try/finally so loading is cleared exactly once even on an UNEXPECTED throw
    // (supabase-js normally returns {error}, but a transport-layer exception must
    // not leave the button stuck on "กำลังบันทึก…" with the typed code lost).
    try {
      // (1) Verify the code → establishes the recovery session. Skipped if a prior
      //     attempt already verified, so a password-policy retry doesn't re-send a
      //     single-use, now-consumed code to verifyOtp (which would fail).
      if (!verifiedRef.current) {
        const { error: vErr } = await authVerifyOtp({ email, token: codeClean, type: "recovery" });
        if (vErr) { setError(otpErrorToThai(vErr.message)); return; }
        verifiedRef.current = true;
      }
      // (2) Set the new password on the now-authenticated session.
      const { error: uErr } = await authUpdatePassword(password);
      if (uErr) { setError(authErrorToThai(uErr.message)); return; }
      setDone(true);
    } catch (err) {
      setError(authErrorToThai(err && err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">ค</div>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }}>ตั้งรหัสผ่านใหม่</h1>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            {done ? "เรียบร้อยแล้ว" : <>กรอกรหัส OTP ที่ส่งไปที่ <strong>{email}</strong> แล้วตั้งรหัสผ่านใหม่</>}
          </div>
        </div>

        {done ? (
          <div className="stack" style={{ gap: 14 }}>
            <div style={{ padding: "14px 16px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
              เปลี่ยนรหัสผ่านเรียบร้อยแล้ว ✓<br/>
              <span style={{ fontSize: 11, opacity: 0.8 }}>รหัสผ่านใหม่พร้อมใช้งานแล้ว — กดปุ่มด้านล่างเพื่อเข้าใช้งานต่อ</span>
            </div>
            <button type="button" className="btn btn-accent" style={{ justifyContent: "center" }}
              onClick={() => onDone && onDone()}>
              เข้าสู่ระบบ <Icons.ArrowRight size={14}/>
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="otp-code">รหัส OTP จากอีเมล</label>
              <input
                id="otp-code"
                className="input input-lg"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, "").slice(0, 10)); setError(""); setInfo(""); }}
                placeholder="••••••"
                autoFocus
                maxLength={10}
                style={{ letterSpacing: "0.4em", fontSize: 20, textAlign: "center", fontFamily: "var(--font-mono, monospace)" }}
              />
              <div className="row" style={{ justifyContent: "space-between", marginTop: 2 }}>
                <span className="hint" style={{ color: info ? "var(--success)" : "var(--muted)" }}>
                  {info || "ดูรหัสได้ในอีเมล (และโฟลเดอร์ spam)"}
                </span>
                <a className="lnk"
                   style={{ fontSize: 11, pointerEvents: (cooldown > 0 || loading) ? "none" : "auto", opacity: (cooldown > 0 || loading) ? 0.5 : 1 }}
                   href="#" onClick={(e) => { e.preventDefault(); resend(); }}>
                  {cooldown > 0 ? `ส่งรหัสอีกครั้ง (${cooldown})` : "ส่งรหัสอีกครั้ง"}
                </a>
              </div>
            </div>

            <div className="field">
              <label htmlFor="otp-password">รหัสผ่านใหม่</label>
              <div style={{ position: "relative" }}>
                <input
                  id="otp-password"
                  className="input input-lg"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="อย่างน้อย 8 ตัวอักษร"
                  autoComplete="new-password"
                  style={{ paddingRight: 44 }}
                />
                <button type="button" onClick={() => setShowPw(s => !s)}
                  aria-label={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} title={showPw ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} tabIndex={-1}
                  style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 8, color: "var(--muted)", display: "grid", placeItems: "center", lineHeight: 0 }}>
                  {showPw
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3.5 8 10 8a9.12 9.12 0 0 0 5.39-1.61"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="m2 2 20 20"/></svg>
                    : <Icons.Eye size={16}/>}
                </button>
              </div>
              {tooShort && <span className="hint" style={{ color: "var(--danger)" }}>ต้องมีอย่างน้อย 8 ตัวอักษร</span>}
            </div>

            <div className="field">
              <label htmlFor="otp-confirm">ยืนยันรหัสผ่านใหม่</label>
              <input
                id="otp-confirm"
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

            <button type="submit" className="btn btn-accent" disabled={loading || !valid}
              style={{ padding: "13px 16px", fontSize: 15, justifyContent: "center", marginTop: 6, opacity: (!valid) ? 0.5 : 1 }}>
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

function UserManagement({ currentUser, pushToast, store, setStore, allNav }) {
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
                เข้าถึง: {(typeof roleNav === "function" ? roleNav(r.id) : (ROLE_NAV[r.id] || [])).length} หน้า
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-role permission editor */}
      <RolePermissions currentUser={currentUser} pushToast={pushToast} allNav={allNav}/>

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

/* ── Per-role permission editor (admin only) ──
   An editable overlay on ROLE_NAV + DEFAULT_ROLE_CAPS (data.jsx). Saving writes
   the app_state "role_perms" blob, so every screen — desktop and mobile, on
   every device — re-gates through roleNav()/canDo() without a reload.
   The admin row is deliberately not editable: an admin who unticks
   "ผู้ใช้งานและสิทธิ์" would lock everyone out of this very screen. */
const MOBILE_ONLY_NAV = [
  { id: "adjust", label: "ปรับสต็อก (เมนูมือถือ)", group: "ops" }
];

function RolePermissions({ currentUser, pushToast, allNav }) {
  const navCatalog = [...(allNav || (typeof ALL_NAV !== "undefined" ? ALL_NAV : [])), ...MOBILE_ONLY_NAV];
  const isAdmin = currentUser && currentUser.role === "admin";
  const [role, setRole] = useStateAuth("staff");
  const [draft, setDraft] = useStateAuth(() => {
    const p = typeof loadRolePerms === "function" ? loadRolePerms() : {};
    return { nav: { ...(p.nav || {}) }, caps: { ...(p.caps || {}) } };
  });
  const [dirty, setDirty] = useStateAuth(false);
  const [saving, setSaving] = useStateAuth(false);

  /* Another device (or the initial cloud load) changed the blob — adopt it,
     unless this admin has unsaved edits in front of them. */
  useEffectAuth(() => {
    const h = () => {
      if (dirty) return;
      const p = typeof loadRolePerms === "function" ? loadRolePerms() : {};
      setDraft({ nav: { ...(p.nav || {}) }, caps: { ...(p.caps || {}) } });
    };
    window.addEventListener("ims-perms-change", h);
    return () => window.removeEventListener("ims-perms-change", h);
  }, [dirty]);

  const roleMeta = ROLES.find(r => r.id === role) || ROLES[0];
  const locked = !isAdmin || role === "admin";

  // Effective value for the role being edited: draft override first, default second.
  const capOn = (id) => {
    const ov = draft.caps[role];
    if (ov && typeof ov[id] === "boolean") return ov[id];
    return !!((DEFAULT_ROLE_CAPS[role] || {})[id]);
  };
  const navList = () => Array.isArray(draft.nav[role]) ? draft.nav[role] : (ROLE_NAV[role] || []);
  const navOn = (id) => navList().indexOf(id) !== -1;

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

  const resetRole = () => {
    if (locked) return;
    if (!confirm(`คืนค่าสิทธิ์ของ "${roleMeta.label}" เป็นค่าเริ่มต้น?`)) return;
    setDraft(d => {
      const nav = { ...d.nav }; delete nav[role];
      const caps = { ...d.caps }; delete caps[role];
      return { nav, caps };
    });
    setDirty(true);
  };

  const save = async () => {
    if (!isAdmin || typeof saveRolePerms !== "function" || saving) return;
    setSaving(true);
    const res = await saveRolePerms(draft);
    setSaving(false);
    // A rejected write (RLS drift, offline, outside working hours) rolls the
    // local copy back — say so instead of claiming a save that never landed.
    if (res && res.ok === false) {
      pushToast("บันทึกไม่สำเร็จ: " + (res.error || "ไม่ทราบสาเหตุ") + " — การตั้งค่ายังไม่ถูกใช้งาน");
      return;
    }
    setDirty(false);
    pushToast(res && res.offline ? "บันทึกในเครื่องแล้ว (ยังไม่ได้ซิงค์ขึ้นคลาวด์)" : "บันทึกสิทธิ์ตามตำแหน่งแล้ว");
    if (typeof recordChange === "function") {
      recordChange({
        entity: "settings", action: "update",
        summary: `แก้ไขสิทธิ์ของตำแหน่ง ${roleMeta.label}`,
        note: `หน้า ${navList().length} · ${CAPS.filter(c => capOn(c.id)).length}/${CAPS.length} ความสามารถ`
      });
    }
  };

  const groups = {};
  navCatalog.forEach(n => { (groups[n.group] ||= []).push(n); });

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>ปรับสิทธิ์ตามตำแหน่ง</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            เลือกตำแหน่ง แล้วกำหนดว่าเห็นหน้าไหนและทำอะไรได้บ้าง — มีผลกับทุกคนในตำแหน่งนั้น ทั้งเดสก์ท็อปและมือถือ
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={resetRole} disabled={locked} style={locked ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Refresh size={13}/> คืนค่าเริ่มต้น
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || !isAdmin || saving}
            style={(!dirty || !isAdmin || saving) ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={13}/> {saving ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {ROLES.map(r => (
          <button key={r.id} className={role === r.id ? "on" : ""} onClick={() => setRole(r.id)}>{r.label}</button>
        ))}
      </div>

      {!isAdmin && (
        <div style={{ padding: "10px 12px", background: "var(--warning-soft)", borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
          เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขสิทธิ์ได้ — หน้านี้แสดงค่าปัจจุบันแบบอ่านอย่างเดียว
        </div>
      )}
      {isAdmin && role === "admin" && (
        <div style={{ padding: "10px 12px", background: "var(--accent-soft)", borderRadius: 10, fontSize: 12, marginBottom: 14, color: "var(--accent)" }}>
          ผู้ดูแลระบบมีสิทธิ์ทั้งหมดเสมอ และแก้ไขไม่ได้ เพื่อป้องกันการล็อกตัวเองออกจากหน้านี้
        </div>
      )}
      {dirty && (
        <div style={{ padding: "10px 12px", background: "var(--warning-soft)", borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
          มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก — กด <strong>บันทึก</strong> เพื่อใช้งานจริง
        </div>
      )}

      <div className="grid-2" style={{ gap: 16, alignItems: "start" }}>
        {/* Capabilities */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>ทำอะไรได้บ้าง</div>
          <div className="stack" style={{ gap: 6 }}>
            {CAPS.map(c => {
              const srvLocked = typeof capServerLocked === "function" && capServerLocked(c.id, role);
              const on = capOn(c.id) && !srvLocked;
              const disabled = locked || srvLocked;
              return (
                <button key={c.id} onClick={() => toggleCap(c.id)} disabled={disabled}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", width: "100%",
                    padding: "10px 12px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
                    background: on ? "var(--accent-soft)" : "var(--surface-2)",
                    border: "1px solid " + (on ? "var(--accent-ring)" : "var(--border)"),
                    opacity: disabled ? 0.6 : 1, fontFamily: "inherit", color: "var(--fg)" }}>
                  <span className={"check" + (on ? " on" : "")} style={{ flexShrink: 0, marginTop: 1 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45, marginTop: 2 }}>{c.desc}</div>
                    {srvLocked && (
                      <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 4 }}>
                        ฐานข้อมูลไม่อนุญาตให้ตำแหน่งนี้ทำรายการนี้ (RLS) — เปิดจากหน้านี้ไม่ได้
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Page access */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>เข้าหน้าไหนได้บ้าง ({navList().length} หน้า)</div>
          <div className="stack" style={{ gap: 12 }}>
            {Object.keys(groups).map(g => (
              <div key={g}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginBottom: 6 }}>{NAV_GROUP_LABELS[g] || g}</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {groups[g].map(n => {
                    const on = navOn(n.id);
                    return (
                      <button key={n.id} onClick={() => toggleNav(n.id)} disabled={locked}
                        style={{ display: "flex", gap: 7, alignItems: "center", padding: "7px 11px", borderRadius: 999,
                          cursor: locked ? "not-allowed" : "pointer", fontSize: 12, fontFamily: "inherit",
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
            ))}
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

Object.assign(window, { LoginScreen, ResetPasswordScreen, ForgotPasswordScreen, UserManagement, LayoutCustomize, RolePermissions, MOBILE_ONLY_NAV, NAV_GROUP_LABELS, recoveryLinkErrorMsg });
