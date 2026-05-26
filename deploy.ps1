###############################################################
#  deploy.ps1  —  Deploy to Vercel (psstock)
#  Usage: .\deploy.ps1   or   Right-click → Run with PowerShell
###############################################################

$LiveURL = "https://psstock.vercel.app"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  Deploy: Vercel (psstock)" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Step 1 — check login
Write-Host "[1/3] Checking Vercel login..." -ForegroundColor Yellow
$whoami = vercel whoami 2>&1
if ($whoami -match "Error|not logged|sign in|No existing") {
    Write-Host "      Not logged in — opening browser..." -ForegroundColor Yellow
    vercel login
} else {
    Write-Host "      Logged in as: $whoami" -ForegroundColor Green
}

# Step 2 — deploy
Write-Host ""
Write-Host "[2/3] Uploading files..." -ForegroundColor Yellow
vercel --prod --yes 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Deploy FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

# Step 3 — done
Write-Host ""
Write-Host "[3/3] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Live URL  -->  $LiveURL" -ForegroundColor Cyan
Write-Host ""
