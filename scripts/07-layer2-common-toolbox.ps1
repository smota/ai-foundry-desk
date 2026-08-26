<#
.SYNOPSIS
    Installs the Layer 2 Common Agent Toolbox on Windows.
.DESCRIPTION
    Garante rg, fd, jq, yq, bat e delta. RTK e deliberadamente excluido.
#>
param([switch]$WhatIf)
$ErrorActionPreference = "Stop"

function Refresh-UserPath {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [Environment]::GetEnvironmentVariable("Path", "User")
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
    [PSCustomObject]@{ Command = "delta"; Package = "dandavison.delta"; Purpose = "visualizacao de diffs" }
)

Refresh-UserPath
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "WinGet was not found." }
foreach ($tool in $tools) {
    if (Test-Tool $tool.Command) { Write-Host "  $($tool.Command) is functional; preserved without updating."; continue }
    if ($WhatIf) { Write-Host "  [WhatIf] Would install $($tool.Command) with WinGet ($($tool.Package))."; continue }
    winget install --id $tool.Package -e --source winget --accept-package-agreements --accept-source-agreements
    Refresh-UserPath
    if (-not (Test-Tool $tool.Command)) { throw "$($tool.Command) is not functional after installation." }
}
Write-Host "Common Agent Toolbox is ready. RTK was not installed." -ForegroundColor Green
