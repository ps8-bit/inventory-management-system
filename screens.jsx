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
  // small variant of locations
  const cells = LOCATIONS.slice(0, 40);
  return (
    <div className="wh-grid">
      {cells.map(c => {
        let cls = "wh-cell";
        if (c.fill === 0) cls += " empty";
        else if (c.fill < 30) cls += " fill1";
        else if (c.fill < 70) cls += " fill2";
        else if (c.fill < 90) cls += " fill3";
        else cls += " fill4";
        return (
          <div key={c.code} className={cls}>
            <div className="lab">{c.code.split("-").slice(0,2).join("-")}</div>
            <div className="pct">{c.fill}%</div>
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
function CameraScanner({ onScan, onClose }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const timerRef  = useRef(null);
  const trackRef  = useRef(null);
  const lastRef   = useRef({ code: null, streak: 0 });
  const fileRef   = useRef(null);
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
        /* ── Engine 1: native BarcodeDetector — Android Chrome, iOS 17.4+, desktop ──
           Fast and hardware-accelerated. We drive a per-frame capture loop. */
        if (hasDetector) {
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

          const FMTS = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39",
                        "code_93","qr_code","data_matrix","itf","aztec","codabar","pdf417"];
          const supported = await BarcodeDetector.getSupportedFormats().catch(() => FMTS);
          const fmts = FMTS.filter(f => supported.includes(f));
          const bd = new BarcodeDetector({ formats: fmts.length ? fmts : FMTS });

          /* ZXing fallback — runs only on frames where BarcodeDetector finds nothing.
             iOS Safari's BarcodeDetector frequently fails to decode 1D bars (EAN/Code128)
             even when sharp; ZXing reliably reads them from the same captured frame. */
          const fCanvas = document.createElement("canvas");
          const fCtx    = fCanvas.getContext("2d", { willReadFrequently: true });
          let zFallback = null, zHints = null;
          if (window.ZXing?.MultiFormatReader) {
            try {
              const BF = ZXing.BarcodeFormat;
              zHints = new Map();
              zHints.set(ZXing.DecodeHintType.TRY_HARDER, true);
              zHints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
                BF.EAN_13, BF.EAN_8, BF.UPC_A, BF.UPC_E, BF.CODE_128,
                BF.CODE_39, BF.CODE_93, BF.ITF, BF.CODABAR, BF.QR_CODE, BF.DATA_MATRIX,
              ]);
              zFallback = new ZXing.MultiFormatReader();
            } catch (_) { zFallback = null; }
          }

          /* Decode the current video frame with ZXing at a given rotation (0/90/180/270°).
             ZXing's 1D reader only scans horizontal pixel rows, so a barcode turned 90°
             runs parallel to the scan lines and never decodes. Rotating the frame lets us
             read bars at any orientation. The frame is also downscaled (longest side ~1024px)
             so multiple rotations stay fast enough to run every tick. */
          const decodeRotated = (vid, deg) => {
            const vw = vid.videoWidth || 640, vh = vid.videoHeight || 480;
            const scale = Math.min(1, 1024 / Math.max(vw, vh));
            const sw = Math.round(vw * scale), sh = Math.round(vh * scale);
            const swap = (deg === 90 || deg === 270);
            const cw = swap ? sh : sw, ch = swap ? sw : sh;
            if (fCanvas.width !== cw)  fCanvas.width  = cw;
            if (fCanvas.height !== ch) fCanvas.height = ch;
            fCtx.setTransform(1, 0, 0, 1, 0, 0);
            fCtx.clearRect(0, 0, cw, ch);
            fCtx.save();
            if (deg === 90)       { fCtx.translate(cw, 0);  fCtx.rotate(Math.PI / 2); }
            else if (deg === 180) { fCtx.translate(cw, ch); fCtx.rotate(Math.PI); }
            else if (deg === 270) { fCtx.translate(0, ch);  fCtx.rotate(-Math.PI / 2); }
            fCtx.drawImage(vid, 0, 0, sw, sh);
            fCtx.restore();
            try {
              const lum = new ZXing.HTMLCanvasElementLuminanceSource(fCanvas);
              const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
              return zFallback.decode(bmp, zHints).getText();
            } catch (_) { return null; }
          };

          setPhase("ready");
          let scanBusy = false;
          const finish = (value) => {
            if (!value || dead) return;
            dead = true;
            clearInterval(timerRef.current);
            streamRef.current?.getTracks().forEach(t => t.stop());
            onScan(value);
          };
          const scan = async () => {
            if (dead || scanBusy) return;
            const vid = videoRef.current;
            if (!vid || vid.readyState < 2 || vid.paused) return;
            scanBusy = true;
            try {
              /* 1. BarcodeDetector straight on the <video> element — most reliable path,
                    avoids a canvas roundtrip that can drop borderline 1D detections. */
              let value = null;
              try {
                const hits = await bd.detect(vid);
                if (hits.length) value = hits[0].rawValue;
              } catch (_) {}

              /* 2. ZXing on the captured frame, tried at every 90° rotation — recovers 1D
                    barcodes BarcodeDetector missed, regardless of how the bars are turned. */
              if (!value && zFallback) {
                for (const deg of [0, 90, 180, 270]) {
                  value = decodeRotated(vid, deg);
                  if (value) break;
                }
              }

              finish(value);
            } catch (_) {}
            scanBusy = false;
          };
          timerRef.current = setInterval(scan, 300);
          return;
        }

        /* ── Engine 2: ZXing live loop — Firefox, iOS < 17.4, browsers w/o BarcodeDetector ──
           Delegate to the library's own video decoder. It captures frames and converts
           luminance correctly; the previous hand-rolled RGBLuminanceSource path fed it
           raw RGBA bytes and almost never decoded. */
        const v = videoRef.current;
        if (!v) return;
        v.setAttribute("playsinline", "true");
        v.setAttribute("webkit-playsinline", "true");
        v.addEventListener("playing", () => { if (!dead) { setupTrack(); setPhase("ready"); } }, { once: true });

        const hints = new Map();
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        zxReader = new ZXing.BrowserMultiFormatReader(hints, 250);
        zxReader.decodeFromConstraints(CONSTRAINTS, v, (result) => {
          if (result && !dead) {
            dead = true;
            try { zxReader.reset(); } catch (_) {}
            onScan(result.getText());
          }
        }).catch(handleCamError);

      } catch (err) {
        handleCamError(err);
      }
    })();

    return () => {
      dead = true;
      clearInterval(timerRef.current);
      try { zxReader?.reset(); } catch (_) {}
      try { trackRef.current?.stop?.(); } catch (_) {}
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (_) {}
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

  return (
    <div style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(0,0,0,0.93)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, padding:16 }}>

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
      <style>{`@keyframes camScan{0%,100%{top:8%}50%{top:80%}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
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
  const [loc,      setLoc]      = useState("");
  const [price,    setPrice]    = useState(prefill?.price ? String(prefill.price) : "");
  const [reorder,  setReorder]  = useState("30");
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
    const product = {
      sku,
      name:     name.trim(),
      cat:      catVal,
      brand:    brand.trim() || "",
      loc:      loc.trim().toUpperCase() || "—",
      price:    parseFloat(price) || 0,
      cost:     Math.round((parseFloat(price) || 0) * 0.6),
      qty:      0,          // start at 0; receiving adds on top
      reserved: 0,
      reorder:  parseInt(reorder) || 30,
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
          <input className={mobile ? "m-input mono" : "input mono"} value={loc}
            onChange={e => setLoc(e.target.value.toUpperCase())} placeholder="เช่น A-01-01"/>
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
                <input className="m-input mono" value={loc}
                  onChange={e => setLoc(e.target.value.toUpperCase())} placeholder="A-01-01"/>
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
  const [received, setReceived] = useState([]);
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState(null);
  const [camOpen, setCamOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState(null); // null | { sku: string }
  const [closeConfirm, setCloseConfirm] = useState(null); // null | { changes }
  const [closed, setClosed] = useState(false); // true once job is committed
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

  const submitScan = (override) => {
    const code = (override ?? scan).trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase());
    if (!p) {
      /* Unknown SKU → check the WooCommerce reference catalog. A match prefills
         the quick-register form (no typing); otherwise open it blank. */
      const hit = typeof wooCatalogLookup === "function" ? wooCatalogLookup(code) : null;
      if (typeof playScanErrorBeep === "function" && !hit) playScanErrorBeep();
      else if (typeof playScanBeep === "function" && hit) playScanBeep();
      setQuickAdd({ sku: code, prefill: hit });
      setScan("");
      return;
    }
    if (typeof playScanBeep === "function") playScanBeep();
    addToReceived(p.sku, p.name, p.loc, 1);
    setFlash({ sku: p.sku, name: p.name, notFound: false });
    setTimeout(() => setFlash(null), 1200);
    setScan("");
    pushToast(`สแกนรับเข้า ${p.sku} สำเร็จ`);
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
          <button className="btn" onClick={() => goTo && goTo("history")}><Icons.History/> ประวัติการรับเข้า</button>
          <button
            className="btn btn-primary"
            disabled={received.length === 0 || closed}
            style={(received.length === 0 || closed) ? { opacity: 0.5, cursor: "not-allowed" } : {}}
            onClick={() => {
              if (received.length === 0 || closed) return;
              setCloseConfirm({
                changes: received.map(r => ({ label: r.sku, to: `+${r.qty} ชิ้น` }))
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
        {camOpen && <CameraScanner onScan={code => { submitScan(code); setCamOpen(false); }} onClose={() => setCamOpen(false)}/>}
        {quickAdd && (
          <QuickAddInboundModal
            sku={quickAdd.sku}
            prefill={quickAdd.prefill}
            onClose={() => setQuickAdd(null)}
            onConfirm={(product, qty) => {
              addProductToStore(product);
              addToReceived(product.sku, product.name, product.loc, qty);
              if (typeof recordChange === "function") {
                recordChange({
                  entity: "product", action: "add",
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

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 4 }}>ทดลองสแกน:</span>
          {PRODUCTS.slice(0, 5).map(p => (
            <button key={p.sku} className="btn btn-sm" onClick={() => submitScan(p.sku)}>
              <span className="mono" style={{ fontSize: 11 }}>{p.sku}</span>
            </button>
          ))}
        </div>

        {flash && (
          flash.notFound ? (
            <div className="row" style={{ padding: "10px 14px", background: "var(--warning-soft,var(--surface-2))", color: "var(--warning,var(--fg))", borderRadius: 10, fontSize: 13, fontWeight: 500, gap: 8 }}>
              <Icons.Warn size={18}/> ไม่พบ SKU: <span className="mono" style={{ marginLeft: 4 }}>{flash.sku}</span>
              <span style={{ fontWeight: 400, fontSize: 12 }}>— กำลังเปิดฟอร์มเพิ่มสินค้าใหม่…</span>
            </div>
          ) : (
            <div className="row" style={{ padding: "10px 14px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
              <Icons.Check size={18}/> รับเข้า {flash.sku} — {flash.name}
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
            <h3>รายการที่นับได้ในรอบนี้</h3>
            <div className="sub">เรียงตามเวลาที่สแกนล่าสุด</div>
          </div>
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}><Icons.Refresh size={14}/></button>
            <button className="btn btn-sm" onClick={() => {
              if (!received.length) return;
              const cols = ["SKU", "ชื่อสินค้า", "ตำแหน่งจัดเก็บ", "จำนวนรับ"];
              const rows = received.map(r => [r.sku, r.name, r.loc, r.qty]);
              const csv = [cols, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
              a.download = `GR-inbound-${new Date().toISOString().slice(0,10)}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}>ส่งออก CSV</button>
          </div>
        </div>
        <table className="t">
          <thead><tr>
            <th style={{ width: 64 }}>เวลา</th>
            <th>SKU</th>
            <th>ชื่อสินค้า</th>
            <th>ตำแหน่งจัดเก็บ</th>
            <th className="t-num">จำนวน</th>
            <th style={{ width: 1 }}/>
          </tr></thead>
          <tbody>
            {received.map((r, i) => (
              <tr key={i}>
                <td className="t-mono">{r.t}</td>
                <td className="t-mono" style={{ color: "var(--fg)" }}>{r.sku}</td>
                <td>{r.name}</td>
                <td><span className="badge badge-neutral"><Icons.Map size={11}/>{r.loc}</span></td>
                <td className="t-num tnum"><span style={{ fontWeight: 500 }}>{r.qty}</span></td>
                <td><button className="btn btn-ghost btn-icon" title={`แก้ไข ${r.sku}`} onClick={() => pushToast(`แก้ไข ${r.sku} — ใช้หน้า สินค้าคงคลัง เพื่อปรับจำนวน`)}><Icons.Edit size={14}/></button></td>
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
        description={`จะเพิ่มสต็อกจำนวน ${received.reduce((s,r)=>s+r.qty,0)} ชิ้น ใน ${received.length} SKU เข้าระบบทันที`}
        changes={closeConfirm?.changes || []}
        action="ยืนยันปิดงาน"
        onCancel={() => setCloseConfirm(null)}
        onConfirm={() => {
          received.forEach(r => {
            const p = PRODUCTS.find(x => x.sku === r.sku);
            if (!p) return;
            updateProductInStore(r.sku, { qty: p.qty + r.qty });
          });
          if (typeof recordChange === "function") {
            recordChange({
              entity: "inbound", action: "close",
              summary: `ปิดงานรับเข้า — เพิ่มสต็อก ${received.length} SKU รวม ${received.reduce((s,r)=>s+r.qty,0)} ชิ้น`,
              changes: received.map(r => ({ label: r.sku, to: `+${r.qty} ชิ้น` }))
            });
          }
          setCloseConfirm(null);
          setClosed(true);
          pushToast(`ปิดงานรับเข้าแล้ว — อัปเดตสต็อก ${received.length} SKU`);
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
function Outbound({ goTo, pushToast }) {
  const [picked, setPicked] = useState({});
  const [orders, setOrders] = useState(loadOrders);
  const [issueOpen, setIssueOpen] = useState(false);
  const [obBulkMenu, setObBulkMenu] = useState(null);
  const [obBulkConfirm, setObBulkConfirm] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCh, setFilterCh] = useState("all");
  const [filterQ, setFilterQ] = useState("");

  // Persist orders + fire badge-refresh event on every change
  useEffect(() => { saveOrders(orders); }, [orders]);

  // Reload from DB when a remote team-member change arrives via real-time
  useEffect(() => {
    const reload = () => { if (window._DB_ORDERS) setOrders(window._DB_ORDERS); };
    window.addEventListener("ims-orders-change", reload);
    return () => window.removeEventListener("ims-orders-change", reload);
  }, []);

  useEffect(() => {
    // Drain orders that were dispatched before this component mounted
    const pending = window.__pendingSellOrders || [];
    if (pending.length > 0) {
      setOrders(prev => [...pending, ...prev]);
      window.__pendingSellOrders = [];
    }
    const handler = (e) => setOrders(prev => [e.detail, ...prev]);
    window.addEventListener("ims-sell-order", handler);
    return () => window.removeEventListener("ims-sell-order", handler);
  }, []);

  // Bulk-status dropdown ref + click-outside to close
  const obBulkMenuRef = useRef(null);
  useEffect(() => {
    if (!obBulkMenu) return;
    const h = (e) => { if (obBulkMenuRef.current && !obBulkMenuRef.current.contains(e.target)) setObBulkMenu(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [obBulkMenu]);

  // Tab definitions — index 0 = "all", 1-4 map to real status values
  const TABS       = ["ทั้งหมด", "กำลังหยิบ", "พร้อมส่ง", "ส่งแล้ว", "จัดส่งสำเร็จ"];
  const TAB_STATUS = [null,       "picking",    "packed",   "shipped",  "delivered"];
  const [tab, setTab] = useState(0);

  // Live counts from orders state (used for stats + tab badges)
  const pickingCount   = orders.filter(o => o.status === "picking").length;
  const packedCount    = orders.filter(o => o.status === "packed").length;
  const shippedCount   = orders.filter(o => o.status === "shipped" || o.status === "delivered").length;
  const pendingCount   = pickingCount + packedCount;

  // Apply tab + optional channel/text filter
  const tabOrders = (TAB_STATUS[tab] ? orders.filter(o => o.status === TAB_STATUS[tab]) : orders)
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
  const STATUS_LABEL = { picking: "กำลังหยิบ", packed: "พร้อมส่ง", shipped: "ส่งแล้ว", delivered: "จัดส่งสำเร็จ" };
  const STATUS_CLS   = { picking: "badge-warning", packed: "badge-info", shipped: "badge-success", delivered: "badge-neutral" };

  const submitIssue = (data) => {
    const id = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
    const totalQty = data.deductions.reduce((s, d) => s + d.qty, 0);
    const primary = data.deductions[0];
    const channelLabel = data.deductions.length === 1 ? primary.name : `${data.deductions.length} ช่องทาง`;
    const ts = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const dateIso = (typeof TODAY_ISO !== "undefined") ? TODAY_ISO : new Date().toISOString().slice(0, 10);

    if (data.mode === "bundle") {
      const { bundle } = data;
      deductManyAndPersist(bundle.items.map(item => ({ sku: item.sku, qty: item.qty * totalQty })));
      if (typeof recordChange === "function") {
        recordChange({
          entity: "bundle", entityId: bundle.id, action: "update",
          summary: `ตัดสต็อกชุด "${bundle.name}" ${totalQty} ชุด ผ่านหน้าจัดส่ง`,
          count: bundle.items.length,
          changes: bundle.items.map(item => ({
            label: item.sku, to: `−${item.qty * totalQty} ชิ้น`
          })),
          note: `ออร์เดอร์ ${id} · ${channelLabel}`
        });
      }
      setOrders(prev => [{
        id, channel: channelLabel, customer: data.customer || "ลูกค้าใหม่",
        items: bundle.items.length, status: "picking", carrier: "", tracking: "",
        ts, dateIso, deductions: data.deductions, isBundle: true, bundleName: bundle.name,
        lineItems: bundle.items.map(it => snapLineItem(it.sku, null, it.qty * totalQty))
      }, ...prev]);
      pushToast(`ตัดสต็อกชุด "${bundle.name}" ${totalQty} ชุด — ${bundle.items.length} รายการสินค้า`);
      setIssueOpen(false);
      return;
    }

    deductStockAndPersist(data.sku, totalQty);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: data.sku, action: "deduct",
        summary: `ตัดสต็อก ${data.sku} จำนวน ${totalQty} ชิ้น ผ่านหน้าจัดส่ง`,
        changes: [{ label: data.sku, to: `−${totalQty} ชิ้น` }],
        note: `ออร์เดอร์ ${id} · ${channelLabel}`
      });
    }
    setOrders(prev => [{
      id, channel: channelLabel, customer: data.customer || "ลูกค้าใหม่",
      items: data.deductions.length, status: "picking", carrier: "", tracking: "",
      ts, dateIso, deductions: data.deductions, sku: data.sku,
      lineItems: [snapLineItem(data.sku, null, totalQty)]
    }, ...prev]);
    pushToast(`ตัดสต็อก ${data.sku} จำนวน ${totalQty} ชิ้น (${data.deductions.length} ช่องทาง)`);
    setIssueOpen(false);
  };

  const pickedIds = Object.keys(picked).filter(k => picked[k]);
  const pickedCount = pickedIds.length;
  const allPicked = orders.length > 0 && orders.every(o => picked[o.id]);
  const somePicked = !allPicked && orders.some(o => picked[o.id]);

  const toggleAllOrders = () => {
    if (allPicked) setPicked({});
    else setPicked(Object.fromEntries(orders.map(o => [o.id, true])));
  };
  const clearPicked = () => { setPicked({}); setObBulkMenu(null); };

  const bulkUpdateStatus = (status) => {
    const STATUS_LABEL = { picking: "กำลังหยิบ", packed: "พร้อมส่ง", shipped: "ส่งแล้ว" };
    setObBulkConfirm({
      title: "ยืนยันการแก้ไขสถานะ",
      description: `อัปเดตสถานะของ ${pickedCount} ออร์เดอร์เป็น \"${STATUS_LABEL[status]}\"`,
      count: pickedCount,
      changes: [{ label: "สถานะใหม่", to: STATUS_LABEL[status] }],
      action: "อัปเดต",
      onConfirm: () => {
        setOrders(prev => prev.map(o => picked[o.id] ? { ...o, status } : o));
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
  const bulkDeleteOrders = () => {
    setObBulkConfirm({
      title: "ยืนยันการลบออร์เดอร์",
      description: `ลบ ${pickedCount} ออร์เดอร์ออกจากระบบ`,
      count: pickedCount,
      action: "ลบออร์เดอร์",
      danger: true,
      onConfirm: () => {
        setOrders(prev => prev.filter(o => !picked[o.id]));
        recordChange({
          entity: "order", action: "bulk-delete",
          summary: `ลบ ${pickedCount} ออร์เดอร์จากหน้าจัดส่ง`,
          count: pickedCount,
          note: `ออร์เดอร์: ${pickedIds.join(", ")}`
        });
        pushToast(`ลบ ${pickedCount} ออร์เดอร์แล้ว`);
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
            if (!toPrint.length) { pushToast("ไม่มีออร์เดอร์ที่ต้องหยิบ"); return; }
            const w = window.open("", "_blank");
            w.document.write(`<!DOCTYPE html><html><head><title>Pick List</title>
<style>*{box-sizing:border-box}body{font-family:sans-serif;padding:24px;color:#111;font-size:13px}h2{margin:0 0 2px;font-size:18px}p{margin:0 0 16px;color:#666}button{padding:8px 18px;cursor:pointer;margin-bottom:16px;font-size:13px}table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}td{padding:8px 10px;border-bottom:1px solid #eee}tr:hover td{background:#fafafa}.mono{font-family:monospace;font-size:12px}@media print{button{display:none!important}}</style>
</head><body>
<h2>Pick List</h2><p>${new Date().toLocaleDateString("th-TH", { dateStyle:"full" })} · ${toPrint.length} ออร์เดอร์</p>
<button onclick="window.print()">🖨 พิมพ์</button>
<table><thead><tr><th>#</th><th>เลขออร์เดอร์</th><th>ลูกค้า</th><th>ช่องทาง</th><th>รายการ</th><th>ขนส่ง</th><th>สถานะ</th></tr></thead><tbody>
${toPrint.map((o,i) => `<tr><td class="mono">${i+1}</td><td class="mono">${o.id}</td><td>${o.customer||"—"}</td><td>${o.channel||"—"}</td><td style="text-align:center">${o.items}</td><td>${o.carrier||"—"}</td><td>${{picking:"กำลังหยิบ",packed:"พร้อมส่ง"}[o.status]||o.status}</td></tr>`).join("")}
</tbody></table></body></html>`);
            w.document.close();
          }}><Icons.Print/> รายการหยิบสินค้า</button>
          <button className="btn" onClick={() => setIssueOpen(true)}><Icons.Out size={14}/> ตัดสต็อก</button>
          <button className="btn btn-primary" onClick={() => goTo("labels")}><Icons.Tag/> สร้างฉลากส่ง</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="กำลังหยิบ"  value={pickingCount}  tone="warning" hint="ออร์เดอร์รอหยิบ"/>
        <SmallStat label="พร้อมส่ง"   value={packedCount}   tone="info"    hint="แพ็คเสร็จรอส่ง"/>
        <SmallStat label="ส่งแล้ว"    value={shippedCount}  tone="success" hint="KEX · Flash · J&T · ไปรษณีย์"/>
      </div>

      {/* Channel breakdown */}
      <div className="card card-tight">
        <div className="card-head">
          <div>
            <h3>ยอดตัดสต็อกตามช่องทาง</h3>
            <div className="sub">วันนี้ • รวม {CHANNELS.reduce((s,c)=>s+c.today,0)} ออร์เดอร์</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => goTo && goTo("analytics")}>ดูรายงาน <Icons.Chev size={14}/></button>
        </div>
        <div style={{ padding: "12px 18px 18px", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
          {CHANNELS.map(c => {
            const meta = CHANNEL_LIST.find(x => x.id === c.id) || {};
            return (
              <div key={c.id} style={{ padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: meta.color }}/>
                  <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{c.name}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", fontFamily: "IBM Plex Sans, sans-serif" }} className="tnum">{c.today}</div>
                <div className="prog" style={{ marginTop: 6, height: 4 }}>
                  <span style={{ width: c.pct + "%", background: meta.color }}/>
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>{c.pct}% ของวันนี้</div>
              </div>
            );
          })}
        </div>
      </div>

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
          const cnt = TAB_STATUS[i] ? orders.filter(o => o.status === TAB_STATUS[i]).length : orders.length;
          return (
            <div key={t} className={"tab" + (tab === i ? " active" : "")} onClick={() => setTab(i)}>
              {t}
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

              // Build per-SKU consolidated pick map: sku → {name, loc, orders:[{id,customer,qty}], total}
              const skuMap = {};
              toPrint.forEach(o => {
                const lines = Array.isArray(o.lineItems) ? o.lineItems : [];
                lines.forEach(it => {
                  const prod = PRODUCTS.find(p => p.sku === it.sku);
                  if (!skuMap[it.sku]) skuMap[it.sku] = { name: it.name || (prod && prod.name) || it.sku, loc: (prod && prod.loc) || "—", orders: [], total: 0 };
                  skuMap[it.sku].orders.push({ id: o.id, customer: o.customer || "—", qty: it.qty || 1 });
                  skuMap[it.sku].total += (it.qty || 1);
                });
              });
              // Sort by bin location for efficient warehouse walk
              const skuRows = Object.entries(skuMap).sort(([,a],[,b]) => (a.loc||"").localeCompare(b.loc||""));
              const totalQty = skuRows.reduce((s,[,v]) => s + v.total, 0);
              const hasLineItems = skuRows.length > 0;

              const skuTable = hasLineItems ? `
                <h3>รายการหยิบสินค้า (เรียงตามตำแหน่ง)</h3>
                <table>
                  <thead><tr><th>☑</th><th>ตำแหน่ง</th><th>SKU</th><th>ชื่อสินค้า</th><th class="num">รวมหยิบ</th><th>ออร์เดอร์ที่ต้องการ</th></tr></thead>
                  <tbody>${skuRows.map(([sku,v]) => `
                    <tr>
                      <td><span class="chk"></span></td>
                      <td class="mono loc">${v.loc}</td>
                      <td class="mono">${sku}</td>
                      <td>${v.name}</td>
                      <td class="num bold">${v.total}</td>
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
                      <td>${{picking:"กำลังหยิบ",packed:"พร้อมส่ง",shipped:"ส่งแล้ว"}[o.status]||o.status}</td>
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
            <BulkBtn icon={<Icons.Trash size={13}/>} label="ลบ" onClick={bulkDeleteOrders} danger/>
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
                  { id: "picking", label: "กำลังหยิบ", icon: Icons.Box },
                  { id: "packed",  label: "พร้อมส่ง",   icon: Icons.Pkg },
                  { id: "shipped", label: "ส่งแล้ว",    icon: Icons.Truck }
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
                  <td className="t-mono" style={{ color: "var(--fg)" }}>
                    {o.id}
                    {o.isBundle && <span className="badge badge-info" style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px" }} title={o.bundleName}><Icons.Bundle size={9}/> ชุด</span>}
                  </td>
                  <td>
                    {chMeta ? (
                      <span className="ch-chip"><span className="swatch" style={{ background: chMeta.color }}/>{o.channel}</span>
                    ) : (
                      <span className="badge badge-neutral">{o.channel}</span>
                    )}
                  </td>
                  <td>{o.customer}</td>
                  <td className="t-num tnum">{o.items}</td>
                  <td>{o.carrier}</td>
                  <td className="t-mono">{o.tracking}</td>
                  <td><span className={"badge " + stCls}><span className="dot"/>{stLab}</span></td>
                  <td><button className="btn btn-ghost btn-icon" title="สร้างฉลากจัดส่ง" onClick={() => { queueLabelsAndGo(o, goTo); pushToast(`สร้างฉลาก ${o.id}`); }}><Icons.Tag size={14}/></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issueOpen && <IssueModal onClose={() => setIssueOpen(false)} onSubmit={submitIssue}/>}
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

function IssueModal({ onClose, onSubmit }) {
  const [mode, setMode] = useState("single"); // single | bundle
  const bundles = useMemo(() => (typeof loadBundles === "function" ? loadBundles() : []), []);
  const effQty = (sku) => (typeof getEffectiveQty === "function"
    ? getEffectiveQty(sku)
    : (PRODUCTS.find(p => p.sku === sku)?.qty ?? 0));

  const [skuId, setSkuId] = useState(PRODUCTS[0].sku);
  const [bundleId, setBundleId] = useState(bundles[0]?.id || "");
  const [customer, setCustomer] = useState("");
  const [channels, setChannels] = useState(() =>
    Object.fromEntries(CHANNEL_LIST.map(c => [c.id, { on: c.id === "shopee", qty: c.id === "shopee" ? 1 : 0 }]))
  );

  const product = PRODUCTS.find(p => p.sku === skuId);
  const bundle = bundles.find(b => b.id === bundleId);
  const bundleMax = bundle && typeof bundleAvail === "function" ? bundleAvail(bundle) : 0;

  const total = Object.values(channels).reduce((s, c) => s + (c.on ? c.qty : 0), 0);
  const selectedCount = Object.values(channels).filter(c => c.on && c.qty > 0).length;
  const isBundle = mode === "bundle";
  const unit = isBundle ? "ชุด" : "ชิ้น";
  const stockCap = isBundle ? bundleMax : (product?.qty ?? 0);
  const overStock = total > stockCap;
  const noBundles = isBundle && bundles.length === 0;
  const bundleIssues = isBundle && bundle && typeof bundleStockIssues === "function"
    ? bundleStockIssues(bundle, total || 1) : [];

  const toggleCh = (id) => setChannels(c => ({ ...c, [id]: { ...c[id], on: !c[id].on, qty: !c[id].on && c[id].qty === 0 ? 1 : c[id].qty } }));
  const setQty = (id, q) => setChannels(c => ({ ...c, [id]: { ...c[id], qty: Math.max(0, q), on: q > 0 ? true : c[id].on } }));

  const submit = () => {
    if (selectedCount === 0 || total === 0 || overStock) return;
    const deductions = CHANNEL_LIST.filter(c => channels[c.id].on && channels[c.id].qty > 0).map(c => ({
      id: c.id, name: c.name, color: c.color, qty: channels[c.id].qty
    }));
    if (isBundle) {
      if (!bundle) return;
      onSubmit({ mode: "bundle", bundle, customer, deductions, total });
    } else {
      onSubmit({ mode: "single", sku: skuId, customer, deductions, total });
    }
  };

  const canSubmit = !noBundles && total > 0 && !overStock && (isBundle ? !!bundle : true);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="modal" style={{ maxHeight: "92vh", overflowY: "auto" }}>
        <div className="modal-head">
          <div>
            <h3>สร้างใบจัดส่ง · ตัดสต็อก</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>เลือกสินค้าเดี่ยวหรือชุดสินค้า ระบุจำนวน และช่องทางที่ต้องการตัดสต็อก</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>

        <div className="modal-body">
          {/* Mode toggle */}
          <div className="seg" style={{ marginBottom: 14, width: "100%" }}>
            <button className={mode === "single" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("single")}>
              <Icons.Box size={13}/> สินค้าเดี่ยว
            </button>
            <button className={mode === "bundle" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("bundle")}>
              <Icons.Bundle size={13}/> ชุดสินค้า
            </button>
          </div>

          {!isBundle && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>สินค้า</label>
              <SkuPicker value={skuId} onChange={setSkuId} products={PRODUCTS}/>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                <span>คงเหลือ <strong className="tnum" style={{ color: "var(--fg)" }}>{product.qty}</strong> ชิ้น · ตำแหน่ง <span className="mono">{product.loc}</span></span>
                <span>ราคา ฿{product.price.toLocaleString()}</span>
              </div>
            </div>
          )}

          {isBundle && (
            noBundles ? (
              <div style={{ padding: 24, textAlign: "center", background: "var(--surface-2)", borderRadius: 10, marginBottom: 14, color: "var(--muted)", fontSize: 13 }}>
                <Icons.Bundle size={22} style={{ opacity: 0.4, marginBottom: 6 }}/>
                <div>ยังไม่มีชุดสินค้า — สร้างชุดได้ที่หน้า "ชุดสินค้า"</div>
              </div>
            ) : (
              <div className="field" style={{ marginBottom: 14 }}>
                <label>ชุดสินค้า</label>
                <select className="input" value={bundleId} onChange={e => setBundleId(e.target.value)}>
                  {bundles.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                  ))}
                </select>
                {bundle && (
                  <>
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                      <span>ขายได้สูงสุด <strong className="tnum" style={{ color: bundleMax === 0 ? "var(--danger)" : "var(--fg)" }}>{bundleMax}</strong> ชุด</span>
                      <span>ราคาชุด ฿{bundle.price.toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10 }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>สินค้าที่จะถูกตัดสต็อก ({bundle.items.length} รายการ)</div>
                      <div className="stack" style={{ gap: 4 }}>
                        {bundle.items.map(item => {
                          const p = PRODUCTS.find(x => x.sku === item.sku);
                          const eq = effQty(item.sku);
                          const perSet = item.qty;
                          const need = perSet * total;
                          return (
                            <div key={item.sku} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <span style={{ width: 6, height: 6, borderRadius: 999, background: eq < need ? "var(--danger)" : eq <= 10 ? "var(--warning)" : "var(--success)", flexShrink: 0 }}/>
                              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name || item.sku}</span>
                              <span className="mono" style={{ color: "var(--muted)", flexShrink: 0 }}>×{perSet}/ชุด</span>
                              <span className="tnum" style={{ color: "var(--muted)", flexShrink: 0, minWidth: 56, textAlign: "right" }}>
                                {eq}{total > 0 ? ` → ${Math.max(0, eq - need)}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <BundleStockAlert issues={bundleIssues}/>
                    </div>
                  </>
                )}
              </div>
            )
          )}

          <div className="field" style={{ marginBottom: 16 }}>
            <label>ลูกค้า / เลขที่อ้างอิง <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ไม่จำเป็น)</span></label>
            <input className="input" placeholder="เช่น คุณ ปวีณา ท. / Shopee #2025-119283" value={customer} onChange={e => setCustomer(e.target.value)}/>
          </div>

          <div style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500, marginBottom: 8 }}>ตัดสต็อกตามช่องทาง <span style={{ color: "var(--muted)", fontWeight: 400 }}>(จำนวน = {unit})</span></div>
          <div className="stack" style={{ gap: 6 }}>
            {CHANNEL_LIST.map(c => {
              const v = channels[c.id];
              return (
                <div key={c.id} className={"ch-row" + (v.on ? " on" : "")}>
                  <span
                    className={"check" + (v.on ? " on" : "")}
                    onClick={() => toggleCh(c.id)}
                  />
                  <span style={{ width: 10, height: 10, borderRadius: 999, background: c.color }}/>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: v.on ? 500 : 400, color: v.on ? "var(--fg)" : "var(--fg-2)" }}>{c.name}</span>
                  <div className="qty-stepper">
                    <button onClick={() => setQty(c.id, v.qty - 1)} disabled={v.qty <= 0}>−</button>
                    <input value={v.qty} onChange={e => setQty(c.id, parseInt(e.target.value) || 0)}/>
                    <button onClick={() => setQty(c.id, v.qty + 1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: overStock ? "var(--danger-soft)" : "var(--surface-2)", color: overStock ? "var(--danger)" : "var(--fg)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12 }}>
              <div>รวมตัดสต็อก</div>
              {overStock && <div style={{ fontSize: 11, marginTop: 2 }}>เกินจำนวนที่ขายได้ ({stockCap} {unit})</div>}
            </div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 600 }}>{total} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>{unit} · {selectedCount} ช่องทาง</span></div>
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit} style={!canSubmit ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> ยืนยันตัดสต็อก
          </button>
        </div>
      </div>
    </>
  );
}

function SmallStat({ label, value, hint, tone }) {
  const map = { warning: "var(--warning)", info: "var(--info)", success: "var(--success)" };
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
function Inventory({ pushToast, density, goTo }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("ทั้งหมด");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState({}); // { sku: true }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [stockKey, setStockKey] = useState(0);

  // Re-render whenever the shared stock-adjustment layer OR the product catalog changes
  useEffect(() => {
    const refresh = () => setStockKey(k => k + 1);
    window.addEventListener("ims-stock-adj-change", refresh);
    window.addEventListener("ims-products-change", refresh);
    return () => {
      window.removeEventListener("ims-stock-adj-change", refresh);
      window.removeEventListener("ims-products-change", refresh);
    };
  }, []);

  const products = PRODUCTS;

  // Overlay the shared stock-adjustment layer so bundle deductions show here too
  const liveProducts = useMemo(() => {
    const adj = (typeof getStockAdj === "function") ? getStockAdj() : {};
    return products.map(p => ({ ...p, qty: Math.max(0, p.qty + (adj[p.sku] || 0)) }));
  }, [products, stockKey]);

  const addProduct = (p) => {
    addProductToStore({ ...p, reserved: 0 });
    pushToast(`เพิ่ม SKU ${p.sku} แล้ว`);
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", entityId: p.sku, action: "create",
        summary: `เพิ่มสินค้าใหม่ ${p.name} (${p.sku})`,
        changes: [
          { label: "จำนวนเริ่มต้น", to: String(p.qty) },
          { label: "ตำแหน่งจัดเก็บ", to: p.loc }
        ]
      });
    }
    setAddOpen(false);
  };

  const cats = useMemo(() => ["ทั้งหมด", ...(typeof loadCategories === "function" ? loadCategories() : [...new Set(products.map(p => p.cat))])], [products, stockKey]);
  const filtered = liveProducts.filter(p => {
    if (cat !== "ทั้งหมด" && p.cat !== cat) return false;
    const s = stockStatus(p).key;
    if (statusFilter !== "all" && s !== statusFilter) return false;
    if (q && !(p.sku.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase()) || (p.brand || "").toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

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

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">สินค้าคงคลัง</h1>
          <div className="page-sub">{liveProducts.length} SKU • รวม {liveProducts.reduce((s,p)=>s+p.qty,0).toLocaleString()} ชิ้น</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => {
            const headers = ["SKU","ชื่อสินค้า","หมวดหมู่","แบรนด์","คงเหลือ","จองแล้ว","จุดสั่งซื้อ","ตำแหน่ง","ราคาขาย","ต้นทุน","ผู้จัดส่ง","สถานะ"];
            const rows = filtered.map(p => {
              const s = stockStatus(p);
              return [p.sku, p.name, p.cat, p.brand || "", p.qty, p.reserved, p.reorder, p.loc, p.price, p.cost, p.supplier, s.label]
                .map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
            });
            const csv = "﻿" + [headers.join(","), ...rows].join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            a.download = `สินค้าคงคลัง_${new Date().toISOString().slice(0,10)}.csv`;
            a.click();
            URL.revokeObjectURL(a.href);
            pushToast(`ส่งออก ${filtered.length} รายการเป็น CSV แล้ว`);
          }}><Icons.Pkg size={14}/> Export CSV</button>
          <button className="btn" onClick={() => {
            const w = window.open("", "_blank");
            const rows = filtered.map(p => { const s = stockStatus(p); return `<tr><td class="mono">${p.sku}</td><td>${p.name}</td><td>${p.cat}</td><td class="r mono">${p.qty}</td><td class="r mono">${p.reorder}</td><td class="mono">${p.loc}</td><td>${s.label}</td></tr>`; }).join("");
            w.document.write(`<!DOCTYPE html><html><head><title>รายงานสินค้าคงคลัง</title><style>*{box-sizing:border-box}body{font-family:sans-serif;padding:24px;color:#111;font-size:13px}h2{margin:0 0 4px}p{margin:0 0 16px;color:#555}button{padding:8px 18px;cursor:pointer;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;font-size:12px;font-weight:600}td{padding:7px 10px;border-bottom:1px solid #eee}.mono{font-family:monospace;font-size:12px}.r{text-align:right}@media print{button{display:none!important}}</style></head><body><h2>รายงานสินค้าคงคลัง</h2><p>${new Date().toLocaleDateString("th-TH",{dateStyle:"full"})} · ${filtered.length} รายการ</p><button onclick="window.print()">🖨 พิมพ์</button><table><thead><tr><th>SKU</th><th>ชื่อสินค้า</th><th>หมวด</th><th class="r">คงเหลือ</th><th class="r">จุดสั่ง</th><th>ตำแหน่ง</th><th>สถานะ</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
            w.document.close();
          }}><Icons.Print/> พิมพ์รายงาน</button>
          <button className="btn" onClick={() => goTo && goTo("import")}><Icons.Pkg size={14}/> นำเข้า SKU จาก Excel</button>
          <button className="btn btn-accent" onClick={() => setAddOpen(true)}><Icons.Plus/> เพิ่ม SKU</button>
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
          <div className="seg">
            {cats.map(c => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          <div className="spacer"/>
          <div className="seg">
            <button className={statusFilter === "all" ? "on" : ""} onClick={() => setStatusFilter("all")}>ทุกสถานะ</button>
            <button className={statusFilter === "ok" ? "on" : ""} onClick={() => setStatusFilter("ok")}>พร้อมขาย</button>
            <button className={statusFilter === "low" ? "on" : ""} onClick={() => setStatusFilter("low")}>ต่ำ</button>
            <button className={statusFilter === "out" ? "on" : ""} onClick={() => setStatusFilter("out")}>หมด</button>
          </div>
        </div>
        {(q || cat !== "ทั้งหมด" || statusFilter !== "all") && (
          <div className="row" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", gap: 10, fontSize: 12, color: "var(--muted)" }}>
            <span>กรองอยู่:</span>
            {q && <span className="badge badge-neutral">ค้นหา "{q}" <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setQ("")}/></span>}
            {cat !== "ทั้งหมด" && <span className="badge badge-neutral">หมวด: {cat} <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setCat("ทั้งหมด")}/></span>}
            {statusFilter !== "all" && <span className="badge badge-neutral">สถานะ: {statusFilter} <Icons.X size={10} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => setStatusFilter("all")}/></span>}
            <span className="spacer"/>
            <span><strong className="tnum" style={{ color: "var(--fg)" }}>{filtered.length}</strong> จาก {products.length} รายการ</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setQ(""); setCat("ทั้งหมด"); setStatusFilter("all"); }}>ล้างตัวกรอง</button>
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
            <BulkBtn icon={<Icons.Edit size={13}/>} label="แก้ไขทั้งหมด" onClick={() => setBulkOpen(true)}/>
            <BulkBtn icon={<Icons.Print size={13}/>} label="พิมพ์บาร์โค้ด" onClick={() => pushToast(`เพิ่ม ${selectedCount} บาร์โค้ดเข้าคิวพิมพ์`)}/>
            <BulkBtn icon={<Icons.Pkg size={13}/>} label="ส่งออก Excel" onClick={() => pushToast(`กำลังส่งออก ${selectedCount} รายการ`)}/>
            <BulkBtn icon={<Icons.Trash size={13}/>} label="ลบ" onClick={bulkDelete} danger/>
          </div>
        </div>
      )}

      <div className="card card-tight">
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
            <th>SKU</th>
            <th>ชื่อสินค้า</th>
            <th>หมวดหมู่</th>
            <th>ตำแหน่ง</th>
            <th className="t-num">คงเหลือ</th>
            <th className="t-num">จอง</th>
            <th className="t-num">พร้อมขาย</th>
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
                  <td className="t-mono" onClick={() => setOpen(p.sku)}>{p.loc}</td>
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
                <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => { setQ(""); setCat("ทั้งหมด"); setStatusFilter("all"); }}>ล้างตัวกรอง</button>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Derive the live product every render so the drawer never shows stale data.
          If the product was deleted while open, openProduct becomes null → drawer closes. */}
      {(() => { const op = open ? liveProducts.find(p => p.sku === open) : null; return op ? <ProductDrawer product={op} onClose={() => setOpen(null)} pushToast={pushToast}/> : null; })()}
      {bulkOpen && <BulkEditModal count={selectedCount} products={products} categories={cats.filter(c => c !== "ทั้งหมด")} onClose={() => setBulkOpen(false)} onApply={applyBulkEdit}/>}
      {addOpen && <AddSkuModal products={products} categories={cats.filter(c => c !== "ทั้งหมด")} onClose={() => setAddOpen(false)} onAdd={addProduct}/>}
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
  const [vals, setVals] = useState({ cat: categories[0] || "", loc: "", supplier: "", reorder: 50 });
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
            hint="เช่น A-02-03 (จะใช้ค่าเดียวกันทุก SKU)"
          >
            <input className="input mono" value={vals.loc} onChange={e => setVals(v => ({ ...v, loc: e.target.value }))} placeholder="A-01-01" style={{ fontFamily: "IBM Plex Mono, monospace" }}/>
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

function AddSkuModal({ products, categories, onClose, onAdd }) {
  const suppliers = useMemo(() => [...new Set(products.map(p => p.supplier))], [products]);
  const brands    = useMemo(() => [...new Set(products.map(p => p.brand))].filter(Boolean), [products]);
  const [f, setF] = useState({
    sku: "", name: "",
    cat: categories[0] || "",
    brand: "",
    supplier: suppliers[0] || "",
    cost: "", price: "", qty: "", reorder: "50", loc: ""
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const skuTrim = f.sku.trim().toUpperCase();
  const dupe = skuTrim && products.some(p => p.sku.toUpperCase() === skuTrim);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const cost = num(f.cost), price = num(f.price), qty = num(f.qty), reorder = num(f.reorder);
  const canSave = skuTrim && !dupe && f.name.trim() && f.loc.trim() &&
    cost !== null && price !== null && qty !== null && reorder !== null;

  const margin = (cost !== null && price !== null && price > 0)
    ? Math.round((1 - cost / price) * 100) : null;

  const save = () => {
    if (!canSave) return;
    onAdd({
      sku: skuTrim, name: f.name.trim(), cat: f.cat,
      brand: (f.brand || "").trim(),
      supplier: f.supplier, cost, price,
      qty: Math.round(qty), reorder: Math.round(reorder),
      loc: f.loc.trim().toUpperCase()
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
            <input className="input" value={f.name} onChange={e => set("name", e.target.value)} placeholder="เช่น เสื้อยืดคอกลม Cotton 100%"/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>หมวดหมู่</label>
              <select className="input" value={f.cat} onChange={e => set("cat", e.target.value)}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>ผู้จัดส่ง</label>
              <select className="input" value={f.supplier} onChange={e => set("supplier", e.target.value)}>
                {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label>แบรนด์</label>
            <input className="input" value={f.brand} onChange={e => set("brand", e.target.value)}
              placeholder="เช่น 5.11, PS TACTICAL" list="addsku-brands"/>
            <datalist id="addsku-brands">{brands.map(b => <option key={b} value={b}/>)}</datalist>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>ต้นทุน (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" type="number" min="0" value={f.cost} onChange={e => set("cost", e.target.value)} placeholder="0" style={{ textAlign: "right" }}/>
            </div>
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
              <input className="input" type="number" min="0" value={f.reorder} onChange={e => set("reorder", e.target.value)} style={{ textAlign: "right" }}/>
            </div>
            <div className="field">
              <label>ตำแหน่ง <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input mono" value={f.loc} onChange={e => set("loc", e.target.value)} placeholder="A-01-01" style={{ fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}/>
            </div>
          </div>
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

function ProductDrawer({ product, onClose, pushToast }) {
  const [editOpen, setEditOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const s = stockStatus(product);
  const avail = product.qty - product.reserved;
  // fake movement history
  const moves = [
    { t: "วันนี้ 09:24", type: "in",  qty: +80, ref: "GR-26051901", who: "สมชาย" },
    { t: "เมื่อวาน 16:12", type: "out", qty: -2, ref: "SO-26051820", who: "ภาณุพงศ์" },
    { t: "เมื่อวาน 14:55", type: "out", qty: -1, ref: "SO-26051815", who: "ระบบ" },
    { t: "2 วันก่อน 10:14", type: "in", qty: +60, ref: "GR-26051704", who: "สมชาย" },
    { t: "3 วันก่อน 11:32", type: "out", qty: -4, ref: "SO-26051611", who: "วรรณา" }
  ];

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
            <Stat label="SKU" value={<span className="mono">{product.sku}</span>}/>
            <Stat label="หมวดหมู่" value={product.cat}/>
            <Stat label="ตำแหน่ง" value={<span className="mono">{product.loc}</span>}/>
            <Stat label="แบรนด์" value={product.brand || "—"}/>
            <Stat label="ผู้จัดส่ง" value={product.supplier}/>
            <Stat label="ราคาทุน" value={`฿${(product.cost ?? Math.round(product.price * 0.6)).toLocaleString()}`}/>
            <Stat label="ราคาขาย" value={`฿${product.price.toLocaleString()}`}/>
            <Stat label="กำไรต่อชิ้น" value={`฿${(product.price - (product.cost ?? Math.round(product.price * 0.6))).toLocaleString()} · ${Math.round((1 - (product.cost ?? product.price * 0.6) / product.price) * 100)}%`}/>
            <Stat label="จุดสั่งซื้อใหม่" value={product.reorder + " ชิ้น"}/>
          </div>

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

          <div style={{ marginTop: 18 }}>
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
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>บาร์โค้ดสินค้า</div>
              <button className="btn btn-sm"><Icons.Print size={13}/> พิมพ์บาร์โค้ด</button>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", textAlign: "center" }}>
              <Barcode value={product.sku} height={50}/>
              <div className="mono" style={{ fontSize: 12, marginTop: 4, letterSpacing: "0.06em" }}>{product.sku}</div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>การเคลื่อนไหวล่าสุด</div>
            <div className="stack" style={{ gap: 8 }}>
              {moves.map((m, i) => (
                <div key={i} className="row" style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, gap: 12 }}>
                  <ActivityDot type={m.type}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>{m.ref}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.t} · {m.who}</div>
                  </div>
                  <div className="tnum" style={{ fontSize: 14, fontWeight: 500, color: m.qty > 0 ? "var(--success)" : "var(--danger)" }}>
                    {m.qty > 0 ? "+" : ""}{m.qty}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn" onClick={() => setAdjOpen(true)}><Icons.Refresh size={14}/> ปรับสต็อก</button>
          <button className="btn btn-primary" onClick={() => setEditOpen(true)}><Icons.Edit size={14}/> แก้ไขข้อมูล</button>
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
          onApply={(delta, reason) => {
            const cur = PRODUCTS.find(p => p.sku === product.sku);
            const newQty = Math.max(0, (cur?.qty ?? product.qty) + delta);
            updateProductInStore(product.sku, { qty: newQty });
            try {
              const a = JSON.parse(localStorage.getItem("ims_stock_adj") || "{}");
              delete a[product.sku];
              localStorage.setItem("ims_stock_adj", JSON.stringify(a));
            } catch (e) {}
            pushToast(`ปรับสต็อก ${product.sku} ${delta > 0 ? "+" : ""}${delta} ชิ้น`);
            if (typeof recordChange === "function") {
              recordChange({
                entity: "product", entityId: product.sku, action: "update",
                summary: `ปรับสต็อก ${product.name} (${product.sku}) ${delta > 0 ? "+" : ""}${delta} ชิ้น`,
                changes: [{ label: "ปรับจำนวน", to: `${delta > 0 ? "+" : ""}${delta} ชิ้น` }],
                note: reason || ""
              });
            }
            setAdjOpen(false);
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
  const cost = num(f.cost), price = num(f.price), reorder = num(f.reorder);
  const canSave = f.name.trim() && f.loc.trim() && cost !== null && price !== null && reorder !== null;
  const margin = (cost !== null && price !== null && price > 0) ? Math.round((1 - cost / price) * 100) : null;

  const save = () => {
    if (!canSave) return;
    onSave({
      name: f.name.trim(), cat: f.cat, brand: (f.brand || "").trim(), supplier: f.supplier,
      cost, price, reorder: Math.round(reorder), loc: f.loc.trim().toUpperCase()
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>ต้นทุน (฿) <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" type="number" min="0" value={f.cost} onChange={e => set("cost", e.target.value)} style={{ textAlign: "right" }}/>
            </div>
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
              <input className="input" type="number" min="0" value={f.reorder} onChange={e => set("reorder", e.target.value)} style={{ textAlign: "right" }}/>
            </div>
            <div className="field">
              <label>ตำแหน่ง <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input mono" value={f.loc} onChange={e => set("loc", e.target.value)} style={{ fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}/>
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

/* Quick stock adjustment — applies a delta through the shared stock-adjustment layer */
function StockAdjustModal({ product, onClose, onApply }) {
  const [mode, setMode] = useState("add"); // add | remove | set
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const effQty = (typeof getEffectiveQty === "function") ? getEffectiveQty(product.sku) : product.qty;
  const n = parseInt(amount);
  const valid = Number.isFinite(n) && n >= 0;
  let delta = 0;
  if (valid) {
    if (mode === "add") delta = n;
    else if (mode === "remove") delta = -Math.min(n, effQty);
    else delta = n - effQty;
  }
  const resultQty = effQty + delta;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 300 }}/>
      <div className="modal" style={{ maxWidth: 440, zIndex: 301 }}>
        <div className="modal-head">
          <div>
            <h3>ปรับสต็อก</h3>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{product.name} · คงเหลือ {effQty} ชิ้น</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="seg" style={{ width: "100%" }}>
            <button className={mode === "add" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("add")}>เพิ่มเข้า</button>
            <button className={mode === "remove" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("remove")}>หักออก</button>
            <button className={mode === "set" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("set")}>ตั้งค่าเป็น</button>
          </div>
          <div className="field">
            <label>{mode === "set" ? "จำนวนคงเหลือใหม่" : "จำนวน (ชิ้น)"}</label>
            <input className="input" type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" style={{ textAlign: "right" }} autoFocus/>
          </div>
          <div className="field">
            <label>เหตุผล <span style={{ color: "var(--muted)", fontWeight: 400 }}>(ไม่จำเป็น)</span></label>
            <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ตรวจนับสต็อก, สินค้าเสียหาย"/>
          </div>
          {valid && (
            <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>คงเหลือหลังปรับ</span>
              <span className="tnum" style={{ fontSize: 20, fontWeight: 600, color: resultQty < 0 ? "var(--danger)" : "var(--fg)" }}>
                {effQty} → {Math.max(0, resultQty)}
              </span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn-primary" disabled={!valid || delta === 0} onClick={() => onApply(delta, reason)} style={(!valid || delta === 0) ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
            <Icons.Check size={14}/> ยืนยันปรับสต็อก
          </button>
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
function Locations() {
  const [selected, setSelected] = useState(null);
  const [locs, setLocs] = useState(loadLocations);
  const [view, setView] = useState("map");
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const h = () => setLocs(loadLocations());
    window.addEventListener("ims-locations-change", h);
    window.addEventListener("ims-products-change", h);
    return () => {
      window.removeEventListener("ims-locations-change", h);
      window.removeEventListener("ims-products-change", h);
    };
  }, []);

  // Live SKU counts from the actual product store
  const rows = locs.map(l => ({ ...l, skus: skusInLocation(l.code) }));
  const total = rows.length;
  const empty = rows.filter(l => l.fill === 0 && l.skus === 0).length;
  const active = total - empty;
  const avgFill = total ? Math.round(rows.reduce((s, l) => s + (l.fill || 0), 0) / total) : 0;
  const nearFull = rows.filter(l => l.fill >= 90).length;

  const cell = (c) => {
    let cls = "wh-cell";
    if (c.fill === 0) cls += " empty";
    else if (c.fill < 30) cls += " fill1";
    else if (c.fill < 70) cls += " fill2";
    else if (c.fill < 90) cls += " fill3";
    else cls += " fill4";
    return cls;
  };

  // group by zone
  const zones = {};
  rows.forEach(l => { (zones[l.code[0]] ||= []).push(l); });

  // Delete is admin/manager only (matches removeLocation's guard + DELETE RLS).
  const allowDelete = typeof canDeleteData === "function" ? canDeleteData() : true;
  const delLoc = (code) => { removeLocation(code); setSelected(null); };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ตำแหน่งจัดเก็บ</h1>
          <div className="page-sub">แผนผังคลังสินค้า • {Object.keys(zones).length} โซน · {total} ตำแหน่ง · อัตราการใช้พื้นที่ {avgFill}%</div>
        </div>
        <div className="row">
          <div className="seg">
            <button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>แผนผัง</button>
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>ตาราง</button>
          </div>
          <button className="btn" onClick={() => setAddOpen(true)}><Icons.Plus/> ตำแหน่งใหม่</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="ตำแหน่งใช้งาน" value={active + " / " + total} tone="info" hint={empty + " ตำแหน่งว่าง"}/>
        <SmallStat label="อัตราการใช้พื้นที่" value={avgFill + "%"} tone="success" hint="เฉลี่ยทุกตำแหน่ง"/>
        <SmallStat label="ตำแหน่งใกล้เต็ม" value={String(nearFull)} tone="warning" hint="≥ 90% — ต้องวางแผนย้ายสต็อก"/>
      </div>

      {view === "map" ? (
        <div className="card">
          <div className="row" style={{ marginBottom: 16, justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>แผนผังคลัง — ชั้น 1</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>คลิกที่ช่องเพื่อดูรายละเอียด</div>
            </div>
            <div className="row" style={{ gap: 12, fontSize: 11 }}>
              <Legend color="var(--surface-2)" label="ว่าง"/>
              <Legend color="oklch(0.97 0.02 150)" label="< 30%"/>
              <Legend color="oklch(0.93 0.05 150)" label="30 – 70%"/>
              <Legend color="oklch(0.87 0.08 75)" label="70 – 90%"/>
              <Legend color="oklch(0.82 0.12 30)" label="เต็ม"/>
            </div>
          </div>

          {total === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              ยังไม่มีตำแหน่งจัดเก็บ — กด "ตำแหน่งใหม่" เพื่อเพิ่ม
            </div>
          ) : (
            <div className="stack" style={{ gap: 18 }}>
              {Object.entries(zones).map(([z, cells]) => (
                <div key={z}>
                  <div className="row" style={{ marginBottom: 8, gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>โซน {z}</div>
                    <span className="badge badge-neutral">{cells.length} ตำแหน่ง</span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      เฉลี่ย {Math.round(cells.reduce((s,c)=>s+c.fill,0)/cells.length)}% เต็ม
                    </span>
                  </div>
                  <div className="wh-grid" style={{ gridTemplateColumns: `repeat(${cells.length}, 1fr)` }}>
                    {cells.map(c => (
                      <div key={c.code} className={cell(c)} onClick={() => setSelected(c)} title={c.code}>
                        <div className="lab">{c.code}</div>
                        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
                          <span style={{ fontSize: 9, color: c.fill > 89 ? "var(--fg)" : "var(--muted)" }}>{c.skus} SKU</span>
                          <span className="pct" style={{ color: c.fill > 89 ? "var(--fg)" : "inherit" }}>{c.fill}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 24, padding: 16, background: "var(--surface-2)", borderRadius: 12, fontSize: 12, color: "var(--muted)", display: "flex", gap: 16, alignItems: "center" }}>
            <Icons.Refresh size={16}/>
            <span>จำนวน SKU คำนวณจากสินค้าจริงที่อ้างอิงตำแหน่งนี้ — อัปเดตอัตโนมัติเมื่อแก้ไขตำแหน่งของสินค้า</span>
          </div>
        </div>
      ) : (
        <LocationTable rows={rows} onOpen={setSelected} onDelete={allowDelete ? delLoc : null}/>
      )}

      {selected && <LocationDrawer loc={{ ...selected, skus: skusInLocation(selected.code) }} onClose={() => setSelected(null)} onDelete={allowDelete ? delLoc : null}/>}
      {addOpen && <AddLocationModal existing={rows} onClose={() => setAddOpen(false)} onAdd={(code, fill) => { if (addLocation(code, fill)) { setAddOpen(false); } }}/>}
    </div>
  );
}

/* Table view of storage locations with live SKU counts + delete. */
function LocationTable({ rows, onOpen, onDelete }) {
  if (!rows.length) {
    return <div className="card" style={{ padding: "40px 16px", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ยังไม่มีตำแหน่งจัดเก็บ</div>;
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="table">
        <thead><tr>
          <th>รหัสตำแหน่ง</th><th>โซน</th><th>อัตราการใช้</th><th>SKU</th><th style={{ width: 1 }}/>
        </tr></thead>
        <tbody>
          {rows.map(l => (
            <tr key={l.code} style={{ cursor: "pointer" }} onClick={() => onOpen(l)}>
              <td className="mono" style={{ fontWeight: 500 }}>{l.code}</td>
              <td>โซน {l.code[0]}</td>
              <td>
                <div className="row" style={{ gap: 8 }}>
                  <div className="prog" style={{ width: 80, height: 6 }}><span style={{ width: l.fill + "%" }}/></div>
                  <span style={{ fontSize: 12 }}>{l.fill}%</span>
                </div>
              </td>
              <td className="tnum">{l.skus} รายการ</td>
              <td>
                {onDelete && (
                  <button className="btn btn-ghost btn-icon" title="ลบตำแหน่ง" onClick={(e) => { e.stopPropagation(); if (confirm(`ลบตำแหน่ง ${l.code}?`)) onDelete(l.code); }}>
                    <Icons.Trash size={13}/>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Add a new storage bin. Validates code format + duplicates. */
function AddLocationModal({ existing, onClose, onAdd }) {
  const [code, setCode] = useState("");
  const [fill, setFill] = useState("0");
  const c = code.trim().toUpperCase();
  const dupe = existing.some(l => l.code === c);
  const valid = /^[A-Z]-\d{2}-\d{2}$/.test(c);
  const canAdd = c && !dupe && valid;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 201, width: "100%", maxWidth: 420, padding: "0 16px" }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>เพิ่มตำแหน่งจัดเก็บ</div>
            <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X size={16}/></button>
          </div>
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>รหัสตำแหน่ง (โซน-แถว-ช่อง)</div>
              <input className="input mono" value={code} onChange={e => setCode(e.target.value)} placeholder="เช่น A-01-09" style={{ textTransform: "uppercase", width: "100%" }} autoFocus/>
              {c && !valid && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>รูปแบบต้องเป็น ตัวอักษร-ตัวเลข2หลัก-ตัวเลข2หลัก (เช่น B-02-05)</div>}
              {dupe && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4 }}>รหัสนี้มีอยู่แล้ว</div>}
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>อัตราการใช้พื้นที่เริ่มต้น (%)</div>
              <input className="input" type="number" min="0" max="100" value={fill} onChange={e => setFill(e.target.value)} style={{ width: "100%" }}/>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
            <button className="btn btn-ghost" onClick={onClose}>ยกเลิก</button>
            <button className="btn btn-primary" disabled={!canAdd} style={!canAdd ? { opacity: 0.5 } : {}} onClick={() => onAdd(c, fill)}>
              <Icons.Plus size={14}/> เพิ่มตำแหน่ง
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function LocationDrawer({ loc, onClose, onDelete }) {
  // Products actually stored in this exact bin (falls back to zone if none match)
  const exact = PRODUCTS.filter(p => (p.loc || "") === loc.code);
  const items = (exact.length ? exact : PRODUCTS.filter(p => (p.loc || "").startsWith(loc.code[0]))).slice(0, 6);

  // Print a bin label with a real, scannable QR of the location code (icons.jsx).
  const printLabel = () => {
    const svg = (typeof qrSvgMarkup === "function") ? qrSvgMarkup(loc.code, 360) : "";
    const w = window.open("", "_blank", "width=420,height=420");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ป้าย ${loc.code}</title>
      <style>
        @page { size: 50mm 50mm; margin: 0; }
        html,body { margin:0; padding:0; }
        body { font-family:'IBM Plex Mono',monospace; text-align:center; padding:4mm; }
        .qr { width:32mm; height:32mm; margin:0 auto 2mm; }
        .qr svg { width:100%; height:100%; display:block; }
        .code { font-size:18px; font-weight:600; letter-spacing:1px; }
      </style></head>
      <body onload="window.focus();window.print();">
        <div class="qr">${svg}</div>
        <div class="code">${loc.code}</div>
      </body></html>`);
    w.document.close();
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose}/>
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div className="eyebrow">ตำแหน่งจัดเก็บ</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{loc.code}</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icons.X/></button>
        </div>
        <div className="drawer-body">
          <div className="grid-2">
            <Stat label="อัตราการใช้" value={loc.fill + "%"}/>
            <Stat label="SKU ในตำแหน่ง" value={loc.skus + " รายการ"}/>
            <Stat label="โซน" value={"โซน " + loc.code[0]}/>
            <Stat label="ประเภท" value="ชั้นวาง · พาเลท"/>
          </div>
          <div className="prog" style={{ marginTop: 14 }}><span style={{ width: loc.fill + "%" }}/></div>

          <div style={{ marginTop: 22, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>สินค้าในตำแหน่งนี้</div>
          <div className="stack" style={{ gap: 6 }}>
            {items.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)", padding: 12, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>ตำแหน่งว่าง</div>}
            {items.map(p => (
              <div key={p.sku} className="row" style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku}</div>
                </div>
                <div className="tnum" style={{ fontSize: 14, fontWeight: 500 }}>{p.qty} ชิ้น</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22, fontWeight: 600, fontSize: 13, marginBottom: 8 }}>QR ตำแหน่ง</div>
          <div className="row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, gap: 14 }}>
            <QR value={loc.code} size={88}/>
            <div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{loc.code}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>สแกนเพื่อเปิดตำแหน่งบนมือถือ</div>
              <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={printLabel}><Icons.Print size={13}/> พิมพ์ป้าย QR</button>
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          {onDelete && (
            <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => { if (confirm(`ลบตำแหน่ง ${loc.code}?`)) onDelete(loc.code); }}>
              <Icons.Trash size={14}/> ลบตำแหน่ง
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose} style={{ marginLeft: "auto" }}>เสร็จสิ้น</button>
        </div>
      </div>
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

/* ========= SELL PRODUCT MODAL (3-step wizard) ========= */
function SellProductModal({ onClose, onSellComplete }) {
  const [step, setStep] = useState(1);
  const [cart, setCart] = useState([]);
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
      return [...prev, { type: "product", sku: p.sku, name: p.name, price: p.price, cat: p.cat, loc: p.loc, qty: 1 }];
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

  const cartErrors = cart.map(item => {
    const avail = item.type === "product" ? effQty(item.sku) : bMax(item);
    if (item.qty > avail) return `${item.name}: ต้องการ ${item.qty} แต่มีเพียง ${avail}`;
    return null;
  }).filter(Boolean);

  const shipValid = ship.name.trim() && ship.phone.trim() && ship.addr1.trim();

  const submitOrder = () => {
    const allDeductions = [];
    cart.forEach(item => {
      if (item.type === "product") {
        allDeductions.push({ sku: item.sku, qty: item.qty });
      } else {
        item.items.forEach(ci => { allDeductions.push({ sku: ci.sku, qty: ci.qty * item.qty }); });
      }
    });
    deductManyAndPersist(allDeductions);

    const orderId = (typeof genOrderId === "function" ? genOrderId() : "SO-" + Math.floor(Math.random() * 90000000 + 10000000));
    const ts = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
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
        note: `ผู้รับ: ${ship.name} · ${ship.addr1} · ${ship.carrier}`
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
      dateIso: (typeof TODAY_ISO !== "undefined") ? TODAY_ISO : new Date().toISOString().slice(0, 10),
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
    window.__pendingSellOrders = window.__pendingSellOrders || [];
    window.__pendingSellOrders.push(order);
    window.dispatchEvent(new CustomEvent("ims-sell-order", { detail: order }));

    // Also create the shipping label so the sale shows in ติดตามพัสดุ (labels are
    // the shipment source of truth there) — mirrors the mobile sell flow.
    if (typeof createSaleLabel === "function") {
      try {
        createSaleLabel({
          orderId,
          name: ship.name,
          phone: ship.phone,
          addr1: ship.addr1,
          addr2: [ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "),
          carrier: ship.carrier,
          cod: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
          items: order.lineItems,
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
            <button className="btn btn-primary" onClick={submitOrder}>
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
          <button className="btn" onClick={exportCsv} disabled={!summary.counted}><Icons.Pkg size={14}/> ส่งออก CSV</button>
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

Object.assign(window, { Inbound, Outbound, Inventory, Locations, Kpi, ActivityDot, Legend, MiniWarehouse, BulkField, SellProductModal, CameraScanner, StockTake, OcrNameButton });
