[CmdletBinding()]
param([string]$OutputDirectory)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$arguments = @((Join-Path $PSScriptRoot "build-release.mjs"))
if ($OutputDirectory) { $arguments += $OutputDirectory }
& $node.Source @arguments
exit $LASTEXITCODE
