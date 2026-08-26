$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed with code $LASTEXITCODE." }
    $packOutput = pnpm pack --dry-run --json
    if ($LASTEXITCODE -ne 0) { throw "pnpm pack --dry-run failed with code $LASTEXITCODE." }
    $json = $packOutput | ConvertFrom-Json
    $files = @($json[0].files | ForEach-Object path)
    $required = @("README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "agent-manager/dist/cli.js", "scripts/01-layer1-runtime.ps1", "scripts/07-layer2-agent-clis.ps1")
    foreach ($item in $required) { if ($files -notcontains $item) { throw "Artifact is missing required file: $item" } }
    $forbidden = @($files | Where-Object { $_ -match '(^|/)(backups|setup-logs|state|local|node_modules|\.env)(/|$)' })
    if ($forbidden) { throw "Local state found in the artifact: $($forbidden -join ', ')" }
    Write-Host "Release allowlist compliant: $($files.Count) files."
} finally { Pop-Location }
