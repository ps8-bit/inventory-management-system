// Nightly full-data backup → Google Drive.
// Reads every table with the service role, uploads a JSON snapshot to a Drive
// folder, and prunes old backups. Uses an OAuth refresh token (uploads to the
// owner's own Drive — 15GB free — avoiding the service-account 0-quota gotcha).
// Triggered by cron (x-cron-secret) or manually by a logged-in admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// SheetJS is not on npm/esm.sh past 0.18.x, and the Supabase bundler blocks
// cdn.sheetjs.com — so the official 0.20.2 ESM build is VENDORED next to this
// file (xlsx.mjs, from https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs).
import * as XLSX from "./xlsx.mjs";

const TABLES = ["products", "orders", "bundles", "bundle_items", "labels", "store_settings", "app_state", "audit_log"];
// Stable sort key per table so paging past PostgREST's 1000-row cap is exact
// (an un-paged select("*") silently returned only the first 1000 rows).
const ORDER: Record<string, string[]> = {
  products: ["sku"], orders: ["id"], bundles: ["id"], bundle_items: ["bundle_id", "sku"], labels: ["id"],
  store_settings: ["key"], app_state: ["key"], audit_log: ["id"],
};

// Same columns/labels as the in-app report (data.jsx buildStockReportWorkbook) —
// keep the two in sync so the nightly Excel and the manual download match.
const STOCK_HEADERS = ["SKU", "ชื่อสินค้า", "หมวดหมู่", "แบรนด์", "คงเหลือ", "จองแล้ว", "จุดสั่งซื้อ", "ตำแหน่ง", "ราคาขาย", "ต้นทุน", "มูลค่าสต็อก", "เปลี่ยนจากเมื่อวาน", "สถานะ"];
const STOCK_SNAPSHOT_KEY = "stock_snapshot_daily";

function statusLabel(qty: number, reorder: number): string {
  if (qty === 0) return "หมดสต็อก";
  if (qty <= reorder) return "ต่ำกว่าจุดสั่งซื้อ";
  return "พร้อมขาย";
}

