# Telegram pack-alert card designs (2026-10-30)

The bot **PS Order Alerts** (`@pstactical_order_bot`) posts order alerts to the staff
group **PS TAC** (chat id saved in `app_state` key `telegram_chats`). Sender:
`supabase/functions/order-push/index.ts`. Audience: owner + packers only — never
cost or sales figures.

Every sample below was sent to the group as a demo (marked "ทดสอบ"); none is a real order.

| # | Layout | Status | Files |
|---|---|---|---|
| 1 | Text message | **LIVE** | — (template below) |
| D | Photo album + text caption | Built, in PR #69, **not deployed** | — (native Telegram album) |
| A | One card per item (sendPhoto per line) | Demo only (DEMO-004) | — |
| B | Text + small thumbnail on the right (link preview) | Demo only (DEMO-005) — 1 photo max | — |
| C | Pick-list image, photo beside each line | Demo only (DEMO-006/007/008) | `C-picklist-*.png` |
| E | Branded card (PS TACTICAL header, platform badge, chips) | Demo only (DEMO-009) — **owner's preferred direction** | `E-branded-card.png`, `E-branded-card.html` |

## 1 — Text message (live)

```
🆕 ออร์เดอร์ใหม่ · <short id>          ✏️ ออร์เดอร์ถูกแก้ไข / ⛔ ออร์เดอร์ถูกยกเลิก
<customer> · <channel>

• <SKU> <name> × <qty>                 edit: ➕ เพิ่ม / ➖ เอาออก / 🔁 <SKU> <name> : 2 → 3
✏️ <field>: <before> → <after>

⚠️ ตรวจสอบและเช็คสินค้าให้ตรงก่อนแพ็ค (โดย <who>)
   (edit: เช็คสินค้าใหม่อีกครั้ง · cancel: ห้ามส่ง — นำสินค้ากลับที่เดิม)
```

## D — Photo album (PR #69)

One photo per SKU (max 10) from `app_state` `img:<sku>`; the text above is the first
photo's caption (or follows as a message when longer than 1024 chars). New orders get
every line; edits only lines that were added/raised; cancels stay text-only.

## C — Pick-list image

1080 px wide; header (order, channel, N รายการ · N ชิ้น), rows = number · photo ·
SKU (bold) · name (ellipsis) · large orange `× qty`, zebra rows, warning footer.
20 rows fit one page (`C-picklist-20-items.png`); the 12-item sample shows the
2-page album variant. Drawn with PIL (no raqm) — Thai tone marks break (ชิ้น), so a
production renderer must shape Thai properly.

## E — Branded card

`E-branded-card.html` is the source; render at 1080 px wide (headless Edge/Chrome
screenshot) to reproduce `E-branded-card.png`. Thai renders correctly (Noto Sans Thai).

- Dark header: orange **PS** logo, "PS TACTICAL · แจ้งแพ็คสินค้า", `🆕 ออร์เดอร์ใหม่ #<id>`
- Platform pill on the right (Shopee orange; give Lazada/TikTok/FB their own colours)
- Accent strip under the header: green = new, yellow = edit, red = cancel (+ big "ห้ามส่ง")
- Chips: status · ลูกค้า · ส่งภายใน · โดย
- Rows: number · 110 px rounded photo · SKU · name · quantity box (orange when ≥ 2)
- Footer: "⚠ เช็คสินค้า สี/ไซส์ ให้ตรงก่อนแพ็ค" + "N รายการ · N ชิ้น"

Next: owner is designing their own look; build the chosen design into `order-push`
with a Thai-capable server-side renderer.
