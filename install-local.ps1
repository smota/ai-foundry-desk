param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$out = $null
if ($WhatIf) { Write-Host "[WhatIf] Executaria pnpm install --frozen-lockfile, build, pack e pnpm add --global do artefato local."; exit 0 }
Push-Location $root
try {
  pnpm install --frozen-lockfile
  pnpm build
  $out = Join-Path $env:TEMP ("afd-pack-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $out | Out-Null
  pnpm pack --pack-destination $out
  $archive = Get-ChildItem $out -Filter "ai-foundry-desk-*.tgz" | Select-Object -First 1
  if (-not $archive) { throw "Artefato npm não foi gerado." }
  pnpm add --global $archive.FullName
  Write-Host "Instalado: afd. Nenhuma layer foi aplicada."
} finally {
  Pop-Location
  if ($out -and (Test-Path -LiteralPath $out) -and ([IO.Path]::GetFullPath($out).StartsWith([IO.Path]::GetFullPath($env:TEMP), [StringComparison]::OrdinalIgnoreCase)) -and (Split-Path -Leaf $out) -like 'afd-pack-*') { Remove-Item -LiteralPath $out -Recurse -Force }
}