// Build a two-sheet .xlsx (สรุป summary + สต็อก detail) as a Uint8Array.
// `adj` is the app_state stock_adj overlay ({sku: delta}); `prevMap` is
// yesterday's {sku: qty} for the change-vs-yesterday column.
function buildStockXlsx(
  products: Array<Record<string, unknown>>,
  adj: Record<string, number>,
  prevMap: Record<string, number>,
  dateStr: string,
): { bytes: Uint8Array; snapshot: Record<string, number>; totals: Record<string, number> } {
  const snapshot: Record<string, number> = {};
  let totalQty = 0, totalVal = 0, outCnt = 0, lowCnt = 0;
  const rows = products.map((p) => {
    const sku = String(p.sku ?? "");
    const rawQty = Number(p.qty) || 0;
    const qty = Math.max(0, rawQty + (Number(adj[sku]) || 0));
    const cost = Number(p.cost) || 0;
    const reorder = Number(p.reorder) || 0;
    const val = qty * cost;
    snapshot[sku] = qty;
    totalQty += qty; totalVal += val;
    if (qty === 0) outCnt++; else if (qty <= reorder) lowCnt++;
    const prev = prevMap[sku];
    const hasPrev = typeof prev === "number";
    const delta = hasPrev ? qty - prev : null;
    return [
      sku, p.name ?? "", p.cat ?? "", (p as Record<string, unknown>).brand ?? "",
      qty, Number(p.reserved) || 0, reorder, p.loc ?? "",
      Number(p.price) || 0, cost, val,
      hasPrev ? (delta! > 0 ? "+" + delta : String(delta)) : "—",
      statusLabel(qty, reorder),
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([STOCK_HEADERS, ...rows]);
  ws["!cols"] = [{ wch: 16 }, { wch: 34 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 15 }, { wch: 18 }];
  const wsSum = XLSX.utils.aoa_to_sheet([
    ["รายงานสต็อกประจำวัน — คลังพร้อมส่ง (PS TACTICAL)"],
    ["วันที่", dateStr],
    [""],
    ["จำนวน SKU", rows.length],
    ["รวมจำนวนชิ้น", totalQty],
    ["มูลค่าสต็อกรวม (บาท)", totalVal],
    ["สินค้าหมดสต็อก", outCnt],
    ["ต่ำกว่าจุดสั่งซื้อ", lowCnt],
  ]);
  wsSum["!cols"] = [{ wch: 30 }, { wch: 22 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsSum, "สรุป");
  XLSX.utils.book_append_sheet(wb, ws, "สต็อก");
  // type:"array" yields an ArrayBuffer (not Uint8Array) — wrap it, or the
  // multipart length math in driveUpload NaNs out and throws a RangeError.
  const raw = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer | Uint8Array;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return { bytes, snapshot, totals: { skus: rows.length, qty: totalQty, value: totalVal, out: outCnt, low: lowCnt } };
}

// Upload arbitrary bytes as a file into the Drive folder. Returns the created
// file's name, or throws.
async function driveUpload(token: string, folderId: string, name: string, mime: string, bytes: Uint8Array): Promise<string> {
  const boundary = "ims" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [folderId] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const enc = new TextEncoder();
  const headB = enc.encode(head), tailB = enc.encode(tail);
  const body = new Uint8Array(headB.length + bytes.length + tailB.length);
  body.set(headB, 0); body.set(bytes, headB.length); body.set(tailB, headB.length + bytes.length);
  const up = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` }, body },
  );
  const j = await up.json();
  if (!up.ok || !j.id) throw new Error("Drive upload failed: " + JSON.stringify(j).slice(0, 200));
  return j.name as string;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
    client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
    refresh_token: Deno.env.get("GOOGLE_REFRESH_TOKEN")!,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error("Google token error: " + JSON.stringify(j).slice(0, 200));
  return j.access_token as string;
}

// Best-effort LINE broadcast so a silent nightly failure (revoked refresh token,
// Drive quota, missing secret) actually reaches the owner instead of the Drive
// folder just quietly stopping. Never throws — alerting must not fail the backup.
async function alertOwner(text: string) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) return;
  try {
    await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    });
  } catch (_) { /* best-effort */ }
}

// ── Success notification: daily report summary as a LINE Flex card ──
// (Brand kit mirrors line-alert/line-bot: PS TACTICAL gradient header.)
// Best-effort like alertOwner — a LINE hiccup must never fail the backup.
const BRAND_GRAD = { type: "linearGradient", angle: "135deg", startColor: "#FF7A1A", endColor: "#2A2A2A" };
function statRow(label: string, value: string, color = "#1A1A1A") {
  return { type: "box", layout: "horizontal", spacing: "sm", contents: [
    { type: "text", text: label, size: "sm", color: "#6B7280", flex: 5, wrap: true },
    { type: "text", text: value, size: "sm", color, weight: "bold", flex: 4, align: "end" },
  ] };
}
async function notifyReportReady(totals: Record<string, number>, dateStr: string, folderId: string) {
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (!token) return;
  const [y, m, d] = dateStr.split("-").map(Number);
  const thDate = `${d}/${m}/${y + 543}`;
  const flex = {
    type: "bubble",
    header: { type: "box", layout: "vertical", paddingAll: "16px", background: BRAND_GRAD, contents: [
      { type: "text", text: "📊 รายงานสต็อกประจำวัน", color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
      { type: "text", text: `คลังพร้อมส่ง · ${thDate} · สำรองสำเร็จ ✓`, color: "#FFFFFFCC", size: "xs", margin: "sm", wrap: true },
    ] },
    body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", contents: [
      statRow("จำนวน SKU", String(totals.skus ?? 0)),
      statRow("รวมจำนวนชิ้น", (totals.qty ?? 0).toLocaleString("th-TH")),
      statRow("มูลค่าสต็อกรวม", "฿" + (totals.value ?? 0).toLocaleString("th-TH")),
      statRow("หมดสต็อก", String(totals.out ?? 0) + " SKU", (totals.out ?? 0) > 0 ? "#A32D2D" : "#1A1A1A"),
      statRow("ต่ำกว่าจุดสั่งซื้อ", String(totals.low ?? 0) + " SKU", (totals.low ?? 0) > 0 ? "#854F0B" : "#1A1A1A"),
    ] },
    footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: [
      { type: "text", text: `ไฟล์ stock-report-${dateStr}.xlsx อยู่ใน Google Drive แล้ว`, size: "xs", color: "#6B7280", align: "center", wrap: true },
      { type: "button", style: "primary", color: "#FF7A1A", height: "sm",
        action: { type: "uri", label: "เปิดโฟลเดอร์ Drive", uri: `https://drive.google.com/drive/folders/${folderId}` } },
      { type: "button", style: "link", height: "sm",
        action: { type: "uri", label: "เปิดในแอป", uri: "https://psstock.vercel.app" } },
    ] },
  };
  try {
    await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{
        type: "flex",
        altText: `📊 รายงานสต็อก ${thDate}: ${totals.skus ?? 0} SKU · ${(totals.qty ?? 0).toLocaleString("th-TH")} ชิ้น · ฿${(totals.value ?? 0).toLocaleString("th-TH")}`,
        contents: flex,
      }] }),
    });
  } catch (_) { /* best-effort */ }
}

