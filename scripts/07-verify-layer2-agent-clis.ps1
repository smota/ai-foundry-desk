<#
.SYNOPSIS
    Read-only verification of the initial Layer 2 agent CLIs.
.DESCRIPTION
    Shows command, source, method, and version. Does not read credentials or authenticate agents.
#>
param([switch]$WhatIf)
$env:Path = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User")) -join ";"

$desktopRows = @()
$claudeDesktop = winget list --id Anthropic.Claude -e --accept-source-agreements 2>$null |
    Select-String -SimpleMatch "Anthropic.Claude" | Select-Object -First 1
$claudeDesktopVersion = if ($claudeDesktop -and $claudeDesktop.Line -match '(\d+(?:\.\d+){2,3})') { $Matches[1] } else { "-" }
$desktopRows += [PSCustomObject]@{
    Application = "Claude Desktop"
    Status = if ($claudeDesktop) { "INSTALLED" } else { "MISSING" }
    Method = if ($claudeDesktop) { "WinGet: Anthropic.Claude" } else { "WinGet: Anthropic.Claude" }
    Version = $claudeDesktopVersion
    Authentication = if ($claudeDesktop) { "MANUAL LOGIN NOT VERIFIED" } else { "-" }
}

$codexDesktop = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
    Where-Object Status -eq "Ok" | Select-Object -First 1
$desktopRows += [PSCustomObject]@{
    Application = "Codex Desktop"
    Status = if ($codexDesktop) { "INSTALLED" } else { "MISSING" }
    Method = if ($codexDesktop) { "Official MSIX: OpenAI.Codex" } else { "Official channel/Microsoft Store; no suitable WinGet package" }
    Version = if ($codexDesktop) { [string]$codexDesktop.Version } else { "-" }
    Authentication = if ($codexDesktop) { "MANUAL LOGIN NOT VERIFIED" } else { "-" }
}

Write-Host "Aplicativos desktop:"
$desktopRows | Format-Table -AutoSize -Wrap

$agents = @(
    [PSCustomObject]@{ Name = "Claude Code"; Command = "claude"; WingetId = "Anthropic.ClaudeCode"; Package = "" },
    [PSCustomObject]@{ Name = "Codex CLI"; Command = "codex"; WingetId = "OpenAI.Codex"; Package = "" },
    [PSCustomObject]@{ Name = "Antigravity CLI"; Command = "agy"; WingetId = "Google.AntigravityCLI"; Package = "" },
    [PSCustomObject]@{ Name = "Pi"; Command = "pi"; WingetId = ""; Package = "@earendil-works/pi-coding-agent" },
    [PSCustomObject]@{ Name = "Hermes Agent"; Command = "hermes"; WingetId = ""; Package = "" },
    [PSCustomObject]@{ Name = "Grok Build"; Command = "grok"; WingetId = ""; Package = "@xai-official/grok" }
)

$rows = foreach ($agent in $agents) {
    $found = Get-Command $agent.Command -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    $method = ""
    if ($found -and $agent.WingetId) {
        $registered = winget list --id $agent.WingetId -e --accept-source-agreements 2>$null |
            Select-String -SimpleMatch $agent.WingetId
        $method = if ($registered) { "WinGet: $($agent.WingetId)" } else { "official installer / not registered in WinGet" }
    }
    elseif ($found -and $agent.Package) { $method = "pnpm global: $($agent.Package)" }
    elseif ($found -and $agent.Command -eq "hermes") { $method = "instalador oficial fixado: v2026.8.19" }

    $version = ""
    if ($found) {
        try { $version = [string](& $found.Source --version 2>&1 | Select-Object -First 1) }
        catch { $version = "versao indisponivel" }
    }
    [PSCustomObject]@{
        Agent = $agent.Name
        Status = if ($found) { "INSTALLED" } else { "MISSING" }
        Command = if ($found) { $found.Source } else { $agent.Command }
        Method = if ($found) { $method } else { "-" }
        Version = if ($found) { $version } else { "-" }
        Authentication = if ($found) { "MANUAL LOGIN NOT VERIFIED" } else { "-" }
    }
}

