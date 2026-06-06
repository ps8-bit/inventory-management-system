/* Label editor + batch print */

const { useState: useStateLB, useMemo: useMemoLB, useEffect: useEffectLB } = React;

const MM_TO_PX = 3.78; // ~96dpi screen approximation

/* ── Sender profiles ── the store settings are the PRIMARY sender; users can
   also save extra senders and pick one when editing a label. ─────────────── */
function storeSenderTemplate() {
  let store = null;
  try { store = window._DB_STORE || JSON.parse(localStorage.getItem("ims_store") || "null"); } catch (e) {}
  const s = (store && store.sender) || {};
  return { name: s.name || "", addr1: s.addr1 || "", addr2: s.addr2 || "", phone: s.phone || "" };
}
function loadSenders() {
  if (Array.isArray(window._DB_SENDERS)) return window._DB_SENDERS;
  try { const a = JSON.parse(localStorage.getItem("ims_senders") || "null"); if (Array.isArray(a)) return a; } catch (e) {}
  return [];
}
function saveSenders(list) {
  window._DB_SENDERS = list;
  try { localStorage.setItem("ims_senders", JSON.stringify(list)); } catch (e) {}
  if (window.dbSaveState) dbSaveState("senders", list).catch(() => {});
  window.dispatchEvent(new CustomEvent("ims-senders-change"));
}

/* Chips to pick a saved sender (store = primary), or save the current one.
   onPick(sender) fills the editor's sender fields. Works on desktop + mobile. */
function SenderPicker({ store, current, onPick, mobile }) {
  const [, force] = useStateLB(0);
  useEffectLB(() => {
    const h = () => force(t => t + 1);
    window.addEventListener("ims-senders-change", h);
    return () => window.removeEventListener("ims-senders-change", h);
  }, []);
  const primary = (store && store.sender) || storeSenderTemplate();
  const saved = loadSenders();
  const same = (a, b) => a && b && (a.name||"")===(b.name||"") && (a.addr1||"")===(b.addr1||"") && (a.addr2||"")===(b.addr2||"") && (a.phone||"")===(b.phone||"");
  const cur = current || {};
  const canSave = (cur.name||"").trim() && !same(cur, primary) && !saved.some(s => same(s, cur));
  const Chip = ({ label, onClick, icon, dashed }) => (
    <button type="button" onClick={onClick} title={label}
      className={mobile ? "m-chip" : "btn btn-sm"}
      style={{ gap: 5, maxWidth: 190, borderStyle: dashed ? "dashed" : undefined }}>
      {icon}<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
      <Chip label="ร้านค้า (หลัก)" icon={<Icons.Box size={12}/>} onClick={() => onPick({ ...primary })}/>
      {saved.map((s, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Chip label={s.name || ("ผู้ส่ง " + (i + 1))} onClick={() => onPick({ ...s })}/>
          <button type="button" title="ลบผู้ส่งนี้" onClick={() => saveSenders(saved.filter((_, j) => j !== i))}
            style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", padding: "0 4px", fontSize: 13 }}>✕</button>
        </span>
      ))}
      {canSave && <Chip label="บันทึกผู้ส่งนี้" dashed icon={<Icons.Plus size={12}/>}
        onClick={() => saveSenders([...saved, { name: cur.name||"", addr1: cur.addr1||"", addr2: cur.addr2||"", phone: cur.phone||"" }])}/>}
    </div>
  );
}

/* Create a well-formed blank label (every field the editor + LabelPaper expect) */
function makeBlankLabel(existing) {
  // Primary sender = store settings; fall back to a sample/empty if not set yet.
  const st = storeSenderTemplate();
  const senderTemplate = (st.name || st.addr1 || st.phone)
    ? st
    : ((typeof SAMPLE_LABELS !== "undefined" && SAMPLE_LABELS[0]) ? { ...SAMPLE_LABELS[0].sender } : { name: "", addr1: "", addr2: "", phone: "" });
  return {
    id: "LBL-NEW-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
    soId: "ฉลากใหม่ " + ((existing ? existing.length : 0) + 1),
    sender: senderTemplate,
    recipient: { name: "", addr1: "", addr2: "", phone: "" },
    carrier: "",
    tracking: "",
    cod: 0,
    weight: "0.5 kg",
    items: [],
    created_at: new Date().toISOString(),
  };
}

/* Build + persist a shipping label from a completed sale, and return it.
   Every sale (POS / stock-out / desktop) is a shipment, so it becomes a label —
   labels are the single source of truth that feeds คิวฉลาก + ติดตามพัสดุ + จัดส่ง.
   `created_at` is set so labelToOrder gives the row a real date (sorts correctly). */
function createSaleLabel({ orderId, name, phone, addr1, addr2, carrier, cod, items, created_at }) {
  const existing = (typeof loadLabels === "function") ? loadLabels() : [];
  const base = (typeof makeBlankLabel === "function")
    ? makeBlankLabel(existing)
    : { id: "LBL-" + orderId, sender: {}, items: [], tracking: "", weight: "0.5 kg" };
  const label = {
    ...base,
    soId: orderId,
    created_at: created_at || new Date().toISOString(),
    recipient: { name: name || "", phone: phone || "", addr1: addr1 || "", addr2: addr2 || "" },
    carrier: carrier || "",
    cod: (typeof cod === "number" && cod > 0) ? cod : 0,
    items: (items || []).map(it => ({ sku: it.sku, name: it.name, qty: it.qty })),
  };
  if (typeof saveLabels === "function") saveLabels([...existing, label]);
  return label;
}

/* Capture a rendered .label-paper DOM node to a single-page PDF and download it.
   Shared so mobile (MLabelView) gets the SAME real PDF export as the desktop
   label editor (html2canvas → jsPDF). `el` = the .label-paper element. */
