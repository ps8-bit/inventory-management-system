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
  { key: "supplier", label: "ผู้จัดส่ง",       required: false, example: "บางกอกแฟชั่น", hint: "ชื่อ supplier" }
];

const SAMPLE_ROWS = [
  ["TH-NEW-101", "หูฟัง In-Ear Pro รุ่น 2025", "อิเล็กทรอนิกส์", "B-02-01", 1290, 80, 25, "Tech Wave Co."],
  ["TH-NEW-102", "เสื้อโปโล Cotton สีกรม Size L", "เสื้อผ้า",       "A-01-05", 590,  120, 40, "บางกอกแฟชั่น"],
  ["TH-NEW-103", "กล่องเก็บของพับได้ 30L",      "ของใช้ในบ้าน",   "C-02-08", 390,  60,  20, "Comfort Living"],
  ["TH-NEW-104", "ลิปบาล์ม Honey Glow 4g",     "ความงาม",        "D-01-12", 180,  240, 50, "Glow Lab"],
  ["TH-NEW-105", "กาแฟคั่วเข้ม 500g",          "อาหารและเครื่องดื่ม", "E-02-14", 480, 90,  30, "Doi Coffee"]
];

function ImportPage({ pushToast, goTo }) {
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
        supplier: r.supplier || "ไม่ระบุ"
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
          <h1 className="page-title">นำเข้า SKU จำนวนมาก</h1>
          <div className="page-sub">ดาวน์โหลดเทมเพลต Excel กรอกข้อมูล แล้วอัปโหลดกลับเข้าระบบ</div>
        </div>
        <div className="row">
          {stage !== "idle" && <button className="btn" onClick={reset}><Icons.Refresh size={14}/> เริ่มใหม่</button>}
        </div>
      </div>

      {stage === "idle" && (
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

      {stage === "preview" && (
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

      {stage === "done" && (
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
