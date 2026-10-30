// Pack-alert card for Telegram — the owner's design (docs/telegram-cards).
// Pure layout: returns a satori element tree + its exact height. order-push
// renders it with satori → resvg. Every block has a fixed height so the canvas
// can be sized without a measuring pass. Satori is flexbox-only: every element
// with more than one child needs display:"flex".
//
// Photos must be PNG/JPEG data URLs (resvg can't draw webp) — order-push
// passes the small JPEG thumbnails from storage (product-images/t/<sku>.jpg).

export type CardLine = { sku: string; name: string; qty: number; from?: number; to?: number; photo?: string };
export type CardField = { label: string; from: string; to: string };
export type CardInput = {
  kind: "new" | "edit" | "removed";
  id: string;
  channel: string;
  customer: string;
  by: string;
  lines: CardLine[];
  fields: CardField[];
  page?: number;
  pages?: number;
  start?: number;        // row number offset on page 2+
  totalLines: number;
  totalQty: number;
};

const W = 1080;
const PAD = 32;          // page margin around the card
const HEAD_H = 164;
const META_H = 100;
const ROW_H = 158;
const BANNER_H = 176;
const FIELD_H = 84;
const FOOT_H = 98;

const THEME = {
  new: {
    page: "linear-gradient(160deg, #ecfdf5, #f1f5f9)",
    head: "linear-gradient(120deg, #6ee7b7, #10b981 55%, #059669)",
    ink: "#047857", sub: "#065f46", strip: "#a7f3d0", meta: "#f0fdfa",
    chipBg: "#ecfdf5", chipBd: "#a7f3d0", chipInk: "#047857",
    hot: "linear-gradient(135deg, #34d399, #059669)", soft: "#f0fdfa", softBd: "#a7f3d0", softInk: "#047857",
    foot: "linear-gradient(90deg, #134e4a, #1f3b3a)", footInk: "#ccfbf1",
    title: "ออร์เดอร์ใหม่", status: "พร้อมแพ็ค", warn: "เช็คสินค้า สี/ไซส์ ให้ตรงก่อนแพ็ค",
  },
  edit: {
    page: "linear-gradient(160deg, #fffbeb, #f8fafc)",
    head: "linear-gradient(120deg, #fcd34d, #f59e0b 55%, #ea7a12)",
    ink: "#c2410c", sub: "#92400e", strip: "#fde68a", meta: "#fffbeb",
    chipBg: "#fef3c7", chipBd: "#fcd34d", chipInk: "#92400e",
    hot: "linear-gradient(135deg, #fbbf24, #f08a12)", soft: "#fff1f2", softBd: "#fecdd3", softInk: "#be123c",
    foot: "linear-gradient(90deg, #4a3526, #5b4636)", footInk: "#fde68a",
    title: "ออร์เดอร์ถูกแก้ไข", status: "แก้ไขแล้ว — เช็คใหม่", warn: "เช็คสินค้าใหม่อีกครั้งก่อนแพ็ค",
  },
  removed: {
    page: "linear-gradient(160deg, #fff1f2, #f8fafc)",
    head: "linear-gradient(120deg, #fda4af, #f43f5e 55%, #e11d48)",
    ink: "#be123c", sub: "#9f1239", strip: "#fecdd3", meta: "#fff1f2",
    chipBg: "#ffe4e6", chipBd: "#fda4af", chipInk: "#be123c",
    hot: "linear-gradient(135deg, #fb7185, #e11d48)", soft: "#fff1f2", softBd: "#fecdd3", softInk: "#be123c",
    foot: "linear-gradient(90deg, #4c1d2b, #5b2333)", footInk: "#fecdd3",
    title: "ออร์เดอร์ถูกยกเลิก", status: "ยกเลิกแล้ว", warn: "ไม่ต้องแพ็ค / ไม่ต้องส่ง",
  },
};

// deno-lint-ignore no-explicit-any
type El = any;
const box = (style: Record<string, unknown>, children?: unknown): El =>
  ({ type: "div", props: { style: { display: "flex", ...style }, children } });
const txt = (style: Record<string, unknown>, s: string): El =>
  ({ type: "div", props: { style, children: s } });
const one = (style: Record<string, unknown>, s: string): El =>
  txt({ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...style }, s);

