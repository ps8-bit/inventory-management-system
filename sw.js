/* Minimal service worker — enables "Add to Home Screen" / installable PWA.
   Intentionally network pass-through: the app serves live Supabase data and
   versioned assets (?v=...), so we do NOT cache app code to avoid stale bugs.
   v3: actively forces a fresh HTML shell + purges any old caches, so an installed
   PWA can never get stuck on an old build. */
const VERSION = "ims-pwa-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Purge any caches a previous worker version may have created — never serve stale app code.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    await self.clients.claim();
  })());
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

  // Force the HTML shell to come fresh from the network on every navigation, so a
  // new deploy's ?v= asset tokens are picked up immediately (the root cause of a PWA
  // stuck on an old build). Versioned assets (?v=...) keep normal browser caching.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => fetch(event.request))
    );
  }
});
