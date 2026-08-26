<#
.SYNOPSIS
    00 - Prerequisite checks. No installs. Verifies Windows version, winget,
    filesystem, architecture, and package-manager prerequisites without requiring elevation.
#>
param([switch]$WhatIf)

$ErrorActionPreference = "Stop"

Write-Host "Checking Windows version..."
$os = [Environment]::OSVersion.Version
Write-Host "  Windows build $($os.Build)"
if ($os.Build -lt 22000) {
    Write-Warning "This blueprint targets Windows 11. Build $($os.Build) looks older; some steps may not work as documented."
}

$architecture=[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if($architecture -ne "X64"){throw "Windows x64 is required; observed $architecture."}
Write-Host "  Architecture OK: $architecture"
$systemRoot=[IO.Path]::GetPathRoot($env:USERPROFILE)
$drive=[IO.DriveInfo]::new($systemRoot)
if($drive.DriveFormat -ne "NTFS"){throw "NTFS is required for the managed user profile; observed $($drive.DriveFormat)."}
Write-Host "  Filesystem OK: NTFS"

Write-Host "Checking for winget..."
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget not found. Install 'App Installer' from the Microsoft Store first, then re-run."
}
Write-Host "  winget OK: $(winget --version)"

Write-Host "Checking for git..."
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would install git via winget"
    } else {
        winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    }
} else {
    Write-Host "  git OK: $(git --version)"
}

Write-Host "`nPrereqs check complete." -ForegroundColor Green