function photo(src: string | undefined, faded: boolean): El {
  const frame = { width: 100, height: 100, borderRadius: 18, background: "#fff", border: "1px solid #e2e8f0",
    alignItems: "center", justifyContent: "center", opacity: faded ? 0.45 : 1, flexShrink: 0 };
  if (!src) return box(frame, txt({ fontSize: 22, color: "#cbd5e1" }, "—"));
  return box(frame, { type: "img", props: { src, width: 84, height: 84, style: { objectFit: "contain" } } });
}

function qtyBox(t: typeof THEME.new, label: string, hot: boolean, down = false, wide = false): El {
  const w = wide ? 152 : 96;
  if (hot) {
    return box({ width: w, height: 74, borderRadius: 16, background: t.hot, alignItems: "center", justifyContent: "center", flexShrink: 0 }, txt({ fontSize: 38, fontWeight: 700, color: "#fff" }, label));
  }
  const bg = down ? "#fff1f2" : t.soft, bd = down ? "#fecdd3" : t.softBd, ink = down ? "#be123c" : t.softInk;
  return box({ width: w, height: 74, borderRadius: 16, background: bg, border: `2px solid ${bd}`, alignItems: "center",
    justifyContent: "center", flexShrink: 0 }, txt({ fontSize: 38, fontWeight: 700, color: ink }, label));
}

const TAG = {
  add: { bg: "#dcfce7", ink: "#15803d", label: "เพิ่มใหม่" },
  chg: { bg: "#fef3c7", ink: "#b45309", label: "แก้จำนวน" },
  del: { bg: "#ffe4e6", ink: "#be123c", label: "เอาออก" },
};

function row(t: typeof THEME.new, kind: CardInput["kind"], l: CardLine, n: number): El {
  let tag: keyof typeof TAG | null = null, q: El, faded = false;
  if (kind === "edit") {
    const from = l.from ?? 0, to = l.to ?? l.qty;
    if (from === 0) { tag = "add"; q = qtyBox(t, `+${to}`, true, false, true); }
    else if (to === 0) { tag = "del"; faded = true; q = qtyBox(t, `${from} → 0`, false, true, true); }
    else { tag = "chg"; q = qtyBox(t, `${from} → ${to}`, to > from, to < from, true); }
  } else {
    q = qtyBox(t, `×${l.qty}`, kind === "new" && l.qty >= 2);
  }
  const skuStyle = { fontSize: 32, fontWeight: 700, color: faded ? "#94a3b8" : "#1e293b",
    textDecoration: faded ? "line-through" : "none" };
  return box({ height: ROW_H, alignItems: "center", padding: "0 36px", gap: 24,
    background: n % 2 ? "#f8fafc" : "#ffffff", borderBottom: "1px solid #eef2f7" }, [
    txt({ width: 24, fontSize: 20, color: "#94a3b8", textAlign: "center", flexShrink: 0 }, String(n + 1)),
    photo(l.photo, faded),
    box({ flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 2 }, [
      box({ alignItems: "center", gap: 10 }, [
        ...(tag ? [txt({ fontSize: 20, fontWeight: 600, color: TAG[tag].ink, background: TAG[tag].bg,
          padding: "2px 10px", borderRadius: 8, flexShrink: 0 }, TAG[tag].label)] : []),
        one(skuStyle, l.sku),
      ]),
      one({ fontSize: 23, color: faded ? "#cbd5e1" : "#64748b" }, l.name),
    ]),
    q,
  ]);
}

export function cardHeight(c: CardInput): number {
  return PAD * 2 + HEAD_H + META_H + ROW_H * c.lines.length +
    (c.kind === "removed" ? BANNER_H : 0) + FIELD_H * c.fields.length + FOOT_H;
}

