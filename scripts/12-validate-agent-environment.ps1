[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [switch]$RequireSandbox,
    [switch]$Json
)

$ErrorActionPreference = "Stop"
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$runner = Join-Path $PSScriptRoot "afd-run-tree.ps1"
$rows = [Collections.Generic.List[object]]::new()
$toolPass = @{}
$toolPaths = @{}

function Add-Result([string]$Id, [bool]$Passed, [string]$Evidence) {
    $rows.Add([pscustomobject]@{ id = $Id; status = $(if ($Passed) { "PASS" } else { "FAIL" }); evidence = $Evidence })
}

function Invoke-Bounded([string]$Executable, [string[]]$Arguments, [int]$TimeoutMs = 15000) {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($Arguments | ConvertTo-Json -Compress)))
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Executable $Executable -ArgumentsBase64 $encoded -TimeoutMs $TimeoutMs -WorkingDirectory $ProjectRoot 2>&1 | Out-String
    $status = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    return [pscustomobject]@{ Status = $status; Output = $output.Trim() }
}

function Invoke-BoundedStable([string]$Executable, [string[]]$Arguments, [int]$TimeoutMs) {
    $first = Invoke-Bounded $Executable $Arguments $TimeoutMs
    if ($first.Status -eq 0) { return [pscustomobject]@{ Status = 0; Output = $first.Output; Attempts = 1 } }
    $second = Invoke-Bounded $Executable $Arguments $TimeoutMs
    return [pscustomobject]@{ Status = $second.Status; Output = $second.Output; Attempts = 2 }
}

function Failure-Summary([string]$Output) {
    $singleLine = ($Output -replace '\s+', ' ').Trim()
    if ($singleLine.Length -gt 500) { return $singleLine.Substring(0, 500) + "..." }
    return $singleLine
}

function Resolve-Application([string]$Name) {
    return Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
}

function Resolve-ManagedApplication([string]$Name) {
    $spec = switch ($Name) {
        "node" { @{ Tool = "node"; Version = "24.19.0"; Relative = "node.exe" } }
        "python" { @{ Tool = "python"; Version = "3.14.7"; Relative = "python.exe" } }
        "go" { @{ Tool = "go"; Version = "1.26.7"; Relative = "bin\go.exe" } }
        "rustc" { @{ Tool = "rust"; Version = "1.98.0"; Relative = "rustc.exe" } }
        "cargo" { @{ Tool = "rust"; Version = "1.98.0"; Relative = "cargo.exe" } }
        default { return $null }
    }
    $mise = Resolve-Application "mise"
    if (-not $mise) { return $null }
    $where = Invoke-Bounded $mise @("where", "$($spec.Tool)@$($spec.Version)")
    if ($where.Status -ne 0) { return $null }
    $root = $where.Output -split "\r?\n" | Select-Object -Last 1
    $candidate = Join-Path $root $spec.Relative
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    return $null
}

$account = (& whoami.exe).Trim()
$declared = [Environment]::GetEnvironmentVariable("USERNAME", "Process")
$sandbox = $account -match '(?i)sandbox'
Add-Result "identity.account" (-not $RequireSandbox -or $sandbox) "account=$account declaredUser=$declared"

$commands = @(
    @{ Name = "node"; Pattern = '^v24\.' },
    @{ Name = "pnpm"; Pattern = '^11\.23\.0$' },
    @{ Name = "mise"; Pattern = '^\d{4}\.' },
    @{ Name = "uv"; Pattern = '^uv 0\.' },
    @{ Name = "uvx"; Pattern = '^uvx 0\.' },
    @{ Name = "python"; Pattern = '^Python 3\.14\.' },
    @{ Name = "go"; Pattern = '^go version go1\.26\.' },
    @{ Name = "rustc"; Pattern = '^rustc 1\.98\.' },
    @{ Name = "cargo"; Pattern = '^cargo 1\.98\.' },
    @{ Name = "codex"; Pattern = '^codex-cli \d+\.' }
)
foreach ($command in $commands) {
    # The shell command itself is the contract. Resolve-ManagedApplication is reserved for
    # running the verifier and must not hide a broken shim or missing inherited configuration.
    $resolved = Resolve-Application $command.Name
    if (-not $resolved) { $toolPass[$command.Name] = $false; Add-Result "command.$($command.Name)" $false "not resolvable"; continue }
    $toolPaths[$command.Name] = $resolved
    $versionArguments = if ($command.Name -eq "go") { @("version") } else { @("--version") }
    $invocation = if ($resolved -match '(?i)\.(cmd|bat)$') {
        @{ Executable = "cmd.exe"; Arguments = @("/d", "/s", "/c", "call", $resolved) + $versionArguments }
    } else {
        @{ Executable = $resolved; Arguments = $versionArguments }
    }
    $result = Invoke-Bounded $invocation.Executable $invocation.Arguments
    $firstLine = ($result.Output -split "\r?\n" | Select-Object -First 1)
    $passed = $result.Status -eq 0 -and $firstLine -match $command.Pattern
    $toolPass[$command.Name] = $passed
    Add-Result "command.$($command.Name)" $passed "path=$resolved version=$firstLine exit=$($result.Status)"
}

