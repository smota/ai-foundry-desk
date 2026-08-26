<#
.SYNOPSIS
    07 - Installs the initial Layer 2 agent CLI set.
.DESCRIPTION
    Installs only Claude Code, Codex CLI, Antigravity CLI, Pi, Hermes Agent, and Grok Build.
    Does not authenticate, configure skills, or install the legacy Paperclip stack.
#>
param([switch]$WhatIf)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "BackupPolicy.ps1")

function Refresh-UserEnvironment {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
        [Environment]::GetEnvironmentVariable("Path", "User")
    foreach ($name in "UV_NO_MANAGED_PYTHON", "UV_PYTHON_DOWNLOADS", "PNPM_HOME") {
        $value = [Environment]::GetEnvironmentVariable($name, "User")
        if ($null -ne $value) { Set-Item -Path "Env:$name" -Value $value }
    }
}

function Test-AgentCommand {
    param([string]$Command)
    return [bool](Get-Command $Command -CommandType Application,ExternalScript -ErrorAction SilentlyContinue)
}

function Test-WingetPackage {
    param([string]$PackageId)
    return [bool](winget list --id $PackageId -e --accept-source-agreements 2>$null |
        Select-String -SimpleMatch $PackageId)
}

function Add-UserPathEntry {
    param([string]$PathEntry)
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($userPath -split ";" | Where-Object { $_ })
    if ($entries -contains $PathEntry) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would add to user PATH: $PathEntry"
        return
    }
    [Environment]::SetEnvironmentVariable("Path", ((($entries + $PathEntry) -join ";") + ";"), "User")
}

function Remove-HermesUserPathEntries {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $entries = @($userPath -split ";" | Where-Object { $_ })
    $kept = @($entries | Where-Object {
        $normalized = $_.TrimEnd("\")
        -not ($normalized -match '(?i)\\hermes\\bin$' -or
              $normalized -match '(?i)\\hermes\\hermes-agent\\bin$')
    })
    if ($kept.Count -eq $entries.Count) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would remove user PATH entries that expose the hermes.exe trampoline."
        return
    }
    [Environment]::SetEnvironmentVariable("Path", (($kept -join ";") + ";"), "User")
}

function Publish-EnvironmentChange {
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would notify Windows about the persistent environment change."
        return
    }
    if (-not ("Layer2.NativeMethods" -as [type])) {
        Add-Type -Namespace Layer2 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam,
    string lParam, uint flags, uint timeout, out UIntPtr result);
"@
    }
    $result = [UIntPtr]::Zero
    [void][Layer2.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero,
        "Environment", 0x0002, 5000, [ref]$result)
}

function Ensure-Layer2PowerShellPathProfiles {
    $start = "# >>> AI Foundry Desk Layer 2 PATH >>>"
    $end = "# <<< AI Foundry Desk Layer 2 PATH <<<"
    $legacyStart = "# >>> AI Workstation Layer 2 PATH >>>"
    $legacyEnd = "# <<< AI Workstation Layer 2 PATH <<<"
    $block = @'
# >>> AI Foundry Desk Layer 2 PATH >>>
# Managed by AI Foundry Desk. Legacy markers are preserved for idempotent upgrades.
$env:Path = (@($env:Path -split ";" | Where-Object {
    $normalized = $_.TrimEnd("\")
    -not ($normalized -match '(?i)\\hermes\\bin$' -or
          $normalized -match '(?i)\\hermes\\hermes-agent\\bin$')
}) -join ";")
foreach ($layer2Path in @(
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"),
    (Join-Path $env:LOCALAPPDATA "pnpm\bin")
)) {
    if ((Test-Path -LiteralPath $layer2Path) -and (($env:Path -split ";") -notcontains $layer2Path)) {
        $env:Path = "$layer2Path;$env:Path"
    }
}

function hermes {
    $interactiveUpdate = [Environment]::UserInteractive -and
        -not $env:CI -and
        -not $env:MISE_LAYER1_NONINTERACTIVE -and
        [string]::IsNullOrEmpty($MyInvocation.ScriptName) -and
        $args.Count -gt 0 -and
        [string]$args[0] -eq "update"
    if ($interactiveUpdate) {
        Write-Warning "Direct Hermes updates are blocked. Wait for the verified AI Foundry Desk update workflow."
        return
    }
    $launcher = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\hermes.cmd"
    & $launcher @args
}
# <<< AI Foundry Desk Layer 2 PATH <<<
'@
    $documents = [Environment]::GetFolderPath("MyDocuments")
    $profiles = @(
        (Join-Path $documents "PowerShell\profile.ps1"),
        (Join-Path $documents "WindowsPowerShell\profile.ps1")
    )
    foreach ($profilePath in $profiles) {
        $content = if (Test-Path -LiteralPath $profilePath) { Get-Content -Raw -LiteralPath $profilePath } else { "" }
        if ($null -eq $content) { $content = "" }
        $pattern = "(?s)" + [regex]::Escape($start) + ".*" + [regex]::Escape($end)
        $legacyPattern = "(?s)" + [regex]::Escape($legacyStart) + ".*" + [regex]::Escape($legacyEnd)
        $content = [regex]::Replace($content, $legacyPattern, "")
        $updated = if ($content -match $pattern) {
            [regex]::Replace($content, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) $block.Trim() })
        } else {
            ($content.TrimEnd() + "`r`n`r`n" + $block.Trim() + "`r`n").TrimStart("`r", "`n")
        }
        if ($updated -eq $content) { continue }
        if ($WhatIf) {
            Write-Host "  [WhatIf] Atualizaria o bloco PATH da Layer 2 em $profilePath."
            continue
        }
        $profileDir = Split-Path -Parent $profilePath
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        if (Test-Path -LiteralPath $profilePath) {
            $targetName = "layer2-profile-" + ((Split-Path -Leaf $profileDir).ToLowerInvariant())
            Backup-ManagedFile -Source $profilePath -Target $targetName | Out-Null
        }
        Set-Content -LiteralPath $profilePath -Value $updated -Encoding utf8
    }
}

