/**
 * Local dev server for คลังพร้อมส่ง IMS
 * Run: node server.js
 * Browser  → http://localhost:8080
 * Mobile   → http://192.168.1.17:8080
 */
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".jsx":  "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

http.createServer((req, res) => {
  let pathname = decodeURIComponent(url.parse(req.url).pathname);

  // Root → main HTML file
  if (pathname === "/" || pathname === "") {
    pathname = "/Inventory Management System.html";
  }

  const filePath = path.join(ROOT, pathname);

  // Security: stay inside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found: " + pathname);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type":  mime,
      "Cache-Control": "no-store",       // always serve fresh files
      "Access-Control-Allow-Origin": "*" // allow Supabase calls from localhost
    });
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("┌──────────────────────────────────────────┐");
  console.log("│  คลังพร้อมส่ง — Local Dev Server         │");
  console.log("├──────────────────────────────────────────┤");
  console.log(`│  Browser  →  http://localhost:${PORT}        │`);
  console.log(`│  Mobile   →  http://192.168.1.17:${PORT}     │`);
  console.log("│                                          │");
  console.log("│  Ctrl+C to stop                         │");
  console.log("└──────────────────────────────────────────┘");
});
