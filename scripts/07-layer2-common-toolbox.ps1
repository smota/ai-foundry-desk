<#
.SYNOPSIS
    Installs the Layer 2 Common Agent Toolbox on Windows.
.DESCRIPTION
    Garante rg, fd, jq, yq, bat, delta (git-delta) e glow. RTK e deliberadamente excluido.
#>
param([switch]$WhatIf)
$ErrorActionPreference = "Stop"

function Refresh-UserPath {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [Environment]::GetEnvironmentVariable("Path", "User")
}

function Test-WinGetInstalled {
    param([string]$PackageId)
    $rows = winget list --id $PackageId --accept-source-agreements 2>&1
    return $rows -match "^\s*$PackageId\s+"
}

function Test-Tool([string]$Command) {
    $found = Get-Command $Command -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $found) { return $false }
    try { & $found.Source --version *> $null; return $LASTEXITCODE -eq 0 }
    catch { return $false }
}

$tools = @(
    [PSCustomObject]@{ Command = "rg"; Package = "BurntSushi.ripgrep.MSVC"; Purpose = "busca rapida de texto" },
    [PSCustomObject]@{ Command = "fd"; Package = "sharkdp.fd"; Purpose = "busca rapida de arquivos" },
    [PSCustomObject]@{ Command = "jq"; Package = "jqlang.jq"; Purpose = "consulta e transformacao JSON" },
    [PSCustomObject]@{ Command = "yq"; Package = "MikeFarah.yq"; Purpose = "consulta e transformacao YAML" },
    [PSCustomObject]@{ Command = "bat"; Package = "sharkdp.bat"; Purpose = "visualizacao de arquivos" },
    [PSCustomObject]@{ Command = "delta"; Package = "dandavison.delta"; Purpose = "visualizacao de diffs" },
    [PSCustomObject]@{ Command = "glow"; Package = "charmbracelet.glow"; Purpose = "visualizacao de markdown" }
)

Refresh-UserPath
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "WinGet was not found." }
foreach ($tool in $tools) {
    Refresh-UserPath
    if (Test-Tool $tool.Command) { Write-Host "  $($tool.Command) is functional; preserved without updating."; continue }
    if (Test-WinGetInstalled $tool.Package) {
        Write-Host "  $($tool.Command) is installed but not visible in this shell session; reloading PATH and retrying."
        Refresh-UserPath
        if (Test-Tool $tool.Command) { Write-Host "  $($tool.Command) is functional; preserved without updating."; continue }
        Write-Host "  $($tool.Command) remains unavailable from PATH after reload. Restart shell or run: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"
    }
    if ($WhatIf) { Write-Host "  [WhatIf] Would install $($tool.Command) with WinGet ($($tool.Package))."; continue }
    winget install --id $tool.Package -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-UserPath
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        if (Test-Tool $tool.Command) { break }
        Start-Sleep -Milliseconds 500
        Refresh-UserPath
    }
    if (-not (Test-Tool $tool.Command)) { throw "$($tool.Command) is not functional after installation." }
}
Write-Host "Common Agent Toolbox is ready. RTK was not installed." -ForegroundColor Green
