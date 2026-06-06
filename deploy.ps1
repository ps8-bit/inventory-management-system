###############################################################
#  deploy.ps1  -  Deploy to Vercel (psstock) + Supabase functions
#  Usage: .\deploy.ps1   or   Right-click -> Run with PowerShell
###############################################################

# Always run from the folder this script lives in (so Vercel deploys the
# project, not whatever directory the terminal happens to be in).
$ProjectDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($ProjectDir)) { $ProjectDir = "D:\Inventory Management System" }
Set-Location -Path $ProjectDir

$LiveURL      = "https://psstock.vercel.app"
$SupabaseRef  = "eayufrfkmpeeeuaimvqw"

Write-Host "  Project folder: $ProjectDir" -ForegroundColor DarkGray

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  Deploy: Vercel + Supabase Functions" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# Step 1 - check Vercel login
Write-Host "[1/4] Checking Vercel login..." -ForegroundColor Yellow
$whoami = npx vercel whoami 2>&1
if ($whoami -match "Error|not logged|sign in|No existing") {
    Write-Host "      Not logged in - opening browser..." -ForegroundColor Yellow
    npx vercel login
} else {
    Write-Host "      Logged in as: $whoami" -ForegroundColor Green
}

# Step 2 - deploy Supabase Edge Functions
Write-Host ""
Write-Host "[2/4] Deploying Supabase Edge Functions..." -ForegroundColor Yellow
npx supabase functions deploy extract-slip --project-ref $SupabaseRef
if ($LASTEXITCODE -ne 0) { Write-Host "      Warning: extract-slip deploy failed" -ForegroundColor Yellow } else { Write-Host "      extract-slip deployed OK" -ForegroundColor Green }
# track-lookup is PUBLIC (customers, no login) -> --no-verify-jwt
npx supabase functions deploy track-lookup --no-verify-jwt --project-ref $SupabaseRef
if ($LASTEXITCODE -ne 0) { Write-Host "      Warning: track-lookup deploy failed" -ForegroundColor Yellow } else { Write-Host "      track-lookup deployed OK" -ForegroundColor Green }
# parse-recipient (label editor AI split) - needs login, keep default verify_jwt
npx supabase functions deploy parse-recipient --project-ref $SupabaseRef
if ($LASTEXITCODE -ne 0) { Write-Host "      Warning: parse-recipient deploy failed" -ForegroundColor Yellow } else { Write-Host "      parse-recipient deployed OK" -ForegroundColor Green }
# store-info is PUBLIC (customer tracking page branding, no login) -> --no-verify-jwt
npx supabase functions deploy store-info --no-verify-jwt --project-ref $SupabaseRef
if ($LASTEXITCODE -ne 0) { Write-Host "      Warning: store-info deploy failed" -ForegroundColor Yellow } else { Write-Host "      store-info deployed OK" -ForegroundColor Green }
# manage-users - admin user management (invite/role/suspend/delete), verifies admin inside -> keep default verify_jwt
npx supabase functions deploy manage-users --project-ref $SupabaseRef
if ($LASTEXITCODE -ne 0) { Write-Host "      Warning: manage-users deploy failed" -ForegroundColor Yellow } else { Write-Host "      manage-users deployed OK" -ForegroundColor Green }

# Step 3 - deploy frontend to Vercel
Write-Host ""
Write-Host "[3/4] Uploading files to Vercel..." -ForegroundColor Yellow
npx vercel deploy "$ProjectDir" --prod --yes --force

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Deploy FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

# Step 4 - done
Write-Host ""
Write-Host "[4/4] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Live URL  -->  $LiveURL" -ForegroundColor Cyan
Write-Host ""
Read-Host "กด Enter เพื่อปิด"
