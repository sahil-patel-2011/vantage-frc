# Vantage — FRC programming laptop setup (Windows)
#
# Run in PowerShell:
#   irm https://vantagefrc.vercel.app/team-setup.ps1 | iex
#
# Installs what a new programmer needs, and updates anything already there:
#   VS Code, Git, GitHub CLI (gh), GitHub Desktop,
#   WPILib (which brings AdvantageScope, Elastic, Glass and its own JDK),
#   PathPlanner, Choreo, REV Hardware Client 2, CTRE Phoenix Tuner X.
# It then offers to sign in to GitHub so `git push` and `gh` work straight away.
#
# What it deliberately does NOT do:
#   - Install a separate Java/JDK. WPILib ships its own and a second JDK on the
#     PATH is the classic reason a build works on one laptop and not the next.
#   - Install AdvantageScope or Elastic on their own. The WPILib installer ships
#     the versions matched to this season; a second copy just drifts.
#   - Pretend to install the NI FRC Game Tools (Driver Station). That download
#     is behind an NI account, so the script opens the page instead of failing
#     quietly or claiming success.
#
# Versions are never hardcoded. WPILib, PathPlanner and Choreo are resolved from
# their official release feeds each run, so this script does not go stale in February.

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Failures = @()
$script:IsArm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'

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

# A fresh install puts git and gh on the machine PATH, but this session still
# holds the PATH it started with.
function Update-SessionPath {
  $env:Path = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [Environment]::GetEnvironmentVariable('Path', 'User')
  ) -join ';'
}

# --- winget ------------------------------------------------------------------
# winget both installs and upgrades, so one code path covers "new laptop" and
# "laptop from last season". These exit codes mean "nothing to do", which is a
# success here, not a failure:
#   -1978335189  0x8A15002B  no applicable upgrade
#   -1978335135  0x8A150061  already installed
$script:WingetNothingToDo = @(0, -1978335189, -1978335135)

function Install-WingetPackage {
  param([string]$Id, [string]$Name, [string]$Source = 'winget')
  # Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  try {
    $listed = & winget list --id $Id --exact --source $Source --accept-source-agreements 2>$null | Out-String
    if ($listed -match [regex]::Escape($Id)) {
      & winget upgrade --id $Id --exact --source $Source --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
      Write-Ok "$Name is installed and up to date"
      return
    }
    & winget install --id $Id --exact --source $Source --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
    if ($script:WingetNothingToDo -contains $LASTEXITCODE) { Write-Ok "$Name installed" }
    else { Write-Fail "$Name did not install (winget exit $LASTEXITCODE)" }
  } catch {
    Write-Fail "$Name failed: $($_.Exception.Message)"
  }
}

function Get-LatestRelease {
  param([string]$Repo)
  $headers = @{ 'User-Agent' = 'vantage-frc-setup'; 'Accept' = 'application/vnd.github+json' }
  Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 60
}

function Get-InstalledApp {
  param([string]$DisplayNameLike)
  Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
                'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
    Where-Object { $_.PSObject.Properties['DisplayName'] -and $_.DisplayName -like $DisplayNameLike } |
    Select-Object -First 1
}

# For tools that ship a silent-capable Windows setup .exe on GitHub Releases
# rather than a winget package.
function Install-GitHubReleaseApp {
  param([string]$Repo, [string]$Name, [string]$AssetLike, [string]$DisplayNameLike)
  try {
    $release = Get-LatestRelease -Repo $Repo
    $asset = $release.assets | Where-Object { $_.name -like $AssetLike } | Select-Object -First 1
    if (-not $asset) {
      Write-Fail "No Windows installer in $Name $($release.tag_name). Download it from https://github.com/$Repo/releases"
      return
    }
    $want = $release.tag_name.TrimStart('v')
    $installed = Get-InstalledApp -DisplayNameLike $DisplayNameLike
    if ($installed -and $installed.PSObject.Properties['DisplayVersion'] -and $installed.DisplayVersion -eq $want) {
      Write-Skip "$Name $want already installed"
      return
    }
    $out = Join-Path $env:TEMP $asset.name
    Write-Host "   .. downloading $Name $($release.tag_name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -TimeoutSec 900
    Start-Process -FilePath $out -ArgumentList '/S' -Wait
    Write-Ok "$Name $want installed"
  } catch {
    Write-Fail "$Name failed: $($_.Exception.Message)"
  }
}

