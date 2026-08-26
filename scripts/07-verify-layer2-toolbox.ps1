<# .SYNOPSIS Read-only verification of the Layer 2 Common Agent Toolbox. #>
param([switch]$WhatIf)
$ErrorActionPreference = "Continue"
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
$tools = @(
    [PSCustomObject]@{ Command = "rg"; Package = "BurntSushi.ripgrep.MSVC"; Purpose = "text search" },
    [PSCustomObject]@{ Command = "fd"; Package = "sharkdp.fd"; Purpose = "file search" },
    [PSCustomObject]@{ Command = "jq"; Package = "jqlang.jq"; Purpose = "JSON" },
    [PSCustomObject]@{ Command = "yq"; Package = "MikeFarah.yq"; Purpose = "YAML/TOML" },
    [PSCustomObject]@{ Command = "bat"; Package = "sharkdp.bat"; Purpose = "source reading" },
    [PSCustomObject]@{ Command = "delta"; Package = "dandavison.delta"; Purpose = "diffs" }
)
$rows = foreach ($tool in $tools) { $found = Get-Command $tool.Command -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1; $version = if ($found) { try { [string](& $found.Source --version 2>&1 | Select-Object -First 1) } catch { "unavailable" } } else { "-" }; [PSCustomObject]@{ Command=$tool.Command; Status=if($found){"INSTALLED"}else{"MISSING"}; Version=$version; Source=if($found){$found.Source}else{"-"}; Method="WinGet: $($tool.Package)"; Purpose=$tool.Purpose } }
$rows | Format-Table -AutoSize -Wrap
Write-Host "RTK: DELIBERATELY EXCLUDED (not installed by this automation)."
if (@($rows | Where-Object Status -ne "INSTALLED").Count) { exit 1 }
Write-Host "Common Agent Toolbox detected. No global cat/git alias was configured." -ForegroundColor Green
