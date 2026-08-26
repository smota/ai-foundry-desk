param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "BackupPolicy.ps1")
$root = Get-AiWorkstationBackupRoot
$rows = @(Get-BackupPolicyReport -Root $root)
$totalBytes = if ($rows.Count) { ($rows | Measure-Object Bytes -Sum).Sum } else { 0 }
$totalSnapshots = if ($rows.Count) { ($rows | Measure-Object Snapshots -Sum).Sum } else { 0 }
Write-Host "Raiz controlada: $root"
$rows | Format-Table -AutoSize
if ($null -eq $totalBytes) { $totalBytes = 0 }
Write-Host "Alvos: $($rows.Count); snapshots: $totalSnapshots; bytes: $([long]$totalBytes)"
if (@($rows | Where-Object RetentionViolations -GT 0).Count) { throw "Retencao nao conforme." }
Write-Host "Retencao conforme: 3 snapshots mais recentes protegidos; excedentes com mais de 30 dias ausentes."
