param([switch]$WhatIf)
$ErrorActionPreference = "Stop"

$legacyConfig = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".ai-workstation"))
$newConfig = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".afd"))
$legacyLocal = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "ai-workstation"))
$newLocal = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "AI Foundry Desk"))

function Move-LegacyRoot([string]$Legacy, [string]$Current) {
    if (-not (Test-Path -LiteralPath $Legacy)) { return }
    if (Test-Path -LiteralPath $Current) { throw "Migration conflict: both legacy and current roots exist: $Legacy | $Current" }
    if ($WhatIf) { Write-Host "[WhatIf] Move $Legacy -> $Current"; return }
    Move-Item -LiteralPath $Legacy -Destination $Current
}

function Rename-ManagedSkill([string]$Root) {
    if (-not $Root) { return }
    $legacy = Join-Path $Root "ai-workstation-principles"
    $current = Join-Path $Root "afd-workbench-principles"
    if (-not (Test-Path -LiteralPath $legacy)) { return }
    if (Test-Path -LiteralPath $current) { throw "Skill migration conflict: $legacy | $current" }
    if ($WhatIf) { Write-Host "[WhatIf] Move $legacy -> $current"; return }
    Move-Item -LiteralPath $legacy -Destination $current
}

Move-LegacyRoot $legacyConfig $newConfig
Move-LegacyRoot $legacyLocal $newLocal

$canonicalSkills = Join-Path $newConfig "catalog\skills"
$sharedSkills = Join-Path $env:USERPROFILE ".agents\skills"
$claudeSkills = Join-Path $env:USERPROFILE ".claude\skills"
$hermesSkills = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\skills"
if (-not (Test-Path -LiteralPath $hermesSkills)) {
    $hermesSkills = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "LocalCache\Local\hermes\hermes-agent\skills" } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
foreach ($root in @($canonicalSkills, $sharedSkills, $claudeSkills, $hermesSkills)) { Rename-ManagedSkill $root }

$manifest = Join-Path $newConfig "manifest.json"
if (Test-Path -LiteralPath $manifest) {
    $content = Get-Content -Raw -LiteralPath $manifest
    $updated = $content.Replace("ai-workstation-principles", "afd-workbench-principles")
    if ($updated -ne $content) { if ($WhatIf) { Write-Host "[WhatIf] Update managed skill IDs in $manifest" } else { Set-Content -LiteralPath $manifest -Value $updated -Encoding UTF8 -NoNewline } }
}

if (-not $WhatIf) {
    New-Item -ItemType Directory -Path $newLocal -Force | Out-Null
    [ordered]@{ schemaVersion = 1; migratedAt = (Get-Date).ToUniversalTime().ToString("o"); configRoot = "%USERPROFILE%\.afd"; localRoot = "%LOCALAPPDATA%\AI Foundry Desk" } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $newLocal "migration.json") -Encoding UTF8
}

Write-Host "AFD state migration complete. Legacy roots are absent or were moved after conflict checks."
