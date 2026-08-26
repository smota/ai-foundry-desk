param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$out = $null
if ($WhatIf) { Write-Host "[WhatIf] Executaria pnpm install --frozen-lockfile, build, pack e pnpm add --global do artefato local."; exit 0 }
Push-Location $root
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with code $LASTEXITCODE." }
  pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build failed with code $LASTEXITCODE." }
  $out = Join-Path $env:TEMP ("afd-pack-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $out | Out-Null
  pnpm pack --pack-destination $out
  if ($LASTEXITCODE -ne 0) { throw "pnpm pack failed with code $LASTEXITCODE." }
  $archive = Get-ChildItem $out -Filter "ai-foundry-desk-*.tgz" | Select-Object -First 1
  if (-not $archive) { throw "The npm artifact was not generated." }
  pnpm add --global $archive.FullName
  if ($LASTEXITCODE -ne 0) { throw "pnpm add --global failed with code $LASTEXITCODE." }
  Write-Host "afd installed. No layer was applied."
} finally {
  Pop-Location
  if ($out -and (Test-Path -LiteralPath $out) -and ([IO.Path]::GetFullPath($out).StartsWith([IO.Path]::GetFullPath($env:TEMP), [StringComparison]::OrdinalIgnoreCase)) -and (Split-Path -Leaf $out) -like 'afd-pack-*') { Remove-Item -LiteralPath $out -Recurse -Force }
}
