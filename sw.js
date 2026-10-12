/* Minimal service worker — enables "Add to Home Screen" / installable PWA.
   Intentionally network pass-through: the app serves live Supabase data and
   versioned assets (?v=...), so we do NOT cache app code to avoid stale bugs.
   v3: actively forces a fresh HTML shell + purges any old caches, so an installed
   PWA can never get stuck on an old build. */
const VERSION = "ims-pwa-v5";

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

// v5: Web Push for order alerts (supabase/functions/order-push). Each push is
// shown in the notification tray AND its alert record (before/after per line
// and field) is kept in IndexedDB, so the app shows the full review the next
// time it opens — even if nobody tapped the notification. Nothing here caches
// app code; the fetch handler above is unchanged.
const INBOX_DB = "ims-push";
function inboxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("inbox", { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function inboxAdd(alert) {
  const db = await inboxDb();
  await new Promise((resolve) => {
    const tx = db.transaction("inbox", "readwrite");
    tx.objectStore("inbox").add({ alert, at: Date.now() });
    tx.oncomplete = tx.onerror = () => resolve();
  });
  db.close();
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { d = { title: "คลังพร้อมส่ง", body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    if (d.alert && d.alert.id && d.alert.id !== "TEST") {
      try { await inboxAdd(d.alert); } catch (e) {}
      // An open app picks it up right away.
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      list.forEach((c) => c.postMessage({ type: "ims-push-inbox" }));
    }
    await self.registration.showNotification(d.title || "ออร์เดอร์ต้องตรวจสอบ", {
      body: d.body || "",
      tag: d.tag || "ims-order",
      renotify: true,
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      data: { url: d.url || "/", orderId: d.alert && d.alert.id },
    });
  })());
});

// Tapping a notification brings the open app to the front (and tells it which
// order), or opens it if it was closed — the app then reads the inbox.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) {
        c.postMessage({ type: "ims-push-open", orderId: data.orderId || null });
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow((data.url || "/") + (data.orderId ? "?oa=" + encodeURIComponent(data.orderId) : ""));
  })());
});
