#Requires -RunAsAdministrator
<#
.SYNOPSIS
    00 — Prerequisite checks. No installs. Verifies Windows version, admin rights, winget,
    and prints the BIOS reminder (cannot be automated).
#>
param([switch]$WhatIf)

$ErrorActionPreference = "Stop"

Write-Host "Checking Windows version..."
$os = Get-CimInstance Win32_OperatingSystem
Write-Host "  $($os.Caption) build $($os.BuildNumber)"
if ([int]$os.BuildNumber -lt 22000) {
    Write-Warning "This blueprint targets Windows 11. Build $($os.BuildNumber) looks like Windows 10 or older — some steps (WSL2 systemd, ConPTY features psmux relies on) may not work as documented."
}

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

Write-Host "`n--- BIOS reminder (cannot be automated) ---" -ForegroundColor Yellow
Write-Host @"
Blueprint §3, step 1: set iGPU/UMA graphics memory allocation in BIOS to Custom with a fixed
value (never Auto — Auto causes ROCm to misreport pool size on this chip). Current scope keeps
local inference dGPU-only (RTX 5060 Ti), so leave the BIOS UMA setting at its conservative
default for now — you only need to raise this, deliberately, if you later engage the deferred
cross-vendor iGPU+eGPU pooling. Nothing in this package touches BIOS settings.
"@

Write-Host "`nPrereqs check complete." -ForegroundColor Green
