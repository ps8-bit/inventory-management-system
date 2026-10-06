/* Dashboard, Inbound, Outbound, Inventory, Locations */

const { useState, useEffect, useRef, useMemo } = React;

/* Catch render errors in a single screen so one broken page shows a
   recoverable message instead of blank-paging the whole app. (No build step
   means a single undefined component would otherwise white-screen everything —
   e.g. the Icons.Spark crash.) Defined here because screens.jsx loads before
   both handheld.jsx and app.jsx, so both routers can wrap their content. */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    try { console.error("[UI] screen crashed:", error, info && info.componentStack); } catch (e) {}
  }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = String((this.state.error && this.state.error.message) || this.state.error || "");
    return (
      <div style={{ padding: this.props.mobile ? "40px 20px" : "56px 24px", textAlign: "center", color: "var(--muted)" }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(220,50,50,0.12)", color: "var(--danger)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
          <Icons.Warn size={26}/>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)", marginBottom: 6 }}>หน้านี้เกิดข้อผิดพลาด</div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>ลองใหม่อีกครั้ง หรือเปลี่ยนไปหน้าอื่น</div>
        {msg && <div style={{ fontSize: 11, fontFamily: "IBM Plex Mono, monospace", opacity: 0.7, marginBottom: 18, wordBreak: "break-word", maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>{msg}</div>}
        <button className="btn btn-accent" onClick={() => this.setState({ error: null })} style={{ marginTop: 8 }}>
          <Icons.Refresh size={14}/> ลองใหม่
        </button>
      </div>
    );
  }
}
if (typeof window !== "undefined") window.ErrorBoundary = ErrorBoundary;

/* ── In-app form dialog (replaces window.prompt) ──────────────────────────────
   prompt() is a grey browser box: tiny on phones, can't show the existing
   names to pick from, and creating a shelf took a chain of three of them.
   askForm() renders a real dialog in its own root and resolves with the
   values (or null on cancel), so plain event handlers can await it. Both the
   desktop screens and handheld.jsx use it (screens.jsx loads first).
     fields: [{ key, label, value, placeholder, options?: (values) => string[],
                type?: "text" | "number", required? }]                         */
function AskFormDialog({ title, message, fields, okLabel, onDone }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(f => [f.key, f.value != null ? String(f.value) : ""])));
  const firstRef = useRef(null);
  useEffect(() => { setTimeout(() => { try { firstRef.current && firstRef.current.focus(); firstRef.current.select && firstRef.current.select(); } catch (e) {} }, 40); }, []);
  const missing = fields.some(f => f.required !== false && !String(vals[f.key] || "").trim());
  const submit = () => {
    if (missing) return;
    const out = {};
    fields.forEach(f => { out[f.key] = String(vals[f.key] || "").trim(); });
    onDone(out);
  };
  return (
    <>
      <div className="drawer-backdrop" onClick={() => onDone(null)} style={{ zIndex: 400 }}/>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: "min(440px, calc(100vw - 24px))", zIndex: 401 }}
        onKeyDown={e => { if (e.key === "Escape") onDone(null); }}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {message && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4, whiteSpace: "pre-line" }}>{message}</div>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={() => onDone(null)} aria-label="ปิด"><Icons.X/></button>
        </div>
        <form className="modal-body" onSubmit={e => { e.preventDefault(); submit(); }}>
          {fields.map((f, i) => {
            const opts = typeof f.options === "function" ? (f.options(vals) || []) : (f.options || []);
            const listId = opts.length ? "ask-" + f.key : undefined;
            return (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{f.label}</label>
                <input ref={i === 0 ? firstRef : undefined} className="input" list={listId}
                  type="text" inputMode={f.type === "number" ? "numeric" : undefined}
                  value={vals[f.key]} placeholder={f.placeholder || ""}
                  onChange={e => setVals(v => ({ ...v, [f.key]: f.type === "number" ? e.target.value.replace(/[^\d]/g, "") : e.target.value }))}
                  style={{ width: "100%", fontSize: 15, padding: "10px 12px" }}/>
                {listId && <datalist id={listId}>{opts.map(o => <option key={o} value={o}/>)}</datalist>}
                {opts.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {opts.slice(0, 12).map(o => (
                      <button type="button" key={o} className={"adj-reason" + (vals[f.key] === o ? " on" : "")}
                        onClick={() => setVals(v => ({ ...v, [f.key]: o }))}>{o}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="submit" style={{ display: "none" }}/>
        </form>
        <div className="modal-foot">
          <button className="btn" onClick={() => onDone(null)}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={missing} onClick={submit}>{okLabel || "บันทึก"}</button>
        </div>
      </div>
    </>
  );
}
function askForm(opts) {
  return new Promise(resolve => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const done = (v) => { resolve(v); setTimeout(() => { try { root.unmount(); } catch (e) {} host.remove(); }, 0); };
    root.render(<AskFormDialog {...opts} onDone={done}/>);
  });
}
/* One text answer — the drop-in for prompt(label, value). null = cancelled. */
async function askText(title, value, extra) {
  const r = await askForm({ title, fields: [{ key: "v", label: (extra && extra.label) || title, value: value || "", placeholder: extra && extra.placeholder, type: extra && extra.type, options: extra && extra.options }], okLabel: extra && extra.okLabel, message: extra && extra.message });
  return r ? r.v : null;
}
/* New storage position in ONE dialog (was three prompts in a row). Existing
   buildings/floors are offered as tap-to-pick chips; typing a new name
   creates it. Resolves the new position code, or null. */
async function askNewPosition() {
  const tree = (typeof loadLocTree === "function") ? loadLocTree() : { buildings: [] };
  const buildings = tree.buildings || [];
  const floorsOf = (bn) => { const b = buildings.find(x => x.name === bn); return b ? (b.floors || []).map(f => f.name) : []; };
  const r = await askForm({
    title: "เพิ่มตำแหน่งจัดเก็บใหม่",
    message: "เลือกอาคาร/ชั้นที่มีอยู่ หรือพิมพ์ชื่อใหม่เพื่อสร้าง",
    fields: [
      { key: "b", label: "อาคาร / โซน", value: buildings[0] ? buildings[0].name : "", options: () => buildings.map(b => b.name) },
      { key: "f", label: "ชั้น", value: (buildings[0] && floorsOf(buildings[0].name)[0]) || "ชั้น 1", options: (v) => floorsOf(v.b) },
      { key: "p", label: "ชื่อตำแหน่ง", placeholder: "เช่น A1, กล่อง 12" }
    ],
    okLabel: "สร้างตำแหน่ง"
  });
  if (!r) return null;
  if (typeof addBuilding === "function") addBuilding(r.b);
  if (typeof addFloor === "function") addFloor(r.b, r.f);
  if (typeof addPosition === "function") addPosition(r.b, r.f, r.p);
  return locCode(r.b, r.f, r.p);
}
Object.assign(window, { askForm, askText, askNewPosition });

/* Dashboard moved to dashboard.jsx (windowed widget board) */

function Kpi({ label, value, sub, delta, spark, warning }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="kpi-value" style={warning ? { color: "var(--danger)" } : {}}>{value}</span>
        {sub && <span style={{ color: "var(--muted)", fontSize: 12 }}>{sub}</span>}
      </div>
      <div className="kpi-delta">{delta}</div>
      {spark && (
        <div className="bars" style={{ marginTop: 6 }}>
          {spark.map((v, i) => <div key={i} className="bar" style={{ height: (v/Math.max(...spark)*100) + "%" }}/>)}
        </div>
      )}
    </div>
  );
}

function ActivityDot({ type }) {
  const map = {
    in:   { bg: "var(--success-soft)", fg: "var(--success)", icon: <Icons.In size={12}/> },
    out:  { bg: "var(--info-soft)",    fg: "var(--info)",    icon: <Icons.Out size={12}/> },
    move: { bg: "var(--surface-3)",    fg: "var(--fg-2)",    icon: <Icons.ArrowRight size={12}/> }
  };
  const s = map[type] || map.move;
  return <div style={{ width: 22, height: 22, borderRadius: 999, background: s.bg, color: s.fg, display: "grid", placeItems: "center" }}>{s.icon}</div>;
}

function Legend({ color, label }) {
  return <div className="row" style={{ gap: 6, fontSize: 11, color: "var(--muted)" }}>
    <div style={{ width: 12, height: 12, borderRadius: 3, background: color, border: "1px solid var(--border)" }}/>
    {label}
  </div>;
}

function MiniWarehouse() {
  // Small dashboard variant of the Building→Floor→Position locations.
  const positions = typeof allPositions === "function" ? allPositions() : [];
  if (!positions.length) {
    const tree = typeof loadLocTree === "function" ? loadLocTree() : { buildings: [] };
    const buildings = tree.buildings || [];
    return (
      <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 2px", lineHeight: 1.7 }}>
        {buildings.length === 0
          ? <div>ยังไม่มีอาคาร</div>
          : buildings.map(b => (
              <div key={b.name}><strong style={{ color: "var(--fg)" }}>{b.name}</strong> · {(b.floors || []).length} ชั้น</div>
            ))}
        <div style={{ marginTop: 6 }}>ยังไม่มีตำแหน่งจัดเก็บ — เพิ่มได้ในหน้า “ตำแหน่งจัดเก็บ”</div>
      </div>
    );
  }
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
      {positions.slice(0, 40).map(p => {
        const n = typeof skusInLocation === "function" ? skusInLocation(p.code) : 0;
        return (
          <div key={p.code} title={p.code} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 9px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{p.pos}</span>
            <span style={{ color: "var(--muted)" }}>{n}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ========= CAMERA BARCODE SCANNER ========= */
/* Two modes, chosen automatically:
   A) Live scan  — getUserMedia + BarcodeDetector/ZXing (needs HTTPS or localhost)
   B) Photo mode — <input capture="environment"> works over plain HTTP on LAN
   Pass onScan(rawValue) and onClose(). */
function CameraScanner({ onScan, onClose, continuous = false }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const timerRef  = useRef(null);
  const trackRef  = useRef(null);
  const lastRef   = useRef({ code: null, streak: 0 });
  const fileRef   = useRef(null);
  const h5qrRef   = useRef(null); // html5-qrcode live-scanner instance
  // Continuous mode: after each decode we pause (don't tear down the camera) and
  // show a "สแกนต่อ" overlay, so receiving many items doesn't bounce out of the
  // scanner. pausedRef gates the decode loop; onScanRef keeps the latest handler.
  const pausedRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [lastScan, setLastScan] = useState(null);
  // Internal scan telemetry (no longer shown on screen) — the decode paths still write
  // to it; harmless and useful if we ever need to surface diagnostics again.
  const dbgRef = useRef({ build: "20260609x", engine: "init", bd: "?", mfr: "?", vid: "-", frames: 0, tries: 0, last: "-", via: "-" });
  const [phase,    setPhase]   = useState("init"); // init | ready | photo | unsupported
  const [errMsg,   setErrMsg]  = useState("");
  const [scanning, setScanning] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn,        setTorchOn]        = useState(false);

  useEffect(() => {
    const isSecure    = window.isSecureContext ||
                        location.hostname === "localhost" ||
                        location.hostname === "127.0.0.1";
    const hasCamera   = !!navigator.mediaDevices?.getUserMedia;
    const hasDetector = "BarcodeDetector" in window;
    const hasZXing    = !!(window.ZXing?.BrowserMultiFormatReader);

    if (!hasDetector && !hasZXing && !window.Html5Qrcode) {
      setPhase("unsupported");
      setErrMsg(
        "เบราว์เซอร์ไม่รองรับการอ่านบาร์โค้ด\n" +
        "แนะนำ Chrome / Edge บน Android หรือ Safari บน iOS\n" +
        "หรือพิมพ์รหัส SKU ในช่องด้านล่างแทนได้เลย"
      );
      return;
    }

    /* Live scanning needs a secure context (HTTPS / localhost) + a camera, plus
       at least one live decode engine. Otherwise (plain-HTTP LAN, no engine) fall
       back to the photo-capture mode, which works everywhere. */
    if (!isSecure || !hasCamera || (!hasDetector && !hasZXing)) {
      setPhase("photo");
      return;
    }

    let dead     = false;
    let zxReader = null;

    const handleCamError = (err) => {
      if (dead) return;
      const name = err?.name || "";
      setPhase("photo");
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setErrMsg(
          "อนุญาตให้ใช้กล้องไม่สำเร็จ\n" +
          "iPhone: Settings → Safari → Camera → Allow\n" +
          "หรือกดปุ่ม 'ถ่ายรูปบาร์โค้ด' ด้านล่าง"
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setErrMsg("ไม่พบกล้องหลัง — กดปุ่มถ่ายรูปด้านล่างแทน");
      } else {
        setErrMsg("เปิดกล้องไม่สำเร็จ (" + (name || "ไม่ทราบสาเหตุ") + ") — กดปุ่มถ่ายรูปด้านล่าง");
      }
    };

    /* Once a stream is attached, grab the rear-camera track to enable continuous
       autofocus (sharper barcodes) and detect torch (flashlight) support. */
    const setupTrack = () => {
      const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
      if (!track) return;
      trackRef.current = track;
      try {
        const caps = track.getCapabilities?.() || {};
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
          track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
        }
        if (caps.torch) setTorchSupported(true);
      } catch (_) {}
    };

    /* Higher resolution helps thin 1D barcode bars resolve — a 720p frame often
       can't separate the bars of an EAN-13 held at arm's length. */
    const CONSTRAINTS = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };

    (async () => {
      try {
        /* ── Engine 1: per-frame capture loop ──
           NOTE: html5-qrcode was tried as the primary engine but it has a well-documented
           failure to decode 1D barcodes on iOS Safari (mebjas/html5-qrcode #484/#512/#618/
           #820/#915) — worked on Android, dead on iPhone. So we use the native BarcodeDetector
           (iOS 17.4+/Android) plus the fixed native-resolution ZXing fallback below, which
           decode 1D + QR on both platforms. ──
           Uses native BarcodeDetector when present (fast, hardware-accelerated),
           and ALWAYS runs the ZXing rotation fallback below — which is what lets us
           read QR codes and 1D barcodes at any orientation. Critically this loop now
           runs even when BarcodeDetector is ABSENT (iOS Safari < 17.4, many desktops),
           so those devices get rotation + QR instead of the old no-rotation path. */
        if (hasDetector || window.ZXing?.MultiFormatReader) {
          const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
          if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;

          const v = videoRef.current;
          if (!v) { stream.getTracks().forEach(t => t.stop()); return; }
          v.srcObject = stream;
          /* iOS Safari needs inline attrs set BEFORE play(); swallow AbortError. */
          v.setAttribute("playsinline", "true");
          v.setAttribute("webkit-playsinline", "true");
          v.muted = true;
          const tryPlay = () => v.play().catch(() => {});
          if (v.readyState >= 1) tryPlay(); else v.onloadedmetadata = tryPlay;
          setupTrack();

          // BarcodeDetector is the fast first-pass when available; otherwise bd stays
          // null and decoding relies entirely on the ZXing rotation fallback below.
          let bd = null;
          if (hasDetector) {
            const FMTS = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39",
                          "code_93","qr_code","data_matrix","itf","aztec","codabar","pdf417"];
            const supported = await BarcodeDetector.getSupportedFormats().catch(() => FMTS);
            const fmts = FMTS.filter(f => supported.includes(f));
            bd = new BarcodeDetector({ formats: fmts.length ? fmts : FMTS });
          }
          dbgRef.current.bd = hasDetector ? "y" : "n";
          dbgRef.current.mfr = (window.ZXing && window.ZXing.MultiFormatReader) ? "y" : "n";
          dbgRef.current.engine = bd ? "frame+BD" : "frame-ZX";

          /* ZXing fallback — runs only on frames where BarcodeDetector finds nothing.
             iOS Safari's BarcodeDetector frequently fails to decode 1D bars (EAN/Code128)
             even when sharp; ZXing reliably reads them from the same captured frame. */
          const fCanvas = document.createElement("canvas");
          const fCtx    = fCanvas.getContext("2d", { willReadFrequently: true });
          // TRY_HARDER only — letting MultiFormatReader consider ALL formats (1D + QR +
          // DataMatrix). Setting POSSIBLE_FORMATS here silently breaks decoding in this
          // ZXing build, which is why QR + rotated 1D never read before.
          let zCapable = false, zHints = null;
          if (window.ZXing?.MultiFormatReader) {
            try {
              zHints = new Map();
              zHints.set(ZXing.DecodeHintType.TRY_HARDER, true);
              zCapable = true;
            } catch (_) { zCapable = false; }
          }

          /* Decode the current video frame with ZXing at a given rotation (0/90/180/270°).
             ZXing's 1D reader only scans horizontal pixel rows, so a barcode turned 90°
             runs parallel to the scan lines and never decodes. Rotating the frame lets us
             read bars at any orientation. The frame is also downscaled (longest side ~1024px)
             so multiple rotations stay fast enough to run every tick. */
          // Draw the current frame rotated by deg into fCanvas; returns the canvas.
          // Decode at NATIVE resolution — the old 1024px downscale aliased a 1D barcode's
          // thin bars below ZXing's threshold, so real-camera frames never decoded even
          // though clean full-size test images did. (Verified: 1920→1024 fails for 2/3/4px
          // bar widths; native decodes all.)
          // Decode the central 84% of the frame (where the user aims) at NATIVE pixel
          // density — smaller area = each rotation decodes ~2x faster, so all 4 rotations
          // finish within a frame and the "horizontal" orientation actually gets caught,
          // while bars stay sharp (no downscale aliasing).
          const CROP = 0.84;
          const renderRotated = (vid, deg) => {
            const vw = vid.videoWidth || 640, vh = vid.videoHeight || 480;
            const cw0 = Math.round(vw * CROP), ch0 = Math.round(vh * CROP);
            const sx = Math.round((vw - cw0) / 2), sy = Math.round((vh - ch0) / 2);
            const swap = (deg === 90 || deg === 270);
            const cw = swap ? ch0 : cw0, ch = swap ? cw0 : ch0;
            if (fCanvas.width !== cw)  fCanvas.width  = cw;
            if (fCanvas.height !== ch) fCanvas.height = ch;
            fCtx.setTransform(1, 0, 0, 1, 0, 0);
            fCtx.clearRect(0, 0, cw, ch);
            fCtx.save();
            if (deg === 90)       { fCtx.translate(cw, 0);  fCtx.rotate(Math.PI / 2); }
            else if (deg === 180) { fCtx.translate(cw, ch); fCtx.rotate(Math.PI); }
            else if (deg === 270) { fCtx.translate(0, ch);  fCtx.rotate(-Math.PI / 2); }
            fCtx.drawImage(vid, sx, sy, cw0, ch0, 0, 0, cw0, ch0);
            fCtx.restore();
            return fCanvas;
          };
          // ZXing decode of a canvas. Fresh reader each attempt (a reused MultiFormatReader
          // gets poisoned after a NotFound); hints via setHints() (decode(bmp, hints) no-ops
          // in this build). Single Hybrid binarizer — halves per-rotation cost so all 4
          // rotations finish in time (GlobalHistogram rarely added a real-world hit and
          // doubled the time, which was starving the rotation that reads the other axis).
          const zxDecode = (canvas) => {
            if (!zCapable) return null;
            try {
              const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
              const reader = new ZXing.MultiFormatReader();
              reader.setHints(zHints);
              return reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum))).getText();
            } catch (_) { return null; }
          };

          setPhase("ready");
          let scanBusy = false;
          const finish = (value) => {
            if (!value || dead) return;
            if (continuous) {
              // Pause (keep camera live) and surface the result; user taps สแกนต่อ.
              pausedRef.current = true;
              try { if (typeof playScanBeep === "function") playScanBeep(); } catch (_) {}
              setLastScan(value);
              try { onScanRef.current(value); } catch (_) {}
              return;
            }
            dead = true;
            clearInterval(timerRef.current);
            streamRef.current?.getTracks().forEach(t => t.stop());
            onScanRef.current(value);
          };
          const scan = async () => {
            if (dead || scanBusy || pausedRef.current) return;
            const vid = videoRef.current;
            if (!vid || vid.readyState < 2 || vid.paused) return;
            scanBusy = true;
            try {
              /* 1. Native BarcodeDetector straight on the <video> — fastest path
                    (hardware), reads the orientation the OS handles with no canvas work. */
              let value = null;
              if (bd) {
                try {
                  const hits = await bd.detect(vid);
                  if (hits.length) { value = hits[0].rawValue; dbgRef.current.via = "bd-vid"; }
                } catch (_) {}
              }

              /* 2. Native BarcodeDetector on ROTATED frames — still hardware-fast (~25ms),
                    reads a SIDEWAYS / upside-down barcode while the phone stays upright.
                    90°/270° (the sideways cases) first since that's the common one. */
              if (!value && bd) {
                for (const deg of [90, 270, 180]) {
                  try {
                    const h = await bd.detect(renderRotated(vid, deg));
                    if (h.length) { value = h[0].rawValue; dbgRef.current.via = "bd-" + deg; break; }
                  } catch (_) {}
                }
              }

              /* 3. ZXing fallback on rotated frames — only when the native detector can't
                    read it at all (older iOS, unusual symbologies). Slower, so it runs last. */
              if (!value && zCapable) {
                for (const deg of [0, 90, 270, 180]) {
                  value = zxDecode(renderRotated(vid, deg));
                  if (value) { dbgRef.current.via = "zx-" + deg; break; }
                }
              }

              dbgRef.current.vid = (vid.videoWidth || 0) + "x" + (vid.videoHeight || 0);
              dbgRef.current.frames = (dbgRef.current.frames || 0) + 1;
              if (value) { dbgRef.current.tries++; dbgRef.current.last = String(value); }
              finish(value);
            } catch (_) {}
            scanBusy = false;
          };
          timerRef.current = setInterval(scan, 140);
          return;
        }

        /* ── Engine 2: ZXing live loop — Firefox, iOS < 17.4, browsers w/o BarcodeDetector ──
           Delegate to the library's own video decoder. It captures frames and converts
           luminance correctly; the previous hand-rolled RGBLuminanceSource path fed it
           raw RGBA bytes and almost never decoded. */
        const v = videoRef.current;
        if (!v) return;
        dbgRef.current.engine = "live-ZX"; dbgRef.current.bd = "n";
        dbgRef.current.mfr = (window.ZXing && window.ZXing.MultiFormatReader) ? "y" : "n";
        v.setAttribute("playsinline", "true");
        v.setAttribute("webkit-playsinline", "true");
        v.addEventListener("playing", () => { if (!dead) { setupTrack(); setPhase("ready"); } }, { once: true });

        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        zxReader = new ZXing.BrowserMultiFormatReader(hints, 250);
        zxReader.decodeFromConstraints(CONSTRAINTS, v, (result) => {
          if (!result || dead || pausedRef.current) return;
          if (continuous) {
            pausedRef.current = true;
            try { if (typeof playScanBeep === "function") playScanBeep(); } catch (_) {}
            setLastScan(result.getText());
            try { onScanRef.current(result.getText()); } catch (_) {}
            return;
          }
          dead = true;
          try { zxReader.reset(); } catch (_) {}
          onScanRef.current(result.getText());
        }).catch(handleCamError);

      } catch (err) {
        handleCamError(err);
      }
    })();

    return () => {
      dead = true;
      clearInterval(timerRef.current);
      try { zxReader?.reset(); } catch (_) {}
      const h5 = h5qrRef.current; h5qrRef.current = null;
      if (h5) {
        try { h5.stop().then(() => { try { h5.clear(); } catch (_) {} }, () => { try { h5.clear(); } catch (_) {} }); }
        catch (_) { try { h5.clear(); } catch (_) {} }
      }
      try { trackRef.current?.stop?.(); } catch (_) {}
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const toggleTorch = async () => {
    const h5 = h5qrRef.current;
    const next = !torchOn;
    try {
      if (h5 && typeof h5.applyVideoConstraints === "function") {
        await h5.applyVideoConstraints({ advanced: [{ torch: next }] });
      } else if (trackRef.current) {
        await trackRef.current.applyConstraints({ advanced: [{ torch: next }] });
      } else return;
      setTorchOn(next);
    } catch (_) {}
  };

  // Continuous mode: clear the result + resume the html5-qrcode live scan.
  const resumeScan = () => {
    pausedRef.current = false;
    setLastScan(null);
    try { h5qrRef.current && h5qrRef.current.resume(); } catch (_) {}
  };

  /* Decode a photo File.
     1. BarcodeDetector — native, fast, handles orientation automatically
     2. html5-qrcode    — ZXing-based, handles EXIF rotation                 */
  const decodeImageFile = async (file, onProgress) => {
    onProgress?.("กำลังวิเคราะห์ภาพ…");

    /* 1. BarcodeDetector */
    if ("BarcodeDetector" in window) {
      try {
        const bitmap = await createImageBitmap(file);
        const bd     = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e",
          "code_128","code_39","code_93","qr_code","data_matrix","itf","aztec","codabar","pdf417"] });
        const hits   = await bd.detect(bitmap);
        bitmap.close();
        if (hits.length) return hits[0].rawValue;
      } catch (_) {}
    }

    /* 2. ZXing direct image decode (TRY_HARDER) — handles EXIF rotation itself */
    if (window.ZXing?.BrowserMultiFormatReader) {
      const url = URL.createObjectURL(file);
      try {
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        const reader = new ZXing.BrowserMultiFormatReader(hints);
        const res = await reader.decodeFromImageUrl(url);
        try { reader.reset(); } catch (_) {}
        if (res) return res.getText();
      } catch (_) {} finally { URL.revokeObjectURL(url); }
    }

    /* 3. html5-qrcode */
    if (window.Html5Qrcode) {
      try {
        const scanner = new Html5Qrcode("__h5qr__", { verbose: false });
        return await scanner.scanFile(file, false);
      } catch (_) {}
    }

    return null;
  };

  const [scanProgress, setScanProgress] = useState("");
  const [scanDebug, setScanDebug] = useState("");

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true); setErrMsg(""); setScanProgress("กำลังโหลดภาพ…"); setScanDebug("");
    const t0 = performance.now();
    const val = await decodeImageFile(file, setScanProgress);
    const elapsed = Math.round(performance.now() - t0);
    if (val) { onScan(val); return; }
    setScanning(false);
    setScanProgress("");
    /* Show debug info to help diagnose why detection failed */
    setScanDebug(
      `${file.type || "?"} · ${(file.size/1024).toFixed(0)} KB · ` +
      `BarcodeDetector ${"BarcodeDetector" in window ? "✓" : "✗"} · ` +
      `ZXing ${window.ZXing ? "✓" : "✗"} · ` +
      `html5-qrcode ${window.Html5Qrcode ? "✓" : "✗"} · ` +
      `เวลา ${elapsed}ms`
    );
    setErrMsg("ไม่พบบาร์โค้ดในภาพ — ลองถ่ายให้ใกล้ขึ้น ชัดขึ้น หรือเปิดไฟมากขึ้น");
    if (fileRef.current) fileRef.current.value = "";
  };

  const corners = [
    { top:0, left:0, borderTop:"3px solid #fff", borderLeft:"3px solid #fff", borderRadius:"4px 0 0 0" },
    { top:0, right:0, borderTop:"3px solid #fff", borderRight:"3px solid #fff", borderRadius:"0 4px 0 0" },
    { bottom:0, left:0, borderBottom:"3px solid #fff", borderLeft:"3px solid #fff", borderRadius:"0 0 0 4px" },
    { bottom:0, right:0, borderBottom:"3px solid #fff", borderRight:"3px solid #fff", borderRadius:"0 0 4px 0" },
  ];

  // Render through a portal to <body> so the full-screen overlay can't be trapped
  // inside a transformed/filtered ancestor (which would render it inline).
  return ReactDOM.createPortal((
    <div style={{ position:"fixed", inset:0, zIndex:99999, background:"rgba(0,0,0,0.93)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, padding:16 }}>

      {/* Continuous-scan pause overlay — shown after each decode; tap สแกนต่อ to keep going */}
      {continuous && lastScan && (
        <div style={{ position:"absolute", inset:0, zIndex:5, background:"rgba(0,0,0,0.82)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20, padding:24 }}>
          <div style={{ width:64, height:64, borderRadius:"50%", background:"rgba(70,200,120,0.18)", border:"2px solid rgba(70,200,120,0.7)", display:"grid", placeItems:"center", color:"#5fd28a", fontSize:30 }}>✓</div>
          <div style={{ textAlign:"center" }}>
            <div style={{ color:"rgba(255,255,255,0.55)", fontSize:13, marginBottom:6 }}>สแกนแล้ว — เพิ่มเข้ารายการ</div>
            <div style={{ color:"#fff", fontSize:22, fontWeight:700, fontFamily:"'IBM Plex Mono', monospace", letterSpacing:"0.04em", wordBreak:"break-all", maxWidth:420 }}>{lastScan}</div>
          </div>
          <div style={{ display:"flex", gap:12, width:"100%", maxWidth:420 }}>
            <button onClick={onClose} style={{ flex:1, padding:"15px 0", borderRadius:14, background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.25)", color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer" }}>เสร็จสิ้น</button>
            <button onClick={resumeScan} style={{ flex:2, padding:"15px 0", borderRadius:14, background:"#fff", border:"none", color:"#111", fontSize:16, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 18px rgba(255,255,255,0.25)" }}>📷 สแกนต่อ</button>
          </div>
        </div>
      )}

      {/* Mode A: live viewfinder (HTTPS / localhost only) */}
      {(phase === "init" || phase === "ready") && (
        <div style={{ position:"relative", width:"100%", maxWidth:520, borderRadius:16, overflow:"hidden", background:"#111", minHeight:200 }}>
          <video ref={videoRef} muted playsInline autoPlay style={{ width:"100%", display:"block", borderRadius:16 }}/>
          {phase === "ready" && (
            <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
              <div style={{ position:"relative", width:"68%", height:110 }}>
                {corners.map((s,i) => <div key={i} style={{ position:"absolute", width:26, height:26, ...s }}/>)}
                <div style={{ position:"absolute", left:6, right:6, height:2, background:"rgba(255,80,80,0.9)", boxShadow:"0 0 10px rgba(255,80,80,0.7)", animation:"camScan 1.8s ease-in-out infinite" }}/>
              </div>
            </div>
          )}
          {phase === "init" && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, background:"rgba(0,0,0,0.55)" }}>
              <div style={{ width:30, height:30, border:"3px solid rgba(255,255,255,0.2)", borderTopColor:"white", borderRadius:"50%", animation:"spin 0.7s linear infinite" }}/>
              <div style={{ color:"rgba(255,255,255,0.6)", fontSize:13 }}>กำลังเปิดกล้อง…</div>
            </div>
          )}
          {phase === "ready" && torchSupported && (
            <button
              onClick={toggleTorch}
              style={{ position:"absolute", bottom:12, right:12, width:46, height:46, borderRadius:"50%",
                background: torchOn ? "rgba(255,210,80,0.95)" : "rgba(0,0,0,0.5)",
                border:"1px solid rgba(255,255,255,0.35)", color: torchOn ? "#111" : "#fff",
                fontSize:20, cursor:"pointer", lineHeight:1 }}
              title="เปิด/ปิดไฟฉาย"
            >🔦</button>
          )}
        </div>
      )}

      {/* Mode B: photo capture (iOS always uses this) */}
      {phase === "photo" && (
        <div style={{ width:"100%", maxWidth:420, textAlign:"center" }}>
          <div style={{ fontSize:64, marginBottom:8, lineHeight:1 }}>📷</div>
          <div style={{ color:"white", fontSize:18, fontWeight:700, marginBottom:6 }}>กดปุ่มด้านล่าง → ถ่ายบาร์โค้ด</div>
          <div style={{ color:"rgba(255,255,255,0.55)", fontSize:13, marginBottom:24, lineHeight:1.8 }}>
            เล็งกล้องให้บาร์โค้ดอยู่ตรงกลาง ชัดเจน ไม่สั่น<br/>
            รองรับ EAN-13 · Code 128 · QR Code · และอื่นๆ
          </div>
          {errMsg && (
            <div style={{ padding:"12px 16px", background:"rgba(255,80,80,0.15)", border:"1px solid rgba(255,80,80,0.4)", borderRadius:12, color:"#ffaaaa", fontSize:13, marginBottom:14, lineHeight:1.6 }}>
              ⚠️ {errMsg}<br/>
              <span style={{ fontSize:11, opacity:0.7 }}>ลองถ่ายใหม่ ให้บาร์โค้ดชัดและตั้งตรง</span>
              {scanDebug && (
                <div style={{ fontSize:10, opacity:0.5, marginTop:8, fontFamily:"monospace", letterSpacing:0.3 }}>
                  {scanDebug}
                </div>
              )}
            </div>
          )}
          {scanning && scanProgress && (
            <div style={{ padding:"10px 14px", background:"rgba(120,180,255,0.15)", border:"1px solid rgba(120,180,255,0.4)", borderRadius:10, color:"#aaccff", fontSize:12, marginBottom:14, lineHeight:1.5 }}>
              ⏳ {scanProgress}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handlePhoto}/>
          <button
            onClick={() => { setErrMsg(""); fileRef.current?.click(); }}
            disabled={scanning}
            style={{ padding:"18px 0", borderRadius:999,
              background: scanning ? "#333" : "white",
              color: scanning ? "#888" : "#111",
              border:"none", fontSize:17, fontWeight:700,
              cursor: scanning ? "default" : "pointer",
              width:"100%", transition:"background 0.15s",
              boxShadow: scanning ? "none" : "0 4px 20px rgba(255,255,255,0.2)" }}
          >
            {scanning ? "⏳  กำลังวิเคราะห์ภาพ…" : "📸  เปิดกล้องสแกน"}
          </button>
          <div style={{ color:"rgba(255,255,255,0.3)", fontSize:11, marginTop:14 }}>
            iPhone: ถ่ายรูปปกติ → ระบบอ่านบาร์โค้ดให้อัตโนมัติ
          </div>
        </div>
      )}

      {/* Hard error: no decode engine available */}
      {phase === "unsupported" && (
        <div style={{ padding:"36px 24px", textAlign:"center", maxWidth:360 }}>
          <Icons.Scan size={36} style={{ color:"#555", marginBottom:12 }}/>
          {errMsg.split("\n").map((l,i) => (
            <div key={i} style={{ color:i===0?"#ccc":"#888", fontSize:i===0?14:12, marginTop:i===0?0:6, lineHeight:1.6 }}>{l}</div>
          ))}
        </div>
      )}

      {phase === "ready" && (
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", textAlign:"center" }}>
          จ่อบาร์โค้ด / QR code ให้อยู่ในกรอบ — ตรวจจับอัตโนมัติ
        </div>
      )}
      <button
        onClick={onClose}
        style={{ padding:"9px 28px", borderRadius:999, background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"white", fontSize:14, cursor:"pointer" }}
      >✕ ปิดกล้อง</button>
      {/* Hidden mount point required by html5-qrcode's scanFile() fallback */}
      <div id="__h5qr__" style={{ display:"none" }}/>
      <style>{`@keyframes camScan{0%,100%{top:8%}50%{top:80%}} @keyframes spin{to{transform:rotate(360deg)}}
        #h5qr-live{border:none!important}
        #h5qr-live video{width:100%!important;height:auto!important;display:block!important;border-radius:16px}
        #h5qr-live img{display:none!important}
        #h5qr-live::part(*){display:none}`}</style>
    </div>
  ), document.body);
}

/* ========= INBOUND ========= */
/* ── Quick-add modal: register an unknown barcode and receive it in one step ── */
/* Reusable "read product name from a photo" button (AI OCR → fills the field).
   Prevents typos when naming a new SKU. Used in every create-product form on
   BOTH desktop and mobile. onResult receives { name, code }. */
function OcrNameButton({ onResult, mobile }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = () => { setErr(""); if (fileRef.current) fileRef.current.click(); };
  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setErr("");
    try {
      if (typeof readProductNameFromImage !== "function") throw new Error("ฟีเจอร์ยังไม่พร้อม");
      const r = await readProductNameFromImage(file);
      if (r && r.name) onResult(r);
      else setErr("อ่านชื่อไม่ได้ — ถ่ายให้ชัดขึ้น");
    } catch (e2) { setErr(String((e2 && e2.message) || e2)); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {err && <span style={{ fontSize: 11, color: "var(--danger)" }}>{err}</span>}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFile}/>
      <button type="button" onClick={pick} disabled={busy} title="ถ่ายรูป/เลือกรูปป้ายสินค้าเพื่ออ่านชื่ออัตโนมัติ"
        className={mobile ? "m-chip" : "btn btn-sm"} style={{ gap: 6, opacity: busy ? 0.7 : 1 }}>
        <Icons.Camera size={13}/> {busy ? "กำลังอ่าน…" : "อ่านชื่อจากรูป"}
      </button>
    </span>
  );
}

/* ── Position dropdown fed by the live location tree (อาคาร → ชั้น → ตำแหน่ง) ──
   Replaces free-typed loc fields in the add/receive forms so a product can only
   land on a REAL position — or create one right here (＋ เพิ่มตำแหน่งใหม่…)
   without a trip to the ตำแหน่งจัดเก็บ page. Values are full loc codes;
   "" = unstored. A legacy/unknown current value stays selectable (ค่าเดิม)
   so opening an old record never silently rewrites it. Shared by desktop and
   the m-* fork (mobile prop only switches the input class). */
function LocationSelect({ value, onChange, mobile, noneLabel, allowNone = true, disabled, className, style }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    // Another tab / device can grow the tree while this form is open.
    const h = () => setTick(n => n + 1);
    window.addEventListener("ims-locations-change", h);
    return () => window.removeEventListener("ims-locations-change", h);
  }, []);
  const tree = (typeof loadLocTree === "function") ? loadLocTree() : { buildings: [] };
  const buildings = tree.buildings || [];
  const known = new Set(typeof allLocationCodes === "function" ? allLocationCodes() : []);
  const val = value || "";

  // One dialog (askNewPosition) instead of the old three-prompt chain.
  const createNew = async () => {
    const code = await askNewPosition();
    if (code) onChange(code);
  };

  const handle = (e) => {
    const v = e.target.value;
    if (v === "__new__") { e.target.value = val; createNew(); return; }
    onChange(v);
  };

  return (
    <select className={className || (mobile ? "m-input" : "input")} value={val} onChange={handle} disabled={disabled} style={style}>
      {allowNone && <option value="">{noneLabel || "— ยังไม่จัดเก็บ —"}</option>}
      {val && !known.has(val) && <option value={val}>ค่าเดิม: {val}</option>}
      {buildings.map(b => (b.floors || []).map(f => (
        <optgroup key={b.name + "|" + f.name} label={`${b.name} · ${f.name}`}>
          {(f.positions || []).map(p => {
            const code = locCode(b.name, f.name, p);
            return <option key={code} value={code}>{p}</option>;
          })}
        </optgroup>
      )))}
      <option value="__new__">＋ เพิ่มตำแหน่งใหม่…</option>
    </select>
  );
}

