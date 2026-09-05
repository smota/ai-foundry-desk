[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet('Inspect', 'Plan', 'Apply', 'Verify', 'Run')][string]$Mode = 'Inspect',
    [string]$OutputDirectory,
    [string]$Executable,
    [string]$ArgumentsBase64,
    [switch]$Approved
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This helper is for Windows MSVC targets.' }
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$taskInstallation = $null
if (Test-Path -LiteralPath $taskVswhere -PathType Leaf) {
    $taskInstallation = (& $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
}
$taskLinker = $null
$taskDevShell = $null
if ($taskInstallation) {
    $taskLinker = Get-ChildItem -LiteralPath (Join-Path $taskInstallation 'VC\Tools\MSVC') -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'bin\Hostx64\x64\link.exe' } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    $taskDevShell = Join-Path $taskInstallation 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
}
$taskSdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Lib'
$taskSdk = $null
if (Test-Path -LiteralPath $taskSdkRoot) {
    $taskSdk = Get-ChildItem -LiteralPath $taskSdkRoot -Directory | Sort-Object Name -Descending | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'um\x64\kernel32.lib')) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'ucrt\x64\ucrt.lib'))
    } | Select-Object -First 1 -ExpandProperty FullName
}
$taskReady = [bool]($taskLinker -and $taskSdk -and $taskDevShell -and (Test-Path -LiteralPath $taskDevShell))
$taskPlan = [ordered]@{
    ready = $taskReady; installation = $taskInstallation; linker = $taskLinker; sdk = $taskSdk
    package = 'Microsoft.VisualStudio.2022.BuildTools'
    workload = 'Microsoft.VisualStudio.Workload.VCTools'
    includesRecommended = $true
    changes = 'Install missing MSVC C++ build tools and recommended Windows SDK; no global PATH/profile edit, no reboot.'
}
if ($Mode -eq 'Inspect' -or $Mode -eq 'Plan') { $taskPlan | ConvertTo-Json; return }
if ($Mode -eq 'Apply') {
    if (-not $Approved) { throw 'Apply requires explicit review of Plan and -Approved.' }
    if ($taskReady) { $taskPlan | ConvertTo-Json; return }
    if ($PSCmdlet.ShouldProcess($taskPlan.package, $taskPlan.changes)) {
        & winget.exe install --id $taskPlan.package --exact --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
        if ($LASTEXITCODE -notin @(0, 3010)) { throw "Build Tools installer failed with exit code $LASTEXITCODE" }
        if ($LASTEXITCODE -eq 3010) { throw 'Installation requires a reboot; validation remains pending.' }
    }
    return
}
if (-not $taskReady) { throw 'MSVC linker, Windows SDK, or developer-shell activation is missing. Review Plan before Apply.' }
if ($Mode -eq 'Run') {
    if ($Executable -notmatch '^(cargo|rustc)(\.exe)?$') { throw 'Run supports cargo or rustc only.' }
    Import-Module -Name $taskDevShell -ErrorAction Stop
    Enter-VsDevShell -VsInstallPath $taskInstallation -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
    & (Join-Path $PSScriptRoot 'afd-run-tree.ps1') -Executable $Executable -ArgumentsBase64 $ArgumentsBase64 -TimeoutMs 270000 -WorkingDirectory (Get-Location).Path
    exit $LASTEXITCODE
}
if (-not $OutputDirectory) { throw 'Verify requires an explicitly selected disposable OutputDirectory.' }
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $taskOutput) { throw 'Verify output directory must not already exist.' }
if ($PSCmdlet.ShouldProcess($taskOutput, 'Compile and run a synthetic Rust executable')) {
    [IO.Directory]::CreateDirectory($taskOutput) | Out-Null
    # Activate compiler variables for this process only. No profile or machine PATH changes.
    Import-Module -Name $taskDevShell -ErrorAction Stop
    Enter-VsDevShell -VsInstallPath $taskInstallation -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
    $taskRustc = (& rustup.exe which rustc | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $taskRustc -PathType Leaf)) { throw 'The selected rustup toolchain is unavailable.' }
    $taskSource = Join-Path $taskOutput 'smoke.rs'
    $taskBinary = Join-Path $taskOutput 'smoke.exe'
    [IO.File]::WriteAllText($taskSource, 'fn main() { println!("AFD_RUST_LINK_RUN_OK"); }')
    & $taskRustc $taskSource -o $taskBinary
    if ($LASTEXITCODE -ne 0) { throw 'Rust compile/link smoke failed.' }
    $taskResult = & $taskBinary
    if ($LASTEXITCODE -ne 0 -or $taskResult -ne 'AFD_RUST_LINK_RUN_OK') { throw 'Rust execution smoke failed.' }
    [ordered]@{ passed = $true; linker = $taskLinker; sdk = $taskSdk; rustc = $taskRustc; output = $taskOutput } | ConvertTo-Json
}
