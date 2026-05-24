/* Dashboard, Inbound, Outbound, Inventory, Locations */

const { useState, useEffect, useRef, useMemo } = React;

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
  const lastRef   = useRef({ code: null, streak: 0 });
  const fileRef   = useRef(null);
  const [phase,    setPhase]   = useState("init"); // init | ready | photo | unsupported
  const [errMsg,   setErrMsg]  = useState("");
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    const isSecure    = window.isSecureContext ||
                        location.hostname === "localhost" ||
                        location.hostname === "127.0.0.1";
    const hasCamera   = !!navigator.mediaDevices?.getUserMedia;
    const hasDetector = "BarcodeDetector" in window;
    const hasZXing    = !!(window.ZXing?.MultiFormatReader);

    if (!hasDetector && !hasZXing) {
      setPhase("unsupported");
      setErrMsg(
        "เบราว์เซอร์ไม่รองรับการอ่านบาร์โค้ด\n" +
        "แนะนำ Chrome / Edge บน Android หรือ Safari 17.4+ บน iOS\n" +
        "หรือพิมพ์รหัส SKU ในช่องด้านล่างแทนได้เลย"
      );
      return;
    }

    /* Non-HTTPS LAN: getUserMedia is blocked by browser policy.
       Fall straight to photo mode — works over plain HTTP. */
    if (!isSecure || !hasCamera) { setPhase("photo"); return; }

    let dead = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const v = videoRef.current;
        if (!v) { stream.getTracks().forEach(t => t.stop()); return; }
        v.srcObject = stream;
        const tryPlay = () => v.play().catch(() => {});
        if (v.readyState >= 1) tryPlay(); else v.onloadedmetadata = tryPlay;

        /* Shared canvas — draw video frame here before every detect call */
        const scanCanvas = document.createElement("canvas");
        const scanCtx    = scanCanvas.getContext("2d", { willReadFrequently: true });
        const drawFrame  = (vid) => {
          const w = vid.videoWidth || 640, h = vid.videoHeight || 480;
          if (scanCanvas.width !== w)  scanCanvas.width  = w;
          if (scanCanvas.height !== h) scanCanvas.height = h;
          scanCtx.drawImage(vid, 0, 0, w, h);
        };

        let detectFn;
        if (hasDetector) {
          /* Always query supported formats so we never pass an unknown one */
          const allFmts = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","code_93","qr_code","data_matrix","itf","aztec"];
          const supported = await BarcodeDetector.getSupportedFormats().catch(() => allFmts);
          const fmts = allFmts.filter(f => supported.includes(f));
          const bd = new BarcodeDetector({ formats: fmts.length ? fmts : allFmts });
          detectFn = async (vid) => {
            drawFrame(vid);
            const h = await bd.detect(scanCanvas); // canvas, NOT video element
            return h.length ? h[0].rawValue : null;
          };
        } else {
          const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
          const reader = new ZXing.MultiFormatReader();
          reader.setHints(hints);
          detectFn = async (vid) => {
            drawFrame(vid);
            try {
              const id  = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
              const lum = new ZXing.RGBLuminanceSource(id.data, scanCanvas.width, scanCanvas.height);
              return reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum))).getText();
            } catch (_) { return null; }
          };
        }

        setPhase("ready");
        let busy = false; // prevent overlapping detect calls
        const scan = async () => {
          if (dead || busy) return;
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2 && !vid.paused) {
            busy = true;
            try {
              const val = await detectFn(vid);
              if (val && !dead) {
                const lr = lastRef.current;
                if (val === lr.code) {
                  lr.streak++;
                  if (lr.streak >= 2) {
                    dead = true; clearInterval(timerRef.current);
                    streamRef.current?.getTracks().forEach(t => t.stop());
                    onScan(val); return;
                  }
                } else { lastRef.current = { code: val, streak: 1 }; }
              }
            } catch (_) {}
            busy = false;
          }
        };
        timerRef.current = setInterval(scan, 250);

      } catch (_) {
        if (!dead) setPhase("photo"); // any camera error → photo mode
      }
    })();

    return () => {
      dead = true;
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  /* Decode a File using BarcodeDetector or ZXing */
  const decodeImageFile = (file) => new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      if ("BarcodeDetector" in window) {
        try {
          const allFmts = ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","code_93","qr_code","data_matrix","itf","aztec"];
          const supported = await BarcodeDetector.getSupportedFormats().catch(() => allFmts);
          const fmts = allFmts.filter(f => supported.includes(f));
          const hits = await new BarcodeDetector({ formats: fmts.length ? fmts : allFmts }).detect(canvas); // canvas, NOT img
          if (hits.length) { resolve(hits[0].rawValue); return; }
        } catch (_) {}
      }
      if (window.ZXing?.MultiFormatReader) {
        try {
          const id  = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const lum = new ZXing.RGBLuminanceSource(id.data, canvas.width, canvas.height);
          resolve(new ZXing.MultiFormatReader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum))).getText());
          return;
        } catch (_) {}
      }
      resolve(null);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true); setErrMsg("");
    const val = await decodeImageFile(file);
    if (val) { onScan(val); return; }
    setScanning(false);
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
        </div>
      )}

      {/* Mode B: photo capture — works over plain HTTP on LAN */}
      {phase === "photo" && (
        <div style={{ width:"100%", maxWidth:400, textAlign:"center" }}>
          <div style={{ fontSize:52, marginBottom:12, lineHeight:1 }}>📸</div>
          <div style={{ color:"white", fontSize:16, fontWeight:600, marginBottom:6 }}>สแกนผ่านกล้องถ่ายรูป</div>
          <div style={{ color:"rgba(255,255,255,0.5)", fontSize:12, marginBottom:20, lineHeight:1.7 }}>
            กดปุ่มด้านล่าง แล้วเล็งกล้องที่บาร์โค้ดให้ชัด<br/>
            ระบบอ่านบาร์โค้ดจากภาพให้อัตโนมัติ
          </div>
          {errMsg && (
            <div style={{ padding:"10px 16px", background:"rgba(255,80,80,0.15)", border:"1px solid rgba(255,80,80,0.3)", borderRadius:10, color:"#ff9090", fontSize:12, marginBottom:16, lineHeight:1.5 }}>
              {errMsg}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display:"none" }} onChange={handlePhoto}/>
          <button
            onClick={() => { setErrMsg(""); fileRef.current?.click(); }}
            disabled={scanning}
            style={{ padding:"14px 0", borderRadius:999, background:scanning?"#333":"white", color:scanning?"#666":"#111", border:"none", fontSize:15, fontWeight:600, cursor:scanning?"default":"pointer", width:"100%", transition:"background 0.15s" }}
          >
            {scanning ? "⏳  กำลังสแกน…" : "📷  ถ่ายรูปบาร์โค้ด / QR Code"}
          </button>
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
      <style>{`@keyframes camScan{0%,100%{top:8%}50%{top:80%}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

/* ========= INBOUND ========= */
function Inbound({ goTo, pushToast }) {
  const [received, setReceived] = useState([]);
  const [scan, setScan] = useState("");
  const [flash, setFlash] = useState(null);
  const [camOpen, setCamOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(null); // null | { changes }
  const [closed, setClosed] = useState(false); // true once job is committed
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submitScan = (override) => {
    const code = (override ?? scan).trim();
    if (!code) return;
    const p = PRODUCTS.find(x => x.sku.toLowerCase() === code.toLowerCase());
    if (!p) {
      setFlash({ sku: code, name: null, notFound: true });
      setTimeout(() => setFlash(null), 2500);
      setScan("");
      return;
    }
    const entry = { sku: p.sku, name: p.name, qty: 1, loc: p.loc, t: new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) };
    setReceived(prev => {
      const idx = prev.findIndex(r => r.sku === p.sku);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1, t: entry.t };
        return [next[idx], ...next.filter((_, i) => i !== idx)];
      }
      return [entry, ...prev];
    });
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
          <div className="page-sub">บันทึก GR-26051902 • PO-2025-0489 • Tech Wave Co. • กำลังตรวจนับ</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => alert("ดูประวัติการรับเข้าทั้งหมด")}><Icons.History/> ประวัติการรับเข้า</button>
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
          <button className="btn btn-accent" style={{ margin: 4 }} onClick={() => submitScan()}>บันทึก</button>
        </div>
        {camOpen && <CameraScanner onScan={code => { submitScan(code); setCamOpen(false); }} onClose={() => setCamOpen(false)}/>}

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
            <div className="row" style={{ padding: "10px 14px", background: "var(--danger-soft)", color: "var(--danger)", borderRadius: 10, fontSize: 13, fontWeight: 500 }}>
              <Icons.X size={18}/> ไม่พบ SKU: <span className="mono" style={{ marginLeft: 6 }}>{flash.sku}</span>
              <span style={{ fontWeight: 400, marginLeft: 6, fontSize: 12 }}>— กรุณาตรวจสอบรหัสสินค้า</span>
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
            <button className="btn btn-sm" onClick={() => alert("ส่งออก CSV ของการสแกนรับเข้า")}> ส่งออก CSV</button>
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
                <td><button className="btn btn-ghost btn-icon" onClick={() => alert("แก้ไขรายการรับเข้า: " + r.name)}><Icons.Edit size={14}/></button></td>
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
            <div className="sub">{INBOUND.length} เอกสาร</div>
          </div>
        </div>
        <table className="t">
          <thead><tr><th>เลขที่</th><th>PO</th><th>ผู้จัดส่ง</th><th className="t-num">รายการ</th><th className="t-num">จำนวน</th><th>เวลา</th><th>สถานะ</th></tr></thead>
          <tbody>
            {INBOUND.map(r => {
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
    carrier: (o.carrier && o.carrier !== "—") ? o.carrier : "Kerry Express",
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
    });

  // Status display helpers
  const STATUS_LABEL = { picking: "กำลังหยิบ", packed: "พร้อมส่ง", shipped: "ส่งแล้ว", delivered: "จัดส่งสำเร็จ" };
  const STATUS_CLS   = { picking: "badge-warning", packed: "badge-info", shipped: "badge-success", delivered: "badge-neutral" };

  const submitIssue = (data) => {
    const id = "SO-" + Math.floor(Math.random() * 90000000 + 10000000);
    const totalQty = data.deductions.reduce((s, d) => s + d.qty, 0);
    const primary = data.deductions[0];
    const channelLabel = data.deductions.length === 1 ? primary.name : `${data.deductions.length} ช่องทาง`;
    const ts = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

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
        items: bundle.items.length, status: "picking", carrier: "—", tracking: "—",
        ts, deductions: data.deductions, isBundle: true, bundleName: bundle.name,
        lineItems: bundle.items.map(it => {
          const p = PRODUCTS.find(x => x.sku === it.sku);
          return { sku: it.sku, name: p ? p.name : it.sku, qty: it.qty * totalQty };
        })
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
      items: data.deductions.length, status: "picking", carrier: "—", tracking: "—",
      ts, deductions: data.deductions, sku: data.sku,
      lineItems: [{ sku: data.sku, name: (PRODUCTS.find(p => p.sku === data.sku) || {}).name || data.sku, qty: totalQty }]
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
        <SmallStat label="ส่งแล้ว"    value={shippedCount}  tone="success" hint="Kerry · Flash · J&T · ไปรษณีย์"/>
      </div>

      {/* Channel breakdown */}
      <div className="card card-tight">
        <div className="card-head">
          <div>
            <h3>ยอดตัดสต็อกตามช่องทาง</h3>
            <div className="sub">วันนี้ • รวม {CHANNELS.reduce((s,c)=>s+c.today,0)} ออร์เดอร์</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => alert("ดูรายงานตัดสต็อกตามช่องทาง")}> ดูรายงาน <Icons.Chev size={14}/></button>
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
            <span style={{ width: 28, height: 28, borderRadius: 999, background: "oklch(0.99 0.003 250)", color: "var(--fg)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }} className="tnum">{pickedCount}</span>
            <span style={{ fontSize: 13, fontWeight: 500 }}>เลือก {pickedCount} ออร์เดอร์</span>
            <button onClick={clearPicked} style={{ background: "transparent", border: "none", color: "oklch(0.85 0.005 250)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>ล้างการเลือก</button>
          </div>
          <div className="spacer"/>
          <div className="row" style={{ gap: 6, position: "relative" }}>
            <BulkBtn icon={<Icons.Truck size={13}/>} label="อัปเดตสถานะ" onClick={() => setObBulkMenu(obBulkMenu === "status" ? null : "status")}/>
            <BulkBtn icon={<Icons.Tag size={13}/>}   label="สร้างฉลาก" onClick={() => { queueLabelsAndGo(orders.filter(o => picked[o.id]), goTo); pushToast(`สร้างฉลาก ${pickedCount} ใบ`); }}/>
            <BulkBtn icon={<Icons.Print size={13}/>} label="พิมพ์ pick list" onClick={() => {
              const toPrint = orders.filter(o => picked[o.id]);
              const w = window.open("", "_blank");
              w.document.write(`<!DOCTYPE html><html><head><title>Pick List</title><style>*{box-sizing:border-box}body{font-family:sans-serif;padding:24px;color:#111;font-size:13px}h2{margin:0 0 2px}p{margin:0 0 16px;color:#666}button{padding:8px 18px;cursor:pointer;margin-bottom:16px}table{width:100%;border-collapse:collapse}th{background:#f5f5f5;padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;font-size:12px;font-weight:600}td{padding:8px 10px;border-bottom:1px solid #eee}.mono{font-family:monospace;font-size:12px}@media print{button{display:none!important}}</style></head><body><h2>Pick List</h2><p>${new Date().toLocaleDateString("th-TH",{dateStyle:"full"})} · ${toPrint.length} ออร์เดอร์</p><button onclick="window.print()">🖨 พิมพ์</button><table><thead><tr><th>#</th><th>เลขออร์เดอร์</th><th>ลูกค้า</th><th>ช่องทาง</th><th>รายการ</th><th>ขนส่ง</th></tr></thead><tbody>${toPrint.map((o,i)=>`<tr><td class="mono">${i+1}</td><td class="mono">${o.id}</td><td>${o.customer||"—"}</td><td>${o.channel||"—"}</td><td style="text-align:center">${o.items}</td><td>${o.carrier||"—"}</td></tr>`).join("")}</tbody></table></body></html>`);
              w.document.close();
            }}/>
            <BulkBtn icon={<Icons.Trash size={13}/>} label="ลบ" onClick={bulkDeleteOrders} danger/>
            {obBulkMenu === "status" && (
              <div ref={null} style={{
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

  const cats = useMemo(() => ["ทั้งหมด", ...new Set(products.map(p => p.cat))], [products, stockKey]);
  const filtered = liveProducts.filter(p => {
    if (cat !== "ทั้งหมด" && p.cat !== cat) return false;
    const s = stockStatus(p).key;
    if (statusFilter !== "all" && s !== statusFilter) return false;
    if (q && !(p.sku.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase()) || p.supplier.toLowerCase().includes(q.toLowerCase()))) return false;
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

  const bulkDelete = () => {
    if (!confirm(`ลบสินค้าที่เลือก ${selectedCount} รายการ?`)) return;
    const removed = [...selectedSkus];
    removeProductsFromStore(removed);
    clearSelection();
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
          <button className="btn"><Icons.Print/> พิมพ์รายงาน</button>
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
            <span style={{ width: 28, height: 28, borderRadius: 999, background: "oklch(0.99 0.003 250)", color: "var(--fg)", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }} className="tnum">{selectedCount}</span>
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
  const [f, setF] = useState({
    sku: "", name: "",
    cat: categories[0] || "",
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
              onChange={e => set("sku", e.target.value)}
              placeholder="เช่น TH-APP-003"
              style={{ fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}
            />
            {dupe && <span className="hint" style={{ color: "var(--danger)" }}>SKU นี้มีอยู่แล้วในคลัง</span>}
          </div>

          <div className="field">
            <label>ชื่อสินค้า <span style={{ color: "var(--danger)" }}>*</span></label>
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
              <div style={{ fontWeight: 600, fontSize: 13 }}>สต็อกตามช่องทาง</div>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>30 วันที่ผ่านมา</span>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              {(() => {
                const breakdown = channelStockFor(product.sku);
                const totalSold = breakdown.reduce((s, c) => s + c.sold30d, 0);
                const totalReserved = breakdown.reduce((s, c) => s + c.reserved, 0);
                return (
                  <>
                    <div className="stack" style={{ gap: 8 }}>
                      {breakdown.map(c => {
                        const pct = totalSold ? (c.sold30d / totalSold * 100) : 0;
                        return (
                          <div key={c.id}>
                            <div className="row" style={{ justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                              <span className="row" style={{ gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 999, background: c.color }}/>
                                {c.name}
                              </span>
                              <span className="tnum" style={{ color: "var(--fg-2)" }}>
                                <strong style={{ color: "var(--fg)" }}>{c.sold30d}</strong> ขาย
                                {c.reserved > 0 && <span style={{ color: "var(--muted)", marginLeft: 6 }}>· {c.reserved} จอง</span>}
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
                      <span><strong className="tnum">{totalSold}</strong> ชิ้น · จอง {totalReserved} ชิ้น</span>
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
  const cats = useMemo(() => [...new Set(PRODUCTS.map(p => p.cat))], []);
  const suppliers = useMemo(() => [...new Set(PRODUCTS.map(p => p.supplier))], []);
  const [f, setF] = useState({
    name: product.name, cat: product.cat, supplier: product.supplier,
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
      name: f.name.trim(), cat: f.cat, supplier: f.supplier,
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
  LOCATIONS.forEach(l => {
    const z = l.code[0];
    (zones[z] ||= []).push(l);
  });

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">ตำแหน่งจัดเก็บ</h1>
          <div className="page-sub">แผนผังคลังสินค้า • 5 โซน · 40 ตำแหน่ง · อัตราการใช้พื้นที่ 68%</div>
        </div>
        <div className="row">
          <div className="seg">
            <button className="on">แผนผัง</button>
            <button onClick={() => alert("ส่วนตารางต้องติดตั้งเพิ่มเติม")}>ตาราง</button>
          </div>
          <button className="btn" onClick={() => alert("สร้างตำแหน่งจัดเก็บใหม่")}><Icons.Plus/> ตำแหน่งใหม่</button>
        </div>
      </div>

      <div className="grid-3">
        <SmallStat label="ตำแหน่งใช้งาน" value="34 / 40" tone="info" hint="6 ตำแหน่งว่าง"/>
        <SmallStat label="อัตราการใช้พื้นที่" value="68%" tone="success" hint="เพิ่มขึ้น 4% จากเดือนก่อน"/>
        <SmallStat label="ตำแหน่งใกล้เต็ม" value="4" tone="warning" hint="ต้องวางแผนย้ายสต็อก"/>
      </div>

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
                      <span style={{ fontSize: 9, color: c.fill > 89 ? "white" : "var(--muted)" }}>{c.skus} SKU</span>
                      <span className="pct" style={{ color: c.fill > 89 ? "white" : "inherit" }}>{c.fill}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, padding: 16, background: "var(--surface-2)", borderRadius: 12, fontSize: 12, color: "var(--muted)", display: "flex", gap: 16, alignItems: "center" }}>
          <Icons.Refresh size={16}/>
          <span>ระบบติดตามอัตโนมัติ — ยอดสต็อกจะถูกอัปเดตทันทีเมื่อมีการรับเข้า/จ่ายออก ปรับปรุงล่าสุด: 1 นาทีที่แล้ว</span>
        </div>
      </div>

      {selected && <LocationDrawer loc={selected} onClose={() => setSelected(null)}/>}
    </div>
  );
}

function LocationDrawer({ loc, onClose }) {
  // pick a few products for this location
  const items = PRODUCTS.filter(p => p.loc.startsWith(loc.code[0])).slice(0, 4);
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
              <button className="btn btn-sm" style={{ marginTop: 8 }}><Icons.Print size={13}/> พิมพ์ป้าย QR</button>
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn">ย้ายสต็อก</button>
          <button className="btn btn-primary"><Icons.Edit size={14}/> แก้ไข</button>
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
    carrier: "Kerry Express", cod: false, codAmt: "", notes: ""
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

    const orderId = "SO-" + Math.floor(Math.random() * 90000000 + 10000000);
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
      tracking: "—",
      ts,
      deductions: [{ id: "direct", name: "ขายตรง", color: "#8B5CF6", qty: cartTotal }],
      isSellOrder: true,
      isBundle: hasBundle,
      bundleName: hasBundle ? cart.filter(i => i.type === "bundle").map(i => i.name).join(", ") : undefined,
      shippingAddr: [ship.addr1, ship.addr2, ship.tambon, ship.amphoe, ship.province, ship.postal].filter(Boolean).join(" "),
      phone: ship.phone,
      codAmount: ship.cod ? (parseFloat(ship.codAmt) || 0) : 0,
      lineItems: cart.flatMap(item => item.type === "product"
        ? [{ sku: item.sku, name: item.name, qty: item.qty }]
        : item.items.map(ci => {
            const cp = PRODUCTS.find(x => x.sku === ci.sku);
            return { sku: ci.sku, name: cp ? cp.name : ci.sku, qty: ci.qty * item.qty };
          })
      )
    };
    window.__pendingSellOrders = window.__pendingSellOrders || [];
    window.__pendingSellOrders.push(order);
    window.dispatchEvent(new CustomEvent("ims-sell-order", { detail: order }));

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
                  const CARRIERS = ["Kerry Express","Flash Express","J&T Express","ไปรษณีย์ไทย","Ninja Van","DHL","Best Express","SCG Express","Alpha Fast","Lalamove"];
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

Object.assign(window, { Inbound, Outbound, Inventory, Locations, Kpi, ActivityDot, Legend, MiniWarehouse, BulkField, SellProductModal, CameraScanner });
