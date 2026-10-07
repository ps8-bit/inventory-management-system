/* boot.js — runs the app's <script type="text/babel"> files with a COMPILE CACHE.

   Why: Babel-standalone recompiled ~2 MB of JSX on every open (~5.4 s on a fast PC,
   several times that on a phone) and its own 3 MB script had to be parsed first.
   The output only changes when a file's text changes, so this loader:
     1. fetches each .jsx exactly as Babel did (same URL, document order),
     2. hashes its text and looks the compiled code up in IndexedDB,
     3. on a hit, runs the stored code — Babel is never even loaded;
        on a miss, lazy-loads Babel, compiles with Babel-standalone's OWN
        script-tag options (copied from babel 7.29.0's transformScriptTags), stores it, runs it.
   It cannot serve stale code: the key is a hash of the exact source text that was
   just fetched from the server, so an edited file is always a miss. This is NOT the
   "app-code caching" sw.js forbids — that cached the SOURCE and could go stale.

   Behaviour kept identical to Babel's runner: files execute in document order, each as
   an inline <script> appended to <head>, only after DOMContentLoaded; a file that fails
   to load is skipped and the rest still run. Any cache problem (no IndexedDB, private
   mode, quota, a hung open on old Safari) just degrades to "compile like before".

   Plain ES5 on purpose — this file is NOT run through Babel. If babel's version, presets or
   plugins ever change, bump CACHE_SIG so every stored entry is recompiled. */
(function () {
  "use strict";

  var BABEL_URL = "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js";
  var BABEL_SRI = "sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y";
  var CACHE_SIG = "babel-7.29.0|react,env|class-properties,object-rest-spread,flow-strip-types|inline-map|v1";
  var DB_NAME = "ims-jsx-cache", STORE = "compiled";

  var tags = Array.prototype.slice.call(document.querySelectorAll('script[type="text/babel"]'));
  // Retype the tags so Babel's own DOMContentLoaded auto-runner (if Babel gets loaded on a
  // miss before that event fires) finds nothing — every file must execute exactly once.
  // Changing `type` never makes the browser execute an already-parsed script element.
  tags.forEach(function (t) { t.type = "text/x-ims-jsx"; });

  var entries = tags.map(function (t) {
    // Compile under the path WITHOUT the ?v= token, so a token bump on a deploy that left
    // a file untouched keeps that file's cache entry. Only the source map's file label differs.
    // The /u/<ts>/ force-refresh prefix (vercel.json rewrite) is dropped too, or such a load
    // would miss every file and then prune the normal entries.
    var name = t.src.split("?")[0].replace(/\/u\/[^\/]+\//, "/");
    return { url: t.src, name: name, code: null, failed: false };
  });

  function babelOptions(name) {
    return {
      filename: name,
      presets: ["react", "env"],
      plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
      sourceMaps: "inline",
      sourceFileName: name,
      targets: { browsers: undefined }
    };
  }

  /* ── IndexedDB (every failure resolves to "no cache", never rejects) ── */
  function withTimeout(p, ms, fallback) {
    return new Promise(function (res) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(fallback); } }, ms);
      p.then(function (v) { if (!done) { done = true; clearTimeout(t); res(v); } },
             function () { if (!done) { done = true; clearTimeout(t); res(fallback); } });
    });
  }
  var dbP = withTimeout(new Promise(function (res, rej) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: "name" }); };
    req.onsuccess = function () { res(req.result); };
    req.onerror = function () { rej(req.error); };
    req.onblocked = function () { rej(new Error("blocked")); };
  }), 2000, null);

  function idbGet(name) {
    return dbP.then(function (db) {
      if (!db) return null;
      return withTimeout(new Promise(function (res, rej) {
        var req = db.transaction(STORE, "readonly").objectStore(STORE).get(name);
        req.onsuccess = function () { res(req.result || null); };
        req.onerror = function () { rej(req.error); };
      }), 3000, null);
    });
  }
  function idbPut(rec) {
    dbP.then(function (db) {
      if (!db) return;
      try { db.transaction(STORE, "readwrite").objectStore(STORE).put(rec); } catch (e) {}
    });
  }
  // Drop entries for files no longer in the page so the store can't grow forever.
  function idbPrune() {
    var keep = {};
    entries.forEach(function (e) { keep[e.name] = true; });
    dbP.then(function (db) {
      if (!db) return;
      try {
        var store = db.transaction(STORE, "readwrite").objectStore(STORE);
        var req = store.getAllKeys();
        req.onsuccess = function () { (req.result || []).forEach(function (k) { if (!keep[k]) store.delete(k); }); };
      } catch (e) {}
    });
  }

  /* ── content hash: SHA-256 where available (secure contexts), else a 53-bit JS hash
     (the plain-http LAN server has no crypto.subtle) ── */
  function cyrb53(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return "c53:" + str.length + ":" + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function digest(str) {
    try {
      if (window.crypto && crypto.subtle && window.TextEncoder) {
        return crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)).then(function (buf) {
          var b = new Uint8Array(buf), s = "sha256:";
          for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
          return s;
        }, function () { return cyrb53(str); });
      }
    } catch (e) {}
    return Promise.resolve(cyrb53(str));
  }

  /* ── Babel, only when something actually needs compiling ── */
  var babelP = null;
  function loadBabel() {
    if (window.Babel && window.Babel.transform) return Promise.resolve(window.Babel);
    if (!babelP) {
      babelP = new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = BABEL_URL;
        s.integrity = BABEL_SRI;
        s.crossOrigin = "anonymous";
        s.onload = function () {
          try { window.Babel.disableScriptTags(); } catch (e) {}
          res(window.Babel);
        };
        s.onerror = function () { babelP = null; rej(new Error("Could not load Babel from " + BABEL_URL)); };
        document.head.appendChild(s);
      });
    }
    return babelP;
  }

  /* ── run in document order, as soon as each file and DOMContentLoaded are ready ── */
  var domReady = document.readyState !== "loading";
  if (!domReady) document.addEventListener("DOMContentLoaded", function () { domReady = true; pump(); });
  var next = 0, pruned = false;
  function pump() {
    if (!domReady) return;
    while (next < entries.length) {
      var e = entries[next];
      if (!e.failed && e.code == null) return;
      next++;
      if (e.failed) continue;
      var s = document.createElement("script");
      s.text = e.code;
      e.code = "";                       // release the string; the script element holds it now
      document.head.appendChild(s);
    }
    if (!pruned) {
      pruned = true;
      // Startup timing for diagnostics: performance.getEntriesByName("ims-boot-done")[0].startTime
      try { performance.mark("ims-boot-done"); } catch (err) {}
      idbPrune();
    }
  }
  function fail(e, err) {
    e.failed = true;
    // Surface it as an uncaught error, like Babel's runner did, without stopping later files.
    setTimeout(function () { throw err; }, 0);
  }

  entries.forEach(function (e) {
    fetch(e.url, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("Could not load " + e.url);
        return r.text();
      })
      .then(function (src) {
        return Promise.all([digest(CACHE_SIG + "\n" + src), idbGet(e.name)]).then(function (r) {
          var hash = r[0], rec = r[1];
          if (rec && rec.hash === hash && typeof rec.code === "string") return rec.code;
          return loadBabel().then(function (Babel) {
            var code = Babel.transform(src, babelOptions(e.name)).code;
            idbPut({ name: e.name, hash: hash, code: code, at: Date.now() });
            return code;
          });
        });
      })
      .then(function (code) { e.code = code; }, function (err) { fail(e, err); })
      .then(pump);
  });
})();
