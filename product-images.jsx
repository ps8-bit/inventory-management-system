/* Product images: upload + automatic WebP conversion, mirrored into our own
   Supabase Storage bucket (see "Own storage" below); app_state img:<sku> rows
   hold the URL, localStorage is the offline seed.
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

/* ============ Own storage (Supabase Storage, bucket "product-images") ============
   Every photo ends up as an 800 px WebP file in our own bucket and the img:<sku>
   row keeps only its public URL — no dependence on Shopify/Shopline links that
   vanish, and no multi-hundred-KB data: URIs making the photo set slow to load.
   setProductImage / setProductImagesBulk save what they were given at once (so
   the photo shows immediately), then mirror it in the background and swap the
   row to our URL. An admin/manager device also moves old photos after load.
   Until supabase/product-images-storage.sql has been run the upload fails once,
   the run stops, and every photo simply keeps its current link. */
const PI_BUCKET = "product-images";
const _piOwnMark = "/storage/v1/object/public/" + PI_BUCKET + "/";
function isOwnProductPhoto(u) { return typeof u === "string" && u.indexOf(_piOwnMark) !== -1; }
function _piCanWrite() {
  const r = window.__currentUser && window.__currentUser.role;
  return r === "admin" || r === "manager" || r === "staff";
}
let _piStorageDown = false;            // bucket missing / forbidden → stop trying this session
const _piMirroring = new Set();