function QuickAddInboundModal({ sku, onConfirm, onClose, mobile, prefill }) {
  const cats      = useMemo(() => typeof loadCategories === "function" ? loadCategories() : [...new Set(PRODUCTS.map(p => p.cat))].filter(Boolean).sort(), []);
  const suppliers = useMemo(() => [...new Set(PRODUCTS.map(p => p.supplier))].filter(Boolean).sort(), []);
  const brands    = useMemo(() => [...new Set(PRODUCTS.map(p => p.brand))].filter(Boolean).sort(), []);
  // When the scanned SKU was found in the WooCommerce reference catalog, prefill
  // name / category / price (and remember the image) so nothing is typed by hand.
  const fromWoo = !!(prefill && (prefill.name || prefill.image || prefill.price));
  const [name,     setName]     = useState(prefill?.name || "");
  const [cat,      setCat]      = useState(prefill?.cat || cats[0] || "ทั่วไป");
  const [brand,    setBrand]    = useState(prefill?.brand || (typeof guessBrandFromSku === "function" ? guessBrandFromSku(sku) : ""));
  // Start from the shelf this device received into last — a scan session
  // usually lands in one place, and a blank shelf left the new product unstored.
  const [loc,      setLoc]      = useState(() => (typeof lastReceiveLoc === "function" ? lastReceiveLoc() : ""));
  const [price,    setPrice]    = useState(prefill?.price ? String(prefill.price) : "");
  const [reorder,  setReorder]  = useState("2");   // was 30 — typical stock is ~4, so 30 flagged most SKUs as low
  const [supplier, setSupplier] = useState(suppliers[0] || "");
  const [qty,      setQty]      = useState("1");
  const nameRef = useRef(null);
  useEffect(() => { setTimeout(() => nameRef.current?.focus(), 60); }, []);

  const canSave = name.trim() && (parseInt(qty) > 0);

  const confirm = () => {
    if (!canSave) { nameRef.current?.focus(); return; }
    const catVal = (cat || "").trim() || "ทั่วไป";
    // Register a brand-new category typed here so it persists + syncs to the
    // shared list (addCategory no-ops if it already exists).
    if (typeof addCategory === "function") { try { addCategory(catVal); } catch (e) {} }
    if (typeof rememberReceiveLoc === "function") rememberReceiveLoc(loc);
    const product = {
      sku,
      name:     name.trim(),
      cat:      catVal,
      brand:    brand.trim() || "",
      // A real tree code from LocationSelect — never case-mangle it. "—" keeps
      // the established not-stored sentinel.
      loc:      (loc || "").trim() || "—",
      price:    parseFloat(price) || 0,
      cost:     Math.round((parseFloat(price) || 0) * 0.6),
      qty:      0,          // start at 0; receiving adds on top
      reserved: 0,
      reorder:  Number.isFinite(parseInt(reorder)) ? Math.max(0, parseInt(reorder)) : 2,
      supplier: supplier.trim() || "ไม่ระบุ",
    };
    // Carry over the WooCommerce product image (a remote URL renders fine in
    // <img> across the app). Set before onConfirm so the new product shows it.
    if (fromWoo && prefill.image && typeof setProductImage === "function") {
      try { setProductImage(sku, prefill.image); } catch (e) {}
    }
    onConfirm(product, parseInt(qty) || 1);
  };

  // "Pulled from WooCommerce" banner (shown above the form on both views).
  const wooBanner = fromWoo ? (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: mobile ? "8px 10px" : "10px 12px",
                  background: "var(--accent-soft, var(--surface-2))", border: "1.5px solid var(--accent)", borderRadius: 12 }}>
      {prefill.image ? (
        <img src={prefill.image} alt="" onError={e => { e.target.style.display = "none"; }}
          style={{ width: mobile ? 40 : 48, height: mobile ? 40 : 48, borderRadius: 8, objectFit: "cover",
                   background: "#fff", flexShrink: 0, border: "1px solid var(--border)" }}/>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: mobile ? 11.5 : 12.5, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}>
          <Icons.Check size={mobile ? 12 : 14}/> ดึงข้อมูลจากแคตตาล็อก WooCommerce
        </div>
        <div style={{ fontSize: mobile ? 10.5 : 11.5, color: "var(--muted)", marginTop: 1 }}>เติมชื่อ · หมวดหมู่ · ราคา ให้อัตโนมัติ — ตรวจสอบแล้วบันทึกได้เลย</div>
      </div>
    </div>
  ) : null;

  const fields = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {wooBanner}
      <div className="field">
        <label>รหัส SKU</label>
        <input className={mobile ? "m-input mono" : "input mono"} value={sku} readOnly
          style={{ fontFamily: "IBM Plex Mono, monospace", background: "var(--surface-2)", color: "var(--muted)" }}/>
      </div>
      <div className="field">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <label>ชื่อสินค้า <span style={{ color: "var(--danger)" }}>*</span></label>
          <OcrNameButton onResult={r => setName(r.name)}/>
        </div>
        <input ref={nameRef} className={mobile ? "m-input" : "input"} value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") confirm(); }}
          placeholder="เช่น กระเป๋าเป้ลายพราง 30L"/>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>หมวดหมู่</label>
          <input className={mobile ? "m-input" : "input"} value={cat} onChange={e => setCat(e.target.value)}
            placeholder="พิมพ์เพื่อค้นหา หรือเพิ่มหมวดหมู่ใหม่" list="qa-cats"/>
          <datalist id="qa-cats">
            {cats.map(c => <option key={c} value={c}/>)}
            <option value="ทั่วไป"/>
          </datalist>
        </div>
        <div className="field">
          <label>ตำแหน่งจัดเก็บ</label>
          <LocationSelect value={loc} onChange={setLoc} noneLabel="— เลือกตำแหน่ง (ไม่บังคับ) —"/>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>ราคาขาย (฿)</label>
          <input className={mobile ? "m-input" : "input"} type="number" min="0" value={price}
            onChange={e => setPrice(e.target.value)} placeholder="0" style={{ textAlign: "right" }}/>
        </div>
        <div className="field">
          <label>จุดสั่งซื้อใหม่</label>
          <input className={mobile ? "m-input" : "input"} type="number" min="0" value={reorder}
            onChange={e => setReorder(e.target.value)} style={{ textAlign: "right" }}/>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>แบรนด์</label>
          <input className={mobile ? "m-input" : "input"} value={brand}
            onChange={e => setBrand(e.target.value)} placeholder="เช่น 5.11, PS TACTICAL" list="qa-brands"/>
          <datalist id="qa-brands">{brands.map(b => <option key={b} value={b}/>)}</datalist>
        </div>
        <div className="field">
          <label>ผู้จัดส่ง</label>
          <input className={mobile ? "m-input" : "input"} value={supplier}
            onChange={e => setSupplier(e.target.value)} placeholder="ชื่อ supplier"/>
        </div>
      </div>
      <div style={{ padding: "14px 16px", background: "var(--accent-soft,var(--surface-2))", borderRadius: 12,
                    border: "1.5px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>จำนวนรับเข้าครั้งนี้</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>จะถูกเพิ่มในรายการรับเข้าทันที</div>
        </div>
        <input className={mobile ? "m-input" : "input"} type="number" min="1" value={qty}
          onChange={e => setQty(e.target.value)}
          style={{ width: 80, textAlign: "center", fontWeight: 700, fontSize: 18 }}/>
      </div>
    </div>
  );

  /* ── Mobile: render as scrollable bottom sheet ── */
  if (mobile) return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ bottom: 84, maxHeight: "68vh", borderRadius: 22, display: "flex", flexDirection: "column" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head" style={{ flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>เพิ่มสินค้าใหม่ + รับเข้า</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              <span className="mono">{sku}</span> ยังไม่มีในระบบ
            </div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          {/* Compact mobile fields — only essentials up front, rest below */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {wooBanner}
            <div className="field" style={{ marginBottom: 0 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: 11 }}>ชื่อสินค้า *</label>
                <OcrNameButton mobile onResult={r => setName(r.name)}/>
              </div>
              <input ref={nameRef} className="m-input" value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") confirm(); }}
                placeholder="เช่น กระเป๋าเป้ลายพราง 30L"/>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11 }}>หมวดหมู่</label>
                <select className="m-input" value={cat} onChange={e => setCat(e.target.value)}>
                  {cat && !cats.includes(cat) && cat !== "ทั่วไป" && <option value={cat}>{cat}</option>}
                  {cats.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="ทั่วไป">ทั่วไป</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11 }}>ตำแหน่งจัดเก็บ</label>
                <LocationSelect mobile value={loc} onChange={setLoc} noneLabel="— เลือก (ไม่บังคับ) —"/>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11 }}>ราคาขาย (฿)</label>
                <input className="m-input" type="number" min="0" value={price}
                  onChange={e => setPrice(e.target.value)} placeholder="0" style={{ textAlign: "right" }}/>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: 11 }}>ผู้จัดส่ง</label>
                <input className="m-input" value={supplier}
                  onChange={e => setSupplier(e.target.value)} placeholder="Supplier"/>
              </div>
            </div>
            <div style={{ padding: "10px 14px", background: "var(--accent-soft,var(--surface-2))", borderRadius: 12,
                          border: "1.5px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>จำนวนรับเข้าครั้งนี้</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>เพิ่มในรายการทันที</div>
              </div>
              <input className="m-input" type="number" min="1" value={qty}
                onChange={e => setQty(e.target.value)}
                style={{ width: 70, textAlign: "center", fontWeight: 700, fontSize: 18 }}/>
            </div>
          </div>
        </div>
        <div className="m-sheet-foot" style={{ flexShrink: 0 }}>
          <button className="m-btn-big" disabled={!canSave}
            style={!canSave ? { opacity: 0.45 } : {}} onClick={confirm}>
            <Icons.Check size={16}/> สร้างสินค้า + รับเข้า {parseInt(qty) || 1} ชิ้น
          </button>
        </div>
      </div>
    </>
  );

  /* ── Desktop: render as centered modal ── */
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>เพิ่มสินค้าใหม่ + รับเข้า</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              บาร์โค้ด <span className="mono" style={{ color: "var(--fg)" }}>{sku}</span> ยังไม่มีในระบบ — กรอกข้อมูลเพื่อสร้างและรับเข้าพร้อมกัน
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body">{fields}</div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!canSave}
            style={!canSave ? { opacity: 0.45, cursor: "not-allowed" } : {}} onClick={confirm}>
            <Icons.Check size={14}/> สร้างสินค้า + รับเข้า {parseInt(qty) || 1} ชิ้น
          </button>
        </div>
      </div>
    </>
  );
}

/* Shown when a scanned code has NO exact match but is *almost* the same as an
   existing stock/catalog SKU (see findSimilarSkus). Lets the operator reuse the
   existing item — receive it (stock) or open the prefilled quick-add (catalog) —
   instead of forking a duplicate, with an explicit "create new anyway" escape.
   Shared by desktop Inbound and mobile MInbound (mobile renders as a sheet). */
function ScanSimilarModal({ code, candidates, onUseExisting, onCreateNew, onClose, mobile }) {
  const reasonLabel = (r) =>
    r === "same"  ? "รหัสเดียวกัน — ต่างแค่เครื่องหมาย"
    : r === "affix" ? "ต่างกันที่รหัสนำหน้า/ต่อท้าย"
    : "คล้ายกันมาก — อาจสแกนหรือพิมพ์ผิด";

  const list = (
    <div style={{ display: "flex", flexDirection: "column", gap: mobile ? 8 : 10 }}>
      {candidates.map((c) => (
        <div key={c.sku} className="row" style={{ gap: mobile ? 10 : 12, alignItems: "center",
          padding: mobile ? "10px 12px" : "12px 14px", background: "var(--surface-2)",
          border: "1px solid var(--border)", borderRadius: 12 }}>
          {c.image ? (
            <img src={c.image} alt="" onError={e => { e.target.style.display = "none"; }}
              style={{ width: mobile ? 42 : 48, height: mobile ? 42 : 48, borderRadius: 8, objectFit: "cover",
                       background: "#fff", flexShrink: 0, border: "1px solid var(--border)" }}/>
          ) : (
            <div style={{ width: mobile ? 42 : 48, height: mobile ? 42 : 48, borderRadius: 8, background: "var(--surface)",
                          border: "1px solid var(--border)", display: "grid", placeItems: "center", flexShrink: 0, color: "var(--muted)" }}>
              <Icons.Box size={mobile ? 18 : 20}/>
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: mobile ? 12.5 : 13.5 }}>{c.sku}</span>
              <span className={`badge ${c.inStock ? "badge-success" : "badge-neutral"}`} style={{ fontSize: 10 }}>
                <span className="dot"/>{c.inStock ? "มีในสต็อก" : "ในแคตตาล็อก"}
              </span>
            </div>
            {c.name ? (
              <div style={{ fontSize: mobile ? 11.5 : 12.5, color: "var(--fg)", marginTop: 2,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
            ) : null}
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
              {[c.brand, c.cat].filter(Boolean).join(" · ")}{(c.brand || c.cat) ? " — " : ""}{reasonLabel(c.reason)}
            </div>
          </div>
          <button className={mobile ? "m-action accent" : "btn btn-accent btn-sm"} onClick={() => onUseExisting(c)}
            style={mobile ? { width: "auto", padding: "0 12px", fontSize: 11, flexShrink: 0, borderRadius: 10, whiteSpace: "nowrap" }
                          : { flexShrink: 0, whiteSpace: "nowrap" }}>
            {c.inStock ? "รับเข้า +1" : "ใช้รหัสนี้"}
          </button>
        </div>
      ))}
    </div>
  );

  const intro = (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: mobile ? "8px 10px" : "10px 12px",
                  background: "var(--warning-soft)", border: "1.5px solid var(--warning)", borderRadius: 12 }}>
      <Icons.Warn size={mobile ? 14 : 16} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }}/>
      <div style={{ fontSize: mobile ? 11 : 12, color: "var(--fg)" }}>
        สแกน <span className="mono" style={{ fontWeight: 700 }}>{code}</span> ไม่พบในระบบ
        แต่พบสินค้าที่รหัส<b>ใกล้เคียง</b> {candidates.length} รายการ — เลือกใช้รายการที่มีอยู่เพื่อไม่ให้สินค้าซ้ำซ้อน
        หรือยืนยันว่าเป็นสินค้าใหม่จริง
      </div>
    </div>
  );

  /* ── Mobile: bottom sheet ── */
  if (mobile) return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose}/>
      <div className="m-sheet" style={{ bottom: 84, maxHeight: "72vh", borderRadius: 22, display: "flex", flexDirection: "column" }}>
        <div className="m-sheet-grabber"/>
        <div className="m-sheet-head" style={{ flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>อาจเป็นสินค้าซ้ำ</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>พบรหัสใกล้เคียง {candidates.length} รายการ</div>
          </div>
          <button className="m-action" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="m-sheet-body" style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", display: "flex", flexDirection: "column", gap: 10 }}>
          {intro}
          {list}
        </div>
        <div className="m-sheet-foot" style={{ flexShrink: 0 }}>
          <button className="m-btn-big" style={{ background: "var(--surface-2)", color: "var(--fg)", border: "1px solid var(--border)" }} onClick={onCreateNew}>
            <Icons.Plus size={16}/> ไม่ซ้ำ — สร้างสินค้าใหม่
          </button>
        </div>
      </div>
    </>
  );

  /* ── Desktop: centered modal ── */
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>อาจเป็นสินค้าซ้ำ</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ตรวจพบรหัสที่ใกล้เคียงกับสินค้าที่มีอยู่</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {intro}
          {list}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" onClick={onCreateNew}><Icons.Plus size={14}/> ไม่ซ้ำ — สร้างสินค้าใหม่</button>
        </div>
      </div>
    </>
  );
}