Write-Host "`nAgentes CLI:"
$rows | Format-List Agent, Status, Command, Method, Version, Authentication
$missing = @($rows | Where-Object Status -ne "INSTALLED")
$missingDesktop = @($desktopRows | Where-Object Status -ne "INSTALLED")
$hermesShim = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\hermes.cmd"
Write-Host "`nIntegracao PATH do Hermes:"
Write-Host "  Shared shim: $(if (Test-Path -LiteralPath $hermesShim) { $hermesShim } else { 'MISSING' })"
Write-Host "  PATH persistente contem WinGet Links: $((([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') -contains (Split-Path -Parent $hermesShim)))"
$hermesTargets = @((Join-Path $env:USERPROFILE ".afd\managed\hermes\hermes-agent\bin\hermes.exe")) +
    @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "LocalCache\Local\hermes\hermes-agent\bin\hermes.exe" }) +
    @((Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\bin\hermes.exe"))
$realHermes = $hermesTargets | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
Write-Host "  Physical official executable: $(if ($realHermes) { $realHermes } else { 'MISSING' })"
Write-Host "  Physical directory on persistent PATH: $([bool]($realHermes -and (([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') -contains (Split-Path -Parent $realHermes))))"
$hermesShimContent = if (Test-Path -LiteralPath $hermesShim) { Get-Content -Raw -LiteralPath $hermesShim } else { "" }
Write-Host "  Launcher evita trampoline uv: $($hermesShimContent -match '-m hermes_cli\.main')"
$hermesRoutes = @(Get-Command hermes -All -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)
$canonicalHermes = $hermesRoutes | Select-Object -First 1
$routeValid = $canonicalHermes -and ($canonicalHermes.Source -eq $hermesShim) -and
    ($hermesShimContent -match '-m hermes_cli\.main')
Write-Host "  Rota canonica unica primeiro: $routeValid"
Write-Host "  Rotas resolvidas: $(@($hermesRoutes | ForEach-Object Source) -join ' | ')"
$grokShim = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\grok.cmd"
Write-Host "`nIntegracao PATH do Grok:"
Write-Host "  Shared shim: $(if (Test-Path -LiteralPath $grokShim) { $grokShim } else { 'MISSING' })"
Write-Host "  pnpm source: $(Join-Path $env:LOCALAPPDATA 'pnpm\bin\grok.CMD')"
$documents = [Environment]::GetFolderPath("MyDocuments")
$profilePaths = @(
    (Join-Path $documents "PowerShell\profile.ps1"),
    (Join-Path $documents "WindowsPowerShell\profile.ps1")
)
Write-Host "`nCobertura de terminais PowerShell:"
foreach ($profilePath in $profilePaths) {
    $managed = (Test-Path -LiteralPath $profilePath) -and
        [bool](Select-String -LiteralPath $profilePath -SimpleMatch "# >>> AI Foundry Desk Layer 2 PATH >>>" -Quiet)
    $guardrail = $managed -and
        [bool](Select-String -LiteralPath $profilePath -SimpleMatch "Direct Hermes updates are blocked" -Quiet)
    Write-Host "  $profilePath : $(if ($managed) { 'MANAGED' } else { 'MISSING' }); update guardrail: $guardrail"
}
Write-Host "  PATHEXT aceita .CMD: $((($env:PATHEXT -split ';') -contains '.CMD'))"
if ($missing.Count -or $missingDesktop.Count -or -not $routeValid) {
    Write-Host "`n$($missing.Count) CLI(s) and $($missingDesktop.Count) desktop app(s) are missing. Run 07-layer2-agent-clis.ps1." -ForegroundColor Yellow
    exit 1
}
Write-Host "`nDesktop apps and CLIs detected. Authentication remains manual and was not inspected." -ForegroundColor Green
