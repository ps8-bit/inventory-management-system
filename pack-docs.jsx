/* แพ็คสินค้า — shipping documents for one order (ใบปะหน้า / ที่อยู่) + cancel.

   Extends the existing pack flow (packQueue / MPackOrder / PackQueue) with what
   the packer needs at the packing table:
     • the label file the owner attached (Shopee/Lazada/Flash slip — JPEG or PDF),
       viewable and printable;
     • the recipient (from the order's label when it was made with ขาย + จัดส่ง,
       else the order's own fields) with a printable 100×150 address label;
     • for the owner only: ยกเลิก + คืนสต็อก (cancelOrdersAndRestock in data.jsx),
       for an order the customer cancelled.

   Files live in table order_files (supabase/packer-role.sql), one row per order
   id, fetched on demand — never in realtime or backups. Attaching needs the
   "sell" capability (the people who create orders); a packer only views/prints.
   Both forks render <PackShipDocs> so desktop and mobile can't diverge. */

const { useState: useStatePD, useEffect: useEffectPD, useRef: useRefPD } = React;

const ORDER_FILE_MAX_PDF = 1.5 * 1024 * 1024;
const ORDER_FILE_TYPES = {
  "image/jpeg":      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/,
  "application/pdf": /^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/
};

/* ── storage ── */
function _pdDb() { return typeof sb !== "undefined" && sb; }
/* Only a real JPEG/PDF data URL may reach the DOM or a blob: a crafted
   "text/html" payload opened as a same-origin blob would run script. */
function safeOrderFile(f) {
  if (!f || !ORDER_FILE_TYPES[f.type] || !ORDER_FILE_TYPES[f.type].test(String(f.dataUrl || ""))) return null;
  return f;
}
const _orderFileCache = {};   // id → { at: updated_at, file }
async function loadOrderFileMeta(id) {
  if (!_pdDb() || !id) return null;
  const { data, error } = await sb.from("order_files").select("name, type, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}
async function loadOrderFile(id) {
  const meta = await loadOrderFileMeta(id);
  if (!meta) { delete _orderFileCache[id]; return null; }
  const c = _orderFileCache[id];
  if (c && c.at === meta.updated_at) return c.file;
  const { data, error } = await sb.from("order_files").select("name, type, data_url, updated_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);   // not cached → the retry button works
  const file = data ? safeOrderFile({ name: data.name, type: data.type, dataUrl: data.data_url }) : null;
  _orderFileCache[id] = { at: data ? data.updated_at : null, file };
  return file;
}
async function saveOrderFile(id, file) {
  if (!_pdDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  delete _orderFileCache[id];
  if (!file) {
    const { data, error } = await sb.from("order_files").delete().eq("id", id).select("id");
    if (error) return { error: error.message };
    return (data && data.length) ? { ok: true } : { error: "ไม่มีสิทธิ์ลบไฟล์" };
  }
  if (!safeOrderFile(file)) return { error: "ไฟล์ไม่ถูกต้อง" };
  const { data, error } = await sb.from("order_files")
    .upsert({ id, name: file.name || "", type: file.type, data_url: file.dataUrl, updated_at: new Date().toISOString() })
    .select("id");
  if (error) return { error: /row-level security/i.test(error.message) ? "ไม่มีสิทธิ์แนบไฟล์" : error.message };
  return (data && data.length) ? { ok: true } : { error: "ไม่มีสิทธิ์แนบไฟล์" };
}
/* Images → 1600px JPEG (canvas JPEG encoding works everywhere incl. iOS Safari,
   which can't encode WebP); PDFs kept as-is under the size cap. */
async function readOrderFile(file) {
  if (!file) return null;
  const asDataUrl = (f) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("อ่านไฟล์ไม่ได้")); fr.readAsDataURL(f); });
  if (file.type && file.type.startsWith("image/")) {
    if (file.size > 15 * 1024 * 1024) throw new Error("รูปใหญ่เกิน 15 MB");
    const src = await asDataUrl(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("เปิดรูปภาพไม่ได้")); i.src = src; });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL("image/jpeg", 0.85), name: file.name, type: "image/jpeg" };
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > ORDER_FILE_MAX_PDF) throw new Error("ไฟล์ PDF ใหญ่เกิน 1.5 MB");
    const dataUrl = String(await asDataUrl(file)).replace(/^data:[^;]*;/, "data:application/pdf;");
    return { dataUrl, name: file.name, type: "application/pdf" };
  }
  throw new Error("รองรับเฉพาะรูปภาพหรือ PDF");
}
function openOrderFile(file) {
  const f = safeOrderFile(file);
  if (!f) return;
  const bin = atob(f.dataUrl.split(",")[1] || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: f.type }));
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ── recipient ── the label made by ขาย + จัดส่ง carries the address; an order
   cut via ตัดสต็อก only has a name/phone. */