// Record the outcome of each run in app_state (key "last_backup") so the app's
// Settings can show the last-successful-backup age. No new table needed.
async function recordRun(admin: any, status: string, extra: Record<string, unknown>) {
  try {
    await admin.from("app_state").upsert({
      key: "last_backup",
      value: { status, at: new Date().toISOString(), ...extra },
      updated_at: new Date().toISOString(),
    });
  } catch (_) { /* best-effort */ }
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Authorize: internal cron (shared secret) OR a logged-in admin (manual run).
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const internalOk = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!internalOk) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);
    const { data: { user }, error } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    if (error || !user) return json({ success: false, error: "Unauthorized" }, 401);
    const role = (user.app_metadata as any)?.role || (user.user_metadata as any)?.role;
    if (role !== "admin") return json({ success: false, error: "Forbidden — admin only" }, 403);
  }

  const cfgFail = async (msg: string) => {
    await recordRun(admin, "error", { error: msg });
    await alertOwner("⚠️ สำรองข้อมูลไม่สำเร็จ (ตั้งค่าไม่ครบ): " + msg);
    return json({ success: false, error: msg }, 500);
  };
  const folderId = Deno.env.get("GDRIVE_FOLDER_ID");
  if (!folderId) return await cfgFail("GDRIVE_FOLDER_ID not configured");
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    if (!Deno.env.get(k)) return await cfgFail(`${k} not configured`);
  }

  // 1) Snapshot every table. Capture per-table read errors instead of silently
  //    swallowing them to [] — a hollow "successful" backup that overwrites good
  //    ones (via retention) is worse than a flagged partial.
  const tables: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    let err: string | null = null;
    for (let from = 0; ; from += 1000) {
      let q = admin.from(t).select("*");
      for (const c of ORDER[t] || []) q = q.order(c);
      const { data, error } = await q.range(from, from + 999);
      if (error) { err = error.message; break; }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    if (err) { tables[t] = []; errors[t] = err; }
    else tables[t] = rows;
    counts[t] = Array.isArray(tables[t]) ? (tables[t] as unknown[]).length : 0;
  }
  const partial = Object.keys(errors).length > 0;
  const snapshot = {
    app: "PS TACTICAL — คลังพร้อมส่ง (IMS)",
    kind: "ims-backup", version: 1,
    generatedAt: new Date().toISOString(),
    counts, partial, errors, tables,
  };
  const content = JSON.stringify(snapshot);

  // 2) Google OAuth access token.
  let token: string;
  try { token = await getAccessToken(); }
  catch (e) {
    const msg = String(e).slice(0, 300);
    await recordRun(admin, "error", { error: msg });
    await alertOwner("⚠️ สำรองข้อมูลไม่สำเร็จ: ต่อ Google Drive ไม่ได้ (โทเคนอาจหมดอายุ) — " + msg);
    return json({ success: false, error: msg }, 502);
  }

  // 3) Upload as a multipart file into the target folder.
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const boundary = "ims" + Math.random().toString(36).slice(2);
  const meta = { name: `ims-backup-${stamp}.json`, parents: [folderId] };
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;

  const up = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true",
    {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    },
  );
  const upJson = await up.json();
  if (!up.ok || !upJson.id) {
    const msg = "Drive upload failed: " + JSON.stringify(upJson).slice(0, 300);
    await recordRun(admin, "error", { error: msg });
    await alertOwner("⚠️ สำรองข้อมูลไม่สำเร็จ: อัปโหลดขึ้น Drive ไม่ได้ — " + msg);
    return json({ success: false, error: msg }, 502);
  }

  // 4) Daily stock report (.xlsx) — a dated, human-readable snapshot for checking
  //    quantities day to day. Best-effort: a failure here never fails the JSON
  //    backup above (that's the real safety net). The change-vs-yesterday column
  //    comes from the prior stock_snapshot_daily written on the last run; we
  //    write today's after a successful upload. Both stock_adj (pending overlay)
  //    and the prior snapshot are read from the app_state rows already fetched.
  const dateStr = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10); // Bangkok (UTC+7) calendar date
  let stockFile: string | null = null;
  let stockError: string | null = null;
  let stockTotals: Record<string, number> | null = null;
  try {
    const stateRows = (Array.isArray(tables.app_state) ? tables.app_state : []) as Array<Record<string, unknown>>;
    const adjRow = stateRows.find((r) => r.key === "stock_adj");
    const adj = (adjRow && adjRow.value && typeof adjRow.value === "object") ? adjRow.value as Record<string, number> : {};
    const prevRow = stateRows.find((r) => r.key === STOCK_SNAPSHOT_KEY);
    const prevVal = prevRow ? prevRow.value as Record<string, unknown> : null;
    const prevMap = (prevVal && prevVal.map && typeof prevVal.map === "object") ? prevVal.map as Record<string, number> : {};
    const productRows = (Array.isArray(tables.products) ? tables.products : []) as Array<Record<string, unknown>>;

    const { bytes, snapshot: stockSnap, totals } = buildStockXlsx(productRows, adj, prevMap, dateStr);
    stockTotals = totals;
    stockFile = await driveUpload(
      token, folderId, `stock-report-${dateStr}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes,
    );
    // Store today's qty map so tomorrow's report can show the delta. Overwrites
    // the single rolling key (not per-day) — we only ever diff against yesterday.
    await admin.from("app_state").upsert({
      key: STOCK_SNAPSHOT_KEY,
      value: { date: dateStr, map: stockSnap, totals },
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    stockError = String(e).slice(0, 300);
  }

  // 5) Retention — keep the newest N of EACH kind (JSON backups + stock reports),
  //    delete the rest (best-effort).
  const keep = parseInt(Deno.env.get("BACKUP_RETENTION") || "30", 10) || 30;
  let pruned = 0;
  for (const prefix of ["ims-backup", "stock-report"]) {
    try {
      const q = encodeURIComponent(`'${folderId}' in parents and name contains '${prefix}' and trashed = false`);
      const list = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { "Authorization": "Bearer " + token } },
      );
      const lj = await list.json();
      const files = Array.isArray(lj.files) ? lj.files : [];
      for (const f of files.slice(keep)) {
        const del = await fetch(
          `https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`,
          { method: "DELETE", headers: { "Authorization": "Bearer " + token } },
        );
        if (del.ok) pruned++;
      }
    } catch (_) { /* retention is best-effort — never fail the backup over it */ }
  }

  // Record the run + alert on a partial snapshot (some table read failed but we
  // still uploaded, clearly flagged) so a slowly-degrading backup gets noticed.
  await recordRun(admin, partial ? "partial" : "ok", { file: upJson.name, stockFile, stockError, counts, partial, errors, pruned });
  if (partial) await alertOwner("⚠️ สำรองข้อมูลบางส่วน: อ่านตารางไม่สำเร็จ — " + Object.keys(errors).join(", "));
  if (stockError) await alertOwner("⚠️ สร้างรายงานสต็อก Excel ไม่สำเร็จ (สำรอง JSON สำเร็จแล้ว) — " + stockError);
  // Success card: daily summary + Drive button. Only when the report actually
  // uploaded (a failed report already alerted above; no double-message).
  if (stockFile && !stockError && stockTotals) await notifyReportReady(stockTotals, dateStr, folderId);

  return json({ success: true, file: upJson.name, id: upJson.id, stockFile, stockError, counts, partial, errors, pruned });
});
