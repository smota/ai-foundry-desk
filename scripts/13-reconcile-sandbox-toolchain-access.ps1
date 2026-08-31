[CmdletBinding()]
param(
    [ValidateSet("Plan", "Apply", "Rollback")][string]$Mode = "Plan",
    [string]$BackupDirectory,
    [switch]$Approved,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

# Codex may prepend its bundled PowerShell 7 modules to PSModulePath even when
# this script is launched by Windows PowerShell 5.1. Bind the security module
# from the active host so ACL commands cannot autoload incompatible type data.
$securityModule = Join-Path $PSHOME "Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
Import-Module -Name $securityModule -ErrorAction Stop
if ($env:OS -ne "Windows_NT") { throw "Sandbox toolchain ACL reconciliation is Windows-only." }

$group = "$env:COMPUTERNAME\CodexSandboxUsers"
$inherited = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$targets = @(
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "mise"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:USERPROFILE ".rustup"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:USERPROFILE ".cargo"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"); inheritance = [Security.AccessControl.InheritanceFlags]::None; grant = "(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\jdx.mise_Microsoft.Winget.Source_8wekyb3d8bbwe"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uv.exe"); inheritance = [Security.AccessControl.InheritanceFlags]::None; grant = "(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uvx.exe"); inheritance = [Security.AccessControl.InheritanceFlags]::None; grant = "(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe\pnpm.exe"); inheritance = [Security.AccessControl.InheritanceFlags]::None; grant = "(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe"); inheritance = $inherited; grant = "(OI)(CI)(RX)" },
    [pscustomobject]@{ path = (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\OpenAI.Codex_Microsoft.Winget.Source_8wekyb3d8bbwe\codex-x86_64-pc-windows-msvc.exe"); inheritance = [Security.AccessControl.InheritanceFlags]::None; grant = "(RX)" }
)
$roots = @($targets.path)
$backupRoot = Join-Path $env:LOCALAPPDATA "AI Foundry Desk\backups"
$requiredRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute

function Assert-ReviewedGroup {
    [void]([Security.Principal.NTAccount]::new($group).Translate([Security.Principal.SecurityIdentifier]))
}

function Test-RequiredRule([Security.AccessControl.FileSystemSecurity]$Acl, [Security.AccessControl.InheritanceFlags]$RequiredInheritance) {
    foreach ($rule in $Acl.Access) {
        $identityMatches = $rule.IdentityReference.Value -ieq $group
        $rightsMatch = (([int]$rule.FileSystemRights -band [int]$requiredRights) -eq [int]$requiredRights)
        $inheritanceMatches = if ($RequiredInheritance -eq [Security.AccessControl.InheritanceFlags]::None) { $rule.InheritanceFlags -eq [Security.AccessControl.InheritanceFlags]::None } else { (([int]$rule.InheritanceFlags -band [int]$RequiredInheritance) -eq [int]$RequiredInheritance) }
        if ($identityMatches -and $rule.AccessControlType -eq "Allow" -and $rightsMatch -and $inheritanceMatches) { return $true }
    }
    return $false
}

function Invoke-Icacls([string[]]$Arguments) {
    $output = & icacls.exe @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "icacls failed with code $LASTEXITCODE`: $($output.Trim())" }
    return $output.Trim()
}

