param([ValidateSet("01", "07")][string]$Only, [switch]$WhatIf)
$ErrorActionPreference = "Stop"
Write-Host "AI Foundry Desk — Multi-Agent Workbench"
if (-not $Only) { Write-Host "No layer applied. Use -Only 01 or -Only 07, first with -WhatIf."; exit 0 }
$scripts = if ($Only -eq "01") { @("01-layer1-runtime.ps1") } else { @("07-layer2-agent-clis.ps1", "07-layer2-common-toolbox.ps1") }
foreach ($name in $scripts) { $path = Join-Path $PSScriptRoot "scripts\$name"; if ($WhatIf) { & $path -WhatIf } else { & $path } }
