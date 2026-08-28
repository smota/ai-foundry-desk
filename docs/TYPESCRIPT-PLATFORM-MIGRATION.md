# TypeScript platform migration

AFD is moving host control into TypeScript. Native executables remain allowed, but PowerShell and POSIX scripts must not be the source of truth for planning, state, mutation, verification, or rollback.

## Contract

`NodePlatformAdapter` provides process execution, managed process lifecycle, local state, loopback probes, and verified HTTPS downloads. Platform-specific persistence is implemented with native operating-system facilities:

- Windows: `winget.exe`, `schtasks.exe`, and user-scoped configuration.
- Linux: native tools and `systemd --user`.
- macOS: native tools and `launchd` agents.

## Migrated paths

- Observability lifecycle, Collector archive verification, and autostart.
- Legacy state migration.
- Backup reporting and retention.
- Cross-platform `afd doctor` diagnostics.
- Bootstrap and release packaging use Node.js entrypoints.
- Recipe tool shims invoke native `.cmd` executables on Windows rather than
  routing through PowerShell.

## Transitional paths

The following command paths are intentionally still backed by legacy scripts.
They remain part of the released product and must not be described as migrated
until their TypeScript replacements satisfy the exit criteria below:

| CLI path | Current legacy source | Required replacement scope |
| --- | --- | --- |
| `afd fix layer1 --apply` | Layer 1 PowerShell/POSIX scripts | Declarative reconciliation, user-scoped runtime installation, safe PATH/profile mutation, verification and rollback. |
| `afd layer1 --apply` | Layer 1 PowerShell/POSIX scripts | Same Layer 1 lifecycle, with platform-specific native executables only behind the adapter. |
| `afd layer2 --apply` | Layer 2 PowerShell/POSIX scripts | Catalogued tool/agent adapters, explicit postinstall consent, verification and rollback. |
| `afd hermes update` | `08-update-hermes.ps1` | Hermes adapter with managed skill state, preview, apply and safe recovery. |
| `afd verify` | Layer verification PowerShell/POSIX scripts | TypeScript verification contracts for Foundation, Layer 2 and backups. |

The legacy Windows and POSIX bootstrap files are retained so already published
releases remain installable. The new release builder produces a Node.js
bootstrap, but it is not a published distribution artifact until its release
validation succeeds; release documentation must name the artifact version it
describes.

## Exit criteria for script retirement

A legacy script may be removed only after its TypeScript replacement has:

1. An explicit plan, apply, verify, and rollback or safe failure contract.
2. Unit tests for normal, dry-run, conflict, and failure paths.
3. A platform adapter test on every claimed operating system.
4. Clean-host validation evidence and release documentation.
5. No remaining CLI, package, release, or documentation reference as its operational source.

The remaining migrations are bootstrap/release, Layer 1, Layer 2, Hermes update, and their verification paths. Existing scripts are transitional references only until those criteria are met.