function Ensure-CodexShim {
    if (Test-AgentCommand "codex") { return }
    if (-not (Test-WingetPackage "OpenAI.Codex")) { return }

    $packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe"
    $codexExe = Join-Path $packageRoot "codex-x86_64-pc-windows-msvc.exe"
    $pnpmHome = [Environment]::GetEnvironmentVariable("PNPM_HOME", "User")
    $shimDir = Join-Path $pnpmHome "bin"
    $shimPath = Join-Path $shimDir "codex.cmd"
    if (-not (Test-Path -LiteralPath $codexExe -PathType Leaf)) { return }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would create codex.cmd in $shimDir for the WinGet binary."
        return
    }
    New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
    $shimContent = "@echo off`r`n`"$codexExe`" %*`r`n"
    if (-not (Test-Path -LiteralPath $shimPath) -or (Get-Content -Raw -LiteralPath $shimPath) -ne $shimContent) {
        Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ascii -NoNewline
    }
    Refresh-UserEnvironment
}

function Resolve-HermesExecutable {
    $packagesRoot = Join-Path $env:LOCALAPPDATA "Packages"
    $virtualized = Get-ChildItem -LiteralPath $packagesRoot -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "LocalCache\Local\hermes\hermes-agent\bin\hermes.exe" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if ($virtualized) { return $virtualized }
    $direct = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\bin\hermes.exe"
    if (Test-Path -LiteralPath $direct -PathType Leaf) { return $direct }
    return $null
}

function Ensure-HermesShim {
    $hermesExe = Resolve-HermesExecutable
    if (-not (Test-Path -LiteralPath $hermesExe -PathType Leaf)) { return }
    $hermesRoot = Split-Path -Parent (Split-Path -Parent $hermesExe)
    $hermesPython = Join-Path $hermesRoot "venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $hermesPython -PathType Leaf)) { return }
    $shimDir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    $shimPath = Join-Path $shimDir "hermes.cmd"
    # The uv-created hermes.exe is a trampoline with an embedded logical path. MSIX apps may
    # virtualize that path, so invoke the official entry point through the existing venv.
    $shimContent = "@echo off`r`nsetlocal`r`npushd `"$hermesRoot`"`r`n`"$hermesPython`" -m hermes_cli.main %*`r`nset `"_hermes_exit=%ERRORLEVEL%`"`r`npopd`r`nexit /b %_hermes_exit%`r`n"
    if ((Test-Path -LiteralPath $shimPath) -and (Get-Content -Raw -LiteralPath $shimPath) -eq $shimContent) {
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would create hermes.cmd in $shimDir to invoke the virtual environment without the uv trampoline."
        return
    }
    New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
    if (Test-Path -LiteralPath $shimPath) {
        Backup-ManagedFile -Source $shimPath -Target "layer2-hermes-launcher" | Out-Null
    }
    Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ascii -NoNewline
}

function Ensure-GrokShim {
    $pnpmHome = [Environment]::GetEnvironmentVariable("PNPM_HOME", "User")
    if (-not $pnpmHome) { $pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm" }
    $grokCmd = Join-Path $pnpmHome "bin\grok.CMD"
    if (-not (Test-Path -LiteralPath $grokCmd -PathType Leaf)) { return }
    $shimDir = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
    $shimPath = Join-Path $shimDir "grok.cmd"
    $shimContent = "@echo off`r`ncall `"$grokCmd`" %*`r`n"
    if ((Test-Path -LiteralPath $shimPath) -and (Get-Content -Raw -LiteralPath $shimPath) -eq $shimContent) {
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would create grok.cmd in $shimDir to avoid stale inherited PATH state."
        return
    }
    New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
    if (Test-Path -LiteralPath $shimPath) {
        Backup-ManagedFile -Source $shimPath -Target "layer2-grok-launcher" | Out-Null
    }
    Set-Content -LiteralPath $shimPath -Value $shimContent -Encoding ascii -NoNewline
}

