<#
.SYNOPSIS
    01 - Layer 1: base nativa, verificavel e isolada por projeto.
.DESCRIPTION
    Instala mise, uv e pnpm; fixa Python 3.14, Node 24 LTS, Go 1.26 e Rust 1.98.0;
    adiciona os shims do mise ao PATH persistente; e mantem guardrails somente para comandos
    digitados interativamente. Scripts e automacoes continuam chamando os executaveis reais.
    Opera no escopo do usuario e nao exige elevacao administrativa.
.PARAMETER WhatIf
    Mostra as mudancas planejadas sem instalar pacotes nem alterar PATH/perfil.
#>
param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "BackupPolicy.ps1")

$toolVersions = [ordered]@{
    python = "3.14"
    node   = "24"
    go     = "1.26"
    rust   = "1.98.0"
}

function Install-WingetPackageIfMissing {
    param([string]$WingetId, [string]$FriendlyName)

    $installed = winget list --id $WingetId -e --accept-source-agreements 2>$null |
        Select-String -SimpleMatch $WingetId
    if ($installed) {
        Write-Host "  $FriendlyName ja esta registrado no winget."
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Instalaria $FriendlyName via winget ($WingetId)"
        return
    }

    winget install --id $WingetId -e --source winget `
        --accept-package-agreements --accept-source-agreements
}

function Add-UserPathEntry {
    param([string]$PathEntry)

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($userPath -split ";" | Where-Object { $_ })
    if ($entries -contains $PathEntry) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Adicionaria ao PATH do usuario: $PathEntry"
        return
    }

    $newPath = (($entries + $PathEntry) -join ";") + ";"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Host "  PATH do usuario atualizado: $PathEntry"
}

function Set-UserEnvironmentVariableIfNeeded {
    param([string]$Name, [string]$Value)

    $current = [Environment]::GetEnvironmentVariable($Name, "User")
    if ($current -eq $Value) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Definiria $Name=$Value no ambiente do usuario."
        return
    }

    [Environment]::SetEnvironmentVariable($Name, $Value, "User")
    Write-Host "  Variavel do usuario atualizada: $Name=$Value"
}

function Update-PowerShellProfile {
    param([string]$ProfilePath)

    $profilePath = $ProfilePath
    $profileDir = Split-Path -Parent $profilePath
    $startMarker = "# >>> AI Workstation Layer 1 >>>"
    $endMarker = "# <<< AI Workstation Layer 1 <<<"

    $guardrailBlock = @'
# >>> AI Workstation Layer 1 >>>
# Managed by AI Foundry Desk. Legacy markers are preserved for idempotent upgrades.
$miseCommand = Get-Command mise -CommandType Application -ErrorAction SilentlyContinue
if ($miseCommand) {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        (& $miseCommand.Source activate pwsh) | Out-String | Invoke-Expression
    } else {
        (& $miseCommand.Source activate pwsh --shims) | Out-String | Invoke-Expression
    }
}

function Test-Layer1InteractiveCall {
    param([string]$CallerScriptName)
    return [Environment]::UserInteractive -and
        -not $env:CI -and
        -not $env:MISE_LAYER1_NONINTERACTIVE -and
        [string]::IsNullOrEmpty($CallerScriptName)
}

function Invoke-Layer1NativeCommand {
    param([string[]]$Names, [object[]]$Arguments)
    $native = Get-Command -Name $Names -CommandType Application,ExternalScript -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $native) { throw "Executavel nao encontrado: $($Names -join ', ')" }
    & $native.Source @Arguments
}

function pip {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Use 'uv add <pacote>' em projetos ou 'uv pip ...' dentro de uma .venv. pip global nao e o padrao desta estacao."
        return
    }
    Invoke-Layer1NativeCommand -Names @("pip.exe", "pip3.exe") -Arguments $args
}

function npm {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Use pnpm (por exemplo, 'pnpm add <pacote>'). Para compatibilidade explicita, chame npm.cmd."
        return
    }
    Invoke-Layer1NativeCommand -Names @("npm.cmd", "npm.exe") -Arguments $args
}

function npx {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Use 'pnpm dlx <pacote>@<versao>' ou um executavel ja fixado no projeto. Para compatibilidade explicita, chame npx.cmd."
        return
    }
    Invoke-Layer1NativeCommand -Names @("npx.cmd", "npx.exe") -Arguments $args
}

function fnm {
    if (Test-Layer1InteractiveCall -CallerScriptName $MyInvocation.ScriptName) {
        Write-Warning "Node.js e gerido pelo mise. Use 'mise use node@<versao>'."
        return
    }
    Invoke-Layer1NativeCommand -Names @("fnm.exe", "fnm.cmd") -Arguments $args
}
# <<< AI Workstation Layer 1 <<<
'@

    [string]$content = if (Test-Path -LiteralPath $profilePath) { Get-Content -Raw -LiteralPath $profilePath } else { "" }

    # Remove somente os trechos legados conhecidos que hoje falham ao abrir o PowerShell.
    $content = [string]($content -replace '(?m)^\s*fnm env --use-on-cd \| Out-String \| Invoke-Expression\s*\r?\n?', '')
    $legacyNpmPattern = '(?ms)^# Optimally add npm global bin to PATH \(Fixed single-quote bug\)\r?\nif \(-not \$global:npmPrefix\) \{\r?\n\s*\$global:npmPrefix = npm config get prefix\r?\n\}\r?\nif \(\$env:Path -notlike "\*\$global:npmPrefix\*"\) \{\r?\n\s*\$env:Path \+= ";\$global:npmPrefix"\r?\n\}\r?\n?'
    $content = [string]($content -replace $legacyNpmPattern, '')
    $managedPattern = "(?ms)^$([regex]::Escape($startMarker)).*?^$([regex]::Escape($endMarker))\s*\r?\n?"
    $content = [string]($content -replace $managedPattern, '')
    $newContent = $content.TrimEnd() + "`r`n`r`n" + $guardrailBlock.Trim() + "`r`n"

    if ((Test-Path -LiteralPath $profilePath) -and
        ((Get-Content -Raw -LiteralPath $profilePath).TrimEnd() -eq $newContent.TrimEnd())) {
        Write-Host "  Perfil do PowerShell ja esta atualizado."
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Atualizaria $profilePath apos criar backup."
        return
    }

    New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
    if (Test-Path -LiteralPath $profilePath) {
        Backup-ManagedFile -Source $profilePath -Target "layer1-powershell-profile" | Out-Null
    }
    [IO.File]::WriteAllText($profilePath, $newContent, (New-Object Text.UTF8Encoding($true)))
    Write-Host "  Perfil atualizado: $profilePath"
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget nao encontrado. Instale o App Installer antes de executar a Layer 1."
}

Write-Host "Instalando a base da Layer 1..."
Install-WingetPackageIfMissing -WingetId "jdx.mise" -FriendlyName "mise"
Install-WingetPackageIfMissing -WingetId "astral-sh.uv" -FriendlyName "uv"
Install-WingetPackageIfMissing -WingetId "pnpm.pnpm" -FriendlyName "pnpm"

$wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
$miseShims = Join-Path $env:LOCALAPPDATA "mise\shims"
$pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
$pnpmBin = Join-Path $pnpmHome "bin"
$uvExe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Filter "uv.exe" -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object FullName -Match '(?i)astral-sh\.uv' | Select-Object -First 1
$documentsDir = [Environment]::GetFolderPath("MyDocuments")
$profilePaths = @(
    (Join-Path $documentsDir "PowerShell\Microsoft.PowerShell_profile.ps1"),
    (Join-Path $documentsDir "WindowsPowerShell\Microsoft.PowerShell_profile.ps1")
)
Add-UserPathEntry -PathEntry $wingetLinks
Add-UserPathEntry -PathEntry $miseShims
if ($uvExe) { Add-UserPathEntry -PathEntry (Split-Path -Parent $uvExe.FullName) }
Set-UserEnvironmentVariableIfNeeded -Name "UV_NO_MANAGED_PYTHON" -Value "1"
Set-UserEnvironmentVariableIfNeeded -Name "UV_PYTHON_DOWNLOADS" -Value "0"
Set-UserEnvironmentVariableIfNeeded -Name "PNPM_HOME" -Value $pnpmHome
Add-UserPathEntry -PathEntry $pnpmBin

if (-not (Test-Path -LiteralPath $pnpmHome)) {
    if ($WhatIf) {
        Write-Host "  [WhatIf] Criaria o diretorio PNPM_HOME: $pnpmHome"
    } else {
        New-Item -ItemType Directory -Path $pnpmHome -Force | Out-Null
        Write-Host "  Diretorio PNPM_HOME criado: $pnpmHome"
    }
}

if ($WhatIf) {
    Write-Host "  [WhatIf] Configuraria Python 3.14, Node 24, Go 1.26 e Rust 1.98.0 no mise."
    Write-Host "  [WhatIf] Desabilitaria instalacao automatica de ferramentas ausentes no mise."
    $profilePaths | ForEach-Object { Update-PowerShellProfile -ProfilePath $_ }
    return
}

$env:UV_NO_MANAGED_PYTHON = "1"
$env:UV_PYTHON_DOWNLOADS = "0"
$env:PNPM_HOME = $pnpmHome
$env:Path = "$wingetLinks;$miseShims;$pnpmBin;$env:Path"
$mise = Get-Command mise -CommandType Application -ErrorAction SilentlyContinue
if (-not $mise) {
    throw "mise foi instalado, mas nao foi localizado em $wingetLinks. Abra um novo terminal e execute novamente."
}

Write-Host "`nConfigurando runtimes verificaveis..."
& $mise.Source settings set not_found_auto_install false
& $mise.Source use --global "python@$($toolVersions.python)" "node@$($toolVersions.node)" "go@$($toolVersions.go)" "rust@$($toolVersions.rust)"
& $mise.Source reshim

Write-Host "`nConfigurando o PowerShell..."
$profilePaths | ForEach-Object { Update-PowerShellProfile -ProfilePath $_ }

Write-Host "`nVerificando hardlinks no volume temporario..."
$testDir = Join-Path $env:TEMP "ai-workstation-layer1-hardlink"
if (Test-Path -LiteralPath $testDir) { throw "O diretorio de teste ja existe e nao sera sobrescrito: $testDir" }
New-Item -ItemType Directory -Path $testDir | Out-Null
$src = Join-Path $testDir "source.txt"
$link = Join-Path $testDir "link.txt"
try {
    Set-Content -LiteralPath $src -Value "layer1" -Encoding ascii
    New-Item -ItemType HardLink -Path $link -Target $src | Out-Null
    Write-Host "  Hardlink OK - o volume suporta o modelo CAS de uv/pnpm." -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $testDir -Recurse -Force
}

Write-Host "`nLayer 1 concluida. Abra um novo PowerShell e execute 01-verify-layer1.ps1." -ForegroundColor Green