Write-Host "Vantage FRC laptop setup" -ForegroundColor White
Write-Host "Team 6925 - VS Code, Git, GitHub, WPILib, PathPlanner, Choreo, REV and CTRE tools" -ForegroundColor DarkGray
if (-not (Test-Admin)) {
  Write-Warn "Not running as Administrator. Installers may each ask for permission."
}

$hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
if (-not $hasWinget) {
  Write-Fail "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again."
}

# --- Editor, Git and GitHub --------------------------------------------------
Write-Step "VS Code, Git, GitHub CLI and GitHub Desktop"
if ($hasWinget) {
  Install-WingetPackage -Id 'Microsoft.VisualStudioCode' -Name 'VS Code'
  Install-WingetPackage -Id 'Git.Git' -Name 'Git'
  Install-WingetPackage -Id 'GitHub.cli' -Name 'GitHub CLI (gh)'
  Install-WingetPackage -Id 'GitHub.GitHubDesktop' -Name 'GitHub Desktop'
  Update-SessionPath
}

# --- GitHub sign-in ----------------------------------------------------------
# `gh auth login` also registers gh as Git's credential helper, so the first
# `git push` from the terminal or VS Code does not stop to ask for a password.
Write-Step "Sign in to GitHub"
# `gh auth status` reports "signed out" on stderr; see Install-WingetPackage.
$ErrorActionPreference = 'Continue'
if (Get-Command gh -ErrorAction SilentlyContinue) {
  & gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Skip "Already signed in to GitHub in the terminal"
  } else {
    $answer = Read-Host "   Sign in to GitHub now? A browser window will open. [Y/n]"
    if ($answer -notmatch '^(n|no)$') {
      & gh auth login --hostname github.com --git-protocol https --web
      if ($LASTEXITCODE -eq 0) {
        & gh auth setup-git 2>&1 | Out-Null
        Write-Ok "Signed in. git and gh now use your GitHub account"
      } else {
        Write-Fail "GitHub sign-in did not finish. Run 'gh auth login' later"
      }
    } else {
      Write-Skip "Skipped. Run 'gh auth login' when you are ready"
    }
  }
} elseif ($hasWinget) {
  Write-Fail "gh is not on PATH yet. Open a new PowerShell window and run 'gh auth login'"
}
$ErrorActionPreference = 'Stop'

# --- Paths: PathPlanner and Choreo -------------------------------------------
Write-Step "PathPlanner and Choreo"
Install-GitHubReleaseApp -Repo 'mjansen4857/pathplanner' -Name 'PathPlanner' `
  -AssetLike 'PathPlanner-Windows-*-setup.exe' -DisplayNameLike 'PathPlanner*'
$choreoArch = if ($script:IsArm) { 'aarch64' } else { 'x86_64' }
Install-GitHubReleaseApp -Repo 'SleipnirGroup/Choreo' -Name 'Choreo' `
  -AssetLike "Choreo-*-Windows-$choreoArch-setup.exe" -DisplayNameLike 'Choreo*'

# --- Motor controller tools --------------------------------------------------
# Phoenix Tuner X is only published through the Microsoft Store; winget can
# install from the Store by its product id.
Write-Step "REV Hardware Client and Phoenix Tuner X"
if ($hasWinget) {
  Install-WingetPackage -Id 'REVRobotics.REVHardwareClient2' -Name 'REV Hardware Client 2'
  Install-WingetPackage -Id '9NVV4PWDW27Z' -Name 'Phoenix Tuner X' -Source 'msstore'
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

$desktop = Join-Path $env:LOCALAPPDATA 'GitHubDesktop\GitHubDesktop.exe'
if (Test-Path $desktop) {
  Write-Host "Opening GitHub Desktop — sign in with the same GitHub account." -ForegroundColor White
  Start-Process -FilePath $desktop
}
Write-Host "Next: open VS Code, press Ctrl+Shift+P, and run 'WPILib: Create a new project'." -ForegroundColor White
Write-Host "Check the terminal side with: git --version; gh auth status" -ForegroundColor White