function GRAddModal({ onClose, onAdd, existing }) {
  const [id, setId]           = useState(() => {
    const d = new Date();
    const seq = (existing.length + 1).toString().padStart(2, "0");
    return `GR-${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}${seq}`;
  });
  const [po, setPo]           = useState("");
  const [supplier, setSupplier] = useState("");
  const [items, setItems]     = useState("");
  const [qty, setQty]         = useState("");
  const [ts, setTs]           = useState(() => new Date().toLocaleTimeString("th-TH", { hour:"2-digit", minute:"2-digit" }));
  const [status, setStatus]   = useState("scheduled");

  const valid = id.trim() && supplier.trim() && Number(items) > 0 && Number(qty) > 0;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    if (existing.find(r => r.id === id.trim())) { alert(`เลขที่ ${id} มีอยู่แล้ว`); return; }
    onAdd({ id: id.trim(), po: po.trim(), supplier: supplier.trim(), items: Number(items), qty: Number(qty), ts: ts.trim(), status });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal">
        <div className="modal-head">
          <div><h3>เพิ่มเอกสารรับเข้า (GR)</h3></div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="field">
                <label>เลขที่ GR *</label>
                <input className="input mono" value={id} onChange={e => setId(e.target.value)} placeholder="GR-260530XX" autoFocus/>
              </div>
              <div className="field">
                <label>เลขที่ PO</label>
                <input className="input mono" value={po} onChange={e => setPo(e.target.value)} placeholder="PO-2025-0000"/>
              </div>
              <div className="field" style={{ gridColumn: "1/-1" }}>
                <label>ผู้จัดส่ง / Supplier *</label>
                <input className="input" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="เช่น Bangkok Fashion Co."/>
              </div>
              <div className="field">
                <label>จำนวนรายการ (SKU) *</label>
                <input className="input" type="number" min="1" value={items} onChange={e => setItems(e.target.value)} placeholder="6"/>
              </div>
              <div className="field">
                <label>จำนวนชิ้นรวม *</label>
                <input className="input" type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="320"/>
              </div>
              <div className="field">
                <label>เวลานัดรับ</label>
                <input className="input" value={ts} onChange={e => setTs(e.target.value)} placeholder="09:00"/>
              </div>
              <div className="field">
                <label>สถานะ</label>
                <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="scheduled">รอเข้า</option>
                  <option value="in-progress">กำลังนับ</option>
                  <option value="received">รับเข้าแล้ว</option>
                </select>
              </div>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary" disabled={!valid} style={!valid ? { opacity: 0.5 } : {}}>
              <Icons.Plus size={14}/> เพิ่มเอกสาร
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function loadGRQueue() {
  try { const s = localStorage.getItem("ims_gr_queue"); if (s) return JSON.parse(s); } catch (e) {}
  return INBOUND; // first run: seed with the demo entries
}
function saveGRQueue(list) {
  try { localStorage.setItem("ims_gr_queue", JSON.stringify(list)); } catch (e) {}
}

function Inbound({ goTo, pushToast }) {
  // Restore any in-progress receiving draft so leaving + returning (or a reload)
  // doesn't lose scanned-but-not-committed items.
  const [received, setReceived] = useState(() => typeof loadInboundDraft === "function" ? loadInboundDraft() : []);
  const [qtyEdit, setQtyEdit] = useState(null); // null | { sku, val } — raw text while a count is being typed
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState(null);
  const [camOpen, setCamOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null); // null | { sku: string }
  const [similar, setSimilar] = useState(null); // null | { code, candidates } — near-duplicate prompt
  const [closeConfirm, setCloseConfirm] = useState(null); // null | { changes }
  const [closed, setClosed] = useState(false); // true once job is committed
  const [report, setReport] = useState(null);   // what the closed batch did (buildReceiveReport)
  const [grQueue, setGRQueue] = useState(loadGRQueue);
  const [grModal, setGRModal] = useState(false); // add-GR modal open
  const inputRef = useRef(null);

  const updateGRQueue = (next) => { setGRQueue(next); saveGRQueue(next); };
  const deleteGR = (id) => {
    if (!confirm(`ลบเอกสาร ${id} ออกจากคิว?`)) return;
    updateGRQueue(grQueue.filter(r => r.id !== id));
    pushToast(`ลบ ${id} แล้ว`);
  };
  const addGR = (entry) => {
    updateGRQueue([...grQueue, entry]);
    pushToast(`เพิ่ม ${entry.id} เข้าคิวแล้ว`);
    setGRModal(false);
  };

  useEffect(() => { inputRef.current?.focus(); }, []);
  // Persist the receiving draft on every change; clear it once the job is committed.
  useEffect(() => { if (typeof saveInboundDraft === "function") saveInboundDraft(closed ? [] : received); }, [received, closed]);

  // Draft lines default to the product's REAL shelf — p.loc is "-" on live data,
  // and filing a batch under "-" created a fake pick-first shelf.
  const recvShelf = (p) => (typeof productHomeLoc === "function" ? productHomeLoc(p) : "");
  const addToReceived = (sku, name, loc, qty) => {
    const t = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    setReceived(prev => {
      const idx = prev.findIndex(r => r.sku === sku);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty, t };
        return [next[idx], ...next.filter((_, i) => i !== idx)];
      }
      return [{ sku, name, qty, loc, t }, ...prev];
    });
  };
  // Per-line "จัดเก็บที่" — where this batch physically lands when the job closes.
  const setReceivedLoc = (idx, locV) => {
    if (typeof rememberReceiveLoc === "function") rememberReceiveLoc(locV);
    setReceived(prev => prev.map((r, i) => (i === idx ? { ...r, loc: locV } : r)));
  };
  // Lines that would be committed with NO shelf (none picked, none on the product).
  const noShelf = (typeof receiveLinesWithoutShelf === "function") ? receiveLinesWithoutShelf(received) : [];
  const noShelfSet = new Set(noShelf.map(r => r.sku));
  // One pick fills every empty line — a scan batch usually lands on one shelf.
  const fillEmptyShelves = (locV) => {
    if (!locV) return;
    if (typeof rememberReceiveLoc === "function") rememberReceiveLoc(locV);
    setReceived(prev => prev.map(r => (noShelfSet.has(r.sku) ? { ...r, loc: locV } : r)));
    pushToast(`ตั้งตำแหน่ง ${noShelf.length} รายการเป็น ${locV}`);
  };
  // Manual qty correction for an already-scanned line (e.g. one scan actually
  // covered a multi-pack, or a rescan-to-bump would be slower than just typing
  // the count). Keyed by sku, not index — `received` reorders on every new scan
  // (most-recent first), so an index captured at render time can't be trusted
  // across a state update the way the sku can.
  const setReceivedQty = (sku, n) =>
    setReceived(prev => prev.map(r => (r.sku === sku ? { ...r, qty: n } : r)));
  // Drop a line from this round's draft — a mis-scan, or a stale entry left over
  // from a job that never got closed. Only touches the in-memory draft; nothing
  // has been written to stock yet, so no confirm dialog beyond the click itself.
  const removeReceived = (idx) => {
    setReceived(prev => {
      const r = prev[idx];
      if (r && pushToast) pushToast(`ลบ ${r.sku} ออกจากรายการแล้ว`);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const submitScan = (override) => {
    const code = (override ?? scan).trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase());
    if (!p) {
      /* Unknown SKU → check the WooCommerce reference catalog. An exact match
         prefills the quick-register form (no typing). */
      const hit = typeof wooCatalogLookup === "function" ? wooCatalogLookup(code) : null;
      if (hit) {
        if (typeof playScanBeep === "function") playScanBeep();
        setQuickAdd({ sku: code, prefill: hit });
        setScan("");
        return;
      }
      /* No exact match anywhere → is this a near-duplicate of an existing SKU
         (brand prefix added/dropped, separators, a typo)? Surface it so we reuse
         the existing item instead of forking a duplicate; else open blank add. */
      const near = typeof findSimilarSkus === "function" ? findSimilarSkus(code) : [];
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      if (near.length) setSimilar({ code, candidates: near });
      else setQuickAdd({ sku: code });
      setScan("");
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    addToReceived(p.sku, p.name, recvShelf(p), 1);
    setFlash({ sku: p.sku, name: p.name, notFound: false });
    setTimeout(() => setFlash(null), 1200);
    setScan("");
    pushToast(`สแกนรับเข้า ${p.sku} สำเร็จ`);
  };

  // Near-duplicate prompt → reuse an existing item. A stocked SKU is received
  // straight away; a catalog-only SKU opens the prefilled quick-add (its real
  // SKU + name/price/image), so no duplicate is created either way.
  const receiveExisting = (cand) => {
    setSimilar(null);
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === cand.sku.toLowerCase());
    if (p) {
      if (typeof playScanBeep === "function") playScanBeep();
      addToReceived(p.sku, p.name, recvShelf(p), 1);
      setFlash({ sku: p.sku, name: p.name, notFound: false });
      setTimeout(() => setFlash(null), 1200);
      pushToast(`สแกนรับเข้า ${p.sku} สำเร็จ`);
    } else {
      setQuickAdd({ sku: cand.sku, prefill: cand });
    }
  };

  const totalQty = received.reduce((s, r) => s + r.qty, 0);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">รับเข้าสินค้า</h1>
          <div className="page-sub">
            {closed
              ? `ปิดงานแล้ว — อัปเดตสต็อก ${received.length} SKU รวม ${totalQty} ชิ้น`
              : received.length > 0
                ? `กำลังนับ — ${received.length} SKU · ${totalQty} ชิ้น`
                : "สแกนบาร์โค้ดหรือพิมพ์ SKU เพื่อเริ่มนับรับเข้า"}
          </div>
        </div>
        <div className="row">
          {canOpenPage("history") && <button className="btn" onClick={() => { try { sessionStorage.setItem("ims_history_filter", "inbound"); } catch (e) {} goTo && goTo("history"); }}><Icons.History/> ประวัติการรับเข้า</button>}
          <button
            className="btn btn-primary"
            disabled={received.length === 0 || closed}
            style={(received.length === 0 || closed) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
            onClick={() => {
              if (received.length === 0 || closed) return;
              setCloseConfirm({
                changes: received.map(r => {
                  const sh = (typeof receiveLineShelf === "function") ? receiveLineShelf(r) : (r.loc || "");
                  return { label: r.sku, to: `+${r.qty} ชิ้น → ${sh || "⚠ ไม่ระบุตำแหน่ง"}` };
                }),
                missing: noShelf.length
              });
            }}
          >
            <Icons.Check/> {closed ? "ปิดงานแล้ว" : "ปิดงานรับเข้า"}
          </button>
        </div>
      </div>

      {/* Low-stock alert — explains the sidebar badge count */}
      {(() => {
        const lowStock = PRODUCTS.filter(p => p.qty <= p.reorder);
        if (!lowStock.length) return null;
        return (
          <div className="card" style={{ padding: "14px 18px", background: "var(--warning-soft)", border: "1px solid var(--warning)", borderRadius: 12 }}>
            <div className="row" style={{ gap: 10, marginBottom: lowStock.length > 0 ? 10 : 0 }}>
              <Icons.Warn size={16} style={{ color: "var(--warning)", flexShrink: 0 }}/>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--warning)" }}>
                สินค้าสต็อกต่ำ {lowStock.length} รายการ — ควรสั่งเพิ่มหรือรับเข้า
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {lowStock.slice(0, 8).map(p => (
                <div key={p.sku} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
                  <span className="mono" style={{ color: "var(--muted)" }}>{p.sku}</span>
                  <span style={{ color: "var(--fg)" }}>{p.name}</span>
                  <span className="tnum" style={{ fontWeight: 600, color: p.qty === 0 ? "var(--danger)" : "var(--warning)" }}>
                    {p.qty === 0 ? "หมด" : `เหลือ ${p.qty}`}
                  </span>
                </div>
              ))}
              {lowStock.length > 8 && <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>+{lowStock.length - 8} รายการ</span>}
            </div>
          </div>
        );
      })()}

      {/* Scan zone */}
      <div className="scan-zone">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow" style={{ color: "var(--accent)" }}>โหมดสแกน</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>วางเครื่องสแกนที่ช่องด้านล่าง หรือพิมพ์รหัส SKU / บาร์โค้ด</div>
          </div>
          <div className="row" style={{ gap: 14, fontSize: 12, color: "var(--muted)" }}>
            <span><span className="kbd">Enter</span> ยืนยัน</span>
            <span><span className="kbd">⇧+Enter</span> ระบุจำนวน</span>
            <span><span className="kbd">Esc</span> ล้าง</span>
          </div>
        </div>

        <div className="scan-input-wrap">
          <Icons.Scan size={26} className="scan-icon"/>
          <input
            ref={inputRef}
            value={scan}
            onChange={e => setScan(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") submitScan();
              if (e.key === "Escape") setScan("");
            }}
            placeholder="สแกนรหัสที่นี่ เช่น TH-APP-001 หรือ 8851234567890"
          />
          {!scan && <span className="scan-blink"/>}
          <button className="btn btn-sm" style={{ margin: "4px 2px", gap: 5 }} onClick={() => setCamOpen(true)} title="สแกนด้วยกล้อง">
            <Icons.Camera size={15}/> กล้อง
          </button>
          <button className="btn btn-sm" style={{ margin: "4px 2px", gap: 5, borderColor: "var(--accent)", color: "var(--accent)" }}
            onClick={() => setQuickAdd({ sku: scan.trim() || "" })}
            title="เพิ่มสินค้าใหม่ที่ยังไม่มีในระบบ">
            <Icons.Plus size={15}/> สินค้าใหม่
          </button>
          <button className="btn btn-accent" style={{ margin: 4 }} onClick={() => submitScan()}>บันทึก</button>
        </div>
        {camOpen && <CameraScanner continuous onScan={code => { submitScan(code); }} onClose={() => setCamOpen(false)}/>}
        {similar && (
          <ScanSimilarModal
            code={similar.code}
            candidates={similar.candidates}
            onUseExisting={receiveExisting}
            onCreateNew={() => { setSimilar(null); setQuickAdd({ sku: similar.code }); }}
            onClose={() => setSimilar(null)}
          />
        )}
        {quickAdd && (
          <QuickAddInboundModal
            sku={quickAdd.sku}
            prefill={quickAdd.prefill}
            onClose={() => setQuickAdd(null)}
            onConfirm={(product, qty) => {
              addProductToStore(product);
              addToReceived(product.sku, product.name, recvShelf(product), qty);
              if (typeof recordChange === "function") {
                recordChange({
                  entity: "product", entityId: product.sku, action: "add",
                  summary: `เพิ่มสินค้าใหม่ ${product.sku} — ${product.name} (สร้างจากการสแกนรับเข้า)`,
                });
              }
              setQuickAdd(null);
              setFlash({ sku: product.sku, name: product.name, notFound: false });
              setTimeout(() => setFlash(null), 1800);
              pushToast(`เพิ่มสินค้า ${product.sku} และรับเข้า ${qty} ชิ้นสำเร็จ`);
            }}
          />
        )}


        {flash && (
          flash.notFound ? (
            <div className="row" style={{ padding: "10px 14px", background: "var(--warning-soft,var(--surface-2))", color: "var(--warning,var(--fg))", borderRadius: 10, fontSize: 13, fontWeight: 500, gap: 8 }}>
              <Icons.Warn size={18}/> ไม่พบ SKU: <span className="mono" style={{ marginLeft: 4 }}>{flash.sku}</span>
              <span style={{ fontWeight: 400, fontSize: 12 }}>— กำลังเปิดฟอร์มเพิ่มสินค้าใหม่…</span>
            </div>
          ) : (
            <div className="row" style={{ padding: "10px 14px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
              <Icons.Check size={18}/> รับเข้า {flash.sku} — {flash.name}
              {(() => { const line = received.find(r => r.sku === flash.sku); return line ? <span className="tnum" style={{ marginLeft: "auto", fontWeight: 700 }}>รวมรอบนี้ {line.qty} ชิ้น</span> : null; })()}
            </div>
          )
        )}
      </div>

      {/* GR header summary */}
      <div className="grid-3">
        <div className="card">
          <div className="eyebrow">เลขที่เอกสาร</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 500, marginTop: 6 }}>GR-26051902</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>อ้างอิง PO-2025-0489</div>
        </div>
        <div className="card">
          <div className="eyebrow">ผู้จัดส่ง</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginTop: 6 }}>Tech Wave Co.</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>คนตรวจรับ: สมชาย ภูมิดี</div>
        </div>
        <div className="card">
          <div className="eyebrow">สรุปการนับ</div>
          <div style={{ fontSize: 16, fontWeight: 500, marginTop: 6 }}><span className="tnum">{received.length}</span> SKU · <span className="tnum">{totalQty}</span> ชิ้น</div>
          <div className="prog" style={{ marginTop: 8 }}><span className="" style={{ width: Math.min(100, totalQty/320*100) + "%", background: "var(--success)" }}/></div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>คาดหมาย 320 ชิ้น · นับแล้ว {totalQty} ชิ้น</div>
        </div>
      </div>

      {/* Received list */}
      <div className="card card-tight">
        <div className="card-head">
          <div>
            <h3>{closed ? "สรุปการรับเข้า" : "รายการที่นับได้ในรอบนี้"}</h3>
            <div className="sub">{received.length} SKU · รวม <b className="tnum">{totalQty}</b> ชิ้น{closed ? " · รับเข้าสต็อกแล้ว" : " · เรียงตามเวลาที่สแกนล่าสุด"}</div>
          </div>
          <div className="row">
            {!closed && noShelf.length > 0 && (
              <div className="row" style={{ gap: 6, padding: "4px 8px", borderRadius: 8, background: "var(--warning-soft)", color: "var(--warning)", fontSize: 12, fontWeight: 600 }}>
                <Icons.Warn size={13}/> ยังไม่ระบุตำแหน่ง {noShelf.length} รายการ
                <LocationSelect value="" onChange={fillEmptyShelves} noneLabel="ใส่ตำแหน่งให้ทุกรายการที่ว่าง…"
                  style={{ padding: "4px 6px", fontSize: 12, minWidth: 200 }}/>
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}><Icons.Refresh size={14}/></button>
            {canDo("exportData") && <button className="btn btn-sm" onClick={() => {
              if (!received.length) return;
              const cols = ["SKU", "ชื่อสินค้า", "ตำแหน่งจัดเก็บ", "จำนวนรับ"];
              const rows = received.map(r => [r.sku, r.name, r.loc, r.qty]);
              const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
              a.download = `GR-inbound-${new Date().toISOString().slice(0,10)}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}>ส่งออก CSV</button>}
          </div>
        </div>
        <table className="t">
          <thead><tr>
            <th style={{ width: 64 }}>เวลา</th>
            <th>SKU</th>
            <th>ชื่อสินค้า</th>
            <th>ตำแหน่งจัดเก็บ</th>
            <th className="t-num">{closed ? "รับเข้า" : "จำนวน"}</th>
            {closed && <th className="t-num">คงเหลือ ก่อน → หลัง</th>}
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {received.map((r, i) => (
              <tr key={i}>
                <td className="t-mono">{r.t}</td>
                <td className="t-mono" style={{ color: "var(--fg)" }}>{r.sku}</td>
                <td>{r.name}</td>
                <td style={{ minWidth: 170 }}>
                  {closed
                    ? (() => { const rr = report && report.lines.find(x => x.sku === r.sku); const sh = (rr && rr.shelf) || r.loc;
                        return sh ? <span className="badge badge-neutral"><Icons.Map size={11}/>{sh}</span>
                                  : <span className="badge badge-warning"><Icons.Warn size={11}/>ไม่ระบุตำแหน่ง</span>; })()
                    : <LocationSelect value={r.loc && r.loc !== "—" ? r.loc : ""} onChange={v => setReceivedLoc(i, v)}
                        noneLabel="— ยังไม่ระบุ —"
                        style={{ padding: "6px 8px", fontSize: 12, width: "100%",
                                 ...(noShelfSet.has(r.sku) ? { borderColor: "var(--danger)", boxShadow: "0 0 0 1px var(--danger)" } : {}) }}/>}
                </td>
                <td className="t-num tnum">
                  {closed
                    ? <span style={{ fontWeight: 700, color: "var(--success)" }}>+{r.qty}</span>
                    : <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <QtyStepper small min={1}
                          value={qtyEdit && qtyEdit.sku === r.sku ? qtyEdit.val : String(r.qty)}
                          onChange={v => {
                            setQtyEdit({ sku: r.sku, val: v });
                            const n = parseInt(v, 10);
                            if (Number.isFinite(n) && n >= 1) setReceivedQty(r.sku, n);
                          }}
                          onBlur={() => setQtyEdit(null)}
                          title={`จำนวน ${r.sku}`}/>
                      </div>}
                </td>
                {closed && (() => {
                  const rr = report && report.lines.find(x => x.sku === r.sku);
                  return <td className="t-num tnum">{rr ? <>{rr.before} → <b>{rr.after}</b></> : "—"}</td>;
                })()}
                <td>
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn btn-ghost btn-icon" title={`แก้ไข ${r.sku}`} onClick={() => pushToast(`แก้ไข ${r.sku} — ใช้หน้า สินค้าคงคลัง เพื่อปรับจำนวน`)}><Icons.Edit size={14}/></button>
                    {!closed && (
                      <button className="btn btn-ghost btn-icon" title={`ลบ ${r.sku} ออกจากรายการ`} onClick={() => {
                        if (!confirm(`ลบ ${r.sku} ออกจากรายการรับเข้ารอบนี้?`)) return;
                        removeReceived(i);
                      }}>
                        <Icons.Trash size={14}/>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending receipts */}
      <div className="card card-tight">
        <div className="card-head">
          <div>
            <h3>รอรับเข้าวันนี้</h3>
            <div className="sub">{grQueue.length} เอกสาร</div>
          </div>
          <button className="btn btn-sm btn-accent" onClick={() => setGRModal(true)}>
            <Icons.Plus size={13}/> เพิ่ม GR
          </button>
        </div>
        <table className="t">
          <thead><tr><th>เลขที่</th><th>PO</th><th>ผู้จัดส่ง</th><th className="t-num">รายการ</th><th className="t-num">จำนวน</th><th>เวลา</th><th>สถานะ</th><th style={{width:1}}/></tr></thead>
          <tbody>
            {grQueue.length === 0 && (
              <tr><td colSpan="8" style={{ textAlign:"center", padding:32, color:"var(--muted)", fontSize:13 }}>ยังไม่มีเอกสารรับเข้า — กด เพิ่ม GR เพื่อเพิ่ม</td></tr>
            )}
            {grQueue.map(r => {
              const st = r.status === "received" ? "badge-success" : r.status === "in-progress" ? "badge-info" : "badge-neutral";
              const lab = r.status === "received" ? "รับเข้าแล้ว" : r.status === "in-progress" ? "กำลังนับ" : "รอเข้า";
              return (
                <tr key={r.id}>
                  <td className="t-mono" style={{ color: "var(--fg)" }}>{r.id}</td>
                  <td className="t-mono">{r.po}</td>
                  <td>{r.supplier}</td>
                  <td className="t-num tnum">{r.items}</td>
                  <td className="t-num tnum">{r.qty}</td>
                  <td className="t-mono">{r.ts}</td>
                  <td><span className={"badge " + st}><span className="dot"/>{lab}</span></td>
                  <td>
                    <button className="btn btn-ghost btn-icon" title="ลบ" onClick={() => deleteGR(r.id)}>
                      <Icons.Trash size={13}/>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {grModal && <GRAddModal onClose={() => setGRModal(false)} onAdd={addGR} existing={grQueue}/>}

      <ConfirmDialog
        open={!!closeConfirm}
        title="ยืนยันปิดงานรับเข้า"
        description={`จะเพิ่มสต็อกจำนวน ${received.reduce((s,r)=>s+r.qty,0)} ชิ้น ใน ${received.length} SKU เข้าระบบทันที`
          + (closeConfirm?.missing ? `\n⚠ ${closeConfirm.missing} รายการยังไม่ได้เลือกตำแหน่งจัดเก็บ — สินค้าจะขึ้นว่า "ยังไม่จัดเก็บ" กด ยกเลิก เพื่อกลับไปเลือกตำแหน่ง` : "")}
        changes={closeConfirm?.changes || []}
        danger={!!closeConfirm?.missing}
        action={closeConfirm?.missing ? "ปิดงานโดยไม่ระบุตำแหน่ง" : "ยืนยันปิดงาน"}
        onCancel={() => setCloseConfirm(null)}
        onConfirm={() => {
          /* One receiving batch = one commit. Without this latch a double-click,
             or a reload that restored the draft after the write had already
             landed, ran the whole batch again and every sku was received twice.
             The key is a fingerprint of the batch, so a DIFFERENT batch — even
             one second later — is never blocked. */
          const guardKey = (typeof commitFingerprint === "function")
            ? commitFingerprint("inbound-close", received) : null;
          if (guardKey && typeof claimCommit === "function" && !claimCommit(guardKey)) {
            if (typeof duplicateCommitToast === "function") duplicateCommitToast();
            setCloseConfirm(null);
            setClosed(true);
            return;
          }
          // Retire the draft NOW, not in the [closed] effect: a reload landing
          // between the stock write and that effect used to restore the batch
          // and invite a second ปิดงาน.
          if (typeof saveInboundDraft === "function") saveInboundDraft([]);
          // Snapshot BEFORE the writes so the report can show stock before → after.
          const rep = (typeof buildReceiveReport === "function") ? buildReceiveReport(received) : null;
          /* Applies every line (atomic +delta, concurrent-safe) and writes one
             movement-ledger row per sku using the quantity the SERVER confirms
             — not the quantity we asked for. Synchronous internally, so the
             applyReceiveLocs call below still sees the new p.qty this tick. */
          if (typeof receiveStockAndRecord === "function") {
            receiveStockAndRecord(received, "รับเข้าสินค้า", { audit: true });
          } else {
            received.forEach(r => { if (PRODUCTS.some(p => p.sku === r.sku)) adjustProductQty(r.sku, r.qty); });
          }
          // Same tick as the qty writes (see applyReceiveLocs): file each batch
          // at its picked position so the split rows follow the new stock.
          if (typeof applyReceiveLocs === "function") {
            applyReceiveLocs(received).then(res => {
              if (res && res.errors && res.errors.length) {
                pushToast(`รับเข้าแล้ว แต่บันทึกตำแหน่งไม่สำเร็จ ${res.errors.length} SKU — แก้ได้ที่หน้าสินค้า`);
              }
            }).catch(() => {});
          }
          if (typeof recordChange === "function") {
            recordChange({
              entity: "inbound", action: "close",
              summary: `ปิดงานรับเข้า — เพิ่มสต็อก ${received.length} SKU รวม ${received.reduce((s,r)=>s+r.qty,0)} ชิ้น`,
              changes: received.map(r => {
                const sh = (typeof receiveLineShelf === "function") ? receiveLineShelf(r) : (r.loc || "");
                return { label: r.sku, to: `+${r.qty} ชิ้น → ${sh || "ไม่ระบุตำแหน่ง"}` };
              })
            });
          }
          setCloseConfirm(null);
          setReport(rep);
          setClosed(true);
          pushToast(`รับเข้าแล้ว ${received.length} SKU รวม ${received.reduce((s,r)=>s+r.qty,0)} ชิ้น`);
        }}
      />
    </div>
  );
}

/* Build a shipping-label object from an outbound order, then jump to the labels page */
function orderToLabel(o) {
  const lineItems = Array.isArray(o.lineItems) ? o.lineItems : [];
  const senderTemplate = (typeof SAMPLE_LABELS !== "undefined" && SAMPLE_LABELS[0])
    ? { ...SAMPLE_LABELS[0].sender }
    : { name: "", addr1: "", addr2: "", phone: "" };
  return {
    id: "LBL-" + o.id + "-" + Math.floor(Math.random() * 10000),
    soId: o.id,
    sender: senderTemplate,
    recipient: {
      name: o.customer || "",
      addr1: o.shippingAddr || "",
      addr2: "",
      phone: o.phone || ""
    },
    carrier: (o.carrier && o.carrier !== "—") ? o.carrier : "",
    tracking: (o.tracking && o.tracking !== "—") ? o.tracking : "",
    cod: o.codAmount || 0,
    weight: "0.5 kg",
    // Carry the order's date onto the label so it groups under the right day in
    // the label queue's date filter (otherwise it falls into "ไม่ระบุวันที่").
    created_at: o.created_at || (o.dateIso ? new Date(o.dateIso + "T00:00:00").toISOString() : new Date().toISOString()),
    items: lineItems.map(it => ({ sku: it.sku, name: it.name, qty: it.qty }))
  };
}
function queueLabelsAndGo(orders, goTo) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean).map(orderToLabel);
  if (!list.length) return;
  window.__pendingLabels = (window.__pendingLabels || []).concat(list);
  goTo("labels");
}

/* ========= OUTBOUND ========= */
function Outbound({ goTo, pushToast, focus }) {
  const [picked, setPicked] = useState({});
  // Tracking-model reader (labels-as-shipments + preserved + DB rows, overrides
  // applied) — the same source MOutbound and TrackingPage use, so desktop and
  // mobile show an identical list. Writes go through setOrderField /
  // appendOrder / deleteOrdersFromDb; the old full-list saveOrders() effect
  // (which re-upserted every order and diffed-and-DELETED missing ids — a
  // cross-device data-loss vector) is gone.
  const orders = useOrders();
  const [issueOpen, setIssueOpen] = useState(false);
  const [obBulkMenu, setObBulkMenu] = useState(null);
  const [obBulkConfirm, setObBulkConfirm] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCh, setFilterCh] = useState("all");
  const [filterQ, setFilterQ] = useState("");

  // Bulk-status dropdown ref + click-outside to close
  const obBulkMenuRef = useRef(null);
  useEffect(() => {
    if (!obBulkMenu) return;
    const h = (e) => { if (obBulkMenuRef.current && !obBulkMenuRef.current.contains(e.target)) setObBulkMenu(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [obBulkMenu]);

  // Tabs. "ค้างส่ง" = รอแพ็ค + พร้อมส่ง minus blank label drafts — the work that
  // is actually waiting, and where the page opens when there is any.
  const pendingOf = (o) => (typeof isPendingOrder === "function") ? isPendingOrder(o) : (o.status === "picking" || o.status === "packed");
  const TABS = [
    { label: "ทั้งหมด",               test: () => true,                         filtered: false },
    { label: "ค้างส่ง",               test: pendingOf,                          filtered: true },
    { label: ORDER_STATUS_TH.picking,   test: o => o.status === "picking",   filtered: true },
    { label: ORDER_STATUS_TH.packed,    test: o => o.status === "packed",    filtered: true },
    { label: ORDER_STATUS_TH.shipped,   test: o => o.status === "shipped",   filtered: true },
    { label: ORDER_STATUS_TH.delivered, test: o => o.status === "delivered", filtered: true },
  ];
  const [tab, setTab] = useState(() => orders.some(pendingOf) ? 1 : 0);

  /* Opened from the global search / notifications with a specific order id.
     There is no per-order drawer here, so isolate that one row instead: jump to
     the "ทั้งหมด" tab (the order may not be in the current status tab), drop the
     channel filter, and put the id in the text filter. Keyed on focus.n so it
     re-runs when the user is already on this page. */
  useEffect(() => {
    if (focus && focus.orderId) { setTab(0); setFilterCh("all"); setFilterQ(focus.orderId); setFilterOpen(true); }
  }, [focus && focus.n]);

  // A selection belongs to the rows on screen: switching tab or filter drops it,
  // so a bulk ลบ / ยกเลิก / status change can't hit orders the user no longer sees.
  useEffect(() => {
    setPicked(p => (Object.keys(p).length ? {} : p));
    setObBulkMenu(null);
  }, [tab, filterCh, filterQ]);

  // Live counts from orders state (used for stats + tab badges)
  const pickingCount   = orders.filter(o => o.status === "picking").length;
  const packedCount    = orders.filter(o => o.status === "packed").length;
  const shippedCount   = orders.filter(o => o.status === "shipped" || o.status === "delivered").length;
  const pendingCount   = orders.filter(pendingOf).length;

  // Apply tab + optional channel/text filter
  const tabOrders = orders.filter(TABS[tab].test)
    .filter(o => {
      if (filterCh !== "all" && o.channel !== filterCh) return false;
      if (filterQ.trim()) {
        const q = filterQ.toLowerCase();
        if (!o.id.toLowerCase().includes(q) && !(o.customer || "").toLowerCase().includes(q)) return false;
      }
      return true;
    })
    // Newest first (by order date + time).
    .sort((a, b) => ((b.dateIso || "") + " " + (b.ts || "")).localeCompare((a.dateIso || "") + " " + (a.ts || "")));

  // Status display helpers
  const STATUS_LABEL = ORDER_STATUS_TH;
  const STATUS_CLS   = { picking: "badge-warning", packed: "badge-info", shipped: "badge-success", delivered: "badge-neutral" };

  // Multi-item stock-out: the modal hands over a cart, commitIssueOrder does the
  // deduct + shelf re-balance + audit + single order append (shared with the
  // สินค้าคงคลัง entry point so the two can't drift).
  const submitIssue = async (data) => {
    await commitIssueOrder(data, pushToast);
    setIssueOpen(false);
  };

  const pickedIds = Object.keys(picked).filter(k => picked[k]);
  const pickedCount = pickedIds.length;
  // Select-all acts on the rows on screen (current tab + filters). It used to
  // tick EVERY order in every tab, so a bulk ลบ from a filtered view could hit
  // orders the user never saw.
  const allPicked = tabOrders.length > 0 && tabOrders.every(o => picked[o.id]);
  const somePicked = !allPicked && tabOrders.some(o => picked[o.id]);

  const toggleAllOrders = () => {
    if (allPicked) setPicked({});
    else setPicked(Object.fromEntries(tabOrders.map(o => [o.id, true])));
  };
  const clearPicked = () => { setPicked({}); setObBulkMenu(null); };

  const bulkUpdateStatus = (status) => {
    const STATUS_LABEL = ORDER_STATUS_TH;
    setObBulkConfirm({
      title: "ยืนยันการแก้ไขสถานะ",
      description: `อัปเดตสถานะของ ${pickedCount} ออร์เดอร์เป็น \"${STATUS_LABEL[status]}\"`,
      count: pickedCount,
      changes: [{ label: "สถานะใหม่", to: STATUS_LABEL[status] }],
      action: "อัปเดต",
      onConfirm: () => {
        if (typeof setOrderField === "function") pickedIds.forEach(id => setOrderField(id, { status }));
        recordChange({
          entity: "order", action: "bulk-update",
          summary: `เปลี่ยนสถานะ ${pickedCount} ออร์เดอร์เป็น ${STATUS_LABEL[status]}`,
          count: pickedCount,
          changes: [{ label: "สถานะใหม่", to: STATUS_LABEL[status] }],
          note: `ออร์เดอร์: ${pickedIds.join(", ")}`
        });
        pushToast(`อัปเดตสถานะ ${pickedCount} ออร์เดอร์`);
        setObBulkConfirm(null);
        clearPicked();
      }
    });
  };
  // Cancel = delete + put every piece back on the shelf the sale took it from.
  const bulkCancelRestock = () => {
    const sel = orders.filter(o => picked[o.id]);
    const pieces = sel.reduce((s, o) => s + ((typeof packLinesForOrder === "function") ? packLinesForOrder(o) : []).reduce((n, l) => n + l.qty, 0), 0);
    setObBulkConfirm({
      title: "ยกเลิกออร์เดอร์ + คืนสต็อก",
      description: `ยกเลิก ${pickedCount} ออร์เดอร์ และคืนสินค้า ${pieces} ชิ้นกลับเข้าตำแหน่งเดิม`,
      count: pickedCount,
      changes: [{ label: "คืนสต็อก", to: `+${pieces} ชิ้น` }],
      action: "ยกเลิก + คืนสต็อก",
      danger: true,
      onConfirm: async () => {
        const r = await cancelOrdersAndRestock(sel);
        setObBulkConfirm(null);
        if (r.blocked) { pushToast("ยกเลิกไม่ได้ — ต้องมีสิทธิ์ลบข้อมูล"); return; }
        if (!r.ok) return;
        let msg = `ยกเลิก ${r.restocked.length} ออร์เดอร์ — คืนสต็อก ${r.pieces} ชิ้น`;
        if (r.skipped.length) msg += ` · ข้าม ${r.skipped.length} (ไม่มีรายการสินค้า/คืนไปแล้ว)`;
        if (r.locError) msg += " · ปรับตำแหน่งไม่สำเร็จ: " + r.locError;
        pushToast(msg);
        clearPicked();
      }
    });
  };
  const bulkDeleteOrders = () => {
    setObBulkConfirm({
      title: "ยืนยันการลบออร์เดอร์",
      description: `ลบ ${pickedCount} ออร์เดอร์ออกจากระบบ`,
      count: pickedCount,
      action: "ลบออร์เดอร์",
      danger: true,
      onConfirm: async () => {
        let res = null;
        if (typeof deleteOrdersFromDb === "function") {
          res = await deleteOrdersFromDb(pickedIds);
          if (res && res.blocked) { pushToast("ลบไม่ได้ — เฉพาะแอดมิน/ผู้จัดการเท่านั้น"); setObBulkConfirm(null); return; }
        }
        if (typeof setOrderField === "function") pickedIds.forEach(id => setOrderField(id, { deleted: true }));
        recordChange({
          entity: "order", action: "bulk-delete",
          summary: `ลบ ${pickedCount} ออร์เดอร์จากหน้าจัดส่ง`,
          count: pickedCount,
          note: `ออร์เดอร์: ${pickedIds.join(", ")}`
        });
        pushToast((res && res.ok === false && res.failedIds && res.failedIds.length)
          ? `ลบแล้ว — ${res.failedIds.length} รายการจะลบให้เสร็จเมื่อกลับมาออนไลน์`
          : `ลบ ${pickedCount} ออร์เดอร์แล้ว`);
        setObBulkConfirm(null);
        clearPicked();
      }
    });
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">จัดส่งสินค้า</h1>
          <div className="page-sub">ออร์เดอร์ทั้งหมด {orders.length} รายการ · ค้างส่ง {pendingCount} · ส่งแล้ว {shippedCount}</div>
        </div>
        <div className="row">
          <button className={"btn" + ((filterCh !== "all" || filterQ) ? " btn-accent" : "")} onClick={() => setFilterOpen(o => !o)}>
            <Icons.Filter/> ตัวกรอง{(filterCh !== "all" || filterQ) ? " •" : ""}
          </button>
          <button className="btn" onClick={() => {
            const toPrint = pickedCount > 0 ? orders.filter(o => picked[o.id]) : tabOrders.filter(o => o.status === "picking");
            if (typeof openPickListWindow === "function") openPickListWindow(toPrint, pushToast);
          }}><Icons.Print/> รายการหยิบสินค้า</button>
          <button className="btn" onClick={() => setIssueOpen(true)}><Icons.Out size={14}/> ตัดสต็อก</button>
          <button className="btn btn-primary" onClick={() => goTo("labels")}><Icons.Tag/> สร้างฉลากส่ง</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label={ORDER_STATUS_TH.picking} value={pickingCount}  tone="warning" hint="ตัดสต็อกแล้ว รอหยิบของ"/>
        <SmallStat label="พร้อมส่ง"   value={packedCount}   tone="info"    hint="แพ็คเสร็จรอส่ง"/>
        <SmallStat label="ส่งแล้ว"    value={shippedCount}  tone="success" hint="KEX · Flash · J&T · ไปรษณีย์"/>
      </div>

      {/* Today's sales by channel — real orders + ปรับสต็อก "ขายผ่าน …" sales.
          (Was a constant list that always read 0.) Hidden without viewSales. */}
      {(typeof canDo !== "function" || canDo("viewSales")) && (() => {
        const rows = typeof channelToday === "function" ? channelToday() : [];
        const total = rows.reduce((n, c) => n + c.units, 0);
        return (
          <div className="card card-tight">
            <div className="card-head">
              <div>
                <h3>ขายวันนี้ตามช่องทาง</h3>
                <div className="sub">{total ? `รวม ${total} ชิ้น · นับรวมการปรับสต็อก “ขายผ่าน …”` : "ยังไม่มีการขายวันนี้"}</div>
              </div>
              {canOpenPage("analytics") && <button className="btn btn-ghost btn-sm" onClick={() => goTo && goTo("analytics")}>ดูรายงาน <Icons.Chev size={14}/></button>}
            </div>
            {total > 0 && (
              <div style={{ padding: "12px 18px 18px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                {rows.filter(c => c.units > 0).map(c => (
                  <div key={c.id} style={{ padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
                    <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/>
                      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>{c.name}</span>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em" }} className="tnum">{c.units} <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400 }}>ชิ้น</span></div>
                    <div className="prog" style={{ marginTop: 6, height: 4 }}><span style={{ width: c.pct + "%", background: c.color }}/></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {filterOpen && (
        <div className="card card-tight" style={{ padding:"14px 18px", animation:"modalin 0.14s ease-out" }}>
          <div className="row" style={{ gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
            <div style={{ flex:"1 1 200px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 }}>ค้นหา</div>
              <input className="input" placeholder="เลขออร์เดอร์, ชื่อลูกค้า..." value={filterQ} onChange={e => setFilterQ(e.target.value)} autoFocus/>
            </div>
            <div style={{ flex:"0 1 180px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 }}>ช่องทางขาย</div>
              <select className="input" value={filterCh} onChange={e => setFilterCh(e.target.value)}>
                <option value="all">ทั้งหมด</option>
                {CHANNEL_LIST.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {(filterCh !== "all" || filterQ) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setFilterCh("all"); setFilterQ(""); }}>
                ✕ ล้างตัวกรอง
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tabs">
        {TABS.map((t, i) => {
          const cnt = orders.filter(t.test).length;
          return (
            <div key={t.label} className={"tab" + (tab === i ? " active" : "")} onClick={() => setTab(i)}>
              {t.label}
              {cnt > 0 && <span className="nav-badge" style={{ marginLeft: 5 }}>{cnt}</span>}
            </div>
          );
        })}
      </div>

      {pickedCount > 0 && (
        <div style={{
          position: "sticky", top: 70, zIndex: 9,
          background: "var(--fg)", color: "oklch(0.99 0.003 250)",
          padding: "10px 18px",
          borderRadius: 14,
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "var(--shadow-lg)",
          animation: "modalin 0.18s cubic-bezier(0.2, 0.8, 0.3, 1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }} className="tnum">{pickedCount}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>เลือก {pickedCount} ออร์เดอร์</span>
            <button onClick={clearPicked} style={{ background: "transparent", border: "none", color: "oklch(0.85 0.005 250)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>ล้างการเลือก</button>
          </div>
          <div className="spacer"/>
          <div className="row" style={{ gap: 6, position: "relative" }}>
            <BulkBtn icon={<Icons.Truck size={13}/>} label="อัปเดตสถานะ" onClick={() => setObBulkMenu(obBulkMenu === "status" ? null : "status")}/>
            <BulkBtn icon={<Icons.Tag size={13}/>}   label="สร้างฉลาก" onClick={() => { queueLabelsAndGo(orders.filter(o => picked[o.id]), goTo); pushToast(`สร้างฉลาก ${pickedCount} ใบ`); }}/>
            <BulkBtn icon={<Icons.Print size={13}/>} label="พิมพ์ pick list" onClick={() => {
              const toPrint = orders.filter(o => picked[o.id]);
              const dateStr = new Date().toLocaleDateString("th-TH", { dateStyle: "full" });
              const timeStr = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

              /* One row per (sku, shelf) via the shared pack resolver, so the paper
                 sheet, the mobile pack screen and the desktop queue all send the
                 picker to the SAME position. It matters: the resolver uses the shelf
                 the sale actually debited (lineItems[].loc) and walks the location
                 tree in physical order, where this used to print the product's
                 primary p.loc sorted alphabetically — which misdirects the picker
                 for any SKU whose stock is split across positions. */
              const waveLines = (typeof packLinesForOrders === "function") ? packLinesForOrders(toPrint) : [];
              const skuRows = waveLines.map(l => [l.sku, {
                name: l.name,
                loc: l.loc ? (((typeof locParts === "function" && locParts(l.loc)) || {}).pos || l.loc) : "—",
                locSub: l.parts ? `${l.parts.building}${l.parts.floor ? " · " + l.parts.floor : ""}` : "",
                shelfQty: l.shelfQty,
                orders: l.per.map(pr => {
                  const src = toPrint.find(x => x.id === pr.orderId);
                  return { id: pr.orderId, customer: (src && src.customer) || "—", qty: pr.qty };
                }),
                total: l.qty
              }]);
              const totalQty = skuRows.reduce((s,[,v]) => s + v.total, 0);
              const hasLineItems = skuRows.length > 0;

              const skuTable = hasLineItems ? `
                <h3>รายการหยิบสินค้า (เรียงตามตำแหน่ง)</h3>
                <table>
                  <thead><tr><th>☑</th><th>ตำแหน่ง</th><th>SKU</th><th>ชื่อสินค้า</th><th class="num">รวมหยิบ</th><th>ออร์เดอร์ที่ต้องการ</th></tr></thead>
                  <tbody>${skuRows.map(([sku,v]) => `
                    <tr>
                      <td><span class="chk"></span></td>
                      <td class="mono loc">${v.loc}${v.locSub ? `<div class="small" style="font-weight:400;color:#666">${v.locSub}</div>` : ""}</td>
                      <td class="mono">${sku}</td>
                      <td>${v.name}</td>
                      <td class="num bold">${v.total}${v.shelfQty < v.total ? `<div class="small" style="color:#c62828;font-weight:400">ในชั้นมี ${v.shelfQty}</div>` : ""}</td>
                      <td class="small">${v.orders.map(r=>`${r.id} (${r.qty})`).join(", ")}</td>
                    </tr>`).join("")}
                    <tr class="total-row"><td colspan="4" style="text-align:right;font-weight:600">รวมทั้งหมด</td><td class="num bold">${totalQty}</td><td></td></tr>
                  </tbody>
                </table>` : `<div class="note">⚠️ ออร์เดอร์ที่เลือกเป็นฉลาก/ไม่มีรายการสินค้า (line items) — ตารางหยิบตาม SKU จึงว่าง แสดงเฉพาะสรุปออร์เดอร์ด้านล่าง</div>`;

              const orderTable = `
                <h3 style="margin-top:32px">สรุปออร์เดอร์ (${toPrint.length} รายการ)</h3>
                <table>
                  <thead><tr><th>#</th><th>เลขออร์เดอร์</th><th>ลูกค้า</th><th>ช่องทาง</th><th class="num">ชิ้น</th><th>ขนส่ง</th><th>สถานะ</th></tr></thead>
                  <tbody>${toPrint.map((o,i) => `
                    <tr>
                      <td class="mono">${i+1}</td>
                      <td class="mono">${o.id}</td>
                      <td>${o.customer||"—"}</td>
                      <td>${o.channel||"—"}</td>
                      <td class="num">${Array.isArray(o.lineItems)&&o.lineItems.length ? o.lineItems.reduce((s,x)=>s+(x.qty||1),0) : (o.items||0)}</td>
                      <td>${o.carrier||"—"}</td>
                      <td>${ORDER_STATUS_TH[o.status]||o.status}</td>
                    </tr>`).join("")}
                  </tbody>
                </table>`;

              const css = `*{box-sizing:border-box}body{font-family:'Sarabun',sans-serif;padding:24px;color:#111;font-size:13px;max-width:960px;margin:0 auto}
                @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&family=IBM+Plex+Mono:wght@400;600&display=swap');
                h2{margin:0 0 2px;font-size:20px}h3{margin:0 0 10px;font-size:14px;font-weight:600;color:#444}
                .meta{color:#666;font-size:12px;margin-bottom:20px}
                .btn{padding:8px 18px;cursor:pointer;margin-bottom:16px;font-size:13px;border:1px solid #ccc;border-radius:6px;background:#f5f5f5}
                table{width:100%;border-collapse:collapse;margin-bottom:8px}
                th{background:#f0f0f0;padding:7px 10px;text-align:left;border-bottom:2px solid #ccc;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
                td{padding:7px 10px;border-bottom:1px solid #eee;font-size:12px;vertical-align:top}
                .mono{font-family:'IBM Plex Mono',monospace;font-size:11px}
                .loc{font-weight:600;color:#1a56db}
                .num{text-align:right}
                .bold{font-weight:600}
                .small{font-size:11px;color:#555}
                .chk{display:inline-block;width:14px;height:14px;border:1.5px solid #999;border-radius:3px}
                .total-row td{border-top:2px solid #ccc;border-bottom:none;background:#f9f9f9}
                .note{padding:12px 14px;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;color:#8a6d00;font-size:12px;margin-bottom:16px}
                @media print{.btn{display:none!important}tr{page-break-inside:avoid}}`;

              const w = window.open("", "_blank");
              w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pick List — ${dateStr}</title><style>${css}</style></head><body>
                <h2>📋 Pick List — ${dateStr} ${timeStr}</h2>
                <div class="meta">${toPrint.length} ออร์เดอร์ · ${totalQty} ชิ้น · พิมพ์โดย ${(window.__currentUser&&window.__currentUser.name)||"Staff"}</div>
                <button class="btn" onclick="window.print()">🖨 พิมพ์</button>
                ${skuTable}${orderTable}
              </body></html>`);
              w.document.close();
            }}/>
            {canDeleteData() && <BulkBtn icon={<Icons.Refresh size={13}/>} label="ยกเลิก + คืนสต็อก" onClick={bulkCancelRestock}/>}
            {canDeleteData() && <BulkBtn icon={<Icons.Trash size={13}/>} label="ลบ" onClick={bulkDeleteOrders} danger/>}
            {obBulkMenu === "status" && (
              <div ref={obBulkMenuRef} style={{
                position: "absolute", top: "calc(100% + 8px)", right: 0,
                background: "var(--surface)", color: "var(--fg)",
                border: "1px solid var(--border)", borderRadius: 12,
                boxShadow: "var(--shadow-lg)", padding: 6, minWidth: 200, zIndex: 30,
                animation: "modalin 0.14s ease-out"
              }}>
                <div style={{ padding: "6px 10px 4px", fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>เปลี่ยนสถานะเป็น</div>
                {[
                  { id: "picking", label: ORDER_STATUS_TH.picking, icon: Icons.Box },
                  { id: "packed",  label: ORDER_STATUS_TH.packed,  icon: Icons.Pkg },
                  { id: "shipped", label: ORDER_STATUS_TH.shipped, icon: Icons.Truck }
                ].map(s => {
                  const I = s.icon;
                  return (
                    <button key={s.id} className="popover-item" onClick={() => bulkUpdateStatus(s.id)}>
                      <I size={13} style={{ color: "var(--muted)" }}/>
                      <span style={{ flex: 1 }}>{s.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card card-tight">
        <table className="t">
          <thead><tr>
            <th style={{ width: 24 }}>
              <span
                className={"check" + (allPicked || somePicked ? " on" : "")}
                onClick={toggleAllOrders}
                style={somePicked && !allPicked ? { background: "var(--accent-soft)", borderColor: "var(--accent)" } : {}}
                title={allPicked ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
              />
            </th>
            <th>เลขที่ออร์เดอร์</th>
            <th>ช่องทาง</th>
            <th>ลูกค้า</th>
            <th className="t-num">รายการ</th>
            <th>ขนส่ง</th>
            <th>เลขพัสดุ</th>
            <th>สถานะ</th>
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {tabOrders.map(o => {
              const stCls = STATUS_CLS[o.status]   || "badge-neutral";
              const stLab = STATUS_LABEL[o.status] || o.status;
              const on = !!picked[o.id];
              // resolve channel meta
              const chMeta = CHANNEL_LIST.find(c => c.name === o.channel);
              return (
                <tr key={o.id}>
                  <td><span className={"check" + (on ? " on" : "")} onClick={() => setPicked(p => ({ ...p, [o.id]: !p[o.id] }))}/></td>
                  <td className="t-mono" style={{ color: "var(--fg)" }} title={o.id}>
                    {typeof orderShortId === "function" ? orderShortId(o) : o.id}
                    {o.isBundle && <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px" }} title={o.bundleName}><Icons.Bundle size={9}/> ชุด</span>}
                  </td>
                  <td>
                    {chMeta ? (
                      <span className="ch-chip"><span className="swatch" style={{ background: chMeta.color }}/>{o.channel}</span>
                    ) : (
                      <span className="badge badge-neutral">{typeof orderChannelLabel === "function" ? orderChannelLabel(o) : o.channel}</span>
                    )}
                  </td>
                  <td style={!o.customer || o.customer === "ไม่ระบุชื่อ" ? { color: "var(--muted)" } : undefined}>{o.customer || "ไม่ระบุชื่อ"}</td>
                  <td className="t-num tnum">{Number(o.items) > 0 ? o.items : "—"}</td>
                  <td>{o.carrier}</td>
                  <td className="t-mono">{o.tracking}</td>
                  <td><span className={"badge " + stCls}><span className="dot"/>{stLab}</span></td>
                  <td><button className="btn btn-ghost btn-icon" title="สร้างฉลากจัดส่ง" onClick={() => { queueLabelsAndGo(o, goTo); pushToast(`สร้างฉลาก ${o.id}`); }}><Icons.Tag size={14}/></button></td>
                </tr>
              );
            })}
            {/* Without this an empty result renders a header over blank space —
                and a filter set from a search hit looks like a broken screen. */}
            {tabOrders.length === 0 && (
              <tr><td colSpan="9" style={{ textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13 }}>
                <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 8 }}/>
                <div>{tab === 1 && !filterQ && filterCh === "all" ? "ไม่มีออร์เดอร์ค้างส่ง" : (filterQ || filterCh !== "all" || TABS[tab].filtered) ? "ไม่พบออร์เดอร์ที่ตรงกับตัวกรอง" : "ยังไม่มีออร์เดอร์"}</div>
                {tab !== 0 && !filterQ && filterCh === "all" && <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setTab(0)}>ดูทั้งหมด</button>}
                {(filterQ || filterCh !== "all") && (
                  <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setFilterCh("all"); setFilterQ(""); }}>ล้างตัวกรอง</button>
                )}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {issueOpen && <IssueModal onClose={() => setIssueOpen(false)} onSubmit={submitIssue} pushToast={pushToast}/>}
      <ConfirmDialog open={!!obBulkConfirm} {...(obBulkConfirm || {})} onCancel={() => setObBulkConfirm(null)}/>
    </div>
  );
}

/* ========= ISSUE (stock-out) MODAL ========= */
function SkuPicker({ value, onChange, products }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = products.find(p => p.sku === value);
  const filtered = products.filter(p =>
    !q ||
    p.sku.toLowerCase().includes(q.toLowerCase()) ||
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.cat.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input"
        style={{
          width: "100%",
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer",
          textAlign: "left",
          padding: "8px 12px",
          height: "auto"
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {current ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.name}</div>
              <div className="row" style={{ gap: 6, marginTop: 1 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{current.sku}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>·</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{current.cat}</span>
              </div>
            </>
          ) : <span style={{ color: "var(--muted)" }}>เลือกสินค้า…</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", color: "var(--muted)", lineHeight: 0.7 }}>
          <span style={{ fontSize: 9 }}>▲</span>
          <span style={{ fontSize: 9 }}>▼</span>
        </div>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "var(--shadow-lg)",
          zIndex: 200,
          maxHeight: 360,
          display: "flex", flexDirection: "column",
          overflow: "hidden",
          animation: "modalin 0.14s cubic-bezier(0.2, 0.8, 0.3, 1)"
        }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <div className="search" style={{ width: "100%" }}>
              <Icons.Search size={14}/>
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="พิมพ์เพื่อค้นหา SKU, ชื่อ, หรือหมวด"
              />
              {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}><Icons.X size={12}/></span>}
            </div>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {filtered.map(p => {
              const s = stockStatus(p);
              const isCurrent = p.sku === value;
              return (
                <div
                  key={p.sku}
                  onClick={() => { onChange(p.sku); setOpen(false); setQ(""); }}
                  style={{
                    padding: "10px 14px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    background: isCurrent ? "var(--accent-soft)" : "transparent",
                    display: "flex", alignItems: "center", gap: 12
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                    <div className="row" style={{ gap: 6, marginTop: 2 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>·</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{p.cat}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>·</span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.loc}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{p.qty}</div>
                    <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 7px", marginTop: 2 }}><span className="dot"/>{s.label}</span>
                  </div>
                  {isCurrent && <Icons.Check size={14} style={{ color: "var(--accent)", flexShrink: 0 }}/>}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
                <div>ไม่พบสินค้าที่ตรงกับ "{q}"</div>
              </div>
            )}
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)", background: "var(--surface-2)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>{filtered.length} จาก {products.length} รายการ</span>
              <span><span className="kbd">Esc</span> ปิด</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* MULTI-ITEM stock-out. The cart takes any number of products AND bundles;
   every line carries its own จำนวน, ช่องทาง and (for a split sku) the shelf it
   is picked from, and one confirm writes ONE order. The old form is the 1-line
   case of this, and its "split one sku across channels" is now two lines with
   the same sku — nothing the previous version could do was lost.
   presetSkus prefills the cart (opened from the สินค้าคงคลัง bulk bar). */
const ISSUE_DEFAULT_CH = "shopee";
function IssueModal({ onClose, onSubmit, presetSkus, pushToast }) {
  const toast = pushToast || ((m) => { try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: m })); } catch (e) {} });
  // Keep stock/bundle numbers live while the modal is open (mirrors SellProductModal)
  const [stockKey, setStockKey] = useState(0);
  useEffect(() => {
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

  const bundles = useMemo(() => (typeof loadBundles === "function" ? loadBundles() : []), [stockKey]);
  const effQty = (sku) => (typeof getEffectiveQty === "function"
    ? getEffectiveQty(sku)
    : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));

  // A line is identified by (type, sku|bundle id, channel) — that triple is the
  // cart key, so the same sku on two channels is two independent lines.
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

  const [startCh] = useState(() => (typeof lastIssueChannel === "function") ? lastIssueChannel() : ISSUE_DEFAULT_CH);
  const [cart, setCart] = useState(() =>
    (Array.isArray(presetSkus) ? presetSkus : [])
      .map(s => PRODUCTS.find(p => p.sku === s))
      .filter(Boolean)
      .map(p => productLine(p, startCh))
  );
  const [defCh, setDefChRaw] = useState(startCh);
  const setDefCh = (ch) => { setDefChRaw(ch); if (typeof rememberIssueChannel === "function") rememberIssueChannel(ch); };
  const [customer, setCustomer] = useState("");
  const [ship, setShip] = useState({ phone: "", carrier: "", tracking: "" });
  const [camOpen, setCamOpen] = useState(false);
  // วันเวลาที่ขาย — "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM" (issueOrderDate).
  const [orderDate, setOrderDate] = useState("");
  const [tab, setTab] = useState("product");   // picker tab: product | bundle
  const [q, setQ] = useState("");
  const [showN, setShowN] = useState(30);
  const [pickOpen, setPickOpen] = useState(!(presetSkus && presetSkus.length));
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const scanRef = useRef(null);

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

  // Scan / typed SKU → add to the cart. Product SELECTION only (exact match),
  // not a third barcode-resolution funnel.
  const submitScan = (code) => {
    const s = String(code ?? scan).trim();
    if (!s) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === s.toLowerCase());
    if (!p) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      toast("ไม่พบ SKU: " + s);
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    setScan("");
    addProduct(p);
  };

  /* Stock is validated per SKU across the WHOLE cart (bundle components folded
     in), not per line — two lines of the same sku on different channels must
     not each pass on their own. */
  const needBySku = {};
  cart.forEach(l => {
    if (l.type === "bundle") (l.items || []).forEach(ci => { needBySku[ci.sku] = (needBySku[ci.sku] || 0) + (Number(ci.qty) || 0) * l.qty; });
    else needBySku[l.sku] = (needBySku[l.sku] || 0) + l.qty;
  });
  const shortages = Object.keys(needBySku)
    .filter(s => needBySku[s] > effQty(s))
    .map(s => {
      const p = PRODUCTS.find(x => x.sku === s);
      return `${p ? p.name : s}: ต้องการ ${needBySku[s]} แต่มีเพียง ${effQty(s)}`;
    });
  const shortSku = (sku) => needBySku[sku] > effQty(sku);
  const totalUnits = cart.reduce((s, l) => s + l.qty, 0);
  const totalPieces = Object.keys(needBySku).reduce((s, k) => s + needBySku[k], 0);
  const cartValue = cart.reduce((s, l) => s + (l.price || 0) * l.qty, 0);
  const chSummary = CHANNEL_LIST
    .map(c => ({ ...c, qty: cart.filter(l => l.ch === c.id).reduce((s, l) => s + l.qty, 0) }))
    .filter(c => c.qty > 0);
  const mixedCh = chSummary.length > 1;

  const qL = q.toLowerCase();
  const prodMatches = PRODUCTS.filter(p =>
    !q || p.sku.toLowerCase().includes(qL) || p.name.toLowerCase().includes(qL) || (p.cat || "").toLowerCase().includes(qL)
  );
  const bundleMatches = bundles.filter(b =>
    !q || b.name.toLowerCase().includes(qL) || b.id.toLowerCase().includes(qL)
  );

  const canSubmit = cart.length > 0 && totalUnits > 0 && shortages.length === 0 && !busy;
  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try { await onSubmit({ customer, ship, orderDate, lines: cart }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ width: 720, maxWidth: "calc(100vw - 40px)", maxHeight: "92vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>สร้างใบจัดส่ง · ตัดสต็อก</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {cart.length
                ? `เลือกไว้ ${cart.length} รายการ · รวม ${totalPieces} ชิ้น — ตัดพร้อมกันในออร์เดอร์เดียว`
                : "เลือกได้หลายรายการพร้อมกัน — สินค้าเดี่ยวและชุดสินค้า ระบุจำนวนและช่องทางแยกรายบรรทัด"}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>

        <div className="modal-body">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>สแกนบาร์โค้ด / พิมพ์ SKU เพื่อเพิ่มเข้ารายการ</label>
            <input ref={scanRef} className="input" value={scan} onChange={e => setScan(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitScan(); }}
              placeholder="ยิงบาร์โค้ดหรือพิมพ์ SKU แล้วกด Enter" autoFocus/>
            {!camOpen && (
              <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setCamOpen(true)}>
                <Icons.Camera size={13}/> สแกนด้วยกล้อง
              </button>
            )}
            {camOpen && typeof CameraScanner === "function" && (
              <div style={{ marginTop: 8 }}>
                <CameraScanner continuous onScan={code => submitScan(code)} onClose={() => setCamOpen(false)}/>
              </div>
            )}
          </div>

          {/* Default channel — new lines inherit it, so a 10-line Shopee batch is one click */}
          <div className="field" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ margin: 0 }}>ช่องทาง <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ใช้กับรายการที่เพิ่มใหม่)</span></label>
              {cart.length > 0 && (
                <button className="btn btn-sm" onClick={applyChToAll}>ใช้กับทุกแถว</button>
              )}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {CHANNEL_LIST.map(c => (
                <button key={c.id} className={"btn btn-sm" + (defCh === c.id ? " btn-accent" : "")} onClick={() => setDefCh(c.id)}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/> {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Product / bundle picker */}
          <div className="field" style={{ marginBottom: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ margin: 0 }}>เลือกสินค้า {cart.length > 0 && <span style={{ color: "var(--accent)" }}>({cart.length})</span>}</label>
              <button className="btn btn-sm" onClick={() => setPickOpen(o => !o)}>
                {pickOpen ? <><Icons.Chev size={12} style={{ transform: "rotate(-90deg)" }}/> ซ่อนรายการ</> : <><Icons.Plus size={12}/> เลือกสินค้าเพิ่ม</>}
              </button>
            </div>
            {pickOpen && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
                <div style={{ padding: 8, borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  <div className="seg" style={{ width: "100%", marginBottom: 8 }}>
                    <button className={tab === "product" ? "on" : ""} style={{ flex: 1 }} onClick={() => { setTab("product"); setShowN(30); }}>
                      <Icons.Box size={13}/> สินค้าเดี่ยว
                    </button>
                    <button className={tab === "bundle" ? "on" : ""} style={{ flex: 1 }} onClick={() => { setTab("bundle"); setShowN(30); }}>
                      <Icons.Bundle size={13}/> ชุดสินค้า
                    </button>
                  </div>
                  <div className="search" style={{ width: "100%" }}>
                    <Icons.Search size={14}/>
                    <input value={q} onChange={e => { setQ(e.target.value); setShowN(30); }} placeholder="ค้นหา SKU, ชื่อสินค้า, หมวด..."/>
                    {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => { setQ(""); setShowN(30); }}><Icons.X size={12}/></span>}
                  </div>
                </div>
                <div style={{ maxHeight: 230, overflowY: "auto", overscrollBehavior: "contain" }}>
                  {tab === "product" && prodMatches.slice(0, showN).map(p => {
                    const s = stockStatus(p);
                    const inCart = cart.filter(l => l.type === "product" && l.sku === p.sku).reduce((n, l) => n + l.qty, 0);
                    return (
                      <div key={p.sku} onClick={() => addProduct(p)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                          cursor: "pointer", borderBottom: "1px solid var(--border)",
                          background: inCart ? "var(--accent-soft)" : "transparent"
                        }}>
                        {typeof ProductImageThumb === "function" && <ProductImageThumb sku={p.sku} size={34} radius={7}/>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                          <div className="row" style={{ gap: 6, marginTop: 1 }}>
                            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</span>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>· {p.cat}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{effQty(p.sku)}</div>
                          <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 7px", marginTop: 2 }}><span className="dot"/>{s.label}</span>
                        </div>
                        {inCart > 0 && <span className="badge badge-info" style={{ fontSize: 10, flexShrink: 0 }}>×{inCart}</span>}
                        <Icons.Plus size={14} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                      </div>
                    );
                  })}
                  {tab === "product" && prodMatches.length > showN && (
                    <button className="btn btn-sm" style={{ width: "100%", borderRadius: 0, justifyContent: "center" }} onClick={() => setShowN(n => n + 30)}>
                      ดูเพิ่ม — แสดง {showN} จาก {prodMatches.length} รายการ
                    </button>
                  )}
                  {tab === "bundle" && bundleMatches.map(b => {
                    const max = (typeof bundleAvail === "function") ? bundleAvail(b) : 0;
                    const inCart = cart.filter(l => l.type === "bundle" && l.id === b.id).reduce((n, l) => n + l.qty, 0);
                    return (
                      <div key={b.id} onClick={() => addBundle(b)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                          cursor: "pointer", borderBottom: "1px solid var(--border)",
                          background: inCart ? "var(--accent-soft)" : "transparent"
                        }}>
                        <span style={{ width: 34, height: 34, borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                          <Icons.Bundle size={16}/>
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{b.items.length} รายการ/ชุด · ฿{(b.price || 0).toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="tnum" style={{ fontSize: 14, fontWeight: 600, color: max === 0 ? "var(--danger)" : "var(--fg)" }}>{max}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)" }}>ชุดที่ทำได้</div>
                        </div>
                        {inCart > 0 && <span className="badge badge-info" style={{ fontSize: 10, flexShrink: 0 }}>×{inCart}</span>}
                        <Icons.Plus size={14} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                      </div>
                    );
                  })}
                  {((tab === "product" && prodMatches.length === 0) || (tab === "bundle" && bundleMatches.length === 0)) && (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                      {tab === "bundle" && bundles.length === 0 ? "ยังไม่มีชุดสินค้า — สร้างชุดได้ที่หน้า “ชุดสินค้า”" : `ไม่พบรายการที่ตรงกับ "${q}"`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* The cart */}
          {cart.length === 0 ? (
            <div style={{ padding: 22, textAlign: "center", color: "var(--muted)", fontSize: 13, border: "1px dashed var(--border)", borderRadius: 12, marginBottom: 14 }}>
              <Icons.Out size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
              <div>ยังไม่ได้เลือกสินค้า — สแกนบาร์โค้ดหรือกดเลือกจากรายการด้านบน</div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500 }}>รายการที่จะตัดสต็อก ({cart.length})</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setCart([])}>ล้างทั้งหมด</button>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {cart.map(l => {
                  const isB = l.type === "bundle";
                  const p = isB ? null : PRODUCTS.find(x => x.sku === l.sku);
                  const short = isB
                    ? (l.items || []).some(ci => shortSku(ci.sku))
                    : shortSku(l.sku);
                  return (
                    <div key={l.key} style={{
                      display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 10px",
                      border: "1px solid " + (short ? "var(--danger)" : "var(--border)"),
                      background: short ? "var(--danger-soft)" : "var(--surface-2)", borderRadius: 10
                    }}>
                      {isB ? (
                        <span style={{ width: 34, height: 34, borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                          <Icons.Bundle size={16}/>
                        </span>
                      ) : (typeof ProductImageThumb === "function" && <ProductImageThumb sku={l.sku} size={34} radius={7}/>)}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {isB && <span className="badge badge-neutral" style={{ fontSize: 9, marginRight: 6 }}>ชุด</span>}{l.name}
                        </div>
                        <div className="row" style={{ gap: 6, marginTop: 1 }}>
                          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{isB ? l.id : l.sku}</span>
                          <span className="tnum" style={{ fontSize: 11, color: short ? "var(--danger)" : "var(--muted)" }}>
                            {isB
                              ? `${(l.items || []).length} รายการ/ชุด`
                              : `คงเหลือ ${effQty(l.sku)} → ${Math.max(0, effQty(l.sku) - (needBySku[l.sku] || 0))}`}
                          </span>
                        </div>
                        {/* Split sku → pick the shelf for THIS line */}
                        {!isB && <LocPickSelect sku={l.sku} value={l.loc} need={l.qty} onChange={loc => setLineLoc(l.key, loc)}/>}
                      </div>
                      <select className="input" style={{ height: 30, fontSize: 12, padding: "2px 6px", width: 118, flexShrink: 0 }}
                        value={l.ch} onChange={e => setLineCh(l.key, e.target.value)} title="ช่องทางของรายการนี้">
                        {CHANNEL_LIST.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <div className="qty-stepper" style={{ flexShrink: 0 }}>
                        <button onClick={() => setLineQty(l.key, l.qty - 1)}>−</button>
                        <input value={l.qty} onChange={e => setLineQty(l.key, Math.max(0, parseInt(e.target.value, 10) || 0))}/>
                        <button onClick={() => setLineQty(l.key, l.qty + 1)}>+</button>
                      </div>
                      <button onClick={() => removeLine(l.key)} title="เอาออก"
                        style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", flexShrink: 0 }}>
                        <Icons.X size={14}/>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sale date/time — backdating files a late-keyed order under the moment it sold. */}
          <StockOutWhenField value={orderDate} onChange={setOrderDate} label="วันเวลาที่ขาย"
            hint="ตัดสต็อกย้อนหลัง? เลือกวันเวลาที่ขายจริง — ออร์เดอร์และยอดขายจะนับเป็นวันนั้น"/>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>ลูกค้า / เลขที่อ้างอิง <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ไม่จำเป็น)</span></label>
            <input className="input" placeholder="เช่น คุณ ปวีณา ท. / Shopee #2025-119283" value={customer} onChange={e => setCustomer(e.target.value)}/>
          </div>

          {/* Optional shipping details — a tracking number marks the order ส่งแล้ว
              straight away and shows it on the customer tracking page. */}
          <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ flex: "1 1 140px", margin: 0 }}>
              <label>เบอร์โทร <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ไม่จำเป็น)</span></label>
              <input className="input" inputMode="tel" value={ship.phone} onChange={e => setShip(s => ({ ...s, phone: e.target.value }))} placeholder="08x-xxx-xxxx"/>
            </div>
            <div className="field" style={{ flex: "1 1 130px", margin: 0 }}>
              <label>ขนส่ง</label>
              <select className="input" value={ship.carrier} onChange={e => setShip(s => ({ ...s, carrier: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {(typeof ISSUE_CARRIERS !== "undefined" ? ISSUE_CARRIERS : []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: "2 1 180px", margin: 0 }}>
              <label>เลขพัสดุ <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ใส่แล้ว = ส่งแล้ว)</span></label>
              <input className="input mono" value={ship.tracking} onChange={e => setShip(s => ({ ...s, tracking: e.target.value }))} placeholder="เช่น TH0123456789"/>
            </div>
          </div>

          {shortages.length > 0 && (
            <div style={{ padding: "10px 12px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 10, fontSize: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>สต็อกไม่พอ</div>
              {shortages.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12 }}>
                <div>รวมตัดสต็อก</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  {cart.length} รายการ · มูลค่า ฿{cartValue.toLocaleString()}
                </div>
              </div>
              <div className="tnum" style={{ fontSize: 22, fontWeight: 600 }}>
                {totalPieces} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>ชิ้น{mixedCh ? ` · ${chSummary.length} ช่องทาง` : ""}</span>
              </div>
            </div>
            {chSummary.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {chSummary.map(c => (
                  <span key={c.id} className="ch-chip">
                    <span className="swatch" style={{ background: c.color }}/>{c.name} <strong className="tnum" style={{ marginLeft: 4 }}>{c.qty}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit} style={!canSubmit ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> ยืนยันตัดสต็อก{cart.length > 1 ? ` ${cart.length} รายการ` : ""}
          </button>
        </div>
      </div>
    </>
  );
}

/* Shared ตัดสต็อก commit — the จัดส่งสินค้า header button and the สินค้าคงคลัง
   bulk bar open the SAME modal, so the write lives in one place. Deducts every
   sku, re-balances the position split in the same tick, records the audit entry
   and appends ONE order (appendOrder = the convergence-safe writer). */
async function commitIssueOrder(data, pushToast) {
  const toast = pushToast || (() => {});
  const plan = (typeof buildIssuePlan === "function") ? buildIssuePlan(data.lines) : null;
  if (!plan || !plan.skuDeducts.length) { toast("ยังไม่ได้เลือกสินค้า"); return null; }

  const id = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
  const od = (typeof issueOrderDate === "function")
    ? issueOrderDate(data.orderDate)
    : { dateIso: new Date().toISOString().slice(0, 10), ts: "", backdated: false };
  const ts = od.ts;
  const dateIso = od.dateIso;
  const dateNote = od.backdated ? ` · ขายวันที่ ${typeof isoToThai === "function" ? isoToThai(dateIso) : dateIso}${ts ? " " + ts : ""}` : "";

  const pieces = plan.skuDeducts.reduce((s, d) => s + d.qty, 0);

  deductManyAndPersist(plan.skuDeducts, `ตัดสต็อก · ออร์เดอร์ ${id} (${plan.channelLabel})${dateNote}`);
  // Same tick as the qty write, before any other await — applyLocPicks re-reads p.qty.
  if (typeof applyLocPicks === "function") {
    const r = await applyLocPicks(plan.locPicks);
    if (r && r.offline) toast("ตัดสต็อกแล้ว — จำนวนตามตำแหน่งจะอัปเดตเมื่อออนไลน์");
    else if (r && r.errors && r.errors.length) toast("ตัดสต็อกสำเร็จ แต่ปรับตำแหน่งไม่สำเร็จ: " + r.errors[0].error);
  }

  if (typeof recordChange === "function") {
    recordChange({
      entity: "order", entityId: id, action: "create",
      summary: `ตัดสต็อก ${plan.lineCount} รายการ (${pieces} ชิ้น) ผ่านหน้าจัดส่ง`,
      count: plan.lineCount,
      changes: data.lines.filter(l => l.qty > 0).map(l => ({
        label: l.type === "bundle" ? `ชุด: ${l.name}` : l.name,
        to: `−${l.qty} ${l.type === "bundle" ? "ชุด" : "ชิ้น"}`
      })),
      note: `ออร์เดอร์ ${id} · ${plan.channelLabel}${dateNote}`
    });
  }

  const sf =(typeof issueShipFields === "function")
    ? issueShipFields(data.ship)
    : { tracking: "", carrier: "", phone: "", status: "picking" };
  const res = await appendOrder({
    id, channel: plan.channelLabel, customer: data.customer || "ลูกค้าใหม่",
    items: plan.lineCount, status: sf.status, carrier: sf.carrier, tracking: sf.tracking,
    ...(sf.phone ? { phone: sf.phone } : {}),
    ts, dateIso, deductions: plan.channelSplit,
    ...(od.backdated && od.createdAt ? { createdAt: od.createdAt } : {}),
    isBundle: plan.hasBundle,
    bundleName: plan.hasBundle ? plan.bundleNames.join(", ") : undefined,
    lineItems: plan.lineItems
  });
  if (res && res.error) toast("⚠️ ออร์เดอร์จะซิงค์อัตโนมัติเมื่อออนไลน์");

  const only = data.lines.filter(l => l && l.qty > 0)[0];
  toast((plan.lineCount === 1 && only
    ? `ตัดสต็อก ${only.name} ${pieces} ชิ้น — ${plan.channelLabel}`
    : `ตัดสต็อก ${plan.lineCount} รายการ (${pieces} ชิ้น) — ${plan.channelLabel}`) + (od.backdated ? ` (ย้อนหลัง ${typeof isoToThai === "function" ? isoToThai(dateIso) : dateIso}${ts ? " " + ts : ""})` : ""));
  return id;
}

function SmallStat({ label, value, hint, tone }) {
  const map = { warning: "var(--warning)", info: "var(--info)", success: "var(--success)", danger: "var(--danger)" };
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="eyebrow">{label}</div>
        <div style={{ width: 6, height: 6, borderRadius: 999, background: map[tone] }}/>
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 8, letterSpacing: "-0.02em", fontFamily: "IBM Plex Sans, sans-serif" }} className="tnum">{value}</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{hint}</div>
    </div>
  );
}

/* ========= INVENTORY ========= */
function Inventory({ pushToast, density, goTo, focus }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("ทั้งหมด");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locFilter, setLocFilter] = useState(false); // true = only products not stored in a real position
  const [sort, setSort] = useState({ key: null, dir: 1 });     // column sort
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  useEffect(() => {
    if (!exportOpen) return;
    const h = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [exportOpen]);
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState({}); // { sku: true }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [assignSkus, setAssignSkus] = useState(null); // array of skus → open AssignLocationModal
  const [issueSkus, setIssueSkus] = useState(null);   // array of skus → open IssueModal prefilled
  const [stockKey, setStockKey] = useState(0);

  // Re-render whenever the shared stock-adjustment layer, the product catalog
  // OR the location tree changes (tree edits change which locs count as stored)
  useEffect(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    window.addEventListener("ims-locations-change", refresh);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
      window.removeEventListener("ims-locations-change", refresh);
    };
  }, []);

  /* Opened from the global search / notifications with a specific SKU — show that
     product's drawer straight away. Keyed on focus.n (a fresh nonce per click) so
     clicking a hit while ALREADY on this page still opens it, and clicking the
     same hit twice re-opens it after a close. Filters are left alone: the drawer
     reads the full catalog, so a filtered-out product still opens. */
  useEffect(() => {
    if (focus && focus.sku) setOpen(focus.sku);
  }, [focus && focus.n]);

  const products = PRODUCTS;

  // Overlay the shared stock-adjustment layer so bundle deductions show here too
  const liveProducts = useMemo(() => {
    const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
    return products.map(p => ({ ...p, qty: Math.max(0, p.qty + (adj[p.sku] || 0)) }));
  }, [products, stockKey]);

  const addProduct = (p) => {
    // _locRows carries the multi-position split from the form. Strip it with omit()
    // — object-rest would collide with another file's Babel temp (see CLAUDE.md).
    const rows = p._locRows;
    const clean = (typeof omit === "function") ? omit(p, "_locRows") : p;
    addProductToStore({ ...clean, reserved: 0 });
    // The product must exist before its split can reference it.
    if (rows && rows.length > 1 && typeof saveLocSplit === "function") {
      saveLocSplit(p.sku, rows).then(res => {
        if (res && res.ok === false) pushToast(res.error || "บันทึกการแบ่งตำแหน่งไม่สำเร็จ");
      }).catch(() => {});
    }
    pushToast(`เพิ่ม SKU ${p.sku} แล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: p.sku, action: "create",
        summary: `เพิ่มสินค้าใหม่ ${p.name} (${p.sku})`,
        changes: [
          { label: "จำนวนเริ่มต้น", to: String(p.qty) },
          { label: "ตำแหน่งจัดเก็บ", to: rows && rows.length > 1
            ? rows.map(r => `${locParts(r.loc).pos} ×${r.qty}`).join(" · ")
            : p.loc }
        ]
      });
    }
    setAddOpen(false);
  };

  const cats = useMemo(() => ["ทั้งหมด", ...(typeof loadCategories === "function" ? loadCategories() : [...new Set(products.map(p => p.cat))])], [products, stockKey]);

  // Which loc codes are real positions in the live tree — stale codes (e.g. a
  // legacy "A" from CSV import) count as NOT stored and get a warning badge.
  const storedCodes = useMemo(() => storedLocSet(), [stockKey]);
  const unstoredCount = useMemo(() => liveProducts.reduce((n, p) => n + (productIsStored(p, storedCodes) ? 0 : 1), 0), [liveProducts, storedCodes]);

  const filteredRaw = liveProducts.filter(p => {
    if (cat !== "ทั้งหมด" && p.cat !== cat) return false;
    const s = stockStatus(p).key;
    if (statusFilter !== "all" && s !== statusFilter) return false;
    if (locFilter && productIsStored(p, storedCodes)) return false;
    if (q && !(p.sku.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase()) || (p.brand || "").toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  const SORTERS = {
    sku:   (a, b) => a.sku.localeCompare(b.sku),
    name:  (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "th"),
    qty:   (a, b) => a.qty - b.qty,
    avail: (a, b) => (a.qty - a.reserved) - (b.qty - b.reserved),
  };
  const filtered = sort.key ? [...filteredRaw].sort((a, b) => SORTERS[sort.key](a, b) * sort.dir) : filteredRaw;
  const sortBy = (key) => setSort(sv => sv.key === key ? (sv.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 }) : { key, dir: 1 });
  const sortMark = (key) => sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "";
  const STATUS_TH = { ok: "พร้อมขาย", low: "ต่ำ", out: "หมด" };

  const filteredSkus = filtered.map(p => p.sku);
  const selectedSkus = filteredSkus.filter(s => selected[s]);
  const selectedCount = selectedSkus.length;
  const allFilteredSelected = filteredSkus.length > 0 && filteredSkus.every(s => selected[s]);
  const someFilteredSelected = !allFilteredSelected && filteredSkus.some(s => selected[s]);

  const toggleSku = (sku) => setSelected(s => {
    const next = { ...s };
    if (next[sku]) delete next[sku]; else next[sku] = true;
    return next;
  });
  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      setSelected(s => {
        const next = { ...s };
        filteredSkus.forEach(k => delete next[k]);
        return next;
      });
    } else {
      setSelected(s => {
        const next = { ...s };
        filteredSkus.forEach(k => { next[k] = true; });
        return next;
      });
    }
  };
  const clearSelection = () => setSelected({});

  const applyBulkEdit = (changes) => {
    updateManyProducts(selectedSkus, changes);
    pushToast(`อัปเดต ${selectedCount} รายการแล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", action: "bulk-update",
        summary: `แก้ไข ${selectedCount} SKU พร้อมกัน`,
        count: selectedCount,
        changes: Object.entries(changes).map(([k, v]) => ({ label: k, to: String(v) })),
        note: `SKU: ${selectedSkus.join(", ")}`
      });
    }
    setBulkOpen(false);
  };

  // จัดเก็บเข้าตำแหน่ง — assign every sku in assignSkus to one real position
  const applyAssign = (code) => {
    const skus = assignSkus || [];
    updateManyProducts(skus, { loc: code });
    pushToast(`จัดเก็บ ${skus.length} รายการเข้าตำแหน่ง ${code} แล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", action: "bulk-update",
        summary: `จัดเก็บ ${skus.length} SKU เข้าตำแหน่ง ${code}`,
        count: skus.length,
        changes: [{ label: "ตำแหน่งจัดเก็บ", to: code }],
        note: `SKU: ${skus.join(", ")}`
      });
    }
    setAssignSkus(null);
  };

  const bulkDelete = async () => {
    if (!confirm(`ลบสินค้าที่เลือก ${selectedCount} รายการ?`)) return;
    const removed = [...selectedSkus];
    clearSelection();
    const res = await removeProductsFromStore(removed);
    if (res && res.ok === false) { pushToast(res.error); return; }
    pushToast(`ลบ ${removed.length} รายการแล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", action: "bulk-delete",
        summary: `ลบ ${removed.length} SKU ออกจากคลัง`,
        count: removed.length,
        note: `SKU: ${removed.join(", ")}`
      });
    }
  };

  const exportInventoryCsv = (rows, filename) => {
    // ต้นทุน is dropped entirely for roles without the viewCost capability —
    // hiding the column on screen but shipping it in the file would leak it.
    const showCost = typeof canDo !== "function" || canDo("viewCost");
    const headers = ["SKU","ชื่อสินค้า","หมวดหมู่","แบรนด์","คงเหลือ","จองแล้ว","จุดสั่งซื้อ","ตำแหน่ง","ราคาขาย", ...(showCost ? ["ต้นทุน"] : []),"ผู้จัดส่ง","สถานะ"];
    const csvRows = rows.map(p => {
      const s = stockStatus(p);
      return [p.sku, p.name, p.cat, p.brand || "", p.qty, p.reserved, p.reorder, p.loc, p.price, ...(showCost ? [p.cost] : []), p.supplier, s.label]
        .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });
    const csv = "﻿" + [headers.join(","), ...csvRows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">สินค้าคงคลัง</h1>
          <div className="page-sub">{liveProducts.length} SKU • รวม {liveProducts.reduce((s,p)=>s+p.qty,0).toLocaleString()} ชิ้น</div>
        </div>
        <div className="row">
          {/* One ส่งออก menu instead of three look-alike buttons. */}
          {canDo("exportData") && (
            <div ref={exportRef} style={{ position: "relative" }}>
              <button className="btn" onClick={() => setExportOpen(o => !o)}><Icons.Pkg size={14}/> ส่งออก <Icons.Down size={12}/></button>
              {exportOpen && (
                <div className="popover" style={{ top: "calc(100% + 6px)", right: 0, left: "auto", bottom: "auto", minWidth: 240, zIndex: 40 }}>
                  <button className="popover-item" onClick={() => { setExportOpen(false); if (typeof downloadStockReport === "function") downloadStockReport(liveProducts); }}>
                    <Icons.Pkg size={14}/> รายงานสต็อก (Excel)
                  </button>
                  <button className="popover-item" onClick={() => {
                    setExportOpen(false);
                    exportInventoryCsv(filtered, `สินค้าคงคลัง_${new Date().toISOString().slice(0,10)}.csv`);
                    pushToast(`ส่งออก ${filtered.length} รายการเป็น CSV แล้ว`);
                  }}>
                    <Icons.Pkg size={14}/> รายการที่แสดงอยู่ (CSV · {filtered.length})
                  </button>
                  <button className="popover-item" onClick={() => {
                    setExportOpen(false);
                    const w = window.open("", "_blank");
            const rows = filtered.map(p => { const s = stockStatus(p); return `<tr><td class="mono">${p.sku}</td><td>${p.name}</td><td>${p.cat}</td><td class="r mono">${p.qty}</td><td class="r mono">${p.reorder}</td><td class="mono">${p.loc}</td><td>${s.label}</td></tr>`; }).join("");
            w.document.write(`<!DOCTYPE html><html><head><title>รายงานสินค้าคงคลัง</title><style>*{box-sizing:border-box}body{font-family:sans-serif;padding:24px;color:#111;font-size:13px}h2{margin:0 0 4px}p{margin:0 0 16px;color:#555}button{padding:8px 18px;cursor:pointer;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;font-size:12px;font-weight:600}td{padding:7px 10px;border-bottom:1px solid #eee}.mono{font-family:monospace;font-size:12px}.r{text-align:right}@media print{button{display:none!important}}</style></head><body><h2>รายงานสินค้าคงคลัง</h2><p>${new Date().toLocaleDateString("th-TH",{dateStyle:"full"})} · ${filtered.length} รายการ</p><button onclick="window.print()">🖨 พิมพ์</button><table><thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th>หมวด</th><th class="r">คงเหลือ</th><th class="r">จุดสั่ง</th><th>ตำแหน่ง</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
            w.document.close();
                  }}>
                    <Icons.Print size={14}/> พิมพ์รายงาน
                  </button>
                </div>
              )}
            </div>
          )}
          {canDo("addProduct") && canOpenPage("import") && <button className="btn" onClick={() => goTo && goTo("import")}><Icons.Pkg size={14}/> นำเข้า SKU จาก Excel</button>}
          {canAdjustStock() && <button className="btn" onClick={() => setAdjOpen(true)}><Icons.Refresh size={14}/> ปรับสต็อก</button>}
          {canDo("addProduct") && <button className="btn btn-accent" onClick={() => setAddOpen(true)}><Icons.Plus/> เพิ่ม SKU</button>}
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <div className="search" style={{ width: 360 }}>
            <Icons.Search size={14}/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา SKU, ชื่อสินค้า, ผู้จัดส่ง..."/>
            {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}><Icons.X size={13}/></span>}
          </div>
          {/* 21 categories as buttons ran 1,500 px wide and scrolled the page sideways. */}
          <select className="input inv-cat-select" value={cat} onChange={e => setCat(e.target.value)} title="หมวดหมู่">
            {cats.map(c => <option key={c} value={c}>{c === "ทั้งหมด" ? "ทุกหมวดหมู่" : c}</option>)}
          </select>
          <div className="spacer"/>
          {(unstoredCount > 0 || locFilter) && (
            <button
              onClick={() => setLocFilter(v => !v)}
              title={locFilter ? "แสดงสินค้าทั้งหมด" : "แสดงเฉพาะสินค้าที่ยังไม่ได้จัดเก็บเข้าตำแหน่ง"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
                border: "1px solid " + (locFilter ? "var(--warning)" : "transparent"),
                background: locFilter ? "var(--warning)" : "var(--warning-soft)",
                color: locFilter ? "#fff" : "oklch(0.5 0.13 65)"
              }}>
              <Icons.Warn size={13}/> ยังไม่จัดเก็บ <span className="tnum">{unstoredCount}</span>
            </button>
          )}
          <div className="seg">
            <button className={statusFilter === "all" ? "on" : ""} onClick={() => setStatusFilter("all")}>ทุกสถานะ</button>
            <button className={statusFilter === "ok" ? "on" : ""} onClick={() => setStatusFilter("ok")}>พร้อมขาย</button>
            <button className={statusFilter === "low" ? "on" : ""} onClick={() => setStatusFilter("low")}>ต่ำ</button>
            <button className={statusFilter === "out" ? "on" : ""} onClick={() => setStatusFilter("out")}>หมด</button>
          </div>
        </div>
        {(q || cat !== "ทั้งหมด" || statusFilter !== "all" || locFilter) && (
          <div className="row" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", gap: 10, fontSize: 12, color: "var(--muted)" }}>
            <span>กรองอยู่:</span>
            {q && <span className="badge badge-neutral">ค้นหา "{q}" <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setQ("")}/></span>}
            {cat !== "ทั้งหมด" && <span className="badge badge-neutral">หมวด: {cat} <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setCat("ทั้งหมด")}/></span>}
            {statusFilter !== "all" && <span className="badge badge-neutral">สถานะ: {STATUS_TH[statusFilter] || statusFilter} <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setStatusFilter("all")}/></span>}
            {locFilter && <span className="badge badge-warning">ยังไม่จัดเก็บ <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setLocFilter(false)}/></span>}
            <span className="spacer"/>
            <span><strong className="tnum" style={{ color: "var(--fg)" }}>{filtered.length}</strong> จาก {products.length} รายการ</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); setCat("ทั้งหมด"); setStatusFilter("all"); setLocFilter(false); }}>ล้างตัวกรอง</button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div style={{
          position: "sticky", top: 70, zIndex: 9,
          background: "var(--fg)", color: "oklch(0.99 0.003 250)",
          padding: "10px 18px",
          borderRadius: 14,
          display: "flex", alignItems: "center", gap: 12,
          boxShadow: "var(--shadow-lg)",
          animation: "modalin 0.18s cubic-bezier(0.2, 0.8, 0.3, 1)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }} className="tnum">{selectedCount}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>เลือก {selectedCount} รายการ</span>
            <button onClick={clearSelection} style={{ background: "transparent", border: "none", color: "oklch(0.85 0.005 250)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>ล้างการเลือก</button>
          </div>
          <div className="spacer"/>
          <div className="row" style={{ gap: 6 }}>
            {canDo("sell") && <BulkBtn icon={<Icons.Out size={13}/>} label="ตัดสต็อก" onClick={() => setIssueSkus([...selectedSkus])}/>}
            <BulkBtn icon={<Icons.Map size={13}/>} label="จัดเก็บเข้าตำแหน่ง" onClick={() => setAssignSkus([...selectedSkus])}/>
            {canDo("editProduct") && <BulkBtn icon={<Icons.Edit size={13}/>} label="แก้ไขทั้งหมด" onClick={() => setBulkOpen(true)}/>}
            <BulkBtn icon={<Icons.Print size={13}/>} label="พิมพ์บาร์โค้ด" onClick={() => { const items = [...selectedSkus].map(s => products.find(p => p.sku === s)).filter(Boolean); if (typeof printBarcodeLabels === "function") printBarcodeLabels(items, pushToast); }}/>
            {canDo("exportData") && <BulkBtn icon={<Icons.Pkg size={13}/>} label="ส่งออก CSV" onClick={() => { const items = [...selectedSkus].map(s => products.find(p => p.sku === s)).filter(Boolean); exportInventoryCsv(items, `สินค้าคงคลัง_เลือก_${new Date().toISOString().slice(0,10)}.csv`); pushToast(`ส่งออก ${items.length} รายการแล้ว`); }}/>}
            {canDeleteData() && <BulkBtn icon={<Icons.Trash size={13}/>} label="ลบ" onClick={bulkDelete} danger/>}
          </div>
        </div>
      )}

      {/* Scroll the table inside its card on narrower screens instead of the whole page. */}
      <div className="card card-tight" style={{ overflowX: "auto" }}>
        <table className="t">
          <thead><tr>
            <th style={{ width: 36 }}>
              <span
                className={"check" + (allFilteredSelected ? " on" : someFilteredSelected ? " on" : "")}
                onClick={toggleAllFiltered}
                style={someFilteredSelected && !allFilteredSelected ? { background: "var(--accent-soft)", borderColor: "var(--accent)" } : {}}
                title={allFilteredSelected ? "ยกเลิกเลือกทั้งหมด" : "เลือกทั้งหมด"}
              />
            </th>
            <th className="th-sort" onClick={() => sortBy("sku")}>SKU{sortMark("sku")}</th>
            <th className="th-sort" onClick={() => sortBy("name")}>ชื่อสินค้า{sortMark("name")}</th>
            <th>หมวดหมู่</th>
            <th>ตำแหน่ง</th>
            <th className="t-num th-sort" onClick={() => sortBy("qty")}>คงเหลือ{sortMark("qty")}</th>
            <th className="t-num">จอง</th>
            <th className="t-num th-sort" onClick={() => sortBy("avail")}>พร้อมขาย{sortMark("avail")}</th>
            <th>สถานะ</th>
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {filtered.map(p => {
              const s = stockStatus(p);
              const avail = p.qty - p.reserved;
              const isSelected = !!selected[p.sku];
              return (
                <tr key={p.sku} style={{ cursor: "pointer", background: isSelected ? "var(--accent-soft)" : undefined }}>
                  <td onClick={(e) => { e.stopPropagation(); toggleSku(p.sku); }}>
                    <span className={"check" + (isSelected ? " on" : "")}/>
                  </td>
                  <td className="t-mono" style={{ color: "var(--fg)" }} onClick={() => setOpen(p.sku)}>{p.sku}</td>
                  <td onClick={() => setOpen(p.sku)}>
                    <div className="row" style={{ gap: 10 }}>
                      <ProductImageThumb sku={p.sku} size={36} radius={8}/>
                      <div style={{ fontSize: 13, minWidth: 0 }}>{p.name}</div>
                    </div>
                  </td>
                  <td onClick={() => setOpen(p.sku)}><span className="badge badge-neutral">{p.cat}</span></td>
                  <td onClick={() => setOpen(p.sku)}>
                    {productIsStored(p, storedCodes) ? (() => {
                      /* Every place this SKU physically sits, not just the primary
                         shelf — a split product read as if all of it were on one. */
                      const spots = (typeof productPositions === "function") ? productPositions(p) : [];
                      const home = productHomeLoc(p, storedCodes);
                      const extra = spots.filter(s => s.loc !== home);
                      const lp = locParts(home);
                      const primaryQty = spots.length > 1 ? qtyAtLocation(p.sku, home) : null;
                      return (
                        <div style={{ lineHeight: 1.3 }}>
                          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{lp.pos}</span>
                          {primaryQty !== null && <span className="tnum" style={{ fontSize: 11, color: "var(--muted)" }}> ×{primaryQty}</span>}
                          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{lp.building}{lp.floor ? " · " + lp.floor : ""}</div>
                          {extra.map(s => {
                            const ep = locParts(s.loc);
                            return (
                              <div key={s.loc} style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>
                                {/* A row filed under "-" / a deleted shelf isn't a place to walk to. */}
                                {locIsStored(s.loc, storedCodes)
                                  ? <span className="mono" style={{ fontWeight: 600, color: "var(--fg-2)" }}>{ep.pos}</span>
                                  : <span style={{ fontWeight: 600, color: "var(--warning)" }}>ยังไม่ระบุตำแหน่ง</span>}
                                <span className="tnum"> ×{s.qty}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })() : (
                      <span
                        className="badge badge-warning"
                        title={"ยังไม่ได้จัดเก็บเข้าตำแหน่ง — คลิกเพื่อเลือกตำแหน่ง" + (p.loc ? ` (ค่าเดิม: ${p.loc})` : "")}
                        style={{ fontSize: 10, whiteSpace: "nowrap", cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); setAssignSkus([p.sku]); }}>
                        <Icons.Warn size={10}/> ยังไม่จัดเก็บ
                      </span>
                    )}
                  </td>
                  <td className="t-num tnum" style={{ fontWeight: 500 }} onClick={() => setOpen(p.sku)}>{p.qty}</td>
                  <td className="t-num tnum" style={{ color: "var(--muted)" }} onClick={() => setOpen(p.sku)}>{p.reserved}</td>
                  <td className="t-num tnum" onClick={() => setOpen(p.sku)}>{avail}</td>
                  <td onClick={() => setOpen(p.sku)}><span className={"badge " + s.cls}><span className="dot"/>{s.label}</span></td>
                  <td onClick={() => setOpen(p.sku)}><Icons.Chev size={14}/></td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan="10" style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                <Icons.Search size={20} style={{ opacity: 0.4, marginBottom: 8 }}/>
                <div>ไม่พบสินค้าที่ตรงกับตัวกรอง</div>
                <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setQ(""); setCat("ทั้งหมด"); setStatusFilter("all"); setLocFilter(false); }}>ล้างตัวกรอง</button>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Derive the live product every render so the drawer never shows stale data.
          If the product was deleted while open, openProduct becomes null → drawer closes. */}
      {(() => { const op = open ? liveProducts.find(p => p.sku === open) : null; return op ? <ProductDrawer product={op} onClose={() => setOpen(null)} pushToast={pushToast}/> : null; })()}
      {bulkOpen && <BulkEditModal count={selectedCount} products={products} categories={cats.filter(c => c !== "ทั้งหมด")} onClose={() => setBulkOpen(false)} onApply={applyBulkEdit}/>}
      {assignSkus && <AssignLocationModal skus={assignSkus} products={liveProducts} storedCodes={storedCodes} onClose={() => setAssignSkus(null)} onApply={applyAssign}/>}
      {addOpen && <AddSkuModal products={products} categories={cats.filter(c => c !== "ทั้งหมด")} onClose={() => setAddOpen(false)} onAdd={addProduct}/>}
      {adjOpen && <StockAdjustModal product={null} onClose={() => setAdjOpen(false)} pushToast={pushToast}/>}
      {/* Same modal the จัดส่งสินค้า page opens, prefilled with the ticked rows —
          one multi-item stock-out, one order. */}
      {issueSkus && (
        <IssueModal
          presetSkus={issueSkus}
          pushToast={pushToast}
          onClose={() => setIssueSkus(null)}
          onSubmit={async (data) => {
            await commitIssueOrder(data, pushToast);
            setIssueSkus(null);
            clearSelection();
          }}
        />
      )}
    </div>
  );
}

function BulkBtn({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 10px",
        background: danger ? "oklch(0.42 0.16 25)" : "oklch(0.3 0.01 250)",
        color: "oklch(0.99 0.003 250)",
        border: "none",
        borderRadius: 8,
        fontSize: 12, fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit"
      }}
    >
      {icon} {label}
    </button>
  );
}

function BulkEditModal({ count, products, categories, onClose, onApply }) {
  const [enabled, setEnabled] = useState({ cat: false, loc: false, supplier: false, reorder: false });
  const [vals, setVals] = useState({ cat: categories[0] || "", loc: "", supplier: "", reorder: 2 });
  const suppliers = useMemo(() => [...new Set(products.map(p => p.supplier))], [products]);

  const hasChanges = Object.values(enabled).some(Boolean);
  const apply = () => {
    const changes = {};
    if (enabled.cat) changes.cat = vals.cat;
    if (enabled.loc) changes.loc = vals.loc;
    if (enabled.supplier) changes.supplier = vals.supplier;
    if (enabled.reorder) changes.reorder = parseInt(vals.reorder) || 0;
    onApply(changes);
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h3>แก้ไข {count} รายการพร้อมกัน</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>เปิดสวิตช์เฉพาะฟิลด์ที่ต้องการเปลี่ยน ค่าจะถูกใช้กับทุก SKU ที่เลือก</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body">
          <BulkField
            label="หมวดหมู่"
            on={enabled.cat}
            onToggle={() => setEnabled(e => ({ ...e, cat: !e.cat }))}
            hint="เปลี่ยนหมวดหมู่ของทุก SKU ที่เลือก"
          >
            <select className="input" value={vals.cat} onChange={e => setVals(v => ({ ...v, cat: e.target.value }))}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </BulkField>

          <BulkField
            label="ตำแหน่งจัดเก็บ"
            on={enabled.loc}
            onToggle={() => setEnabled(e => ({ ...e, loc: !e.loc }))}
            hint="เลือกตำแหน่ง (จะใช้ค่าเดียวกันทุก SKU)"
          >
            <input className="input" value={vals.loc} onChange={e => setVals(v => ({ ...v, loc: e.target.value }))} list="loc-positions-bulk" placeholder="เลือกตำแหน่ง"/>
            <datalist id="loc-positions-bulk">
              {(typeof allLocationCodes === "function" ? allLocationCodes() : []).map(c => <option key={c} value={c}/>)}
            </datalist>
          </BulkField>

          <BulkField
            label="ผู้จัดส่ง"
            on={enabled.supplier}
            onToggle={() => setEnabled(e => ({ ...e, supplier: !e.supplier }))}
            hint="กำหนด supplier ใหม่ให้ทุก SKU"
          >
            <select className="input" value={vals.supplier || suppliers[0]} onChange={e => setVals(v => ({ ...v, supplier: e.target.value }))}>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </BulkField>

          <BulkField
            label="จุดสั่งซื้อใหม่"
            on={enabled.reorder}
            onToggle={() => setEnabled(e => ({ ...e, reorder: !e.reorder }))}
            hint="ระบบจะเตือนเมื่อสต็อกต่ำกว่าค่านี้"
          >
            <input className="input" type="number" value={vals.reorder} onChange={e => setVals(v => ({ ...v, reorder: e.target.value }))} style={{ textAlign: "right" }}/>
          </BulkField>

          <div style={{ marginTop: 16, padding: 12, background: "var(--surface-2)", borderRadius: 10, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
            <Icons.Help size={14}/>
            <span>การเปลี่ยนแปลงนี้จะถูกบันทึกใน <strong className="tnum" style={{ color: "var(--fg)" }}>{count}</strong> รายการที่เลือกไว้ในตาราง</span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!hasChanges} onClick={apply} style={!hasChanges ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> บันทึก {count} รายการ
          </button>
        </div>
      </div>
    </>
  );
}

/* จัดเก็บเข้าตำแหน่ง — assign the given skus to ONE real position from the live
   tree. Opened from the Inventory bulk bar or a row's "ยังไม่จัดเก็บ" badge. */
function AssignLocationModal({ skus, products, storedCodes, onClose, onApply, onAddBuilding }) {
  const [code, setCode] = useState("");
  // Read the tree on every render (it is tiny) — a memo keyed on [] would keep
  // showing "no positions" after one is added while this modal is open.
  const groups = (() => {
    const by = new Map();
    allPositions().forEach(x => {
      const g = `${x.building} · ${x.floor}`;
      if (!by.has(g)) by.set(g, []);
      by.get(g).push(x);
    });
    return [...by.entries()];
  })();
  const items = skus.map(s => products.find(p => p.sku === s)).filter(Boolean);
  const hasPositions = groups.length > 0;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal">
        <div className="modal-head">
          <div>
            <h3>จัดเก็บเข้าตำแหน่ง ({items.length} รายการ)</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>สินค้าที่เลือกทั้งหมดจะถูกบันทึกไว้ที่ตำแหน่งนี้</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body">
          {hasPositions ? (
            <div>
              <label>ตำแหน่งจัดเก็บ</label>
              <select className="input" value={code} onChange={e => setCode(e.target.value)} autoFocus>
                <option value="">— เลือกตำแหน่ง —</option>
                {groups.map(([g, list]) => (
                  <optgroup key={g} label={g}>
                    {list.map(x => <option key={x.code} value={x.code}>{x.pos}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          ) : (
            <div className="row" style={{ gap: 10, padding: "12px 14px", background: "var(--warning-soft)", borderRadius: 10, fontSize: 13, color: "oklch(0.5 0.13 65)" }}>
              <Icons.Warn size={15} style={{ flexShrink: 0 }}/>
              {/* onAddBuilding is passed when this modal is opened FROM the
                  locations page — telling that user to "go to ตำแหน่งจัดเก็บ"
                  would point at the page they are already on. */}
              {onAddBuilding ? (
                <>
                  <span style={{ flex: 1 }}>ยังไม่มีตำแหน่งในระบบ — เพิ่มอาคาร / ชั้น / ตำแหน่งก่อน แล้วค่อยจัดเก็บสินค้า</span>
                  <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => { onClose(); onAddBuilding(); }}>
                    <Icons.Plus size={12}/> เพิ่มอาคาร
                  </button>
                </>
              ) : (
                <span>ยังไม่มีตำแหน่งในระบบ — ไปที่หน้า “ตำแหน่งจัดเก็บ” เพื่อเพิ่มอาคาร / ชั้น / ตำแหน่งก่อน</span>
              )}
            </div>
          )}

          <div className="stack" style={{ gap: 6, marginTop: 14, maxHeight: 240, overflowY: "auto" }}>
            {items.slice(0, 30).map(p => {
              const stored = productIsStored(p, storedCodes);
              const lp = stored ? locParts(p.loc) : null;
              return (
                <div key={p.sku} className="row" style={{ gap: 10, padding: "6px 8px", background: "var(--surface-2)", borderRadius: 8 }}>
                  {typeof ProductImageThumb === "function" && <ProductImageThumb sku={p.sku} size={30} radius={6}/>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</div>
                  </div>
                  {stored
                    ? <span className="mono" style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{lp.pos} · {lp.building}</span>
                    : <span className="badge badge-warning" style={{ fontSize: 9, flexShrink: 0 }}><Icons.Warn size={9}/> ยังไม่จัดเก็บ</span>}
                </div>
              );
            })}
            {items.length > 30 && <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", padding: "4px 0" }}>+ อีก {items.length - 30} รายการ</div>}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!code} onClick={() => onApply(code)} style={!code ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> จัดเก็บ {items.length} รายการ
          </button>
        </div>
      </div>
    </>
  );
}

function BulkField({ label, hint, on, onToggle, children }) {
  return (
    <div style={{
      padding: 14,
      background: on ? "var(--surface)" : "var(--surface-2)",
      border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
      borderRadius: 12,
      marginBottom: 10,
      transition: "background 0.15s, border-color 0.15s"
    }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        <span className={"check" + (on ? " on" : "")} onClick={onToggle} style={{ marginTop: 2 }}/>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div style={{ fontWeight: 500, fontSize: 13, color: on ? "var(--fg)" : "var(--fg-2)", cursor: "pointer" }} onClick={onToggle}>{label}</div>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginBottom: on ? 10 : 0 }}>{hint}</div>
          {on && children}
        </div>
      </div>
    </div>
  );
}

/* Product-name input with a live search dropdown over BOTH live stock and the
   WooCommerce catalog. Picking a result lets the parent auto-fill SKU / price /
   category / brand / image. Shared by desktop AddSkuModal + mobile MAddSku. */
function ProductNameSearchField({ value, onChange, onPick, mobile, placeholder, inputRef }) {
  const [open, setOpen] = useState(false);
  const blurT = useRef(null);
  const results = useMemo(
    () => (typeof searchProductCandidates === "function" ? searchProductCandidates(value, 12) : []),
    [value]
  );
  const show = open && String(value || "").trim().length >= 1 && results.length > 0;
  return (
    <div style={{ position: "relative" }}>
      <input ref={inputRef} className={mobile ? "m-input" : "input"} value={value} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurT.current = setTimeout(() => setOpen(false), 150); }}
        placeholder={placeholder || "พิมพ์ชื่อสินค้าเพื่อค้นหาจากคลังหรือแคตตาล็อก…"}/>
      {show && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 80,
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
          boxShadow: "var(--elev-2, 0 10px 28px rgba(0,0,0,0.22))", maxHeight: 288, overflowY: "auto" }}>
          {results.map((r, i) => (
            <div key={r.sku + ":" + i}
              onMouseDown={e => { e.preventDefault(); clearTimeout(blurT.current); onPick(r); setOpen(false); }}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", cursor: "pointer",
                borderTop: i ? "1px solid var(--border)" : "none" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {r.image
                ? <img src={r.image} alt="" loading="lazy" onError={ev => { ev.target.style.visibility = "hidden"; }}
                    style={{ width: 38, height: 38, borderRadius: 7, objectFit: "cover", background: "#fff", border: "1px solid var(--border)", flexShrink: 0 }}/>
                : <div style={{ width: 38, height: 38, borderRadius: 7, background: "var(--surface-2)", border: "1px solid var(--border)", flexShrink: 0 }}/>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name || "—"}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.sku}{r.brand ? " · " + r.brand : ""}{r.price ? " · ฿" + Number(r.price).toLocaleString() : ""}
                </div>
              </div>
              <span className={"badge " + (r.source === "stock" ? "badge-success" : "badge-neutral")} style={{ flexShrink: 0, fontSize: 10 }}>
                {r.source === "stock" ? "ในคลัง" : "แคตตาล็อก"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddSkuModal({ products, categories, onClose, onAdd }) {
  const suppliers = useMemo(() => [...new Set(products.map(p => p.supplier))].filter(Boolean), [products]);
  const brands    = useMemo(() => [...new Set(products.map(p => p.brand))].filter(Boolean), [products]);
  const [f, setF] = useState({
    sku: "", name: "",
    cat: categories[0] || "",
    brand: "",
    supplier: "",
    cost: "", price: "", qty: "", reorder: "2", loc: ""
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const [pickedImage, setPickedImage] = useState("");
  /* Storage positions. Row 0 is the primary (pick-first) shelf = products.loc;
     extra rows become the product_locations split, which must sum to the opening
     quantity — the same invariant saveLocSplit enforces. */
  const [locRows, setLocRows] = useState([{ loc: "", qty: "" }]);
  const filledLocRows = locRows.filter(r => (r.loc || "").trim());
  const multiLoc = filledLocRows.length > 1;
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
  const dupe = skuTrim && products.some(p => p.sku.toUpperCase() === skuTrim);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  /* Roles without viewCost never see the ต้นทุน field, so it can't be required:
     the cost falls back to the same 60%-of-price estimate the CSV importer uses,
     and an admin can correct it later. */
  const showCost = canDo("viewCost");
  const price = num(f.price), qty = num(f.qty), reorder = num(f.reorder);
  const cost = showCost ? num(f.cost) : (price === null ? null : Math.round(price * 0.6));
  // A split that doesn't add up to the opening stock would contradict p.qty.
  const splitOk = !multiLoc || (qty !== null && splitSum === Math.round(qty));
  const canSave = skuTrim && !dupe && f.name.trim() &&
    cost !== null && price !== null && qty !== null && reorder !== null && splitOk;

  const margin = (showCost && cost !== null && price !== null && price > 0)
    ? Math.round((1 - cost / price) * 100) : null;

  const save = () => {
    if (!canSave) return;
    // Carry over the picked stock/catalog image so the new product shows it.
    if (pickedImage && typeof setProductImage === "function") {
      try { setProductImage(skuTrim, pickedImage); } catch (e) {}
    }
    // Row 0 is the primary shelf; the whole set becomes the split when there are 2+.
    const rows = filledLocRows.map(r => ({
      loc: r.loc.trim(),
      qty: multiLoc ? (parseInt(r.qty, 10) || 0) : Math.round(qty)
    }));
    onAdd({
      sku: skuTrim, name: f.name.trim(), cat: f.cat,
      brand: (f.brand || "").trim(),
      supplier: f.supplier, cost, price,
      qty: Math.round(qty), reorder: Math.round(reorder),
      loc: rows.length ? rows[0].loc : "",
      _locRows: rows.length > 1 ? rows : null
    });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ maxWidth: 540, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>เพิ่ม SKU ใหม่</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>กรอกข้อมูลสินค้าเพื่อเพิ่มเข้าคลัง</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label>รหัส SKU <span style={{ color: "var(--danger)" }}>*</span></label>
            <input
              className="input mono"
              value={f.sku}
              onChange={e => { const v = e.target.value; setF(prev => ({ ...prev, sku: v, brand: prev.brand || (typeof guessBrandFromSku === "function" ? guessBrandFromSku(v) : "") })); }}
              placeholder="เช่น TH-APP-003"
              style={{ fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}
            />
            {dupe && <span className="hint" style={{ color: "var(--danger)" }}>SKU นี้มีอยู่แล้วในคลัง</span>}
          </div>

          <div className="field">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <label>ชื่อสินค้า <span style={{ color: "var(--danger)" }}>*</span></label>
              <OcrNameButton onResult={r => set("name", r.name)}/>
            </div>
            <ProductNameSearchField value={f.name} onChange={v => set("name", v)} onPick={pickCandidate}
              placeholder="พิมพ์ชื่อเพื่อค้นหาจากคลังหรือแคตตาล็อก WooCommerce…"/>
            <span className="hint" style={{ color: "var(--muted)" }}>พิมพ์ชื่อแล้วเลือกจากคลังหรือแคตตาล็อก เพื่อเติม SKU/ราคา/รูปอัตโนมัติ</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>หมวดหมู่</label>
              <select className="input" value={f.cat} onChange={e => set("cat", e.target.value)}>
                {f.cat && !categories.includes(f.cat) && <option value={f.cat}>{f.cat}</option>}
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>ผู้จัดส่ง</label>
              <input className="input" value={f.supplier} onChange={e => set("supplier", e.target.value)}
                placeholder="เว้นว่างได้ หรือเลือกจากที่เคยใช้" list="addsku-suppliers"/>
              <datalist id="addsku-suppliers">{suppliers.map(s => <option key={s} value={s}/>)}</datalist>
            </div>
          </div>

          <div className="field">
            <label>แบรนด์</label>
            <input className="input" value={f.brand} onChange={e => set("brand", e.target.value)}
              placeholder="เช่น 5.11, PS TACTICAL" list="addsku-brands"/>
            <datalist id="addsku-brands">{brands.map(b => <option key={b} value={b}/>)}</datalist>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: showCost ? "1fr 1fr" : "1fr", gap: 12 }}>
            {showCost && (
              <div className="field">
                <label>ต้นทุน (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
                <input className="input" type="number" min="0" value={f.cost} onChange={e => set("cost", e.target.value)} placeholder="0" style={{ textAlign: "right" }}/>
              </div>
            )}
            <div className="field">
              <label>ราคาขาย (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" type="number" min="0" value={f.price} onChange={e => set("price", e.target.value)} placeholder="0" style={{ textAlign: "right" }}/>
            </div>
          </div>
          {margin !== null && (
            <div style={{ fontSize: 11, color: margin >= 0 ? "var(--success)" : "var(--danger)", marginTop: -6 }}>
              มาร์จิ้น {margin}% จากราคาขาย
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>จำนวนเริ่มต้น <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" type="number" min="0" value={f.qty} onChange={e => set("qty", e.target.value)} placeholder="0" style={{ textAlign: "right" }}/>
            </div>
            <div className="field">
              <label>จุดสั่งซื้อใหม่</label>
              <input className="input" type="number" min="0" value={f.reorder} onChange={e => set("reorder", e.target.value)}
                list="reorder-presets" placeholder="พิมพ์เอง หรือเลือก" style={{ textAlign: "right" }}/>
              <datalist id="reorder-presets">
                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(n => <option key={n} value={n}/>)}
              </datalist>
            </div>
          </div>

          {/* ── Storage positions — one row per place the stock physically sits.
                One row behaves exactly like the old single field (no qty to type);
                add a second and the pieces must be split across them. ── */}
          <div className="field">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ marginBottom: 0 }}>ตำแหน่งจัดเก็บ</label>
              <button type="button" className="btn btn-sm" onClick={() => setLocRows(rs => [...rs, { loc: "", qty: "" }])}>
                <Icons.Plus size={12}/> เพิ่มตำแหน่ง
              </button>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 6 }}>
              {locRows.map((r, i) => (
                <div key={i} className="row" style={{ gap: 8 }}>
                  <LocationSelect style={{ flex: 1 }} value={r.loc}
                    noneLabel={i === 0 ? "— เลือกตำแหน่ง (ไม่บังคับ) —" : "— เลือกตำแหน่งเพิ่ม —"}
                    onChange={v => setLocRows(rs => rs.map((x, j) => j === i ? { ...x, loc: v } : x))}/>
                  {multiLoc && (
                    <input className="input tnum" type="number" min="0" style={{ width: 90, textAlign: "right" }}
                      value={r.qty} placeholder="0"
                      onChange={e => { const v = e.target.value; setLocRows(rs => rs.map((x, j) => j === i ? { ...x, qty: v } : x)); }}/>
                  )}
                  {i === 0
                    ? <span className="badge badge-neutral" style={{ fontSize: 10, flexShrink: 0 }}>หยิบก่อน</span>
                    : <button type="button" className="btn btn-ghost btn-icon" title="เอาตำแหน่งนี้ออก" style={{ flexShrink: 0 }}
                        onClick={() => setLocRows(rs => rs.filter((_, j) => j !== i))}><Icons.X size={13}/></button>}
                </div>
              ))}
            </div>
            {multiLoc && (
              <span className="hint" style={{ color: splitOk ? "var(--muted)" : "var(--danger)" }}>
                {splitOk
                  ? `แบ่งครบ ${splitSum} ชิ้นตามจำนวนเริ่มต้น`
                  : `รวมทุกตำแหน่ง ${splitSum} ชิ้น — ต้องเท่ากับจำนวนเริ่มต้น ${qty === null ? 0 : Math.round(qty)} ชิ้น`}
              </span>
            )}
          </div>

          {(() => {
            const locTrim = (locRows[0] && locRows[0].loc || "").trim();
            return (
              <div className="field">
                <label>ภาพตำแหน่ง{locTrim ? <span style={{ fontWeight: 400, color: "var(--muted)" }}> · {locTrim}</span> : null}</label>
                {locTrim && typeof LocationImageUpload === "function"
                  ? <LocationImageUpload code={locTrim} compact/>
                  : <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 12px", background: "var(--surface-2)", border: "1px dashed var(--border)", borderRadius: 10 }}>
                      เลือกหรือพิมพ์ตำแหน่งด้านบนก่อน เพื่อเพิ่มรูปของตำแหน่งนั้น
                    </div>}
              </div>
            );
          })()}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!canSave} onClick={save} style={!canSave ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Plus size={14}/> เพิ่ม SKU
          </button>
        </div>
      </div>
    </>
  );
}

/* ตำแหน่งจัดเก็บแยกจำนวน — one SKU, several shelves.
   product.loc names only the PRIMARY position, so stock kept in a second place
   (zone A downstairs + a backup box upstairs) had nowhere to be recorded and
   was silently reported as all-downstairs. The real distribution lives in
   product_locations; this panel shows it and lets an editor record it.

   Stays quiet for the ordinary single-position product — an inventory where
   every drawer sprouts a location table teaches staff to ignore it. It appears
   only when a split actually exists, or behind one small button for editors. */
function LocationSplitPanel({ product, pushToast }) {
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = pushToast || (() => {});

  useEffect(() => {
    const h = () => setTick(n => n + 1);
    window.addEventListener("ims-product-locs-change", h);
    return () => window.removeEventListener("ims-product-locs-change", h);
  }, []);
  // Never carry an open editor across to a different product.
  useEffect(() => { setEditing(false); }, [product.sku]);

  const split = typeof productPositions === "function" ? productPositions(product) : [];
  const isSplit = split.length > 1;
  const canEdit = typeof canDo === "function" ? canDo("editProduct") : false;
  const codes = typeof allLocationCodes === "function" ? allLocationCodes() : [];
  const qty = Number(product.qty) || 0;

  const startEdit = () => {
    setRows(split.length ? split.map(r => ({ loc: r.loc, qty: r.qty }))
                         : [{ loc: product.loc || "", qty }]);
    setEditing(true);
  };
  const sum = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
  const balanced = sum === qty;
  const setRow = (i, patch) => setRows(rs => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (typeof saveLocSplit !== "function") { toast("ยังไม่พร้อมใช้งาน"); return; }
    setBusy(true);
    const res = await saveLocSplit(product.sku, rows);
    setBusy(false);
    if (!res || !res.ok) { toast((res && res.error) || "บันทึกไม่สำเร็จ"); return; }
    toast("บันทึกตำแหน่งแยกจำนวนแล้ว");
    setEditing(false);
  };

  if (!isSplit && !editing) {
    if (!canEdit) return null;
    return (
      <button className="btn btn-sm btn-ghost" style={{ marginTop: 10 }} onClick={startEdit}>
        <Icons.Plus size={13}/> แยกจำนวนตามตำแหน่ง
      </button>
    );
  }

  return (
    <div style={{ marginTop: 14, padding: 14, background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div className="eyebrow">เก็บไว้ {split.length} ตำแหน่ง</div>
        {!editing && canEdit && (
          <button className="btn btn-sm btn-ghost" onClick={startEdit}><Icons.Edit size={13}/> แก้ไข</button>
        )}
      </div>

      {!editing && split.map((r, i) => {
        // A row filed under "-" / a deleted shelf is not a place — say so, and
        // never tag it หยิบก่อน (pick-first = defaultPickLoc, the first REAL shelf).
        const real = codes.indexOf(r.loc) >= 0;
        const lp = real && typeof locParts === "function" ? locParts(r.loc) : null;
        const primary = r.loc === (typeof defaultPickLoc === "function" ? defaultPickLoc(product) : product.loc);
        return (
          <div key={r.loc + i} className="row" style={{ justifyContent: "space-between", padding: "7px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ minWidth: 0 }}>
              {real
                ? <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{lp ? lp.pos : r.loc}</div>
                : <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--warning)" }}>ยังไม่ระบุตำแหน่ง</div>}
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                {lp ? lp.building + (lp.floor ? " · " + lp.floor : "") : ""}
                {primary && <span style={{ marginLeft: 6, color: "var(--accent)" }}>· หยิบก่อน</span>}
              </div>
            </div>
            <div className="tnum" style={{ fontSize: 15, fontWeight: 600 }}>{r.qty}</div>
          </div>
        );
      })}

      {editing && (
        <>
          {rows.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8, marginBottom: 8 }}>
              <input className="input" style={{ flex: 1, fontSize: 12 }} value={r.loc} list="loc-positions-split"
                     placeholder="เลือกตำแหน่ง" onChange={e => setRow(i, { loc: e.target.value })}/>
              <input className="input tnum" type="number" min="0" style={{ width: 86, textAlign: "right" }}
                     value={r.qty} onChange={e => setRow(i, { qty: e.target.value })}/>
              <button className="btn btn-sm btn-ghost btn-icon" title="ลบตำแหน่งนี้"
                      onClick={() => setRows(rs => rs.filter((_, n) => n !== i))}><Icons.X size={13}/></button>
            </div>
          ))}
          <datalist id="loc-positions-split">{codes.map(c => <option key={c} value={c}/>)}</datalist>
          <button className="btn btn-sm btn-ghost" onClick={() => setRows(rs => rs.concat([{ loc: "", qty: 0 }]))}>
            <Icons.Plus size={13}/> เพิ่มตำแหน่ง
          </button>
          {/* The invariant, shown live: you cannot place more pieces than you own.
              saveLocSplit() re-checks server-side of this component, so a stale
              qty from another device still can't write a contradictory split. */}
          <div className="row" style={{ justifyContent: "space-between", marginTop: 12, fontSize: 12,
                                        color: balanced ? "var(--muted)" : "var(--danger)" }}>
            <span>รวมทุกตำแหน่ง</span>
            <span className="tnum" style={{ fontWeight: 600 }}>{sum} / {qty} ชิ้น</span>
          </div>
          {!balanced && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
              ต้องเท่ากับสต็อกทั้งหมด ({qty} ชิ้น) จึงจะบันทึกได้
            </div>
          )}
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn btn-sm btn-primary" disabled={!balanced || busy} onClick={save}>
              {busy ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditing(false)}>ยกเลิก</button>
          </div>
        </>
      )}
    </div>
  );
}

function ProductDrawer({ product, onClose, pushToast }) {
  const [editOpen, setEditOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const s = stockStatus(product);
  const avail = product.qty - product.reserved;

  // Print a scannable Code 128 barcode label (50×30mm) for this SKU.
  const printBarcode = () => {
    const svg = (typeof barcodeSvgMarkup === "function") ? barcodeSvgMarkup(product.sku, { height: 80, moduleWidth: 2 }) : "";
    const safe = (str) => String(str == null ? "" : str).replace(/[<>&]/g, "");
    const w = window.open("", "_blank", "width=480,height=320");
    if (!w) { (pushToast || (() => {}))("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาตป๊อปอัปแล้วลองใหม่"); return; }
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>บาร์โค้ด ${safe(product.sku)}</title>
      <style>
        @page { size: 50mm 30mm; margin: 0; }
        html,body { margin:0; padding:0; }
        body { font-family:'IBM Plex Mono',monospace; text-align:center; padding:2.5mm 2mm; }
        .name { font-size:10px; line-height:1.2; max-height:2.4em; overflow:hidden; margin-bottom:1mm; }
        .bc svg { width:auto; max-width:46mm; height:13mm; display:block; margin:0 auto; }
        .sku { font-size:13px; font-weight:600; letter-spacing:1px; margin-top:1mm; }
      </style></head>
      <body onload="window.focus();window.print();">
        <div class="name">${safe(product.name)}</div>
        <div class="bc">${svg}</div>
        <div class="sku">${safe(product.sku)}</div>
      </body></html>`);
    w.document.close();
  };
  // Real adjustment history from stock_adjustments (replaces the old hardcoded
  // demo rows). null = loading; [] = loaded, none yet. Re-fetched per sku.
  const [moves, setMoves] = useState(null);
  const [movesTick, setMovesTick] = useState(0);
  // Re-fetch whenever stock moves while the drawer is open, so an adjustment
  // made right here shows up in the list instead of looking like it wasn't saved.
  useEffect(() => {
    // Short delay: the qty write lands first and the ledger row is inserted
    // right behind it, so an immediate re-read would miss the new row.
    let t = null;
    const bump = () => { if (t) clearTimeout(t); t = setTimeout(() => setMovesTick(v => v + 1), 900); };
    window.addEventListener("ims-products-change", bump);
    // Fired once a history row has actually been written (this device), and on
    // a realtime stock event from another one — no more racing the insert.
    const now = () => setMovesTick(v => v + 1);
    window.addEventListener("ims-ledger-change", now);
    return () => { if (t) clearTimeout(t); window.removeEventListener("ims-products-change", bump); window.removeEventListener("ims-ledger-change", now); };
  }, []);
  useEffect(() => {
    let dead = false;
    if (typeof dbLoadStockAdjustments === "function") {
      dbLoadStockAdjustments(product.sku, 12)
        .then(rows => { if (!dead) setMoves(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (!dead) setMoves([]); });
    } else setMoves([]);
    return () => { dead = true; };
  }, [product.sku, movesTick]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">รายละเอียดสินค้า</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{product.name}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="drawer-body">
          <ProductImageUpload sku={product.sku} productName={product.name} pushToast={pushToast || (() => {})}/>

          <div className="grid-2" style={{ gap: 12, marginTop: 18 }}>
            <Stat label="SKU" value={
              <span className="row" style={{ gap: 6, alignItems: "center" }}>
                <span className="mono">{product.sku}</span>
                {canDo("renameSku") && (
                  <button className="btn btn-ghost btn-icon" style={{ width: 22, height: 22 }} title="แก้ไขรหัส SKU" onClick={() => setRenameOpen(true)}>
                    <Icons.Tag size={12}/>
                  </button>
                )}
              </span>
            }/>
            <Stat label="หมวดหมู่" value={product.cat}/>
            <Stat label="ตำแหน่ง" value={productIsStored(product)
              ? <span>
                  <span className="mono">{productHomeLoc(product)}</span>
                  {/* A split product's loc is only where you pick FIRST — say so,
                      or the drawer reads as "all 83 are in A" like it used to. */}
                  {typeof hasLocSplit === "function" && hasLocSplit(product.sku) && (
                    <span className="badge badge-neutral" style={{ fontSize: 9.5, marginLeft: 6 }}>
                      +{productPositions(product).length - 1} ที่
                    </span>
                  )}
                </span>
              : <span className="badge badge-warning" style={{ fontSize: 10 }} title={product.loc ? `ค่าเดิม: ${product.loc}` : undefined}><Icons.Warn size={10}/> ยังไม่จัดเก็บ</span>}/>
            <Stat label="แบรนด์" value={product.brand || "—"}/>
            <Stat label="ผู้จัดส่ง" value={product.supplier}/>
            {canDo("viewCost") && <Stat label="ราคาทุน" value={`฿${(product.cost ?? Math.round(product.price * 0.6)).toLocaleString()}`}/>}
            <Stat label="ราคาขาย" value={`฿${product.price.toLocaleString()}`}/>
            {canDo("viewCost") && <Stat label="กำไรต่อชิ้น" value={`฿${(product.price - (product.cost ?? Math.round(product.price * 0.6))).toLocaleString()} · ${Math.round((1 - (product.cost ?? product.price * 0.6) / product.price) * 100)}%`}/>}
            <Stat label="จุดสั่งซื้อใหม่" value={product.reorder + " ชิ้น"}/>
          </div>

          <LocationSplitPanel product={product} pushToast={pushToast}/>

          <div style={{ marginTop: 18, padding: 16, background: "var(--surface-2)", borderRadius: 12, border: "1px solid var(--border)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="eyebrow">สต็อกปัจจุบัน</div>
              <span className={"badge " + s.cls}><span className="dot"/>{s.label}</span>
            </div>
            <div className="grid-3" style={{ marginTop: 10 }}>
              <div><div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">{product.qty}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>คงเหลือ</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--muted)" }} className="tnum">{product.reserved}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>จองไว้</div></div>
              <div><div style={{ fontSize: 22, fontWeight: 600, color: "var(--success)" }} className="tnum">{avail}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>พร้อมขาย</div></div>
            </div>
            <div className="prog" style={{ marginTop: 12 }}>
              <span style={{ width: Math.min(100, product.qty/(product.reorder*3)*100) + "%", background: s.key === "out" ? "var(--danger)" : s.key === "low" ? "var(--warning)" : "var(--success)" }}/>
            </div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
              <span>จุดสั่งซื้อ {product.reorder}</span>
              <span>เป้าหมาย {product.reorder * 3}</span>
            </div>
          </div>

          {canDo("viewSales") && <div style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>ยอดขายตามช่องทาง</div>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>30 วันที่ผ่านมา</span>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              {(() => {
                const breakdown = (typeof channelSalesFor === "function") ? channelSalesFor(product.sku) : [];
                const totalSold = breakdown.reduce((s, c) => s + c.sold, 0);
                if (!totalSold) return <div style={{ padding: "6px 0", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ยังไม่มียอดขายในช่วงนี้</div>;
                return (
                  <>
                    <div className="stack" style={{ gap: 8 }}>
                      {breakdown.filter(c => c.sold > 0).map(c => {
                        const pct = totalSold ? (c.sold / totalSold * 100) : 0;
                        return (
                          <div key={c.id}>
                            <div className="row" style={{ justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                              <span className="row" style={{ gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/>
                                {c.name}
                              </span>
                              <span className="tnum" style={{ color: "var(--fg-2)" }}>
                                <strong style={{ color: "var(--fg)" }}>{c.sold}</strong> ชิ้น
                              </span>
                            </div>
                            <div className="prog" style={{ height: 4 }}>
                              <span style={{ width: pct + "%", background: c.color }}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="divider"/>
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--muted)" }}>รวมขายทุกช่องทาง</span>
                      <span><strong className="tnum">{totalSold}</strong> ชิ้น</span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>}

          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>บาร์โค้ดสินค้า</div>
              <button className="btn btn-sm" onClick={printBarcode}><Icons.Print size={13}/> พิมพ์บาร์โค้ด</button>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", textAlign: "center" }}>
              <Barcode value={product.sku} height={50}/>
              <div className="mono" style={{ fontSize: 12, marginTop: 4, letterSpacing: "0.06em" }}>{product.sku}</div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            {/* Every movement kind now lands here — รับเข้า / ตัดสต็อก / ตรวจนับ /
                ปรับสต็อก — so this panel is the product's real stock history. */}
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>ประวัติการเคลื่อนไหวสต็อกล่าสุด</div>
            <div className="stack" style={{ gap: 8 }}>
              {moves === null && (
                <div style={{ fontSize: 12, color: "var(--muted)", padding: 10 }}>กำลังโหลด…</div>
              )}
              {moves && moves.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", padding: 10, background: "var(--surface-2)", borderRadius: 8 }}>ยังไม่มีการเคลื่อนไหวสต็อก</div>
              )}
              {(moves || []).map(m => (
                <div key={m.id} className="row" style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, gap: 12 }}>
                  <ActivityDot type={m.delta > 0 ? "in" : "out"}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.reason || "ปรับสต็อก"}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {new Date(m.created_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {m.created_by || "ระบบ"}
                    </div>
                  </div>
                  <div className="tnum" style={{ fontSize: 14, fontWeight: 500, color: m.delta > 0 ? "var(--success)" : "var(--danger)" }}>
                    {m.delta > 0 ? "+" : ""}{m.delta}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          {canAdjustStock() && <button className="btn" onClick={() => setAdjOpen(true)}><Icons.Refresh size={14}/> ปรับสต็อก</button>}
          {canDo("editProduct") && <button className="btn btn-primary" onClick={() => setEditOpen(true)}><Icons.Edit size={14}/> แก้ไขข้อมูล</button>}
        </div>
      </div>
      {editOpen && (
        <ProductEditModal
          product={PRODUCTS.find(p => p.sku === product.sku) || product}
          onClose={() => setEditOpen(false)}
          onSave={(changes) => {
            updateProductInStore(product.sku, changes);
            pushToast(`บันทึกการแก้ไข ${product.sku} แล้ว`);
            if (typeof recordChange === "function") {
              recordChange({
                entity: "product", entityId: product.sku, action: "update",
                summary: `แก้ไขข้อมูลสินค้า ${changes.name || product.name} (${product.sku})`,
                changes: Object.entries(changes).map(([k, v]) => ({ label: k, to: String(v) }))
              });
            }
            setEditOpen(false);
            onClose();
          }}
        />
      )}
      {adjOpen && (
        <StockAdjustModal
          product={PRODUCTS.find(p => p.sku === product.sku) || product}
          onClose={() => setAdjOpen(false)}
          pushToast={pushToast}
          onApply={() => { setAdjOpen(false); onClose(); }}
        />
      )}
      {renameOpen && typeof RenameSkuModal === "function" && (
        <RenameSkuModal
          sku={product.sku}
          pushToast={pushToast}
          onClose={() => setRenameOpen(false)}
          onRenamed={(newSku) => {
            if (typeof recordChange === "function") {
              recordChange({
                entity: "product", entityId: newSku, action: "update",
                summary: `เปลี่ยนรหัส SKU ${product.sku} → ${newSku}`,
                changes: [{ label: "sku", from: product.sku, to: newSku }]
              });
            }
            setRenameOpen(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

/* Edit an existing product's catalog fields */
function ProductEditModal({ product, onClose, onSave }) {
  const cats = useMemo(() => typeof loadCategories === "function" ? loadCategories() : [...new Set(PRODUCTS.map(p => p.cat))], []);
  const suppliers = useMemo(() => [...new Set(PRODUCTS.map(p => p.supplier))], []);
  const brands = useMemo(() => [...new Set(PRODUCTS.map(p => p.brand))].filter(Boolean), []);
  const [f, setF] = useState({
    name: product.name, cat: product.cat, brand: product.brand || "", supplier: product.supplier,
    cost: String(product.cost ?? ""), price: String(product.price ?? ""),
    reorder: String(product.reorder ?? "50"), loc: product.loc
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  /* Without viewCost the ต้นทุน field is hidden — keep the product's existing
     cost untouched rather than blanking it on save. */
  const showCost = canDo("viewCost");
  const price = num(f.price), reorder = num(f.reorder);
  const cost = showCost ? num(f.cost) : (Number.isFinite(Number(product.cost)) ? Number(product.cost) : (price === null ? null : Math.round(price * 0.6)));
  const canSave = f.name.trim() && cost !== null && price !== null && reorder !== null;
  const margin = (showCost && cost !== null && price !== null && price > 0) ? Math.round((1 - cost / price) * 100) : null;

  const save = () => {
    if (!canSave) return;
    onSave({
      name: f.name.trim(), cat: f.cat, brand: (f.brand || "").trim(), supplier: f.supplier,
      cost, price, reorder: Math.round(reorder), loc: f.loc.trim()
    });
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 300 }}/>
      <div className="modal" style={{ maxWidth: 540, maxHeight: "90vh", overflowY: "auto", zIndex: 301 }}>
        <div className="modal-head">
          <div>
            <h3>แก้ไขข้อมูลสินค้า</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}><span className="mono">{product.sku}</span> · ปรับข้อมูลแล้วบันทึก</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label>ชื่อสินค้า <span style={{ color: "var(--danger)" }}>*</span></label>
            <input className="input" value={f.name} onChange={e => set("name", e.target.value)}/>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>หมวดหมู่</label>
              <select className="input" value={f.cat} onChange={e => set("cat", e.target.value)}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>ผู้จัดส่ง</label>
              <select className="input" value={f.supplier} onChange={e => set("supplier", e.target.value)}>
                {suppliers.map(sp => <option key={sp} value={sp}>{sp}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>แบรนด์</label>
            <input className="input" value={f.brand} onChange={e => set("brand", e.target.value)}
              placeholder="เช่น 5.11, PS TACTICAL" list="editprod-brands"/>
            <datalist id="editprod-brands">{brands.map(b => <option key={b} value={b}/>)}</datalist>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: showCost ? "1fr 1fr" : "1fr", gap: 12 }}>
            {showCost && (
              <div className="field">
                <label>ต้นทุน (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
                <input className="input" type="number" min="0" value={f.cost} onChange={e => set("cost", e.target.value)} style={{ textAlign: "right" }}/>
              </div>
            )}
            <div className="field">
              <label>ราคาขาย (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" type="number" min="0" value={f.price} onChange={e => set("price", e.target.value)} style={{ textAlign: "right" }}/>
            </div>
          </div>
          {margin !== null && (
            <div style={{ fontSize: 11, color: margin >= 0 ? "var(--success)" : "var(--danger)", marginTop: -6 }}>
              มาร์จิ้น {margin}% จากราคาขาย
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>จุดสั่งซื้อใหม่</label>
              <input className="input" type="number" min="0" value={f.reorder} onChange={e => set("reorder", e.target.value)}
                list="reorder-presets" placeholder="พิมพ์เอง หรือเลือก" style={{ textAlign: "right" }}/>
              <datalist id="reorder-presets">
                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(n => <option key={n} value={n}/>)}
              </datalist>
            </div>
            <div className="field">
              <label>ตำแหน่ง</label>
              <LocationSelect value={f.loc} onChange={v => set("loc", v)} noneLabel="— เลือกตำแหน่ง (ไม่บังคับ) —"/>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!canSave} onClick={save} style={!canSave ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> บันทึก
          </button>
        </div>
      </div>
    </>
  );
}

/* ── RenameSkuModal — correct a wrong SKU code on an existing product ──────
   sku is the primary key, so renaming it is not a normal field edit: it goes
   through the rename_product_sku RPC (supabase/rename-sku-cascade.sql), which
   cascades to bundle_items/product_locations/stock_adjustments server-side and
   is restricted to admin/manager (CAPS.renameSku). A useRef latch (not just a
   state flag) blocks a second tap while the await is in flight — the same
   double-submit hazard as every other stock-moving/PK write in this app.
   Shared with the mobile fork — defined here because screens.jsx loads before
   handheld.jsx (same as QtyStepper/CameraScanner). */
function RenameSkuModal({ sku, onClose, onRenamed, pushToast }) {
  const [value, setValue] = useState(sku);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const trimmed = value.trim();
  const changed = trimmed !== sku;
  const dup = changed && PRODUCTS.some(p => p.sku === trimmed);
  const canSave = trimmed && changed && !dup;

  const save = async () => {
    if (!canSave || lock.current) return;
    lock.current = true; setBusy(true);
    const res = await renameProductSku(sku, trimmed);
    lock.current = false; setBusy(false);
    if (res && res.ok) {
      pushToast(`เปลี่ยนรหัสเป็น ${res.sku} แล้ว`);
      onRenamed(res.sku);
    }
    // A failure already toasted inside renameProductSku — stay open to retry/edit.
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 320 }}/>
      <div className="modal" style={{ maxWidth: 420, zIndex: 321 }}>
        <div className="modal-head">
          <div>
            <h3>เปลี่ยนรหัส SKU</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>รหัสเดิม <span className="mono">{sku}</span></div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label>รหัส SKU ใหม่</label>
            <input className="input mono" value={value} onChange={e => setValue(e.target.value)} autoFocus/>
            {dup && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>มีรหัสนี้ในคลังแล้ว</div>}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
            สต็อก ตำแหน่งจัดเก็บ ชุดสินค้า และประวัติการเคลื่อนไหวจะย้ายไปใช้รหัสใหม่ทันที
            ส่วนออร์เดอร์เก่าที่บันทึกรหัสเดิมไว้แล้วจะยังแสดงรหัสเดิม
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!canSave || busy} onClick={save} style={(!canSave || busy) ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> {busy ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── QtyStepper — จำนวนที่กดพลาดไม่ได้ ────────────────────────────────
   A focused <input type="number"> increments on mouse-wheel, so scrolling a
   long ปรับสต็อก list with the cursor over the amount silently changed it
   (reported 2026-09-19 — the count went in wrong and nobody saw why).
   This is type="text" + inputMode="numeric": no native spinner, nothing for
   the wheel to grab, and explicit − / + buttons replace the arrows.
   `value` stays a STRING so the field can be emptied while typing; callers
   already treat it that way (r.amount). Shared with the mobile fork — defined
   here because screens.jsx loads before handheld.jsx (same as CameraScanner). */
function QtyStepper({ value, onChange, onBlur, min = 0, max, small, title }) {
  const raw = String(value == null ? "" : value);
  const parsed = parseInt(raw, 10);
  const base = Number.isFinite(parsed) ? parsed : 0;
  const clamp = (n) => {
    let v = n;
    if (typeof min === "number") v = Math.max(min, v);
    if (typeof max === "number") v = Math.min(max, v);
    return v;
  };
  const bump = (d) => onChange(String(clamp(base + d)));
  const atMin = typeof min === "number" && raw !== "" && base <= min;
  const atMax = typeof max === "number" && base >= max;
  return (
    <div className={"qty-stepper" + (small ? " qty-sm" : "")} title={title}>
      <button type="button" tabIndex={-1} disabled={atMin} onClick={() => bump(-1)} aria-label="ลดจำนวน">−</button>
      <input
        type="text" inputMode="numeric" pattern="[0-9]*" value={raw} placeholder="0"
        onChange={e => onChange(e.target.value.replace(/[^\d]/g, ""))}
        onFocus={e => e.target.select()}
        onBlur={onBlur}
        aria-label={title || "จำนวน"}/>
      <button type="button" tabIndex={-1} disabled={atMax} onClick={() => bump(1)} aria-label="เพิ่มจำนวน">+</button>
    </div>
  );
}

/* Reason-driven stock adjustment (นับผิด / เสียหาย / ขายนอกระบบ) — applies via
   the shared applyStockAdjustmentBatch → applyStockAdjustment choke point
   (data.jsx), which also writes the audit trail + stock_adjustments history.
   MULTI-SKU: pick/scan any number of products (with photos), give each its own
   จำนวน, share one รูปแบบ/เหตุผล/หมายเหตุ, confirm once — so a batch of
   external-platform sales or a damaged-carton write-off is a single pass.
   Opened WITH a product (ProductDrawer) it starts with that item selected and
   calls onApply after; opened WITHOUT one (Inventory header) it starts on the
   picker and resets back to it after each apply. */
function StockAdjustModal({ product, onClose, onApply, pushToast }) {
  const [rows, setRows] = useState(() => (product ? [{ sku: product.sku, amount: "" }] : []));
  const [mode, setMode] = useState("remove"); // add | remove | set
  const [reasonId, setReasonIdRaw] = useState(() => (typeof lastAdjustReason === "function" ? lastAdjustReason() : ""));
  const setReasonId = (id) => { setReasonIdRaw(id); if (typeof rememberAdjustReason === "function") rememberAdjustReason(id); };
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(""); // "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM"
  const [scan, setScan] = useState("");
  const [q, setQ] = useState("");
  const [showN, setShowN] = useState(30);
  const [pickOpen, setPickOpen] = useState(!product);
  const [busy, setBusy] = useState(false);
  const [fillValue, setFillValue] = useState("");   // "ใส่เท่ากันทุกแถว" box
  const busyRef = useRef(false);
  const scanRef = useRef(null);
  const toast = pushToast || (() => {});
  // Only reasons that fit the mode (เพิ่มเข้า hides ขายผ่าน… etc.); a pick that
  // doesn't fit after a mode switch resolves to null so confirm stays disabled.
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

  // Scan/typed-SKU selection — same exact-match funnel as StockTake.submitScan
  // (product SELECTION only; not a third barcode-resolution path).
  const submitScan = (code) => {
    const s = String(code ?? scan).trim();
    if (!s) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === s.toLowerCase());
    if (!p) {
      if (typeof playScanErrorBeep === "function") playScanErrorBeep();
      toast("ไม่พบ SKU: " + s);
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    setScan("");
    if (picked(p.sku)) { toast(`${p.sku} เลือกไว้แล้ว`); return; }
    addSku(p.sku);
  };

  // Per-row delta from the shared mode. หักออก clamps at the current qty so a
  // typo can't drive stock negative; ตั้งค่าเป็น is an absolute target.
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
  const canConfirm = changes.length > 0 && !!reason && (!reason.requireNote || note.trim());

  const filtered = PRODUCTS.filter(p =>
    !q ||
    p.sku.toLowerCase().includes(q.toLowerCase()) ||
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    (p.cat || "").toLowerCase().includes(q.toLowerCase())
  );

  const resetForNext = () => {
    busyRef.current = false; setBusy(false);
    setRows([]); setMode("remove"); setReasonIdRaw(typeof lastAdjustReason === "function" ? lastAdjustReason() : ""); setNote(""); setScan(""); setQ(""); setShowN(30); setPickOpen(true);
    setTimeout(() => scanRef.current?.focus(), 60);
  };

  const confirm = async () => {
    if (!canConfirm || busyRef.current) return;
    // Synchronous latch: a second click can land before React re-renders with a
    // disabled button, and each one applied the batch again.
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
      ? applyStockAdjustmentBatch(changes, { reason, note, when })
      : { applied: 0, net: 0 };
    if (!res.applied) {
      toast("ปรับสต็อกไม่สำเร็จ");
      if (guardKey && typeof releaseCommit === "function") releaseCommit(guardKey);
      busyRef.current = false; setBusy(false);
      return;
    }
    /* Re-balance the split from the ACTUAL applied results — a row the clamp ate
       contributes nothing. Works for both signs: a positive delta lands on the
       chosen shelf, a negative one comes off it and cascades. */
    if (typeof applyLocPicks === "function") {
      const locBySku = {};
      rows.forEach(r => { locBySku[r.sku] = r.loc; });
      const picks = (res.results || changes).filter(r => r.ok !== false).map(r => ({ sku: r.sku, loc: locBySku[r.sku] }));
      const locRes = await applyLocPicks(picks);
      if (locRes && locRes.offline) toast("ปรับสต็อกแล้ว — จำนวนตามตำแหน่งจะอัปเดตเมื่อออนไลน์");
      else if (locRes && locRes.errors && locRes.errors.length) toast("ปรับสต็อกสำเร็จ แต่ปรับตำแหน่งไม่สำเร็จ: " + locRes.errors[0].error);
    }
    const backSt = when && typeof stockOutStamp === "function" ? stockOutStamp(when) : null;
    const backTxt = backSt && backSt.backdated ? ` (ย้อนหลัง ${stockOutStampLabel(backSt)})` : "";
    toast((changes.length === 1
      ? `ปรับสต็อก ${changes[0].sku} ${res.net > 0 ? "+" : ""}${res.net} ชิ้น — ${reason.label}`
      : `ปรับสต็อก ${res.applied} รายการ (สุทธิ ${res.net > 0 ? "+" : ""}${res.net} ชิ้น) — ${reason.label}`) + backTxt);
    busyRef.current = false; setBusy(false);
    if (product) onApply?.();
    else resetForNext(); // batch loop: back to the picker for the next round
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 300 }}/>
      <div className="modal" style={{ width: 660, maxWidth: "calc(100vw - 40px)", zIndex: 301 }}>
        <div className="modal-head">
          <div>
            <h3>ปรับสต็อก</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {rows.length
                ? `เลือกไว้ ${rows.length} รายการ · เลือกได้หลายรายการพร้อมกัน`
                : "สำหรับนับสต็อกผิด สินค้าเสียหาย หรือขายนอกระบบ (Shopee / Lazada / หน้าร้าน)"}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label>สแกนบาร์โค้ด / พิมพ์ SKU เพื่อเพิ่มเข้ารายการ</label>
            <input ref={scanRef} className="input" value={scan} onChange={e => setScan(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitScan(); }}
              placeholder="ยิงบาร์โค้ดหรือพิมพ์ SKU แล้วกด Enter" autoFocus={!product}/>
          </div>

          {/* Multi-select product browser with photos */}
          <div className="field">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ margin: 0 }}>เลือกสินค้า {rows.length > 0 && <span style={{ color: "var(--accent)" }}>({rows.length})</span>}</label>
              <button className="btn btn-sm" onClick={() => setPickOpen(o => !o)}>
                {pickOpen ? <><Icons.Chev size={12} style={{ transform: "rotate(-90deg)" }}/> ซ่อนรายการ</> : <><Icons.Plus size={12}/> เลือกสินค้าเพิ่ม</>}
              </button>
            </div>
            {pickOpen && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
                <div style={{ padding: 8, borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  <div className="search" style={{ width: "100%" }}>
                    <Icons.Search size={14}/>
                    <input value={q} onChange={e => { setQ(e.target.value); setShowN(30); }} placeholder="ค้นหา SKU, ชื่อสินค้า, หมวด..."/>
                    {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => { setQ(""); setShowN(30); }}><Icons.X size={12}/></span>}
                  </div>
                </div>
                <div style={{ maxHeight: 250, overflowY: "auto", overscrollBehavior: "contain" }}>
                  {filtered.slice(0, showN).map(p => {
                    const s = stockStatus(p);
                    const on = picked(p.sku);
                    return (
                      <div key={p.sku} onClick={() => toggleSku(p.sku)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", cursor: "pointer",
                          borderBottom: "1px solid var(--border)",
                          background: on ? "var(--accent-soft)" : "transparent"
                        }}>
                        <span className={"check" + (on ? " on" : "")} style={{ flexShrink: 0 }}/>
                        {typeof ProductImageThumb === "function" && <ProductImageThumb sku={p.sku} size={34} radius={7}/>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                          <div className="row" style={{ gap: 6, marginTop: 1 }}>
                            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</span>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>· {p.cat}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="tnum" style={{ fontSize: 14, fontWeight: 600 }}>{effQty(p.sku)}</div>
                          <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 7px", marginTop: 2 }}><span className="dot"/>{s.label}</span>
                        </div>
                      </div>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่พบสินค้าที่ตรงกับ "{q}"</div>
                  )}
                  {filtered.length > showN && (
                    <button className="btn btn-sm" style={{ width: "100%", borderRadius: 0, justifyContent: "center" }} onClick={() => setShowN(n => n + 30)}>
                      ดูเพิ่ม — แสดง {showN} จาก {filtered.length} รายการ
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {rows.length > 0 && (
            <>
              <div className="seg" style={{ width: "100%" }}>
                <button className={mode === "add" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("add")}>เพิ่มเข้า</button>
                <button className={mode === "remove" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("remove")}>หักออก</button>
                <button className={mode === "set" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("set")}>ตั้งค่าเป็น</button>
              </div>

              <div className="field">
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>{mode === "set" ? "จำนวนคงเหลือใหม่ (ต่อรายการ)" : "จำนวน (ชิ้น) ต่อรายการ"}</label>
                  {rows.length > 1 && (
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>ใส่เท่ากันทุกแถว</span>
                      <QtyStepper small value={fillValue}
                        onChange={v => { setFillValue(v); fillAll(v); }}
                        title="ใส่จำนวนเท่ากันทุกแถว"/>
                    </div>
                  )}
                </div>
                <div className="stack" style={{ gap: 6, maxHeight: 260, overflowY: "auto", overscrollBehavior: "contain" }}>
                  {rows.map(r => {
                    const p = PRODUCTS.find(x => x.sku === r.sku);
                    const cur = effQty(r.sku);
                    const d = deltaOf(r);
                    return (
                      <div key={r.sku} className="row" style={{ gap: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
                        {typeof ProductImageThumb === "function" && <ProductImageThumb sku={r.sku} size={40} radius={8}/>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p ? p.name : r.sku}</div>
                          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{r.sku} · คงเหลือ {cur}</div>
                          {/* Neutral label here — the delta can be positive. */}
                          <LocPickSelect sku={r.sku} value={r.loc} need={d < 0 ? -d : 0} label="ตำแหน่ง" onChange={loc => setRowLoc(r.sku, loc)}/>
                        </div>
                        <QtyStepper value={r.amount} onChange={v => setAmount(r.sku, v)}
                          max={mode === "remove" ? cur : undefined}
                          title={`จำนวนสำหรับ ${r.sku}`}/>
                        <div className="tnum" style={{ width: 76, textAlign: "right", fontSize: 12, flexShrink: 0, color: d === 0 ? "var(--muted)" : d > 0 ? "var(--success)" : "var(--danger)" }}>
                          {d === 0 ? "—" : `${cur} → ${Math.max(0, cur + d)}`}
                        </div>
                        <button className="btn btn-sm btn-ghost btn-icon" title="เอาออกจากรายการ" onClick={() => removeSku(r.sku)} style={{ flexShrink: 0 }}><Icons.X size={13}/></button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="field">
                <label>เหตุผล <span style={{ color: "var(--danger)" }}>*</span></label>
                <div className="adj-reasons">
                  {modeReasons.map(r => (
                    <button key={r.id} type="button" className={"adj-reason" + (reasonId === r.id ? " on" : "")} onClick={() => setReasonId(r.id)}>{r.label}</button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>หมายเหตุ {reason && reason.requireNote
                  ? <span style={{ color: "var(--danger)" }}>*</span>
                  : <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ไม่จำเป็น)</span>}</label>
                <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เลขออร์เดอร์ Shopee, อ้างอิงการนับ"/>
              </div>
              <StockOutWhenField value={when} onChange={setWhen} label="วันเวลาที่ปรับสต็อก"
                hint="ปรับย้อนหลัง? เลือกวันเวลาที่เกิดขึ้นจริง — ประวัติ (และยอดขาย ถ้าเป็นเหตุผล ขายผ่าน…) จะลงวันนั้น"/>
              {changes.length > 0 && (
                <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>จะปรับ {changes.length} รายการ</span>
                  <span className="tnum" style={{ fontSize: 20, fontWeight: 600, color: net > 0 ? "var(--success)" : "var(--danger)" }}>
                    สุทธิ {net > 0 ? "+" : ""}{net} ชิ้น
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{product ? "ยกเลิก" : "ปิด"}</button>
          {rows.length > 0 && (
            <button className="btn btn-primary" disabled={!canConfirm || busy} onClick={confirm} style={(!canConfirm || busy) ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
              <Icons.Check size={14}/> ยืนยันปรับสต็อก{changes.length > 1 ? ` (${changes.length})` : ""}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

/* ========= LOCATIONS ========= */
function Locations({ goTo }) {
  const [tree, setTree] = useState(loadLocTree);
  const [selected, setSelected] = useState(null); // { building, floor, pos, code, highlightSku? }
  const [finderQ, setFinderQ] = useState("");
  const [assignSku, setAssignSku] = useState(null); // finder hit with no position → assign it one

  useEffect(() => {
    // Shallow-copy: once the cloud tree is loaded, loadLocTree() returns the same
    // object reference every time, and setState would bail out — freezing SKU counts.
    const h = () => setTree({ ...loadLocTree() });
    window.addEventListener("ims-locations-change", h);
    window.addEventListener("ims-products-change", h);
    // Split rows move without touching products (partial ย้าย/แก้การแบ่ง) —
    // the SKU badges and the open drawer must follow those too.
    window.addEventListener("ims-product-locs-change", h);
    return () => {
      window.removeEventListener("ims-locations-change", h);
      window.removeEventListener("ims-products-change", h);
      window.removeEventListener("ims-product-locs-change", h);
    };
  }, []);

  const buildings = tree.buildings || [];
  const floorCount = buildings.reduce((s, b) => s + (b.floors || []).length, 0);
  const posCount = buildings.reduce((s, b) => s + (b.floors || []).reduce((t, f) => t + (f.positions || []).length, 0), 0);
  const allowDelete = typeof canDeleteData === "function" ? canDeleteData() : true;
  // Writing p.loc IS the editProduct capability (and RLS enforces it server-side),
  // so a role that can't edit products must not be offered the assign flow.
  const canAssign = typeof canDo === "function" ? canDo("editProduct") : true;
  const locImages = useLocationImages();
  // tree state refreshes on both products- and locations-change, so this stays live
  const unstored = useMemo(() => countUnstoredProducts(), [tree]);

  const askBuilding = async () => { const n = await askText("เพิ่มอาคาร / โซน", "", { label: "ชื่ออาคาร / โซน", placeholder: "เช่น สภ., ตึกพาณิชย์" }); if (n) addBuilding(n); };
  const askFloor    = async (b) => { const n = await askText(`เพิ่มชั้นในอาคาร "${b}"`, "", { label: "ชื่อชั้น", placeholder: "เช่น ชั้น 3" }); if (n) addFloor(b, n); };
  const askPos      = async (b, f) => { const n = await askText(`เพิ่มตำแหน่งใน ${b} · ${f}`, "", { label: "ชื่อตำแหน่ง", placeholder: "เช่น A1, กล่อง 12" }); if (n) addPosition(b, f, n); };
  const editB = async (b) => { const n = await askText("เปลี่ยนชื่ออาคาร", b, { okLabel: "เปลี่ยนชื่อ" }); if (n && n !== b) renameBuilding(b, n); };
  const editF = async (b, f) => { const n = await askText("เปลี่ยนชื่อชั้น", f, { okLabel: "เปลี่ยนชื่อ" }); if (n && n !== f) renameFloor(b, f, n); };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ตำแหน่งจัดเก็บ</h1>
          <div className="page-sub">{buildings.length} อาคาร · {floorCount} ชั้น · {posCount} ตำแหน่ง</div>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={askBuilding}><Icons.Plus/> เพิ่มอาคาร</button>
        </div>
      </div>

      {/* ── Warning: products not yet stored in any real position ── */}
      {unstored > 0 && (
        <div className="row" style={{ padding: "12px 16px", background: "var(--warning-soft)", borderRadius: 12, gap: 12, alignItems: "center", fontSize: 13, color: "oklch(0.5 0.13 65)" }}>
          <Icons.Warn size={16} style={{ flexShrink: 0 }}/>
          <span style={{ flex: 1 }}>มีสินค้า <strong className="tnum">{unstored}</strong> รายการที่ยังไม่ได้จัดเก็บเข้าตำแหน่ง — เปิดตำแหน่งแล้วกด “เพิ่มสินค้า” หรือจัดเก็บทีละหลายรายการจากหน้าสินค้าคงคลัง</span>
          {typeof goTo === "function" && <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => goTo("inventory")}>ไปที่สินค้าคงคลัง</button>}
        </div>
      )}

      {/* ── Product finder: search a product → see & jump to its storage position ── */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
          <Icons.Search size={15} style={{ color: "var(--muted)", flexShrink: 0 }}/>
          <input
            value={finderQ}
            onChange={e => setFinderQ(e.target.value)}
            placeholder="ค้นหาสินค้า (ชื่อ / SKU / สแกนบาร์โค้ด) เพื่อเช็คตำแหน่งจัดเก็บ..."
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14, color: "var(--fg)", fontFamily: "inherit" }}
          />
          {finderQ && <button className="btn btn-ghost btn-icon" title="ล้างคำค้น" onClick={() => setFinderQ("")}><Icons.X size={14}/></button>}
        </div>
        {finderQ.trim() && (() => {
          const res = searchProductsForLocation(finderQ, 12);
          return (
            <div className="stack" style={{ gap: 6, marginTop: 12 }}>
              {res.hits.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--muted)", padding: "14px 4px", textAlign: "center" }}>ไม่พบสินค้า "{finderQ}"</div>
              )}
              {res.hits.map(p => {
                const st = stockStatus(p);
                const parts = ((h) => h ? locParts(h) : null)(productHomeLoc(p));
                return (
                  <div key={p.sku} className="row"
                    onClick={() => parts
                      ? setSelected({ building: parts.building, floor: parts.floor, pos: parts.pos, code: parts.code, highlightSku: p.sku })
                      : (canAssign && setAssignSku(p.sku))}
                    title={parts ? "เปิดตำแหน่งนี้" : (canAssign ? "เลือกตำแหน่งจัดเก็บให้สินค้านี้" : "บัญชีนี้ไม่มีสิทธิ์แก้ไขตำแหน่งจัดเก็บ")}
                    style={{ gap: 12, padding: 10, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, cursor: (parts || canAssign) ? "pointer" : "default" }}>
                    {typeof ProductImageThumb === "function" && <ProductImageThumb sku={p.sku} size={44} radius={8}/>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      <div className="row" style={{ gap: 8, marginTop: 2 }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</span>
                        <span className={"badge " + st.cls} style={{ fontSize: 10 }}>{p.qty} ชิ้น</span>
                      </div>
                    </div>
                    {parts ? (
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          <Icons.Map size={13} style={{ color: "var(--accent)" }}/>
                          <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{parts.pos}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{parts.building} · {parts.floor}</div>
                      </div>
                    ) : (
                      <span className="badge badge-warning" style={{ fontSize: 10, flexShrink: 0 }}><Icons.Warn size={10}/> ยังไม่จัดเก็บ</span>
                    )}
                  </div>
                );
              })}
              {res.total > res.hits.length && (
                <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", paddingTop: 2 }}>
                  แสดง {res.hits.length} จาก {res.total} รายการ — พิมพ์เพิ่มเพื่อค้นหาให้แคบลง
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {buildings.length === 0 ? (
        <div className="card" style={{ padding: "44px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          ยังไม่มีอาคาร — กด “เพิ่มอาคาร” เพื่อเริ่ม
        </div>
      ) : buildings.map(b => (
        <div key={b.name} className="card" style={{ padding: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="row" style={{ gap: 8 }}>
              <Icons.Map size={16}/>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{b.name}</span>
              <span className="badge badge-neutral">{(b.floors || []).length} ชั้น</span>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button className="btn btn-sm" onClick={() => askFloor(b.name)}><Icons.Plus size={12}/> เพิ่มชั้น</button>
              <button className="btn btn-ghost btn-icon" title="แก้ชื่ออาคาร" onClick={() => editB(b.name)}><Icons.Edit size={13}/></button>
              {allowDelete && <button className="btn btn-ghost btn-icon" title="ลบอาคาร" onClick={() => { if (confirm(`ลบอาคาร “${b.name}” และทุกชั้น/ตำแหน่งในนั้น?`)) removeBuilding(b.name); }}><Icons.Trash size={13}/></button>}
            </div>
          </div>

          {(b.floors || []).length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)", padding: "6px 2px" }}>ยังไม่มีชั้น — กด “เพิ่มชั้น”</div>
          ) : (b.floors || []).map(f => (
            <div key={f.name} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{f.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{(f.positions || []).length} ตำแหน่ง</span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn btn-sm" onClick={() => askPos(b.name, f.name)}><Icons.Plus size={12}/> เพิ่มตำแหน่ง</button>
                  <button className="btn btn-ghost btn-icon" title="แก้ชื่อชั้น" onClick={() => editF(b.name, f.name)}><Icons.Edit size={13}/></button>
                  {allowDelete && <button className="btn btn-ghost btn-icon" title="ลบชั้น" onClick={() => { if (confirm(`ลบ ${f.name} ในอาคาร ${b.name}?`)) removeFloor(b.name, f.name); }}><Icons.Trash size={13}/></button>}
                </div>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {(f.positions || []).length === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>— ยังไม่มีตำแหน่ง —</span>}
                {(f.positions || []).map(p => {
                  const code = locCode(b.name, f.name, p);
                  const n = skusInLocation(code);
                  const hasPhoto = typeof getLocationImage === "function" && getLocationImage(code, locImages);
                  return (
                    <div key={p} onClick={() => setSelected({ building: b.name, floor: f.name, pos: p, code })}
                      style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
                      <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{p}</span>
                      <span className="badge badge-neutral" style={{ fontSize: 10 }}>{n} SKU</span>
                      {hasPhoto && typeof LocationImageThumb === "function" && <LocationImageThumb code={code} size={20} radius={6}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="row" style={{ padding: "12px 16px", background: "var(--surface-2)", borderRadius: 12, fontSize: 12, color: "var(--muted)", gap: 12, alignItems: "center" }}>
        <Icons.Refresh size={16}/>
        <span>จำนวน SKU ของแต่ละตำแหน่งคำนวณจากสินค้าจริง — เปิดตำแหน่งแล้วกด “เพิ่มสินค้า” เพื่อจัดสินค้าเข้าตำแหน่งได้เลย</span>
      </div>

      {assignSku && (
        <AssignLocationModal
          skus={[assignSku]}
          products={PRODUCTS}
          storedCodes={storedLocSet()}
          onClose={() => setAssignSku(null)}
          onAddBuilding={askBuilding}
          onApply={(code) => {
            updateManyProducts([assignSku], { loc: code });
            if (typeof recordChange === "function") {
              recordChange({
                entity: "product", entityId: assignSku, action: "update",
                summary: `จัดเก็บ ${assignSku} เข้าตำแหน่ง ${code}`,
                changes: [{ label: "ตำแหน่งจัดเก็บ", to: code }]
              });
            }
            try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: `จัดเก็บ ${assignSku} เข้าตำแหน่ง ${code} แล้ว` })); } catch (e) {}
            setAssignSku(null);
          }}/>
      )}

      {selected && <LocationDrawer loc={selected} highlightSku={selected.highlightSku} onClose={() => setSelected(null)}
        onDelete={allowDelete ? (() => { if (confirm(`ลบตำแหน่ง ${selected.pos}?`)) { removePosition(selected.building, selected.floor, selected.pos); setSelected(null); } }) : null}/>}
    </div>
  );
}

function LocationDrawer({ loc, onClose, onDelete, highlightSku }) {
  /* Everything physically here — primary loc OR split stock parked here. Filtering
     on p.loc alone hid every item whose main shelf is elsewhere: the SKU-count badge
     (skusInLocation) counts the split, so a box could read "10 SKU" and list 7, and
     boxes that only ever hold split stock (กล่อง 3–6) looked empty. */
  const items = (typeof productsInLocation === "function")
    ? productsInLocation(loc.code)
    : PRODUCTS.filter(p => (p.loc || "") === loc.code);
  // The product the user searched for floats to the top of the shelf list.
  if (highlightSku) items.sort((a, b) => (b.sku === highlightSku) - (a.sku === highlightSku));

  // Assign products to this position straight from the drawer — no trip to the
  // product edit modal. Gated like every other product UPDATE (viewer sees no UI).
  const canAssign = typeof canAdjustStock === "function" ? canAdjustStock() : true;
  const [adding, setAdding] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [camOpen, setCamOpen] = useState(false);
  const [showN, setShowN] = useState(8);
  // The shelf list itself is windowed too — โซน A holds 200+ SKUs, and a hard
  // .slice(0, 40) ended the list silently with no way to reach the rest.
  const [showItems, setShowItems] = useState(40);
  // Tap a row → full product drawer (per-position split panel lives there).
  const [viewSku, setViewSku] = useState(null);
  useEffect(() => { setShowItems(40); setViewSku(null); }, [loc.code]);
  const toast = (m) => window.dispatchEvent(new CustomEvent("ims-toast", { detail: m }));
  // "Already here" = pieces filed at this shelf (product_locations), not p.loc —
  // p.loc is "-" on live data, which listed shelved products as addable.
  const isHere = (p) => (p.loc || "") === loc.code
    || ((typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, loc.code) : 0) > 0;
  const assign = async (p) => {
    const home = productHomeLoc(p);
    const from = home && home !== loc.code ? locParts(home) : null;
    const rows = (typeof locSplitFor === "function") ? locSplitFor(p.sku, p.loc) : [];
    if (rows.length && typeof moveStockToLocation === "function") {
      /* Recorded split → the rows must move, not just p.loc (a bare p.loc write
         showed 0 ชิ้น here and the pieces stayed filed at the old shelf).
         Multi-position sku: ask how many pieces come here (default = the
         primary pile); single-position sku moves whole, no question. */
      let pieces = Number(p.qty) || 0;
      if (rows.length > 1) {
        const atPrimary = (typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, home || p.loc) : 0;
        const ans = await askText(`ย้ายมา ${loc.pos} กี่ชิ้น?`, String(atPrimary > 0 ? atPrimary : pieces), {
          label: "จำนวนชิ้น", type: "number", okLabel: "ย้าย",
          message: `“${p.name}” แยกเก็บ ${rows.length} ตำแหน่ง (รวม ${pieces} ชิ้น)`
        });
        if (ans === null) return;
        pieces = Math.round(Number(ans));
        if (!pieces || pieces <= 0 || isNaN(pieces)) return;
      }
      const res = await moveStockToLocation(p.sku, loc.code, pieces);
      if (!res || !res.ok) { if (res && res.error) toast(res.error); return; }
      toast(res.all
        ? (from ? `ย้าย “${p.name}” จาก ${from.pos} มา ${loc.pos} แล้ว` : `เพิ่ม “${p.name}” เข้า ${loc.pos} แล้ว`)
        : `ย้าย “${p.name}” มา ${loc.pos} ${res.moved} ชิ้นแล้ว`);
      return;
    }
    updateProductInStore(p.sku, { loc: loc.code });
    toast(from ? `ย้าย “${p.name}” จาก ${from.pos} มา ${loc.pos} แล้ว` : `เพิ่ม “${p.name}” เข้า ${loc.pos} แล้ว`);
  };
  const unassign = async (p) => {
    const rows = (typeof locSplitFor === "function") ? locSplitFor(p.sku, p.loc) : [];
    if (rows.length > 1) { toast(`“${p.name}” แยกเก็บหลายตำแหน่ง — กดที่สินค้าเพื่อแก้การแบ่งตำแหน่ง`); return; }
    if (rows.length === 1 && typeof saveLocSplit === "function") {
      const res = await saveLocSplit(p.sku, []);
      if (!res || !res.ok) { toast((res && res.error) || "นำออกไม่สำเร็จ"); return; }
    }
    updateProductInStore(p.sku, { loc: "" });
    toast(`นำ “${p.name}” ออกจาก ${loc.pos} แล้ว`);
  };
  // Enter = keyboard-wedge scan: an exact-SKU (or single) hit is assigned and the
  // box clears, so a batch can be shelved scan-by-scan without touching the mouse.
  const onAddKey = (e) => {
    if (e.key !== "Enter") return;
    const q = addQ.trim().toLowerCase();
    if (!q) return;
    const exact = PRODUCTS.find(p => String(p.sku || "").toLowerCase() === q);
    const res = searchProductsForLocation(addQ, 2);
    const hit = exact || (res.hits.length === 1 ? res.hits[0] : null);
    if (!hit) return;
    if (!isHere(hit)) assign(hit);
    setAddQ("");
  };
  // Camera scan → assign here. Resolves exactly like the wedge path (exact SKU,
  // else a single search hit) so a code that types-to-a-match also scans-to-it.
  // Continuous mode: the scanner stays open between decodes so a whole shelf
  // can be filled in one session.
  const onCamScan = (code) => {
    const q = String(code || "").trim();
    if (!q) return;
    const exact = PRODUCTS.find(x => String(x.sku || "").toLowerCase() === q.toLowerCase());
    const res = searchProductsForLocation(q, 2);
    const p = exact || (res.hits.length === 1 ? res.hits[0] : null);
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); toast("ไม่พบ SKU: " + q); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    const here = (typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, loc.code) : 0;
    if (isHere(p) && !(typeof hasLocSplit === "function" && hasLocSplit(p.sku))) {
      toast(`“${p.name}” อยู่ใน ${loc.pos} อยู่แล้ว (${here || p.qty} ชิ้น)`);
      return;
    }
    assign(p);
  };
  // One row of the picker — used by both the search results and the browse list.
  const pickRow = (p) => {
    const here = isHere(p);
    const home = here ? "" : productHomeLoc(p);
    const from = home && home !== loc.code ? locParts(home) : null;
    return (
      <div key={p.sku} className="row" onClick={() => { if (!here) assign(p); }}
        style={{ gap: 10, padding: 8, borderRadius: 8, background: here ? "var(--accent-soft)" : "var(--surface-2)", cursor: here ? "default" : "pointer" }}>
        {typeof ProductImageThumb === "function" && <ProductImageThumb sku={p.sku} size={36} radius={7}/>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{p.sku} · {p.qty} ชิ้น</div>
        </div>
        {here
          ? <span className="row" style={{ gap: 4, fontSize: 11, color: "var(--accent)", fontWeight: 600, flexShrink: 0 }}><Icons.Check size={12}/> อยู่ที่นี่แล้ว</span>
          : (
            <span className="row" style={{ gap: 6, flexShrink: 0 }}>
              {from && <span style={{ fontSize: 10, color: "var(--muted)" }}>อยู่ที่ {from.pos}</span>}
              <span className="btn btn-sm btn-primary" style={{ pointerEvents: "none" }}><Icons.Plus size={11}/> {from ? "ย้ายมาที่นี่" : "เพิ่ม"}</span>
            </span>
          )}
      </div>
    );
  };

  const printLabel = () => {
    const svg = (typeof qrSvgMarkup === "function") ? qrSvgMarkup(loc.code, 360) : "";
    const w = window.open("", "_blank", "width=420,height=470");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ป้าย ${loc.pos}</title>
      <style>
        @page { size: 50mm 50mm; margin: 0; }
        html,body { margin:0; padding:0; }
        body { font-family:'IBM Plex Sans Thai','IBM Plex Mono',monospace; text-align:center; padding:4mm; }
        .qr { width:30mm; height:30mm; margin:0 auto 2mm; }
        .qr svg { width:100%; height:100%; display:block; }
        .pos { font-size:20px; font-weight:700; }
        .path { font-size:11px; color:#555; margin-top:1mm; }
      </style></head>
      <body onload="window.focus();window.print();">
        <div class="qr">${svg}</div>
        <div class="pos">${loc.pos}</div>
        <div class="path">${loc.building} · ${loc.floor}</div>
      </body></html>`);
    w.document.close();
  };

  const renamePos = async () => {
    const n = await askText("เปลี่ยนชื่อตำแหน่ง", loc.pos, { okLabel: "เปลี่ยนชื่อ" });
    if (n && n !== loc.pos) { renamePosition(loc.building, loc.floor, loc.pos, n); onClose(); }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">{loc.building} · {loc.floor}</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{loc.pos}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-ghost btn-icon" title="แก้ชื่อตำแหน่ง" onClick={renamePos}><Icons.Edit size={15}/></button>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
          </div>
        </div>
        <div className="drawer-body">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>สินค้าในตำแหน่งนี้ ({items.length})</div>
            {canAssign && (
              <button className={"btn btn-sm" + (adding ? "" : " btn-primary")} onClick={() => { setAdding(a => !a); setAddQ(""); setShowN(8); }}>
                {adding ? "เสร็จแล้ว" : <><Icons.Plus size={12}/> เพิ่มสินค้า</>}
              </button>
            )}
          </div>

          {adding && (
            <div style={{ marginBottom: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                  <Icons.Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }}/>
                  <input autoFocus value={addQ} onChange={e => setAddQ(e.target.value)} onKeyDown={onAddKey}
                    placeholder="ค้นหาสินค้า (ชื่อ / SKU)..."
                    style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 13, color: "var(--fg)", fontFamily: "inherit" }}/>
                  {addQ && <Icons.X size={13} style={{ cursor: "pointer", color: "var(--muted)", flexShrink: 0 }} onClick={() => setAddQ("")}/>}
                </div>
                <button className="btn btn-sm" style={{ flexShrink: 0, gap: 5 }} onClick={() => setCamOpen(true)} title="สแกนบาร์โค้ดด้วยกล้อง">
                  <Icons.Camera size={14}/> สแกน
                </button>
              </div>
              {(() => {
                if (addQ.trim()) {
                  const res = searchProductsForLocation(addQ, 8);
                  return (
                    <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                      {res.hits.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "10px 0" }}>ไม่พบสินค้า "{addQ}"</div>}
                      {res.hits.map(p => pickRow(p))}
                    </div>
                  );
                }
                // No query → browse the whole catalog right here; unplaced products first
                // (stale codes count as unplaced, same as the ยังไม่จัดเก็บ badge).
                const stored = storedLocSet();
                const browse = PRODUCTS.filter(p => !isHere(p))
                  .sort((a, b) => ((productIsStored(a, stored) ? 1 : 0) - (productIsStored(b, stored) ? 1 : 0)) || String(a.name || "").localeCompare(String(b.name || ""), "th"));
                return (
                  <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                    {browse.length === 0
                      ? <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "10px 0" }}>สินค้าทุกรายการอยู่ในตำแหน่งนี้แล้ว</div>
                      : <div style={{ fontSize: 11, color: "var(--muted)", padding: "0 2px" }}>เลือกจากรายการ (สินค้าที่ยังไม่มีตำแหน่งขึ้นก่อน) หรือพิมพ์ค้นหา / กดสแกน</div>}
                    {browse.slice(0, showN).map(p => pickRow(p))}
                    {browse.length > showN && (
                      <button className="btn btn-sm" style={{ alignSelf: "center", marginTop: 2 }} onClick={() => setShowN(n => n + 12)}>
                        ดูเพิ่ม — แสดง {Math.min(showN, browse.length)} จาก {browse.length}
                      </button>
                    )}
                  </div>
                );
              })()}
              {camOpen && <CameraScanner continuous onScan={onCamScan} onClose={() => setCamOpen(false)}/>}
            </div>
          )}

          <div className="stack" style={{ gap: 6 }}>
            {items.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: 12, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>ยังไม่มีสินค้าในตำแหน่งนี้{canAssign ? " — กด “เพิ่มสินค้า” เพื่อเลือกสินค้าเข้าตำแหน่ง" : ""}</div>}
            {items.slice(0, showItems).map(p => {
              const hl = p.sku === highlightSku;
              // Pieces AT THIS POSITION, not the product's grand total — a picker
              // sent here for 6 must not read the 12 that include another shelf.
              const here = (typeof qtyAtLocation === "function") ? qtyAtLocation(p.sku, loc.code) : p.qty;
              // Primary / "หลักอยู่" from the real home shelf — p.loc is "-" on live data.
              const home = productHomeLoc(p);
              const isPrimary = home === loc.code;
              const main = home && home !== loc.code ? locParts(home) : null;
              const split = typeof hasLocSplit === "function" && hasLocSplit(p.sku);
              return (
                <div key={p.sku} className="row" onClick={() => setViewSku(p.sku)} title="ดูรายละเอียดสินค้า"
                  style={{ gap: 10, padding: 10, background: hl ? "var(--accent-soft)" : "var(--surface-2)", border: hl ? "1.5px solid var(--accent)" : "1px solid transparent", borderRadius: 8, cursor: "pointer" }}>
                  {typeof ProductImageThumb === "function" && <ProductImageThumb sku={p.sku} size={40} radius={8}/>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                      {p.sku}{main ? <span style={{ fontFamily: "inherit" }}> · หลักอยู่ {main.pos}</span> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div className="tnum" style={{ fontSize: 14, fontWeight: 500 }}>{here} ชิ้น</div>
                    {here !== p.qty && <div style={{ fontSize: 10, color: "var(--muted)" }}>รวมทุกที่ {p.qty}</div>}
                  </div>
                  {/* Only a product stored here-and-only-here can be "removed" with one
                      tap — a multi-position sku is rebalanced in its split panel
                      (tap the row), not blanked. */}
                  {canAssign && isPrimary && !split && <button className="btn btn-ghost btn-icon" title="นำออกจากตำแหน่งนี้" style={{ flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); unassign(p); }}><Icons.X size={13}/></button>}
                </div>
              );
            })}
            {items.length > showItems && (
              <button className="btn btn-sm" style={{ alignSelf: "center", marginTop: 4 }} onClick={() => setShowItems(n => n + 40)}>
                ดูเพิ่ม — แสดง {showItems} จาก {items.length} รายการ
              </button>
            )}
          </div>

          <div style={{ marginTop: 22, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>ภาพตำแหน่ง</div>
          {typeof LocationImageUpload === "function"
            ? <LocationImageUpload code={loc.code}/>
            : null}

          <div style={{ marginTop: 22, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>QR ตำแหน่ง</div>
          <div className="row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, gap: 14 }}>
            <QR value={loc.code} size={88}/>
            <div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{loc.pos}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{loc.building} · {loc.floor}</div>
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={printLabel}><Icons.Print size={13}/> พิมพ์ป้าย QR</button>
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          {onDelete && (
            <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={onDelete}>
              <Icons.Trash size={14}/> ลบตำแหน่ง
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose} style={{ marginLeft: "auto" }}>เสร็จสิ้น</button>
        </div>
      </div>
      {/* Product detail stacked over the position drawer (later sibling → on top).
          Closing it drops back to this shelf list, not out of the drawer. */}
      {(() => {
        const vp = viewSku ? PRODUCTS.find(x => x.sku === viewSku) : null;
        return vp ? <ProductDrawer product={vp} onClose={() => setViewSku(null)} pushToast={toast}/> : null;
      })()}
    </>
  );
}

/* ── Thai address database (Earthchie raw_database, compacted to [tambon,amphoe,province,zip]) ──
   Fetched once, lazily, then cached for the whole session. */
let __thaiAddrCache = null;
let __thaiAddrPromise = null;
function loadThaiAddresses() {
  if (__thaiAddrCache) return Promise.resolve(__thaiAddrCache);
  if (__thaiAddrPromise) return __thaiAddrPromise;
  __thaiAddrPromise = fetch("thai-address.json")
    .then(r => r.json())
    .then(rows => {
      __thaiAddrCache = rows.map(r => ({ tambon: r[0], amphoe: r[1], province: r[2], zip: String(r[3]) }));
      return __thaiAddrCache;
    })
    .catch(() => { __thaiAddrCache = []; return []; });
  return __thaiAddrPromise;
}

/* One autocomplete-enabled address field. Typing searches the Thai address DB
   by this field; picking a suggestion fills all four fields at once. */
function ThaiAddrField({ label, fieldKey, value, placeholder, mono, db, onType, onPick }) {
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const runSearch = (text) => {
    onType(text);
    const q = text.trim().toLowerCase();
    if (!db || !q) { setMatches([]); setOpen(false); return; }
    const seen = new Set();
    const hits = [];
    for (let i = 0; i < db.length && hits.length < 40; i++) {
      const row = db[i];
      if (String(row[fieldKey]).toLowerCase().indexOf(q) !== -1) {
        const k = row.tambon + "|" + row.amphoe + "|" + row.province + "|" + row.zip;
        if (!seen.has(k)) { seen.add(k); hits.push(row); }
      }
    }
    setMatches(hits);
    setOpen(hits.length > 0);
  };

  return (
    <div className="field" ref={wrapRef} style={{ position: "relative" }}>
      <label>{label}</label>
      <input
        className={"input" + (mono ? " mono" : "")}
        style={mono ? { fontFamily: "IBM Plex Mono, monospace" } : {}}
        value={value}
        placeholder={placeholder}
        onChange={e => runSearch(e.target.value)}
        onFocus={() => { if (matches.length) setOpen(true); }}
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, boxShadow: "var(--shadow-lg)", zIndex: 300,
          maxHeight: 224, overflowY: "auto"
        }}>
          {matches.map((row, i) => (
            <div key={i}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(row); setOpen(false); setMatches([]); }}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{row.tambon} <span style={{ color: "var(--muted)" }}>›</span> {row.amphoe}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{row.province} · <span className="mono">{row.zip}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* Group of 4 linked Thai-address fields sharing the autocomplete database */
function ThaiAddrAutocomplete({ value, onChange }) {
  const [db, setDb] = useState(null);
  useEffect(() => {
    let alive = true;
    loadThaiAddresses().then(d => { if (alive) setDb(d); });
    return () => { alive = false; };
  }, []);

  const pick = (row) => onChange({ tambon: row.tambon, amphoe: row.amphoe, province: row.province, postal: row.zip });

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500 }}>ที่อยู่ตามทะเบียน <span style={{ color: "var(--muted)", fontWeight: 400 }}>(พิมพ์เพื่อค้นหาอัตโนมัติ)</span></span>
        <span style={{ fontSize: 11, color: db ? "var(--success)" : "var(--muted)" }}>
          {db ? `${db.length.toLocaleString()} ตำบลในระบบ` : "กำลังโหลดฐานข้อมูล…"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ThaiAddrField label="ตำบล / แขวง" fieldKey="tambon" db={db}
          value={value.tambon} placeholder="เช่น คลองเตย"
          onType={v => onChange({ tambon: v })} onPick={pick}/>
        <ThaiAddrField label="อำเภอ / เขต" fieldKey="amphoe" db={db}
          value={value.amphoe} placeholder="เช่น คลองเตย"
          onType={v => onChange({ amphoe: v })} onPick={pick}/>
        <ThaiAddrField label="จังหวัด" fieldKey="province" db={db}
          value={value.province} placeholder="เช่น กรุงเทพมหานคร"
          onType={v => onChange({ province: v })} onPick={pick}/>
        <ThaiAddrField label="รหัสไปรษณีย์" fieldKey="zip" db={db} mono
          value={value.postal} placeholder="10110"
          onType={v => onChange({ postal: v })} onPick={pick}/>
      </div>
    </div>
  );
}

/* Which shelf to take this sku from. Renders nothing for the ordinary
   single-position product, so 90% of the catalogue gains no friction; options
   come from the product's OWN positions (never the whole tree) so staff can't
   pick a shelf the stock isn't on. */
function LocPickSelect({ sku, value, onChange, need, label }) {
  const [, setTick] = useState(0);
  useEffect(() => {
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
    <div style={{ marginTop: 6 }}>
      <div className="row" style={{ gap: 6, alignItems: "center" }}>
        <Icons.Map size={12} style={{ color: "var(--accent)", flexShrink: 0 }}/>
        <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{label || "ตัดจากตำแหน่ง"}</span>
        <select className="input" style={{ height: 30, fontSize: 12, padding: "2px 8px", flex: 1 }}
          value={value || ""} onChange={e => onChange(e.target.value)}>
          {!value && <option value="">— เลือกตำแหน่ง —</option>}
          {spots.map(s => (
            <option key={s.loc} value={s.loc} disabled={s.qty <= 0}>
              {locIsStored(s.loc, stored) ? locParts(s.loc).pos : "ยังไม่ระบุตำแหน่ง"} ×{s.qty}{s.loc === first ? " · หยิบก่อน" : ""}
            </option>
          ))}
        </select>
      </div>
      {short && (
        <div style={{ fontSize: 10.5, color: "var(--warning)", marginTop: 2 }}>
          ตำแหน่งนี้มีแค่ {here} ชิ้น — ที่เหลือหยิบจากตำแหน่งถัดไป
        </div>
      )}
    </div>
  );
}

/* ========= SELL PRODUCT MODAL (3-step wizard) ========= */
/* วันเวลา picker for a stock-out (ตัดสต็อก / ปรับสต็อก / ขายออก / ขาย+จัดส่ง /
   ขายชุด) — most stock-outs are keyed in after the fact, so the record must land
   on the day it really happened. "" = now. The value is Bangkok wall-clock
   "YYYY-MM-DDTHH:MM"; stockOutStamp (data.jsx) turns it into dateIso/ts/createdAt.
   Mobile twin: MStockOutWhen in handheld.jsx. */
function StockOutWhenField({ value, onChange, label, hint, style }) {
  const maxLocal = (typeof nowBkkLocal === "function") ? nowBkkLocal() : "";
  const stamp = value && typeof stockOutStamp === "function" ? stockOutStamp(value) : null;
  const backdated = !!(stamp && stamp.backdated);
  const setYesterday = () => {
    const base = value || maxLocal;
    const d = new Date(Date.parse(base.slice(0, 10) + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    onChange(d + "T" + (base.slice(11, 16) || "12:00"));
  };
  return (
    <div className="field" style={{ marginBottom: 14, ...(style || {}) }}>
      <label>{label || "วันเวลาที่ตัดสต็อก"}</label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <input
          type="datetime-local" className="input" style={{ flex: "1 1 200px", minWidth: 0, ...(backdated ? { borderColor: "var(--warning)" } : {}) }}
          value={value || maxLocal} max={maxLocal}
          onChange={e => onChange(e.target.value && e.target.value < maxLocal ? e.target.value : "")}
        />
        <button type="button" className="btn" onClick={setYesterday}>เมื่อวาน</button>
        <button type="button" className={"btn" + (!value ? " btn-primary" : "")} onClick={() => onChange("")}>ตอนนี้</button>
      </div>
      {backdated ? (
        <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 8, background: "var(--warning-soft)", color: "oklch(0.5 0.13 65)", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Icons.Calendar size={13}/> ย้อนหลัง · บันทึกเป็นวันที่ <strong>{stockOutStampLabel(stamp)}</strong>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{hint || "ทำย้อนหลัง? เลือกวันเวลาที่เกิดขึ้นจริง — จะบันทึกเป็นวันนั้น"}</div>
      )}
    </div>
  );
}

/* ========= ขายออก (quick sale) — desktop =========
   One screen for the everyday sale: scan or search → quantity → channel → done.
   Writes through commitQuickSale (data.jsx), the same path ปรับสต็อก "ขายผ่าน …"
   already uses, so analytics and the channel cards count it. Stays open after a
   sale with the channel kept, ready for the next one. Twin: MQuickSell. */
function QuickSellModal({ onClose, pushToast }) {
  const toast = pushToast || ((m) => { try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: m })); } catch (e) {} });
  const channels = useMemo(() => (typeof quickSaleChannels === "function" ? quickSaleChannels() : []), []);
  const [reasonId, setReasonId] = useState(() => (typeof lastAdjustReason === "function" ? lastAdjustReason() : ""));
  const [lines, setLines] = useState([]);          // [{ sku, qty (string), loc }]
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  // วันเวลาที่ขาย — kept across consecutive sales (a batch of yesterday's orders
  // is keyed in one after another); the orange bar keeps it visible.
  const [when, setWhen] = useState("");
  const [camOpen, setCamOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const searchRef = useRef(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick(t => t + 1);
    window.addEventListener("ims-products-change", h);
    window.addEventListener("ims-stock-adj-change", h);
    setTimeout(() => searchRef.current && searchRef.current.focus(), 60);
    return () => { window.removeEventListener("ims-products-change", h); window.removeEventListener("ims-stock-adj-change", h); };
  }, []);
  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : ((PRODUCTS.find(p => p.sku === sku) || {}).qty || 0));

  const add = (sku) => {
    const p = PRODUCTS.find(x => x.sku === sku);
    if (!p) return false;
    if (effQty(sku) <= 0) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); toast(`${p.sku} หมดสต็อก`); return true; }
    if (typeof playScanBeep === "function") playScanBeep();
    setLines(ls => {
      const hit = ls.find(l => l.sku === sku);
      if (hit) return ls.map(l => l.sku === sku ? { ...l, qty: String(Math.min(effQty(sku), (parseInt(l.qty, 10) || 0) + 1)) } : l);
      return [...ls, { sku, qty: "1", loc: typeof defaultPickLoc === "function" ? defaultPickLoc(p) : "" }];
    });
    setQ("");
    return true;
  };
  const lq = q.trim().toLowerCase();
  const hits = !lq ? [] : PRODUCTS.filter(p => p.sku.toLowerCase().includes(lq) || String(p.name || "").toLowerCase().includes(lq))
    .sort((a, b) => (a.sku.toLowerCase() === lq ? -1 : b.sku.toLowerCase() === lq ? 1 : 0))
    .slice(0, 8);
  const onSearchKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = PRODUCTS.find(p => p.sku.toLowerCase() === lq);   // keyboard-wedge scanner
    if (exact) { add(exact.sku); return; }
    if (hits.length === 1) { add(hits[0].sku); return; }
    if (lq && !hits.length) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); toast("ไม่พบสินค้า: " + q.trim()); }
  };
  const onCamScan = (code) => {
    const c = String(code || "").trim();
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === c.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); toast("ไม่พบ SKU: " + c); return; }
    add(p.sku);
  };
  const setLine = (sku, patch) => setLines(ls => ls.map(l => l.sku === sku ? { ...l, ...patch } : l));
  const pieces = lines.reduce((n, l) => n + (parseInt(l.qty, 10) || 0), 0);
  const overStock = lines.find(l => (parseInt(l.qty, 10) || 0) > effQty(l.sku));
  const canSubmit = !!reasonId && pieces > 0 && !overStock && !busy;

  const submit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true; setBusy(true);   // synchronous latch — a double-click must not sell twice
    const res = await commitQuickSale({ lines: lines.map(l => ({ sku: l.sku, qty: parseInt(l.qty, 10) || 0, loc: l.loc })), reasonId, note: note.trim(), when });
    busyRef.current = false; setBusy(false);
    if (!res.ok) { if (res.error) toast(res.error); return; }
    const ch = channels.find(c => c.id === reasonId);
    const st = when && typeof stockOutStamp === "function" ? stockOutStamp(when) : null;
    const backTxt = st && st.backdated ? ` (ย้อนหลัง ${stockOutStampLabel(st)})` : "";
    toast(`ขายออก ${res.pieces} ชิ้น (${res.applied} รายการ) · ${ch ? ch.label : ""}${backTxt}` + (res.locWarning ? " — " + res.locWarning : ""));
    setLines([]); setNote("");
    setTimeout(() => searchRef.current && searchRef.current.focus(), 60);
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 300 }}/>
      <div className="modal" style={{ width: 680, maxWidth: "calc(100vw - 40px)", zIndex: 301 }}>
        <div className="modal-head">
          <div>
            <h3>ขายออก</h3>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>สแกนหรือค้นหา → จำนวน → ช่องทาง → ยืนยัน · ตัดสต็อกทันทีและนับเข้ายอดขาย</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="ปิด"><Icons.X/></button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>ช่องทางขาย</div>
          <div className="adj-reasons" style={{ marginBottom: 16 }}>
            {channels.map(c => (
              <button key={c.id} type="button" className={"adj-reason" + (reasonId === c.id ? " on" : "")} onClick={() => setReasonId(c.id)}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: c.color, marginRight: 6 }}/>{c.label}
              </button>
            ))}
          </div>

          <div style={{ position: "relative" }}>
            <div className="row" style={{ gap: 8 }}>
              <div className="search" style={{ flex: 1 }}>
                <Icons.Search size={14}/>
                <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey}
                  placeholder="สแกนบาร์โค้ด หรือพิมพ์ SKU / ชื่อสินค้า แล้วกด Enter"/>
              </div>
              <button className="btn" onClick={() => setCamOpen(o => !o)}><Icons.Camera size={14}/> {camOpen ? "ปิดกล้อง" : "กล้อง"}</button>
            </div>
            {hits.length > 0 && (
              <div className="card" style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 5, padding: 4, maxHeight: 320, overflowY: "auto", boxShadow: "var(--shadow-lg)" }}>
                {hits.map(p => {
                  const left = effQty(p.sku);
                  return (
                    <button key={p.sku} className="popover-item" style={{ width: "100%", gap: 10, opacity: left > 0 ? 1 : 0.5 }} onClick={() => add(p.sku)}>
                      <ProductImageThumb sku={p.sku} size={32} radius={7}/>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <span style={{ display: "block", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</span>
                      </span>
                      <span className="tnum" style={{ fontSize: 12, color: left > 0 ? "var(--fg-2)" : "var(--danger)" }}>{left > 0 ? `เหลือ ${left}` : "หมด"}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {camOpen && <div style={{ marginTop: 10 }}><CameraScanner continuous onScan={onCamScan} onClose={() => setCamOpen(false)}/></div>}

          <div style={{ marginTop: 14 }}>
            {lines.length === 0 && (
              <div style={{ padding: "22px 12px", textAlign: "center", color: "var(--muted)", fontSize: 13, border: "1px dashed var(--border)", borderRadius: 12 }}>
                ยังไม่มีสินค้า — สแกนหรือค้นหาด้านบน (สแกนซ้ำ = +1)
              </div>
            )}
            {lines.map(l => {
              const p = PRODUCTS.find(x => x.sku === l.sku) || { sku: l.sku, name: l.sku };
              const left = effQty(l.sku);
              const n = parseInt(l.qty, 10) || 0;
              return (
                <div key={l.sku} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <ProductImageThumb sku={l.sku} size={40} radius={8}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: n > left ? "var(--danger)" : "var(--muted)" }}>
                      <span className="mono">{l.sku}</span> · เหลือ {left}{n > 0 && n <= left ? ` → ${left - n}` : ""}{n > left ? " — เกินสต็อก" : ""}
                    </div>
                    <LocPickSelect sku={l.sku} value={l.loc} need={n} onChange={loc => setLine(l.sku, { loc })}/>
                  </div>
                  <QtyStepper small value={l.qty} min={1} max={left} onChange={v => setLine(l.sku, { qty: v })} title={`จำนวน ${l.sku}`}/>
                  <button className="btn btn-ghost btn-icon" title="เอาออก" onClick={() => setLines(ls => ls.filter(x => x.sku !== l.sku))}><Icons.X size={14}/></button>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>หมายเหตุ <span style={{ fontWeight: 400, color: "var(--muted)" }}>(ไม่จำเป็น)</span></div>
            <input className="input" style={{ width: "100%" }} value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น เลขออร์เดอร์ Shopee, ชื่อลูกค้า"/>
          </div>
          <StockOutWhenField value={when} onChange={setWhen} label="วันเวลาที่ขาย" style={{ marginTop: 14, marginBottom: 0 }}
            hint="ขายย้อนหลัง? เลือกวันเวลาที่ขายจริง — ยอดขายจะนับเป็นวันนั้น"/>
        </div>
        <div className="modal-foot" style={{ alignItems: "center" }}>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--muted)" }}>
            {!reasonId ? "เลือกช่องทางขายก่อน" : pieces ? `${lines.length} รายการ · ${pieces} ชิ้น` : ""}
          </span>
          <button className="btn" onClick={onClose}>ปิด</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            <Icons.Check size={14}/> {busy ? "กำลังบันทึก…" : `ยืนยันขาย${pieces ? " " + pieces + " ชิ้น" : ""}`}
          </button>
        </div>
      </div>
    </>
  );
}

function SellProductModal({ onClose, onSellComplete, presetSku }) {
  const [step, setStep] = useState(1);
  const [when, setWhen] = useState(""); // วันเวลาที่ขาย — "" = now; else backdated Bangkok "YYYY-MM-DDTHH:MM"
  const [sellBusy, setSellBusy] = useState(false);
  const sellBusyRef = useRef(false);
  // presetSku: opened from the Product Finder with an already-confirmed product —
  // start the cart with it so staff never re-search (and can't re-pick the wrong SKU).
  const [cart, setCart] = useState(() => {
    const p = presetSku && PRODUCTS.find(x => x.sku === presetSku);
    return p ? [{ type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: defaultPickLoc(p), qty: 1 }] : [];
  });
  const [q, setQ] = useState("");
  const [ship, setShipState] = useState({
    name: "", phone: "", addr1: "", addr2: "",
    tambon: "", amphoe: "", province: "", postal: "",
    carrier: "KEX", cod: false, codAmt: "", notes: ""
  });
  const setShip = (k, v) => setShipState(s => ({ ...s, [k]: v }));

  const [stockKey, setStockKey] = useState(0);
  useEffect(() => {
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

  const bundles = useMemo(() => (typeof loadBundles === "function" ? loadBundles() : []), [stockKey]);
  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));
  const bMax = (b) => (typeof bundleAvail === "function" ? bundleAvail(b) : 0);

  const liveProducts = useMemo(() => {
    const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
    return PRODUCTS.map(p => ({ ...p, qty: Math.max(0, p.qty + (adj[p.sku] || 0)) }));
  }, [stockKey]);

  const qL = q.toLowerCase();
  const prodMatches = liveProducts.filter(p =>
    !q || p.sku.toLowerCase().includes(qL) || p.name.toLowerCase().includes(qL) || p.cat.toLowerCase().includes(qL)
  );
  const bundleMatches = bundles.filter(b =>
    !q || b.name.toLowerCase().includes(qL) || b.id.toLowerCase().includes(qL)
  );

  const cartTotal = cart.reduce((s, i) => s + i.qty, 0);
  const cartValue = cart.reduce((s, i) => s + (i.price || 0) * i.qty, 0);

  const addProduct = (p) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.type === "product" && i.sku === p.sku);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: defaultPickLoc(p), qty: 1 }];
    });
  };

  const addBundle = (b) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.type === "bundle" && i.id === b.id);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, { type: "bundle", id: b.id, name: b.name, price: b.price, items: b.items, qty: 1 }];
    });
  };

  const removeItem = (idx) => setCart(prev => prev.filter((_, i) => i !== idx));
  const updateQty = (idx, qty) => {
    if (qty <= 0) { removeItem(idx); return; }
    setCart(prev => { const n = [...prev]; n[idx] = { ...n[idx], qty }; return n; });
  };
  // Which shelf this line is taken from (split products only).
  const updateLoc = (idx, loc) => setCart(prev => { const n = [...prev]; n[idx] = { ...n[idx], loc }; return n; });

  const cartErrors = cart.map(item => {
    const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
    if (item.qty > avail) return `${item.name}: ต้องการ ${item.qty} แต่มีเพียง ${avail}`;
    return null;
  }).filter(Boolean);

  const shipValid = ship.name.trim() && ship.phone.trim() && ship.addr1.trim();

  /* Synchronous double-submit latch. A state flag is NOT enough here: this
     handler awaits applyLocPicks (a network round-trip) before the modal
     closes, so the button sits there live and unchanged for as long as the
     connection takes — and a second tap during that gap deducted the whole cart
     again. A ref flips before React can re-render. */
  const submitOrder = async () => {
    if (sellBusyRef.current) return;
    sellBusyRef.current = true;
    setSellBusy(true);
    const allDeductions = [];
    // Which shelf each sku comes off. Kept BESIDE the deduction, never inside it:
    // dbDeductStock rebuilds entries as {sku,qty} and the offline queue replays that.
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
    deductManyAndPersist(allDeductions, "ขายสินค้า · " + (ship.name || "ลูกค้าใหม่"));
    // Same tick, before any other await: applyLocPicks re-reads the just-written qty.
    if (typeof applyLocPicks === "function") {
      const locRes = await applyLocPicks(locPicks);
      const toast = (m) => { try { window.dispatchEvent(new CustomEvent("ims-toast", { detail: m })); } catch (e) {} };
      if (locRes && locRes.offline) toast("ตัดสต็อกแล้ว — จำนวนตามตำแหน่งจะอัปเดตเมื่อออนไลน์");
      else if (locRes && locRes.errors && locRes.errors.length) toast("ตัดสต็อกสำเร็จ แต่ปรับตำแหน่งไม่สำเร็จ: " + locRes.errors[0].error);
    }

    const orderId = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
    const stamp = (typeof stockOutStamp === "function") ? stockOutStamp(when) : null;
    const createdAt = stamp && stamp.backdated ? stamp.createdAt : undefined;
    const ts = stamp ? stamp.ts : new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const hasBundle = cart.some(i => i.type === "bundle");

    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", action: "create",
        summary: `ขายสินค้า ${cart.length} รายการ → ${ship.name} (${ship.carrier})`,
        count: cartTotal,
        changes: cart.map(item => ({
          label: item.type === "bundle" ? `ชุด: ${item.name}` : item.name,
          to: `−${item.qty} ${item.type === "bundle" ? "ชุด" : "ชิ้น"}`
        })),
        note: `ผู้รับ: ${ship.name} · ${ship.addr1} · ${ship.carrier}${createdAt ? ` · ย้อนหลัง ${stockOutStampLabel(stamp)}` : ""}`
      });
    }

    const order = {
      id: orderId,
      channel: "ขายตรง",
      customer: ship.name,
      items: cart.length,
      status: "picking",
      carrier: ship.carrier,
      tracking: "",
      ts,
      dateIso: stamp ? stamp.dateIso : ((typeof todayIso === "function") ? todayIso() : new Date().toISOString().slice(0, 10)),
      ...(createdAt ? { createdAt } : {}),
      deductions: [{ id: "direct", name: "ขายตรง", color: "#8B5CF6", qty: cartTotal }],
      isSellOrder: true,
      isBundle: hasBundle,
      bundleName: hasBundle ? cart.filter(i => i.type === "bundle").map(i => i.name).join(", ") : undefined,
      shippingAddr: [ship.addr1, ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "),
      phone: ship.phone,
      codAmount: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
      lineItems: cart.flatMap(item => item.type === "product"
        ? [snapLineItem(item.sku, item.name, item.qty)]
        : item.items.map(ci => snapLineItem(ci.sku, null, ci.qty * item.qty))
      )
    };
    // Persist the order directly (single-row optimistic write + DB upsert,
    // offline-queued on failure). Replaces the old __pendingSellOrders +
    // ims-sell-order handoff, which silently dropped the order row if the
    // Outbound screen was never mounted afterwards.
    if (typeof appendOrder === "function") appendOrder(order);

    // Also create the shipping label so the sale shows in ติดตามพัสดุ (labels are
    // the shipment source of truth there) — mirrors the mobile sell flow.
    if (typeof createSaleLabel === "function") {
      try {
        createSaleLabel({
          orderId,
          name: ship.name,
          phone: ship.phone,
          addr1: ship.addr1,
          addr2: ship.addr2,
          tambon: ship.tambon, amphoe: ship.amphoe, province: ship.province, postal: ship.postal,
          carrier: ship.carrier,
          cod: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
          items: order.lineItems,
          created_at: createdAt,
        });
      } catch (e) {}
    }

    if (typeof onSellComplete === "function") {
      onSellComplete({ orderId, customerName: ship.name, itemCount: cart.length, cartValue });
    }
  };

  const STEPS = ["เลือกสินค้า", "ข้อมูลจัดส่ง", "ยืนยัน"];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ maxWidth: 700, maxHeight: "92vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3><Icons.Cart size={16} style={{ verticalAlign: "middle", marginRight: 6 }}/>ขายสินค้า</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>เพิ่มสินค้าหรือชุดสินค้า กรอกข้อมูลจัดส่ง แล้วยืนยัน</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: "0 24px 16px", display: "flex", alignItems: "center" }}>
          {STEPS.map((label, i) => (
            <React.Fragment key={i}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 999, flexShrink: 0,
                  background: step > i + 1 ? "var(--success)" : step === i + 1 ? "var(--accent)" : "var(--surface-3)",
                  color: step >= i + 1 ? "white" : "var(--muted)",
                  display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600
                }}>
                  {step > i + 1 ? <Icons.Check size={11}/> : i + 1}
                </div>
                <span style={{ fontSize: 12, fontWeight: step === i + 1 ? 600 : 400, color: step === i + 1 ? "var(--fg)" : "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: step > i + 1 ? "var(--success)" : "var(--border)", margin: "0 10px" }}/>}
            </React.Fragment>
          ))}
        </div>

        <div className="modal-body">

          {/* ─── STEP 1: CART ─── */}
          {step === 1 && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="search">
                <Icons.Search size={14}/>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา SKU, ชื่อ, ชุดสินค้า..."/>
                {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}><Icons.X size={12}/></span>}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Products */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 300 }}>
                  <div style={{ padding: "7px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", flexShrink: 0 }}>
                    สินค้าเดี่ยว ({prodMatches.length})
                  </div>
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {prodMatches.map(p => {
                      const s = stockStatus(p);
                      const inCart = cart.find(i => i.type === "product" && i.sku === p.sku);
                      return (
                        <div key={p.sku} onClick={() => addProduct(p)}
                          style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: inCart ? "var(--accent-soft)" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                            <div className="row" style={{ gap: 5, marginTop: 2 }}>
                              <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{p.sku}</span>
                              <span style={{ fontSize: 10, color: "var(--muted)" }}>฿{p.price.toLocaleString()}</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div className="tnum" style={{ fontSize: 12, fontWeight: 600 }}>{p.qty}</div>
                            <span className={"badge " + s.cls} style={{ fontSize: 9, padding: "1px 5px" }}>{s.label}</span>
                          </div>
                          {inCart && <div style={{ width: 17, height: 17, borderRadius: 999, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{inCart.qty}</div>}
                        </div>
                      );
                    })}
                    {prodMatches.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่พบสินค้า</div>}
                  </div>
                </div>

                {/* Bundles */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 300 }}>
                  <div style={{ padding: "7px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)", flexShrink: 0 }}>
                    <span className="row" style={{ gap: 5 }}><Icons.Bundle size={11}/>ชุดสินค้า ({bundleMatches.length})</span>
                  </div>
                  <div style={{ overflowY: "auto", flex: 1 }}>
                    {bundleMatches.map(b => {
                      const avail = bMax(b);
                      const inCart = cart.find(i => i.type === "bundle" && i.id === b.id);
                      return (
                        <div key={b.id} onClick={() => avail > 0 && addBundle(b)}
                          style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", cursor: avail > 0 ? "pointer" : "not-allowed", opacity: avail === 0 ? 0.5 : 1, background: inCart ? "var(--accent-soft)" : "transparent", display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</div>
                            <div className="row" style={{ gap: 5, marginTop: 2 }}>
                              <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{b.id}</span>
                              <span style={{ fontSize: 10, color: "var(--muted)" }}>฿{b.price.toLocaleString()}</span>
                              <span style={{ fontSize: 10, color: "var(--muted)" }}>{b.items.length} ชิ้น/ชุด</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div className="tnum" style={{ fontSize: 12, fontWeight: 600, color: avail === 0 ? "var(--danger)" : "var(--fg)" }}>{avail}</div>
                            <span className={"badge " + (avail === 0 ? "badge-warning" : "badge-success")} style={{ fontSize: 9, padding: "1px 5px" }}>{avail === 0 ? "หมด" : "พร้อม"}</span>
                          </div>
                          {inCart && <div style={{ width: 17, height: 17, borderRadius: 999, background: "var(--accent)", color: "white", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{inCart.qty}</div>}
                        </div>
                      );
                    })}
                    {bundleMatches.length === 0 && (
                      <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                        {bundles.length === 0 ? "ยังไม่มีชุดสินค้า — สร้างได้ที่หน้าชุดสินค้า" : "ไม่พบชุดสินค้า"}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Cart */}
              {cart.length > 0 ? (
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "7px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>ตะกร้า ({cart.length} รายการ)</span>
                    <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>฿{cartValue.toLocaleString()}</span>
                  </div>
                  {cart.map((item, idx) => {
                    const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
                    const over = item.qty > avail;
                    return (
                      <div key={idx} style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, background: over ? "var(--danger-soft)" : "transparent" }}>
                        {item.type === "bundle" && <Icons.Bundle size={13} style={{ color: "var(--info)", flexShrink: 0 }}/>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: over ? "var(--danger)" : "var(--muted)", marginTop: 1 }}>
                            {over ? `มีเพียง ${avail} ${item.type === "bundle" ? "ชุด" : "ชิ้น"}` : `฿${(item.price * item.qty).toLocaleString()}`}
                          </div>
                          {item.type === "product" && (
                            <LocPickSelect sku={item.sku} value={item.loc} need={item.qty} onChange={loc => updateLoc(idx, loc)}/>
                          )}
                        </div>
                        <div className="qty-stepper">
                          <button onClick={() => updateQty(idx, item.qty - 1)}>−</button>
                          <input value={item.qty} onChange={e => updateQty(idx, parseInt(e.target.value) || 0)}/>
                          <button onClick={() => updateQty(idx, item.qty + 1)}>+</button>
                        </div>
                        <button className="btn btn-ghost btn-icon" style={{ color: "var(--danger)" }} onClick={() => removeItem(idx)}>
                          <Icons.Trash size={13}/>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ padding: 22, textAlign: "center", color: "var(--muted)", fontSize: 13, background: "var(--surface-2)", borderRadius: 12, border: "1px dashed var(--border)" }}>
                  <Icons.Cart size={22} style={{ opacity: 0.35, marginBottom: 8 }}/>
                  <div>คลิกสินค้าด้านบนเพื่อเพิ่มในตะกร้า</div>
                </div>
              )}

              {cartErrors.length > 0 && (
                <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 12 }}>
                  <div className="row" style={{ gap: 6, fontWeight: 600, marginBottom: 4 }}><Icons.Warn size={13}/>สต็อกไม่พอ</div>
                  {cartErrors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 2: SHIPPING ─── */}
          {step === 2 && (
            <div className="stack" style={{ gap: 14 }}>
              <div className="field">
                <label>ชื่อผู้รับ <span style={{ color: "var(--danger)" }}>*</span></label>
                <input className="input" value={ship.name} onChange={e => setShip("name", e.target.value)} placeholder="เช่น คุณ สมศรี ใจดี"/>
              </div>
              <div className="field">
                <label>เบอร์โทรศัพท์ <span style={{ color: "var(--danger)" }}>*</span></label>
                <input className="input" type="tel" value={ship.phone} onChange={e => setShip("phone", e.target.value)} placeholder="เช่น 089-123-4567"/>
              </div>
              <div className="field">
                <label>ที่อยู่ <span style={{ color: "var(--danger)" }}>*</span></label>
                <input className="input" value={ship.addr1} onChange={e => setShip("addr1", e.target.value)} placeholder="บ้านเลขที่ ถนน ซอย หมู่บ้าน"/>
              </div>
              <div className="field">
                <label>ที่อยู่เพิ่มเติม</label>
                <input className="input" value={ship.addr2} onChange={e => setShip("addr2", e.target.value)} placeholder="อาคาร ชั้น ห้อง (ถ้ามี)"/>
              </div>
              <ThaiAddrAutocomplete
                value={{ tambon: ship.tambon, amphoe: ship.amphoe, province: ship.province, postal: ship.postal }}
                onChange={(partial) => setShipState(s => ({ ...s, ...partial }))}
              />
              <div className="field">
                <label>บริษัทขนส่ง</label>
                {(() => {
                  const CARRIERS = ["KEX","Flash Express","J&T Express","ไปรษณีย์ไทย","Ninja Van","DHL","Best Express","SCG Express","Alpha Fast","Lalamove"];
                  const isOther = !CARRIERS.includes(ship.carrier);
                  return (
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {CARRIERS.map(c => {
                          const on = ship.carrier === c;
                          return (
                            <button key={c} type="button"
                              onClick={() => setShip("carrier", c)}
                              style={{
                                padding: "5px 12px", borderRadius: 999, fontSize: 12,
                                cursor: "pointer", userSelect: "none", lineHeight: 1.4,
                                border: "1px solid " + (on ? "var(--fg)" : "var(--border)"),
                                background: on ? "var(--fg)" : "transparent",
                                color: on ? "var(--surface)" : "var(--fg-2)",
                                fontWeight: on ? 500 : 400,
                                transition: "background 0.1s, color 0.1s, border-color 0.1s",
                              }}
                            >{c}</button>
                          );
                        })}
                        <button type="button"
                          onClick={() => { if (!isOther) setShip("carrier", ""); }}
                          style={{
                            padding: "5px 12px", borderRadius: 999, fontSize: 12,
                            cursor: "pointer", userSelect: "none", lineHeight: 1.4,
                            border: "1px solid " + (isOther ? "var(--fg)" : "var(--border)"),
                            background: isOther ? "var(--fg)" : "transparent",
                            color: isOther ? "var(--surface)" : "var(--fg-2)",
                            fontWeight: isOther ? 500 : 400,
                            transition: "background 0.1s, color 0.1s, border-color 0.1s",
                          }}
                        >อื่นๆ</button>
                      </div>
                      {isOther && (
                        <input className="input" autoFocus value={ship.carrier}
                          onChange={e => setShip("carrier", e.target.value)}
                          placeholder="ระบุชื่อบริษัทขนส่ง เช่น TP Logistics"
                          style={{ marginTop: 8 }}/>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--surface-2)", borderRadius: 10, cursor: "pointer", border: "1px solid " + (ship.cod ? "var(--accent)" : "var(--border)") }}
                onClick={() => setShip("cod", !ship.cod)}
              >
                <span className={"check" + (ship.cod ? " on" : "")}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>เก็บเงินปลายทาง (COD)</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>ลูกค้าชำระเมื่อรับสินค้า</div>
                </div>
                {ship.cod && (
                  <input
                    className="input"
                    type="number"
                    style={{ width: 130, textAlign: "right" }}
                    value={ship.codAmt}
                    placeholder="฿ จำนวน COD"
                    onChange={e => { e.stopPropagation(); setShip("codAmt", e.target.value); }}
                    onClick={e => e.stopPropagation()}
                  />
                )}
              </div>
              <div className="field">
                <label>หมายเหตุ</label>
                <input className="input" value={ship.notes} onChange={e => setShip("notes", e.target.value)} placeholder="เช่น วางหน้าบ้าน, โทรก่อนส่ง..."/>
              </div>
            </div>
          )}

          {/* ─── STEP 3: CONFIRM ─── */}
          {step === 3 && (
            <div className="stack" style={{ gap: 14 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "8px 14px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>
                  สินค้าในออร์เดอร์
                </div>
                {cart.map((item, idx) => (
                  <div key={idx} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                    {item.type === "bundle" && <Icons.Bundle size={13} style={{ color: "var(--info)", flexShrink: 0 }}/>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{item.name}</div>
                      {item.type === "bundle" && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{item.items.length} ชิ้นต่อชุด</div>}
                    </div>
                    <span className="tnum" style={{ fontSize: 13, color: "var(--fg-2)" }}>×{item.qty}</span>
                    <span className="tnum" style={{ fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "right" }}>฿{(item.price * item.qty).toLocaleString()}</span>
                  </div>
                ))}
                <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", background: "var(--surface-2)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>รวมทั้งหมด</span>
                  <span className="tnum" style={{ fontSize: 16, fontWeight: 700 }}>฿{cartValue.toLocaleString()}</span>
                </div>
              </div>

              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 10 }}>ข้อมูลการจัดส่ง</div>
                <div className="stack" style={{ gap: 8, fontSize: 13 }}>
                  {[
                    ["ผู้รับ",     ship.name,      true],
                    ["โทร",       ship.phone,     false],
                    ["ที่อยู่",    [ship.addr1, ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "), false],
                    ["ขนส่ง",     ship.carrier,   false],
                    ship.cod ? ["COD", `฿${parseFloat(ship.codAmt || 0).toLocaleString()}`, false] : null,
                    ship.notes ? ["หมายเหตุ", ship.notes, false] : null
                  ].filter(Boolean).map(([label, val, bold]) => (
                    <div key={label} className="row" style={{ justifyContent: "space-between", gap: 16 }}>
                      <span style={{ color: "var(--muted)", flexShrink: 0 }}>{label}</span>
                      <span style={{ fontWeight: bold ? 600 : 400, textAlign: "right" }}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <StockOutWhenField value={when} onChange={setWhen} label="วันเวลาที่ขาย" style={{ marginBottom: 0 }}
                hint="ขายย้อนหลัง? เลือกวันเวลาที่ขายจริง — ออร์เดอร์และยอดขายจะนับเป็นวันนั้น"/>

              <div style={{ padding: "12px 14px", background: "var(--info-soft)", borderRadius: 10, fontSize: 12, color: "var(--info)" }}>
                <div className="row" style={{ gap: 6, fontWeight: 600, marginBottom: 4 }}><Icons.Check size={13}/>พร้อมยืนยัน</div>
                <div>การยืนยันจะตัดสต็อกทันที และสร้างออร์เดอร์ใหม่ในหน้าจัดส่ง</div>
              </div>
            </div>
          )}

        </div>

        <div className="modal-foot">
          {step === 1 && <>
            <button className="btn" onClick={onClose}>ยกเลิก</button>
            <button className="btn btn-primary"
              disabled={cart.length === 0 || cartErrors.length > 0}
              onClick={() => setStep(2)}
              style={cart.length === 0 || cartErrors.length > 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
              ข้อมูลจัดส่ง <Icons.Chev size={14}/>
            </button>
          </>}
          {step === 2 && <>
            <button className="btn" onClick={() => setStep(1)}>
              <Icons.ArrowRight size={14} style={{ transform: "rotate(180deg)" }}/> ย้อนกลับ
            </button>
            <button className="btn btn-primary"
              disabled={!shipValid}
              onClick={() => setStep(3)}
              style={!shipValid ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
              ยืนยันออร์เดอร์ <Icons.Chev size={14}/>
            </button>
          </>}
          {step === 3 && <>
            <button className="btn" onClick={() => setStep(2)}>
              <Icons.ArrowRight size={14} style={{ transform: "rotate(180deg)" }}/> ย้อนกลับ
            </button>
            <button className="btn btn-primary" disabled={sellBusy} onClick={submitOrder}
              style={sellBusy ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
              <Icons.Check size={14}/> ยืนยันการขาย
            </button>
          </>}
        </div>
      </div>
    </>
  );
}

/* ========= STOCK TAKE / CYCLE COUNT (desktop) ========= */
function StockTake({ pushToast }) {
  const [counts, setCounts] = useState(loadStockTake);   // { sku: "12" }
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [onlyCounted, setOnlyCounted] = useState(false);
  const [scan, setScan] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const scanRef = useRef(null);

  useEffect(() => {
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

  const cats = useMemo(() => ["all", ...Array.from(new Set(PRODUCTS.map(p => p.cat).filter(Boolean)))], [tick]);

  const rows = useMemo(() => {
    const lq = q.trim().toLowerCase();
    return PRODUCTS.filter(p => {
      if (cat !== "all" && p.cat !== cat) return false;
      if (onlyCounted && counts[p.sku] === undefined) return false;
      if (!lq) return true;
      return p.sku.toLowerCase().includes(lq) || (p.name || "").toLowerCase().includes(lq);
    });
  }, [q, cat, onlyCounted, counts, tick]);

  const summary = useMemo(() => {
    let counted = 0, over = 0, short = 0, net = 0;
    Object.keys(counts).forEach(sku => {
      const p = PRODUCTS.find(x => x.sku === sku);
      if (!p || counts[sku] === "") return;
      counted++;
      const v = (parseInt(counts[sku], 10) || 0) - p.qty;
      if (v > 0) over++; else if (v < 0) short++;
      net += v;
    });
    return { counted, over, short, net, discrepancies: over + short };
  }, [counts, tick]);

  const changeList = useMemo(() => {
    const list = [];
    Object.keys(counts).forEach(sku => {
      const p = PRODUCTS.find(x => x.sku === sku);
      if (!p || counts[sku] === "") return;
      const to = parseInt(counts[sku], 10) || 0;
      if (to !== p.qty) list.push({ sku, name: p.name, from: p.qty, to, delta: to - p.qty });
    });
    return list;
  }, [counts, tick]);

  const submitScan = (override) => {
    const code = (override ?? scan).trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase());
    setScan("");
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); pushToast(`ไม่พบ SKU: ${code}`); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    const cur = parseInt(counts[p.sku] || "0", 10) || 0;
    setCount(p.sku, cur + 1);
    setQ(p.sku);
    if (scanRef.current) scanRef.current.focus();
  };

  const fillSystem = () => {
    setCounts(prev => {
      const next = { ...prev };
      rows.forEach(p => { next[p.sku] = String(p.qty); });
      saveStockTake(next);
      return next;
    });
  };

  const clearAll = () => {
    if (!Object.keys(counts).length) return;
    if (!confirm("ล้างผลการนับทั้งหมด?")) return;
    setCounts({}); saveStockTake({});
  };

  const apply = () => {
    // Same duplicate-commit latch as รับเข้า: applying a count is destructive
    // (it SETS qty), so running it twice on a double-click hid a real movement
    // that happened in between the two runs.
    const guardKey = (typeof commitFingerprint === "function")
      ? commitFingerprint("stocktake-apply", changeList) : null;
    if (guardKey && typeof claimCommit === "function" && !claimCommit(guardKey)) {
      if (typeof duplicateCommitToast === "function") duplicateCommitToast();
      // The identical count DID just apply (that is what the latch matched), so
      // retire the sheet instead of leaving numbers that invite a third attempt.
      setCounts({}); saveStockTake({});
      setConfirmOpen(false);
      return;
    }
    const changes = (typeof applyStockCounts === "function") ? applyStockCounts(counts) : [];
    const net = changes.reduce((s, c) => s + c.delta, 0);
    if (typeof recordChange === "function" && changes.length) {
      recordChange({
        entity: "product", action: "update",
        summary: `ตรวจนับสต็อก — ปรับ ${changes.length} SKU (สุทธิ ${net >= 0 ? "+" : ""}${net} ชิ้น)`,
        count: changes.length,
        changes: changes.map(c => ({ label: c.sku, to: `${c.from} → ${c.to} ชิ้น (${c.delta >= 0 ? "+" : ""}${c.delta})` }))
      });
    }
    setCounts({}); saveStockTake({});
    setConfirmOpen(false);
    pushToast(changes.length ? `ปรับสต็อกแล้ว ${changes.length} SKU` : "ไม่มีส่วนต่าง — สต็อกตรงกับระบบ");
  };

  const exportCsv = () => {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = PRODUCTS.filter(p => counts[p.sku] !== undefined && counts[p.sku] !== "").map(p => {
      const c = parseInt(counts[p.sku], 10) || 0; return [p.sku, p.name, p.qty, c, c - p.qty].map(esc).join(",");
    });
    const csv = ["SKU,สินค้า,ระบบ,นับได้,ส่วนต่าง", ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `stocktake-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ตรวจนับสต็อก</h1>
          <div className="page-sub">นับสินค้าจริงเทียบกับระบบ แล้วปรับให้ตรง — สแกนหรือกรอกจำนวนที่นับได้</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canDo("exportData") && <button className="btn" onClick={exportCsv} disabled={!summary.counted}><Icons.Pkg size={14}/> ส่งออก CSV</button>}
          <button className="btn btn-accent" onClick={() => setConfirmOpen(true)} disabled={!changeList.length}>
            <Icons.Check size={14}/> บันทึกผลการนับ{changeList.length ? ` (${changeList.length})` : ""}
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label">นับแล้ว</div><div className="kpi-value">{summary.counted}<span style={{ fontSize: 14, color: "var(--muted)" }}> / {PRODUCTS.length}</span></div><div className="kpi-delta">SKU</div></div>
        <div className="kpi"><div className="kpi-label">ส่วนต่าง</div><div className="kpi-value" style={{ color: summary.discrepancies ? "var(--warning)" : "var(--success)" }}>{summary.discrepancies}</div><div className="kpi-delta">{summary.over} เกิน · {summary.short} ขาด</div></div>
        <div className="kpi"><div className="kpi-label">สุทธิ (ชิ้น)</div><div className="kpi-value" style={{ color: summary.net > 0 ? "var(--info)" : summary.net < 0 ? "var(--danger)" : "var(--fg)" }}>{summary.net > 0 ? "+" : ""}{summary.net}</div><div className="kpi-delta">เทียบกับระบบ</div></div>
        <div className="kpi"><div className="kpi-label">ยังไม่นับ</div><div className="kpi-value">{PRODUCTS.length - summary.counted}</div><div className="kpi-delta">SKU</div></div>
      </div>

      <div className="scan-zone" style={{ padding: 18 }}>
        <div className="scan-input-wrap">
          <Icons.Scan size={22} className="scan-icon"/>
          <input ref={scanRef} value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submitScan(); }} placeholder="สแกนบาร์โค้ด / พิมพ์ SKU แล้ว Enter เพื่อ +1"/>
        </div>
      </div>

      <div className="card card-tight">
        <div className="card-head">
          <div className="row" style={{ gap: 10, flex: 1, flexWrap: "wrap" }}>
            <div className="search" style={{ width: 260 }}>
              <Icons.Search size={14}/>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหา SKU หรือชื่อสินค้า..."/>
            </div>
            <select className="input" style={{ width: 150 }} value={cat} onChange={e => setCat(e.target.value)}>
              {cats.map(c => <option key={c} value={c}>{c === "all" ? "ทุกหมวด" : c}</option>)}
            </select>
            <button className={"btn btn-sm" + (onlyCounted ? " btn-accent" : "")} onClick={() => setOnlyCounted(v => !v)}>เฉพาะที่นับแล้ว</button>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm" onClick={fillSystem}>ตั้ง = ระบบ</button>
            <button className="btn btn-sm btn-danger" onClick={clearAll}>ล้าง</button>
          </div>
        </div>
        <table className="t">
          <thead><tr>
            <th>สินค้า</th>
            <th className="t-num">ระบบ</th>
            <th className="t-num" style={{ width: 120 }}>นับได้</th>
            <th className="t-num">ส่วนต่าง</th>
            <th style={{ width: 96 }}>สถานะ</th>
          </tr></thead>
          <tbody>
            {rows.map(p => {
              const raw = counts[p.sku];
              const has = raw !== undefined && raw !== "";
              const c = has ? (parseInt(raw, 10) || 0) : null;
              const v = has ? c - p.qty : null;
              const tone = v === null ? "var(--muted)" : v === 0 ? "var(--success)" : v > 0 ? "var(--info)" : "var(--danger)";
              return (
                <tr key={p.sku} style={{ background: (v !== null && v !== 0) ? "var(--warning-soft)" : undefined }}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <ProductImageThumb sku={p.sku} size={30} radius={6}/>
                      <div>
                        <div style={{ fontSize: 13 }}>{p.name}</div>
                        <div className="t-mono" style={{ marginTop: 2 }}>{p.sku} · {p.cat}</div>
                      </div>
                    </div>
                  </td>
                  <td className="t-num tnum" style={{ color: "var(--muted)" }}>{p.qty}</td>
                  <td className="t-num">
                    <input className="input" style={{ width: 90, textAlign: "right", padding: "6px 8px" }} type="number" min="0"
                           value={raw ?? ""} onChange={e => setCount(p.sku, e.target.value)} placeholder="—"/>
                  </td>
                  <td className="t-num tnum" style={{ color: tone, fontWeight: 600 }}>{v === null ? "—" : (v > 0 ? "+" + v : v)}</td>
                  <td>
                    {!has ? <span className="badge badge-neutral">ยังไม่นับ</span>
                      : v === 0 ? <span className="badge badge-success"><span className="dot"/>ตรงกัน</span>
                      : v > 0 ? <span className="badge badge-info"><span className="dot"/>เกิน</span>
                      : <span className="badge badge-danger"><span className="dot"/>ขาด</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan="5" style={{ textAlign: "center", color: "var(--muted)", padding: 30 }}>ไม่พบสินค้า</td></tr>}
          </tbody>
        </table>
      </div>

      {confirmOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => setConfirmOpen(false)}/>
          <div className="modal">
            <div className="modal-head"><h3>ยืนยันปรับสต็อกตามผลการนับ</h3><button className="btn btn-icon btn-ghost" onClick={() => setConfirmOpen(false)}><Icons.X size={16}/></button></div>
            <div className="modal-body">
              <div className="page-sub" style={{ marginBottom: 12 }}>จะปรับ {changeList.length} SKU ให้ตรงกับจำนวนที่นับได้ — บันทึกในประวัติการแก้ไข</div>
              <div className="stack" style={{ gap: 6, maxHeight: 340, overflowY: "auto" }}>
                {changeList.map(c => (
                  <div key={c.sku} className="row" style={{ justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <div><div style={{ fontSize: 13 }}>{c.name}</div><div className="t-mono">{c.sku}</div></div>
                    <div className="tnum" style={{ fontWeight: 600 }}>{c.from} → {c.to} <span style={{ color: c.delta > 0 ? "var(--info)" : "var(--danger)" }}>({c.delta > 0 ? "+" : ""}{c.delta})</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setConfirmOpen(false)}>ยกเลิก</button>
              <button className="btn btn-accent" onClick={apply}><Icons.Check size={14}/> ยืนยันปรับ {changeList.length} SKU</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* =============== PRODUCT FINDER (ค้นหาสินค้า) ===============
   Staff visual lookup: search or scan a barcode → big product photo + storage
   position (with the bin photo), confirm it's the right item, then sell it —
   the anti-mistake funnel for picking / deducting stock. Mobile fork: MFinder
   in handheld.jsx. */
function ProductFinder({ pushToast, goTo, focus }) {
  const [q, setQ] = useState("");
  const [selectedSku, setSelectedSku] = useState(null);
  const [camOpen, setCamOpen] = useState(false);
  const [sellSku, setSellSku] = useState(null);
  const [stockKey, setStockKey] = useState(0);
  const inputRef = useRef(null);
  const images = useProductImages();
  const locImages = useLocationImages();

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const refresh = () => setStockKey(k => k + 1);
    const evs = ["ims-products-change", "ims-stock-adj-change", "ims-locations-change"];
    evs.forEach(ev => window.addEventListener(ev, refresh));
    return () => evs.forEach(ev => window.removeEventListener(ev, refresh));
  }, []);
  // Arrived here with a specific SKU (goTo("finder", { sku })) → show its card.
  useEffect(() => {
    if (focus && focus.sku) { setQ(focus.sku); setSelectedSku(focus.sku); }
  }, [focus && focus.n]);

  const effQty = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));
  const res = useMemo(
    () => (typeof searchProductsForLocation === "function" ? searchProductsForLocation(q, 24) : { hits: [], total: 0 }),
    [q, stockKey]
  );

  const canSell = canDo("sell");

  // Camera + keyboard-wedge funnel: exact SKU (= barcode) → jump straight to the
  // confirmation card; a miss beeps so the picker knows the scan didn't land.
  const resolveScan = (code) => {
    const s = String(code || "").trim();
    setCamOpen(false);
    if (!s) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === s.toLowerCase());
    if (!p) { if (typeof playScanErrorBeep === "function") playScanErrorBeep(); pushToast("ไม่พบสินค้า: " + s); return; }
    if (typeof playScanBeep === "function") playScanBeep();
    setQ(p.sku);
    setSelectedSku(p.sku);
  };
  const onSearchEnter = () => {
    const exact = PRODUCTS.find(x => x.sku.toLowerCase() === q.trim().toLowerCase());
    if (exact) { setSelectedSku(exact.sku); return; }
    if (res.hits.length === 1) setSelectedSku(res.hits[0].sku);
  };

  const selected = selectedSku ? PRODUCTS.find(p => p.sku === selectedSku) : null;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ค้นหาสินค้า</h1>
          <div className="page-sub">ค้นหาด้วยชื่อ / SKU / สแกนบาร์โค้ด — เห็นรูปสินค้าและตำแหน่งจัดเก็บก่อนหยิบ ตัดสต็อก หรือขาย</div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div className="row" style={{ gap: 10 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
            <Icons.Search size={16} style={{ color: "var(--muted)", flexShrink: 0 }}/>
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") onSearchEnter(); }}
              placeholder="พิมพ์ชื่อสินค้า / SKU หรือยิงบาร์โค้ดด้วยเครื่องสแกน..."
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: "var(--fg)", fontFamily: "inherit" }}
            />
            {q && <button className="btn btn-ghost btn-icon" title="ล้างคำค้น" onClick={() => { setQ(""); inputRef.current?.focus(); }}><Icons.X size={14}/></button>}
          </div>
          <button className="btn" onClick={() => setCamOpen(true)}><Icons.Camera size={14}/> สแกนด้วยกล้อง</button>
        </div>
      </div>

      {!q.trim() ? (
        <div className="card" style={{ padding: "56px 24px", textAlign: "center", color: "var(--muted)" }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-soft, var(--surface-2))", color: "var(--accent)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <Icons.Search size={26}/>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>ค้นหาเพื่อยืนยันสินค้าก่อนหยิบ</div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>พิมพ์ชื่อหรือ SKU หรือสแกนบาร์โค้ด แล้วระบบจะแสดง<br/>รูปสินค้า สต็อกคงเหลือ และตำแหน่งจัดเก็บ เพื่อไม่ให้หยิบผิดตัว</div>
        </div>
      ) : res.hits.length === 0 ? (
        <div className="card" style={{ padding: "44px 24px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
          ไม่พบสินค้า "{q}"
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
            {res.hits.map(p => {
              const eq = effQty(p.sku);
              const st = stockStatus({ ...p, qty: eq });
              const parts = ((h) => h ? locParts(h) : null)(productHomeLoc(p));
              const url = typeof resolveProductImage === "function" ? resolveProductImage(p.sku, images) : "";
              return (
                <div key={p.sku} className="card" onClick={() => setSelectedSku(p.sku)}
                  style={{ padding: 0, overflow: "hidden", cursor: "pointer" }}>
                  <div style={{ aspectRatio: "1 / 1", background: "#fff", borderBottom: "1px solid var(--border)", display: "grid", placeItems: "center", overflow: "hidden" }}>
                    {url
                      ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
                      : <Icons.Box size={40} style={{ color: "var(--muted)", opacity: 0.45 }}/>}
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, minHeight: 36, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.name}</div>
                    <div className="row" style={{ gap: 8, marginTop: 4 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.sku}</span>
                      <span className={"badge " + st.cls} style={{ fontSize: 10, flexShrink: 0, marginLeft: "auto" }}>{eq} ชิ้น</span>
                    </div>
                    <div className="row" style={{ gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>
                      {parts ? (
                        <>
                          <Icons.Map size={13} style={{ color: "var(--accent)", flexShrink: 0 }}/>
                          <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{parts.pos}</span>
                          <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parts.building}{parts.floor ? " · " + parts.floor : ""}</span>
                        </>
                      ) : (
                        <span className="badge badge-warning" style={{ fontSize: 10 }}><Icons.Warn size={10}/> ยังไม่จัดเก็บ</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {res.total > res.hits.length && (
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
              แสดง {res.hits.length} จาก {res.total} รายการ — พิมพ์เพิ่มเพื่อค้นหาให้แคบลง
            </div>
          )}
        </>
      )}

      {/* ── Confirmation card: XL photo + storage position + actions ── */}
      {selected && (() => {
        const p = selected;
        const eq = effQty(p.sku);
        const st = stockStatus({ ...p, qty: eq });
        const avail = Math.max(0, eq - (p.reserved || 0));
        const parts = ((h) => h ? locParts(h) : null)(productHomeLoc(p));
        const locPhoto = productHomeLoc(p) && typeof getLocationImage === "function" ? getLocationImage(productHomeLoc(p), locImages) : "";
        const url = typeof resolveProductImage === "function" ? resolveProductImage(p.sku, images) : "";
        const close = () => setSelectedSku(null);
        return (
          <>
            <div className="drawer-backdrop" onClick={close}/>
            <div className="modal" style={{ maxWidth: 680, maxHeight: "92vh", overflowY: "auto" }}>
              <div className="modal-head">
                <div>
                  <h3>ยืนยันสินค้า</h3>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>ตรวจรูปและตำแหน่งให้ตรงกับของจริงก่อนหยิบ / ขาย</div>
                </div>
                <button className="btn btn-ghost btn-icon" onClick={close}><Icons.X size={16}/></button>
              </div>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 260px) 1fr", gap: 18 }}>
                  <div style={{ aspectRatio: "1 / 1", background: "#fff", border: "1px solid var(--border)", borderRadius: 14, display: "grid", placeItems: "center", overflow: "hidden" }}>
                    {url
                      ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}/>
                      : <Icons.Box size={56} style={{ color: "var(--muted)", opacity: 0.4 }}/>}
                  </div>
                  <div className="stack" style={{ gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.4 }}>{p.name}</div>
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        {p.cat && <span className="badge badge-neutral">{p.cat}</span>}
                        <span className={"badge " + st.cls}><span className="dot"/>{st.label}</span>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, textAlign: "center", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 8px" }}>
                      <div>
                        <div className="tnum" style={{ fontSize: 22, fontWeight: 700 }}>{eq}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>คงเหลือ</div>
                      </div>
                      <div style={{ borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }}>
                        <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: "var(--muted)" }}>{p.reserved || 0}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>จอง</div>
                      </div>
                      <div>
                        <div className="tnum" style={{ fontSize: 22, fontWeight: 700, color: avail > 0 ? "var(--success)" : "var(--danger)" }}>{avail}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>พร้อมขาย</div>
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8, fontSize: 13 }}>
                      <span style={{ color: "var(--muted)" }}>ราคา</span>
                      <span className="tnum" style={{ fontWeight: 700 }}>฿{(p.price || 0).toLocaleString()}</span>
                      <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{p.sku}</span>
                    </div>
                  </div>
                </div>

                {/* Storage position — the "where do I walk to" answer, with the bin photo */}
                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10 }}>ตำแหน่งจัดเก็บ</div>
                  {parts ? (
                    <div className="row" style={{ gap: 14 }}>
                      {locPhoto ? (
                        <img src={locPhoto} alt="" style={{ width: 92, height: 92, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)", flexShrink: 0 }}/>
                      ) : (
                        <div style={{ width: 92, height: 92, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--accent)", flexShrink: 0 }}>
                          <Icons.Map size={30}/>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>{parts.pos}</div>
                        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{parts.building}{parts.floor ? " · " + parts.floor : ""}</div>
                      </div>
                      <button className="btn btn-sm" style={{ alignSelf: "center", flexShrink: 0 }} onClick={() => { if (typeof goTo === "function") goTo("locations"); }}>
                        <Icons.Map size={13}/> ดูผังคลัง
                      </button>
                    </div>
                  ) : (
                    <div className="row" style={{ gap: 10, fontSize: 13, color: "var(--muted)" }}>
                      <span className="badge badge-warning"><Icons.Warn size={11}/> ยังไม่จัดเก็บ</span>
                      <span>กำหนดได้ในหน้าตำแหน่งจัดเก็บ หรือแก้ไขสินค้าในคลัง</span>
                    </div>
                  )}
                </div>

                <div style={{ textAlign: "center", padding: "4px 0 2px" }}>
                  <Barcode value={p.sku} height={44}/>
                  <div className="mono" style={{ fontSize: 12, marginTop: 4, letterSpacing: "0.06em", color: "var(--muted)" }}>{p.sku}</div>
                </div>
              </div>
              <div className="modal-foot">
                <button className="btn" onClick={close}>ปิด</button>
                <div className="spacer"/>
                {canSell && (
                  <button className="btn btn-primary" disabled={avail <= 0} onClick={() => setSellSku(p.sku)}>
                    <Icons.Cart size={14}/> ขายสินค้านี้
                  </button>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {camOpen && <CameraScanner onScan={resolveScan} onClose={() => setCamOpen(false)}/>}

      {sellSku && (
        <SellProductModal
          presetSku={sellSku}
          onClose={() => setSellSku(null)}
          onSellComplete={({ orderId, customerName, itemCount }) => {
            pushToast(`สร้างออร์เดอร์ ${orderId} — ${itemCount} รายการ สำหรับ ${customerName}`);
            setSellSku(null);
            setSelectedSku(null);
            if (typeof goTo === "function") goTo("outbound");
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   แพ็คสินค้า — desktop queue / supervisor view

   The packer's working screen is the MOBILE fork (MPack / MPackOrder /
   MPackWave in handheld.jsx) — that is where tick-off, scanning and the
   shortage flow live, because picking happens on the floor with a phone.
   This desktop screen is deliberately the OTHER half of that job: see the
   queue, see how far each order has got and who is on it, drill into the
   lines, and close orders out from the packing table. It reads the same
   pack helpers, so the two views can never disagree.
   ═══════════════════════════════════════════════════════════════════ */
function PackQueue({ pushToast, goTo, user }) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(null);      // expanded order id
  const [sel, setSel] = useState({});

  useEffect(() => {
    const refresh = () => setTick(t => t + 1);
    ["ims-orders-change", "ims-labels-change", "ims-pack-change", "ims-products-change", "ims-product-locs-change"]
      .forEach(ev => window.addEventListener(ev, refresh));
    return () => ["ims-orders-change", "ims-labels-change", "ims-pack-change", "ims-products-change", "ims-product-locs-change"]
      .forEach(ev => window.removeEventListener(ev, refresh));
  }, []);

  const progress = useMemo(() => (typeof loadPackProgress === "function") ? loadPackProgress() : {}, [tick]);
  const rows = useMemo(() => {
    const q = (typeof packQueue === "function") ? packQueue() : [];
    return q.map(o => {
      const lines = (typeof packLinesForOrder === "function") ? packLinesForOrder(o) : [];
      const totals = (typeof packLineTotals === "function") ? packLineTotals(lines, progress[o.id]) : { need: 0, got: 0, pct: 0, lineCount: 0, lineDone: 0, shortLines: 0, complete: false };
      const shelves = new Set(lines.map(l => l.loc).filter(Boolean));
      const rec = progress[o.id] || null;
      return { o, lines, totals, shelves: shelves.size, rec };
    });
  }, [tick, progress]);

  // Waves in flight, so the table's "why is this order half-picked" is explainable.
  const waves = useMemo(() => Object.keys(progress)
    .filter(k => k.indexOf("batch:") === 0)
    .map(k => ({ id: k, rec: progress[k] })), [progress]);
  const waveOf = useMemo(() => {
    const m = {};
    waves.forEach(w => (w.rec.orderIds || []).forEach(id => { m[id] = w; }));
    return m;
  }, [waves]);

  const selIds = Object.keys(sel).filter(id => sel[id]);
  const totalPieces = rows.reduce((s, r) => s + r.totals.need, 0);
  const started = rows.filter(r => r.rec).length;
  const readyCount = rows.filter(r => r.totals.complete).length;

  const markPacked = (ids) => {
    if (!ids.length) return;
    const notDone = ids.filter(id => { const r = rows.find(x => x.o.id === id); return r && !r.totals.complete; });
    const msg = notDone.length
      ? `ทำเครื่องหมาย "พร้อมส่ง" ${ids.length} ออร์เดอร์?\nมี ${notDone.length} ออร์เดอร์ที่ยังหยิบไม่ครบ`
      : `ทำเครื่องหมาย "พร้อมส่ง" ${ids.length} ออร์เดอร์?`;
    if (!confirm(msg)) return;
    const at = new Date().toISOString();
    const who = (user && user.name) || "";
    ids.forEach(id => {
      if (typeof setOrderField === "function") setOrderField(id, { status: "packed", packedAt: at, packedBy: who });
      if (typeof clearPackEntry === "function") clearPackEntry(id);
    });
    if (typeof recordChange === "function") {
      recordChange({
        entity: "order", action: ids.length > 1 ? "bulk-update" : "update",
        entityId: ids.length === 1 ? ids[0] : undefined,
        summary: `แพ็คสินค้าเสร็จ ${ids.length} ออร์เดอร์ (จากหน้าเดสก์ท็อป)`,
        count: ids.length,
        changes: [{ label: "สถานะ", from: "กำลังจัดเตรียม", to: "พร้อมส่ง" }],
        note: "ออร์เดอร์: " + ids.join(", ")
      });
    }
    setSel({});
    pushToast(`พร้อมส่ง ${ids.length} ออร์เดอร์`);
  };

  const resetProgress = (id) => {
    if (!confirm("ล้างความคืบหน้าการหยิบของออร์เดอร์นี้?")) return;
    if (typeof clearPackEntry === "function") clearPackEntry(id);
    pushToast("ล้างความคืบหน้าแล้ว");
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">แพ็คสินค้า</h1>
          <div className="page-sub">
            รอแพ็ค {rows.length} ออร์เดอร์ · {totalPieces} ชิ้น · กำลังแพ็ค {started}
            {waves.length > 0 ? ` · หยิบรวม ${waves.length} รอบ` : ""}
          </div>
        </div>
        <div className="row">
          {canOpenPage("outbound") && <button className="btn" onClick={() => goTo("outbound")}><Icons.Out size={14}/> จัดส่งสินค้า</button>}
          <span className="badge badge-neutral" title="การหยิบ ติ๊ก และสแกน ทำบนมือถือ"><Icons.Phone size={12}/> หยิบของบนมือถือ: เพิ่มเติม → แพ็คสินค้า</span>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="รอแพ็ค"    value={rows.length}  tone="warning" hint="ออร์เดอร์ที่ตัดสต็อกแล้วรอหยิบ"/>
        <SmallStat label="หยิบครบแล้ว" value={readyCount}   tone="success" hint="พร้อมปิดเป็นพร้อมส่ง"/>
        <SmallStat label="รวมชิ้นที่ต้องหยิบ" value={totalPieces} tone="info" hint="ทุกออร์เดอร์ในคิว"/>
      </div>

      <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--info-soft)", color: "var(--info)", fontSize: 12.5, lineHeight: 1.7 }}>
        <strong>สต็อกถูกตัดไปแล้วตอนกดตัดสต็อก</strong> — หน้านี้บอกว่าต้องไปหยิบของจากชั้นไหน ไม่ได้ตัดสต็อกซ้ำ
        การติ๊กทีละชิ้น สแกนบาร์โค้ด และแจ้งของขาด ทำบนมือถือ (แพ็คสินค้า ในเมนูเพิ่มเติม)
      </div>

      {selIds.length > 0 && (
        <div style={{ position: "sticky", top: 70, zIndex: 9, background: "var(--fg)", color: "oklch(0.99 0.003 250)", padding: "10px 18px", borderRadius: 14, display: "flex", alignItems: "center", gap: 12, boxShadow: "var(--shadow-lg)" }}>
          <span style={{ width: 28, height: 28, borderRadius: 999, background: "var(--accent)", color: "#fff", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }} className="tnum">{selIds.length}</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>เลือก {selIds.length} ออร์เดอร์</span>
          <button onClick={() => setSel({})} style={{ background: "transparent", border: "none", color: "oklch(0.85 0.005 250)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>ล้างการเลือก</button>
          <div className="spacer"/>
          <BulkBtn icon={<Icons.Check size={13}/>} label="พร้อมส่ง" onClick={() => markPacked(selIds)}/>
        </div>
      )}

      <div className="card card-tight">
        <table className="t">
          <thead><tr>
            <th style={{ width: 24 }}>
              <span className={"check" + (selIds.length && selIds.length === rows.length ? " on" : "")}
                onClick={() => setSel(selIds.length === rows.length ? {} : Object.fromEntries(rows.map(r => [r.o.id, true])))}
                title="เลือกทั้งหมด"/>
            </th>
            <th>เลขที่ออร์เดอร์</th>
            <th>ลูกค้า</th>
            <th>ช่องทาง</th>
            <th className="t-num">รายการ</th>
            <th className="t-num">ชิ้น</th>
            <th className="t-num">ตำแหน่ง</th>
            <th style={{ minWidth: 150 }}>ความคืบหน้า</th>
            <th>ผู้หยิบ</th>
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const isOpen = open === r.o.id;
              const w = waveOf[r.o.id];
              return (
                <React.Fragment key={r.o.id}>
                  <tr style={r.totals.complete ? { background: "var(--success-soft)" } : undefined}>
                    <td><span className={"check" + (sel[r.o.id] ? " on" : "")} onClick={() => setSel(p => ({ ...p, [r.o.id]: !p[r.o.id] }))}/></td>
                    <td className="mono" style={{ fontSize: 12, cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : r.o.id)}>
                      {r.o.id}
                      {w && <div style={{ fontSize: 10, color: "var(--info)" }}>หยิบรวม · {w.rec.stage === "sort" ? "แยกลงออร์เดอร์" : "เดินหยิบ"}</div>}
                    </td>
                    <td style={{ cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : r.o.id)}>{r.o.customer || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{r.o.channel || "—"}</td>
                    <td className="t-num tnum">{r.totals.lineCount}</td>
                    <td className="t-num tnum" style={{ fontWeight: 500 }}>{r.totals.need}</td>
                    <td className="t-num tnum" style={{ color: "var(--muted)" }}>{r.shelves}</td>
                    <td>
                      {r.rec ? (
                        <div className="row" style={{ gap: 8 }}>
                          <div className={"prog" + (r.totals.complete ? " success" : "")} style={{ flex: 1, height: 5 }}><span style={{ width: r.totals.pct + "%" }}/></div>
                          <span className="tnum" style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{r.totals.got}/{r.totals.need}</span>
                        </div>
                      ) : <span style={{ fontSize: 11.5, color: "var(--muted)" }}>ยังไม่เริ่ม</span>}
                      {r.totals.shortLines > 0 && (
                        <div style={{ fontSize: 10.5, color: "var(--warning)", marginTop: 3 }}>
                          <Icons.Warn size={10}/> ของขาด {r.totals.shortLines} รายการ
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 11.5, color: "var(--muted)" }}>{(r.rec && r.rec.by) || "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn btn-sm" onClick={() => markPacked([r.o.id])} title="ทำเครื่องหมายพร้อมส่ง">
                          <Icons.Check size={12}/>
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(isOpen ? null : r.o.id)}>
                          <Icons.Chev size={13} style={isOpen ? { transform: "rotate(90deg)" } : undefined}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan="10" style={{ background: "var(--surface-2)", padding: "14px 18px" }}>
                        {r.lines.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
                            ออร์เดอร์นี้ไม่มีรายการที่ระบุ SKU (ออร์เดอร์เก่า หรือฉลากที่พิมพ์ชื่อสินค้าเอง) — หยิบตามฉลากแทน
                          </div>
                        ) : (
                          <>
                            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                              <div className="eyebrow">รายการหยิบ · เรียงตามเส้นทางเดิน</div>
                              {r.rec && <button className="btn btn-sm btn-ghost" onClick={() => resetProgress(r.o.id)}>ล้างความคืบหน้า</button>}
                            </div>
                            <table className="t" style={{ background: "var(--surface)", borderRadius: 8 }}>
                              <thead><tr>
                                <th>ตำแหน่ง</th><th>SKU</th><th>ชื่อสินค้า</th>
                                <th className="t-num">ต้องหยิบ</th><th className="t-num">หยิบแล้ว</th><th className="t-num">ในชั้น</th><th>หมายเหตุ</th>
                              </tr></thead>
                              <tbody>
                                {r.lines.map(l => {
                                  const picked = (r.rec && r.rec.done && r.rec.done[l.key]) || 0;
                                  const short = (r.rec && r.rec.short && r.rec.short[l.key]) || "";
                                  const thin = l.shelfQty < l.qty;
                                  return (
                                    <tr key={l.key}>
                                      <td className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
                                        {(l.parts && l.parts.pos) || l.loc || "—"}
                                        <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400 }}>
                                          {l.parts ? `${l.parts.building}${l.parts.floor ? " · " + l.parts.floor : ""}` : ""}
                                        </div>
                                      </td>
                                      <td className="mono" style={{ fontSize: 11.5 }}>{l.sku}</td>
                                      <td style={{ fontSize: 12.5 }}>{l.name}</td>
                                      <td className="t-num tnum" style={{ fontWeight: 600 }}>{l.qty}</td>
                                      <td className="t-num tnum" style={{ color: picked >= l.qty ? "var(--success)" : "var(--muted)" }}>{picked}</td>
                                      <td className="t-num tnum" style={{ color: thin ? "var(--danger)" : "var(--muted)" }}>{l.shelfQty}</td>
                                      <td style={{ fontSize: 11 }}>
                                        {short
                                          ? <span style={{ color: "var(--warning)" }}>{short}</span>
                                          : thin ? <span style={{ color: "var(--danger)" }}>ในชั้นไม่พอ</span> : ""}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </>
                        )}
                        {/* ใบปะหน้า + ที่อยู่ + (owner) ยกเลิก/คืนสต็อก — pack-docs.jsx */}
                        {typeof PackShipDocs === "function" && <PackShipDocs order={r.o} lines={r.lines} pushToast={pushToast} onCancelled={() => setOpen(null)}/>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan="10" style={{ textAlign: "center", padding: 48, color: "var(--muted)", fontSize: 13 }}>
                <Icons.Check size={22} style={{ opacity: 0.5, marginBottom: 8, color: "var(--success)" }}/>
                <div>ไม่มีออร์เดอร์รอแพ็ค</div>
                <div style={{ fontSize: 11.5, marginTop: 4 }}>ออร์เดอร์จะเข้าคิวนี้อัตโนมัติหลังตัดสต็อก</div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { QuickSellModal });
Object.assign(window, { Inbound, Outbound, Inventory, Locations, Kpi, ActivityDot, Legend, MiniWarehouse, BulkField, SellProductModal, CameraScanner, StockTake, OcrNameButton, ProductFinder, ProductNameSearchField, LocationSplitPanel, LocationSelect, PackQueue, QtyStepper });
