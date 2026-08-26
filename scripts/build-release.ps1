[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root "release" }
$package = Get-Content -Raw -LiteralPath (Join-Path $root "package.json") | ConvertFrom-Json
$version = $package.version
$artifactName = "ai-foundry-desk-$version.tgz"
if (-not (Test-Path -LiteralPath $OutputDirectory)) { New-Item -ItemType Directory -Path $OutputDirectory | Out-Null }

Push-Location $root
try {
    & pnpm check
    if ($LASTEXITCODE -ne 0) { throw "pnpm check failed." }
    & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-audit.ps1
    if ($LASTEXITCODE -ne 0) { throw "Release audit failed." }
    $packed = (& pnpm pack --pack-destination $OutputDirectory | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0) { throw "pnpm pack failed." }
    $sourceArtifact = if ([IO.Path]::IsPathRooted($packed)) { $packed } else { Join-Path $root $packed }
    $artifact = Join-Path $OutputDirectory $artifactName
    if ((Resolve-Path $sourceArtifact).Path -ne [IO.Path]::GetFullPath($artifact)) { Move-Item -LiteralPath $sourceArtifact -Destination $artifact -Force }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$artifact.sha256" -Value "$hash  $artifactName" -Encoding ascii
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "afd-bootstrap.ps1") -Destination (Join-Path $OutputDirectory "afd-bootstrap.ps1") -Force
    $bootstrapHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap.ps1")).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap.ps1.sha256") -Value "$bootstrapHash  afd-bootstrap.ps1" -Encoding ascii
    Set-Content -LiteralPath (Join-Path $OutputDirectory "RELEASE-NOTES.md") -Value "# AI Foundry Desk v$version`r`n`r`nVerified Windows x64 bootstrap release. Installing the CLI does not apply Layer 1 or Layer 2.`r`n" -Encoding utf8
    Write-Host "Release assets created in $OutputDirectory"
} finally { Pop-Location }
