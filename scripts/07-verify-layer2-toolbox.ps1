<# .SYNOPSIS Verificacao somente leitura da Common Agent Toolbox da Layer 2. #>
param([switch]$WhatIf)
$ErrorActionPreference = "Continue"
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
    [Environment]::GetEnvironmentVariable("Path", "User")
$tools = @(
    [PSCustomObject]@{ Command = "rg"; Package = "BurntSushi.ripgrep.MSVC"; Purpose = "busca de texto" },
    [PSCustomObject]@{ Command = "fd"; Package = "sharkdp.fd"; Purpose = "busca de arquivos" },
    [PSCustomObject]@{ Command = "jq"; Package = "jqlang.jq"; Purpose = "JSON" },
    [PSCustomObject]@{ Command = "yq"; Package = "MikeFarah.yq"; Purpose = "YAML" },
    [PSCustomObject]@{ Command = "bat"; Package = "sharkdp.bat"; Purpose = "arquivos" },
    [PSCustomObject]@{ Command = "delta"; Package = "dandavison.delta"; Purpose = "diffs" }
)
$rows = foreach ($tool in $tools) {
    $found = Get-Command $tool.Command -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    $version = if ($found) { try { [string](& $found.Source --version 2>&1 | Select-Object -First 1) } catch { "indisponivel" } } else { "-" }
    [PSCustomObject]@{ Command = $tool.Command; Status = if ($found) { "INSTALADO" } else { "AUSENTE" }; Version = $version; Source = if ($found) { $found.Source } else { "-" }; Method = "WinGet: $($tool.Package)"; Purpose = $tool.Purpose }
}
$rows | Format-Table -AutoSize -Wrap
Write-Host "RTK: EXCLUIDO DELIBERADAMENTE (nao instalado por esta automacao)."
if (@($rows | Where-Object Status -ne "INSTALADO").Count) { exit 1 }
Write-Host "Common Agent Toolbox detectada. Nenhum alias global de cat/git foi configurado." -ForegroundColor Green
