<#
.SYNOPSIS
    Read-only Layer 1 verification.
.DESCRIPTION
    Confirms commands, effective versions, mise provenance, and protection against implicit
    installation. Does not install or alter files.
#>
param([switch]$WhatIf)

$ErrorActionPreference = "Continue"
$env:Path = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User")) -join ";"
$checks = @()

function Add-Check {
    param([string]$Item, [bool]$Passed, [string]$Observed, [string]$Expected)
    $script:checks += [PSCustomObject]@{
        Item = $Item
        Status = if ($Passed) { "OK" } else { "FAIL" }
        Observed = $Observed
        Expected = $Expected
    }
}

function Get-FirstLine {
    param([scriptblock]$Command)
    try { return [string](& $Command 2>&1 | Select-Object -First 1) } catch { return $_.Exception.Message }
}

$commands = @("mise", "uv", "pnpm", "python", "node", "go", "rustc", "cargo")
foreach ($command in $commands) {
    $found = Get-Command $command -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    Add-Check -Item "$command no PATH" -Passed ([bool]$found) `
        -Observed $(if ($found) { $found.Source } else { "missing" }) -Expected "present"
}

$versions = [ordered]@{
    Python = Get-FirstLine { python --version }
    Node = Get-FirstLine { node --version }
    Go = Get-FirstLine { go version }
    Rust = Get-FirstLine { rustc --version }
}
Add-Check "Python" ($versions.Python -match '^Python 3\.14\.') $versions.Python "3.14.x"
Add-Check "Node.js" ($versions.Node -match '^v24\.') $versions.Node "24.x LTS"
Add-Check "Go" ($versions.Go -match 'go1\.26\.') $versions.Go "1.26.x"
Add-Check "Rust" ($versions.Rust -match '^rustc 1\.98\.0\b') $versions.Rust "1.98.0"

$autoInstall = Get-FirstLine { mise settings get not_found_auto_install }
Add-Check "mise not_found_auto_install" ($autoInstall -eq "false") $autoInstall "false"

$uvNoManaged = [Environment]::GetEnvironmentVariable("UV_NO_MANAGED_PYTHON", "User")
$uvDownloads = [Environment]::GetEnvironmentVariable("UV_PYTHON_DOWNLOADS", "User")
Add-Check "UV_NO_MANAGED_PYTHON" ($uvNoManaged -eq "1") $uvNoManaged "1"
Add-Check "UV_PYTHON_DOWNLOADS" ($uvDownloads -eq "0") $uvDownloads "0"

$uvPython = Get-FirstLine { uv python find --no-python-downloads }
$misePythonRoot = Join-Path $env:LOCALAPPDATA "mise\installs\python"
$uvUsesMise = $uvPython -and ([IO.Path]::GetFullPath($uvPython)).StartsWith(
    ([IO.Path]::GetFullPath($misePythonRoot).TrimEnd("\") + "\"),
    [StringComparison]::OrdinalIgnoreCase
)
Add-Check "uv usa Python do mise" $uvUsesMise $uvPython "$misePythonRoot\..."

$pnpmHome = [Environment]::GetEnvironmentVariable("PNPM_HOME", "User")
$expectedPnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
$expectedPnpmBin = Join-Path $expectedPnpmHome "bin"
$userPathEntries = @([Environment]::GetEnvironmentVariable("Path", "User") -split ";" |
    Where-Object { $_ })
Add-Check "PNPM_HOME" ($pnpmHome -eq $expectedPnpmHome) $pnpmHome $expectedPnpmHome
Add-Check "PNPM_HOME directory" (Test-Path -LiteralPath $expectedPnpmHome -PathType Container) `
    $(if (Test-Path -LiteralPath $expectedPnpmHome) { "present" } else { "missing" }) "present"
Add-Check "PNPM_HOME bin no PATH" ($userPathEntries -contains $expectedPnpmBin) `
    $(if ($userPathEntries -contains $expectedPnpmBin) { $expectedPnpmBin } else { "missing" }) $expectedPnpmBin

$checks | Format-Table -AutoSize
$failed = @($checks | Where-Object Status -ne "OK")
if ($failed.Count -gt 0) {
    Write-Host "`n$($failed.Count) check(s) failed." -ForegroundColor Yellow
    exit 1
}
Write-Host "`nLayer 1 verification passed." -ForegroundColor Green
