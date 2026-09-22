# Vantage — FRC programming laptop setup (Windows)
#
# Run in PowerShell:
#   irm https://vantagefrc.vercel.app/team-setup.ps1 | iex
#
# Installs what a new programmer needs, and updates anything already there:
#   VS Code, Git, PathPlanner, WPILib.
#
# What it deliberately does NOT do:
#   - Install a separate Java/JDK. WPILib ships its own and a second JDK on the
#     PATH is the classic reason a build works on one laptop and not the next.
#   - Pretend to install the NI FRC Game Tools (Driver Station). That download
#     is behind an NI account, so the script opens the page instead of failing
#     quietly or claiming success.
#
# Versions are never hardcoded. WPILib and PathPlanner are resolved from their
# official release feeds each run, so this script does not go stale in February.

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Failures = @()

function Write-Step { param([string]$Text) Write-Host "`n== $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "   OK   $Text" -ForegroundColor Green }
function Write-Skip { param([string]$Text) Write-Host "   --   $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Text) Write-Host "   !!   $Text" -ForegroundColor Yellow }
function Write-Fail {
  param([string]$Text)
  Write-Host "   XX   $Text" -ForegroundColor Red
  $script:Failures += $Text
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

# --- winget ------------------------------------------------------------------
# winget both installs and upgrades, so one code path covers "new laptop" and
# "laptop from last season". `upgrade` exits non-zero when nothing is newer,
# which is a success here, not a failure.
function Install-WingetPackage {
  param([string]$Id, [string]$Name)
  try {
    $listed = & winget list --id $Id --exact --accept-source-agreements 2>$null | Out-String
    if ($listed -match [regex]::Escape($Id)) {
      & winget upgrade --id $Id --exact --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
      Write-Ok "$Name is installed and up to date"
    } else {
      & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
      if ($LASTEXITCODE -eq 0) { Write-Ok "$Name installed" }
      else { Write-Fail "$Name did not install (winget exit $LASTEXITCODE)" }
    }
  } catch {
    Write-Fail "$Name failed: $($_.Exception.Message)"
  }
}

function Get-LatestRelease {
  param([string]$Repo)
  $headers = @{ 'User-Agent' = 'vantage-frc-setup'; 'Accept' = 'application/vnd.github+json' }
  Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 60
}

Write-Host "Vantage FRC laptop setup" -ForegroundColor White
Write-Host "Team 6925 - VS Code, Git, WPILib, PathPlanner" -ForegroundColor DarkGray
if (-not (Test-Admin)) {
  Write-Warn "Not running as Administrator. Installers may each ask for permission."
}

# --- VS Code and Git ---------------------------------------------------------
Write-Step "VS Code and Git"
if (Get-Command winget -ErrorAction SilentlyContinue) {
  Install-WingetPackage -Id 'Microsoft.VisualStudioCode' -Name 'VS Code'
  Install-WingetPackage -Id 'Git.Git' -Name 'Git'
} else {
  Write-Fail "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again."
}

# --- PathPlanner -------------------------------------------------------------
# Ships a normal Windows setup .exe, so this one can go end to end unattended.
Write-Step "PathPlanner"
try {
  $pp = Get-LatestRelease -Repo 'mjansen4857/pathplanner'
  $asset = $pp.assets | Where-Object { $_.name -like 'PathPlanner-Windows-*-setup.exe' } | Select-Object -First 1
  if (-not $asset) {
    Write-Fail "No Windows installer in PathPlanner $($pp.tag_name). Download it from https://pathplanner.dev"
  } else {
    $installed = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                               'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
      ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
      Where-Object { $_.DisplayName -like 'PathPlanner*' } | Select-Object -First 1
    $want = $pp.tag_name.TrimStart('v')
    if ($installed -and $installed.DisplayVersion -eq $want) {
      Write-Skip "PathPlanner $want already installed"
    } else {
      $out = Join-Path $env:TEMP $asset.name
      Write-Host "   .. downloading PathPlanner $($pp.tag_name)"
      Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -TimeoutSec 900
      Start-Process -FilePath $out -ArgumentList '/S' -Wait
      Write-Ok "PathPlanner $want installed"
    }
  }
} catch {
  Write-Fail "PathPlanner failed: $($_.Exception.Message)"
}

# --- WPILib ------------------------------------------------------------------
# Ships as a ~2.5 GB ISO with a click-through installer, so this stops at
# launching it rather than claiming an unattended install it cannot do.
Write-Step "WPILib"
try {
  $wpi = Get-LatestRelease -Repo 'wpilibsuite/allwpilib'
  $tag = $wpi.tag_name
  $version = $tag.TrimStart('v')
  $year = $version.Split('.')[0]

  # Prefer the download link in the release notes; fall back to the documented
  # path so a formatting change upstream does not break the script.
  $iso = ([regex]'https://\S+?/installer/\S+?/Win64/WPILib_Windows-\S+?\.iso').Match($wpi.body).Value
  if (-not $iso) {
    $iso = "https://packages.wpilib.workers.dev/installer/$tag/Win64/WPILib_Windows-$version.iso"
  }

  $installRoot = Join-Path $env:PUBLIC "wpilib\$year"
  $marker = Join-Path $installRoot 'vscode'
  if ((Test-Path $marker) -and (Test-Path (Join-Path $installRoot "installUtils"))) {
    Write-Skip "WPILib $year already installed at $installRoot"
    Write-Host "      To move to $version, re-run the installer from $iso" -ForegroundColor DarkGray
  } else {
    $out = Join-Path $env:TEMP "WPILib_Windows-$version.iso"
    if (-not (Test-Path $out)) {
      Write-Warn "WPILib is about 2.5 GB. This takes a while on venue Wi-Fi."
      Invoke-WebRequest -Uri $iso -OutFile $out -TimeoutSec 5400
    } else {
      Write-Skip "Using the copy already in $out"
    }
    $mount = Mount-DiskImage -ImagePath $out -PassThru
    $drive = ($mount | Get-Volume).DriveLetter
    $exe = "${drive}:\WPILibInstaller.exe"
    if (Test-Path $exe) {
      Write-Ok "Mounted. Launching the WPILib installer — choose 'Everything' when it asks."
      Start-Process -FilePath $exe -Wait
      Dismount-DiskImage -ImagePath $out | Out-Null
      Write-Ok "WPILib installer finished"
    } else {
      Dismount-DiskImage -ImagePath $out | Out-Null
      Write-Fail "WPILibInstaller.exe was not on the mounted image"
    }
  }
} catch {
  Write-Fail "WPILib failed: $($_.Exception.Message)"
}

# --- Driver Station ----------------------------------------------------------
Write-Step "FRC Game Tools (Driver Station)"
Write-Warn "NI requires an account, so this cannot be scripted. Opening the download page."
Start-Process 'https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/frc-game-tools.html'

# --- Result ------------------------------------------------------------------
Write-Host ""
if ($script:Failures.Count -eq 0) {
  Write-Host "Done. Everything installed or already current." -ForegroundColor Green
} else {
  Write-Host "Finished with $($script:Failures.Count) problem(s):" -ForegroundColor Yellow
  $script:Failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
  Write-Host "Fix those, then run this again — it skips whatever is already done." -ForegroundColor Yellow
}
Write-Host "Next: open VS Code, press Ctrl+Shift+P, and run 'WPILib: Create a new project'." -ForegroundColor White
