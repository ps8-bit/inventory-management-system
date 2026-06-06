# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Thai-language **Inventory / Warehouse Management System** ("คลังพร้อมส่ง", brand **PS TACTICAL**) for an e-commerce fulfillment operation: inbound receiving, outbound/sell, stock, locations, label printing, parcel tracking, analytics, bundles, user roles. It's a **no-build single-page app** served as a static site on Vercel (live: `https://psstock.vercel.app`, Supabase project ref `eayufrfkmpeeeuaimvqw`) and installable as a PWA. UI text is Thai.

## No build step — read this first

There is **no bundler, no `package.json`, no tests, no TypeScript** in the frontend. Every `.jsx` file is loaded as `<script type="text/babel">` and transpiled **in the browser** by Babel-standalone, running React 18 (UMD) in **global scope**.

Consequences for any change:
- **Do NOT add `import`/`export`.** Cross-file sharing is done by declaring top-level functions/consts and exposing them via `Object.assign(window, { name })` at the end of a file. Consumers call them **defensively**: `if (typeof helper === "function") helper(...)`.
- **Script load order is fixed and significant** (in `Inventory Management System.html`): `tweaks-panel → data → supabase → icons → product-images → screens → dashboard → labels → settings → audit → tracking → analytics → handheld → import → bundles → auth → app`. A file can only reference globals from files loaded **before** it at top level; later-loaded helpers must be called through `typeof` guards. `data.jsx` loads early and is the natural home for low-level shared utilities.
- **React hooks are aliased per file** to avoid global collisions: e.g. `const { useState: useStateApp, useEffect: useEffectApp } = React;` (each file uses its own suffix — `useStateApp`, `useStateDash`, …). Follow the local suffix when editing a file.
- Adding a new CDN `<script>` requires updating the CSP `script-src` in `vercel.json` (it whitelists exact hosts).

## Commands

This is a Windows/PowerShell environment. The main HTML filename contains spaces (`Inventory Management System.html`); `/` rewrites to it (see `vercel.json`, `server.js`, `serve.ps1`).

```powershell
# Local dev server (preferred; configured in .claude/launch.json) → http://localhost:8080
node server.js

# LAN server for team / phones on the same Wi-Fi → http://<lan-ip>:5500
powershell -ExecutionPolicy Bypass -File serve.ps1

# Deploy to production (Vercel prod + redeploys ALL Supabase Edge Functions, checks vercel login)
./deploy.ps1
# Frontend-only prod deploy (faster; use when no Edge Function changed)
npx vercel deploy --prod --yes --force

# Deploy a single Supabase Edge Function (Deno/TS)
npx supabase functions deploy <name> --project-ref eayufrfkmpeeeuaimvqw
# track-lookup and store-info are PUBLIC (no auth) → add --no-verify-jwt
```

There are no lint/test/build commands. Verify changes by running `node server.js` and exercising the app in a browser (auth is real Supabase — there is no login bypass/seed).

### Cache-bust token — bump on every deploy that changes an asset

