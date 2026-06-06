# PS TACTICAL IMS — Roadmap & Planning Workflow

A living plan for what's done, what's pending, and what to build next — plus the
repeatable workflow we use for every change. Update this as items move.

_Last updated: 2026-06-06_

---

## 1. Status snapshot

### ✅ Done & live (cache token `20260606d`)
- UI refresh → clean **white theme + floating depth** (desktop + mobile)
- **Analytics** on real order data, bucketed by real date/time (+ sale-time price snapshot)
- **Stock take / cycle count** (desktop + mobile)
- **Product-name OCR** — read a product name from a photo (Gemini) → auto-fill
- **Backup Tier 1** — one-tap manual export of all data to `.json`
- Contrast/visibility fixes · `CLAUDE.md` · "always update mobile" rule

### 🟡 Built but not activated (needs a one-time action)
- **Backup Tier 2 — nightly → Google Drive.** Function + cron + `SETUP-BACKUP.md`
  are ready. Activate by doing the ~15-min Google setup + setting secrets + running
  `supabase/setup-backup-cron.sql`. Also enable **2FA** on that Google account.

### ⏸️ Parked backlog (pick anytime)
- Guided **Restore** (so backups are testable)
- **2nd backup destination** (Backblaze B2 / Cloudflare R2) → true 3-2-1
- **Reorder suggestions** + days-of-stock + **low-stock LINE alerts**
- **Dead-stock / slow-mover** report
- **Returns / RMA** workflow
- **Scan-to-verify packing** (fewer mis-ships)
- OCR **#2** recognize-existing-product (catalog match) / OCR **#1** offline fallback (Tesseract)
- **WooCommerce integration** (stock sync + order webhook) — _blocked: WordPress site not finished_
- **Marketplace order sync** (Shopee / Lazada / TikTok) — needs seller API access

---

## 2. The build workflow (run this loop for every item)

```
1. PICK     choose the next item from the backlog (by priority — section 3)
2. PLAN     scope it; list which screens change — DESKTOP and MOBILE both
3. BUILD    implement on desktop (screens.jsx / app.jsx / <feature>.jsx)
            AND mobile (handheld.jsx, m-* components)  ← never desktop-only
            shared logic/helpers → data.jsx or supabase.jsx (exposed on window)
4. VERIFY   Babel syntax-check changed files → run/preview → test the real flow
5. DEPLOY   bump the shared ?v= token in the HTML (defeats caches)
            npx vercel deploy --prod --yes --force
            + npx supabase functions deploy <name> ...  (only if an Edge Fn changed)
6. CONFIRM  load it live, verify on desktop + mobile → mark done here → next
```

**Non-negotiables (project rules):**
- **Every change ships to mobile too** (`handheld.jsx`) — see `CLAUDE.md` and the
  desktop+mobile memory. The mobile app is a full fork, not responsive CSS.
- **Adding a new page** = `ALL_NAV` + `CRUMB_MAP` + router (app.jsx) + **`ROLE_NAV`**
  (data.jsx) + desktop component + **mobile screen + `MMore` entry + mobile route**.
  (Forgetting `ROLE_NAV` hides the page for everyone — see `CLAUDE.md`.)
- **Bump the `?v=` cache token** on any asset change.
- **No build step** — global-scope React, no imports; share via `Object.assign(window, …)`.

---

## 3. How to prioritize (pick the next item)

Score each candidate on three axes, then do the highest value-per-effort with no blockers:

| Axis | Ask |
|---|---|
| **Impact** | Does it protect the business (data/accuracy) or save real daily time? |
| **Effort** | S (hours) / M (a day) / L (multi-day) |
| **Dependency** | Does it need something external first (WordPress, API keys, Google setup, a plan upgrade)? |

Rule of thumb: **protect data → improve accuracy → speed up fulfillment → integrate channels → scale.**

---

## 4. Recommended phased plan

### Phase 0 — Stabilize & protect _(now; mostly your action)_
- [ ] Take a **manual backup** today (Settings → ดาวน์โหลดไฟล์สำรอง)
- [ ] **Save secrets in a password manager** (Google Password Manager / Bitwarden): the
      `CRON_SECRET` (LINE + backup cron), the LINE channel token, and future Google/Woo keys.
      _(Do NOT store the actual values here in the repo.)_
- [ ] **Activate nightly Drive backup** (`SETUP-BACKUP.md`) + **2FA** on the Google account
- [ ] (Optional, I build) **Guided Restore** so backups are verifiable — **S/M**

> ✅ **LINE low-stock alert — FIXED (2026-06-06):** the daily cron was active but its
> `x-cron-secret` had drifted from the function's `CRON_SECRET`, so the call 401'd silently.
> Reset the secret + re-scheduled `line-lowstock-daily` → now `200 / sent:true`, fires 08:00 daily.

### Phase 1 — Inventory intelligence _(high ROI, no external deps)_
- [ ] **Reorder suggestions** — days-of-stock-left + suggested qty from real sales velocity — **M**
- [ ] **Low-stock LINE alerts** (reuses your LINE bot) — **S/M**
- [ ] **Dead-stock / slow-mover** report — **S**

### Phase 2 — Fulfillment accuracy
- [ ] **Returns / RMA** (log return → restock/write-off → audit) — **M**
- [ ] **Scan-to-verify packing** (scan item before ship → block mis-ships) — **M**
- [ ] OCR **#2** recognize-existing-product on photo (catalog match) — **S/M**

### Phase 3 — Channel integration _(blocked on WordPress)_
- [ ] **Stock sync IMS → WooCommerce** (Edge Fn + short cron, IMS = master) — **M**
- [ ] **Order webhook WooCommerce → IMS** (ingest web orders → deduct stock) — **M**
- [ ] **Reconciliation cron** (nightly drift check) + oversell guard — **S**
- _Prereq: WooCommerce installed + REST API keys + matching SKUs._

### Phase 4 — Scale & resilience
- [ ] **Marketplace order sync** (Shopee/Lazada/TikTok APIs) — **L**, needs seller API access
- [ ] **2nd backup destination** (Backblaze/R2) for full 3-2-1 — **S**

---

## 5. Dependencies & blockers
- **WooCommerce work** → waits on the WordPress site being finished + API keys.
- **Nightly Drive backup** → waits on your Google Cloud setup + secrets.
- **Marketplace sync** → waits on Shopee/Lazada/TikTok seller/developer API access.
- **Supabase plan** → if on free tier, platform backups are limited → prioritise the Drive backup.

## 6. Risks to keep an eye on
- **Overselling** once channels are connected (sale-to-sync latency) → IMS-as-master + frequent push + stock buffer.
- **SKU drift** — renaming/reusing SKUs breaks every integration. Keep them unique and stable.
- **PDPA** — backups + order data contain customer names/phones/addresses → keep storage private + access-controlled.
- **Two order stores** (see `CLAUDE.md`) — converge on the tracking model rather than bridging.

---

## 7. Foundations already in place (that make the above easier)
- Order model carries **`lineItems` (sku, qty, price snapshot)** → ready to ingest web/marketplace orders.
- **"เว็บไซต์" channel** already exists → maps to WordPress orders.
- **Edge Function pattern** proven (auth'd: extract-slip/product, backup-to-drive; public: track-lookup; cron: line-alert).
- **Supabase Realtime + event bus** (`ims-*-change`) → can drive sync triggers.
- **SKU-centric** flows (scan, stock-take, OCR) → the shared key for every integration.
