[CmdletBinding()]
param([switch]$WhatIf, [switch]$Confirm)
$ErrorActionPreference = "Stop"
$tag = "v2026.8.19"
$expectedHash = "74225bf244253bfa5bc2b1d16fa3bb8618e199a53d1c0344b37ab9930696d3ba"
$installerUrl = "https://raw.githubusercontent.com/NousResearch/hermes-agent/$tag/scripts/install.ps1"
$backupRoot = Join-Path $env:LOCALAPPDATA "AI Foundry Desk\backups\hermes-update"

function Find-HermesRoot {
    $packages = Join-Path $env:LOCALAPPDATA "Packages"
    foreach ($package in @(Get-ChildItem -LiteralPath $packages -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue)) {
        $candidate = Join-Path $package.FullName "LocalCache\Local\hermes\hermes-agent"
        if (Test-Path -LiteralPath $candidate -PathType Container) { return $candidate }
    }
    $direct = Join-Path $env:LOCALAPPDATA "hermes\hermes-agent"
    if (Test-Path -LiteralPath $direct -PathType Container) { return $direct }
    return $direct
}

$sourceRoot = Find-HermesRoot
$managedHome = Join-Path $env:USERPROFILE ".afd\managed\hermes"
$managedRoot = Join-Path $managedHome "hermes-agent"
if ($WhatIf) {
    Write-Host "[WhatIf] Hermes update ${tag}: install under isolated LOCALAPPDATA staging, verify SHA256/version, preserve existing skills, atomically publish $managedRoot, and restore the prior launcher/managed root on failure."
    exit 0
}
if (-not $Confirm) { throw "Hermes update requires -Confirm after -WhatIf preview." }
$env:Path = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User")) -join ";"
if (-not (Get-Command mise -ErrorAction SilentlyContinue)) { throw "mise is required." }

