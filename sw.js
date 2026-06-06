/* Minimal service worker — enables "Add to Home Screen" / installable PWA.
   Intentionally network pass-through: the app serves live Supabase data and
   versioned assets (?v=...), so we do NOT cache app code to avoid stale bugs. */
const VERSION = "ims-pwa-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // IMPORTANT: only intercept SAME-ORIGIN requests.
  // The worker inherits the page CSP, whose `connect-src` allows only self +
  // Supabase. If we re-fetched cross-origin CDN scripts (React, Babel, fonts)
  // here, CSP would block them and the app would white-screen. Letting those
  // requests fall through means the browser fetches them natively under the
  // page's (more permissive) script-src/font-src rules.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