Every CSS/JSX `<link>`/`<script>` in `Inventory Management System.html` carries a shared `?v=YYYYMMDDx` query (a moving value — read the HTML for the current one, e.g. `20260606l`). **When you change any `.jsx` or `styles.css`, bump that token** (it's one shared value — replace-all it in the HTML). This is the project's enforced convention to defeat browser/CDN/PWA caching of the changed file. (`vercel.json` also sets `Cache-Control: no-store`, but bump the token regardless.)

### PWA / service worker — do NOT add app-code caching

The app is an installable PWA (`manifest.webmanifest` + PWA icons + `sw.js`, registered at the end of the HTML). `sw.js` is **intentionally a network pass-through** that caches nothing and only intercepts same-origin requests — keep it that way: caching app code would resurrect the exact stale-bug class the `?v=` token exists to kill, and re-fetching cross-origin CDN scripts (React/Babel/fonts) inside the worker would hit the page CSP `connect-src` and white-screen the app. If you do change `sw.js`, bump its `VERSION` constant.

## Architecture

**Frontend (global-scope React, in load order):**
- `data.jsx` — the in-memory `PRODUCTS` array (mutated **in place**, never reassigned, so existing `.find()`/`.map()` references stay valid) + localStorage cache + Supabase sync. Hosts the custom-event bus: `ims-products-change`, `ims-orders-change`, `ims-labels-change`, `ims-toast`, `ims-sell-order`. Screens re-render by listening to these events.
- `supabase.jsx` — the `sb` client (URL + anon key inline) and all DB CRUD. **RLS-aware**: writes/deletes use `.select()` and compare returned row count to detect silently-blocked operations (0 rows + no error = permission denied) and surface a toast. Order row mapping lives in `_orderToRow`/`_rowToOrder` — **do not change these or the `orders` schema**; the public customer Edge Function depends on them.
- `app.jsx` — `AuthGate`, desktop shell (sidebar from `ALL_NAV`, topbar, nav-id routing, global search overlay, live sidebar badge counts via `computeBadges`/`useBadges`), tweaks + layout customization.
- `screens.jsx` — large file; desktop feature screens (Inbound, Outbound, Inventory, Locations, `SellProductModal`, the shared `CameraScanner`, bulk-action bars).
- `handheld.jsx` — the **entire mobile app** (`.m-app` + `m-*` components: MHome, MInbound, MSell, MIssue, MTracking, bottom tab bar). Desktop vs mobile is a **full component fork**, not just responsive CSS.
- Feature files: `tracking.jsx`, `labels.jsx`, `analytics.jsx`, `bundles.jsx`, `import.jsx`, `settings.jsx`, `audit.jsx`, `dashboard.jsx`, `auth.jsx`. Plus `icons.jsx` (SVG icon set on `Icons`), `product-images.jsx`, `tweaks-panel.jsx` (dev-only tweak-panel shell/protocol).

**Backend:** Supabase Postgres + Auth + Edge Functions in `supabase/functions/*/index.ts` (Deno/TypeScript): `extract-slip` (AI OCR of shipping slips) and `extract-product` (Gemini product-name OCR — both CORS-allowlist + JWT/write-role gated), `parse-recipient` (AI address split), `track-lookup` + `store-info` (PUBLIC customer tracking, deployed `--no-verify-jwt`), `manage-users`/`create-user` (admin), `line-bot`/`line-alert` (LINE), `backup-to-drive` (nightly full-data JSON snapshot to the owner's Google Drive via an OAuth refresh token, run on a cron). Schema + RLS live in `supabase/*.sql` plus root `supabase-schema.sql`/`migration-*.sql`; pg_cron schedules are in `supabase/setup-backup-cron.sql` and `supabase/setup-line-cron.sql`.

**Styling:** `styles.css` is token-driven (CSS custom properties on `:root`). It contains several appended refresh blocks and **the last `:root`/block wins** — the active theme (clean white background, orange×black PS TACTICAL brand, layered elevation/depth) lives in the trailing appended blocks. Drive UI from tokens (`--accent`, `--surface`, `--fg`, `--*-soft`, `--elev-1/2`, `--brand-grad`) so a change flows to both desktop and mobile at once. Mobile is engaged via device detection setting `html[data-mobile="1"]` + `.mobile-fullscreen`; **every UI change must be verified on both desktop and the mobile (`m-*`) view.**

## Two structural gotchas (verify against current code)

1. **There are two parallel order stores** answering "what orders exist?", both upserting the same Supabase `orders` table and both firing/listening on `ims-orders-change`:
   - *Tracking model* — `useOrders`/`buildOrders` in `tracking.jsx` (treats labels as shipments; single writer `setOrderField`). Feeds desktop Tracking, mobile MTracking, and the public `track-lookup` function.
   - *Outbound model* — `loadOrders`/`saveOrders` in `data.jsx` over `ims_orders` + `window._DB_ORDERS`; drives **all sidebar badge counts**. Sales enter via `window.__pendingSellOrders` + `ims-sell-order`.
   A sale only reaches Tracking if a **label** is created for it. For order/shipment work, prefer converging onto the Tracking model rather than bridging the two (a naive "write to both" amplifies duplicate-row and event-loop risk).

2. **Product barcode/SKU scans resolve in exactly two places**: desktop `Inbound.submitScan` (`screens.jsx`) and mobile `MInbound.submit` (`handheld.jsx`); both route camera (`CameraScanner`) and keyboard-wedge input through one funnel. Other "scan"-labelled UIs (`SlipScanModal` OCR, the labels "คัดแยก" parser, `SellProductModal` search) are **not** barcode scanners — don't treat them as scan funnels.

## Adding a new top-level page/screen (do ALL of these, or it silently won't show)

A desktop nav page needs **four** edits, and the mobile fork is **separate**:
1. `app.jsx` — add to `ALL_NAV` (id/label/icon/group), add `CRUMB_MAP[id]`, and add the router line `{page === "id" && <Comp .../>}`.
2. **`data.jsx` `ROLE_NAV`** — add the id to every role that should see it (admin/manager/staff/viewer). **This is the easy-to-miss one:** the sidebar is `navItems.filter(visible).map(ALL_NAV).filter(n => ROLE_NAV[role].has(n.id))` — a page absent from `ROLE_NAV` is hidden for everyone, even admin, with no error. (`ims_nav_layout` auto-merges new `ALL_NAV` ids, so that's not the blocker — `ROLE_NAV` is.)
3. `screens.jsx` — define the desktop component and add it to the `Object.assign(window, {...})` export.
4. **Mobile is a separate screen in `handheld.jsx`**: define `M<Name>`, add the router line in the view switch (`if (route.view === "id") return <M... ctx={ctx}/>`), and add an entry to the `MMore` items array (mobile menu is a static list, NOT role-gated by `ROLE_NAV`).

Shared low-level helpers go in `data.jsx` (loads first) and are exposed via `Object.assign(window, {...})`; the stock-take feature's `loadStockTake`/`saveStockTake`/`applyStockCounts` follow this pattern.
