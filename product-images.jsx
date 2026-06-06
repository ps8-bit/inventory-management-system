/* Product images: upload + automatic WebP conversion.
   Stores per-SKU image data URLs in localStorage.
   Subscribers re-render via a custom "ims-images-change" event. */

const { useState: useStateImg, useEffect: useEffectImg, useRef: useRefImg } = React;

const PI_KEY = "ims_product_images";

function loadProductImages() {
  // Cloud copy (synced via app_state "img:<sku>" rows) wins so every device shows
  // the same images; localStorage is an offline fallback / seed.
  if (window._DB_PRODUCT_IMAGES && typeof window._DB_PRODUCT_IMAGES === "object") return window._DB_PRODUCT_IMAGES;
  try { return JSON.parse(localStorage.getItem(PI_KEY) || "{}"); }
  catch { return {}; }
}

function setProductImage(sku, dataUrl) {
  const prev = loadProductImages();
  // Fresh object ref so useProductImages' setImages() actually re-renders.
  const m = { ...prev };
  if (dataUrl === null || dataUrl === undefined) delete m[sku];
  else m[sku] = dataUrl;
  window._DB_PRODUCT_IMAGES = m;
  try { localStorage.setItem(PI_KEY, JSON.stringify(m)); }
  catch (e) { console.warn("Image storage failed", e); } // quota — cloud still has it
  // Sync to Supabase (per-SKU app_state row); null clears it for every device.
  if (typeof dbSaveState === "function") {
    dbSaveState("img:" + sku, (dataUrl === undefined ? null : dataUrl)).catch(() => {});
  }
  window.dispatchEvent(new CustomEvent("ims-images-change"));
}

function useProductImages() {
  const [images, setImages] = useStateImg(() => loadProductImages());
  useEffectImg(() => {
    const handler = () => setImages(loadProductImages());
    window.addEventListener("ims-images-change", handler);
    return () => window.removeEventListener("ims-images-change", handler);
  }, []);
  return images;
}

/* ============ WebP conversion via Canvas ============ */

async function fileToWebp(file, { maxSize = 800, quality = 0.85 } = {}) {
  if (!file.type.startsWith("image/")) throw new Error("ไม่ใช่ไฟล์รูปภาพ");
  if (file.size > 10 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 10 MB");

  return new Promise((resolve, reject) => {
    const r1 = new FileReader();
    r1.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    r1.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("เปิดรูปภาพไม่ได้"));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        // White background for transparency-flattening (looks cleaner against various card backgrounds)
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("เบราว์เซอร์ไม่รองรับ WebP")); return; }
          const r2 = new FileReader();
          r2.onerror = () => reject(new Error("อ่านผลลัพธ์ไม่ได้"));
          r2.onload = () => resolve({
            dataUrl: r2.result,
            originalSize: file.size,
            originalType: file.type,
            originalName: file.name,
            newSize: blob.size,
            width: w, height: h,
            savings: 1 - blob.size / file.size
          });
          r2.readAsDataURL(blob);
        }, "image/webp", quality);
      };
      img.src = r1.result;
    };
    r1.readAsDataURL(file);
  });
}

const fmtBytes = (n) => {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
};

/* ============ Thumbnail component ============ */

function ProductImageThumb({ sku, size = 40, radius = 8, fallbackLabel }) {
  const images = useProductImages();
  const url = images[sku];
  if (url) {
    return (
      <div style={{
        width: size, height: size,
        borderRadius: radius,
        overflow: "hidden",
        background: "white",
        border: "1px solid var(--border)",
        flexShrink: 0,
        display: "grid", placeItems: "center"
      }}>
        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size,
      borderRadius: radius,
      background: "var(--surface-2)",
      color: "var(--fg-2)",
      border: "1px dashed var(--border)",
      display: "grid", placeItems: "center",
      fontSize: size * 0.28,
      fontWeight: 600,
      fontFamily: "IBM Plex Mono, monospace",
      flexShrink: 0
    }}>{fallbackLabel || (sku ? sku.slice(-3) : "?")}</div>
  );
}

/* ============ Upload UI (drag/drop or click) ============ */

function ProductImageUpload({ sku, productName, pushToast, size = "lg" }) {
  const images = useProductImages();
  const current = images[sku];
  const fileRef = useRefImg(null);
  const [busy, setBusy] = useStateImg(false);
  const [drag, setDrag] = useStateImg(false);
  const [lastConv, setLastConv] = useStateImg(null);

  const upload = async (file) => {
    if (!file) return;
    if (busy) return;
    setBusy(true);
    try {
      const result = await fileToWebp(file, { maxSize: 1000, quality: 0.85 });
      setProductImage(sku, result.dataUrl);
      setLastConv(result);
      pushToast(`แปลงเป็น .webp แล้ว · ลดขนาด ${Math.round(result.savings * 100)}%`);
    } catch (err) {
      pushToast(err.message || "อัปโหลดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    setProductImage(sku, null);
    setLastConv(null);
    pushToast("ลบรูปภาพแล้ว");
  };

  const big = size === "lg";

  return (
    <div>
      <div
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: big ? "4 / 3" : "1 / 1",
          background: current ? "white" : "var(--surface-2)",
          border: "1.5px dashed " + (drag ? "var(--accent)" : "var(--border-strong)"),
          borderRadius: 14,
          display: "grid", placeItems: "center",
          cursor: busy ? "wait" : "pointer",
          overflow: "hidden",
          transition: "border-color 0.15s, background 0.15s"
        }}
      >
        {current ? (
          <img src={current} alt={productName} style={{ width: "100%", height: "100%", objectFit: "contain", background: "white" }}/>
        ) : (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--muted)", margin: "0 auto 10px" }}>
              <Icons.Plus size={20}/>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>เพิ่มรูปภาพสินค้า</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>คลิกหรือลากไฟล์มาวาง</div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>JPG · PNG · GIF · ระบบจะแปลงเป็น .webp ให้</div>
          </div>
        )}
        {busy && (
          <div style={{ position: "absolute", inset: 0, background: "oklch(0.99 0.005 250 / 0.85)", display: "grid", placeItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 36, height: 36, border: "3px solid var(--surface-3)", borderTopColor: "var(--accent)", borderRadius: 999, animation: "spin 0.8s linear infinite", margin: "0 auto 8px" }}/>
              <div style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500 }}>กำลังแปลงเป็น .webp…</div>
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }}/>
      </div>

      {current && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}><Icons.Refresh size={12}/> เปลี่ยนรูป</button>
          <button className="btn btn-sm btn-danger" onClick={remove}><Icons.Trash size={12}/> ลบ</button>
          <div className="spacer"/>
          <span className="badge badge-success" style={{ fontSize: 10 }}><span className="dot"/>.webp</span>
        </div>
      )}

      {lastConv && (
        <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--success-soft)", color: "var(--success)", borderRadius: 10, fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ gap: 8 }}>
            <Icons.Check size={14}/>
            <span>แปลงเป็น .webp แล้ว · {lastConv.width}×{lastConv.height}px</span>
          </div>
          <div style={{ color: "var(--fg-2)" }}>
            <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{fmtBytes(lastConv.originalSize)}</span>
            {" → "}
            <strong className="tnum">{fmtBytes(lastConv.newSize)}</strong>
            <span style={{ marginLeft: 6, fontWeight: 600 }}>− {Math.round(lastConv.savings * 100)}%</span>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

Object.assign(window, {
  fileToWebp,
  setProductImage,
  loadProductImages,
  useProductImages,
  ProductImageUpload,
  ProductImageThumb
});
