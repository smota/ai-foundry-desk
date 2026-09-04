[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = "SilentlyContinue"
$results = [Collections.Generic.List[object]]::new()

function Add-Diagnostic {
    param([string]$Category, [string]$Severity, [string]$Code, [string]$Summary,
          [string]$Evidence, [string]$Suggestion)
    $results.Add([PSCustomObject]@{ category=$Category; severity=$Severity; code=$Code;
        summary=$Summary; evidence=$Evidence; suggestion=$Suggestion })
}
function User-PathEntries { @([Environment]::GetEnvironmentVariable("Path", "User") -split ';' | Where-Object { $_ }) }
function Command-Info([string]$Name) {
    $command = Get-Command $Name -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { return $null }
    $source = $command.Source
    $kind = if ($source -match '(?i)\\mise\\shims\\') { "mise shim" }
        elseif ($source -match '(?i)\\Microsoft\\WindowsApps\\') { "Microsoft Store alias" }
        elseif ($source -match '(?i)\\Microsoft\\WinGet\\') { "WinGet package" }
        else { "external command" }
    [PSCustomObject]@{ Source=$source; Kind=$kind }
}
function First-Line([scriptblock]$Operation) { try { [string](& $Operation 2>&1 | Select-Object -First 1) } catch { $_.Exception.Message } }

$isWindows = $env:OS -eq "Windows_NT"
$arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
Add-Diagnostic platform $(if($isWindows -and $arch -eq 'X64'){'PASS'}else{'FAIL'}) "platform.windows-x64" `
    "Validated platform" "$($env:OS)/$arch" "Use Windows x64; other platforms remain roadmap targets."

$account = [string](& whoami.exe 2>$null)
$sandboxIdentity = $account -match '(?i)\\codexsandbox'
Add-Diagnostic identity $(if($sandboxIdentity){'WARN'}else{'PASS'}) "identity.execution-context" `
    "Execution context authority" $(if($sandboxIdentity){"sandbox account $account"}else{"normal user account $account"}) `
    $(if($sandboxIdentity){"Persistent HKCU, user PATH, and known-folder checks are not authoritative here; run this doctor from a normal user shell."}else{"No action."})

if ($sandboxIdentity) {
    foreach($name in @('mise','uv','pnpm','python','node','go','rustc','cargo','allow-scripts','docker')) {
        $info = Command-Info $name
        Add-Diagnostic commands $(if($info){'PASS'}else{'FAIL'}) "command.$name" "$name resolves in the effective sandbox process" `
            $(if($info){$info.Source}else{'missing'}) "Repair the reviewed sandbox toolchain path or ACL, then start a fresh task."
    }
    Add-Diagnostic scope 'WARN' 'scope.persistent-state-skipped' "Persistent user-state checks skipped" `
        "dedicated Codex sandbox identities have a separate HKCU and known-folder view" `
        "Run this doctor from a normal user shell for persistent-state evidence; use scripts/12-validate-agent-environment.ps1 for sandbox evidence."
    if($Json){
        [PSCustomObject]@{schemaVersion=1;product='AI Foundry Desk';command='doctor';platform='windows-x64';results=@($results)} | ConvertTo-Json -Depth 5
    } else {
        foreach($category in @($results.category | Select-Object -Unique)){
            Write-Host "`n[$category]"
            foreach($item in @($results | Where-Object category -eq $category)){Write-Host ("{0,-4} {1} - {2}`n     Evidence: {3}`n     Next: {4}" -f $item.severity,$item.code,$item.summary,$item.evidence,$item.suggestion)}
        }
    }
    if(@($results | Where-Object severity -eq 'FAIL').Count -gt 0){exit 2}
    exit 0
}