export function buildCard(c: CardInput): { el: El; width: number; height: number } {
  const t = THEME[c.kind];
  const height = cardHeight(c);
  const pageTag = c.pages && c.pages > 1 ? `  ·  หน้า ${c.page}/${c.pages}` : "";
  const meta: El[] = [
    txt({ fontSize: 22, fontWeight: 600, color: t.chipInk, background: t.chipBg, border: `1px solid ${t.chipBd}`,
      padding: "6px 16px", borderRadius: 10, flexShrink: 0 }, t.status),
  ];
  if (c.customer) meta.push(box({ gap: 6, fontSize: 22, color: "#64748b", flexShrink: 1, minWidth: 0 },
    [txt({ flexShrink: 0 }, "ลูกค้า"), one({ color: "#1e293b", fontWeight: 600 }, c.customer)]));
  if (c.by) meta.push(box({ gap: 6, fontSize: 22, color: "#64748b", flexShrink: 0 },
    [txt({}, "โดย"), txt({ color: "#1e293b", fontWeight: 600 }, c.by)]));

  const blocks: El[] = [
    // header
    box({ height: HEAD_H, background: t.head, alignItems: "center", padding: "0 36px", gap: 24,
      borderBottom: `4px solid ${t.strip}` }, [
      box({ width: 68, height: 68, borderRadius: 16, background: "#fff", alignItems: "center", justifyContent: "center", flexShrink: 0 }, txt({ fontSize: 26, fontWeight: 700, color: t.ink }, "PS")),
      box({ flexDirection: "column", flexGrow: 1, minWidth: 0 }, [
        txt({ fontSize: 18, fontWeight: 600, color: t.sub, letterSpacing: 1 }, "PS TACTICAL · แจ้งแพ็คสินค้า" + pageTag),
        one({ fontSize: 38, fontWeight: 700, color: "#fff" }, `${t.title} #${c.id}`),
      ]),
      ...(c.channel ? [txt({ fontSize: 22, fontWeight: 700, color: t.ink, background: "#fff", padding: "8px 20px",
        borderRadius: 14, flexShrink: 0 }, c.channel)] : []),
    ]),
    // meta
    box({ height: META_H, background: t.meta, alignItems: "center", padding: "0 36px", gap: 22,
      borderBottom: "1px solid #eef2f7" }, meta),
  ];
  if (c.kind === "removed") {
    blocks.push(box({ height: BANNER_H, background: t.head, flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 4 }, [
      txt({ fontSize: 60, fontWeight: 700, color: "#fff" }, "ห้ามส่ง"),
      txt({ fontSize: 24, color: "#fff" }, "ถ้าแพ็คแล้ว ให้แกะ และนำสินค้ากลับที่เดิม"),
    ]));
  }
  c.lines.forEach((l, i) => blocks.push(row(t, c.kind, l, i + (c.start || 0))));
  c.fields.forEach((f) => blocks.push(box({ height: FIELD_H, background: "#fffbeb", alignItems: "center",
    padding: "0 36px", gap: 10, fontSize: 24, borderBottom: "1px solid #fef3c7" }, [
    txt({ color: "#92400e", flexShrink: 0 }, `${f.label}:`),
    one({ color: "#94a3b8", textDecoration: "line-through", flexShrink: 1, maxWidth: 360 }, f.from || "-"),
    txt({ color: "#64748b", flexShrink: 0 }, "→"),
    one({ color: "#1e293b", fontWeight: 600, flexShrink: 1 }, f.to || "-"),
  ])));
  const changed = c.kind === "edit"
    ? `เปลี่ยน ${c.lines.length} รายการ${c.fields.length ? ` · ${c.fields.length} ข้อมูล` : ""}`
    : `${c.totalLines} รายการ · ${c.totalQty} ชิ้น`;
  blocks.push(box({ height: FOOT_H, background: t.foot, alignItems: "center", justifyContent: "space-between",
    padding: "0 36px" }, [
    // The font has no ⚠/⛔ glyphs — draw the badge instead.
    box({ alignItems: "center", gap: 12 }, [
      box({ width: 30, height: 30, borderRadius: 15, background: t.footInk, alignItems: "center", justifyContent: "center" },
        txt({ fontSize: 20, fontWeight: 700, color: "#1e293b" }, c.kind === "removed" ? "×" : "!")),
      txt({ fontSize: 24, fontWeight: 600, color: t.footInk }, t.warn),
    ]),
    txt({ fontSize: 26, fontWeight: 600, color: "#fff" }, changed),
  ]));

  const el = box({ width: W, height, background: t.page, padding: PAD, fontFamily: "Prompt" },
    box({ flexDirection: "column", width: W - PAD * 2, borderRadius: 28, overflow: "hidden", background: "#fff" }, blocks));
  return { el, width: W, height };
}
