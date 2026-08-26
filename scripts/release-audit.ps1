$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build falhou com codigo $LASTEXITCODE." }
    $packOutput = pnpm pack --dry-run --json
    if ($LASTEXITCODE -ne 0) { throw "pnpm pack --dry-run falhou com codigo $LASTEXITCODE." }
    $json = $packOutput | ConvertFrom-Json
    $files = @($json[0].files | ForEach-Object path)
    $required = @("README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "agent-manager/dist/cli.js", "scripts/01-layer1-runtime.ps1", "scripts/07-layer2-agent-clis.ps1")
    foreach ($item in $required) { if ($files -notcontains $item) { throw "Artefato sem arquivo obrigatorio: $item" } }
    $forbidden = @($files | Where-Object { $_ -match '(^|/)(backups|setup-logs|state|local|node_modules|\.env)(/|$)' })
    if ($forbidden) { throw "Estado local encontrado no artefato: $($forbidden -join ', ')" }
    Write-Host "Release allowlist conforme: $($files.Count) arquivos."
} finally { Pop-Location }
