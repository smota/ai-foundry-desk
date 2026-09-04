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
    [void](Invoke-Pnpm @("build"))
    $packOutput = Invoke-Pnpm @("pack", "--dry-run", "--json")
    $json = $packOutput | ConvertFrom-Json
    $files = @($json[0].files | ForEach-Object path)
    $required = @(
        "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
        "agent-manager/dist/cli.js", "agent-manager/dist/doctor.js",
        "agent-manager/dist/autostart.js", "agent-manager/dist/telemetry.js",
        "agent-manager/dist/telemetry-runtime.js", "agent-manager/dist/telemetry-correlation.js",
        "agent-manager/dist/telemetry-explain.js", "agent-manager/dist/agentacct-adapter.js",
        "agent-manager/dist/mcp-contracts.js", "agent-manager/dist/mcp-formats.js",
        "agent-manager/dist/mcp-manager.js", "agent-manager/dist/mcp-registry.js",
        "agent-manager/dist/platform.js", "recipes/observability.json", "scripts/agentacct-query.py",
        "scripts/agentacct-native/afd_agentacct_windows.py", "scripts/agentacct-native/fcntl.py", "scripts/agentacct-native/sitecustomize.py",
        "requirements/agentacct.in", "requirements/phoenix.in",
        "requirements/pylock.agentacct.toml", "requirements/pylock.phoenix.toml",
        "requirements/sbom.telemetry.cdx.json",
        "scripts/01-layer1-runtime.ps1", "scripts/02-docker-windows.ps1",
        "scripts/01-layer1-runtime-macos.sh", "scripts/01-doctor-layer1-macos.sh",
        "scripts/01-verify-layer1-macos.sh", "scripts/02-docker-macos.sh", "scripts/07-layer2-agent-clis.ps1",
        "scripts/afd-run-tree.ps1", "scripts/12-validate-agent-environment.ps1",
        "scripts/13-reconcile-sandbox-toolchain-access.ps1", "scripts/14-validate-observability-pilot.ps1",
        "docs/OBSERVABILITY.md", "docs/VALIDATION-MATRIX.md", "docs/AGENT-SANDBOX-REPAIR.md",
        "docs/ENVIRONMENT-OWNERSHIP.md", "docs/MCP-CONFIGURATION-DESIGN.md"
    )
    foreach ($item in $required) { if ($files -notcontains $item) { throw "Artifact is missing required file: $item" } }
    $forbidden = @($files | Where-Object {
        $_ -match '(^|/)(backups|setup-logs|state|local|node_modules|\.env|src|test)(/|$)' -or
        $_ -match '^scripts/(afd-bootstrap|build-release|capture-tui-screens|check-docs|check-dist-parity|check-release-version|clean-dist|generate-telemetry-sbom|package-smoke|release-audit|test-clean-build)' -or
        $_ -eq 'setup.ps1'
    })
    if ($forbidden) { throw "Forbidden development or local content found in the artifact: $($forbidden -join ', ')" }
    if ($files.Count -gt 260) { throw "Artifact file-count ceiling exceeded: $($files.Count) > 260." }

    $totalBytes = 0L
    $sensitive = [regex]'(?i)(C:\\Users\\samue|/home/[a-z0-9._-]+/|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|npm_[a-z0-9]{20,}|gh[pousr]_[a-z0-9]{20,}|AKIA[0-9A-Z]{16})'
    $textExtensions = @('.js', '.json', '.md', '.ps1', '.py', '.sh', '.toml', '.yaml', '.yml', '.txt')
    foreach ($item in $files) {
        $path = Join-Path $root ($item -replace '/', [IO.Path]::DirectorySeparatorChar)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Packed file does not resolve in the workspace: $item" }
        $totalBytes += (Get-Item -LiteralPath $path).Length
        if (($textExtensions -contains [IO.Path]::GetExtension($path)) -or [IO.Path]::GetFileName($path) -in @('LICENSE')) {
            $content = Get-Content -Raw -LiteralPath $path
            if ($sensitive.IsMatch($content)) { throw "Sensitive or host-specific content found in packaged file: $item" }
        }
    }
    if ($totalBytes -gt 8MB) { throw "Artifact uncompressed-size ceiling exceeded: $totalBytes > 8 MiB." }

    $manifest = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
    foreach ($hook in @('preinstall', 'install', 'postinstall', 'prepare')) {
        if ($manifest.scripts.PSObject.Properties.Name -contains $hook) { throw "Package lifecycle hook is forbidden: $hook" }
    }
    if ($manifest.repository.url -ne 'git+https://github.com/smota/ai-foundry-desk.git') { throw 'package.json repository.url must exactly identify the public source repository.' }
    if ($manifest.publishConfig.access -ne 'public') { throw 'package.json publishConfig.access must be public.' }
    Write-Host "Release allowlist compliant: $($files.Count) files, $totalBytes uncompressed bytes."
} finally { Pop-Location }
