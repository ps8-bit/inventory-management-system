/* ══════════════════════════════════════════════════════════════════════════
   นำเข้าข้อมูล — two independent importers sharing one page:
     • StockCsvImport   — the REAL catalog: creates/updates rows in PRODUCTS
     • WooCatalogImport — a SKU-keyed REFERENCE catalog that auto-fills scans
   ══════════════════════════════════════════════════════════════════════════ */

const { useState: useStateImp, useRef: useRefImp, useMemo: useMemoImp } = React;

/* ── Importable fields ──
   `kw` drives header auto-detection (autoMapColumns): a longer keyword scores
   higher, so a "ราคาทุน" header lands on cost instead of being swallowed by
   price's "ราคา". `cap` hides a field from roles without that capability — a
   staff account with no viewCost never sees, maps, or imports a cost column
   (same rule the CSV/Excel exports follow).
   Only sku+name are required. Every other column is optional and a BLANK cell
   is left alone on an existing product rather than overwriting it with a
   default — so a 3-column price-update file can't wipe supplier/location. */
const IMPORT_FIELDS = [
  { key: "sku",      label: "SKU / รหัสสินค้า", required: true, type: "text",
    kw: ["sku", "รหัสสินค้า", "รหัส sku", "รหัส", "product code", "code"],
    example: "TH-NEW-101", hint: "รหัสเฉพาะของสินค้า — ใช้จับคู่เวลานำเข้าซ้ำ" },
  { key: "name",     label: "ชื่อสินค้า", required: true, type: "text",
    kw: ["ชื่อสินค้า", "ชื่อ", "product name", "name", "title", "รายการ"],
    example: "หูฟัง In-Ear Pro รุ่น 2025", hint: "ชื่อที่แสดงในระบบ" },
  { key: "cat",      label: "หมวดหมู่", type: "text",
    kw: ["หมวดหมู่", "หมวด", "ประเภทสินค้า", "ประเภท", "category", "categories", "cat"],
    example: "อิเล็กทรอนิกส์", hint: "ถ้าเว้นว่างสำหรับสินค้าใหม่จะเป็น “ทั่วไป”", default: "ทั่วไป" },
  { key: "brand",    label: "แบรนด์", type: "text",
    kw: ["แบรนด์", "ยี่ห้อ", "brand", "brands"],
    example: "SoundMax", hint: "แบรนด์สินค้า (ถ้ามี)", default: "" },
  { key: "loc",      label: "ตำแหน่งจัดเก็บ", type: "text",
    kw: ["ตำแหน่งจัดเก็บ", "ตำแหน่ง", "ที่จัดเก็บ", "ที่เก็บ", "location", "loc", "shelf", "bin"],
    example: "ตึกพาณิชย์ › ชั้น 1 › A1", hint: "ต้องตรงกับผังคลัง มิฉะนั้นจะขึ้นคำเตือน", default: "-" },
  { key: "price",    label: "ราคาขาย", type: "num",
    kw: ["ราคาขาย", "ราคาปลีก", "regular price", "sale price", "ราคา", "price"],
    example: "1290", hint: "ตัวเลขเท่านั้น (คั่นหลักพันได้)", default: 0 },
  { key: "cost",     label: "ราคาทุน", type: "num", cap: "viewCost",
    kw: ["ราคาทุน", "ต้นทุนต่อชิ้น", "ต้นทุน", "ทุน", "unit cost", "cost"],
    example: "800", hint: "ใช้คำนวณกำไร/มาร์จิ้น", default: 0 },
  { key: "qty",      label: "จำนวนคงเหลือ", type: "int",
    kw: ["จำนวนคงเหลือ", "คงเหลือ", "จำนวน", "สต็อก", "stock", "quantity", "qty"],
    example: "80", hint: "ความหมายขึ้นกับโหมด “SKU ที่มีอยู่แล้ว”", default: 0 },
  { key: "reorder",  label: "จุดสั่งซื้อใหม่", type: "int",
    kw: ["จุดสั่งซื้อใหม่", "จุดสั่งซื้อ", "สั่งซื้อเมื่อ", "reorder point", "reorder", "min stock"],
    example: "25", hint: "แจ้งเตือนเมื่อคงเหลือต่ำกว่าค่านี้", default: 0 },
  { key: "supplier", label: "ผู้จัดส่ง", type: "text",
    kw: ["ผู้จัดส่ง", "ซัพพลายเออร์", "ผู้ขาย", "supplier", "vendor"],
    example: "Tech Wave Co.", hint: "ชื่อ supplier", default: "ไม่ระบุ" },
  { key: "image",    label: "ลิงก์รูปสินค้า", type: "url",
    kw: ["ลิงก์รูป", "url รูป", "รูปสินค้า", "รูปภาพ", "รูป", "images", "image", "photo"],
    example: "https://example.com/p.jpg", hint: "ต้องเป็น http/https — จะถูกใส่เป็นรูปสินค้า" }
];

const SAMPLE_ROWS = [
  ["TH-NEW-101", "หูฟัง In-Ear Pro รุ่น 2025",     "อิเล็กทรอนิกส์",     "SoundMax",  "ตึกพาณิชย์ › ชั้น 1 › A1", 1290, 800, 80,  25, "Tech Wave Co.",  ""],
  ["TH-NEW-102", "เสื้อโปโล Cotton สีกรม Size L",  "เสื้อผ้า",           "BKK Wear",  "ตึกพาณิชย์ › ชั้น 1 › A2", 590,  310, 120, 40, "บางกอกแฟชั่น",   ""],
  ["TH-NEW-103", "กล่องเก็บของพับได้ 30L",         "ของใช้ในบ้าน",       "HomeFit",   "ตึกพาณิชย์ › ชั้น 2 › B1", 390,  205, 60,  20, "Comfort Living", ""]
];

/* How an existing SKU is treated. Default is keepQty: a re-import is nearly
   always a data refresh, and silently rewriting stock from a stale spreadsheet
   is the one mistake that can't be undone from the UI. */
const DUP_MODES = [
  { id: "keepQty", label: "อัปเดตข้อมูล ไม่แตะจำนวน", desc: "แก้ชื่อ/ราคา/ตำแหน่ง ฯลฯ แต่คงจำนวนในคลังไว้เท่าเดิม (ปลอดภัยที่สุด)" },
  { id: "set",     label: "เขียนทับทั้งหมด",           desc: "ใช้ค่าจากไฟล์เป็นความจริง รวมถึงจำนวนคงเหลือ (เหมือนผลนับสต็อก)" },
  { id: "addQty",  label: "บวกจำนวนเข้าของเดิม",       desc: "รับเข้าเพิ่ม — จำนวนในไฟล์คือยอดที่รับเข้ามาใหม่" },
  { id: "skip",    label: "ข้ามไป",                    desc: "นำเข้าเฉพาะ SKU ที่ยังไม่มีในระบบ" }
];

const IMPORT_MAX_ROWS = 5000;

/* ── Header auto-mapping ──
   Scores every (field, column) pair then assigns greedily best-first, so one
   column can't be claimed by two fields and the strongest match wins globally.
   Returns { fieldKey: columnIndex }; unmatched fields are simply absent. */
function autoMapColumns(headers, fields) {
  const norm = (s) => String(s == null ? "" : s)
    .replace(/\*/g, "").replace(/[()[\]]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const cols = headers.map(norm);
  const pairs = [];
  fields.forEach(f => {
    cols.forEach((h, i) => {
      if (!h) return;
      let best = 0;
      f.kw.forEach(kwRaw => {
        const kw = norm(kwRaw);
        if (!kw) return;
        let s = 0;
        if (h === kw) s = 200 + kw.length;
        else if (h.startsWith(kw) || h.endsWith(kw)) s = 100 + kw.length * 2;
        else if (h.indexOf(kw) > -1) s = 40 + kw.length * 2;
        if (s > best) best = s;
      });
      if (best) pairs.push({ key: f.key, col: i, score: best });
    });
  });
  pairs.sort((a, b) => b.score - a.score);
  const map = {}, usedCol = {};
  pairs.forEach(p => {
    if (map[p.key] != null || usedCol[p.col]) return;
    map[p.key] = p.col; usedCol[p.col] = true;
  });
  return map;
}

/* Turn the file body + a column map into plain string rows. Kept as raw strings
   (never coerced here) so the review table can show exactly what the file said
   and inline edits re-validate through the same path as the original parse. */
function buildImportRaws(body, map, fields) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i] || [];
    if (!r.some(c => c !== "" && c != null)) continue;   // blank line
    const o = { _row: i + 2 };                            // +2: 1-based, header consumed
    fields.forEach(f => {
      const ci = map[f.key];
      o[f.key] = (ci != null && ci >= 0 && r[ci] != null) ? String(r[ci]).trim() : "";
    });
    out.push(o);
    if (out.length >= IMPORT_MAX_ROWS) break;
  }
  return out;
}

/* Validate + classify every row against the live catalog.
   Errors block a row; warnings never do. `_state` is what will actually happen:
     "new" | "update" | "skip" | "error"
   `_values` carries ONLY the columns that were mapped AND non-blank, so an
   update can't blank out a field the file never mentioned. */
