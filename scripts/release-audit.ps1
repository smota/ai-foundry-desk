[CmdletBinding()]
param([string]$PnpmPath, [string]$NodePath)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "afd-run-tree.ps1"
if (-not $PnpmPath) { $PnpmPath = Get-Command pnpm -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source }
if (-not $NodePath) { $NodePath = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source }
$env:Path = (Split-Path -Parent $NodePath) + ";" + $env:Path

function Invoke-Pnpm([string[]]$Arguments) {
    $executable = $PnpmPath
    $actual = $Arguments
    if ($PnpmPath -match '(?i)\.(cmd|bat)$') { $executable = "cmd.exe"; $actual = @("/d", "/s", "/c", "call", $PnpmPath) + $Arguments }
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($actual | ConvertTo-Json -Compress)))
    $priorPreference = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Executable $executable -ArgumentsBase64 $encoded -TimeoutMs 300000 -WorkingDirectory $root 2>&1 | Out-String
    $status = $LASTEXITCODE; $ErrorActionPreference = $priorPreference
    if ($status -ne 0) { throw "pnpm $($Arguments -join ' ') failed with code $($status): $($output.Trim())" }
    return $output.Trim()
}

Push-Location $root
try {
    [void](Invoke-Pnpm @("--filter", "@ai-foundry-desk/cli", "build"))
    $packOutput = Invoke-Pnpm @("pack", "--dry-run", "--json")
    $json = $packOutput | ConvertFrom-Json
    $files = @($json[0].files | ForEach-Object path)
    $required = @(
        "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
        "agent-manager/dist/cli.js", "agent-manager/dist/doctor.js",
        "agent-manager/dist/autostart.js", "agent-manager/dist/telemetry.js",
        "agent-manager/dist/telemetry-runtime.js", "agent-manager/dist/telemetry-correlation.js",
        "agent-manager/dist/telemetry-explain.js", "agent-manager/dist/agentacct-adapter.js",
        "agent-manager/dist/platform.js", "recipes/observability.json", "scripts/agentacct-query.py",
        "requirements/agentacct.in", "requirements/phoenix.in",
        "requirements/pylock.agentacct.toml", "requirements/pylock.phoenix.toml",
        "requirements/sbom.telemetry.cdx.json", "scripts/generate-telemetry-sbom.mjs",
        "scripts/01-layer1-runtime.ps1", "scripts/07-layer2-agent-clis.ps1",
        "scripts/afd-run-tree.ps1", "scripts/12-validate-agent-environment.ps1",
        "scripts/13-reconcile-sandbox-toolchain-access.ps1", "scripts/14-validate-observability-pilot.ps1",
        "scripts/afd-bootstrap.mjs", "scripts/afd-bootstrap.ps1", "scripts/afd-bootstrap-posix.sh",
        "scripts/build-release.mjs", "scripts/build-release.ps1",
        "docs/OBSERVABILITY.md", "docs/VALIDATION-MATRIX.md", "docs/AGENT-SANDBOX-REPAIR.md"
    )
    foreach ($item in $required) { if ($files -notcontains $item) { throw "Artifact is missing required file: $item" } }
    $forbidden = @($files | Where-Object { $_ -match '(^|/)(backups|setup-logs|state|local|node_modules|\.env)(/|$)' })
    if ($forbidden) { throw "Local state found in the artifact: $($forbidden -join ', ')" }
    Write-Host "Release allowlist compliant: $($files.Count) files."
} finally { Pop-Location }
