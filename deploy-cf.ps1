###############################################################
#  deploy-cf.ps1  —  Deploy to Cloudflare Pages via Wrangler
#  Usage: .\deploy-cf.ps1
#  First run: will open browser to log in to Cloudflare
###############################################################

$ProjectName = "psstock"                               # Cloudflare Pages project name
$SrcDir      = $PSScriptRoot                           # this folder
$env:CLOUDFLARE_API_TOKEN   = "PASTE_YOUR_TOKEN_HERE"
$env:CLOUDFLARE_ACCOUNT_ID  = "4b8b4d635ffc0a98189d3ee9efc5afad"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  Deploy: Cloudflare Pages" -ForegroundColor Cyan
Write-Host "  Project: $ProjectName" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Step 1 — ensure logged in
Write-Host "[1/3] Checking Cloudflare login..." -ForegroundColor Yellow
$whoami = wrangler whoami 2>&1
if ($whoami -match "not authenticated|You are not") {
    Write-Host "      Not logged in — opening browser for OAuth..." -ForegroundColor Yellow
    wrangler login
} else {
    Write-Host "      Logged in OK" -ForegroundColor Green
}

# Step 2 — deploy
Write-Host ""
Write-Host "[2/3] Deploying to Cloudflare Pages..." -ForegroundColor Yellow
wrangler pages deploy $SrcDir --project-name $ProjectName --commit-dirty=true

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Deploy FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    Write-Host "If project does not exist yet, create it first:" -ForegroundColor Yellow
    Write-Host "  wrangler pages project create $ProjectName" -ForegroundColor White
    exit 1
}

# Step 3 — done
Write-Host ""
Write-Host "[3/3] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Live URL: https://$ProjectName.pages.dev" -ForegroundColor Cyan
Write-Host ""
