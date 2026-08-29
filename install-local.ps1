param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$out = $null
if ($WhatIf) { Write-Host "[WhatIf] Executaria pnpm install --frozen-lockfile, build, pack, pnpm add --global e substituiria apenas os launchers afd pelo Node gerenciado exato."; exit 0 }

function Install-LocalAfdLauncher([string]$ExactNode) {
  $pnpm = Get-Command pnpm -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $metadata = (& $pnpm.Source list --global ai-foundry-desk --depth -1 --json | Out-String) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw "Could not resolve the installed AFD package." }
  $packageRoot = [string]$metadata[0].dependencies.'ai-foundry-desk'.path
  $cli = Join-Path $packageRoot "agent-manager\dist\cli.js"
  $bin = (& $pnpm.Source bin --global | Out-String).Trim()
  if (-not (Test-Path -LiteralPath $cli -PathType Leaf) -or [string]::IsNullOrWhiteSpace($bin)) { throw "Could not resolve the installed AFD CLI and global bin directory." }
  $psLauncher = "#!/usr/bin/env pwsh`n& '$($ExactNode.Replace("'", "''"))' '$($cli.Replace("'", "''"))' @args`nexit `$LASTEXITCODE`n"
  $cmdLauncher = "@echo off`r`n`"$ExactNode`" `"$cli`" %*`r`nexit /b %ERRORLEVEL%`r`n"
  $shNode = $ExactNode.Replace('\', '/')
  $shCli = $cli.Replace('\', '/')
  if ($shNode.Contains('"') -or $shCli.Contains('"')) { throw "Unsafe launcher path." }
  Set-Content -LiteralPath (Join-Path $bin "afd.ps1") -Value $psLauncher -Encoding utf8 -NoNewline
  Set-Content -LiteralPath (Join-Path $bin "afd.CMD") -Value $cmdLauncher -Encoding ascii -NoNewline
  Set-Content -LiteralPath (Join-Path $bin "afd") -Value "#!/bin/sh`nexec `"$shNode`" `"$shCli`" `"`$@`"`n" -Encoding ascii -NoNewline
}
Push-Location $root
try {
  $node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $nodeRuntime = (& $node.Source -p "process.execPath").Trim()
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $nodeRuntime -PathType Leaf)) { throw "Could not resolve the exact managed Node runtime." }
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
  Install-LocalAfdLauncher $nodeRuntime
  Write-Host "afd installed. No layer was applied."
} finally {
  Pop-Location
  if ($out -and (Test-Path -LiteralPath $out) -and ([IO.Path]::GetFullPath($out).StartsWith([IO.Path]::GetFullPath($env:TEMP), [StringComparison]::OrdinalIgnoreCase)) -and (Split-Path -Leaf $out) -like 'afd-pack-*') { Remove-Item -LiteralPath $out -Recurse -Force }
}