function packRecipientFor(order) {
  if (!order) return null;
  const labels = (typeof loadLabels === "function") ? loadLabels() : [];
  const idOf = (l) => (typeof orderIdForLabel === "function") ? orderIdForLabel(l) : (l.soId || l.id);
  const lab = labels.find(l => idOf(l) === order.id);
  const r = (lab && lab.recipient) || {};
  const locality = (typeof formatRecipientLocality === "function") ? formatRecipientLocality(r) : [r.tambon, r.amphoe, r.province, r.postal].filter(Boolean).join(" ");
  const addr = [r.addr1, r.addr2, locality].filter(Boolean).join(" ").trim();
  return {
    name: r.name || order.customer || "",
    phone: r.phone || order.phone || "",
    addr,
    cod: (lab && Number(lab.cod)) || 0,
    carrier: order.carrier || (lab && lab.carrier) || "",
    hasLabel: !!lab
  };
}

/* ── printing (same in-page technique as labels.jsx printLabels) ── */
function _escPD(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function _printPDHtml(innerHtml) {
  ["__pdPrintRoot", "__pdPrintStyle"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  const root = document.createElement("div");
  root.id = "__pdPrintRoot";
  root.innerHTML = innerHtml;
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.id = "__pdPrintStyle";
  style.textContent =
    "#__pdPrintRoot{display:none}" +
    "@page{size:100mm 150mm;margin:0}" +
    "@media print{html,body{margin:0!important;padding:0!important;background:#fff!important}" +
    "body>*{display:none!important}body>#__pdPrintRoot{display:block!important}" +
    "#__pdPrintRoot,#__pdPrintRoot *{letter-spacing:normal!important;color:#000;font-family:'Sarabun','IBM Plex Sans Thai','Leelawadee UI',Tahoma,sans-serif}}";
  document.head.appendChild(style);
  const cleanup = () => { try { root.remove(); style.remove(); } catch (e) {} window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  const imgs = Array.from(root.querySelectorAll("img"));
  Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
    .then(() => setTimeout(() => { try { window.focus(); window.print(); } catch (e) {} }, 60));
  setTimeout(cleanup, 60000);
}
function printOrderAddress(order, lines) {
  const s = (typeof storeSenderTemplate === "function") ? storeSenderTemplate() : {};
  const r = packRecipientFor(order) || {};
  const items = (lines || []).map(l => `${_escPD(l.name || l.sku)} ×${_escPD(l.qty)}`).join(", ");
  _printPDHtml(
    `<div style="width:100mm;height:150mm;box-sizing:border-box;padding:6mm;display:flex;flex-direction:column;gap:4mm;font-size:12pt;overflow:hidden">` +
      `<div style="font-size:9pt;border-bottom:1px dashed #000;padding-bottom:3mm"><b>ผู้ส่ง</b> ${_escPD(s.name)} ${_escPD(s.phone)}<br>${_escPD([s.addr1, s.addr2].filter(Boolean).join(" "))}</div>` +
      `<div style="flex:1"><div style="font-size:10pt"><b>ผู้รับ</b></div>` +
        `<div style="font-size:17pt;font-weight:700;margin-top:1mm">${_escPD(r.name)}</div>` +
        `<div style="font-size:14pt;font-weight:700">${_escPD(r.phone)}</div>` +
        `<div style="font-size:13pt;line-height:1.45;margin-top:2mm;white-space:pre-wrap">${_escPD(r.addr)}</div></div>` +
      (r.cod > 0 ? `<div style="border:2px solid #000;padding:2mm;font-size:15pt;font-weight:700;text-align:center">เก็บเงินปลายทาง ฿${_escPD(r.cod.toLocaleString())}</div>` : "") +
      `<div style="font-size:8.5pt;border-top:1px dashed #000;padding-top:2mm">${_escPD(order.id)}${r.carrier ? " · " + _escPD(r.carrier) : ""}<br>${items}</div>` +
    `</div>`);
}
function printOrderFile(file) {
  const f = safeOrderFile(file);
  if (!f) return;
  if (f.type === "application/pdf") { openOrderFile(f); return; }
  _printPDHtml(`<img src="${_escPD(f.dataUrl)}" style="width:100mm;height:150mm;object-fit:contain;display:block">`);
}

/* ── UI ── */
function PackShipDocs({ order, lines, pushToast, mobile, onCancelled }) {
  const [file, setFile] = useStatePD(null);
  const [state, setState] = useStatePD("loading");   // loading | none | ok | error
  const [busy, setBusy] = useStatePD(false);
  const [rev, setRev] = useStatePD(0);
  const inputRef = useRefPD(null);
  const canAttach = typeof canDo !== "function" || canDo("sell");
  const canCancel = typeof canDeleteData === "function" && canDeleteData();
  const r = packRecipientFor(order) || {};

  useEffectPD(() => {
    let alive = true;
    setState("loading");
    loadOrderFile(order.id)
      .then(f => { if (alive) { setFile(f); setState(f ? "ok" : "none"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [order.id, rev]);

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    try {
      const data = await readOrderFile(f);
      const res = await saveOrderFile(order.id, data);
      if (res.error) pushToast("แนบไฟล์ไม่สำเร็จ: " + res.error);
      else { pushToast("แนบใบปะหน้าแล้ว"); setRev(x => x + 1); }
    } catch (err) { pushToast(err.message || "แนบไฟล์ไม่สำเร็จ"); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm("ลบใบปะหน้าที่แนบไว้?")) return;
    setBusy(true);
    const res = await saveOrderFile(order.id, null);
    setBusy(false);
    if (res.error) pushToast(res.error); else { pushToast("ลบไฟล์แล้ว"); setRev(x => x + 1); }
  };
  const cancel = async () => {
    const pcs = (lines || []).reduce((n, l) => n + (Number(l.qty) || 0), 0);
    const note = prompt(`ลูกค้ายกเลิกออร์เดอร์ ${order.id}?\nสินค้า ${pcs} ชิ้นจะถูกคืนเข้าตำแหน่งเดิม\n\nเหตุผล (ไม่บังคับ):`, "ลูกค้ายกเลิก");
    if (note === null) return;
    setBusy(true);
    const res = (typeof cancelOrdersAndRestock === "function") ? await cancelOrdersAndRestock([order], note) : { ok: false };
    setBusy(false);
    if (res.blocked) { pushToast("ไม่มีสิทธิ์ยกเลิกออร์เดอร์"); return; }
    if (!res.ok) return;
    if (res.restocked && res.restocked.length) {
      if (typeof clearPackEntry === "function") clearPackEntry(order.id);
      pushToast(`ยกเลิก ${order.id} — คืนสต็อก ${res.pieces} ชิ้น` + (res.locError ? " (ปรับตำแหน่งไม่สำเร็จ: " + res.locError + ")" : ""));
      if (onCancelled) onCancelled();
    } else {
      pushToast("ออร์เดอร์นี้ไม่มีสินค้าที่ระบุ SKU หรือคืนสต็อกไปแล้ว — ยกเลิกที่หน้าจัดส่งสินค้าแทน");
    }
  };

  const card = mobile ? { className: "m-card", style: { padding: 14, marginTop: 12 } } : { className: "card", style: { padding: 14 } };
  const btn = "btn btn-sm";

  return (
    <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", gap: 12, flexWrap: "wrap", marginTop: mobile ? 0 : 12 }}>
      {/* attached label file */}
      <div {...card} style={{ ...card.style, flex: 1, minWidth: 240 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>ใบปะหน้าที่แนบ</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {file && <button className={btn} onClick={() => openOrderFile(file)}><Icons.Eye size={13}/> เปิด</button>}
            {file && <button className={btn} onClick={() => printOrderFile(file)}><Icons.Print size={13}/> พิมพ์</button>}
            {canAttach && <button className={btn} disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}><Icons.Plus size={13}/> {file ? "เปลี่ยน" : "แนบไฟล์"}</button>}
            {canAttach && file && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={remove}><Icons.Trash size={13}/></button>}
          </div>
        </div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={pick}/>
        {state === "loading" ? <div style={{ fontSize: 12, color: "var(--muted)" }}>กำลังโหลด…</div>
          : state === "error" ? <div style={{ fontSize: 12, color: "var(--danger)" }}>โหลดไฟล์ไม่ได้ <button className="btn btn-ghost btn-sm" onClick={() => setRev(x => x + 1)}>ลองใหม่</button></div>
          : !file ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{busy ? "กำลังอัปโหลด…" : canAttach ? "ยังไม่มีไฟล์ — แนบรูปหรือ PDF ใบปะหน้าจาก Shopee / Lazada / ขนส่ง" : "ไม่มีไฟล์แนบ — ใช้ที่อยู่ด้านล่าง"}</div>
          : file.type === "application/pdf" ? <div style={{ fontSize: 13 }}>📄 {file.name}</div>
          : <img src={file.dataUrl} alt="ใบปะหน้า" style={{ width: "100%", maxHeight: mobile ? 320 : 260, objectFit: "contain", borderRadius: 8, background: "#fff" }}/>}
      </div>

      {/* recipient */}
      <div {...card} style={{ ...card.style, flex: 1, minWidth: 240 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>ที่อยู่ผู้รับ</strong>
          <div className="row" style={{ gap: 6 }}>
            <button className={btn} disabled={!r.name && !r.addr} onClick={() => { const t = [r.name, r.phone, r.addr].filter(Boolean).join("\n"); if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => pushToast("คัดลอกที่อยู่แล้ว")).catch(() => {}); }}><Icons.Copy size={13}/> คัดลอก</button>
            <button className={btn} disabled={!r.addr} onClick={() => printOrderAddress(order, lines)}><Icons.Print size={13}/> พิมพ์ใบปะหน้า</button>
          </div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{r.name || "—"}</div>
        {r.phone && <div className="mono" style={{ fontSize: 13 }}>{r.phone}</div>}
        <div style={{ fontSize: 12.5, marginTop: 4, color: r.addr ? "var(--fg)" : "var(--muted)" }}>{r.addr || "ออร์เดอร์นี้ไม่มีที่อยู่ (สร้างจากขายออก/ตัดสต็อก) — ใช้ไฟล์ใบปะหน้าที่แนบ"}</div>
        {(r.cod > 0 || r.carrier) && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{r.carrier}{r.cod > 0 ? ` · COD ฿${r.cod.toLocaleString()}` : ""}</div>}
      </div>

      {canCancel && (
        <div style={{ flexBasis: "100%" }}>
          <button className="btn btn-sm btn-ghost" style={{ color: "var(--danger)" }} disabled={busy} onClick={cancel}>
            <Icons.X size={13}/> ลูกค้ายกเลิก — ยกเลิกออร์เดอร์และคืนสต็อก
          </button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  loadOrderFile, saveOrderFile, readOrderFile, safeOrderFile, openOrderFile,
  packRecipientFor, printOrderAddress, printOrderFile, PackShipDocs
});
