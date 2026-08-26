param([switch]$WhatIf)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "BackupPolicy.ps1")
$root = Get-AiWorkstationBackupRoot
Write-Host "Raiz de backups: $root"
if ($WhatIf -and -not (Test-Path -LiteralPath $root)) { Write-Host "[WhatIf] Criaria a raiz controlada: $root" }
$removed = @(Invoke-BackupRetention -Root $root -WhatIf:$WhatIf)
if (-not $WhatIf -and -not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root -Force | Out-Null }
Write-Host "Snapshots removidos: $($removed.Count)"