if ($Mode -eq "Rollback") {
    if (-not $Approved) { throw "Rollback requires -Approved after explicit review." }
    if ([string]::IsNullOrWhiteSpace($BackupDirectory)) { throw "Rollback requires -BackupDirectory from a prior Apply result." }
    $resolvedBackupRoot = [IO.Path]::GetFullPath($backupRoot).TrimEnd('\') + '\'
    $resolvedBackup = [IO.Path]::GetFullPath($BackupDirectory).TrimEnd('\') + '\'
    if (-not $resolvedBackup.StartsWith($resolvedBackupRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Rollback is restricted to the AFD backup root." }
    $snapshotPath = Join-Path $BackupDirectory "root-acls.json"
    if (-not (Test-Path -LiteralPath $snapshotPath -PathType Leaf)) { throw "ACL snapshot is missing: $snapshotPath" }
    $snapshot = @(Get-Content -Raw -LiteralPath $snapshotPath | ConvertFrom-Json)
    $expected = @($roots | ForEach-Object { [IO.Path]::GetFullPath($_) })
    $actual = @($snapshot | ForEach-Object { [IO.Path]::GetFullPath([string]$_.path) } | Sort-Object)
    if ($snapshot.Count -eq 0 -or $actual.Count -ne @($actual | Select-Object -Unique).Count -or @($actual | Where-Object { $expected -notcontains $_ }).Count -ne 0) { throw "ACL snapshot targets are not a unique subset of the reviewed tool roots." }
    if (@($snapshot | Where-Object { $null -eq $_.groupRuleCountBefore -or $null -eq $_.requiredRuleBefore -or ($_.groupRuleCountBefore -ne 0 -and -not $_.requiredRuleBefore) }).Count -ne 0) { throw "Rollback snapshot does not prove a safe pre-Apply group ACL state." }
    foreach ($entry in $snapshot | Where-Object { $_.groupRuleCountBefore -eq 0 }) { [void](Invoke-Icacls @([string]$entry.path, "/remove:g", $group)) }
    Write-Output "ROLLED_BACK`t$BackupDirectory"
    return
}

Assert-ReviewedGroup
$inspection = foreach ($target in $targets) {
    $root = $target.path
    if (-not (Test-Path -LiteralPath $root)) {
        [pscustomobject]@{ path = $root; group = $group; grant = $target.grant; exists = $false; readable = $false; groupRuleCount = 0; readExecuteInherited = $false; action = "not-installed"; evidence = "Reviewed target is not installed." }
        continue
    }
    try {
        $acl = Get-Acl -LiteralPath $root
        $hasRule = Test-RequiredRule $acl $target.inheritance
        $groupRules = @($acl.Access | Where-Object { $_.IdentityReference.Value -ieq $group })
        [pscustomobject]@{ path = $root; group = $group; grant = $target.grant; exists = $true; readable = $true; groupRuleCount = $groupRules.Count; readExecuteInherited = $hasRule; action = $(if ($hasRule) { "none" } elseif ($groupRules.Count -eq 0) { "grant-read-execute" } else { "manual-review" }); evidence = "ACL inspected" }
    } catch {
        if ($Mode -ne "Plan") { throw }
        [pscustomobject]@{ path = $root; group = $group; grant = $target.grant; exists = $true; readable = $false; groupRuleCount = -1; readExecuteInherited = $false; action = "inspect-from-normal-user-shell"; evidence = $_.Exception.Message }
    }
}

if ($Mode -eq "Plan") {
    $drift = @($inspection | Where-Object { $_.action -in @("grant-read-execute", "manual-review", "inspect-from-normal-user-shell") })
    $report = [pscustomobject]@{ schemaVersion = 1; state = $(if ($drift.Count -eq 0) { "healthy" } elseif (@($drift | Where-Object action -eq "manual-review").Count -gt 0) { "manual-review" } else { "drift" }); group = $group; targets = @($inspection) }
    if ($Json) {
        $report | ConvertTo-Json -Depth 5
    } else {
        foreach ($item in $inspection) {
            Write-Output ("ACCESS`t{0}`tgrant={1}`texists={2}`treadable={3}`tgroupRules={4}`treadExecuteInherited={5}`taction={6}`tevidence={7}" -f $item.path, $item.grant, $item.exists.ToString().ToLowerInvariant(), $item.readable.ToString().ToLowerInvariant(), $item.groupRuleCount, $item.readExecuteInherited.ToString().ToLowerInvariant(), $item.action, $item.evidence)
        }
    }
    if ($drift.Count -gt 0) { exit 2 }
    return
}

$installed = @($inspection | Where-Object exists)
if (@($installed | Where-Object { -not $_.readExecuteInherited -and $_.groupRuleCount -ne 0 }).Count -ne 0) { throw "A reviewed root has an existing non-matching CodexSandboxUsers ACE; automatic Apply is refused." }
if (@($installed | Where-Object { -not $_.readExecuteInherited }).Count -eq 0) { Write-Output "ALREADY_APPLIED"; return }
if (-not $Approved) { throw "Apply requires -Approved after explicit review." }
$snapshot = @($installed | ForEach-Object { [pscustomobject]@{ path = $_.path; sddl = (Get-Acl -LiteralPath $_.path).Sddl; groupRuleCountBefore = $_.groupRuleCount; requiredRuleBefore = $_.readExecuteInherited } })
$createdBackup = Join-Path $backupRoot ("sandbox-toolchain-acl-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
[void](New-Item -ItemType Directory -Path $createdBackup -Force)
$snapshot | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $createdBackup "root-acls.json") -Encoding utf8
try {
    $changed = [Collections.Generic.List[string]]::new()
    foreach ($target in $targets | Where-Object { Test-Path -LiteralPath $_.path }) {
        $root = $target.path
        $acl = Get-Acl -LiteralPath $root
        if (-not (Test-RequiredRule $acl $target.inheritance)) {
            [void](Invoke-Icacls @($root, "/grant", "${group}:$($target.grant)"))
            $changed.Add($root)
        }
    }
} catch {
    foreach ($root in $changed) { [void](Invoke-Icacls @($root, "/remove:g", $group)) }
    throw "ACL reconciliation failed and the reviewed root ACLs were restored: $($_.Exception.Message)"
}

Write-Output "APPLIED`t$createdBackup"
