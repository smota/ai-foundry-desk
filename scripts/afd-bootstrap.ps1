[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Version = "0.1.2",
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
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is required. Install the Windows prerequisites described in the release notes, then retry."
    }
}
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw "Node.js 24 or newer is required." }

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

    & pnpm add --global $packagePath --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw "pnpm global installation failed with code $LASTEXITCODE." }

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
