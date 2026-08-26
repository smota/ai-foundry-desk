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
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "afd-bootstrap.ps1") -Destination (Join-Path $OutputDirectory "afd-bootstrap-windows.ps1") -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "afd-bootstrap-posix.sh") -Destination (Join-Path $OutputDirectory "afd-bootstrap-posix.sh") -Force
    $bootstrapHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap.ps1")).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap.ps1.sha256") -Value "$bootstrapHash  afd-bootstrap.ps1" -Encoding ascii
    Set-Content -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap-windows.ps1.sha256") -Value "$bootstrapHash  afd-bootstrap-windows.ps1" -Encoding ascii
    $posixHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap-posix.sh")).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $OutputDirectory "afd-bootstrap-posix.sh.sha256") -Value "$posixHash  afd-bootstrap-posix.sh" -Encoding ascii
    Set-Content -LiteralPath (Join-Path $OutputDirectory "RELEASE-NOTES.md") -Value "# AI Foundry Desk v$version`r`n`r`nWindows x64 includes the full PowerShell bootstrap and Layer 1 doctor/fix. The separate POSIX bootstrap is validated for the portable CLI cycle on Ubuntu 26.04.1 LTS under WSL2 x86_64; native Linux Layers remain unavailable. macOS detection is experimental and unvalidated. Installing the CLI never applies Layer 1 or Layer 2.`r`n" -Encoding utf8
    Write-Host "Release assets created in $OutputDirectory"
} finally { Pop-Location }