$stage = Join-Path ([IO.Path]::GetTempPath()) ("afd-hermes-update-" + [guid]::NewGuid().ToString("N"))
$snapshot = Join-Path $backupRoot (Get-Date -Format "yyyyMMdd-HHmmss-fffffff")
$launcher = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\hermes.cmd"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$published = $false
try {
    $installer = Join-Path $stage "install.ps1"
    Invoke-WebRequest -Uri $installerUrl -OutFile $installer -UseBasicParsing
    $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expectedHash) { throw "Hermes installer checksum mismatch. Expected $expectedHash; observed $actual." }
    New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
    if (Test-Path -LiteralPath $launcher -PathType Leaf) { Copy-Item -LiteralPath $launcher -Destination (Join-Path $snapshot "hermes.cmd") -Force }
    try {
        $pythonRoot = (& mise where "python@3.11" | Select-Object -First 1)
        if (-not $pythonRoot) { mise install "python@3.11"; $pythonRoot = (& mise where "python@3.11" | Select-Object -First 1) }
        $misePython = Join-Path $pythonRoot "python.exe"
        $env:UV_PYTHON = $misePython
        $env:Path = "$pythonRoot;$env:Path"
        $env:UV_NO_MANAGED_PYTHON = "1"; $env:UV_PYTHON_DOWNLOADS = "0"; $env:MISE_LAYER1_NONINTERACTIVE = "1"
        $stageHermesHome = Join-Path $stage "hermes"
        $updated = Join-Path $stageHermesHome "hermes-agent"
        New-Item -ItemType Directory -Path $stageHermesHome -Force | Out-Null
        $installerText = Get-Content -Raw -LiteralPath $installer
        $pythonContract = '(?m)^\$PythonVersion\s*=\s*"3\.11"\s*$'
        if ([regex]::Matches($installerText,$pythonContract).Count -ne 1) { throw "Pinned Hermes installer Python contract changed; refusing to patch staging adapter." }
        $installerText = [regex]::Replace($installerText,$pythonContract,('$PythonVersion = "' + $misePython + '"'))
        Set-Content -LiteralPath $installer -Value $installerText -Encoding UTF8 -NoNewline
        $previousUserPath = (([Environment]::GetEnvironmentVariable("Path", "User") -split ";" |
            Where-Object { $_ -and $_ -notmatch '(?i)[\\/]afd-hermes-update-[^\\/]+[\\/]' }) -join ";")
        $previousHermesHome = [Environment]::GetEnvironmentVariable("HERMES_HOME", "User")
        @{ path = $previousUserPath; hermesHome = $previousHermesHome } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $snapshot "environment.json") -Encoding UTF8
        $oldConfigCount=$env:GIT_CONFIG_COUNT;$oldConfigKey=$env:GIT_CONFIG_KEY_0;$oldConfigValue=$env:GIT_CONFIG_VALUE_0
        try {
            $env:GIT_CONFIG_COUNT="1";$env:GIT_CONFIG_KEY_0="core.longpaths";$env:GIT_CONFIG_VALUE_0="true"
            $installOutput = (& $installer -SkipSetup -SkipComputerUse -Tag $tag -HermesHome $stageHermesHome -InstallDir $updated 2>&1 | Out-String)
        }
        finally {
            [Environment]::SetEnvironmentVariable("Path",$previousUserPath,"User")
            [Environment]::SetEnvironmentVariable("HERMES_HOME",$previousHermesHome,"User")
            $env:GIT_CONFIG_COUNT=$oldConfigCount;$env:GIT_CONFIG_KEY_0=$oldConfigKey;$env:GIT_CONFIG_VALUE_0=$oldConfigValue
        }
        $installOutput | Write-Host
        if ($installOutput -match '\[X\]\s+Installation failed' -or $installOutput -match 'Failed to create virtual environment') { throw "Upstream Hermes installer reported failure." }
        $python = Join-Path $updated "venv\Scripts\python.exe"
        if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "Updated Hermes Python environment is missing." }
        Push-Location $updated
        try { $stagedVersion = (& $python -m hermes_cli.main --version 2>&1 | Out-String) } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0 -or $stagedVersion -notmatch [regex]::Escape($tag.TrimStart("v"))) { throw "Staged Hermes version validation failed." }
        $skillSources=@((Join-Path (Split-Path $sourceRoot -Parent) "skills"),(Join-Path $sourceRoot "skills"))
        foreach($sourceSkills in $skillSources){if(Test-Path -LiteralPath $sourceSkills -PathType Container){& robocopy.exe $sourceSkills (Join-Path $stageHermesHome "skills") /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /SL /NFL /NDL /NJH /NJS /NP|Out-Null;if($LASTEXITCODE -gt 7){throw "Could not preserve existing Hermes skills."}}}
        if (Test-Path -LiteralPath $managedHome -PathType Container) { Move-Item -LiteralPath $managedHome -Destination (Join-Path $snapshot "managed-hermes") }
        New-Item -ItemType Directory -Path $managedHome -Force | Out-Null
        $published = $true
        & robocopy.exe $stageHermesHome $managedHome /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /SL /NFL /NDL /NJH /NJS /NP | Out-Null
        if($LASTEXITCODE -gt 7){throw "Publishing staged Hermes failed with robocopy code $LASTEXITCODE."}
        $managedPython = Join-Path $managedRoot "venv\Scripts\python.exe"
        $shim = "@echo off`r`nsetlocal`r`npushd `"$managedRoot`"`r`n`"$managedPython`" -m hermes_cli.main %*`r`nset `"_hermes_exit=%ERRORLEVEL%`"`r`npopd`r`nexit /b %_hermes_exit%`r`n"
        New-Item -ItemType Directory -Path (Split-Path $launcher -Parent) -Force | Out-Null
        Set-Content -LiteralPath $launcher -Value $shim -Encoding ascii -NoNewline
        $observed = (& $launcher --version 2>&1 | Out-String)
        $observed | Write-Host
        if ($LASTEXITCODE -ne 0) { throw "Hermes validation failed after update." }
        if ($observed -notmatch [regex]::Escape($tag.TrimStart("v"))) { throw "Hermes version does not match pinned tag $tag." }
    }
    catch {
        if ($published -and (Test-Path -LiteralPath $managedHome -PathType Container)) {
            Move-Item -LiteralPath $managedHome -Destination (Join-Path $snapshot "failed-managed-hermes")
        }
        if (Test-Path -LiteralPath (Join-Path $snapshot "managed-hermes") -PathType Container) { Move-Item -LiteralPath (Join-Path $snapshot "managed-hermes") -Destination $managedHome }
        if (Test-Path -LiteralPath (Join-Path $snapshot "hermes.cmd")) { Copy-Item -LiteralPath (Join-Path $snapshot "hermes.cmd") -Destination $launcher -Force }
        if (Test-Path -LiteralPath (Join-Path $snapshot "environment.json")) { $prior=Get-Content -Raw (Join-Path $snapshot "environment.json")|ConvertFrom-Json;[Environment]::SetEnvironmentVariable("Path",$prior.path,"User");[Environment]::SetEnvironmentVariable("HERMES_HOME",$prior.hermesHome,"User") }
        throw "Hermes update failed; the prior launcher/managed root were restored and the virtualized installation was never modified: $($_.Exception.Message)"
    }
}
finally { if (Test-Path -LiteralPath $stage) { try { Remove-Item -LiteralPath $stage -Recurse -Force } catch { Write-Warning "Staging cleanup requires manual review: $stage" } } }
Write-Host "Hermes $tag update validated. Backup: $snapshot" -ForegroundColor Green