$toolDirectories = @($toolPaths.Values | ForEach-Object { Split-Path -Parent $_ } | Select-Object -Unique)
if ($toolDirectories.Count) { $env:Path = ($toolDirectories -join ";") + ";" + $env:Path }

$node = Resolve-ManagedApplication "node"
if ($node -and $toolPass.node) {
    $fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("afd-process-tree-" + [Guid]::NewGuid().ToString("N"))
    [void](New-Item -ItemType Directory -Path $fixtureRoot)
    try {
        $parentPidFile = Join-Path $fixtureRoot "parent.pid"
        $childPidFile = Join-Path $fixtureRoot "child.pid"
        $grandchildPidFile = Join-Path $fixtureRoot "grandchild.pid"
        $grandchildScript = 'setInterval(() => {}, 1000)'
        $childScript = 'const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");writeFileSync(' + ($childPidFile | ConvertTo-Json -Compress) + ',String(process.pid));const grandchild=spawn(process.execPath,["-e",' + ($grandchildScript | ConvertTo-Json -Compress) + '],{stdio:"ignore"});writeFileSync(' + ($grandchildPidFile | ConvertTo-Json -Compress) + ',String(grandchild.pid));setInterval(()=>{},1000);'
        $parentScript = 'const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");writeFileSync(' + ($parentPidFile | ConvertTo-Json -Compress) + ',String(process.pid));spawn(process.execPath,["-e",' + ($childScript | ConvertTo-Json -Compress) + '],{stdio:"ignore"});setInterval(()=>{},1000);'
        $tree = Invoke-Bounded $node @("-e", $parentScript) 1000
        Start-Sleep -Milliseconds 300
        $pidFiles = @($parentPidFile, $childPidFile, $grandchildPidFile)
        $pids = @($pidFiles | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { [int](Get-Content -Raw -LiteralPath $_) })
        $alive = @($pids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        $passed = $tree.Status -eq 124 -and $pidFiles.Count -eq $pids.Count -and $alive.Count -eq 0
        Add-Result "process.timeout-tree" $passed "exit=$($tree.Status) pids=$($pids -join ',') alive=$($alive -join ',')"
    } finally {
        if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
    }
} else {
    Add-Result "process.timeout-tree" $false "managed node not resolvable"
}

$pnpm = Resolve-Application "pnpm"
if ($pnpm -and $toolPass.pnpm) {
    $managedNode = Resolve-ManagedApplication "node"
    if ($managedNode) { $env:Path = (Split-Path -Parent $managedNode) + ";" + $env:Path }
    $pnpmInvocation = if ($pnpm -match '(?i)\.(cmd|bat)$') { @{ Executable = "cmd.exe"; Prefix = @("/d", "/s", "/c", "call", $pnpm) } } else { @{ Executable = $pnpm; Prefix = @() } }
    $check = Invoke-BoundedStable $pnpmInvocation.Executable @($pnpmInvocation.Prefix + "check") 300000
    $checkEvidence = "exit=$($check.Status) attempts=$($check.Attempts)"
    if ($check.Status -ne 0) { $checkEvidence += " output=$(Failure-Summary $check.Output)" }
    Add-Result "project.pnpm-check" ($check.Status -eq 0) $checkEvidence
} else {
    Add-Result "project.pnpm-check" $false "pnpm not resolvable"
}

$cli = Join-Path $ProjectRoot "agent-manager\dist\cli.js"
if ($node -and (Test-Path -LiteralPath $cli)) {
    $provenance = Invoke-Bounded $node @($cli, "provenance", "--json")
    Add-Result "afd.provenance" ($provenance.Status -eq 0 -and $provenance.Output -match '"version":\s*"0\.3\.1"') "exit=$($provenance.Status)"
    $doctor = Invoke-BoundedStable $node @($cli, "doctor", "--json") 60000
    $doctorPassed = ($doctor.Status -eq 0 -or $doctor.Status -eq 2) -and $doctor.Output -notmatch '"status":\s*"FAIL"'
    $doctorEvidence = "exit=$($doctor.Status) attempts=$($doctor.Attempts)"
    if (-not $doctorPassed) { $doctorEvidence += " output=$(Failure-Summary $doctor.Output)" }
    Add-Result "afd.doctor" $doctorPassed $doctorEvidence
    $telemetryPlan = Invoke-Bounded $node @($cli, "telemetry", "plan") 60000
    Add-Result "telemetry.plan" (($telemetryPlan.Status -eq 0 -or $telemetryPlan.Status -eq 2) -and $telemetryPlan.Output -match '"id":\s*"observability"' -and $telemetryPlan.Output -match 'agentacct 0\.10\.1') "exit=$($telemetryPlan.Status)"
    $telemetryStatus = Invoke-Bounded $node @($cli, "telemetry", "status", "--json") 60000
    Add-Result "telemetry.status-contract" (($telemetryStatus.Status -eq 0 -or $telemetryStatus.Status -eq 2) -and $telemetryStatus.Output -match '"schemaVersion":\s*2' -and $telemetryStatus.Output -match '"collector"' -and $telemetryStatus.Output -match '"agentacct"' -and $telemetryStatus.Output -match '"capabilities"') "exit=$($telemetryStatus.Status)"
    $telemetryHealthy = $false
    $telemetryEvidence = "invalid status JSON"
    try {
        $telemetryValue = $telemetryStatus.Output | ConvertFrom-Json
        $telemetryHealthy = $telemetryValue.state -eq "disabled" -or (
            $telemetryValue.state -eq "healthy" -and
            $telemetryValue.collector.state -eq "healthy" -and
            $telemetryValue.phoenix.state -eq "healthy" -and
            $telemetryValue.agentacct.state -eq "healthy"
        )
        $telemetryEvidence = "overall=$($telemetryValue.state) collector=$($telemetryValue.collector.state) phoenix=$($telemetryValue.phoenix.state) agentacct=$($telemetryValue.agentacct.state)"
    } catch { $telemetryHealthy = $false }
    Add-Result "telemetry.live-health" $telemetryHealthy $telemetryEvidence
} else {
    Add-Result "afd.provenance" $false "built CLI or managed node missing"
    Add-Result "afd.doctor" $false "built CLI or managed node missing"
    Add-Result "observability.agents.plan" $false "built CLI or managed node missing"
    Add-Result "observability.agents.status" $false "built CLI or managed node missing"
    Add-Result "observability.host.plan" $false "built CLI or managed node missing"
    Add-Result "observability.host.status" $false "built CLI or managed node missing"
}

$globalAfd = Resolve-Application "afd"
if ($globalAfd) {
    $global = if ($globalAfd -match '(?i)\.(cmd|bat)$') { Invoke-Bounded "cmd.exe" @("/d", "/s", "/c", "call", $globalAfd, "--version") } else { Invoke-Bounded $globalAfd @("--version") }
    Add-Result "afd.global-version" ($global.Status -eq 0 -and ($global.Output -split "\r?\n" | Select-Object -First 1) -eq "0.5.0") "path=$globalAfd version=$($global.Output)"
    $globalProvenance = if ($globalAfd -match '(?i)\.(cmd|bat)$') { Invoke-Bounded "cmd.exe" @("/d", "/s", "/c", "call", $globalAfd, "provenance", "--json") } else { Invoke-Bounded $globalAfd @("provenance", "--json") }
    $globalProvenancePass = $false
    if ($globalProvenance.Status -eq 0) {
        try {
            $globalDetails = $globalProvenance.Output | ConvertFrom-Json
        $globalProvenancePass = $globalDetails.version -eq "0.5.0" -and -not [string]::IsNullOrWhiteSpace($globalDetails.cli) -and -not [string]::IsNullOrWhiteSpace($globalDetails.runtime.executable)
        } catch { $globalProvenancePass = $false }
    }
    Add-Result "afd.global-provenance" $globalProvenancePass "exit=$($globalProvenance.Status)"
} else {
    Add-Result "afd.global-version" $false "global afd not resolvable"
    Add-Result "afd.global-provenance" $false "global afd not resolvable"
}

if ($Json) { $rows | ConvertTo-Json -Depth 4 } else { $rows | Format-Table -AutoSize }
if ($rows.Status -contains "FAIL") { exit 2 }
