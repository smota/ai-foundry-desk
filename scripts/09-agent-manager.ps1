<#
.SYNOPSIS
    09 - Prepara o Agent Manager Node/TypeScript do produto.
.DESCRIPTION
    Instala dependencias fixadas e compila o CLI. Nao sincroniza skills, nao altera agentes e nao autentica.
#>
param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Get-Command pnpm -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)) {
    throw "pnpm nao encontrado; valide a Layer 1 primeiro."
}
if ($WhatIf) {
    Write-Host "[WhatIf] Executaria pnpm install --frozen-lockfile e pnpm build no workspace."
    Write-Host "[WhatIf] Nao executaria afd sync automaticamente."
    return
}
Push-Location $root
try { pnpm install --frozen-lockfile; pnpm build }
finally { Pop-Location }
Write-Host "Agent Manager preparado. Revise com 'afd review' e aplique com 'afd sync'." -ForegroundColor Green
