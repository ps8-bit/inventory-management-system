# IMS LAN server — serves the app to everyone on the same Wi-Fi / office network
# Usage:  Right-click → "Run with PowerShell"   (must be Run as Administrator for LAN access)
#   or:   powershell -ExecutionPolicy Bypass -File serve.ps1
# Press Ctrl+C to stop

param([int]$Port = 5500)

$root = $PSScriptRoot

# Get the primary LAN IP (first non-loopback IPv4)
$lanIP = (Get-NetIPAddress -AddressFamily IPv4 |
          Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
          Sort-Object InterfaceMetric |
          Select-Object -First 1).IPAddress

if (-not $lanIP) { $lanIP = "localhost" }

# Listen on ALL interfaces so LAN devices can reach it
$prefix = "http://+:$Port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".htm"  = "text/html; charset=utf-8"
  ".jsx"  = "application/javascript; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".webp" = "image/webp"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
  ".toml" = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  ERROR: Could not bind to port $Port on all interfaces." -ForegroundColor Red
  Write-Host "  Try running this script as Administrator (right-click → Run as Administrator)." -ForegroundColor Yellow
  Write-Host "  Or run this once in an admin PowerShell to allow the port without admin:" -ForegroundColor Yellow
  Write-Host "    netsh http add urlacl url=http://+:$Port/ user=Everyone" -ForegroundColor Cyan
  Write-Host ""
  pause
  exit 1
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   IMS — คลังพร้อมส่ง  (LAN Server)                     ║" -ForegroundColor Cyan
Write-Host "  ╠══════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "  ║                                                          ║" -ForegroundColor Cyan
Write-Host "  ║  This computer :  http://localhost:$Port                   ║" -ForegroundColor Cyan
Write-Host "  ║  LAN / Wi-Fi   :  http://${lanIP}:$Port               ║" -ForegroundColor Green
Write-Host "  ║                                                          ║" -ForegroundColor Cyan
Write-Host "  ║  Share the LAN address with your team.                  ║" -ForegroundColor Cyan
Write-Host "  ║  Works on phones & tablets on the same Wi-Fi too.       ║" -ForegroundColor Cyan
Write-Host "  ║                                                          ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    # Build file path from URL
    $urlPath = $req.Url.LocalPath
    if ($urlPath -eq "/" -or $urlPath -eq "") { $urlPath = "/Inventory Management System.html" }
    $filePath = Join-Path $root ($urlPath.TrimStart("/").Replace("/", "\"))

    if (Test-Path $filePath -PathType Leaf) {
      $ext   = [System.IO.Path]::GetExtension($filePath).ToLower()
      $ct    = if ($mime[$ext]) { $mime[$ext] } else { "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)

      $res.StatusCode        = 200
      $res.ContentType       = $ct
      $res.ContentLength64   = $bytes.Length
      $res.Headers.Add("Cache-Control", "no-cache, no-store, must-revalidate")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $msg   = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
      $res.StatusCode      = 404
      $res.ContentType     = "text/plain"
      $res.ContentLength64 = $msg.Length
      $res.OutputStream.Write($msg, 0, $msg.Length)
      Write-Host "  404  $urlPath" -ForegroundColor DarkGray
    }

    $res.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  Write-Host "Server stopped." -ForegroundColor Yellow
}
