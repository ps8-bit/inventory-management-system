/* Bulk SKU import page — Excel template download + upload + preview */

const { useState: useStateImp, useRef: useRefImp, useMemo: useMemoImp } = React;

const TEMPLATE_COLUMNS = [
  { key: "sku",      label: "SKU",           required: true,  example: "TH-XXX-001", hint: "รหัสสินค้าเฉพาะ ห้ามซ้ำ" },
  { key: "name",     label: "ชื่อสินค้า",     required: true,  example: "เสื้อยืดคอกลม สีขาว", hint: "ชื่อแสดงในระบบ" },
  { key: "cat",      label: "หมวดหมู่",       required: false, example: "เสื้อผ้า", hint: "ถ้าไม่ระบุจะถูกจัดเป็น 'ทั่วไป'" },
  { key: "loc",      label: "ตำแหน่งจัดเก็บ", required: false, example: "A-01-01", hint: "รูปแบบ โซน-แถว-ช่อง" },
  { key: "price",    label: "ราคา (บาท)",     required: false, example: "290", hint: "ตัวเลขเท่านั้น" },
  { key: "qty",      label: "จำนวนเริ่มต้น",   required: false, example: "100", hint: "สต็อกตอนนำเข้า" },
  { key: "reorder",  label: "จุดสั่งซื้อใหม่", required: false, example: "30", hint: "แจ้งเตือนเมื่อต่ำกว่าค่านี้" },
  { key: "supplier", label: "ผู้จัดส่ง",       required: false, example: "บางกอกแฟชั่น", hint: "ชื่อ supplier" },
  { key: "brand",    label: "แบรนด์",          required: false, example: "5.11", hint: "แบรนด์สินค้า (ถ้ามี)" }
];

const SAMPLE_ROWS = [
  ["TH-NEW-101", "หูฟัง In-Ear Pro รุ่น 2025", "อิเล็กทรอนิกส์", "B-02-01", 1290, 80, 25, "Tech Wave Co.", "SoundMax"],
  ["TH-NEW-102", "เสื้อโปโล Cotton สีกรม Size L", "เสื้อผ้า",       "A-01-05", 590,  120, 40, "บางกอกแฟชั่น", "BKK Wear"],
  ["TH-NEW-103", "กล่องเก็บของพับได้ 30L",      "ของใช้ในบ้าน",   "C-02-08", 390,  60,  20, "Comfort Living", "HomeFit"],
  ["TH-NEW-104", "ลิปบาล์ม Honey Glow 4g",     "ความงาม",        "D-01-12", 180,  240, 50, "Glow Lab", "Glow Lab"],
  ["TH-NEW-105", "กาแฟคั่วเข้ม 500g",          "อาหารและเครื่องดื่ม", "E-02-14", 480, 90,  30, "Doi Coffee", "Doi Coffee"]
];

