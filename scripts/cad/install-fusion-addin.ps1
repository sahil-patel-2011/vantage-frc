# Copy the Vantage Fusion 360 add-in into the Autodesk AddIns folder (Windows).
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-fusion-addin.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-fusion-addin.ps1 -Force
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Src = Join-Path $Root "packages\fusion360-official-connector\VantageCadRelay"

if (-not (Test-Path (Join-Path $Src "VantageCadRelay.py"))) {
  throw "Add-in source missing: $Src"
}
if (-not (Test-Path (Join-Path $Src "VantageCadRelay.manifest"))) {
  throw "Add-in manifest missing under $Src"
}

$AppData = $env:APPDATA
if (-not $AppData) { throw "APPDATA is not set" }

$AddInsRoot = Join-Path $AppData "Autodesk\Autodesk Fusion 360\API\AddIns"
$Dest = Join-Path $AddInsRoot "VantageCadRelay"

$srcVersionPath = Join-Path $Src "VERSION.json"
$srcVersion = "unknown"
if (Test-Path $srcVersionPath) {
  try {
    $srcVersion = (Get-Content $srcVersionPath -Raw | ConvertFrom-Json).version
  } catch {
    $srcVersion = "unknown"
  }
}

$destVersion = $null
$destVersionPath = Join-Path $Dest "VERSION.json"
if (Test-Path $destVersionPath) {
  try {
    $destVersion = (Get-Content $destVersionPath -Raw | ConvertFrom-Json).version
  } catch {
    $destVersion = $null
  }
}

if ((Test-Path $Dest) -and $destVersion -and $srcVersion -eq $destVersion -and -not $Force) {
  Write-Host "VantageCadRelay $srcVersion already installed at:"
  Write-Host "  $Dest"
  Write-Host "Use -Force to reinstall."
  exit 0
}

New-Item -ItemType Directory -Force -Path $AddInsRoot | Out-Null
if (Test-Path $Dest) {
  Remove-Item -Recurse -Force $Dest
}
Copy-Item -Recurse -Force $Src $Dest

# Verify critical files landed
foreach ($name in @("VantageCadRelay.py", "VantageCadRelay.manifest", "VERSION.json")) {
  if (-not (Test-Path (Join-Path $Dest $name))) {
    throw "Install incomplete — missing $name under $Dest"
  }
}

$fusionRunning = Get-Process -Name "Fusion360","Fusion360.exe" -ErrorAction SilentlyContinue
if ($fusionRunning) {
  Write-Warning "Fusion 360 appears to be running. Restart the VantageCadRelay add-in (or Fusion) to load the new files."
}

Write-Host "Installed Fusion add-in v$srcVersion$(if ($destVersion) { " (was $destVersion)" }) to:"
Write-Host "  $Dest"
Write-Host ""
Write-Host "In Fusion 360:"
Write-Host "  1. Utilities → Add-Ins → Scripts and Add-Ins"
Write-Host "  2. Add / select VantageCadRelay"
Write-Host "  3. Run it (loopback http://127.0.0.1:32145)"
Write-Host "  4. vantage-cad start"
Write-Host ""
Write-Host "Optional: set FUSION_RELAY_SIGNING_SECRET to match the Vantage server (process env for Fusion)."
Write-Host "Unsigned script install — see scripts\cad\windows\ for future Authenticode/.msi scaffolding."
