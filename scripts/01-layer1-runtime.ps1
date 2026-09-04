<#
.SYNOPSIS
    01 - Layer 1: native, verifiable, project-isolated foundation.
.DESCRIPTION
    Installs mise, uv, pnpm, and an integrity-pinned LavaMoat allow-scripts CLI; pins Python 3.14,
    Node 24 LTS, Go 1.26, and Rust 1.98.0; adds mise shims to persistent PATH; and keeps guardrails
    limited to interactive commands. Scripts and automation continue to call the real executables.
    Runs in user scope.
.PARAMETER WhatIf
    Shows planned changes without installing packages or changing PATH/profiles.
#>
param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "BackupPolicy.ps1")

$toolVersions = [ordered]@{
    python = "3.14"
    node   = "24"
    go     = "1.26"
    rust   = "1.98.0"
}
$allowScriptsPackage = "@lavamoat/allow-scripts"
$allowScriptsVersion = "5.1.0"
$allowScriptsIntegrity = "sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w=="

function Install-WingetPackageIfMissing {
    param([string]$WingetId, [string]$FriendlyName)

    $installed = winget list --id $WingetId -e --accept-source-agreements 2>$null |
        Select-String -SimpleMatch $WingetId
    if ($installed) {
        Write-Host "  $FriendlyName is already registered with WinGet."
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would install $FriendlyName with WinGet ($WingetId)"
        return
    }

    winget install --id $WingetId -e --source winget `
        --accept-package-agreements --accept-source-agreements
}

function Add-UserPathEntry {
    param([string]$PathEntry, [switch]$Prepend)

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($userPath -split ";" | Where-Object { $_ })
    $alreadyPresent = @($entries | Where-Object { $_.TrimEnd('\') -ieq $PathEntry.TrimEnd('\') }).Count -gt 0
    if (-not $Prepend -and $alreadyPresent) { return }
    $withoutEntry = @($entries | Where-Object { $_.TrimEnd('\') -ine $PathEntry.TrimEnd('\') })
    $desired = if ($Prepend) { @($PathEntry) + $withoutEntry } else { $withoutEntry + @($PathEntry) }
    if (($entries -join ';') -eq ($desired -join ';')) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would add to user PATH: $PathEntry"
        return
    }

    $newPath = ($desired -join ";") + ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "  User PATH updated: $PathEntry"
}

function Set-UserEnvironmentVariableIfNeeded {
    param([string]$Name, [string]$Value)

    $current = [Environment]::GetEnvironmentVariable($Name, "User")
    if ($current -eq $Value) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would set user environment variable $Name=$Value."
        return
    }

    [Environment]::SetEnvironmentVariable($Name, $Value, "User")
    Write-Host "  User environment variable updated: $Name=$Value"
}

function Get-AllowScriptsVersion {
    $command = Get-Command allow-scripts -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $command) { return $null }
    $output = [string](& $command.Source --version 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0) { return $null }
    return $output.Trim().TrimStart('v')
}

function Install-AllowScriptsIfNeeded {
    $installedVersion = Get-AllowScriptsVersion
    if ($installedVersion -eq $allowScriptsVersion) {
        Write-Host "  $allowScriptsPackage $allowScriptsVersion is already installed."
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would integrity-check and install $allowScriptsPackage@$allowScriptsVersion with lifecycle scripts disabled."
        return
    }

    $pnpm = Get-Command pnpm -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $pnpm) { throw "pnpm is required before installing $allowScriptsPackage." }
    $observedIntegrity = [string](& $pnpm.Source view "$allowScriptsPackage@$allowScriptsVersion" dist.integrity --json 2>$null)
    $observedIntegrity = $observedIntegrity.Trim().Trim('"')
    if ($LASTEXITCODE -ne 0 -or $observedIntegrity -ne $allowScriptsIntegrity) {
        throw "Registry integrity mismatch for $allowScriptsPackage@$allowScriptsVersion."
    }
    & $pnpm.Source add --global --ignore-scripts "$allowScriptsPackage@$allowScriptsVersion"
    if ($LASTEXITCODE -ne 0) { throw "pnpm failed to install $allowScriptsPackage@$allowScriptsVersion." }
    $installedVersion = Get-AllowScriptsVersion
    if ($installedVersion -ne $allowScriptsVersion) {
        throw "$allowScriptsPackage installation did not expose allow-scripts $allowScriptsVersion."
    }
    Write-Host "  Installed $allowScriptsPackage $allowScriptsVersion with lifecycle scripts disabled."
}

function Update-PowerShellProfile {
    param([string]$ProfilePath)

    $profilePath = $ProfilePath
    $profileDir = Split-Path -Parent $profilePath
    $startMarker = "# >>> AI Foundry Desk Layer 1 >>>"
    $endMarker = "# <<< AI Foundry Desk Layer 1 <<<"
    $legacyStartMarker = "# >>> AI Workstation Layer 1 >>>"
    $legacyEndMarker = "# <<< AI Workstation Layer 1 <<<"

    $guardrailBlock = @'
# >>> AI Foundry Desk Layer 1 >>>
# Managed by AI Foundry Desk. Legacy markers are preserved for idempotent upgrades.
$miseCommand = Get-Command mise -CommandType Application -ErrorAction SilentlyContinue
if ($miseCommand) {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        (& $miseCommand.Source activate pwsh) | Out-String | Invoke-Expression
    } else {
        (& $miseCommand.Source activate pwsh --shims) | Out-String | Invoke-Expression
    }
}

function Test-Layer1InteractiveCall {
    param([string]$CallerScriptName)
    return [Environment]::UserInteractive -and
        -not $env:CI -and
        -not $env:MISE_LAYER1_NONINTERACTIVE -and
        [string]::IsNullOrEmpty($CallerScriptName)
}

function Invoke-Layer1NativeCommand {
    param([string[]]$Names, [object[]]$Arguments)
    $native = Get-Command -Name $Names -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $native) { throw "Executable not found: $($Names -join ', ')" }
    & $native.Source @Arguments
}

function pip {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Use 'uv add <package>' in projects or 'uv pip ...' inside a .venv. Global pip is not the workbench default."
        return
    }
    Invoke-Layer1NativeCommand -Names @("pip.exe", "pip3.exe") -Arguments $args
}

function npm {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Use pnpm (for example, 'pnpm add <package>'). For explicit compatibility, call npm.cmd."
        return
    }
    Invoke-Layer1NativeCommand -Names @("npm.cmd", "npm.exe") -Arguments $args
}

function npx {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Use 'pnpm dlx <package>@<version>' or a project-pinned executable. For explicit compatibility, call npx.cmd."
        return
    }
    Invoke-Layer1NativeCommand -Names @("npx.cmd", "npx.exe") -Arguments $args
}

function fnm {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Node.js is managed by mise. Use 'mise use node@<version>'."
        return
    }
    Invoke-Layer1NativeCommand -Names @("fnm.exe", "fnm.cmd") -Arguments $args
}
# <<< AI Foundry Desk Layer 1 <<<
'@

    [string]$content = if (Test-Path -LiteralPath $profilePath) { Get-Content -Raw -LiteralPath $profilePath } else { "" }

    # Remove only known legacy fragments that break PowerShell startup.
    $content = [string]($content -replace '(?m)^\s*fnm env --use-on-cd \| Out-String \| Invoke-Expression\s*\r?\n?', '')
    $legacyNpmPattern = '(?ms)^# Optimally add npm global bin to PATH \(Fixed single-quote bug\)\r?\nif \(-not \$global:npmPrefix\) \{\r?\n\s*\$global:npmPrefix = npm config get prefix\r?\n\}\r?\nif \(\$env:Path -notlike "\*\$global:npmPrefix\*"\) \{\r?\n\s*\$env:Path \+= ";\$global:npmPrefix"\r?\n\}\r?\n?'
    $content = [string]($content -replace $legacyNpmPattern, '')
    $managedPattern = "(?ms)^$([regex]::Escape($startMarker)).*?^$([regex]::Escape($endMarker))\s*\r?\n?"
    $content = [string]($content -replace $managedPattern, '')
    $legacyManagedPattern = "(?ms)^$([regex]::Escape($legacyStartMarker)).*?^$([regex]::Escape($legacyEndMarker))\s*\r?\n?"
    $content = [string]($content -replace $legacyManagedPattern, '')
    $newContent = $content.TrimEnd() + "`r`n`r`n" + $guardrailBlock.Trim() + "`r`n"

    if ((Test-Path -LiteralPath $profilePath) -and
        ((Get-Content -Raw -LiteralPath $profilePath).TrimEnd() -eq $newContent.TrimEnd())) {
        Write-Host "  PowerShell profile is already up to date."
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would update $profilePath after creating a backup."
        return
    }

    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
    if (Test-Path -LiteralPath $profilePath) {
        Backup-ManagedFile -Source $profilePath -Target "layer1-powershell-profile" | Out-Null
    }
    [IO.File]::WriteAllText($profilePath, $newContent, (New-Object Text.UTF8Encoding($true)))
    Write-Host "  Profile updated: $profilePath"
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "WinGet was not found. Install App Installer before running Layer 1."
}

Write-Host "Installing the Layer 1 foundation..."
Install-WingetPackageIfMissing -WingetId "jdx.mise" -FriendlyName "mise"
Install-WingetPackageIfMissing -WingetId "astral-sh.uv" -FriendlyName "uv"
Install-WingetPackageIfMissing -WingetId "pnpm.pnpm" -FriendlyName "pnpm"

$wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
$miseShims = Join-Path $env:LOCALAPPDATA "mise\shims"
$miseGlobalConfig = Join-Path $env:LOCALAPPDATA "mise\afd-global-config.toml"
$miseState = Join-Path $env:TEMP "afd-mise-state"
$legacyMiseGlobalConfig = Join-Path $env:USERPROFILE ".config\mise\config.toml"
$rustupHome = Join-Path $env:USERPROFILE ".rustup"
$cargoHome = Join-Path $env:USERPROFILE ".cargo"
$pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
$pnpmBin = Join-Path $pnpmHome "bin"
$uvExe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Filter "uv.exe" -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '(?i)astral-sh\.uv' | Select-Object -First 1
$documentsDir = [Environment]::GetFolderPath("MyDocuments")
$profilePaths = @(
    (Join-Path $documentsDir "PowerShell\Microsoft.PowerShell_profile.ps1"),
    (Join-Path $documentsDir "WindowsPowerShell\Microsoft.PowerShell_profile.ps1")
)
Add-UserPathEntry -PathEntry $wingetLinks
Add-UserPathEntry -PathEntry $miseShims -Prepend
if ($uvExe) { Add-UserPathEntry -PathEntry (Split-Path -Parent $uvExe.FullName) }
Set-UserEnvironmentVariableIfNeeded -Name "UV_NO_MANAGED_PYTHON" -Value "1"
Set-UserEnvironmentVariableIfNeeded -Name "UV_PYTHON_DOWNLOADS" -Value "0"
Set-UserEnvironmentVariableIfNeeded -Name "MISE_GLOBAL_CONFIG_FILE" -Value $miseGlobalConfig
Set-UserEnvironmentVariableIfNeeded -Name "MISE_STATE_DIR" -Value $miseState
Set-UserEnvironmentVariableIfNeeded -Name "MISE_IGNORED_CONFIG_PATHS" -Value $legacyMiseGlobalConfig
Set-UserEnvironmentVariableIfNeeded -Name "RUSTUP_HOME" -Value $rustupHome
Set-UserEnvironmentVariableIfNeeded -Name "CARGO_HOME" -Value $cargoHome
Set-UserEnvironmentVariableIfNeeded -Name "PNPM_HOME" -Value $pnpmHome
Add-UserPathEntry -PathEntry $pnpmBin

if (-not (Test-Path -LiteralPath $pnpmHome)) {
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would create PNPM_HOME directory: $pnpmHome"
    } else {
        New-Item -ItemType Directory -Path $pnpmHome -Force | Out-Null
        Write-Host "  PNPM_HOME directory created: $pnpmHome"
    }
}

if ($WhatIf) {
    Write-Host "  [WhatIf] Would configure Python 3.14, Node 24, Go 1.26, and Rust 1.98.0 in $miseGlobalConfig with writable runtime state in $miseState."
    Write-Host "  [WhatIf] Would retain but ignore the superseded global config at $legacyMiseGlobalConfig; project-local configs remain enabled."
    Write-Host "  [WhatIf] Would disable automatic installation of missing mise tools."
    Install-AllowScriptsIfNeeded
    $profilePaths | ForEach-Object { Update-PowerShellProfile -ProfilePath $_ }
    return
}

$env:UV_NO_MANAGED_PYTHON = "1"
$env:UV_PYTHON_DOWNLOADS = "0"
$env:MISE_GLOBAL_CONFIG_FILE = $miseGlobalConfig
$env:MISE_STATE_DIR = $miseState
$env:MISE_IGNORED_CONFIG_PATHS = $legacyMiseGlobalConfig
$env:RUSTUP_HOME = $rustupHome
$env:CARGO_HOME = $cargoHome
$env:PNPM_HOME = $pnpmHome
$env:Path = "$wingetLinks;$miseShims;$pnpmBin;$env:Path"
$mise = Get-Command mise -CommandType Application -ErrorAction SilentlyContinue
if (-not $mise) {
    throw "mise is installed but was not found in $wingetLinks. Open a new terminal and try again."
}

Write-Host "`nConfiguring verifiable runtimes..."
& $mise.Source settings set not_found_auto_install false
& $mise.Source use --global "python@$($toolVersions.python)" "node@$($toolVersions.node)" "go@$($toolVersions.go)" "rust@$($toolVersions.rust)"
& $mise.Source reshim

Write-Host "`nConfiguring Node.js supply-chain guardrail..."
Install-AllowScriptsIfNeeded

Write-Host "`nConfiguring PowerShell..."
$profilePaths | ForEach-Object { Update-PowerShellProfile -ProfilePath $_ }

Write-Host "`nVerifying hardlinks on the temporary volume..."
$testDir = Join-Path $env:TEMP "afd-layer1-hardlink"
if (Test-Path -LiteralPath $testDir) { throw "The test directory already exists and will not be overwritten: $testDir" }
New-Item -ItemType Directory -Path $testDir | Out-Null
$src = Join-Path $testDir "source.txt"
$link = Join-Path $testDir "link.txt"
try {
    Set-Content -LiteralPath $src -Value "layer1" -Encoding ascii
    New-Item -ItemType HardLink -Path $link -Target $src | Out-Null
    Write-Host "  Hardlink OK - the volume supports the uv/pnpm CAS model." -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $testDir -Recurse -Force
}

Write-Host "`nLayer 1 complete. Open a new PowerShell and run 01-verify-layer1.ps1." -ForegroundColor Green