function ImportPage({ pushToast, goTo }) {
  const [mode, setMode] = useStateImp("stock"); // stock (template) | woo (WooCommerce catalog)
  const [stage, setStage] = useStateImp("idle"); // idle | preview | done
  const [rows, setRows] = useStateImp([]);
  const [fileName, setFileName] = useStateImp("");
  const [dragOver, setDragOver] = useStateImp(false);
  const fileRef = useRefImp(null);

  const xlsxAvailable = typeof XLSX !== "undefined";

  const downloadTemplate = () => {
    if (!xlsxAvailable) { pushToast("ไลบรารี Excel ยังไม่พร้อม กรุณารอสักครู่"); return; }
    const headerRow = TEMPLATE_COLUMNS.map(c => c.label + (c.required ? " *" : ""));
    const aoa = [headerRow, ...SAMPLE_ROWS];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // column widths
    ws["!cols"] = TEMPLATE_COLUMNS.map(c => ({ wch: Math.max(c.label.length + 3, 16) }));

    // instructions sheet
    const instrAoA = [
      ["เทมเพลตนำเข้าสินค้า — คลังพร้อมส่ง"],
      [""],
      ["วิธีใช้"],
      ["1. กรอกข้อมูลในชีท 'สินค้า' ตามคอลัมน์ที่กำหนด"],
      ["2. คอลัมน์ที่มีเครื่องหมาย * เป็นข้อมูลที่ต้องกรอก"],
      ["3. ลบแถวตัวอย่างออกก่อนอัปโหลดไฟล์เข้าระบบ"],
      ["4. รองรับไฟล์นามสกุล .xlsx เท่านั้น (Excel 2007 ขึ้นไป)"],
      [""],
      ["ความหมายของคอลัมน์"],
      ["คอลัมน์", "จำเป็น", "ตัวอย่าง", "คำอธิบาย"],
      ...TEMPLATE_COLUMNS.map(c => [c.label, c.required ? "ต้องกรอก" : "ไม่บังคับ", c.example, c.hint])
    ];
    const wsInstr = XLSX.utils.aoa_to_sheet(instrAoA);
    wsInstr["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 22 }, { wch: 40 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "สินค้า");
    XLSX.utils.book_append_sheet(wb, wsInstr, "วิธีใช้");

    XLSX.writeFile(wb, "เทมเพลตนำเข้าสินค้า.xlsx");
    pushToast("ดาวน์โหลดเทมเพลตแล้ว");
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!xlsxAvailable) { pushToast("ไลบรารี Excel ยังไม่พร้อม กรุณารอสักครู่"); return; }
    const ext = file.name.toLowerCase().split(".").pop();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      pushToast("กรุณาเลือกไฟล์ .xlsx หรือ .csv");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const rawBytes = new Uint8Array(e.target.result);
        let wb;

        if (ext === "csv") {
          /* ── CSV encoding detection ──
             Thai CSV files from Windows/Excel can be saved in several encodings:
               • UTF-8 with BOM  (EF BB BF)  — modern Excel / Google Sheets
               • UTF-16 LE BOM   (FF FE)      — Excel "Unicode CSV" / "Save as UTF-16"
               • UTF-16 BE BOM   (FE FF)      — rare but possible
               • Windows-874 / TIS-620        — no BOM, bytes 0xA0-0xFB for Thai
             Strategy: check for each BOM first, then probe UTF-8 quality.
             Use � escape (not literal char) so this works regardless of source editor encoding. */
          const hasBOM_UTF8    = rawBytes[0] === 0xEF && rawBytes[1] === 0xBB && rawBytes[2] === 0xBF;
          const hasBOM_UTF16LE = rawBytes[0] === 0xFF && rawBytes[1] === 0xFE;
          const hasBOM_UTF16BE = rawBytes[0] === 0xFE && rawBytes[1] === 0xFF;
          let csvText;
          if (hasBOM_UTF8) {
            csvText = new TextDecoder("utf-8").decode(rawBytes);
          } else if (hasBOM_UTF16LE) {
            csvText = new TextDecoder("utf-16le").decode(rawBytes);
          } else if (hasBOM_UTF16BE) {
            csvText = new TextDecoder("utf-16be").decode(rawBytes);
          } else {
            // No BOM — try UTF-8 first
            const utf8 = new TextDecoder("utf-8").decode(rawBytes);
            if (utf8.includes("�")) {
              // Contains invalid UTF-8 sequences → likely Windows-874 (Thai Windows/Excel)
              try { csvText = new TextDecoder("windows-874").decode(rawBytes); }
              catch (e1) {
                try { csvText = new TextDecoder("iso-8859-11").decode(rawBytes); }
                catch (e2) { csvText = utf8; }
              }
            } else {
              csvText = utf8;
            }
          }
          wb = XLSX.read(csvText, { type: "string" });
        } else {
          wb = XLSX.read(rawBytes, { type: "array" });
        }

        const sheet = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // Detect a WooCommerce export dropped into the wrong tab — its header has
        // columns our template never uses. Redirect to the WooCommerce tab instead
        // of producing a wall of "wrong column" errors.
        const hdr = (aoa[0] || []).map(h => String(h == null ? "" : h).trim().toLowerCase());
        const looksWoo = hdr.includes("parent") || hdr.includes("regular price") || (hdr.includes("type") && hdr.includes("images"));
        if (looksWoo) {
          setMode("woo");
          setFileName("");
          pushToast("ไฟล์นี้เป็น WooCommerce export — สลับไปแท็บ “แคตตาล็อก WooCommerce” ให้แล้ว ลากไฟล์มาวางอีกครั้ง");
          return;
        }

        // skip header row, drop empty rows
        const dataRows = aoa.slice(1).filter(r => r.some(cell => cell !== "" && cell != null));
        const parsed = dataRows.map((r, i) => {
          const obj = { _row: i + 2, _errors: [] };
          TEMPLATE_COLUMNS.forEach((c, ci) => obj[c.key] = r[ci] != null ? String(r[ci]).trim() : "");
          // validation
          if (!obj.sku) obj._errors.push("ขาด SKU");
          if (!obj.name) obj._errors.push("ขาดชื่อสินค้า");
          if (obj.price && isNaN(Number(obj.price))) obj._errors.push("ราคาไม่ใช่ตัวเลข");
          if (obj.qty && isNaN(Number(obj.qty))) obj._errors.push("จำนวนไม่ใช่ตัวเลข");
          if (obj.reorder && isNaN(Number(obj.reorder))) obj._errors.push("จุดสั่งซื้อไม่ใช่ตัวเลข");
          if (PRODUCTS.some(p => p.sku === obj.sku)) obj._errors.push("SKU นี้มีอยู่ในระบบแล้ว");
          return obj;
        });
        setRows(parsed);
        setStage("preview");
        pushToast(`อ่านไฟล์สำเร็จ พบ ${parsed.length} แถว`);
      } catch (err) {
        pushToast("อ่านไฟล์ไม่ได้ ตรวจสอบรูปแบบไฟล์");
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const validRows = rows.filter(r => r._errors.length === 0);
  const errorRows = rows.filter(r => r._errors.length > 0);

  const confirmImport = () => {
    validRows.forEach(r => {
      const price = Number(r.price) || 0;
      addProductToStore({
        sku: r.sku,
        name: r.name,
        cat: r.cat || "ทั่วไป",
        loc: (r.loc || "—").toUpperCase(),
        price,
        cost: Math.round(price * 0.6),
        qty: parseInt(r.qty) || 0,
        reserved: 0,
        reorder: parseInt(r.reorder) || 30,
        supplier: r.supplier || "ไม่ระบุ",
        brand: r.brand || ""
      });
    });
    if (typeof recordChange === "function" && validRows.length) {
      recordChange({
        entity: "product", action: "import",
        summary: `นำเข้า ${validRows.length} SKU จากไฟล์ ${fileName}`,
        count: validRows.length,
        note: "SKU: " + validRows.map(r => r.sku).join(", ")
      });
    }
    setStage("done");
    pushToast(`นำเข้า ${validRows.length} SKU เข้าคลังสำเร็จ`);
  };

  const reset = () => {
    setRows([]);
    setFileName("");
    setStage("idle");
  };

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">นำเข้าข้อมูล</h1>
          <div className="page-sub">
            {mode === "woo"
              ? "นำเข้าแคตตาล็อกสินค้าจาก WooCommerce — เมื่อสแกน SKU ที่ตรงกัน ระบบจะดึงชื่อ/หมวดหมู่/ราคา/รูปให้อัตโนมัติ"
              : "ดาวน์โหลดเทมเพลต Excel กรอกข้อมูล แล้วอัปโหลดกลับเข้าระบบ"}
          </div>
        </div>
        <div className="row">
          {mode === "stock" && stage !== "idle" && <button className="btn" onClick={reset}><Icons.Refresh size={14}/> เริ่มใหม่</button>}
        </div>
      </div>

      <div className="tabs">
        <div className={"tab" + (mode === "stock" ? " active" : "")} onClick={() => setMode("stock")}>
          <Icons.Pkg size={14}/> นำเข้าสต็อก (เทมเพลต)
        </div>
        <div className={"tab" + (mode === "woo" ? " active" : "")} onClick={() => setMode("woo")}>
          <Icons.Scan size={14}/> แคตตาล็อก WooCommerce
        </div>
      </div>

      {mode === "woo" && <WooCatalogImport pushToast={pushToast}/>}

      {mode === "stock" && stage === "idle" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Step 1: download template */}
            <div className="card" style={{ padding: 24, position: "relative" }}>
              <StepBadge n={1}/>
              <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>ดาวน์โหลดเทมเพลต</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
                เทมเพลต Excel มาพร้อมแถวตัวอย่างและคำอธิบายแต่ละคอลัมน์ ลบแถวตัวอย่างก่อนอัปโหลดเข้าระบบ
              </div>
              <button className="btn btn-primary" onClick={downloadTemplate}>
                <Icons.Pkg size={14}/> ดาวน์โหลด .xlsx
              </button>

              <div style={{ marginTop: 18, padding: 14, background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div className="eyebrow" style={{ marginBottom: 8 }}>คอลัมน์ในเทมเพลต</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {TEMPLATE_COLUMNS.map(c => (
                    <div key={c.key} style={{ fontSize: 12, padding: "3px 0", display: "flex", alignItems: "center", gap: 4 }}>
                      {c.required && <span style={{ color: "var(--danger)", fontWeight: 600 }}>*</span>}
                      <span style={{ color: c.required ? "var(--fg)" : "var(--fg-2)" }}>{c.label}</span>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}><span style={{ color: "var(--danger)" }}>*</span> = ต้องกรอก</div>
              </div>
            </div>

            {/* Step 2: upload */}
            <div className="card" style={{ padding: 24, position: "relative" }}>
              <StepBadge n={2}/>
              <div style={{ fontWeight: 600, fontSize: 15, marginTop: 12 }}>อัปโหลดไฟล์</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
                รองรับ .xlsx (Excel) และ .csv ระบบจะตรวจสอบข้อมูลและให้คุณยืนยันก่อนนำเข้า
              </div>
              <div
                className={"dropzone" + (dragOver ? " over" : "")}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              >
                <div className="dz-icon"><Icons.Pkg size={24}/></div>
                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 12 }}>ลากไฟล์มาวาง หรือ คลิกเพื่อเลือก</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>.xlsx · .csv · ขนาดไม่เกิน 5 MB</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => handleFile(e.target.files?.[0])} style={{ display: "none" }}/>
            </div>
          </div>

          <div className="card" style={{ padding: 18, display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--info-soft)", color: "var(--info)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icons.Help size={18}/>
            </div>
            <div style={{ fontSize: 12, color: "var(--fg-2)", lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600, color: "var(--fg)", fontSize: 13, marginBottom: 4 }}>เคล็ดลับการใช้งาน</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>เก็บคอลัมน์เรียงตามเทมเพลต อย่าสลับลำดับ</li>
                <li>ค่าตัวเลข (ราคา จำนวน) ต้องเป็นตัวเลขล้วน ไม่มีจุลภาคหรือสัญลักษณ์</li>
                <li>SKU ห้ามซ้ำกับที่มีอยู่ในระบบ — ระบบจะแจ้งเตือนในขั้นตอนตรวจสอบ</li>
                <li>นำเข้าครั้งละไม่เกิน 5,000 แถว เพื่อประสิทธิภาพการตรวจสอบ</li>
              </ul>
            </div>
          </div>
        </>
      )}

      {mode === "stock" && stage === "preview" && (
        <>
          <div className="grid-3">
            <SmallStat label="แถวทั้งหมด" value={rows.length} tone="info" hint={`จากไฟล์ ${fileName}`}/>
            <SmallStat label="ผ่านการตรวจ" value={validRows.length} tone="success" hint="พร้อมนำเข้า"/>
            <SmallStat label="ต้องแก้ไข" value={errorRows.length} tone={errorRows.length > 0 ? "warning" : "success"} hint={errorRows.length > 0 ? "ดูรายละเอียดด้านล่าง" : "ไม่มีปัญหา"}/>
          </div>

          <div className="card card-tight">
            <div className="card-head">
              <div>
                <h3>ตรวจสอบข้อมูลก่อนนำเข้า</h3>
                <div className="sub">{fileName}</div>
              </div>
              <div className="row">
                <button className="btn btn-sm" onClick={reset}>เลือกไฟล์ใหม่</button>
              </div>
            </div>
            <div style={{ maxHeight: 480, overflow: "auto" }}>
              <table className="t">
                <thead><tr>
                  <th style={{ width: 36 }}>แถว</th>
                  {TEMPLATE_COLUMNS.map(c => <th key={c.key}>{c.label}</th>)}
                  <th>สถานะ</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const bad = r._errors.length > 0;
                    return (
                      <tr key={i} style={bad ? { background: "var(--danger-soft)" } : {}}>
                        <td className="t-mono" style={{ color: "var(--muted)" }}>{r._row}</td>
                        {TEMPLATE_COLUMNS.map(c => (
                          <td key={c.key} className={["sku"].includes(c.key) ? "t-mono" : ""} style={{ fontSize: 12 }}>
                            {r[c.key] || <span style={{ color: "var(--faint)" }}>—</span>}
                          </td>
                        ))}
                        <td>
                          {bad ? (
                            <span className="badge badge-danger" title={r._errors.join(", ")}>
                              <Icons.Warn size={11}/> {r._errors[0]}{r._errors.length > 1 ? ` +${r._errors.length-1}` : ""}
                            </span>
                          ) : (
                            <span className="badge badge-success"><Icons.Check size={11}/> พร้อม</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
              จะนำเข้า <strong className="tnum" style={{ color: "var(--fg)" }}>{validRows.length}</strong> SKU เข้าสู่ระบบ
              {errorRows.length > 0 && <span style={{ color: "var(--muted)" }}> · ข้าม {errorRows.length} แถวที่มีข้อผิดพลาด</span>}
            </div>
            <div className="row">
              <button className="btn" onClick={reset}>ยกเลิก</button>
              <button className="btn btn-primary" disabled={validRows.length === 0} onClick={confirmImport} style={validRows.length === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}}>
                <Icons.Check size={14}/> ยืนยันนำเข้า {validRows.length} SKU
              </button>
            </div>
          </div>
        </>
      )}

      {mode === "stock" && stage === "done" && (
        <div className="card" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 999, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
            <Icons.Check size={28} stroke={2}/>
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>นำเข้าสำเร็จ {validRows.length} SKU</div>
          <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>ข้อมูลถูกบันทึกในระบบเรียบร้อยแล้ว สินค้าใหม่จะปรากฏในหน้าสินค้าคงคลัง</div>
          <div className="row" style={{ justifyContent: "center", marginTop: 24, gap: 10 }}>
            <button className="btn" onClick={reset}>นำเข้าไฟล์อื่นต่อ</button>
            <button className="btn btn-primary" onClick={() => goTo && goTo("inventory")}>ไปที่สินค้าคงคลัง <Icons.ArrowRight size={14}/></button>
          </div>
        </div>
      )}
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

Object.assign(window, { ImportPage });
