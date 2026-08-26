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

$miseShims = Join-Path $env:LOCALAPPDATA "mise\shims"
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

foreach($variable in @(@{Name='UV_NO_MANAGED_PYTHON';Value='1'},@{Name='UV_PYTHON_DOWNLOADS';Value='0'},@{Name='PNPM_HOME';Value=$pnpmHome})) {
    $observed=[Environment]::GetEnvironmentVariable($variable.Name,'User'); $ok=$observed -eq $variable.Value
    Add-Diagnostic environment $(if($ok){'PASS'}else{'FAIL'}) "env.$($variable.Name.ToLowerInvariant())" $variable.Name `
        $(if($ok){'expected value'}elseif($observed){'unexpected value'}else{'missing'}) "Run 'afd fix layer1 --dry-run'."
}
Add-Diagnostic environment $(if(Test-Path -LiteralPath $pnpmHome -PathType Container){'PASS'}else{'FAIL'}) "pnpm.home-directory" `
    "PNPM_HOME directory" $(if(Test-Path -LiteralPath $pnpmHome){'present'}else{'missing'}) "Run 'afd fix layer1 --dry-run'."

$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')
$commands=@('mise','uv','pnpm','python','node','go','rustc','cargo')
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
    @{Code='runtime.python';Summary='Python 3.14';Value=(First-Line { python --version });Pattern='^Python 3\.14\.'},
    @{Code='runtime.node';Summary='Node.js 24';Value=(First-Line { node --version });Pattern='^v24\.'},
    @{Code='runtime.go';Summary='Go 1.26';Value=(First-Line { go version });Pattern='go1\.26\.'},
    @{Code='runtime.rust';Summary='Rust 1.98.0';Value=(First-Line { rustc --version });Pattern='^rustc 1\.98\.0\b'}
)
foreach($item in $versions){$ok=$item.Value -match $item.Pattern; Add-Diagnostic runtimes $(if($ok){'PASS'}else{'FAIL'}) $item.Code $item.Summary $item.Value "Run 'afd fix layer1 --dry-run'."}
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
