[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Version = "0.7.0",
    [string]$Repository = "smota/ai-foundry-desk",
    [string]$LocalAssetDirectory
)

$ErrorActionPreference = "Stop"
$tag = "v$Version"
$packageName = "ai-foundry-desk-$Version.tgz"
$checksumName = "$packageName.sha256"

if ($WhatIfPreference) {
    Write-Host "[WhatIf] Would download and verify $packageName from GitHub Release $tag."
    Write-Host "[WhatIf] Would install only the AFD CLI; Layer 1 and Layer 2 would not run."
    return
}

foreach ($command in @("node", "pnpm")) {
    if (-not (Get-Command $command -CommandType Application -ErrorAction SilentlyContinue)) {
        throw "$command is required. Install the Windows prerequisites described in the release notes, then retry."
    }
}
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$pnpm = Get-Command pnpm -CommandType Application -ErrorAction Stop | Select-Object -First 1
$nodeMajor = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw "Node.js 24 or newer is required." }
$nodeRuntime = (& $node.Source -p "process.execPath").Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeRuntime -PathType Leaf)) { throw "Could not resolve the exact Node.js runtime." }

function Install-AfdLauncher([string]$PnpmPath, [string]$ExactNode) {
    $metadataText = & $PnpmPath list --global ai-foundry-desk --depth -1 --json | Out-String
    if ($LASTEXITCODE -ne 0) { throw "Could not resolve the installed AFD package." }
    $metadata = $metadataText | ConvertFrom-Json
    $packageRoot = [string]$metadata[0].dependencies.'ai-foundry-desk'.path
    $cli = Join-Path $packageRoot "agent-manager\dist\cli.js"
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw "The installed AFD CLI is missing." }
    $bin = (& $PnpmPath bin --global | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($bin)) { throw "Could not resolve the pnpm global bin directory." }
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $psNode = $ExactNode.Replace("'", "''")
    $psCli = $cli.Replace("'", "''")
    $psLauncher = "#!/usr/bin/env pwsh`n& '$psNode' '$psCli' @args`nexit `$LASTEXITCODE`n"
    $cmdLauncher = "@echo off`r`n`"$ExactNode`" `"$cli`" %*`r`nexit /b %ERRORLEVEL%`r`n"
    $shNode = $ExactNode.Replace('\', '/')
    $shCli = $cli.Replace('\', '/')
    if ($shNode.Contains('"') -or $shCli.Contains('"')) { throw "Unsafe launcher path." }
    $shLauncher = "#!/bin/sh`nexec `"$shNode`" `"$shCli`" `"`$@`"`n"
    Set-Content -LiteralPath (Join-Path $bin "afd.ps1") -Value $psLauncher -Encoding utf8 -NoNewline
    Set-Content -LiteralPath (Join-Path $bin "afd.CMD") -Value $cmdLauncher -Encoding ascii -NoNewline
    Set-Content -LiteralPath (Join-Path $bin "afd") -Value $shLauncher -Encoding ascii -NoNewline
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("afd-bootstrap-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    $packagePath = Join-Path $tempRoot $packageName
    $checksumPath = Join-Path $tempRoot $checksumName
    if ($LocalAssetDirectory) {
        Copy-Item -LiteralPath (Join-Path $LocalAssetDirectory $packageName) -Destination $packagePath
        Copy-Item -LiteralPath (Join-Path $LocalAssetDirectory $checksumName) -Destination $checksumPath
    } else {
        $base = "https://github.com/$Repository/releases/download/$tag"
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$packageName" -OutFile $packagePath
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$checksumName" -OutFile $checksumPath
    }
    $expected = ((Get-Content -Raw -LiteralPath $checksumPath).Trim() -split '\s+')[0]
    if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid SHA-256 checksum file." }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagePath).Hash
    if ($actual -ne $expected) { throw "SHA-256 verification failed; nothing was installed." }

    & $pnpm.Source add --global $packagePath --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "pnpm global installation failed with code $LASTEXITCODE." }
    Install-AfdLauncher $pnpm.Source $nodeRuntime

    $pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
    $pnpmBin = Join-Path $pnpmHome "bin"
    [Environment]::SetEnvironmentVariable("PNPM_HOME", $pnpmHome, "User")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($userPath -split ';' | Where-Object { $_ })
    if ($entries -notcontains $pnpmBin) {
        [Environment]::SetEnvironmentVariable("Path", (($entries + $pnpmBin) -join ';') + ';', "User")
    }
    Write-Host "AI Foundry Desk $Version installed for Windows. Open a new PowerShell or cmd and run: afd init --dry-run"
    Write-Host "No layer was applied."
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