function Install-DesktopAppsIfMissing {
    if (Test-WingetPackage "Anthropic.Claude") {
        Write-Host "  Claude Desktop is already installed; no reinstall will be performed."
    }
    elseif ($WhatIf) {
        Write-Host "  [WhatIf] Would install Claude Desktop with WinGet (Anthropic.Claude)."
    }
    else {
        winget install --id Anthropic.Claude -e --source winget `
            --accept-package-agreements --accept-source-agreements
    }

    $codexDesktop = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue |
        Where-Object Status -eq "Ok" | Select-Object -First 1
    if ($codexDesktop) {
        Write-Host "  Codex Desktop is already installed and registered; no reinstall will be performed."
    }
    else {
        Write-Warning "Codex Desktop was not detected. No suitable official WinGet package exists; install it through the official channel/Microsoft Store and retry."
    }
}

function Install-WingetAgentIfMissing {
    param([string]$Name, [string]$Command, [string]$PackageId)
    if (Test-AgentCommand $Command) {
        Write-Host "  $Name is already functional; no reinstall will be performed."
        return
    }
    if (Test-WingetPackage $PackageId) {
        Write-Warning "$Name is registered in WinGet, but its alias is not visible in this session. No reinstall or update will be attempted."
        return
    }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would install $Name with WinGet ($PackageId)."
        return
    }
    winget install --id $PackageId -e --source winget `
        --accept-package-agreements --accept-source-agreements
    Refresh-UserEnvironment
    if (-not (Test-AgentCommand $Command)) {
        if (Test-WingetPackage $PackageId) {
            Write-Warning "$Name is registered in WinGet, but its alias is not visible yet. Final validation will run in a new PowerShell."
            return
        }
        throw "$Name is neither functional nor registered in WinGet."
    }
}

function Install-PiIfMissing {
    if (Test-AgentCommand "pi") {
        Write-Host "  Pi is already functional; no reinstall will be performed."
        return
    }
    if (-not (Test-AgentCommand "pnpm")) { throw "pnpm was not found; validate Layer 1 first." }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would install Pi from the official @earendil-works/pi-coding-agent package with pnpm global and scripts disabled."
        return
    }
    pnpm add --global --ignore-scripts @earendil-works/pi-coding-agent
    Refresh-UserEnvironment
    if (-not (Test-AgentCommand "pi")) { throw "Pi was installed but was not found on PATH." }
}

function Install-GrokIfMissing {
    Ensure-GrokShim
    if (Test-AgentCommand "grok") {
        Write-Host "  Grok Build is already functional; no reinstall will be performed."
        return
    }
    if (-not (Test-AgentCommand "pnpm")) { throw "pnpm nao encontrado; valide a Layer 1 primeiro." }
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would install Grok Build from the official @xai-official/grok package with pnpm global."
        return
    }
    # The official package uses postinstall to materialize the executable; do not disable scripts here.
    pnpm add --global @xai-official/grok
    Refresh-UserEnvironment
    Ensure-GrokShim
    if (-not (Test-AgentCommand "grok")) { throw "Grok Build was installed but was not found on PATH." }
}