$miseShims = Join-Path $env:LOCALAPPDATA "mise\shims"
$miseGlobalConfig = Join-Path $env:LOCALAPPDATA "mise\afd-global-config.toml"
$miseState = Join-Path $env:TEMP "afd-mise-state"
$legacyMiseGlobalConfig = Join-Path $env:USERPROFILE ".config\mise\config.toml"
$rustupHome = Join-Path $env:USERPROFILE ".rustup"
$cargoHome = Join-Path $env:USERPROFILE ".cargo"
$wingetLinks = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"
$pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
$pnpmBin = Join-Path $pnpmHome "bin"
$userPath = @(User-PathEntries)
$miseIndex = [Array]::FindIndex([string[]]$userPath, [Predicate[string]]{ param($item) $item.TrimEnd('\') -ieq $miseShims.TrimEnd('\') })
Add-Diagnostic path $(if($miseIndex -eq 0){'PASS'}elseif($miseIndex -ge 0){'WARN'}else{'FAIL'}) "path.mise-shims-first" `
    "mise shims precedence" $(if($miseIndex -ge 0){"user PATH index $miseIndex"}else{"missing"}) `
    "Run 'afd fix layer1 --dry-run'; AFD can place its managed shim entry first."
foreach($entry in @(@{Code='path.winget-links';Path=$wingetLinks},@{Code='path.pnpm-bin';Path=$pnpmBin})) {
    $present = @($userPath | Where-Object { $_.TrimEnd('\') -ieq $entry.Path.TrimEnd('\') }).Count -gt 0
    Add-Diagnostic path $(if($present){'PASS'}else{'FAIL'}) $entry.Code "Managed PATH entry" $(if($present){'present'}else{'missing'}) "Run 'afd fix layer1 --dry-run'."
}

foreach($variable in @(@{Name='UV_NO_MANAGED_PYTHON';Value='1'},@{Name='UV_PYTHON_DOWNLOADS';Value='0'},@{Name='MISE_GLOBAL_CONFIG_FILE';Value=$miseGlobalConfig},@{Name='MISE_STATE_DIR';Value=$miseState},@{Name='MISE_IGNORED_CONFIG_PATHS';Value=$legacyMiseGlobalConfig},@{Name='RUSTUP_HOME';Value=$rustupHome},@{Name='CARGO_HOME';Value=$cargoHome},@{Name='PNPM_HOME';Value=$pnpmHome})) {
    $observed=[Environment]::GetEnvironmentVariable($variable.Name,'User'); $ok=$observed -eq $variable.Value
    Add-Diagnostic environment $(if($ok){'PASS'}else{'FAIL'}) "env.$($variable.Name.ToLowerInvariant())" $variable.Name `
        $(if($ok){'expected value'}elseif($observed){'unexpected value'}else{'missing'}) "Run 'afd fix layer1 --dry-run'."
}
Add-Diagnostic environment $(if(Test-Path -LiteralPath $miseGlobalConfig -PathType Leaf){'PASS'}else{'FAIL'}) "mise.global-config" `
    "Sandbox-readable mise global config" $(if(Test-Path -LiteralPath $miseGlobalConfig){$miseGlobalConfig}else{'missing'}) "Run 'afd fix layer1 --dry-run'."
Add-Diagnostic environment $(if(Test-Path -LiteralPath $pnpmHome -PathType Container){'PASS'}else{'FAIL'}) "pnpm.home-directory" `
    "PNPM_HOME directory" $(if(Test-Path -LiteralPath $pnpmHome){'present'}else{'missing'}) "Run 'afd fix layer1 --dry-run'."

$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')
$commands=@('mise','uv','pnpm','python','node','go','rustc','cargo','allow-scripts','docker')
foreach($name in $commands){
    $info=Command-Info $name
    Add-Diagnostic commands $(if($info){'PASS'}else{'FAIL'}) "command.$name" "$name resolves in a new no-profile shell" `
        $(if($info){$info.Kind}else{'missing'}) "Run 'afd fix layer1 --dry-run' for managed Layer 1 commands."
}
$python=Command-Info 'python'
if($python -and $python.Kind -eq 'Microsoft Store alias'){
    Add-Diagnostic conflicts 'WARN' 'python.microsoft-store-alias' "Microsoft Store Python alias wins command resolution" `
        "WindowsApps alias precedes the mise shim" "AFD can move its shim entry first; disabling Windows aliases remains a manual Windows setting."
}

$versions=@(
    @{Category='runtimes';Code='runtime.python';Summary='Python 3.14';Value=(First-Line { python --version });Pattern='^Python 3\.14\.'},
    @{Category='runtimes';Code='runtime.node';Summary='Node.js 24';Value=(First-Line { node --version });Pattern='^v24\.'},
    @{Category='runtimes';Code='runtime.go';Summary='Go 1.26';Value=(First-Line { go version });Pattern='go1\.26\.'},
    @{Category='runtimes';Code='runtime.rust';Summary='Rust 1.98.0';Value=(First-Line { rustc --version });Pattern='^rustc 1\.98\.0\b'},
    @{Category='supply-chain-security';Code='security.allow-scripts';Summary='LavaMoat allow-scripts 5.1.0';Value=(First-Line { allow-scripts --version });Pattern='^v?5\.1\.0$'},
    @{Category='host-capabilities';Code='host.docker-cli';Summary='Docker CLI';Value=(First-Line { docker --version 2>$null });Pattern='^Docker version '},
    @{Category='host-capabilities';Code='host.docker-compose';Summary='Docker Compose';Value=(First-Line { docker compose version 2>$null });Pattern='^Docker Compose version '}
)
foreach($item in $versions){$ok=$item.Value -match $item.Pattern; Add-Diagnostic $item.Category $(if($ok){'PASS'}else{'FAIL'}) $item.Code $item.Summary $item.Value "Run 'afd fix layer1 --dry-run'."}
$dockerDaemon=[string](& docker info --format '{{.ServerVersion}}' 2>$null | Select-Object -First 1)
$dockerDaemonReady=$LASTEXITCODE -eq 0 -and $dockerDaemon
Add-Diagnostic host-capabilities $(if($dockerDaemonReady){'PASS'}else{'WARN'}) 'host.docker-daemon' "Docker daemon availability" `
    $(if($dockerDaemonReady){$dockerDaemon}else{'installed but not running or unavailable'}) "Start Docker Desktop interactively only when a workload needs containers."
$uvPython=First-Line { uv python find --no-python-downloads }
$uvUsesMise=$uvPython -match '(?i)\\mise\\installs\\python\\3\.14'
Add-Diagnostic runtimes $(if($uvUsesMise){'PASS'}else{'FAIL'}) 'uv.python-provider' "uv uses mise Python without downloads" `
    $(if($uvUsesMise){'mise Python 3.14'}else{'not mise Python 3.14'}) "Run 'afd fix layer1 --dry-run'."
$uvInfo=Command-Info 'uv'
$uvPhysical=@(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter uv.exe -File -Recurse -ErrorAction SilentlyContinue | Where-Object FullName -Match '(?i)astral-sh\.uv').Count -gt 0
Add-Diagnostic commands $(if($uvInfo -or $uvPhysical){'PASS'}else{'FAIL'}) 'uv.physical-or-link' "uv executable source" `
    $(if($uvInfo){$uvInfo.Kind}elseif($uvPhysical){'physical WinGet package'}else{'missing'}) "Run 'afd fix layer1 --dry-run'."

$documents=[Environment]::GetFolderPath('MyDocuments')
foreach($profile in @((Join-Path $documents 'PowerShell\Microsoft.PowerShell_profile.ps1'),(Join-Path $documents 'WindowsPowerShell\Microsoft.PowerShell_profile.ps1'))){
    $content=if(Test-Path -LiteralPath $profile){Get-Content -Raw -LiteralPath $profile}else{''}
    $ok=$content -match '(?s)# >>> AI Foundry Desk Layer 1 >>>.*# <<< AI Foundry Desk Layer 1 <<<'
    Add-Diagnostic profiles $(if($ok){'PASS'}else{'FAIL'}) 'profile.layer1-managed-block' "Managed Layer 1 profile block" `
        $(if($ok){'present'}else{'missing'}) "Run 'afd fix layer1 --dry-run'; existing files are backed up before a real change."
}
Add-Diagnostic scope 'WARN' 'scope.unmanaged-state' "Unmanaged machine state is not repaired" `
    "third-party runtimes, projects, credentials, services, and agent layers excluded" "Review these separately; AFD will not reset or remove them."

if($Json){
    [PSCustomObject]@{schemaVersion=1;product='AI Foundry Desk';command='doctor';platform='windows-x64';results=@($results)} | ConvertTo-Json -Depth 5
} else {
    foreach($category in @($results.category | Select-Object -Unique)){
        Write-Host "`n[$category]"
        foreach($item in @($results | Where-Object category -eq $category)){Write-Host ("{0,-4} {1} - {2}`n     Evidence: {3}`n     Next: {4}" -f $item.severity,$item.code,$item.summary,$item.evidence,$item.suggestion)}
    }
}
if(@($results | Where-Object severity -eq 'FAIL').Count -gt 0){exit 2}
