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
  // Pop-ups are often blocked (installed PWA, in-app browsers, some phones), and
  // the CSP forbids framing a blob — so when the new tab is refused, download
  // the file instead; the phone/PC then opens it in its own viewer to print.
  const w = window.open(url, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name || (f.type === "application/pdf" ? "label.pdf" : "label.jpg");
    document.body.appendChild(a); a.click(); a.remove();
    window.dispatchEvent(new CustomEvent("ims-toast", { detail: "ดาวน์โหลดใบปะหน้าแล้ว — เปิดไฟล์เพื่อพิมพ์" }));
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* Save the file to the device. Phones (iOS especially) ignore <a download> on
   a blob inside an installed PWA, so where the browser can share files we open
   the share sheet — "บันทึกรูปภาพ" / "บันทึกไปยังไฟล์" — else a plain download. */
async function downloadOrderFile(file, fallbackName) {
  const f = safeOrderFile(file);
  if (!f) return;
  const ext = f.type === "application/pdf" ? ".pdf" : ".jpg";
  let name = String(f.name || fallbackName || "file").replace(/[\/:*?"<>|]+/g, "_");
  if (!/\.(pdf|jpe?g)$/i.test(name)) name = name.replace(/\.[a-z0-9]{1,5}$/i, "") + ext;
  const bin = atob(f.dataUrl.split(",")[1] || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: f.type });
  const phone = (typeof _pdIsPhone === "function") ? _pdIsPhone() : /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (phone && typeof File === "function" && navigator.canShare) {
    try {
      const fileObj = new File([blob], name, { type: f.type });
      if (navigator.canShare({ files: [fileObj] })) { await navigator.share({ files: [fileObj] }); return; }
    } catch (e) {
      if (e && e.name === "AbortError") return;   // user closed the share sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  window.dispatchEvent(new CustomEvent("ims-toast", { detail: "ดาวน์โหลด " + name + " แล้ว" }));
}

/* ── attachments ── many photos/PDFs per order (order_attachments,
   supabase/order-attachments.sql). Unlike the single label slot above, the
   packer may add them too — e.g. a photo of the packed parcel as evidence. */
const ATTACH_ROLES = ["admin", "manager", "staff", "packer"];
function canAddOrderAttachment() {
  const role = (typeof currentRoleId === "function") ? currentRoleId() : "viewer";
  return ATTACH_ROLES.includes(role);
}
function canDeleteOrderAttachment(a) {
  const u = window.__currentUser || {};
  return ["admin", "manager", "staff"].includes(u.role) || (a && a.createdBy && a.createdBy === u.id);
}
async function loadOrderAttachments(orderId) {
  if (!_pdDb() || !orderId) return [];
  const { data, error } = await sb.from("order_attachments")
    .select("id, name, type, data_url, created_by, created_by_name, created_at")
    .eq("order_id", orderId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(r => {
    const f = safeOrderFile({ name: r.name, type: r.type, dataUrl: r.data_url });
    return f ? { ...f, id: r.id, createdBy: r.created_by, createdByName: r.created_by_name, createdAt: r.created_at } : null;
  }).filter(Boolean);
}
async function addOrderAttachment(orderId, file) {
  if (!_pdDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  if (!safeOrderFile(file)) return { error: "ไฟล์ไม่ถูกต้อง" };
  const by = (window.__currentUser && window.__currentUser.name) || "";
  const { data, error } = await sb.from("order_attachments")
    .insert({ order_id: orderId, name: file.name || "", type: file.type, data_url: file.dataUrl, created_by_name: by })
    .select("id");
  if (error) return { error: /row-level security/i.test(error.message) ? "ไม่มีสิทธิ์แนบไฟล์" : error.message };
  return (data && data.length) ? { ok: true } : { error: "ไม่มีสิทธิ์แนบไฟล์" };
}
async function deleteOrderAttachment(id) {
  if (!_pdDb()) return { error: "ไม่ได้เชื่อมต่อฐานข้อมูล" };
  const { data, error } = await sb.from("order_attachments").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  return (data && data.length) ? { ok: true } : { error: "ไม่มีสิทธิ์ลบไฟล์" };
}

/* Files of cancelled/deleted orders (called from cancelOrdersAndRestock). */
async function deleteOrderDocs(ids) {
  const list = (ids || []).filter(Boolean);
  if (!_pdDb() || !list.length) return;
  list.forEach(id => { delete _orderFileCache[id]; });
  await sb.from("order_files").delete().in("id", list);
  await sb.from("order_attachments").delete().in("order_id", list);
  refreshOrderFileIds().catch(() => {});
}

function PackAttachments({ orderId, pushToast, card }) {
  const [list, setList] = useStatePD([]);
  const [state, setState] = useStatePD("loading");   // loading | ok | error
  const [busy, setBusy] = useStatePD("");
  const [rev, setRev] = useStatePD(0);
  const inputRef = useRefPD(null);
  const canAdd = canAddOrderAttachment();

  useEffectPD(() => {
    let alive = true;
    setState("loading");
    loadOrderAttachments(orderId)
      .then(l => { if (alive) { setList(l); setState("ok"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [orderId, rev]);

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setBusy(`กำลังอัปโหลด ${i + 1}/${files.length}…`);
      try {
        const res = await addOrderAttachment(orderId, await readOrderFile(files[i]));
        if (res.error) pushToast(`${files[i].name}: ${res.error}`); else ok++;
      } catch (err) { pushToast(`${files[i].name}: ${err.message || "แนบไฟล์ไม่สำเร็จ"}`); }
    }
    setBusy("");
    if (ok) { pushToast(`แนบไฟล์แล้ว ${ok} ไฟล์`); setRev(x => x + 1); }
  };
  const remove = async (a) => {
    if (!confirm(`ลบไฟล์ "${a.name || "ไฟล์แนบ"}"?`)) return;
    setBusy("กำลังลบ…");
    const res = await deleteOrderAttachment(a.id);
    setBusy("");
    if (res.error) pushToast(res.error); else { pushToast("ลบไฟล์แล้ว"); setRev(x => x + 1); }
  };

  return (
    <div {...card} style={{ ...card.style, flexBasis: "100%" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>รูป / ไฟล์แนบ{list.length ? ` (${list.length})` : ""}</strong>
        {canAdd && <button className="btn btn-sm" disabled={!!busy} onClick={() => inputRef.current && inputRef.current.click()}><Icons.Camera size={13}/> เพิ่มรูป/ไฟล์</button>}
      </div>
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" style={{ display: "none" }} onChange={pick}/>
      {busy && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{busy}</div>}
      {state === "loading" ? <div style={{ fontSize: 12, color: "var(--muted)" }}>กำลังโหลด…</div>
        : state === "error" ? <div style={{ fontSize: 12, color: "var(--danger)" }}>โหลดไฟล์ไม่ได้ <button className="btn btn-ghost btn-sm" onClick={() => setRev(x => x + 1)}>ลองใหม่</button></div>
        : !list.length ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{canAdd ? "ยังไม่มีไฟล์ — ถ่ายรูปกล่องที่แพ็คแล้ว หรือแนบรูป/PDF ได้หลายไฟล์" : "ไม่มีไฟล์แนบ"}</div>
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {list.map(a => (
              <div key={a.id} style={{ position: "relative", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                <button onClick={() => openOrderFile(a)} title={`${a.name}${a.createdByName ? " · " + a.createdByName : ""}`}
                  style={{ display: "block", width: "100%", aspectRatio: "1", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
                  {a.type === "application/pdf"
                    ? <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#333", padding: 4, wordBreak: "break-all" }}><span style={{ fontSize: 26 }}>📄</span>{a.name}</div>
                    : <img src={a.dataUrl} alt={a.name || "ไฟล์แนบ"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 2px 2px 6px" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.createdByName || "—"}</span>
                  <button onClick={() => downloadOrderFile(a, "ไฟล์แนบ-" + orderId)} title="ดาวน์โหลด"
                    style={{ flexShrink: 0, width: 32, height: 28, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "var(--accent-soft)", color: "var(--accent)", cursor: "pointer", padding: 0 }}>
                    <Icons.Download size={14}/>
                  </button>
                </div>
                {canDeleteOrderAttachment(a) && (
                  <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => remove(a)} title="ลบ"
                    style={{ position: "absolute", top: 4, right: 4, padding: 4, background: "rgba(255,255,255,.9)", color: "var(--danger)" }}>
                    <Icons.Trash size={12}/>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

/* Which orders already have a label file — ids only (no payload), so every
   queue row can show "มีใบปะหน้า" / "แนบใบปะหน้า" without loading files. */
let _orderFileIds = null;
let _orderFileWatchers = 0, _orderFileTimer = null, _orderFileVis = null;   // one poller for every chip on screen
async function refreshOrderFileIds() {
  if (!_pdDb()) return;
  // Recent files only: a queue order is days old, and an unbounded select would
  // silently stop at PostgREST's 1000-row cap as the table grows.
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data, error } = await sb.from("order_files").select("id").gte("updated_at", since);
  if (error) return;
  _orderFileIds = new Set((data || []).map(r => r.id));
  window.dispatchEvent(new CustomEvent("ims-order-files-change"));
}
function useOrderFileIds() {
  const [, bump] = useStatePD(0);
  useEffectPD(() => {
    const h = () => bump(x => x + 1);
    window.addEventListener("ims-order-files-change", h);
    // order_files has no realtime feed: re-read when a queue mounts, when the app
    // comes back to the foreground, and once a minute while it's on screen, so a
    // label attached on another device shows up without restarting the app.
    const refresh = () => { if (document.visibilityState !== "hidden") refreshOrderFileIds().catch(() => {}); };
    _orderFileWatchers++;
    if (_orderFileWatchers === 1) {
      refresh();
      _orderFileTimer = setInterval(refresh, 60000);
      document.addEventListener("visibilitychange", refresh);
      _orderFileVis = refresh;
    }
    return () => {
      window.removeEventListener("ims-order-files-change", h);
      if (--_orderFileWatchers === 0) {
        clearInterval(_orderFileTimer);
        document.removeEventListener("visibilitychange", _orderFileVis);
      }
    };
  }, []);
  return _orderFileIds || new Set();
}
/* Inline status for a queue row: label file + address at a glance, and for the
   people who attach, an obvious "แนบใบปะหน้า" call to action. */
function PackDocChip({ order, onOpen }) {
  const ids = useOrderFileIds();
  const has = ids.has(order.id);
  const r = packRecipientFor(order) || {};
  const canAttach = typeof canDo !== "function" || canDo("sell");
  const chip = (bg, fg, text) => <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, background: bg, color: fg, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{text}</span>;
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginTop: 4 }} onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined}>
      {has ? chip("var(--success-soft)", "var(--success)", "📎 มีใบปะหน้า")
        : canUploadOrderFile() ? chip("var(--accent-soft)", "var(--accent)", "📎 แนบใบปะหน้า")
        : null}
      {r.addr ? chip("var(--info-soft)", "var(--info)", "📍 มีที่อยู่")
        : (!has && canAttach) ? chip("var(--surface-2)", "var(--muted)", "＋ ที่อยู่") : null}
    </span>
  );
}

/* Who may attach/replace a label file: everyone who can sell, plus the packer —
   the owner wants the packer to be able to photograph / upload the slip too.
   Deleting a file stays with sell roles (RLS: order_files delete excludes packer). */
function canUploadOrderFile() {
  if (typeof canDo !== "function") return true;
  if (canDo("sell")) return true;
  return typeof canOpenPage === "function" && canOpenPage("pack");
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
  // An address typed on the pack screen (order override `shipTo`) wins.
  const t = order.shipTo || {};
  return {
    name: t.name || r.name || order.customer || "",
    phone: t.phone || r.phone || order.phone || "",
    addr: t.addr || addr,
    // Street / locality kept apart so the printed label can break between them.
    addrLines: t.addr ? [t.addr] : [[r.addr1, r.addr2].filter(Boolean).join(" "), locality].map(s => (s || "").trim()).filter(Boolean),
    cod: (lab && Number(lab.cod)) || 0,
    carrier: order.carrier || (lab && lab.carrier) || "",
    hasLabel: !!lab
  };
}

/* Copy for the emergency hand-written / other-app label. navigator.clipboard is
   missing or refused on some phones (non-secure context, in-app browsers), so fall
   back to a hidden textarea + execCommand, and SAY when both fail — the old button
   swallowed the error and staff thought they had copied. */
function copyPackText(text, what, pushToast) {
  const t = String(text || "").trim();
  if (!t) return;
  const ok = () => pushToast && pushToast("คัดลอก" + (what || "") + "แล้ว");
  const legacy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, t.length);
      const done = document.execCommand("copy"); ta.remove();
      if (done) ok(); else throw new Error("copy");
    } catch (e) { pushToast && pushToast("คัดลอกไม่ได้ — กดค้างที่ข้อความเพื่อเลือกแล้วคัดลอกเอง"); }
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, legacy);
  else legacy();
}

/* ── printing (same in-page technique as labels.jsx printLabels) ── */
function _escPD(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function _printPDHtml(innerHtml, size, beforePrint) {
  const w = (size && size.w) || 100, h = (size && size.h) || 150;
  ["__pdPrintRoot", "__pdPrintStyle"].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
  const root = document.createElement("div");
  root.id = "__pdPrintRoot";
  root.innerHTML = innerHtml;
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.id = "__pdPrintStyle";
  // Thermal heads render thin strokes grey/broken: pure black, medium+ weights,
  // no anti-alias tinting, and the Thai font FIRST in the stack (iOS fallback).
  style.textContent =
    "#__pdPrintRoot{display:none}" +
    "@page{size:" + w + "mm " + h + "mm;margin:0}" +
    "@media print{html,body{margin:0!important;padding:0!important;background:#fff!important}" +
    "body>*{display:none!important}body>#__pdPrintRoot{display:block!important}" +
    "#__pdPrintRoot,#__pdPrintRoot *{letter-spacing:normal!important;color:#000!important;font-family:'IBM Plex Sans Thai','Sarabun','Leelawadee UI',Tahoma,sans-serif;" +
      "text-rendering:geometricPrecision;-webkit-font-smoothing:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}}";
  document.head.appendChild(style);
  const cleanup = () => { try { root.remove(); style.remove(); } catch (e) {} window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  const imgs = Array.from(root.querySelectorAll("img"));
  // Wait for the web font too — printing before it lands falls back to a thin system face.
  const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready.catch(() => {}) : Promise.resolve();
  Promise.all([fontsReady, ...imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))])
    .then(() => { if (beforePrint) { try { beforePrint(root); } catch (e) {} } })
    .then(() => setTimeout(() => { try { window.focus(); window.print(); } catch (e) {} }, 60));
  setTimeout(cleanup, 60000);
}

/* Paper for the printed ใบปะหน้า — remembered per device (it follows the printer). */
const PACK_LABEL_SIZES = [
  { id: "100x150", label: "100 × 150 มม.", w: 100, h: 150 },
  { id: "75x100",  label: "75 × 100 มม.",  w: 75,  h: 100 }
];
function packLabelSize() {
  let id = "";
  try { id = localStorage.getItem("ims_pack_label_size") || ""; } catch (e) {}
  return PACK_LABEL_SIZES.find(s => s.id === id) || PACK_LABEL_SIZES[0];
}
function setPackLabelSize(id) {
  try { localStorage.setItem("ims_pack_label_size", id); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-pack-label-size"));
}

/* What the printed ใบปะหน้า shows — set by the owner, stored in the shared
   store settings (store_settings.main.packLabel) so every device prints alike.
   The recipient block is always printed. */
const PACK_LABEL_FIELDS = [
  { group: "หัวใบ",  items: [["header", "หมายเลข Label / เลขออร์เดอร์"]] },
  { group: "ผู้ส่ง",  items: [["sender", "แสดงผู้ส่ง"], ["senderName", "ชื่อ"], ["senderAddr", "ที่อยู่"], ["senderPhone", "เบอร์โทร"]] },
  { group: "ผู้รับ",  items: [["recvPhone", "เบอร์โทร"], ["cod", "เก็บเงินปลายทาง (COD)"], ["carrier", "ขนส่ง"]] },
  { group: "สินค้า", items: [["items", "แสดงรายการสินค้า"], ["itemSku", "รหัส (SKU)"], ["itemName", "ชื่อสินค้า"], ["itemQty", "จำนวน"]] },
  { group: "โน้ต",   items: [["notes", "โน้ตเตือนพนักงาน (ออร์เดอร์ + ช่อง)"]] }
];
const PACK_LABEL_DEFAULT = { header: true, sender: true, senderName: true, senderAddr: true, senderPhone: true,
  recvPhone: true, cod: true, carrier: true, items: true, itemSku: true, itemName: true, itemQty: true, notes: true };
function packLabelConfig() {
  let st = window._DB_STORE;
  if (!st) { try { st = JSON.parse(localStorage.getItem("ims_store") || "null"); } catch (e) {} }
  return { ...PACK_LABEL_DEFAULT, ...((st && st.packLabel) || {}) };
}
function canEditPackLabel() {
  const u = window.__currentUser;
  return !!u && (u.role === "admin" || u.role === "manager");
}
/* Merge into the FULL store blob (never write packLabel alone — the row holds
   sender/shop info too), then announce it so the shells' store state follows. */
async function savePackLabelConfig(next) {
  let base = window._DB_STORE;
  if (!base) { try { base = JSON.parse(localStorage.getItem("ims_store") || "null"); } catch (e) {} }
  const prevStore = window._DB_STORE;
  const store = { ...(typeof DEFAULT_STORE !== "undefined" ? DEFAULT_STORE : {}), ...(base || {}), packLabel: next };
  window._DB_STORE = store;
  try { localStorage.setItem("ims_store", JSON.stringify(store)); } catch (e) {}
  window.dispatchEvent(new CustomEvent("ims-store-change"));
  const res = window.dbSaveStoreSettings ? await dbSaveStoreSettings(store).catch(e => ({ error: e.message })) : { ok: true };
  if (res && res.error) {
    window._DB_STORE = prevStore;
    try { if (prevStore) localStorage.setItem("ims_store", JSON.stringify(prevStore)); } catch (e) {}
    window.dispatchEvent(new CustomEvent("ims-store-change"));
    return { error: res.error };
  }
  return { ok: true };
}

/* Reminders for whoever packs this parcel: the order's own note, then each
   shelf note (packLocNote) for the shelves this order picks from, once each. */
function packLabelNotes(order, lines) {
  const out = [];
  // Owner's order note first — it's the instruction for THIS parcel.
  const own = (order && typeof packOrderNote === "function") ? packOrderNote(order.id) : null;
  if (own) out.push({ tag: "โน้ตออร์เดอร์", text: own.text });
  if (order && order.note) out.push({ tag: "หมายเหตุออร์เดอร์", text: String(order.note) });
  const seen = new Set();
  (lines || []).forEach(l => {
    if (!l || !l.loc || seen.has(l.loc)) return;
    seen.add(l.loc);
    const n = (typeof packLocNote === "function") ? packLocNote(l.loc) : null;
    if (n && n.text) out.push({ tag: "ช่อง " + ((l.parts && l.parts.pos) || l.loc), text: n.text });
  });
  return out;   // [{ tag, text }] — text may hold line breaks
}

/* Layout: หมายเลข Label + order no. │ ผู้ส่ง │ ผู้รับ (big) │ สินค้าที่ต้องแพ็ค.
   Sizes are in pt and scaled for the 75×100 roll, with a floor so nothing
   drops below what a 203-dpi thermal head prints legibly. */
function buildPackLabelHtml(order, lines, size, cfgOverride, recipOverride) {
  const small = size.w < 100;
  const pt = (n) => Math.max(small ? 8 : 9, Math.round(n * (small ? 0.8 : 1) * 2) / 2) + "pt";
  const pad = small ? 4 : 5.5;
  const rule = `border-top:${small ? 0.35 : 0.45}mm solid #000;margin:${small ? 2 : 2.8}mm 0`;
  const cap = `font-size:${pt(9)};font-weight:700;margin-bottom:${small ? 0.6 : 1}mm`;
  const s = (typeof storeSenderTemplate === "function") ? storeSenderTemplate() : {};
  const r = recipOverride || packRecipientFor(order) || {};
  const ref = (typeof orderShortId === "function") ? orderShortId(order) : order.id;
  const all = (lines || []).filter(l => l && (Number(l.qty) || 0) > 0);
  const maxRows = small ? 4 : 9;
  const shown = all.length > maxRows ? all.slice(0, maxRows - 1) : all;
  // Many item rows = less room: start the notes smaller so they, not the
  // address, give way (fitPackLabel shrinks them further via --nfit).
  const busy = shown.length >= (small ? 3 : 5);
  const noteBase = small ? (busy ? pt(8.5) : pt(9.5)) : (busy ? pt(9.5) : pt(10.5));
  // Never print a note below 7pt (a 203-dpi thermal head smears anything
  // smaller) — past that, fitPackLabel cuts lines instead of shrinking.
  const noteMin = Math.min(1, 7 / parseFloat(noteBase));
  const pcs = all.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  let addrLines = (r.addrLines && r.addrLines.length) ? r.addrLines : [r.addr].filter(Boolean);
  // A typed one-line address: start the locality (แขวง/ตำบล/ต.) on its own line.
  if (addrLines.length === 1) {
    const m = /\s(?=(?:แขวง|ตำบล|ต\.))/.exec(addrLines[0]);
    if (m && m.index > 0) addrLines = [addrLines[0].slice(0, m.index), addrLines[0].slice(m.index + 1)];
  }
  const one = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  const c = cfgOverride || packLabelConfig();
  // Recipient text scales by --fit; a long address shrinks until the label fits.
  const fit = (n) => `calc(${pt(n)} * var(--fit,1))`;
  const showSender = c.sender && ((c.senderName && s.name) || (c.senderAddr && (s.addr1 || s.addr2)) || (c.senderPhone && s.phone));
  const showItems = c.items && (c.itemSku || c.itemName || c.itemQty) && all.length > 0;
  const notes = c.notes ? packLabelNotes(order, lines) : [];
  // The last visible text column takes the free width; qty stays pinned right.
  const flexCol = c.itemName ? "name" : "sku";
  return (
    `<div class="__pdLbl" data-nmin="${noteMin.toFixed(2)}" style="width:${size.w}mm;height:${size.h}mm;box-sizing:border-box;padding:${pad}mm;display:flex;flex-direction:column;overflow:hidden;line-height:1.3;font-weight:500">` +
      // header
      (c.header ? `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:2mm">` +
        `<span style="font-size:${pt(9)};font-weight:700;white-space:nowrap">หมายเลข Label</span>` +
        `<span style="font-size:${pt(14)};font-weight:700;${one}">${_escPD(ref)}</span></div>` +
      `<div style="${rule}"></div>` : "") +
      // sender
      (showSender ? `<div style="${cap}">ผู้ส่ง</div>` +
      (c.senderName && s.name ? `<div style="font-size:${pt(12)};font-weight:700">${_escPD(s.name)}</div>` : "") +
      (c.senderAddr ? [s.addr1, s.addr2].filter(Boolean).map(a => `<div style="font-size:${pt(10)}">${_escPD(a)}</div>`).join("") : "") +
      (c.senderPhone && s.phone ? `<div style="font-size:${pt(10)}">โทร. ${_escPD(s.phone)}</div>` : "") +
      `<div style="${rule}"></div>` : "") +
      // recipient
      `<div style="${cap}">ผู้รับ</div>` +
      `<div style="font-size:${fit(19)};font-weight:700;line-height:1.25">${_escPD(r.name)}</div>` +
      addrLines.map(a => `<div style="font-size:${fit(13)};line-height:1.4;margin-top:0.6mm">${_escPD(a)}</div>`).join("") +
      (c.recvPhone && r.phone ? `<div style="font-size:${fit(14)};font-weight:700;margin-top:${small ? 0.8 : 1.4}mm">โทร. ${_escPD(r.phone)}</div>` : "") +
      (c.cod && r.cod > 0 ? `<div style="border:0.6mm solid #000;padding:1.2mm;margin-top:2mm;font-size:${pt(15)};font-weight:700;text-align:center">เก็บเงินปลายทาง ฿${_escPD(r.cod.toLocaleString())}</div>` : "") +
      (c.carrier && r.carrier ? `<div style="font-size:${pt(10)};font-weight:700;margin-top:1mm">ขนส่ง: ${_escPD(r.carrier)}</div>` : "") +
      // items
      (showItems ? `<div style="${rule}"></div>` +
      `<div style="${cap};display:flex;justify-content:space-between;gap:2mm"><span>สินค้าที่ต้องแพ็ค</span>` +
        `<span style="white-space:nowrap">${all.length} รายการ · รวม ${pcs} ชิ้น</span></div>` +
      shown.map(l =>
        `<div style="display:flex;gap:1.5mm;align-items:baseline;font-size:${pt(10.5)};margin-top:0.5mm">` +
          (c.itemSku ? `<span style="font-weight:700;${flexCol === "sku" ? "flex:1;min-width:0;" + one : "white-space:nowrap"}">${_escPD(l.sku || (c.itemName ? "" : l.name || ""))}</span>` : "") +
          (c.itemName ? `<span style="flex:1;min-width:0;${one}">${_escPD(l.name || "")}</span>` : "") +
          (!c.itemSku && !c.itemName ? `<span style="flex:1"></span>` : "") +
          (c.itemQty ? `<span style="font-weight:700;white-space:nowrap">× ${_escPD(l.qty)}</span>` : "") + `</div>`).join("") +
      (shown.length < all.length ? `<div style="font-size:${pt(10)};font-weight:700;margin-top:0.5mm">… และอีก ${all.length - shown.length} รายการ</div>` : "") : "") +
      // notes — boxed so they read as a warning, not part of the address
      // One block per note: a black tag (ออร์เดอร์ / ช่อง A) on its own line, the
      // text below at full width with its own line breaks kept. Side-by-side
      // squeezed long shelf tags and split Thai words on the 75×100 roll; the
      // 1.5 line-height keeps stacked Thai tone marks from touching.
      (notes.length ? `<div style="border:0.7mm solid #000;border-radius:1mm;padding:${small ? "0.8mm 1.4mm" : "1.2mm 1.8mm"};margin-top:${small ? 1.2 : 2}mm">` +
        notes.map((n, i) =>
          `<div class="__pdNB" style="${i ? `margin-top:${small ? 0.8 : 1.2}mm;padding-top:${small ? 0.8 : 1.2}mm;border-top:0.3mm dashed #000;` : ""}">` +
            `<span style="display:inline-block;background:#000;color:#fff;font-size:${pt(9)};font-weight:700;padding:0.3mm 1.4mm;border-radius:0.8mm;line-height:1.35">${_escPD(n.tag)}</span>` +
            // --nfit shrinks the NOTES first (fitPackLabel) so the address never pays
            // for a long note; blank lines are dropped on paper only.
            // Each line is its own .__pdNL so fitPackLabel can drop trailing lines
            // when even a shrunk note won't fit beside a long item list.
            `<div style="font-size:calc(${noteBase} * var(--nfit,1));font-weight:700;line-height:1.35;margin-top:${small ? 0.3 : 0.5}mm;word-break:break-word">` +
              String(n.text).replace(/\n\s*\n+/g, "\n").split("\n").map(t => `<div class="__pdNL">${_escPD(t) || "&nbsp;"}</div>`).join("") +
            `</div>` +
          `</div>`).join("") +
        `<div class="__pdNMore" style="display:none;font-size:${pt(8.5)};font-weight:700;margin-top:0.6mm">… ดูโน้ตเต็มในแอป</div>` +
      `</div>` : "") +
    `</div>`);
}
/* Phones (iOS Safari, Android Chrome, the installed PWA) ignore @page size:
   the print sheet lays the label out on A4/Letter and the printer app shrinks
   it, so it comes out smaller than the roll. There we build an exact-size PDF
   instead — the same proven path as the mobile ฉลาก screen (labelsToPDF) — and
   the phone's PDF viewer prints it at true size. */
function _pdIsPhone() {
  return document.documentElement.getAttribute("data-mobile") === "1"
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}
function _pdToast(msg) { window.dispatchEvent(new CustomEvent("ims-toast", { detail: msg })); }
async function _pdLabelPdf(html, size, name) {
  if (typeof labelsToPDF !== "function" || !window.jspdf) return false;
  // Lay out off-screen at real size in Sarabun — the face the rasteriser embeds —
  // so the fit measurement matches what lands in the PDF.
  const host = document.createElement("div");
  host.setAttribute("style", "position:fixed;left:-10000px;top:0;background:#fff;color:#000;letter-spacing:normal;font-family:'Sarabun','Leelawadee UI',Tahoma,sans-serif");
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    try { await document.fonts.ready; } catch (e) {}
    const lbl = host.firstElementChild;
    if (!lbl) return false;
    if (lbl.classList.contains("__pdLbl")) fitPackLabel(host);
    return await labelsToPDF([lbl], size, name, _pdToast);
  } finally { host.remove(); }
}
function printOrderAddress(order, lines, sizeId) {
  const size = PACK_LABEL_SIZES.find(x => x.id === sizeId) || packLabelSize();
  const html = buildPackLabelHtml(order, lines, size);
  if (_pdIsPhone()) {
    _pdToast("กำลังสร้างไฟล์ใบปะหน้า " + size.w + "×" + size.h + " มม.…");
    _pdLabelPdf(html, size, (order && order.id) || "label").then(ok => { if (!ok) _printPDHtml(html, size, fitPackLabel); });
    return;
  }
  _printPDHtml(html, size, fitPackLabel);
}
/* Shrink the recipient block step by step until nothing spills off the paper
   (floor 55% — still bigger than the sender/item text at that point). The
   root is display:none on screen, so measure it off-screen at real size. */
function fitPackLabel(root) {
  const lbl = root.querySelector(".__pdLbl");
  if (!lbl) return;
  const prev = root.getAttribute("style") || "";
  // Keep the caller's font while measuring — the PDF path lays out in Sarabun.
  root.setAttribute("style", "display:block;position:fixed;left:-10000px;top:0;font-family:" + (root.style.fontFamily || "'IBM Plex Sans Thai','Sarabun',Tahoma,sans-serif"));
  const over = () => lbl.scrollHeight > lbl.clientHeight + 1;
  // Start from the full note every time (the same node can be re-fitted).
  const nls = Array.from(lbl.querySelectorAll(".__pdNL"));
  const more = lbl.querySelector(".__pdNMore");
  const blocks = Array.from(lbl.querySelectorAll(".__pdNB"));
  nls.forEach(n => { n.style.display = ""; });
  blocks.forEach(b => { b.style.display = ""; });
  if (more) { more.style.display = "none"; more.style.marginTop = "0.6mm"; more.textContent = "… ดูโน้ตเต็มในแอป"; }
  // 1) Notes give way first (down to the 7pt floor) — the recipient is what the courier reads.
  let nf = 1;
  lbl.style.setProperty("--nfit", "1");
  const nmin = Math.max(0.6, parseFloat(lbl.getAttribute("data-nmin")) || 0.6);
  while (over() && nf - 0.05 >= nmin - 0.001) {
    nf = Math.round((nf - 0.05) * 100) / 100;
    lbl.style.setProperty("--nfit", String(nf));
  }
  // 2) Still too long (many items + long note): drop the note's last lines and
  //    say so — the full note is in the app. At least one line always stays.
  for (let k = nls.length - 1; over() && k >= 1; k--) {
    nls[k].style.display = "none";
    if (more) more.style.display = "block";
  }
  //    Even one line won't fit: collapse the box to a single pointer line, so the
  //    packer still knows there IS a note — never at the address's expense.
  if (over() && blocks.length && more) {
    blocks.forEach(b => { b.style.display = "none"; });
    more.style.display = "block";
    more.style.marginTop = "0";
    more.textContent = "มีโน้ตถึงคนแพ็ค — ดูในแอป";
  }
  // 3) Only then shrink the recipient block.
  let f = 1;
  lbl.style.setProperty("--fit", "1");
  while (lbl.scrollHeight > lbl.clientHeight + 1 && f > 0.55) {
    f = Math.round((f - 0.05) * 100) / 100;
    lbl.style.setProperty("--fit", String(f));
  }
  root.setAttribute("style", prev);
}
function printOrderFile(file) {
  const f = safeOrderFile(file);
  if (!f) return;
  if (f.type === "application/pdf") { openOrderFile(f); return; }
  const size = packLabelSize();
  const img = `<img src="${_escPD(f.dataUrl)}" style="width:${size.w}mm;height:${size.h}mm;object-fit:contain;display:block">`;
  if (_pdIsPhone() && window.jspdf) {
    // Same @page problem on phones: put the photo on an exact-size PDF page.
    const im = new Image();
    im.onload = () => {
      try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: "mm", format: [size.w, size.h], orientation: "portrait" });
        const k = Math.min(size.w / im.naturalWidth, size.h / im.naturalHeight);
        const w = im.naturalWidth * k, h = im.naturalHeight * k;
        pdf.addImage(f.dataUrl, (/png/i.test(f.type) ? "PNG" : "JPEG"), (size.w - w) / 2, (size.h - h) / 2, w, h);
        pdf.save(String(f.name || "label").replace(/\.[a-z0-9]+$/i, "").replace(/[/\\:*?"<>|]/g, "_") + "_" + size.id + ".pdf");
      } catch (e) { _printPDHtml(img, size); }
    };
    im.onerror = () => _printPDHtml(img, size);
    im.src = f.dataUrl;
    return;
  }
  _printPDHtml(img, size);
}


/* ONE shop-wide setting for every printed ใบปะหน้า — opened from the แพ็คสินค้า
   page header (desktop PackQueue + mobile MPack), never per order. Shows a live
   preview with sample data so the owner sees the effect before printing. */
const PACK_LABEL_SAMPLE = {
  order: { id: "SO-20261007-001", note: "ของแตกง่าย ห่อบับเบิ้ล 2 ชั้น" },
  lines: [{ sku: "PST-001", name: "กระเป๋าอเนกประสงค์", qty: 1 }, { sku: "AFG-OT33-BK", name: "เสื้อยืดแทคติคอล สีดำ L", qty: 2 }],
  recip: { name: "คุณสมชาย ใจดี", phone: "080-000-0000", addrLines: ["99/12 หมู่ 3 ซอยสุขใจ ถนนประชาอุทิศ", "แขวงทุ่งครุ เขตทุ่งครุ กรุงเทพมหานคร 10140"], cod: 0, carrier: "Flash Express" }
};
function PackLabelSettings({ pushToast, mobile, onClose }) {
  const [cfg, setCfg] = useStatePD(() => packLabelConfig());
  const [paper, setPaper] = useStatePD(() => packLabelSize().id);
  const [saving, setSaving] = useStatePD(false);
  const canEdit = canEditPackLabel();
  useEffectPD(() => {
    const h = () => setCfg(packLabelConfig());
    window.addEventListener("ims-store-change", h);
    return () => window.removeEventListener("ims-store-change", h);
  }, []);
  const toggle = async (k) => {
    if (!canEdit || saving) return;
    const prev = cfg, next = { ...cfg, [k]: !cfg[k] };
    setCfg(next); setSaving(true);
    const res = await savePackLabelConfig(next);
    setSaving(false);
    if (res.error) { setCfg(prev); if (pushToast) pushToast({ msg: "บันทึกการตั้งค่าใบปะหน้าไม่สำเร็จ — ตรวจสอบสิทธิ์", type: "error" }); }
  };
  const size = PACK_LABEL_SIZES.find(z => z.id === paper) || PACK_LABEL_SIZES[0];
  const html = buildPackLabelHtml(PACK_LABEL_SAMPLE.order, PACK_LABEL_SAMPLE.lines, size, cfg, PACK_LABEL_SAMPLE.recip);
  const pxPerMm = 3.78, scale = Math.min(1, (mobile ? 200 : 230) / (size.w * pxPerMm));
  return (
    <div className={mobile ? "m-card" : "card"} style={{ padding: 16, marginBottom: mobile ? 12 : 0 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <strong style={{ fontSize: 15 }}>⚙ ตั้งค่าใบปะหน้า</strong>
        {onClose && <button className="btn btn-sm btn-ghost" onClick={onClose}><Icons.X size={14}/></button>}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
        ตั้งครั้งเดียว ใช้กับใบปะหน้าทุกใบ ทุกเครื่อง · ชื่อและที่อยู่ผู้รับแสดงเสมอ
        {!canEdit && " · เฉพาะผู้ดูแล/ผู้จัดการแก้ไขได้"}
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 240px", minWidth: 220 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>ขนาดกระดาษ <span style={{ fontWeight: 400, color: "var(--muted)" }}>(ของเครื่องนี้)</span></div>
          <div className="row" style={{ gap: 6, marginBottom: 12 }}>
            {PACK_LABEL_SIZES.map(z => (
              <button key={z.id} className={"btn btn-sm" + (paper === z.id ? " btn-primary" : "")} onClick={() => { setPaper(z.id); setPackLabelSize(z.id); }}>{z.label}</button>
            ))}
          </div>
          {PACK_LABEL_FIELDS.map(g => (
            <div key={g.group} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>{g.group}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
                {g.items.map(([k, label]) => {
                  const off = !canEdit || (g.group === "ผู้ส่ง" && k !== "sender" && !cfg.sender) || (g.group === "สินค้า" && k !== "items" && !cfg.items);
                  return (
                    <label key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: mobile ? 14 : 13, cursor: off ? "default" : "pointer", opacity: off && canEdit ? 0.45 : 1, minHeight: mobile ? 34 : 0 }}>
                      <input type="checkbox" checked={!!cfg[k]} disabled={off} onChange={() => toggle(k)} style={{ width: 17, height: 17 }}/> {label}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{ flex: "0 0 auto", margin: mobile ? "0 auto" : 0 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>ตัวอย่าง (ข้อมูลสมมติ)</div>
          <div style={{ width: size.w * pxPerMm * scale, height: size.h * pxPerMm * scale, overflow: "hidden", boxShadow: "var(--elev-2, 0 2px 10px rgba(0,0,0,.15))", background: "#fff" }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", color: "#000", background: "#fff", fontFamily: "'IBM Plex Sans Thai','Sarabun',Tahoma,sans-serif", letterSpacing: "normal" }}
              dangerouslySetInnerHTML={{ __html: html }}/>
          </div>
        </div>
      </div>
    </div>
  );
}

/* One tap → print this order's label: the attached file if there is one, else
   the 100×150 address label. Used per parcel in the หยิบรวม sort step. */
function PackLabelButton({ order, lines, pushToast }) {
  const [busy, setBusy] = useStatePD(false);
  const go = async () => {
    setBusy(true);
    let file = null;
    try { file = await loadOrderFile(order.id); } catch (e) { pushToast("โหลดใบปะหน้าไม่ได้ — ลองใหม่"); setBusy(false); return; }
    setBusy(false);
    if (file) { printOrderFile(file); return; }
    const r = packRecipientFor(order) || {};
    if (r.addr) { printOrderAddress(order, lines); return; }
    pushToast("ออร์เดอร์นี้ยังไม่มีใบปะหน้าหรือที่อยู่");
  };
  return <button className="btn btn-sm" disabled={busy} onClick={go}><Icons.Print size={13}/> {busy ? "กำลังโหลด…" : "พิมพ์ใบปะหน้า"}</button>;
}

/* ── UI ── */
function PackShipDocs({ order, lines, pushToast, mobile, onCancelled }) {
  const [file, setFile] = useStatePD(null);
  const [state, setState] = useStatePD("loading");   // loading | none | ok | error
  const [busy, setBusy] = useStatePD(false);
  const [rev, setRev] = useStatePD(0);
  const inputRef = useRefPD(null);
  const canAttach = typeof canDo !== "function" || canDo("sell");
  const canUpload = canUploadOrderFile();
  const canCancel = typeof canDeleteData === "function" && canDeleteData();
  const r = packRecipientFor(order) || {};
  const [edit, setEdit] = useStatePD(null);   // null | { name, phone, addr, paste }
  const [paper, setPaper] = useStatePD(() => packLabelSize().id);
  useEffectPD(() => {
    const h = () => setPaper(packLabelSize().id);
    window.addEventListener("ims-pack-label-size", h);
    return () => window.removeEventListener("ims-pack-label-size", h);
  }, []);
  const startEdit = () => setEdit({ name: r.name || "", phone: r.phone || "", addr: r.addr || "", paste: "" });
  const splitPaste = () => {
    const p = (typeof parseRecipientBlob === "function") ? parseRecipientBlob(edit.paste) : null;
    if (!p) { pushToast("แยกที่อยู่ไม่ได้ — กรอกเองได้เลย"); return; }
    setEdit(e => ({ ...e, paste: "", name: p.name || e.name, phone: p.phone || e.phone, addr: [p.addr1, p.addr2].filter(Boolean).join(" ") || e.addr }));
  };
  const saveAddr = () => {
    if (typeof setOrderField !== "function") return;
    setOrderField(order.id, { shipTo: { name: edit.name.trim(), phone: edit.phone.trim(), addr: edit.addr.trim() } });
    setEdit(null);
    pushToast("บันทึกที่อยู่แล้ว");
  };

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
      else { pushToast("แนบใบปะหน้าแล้ว"); setRev(x => x + 1); refreshOrderFileIds().catch(() => {}); }
    } catch (err) { pushToast(err.message || "แนบไฟล์ไม่สำเร็จ"); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm("ลบใบปะหน้าที่แนบไว้?")) return;
    setBusy(true);
    const res = await saveOrderFile(order.id, null);
    setBusy(false);
    if (res.error) pushToast(res.error); else { pushToast("ลบไฟล์แล้ว"); setRev(x => x + 1); refreshOrderFileIds().catch(() => {}); }
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
            {file && <button className={btn} onClick={() => downloadOrderFile(file, "ใบปะหน้า-" + order.id)}><Icons.Download size={13}/> ดาวน์โหลด</button>}
            {file && <button className={btn} onClick={() => printOrderFile(file)}><Icons.Print size={13}/> พิมพ์</button>}
            {canUpload && <button className={btn} disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}><Icons.Plus size={13}/> {file ? "เปลี่ยน" : "แนบไฟล์"}</button>}
            {canAttach && file && <button className="btn btn-sm btn-ghost" disabled={busy} onClick={remove}><Icons.Trash size={13}/></button>}
          </div>
        </div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={pick}/>
        {state === "loading" ? <div style={{ fontSize: 12, color: "var(--muted)" }}>กำลังโหลด…</div>
          : state === "error" ? <div style={{ fontSize: 12, color: "var(--danger)" }}>โหลดไฟล์ไม่ได้ <button className="btn btn-ghost btn-sm" onClick={() => setRev(x => x + 1)}>ลองใหม่</button></div>
          : !file ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{busy ? "กำลังอัปโหลด…" : canUpload ? "ยังไม่มีไฟล์ — แนบรูปหรือ PDF ใบปะหน้าจาก Shopee / Lazada / ขนส่ง" : "ไม่มีไฟล์แนบ — ใช้ที่อยู่ด้านล่าง"}</div>
          : file.type === "application/pdf" ? <div style={{ fontSize: 13 }}>📄 {file.name}</div>
          : <img src={file.dataUrl} alt="ใบปะหน้า" style={{ width: "100%", maxHeight: mobile ? 320 : 260, objectFit: "contain", borderRadius: 8, background: "#fff" }}/>}
      </div>

      {/* recipient */}
      <div {...card} style={{ ...card.style, flex: 1, minWidth: 240 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
          <strong style={{ fontSize: 13 }}>ที่อยู่ผู้รับ</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {canAttach && !edit && <button className={btn} onClick={startEdit}><Icons.Edit size={13}/> {r.addr ? "แก้ไข" : "เพิ่มที่อยู่"}</button>}
            <button className={btn} disabled={!r.name && !r.addr} onClick={() => copyPackText([r.name, r.phone, r.addr].filter(Boolean).join("\n"), "ที่อยู่ทั้งหมด", pushToast)}><Icons.Copy size={13}/> คัดลอกทั้งหมด</button>
            <select className="input" value={paper} onChange={e => { setPaper(e.target.value); setPackLabelSize(e.target.value); }}
              title="ขนาดกระดาษใบปะหน้า" style={{ width: "auto", height: 30, padding: "0 6px", fontSize: 12 }}>
              {PACK_LABEL_SIZES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
            <button className={btn} disabled={!r.addr} onClick={() => printOrderAddress(order, lines, paper)}><Icons.Print size={13}/> พิมพ์ใบปะหน้า</button>
          </div>
        </div>
        {edit ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <textarea className="input" rows={2} value={edit.paste} onChange={e => setEdit({ ...edit, paste: e.target.value })} placeholder="วางที่อยู่ทั้งก้อนจากแชท/Shopee แล้วกด แยกอัตโนมัติ" style={{ flex: 1, resize: "vertical" }}/>
              <button className={btn} disabled={!edit.paste.trim()} onClick={splitPaste}>แยกอัตโนมัติ</button>
            </div>
            <input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="ชื่อผู้รับ"/>
            <input className="input" value={edit.phone} inputMode="tel" onChange={e => setEdit({ ...edit, phone: e.target.value })} placeholder="เบอร์โทร"/>
            <textarea className="input" rows={3} value={edit.addr} onChange={e => setEdit({ ...edit, addr: e.target.value })} placeholder="ที่อยู่ ตำบล อำเภอ จังหวัด รหัสไปรษณีย์" style={{ resize: "vertical" }}/>
            <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
              <button className={btn} onClick={() => setEdit(null)}>ยกเลิก</button>
              <button className="btn btn-sm btn-primary" disabled={!edit.name.trim() && !edit.addr.trim()} onClick={saveAddr}>บันทึกที่อยู่</button>
            </div>
          </div>
        ) : (
          <>
            {/* Each field copies on its own so it can go into a carrier app's separate boxes. */}
            <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, userSelect: "text", WebkitUserSelect: "text" }}>{r.name || "—"}</div>
              {r.name && <button className="btn btn-sm btn-ghost" title="คัดลอกชื่อ" onClick={() => copyPackText(r.name, "ชื่อ", pushToast)}><Icons.Copy size={12}/> ชื่อ</button>}
            </div>
            {r.phone && (
              <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
                <div className="mono" style={{ flex: 1, minWidth: 0, fontSize: 13, userSelect: "text", WebkitUserSelect: "text" }}>{r.phone}</div>
                <button className="btn btn-sm btn-ghost" title="คัดลอกเบอร์โทร" onClick={() => copyPackText(r.phone, "เบอร์โทร", pushToast)}><Icons.Copy size={12}/> เบอร์</button>
              </div>
            )}
            <div className="row" style={{ gap: 6, alignItems: "flex-start", marginTop: 4 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: r.addr ? "var(--fg)" : "var(--muted)", userSelect: "text", WebkitUserSelect: "text" }}>{r.addr || (canAttach ? "ยังไม่มีที่อยู่ — กด เพิ่มที่อยู่ หรือแนบไฟล์ใบปะหน้า" : "ไม่มีที่อยู่ — ใช้ไฟล์ใบปะหน้าที่แนบ")}</div>
              {r.addr && <button className="btn btn-sm btn-ghost" title="คัดลอกที่อยู่" onClick={() => copyPackText(r.addr, "ที่อยู่", pushToast)}><Icons.Copy size={12}/> ที่อยู่</button>}
            </div>
          </>
        )}
        {(r.cod > 0 || r.carrier) && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{r.carrier}{r.cod > 0 ? ` · COD ฿${r.cod.toLocaleString()}` : ""}</div>}
      </div>

      <PackAttachments orderId={order.id} pushToast={pushToast} card={card}/>

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

/* ── สั่งแพ็คใหม่ — ONE page: products + label/address + send ──
   The owner's ask: "จบที่หน้าเดียว ง่ายและเร็ว". Everything the packer needs is
   chosen here and committed through the existing sale choke point
   (commitIssueOrder → stock, shelves, history, order in the pack queue), then
   the label file / pasted address are attached to that order. Used by the
   desktop แพ็คสินค้า page (modal) and mobile (view "pack-new"). */
function PackNewOrder({ onClose, pushToast, mobile, addTo, user }) {
  // addTo = an order already in the pack queue → "เพิ่มรายการ" mode: same picker,
  // no label/address/channel step (the order has them), commit through
  // addItemsToPackOrder so only the ADDED lines are cut from stock.
  const [q, setQ] = useStatePD("");
  const [cart, setCart] = useStatePD([]);            // [{ key, type, sku?, id?, name, qty, items? }]
  const [file, setFile] = useStatePD(null);
  const [paste, setPaste] = useStatePD("");
  const [ch, setCh] = useStatePD(() => (typeof lastIssueChannel === "function" && lastIssueChannel()) || "other");
  const [busy, setBusy] = useStatePD(false);
  const sendingRef = useRefPD(false);   // sync latch: this commit moves stock
  const inputRef = useRefPD(null);

  const lq = q.trim().toLowerCase();
  const avail = (sku) => (typeof getEffectiveQty === "function" ? getEffectiveQty(sku) : ((PRODUCTS.find(p => p.sku === sku) || {}).qty || 0));
  // Always a full, scrollable list — typing only narrows it. Every word must
  // match (any order), so "ชุดเกราะ m" finds "ชุดเกราะ 55GEAR FCSK 3.0 [M]".
  // In-stock first; capped at 1000 rows (thumbnails are lazy).
  const words = lq.split(/\s+/).filter(Boolean);
  const match = (text) => { const t = String(text || "").toLowerCase(); return words.every(w => t.includes(w)); };
  const allHits = [
    ...((typeof loadBundles === "function" ? loadBundles() : []) || [])
      .filter(b => match(b.name))
      .map(b => ({ key: "b:" + b.id, type: "bundle", id: b.id, name: b.name, items: b.items, stock: typeof bundleAvail === "function" ? bundleAvail(b) : 0 })),
    ...PRODUCTS.filter(p => match((p.name || "") + " " + p.sku + " " + (p.cat || "")))
      .map(p => ({ key: "s:" + p.sku, type: "sku", sku: p.sku, name: p.name, stock: avail(p.sku) }))
  ].sort((a, b) => (b.stock > 0) - (a.stock > 0));
  const hits = allHits.slice(0, 1000);
  const add = (h) => {
    setCart(c => c.some(x => x.key === h.key) ? c.map(x => x.key === h.key ? { ...x, qty: x.qty + 1 } : x) : [...c, { ...h, qty: 1 }]);
  };
  const setQty = (key, n) => setCart(c => n <= 0 ? c.filter(x => x.key !== key) : c.map(x => x.key === key ? { ...x, qty: n } : x));

  // Stock check per sku (bundles expanded) — never let a send drive stock negative.
  const need = {};
  cart.forEach(x => {
    if (x.type === "bundle") (x.items || []).forEach(ci => { need[ci.sku] = (need[ci.sku] || 0) + (Number(ci.qty) || 0) * x.qty; });
    else need[x.sku] = (need[x.sku] || 0) + x.qty;
  });
  const short = Object.keys(need).filter(sku => need[sku] > avail(sku));

  const parsed = paste.trim() && typeof parseRecipientBlob === "function" ? parseRecipientBlob(paste) : null;
  const shipTo = paste.trim()
    ? (parsed ? { name: parsed.name || "", phone: parsed.phone || "", addr: [parsed.addr1, parsed.addr2].filter(Boolean).join(" ") || paste.trim() }
              : { name: "", phone: "", addr: paste.trim() })
    : null;
  const canSend = cart.length > 0 && !short.length && (addTo ? true : !!(file || shipTo)) && !busy;

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try { setFile(await readOrderFile(f)); } catch (err) { pushToast(err.message || "แนบไฟล์ไม่สำเร็จ"); }
  };

  const sendAdd = async () => {
    if (!canSend || typeof addItemsToPackOrder !== "function" || sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true);
    const lines = cart.map(x => x.type === "bundle"
      ? { type: "bundle", id: x.id, name: x.name, items: x.items, qty: x.qty }
      : { type: "sku", sku: x.sku, name: x.name, qty: x.qty, loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(PRODUCTS.find(p => p.sku === x.sku)) : "" });
    let res = null;
    try { res = await addItemsToPackOrder(addTo, lines, (user && user.name) || ""); }
    catch (e) { res = { ok: false, error: "เพิ่มรายการไม่สำเร็จ: " + (e.message || e) }; }
    sendingRef.current = false;
    setBusy(false);
    if (!res || !res.ok) { if (res && res.error) pushToast(res.error); return; }
    if (res.locError) pushToast("ตัดสต็อกแล้ว แต่ปรับตำแหน่งไม่สำเร็จ: " + res.locError);
    pushToast(`เพิ่ม ${res.lineCount} รายการ (${res.pieces} ชิ้น) เข้า ${addTo.id} แล้ว`);
    onClose();
  };

  const send = async () => {
    if (addTo) return sendAdd();
    if (!canSend || typeof commitIssueOrder !== "function" || sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true);
    window.__packPromptSkip = true;                      // this page already covers the popup
    const lines = cart.map(x => x.type === "bundle"
      ? { type: "bundle", id: x.id, name: x.name, items: x.items, qty: x.qty, ch }
      : { type: "sku", sku: x.sku, name: x.name, qty: x.qty, ch, loc: (typeof defaultPickLoc === "function") ? defaultPickLoc(PRODUCTS.find(p => p.sku === x.sku)) : "" });
    let id = null;
    try {
      // Only the warnings get through (shelf update failed / order waiting to sync);
      // the routine "ตัดสต็อก …" success line is replaced by our own toast below.
      const warn = (m) => { if (/ไม่สำเร็จ|ออนไลน์|ยังไม่ได้/.test(String(m))) pushToast(m); };
      id = await commitIssueOrder({ lines, customer: (shipTo && shipTo.name) || (file ? "ดูใบปะหน้า" : "ลูกค้า"), ship: { phone: shipTo ? shipTo.phone : "" } }, warn);
    } catch (e) { pushToast("สร้างออร์เดอร์ไม่สำเร็จ: " + (e.message || e)); }
    setTimeout(() => { window.__packPromptSkip = false; }, 1500);
    if (!id) { sendingRef.current = false; setBusy(false); return; }
    try { if (typeof rememberIssueChannel === "function") rememberIssueChannel(ch); } catch (e) {}
    if (shipTo && typeof setOrderField === "function") setOrderField(id, { shipTo });
    if (file) {
      const res = await saveOrderFile(id, file);
      if (res.error) pushToast("สร้างออร์เดอร์แล้ว แต่แนบไฟล์ไม่สำเร็จ: " + res.error + " — แนบใหม่ได้ที่หน้าแพ็คสินค้า");
      refreshOrderFileIds().catch(() => {});
    }
    setBusy(false);
    pushToast(`ส่งให้คนแพ็คแล้ว — ${id}`);
    onClose();
  };

  const sec = { fontSize: 13, fontWeight: 700, margin: "4px 0 8px" };
  const body = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        {addTo && (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--info-soft)", color: "var(--info)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 10 }}>
            เพิ่มสินค้าเข้าออร์เดอร์ <b className="mono">{addTo.id}</b>{addTo.customer ? " · " + addTo.customer : ""}<br/>
            ระบบจะตัดสต็อกเฉพาะรายการที่เพิ่ม และขึ้นป้าย <b>เพิ่มใหม่</b> ให้คนแพ็คเห็น
          </div>
        )}
        <div style={sec}>{addTo ? "สินค้าที่จะเพิ่ม" : "1. สินค้าที่ต้องแพ็ค"}</div>
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 พิมพ์ชื่อสินค้า หรือ SKU" style={{ width: "100%", fontSize: 15, padding: "12px 14px" }}/>
        <div style={{ fontSize: 11, color: "var(--muted)", margin: "6px 2px 4px" }}>
          {lq ? `พบ ${allHits.length} รายการ` : `สินค้าทั้งหมด ${allHits.length} รายการ — เลื่อนเลือก หรือพิมพ์ค้นหา`}{allHits.length > hits.length ? ` (แสดง ${hits.length} — พิมพ์เพิ่มเพื่อกรอง)` : ""}
        </div>
        {hits.length > 0 && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflowY: "auto", maxHeight: mobile ? 300 : 260, overscrollBehavior: "contain" }}>
            {hits.map(h => (
              <button key={h.key} onClick={() => add(h)} disabled={h.stock <= 0}
                style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", textAlign: "left", fontFamily: "inherit", cursor: h.stock > 0 ? "pointer" : "not-allowed", opacity: h.stock > 0 ? 1 : 0.5 }}>
                {h.type === "sku" && typeof ProductImageThumb === "function" ? <ProductImageThumb sku={h.sku} size={34}/> : <span style={{ width: 34, textAlign: "center" }}>📦</span>}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.type === "bundle" ? "ชุด: " : ""}{h.name}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{h.sku || "ชุดสินค้า"} · เหลือ {h.stock}</span>
                </span>
                {(() => { const inCart = cart.find(c => c.key === h.key); return inCart
                  ? <span style={{ fontSize: 13, color: "#fff", background: "var(--accent)", borderRadius: 999, padding: "2px 9px", fontWeight: 700 }}>{inCart.qty}</span>
                  : <span style={{ fontSize: 20, color: "var(--accent)", fontWeight: 700 }}>＋</span>; })()}
              </button>
            ))}
          </div>
        )}
        {cart.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {cart.map(x => (
              <div key={x.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "var(--surface-2)" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.type === "bundle" ? "ชุด: " : ""}{x.name}</span>
                <button className="btn btn-sm" style={{ width: 34, height: 34, justifyContent: "center", fontSize: 18 }} onClick={() => setQty(x.key, x.qty - 1)}>−</button>
                <span className="tnum" style={{ width: 26, textAlign: "center", fontSize: 17, fontWeight: 700 }}>{x.qty}</span>
                <button className="btn btn-sm" style={{ width: 34, height: 34, justifyContent: "center", fontSize: 18 }} onClick={() => setQty(x.key, x.qty + 1)}>＋</button>
              </div>
            ))}
            {short.length > 0 && <div style={{ fontSize: 12, color: "var(--danger)" }}>สต็อกไม่พอ: {short.join(", ")}</div>}
          </div>
        )}
      </div>

      {!addTo && <div>
        <div style={sec}>2. ใบปะหน้า หรือ ที่อยู่ <span style={{ fontWeight: 400, color: "var(--muted)" }}>(อย่างใดอย่างหนึ่ง)</span></div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={pick}/>
        {file ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "var(--success-soft)", color: "var(--success)", fontWeight: 600, fontSize: 14 }}>
            ✓ {file.name}
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setFile(null)}>เปลี่ยน</button>
          </div>
        ) : (
          <button onClick={() => inputRef.current && inputRef.current.click()}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, border: "2px dashed var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            📎 แนบใบปะหน้า <span style={{ fontWeight: 400, fontSize: 12 }}>(ถ่ายรูป / รูป / PDF)</span>
          </button>
        )}
        <textarea className="input" rows={3} value={paste} onChange={e => setPaste(e.target.value)}
          placeholder="📋 หรือวางที่อยู่ทั้งก้อนตรงนี้ (ชื่อ เบอร์ ที่อยู่) — ระบบแยกให้เอง"
          style={{ width: "100%", marginTop: 8, fontSize: 14, resize: "vertical" }}/>
        {shipTo && (shipTo.name || shipTo.phone) && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>✓ ผู้รับ: <b style={{ color: "var(--fg)" }}>{shipTo.name || "—"}</b> {shipTo.phone}</div>
        )}
      </div>}

      {!addTo && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>ช่องทาง:</span>
        {(typeof CHANNEL_LIST !== "undefined" ? CHANNEL_LIST : []).map(c => (
          <button key={c.id} onClick={() => setCh(c.id)}
            style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (ch === c.id ? "var(--fg)" : "var(--border)"), background: ch === c.id ? "var(--fg)" : "transparent", color: ch === c.id ? "var(--surface)" : "var(--fg-2)" }}>{c.name}</button>
        ))}
      </div>}
    </div>
  );
  const sendBtn = (
    <button onClick={send} disabled={!canSend}
      style={{ width: "100%", padding: 16, borderRadius: 14, border: "none", background: canSend ? "var(--accent)" : "var(--surface-2)", color: canSend ? "#fff" : "var(--muted)", fontSize: 17, fontWeight: 800, cursor: canSend ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
      {busy ? "กำลังส่ง…" : cart.length === 0 ? "เลือกสินค้าก่อน"
        : addTo ? (short.length ? "สต็อกไม่พอ" : `เพิ่มเข้าออร์เดอร์ (${cart.reduce((s, x) => s + x.qty, 0)}) ✓`)
        : !(file || shipTo) ? "แนบใบปะหน้าหรือวางที่อยู่" : "ส่งให้คนแพ็ค ✓"}
    </button>
  );

  if (mobile) {
    return (
      <>
        <div className="m-topbar">
          <button className="m-back" onClick={onClose}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
          <div className="m-title-sub">{addTo ? "เพิ่มรายการ " + addTo.id : "สั่งแพ็คใหม่"}</div>
          <span style={{ width: 30 }}/>
        </div>
        <div className="m-content" style={{ paddingTop: 10 }}>
          {body}
          <div style={{ marginTop: 18 }}>{sendBtn}</div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 90 }}/>
      <div className="modal" style={{ zIndex: 91, width: 560, maxHeight: "92vh" }}>
        <div className="modal-head">
          <h3>{addTo ? <>เพิ่มรายการ <span className="mono">{addTo.id}</span></> : "สั่งแพ็คใหม่"}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icons.X size={14}/></button>
        </div>
        <div className="modal-body">{body}</div>
        <div className="modal-foot" style={{ display: "block" }}>{sendBtn}</div>
      </div>
    </>
  );
}
function MPackNew({ ctx }) { return <PackNewOrder mobile pushToast={ctx.pushToast} onClose={ctx.back}/>; }
/* Mobile เพิ่มรายการ (view "pack-add", params.id) — the order is re-read live so a
   stale route can't add to an order another device already packed. */
function MPackAdd({ ctx }) {
  const id = (ctx.route.params && ctx.route.params.id) || "";
  const all = (typeof buildOrders === "function") ? buildOrders() : loadOrders();
  const order = (all || []).find(o => o.id === id && o.status === "picking") || null;
  if (!order) {
    return (
      <>
        <div className="m-topbar">
          <button className="m-back" onClick={ctx.back}><Icons.Chev size={16} style={{ transform: "rotate(180deg)" }}/></button>
          <div className="m-title-sub">เพิ่มรายการ</div>
        </div>
        <div className="m-content" style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ออร์เดอร์นี้ไม่ได้อยู่ในคิวแพ็คแล้ว</div>
      </>
    );
  }
  return <PackNewOrder mobile addTo={order} user={ctx.user} pushToast={ctx.pushToast} onClose={ctx.back}/>;
}

/* "มีการเพิ่มรายการ" banner — shown on the pick list (phone + desktop) and the
   queue rows, so a packer who already started never misses the extra lines. */
function PackAddedBanner({ order, compact }) {
  const a = (typeof packOrderAdds === "function") ? packOrderAdds(order) : null;
  if (!a) return null;
  if (compact) {
    return <div style={{ display: "inline-block", marginTop: 4, fontSize: 10.5, fontWeight: 700, color: "#fff", background: "var(--info)", borderRadius: 999, padding: "1px 8px" }}>＋ มีการเพิ่มรายการ +{a.pieces} ชิ้น</div>;
  }
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--info-soft)", borderLeft: "4px solid var(--info)", borderRadius: 8, fontSize: 12, lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, color: "var(--info)" }}>＋ มีการเพิ่มรายการ +{a.pieces} ชิ้น{a.times > 1 ? ` (${a.times} ครั้ง)` : ""}</div>
      <div style={{ color: "var(--fg)" }}>{a.names.join(", ")}</div>
      <div style={{ color: "var(--muted)", fontSize: 11 }}>ล่าสุด {a.when}{a.by ? " · โดย " + a.by : ""}</div>
    </div>
  );
}

/* ── "ส่งให้คนแพ็ค" — shown right after a sale creates an order ──
   The owner asked for the simplest possible path: no hunting for a button on
   another page. The moment a sale is confirmed (any fork, any sell screen —
   they all go through appendOrder), this asks once: attach the label or paste
   the address for the packer, or skip. Mounted in both shells (app.jsx /
   MobileApp). Never shown to a role that can't sell (the packer). */
function PackSendPrompt({ pushToast, mobile }) {
  const [order, setOrder] = useStatePD(null);        // { id }
  const [file, setFile] = useStatePD(null);          // saved file meta { name, type, dataUrl }
  const [addrMode, setAddrMode] = useStatePD(false);
  const [paste, setPaste] = useStatePD("");
  const [savedAddr, setSavedAddr] = useStatePD(null);
  const [busy, setBusy] = useStatePD(false);
  const inputRef = useRefPD(null);

  useEffectPD(() => {
    const h = (e) => {
      const d = (e && e.detail) || {};
      if (!d.id || (d.status && d.status !== "picking")) return;     // already shipped → not for the packer
      if (window.__packPromptSkip) return;                             // sent from สั่งแพ็คใหม่ — already attached
      if (typeof canDo === "function" && !canDo("sell")) return;
      setTimeout(() => {                                               // let the sale screen close first
        // ขาย + จัดส่ง already typed the full address (its label exists by now) —
        // asking for it again is noise.
        const known = packRecipientFor({ id: d.id }) || {};
        if (known.addr) return;
        setOrder({ id: d.id }); setFile(null); setAddrMode(false); setPaste(""); setSavedAddr(null);
      }, 400);
    };
    window.addEventListener("ims-order-created", h);
    return () => window.removeEventListener("ims-order-created", h);
  }, []);
  if (!order) return null;

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    try {
      const data = await readOrderFile(f);
      const res = await saveOrderFile(order.id, data);
      if (res.error) pushToast("แนบไฟล์ไม่สำเร็จ: " + res.error);
      else { setFile(data); refreshOrderFileIds().catch(() => {}); }
    } catch (err) { pushToast(err.message || "แนบไฟล์ไม่สำเร็จ"); }
    setBusy(false);
  };
  const saveAddress = () => {
    const text = paste.trim();
    if (!text) return;
    const p = (typeof parseRecipientBlob === "function") ? parseRecipientBlob(text) : null;
    const shipTo = p
      ? { name: p.name || "", phone: p.phone || "", addr: [p.addr1, p.addr2].filter(Boolean).join(" ") || text }
      : { name: "", phone: "", addr: text };
    if (typeof setOrderField === "function") setOrderField(order.id, { shipTo });
    setSavedAddr(shipTo); setAddrMode(false); setPaste("");
  };
  const close = () => {
    if (file || savedAddr) pushToast("ส่งให้คนแพ็คแล้ว — ดูได้ที่หน้าแพ็คสินค้า");
    setOrder(null);
  };

  const big = (bg, fg) => ({ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "16px 16px", borderRadius: 14, border: "none", background: bg, color: fg, fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textAlign: "left" });
  const done = { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 12, background: "var(--success-soft)", color: "var(--success)", fontSize: 14, fontWeight: 600 };

  return (
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 300 }}/>
      <div style={{
        position: "fixed", zIndex: 301, background: "var(--surface)", boxShadow: "var(--shadow-lg)",
        ...(mobile
          ? { left: 0, right: 0, bottom: 0, borderRadius: "20px 20px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", maxHeight: "88vh", overflowY: "auto" }
          : { left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 440, maxWidth: "calc(100vw - 32px)", borderRadius: 18, padding: 22, maxHeight: "90vh", overflowY: "auto" })
      }}>
        <div style={{ fontSize: 19, fontWeight: 800 }}>ส่งให้คนแพ็ค</div>
        <div style={{ fontSize: 13, color: "var(--muted)", margin: "2px 0 16px" }}>ออร์เดอร์ <span className="mono">{order.id}</span> — แนบใบปะหน้าหรือที่อยู่ให้คนแพ็คพิมพ์</div>
        <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={pick}/>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {file ? (
            <div style={done}>✓ แนบใบปะหน้าแล้ว <span style={{ fontWeight: 400, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span></div>
          ) : (
            <button style={big("var(--accent)", "#fff")} disabled={busy} onClick={() => inputRef.current && inputRef.current.click()}>
              <span style={{ fontSize: 24 }}>📎</span>
              <span>{busy ? "กำลังอัปโหลด…" : "แนบใบปะหน้า"}<div style={{ fontSize: 12, fontWeight: 400, opacity: 0.9 }}>ถ่ายรูป / เลือกรูป / ไฟล์ PDF</div></span>
            </button>
          )}

          {savedAddr ? (
            <div style={done}>✓ บันทึกที่อยู่แล้ว <span style={{ fontWeight: 400, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{savedAddr.name || savedAddr.addr}</span></div>
          ) : addrMode ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea className="input" autoFocus rows={4} value={paste} onChange={e => setPaste(e.target.value)} placeholder="วางที่อยู่ทั้งก้อน (ชื่อ เบอร์ ที่อยู่) จากแชท/Shopee" style={{ fontSize: 15 }}/>
              <button style={{ ...big("var(--fg)", "var(--surface)"), justifyContent: "center", padding: 14 }} disabled={!paste.trim()} onClick={saveAddress}>บันทึกที่อยู่</button>
            </div>
          ) : (
            <button style={big("var(--surface-2)", "var(--fg)")} onClick={() => setAddrMode(true)}>
              <span style={{ fontSize: 24 }}>📍</span>
              <span>วางที่อยู่ผู้รับ<div style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>คัดลอกจากแชทแล้ววาง ระบบแยกชื่อ/เบอร์ให้</div></span>
            </button>
          )}
        </div>

        <button onClick={close} style={{ marginTop: 16, width: "100%", padding: 14, borderRadius: 12, border: "1px solid var(--border)", background: "transparent", color: (file || savedAddr) ? "var(--fg)" : "var(--muted)", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          {(file || savedAddr) ? "เสร็จ" : "ข้าม (แนบทีหลังได้ที่หน้าแพ็คสินค้า)"}
        </button>
      </div>
    </>
  );
}

Object.assign(window, {
  loadOrderFile, saveOrderFile, readOrderFile, safeOrderFile, openOrderFile,
  packRecipientFor, printOrderAddress, packLabelConfig, savePackLabelConfig, PackLabelSettings, canEditPackLabel, printOrderFile, PackShipDocs, PackDocChip, refreshOrderFileIds, canUploadOrderFile, PackSendPrompt, PackNewOrder, MPackNew, MPackAdd, PackAddedBanner,
  loadOrderAttachments, addOrderAttachment, deleteOrderAttachment, PackAttachments,
  deleteOrderDocs, PackLabelButton, downloadOrderFile
});
