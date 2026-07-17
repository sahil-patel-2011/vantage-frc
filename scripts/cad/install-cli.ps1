# Install Vantage CAD CLI from a local monorepo checkout (Windows PowerShell).
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-cli.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-cli.ps1 -SkipNpmInstall
param(
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found on PATH: $Name. Install Node.js 22+ and reopen PowerShell."
  }
}

Assert-Command "node"
Assert-Command "npm"

$nodeVersion = (& node -v).Trim()
Write-Host "==> Node $nodeVersion"
if ($nodeVersion -notmatch '^v(2[2-9]|[3-9]\d)\.') {
  Write-Warning "Node.js 22+ is recommended (engines.node >=22). Continuing anyway."
}

if (-not $SkipNpmInstall) {
  Write-Host "==> Installing workspace dependencies"
  npm install
}

Write-Host "==> Building @vantage/cad-cli"
npm run build --workspace=@vantage/cad-cli
if ($LASTEXITCODE -ne 0) { throw "CLI build failed" }

$cliPkg = Join-Path $Root "packages\vantage-cad-cli"
$cliDist = Join-Path $cliPkg "dist\cli.js"
if (-not (Test-Path $cliDist)) {
  throw "Expected build output missing: $cliDist"
}

Write-Host "==> Linking vantage-cad globally from local package"
npm install -g $cliPkg
if ($LASTEXITCODE -ne 0) { throw "Global npm install of vantage-cad failed" }

$vantageCad = Get-Command "vantage-cad" -ErrorAction SilentlyContinue
if (-not $vantageCad) {
  Write-Warning "vantage-cad is not on PATH yet. Close/reopen the terminal, or ensure npm's global bin folder is on PATH."
  Write-Host "  Typical npm global bin: $(npm prefix -g)\bin  (or %APPDATA%\npm)"
} else {
  Write-Host "==> Verified: $($vantageCad.Source)"
}

Write-Host ""
Write-Host "Installed. Next steps:"
Write-Host '  $env:VANTAGE_URL="https://vantage-frc-web.vercel.app"  # or http://localhost:3001'
Write-Host "  vantage-cad setup"
Write-Host "  vantage-cad diagnose"
Write-Host ""
Write-Host "One-shot Windows path (CLI + Fusion add-in):"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1"
Write-Host "Fusion add-in only:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-fusion-addin.ps1"
