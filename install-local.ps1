param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$out = $null
if ($WhatIf) { Write-Host "[WhatIf] Executaria pnpm install --frozen-lockfile, build, pack e pnpm add --global do artefato local."; exit 0 }
Push-Location $root
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install falhou com codigo $LASTEXITCODE." }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build falhou com codigo $LASTEXITCODE." }
  $out = Join-Path $env:TEMP ("afd-pack-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $out | Out-Null
  pnpm pack --pack-destination $out
  if ($LASTEXITCODE -ne 0) { throw "pnpm pack falhou com codigo $LASTEXITCODE." }
  $archive = Get-ChildItem $out -Filter "ai-foundry-desk-*.tgz" | Select-Object -First 1
  if (-not $archive) { throw "Artefato npm não foi gerado." }
  pnpm add --global $archive.FullName
  if ($LASTEXITCODE -ne 0) { throw "pnpm add --global falhou com codigo $LASTEXITCODE." }
  Write-Host "Instalado: afd. Nenhuma layer foi aplicada."
} finally {
  Pop-Location
  if ($out -and (Test-Path -LiteralPath $out) -and ([IO.Path]::GetFullPath($out).StartsWith([IO.Path]::GetFullPath($env:TEMP), [StringComparison]::OrdinalIgnoreCase)) -and (Split-Path -Leaf $out) -like 'afd-pack-*') { Remove-Item -LiteralPath $out -Recurse -Force }
}
