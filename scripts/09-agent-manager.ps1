<#
.SYNOPSIS
    09 - Prepara o Agent Manager Node/TypeScript do produto.
.DESCRIPTION
    Installs locked dependencies and builds the CLI. It does not sync skills, alter agents, or authenticate.
#>
param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command pnpm -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)) {
    throw "pnpm was not found; validate Layer 1 first."
}
if ($WhatIf) {
    Write-Host "[WhatIf] Executaria pnpm install --frozen-lockfile e pnpm build no workspace."
    Write-Host "[WhatIf] Would not run afd sync automatically."
    return
}
Push-Location $root
try { pnpm install --frozen-lockfile; pnpm build }
finally { Pop-Location }
Write-Host "Agent Manager is ready. Review with 'afd review' and apply with 'afd sync'." -ForegroundColor Green