function validateImportRows(raws, opt) {
  const mapped   = opt.mapped || new Set();
  const dupMode  = opt.dupMode || "keepQty";
  const bySku    = {};
  PRODUCTS.forEach(p => { bySku[String(p.sku || "").trim().toLowerCase()] = p; });
  const catSet   = new Set(typeof loadCategories   === "function" ? loadCategories()   : []);
  const locSet   = new Set(typeof allLocationCodes === "function" ? allLocationCodes() : []);
  const seen     = {};

  return raws.map(r => {
    const errors = [], warns = [];
    let sku = String(r.sku || "").trim();
    if (opt.normSku) sku = sku.toUpperCase();
    const key  = sku.toLowerCase();
    const name = String(r.name || "").trim();
    const has  = (k) => mapped.has(k) && String(r[k] == null ? "" : r[k]).trim() !== "";

    if (!sku)  errors.push("ไม่มี SKU");
    if (!name) errors.push("ไม่มีชื่อสินค้า");
    if (sku && /\s/.test(sku)) warns.push("SKU มีช่องว่าง — ตรวจว่าถูกต้อง");

    // Numbers: strip thousands separators / ฿ before parsing; blank = "not provided".
    const num = (k, label, int) => {
      if (!has(k)) return null;
      const s = String(r[k]).trim().replace(/[,\s฿]/g, "");
      const n = int ? parseInt(s, 10) : parseFloat(s);
      if (!isFinite(n)) { errors.push(label + "ไม่ใช่ตัวเลข"); return null; }
      if (n < 0)        { errors.push(label + "ติดลบ");        return null; }
      return n;
    };
    const price   = num("price",   "ราคาขาย");
    const cost    = num("cost",    "ราคาทุน");
    const qty     = num("qty",     "จำนวน",        true);
    const reorder = num("reorder", "จุดสั่งซื้อ",  true);

    if (sku) {
      if (seen[key] != null) errors.push("SKU ซ้ำกับแถวที่ " + seen[key]);
      else seen[key] = r._row;
    }

    const cur    = sku ? bySku[key] : null;
    const exists = !!cur;

    // Only columns the file actually provided — a blank never overwrites.
    const values = {};
    if (name)            values.name     = name;
    if (has("cat"))      values.cat      = String(r.cat).trim();
    if (has("brand"))    values.brand    = String(r.brand).trim();
    if (has("loc"))      values.loc      = String(r.loc).trim();
    if (has("supplier")) values.supplier = String(r.supplier).trim();
    if (price   !== null) values.price   = price;
    if (cost    !== null) values.cost    = cost;
    if (qty     !== null) values.qty     = qty;
    if (reorder !== null) values.reorder = reorder;

    const image = has("image") ? String(r.image).trim() : "";
    if (image && !/^https?:\/\//i.test(image)) warns.push("ลิงก์รูปไม่ใช่ http/https — จะข้ามรูปนี้");

    // Warnings that depend on what the row will do.
    if (values.cat && !catSet.has(values.cat)) warns.push("หมวดหมู่ใหม่: " + values.cat);
    if (values.loc && values.loc !== "-" && locSet.size && !locSet.has(values.loc))
      warns.push("ไม่พบตำแหน่งนี้ในผังคลัง");
    const effPrice = price !== null ? price : (cur ? Number(cur.price) || 0 : 0);
    const effCost  = cost  !== null ? cost  : (cur ? Number(cur.cost)  || 0 : 0);
    if (effCost > 0 && effPrice > 0 && effCost > effPrice) warns.push("ราคาทุนสูงกว่าราคาขาย");
    if (!exists && effPrice === 0) warns.push("ยังไม่ได้ระบุราคาขาย");

    let state = exists ? "update" : "new";
    if (exists) {
      if (!opt.canEdit)          { state = "skip"; warns.push("บัญชีนี้ไม่มีสิทธิ์แก้ไขสินค้า"); }
      else if (dupMode === "skip") state = "skip";
      else if (dupMode === "set" && qty !== null && qty !== (Number(cur.qty) || 0))
        warns.push("จะเขียนทับจำนวน " + (Number(cur.qty) || 0).toLocaleString() + " → " + qty.toLocaleString());
      else if (dupMode === "addQty" && qty)
        warns.push("จะบวกเพิ่ม " + qty.toLocaleString() + " เป็น " + ((Number(cur.qty) || 0) + qty).toLocaleString());
    } else if (!opt.canAdd) {
      state = "skip"; warns.push("บัญชีนี้ไม่มีสิทธิ์เพิ่มสินค้าใหม่");
    }
    if (errors.length) state = "error";

    // An error row won't import at all, so its warnings are noise — a bad price
    // cell otherwise reports both "ราคาขายไม่ใช่ตัวเลข" and "ยังไม่ได้ระบุราคาขาย".
    return { ...r, _sku: sku, _exists: exists, _cur: cur, _image: image, _values: values,
             _errors: errors, _warns: errors.length ? [] : warns, _state: state };
  });
}

// Defaults applied only when CREATING a product — an update never sees these.
function importRowDefaults(fields) {
  const d = {};
  fields.forEach(f => { if (f.default !== undefined) d[f.key] = f.default; });
  d.qty = d.qty || 0;
  return d;
}

const csvCell = (v) => {
  const s = String(v == null ? "" : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
// BOM first — without it Excel on Windows reads a UTF-8 Thai CSV as mojibake.
function downloadCsvFile(aoa, filename) {
  const csv = "﻿" + aoa.map(r => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ImportPage({ pushToast, goTo }) {
  const [mode, setMode] = useStateImp("stock"); // stock (catalog) | woo (reference catalog)

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 1180 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">นำเข้าข้อมูล</h1>
          <div className="page-sub">
            {mode === "woo"
              ? "นำเข้าแคตตาล็อกอ้างอิงจาก WooCommerce — เมื่อสแกน SKU ที่ตรงกัน ระบบจะดึงชื่อ/หมวดหมู่/ราคา/รูปให้อัตโนมัติ"
              : "อัปโหลด CSV หรือ Excel เพื่อเพิ่ม/อัปเดตสินค้าในคลัง — จับคู่คอลัมน์เอง ตรวจทุกแถว แก้ได้ก่อนยืนยัน"}
          </div>
        </div>
      </div>

      <div className="tabs">
        <div className={"tab" + (mode === "stock" ? " active" : "")} onClick={() => setMode("stock")}>
          <Icons.Pkg size={14}/> นำเข้าสินค้า (CSV / Excel)
        </div>
        <div className={"tab" + (mode === "woo" ? " active" : "")} onClick={() => setMode("woo")}>
          <Icons.Scan size={14}/> แคตตาล็อก WooCommerce
        </div>
      </div>

      {mode === "woo"
        ? <WooCatalogImport pushToast={pushToast}/>
        : <StockCsvImport pushToast={pushToast} goTo={goTo} onWooFile={() => setMode("woo")}/>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   StockCsvImport — 4 steps: เลือกไฟล์ → จับคู่คอลัมน์ → ตรวจ/แก้ → ยืนยัน
   ════════════════════════════════════════════════════════════════════════ */
function StockCsvImport({ pushToast, goTo, onWooFile }) {
  const [stage, setStage]           = useStateImp("idle");   // idle | map | review | done
  const [fileName, setFileName]     = useStateImp("");
  const [headers, setHeaders]       = useStateImp([]);
  const [body, setBody]             = useStateImp([]);
  const [truncated, setTruncated]   = useStateImp(0);
  const [map, setMap]               = useStateImp({});
  const [raws, setRaws]             = useStateImp([]);
  const [dupMode, setDupMode]       = useStateImp("keepQty");
  const [normSku, setNormSku]       = useStateImp(true);
  const [createCats, setCreateCats] = useStateImp(true);
  const [applyImages, setApplyImages] = useStateImp(true);
  const [withSamples, setWithSamples] = useStateImp(true);
  const [filter, setFilter]         = useStateImp("all");
  const [editIdx, setEditIdx]       = useStateImp(-1);
  const [showN, setShowN]           = useStateImp(200);
  const [busy, setBusy]             = useStateImp(false);
  const [prog, setProg]             = useStateImp({ done: 0, total: 0 });
  const [result, setResult]         = useStateImp(null);
  const [dragOver, setDragOver]     = useStateImp(false);
  const fileRef = useRefImp(null);

  const cap      = (id) => (typeof canDo === "function" ? canDo(id) : true);
  const canAdd   = cap("addProduct");
  const canEdit  = cap("editProduct");
  const canExport = cap("exportData");
  const fields   = IMPORT_FIELDS.filter(f => !f.cap || cap(f.cap));
  const costHidden = IMPORT_FIELDS.some(f => f.cap === "viewCost") && !cap("viewCost");
  const xlsxReady = typeof XLSX !== "undefined";

  const mappedKeys = fields.filter(f => map[f.key] != null && map[f.key] >= 0).map(f => f.key);
  const mappedSig  = mappedKeys.join(",");
  const shownFields = fields.filter(f => mappedKeys.indexOf(f.key) > -1);

  const rows = useMemoImp(
    () => validateImportRows(raws, { mapped: new Set(mappedKeys), dupMode, canAdd, canEdit, normSku }),
    [raws, mappedSig, dupMode, canAdd, canEdit, normSku]
  );

  const nNew    = rows.filter(r => r._state === "new").length;
  const nUpd    = rows.filter(r => r._state === "update").length;
  const nSkip   = rows.filter(r => r._state === "skip").length;
  const nErr    = rows.filter(r => r._state === "error").length;
  const nWarn   = rows.filter(r => r._state !== "error" && r._warns.length > 0).length;
  const importable = rows.filter(r => r._state === "new" || r._state === "update");

  const newCats = useMemoImp(() => {
    const known = new Set(typeof loadCategories === "function" ? loadCategories() : []);
    const out = new Set();
    importable.forEach(r => { const c = r._values.cat; if (c && !known.has(c)) out.add(c); });
    return [...out];
  }, [rows]);

  const imageCount = importable.filter(r => r._image && /^https?:\/\//i.test(r._image)).length;

  /* ── Step 1: template + file ── */
  const templateAoA = (withRows) => {
    const head = fields.map(f => f.label + (f.required ? " *" : ""));
    if (!withRows) return [head];
    const idx = fields.map(f => IMPORT_FIELDS.findIndex(x => x.key === f.key));
    return [head, ...SAMPLE_ROWS.map(sr => idx.map(i => sr[i]))];
  };

  const downloadTemplateCsv = () => {
    downloadCsvFile(templateAoA(withSamples), "เทมเพลตนำเข้าสินค้า.csv");
    pushToast("ดาวน์โหลดเทมเพลต .csv แล้ว");
  };

  const downloadTemplateXlsx = () => {
    if (!xlsxReady) { pushToast("ไลบรารี Excel ยังไม่พร้อม กรุณารอสักครู่"); return; }
    const ws = XLSX.utils.aoa_to_sheet(templateAoA(withSamples));
    ws["!cols"] = fields.map(f => ({ wch: Math.max(f.label.length + 4, 18) }));
    const instr = [
      ["เทมเพลตนำเข้าสินค้า — คลังพร้อมส่ง"],
      [""],
      ["วิธีใช้"],
      ["1. กรอกข้อมูลในชีท “สินค้า” — คอลัมน์ที่มี * ต้องกรอก"],
      ["2. ลบแถวตัวอย่างออกก่อนอัปโหลด"],
      ["3. สลับลำดับคอลัมน์ได้ ระบบให้จับคู่คอลัมน์เองในขั้นตอนถัดไป"],
      ["4. เว้นช่องว่างไว้ = ไม่แก้ค่าเดิมของสินค้านั้น"],
      ["5. รองรับ .csv และ .xlsx — สูงสุด " + IMPORT_MAX_ROWS.toLocaleString() + " แถวต่อครั้ง"],
      [""],
      ["ความหมายของคอลัมน์"],
      ["คอลัมน์", "จำเป็น", "ตัวอย่าง", "คำอธิบาย"],
      ...fields.map(f => [f.label, f.required ? "ต้องกรอก" : "ไม่บังคับ", f.example, f.hint])
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI["!cols"] = [{ wch: 20 }, { wch: 12 }, { wch: 26 }, { wch: 46 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "สินค้า");
    XLSX.utils.book_append_sheet(wb, wsI, "วิธีใช้");
    XLSX.writeFile(wb, "เทมเพลตนำเข้าสินค้า.xlsx");
    pushToast("ดาวน์โหลดเทมเพลต .xlsx แล้ว");
  };

  // Round-trip helper: export what's in stock now, edit in Excel, import back.
  const exportCurrent = () => {
    const head = fields.map(f => f.label + (f.required ? " *" : ""));
    const imgs = typeof loadProductImages === "function" ? loadProductImages() : {};
    const aoa = [head, ...PRODUCTS.map(p => fields.map(f => (f.key === "image" ? (imgs[p.sku] || "") : (p[f.key] != null ? p[f.key] : ""))))];
    downloadCsvFile(aoa, "สินค้าปัจจุบัน-" + (typeof todayIso === "function" ? todayIso() : "export") + ".csv");
    pushToast("ส่งออกสินค้าปัจจุบัน " + PRODUCTS.length.toLocaleString() + " รายการ");
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!xlsxReady) { pushToast("ไลบรารี Excel ยังไม่พร้อม กรุณารอสักครู่"); return; }
    const ext = file.name.toLowerCase().split(".").pop();
    if (["xlsx", "xls", "csv"].indexOf(ext) === -1) { pushToast("รองรับเฉพาะไฟล์ .csv, .xlsx หรือ .xls"); return; }
    if (file.size > 8 * 1024 * 1024) { pushToast("ไฟล์ใหญ่เกิน 8 MB — แบ่งไฟล์ก่อนนำเข้า"); return; }

    readSheetToAoA(file).then(aoa => {
      const head = (aoa[0] || []).map(h => String(h == null ? "" : h).trim());
      if (!head.some(h => h)) { pushToast("แถวแรกของไฟล์ต้องเป็นชื่อคอลัมน์"); return; }

      // A WooCommerce export dropped in here would produce a wall of mismatches —
      // send it to the tab that understands it instead.
      const low = head.map(h => h.toLowerCase());
      const looksWoo = low.indexOf("parent") > -1 || low.indexOf("regular price") > -1 ||
                       (low.indexOf("type") > -1 && low.indexOf("images") > -1);
      if (looksWoo && onWooFile) {
        onWooFile();
        pushToast("ไฟล์นี้เป็น WooCommerce export — สลับไปแท็บ “แคตตาล็อก WooCommerce” ให้แล้ว ลากไฟล์มาวางอีกครั้ง");
        return;
      }

      const rest = aoa.slice(1).filter(r => r && r.some(c => c !== "" && c != null));
      if (!rest.length) { pushToast("ไม่พบข้อมูลในไฟล์ (มีแต่หัวตาราง)"); return; }

      const m = autoMapColumns(head, fields);
      setFileName(file.name);
      setHeaders(head);
      setBody(rest);
      setTruncated(Math.max(0, rest.length - IMPORT_MAX_ROWS));
      setMap(m);
      setStage("map");
      const got = fields.filter(f => m[f.key] != null).length;
      pushToast("อ่านไฟล์สำเร็จ " + rest.length.toLocaleString() + " แถว · จับคู่คอลัมน์อัตโนมัติได้ " + got + "/" + fields.length);
    }).catch(err => {
      console.error(err);
      pushToast("อ่านไฟล์ไม่ได้ — ตรวจสอบว่าเป็น .csv หรือ .xlsx ที่ไม่เสียหาย");
    });
  };

  const goReview = () => {
    if (map.sku == null || map.sku < 0)   { pushToast("ต้องจับคู่คอลัมน์ SKU ก่อน"); return; }
    if (map.name == null || map.name < 0) { pushToast("ต้องจับคู่คอลัมน์ชื่อสินค้าก่อน"); return; }
    setRaws(buildImportRaws(body, map, fields));
    setEditIdx(-1); setFilter("all"); setShowN(200);
    setStage("review");
  };

  const reset = () => {
    setStage("idle"); setFileName(""); setHeaders([]); setBody([]); setRaws([]);
    setMap({}); setResult(null); setEditIdx(-1); setFilter("all"); setShowN(200);
    setTruncated(0); setProg({ done: 0, total: 0 });
  };

  const editCell = (i, key, val) => setRaws(prev => prev.map((r, ix) => (ix === i ? { ...r, [key]: val } : r)));
  const dropRow  = (i) => { setRaws(prev => prev.filter((_, ix) => ix !== i)); setEditIdx(-1); };

  /* ── Confirm ── */
  const runImport = async () => {
    if (busy || !importable.length) return;
    if (typeof importProductsBulk !== "function") { pushToast("ระบบนำเข้ายังไม่พร้อม ลองรีเฟรชหน้า"); return; }
    setBusy(true); setProg({ done: 0, total: importable.length });

    const defaults = importRowDefaults(fields);
    const items = importable.map(r => ({
      sku: r._sku,
      mode: r._exists ? dupMode : "add",
      values: r._exists ? r._values : { ...defaults, ...r._values }
    }));

    let res;
    try { res = await importProductsBulk(items, (done, total) => setProg({ done, total })); }
    catch (e) { res = { added: 0, updated: 0, error: (e && e.message) || String(e) }; }

    let catN = 0;
    if (createCats && !res.error && typeof addCategory === "function") {
      newCats.forEach(c => { if (addCategory(c)) catN++; });
    }
    let imgN = 0;
    if (applyImages && !res.error && typeof setProductImagesBulk === "function") {
      const m = {};
      importable.forEach(r => { if (r._image && /^https?:\/\//i.test(r._image)) m[r._sku] = r._image; });
      imgN = setProductImagesBulk(m);
    }
    if (!res.error && typeof recordChange === "function" && (res.added || res.updated)) {
      recordChange({
        entity: "product", action: "import",
        summary: "นำเข้าสินค้าจากไฟล์ " + fileName + " — เพิ่ม " + res.added + ", อัปเดต " + res.updated +
                 (nSkip ? ", ข้าม " + nSkip : "") + (nErr ? ", ผิดพลาด " + nErr : ""),
        count: res.added + res.updated,
        note: "โหมด SKU ซ้ำ: " + (DUP_MODES.find(d => d.id === dupMode) || {}).label
      });
    }

    setResult({ ...res, cats: catN, images: imgN, skipped: nSkip, errors: nErr });
    setBusy(false);
    setStage("done");
    if (res.error) pushToast("นำเข้าไม่สำเร็จ: " + (res.error === "PERMISSION_OR_MISSING" ? "บัญชีนี้ไม่มีสิทธิ์บันทึกสินค้า" : res.error));
    else pushToast("นำเข้าสำเร็จ — เพิ่ม " + res.added + ", อัปเดต " + res.updated + " รายการ");
  };

  /* ── No permission at all ── */
  if (!canAdd && !canEdit) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: "var(--surface-2)", color: "var(--muted)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
          <Icons.Lock size={24}/>
        </div>
        <div style={{ fontWeight: 600, fontSize: 16 }}>บัญชีนี้ไม่มีสิทธิ์นำเข้าสินค้า</div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
          ต้องมีสิทธิ์ “เพิ่มสินค้าใหม่” หรือ “แก้ไขข้อมูลสินค้า” — ติดต่อผู้ดูแลระบบเพื่อขอเปิดสิทธิ์
        </div>
      </div>
    );
  }

  const dz = (
    <div
      className={"dropzone" + (dragOver ? " over" : "")}
      onClick={() => fileRef.current && fileRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
    >
      <div className="dz-icon"><Icons.Pkg size={24}/></div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 12 }}>ลากไฟล์มาวาง หรือ คลิกเพื่อเลือก</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>.csv · .xlsx · .xls — สูงสุด {IMPORT_MAX_ROWS.toLocaleString()} แถว</div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
        onChange={(e) => { handleFile(e.target.files && e.target.files[0]); e.target.value = ""; }}/>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 20 }}>
      <ImportSteps stage={stage}/>

      {/* ─────────── STEP 1 ─────────── */}
      {stage === "idle" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="card" style={{ padding: 24, position: "relative" }}>
              <StepBadge n={1}/>
              <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>ดาวน์โหลดเทมเพลต</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
                ไม่จำเป็นต้องใช้เทมเพลตก็ได้ — ไฟล์ของคุณเรียงคอลัมน์อย่างไรก็ได้ ระบบให้จับคู่คอลัมน์เองในขั้นตอนถัดไป
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={downloadTemplateCsv}><Icons.Down size={14}/> เทมเพลต .csv</button>
                <button className="btn" onClick={downloadTemplateXlsx}><Icons.Down size={14}/> .xlsx</button>
                {canExport && PRODUCTS.length > 0 && (
                  <button className="btn btn-ghost" onClick={exportCurrent} title="ส่งออกสินค้าที่มีอยู่เป็น CSV เพื่อแก้ไขแล้วนำเข้ากลับ">
                    <Icons.Copy size={14}/> ส่งออกของเดิม
                  </button>
                )}
              </div>
              <label className="row" style={{ gap: 8, marginTop: 12, fontSize: 12, color: "var(--fg-2)", cursor: "pointer" }}>
                <input type="checkbox" checked={withSamples} onChange={e => setWithSamples(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }}/>
                ใส่แถวตัวอย่างในเทมเพลต (อย่าลืมลบออกก่อนอัปโหลด)
              </label>

              <div style={{ marginTop: 16, padding: 14, background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>คอลัมน์ที่นำเข้าได้</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                  {fields.map(f => (
                    <div key={f.key} style={{ fontSize: 12, padding: "2px 0", display: "flex", alignItems: "center", gap: 4 }}>
                      {f.required && <span style={{ color: "var(--danger)", fontWeight: 600 }}>*</span>}
                      <span style={{ color: f.required ? "var(--fg)" : "var(--fg-2)" }}>{f.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
                  <span style={{ color: "var(--danger)" }}>*</span> = ต้องกรอก
                  {costHidden && <> · คอลัมน์ราคาทุนถูกซ่อนตามสิทธิ์ของบัญชีนี้ และจะไม่ถูกนำเข้า</>}
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 24, position: "relative" }}>
              <StepBadge n={2}/>
              <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>อัปโหลดไฟล์</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 16, lineHeight: 1.6 }}>
                รองรับ CSV ภาษาไทยทุกแบบ (UTF-8, UTF-16 และ Windows-874 จาก Excel เดิม) — ระบบตรวจการเข้ารหัสให้อัตโนมัติ
              </div>
              {dz}
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, lineHeight: 1.7 }}>
                <div>• เว้นช่องว่างไว้ = ไม่แก้ค่าเดิมของสินค้านั้น</div>
                <div>• SKU ที่มีอยู่แล้วจะถูก<strong style={{ color: "var(--fg-2)" }}>อัปเดต</strong> ไม่ใช่ปฏิเสธ (เลือกวิธีได้ในขั้นตอนตรวจสอบ)</div>
                <div>• ตัวเลขใส่จุลภาคหรือ ฿ ได้ ระบบตัดให้เอง</div>
              </div>
            </div>
          </div>

          {!canAdd && (
            <NoteCard tone="warning" icon={<Icons.Lock size={18}/>} title="บัญชีนี้อัปเดตได้อย่างเดียว">
              คุณไม่มีสิทธิ์ “เพิ่มสินค้าใหม่” — แถวที่เป็น SKU ใหม่จะถูกข้าม แต่ยังอัปเดต SKU ที่มีอยู่แล้วได้ตามปกติ
            </NoteCard>
          )}
          {!canEdit && (
            <NoteCard tone="warning" icon={<Icons.Lock size={18}/>} title="บัญชีนี้เพิ่มได้อย่างเดียว">
              คุณไม่มีสิทธิ์ “แก้ไขข้อมูลสินค้า” — แถวที่ SKU มีอยู่แล้วจะถูกข้าม
            </NoteCard>
          )}
        </>
      )}

      {/* ─────────── STEP 2: column mapping ─────────── */}
      {stage === "map" && (
        <>
          <div className="card card-tight">
            <div className="card-head">
              <div>
                <h3>จับคู่คอลัมน์</h3>
                <div className="sub">{fileName} · {body.length.toLocaleString()} แถว · พบ {headers.length} คอลัมน์ในไฟล์</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setMap(autoMapColumns(headers, fields))}>
                  <Icons.Refresh size={13}/> จับคู่อัตโนมัติอีกครั้ง
                </button>
                <button className="btn btn-sm" onClick={reset}>เลือกไฟล์ใหม่</button>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {fields.map(f => {
                const ci = map[f.key];
                const on = ci != null && ci >= 0;
                const samples = on ? body.slice(0, 3).map(r => String(r[ci] == null ? "" : r[ci]).trim()).filter(Boolean) : [];
                const missingReq = f.required && !on;
                return (
                  <div key={f.key} style={{
                    padding: 12, borderRadius: 10, background: "var(--surface-2)",
                    border: "1px solid " + (missingReq ? "var(--danger)" : on ? "var(--border)" : "var(--border)"),
                    opacity: on || f.required ? 1 : 0.78
                  }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {f.label}{f.required && <span style={{ color: "var(--danger)" }}> *</span>}
                      </div>
                      {on
                        ? <span className="badge badge-success"><Icons.Check size={10}/> จับคู่แล้ว</span>
                        : missingReq
                          ? <span className="badge badge-danger"><Icons.Warn size={10}/> ต้องจับคู่</span>
                          : <span className="badge badge-neutral">ไม่ใช้</span>}
                    </div>
                    <select className="input" value={on ? ci : -1} style={{ padding: "7px 10px", fontSize: 13 }}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        setMap(prev => {
                          const next = { ...prev };
                          // One file column can only feed one field — steal it from whoever had it.
                          if (v >= 0) Object.keys(next).forEach(k => { if (k !== f.key && next[k] === v) delete next[k]; });
                          if (v < 0) delete next[f.key]; else next[f.key] = v;
                          return next;
                        });
                      }}>
                      <option value={-1}>— ไม่ใช้คอลัมน์นี้ —</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || "(คอลัมน์ที่ " + (i + 1) + ")"}</option>)}
                    </select>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, lineHeight: 1.5, minHeight: 30 }}>
                      {samples.length
                        ? <>ตัวอย่าง: <span style={{ color: "var(--fg-2)" }}>{samples.join(" · ")}</span></>
                        : f.hint}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {truncated > 0 && (
            <NoteCard tone="warning" icon={<Icons.Warn size={18}/>} title="ไฟล์ยาวเกินขีดจำกัด">
              ไฟล์มี {(body.length).toLocaleString()} แถว — จะนำเข้าเฉพาะ {IMPORT_MAX_ROWS.toLocaleString()} แถวแรก
              (เหลืออีก {truncated.toLocaleString()} แถว) แบ่งไฟล์แล้วนำเข้าอีกรอบได้
            </NoteCard>
          )}

          <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
              จับคู่แล้ว <strong className="tnum" style={{ color: "var(--fg)" }}>{mappedKeys.length}</strong> / {fields.length} คอลัมน์
              <span style={{ color: "var(--muted)" }}> · คอลัมน์ที่ไม่จับคู่จะถูกมองข้าม ไม่ทำให้ข้อมูลเดิมหาย</span>
            </div>
            <div className="row">
              <button className="btn" onClick={reset}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={goReview}>ตรวจสอบข้อมูล <Icons.ArrowRight size={14}/></button>
            </div>
          </div>
        </>
      )}

      {/* ─────────── STEP 3: review ─────────── */}
      {stage === "review" && (
        <>
          <div className="grid-3">
            <SmallStat label="เพิ่มใหม่"  value={nNew} tone="success" hint={canAdd ? "ยังไม่มีในระบบ" : "ไม่มีสิทธิ์ — จะถูกข้าม"}/>
            <SmallStat label="อัปเดต"     value={nUpd} tone="info"    hint={(DUP_MODES.find(d => d.id === dupMode) || {}).label}/>
            <SmallStat label="ต้องแก้ไข"  value={nErr} tone={nErr > 0 ? "danger" : "success"} hint={nErr > 0 ? "แถวเหล่านี้จะไม่ถูกนำเข้า" : "ไม่มีข้อผิดพลาด"}/>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>SKU ที่มีอยู่ในระบบแล้ว ({nUpd + (dupMode === "skip" ? nSkip : 0)} แถว)</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>เลือกว่าจะทำอย่างไรกับแถวที่ SKU ตรงกับสินค้าที่มีอยู่</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {DUP_MODES.map(m => {
                const on = dupMode === m.id;
                const locked = !canEdit && m.id !== "skip";
                return (
                  <button key={m.id} disabled={locked} onClick={() => { setDupMode(m.id); setShowN(200); }}
                    style={{
                      textAlign: "left", padding: "11px 13px", borderRadius: 10, cursor: locked ? "not-allowed" : "pointer",
                      border: "1.5px solid " + (on ? "var(--accent)" : "var(--border)"),
                      background: on ? "var(--accent-soft)" : "var(--surface)",
                      opacity: locked ? 0.5 : 1
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: on ? "var(--accent)" : "var(--fg)" }}>{m.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>{m.desc}</div>
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ gap: 18, marginTop: 14, flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 7, fontSize: 12.5, cursor: "pointer" }}>
                <input type="checkbox" checked={normSku} onChange={e => setNormSku(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }}/>
                แปลง SKU เป็นตัวพิมพ์ใหญ่
              </label>
              <label className="row" style={{ gap: 7, fontSize: 12.5, cursor: "pointer", opacity: newCats.length ? 1 : 0.55 }}>
                <input type="checkbox" checked={createCats} disabled={!newCats.length} onChange={e => setCreateCats(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }}/>
                สร้างหมวดหมู่ใหม่ {newCats.length > 0 && <strong style={{ color: "var(--accent)" }}>({newCats.length})</strong>}
              </label>
              <label className="row" style={{ gap: 7, fontSize: 12.5, cursor: "pointer", opacity: imageCount ? 1 : 0.55 }}>
                <input type="checkbox" checked={applyImages} disabled={!imageCount} onChange={e => setApplyImages(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }}/>
                ดึงรูปจากลิงก์ {imageCount > 0 && <strong style={{ color: "var(--accent)" }}>({imageCount})</strong>}
              </label>
            </div>
            {newCats.length > 0 && createCats && (
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>หมวดหมู่ใหม่: {newCats.join(", ")}</div>
            )}
          </div>

          {nErr > 0 && (
            <NoteCard tone="danger" icon={<Icons.Warn size={18}/>} title={nErr.toLocaleString() + " แถวมีข้อผิดพลาด และจะไม่ถูกนำเข้า"}>
              กดปุ่มดินสอที่ท้ายแถวเพื่อแก้ค่าตรงนี้ได้เลย โดยไม่ต้องกลับไปแก้ไฟล์ต้นทาง — หรือกดถังขยะเพื่อตัดแถวนั้นทิ้ง
            </NoteCard>
          )}

          <div className="card card-tight">
            <div className="card-head">
              <div>
                <h3>ตรวจสอบข้อมูลก่อนนำเข้า</h3>
                <div className="sub">{fileName} · {rows.length.toLocaleString()} แถว</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setStage("map")}>ย้อนกลับไปจับคู่คอลัมน์</button>
                <button className="btn btn-sm" onClick={reset}>เลือกไฟล์ใหม่</button>
              </div>
            </div>

            <div className="row" style={{ flexWrap: "wrap", gap: 6, padding: "10px 14px 6px" }}>
              {[
                { id: "all",    label: "ทั้งหมด",  n: rows.length },
                { id: "new",    label: "เพิ่มใหม่", n: nNew },
                { id: "update", label: "อัปเดต",   n: nUpd },
                { id: "skip",   label: "ข้าม",     n: nSkip },
                { id: "error",  label: "ผิดพลาด",  n: nErr },
                { id: "warn",   label: "คำเตือน",  n: nWarn }
              ].map(c => {
                const on = filter === c.id;
                return (
                  <button key={c.id} onClick={() => { setFilter(c.id); setShowN(200); }}
                    style={{
                      fontSize: 12, padding: "4px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                      border: "1px solid " + (on ? "var(--accent)" : "var(--border)"),
                      background: on ? "var(--accent)" : "var(--surface-2)",
                      color: on ? "#fff" : "var(--fg-2)", fontWeight: on ? 600 : 500
                    }}>
                    {c.label} <span style={{ opacity: 0.75 }}>({c.n.toLocaleString()})</span>
                  </button>
                );
              })}
            </div>

            <ImportReviewTable
              rows={rows} fields={shownFields} filter={filter} showN={showN}
              editIdx={editIdx} setEditIdx={setEditIdx} onEdit={editCell} onDrop={dropRow}
              onMore={() => setShowN(n => n + 200)}
            />
          </div>

          <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.7 }}>
              จะนำเข้า <strong className="tnum" style={{ color: "var(--fg)" }}>{importable.length.toLocaleString()}</strong> แถว
              <span style={{ color: "var(--muted)" }}> — เพิ่มใหม่ {nNew.toLocaleString()} · อัปเดต {nUpd.toLocaleString()}</span>
              {(nSkip > 0 || nErr > 0) && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  ข้าม {nSkip.toLocaleString()} แถว{nErr > 0 && <> · ผิดพลาด {nErr.toLocaleString()} แถว</>}
                </div>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={reset} disabled={busy}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={busy || !importable.length}
                style={(busy || !importable.length) ? { opacity: 0.5, cursor: busy ? "wait" : "not-allowed" } : {}}
                onClick={runImport}>
                <Icons.Check size={14}/> {busy
                  ? "กำลังนำเข้า… " + prog.done.toLocaleString() + "/" + prog.total.toLocaleString()
                  : "ยืนยันนำเข้า " + importable.length.toLocaleString() + " รายการ"}
              </button>
            </div>
          </div>

          {busy && (
            <div style={{ height: 4, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: (prog.total ? Math.round(prog.done / prog.total * 100) : 0) + "%", background: "var(--accent)", transition: "width .2s" }}/>
            </div>
          )}
        </>
      )}

      {/* ─────────── STEP 4: done ─────────── */}
      {stage === "done" && result && (
        <div className="card" style={{ padding: 44, textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 999, margin: "0 auto 16px", display: "grid", placeItems: "center",
            background: result.error ? "var(--danger-soft)" : "var(--success-soft)",
            color: result.error ? "var(--danger)" : "var(--success)"
          }}>
            {result.error ? <Icons.Warn size={28}/> : <Icons.Check size={28} stroke={2}/>}
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {result.error ? "นำเข้าไม่สำเร็จ" : "นำเข้าสำเร็จ"}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 8, lineHeight: 1.8 }}>
            {result.error ? (
              <>
                {result.error === "PERMISSION_OR_MISSING"
                  ? "บัญชีนี้ไม่มีสิทธิ์บันทึกสินค้าลงฐานข้อมูล — ระบบดึงข้อมูลจริงจากเซิร์ฟเวอร์กลับมาแล้ว"
                  : result.error}
                <br/>ไม่มีการเปลี่ยนแปลงที่ค้างอยู่บนเครื่องนี้
              </>
            ) : (
              <>
                เพิ่มสินค้าใหม่ <strong style={{ color: "var(--fg)" }}>{(result.added || 0).toLocaleString()}</strong> รายการ ·
                อัปเดต <strong style={{ color: "var(--fg)" }}>{(result.updated || 0).toLocaleString()}</strong> รายการ
                {result.cats   > 0 && <><br/>สร้างหมวดหมู่ใหม่ {result.cats} หมวด</>}
                {result.images > 0 && <><br/>ใส่รูปสินค้าจากลิงก์ {result.images} รายการ</>}
                {(result.skipped > 0 || result.errors > 0) && (
                  <><br/>ข้าม {result.skipped.toLocaleString()} แถว{result.errors > 0 && <> · ไม่ผ่านการตรวจ {result.errors.toLocaleString()} แถว</>}</>
                )}
                {result.offline && <><br/>บันทึกลงเครื่องแล้ว — จะซิงก์ขึ้นคลาวด์เมื่อออนไลน์</>}
              </>
            )}
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 24, gap: 10 }}>
            <button className="btn" onClick={reset}>นำเข้าไฟล์อื่นต่อ</button>
            {!result.error && (
              <button className="btn btn-primary" onClick={() => {
                if (typeof canOpenPage === "function" && !canOpenPage("inventory")) { pushToast("บัญชีนี้ไม่มีสิทธิ์เปิดหน้าสินค้าคงคลัง"); return; }
                if (goTo) goTo("inventory");
              }}>ไปที่สินค้าคงคลัง <Icons.ArrowRight size={14}/></button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Review table — split out so the (potentially 5,000-row) list re-renders on its
   own state, and only one row is ever an editable form at a time. */
function ImportReviewTable({ rows, fields, filter, showN, editIdx, setEditIdx, onEdit, onDrop, onMore }) {
  const shown = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const keep =
      filter === "all"  ? true :
      filter === "warn" ? (r._state !== "error" && r._warns.length > 0) :
      r._state === filter;
    if (keep) shown.push({ r, i });
  }

  const STATE_BADGE = {
    new:    { cls: "badge-success", label: "เพิ่มใหม่" },
    update: { cls: "badge-info",    label: "อัปเดต" },
    skip:   { cls: "badge-neutral", label: "ข้าม" },
    error:  { cls: "badge-danger",  label: "ผิดพลาด" }
  };

  if (!shown.length) {
    return <div style={{ padding: 28, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่มีแถวที่ตรงกับตัวกรองนี้</div>;
  }

  return (
    <>
      <div style={{ maxHeight: 520, overflow: "auto" }}>
        <table className="t">
          <thead><tr>
            <th style={{ width: 40 }}>แถว</th>
            {fields.map(f => <th key={f.key}>{f.label}</th>)}
            <th style={{ minWidth: 150 }}>สถานะ</th>
            <th style={{ width: 66 }}></th>
          </tr></thead>
          <tbody>
            {shown.slice(0, showN).map(({ r, i }) => {
              const editing = editIdx === i;
              const bad = r._state === "error";
              const b = STATE_BADGE[r._state] || STATE_BADGE.skip;
              return (
                <tr key={i} style={bad ? { background: "var(--danger-soft)" } : r._state === "skip" ? { opacity: 0.6 } : {}}>
                  <td className="t-mono" style={{ color: "var(--muted)", fontSize: 12 }}>{r._row}</td>
                  {fields.map(f => (
                    <td key={f.key} className={f.key === "sku" ? "t-mono" : ""} style={{ fontSize: 12, maxWidth: 220 }}>
                      {editing ? (
                        <input className="input" value={r[f.key] == null ? "" : r[f.key]}
                          onChange={e => onEdit(i, f.key, e.target.value)}
                          style={{ padding: "4px 7px", fontSize: 12, minWidth: 90 }}/>
                      ) : (
                        r[f.key]
                          ? <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r[f.key]}>{r[f.key]}</span>
                          : <span style={{ color: "var(--faint)" }}>—</span>
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="stack" style={{ gap: 3 }}>
                      <span className={"badge " + b.cls}>{bad ? <Icons.Warn size={10}/> : <Icons.Check size={10}/>} {b.label}</span>
                      {r._errors.map((e, k) => <div key={"e" + k} style={{ fontSize: 11, color: "var(--danger)" }}>{e}</div>)}
                      {r._warns.map((w, k)  => <div key={"w" + k} style={{ fontSize: 11, color: "var(--warning)" }}>{w}</div>)}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" title={editing ? "เสร็จสิ้น" : "แก้ไขแถวนี้"}
                        onClick={() => setEditIdx(editing ? -1 : i)} style={{ padding: "3px 6px" }}>
                        {editing ? <Icons.Check size={13}/> : <Icons.Edit size={13}/>}
                      </button>
                      <button className="btn btn-ghost btn-sm" title="ตัดแถวนี้ออก" onClick={() => onDrop(i)}
                        style={{ padding: "3px 6px", color: "var(--danger)" }}>
                        <Icons.Trash size={13}/>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > showN ? (
        <div style={{ padding: "12px 14px", textAlign: "center", borderTop: "1px solid var(--border)" }}>
          <button className="btn btn-sm" onClick={onMore}>
            ดูเพิ่ม — แสดง {showN.toLocaleString()} จาก {shown.length.toLocaleString()} แถว
          </button>
        </div>
      ) : (
        <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border)", textAlign: "right" }}>
          แสดงครบ {shown.length.toLocaleString()} แถว
        </div>
      )}
    </>
  );
}

function ImportSteps({ stage }) {
  const steps = [
    { id: "idle",   label: "เลือกไฟล์" },
    { id: "map",    label: "จับคู่คอลัมน์" },
    { id: "review", label: "ตรวจสอบและแก้ไข" },
    { id: "done",   label: "นำเข้า" }
  ];
  const at = Math.max(0, steps.findIndex(s => s.id === stage));
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {steps.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "next";
        return (
          <React.Fragment key={s.id}>
            <div className="row" style={{ gap: 7 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center",
                fontSize: 11, fontWeight: 600,
                background: state === "next" ? "var(--surface-3)" : state === "now" ? "var(--accent)" : "var(--success)",
                color: state === "next" ? "var(--muted)" : "#fff"
              }}>{state === "done" ? <Icons.Check size={12} stroke={2.5}/> : i + 1}</div>
              <div style={{ fontSize: 12.5, fontWeight: state === "now" ? 600 : 500, color: state === "next" ? "var(--muted)" : "var(--fg)" }}>{s.label}</div>
            </div>
            {i < steps.length - 1 && <div style={{ width: 22, height: 1, background: "var(--border)", margin: "0 2px" }}/>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function NoteCard({ tone, icon, title, children }) {
  const c = tone === "danger" ? "danger" : tone === "warning" ? "warning" : "info";
  return (
    <div className="card" style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start", background: "var(--" + c + "-soft)", border: "1px solid var(--" + c + ")" }}>
      <div style={{ color: "var(--" + c + ")", flexShrink: 0, marginTop: 1 }}>{icon}</div>
      <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6 }}>
        {title && <div style={{ fontWeight: 600, color: "var(--fg)", marginBottom: 2 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════════════
   WooCommerce reference-catalog import
   Reads a WooCommerce product CSV/XLSX export and upserts a SKU-keyed catalog
   (name / category / price / image). Scanning then auto-fills from it.
   ════════════════════════════════════════════════════════════════════════ */

// Read the first sheet of a CSV/XLSX file into an array-of-arrays, with the same
// Thai-encoding detection the stock importer uses (UTF-8/UTF-16 BOM, Windows-874).
function readSheetToAoA(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if (!["xlsx", "xls", "csv"].includes(ext)) { reject(new Error("unsupported file type")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = (e) => {
      try {
        const rawBytes = new Uint8Array(e.target.result);
        let wb;
        if (ext === "csv") {
          const hasBOM_UTF8    = rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF;
          const hasBOM_UTF16LE = rawBytes[0] === 0xFF && rawBytes[1] === 0xFE;
          const hasBOM_UTF16BE = rawBytes[0] === 0xFE && rawBytes[1] === 0xFF;
          let csvText;
          if (hasBOM_UTF8)         csvText = new TextDecoder("utf-8").decode(rawBytes);
          else if (hasBOM_UTF16LE) csvText = new TextDecoder("utf-16le").decode(rawBytes);
          else if (hasBOM_UTF16BE) csvText = new TextDecoder("utf-16be").decode(rawBytes);
          else {
            const utf8 = new TextDecoder("utf-8").decode(rawBytes);
            if (utf8.includes("�")) {
              try { csvText = new TextDecoder("windows-874").decode(rawBytes); }
              catch (e1) { try { csvText = new TextDecoder("iso-8859-11").decode(rawBytes); } catch (e2) { csvText = utf8; } }
            } else csvText = utf8;
          }
          wb = XLSX.read(csvText, { type: "string" });
        } else {
          wb = XLSX.read(rawBytes, { type: "array" });
        }
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }));
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Map a WooCommerce export (array-of-arrays incl. header row) → catalog entries.
// Columns are matched by HEADER NAME (WooCommerce exports vary in order).
function parseWooAoA(aoa) {
  if (!aoa || !aoa.length) return { entries: [], headerOk: false };
  const header = aoa[0].map(h => String(h == null ? "" : h).trim().toLowerCase());
  const findCol = (names) => {
    for (const n of names) { const i = header.indexOf(n); if (i > -1) return i; }       // exact
    for (const n of names) { const i = header.findIndex(h => h.includes(n)); if (i > -1) return i; } // contains
    return -1;
  };
  const cSku   = findCol(["sku", "รหัสสินค้า", "รหัส"]);
  const cName  = findCol(["name", "product name", "ชื่อสินค้า", "ชื่อ"]);
  const cPrice = findCol(["regular price", "price", "ราคา"]);
  const cCat   = findCol(["categories", "category", "หมวดหมู่"]);
  const cImg   = findCol(["images", "image", "รูป"]);
  const cBrand = findCol(["brands", "brand", "แบรนด์"]);
  // Captured for the future "pull image from the product web page" feature:
  // WooCommerce ID (always present) lets us build /?p=<ID>; an explicit permalink
  // column is used directly if the export includes one.
  const cId    = findCol(["id"]);
  const cLink  = findCol(["permalink", "external url", "product url", "product link", "link", "ลิงก์"]);
  // For variable products, the gallery image lives on the PARENT row;
  // each colour/size VARIATION row carries the SKU but often an empty Images cell.
  // The Parent column lets a variation inherit the parent's photo/category/name.
  const cParent = findCol(["parent"]);
  // Type column ("simple" / "variable" / "variation") — used to drop the parent
  // "variable" rows, which aren't a scannable product (some exports give them a
  // slug as SKU, which would otherwise leak in as a junk entry).
  const cType = findCol(["type"]);
  const headerOk = cSku > -1 && cName > -1;
  if (!headerOk) return { entries: [], headerOk: false };

  // WooCommerce category cell: "Parent > Child, OtherTop" → take the leaf of the primary.
  const cleanCat = (raw) => {
    if (raw == null || raw === "") return "";
    const primary = String(raw).split(",")[0].trim();
    return primary.split(">").pop().trim() || primary;
  };
  const firstUrl = (raw) => (raw == null ? "" : String(raw).split(",")[0].trim());
  const toPrice = (raw) => (raw == null ? 0 : parseFloat(String(raw).replace(/[^0-9.]/g, "")) || 0);

  // Slugify a name/parent-ref to a stable key (a-z/0-9/Thai kept; rest → "-").
  // This export links variations to their parent by the parent's slugified name,
  // not by id — so we match on that.
  const keyify = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9฀-๿]+/g, "-").replace(/^-+|-+$/g, "");

  // Pass 1 — index image + category by product ID, SKU, AND slugified name, so a
  // variation with no image of its own can inherit it from its parent product.
  const imgById = {}, imgBySku = {}, imgBySlug = {}, catById = {}, catBySku = {}, catBySlug = {}, nameById = {}, nameBySku = {}, nameBySlug = {};
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i]; if (!r) continue;
    const id   = cId  > -1 && r[cId]  != null ? String(r[cId]).trim() : "";
    const sku  = cSku > -1 && r[cSku] != null ? String(r[cSku]).trim() : "";
    const name = cName > -1 && r[cName] != null ? String(r[cName]).trim() : "";
    const slug = keyify(name);
    const img  = cImg > -1 ? firstUrl(r[cImg]) : "";
    const cat  = cCat > -1 ? cleanCat(r[cCat]) : "";
    if (img)  { if (id) imgById[id]  = img;  if (sku) imgBySku[sku.toLowerCase()]  = img;  if (slug) imgBySlug[slug]  = img; }
    if (cat)  { if (id) catById[id]  = cat;  if (sku) catBySku[sku.toLowerCase()]  = cat;  if (slug) catBySlug[slug]  = cat; }
    if (name) { if (id) nameById[id] = name; if (sku) nameBySku[sku.toLowerCase()] = name; if (slug) nameBySlug[slug] = name; }
  }
  // Resolve an inherited value via the Parent cell ("id:<ID>" / parent SKU / parent
  // slug), then fall back to the row's OWN slugified name — variations share their
  // parent's name, so this covers exports whose Parent reference we can't match.
  const inherit = (parentRaw, ownName, byId, bySkuMap, bySlugMap) => {
    const v = String(parentRaw || "").trim();
    if (v) {
      const m = v.match(/^id:\s*(\d+)/i);
      if (m && byId[m[1]]) return byId[m[1]];
      if (bySkuMap[v.toLowerCase()]) return bySkuMap[v.toLowerCase()];
      const ks = keyify(v);
      if (ks && bySlugMap[ks]) return bySlugMap[ks];
    }
    const own = keyify(ownName);
    return (own && bySlugMap[own]) || "";
  };

  // Pass 2 — build a catalog entry per SKU, inheriting image/category/name when blank.
  const bySku = {};
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r) continue;
    const type = cType > -1 && r[cType] != null ? String(r[cType]).trim().toLowerCase() : "";
    if (type === "variable") continue; // parent row — not a scannable product (its variations are)
    const sku = r[cSku] != null ? String(r[cSku]).trim() : "";
    if (!sku) continue; // rows without a SKU can't be scanned
    let name  = r[cName] != null ? String(r[cName]).trim() : "";
    let image = cImg > -1 ? firstUrl(r[cImg]) : "";
    let cat   = cCat > -1 ? cleanCat(r[cCat]) : "";
    const parentRaw = cParent > -1 && r[cParent] != null ? String(r[cParent]).trim() : "";
    // Some exports leave the variation's Name/Image/Category blank — inherit from the parent.
    if (!name)  name  = inherit(parentRaw, name, nameById, nameBySku, nameBySlug);
    if (!image) image = inherit(parentRaw, name, imgById, imgBySku, imgBySlug);
    if (!cat)   cat   = inherit(parentRaw, name, catById, catBySku, catBySlug);
    bySku[sku.toLowerCase()] = {
      sku, name, cat,
      brand: cBrand > -1 && r[cBrand] != null ? String(r[cBrand]).trim() : "",
      price: cPrice > -1 ? toPrice(r[cPrice]) : 0,
      image,
      id:    cId   > -1 && r[cId]   != null ? String(r[cId]).trim()   : "",
      link:  cLink > -1 && r[cLink] != null ? String(r[cLink]).trim() : ""
    };
  }
  return { entries: Object.values(bySku), headerOk: true };
}

function WooCatalogImport({ pushToast }) {
  const [stage, setStage]       = useStateImp("idle"); // idle | preview | done
  const [entries, setEntries]   = useStateImp([]);
  const [fileName, setFileName] = useStateImp("");
  const [dragOver, setDragOver] = useStateImp(false);
  const [result, setResult]     = useStateImp(null);
  const [pullImages, setPullImages] = useStateImp(true);
  const [catCount, setCatCount] = useStateImp(() => typeof wooCatalogCount === "function" ? wooCatalogCount() : 0);
  // Web-image backfill (draft — needs a public store URL; localhost is rejected server-side)
  const [storeUrl, setStoreUrl]   = useStateImp(() => { try { return localStorage.getItem("ims_woo_store_url") || ""; } catch (e) { return ""; } });
  const [webBusy, setWebBusy]     = useStateImp(false);
  const [webProgress, setWebProgress] = useStateImp({ done: 0, total: 0 });
  const [webResult, setWebResult] = useStateImp(null);
  const [catQuery, setCatQuery]   = useStateImp("");
  const [browseOpen, setBrowseOpen] = useStateImp(false);
  const [brandFilter, setBrandFilter] = useStateImp(""); // "" = all brands
  const [showN, setShowN]         = useStateImp(300);     // how many rows of the catalog to render
  const fileRef = useRefImp(null);
  const xlsxAvailable = typeof XLSX !== "undefined";

  const refreshCount = () => setCatCount(typeof wooCatalogCount === "function" ? wooCatalogCount() : 0);

  const handleFile = (file) => {
    if (!file) return;
    if (!xlsxAvailable) { pushToast("ไลบรารี Excel ยังไม่พร้อม กรุณารอสักครู่"); return; }
    const ext = file.name.toLowerCase().split(".").pop();
    if (!["xlsx", "xls", "csv"].includes(ext)) { pushToast("กรุณาเลือกไฟล์ .csv หรือ .xlsx ที่ส่งออกจาก WooCommerce"); return; }
    setFileName(file.name);
    readSheetToAoA(file).then(aoa => {
      const out = parseWooAoA(aoa);
      if (!out.headerOk) { pushToast("ไม่พบคอลัมน์ SKU และ Name — ตรวจสอบว่าเป็นไฟล์ส่งออกจาก WooCommerce"); return; }
      if (!out.entries.length) { pushToast("ไม่พบสินค้าที่มี SKU ในไฟล์"); return; }
      setEntries(out.entries);
      setStage("preview");
      pushToast(`อ่านไฟล์สำเร็จ พบ ${out.entries.length} สินค้าที่มี SKU`);
    }).catch(err => { console.error(err); pushToast("อ่านไฟล์ไม่ได้ ตรวจสอบรูปแบบไฟล์"); });
  };

  const existing = useMemoImp(() => (typeof loadWooCatalog === "function" ? loadWooCatalog() : {}), [stage, catCount]);
  const updCount = entries.filter(e => existing[e.sku.toLowerCase()]).length;
  const newCount = entries.length - updCount;
  // How many of the file's products (with an image) already exist in live stock —
  // those are the ones whose photo we can attach so staff recognise them.
  const inStockImgCount = useMemoImp(
    () => entries.filter(e => e.image && PRODUCTS.some(p => p.sku.toLowerCase() === e.sku.toLowerCase())).length,
    [entries]
  );

  // Attach WooCommerce photos to matching in-stock products (keyed by the
  // product's own SKU so the image store/thumbnails line up). Returns count.
  const applyImagesToStock = () => {
    const map = {};
    entries.forEach(e => {
      if (!e.image) return;
      const p = PRODUCTS.find(x => x.sku.toLowerCase() === e.sku.toLowerCase());
      if (p) map[p.sku] = e.image;
    });
    return typeof setProductImagesBulk === "function" ? setProductImagesBulk(map) : 0;
  };

  // ── Web-image backfill: for in-stock products whose catalog entry has no image,
  //    fetch the product page (permalink, or storeURL/?p=<id>) and pull its og:image.
  const deriveBase = () => {
    try {
      const cat = typeof loadWooCatalog === "function" ? loadWooCatalog() : {};
      for (const k in cat) { if (cat[k].link) return new URL(cat[k].link).origin; }
    } catch (e) {}
    return "";
  };
  const suggestedBase = useMemoImp(deriveBase, [catCount]);
  const persistUrl = () => { try { localStorage.setItem("ims_woo_store_url", (storeUrl || "").trim()); } catch (e) {} };

  // Stored catalog as a list (for the browse/inspect table), filtered by search.
  const catList = useMemoImp(() => {
    const cat = typeof loadWooCatalog === "function" ? loadWooCatalog() : {};
    return Object.keys(cat).map(k => cat[k]);
  }, [catCount, stage, webResult, browseOpen]);
  // Brand of a catalog entry: the stored brand wins; otherwise guess from the SKU
  // prefix (older imports have no brand field). "อื่นๆ" groups the unknowns.
  const brandOf = (e) => (e.brand && e.brand.trim())
    || (typeof guessBrandFromSku === "function" ? guessBrandFromSku(e.sku) : "")
    || "อื่นๆ";
  // Distinct brands (with counts), most-populous first — drives the filter chips.
  const brands = useMemoImp(() => {
    const m = {};
    catList.forEach(e => { const b = brandOf(e); m[b] = (m[b] || 0) + 1; });
    return Object.keys(m).sort((a, b) => m[b] - m[a]).map(name => ({ name, count: m[name] }));
  }, [catList]);
  const catFiltered = useMemoImp(() => {
    const q = catQuery.trim().toLowerCase();
    return catList.filter(e => {
      if (brandFilter && brandOf(e) !== brandFilter) return false;
      if (q && !((e.sku || "").toLowerCase().includes(q) || (e.name || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [catList, catQuery, brandFilter]);

  // In-stock products that still have no image in the catalog.
  const missingInStock = useMemoImp(() => {
    const cat = typeof loadWooCatalog === "function" ? loadWooCatalog() : {};
    let n = 0;
    Object.keys(cat).forEach(k => { if (!cat[k].image && PRODUCTS.some(p => p.sku.toLowerCase() === k)) n++; });
    return n;
  }, [catCount, stage]);

  const pullWebImages = async () => {
    if (webBusy || typeof resolveWebImages !== "function") return;
    const cat = typeof loadWooCatalog === "function" ? loadWooCatalog() : {};
    const base = (storeUrl || suggestedBase || "").trim().replace(/\/+$/, "");
    // Build the work list: missing-image catalog entries, matched to in-stock products, with a usable page URL.
    const work = [];
    Object.keys(cat).forEach(k => {
      const e = cat[k];
      if (e.image) return;
      const p = PRODUCTS.find(x => x.sku.toLowerCase() === k);
      if (!p) return;
      let url = e.link || "";
      if (!url && base && e.id) url = base + "/?p=" + encodeURIComponent(e.id);
      if (!url) return;
      work.push({ key: k, sku: p.sku, url });
    });
    if (!work.length) {
      pushToast(base ? "ไม่มีสินค้าที่ต้องดึงรูป (มีรูปครบ หรือไม่มีลิงก์/ID)" : "ใส่ URL ร้านค้าก่อน หรือไฟล์ต้องมีคอลัมน์ลิงก์/ID");
      return;
    }
    persistUrl();
    setWebBusy(true); setWebResult(null); setWebProgress({ done: 0, total: work.length });
    const imgMap = {};
    let found = 0;
    const CHUNK = 25;
    try {
      for (let i = 0; i < work.length; i += CHUNK) {
        const slice = work.slice(i, i + CHUNK);
        let resp;
        try { resp = await resolveWebImages(slice.map(w => w.url)); }
        catch (err) { pushToast("ดึงรูปไม่สำเร็จ: " + (err && err.message ? err.message : "error")); break; }
        const byUrl = {};
        (resp.results || []).forEach(r => { byUrl[r.url] = r.image; });
        slice.forEach(w => {
          const img = byUrl[w.url];
          if (img) { imgMap[w.sku] = img; if (cat[w.key]) cat[w.key].image = img; found++; }
        });
        setWebProgress({ done: Math.min(i + CHUNK, work.length), total: work.length });
      }
      if (Object.keys(imgMap).length && typeof setProductImagesBulk === "function") setProductImagesBulk(imgMap);
      if (typeof saveWooCatalog === "function") saveWooCatalog(cat);
      refreshCount();
      setWebResult({ attempted: work.length, found });
      pushToast(`ดึงรูปจากเว็บ ${found}/${work.length} รายการ`);
    } finally {
      setWebBusy(false);
    }
  };

  // Heads-up flags for the preview.
  const missingImg = entries.filter(e => !e.image).length;
  const hasLocalImg = entries.some(e => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(e.image || ""));

  const confirmImport = () => {
    const res = typeof upsertWooCatalog === "function" ? upsertWooCatalog(entries) : { added: 0, updated: 0, total: 0 };
    const imgN = pullImages ? applyImagesToStock() : 0;
    setResult({ ...res, images: imgN });
    refreshCount();
    setStage("done");
    if (typeof recordChange === "function") {
      recordChange({
        entity: "product", action: "import",
        summary: `นำเข้าแคตตาล็อก WooCommerce — ใหม่ ${res.added}, อัปเดต ${res.updated}, ดึงรูปเข้าคลัง ${imgN} (ไฟล์ ${fileName})`,
        count: entries.length
      });
    }
    pushToast(`บันทึกแคตตาล็อก ${res.total} รายการ${imgN ? ` · ดึงรูป ${imgN} รายการ` : ""}`);
  };

  const reset = () => { setEntries([]); setFileName(""); setStage("idle"); setResult(null); };

  const clearCatalog = () => {
    if (!window.confirm("ล้างแคตตาล็อก WooCommerce ทั้งหมด? (ไม่กระทบสินค้าคงคลังจริง)")) return;
    if (typeof clearWooCatalog === "function") clearWooCatalog();
    refreshCount();
    pushToast("ล้างแคตตาล็อกแล้ว");
  };

  const MAX_SHOW = 100;

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Current catalog status */}
      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-soft, var(--surface-2))", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icons.Scan size={20}/>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>แคตตาล็อกอ้างอิงปัจจุบัน</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>
              <strong className="tnum" style={{ color: "var(--fg)" }}>{catCount.toLocaleString()}</strong> รายการ — ใช้ตอนสแกนเพื่อเติมข้อมูลอัตโนมัติ
            </div>
          </div>
        </div>
        {catCount > 0 && <button className="btn btn-ghost btn-sm" onClick={clearCatalog} style={{ color: "var(--danger)" }}>ล้างแคตตาล็อก</button>}
      </div>

      {/* Web-image backfill — pull og:image from product pages for in-stock items with no photo */}
      {catCount > 0 && stage === "idle" && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <Icons.Scan size={16}/> ดึงรูปจากหน้าเว็บ (สินค้าที่ยังไม่มีรูป)
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
            ใช้ลิงก์หน้าสินค้า (Permalink) หรือสร้างจาก URL ร้าน + รหัส ID แล้วดึงรูปหลัก (og:image) มาใส่ให้สินค้าที่มีอยู่ในคลัง
            <br/><strong style={{ color: "var(--warning)" }}>ต้องเป็น URL ร้านสาธารณะเท่านั้น</strong> — localhost / เครือข่ายภายใน ใช้ไม่ได้
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>URL ร้านค้า (โดเมนสาธารณะ)</label>
            <input className="input" value={storeUrl} placeholder={suggestedBase || "https://yourstore.com"}
              onChange={e => setStoreUrl(e.target.value)} onBlur={persistUrl}/>
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {webBusy
                ? `กำลังดึงรูป… ${webProgress.done}/${webProgress.total}`
                : webResult
                  ? `ดึงสำเร็จ ${webResult.found}/${webResult.attempted} รายการ`
                  : `สินค้าในคลังที่ยังไม่มีรูป: ${missingInStock} รายการ`}
            </div>
            <button className="btn btn-primary" disabled={webBusy || missingInStock === 0}
              style={(webBusy || missingInStock === 0) ? { opacity: 0.55, cursor: webBusy ? "wait" : "not-allowed" } : {}}
              onClick={pullWebImages}>
              <Icons.Scan size={14}/> {webBusy ? "กำลังดึง…" : "ดึงรูปที่ขาด"}
            </button>
          </div>
        </div>
      )}

      {/* Browse / inspect the drafted catalog */}
      {catCount > 0 && stage === "idle" && (
        <div className="card card-tight">
          <div className="card-head">
            <div>
              <h3>สินค้าในแคตตาล็อก (ร่าง)</h3>
              <div className="sub">{catCount.toLocaleString()} รายการ — กดเพื่อดูและตรวจสอบ</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {browseOpen && (
                <input className="input" placeholder="ค้นหา SKU หรือ ชื่อ…" value={catQuery}
                  onChange={e => { setCatQuery(e.target.value); setShowN(300); }} style={{ maxWidth: 240 }}/>
              )}
              <button className="btn btn-sm" onClick={() => setBrowseOpen(o => !o)}>
                {browseOpen ? "ซ่อน" : "ดูรายการ"}
              </button>
            </div>
          </div>
          {browseOpen && (
            <>
              {/* Brand filter chips — view the catalog by brand */}
              <div className="row" style={{ flexWrap: "wrap", gap: 6, padding: "10px 14px 4px" }}>
                {[{ name: "", count: catList.length }, ...brands].map(b => {
                  const active = brandFilter === b.name;
                  return (
                    <button key={b.name || "__all"} onClick={() => { setBrandFilter(b.name); setShowN(300); }}
                      style={{
                        fontSize: 12, padding: "4px 11px", borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                        border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
                        background: active ? "var(--accent)" : "var(--surface-2)",
                        color: active ? "#fff" : "var(--fg-2)", fontWeight: active ? 600 : 500
                      }}>
                      {b.name || "ทั้งหมด"} <span style={{ opacity: 0.7 }}>({b.count.toLocaleString()})</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ maxHeight: 520, overflow: "auto" }}>
                <table className="t">
                  <thead><tr>
                    <th style={{ width: 44 }}>รูป</th>
                    <th>SKU</th>
                    <th>ชื่อสินค้า</th>
                    <th>แบรนด์</th>
                    <th>หมวดหมู่</th>
                    <th style={{ textAlign: "right" }}>ราคา</th>
                    <th>ในคลัง</th>
                  </tr></thead>
                  <tbody>
                    {catFiltered.slice(0, showN).map((e, i) => {
                      const inStock = PRODUCTS.some(p => p.sku.toLowerCase() === (e.sku || "").toLowerCase());
                      return (
                        <tr key={e.sku || i}>
                          <td>
                            {e.image
                              ? <img src={e.image} alt="" loading="lazy" onError={ev => { ev.target.style.visibility = "hidden"; }}
                                  style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", background: "#fff", border: "1px solid var(--border)" }}/>
                              : <span style={{ color: "var(--faint)" }}>—</span>}
                          </td>
                          <td className="t-mono" style={{ fontSize: 12 }}>{e.sku}</td>
                          <td style={{ fontSize: 12 }}>{e.name || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                          <td style={{ fontSize: 12 }}>{brandOf(e)}</td>
                          <td style={{ fontSize: 12 }}>{e.cat || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                          <td className="tnum" style={{ fontSize: 12, textAlign: "right" }}>{e.price ? "฿" + e.price.toLocaleString() : "—"}</td>
                          <td>{inStock
                            ? <span className="badge badge-success">มีในคลัง</span>
                            : <span className="badge badge-neutral">อ้างอิง</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {catFiltered.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>ไม่พบรายการที่ตรงกับเงื่อนไข</div>
              )}
              {catFiltered.length > showN ? (
                <div style={{ padding: "12px 14px", textAlign: "center", borderTop: "1px solid var(--border)" }}>
                  <button className="btn btn-sm" onClick={() => setShowN(n => n + 300)}>
                    ดูเพิ่ม — แสดง {showN.toLocaleString()} จาก {catFiltered.length.toLocaleString()} รายการ
                  </button>
                </div>
              ) : catFiltered.length > 0 && (
                <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--muted)", borderTop: "1px solid var(--border)", textAlign: "right" }}>
                  แสดงครบ {catFiltered.length.toLocaleString()} รายการ
                  {brandFilter && <> · แบรนด์ <strong style={{ color: "var(--fg)" }}>{brandFilter}</strong></>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {stage === "idle" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* How to export */}
          <div className="card" style={{ padding: 24, position: "relative" }}>
            <StepBadge n={1}/>
            <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>ส่งออกไฟล์จาก WooCommerce</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
              ใน WordPress: <strong>Products → All Products → Export</strong> แล้วดาวน์โหลดไฟล์ .csv
              ระบบจะอ่านคอลัมน์เหล่านี้โดยอัตโนมัติ:
            </div>
            <div style={{ padding: 14, background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>คอลัมน์ที่ใช้</div>
              {[["SKU", "รหัสสินค้า — ใช้จับคู่ตอนสแกน (จำเป็น)"],
                ["Name", "ชื่อสินค้า (จำเป็น)"],
                ["Categories", "หมวดหมู่"],
                ["Regular price", "ราคา"],
                ["Images", "ลิงก์รูปสินค้า"]].map(([c, d]) => (
                <div key={c} style={{ fontSize: 12, padding: "3px 0", display: "flex", gap: 8 }}>
                  <span className="mono" style={{ color: "var(--accent)", minWidth: 92 }}>{c}</span>
                  <span style={{ color: "var(--fg-2)" }}>{d}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upload */}
          <div className="card" style={{ padding: 24, position: "relative" }}>
            <StepBadge n={2}/>
            <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>อัปโหลดไฟล์ WooCommerce</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
              รองรับ .csv และ .xlsx — ระบบจะแสดงตัวอย่างให้ตรวจก่อนบันทึก SKU ที่มีอยู่แล้วจะถูกอัปเดตทับ
            </div>
            <div
              className={"dropzone" + (dragOver ? " over" : "")}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
            >
              <div className="dz-icon"><Icons.Scan size={24}/></div>
              <div style={{ fontSize: 14, fontWeight: 500, marginTop: 12 }}>ลากไฟล์มาวาง หรือ คลิกเพื่อเลือก</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>WooCommerce export · .csv · .xlsx</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFile(e.target.files?.[0])} style={{ display: "none" }}/>
          </div>
        </div>
      )}

      {stage === "preview" && (
        <>
          <div className="grid-3">
            <SmallStat label="สินค้าในไฟล์" value={entries.length} tone="info" hint={`จากไฟล์ ${fileName}`}/>
            <SmallStat label="เพิ่มใหม่" value={newCount} tone="success" hint="ยังไม่มีในแคตตาล็อก"/>
            <SmallStat label="อัปเดตทับ" value={updCount} tone={updCount > 0 ? "warning" : "success"} hint="มี SKU อยู่แล้ว"/>
          </div>

          {(hasLocalImg || missingImg > 0) && (
            <div className="card" style={{ padding: 14, display: "flex", gap: 12, alignItems: "flex-start", background: "var(--warning-soft)", border: "1px solid var(--warning)" }}>
              <Icons.Warn size={18} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }}/>
              <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6 }}>
                {hasLocalImg && (
                  <div><strong style={{ color: "var(--fg)" }}>พบลิงก์รูปแบบ localhost / ในเครือข่ายภายใน</strong> — รูปเหล่านี้จะ<u>ไม่แสดง</u>บนแอปจริงหรือบนมือถือ จนกว่าเว็บร้านจะออนไลน์บนโดเมนจริง</div>
                )}
                {missingImg > 0 && (
                  <div style={{ marginTop: hasLocalImg ? 4 : 0 }}>
                    สินค้า <strong className="tnum" style={{ color: "var(--fg)" }}>{missingImg}</strong> รายการไม่มีรูปในไฟล์ —
                    ฟีเจอร์ "ดึงรูปจากหน้าเว็บอัตโนมัติ" จะเปิดใช้ได้เมื่อเว็บร้านขึ้นออนไลน์ (ระบบเก็บรหัส ID/ลิงก์ไว้ให้แล้ว)
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card card-tight">
            <div className="card-head">
              <div>
                <h3>ตรวจสอบก่อนบันทึกแคตตาล็อก</h3>
                <div className="sub">{fileName} · แสดง {Math.min(entries.length, MAX_SHOW)} จาก {entries.length}</div>
              </div>
              <div className="row"><button className="btn btn-sm" onClick={reset}>เลือกไฟล์ใหม่</button></div>
            </div>
            <div style={{ maxHeight: 460, overflow: "auto" }}>
              <table className="t">
                <thead><tr>
                  <th style={{ width: 44 }}>รูป</th>
                  <th>SKU</th>
                  <th>ชื่อสินค้า</th>
                  <th>หมวดหมู่</th>
                  <th style={{ textAlign: "right" }}>ราคา</th>
                  <th>สถานะ</th>
                </tr></thead>
                <tbody>
                  {entries.slice(0, MAX_SHOW).map((e, i) => {
                    const isUpd = !!existing[e.sku.toLowerCase()];
                    return (
                      <tr key={i}>
                        <td>
                          {e.image
                            ? <img src={e.image} alt="" onError={ev => { ev.target.style.visibility = "hidden"; }}
                                style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", background: "#fff", border: "1px solid var(--border)" }}/>
                            : <span style={{ color: "var(--faint)" }}>—</span>}
                        </td>
                        <td className="t-mono" style={{ fontSize: 12 }}>{e.sku}</td>
                        <td style={{ fontSize: 12 }}>{e.name || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                        <td style={{ fontSize: 12 }}>{e.cat || <span style={{ color: "var(--faint)" }}>—</span>}</td>
                        <td className="tnum" style={{ fontSize: 12, textAlign: "right" }}>{e.price ? "฿" + e.price.toLocaleString() : "—"}</td>
                        <td>
                          {isUpd
                            ? <span className="badge badge-warning">อัปเดต</span>
                            : <span className="badge badge-success">ใหม่</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pull product photos onto matching in-stock items */}
          <div className="card" style={{ padding: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input id="woo-pullimg" type="checkbox" checked={pullImages} onChange={e => setPullImages(e.target.checked)}
              style={{ width: 17, height: 17, marginTop: 1, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}/>
            <label htmlFor="woo-pullimg" style={{ fontSize: 13, cursor: "pointer", lineHeight: 1.5 }}>
              <strong>ดึงรูปสินค้าเข้าระบบ</strong> สำหรับ SKU ที่มีอยู่ในคลังแล้ว
              <span style={{ color: "var(--muted)" }}>
                {" "}— ตรงกับคลัง <strong className="tnum" style={{ color: inStockImgCount > 0 ? "var(--accent)" : "var(--muted)" }}>{inStockImgCount}</strong> รายการ
                พนักงานจะเห็นรูปในหน้าสินค้าและตอนสแกน (รูปเดิมจะถูกแทนที่ด้วยรูปจากร้าน)
              </span>
            </label>
          </div>

          <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
              จะบันทึก <strong className="tnum" style={{ color: "var(--fg)" }}>{entries.length}</strong> รายการเข้าแคตตาล็อกอ้างอิง
              {pullImages && inStockImgCount > 0 && <span style={{ color: "var(--muted)" }}> · ดึงรูปเข้าคลัง {inStockImgCount} รายการ</span>}
            </div>
            <div className="row">
              <button className="btn" onClick={reset}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={entries.length === 0} onClick={confirmImport}>
                <Icons.Check size={14}/> บันทึกแคตตาล็อก {entries.length} รายการ
              </button>
            </div>
          </div>
        </>
      )}

      {stage === "done" && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 999, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <Icons.Check size={28} stroke={2}/>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>บันทึกแคตตาล็อกสำเร็จ</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>
            {result ? `เพิ่มใหม่ ${result.added} · อัปเดต ${result.updated} · รวมทั้งหมด ${result.total} รายการ` : ""}
            {result && result.images > 0 && <><br/>ดึงรูปสินค้าเข้าคลังแล้ว {result.images} รายการ — พนักงานจะเห็นรูปในหน้าสินค้า</>}
            <br/>เมื่อสแกน SKU ที่ตรงกัน ระบบจะดึงชื่อ/หมวดหมู่/ราคา/รูปให้อัตโนมัติ
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 24 }}>
            <button className="btn btn-primary" onClick={reset}>นำเข้าไฟล์อื่นต่อ</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepBadge({ n }) {
  return (
    <div style={{
      position: "absolute", top: 18, right: 18,
      width: 28, height: 28, borderRadius: 999,
      background: "var(--fg)", color: "var(--bg)",
      display: "grid", placeItems: "center",
      fontSize: 12, fontWeight: 600
    }}>{n}</div>
  );
}

/* The mobile fork (MImport in handheld.jsx) reuses the parsing + validation
   engine so both views classify a row identically. handheld.jsx loads BEFORE
   this file, so it reads these off window at render time, never at top level. */
Object.assign(window, {
  ImportPage,
  IMPORT_FIELDS, DUP_MODES, IMPORT_MAX_ROWS, SAMPLE_ROWS,
  autoMapColumns, buildImportRaws, validateImportRows, importRowDefaults,
  readSheetToAoA, downloadCsvFile
});