function Install-HermesIfMissing {
    $hermesExe = Resolve-HermesExecutable
    $hermesBin = if ($hermesExe) { Split-Path -Parent $hermesExe } else { Join-Path $env:LOCALAPPDATA "hermes\hermes-agent\bin" }
    Ensure-HermesShim
    Remove-HermesUserPathEntries
    if (-not $WhatIf) { Refresh-UserEnvironment }
    if (Test-AgentCommand "hermes") {
        Write-Host "  Hermes is already functional; no reinstall will be performed."
        return
    }

    $tag = "v2026.8.19"
    $installerUrl = "https://raw.githubusercontent.com/NousResearch/hermes-agent/$tag/scripts/install.ps1"
    $expectedHash = "74225bf244253bfa5bc2b1d16fa3bb8618e199a53d1c0344b37ab9930696d3ba"
    if ($WhatIf) {
        Write-Host "  [WhatIf] Would ensure Python 3.11 through mise without making it global."
        Write-Host "  [WhatIf] Baixaria o instalador Hermes $tag, confirmaria SHA256 $expectedHash e executaria -SkipSetup -SkipComputerUse."
        return
    }
    if (-not (Test-AgentCommand "mise")) { throw "mise was not found; validate Layer 1 first." }

    mise install "python@3.11"
    $hermesPython = (& mise where "python@3.11" | Select-Object -First 1)
    if (-not $hermesPython) { throw "Could not prepare Python 3.11 through mise for Hermes." }
    $hermesPythonExe = Join-Path $hermesPython "python.exe"
    if (-not (Test-Path -LiteralPath $hermesPythonExe -PathType Leaf)) {
        throw "mise Python 3.11 was not found at $hermesPythonExe."
    }

    $source = [string](Invoke-RestMethod -Uri $installerUrl)
    $bytes = [Text.Encoding]::UTF8.GetBytes($source)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $actualHash = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally { $sha.Dispose() }
    if ($actualHash -ne $expectedHash) {
        throw "Unexpected hash for Hermes installer $tag. Expected: $expectedHash; observed: $actualHash."
    }

    # O instalador pede Python 3.11. Exponha apenas o runtime gerido pelo mise nesta sessao.
    $previousPath = $env:Path
    $previousUvPython = $env:UV_PYTHON
    $previousNonInteractive = $env:MISE_LAYER1_NONINTERACTIVE
    $previousUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $temporaryUserPath = "$hermesPython;$previousUserPath"
    [Environment]::SetEnvironmentVariable("Path", $temporaryUserPath, "User")
    $env:Path = "$hermesPython;$env:Path"
    $env:UV_PYTHON = $hermesPythonExe
    $env:MISE_LAYER1_NONINTERACTIVE = "1"
    $env:UV_NO_MANAGED_PYTHON = "1"
    $env:UV_PYTHON_DOWNLOADS = "0"
    try {
        $cleanSource = $source.TrimStart([char]0xFEFF)
        & ([scriptblock]::Create($cleanSource)) -SkipSetup -SkipComputerUse -Tag $tag
    }
    finally {
        [Environment]::SetEnvironmentVariable("Path", $previousUserPath, "User")
        $env:Path = $previousPath
        if ($null -eq $previousUvPython) { Remove-Item Env:UV_PYTHON -ErrorAction SilentlyContinue }
        else { $env:UV_PYTHON = $previousUvPython }
        if ($null -eq $previousNonInteractive) { Remove-Item Env:MISE_LAYER1_NONINTERACTIVE -ErrorAction SilentlyContinue }
        else { $env:MISE_LAYER1_NONINTERACTIVE = $previousNonInteractive }
    }

    Refresh-UserEnvironment
    $hermesExe = Resolve-HermesExecutable
    $hermesBin = Split-Path -Parent $hermesExe
    Remove-HermesUserPathEntries
    Refresh-UserEnvironment
    Ensure-HermesShim
    if (-not (Test-AgentCommand "hermes")) {
        throw "Hermes was installed, but its command was not found on persistent PATH. Open a new PowerShell and run the verifier."
    }
}

Refresh-UserEnvironment
if (-not (Test-AgentCommand "winget")) { throw "WinGet was not found." }

Write-Host "Installing the core Layer 2 agents..."
Install-DesktopAppsIfMissing
Install-WingetAgentIfMissing -Name "Claude Code" -Command "claude" -PackageId "Anthropic.ClaudeCode"
Install-WingetAgentIfMissing -Name "Codex CLI" -Command "codex" -PackageId "OpenAI.Codex"
Ensure-CodexShim
Install-WingetAgentIfMissing -Name "Antigravity CLI" -Command "agy" -PackageId "Google.AntigravityCLI"
Install-PiIfMissing
Install-HermesIfMissing
Install-GrokIfMissing
Ensure-Layer2PowerShellPathProfiles
Publish-EnvironmentChange

Write-Host "`nInstallation complete. No login was performed." -ForegroundColor Green
Write-Host "Abra um novo PowerShell e execute .\scripts\07-verify-layer2-agent-clis.ps1."
