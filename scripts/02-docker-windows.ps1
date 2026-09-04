<#
.SYNOPSIS
    Install or verify Docker Desktop as a native Layer 1 host capability.
.DESCRIPTION
    Uses the official Docker.DockerDesktop WinGet package when Docker Desktop is absent.
    The WinGet package is machine-scoped and may request elevation. This adapter never starts
    Docker Desktop, accepts its in-app terms, changes its backend, or edits docker-users membership.
.PARAMETER WhatIf
    Shows the planned action without installing packages or changing host state.
#>
param(
    [switch]$WhatIf,
    [string]$ProgramFilesRoot = $env:ProgramFiles,
    [string]$LocalAppDataRoot = $env:LOCALAPPDATA
)

$ErrorActionPreference = "Stop"
$packageId = "Docker.DockerDesktop"

if ($env:OS -ne "Windows_NT" -or
    [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
    throw "The Docker Desktop adapter is validated only on Windows x64."
}

function Get-DockerCommand {
    Get-Command docker -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

$desktopPaths = @(
    (Join-Path $ProgramFilesRoot "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $LocalAppDataRoot "Programs\DockerDesktop\Docker Desktop.exe")
)
$desktop = $desktopPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$winget = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$registered = if ($winget) {
    & $winget.Source list --id $packageId -e --accept-source-agreements 2>$null |
        Select-String -SimpleMatch $packageId
} else { $null }

if ($desktop -or $registered) {
    Write-Host "Docker Desktop is already installed$(if($desktop){" at $desktop"}). No reinstall is required."
} else {
    if (-not $winget) { throw "WinGet was not found. Install App Installer before applying Docker Desktop." }
    if ($WhatIf) {
        Write-Host "[WhatIf] Would install Docker Desktop with WinGet ($packageId)."
        Write-Host "[WhatIf] The current WinGet package is machine-scoped and may request elevation."
        Write-Host "[WhatIf] AFD would not start Docker Desktop, accept in-app terms, or change group membership."
        return
    } else {
        Write-Host "Installing Docker Desktop through WinGet. The installer may request elevation..."
        & $winget.Source install --id $packageId -e --source winget `
            --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "WinGet Docker Desktop installation failed with code $LASTEXITCODE." }
    }
}

if ($WhatIf) {
    Write-Host "[WhatIf] Would verify Docker CLI and Compose without starting the Docker daemon."
    return
}

$docker = Get-DockerCommand
if (-not $docker) {
    foreach ($dockerBin in @(
        (Join-Path $ProgramFilesRoot "Docker\Docker\resources\bin"),
        (Join-Path $LocalAppDataRoot "Programs\DockerDesktop\resources\bin")
    )) {
        if (Test-Path -LiteralPath (Join-Path $dockerBin "docker.exe") -PathType Leaf) {
            $env:Path = "$dockerBin;$env:Path"
            $docker = Get-DockerCommand
            if ($docker) { break }
        }
    }
}
if (-not $docker) { throw "Docker Desktop is installed but docker is not resolvable. Open a fresh shell and rerun verification." }

$priorErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$dockerVersionOutput = @(& $docker.Source --version 2>$null)
$dockerVersionExit = $LASTEXITCODE
$dockerVersion = [string]($dockerVersionOutput | Select-Object -First 1)
$composeVersionOutput = @(& $docker.Source compose version 2>$null)
$composeVersionExit = $LASTEXITCODE
$composeVersion = [string]($composeVersionOutput | Select-Object -First 1)
$ErrorActionPreference = $priorErrorPreference
if ($dockerVersionExit -ne 0 -or $dockerVersion -notmatch '^Docker version ') { throw "Docker CLI verification failed: $dockerVersion" }
if ($composeVersionExit -ne 0 -or $composeVersion -notmatch '^Docker Compose version ') { throw "Docker Compose verification failed: $composeVersion" }
Write-Host "  $dockerVersion"
Write-Host "  $composeVersion"

$ErrorActionPreference = "Continue"
$daemonVersionOutput = @(& $docker.Source info --format '{{.ServerVersion}}' 2>$null)
$daemonExit = $LASTEXITCODE
$daemonVersion = [string]($daemonVersionOutput | Select-Object -First 1)
$ErrorActionPreference = $priorErrorPreference
if ($daemonExit -eq 0 -and $daemonVersion) {
    Write-Host "  Docker daemon available: $daemonVersion"
} else {
    Write-Warning "Docker Desktop is installed but its daemon is not available. Start it interactively when a workload needs containers."
}

Write-Host "Docker Desktop Layer 1 host capability verified. Layers 1-3 remain native."
