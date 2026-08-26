Set-StrictMode -Version Latest

function Get-AiWorkstationBackupRoot {
    if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA nao esta definido." }
    return [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "ai-workstation\backups"))
}

function Assert-BackupPath {
    param([Parameter(Mandatory)][string]$Path, [string]$Root = (Get-AiWorkstationBackupRoot))
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $pathFull = [IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Operacao recusada fora da raiz controlada: $pathFull"
    }
    return $pathFull
}

function Backup-ManagedFile {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Target,
          [switch]$WhatIf, [string]$Root = (Get-AiWorkstationBackupRoot))
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return $null }
    if ($Target -notmatch '^[a-z0-9][a-z0-9._-]*$') { throw "Nome de alvo de backup invalido: $Target" }
    $snapshot = Join-Path (Join-Path $Root $Target) (Get-Date -Format 'yyyyMMdd-HHmmss-fffffff')
    $null = Assert-BackupPath -Path $snapshot -Root $Root
    $destination = Join-Path $snapshot (Split-Path -Leaf $Source)
    if ($WhatIf) { Write-Host "  [WhatIf] Criaria backup: $destination"; return $destination }
    New-Item -ItemType Directory -Path $snapshot -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $destination
    Write-Host "  Backup: $destination"
    Invoke-BackupRetention -Root $Root | Out-Null
    return $destination
}

function Invoke-BackupRetention {
    param([switch]$WhatIf, [string]$Root = (Get-AiWorkstationBackupRoot), [int]$Keep = 3, [int]$MaxAgeDays = 30)
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
    $cutoff = (Get-Date).AddDays(-$MaxAgeDays); $removed = @()
    foreach ($target in Get-ChildItem -LiteralPath $Root -Directory) {
        $snapshots = @(Get-ChildItem -LiteralPath $target.FullName -Directory | Sort-Object LastWriteTime -Descending)
        foreach ($snapshot in @($snapshots | Select-Object -Skip $Keep | Where-Object LastWriteTime -LT $cutoff)) {
            $safe = Assert-BackupPath -Path $snapshot.FullName -Root $Root
            if ($WhatIf) { Write-Host "  [WhatIf] Removeria snapshot expirado: $safe" }
            else { Remove-Item -LiteralPath $safe -Recurse -Force }
            $removed += $safe
        }
    }
    return $removed
}

function Get-BackupPolicyReport {
    param([string]$Root = (Get-AiWorkstationBackupRoot), [int]$Keep = 3, [int]$MaxAgeDays = 30)
    $rows = @(); $cutoff = (Get-Date).AddDays(-$MaxAgeDays)
    if (Test-Path -LiteralPath $Root -PathType Container) {
        foreach ($target in Get-ChildItem -LiteralPath $Root -Directory) {
            $snapshots = @(Get-ChildItem -LiteralPath $target.FullName -Directory | Sort-Object LastWriteTime -Descending)
            $bytes = (Get-ChildItem -LiteralPath $target.FullName -File -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
            $violations = @($snapshots | Select-Object -Skip $Keep | Where-Object LastWriteTime -LT $cutoff).Count
            if ($null -eq $bytes) { $bytes = 0 }
            $rows += [pscustomobject]@{ Target=$target.Name; Snapshots=$snapshots.Count; Bytes=[long]$bytes; RetentionViolations=$violations }
        }
    }
    return $rows
}
