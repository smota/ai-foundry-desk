<#
.SYNOPSIS
    Verificacao somente leitura dos agentes CLI iniciais da Layer 2.
.DESCRIPTION
    Mostra comando, origem, metodo e versao. Nao le credenciais e nao autentica agentes.
#>
param([switch]$WhatIf)

$desktopRows = @()
$claudeDesktop = winget list --id Anthropic.Claude -e --accept-source-agreements 2>$null |
    Select-String -SimpleMatch "Anthropic.Claude" | Select-Object -First 1
$claudeDesktopVersion = if ($claudeDesktop -and $claudeDesktop.Line -match '(\d+(?:\.\d+){2,3})') { $Matches[1] } else { "-" }
$desktopRows += [PSCustomObject]@{
    Application = "Claude Desktop"
    Status = if ($claudeDesktop) { "INSTALADO" } else { "AUSENTE" }
    Method = if ($claudeDesktop) { "WinGet: Anthropic.Claude" } else { "WinGet: Anthropic.Claude" }
    Version = $claudeDesktopVersion
    Authentication = if ($claudeDesktop) { "LOGIN MANUAL NAO VERIFICADO" } else { "-" }
}

$codexDesktop = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
    Where-Object Status -eq "Ok" | Select-Object -First 1
$desktopRows += [PSCustomObject]@{
    Application = "Codex Desktop"
    Status = if ($codexDesktop) { "INSTALADO" } else { "AUSENTE" }
    Method = if ($codexDesktop) { "MSIX oficial: OpenAI.Codex" } else { "canal oficial/Microsoft Store; sem pacote WinGet adequado" }
    Version = if ($codexDesktop) { [string]$codexDesktop.Version } else { "-" }
    Authentication = if ($codexDesktop) { "LOGIN MANUAL NAO VERIFICADO" } else { "-" }
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
        $method = if ($registered) { "WinGet: $($agent.WingetId)" } else { "instalador oficial / nao registrado no WinGet" }
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
        Status = if ($found) { "INSTALADO" } else { "AUSENTE" }
        Command = if ($found) { $found.Source } else { $agent.Command }
        Method = if ($found) { $method } else { "-" }
        Version = if ($found) { $version } else { "-" }
        Authentication = if ($found) { "LOGIN MANUAL NAO VERIFICADO" } else { "-" }
    }
}

Write-Host "`nAgentes CLI:"
$rows | Format-List Agent, Status, Command, Method, Version, Authentication
$missing = @($rows | Where-Object Status -ne "INSTALADO")
$missingDesktop = @($desktopRows | Where-Object Status -ne "INSTALADO")
$hermesShim = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\hermes.cmd"
Write-Host "`nIntegracao PATH do Hermes:"
Write-Host "  Shim compartilhado: $(if (Test-Path -LiteralPath $hermesShim) { $hermesShim } else { 'AUSENTE' })"
Write-Host "  PATH persistente contem WinGet Links: $((([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') -contains (Split-Path -Parent $hermesShim)))"
$hermesTargets = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "Packages") -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "LocalCache\Local\hermes\hermes-agent\bin\hermes.exe" }) +
    @((Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\bin\hermes.exe"))
$realHermes = $hermesTargets | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
Write-Host "  Executavel oficial fisico: $(if ($realHermes) { $realHermes } else { 'AUSENTE' })"
Write-Host "  Diretorio fisico no PATH persistente: $([bool]($realHermes -and (([Environment]::GetEnvironmentVariable('Path', 'User') -split ';') -contains (Split-Path -Parent $realHermes))))"
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
Write-Host "  Shim compartilhado: $(if (Test-Path -LiteralPath $grokShim) { $grokShim } else { 'AUSENTE' })"
Write-Host "  Origem pnpm: $(Join-Path $env:LOCALAPPDATA 'pnpm\bin\grok.CMD')"
$documents = [Environment]::GetFolderPath("MyDocuments")
$profilePaths = @(
    (Join-Path $documents "PowerShell\profile.ps1"),
    (Join-Path $documents "WindowsPowerShell\profile.ps1")
)
Write-Host "`nCobertura de terminais PowerShell:"
foreach ($profilePath in $profilePaths) {
    $managed = (Test-Path -LiteralPath $profilePath) -and
        [bool](Select-String -LiteralPath $profilePath -SimpleMatch "# >>> AI Workstation Layer 2 PATH >>>" -Quiet)
    $guardrail = $managed -and
        [bool](Select-String -LiteralPath $profilePath -SimpleMatch "Atualizacao direta do Hermes bloqueada" -Quiet)
    Write-Host "  $profilePath : $(if ($managed) { 'GERENCIADO' } else { 'AUSENTE' }); guardrail update: $guardrail"
}
Write-Host "  PATHEXT aceita .CMD: $((($env:PATHEXT -split ';') -contains '.CMD'))"
if ($missing.Count -or $missingDesktop.Count -or -not $routeValid) {
    Write-Host "`n$($missing.Count) CLI(s) e $($missingDesktop.Count) aplicativo(s) desktop ausente(s). Execute 07-layer2-agent-clis.ps1." -ForegroundColor Yellow
    exit 1
}
Write-Host "`nAplicativos desktop e CLIs detectados. Autenticacao continua manual e nao foi inspecionada." -ForegroundColor Green