function _piLoadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    if (!/^(data|blob):/.test(src)) i.crossOrigin = "anonymous";
    const t = setTimeout(() => rej(new Error("timeout")), 20000);
    i.onload = () => { clearTimeout(t); res(i); };
    i.onerror = () => { clearTimeout(t); rej(new Error("load failed")); };
    i.src = src;
  });
}
async function _piToBlob(src, maxSize = 800) {
  const img = await _piLoadImage(src);
  const k = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const enc = (type, q) => new Promise(r => c.toBlob(r, type, q));
  // iOS Safari can't encode WebP (toBlob silently returns PNG) — use JPEG there.
  let blob = await enc("image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") blob = await enc("image/jpeg", 0.85);
  c.width = c.height = 0;
  if (!blob) throw new Error("encode failed");
  return blob;
}
async function _piUpload(sku, blob) {
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const safe = String(sku).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "sku";
  const path = `p/${safe}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const { error } = await sb.storage.from(PI_BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false });
  if (error) {
    // No bucket yet / not allowed: further attempts would fail the same way.
    if (/not found|bucket|row-level security|unauthorized|403|404/i.test(error.message || "")) _piStorageDown = true;
    throw error;
  }
  return sb.storage.from(PI_BUCKET).getPublicUrl(path).data.publicUrl;
}
function _piRemoveOwn(url) {
  if (!isOwnProductPhoto(url) || typeof sb === "undefined") return;
  const path = decodeURIComponent(url.split(_piOwnMark)[1] || "").split("?")[0];
  if (path) sb.storage.from(PI_BUCKET).remove([path]).catch(() => {});   // staff can't delete — harmless
}
/* Copy one SKU's photo into our bucket and point the row at it. Only swaps when
   the row still holds the photo we copied (a newer upload meanwhile wins). */
async function mirrorProductImage(sku, src) {
  if (!sku || !src || typeof src !== "string" || isOwnProductPhoto(src)) return false;
  if (_piStorageDown || typeof sb === "undefined" || !sb.storage || !_piCanWrite() || _piMirroring.has(sku)) return false;
  _piMirroring.add(sku);
  try {
    const url = await _piUpload(sku, await _piToBlob(src));
    if (loadProductImages()[sku] !== src) { _piRemoveOwn(url); return false; }
    _writeProductImage(sku, url);
    return true;
  } catch (e) {
    console.warn("[product-images] mirror", sku, e && e.message);
    return false;
  } finally { _piMirroring.delete(sku); }
}
/* Background move of photos that still live elsewhere — admin/manager only, a
   few at a time, once per app open; whatever fails is retried next open. */
let _piSweepStarted = false;
async function mirrorPendingProductImages(opts) {
  const force = opts && opts.force;
  if ((_piSweepStarted && !force) || _piStorageDown || typeof sb === "undefined") return { moved: 0, failed: 0, left: 0 };
  const role = window.__currentUser && window.__currentUser.role;
  if (role !== "admin" && role !== "manager") return { moved: 0, failed: 0, left: 0 };
  const map = loadProductImages();
  const todo = Object.keys(map).filter(s => map[s] && !isOwnProductPhoto(map[s]));
  if (!todo.length) return { moved: 0, failed: 0, left: 0 };
  _piSweepStarted = true;
  let moved = 0, failed = 0, i = 0;
  const work = async () => {
    while (i < todo.length && !_piStorageDown) {
      const sku = todo[i++];
      const cur = loadProductImages()[sku];
      if (!cur || isOwnProductPhoto(cur)) continue;
      (await mirrorProductImage(sku, cur)) ? moved++ : failed++;
      if (opts && opts.onProgress) opts.onProgress(moved, failed, todo.length);
    }
  };
  await Promise.all([work(), work(), work()]);
  if (moved) console.info(`[product-images] moved ${moved} photo(s) into storage` + (failed ? `, ${failed} failed (retried next open)` : ""));
  return { moved, failed, left: todo.length - moved };
}
let _piSweepTimer = null;
window.addEventListener("ims-images-change", () => {
  if (_piSweepStarted || _piSweepTimer) return;
  // Let the app settle (first paint, the rest of dbInit) before moving photos.
  _piSweepTimer = setTimeout(() => { _piSweepTimer = null; mirrorPendingProductImages(); }, 15000);
});

function setProductImage(sku, dataUrl) {
  const prev = (loadProductImages() || {})[sku];
  _writeProductImage(sku, dataUrl);
  if (typeof dataUrl === "string" && dataUrl && !isOwnProductPhoto(dataUrl)) mirrorProductImage(sku, dataUrl);
  // Replaced or removed: drop our old file (admin/manager; staff policy can't delete).
  if (prev && prev !== dataUrl && isOwnProductPhoto(prev)) _piRemoveOwn(prev);
}

function _writeProductImage(sku, dataUrl) {
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
    dbSaveState("img:" + sku, (dataUrl === undefined ? null : dataUrl))
      .then(r => { if (typeof cloudWriteFailed === "function") cloudWriteFailed(r, "รูปสินค้า"); })
      .catch(e => { if (typeof cloudWriteFailed === "function") cloudWriteFailed({ error: String(e) }, "รูปสินค้า"); });
  }
  window.dispatchEvent(new CustomEvent("ims-images-change"));
}

// Bulk-set images at once (e.g. from a WooCommerce catalog import). map = { sku: url }.
// One localStorage write + one re-render instead of N; each SKU's cloud row is
// still saved individually (the schema is one app_state row per SKU). A url of
// null/"" is skipped (use setProductImage to clear a single image). Returns the
// number applied.
function setProductImagesBulk(map) {
  if (!map || typeof map !== "object") return 0;
  const m = { ...loadProductImages() };
  let n = 0;
  Object.keys(map).forEach(sku => {
    const url = map[sku];
    if (!url) return;
    m[sku] = url; n++;
    if (typeof dbSaveState === "function") dbSaveState("img:" + sku, url)
      .then(r => { if (typeof cloudWriteFailed === "function") cloudWriteFailed(r, "รูปสินค้า"); })
      .catch(e => { if (typeof cloudWriteFailed === "function") cloudWriteFailed({ error: String(e) }, "รูปสินค้า"); });
  });
  if (!n) return 0;
  window._DB_PRODUCT_IMAGES = m;
  try { localStorage.setItem(PI_KEY, JSON.stringify(m)); } catch (e) {} // quota — cloud still has it
  window.dispatchEvent(new CustomEvent("ims-images-change"));
  // Copy the imported links into our own bucket, three at a time.
  const queue = Object.keys(map).filter(sku => map[sku] && !isOwnProductPhoto(map[sku]));
  const run = async () => { while (queue.length && !_piStorageDown) { const sku = queue.shift(); await mirrorProductImage(sku, map[sku]); } };
  run(); run(); run();
  return n;
}

function useProductImages() {
  const [images, setImages] = useStateImg(() => loadProductImages());
  const [, setTick] = useStateImg(0);
  useEffectImg(() => {
    const onImg = () => setImages(loadProductImages());
    // A WooCommerce-catalog import/backfill changes the fallback image source
    // (resolveProductImage) without touching ims_product_images — force a
    // re-render so thumbnails pick up newly-catalogued photos immediately.
    const onCat = () => setTick(t => t + 1);
    window.addEventListener("ims-images-change", onImg);
    window.addEventListener("ims-woo-catalog-change", onCat);
    return () => {
      window.removeEventListener("ims-images-change", onImg);
      window.removeEventListener("ims-woo-catalog-change", onCat);
    };
  }, []);
  return images;
}

// Resolve the image to DISPLAY for a SKU. An explicitly attached image
// (uploaded, or pulled into ims_product_images) always wins; otherwise fall
// back to the WooCommerce reference-catalog image so every catalogued product
// shows its photo even before one is attached to live stock. `images` is the
// map from useProductImages()/loadProductImages() (passed in to avoid a reload).
function resolveProductImage(sku, images) {
  const map = images || loadProductImages();
  let url = map[sku];
  if (!url && typeof wooCatalogLookup === "function") {
    const hit = wooCatalogLookup(sku);
    if (hit && hit.image) url = hit.image;
  }
  return url || "";
}

/* ============ Location photos (per-position bin/shelf photo) ============
   One photo per storage position, keyed by its full code string (locCode()),
   e.g. "สภ. › ชั้น 1 › A1". Mirrors the product-image sync model: cloud copy
   (app_state "locimg:<code>" rows) wins, localStorage is the offline seed. */

const LI_KEY = "ims_location_images";

function loadLocationImages() {
  if (window._DB_LOCATION_IMAGES && typeof window._DB_LOCATION_IMAGES === "object") return window._DB_LOCATION_IMAGES;
  try { return JSON.parse(localStorage.getItem(LI_KEY) || "{}"); }
  catch { return {}; }
}

function setLocationImage(code, dataUrl) {
  const m = { ...loadLocationImages() };
  if (dataUrl === null || dataUrl === undefined) delete m[code];
  else m[code] = dataUrl;
  window._DB_LOCATION_IMAGES = m;
  try { localStorage.setItem(LI_KEY, JSON.stringify(m)); }
  catch (e) { console.warn("Loc image storage failed", e); } // quota — cloud still has it
  if (typeof dbSaveState === "function") {
    dbSaveState("locimg:" + code, (dataUrl === undefined ? null : dataUrl))
      .then(r => { if (typeof cloudWriteFailed === "function") cloudWriteFailed(r, "รูปตำแหน่ง"); })
      .catch(e => { if (typeof cloudWriteFailed === "function") cloudWriteFailed({ error: String(e) }, "รูปตำแหน่ง"); });
  }
  window.dispatchEvent(new CustomEvent("ims-location-images-change"));
}

// Move a photo when a position/floor/building is renamed (its code changes) so
// the photo isn't orphaned under the old code. No-op if there's nothing to move.
function moveLocationImage(oldCode, newCode) {
  if (!oldCode || !newCode || oldCode === newCode) return;
  const m = loadLocationImages();
  const url = m[oldCode];
  if (url == null) return;
  setLocationImage(newCode, url);
  setLocationImage(oldCode, null);
}

function getLocationImage(code, map) { return (map || loadLocationImages())[code] || ""; }

function useLocationImages() {
  const [images, setImages] = useStateImg(() => loadLocationImages());
  useEffectImg(() => {
    const on = () => setImages(loadLocationImages());
    window.addEventListener("ims-location-images-change", on);
    return () => window.removeEventListener("ims-location-images-change", on);
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

/* Full-screen photo so a packer can check colour/model before picking. Mounted
   in its own root (like askForm) so it works from any screen; tap or Esc closes. */
function openProductImageViewer(url, caption) {
  if (!url) return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  // The phone's back button must close the photo, not change the screen under it:
  // push a same-URL history entry (no hashchange) and close on its popstate.
  let closed = false, pushed = false;
  const teardown = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", onPop);
    setTimeout(() => { try { root.unmount(); } catch (e) {} host.remove(); }, 0);
  };
  const onPop = () => teardown();
  const close = () => {
    if (closed) return;
    const ours = pushed && history.state && history.state.__imsPhoto;
    teardown();
    if (ours) history.back();          // drop our entry; popstate is already unhooked
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  try { history.pushState({ ...(history.state || {}), __imsPhoto: 1 }, ""); pushed = true; window.addEventListener("popstate", onPop); } catch (e) {}
  root.render(
    <div onClick={close} role="dialog" aria-label="ดูรูปสินค้า" style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, cursor: "zoom-out" }}>
      <img src={url} alt={caption || ""} style={{ maxWidth: "100%", maxHeight: "calc(100% - 60px)", objectFit: "contain", borderRadius: 8, background: "#fff" }}/>
      {caption && <div className="mono" style={{ color: "#fff", fontSize: 13, marginTop: 10, textAlign: "center", wordBreak: "break-word" }}>{caption}</div>}
      <div style={{ color: "rgba(255,255,255,.7)", fontSize: 12, marginTop: 6 }}>แตะเพื่อปิด</div>
    </div>
  );
}

/* zoom: tap opens the full-size photo (stops the tap reaching the row under it). */
/* addable: a product with no photo shows a "+ รูป" tile that picks/takes one in
   place (the tap never reaches the row under it). Only for roles that can write. */
function ProductImageThumb({ sku, size = 40, radius = 8, fallbackLabel, zoom, caption, addable }) {
  const images = useProductImages();
  const url = resolveProductImage(sku, images);
  const fileRef = useRefImg(null);
  const [busy, setBusy] = useStateImg(false);
  if (url) {
    const open = zoom ? (e) => { e.stopPropagation(); e.preventDefault(); openProductImageViewer(url, caption || sku); } : undefined;
    return (
      <div onClick={open} role={zoom ? "button" : undefined} title={zoom ? "แตะเพื่อดูรูปใหญ่" : undefined} style={{
        cursor: zoom ? "zoom-in" : undefined,
        width: size, height: size,
        borderRadius: radius,
        overflow: "hidden",
        background: "white",
        border: "1px solid var(--border)",
        flexShrink: 0,
        display: "grid", placeItems: "center"
      }}>
        <img src={url} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
      </div>
    );
  }
  if (addable && sku && _piCanWrite() && (typeof canDo !== "function" || canDo("editProduct"))) {
    const stop = (e) => { e.stopPropagation(); };
    const pick = (e) => { e.stopPropagation(); e.preventDefault(); if (!busy) fileRef.current?.click(); };
    const upload = async (file) => {
      if (!file) return;
      setBusy(true);
      try {
        const r = await fileToWebp(file, { maxSize: 1000, quality: 0.85 });
        setProductImage(sku, r.dataUrl);
        window.dispatchEvent(new CustomEvent("ims-toast", { detail: { msg: "เพิ่มรูปให้ " + sku + " แล้ว", type: "success" } }));
      } catch (err) {
        window.dispatchEvent(new CustomEvent("ims-toast", { detail: { msg: (err && err.message) || "เพิ่มรูปไม่สำเร็จ", type: "error" } }));
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    };
    return (
      <span onClick={pick} role="button" title="เพิ่มรูปสินค้า" style={{
        width: size, height: size, borderRadius: radius, flexShrink: 0,
        background: "var(--accent-soft)", color: "var(--accent)",
        border: "1.5px dashed var(--accent)", cursor: busy ? "wait" : "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontSize: Math.max(9, size * 0.24), fontWeight: 600, lineHeight: 1.1, gap: 1
      }}>
        {busy ? "…" : <><Icons.Plus size={Math.max(10, Math.round(size * 0.32))}/><span>รูป</span></>}
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onClick={stop} onChange={(e) => upload(e.target.files?.[0])}/>
      </span>
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
          // Absolutely positioned so the image fills the aspect-ratio box exactly and
          // can never push the container taller (a tall portrait photo was overflowing).
          <img src={current} alt={productName} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "white" }}/>
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

/* ============ Location photo thumbnail ============ */

function LocationImageThumb({ code, size = 40, radius = 8 }) {
  const images = useLocationImages();
  const url = getLocationImage(code, images);
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
        <img src={url} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size,
      borderRadius: radius,
      background: "var(--surface-2)",
      color: "var(--muted)",
      border: "1px dashed var(--border)",
      display: "grid", placeItems: "center",
      flexShrink: 0
    }}>
      <Icons.Camera size={Math.round(size * 0.4)}/>
    </div>
  );
}

/* ============ Location photo upload UI (camera or gallery) ============ */

function LocationImageUpload({ code, pushToast, size = "lg", compact }) {
  const images = useLocationImages();
  const current = images[code];
  const toast = pushToast || ((m) => window.dispatchEvent(new CustomEvent("ims-toast", { detail: m })));
  const cameraRef = useRefImg(null);
  const galleryRef = useRefImg(null);
  const [busy, setBusy] = useStateImg(false);

  const upload = async (file) => {
    if (!file) return;
    if (busy) return;
    setBusy(true);
    try {
      const result = await fileToWebp(file, { maxSize: 1000, quality: 0.85 });
      setLocationImage(code, result.dataUrl);
      toast("บันทึกรูปตำแหน่งแล้ว");
    } catch (err) {
      toast(err.message || "อัปโหลดไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    setLocationImage(code, null);
    toast("ลบรูปแล้ว");
  };

  const big = size === "lg";

  if (compact) {
    return (
      <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
        <div style={{
          position: "relative",
          width: 84, height: 84,
          flexShrink: 0,
          background: current ? "white" : "var(--surface-2)",
          border: "1.5px dashed var(--border-strong)",
          borderRadius: 12,
          overflow: "hidden"
        }}>
          {current ? (
            <img src={current} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", background: "white" }}/>
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <Icons.Camera size={22} style={{ color: "var(--muted)" }}/>
            </div>
          )}
          {busy && (
            <div style={{ position: "absolute", inset: 0, background: "oklch(0.99 0.005 250 / 0.85)", display: "grid", placeItems: "center" }}>
              <div style={{ width: 22, height: 22, border: "2.5px solid var(--surface-3)", borderTopColor: "var(--accent)", borderRadius: 999, animation: "spin 0.8s linear infinite" }}/>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }}/>
          <input ref={galleryRef} type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }}/>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "center" }}>
          {current ? (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => cameraRef.current?.click()}><Icons.Camera size={12}/> ถ่ายใหม่</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => galleryRef.current?.click()}><Icons.Refresh size={12}/> เปลี่ยนรูป</button>
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={remove}><Icons.Trash size={12}/> ลบ</button>
            </>
          ) : (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => cameraRef.current?.click()}><Icons.Camera size={12}/> ถ่ายรูป</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => galleryRef.current?.click()}><Icons.Plus size={12}/> เลือกรูป</button>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>ถ่ายรูปชั้นวางหรือเลือกจากคลังภาพ</span>
            </>
          )}
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: big ? "4 / 3" : "1 / 1",
          background: current ? "white" : "var(--surface-2)",
          border: "1.5px dashed var(--border-strong)",
          borderRadius: 14,
          display: "grid", placeItems: "center",
          overflow: "hidden"
        }}
      >
        {current ? (
          <img src={current} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "white" }}/>
        ) : (
          <div style={{ textAlign: "center", padding: 20 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--muted)", margin: "0 auto 10px" }}>
              <Icons.Camera size={20}/>
            </div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>เพิ่มรูปตำแหน่ง</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>ถ่ายรูปชั้นวางหรือเลือกจากคลังภาพ</div>
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
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }}/>
        <input ref={galleryRef} type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} style={{ display: "none" }}/>
      </div>

      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        {current ? (
          <>
            <button className="btn btn-sm" disabled={busy} onClick={() => cameraRef.current?.click()}><Icons.Camera size={12}/> ถ่ายใหม่</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => galleryRef.current?.click()}><Icons.Refresh size={12}/> เปลี่ยนรูป</button>
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={remove}><Icons.Trash size={12}/> ลบ</button>
            <div className="spacer"/>
            <span className="badge badge-success" style={{ fontSize: 10 }}><span className="dot"/>.webp</span>
          </>
        ) : (
          <>
            <button className="btn btn-sm" disabled={busy} onClick={() => cameraRef.current?.click()}><Icons.Camera size={12}/> ถ่ายรูป</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => galleryRef.current?.click()}><Icons.Plus size={12}/> เลือกรูป</button>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

Object.assign(window, {
  fileToWebp,
  setProductImage,
  mirrorProductImage,
  mirrorPendingProductImages,
  isOwnProductPhoto,
  setProductImagesBulk,
  loadProductImages,
  resolveProductImage,
  useProductImages,
  ProductImageUpload,
  ProductImageThumb,
  openProductImageViewer,
  setLocationImage,
  loadLocationImages,
  moveLocationImage,
  getLocationImage,
  useLocationImages,
  LocationImageUpload,
  LocationImageThumb
});
