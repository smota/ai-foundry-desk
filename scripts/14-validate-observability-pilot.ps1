[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [ValidateRange(1, 100)][int]$Samples = 5,
    [ValidateRange(0, 300)][int]$IntervalSeconds = 1,
    [string]$RunId,
    [switch]$RunVerify
)

$ErrorActionPreference = "Stop"
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$runner = Join-Path $PSScriptRoot "afd-run-tree.ps1"
$cli = Join-Path $ProjectRoot "agent-manager\dist\cli.js"
$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source
$node = (& $nodeCommand -p "process.execPath").Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $node)) { throw "Could not resolve the managed Node.js executable." }
if (-not (Test-Path -LiteralPath $cli)) { throw "Build the AFD CLI before collecting pilot evidence." }
if ($RunId -and $RunId -notmatch '^[a-f0-9]{32}$') { throw "RunId must be a 32-character lowercase hexadecimal identifier." }

function Invoke-Afd([string[]]$Arguments, [int]$TimeoutMs = 60000) {
    $allArguments = @($cli) + $Arguments
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($allArguments | ConvertTo-Json -Compress)))
    $started = [Diagnostics.Stopwatch]::StartNew()
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Executable $node -ArgumentsBase64 $encoded -TimeoutMs $TimeoutMs -WorkingDirectory $ProjectRoot 2>&1 | Out-String
    $status = $LASTEXITCODE
    $ErrorActionPreference = $priorPreference
    $started.Stop()
    return [pscustomobject]@{ Status = $status; Output = $output.Trim(); DurationMs = [math]::Round($started.Elapsed.TotalMilliseconds, 2) }
}

function Get-Percentile([double[]]$Values, [double]$Percentile) {
    if ($Values.Count -eq 0) { return $null }
    $ordered = @($Values | Sort-Object)
    $index = [math]::Ceiling($Percentile * $ordered.Count) - 1
    return $ordered[[math]::Max(0, $index)]
}

$planResult = Invoke-Afd @("telemetry", "plan")
if ($planResult.Status -ne 0 -and $planResult.Status -ne 2) { throw "Telemetry plan failed with exit code $($planResult.Status)." }
$plan = $planResult.Output | ConvertFrom-Json
$managedRoot = [string]$plan.telemetry.stateRoot
if ([string]::IsNullOrWhiteSpace($managedRoot)) { throw "Telemetry plan did not expose its managed state root." }

$verifyResult = $null
if ($RunVerify) {
    $verifyResult = Invoke-Afd @("telemetry", "verify") 120000
    if ($verifyResult.Status -ne 0) { throw "Telemetry verification failed with exit code $($verifyResult.Status)." }
}

$rows = [Collections.Generic.List[object]]::new()
for ($sample = 1; $sample -le $Samples; $sample += 1) {
    $statusResult = Invoke-Afd @("telemetry", "status", "--json")
    if ($statusResult.Status -ne 0 -and $statusResult.Status -ne 2) { throw "Telemetry status failed with exit code $($statusResult.Status)." }
    $status = $statusResult.Output | ConvertFrom-Json
    $components = [ordered]@{}
    foreach ($name in @("collector", "phoenix")) {
        $component = $status.$name
        $process = if ($component.pid) { Get-Process -Id $component.pid -ErrorAction SilentlyContinue } else { $null }
        $components[$name] = [ordered]@{
            state = $component.state
            workingSetBytes = if ($process) { [long]$process.WorkingSet64 } else { $null }
            cpuSeconds = if ($process) { [math]::Round([double]$process.CPU, 3) } else { $null }
        }
    }
    $files = if (Test-Path -LiteralPath $managedRoot) { @(Get-ChildItem -LiteralPath $managedRoot -File -Recurse -ErrorAction Stop) } else { @() }
    $logFiles = @($files | Where-Object { $_.Extension -in @(".log", ".out", ".err") })
    $explainResult = if ($RunId) { Invoke-Afd @("telemetry", "explain", $RunId, "--json") 30000 } else { $null }
    $rows.Add([pscustomobject]@{
        sample = $sample
        capturedAt = [DateTimeOffset]::UtcNow.ToString("o")
        state = $status.state
        statusLatencyMs = $statusResult.DurationMs
        explainLatencyMs = if ($explainResult) { $explainResult.DurationMs } else { $null }
        explainExitCode = if ($explainResult) { $explainResult.Status } else { $null }
        managedBytes = [long](($files | Measure-Object -Property Length -Sum).Sum)
        logBytes = [long](($logFiles | Measure-Object -Property Length -Sum).Sum)
        components = $components
        traceFreshnessMs = $status.diagnostics.performance.traceFreshnessMs
        phoenixQueryMs = $status.diagnostics.performance.phoenixQueryMs
    })
    if ($sample -lt $Samples -and $IntervalSeconds -gt 0) { Start-Sleep -Seconds $IntervalSeconds }
}

$statusLatencies = @($rows | ForEach-Object { [double]$_.statusLatencyMs })
$explainLatencies = @($rows | Where-Object { $null -ne $_.explainLatencyMs } | ForEach-Object { [double]$_.explainLatencyMs })
$result = [ordered]@{
    schemaVersion = 1
    samples = $rows
    summary = [ordered]@{
        statusP95Ms = Get-Percentile $statusLatencies 0.95
        explainP95Ms = Get-Percentile $explainLatencies 0.95
        managedGrowthBytes = [long]($rows[$rows.Count - 1].managedBytes - $rows[0].managedBytes)
        logGrowthBytes = [long]($rows[$rows.Count - 1].logBytes - $rows[0].logBytes)
        verifyLatencyMs = if ($verifyResult) { $verifyResult.DurationMs } else { $null }
    }
    privacy = [ordered]@{
        containsPaths = $false
        containsRawContent = $false
        note = "Only bounded component metrics and synthetic verification diagnostics are emitted."
    }
}
$result | ConvertTo-Json -Depth 8
