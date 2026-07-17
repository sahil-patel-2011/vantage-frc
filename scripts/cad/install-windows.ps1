# One-shot Windows installer: vantage-cad CLI + Fusion 360 VantageCadRelay add-in.
# Fusion is local-only — this never deploys CAD to Vercel.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1 -SkipNpmInstall -ForceAddin
param(
  [switch]$SkipNpmInstall,
  [switch]$ForceAddin,
  [switch]$SkipAddin,
  [switch]$SkipCli
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

Write-Host "========================================"
Write-Host " Vantage CAD relay — Windows install"
Write-Host "========================================"
Write-Host "Repo: $Root"
Write-Host ""

if (-not $SkipCli) {
  $cliArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "install-cli.ps1"))
  if ($SkipNpmInstall) { $cliArgs += "-SkipNpmInstall" }
  Write-Host "==> Step 1/2: Install vantage-cad CLI"
  & powershell @cliArgs
  if ($LASTEXITCODE -ne 0) { throw "CLI install failed with exit $LASTEXITCODE" }
} else {
  Write-Host "==> Skipping CLI install (-SkipCli)"
}

if (-not $SkipAddin) {
  $addinArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "install-fusion-addin.ps1"))
  if ($ForceAddin) { $addinArgs += "-Force" }
  Write-Host ""
  Write-Host "==> Step 2/2: Install Fusion 360 add-in"
  & powershell @addinArgs
  if ($LASTEXITCODE -ne 0) { throw "Fusion add-in install failed with exit $LASTEXITCODE" }
} else {
  Write-Host "==> Skipping Fusion add-in (-SkipAddin)"
}

Write-Host ""
Write-Host "========================================"
Write-Host " Windows install complete"
Write-Host "========================================"
Write-Host '  $env:VANTAGE_URL="https://vantage-frc-web.vercel.app"'
Write-Host "  vantage-cad setup"
Write-Host "  # In Fusion: run VantageCadRelay add-in"
Write-Host "  vantage-cad start"
Write-Host "  vantage-cad diagnose"
Write-Host ""
Write-Host "Update later: vantage-cad update   (or re-run this script)"
Write-Host "Package unsigned tree: npm run cad:package"
