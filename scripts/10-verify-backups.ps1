param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "BackupPolicy.ps1")
$root = Get-AiWorkstationBackupRoot
$rows = @(Get-BackupPolicyReport -Root $root)
$totalBytes = if ($rows.Count) { ($rows | Measure-Object Bytes -Sum).Sum } else { 0 }
$totalSnapshots = if ($rows.Count) { ($rows | Measure-Object Snapshots -Sum).Sum } else { 0 }
Write-Host "Controlled root: $root"
$rows | Format-Table -AutoSize
if ($null -eq $totalBytes) { $totalBytes = 0 }
Write-Host "Targets: $($rows.Count); snapshots: $totalSnapshots; bytes: $([long]$totalBytes)"
if (@($rows | Where-Object RetentionViolations -GT 0).Count) { throw "Backup retention is not compliant." }
Write-Host "Retention compliant: the 3 newest snapshots are protected and no expired excess snapshots remain."