async function exportLabelPDF(el, size, soId, pushToast, scale) {
  if (!el) { if (pushToast) pushToast("ไม่พบฉลากที่จะส่งออก"); return false; }
  if (!window.html2canvas || !window.jspdf) {
    if (pushToast) pushToast("⚠️ ไลบรารี PDF ยังโหลดไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่");
    return false;
  }
  const canvas = await window.html2canvas(el, {
    scale: scale || 4,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    onclone: (doc) => {
      // html2canvas 1.4.1 throws on oklch() in stylesheets; LabelPaper is fully
      // inline-styled (hex only), so dropping external sheets is visually safe.
      doc.querySelectorAll('link[rel="stylesheet"]').forEach(n => n.remove());
      doc.querySelectorAll('style').forEach(n => n.remove());
      const st = doc.createElement("style");
      st.textContent = [
        "*, *::before, *::after { box-sizing: border-box; }",
        "body { margin: 0; }",
        '.label-paper { background: #fff; font-family: "IBM Plex Sans","IBM Plex Sans Thai",sans-serif; color: #111; }',
        '.mono { font-family: "IBM Plex Mono",monospace; }',
      ].join("\n");
      doc.head.appendChild(st);
    },
  });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: [size.w, size.h] });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, size.w, size.h);
  const filename = String(soId || "label").replace(/[/\\:*?"<>|]/g, "_") + "_label.pdf";
  pdf.save(filename);
  if (pushToast) pushToast("ดาวน์โหลด " + filename + " แล้ว ✓");
  return true;
}

/* Parse a pasted recipient blob (common Thai formats — labeled or freeform,
   single or multi-line) into { name, phone, addr1, addr2 }. Best-effort: the
   user reviews/edits the result. Returns null if there's nothing to parse. */
function parseRecipientBlob(raw) {
  let text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return null;
  const out = { name: "", phone: "", addr1: "", addr2: "" };
  const addrKw = /(บ้านเลขที่|เลขที่|ห้อง|อาคาร|ตึก|ชั้น|หมู่บ้าน|หมู่|ม\.|ซอย|ซ\.|ถนน|ถ\.|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.|รหัสไปรษณีย์|\d{1,4}\/\d{1,4}|\d{5})/;
  // A leading chain of single-letter dotted groups is a Thai military/police/
  // civil rank or title (ส.ต.ต. / จ.ส.อ. / พ.ต.ท. / ด.ต. / น.ส. …), NOT an
  // address abbreviation. Mask it before address-keyword tests so its dots
  // don't collide with ต./อ./จ. (critical for this shop's many ranked buyers).
  const RANK = /(?:[ก-ฮ]{1,3}\.){2,}/g;
  const looksAddr = (line) => addrKw.test(line.replace(RANK, " "));

  // 1) Phone — exact-length patterns so it can't bleed into an adjacent number.
  //    Mobile = 10 digits (0[689]+8), +66 mobile, or landline = 9 digits (0[2-7]+7).
  const phonePatterns = [
    /0[689](?:[ \-.]?\d){8}/,         // 08x/06x/09x mobile
    /(?:\+?66)[ \-.]?[689](?:[ \-.]?\d){8}/, // +66 mobile (0 dropped)
    /0[2-7](?:[ \-.]?\d){7}/,         // 02x landline / provincial
  ];
  for (const re of phonePatterns) {
    const pm = text.match(re);
    if (pm) {
      let d = pm[0].replace(/\D/g, "");
      if (d.startsWith("66")) d = "0" + d.slice(2);
      if (d.length === 9 || d.length === 10) { out.phone = d; text = text.replace(pm[0], "\n"); break; }
    }
  }

  // 2) Labeled fields (ชื่อ: / ที่อยู่: ...).
  const grab = (labels) => {
    const m = text.match(new RegExp("(?:^|\\n)[ \\t]*(?:" + labels + ")[ \\t]*[:：][ \\t]*([^\\n]+)", "i"));
    return m ? m[1].trim() : "";
  };
  out.name = grab("ชื่อผู้รับ|ชื่อ[ \\-]?นามสกุล|ชื่อ|name|ผู้รับ");
  let addr = grab("ที่อยู่จัดส่ง|ที่อยู่|address|จัดส่งที่|ที่จัดส่ง");

  // Strip the label lines (and any phone-label line) from the remainder.
  const rest = text
    .replace(/(?:^|\n)[ \t]*(?:ชื่อผู้รับ|ชื่อ[ \-]?นามสกุล|ชื่อ|name|ผู้รับ)[ \t]*[:：][^\n]*/i, "")
    .replace(/(?:^|\n)[ \t]*(?:ที่อยู่จัดส่ง|ที่อยู่|address|จัดส่งที่|ที่จัดส่ง)[ \t]*[:：][^\n]*/i, "")
    .replace(/(?:^|\n)[ \t]*(?:เบอร์โทรศัพท์|เบอร์โทร|เบอร์|โทรศัพท์|โทร\.?|tel|phone|มือถือ)[ \t]*[:：][^\n]*/i, "")
    // Orphan phone-label word left behind once its number was extracted
    // (e.g. "โทร 0993164656" → "โทร"). Strip the bare label token too.
    .replace(/(?:^|[\n\s])(?:เบอร์โทรศัพท์|เบอร์โทร|เบอร์|โทรศัพท์|โทร\.?|tel|phone|มือถือ)(?=$|[\n\s])/gi, " ")
    .trim();

  // 3) Fallback: line-based heuristics for whatever the labels didn't capture.
  if (!out.name || !addr) {
    const lines = rest.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (!out.name) {
      const nameLine = lines.find(l => !looksAddr(l));
      if (nameLine) out.name = nameLine;
    }
    if (!addr) {
      const addrLines = lines.filter(l => l !== out.name);
      addr = addrLines.join(" ");
    }
  }

  // Single line holding both name and address → split at the first address
  // marker. Mask any leading rank/title first (preserving indices) so its dots
  // aren't mistaken for the split point.
  if (out.name && !addr) {
    const masked = out.name.replace(RANK, m => " ".repeat(m.length));
    const km = masked.match(addrKw);
    if (km && km.index > 0) { addr = out.name.slice(km.index).trim(); out.name = out.name.slice(0, km.index).trim(); }
  }
  out.name = out.name.replace(/\s+/g, " ").trim();

  // 4) Split the address across the label's two lines (main / subdistrict→postal).
  //    Prefer the Thai-address gazetteer (data-anchored: validates against real
  //    tambon/amphoe/province/postcode), falling back to the keyword/length
  //    heuristic when it can't confidently anchor. Requires the index to be
  //    loaded — callers await ensureThaiAddrIndex() before parsing.
  addr = addr.replace(/\s+/g, " ").trim();
  if (addr) {
    let g = null;
    if (typeof getThaiAddrIndex === "function" && getThaiAddrIndex() && typeof parseThaiAddrTail === "function") {
      g = parseThaiAddrTail(addr);
    }
    if (g && (g.addr1 || g.addr2)) {
      out.addr1 = g.addr1 || addr;
      out.addr2 = g.addr2 || "";
      out.tambon = g.tambon; out.amphoe = g.amphoe; out.province = g.province; out.zip = g.zip;
      out.addrConfidence = g.confidence;
    } else {
      const sk = addr.match(/(ตำบล|ต\.|แขวง)/);
      if (sk && sk.index > 6) {
        out.addr1 = addr.slice(0, sk.index).trim();
        out.addr2 = addr.slice(sk.index).trim();
      } else if (addr.length > 42) {
        let cut = addr.lastIndexOf(" ", Math.floor(addr.length * 0.55));
        if (cut < 10) cut = addr.indexOf(" ", Math.floor(addr.length * 0.5));
        if (cut > 6) { out.addr1 = addr.slice(0, cut).trim(); out.addr2 = addr.slice(cut).trim(); }
        else out.addr1 = addr;
      } else {
        out.addr1 = addr;
      }
    }
  }

  if (!out.name && !out.phone && !out.addr1 && !out.addr2) return null;
  return out;
}

/* The label queue persists to localStorage so edits and freshly-created labels
   survive navigating away from the page and back (the component unmounts on
   navigation, so in-memory-only state would reset to the samples every time). */
function loadLabels() {
  if (window._DB_LABELS) return window._DB_LABELS;
  try {
    const raw = localStorage.getItem("ims_labels");
    if (raw !== null) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {}
  return SAMPLE_LABELS.map(l => ({ ...l, items: l.items.map(it => ({ ...it })) }));
}
function saveLabels(labels) {
  const prev = window._DB_LABELS;
  // Stamp `updatedAt` (inside the label, persisted in the data jsonb) on labels
  // that are new or whose content changed, so dbInit can merge local↔cloud by
  // recency instead of blindly letting the cloud copy win. Only changed labels
  // get bumped — comparing each against its previous version, ignoring updatedAt.
  {
    const prevById = {};
    (prev || []).forEach(l => { if (l && l.id != null) prevById[l.id] = l; });
    const now = new Date().toISOString();
    labels = labels.map(l => {
      const before = prevById[l.id];
      const { updatedAt: _a, ...lRest } = l;
      const { updatedAt: _b, ...beforeRest } = before || {};
      const changed = !before || JSON.stringify(lRest) !== JSON.stringify(beforeRest);
      return changed ? { ...l, updatedAt: now } : l;
    });
  }
  if (prev) {
    const newIds = new Set(labels.map(l => l.id));
    prev.filter(l => !newIds.has(l.id)).forEach(l => {
      // Before hard-deleting, snapshot any label that has a tracking number so
      // ติดตามพัสดุ keeps showing the shipment even after the label is removed.
      if (l.tracking && typeof labelToOrder === "function") {
        try {
          const snap = JSON.parse(localStorage.getItem("ims_preserved_orders") || "{}");
          const order = labelToOrder(l);
          if (!snap[order.id]) {
            const preserved = { ...order, __fromLabel: false };
            snap[order.id] = preserved;
            localStorage.setItem("ims_preserved_orders", JSON.stringify(snap));
            window.dispatchEvent(new CustomEvent("ims-orders-change"));
            // Sync to Supabase orders table so the public track-lookup Edge Function
            // can still find this shipment for anonymous customers.
            if (typeof dbUpsertOrders === "function") dbUpsertOrders([preserved]).catch(() => {});
          }
        } catch (e) {}
      }
      if (window.dbDeleteLabel) dbDeleteLabel(l.id).catch(() => {});
    });
  }
  try { localStorage.setItem("ims_labels", JSON.stringify(labels)); } catch (e) {}
  window._DB_LABELS = labels;
  window.dispatchEvent(new CustomEvent("ims-labels-change"));
  if (window.dbUpsertLabels) dbUpsertLabels(labels).catch(() => {});
}

function Labels({ pushToast, store }) {
  const [labels, setLabels] = useStateLB(loadLabels);
  const [activeId, setActiveId] = useStateLB(() => (labels[0] ? labels[0].id : null));
  const [savedSnapshots, setSavedSnapshots] = useStateLB(() => {
    const m = {};
    loadLabels().forEach(l => { m[l.id] = JSON.stringify(l); });
    return m;
  });
  const [confirmOpen, setConfirmOpen] = useStateLB(false);
  const [showErrors, setShowErrors] = useStateLB(false);
  const [sizeId, setSizeId] = useStateLB("100x150");
  const [selected, setSelected] = useStateLB(() => Object.fromEntries(labels.map(l => [l.id, true])));
  const [view, setView] = useStateLB("editor"); // editor | batch
  const [zoom, setZoom] = useStateLB(1);
  const [pdfLoading, setPdfLoading] = useStateLB(false);
  const [pasteText, setPasteText] = useStateLB("");
  const [aiLoading, setAiLoading] = useStateLB(false);
  const autoPrintRef = React.useRef(false);

  const size = LABEL_SIZES.find(s => s.id === sizeId);
  // Fallback to the first label so `active` is never undefined while the queue is non-empty
  const active = labels.find(l => l.id === activeId) || labels[0] || null;

  // Persist the queue on every change so edits + created labels are never lost
  useEffectLB(() => { saveLabels(labels); }, [labels]);

  // Reload from DB when a remote team-member change arrives via real-time
  useEffectLB(() => {
    const reload = () => { if (window._DB_LABELS) setLabels(window._DB_LABELS); };
    window.addEventListener("ims-labels-change", reload);
    return () => window.removeEventListener("ims-labels-change", reload);
  }, []);

  // Re-render when the product catalog changes so the SKU picker shows current names
  const [, setPv] = useStateLB(0);
  useEffectLB(() => {
    const refresh = () => setPv(v => v + 1);
    window.addEventListener("ims-products-change", refresh);
    return () => window.removeEventListener("ims-products-change", refresh);
  }, []);

  // Auto-trigger batch PDF after switching to batch view via the "print selected" button
  useEffectLB(() => {
    if (view !== "batch" || !autoPrintRef.current) return;
    autoPrintRef.current = false;
    setTimeout(() => printNow(), 400);
  }, [view]);

  // Pick up labels queued from the Outbound page ("สร้างฉลาก")
  useEffectLB(() => {
    const pending = window.__pendingLabels;
    if (!pending || !pending.length) return;
    window.__pendingLabels = [];
    // Map labels already in the queue by their order id (soId) — avoid duplicates
    const existingIdBySoId = {};
    labels.forEach(l => { if (!(l.soId in existingIdBySoId)) existingIdBySoId[l.soId] = l.id; });
    const toAdd = pending.filter(p => !(p.soId in existingIdBySoId));
    if (toAdd.length) {
      setLabels(prev => [...toAdd, ...prev]);
      setSelected(s => {
        const n = { ...s };
        toAdd.forEach(p => { n[p.id] = true; });
        return n;
      });
    }
    // Activate the label for the first requested order (newly added or pre-existing)
    const first = pending[0];
    setActiveId(existingIdBySoId[first.soId] || first.id);
    setView("editor");
  }, []);

  const updateActive = (fn) => {
    setLabels(ls => ls.map(l => l.id === activeId ? fn(l) : l));
    setShowErrors(false);
  };

  // Paste a recipient blob → auto-split into the recipient fields.
  const applyPaste = async () => {
    if (typeof ensureThaiAddrIndex === "function") { try { await ensureThaiAddrIndex(); } catch (e) {} }
    const parsed = parseRecipientBlob(pasteText);
    if (!parsed) { pushToast("ไม่พบข้อมูลให้คัดแยก"); return; }
    updateActive(l => ({
      ...l,
      recipient: {
        ...l.recipient,
        name: parsed.name || l.recipient.name,
        phone: parsed.phone || l.recipient.phone,
        addr1: parsed.addr1 || l.recipient.addr1,
        addr2: parsed.addr2 || l.recipient.addr2,
      },
    }));
    const got = [parsed.name && "ชื่อ", parsed.phone && "เบอร์", (parsed.addr1 || parsed.addr2) && "ที่อยู่"].filter(Boolean).join(" · ");
    const hasAddr = parsed.addr1 || parsed.addr2;
    const tail = !hasAddr ? "" : parsed.addrConfidence === "high"
      ? " · ✓ ตรงรหัสไปรษณีย์"
      : " · ที่อยู่อาจไม่ครบ ลองปุ่ม AI";
    pushToast("คัดแยกแล้ว: " + (got || "—") + tail);
    setPasteText("");
  };

  // Same as applyPaste but via Gemini (more forgiving of messy/unusual pastes).
  const applyPasteAI = async () => {
    const text = pasteText.trim();
    if (!text) return;
    setAiLoading(true);
    try {
      const { data: { session } } = await authGetSession();
      if (!session) { pushToast("กรุณาเข้าสู่ระบบใหม่"); return; }
      const res = await fetch(SUPABASE_FUNC_URL + "/parse-recipient", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
        body: JSON.stringify({ text }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) { pushToast(j.error || "คัดแยกด้วย AI ไม่สำเร็จ"); return; }
      updateActive(l => ({
        ...l,
        recipient: {
          ...l.recipient,
          name: j.name || l.recipient.name,
          phone: j.phone || l.recipient.phone,
          addr1: j.addr1 || l.recipient.addr1,
          addr2: j.addr2 || l.recipient.addr2,
        },
      }));
      const got = [j.name && "ชื่อ", j.phone && "เบอร์", (j.addr1 || j.addr2) && "ที่อยู่"].filter(Boolean).join(" · ");
      pushToast("AI คัดแยกแล้ว: " + (got || "—"));
      setPasteText("");
    } catch (e) {
      pushToast("คัดแยกด้วย AI ไม่สำเร็จ: " + (e.message || e));
    } finally {
      setAiLoading(false);
    }
  };

  const validateLabel = (label) => {
    if (!label) return { ok: false, reason: "ไม่พบฉลาก" };
    if (!label.items.length) return { ok: false, reason: "ต้องมีรายการอย่างน้อย 1 รายการ" };
    const missing = label.items.filter(it => !it.sku);
    if (missing.length) return { ok: false, reason: `มี ${missing.length} รายการที่ยังไม่ได้เลือกสินค้า` };
    const badQty = label.items.filter(it => !it.qty || it.qty <= 0);
    if (badQty.length) return { ok: false, reason: `มี ${badQty.length} รายการจำนวนไม่ถูกต้อง` };
    if (!label.recipient.name.trim()) return { ok: false, reason: "ยังไม่ได้ระบุชื่อผู้รับ" };
    return { ok: true };
  };

  const isDirty = active && savedSnapshots[active.id] !== JSON.stringify(active);
  const validation = validateLabel(active);

  const requestSave = () => {
    if (!validation.ok) {
      setShowErrors(true);
      pushToast(validation.reason);
      return;
    }
    if (!isDirty) {
      pushToast("ไม่มีการเปลี่ยนแปลง");
      return;
    }
    setConfirmOpen(true);
  };

  const doSave = () => {
    setSavedSnapshots(s => ({ ...s, [active.id]: JSON.stringify(active) }));
    recordChange({
      entity: "label",
      entityId: active.soId,
      action: "update",
      summary: `บันทึกฉลาก ${active.soId} · ${active.items.length} รายการ`,
      changes: [
        { label: "ผู้รับ", to: active.recipient.name },
        { label: "ขนส่ง", to: active.carrier },
        { label: "เลขพัสดุ", to: active.tracking || "—" },
        { label: "รายการ", to: `${active.items.length} SKU · ${active.items.reduce((s,x)=>s+x.qty,0)} ชิ้น` }
      ]
    });
    pushToast(`บันทึกฉลาก ${active.soId} แล้ว`);
    setConfirmOpen(false);
    setShowErrors(false);
  };

  /* ── PDF export helpers ─────────────────────────────────────────────────── */
  const _capturePaper = (el) =>
    window.html2canvas(el, {
      scale: 4 / zoom,   // compensate for CSS zoom transform on parent
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
      onclone: (clonedDoc) => {
        // html2canvas 1.4.1 throws on oklch() in stylesheets.
        // LabelPaper is 100% inline-styled (hex/rgb only), so dropping
        // all external sheets from the clone has zero visual effect.
        clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach(n => n.remove());
        clonedDoc.querySelectorAll('style').forEach(n => n.remove());
        const s = clonedDoc.createElement("style");
        s.textContent = [
          "*, *::before, *::after { box-sizing: border-box; }",
          "body { margin: 0; }",
          '.label-paper { background: #fff; font-family: "IBM Plex Sans","IBM Plex Sans Thai",sans-serif; color: #111; }',
          '.mono { font-family: "IBM Plex Mono",monospace; }',
        ].join("\n");
        clonedDoc.head.appendChild(s);
      },
    });

  const exportSinglePDF = async () => {
    const el = document.querySelector(".label-stage .label-paper");
    if (!el) throw new Error("ไม่พบ element ฉลาก");
    const canvas = await _capturePaper(el);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: [size.w, size.h] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, size.w, size.h);
    const filename = (active.soId || "label").replace(/[/\\:*?"<>|]/g, "_") + "_label.pdf";
    pdf.save(filename);
    pushToast("ดาวน์โหลด " + filename + " แล้ว ✓");
  };

  const exportBatchPDF = async () => {
    const sel = labels.filter(l => selected[l.id]);
    if (!sel.length) { pushToast("ยังไม่ได้เลือกฉลาก"); return; }
    const paperEls = [...document.querySelectorAll(".batch-card .label-paper")];
    if (!paperEls.length) { pushToast("ไม่พบฉลากในชุดพิมพ์"); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: [size.w, size.h] });
    for (let i = 0; i < paperEls.length; i++) {
      if (i > 0) pdf.addPage([size.w, size.h]);
      const canvas = await _capturePaper(paperEls[i]);
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, size.w, size.h);
    }
    const filename = "labels_batch_" + sel.length + "pcs.pdf";
    pdf.save(filename);
    pushToast("ดาวน์โหลด PDF ชุด " + sel.length + " ใบแล้ว ✓");
  };

  const printNow = async () => {
    if (!window.html2canvas || !window.jspdf) {
      pushToast("⚠️ ไลบรารี PDF ยังโหลดไม่เสร็จ กรุณารอสักครู่แล้วลองใหม่");
      return;
    }
    setPdfLoading(true);
    try {
      if (view === "batch") {
        await exportBatchPDF();
      } else {
        await exportSinglePDF();
      }
    } catch (e) {
      console.error("PDF export error:", e);
      pushToast("เกิดข้อผิดพลาด: " + (e.message || String(e)));
    }
    setPdfLoading(false);
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head no-print">
        <div>
          <h1 className="page-title">พิมพ์ฉลากจัดส่ง</h1>
          <div className="page-sub">แก้ไขรายละเอียดฉลาก เลือกขนาด และพิมพ์ทีละแผ่นหรือเป็นชุด</div>
        </div>
        <div className="row">
          <div className="seg">
            <button className={view === "editor" ? "on" : ""} onClick={() => setView("editor")}>แก้ไขทีละใบ</button>
            <button className={view === "batch" ? "on" : ""} onClick={() => setView("batch")}>ชุดพิมพ์ ({selectedCount})</button>
          </div>
          <button className="btn" onClick={() => {
            const blank = makeBlankLabel(labels);
            setLabels(ls => [...ls, blank]);
            setSelected(s => ({ ...s, [blank.id]: true }));
            setActiveId(blank.id);
            setView("editor");
            pushToast("สร้างฉลากใหม่แล้ว");
          }}><Icons.Plus/> สร้างฉลากใหม่</button>
          <button
            className="btn btn-primary"
            onClick={printNow}
            disabled={pdfLoading}
            style={{
              padding: "9px 20px",
              fontSize: 14,
              fontWeight: 700,
              background: pdfLoading ? undefined : "linear-gradient(135deg, #1e40af 0%, #2563eb 100%)",
              boxShadow: pdfLoading ? undefined : "0 3px 12px rgba(37,99,235,0.45)",
              gap: 8,
              ...(pdfLoading ? { opacity: 0.75, cursor: "wait" } : {})
            }}
          >
            {pdfLoading ? "⏳ กำลังสร้าง PDF…" : (
              <>
                <Icons.Print size={16}/>
                {" "}ส่งออก PDF
                {view === "batch" && selectedCount > 0 && (
                  <span style={{ background: "rgba(255,255,255,0.28)", borderRadius: 20, padding: "1px 8px", fontSize: 12, marginLeft: 4 }}>
                    {selectedCount} ใบ
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Size + batch controls */}
      <div className="card no-print" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>ขนาดฉลาก</div>
            <div className="row" style={{ gap: 6 }}>
              {LABEL_SIZES.map(s => (
                <button
                  key={s.id}
                  className={"btn btn-sm" + (sizeId === s.id ? " btn-primary" : "")}
                  onClick={() => setSizeId(s.id)}
                  style={{ flexDirection: "column", alignItems: "flex-start", padding: "8px 12px", lineHeight: 1.2 }}
                >
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{s.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch", margin: "0 6px" }}/>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>การพิมพ์</div>
            <div className="row" style={{ gap: 6 }}>
              <div className="seg">
                <button className={zoom === 0.75 ? "on" : ""} onClick={() => setZoom(0.75)}>75%</button>
                <button className={zoom === 1 ? "on" : ""} onClick={() => setZoom(1)}>100%</button>
                <button className={zoom === 1.25 ? "on" : ""} onClick={() => setZoom(1.25)}>125%</button>
              </div>
              <button className="btn btn-sm" onClick={() => {
                if (!active) { pushToast("ยังไม่ได้เลือกฉลาก"); return; }
                const copy = {
                  ...active,
                  id: "LBL-COPY-" + Date.now(),
                  soId: active.soId + " (สำเนา)",
                  recipient: { ...active.recipient },
                  sender: { ...active.sender },
                  items: active.items.map(it => ({ ...it }))
                };
                setLabels(ls => [...ls, copy]);
                setSelected(s => ({ ...s, [copy.id]: true }));
                setActiveId(copy.id);
                pushToast("คัดลอกฉลากสำเร็จ");
              }}><Icons.Copy size={13}/> คัดลอกฉลาก</button>
            </div>
          </div>
          <div className="spacer"/>
          <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
            <div>ขนาดจริงเมื่อพิมพ์: <strong style={{ color: "var(--fg)" }}>{size.w} × {size.h} mm</strong></div>
            <div style={{ marginTop: 2 }}>{view === "batch" ? `เลือก ${selectedCount} จาก ${labels.length} ใบ` : `ฉลากที่ ${labels.findIndex(l => l.id === activeId)+1} จาก ${labels.length}`}</div>
          </div>
        </div>
      </div>

      {view === "editor" ? (
        labels.length === 0 ? (
          <div className="card no-print" style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>
            <Icons.Tag size={32} style={{ opacity: 0.3, marginBottom: 12 }}/>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--fg)" }}>คิวฉลากว่าง</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>กดปุ่ม "สร้างฉลากใหม่" ด้านบน หรือไปที่หน้า "จัดส่งสินค้า" แล้วเลือกออร์เดอร์เพื่อสร้างฉลาก</div>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => {
              const blank = makeBlankLabel(labels);
              setLabels([blank]);
              setSelected({ [blank.id]: true });
              setActiveId(blank.id);
            }}>
              <Icons.Plus size={14}/> สร้างฉลากใหม่
            </button>
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr 380px", gap: 20 }}>
          {/* Sidebar: label queue */}
          <div className="card card-tight no-print">
            <div className="card-head">
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <span
                  className={"check" + (labels.length > 0 && labels.every(l => selected[l.id]) ? " on" : "")}
                  onClick={() => {
                    const allSel = labels.length > 0 && labels.every(l => selected[l.id]);
                    if (allSel) setSelected({});
                    else setSelected(Object.fromEntries(labels.map(l => [l.id, true])));
                  }}
                  title="เลือก/ยกเลิกทั้งหมด"
                  style={{ flexShrink: 0 }}
                />
                <div>
                  <h3 style={{ whiteSpace: "nowrap" }}>คิวฉลาก</h3>
                  <div className="sub">{selectedCount > 0 ? `เลือก ${selectedCount}/${labels.length}` : `${labels.length} ใบ`}</div>
                </div>
              </div>
              <div className="row" style={{ gap: 4 }}>
                {selectedCount > 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    title={`พิมพ์ ${selectedCount} ฉลากที่เลือก`}
                    onClick={() => { autoPrintRef.current = true; setView("batch"); }}
                    style={{ fontSize: 11, gap: 5 }}
                  >
                    <Icons.Print size={12}/> {selectedCount} ใบ
                  </button>
                )}
                {labels.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    title="ล้างคิวทั้งหมด"
                    onClick={() => {
                      if (!confirm(`ลบฉลากทั้งหมด ${labels.length} ใบออกจากคิว?`)) return;
                      setLabels([]);
                      pushToast(`ล้างคิว ${labels.length} ฉลากแล้ว`);
                    }}
                    style={{ color: "var(--danger)" }}
                  >
                    <Icons.Trash size={13}/>
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" title="เพิ่มฉลากใหม่" onClick={() => {
                  const blank = makeBlankLabel(labels);
                  setLabels(ls => [...ls, blank]);
                  setSelected(s => ({ ...s, [blank.id]: true }));
                  setActiveId(blank.id);
                }}><Icons.Plus size={13}/></button>
              </div>
            </div>
            <div className="stack" style={{ gap: 0, padding: "6px 0" }}>
              {labels.map(l => {
                const isActive = l.id === activeId;
                return (
                  <div
                    key={l.id}
                    onClick={() => setActiveId(l.id)}
                    className="queue-row"
                    style={{
                      padding: "10px 16px",
                      borderLeft: "3px solid " + (isActive ? "var(--accent)" : "transparent"),
                      background: isActive ? "var(--accent-soft)" : "transparent",
                      cursor: "pointer",
                      position: "relative"
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <div className="row" style={{ gap: 6, alignItems: "center", minWidth: 0 }}>
                        <span
                          className={"check" + (selected[l.id] ? " on" : "")}
                          onClick={(e) => { e.stopPropagation(); setSelected(s => ({ ...s, [l.id]: !s[l.id] })); }}
                          style={{ flexShrink: 0 }}
                        />
                        <span className="mono" style={{ fontSize: 12, color: "var(--fg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.soId}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0, marginLeft: 6 }}>{l.carrier.split(" ")[0]}</span>
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4, paddingRight: 22 }}>{l.recipient.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {l.items.length} รายการ · {l.weight}
                    </div>
                    <button
                      className="queue-del"
                      title="ลบออกจากคิว"
                      onClick={(e) => {
                        e.stopPropagation();
                        const remaining = labels.filter(x => x.id !== l.id);
                        setLabels(remaining);
                        setSelected(s => { const n = { ...s }; delete n[l.id]; return n; });
                        if (isActive && remaining.length > 0) setActiveId(remaining[0].id);
                        pushToast(`ลบฉลาก ${l.soId} ออกจากคิว`);
                      }}
                    >
                      <Icons.X size={11}/>
                    </button>
                  </div>
                );
              })}
              {labels.length === 0 && (
                <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                  <Icons.Tag size={20} style={{ opacity: 0.4, marginBottom: 6 }}/>
                  <div>คิวฉลากว่าง</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>กดปุ่ม "สร้างฉลากใหม่" เพื่อเริ่ม</div>
                </div>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="label-stage no-print-stage">
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
              <LabelPaper label={active} size={size} store={store}/>
            </div>
          </div>

          {/* Edit form */}
          <div className="card no-print" style={{ padding: 0 }}>
            <div className="card-head">
              <div>
                <h3>แก้ไขฉลาก</h3>
                <div className="sub mono">{active.soId}{isDirty && <span style={{ color: "var(--warning)", marginLeft: 6 }}>· ยังไม่ได้บันทึก</span>}</div>
              </div>
              <button
                className={"btn btn-sm " + (isDirty && validation.ok ? "btn-primary" : "")}
                onClick={requestSave}
                disabled={!isDirty}
                style={!isDirty ? { opacity: 0.5, cursor: "not-allowed" } : {}}
                title={validation.ok ? "บันทึกการเปลี่ยนแปลง" : validation.reason}
              >
                <Icons.Check size={13}/> บันทึก
              </button>
            </div>
            <div style={{ padding: 18, overflow: "auto", maxHeight: 720 }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>ผู้รับ</div>

              {/* Paste a recipient blob and auto-split name / phone / address */}
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                  วางข้อมูลผู้รับทั้งก้อน แล้วคัดแยก <strong style={{ color: "var(--fg)" }}>ชื่อ / เบอร์ / ที่อยู่</strong> อัตโนมัติ
                </div>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder={"เช่น คุณสมชาย ใจดี 081-234-5678\n123/45 หมู่ 2 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540"}
                  rows={3}
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontSize: 12, padding: 8, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--fg)", fontFamily: "inherit", lineHeight: 1.5 }}
                />
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={applyPaste} disabled={!pasteText.trim() || aiLoading} style={(!pasteText.trim() || aiLoading) ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
                    <Icons.Scan size={13}/> คัดแยกข้อมูล
                  </button>
                  <button className="btn btn-sm" onClick={applyPasteAI} disabled={!pasteText.trim() || aiLoading} style={(!pasteText.trim() || aiLoading) ? { opacity: 0.5, cursor: "not-allowed" } : {}} title="ใช้ AI ช่วยคัดแยก เหมาะกับข้อความที่จัดรูปแบบยุ่งยาก">
                    {aiLoading ? <>⏳ กำลังคัดแยก…</> : <><Icons.Bundle size={13}/> คัดแยกด้วย AI</>}
                  </button>
                  {pasteText && !aiLoading && <button className="btn btn-sm" onClick={() => setPasteText("")}>ล้าง</button>}
                </div>
              </div>

              <div className="stack" style={{ gap: 8 }}>
                <Field label="ชื่อ-นามสกุล" value={active.recipient.name} onChange={v => updateActive(l => ({ ...l, recipient: { ...l.recipient, name: v } }))}/>
                <Field label="ที่อยู่ (บรรทัด 1)" value={active.recipient.addr1} onChange={v => updateActive(l => ({ ...l, recipient: { ...l.recipient, addr1: v } }))}/>
                <Field label="ที่อยู่ (บรรทัด 2)" value={active.recipient.addr2} onChange={v => updateActive(l => ({ ...l, recipient: { ...l.recipient, addr2: v } }))}/>
                <Field label="โทรศัพท์" value={active.recipient.phone} onChange={v => updateActive(l => ({ ...l, recipient: { ...l.recipient, phone: v } }))}/>
              </div>

              <div className="divider"/>
              <div className="eyebrow" style={{ marginBottom: 10 }}>ผู้ส่ง</div>
              <SenderPicker store={store} current={active.sender} onPick={s => updateActive(l => ({ ...l, sender: { ...l.sender, ...s } }))}/>
              <div className="stack" style={{ gap: 8 }}>
                <Field label="ชื่อ / บริษัท" value={active.sender.name} onChange={v => updateActive(l => ({ ...l, sender: { ...l.sender, name: v } }))}/>
                <Field label="ที่อยู่ (บรรทัด 1)" value={active.sender.addr1} onChange={v => updateActive(l => ({ ...l, sender: { ...l.sender, addr1: v } }))}/>
                <Field label="ที่อยู่ (บรรทัด 2)" value={active.sender.addr2} onChange={v => updateActive(l => ({ ...l, sender: { ...l.sender, addr2: v } }))}/>
                <Field label="โทรศัพท์" value={active.sender.phone} onChange={v => updateActive(l => ({ ...l, sender: { ...l.sender, phone: v } }))}/>
              </div>

              <div className="divider"/>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <div className="eyebrow">รายการสินค้า {showErrors && active.items.some(it => !it.sku) && <span style={{ color: "var(--danger)", marginLeft: 6 }}>· ต้องเลือกสินค้าทุกรายการ</span>}</div>
                <ItemAddPicker
                  onAddProduct={(p) => updateActive(l => ({ ...l, items: [...l.items, { sku: p.sku, name: p.name, qty: 1 }] }))}
                  onAddBundle={(b) => {
                    const expanded = b.items.map(it => {
                      const p = PRODUCTS.find(x => x.sku === it.sku);
                      return { sku: it.sku, name: p ? p.name : it.sku, qty: it.qty, fromBundle: b.name };
                    });
                    updateActive(l => ({ ...l, items: [...l.items, ...expanded] }));
                    pushToast(`เพิ่มชุด "${b.name}" — ${expanded.length} รายการ`);
                  }}
                />
              </div>
              <div className="stack" style={{ gap: 10 }}>
                {active.items.map((it, i) => {
                  const invalid = showErrors && (!it.sku || it.qty <= 0);
                  return (
                    <div key={i} style={{ padding: 10, background: "var(--surface-2)", borderRadius: 8, border: "1px solid " + (invalid ? "var(--danger)" : "var(--border)") }}>
                      {it.fromBundle && (
                        <div style={{ marginBottom: 6 }}>
                          <span className="badge badge-info" style={{ fontSize: 10 }}>
                            <Icons.Bundle size={10}/> จากชุด: {it.fromBundle}
                          </span>
                        </div>
                      )}
                      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, gap: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <SkuPicker
                            value={it.sku || PRODUCTS[0].sku}
                            onChange={(sku) => {
                              const p = PRODUCTS.find(x => x.sku === sku);
                              updateActive(l => ({ ...l, items: l.items.map((x, j) => j === i ? { ...x, sku, name: p ? p.name : x.name } : x) }));
                            }}
                            products={PRODUCTS}
                          />
                          {!it.sku && (
                            <div style={{ fontSize: 11, color: showErrors ? "var(--danger)" : "var(--muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                              <Icons.Warn size={11}/> ยังไม่ได้เลือกสินค้า
                            </div>
                          )}
                        </div>
                        <button className="btn btn-ghost btn-icon" onClick={() => updateActive(l => ({ ...l, items: l.items.filter((_, j) => j !== i) }))} title="ลบรายการ"><Icons.Trash size={13}/></button>
                      </div>
                      <input
                        className="input"
                        style={{ marginBottom: 6, fontSize: 12 }}
                        value={it.name}
                        onChange={e => updateActive(l => ({ ...l, items: l.items.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                        placeholder="คำอธิบายที่แสดงบนฉลาก (แก้ไขได้)"
                      />
                      <div className="row" style={{ gap: 8 }}>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>จำนวน</span>
                        <div className="qty-stepper">
                          <button onClick={() => updateActive(l => ({ ...l, items: l.items.map((x, j) => j === i ? { ...x, qty: Math.max(0, x.qty - 1) } : x) }))} disabled={it.qty <= 0}>−</button>
                          <input value={it.qty} onChange={e => updateActive(l => ({ ...l, items: l.items.map((x, j) => j === i ? { ...x, qty: parseInt(e.target.value) || 0 } : x) }))}/>
                          <button onClick={() => updateActive(l => ({ ...l, items: l.items.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x) }))}>+</button>
                        </div>
                        {it.sku && <span className="mono" style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>{it.sku}</span>}
                      </div>
                    </div>
                  );
                })}
                {active.items.length === 0 && (
                  <div style={{ padding: 16, textAlign: "center", fontSize: 12, color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 8 }}>
                    ยังไม่มีรายการสินค้า · กด "เพิ่ม" ด้านบน
                  </div>
                )}
              </div>

              <div className="divider"/>
              <div className="eyebrow" style={{ marginBottom: 10 }}>ขนส่ง</div>
              <div className="grid-2">
                <Field label="ผู้ให้บริการ" value={active.carrier} onChange={v => updateActive(l => ({ ...l, carrier: v }))}/>
                <Field label="เลขพัสดุ" value={active.tracking} onChange={v => updateActive(l => ({ ...l, tracking: v }))} mono/>
                <Field label="น้ำหนัก" value={active.weight} onChange={v => updateActive(l => ({ ...l, weight: v }))}/>
                <Field label="COD (บาท)" value={String(active.cod)} onChange={v => updateActive(l => ({ ...l, cod: parseInt(v) || 0 }))} num/>
              </div>
            </div>
          </div>
        </div>
        )
      ) : (
        <BatchView labels={labels} selected={selected} setSelected={setSelected} size={size} zoom={zoom} store={store} onExportPDF={printNow} pdfLoading={pdfLoading}/>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการบันทึกฉลาก"
        description={active ? `ฉลาก ${active.soId} จะถูกบันทึกในระบบและประวัติการแก้ไข` : ""}
        changes={active ? [
          { label: "ผู้รับ", to: active.recipient.name },
          { label: "ขนส่ง", to: active.carrier },
          { label: "เลขพัสดุ", to: active.tracking || "—" },
          { label: "รายการสินค้า", to: `${active.items.length} SKU · ${active.items.reduce((s,x)=>s+x.qty,0)} ชิ้น` }
        ] : []}
        action="บันทึก"
        onConfirm={doSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* Unified picker — search & select single products OR product bundles for a label */
function ItemAddPicker({ onAddProduct, onAddBundle }) {
  const [open, setOpen] = useStateLB(false);
  const [q, setQ] = useStateLB("");
  const wrapRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const bundles = useMemoLB(() => (typeof loadBundles === "function" ? loadBundles() : []), [open]);

  useEffectLB(() => {
    if (!open) return;
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const ql = q.trim().toLowerCase();
  const prodMatches = PRODUCTS.filter(p =>
    !ql || p.sku.toLowerCase().includes(ql) || p.name.toLowerCase().includes(ql) || p.cat.toLowerCase().includes(ql)
  );
  const bundleMatches = bundles.filter(b =>
    !ql || b.name.toLowerCase().includes(ql) || (b.desc || "").toLowerCase().includes(ql) ||
    b.items.some(it => it.sku.toLowerCase().includes(ql))
  );

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
        <Icons.Plus size={12}/> เพิ่มสินค้า / ชุด
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          width: 340, background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 14, boxShadow: "var(--shadow-lg)", zIndex: 200,
          maxHeight: 380, display: "flex", flexDirection: "column", overflow: "hidden",
          animation: "modalin 0.14s cubic-bezier(0.2, 0.8, 0.3, 1)"
        }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <div className="search" style={{ width: "100%" }}>
              <Icons.Search size={14}/>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาสินค้าเดี่ยว หรือ ชุดสินค้า"/>
              {q && <span style={{ cursor: "pointer", color: "var(--muted)" }} onClick={() => setQ("")}><Icons.X size={12}/></span>}
            </div>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {bundleMatches.length > 0 && (
              <>
                <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>ชุดสินค้า</div>
                {bundleMatches.map(b => {
                  const avail = typeof bundleAvail === "function" ? bundleAvail(b) : 0;
                  return (
                    <div key={b.id} onClick={() => { onAddBundle(b); setOpen(false); }}
                      style={{ padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)" }}>
                      <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <Icons.Bundle size={14}/>
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{b.items.length} รายการในชุด</div>
                      </div>
                      <span className={"badge " + (avail > 0 ? "badge-success" : "badge-danger")} style={{ fontSize: 9, flexShrink: 0 }}>
                        <span className="dot"/>{avail > 0 ? "ขายได้ " + avail : "หมด"}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
            <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>สินค้าเดี่ยว</div>
            {prodMatches.map(p => (
              <div key={p.sku} onClick={() => { onAddProduct(p); setOpen(false); }}
                style={{ padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{p.sku} · {p.cat}</div>
                </div>
                <span className="tnum" style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>คงเหลือ {p.qty}</span>
              </div>
            ))}
            {prodMatches.length === 0 && bundleMatches.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>ไม่พบสินค้าหรือชุดที่ตรงกับ "{q}"</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, mono, num }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        style={mono ? { fontFamily: "IBM Plex Mono, monospace", fontSize: 12 } : num ? { textAlign: "right" } : {}}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function fmtLabelDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543} ${pad(d.getHours())}:${pad(d.getMinutes())} น.`;
}

/* ===== Label paper (the actual printed thing) — minimal modern, no barcode/QR ===== */
function LabelPaper({ label, size, store }) {
  const wPx = size.w * MM_TO_PX;
  const hPx = size.h * MM_TO_PX;

  // For very small sizes, condense the layout
  const compact = size.w * size.h < 100 * 130;
  const s = store || DEFAULT_STORE;

  // Brand accents — hardcoded hex (html2canvas 1.4.1 can't parse oklch()/CSS vars).
  // PS TACTICAL orange. Used ONLY for decorative elements; ALL text stays #111 (black).
  const ACCENT = "#f15a22";
  const ACCENT_GRAD = "linear-gradient(135deg, #ff8a3d, #ef5a1c)";

  // Section eyebrow with a small orange brand tick — reused across blocks.
  const Eyebrow = ({ text, onTint }) => (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 4 : 5 }}>
      <span style={{ width: compact ? 3 : 3.5, height: compact ? 9 : 11, background: ACCENT, borderRadius: 2, flexShrink: 0 }}/>
      <span style={{ fontSize: compact ? 6.5 : 7.5, color: "#111", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>{text}</span>
    </div>
  );

  return (
    <div
      className="label-paper"
      style={{
        width: wPx,
        height: hPx,
        padding: compact ? "13px 13px 11px" : "18px 17px 15px",
        position: "relative",
        overflow: "hidden",
        boxSizing: "border-box",
        fontSize: compact ? 9 : 10
      }}
    >
      {/* Brand accent strip across the very top edge (decorative) */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: compact ? 4 : 5, background: ACCENT_GRAD }}/>

      {/* Header: store logo + name on left, carrier + SO on right */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #111", paddingBottom: compact ? 8 : 10, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: compact ? 8 : 10, minWidth: 0 }}>
          <StoreLogoMark store={s} size={compact ? 32 : 42} forLabel/>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: compact ? 11.5 : 14, fontWeight: 700, color: "#111", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
            <div style={{ fontSize: compact ? 7 : 8, color: "#111", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.tagline}</div>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: compact ? 6.5 : 7.5, color: "#111", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 600 }}>Shipping Label</div>
          <div className="mono" style={{ fontSize: compact ? 9.5 : 11, fontWeight: 600, marginTop: 2, color: "#111" }}>{label.soId}</div>
          <div style={{ fontSize: compact ? 7.5 : 8.5, color: "#111", marginTop: 2, fontWeight: 600 }}>{label.carrier}</div>
          {(label.created_at || label.updatedAt) && <div style={{ fontSize: compact ? 5.5 : 6.5, color: "#111", marginTop: 2 }}>{fmtLabelDate(label.created_at || label.updatedAt)}</div>}
        </div>
      </div>

      {/* Sender */}
      <div style={{ padding: compact ? "7px 0 5px" : "10px 0 8px", borderBottom: "1px dashed #cfcfcf" }}>
        <Eyebrow text="From · ผู้ส่ง"/>
        <div style={{ fontSize: compact ? 9.5 : 11, marginTop: 4, lineHeight: 1.4, color: "#111" }}>
          <div style={{ fontWeight: 700, fontSize: compact ? 11.5 : 13 }}>{label.sender.name}</div>
          <div>{label.sender.addr1}</div>
          <div>{label.sender.addr2}</div>
          <div className="mono" style={{ marginTop: 1 }}>โทร. {label.sender.phone}</div>
        </div>
      </div>

      {/* Recipient — hero card on standard labels; a tighter plain block on tiny labels to save room.
          Address text is enlarged in both cases (the focus of this layout). */}
      <div style={compact
        ? { padding: "7px 0", borderBottom: "2px solid #111" }
        : { marginTop: 11, padding: "13px 15px", background: "#f6f5f3", borderRadius: 9, border: "1px solid #e7e5e1" }}>
        <Eyebrow text="To · ผู้รับ"/>
        <div style={{ marginTop: compact ? 4 : 6, lineHeight: 1.45, color: "#111" }}>
          <div style={{ fontSize: compact ? 16 : 21, fontWeight: 700, letterSpacing: "-0.01em" }}>{label.recipient.name}</div>
          <div style={{ fontSize: compact ? 10.5 : 14, marginTop: compact ? 3 : 6, fontWeight: 500 }}>{label.recipient.addr1}</div>
          <div style={{ fontSize: compact ? 10.5 : 14, fontWeight: 500 }}>{label.recipient.addr2}</div>
          <div className="mono" style={{ fontSize: compact ? 10 : 12.5, marginTop: compact ? 3 : 6, fontWeight: 600 }}>โทร. {label.recipient.phone}</div>
        </div>
      </div>

      {/* Items list */}
      <div style={{ padding: compact ? "6px 0" : "10px 0", overflow: "hidden" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <Eyebrow text={`Items · รายการ (${label.items.reduce((s,i)=>s+i.qty,0)})`}/>
          <span style={{ fontSize: compact ? 7.5 : 8.5, color: "#111", fontWeight: 600 }}>น้ำหนัก {label.weight}</span>
        </div>
        <div style={{ fontSize: compact ? 8.5 : 10, lineHeight: 1.45, color: "#111", ...(compact ? { maxHeight: 42, overflow: "hidden" } : {}) }}>
          {label.items.slice(0, compact ? 2 : 6).map((it, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.sku && <span className="mono" style={{ fontSize: compact ? 7 : 8, color: "#111", marginRight: 6 }}>{it.sku}</span>}
                {it.name}
              </span>
              <span className="mono" style={{ flexShrink: 0, fontWeight: 600 }}>× {it.qty}</span>
            </div>
          ))}
          {label.items.length > (compact ? 2 : 6) && (
            <div style={{ fontSize: compact ? 7.5 : 8.5, color: "#111", marginTop: 3, fontStyle: "italic" }}>… และอีก {label.items.length - (compact ? 2 : 6)} รายการ</div>
          )}
        </div>
      </div>

      {/* Footer: tracking + payment — pinned to the bottom via absolute position
          so it renders identically in html2canvas (which mishandles flex:1). */}
      <div style={{ position: "absolute", left: compact ? 13 : 17, right: compact ? 13 : 17, bottom: compact ? 11 : 15, display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: "2px solid #111", paddingTop: compact ? 8 : 10, gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Eyebrow text="Tracking · เลขพัสดุ"/>
          <div className="mono" style={{ fontSize: compact ? 12.5 : 15.5, fontWeight: 700, marginTop: 3, letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#111" }}>{label.tracking}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {label.cod > 0 ? (
            <div style={{ background: "#111", color: "white", padding: compact ? "5px 11px" : "7px 14px", fontSize: compact ? 10 : 12, fontWeight: 700, letterSpacing: "0.06em", borderRadius: 999 }}>
              COD ฿{label.cod.toLocaleString()}
            </div>
          ) : (
            <div style={{ border: "1.5px solid #111", padding: compact ? "4px 10px" : "5px 12px", fontSize: compact ? 9 : 10.5, fontWeight: 700, letterSpacing: "0.08em", borderRadius: 999, color: "#111" }}>
              PAID · ชำระแล้ว
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== Batch view ===== */
function BatchView({ labels, selected, setSelected, size, zoom, store, onExportPDF, pdfLoading }) {
  const sel = labels.filter(l => selected[l.id]);
  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* selection bar */}
      <div className="card no-print" style={{ padding: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => setSelected(Object.fromEntries(labels.map(l => [l.id, true])))}>เลือกทั้งหมด</button>
          <button className="btn btn-sm" onClick={() => setSelected({})}>ล้างการเลือก</button>
          <div className="spacer"/>
          {labels.map(l => (
            <label key={l.id} className="row" style={{ gap: 6, fontSize: 12, cursor: "pointer", padding: "4px 8px", background: "var(--surface-2)", borderRadius: 6 }}>
              <span
                className={"check" + (selected[l.id] ? " on" : "")}
                onClick={() => setSelected(s => ({ ...s, [l.id]: !s[l.id] }))}
              />
              <span className="mono">{l.soId}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="label-stage no-print-stage" style={{ alignItems: "flex-start", padding: 20 }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${size.w * MM_TO_PX * zoom + 24}px, 1fr))`,
          gap: 20,
          width: "100%",
          justifyItems: "center"
        }}>
          {sel.map(l => (
            <div key={l.id} className="batch-card">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
                <LabelPaper label={l} size={size} store={store}/>
              </div>
              <div className="row no-print" style={{ marginTop: 8, fontSize: 11, color: "var(--muted)", justifyContent: "center", gap: 6 }}>
                <span className="mono">{l.soId}</span>
                <span>·</span>
                <span>{l.carrier.split(" ")[0]}</span>
              </div>
            </div>
          ))}
          {sel.length === 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 60, color: "var(--muted)" }}>
              เลือกฉลากด้านบนเพื่อเพิ่มเข้าชุดพิมพ์
            </div>
          )}
        </div>
      </div>

      {sel.length > 0 && (
        <div className="card no-print" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13 }}>
            พร้อมพิมพ์ <strong className="tnum">{sel.length}</strong> ใบ · ขนาด {size.label} · กระดาษโดยประมาณ {sel.length} แผ่น
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={onExportPDF} disabled={pdfLoading} style={pdfLoading ? { opacity: 0.75, cursor: "wait" } : {}}>
              <Icons.Print size={14}/> {pdfLoading ? "กำลังสร้าง…" : "ส่งออก PDF (ชุด)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Labels, LabelPaper, loadLabels, saveLabels, parseRecipientBlob, blankLabel: makeBlankLabel, createSaleLabel, exportLabelPDF, SenderPicker, loadSenders, saveSenders, storeSenderTemplate });
