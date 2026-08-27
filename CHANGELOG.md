# Changelog

## 0.3.0 — 2026-08-27

- Added native Linux/WSL2 Layer 1 runtime, doctor, fix, verification, and hardlink adapters.
- Added Docker Engine to Layer 1 as an independent host tool while explicitly prohibiting Docker
  as the execution mechanism for Layers 1–3.
- Added native Linux Layer 2 toolbox and integrity-pinned agent CLI adapters, plus portable Linux
  routing and HOME isolation for Layer 3.

## 0.2.0 — 2026-08-26

- Validated the Windows x64 Layer 1 foundation, persistent PATH reconstruction, hardlinks, and an
  idempotent pilot project.
- Added strict manifests, explicit pending-skill review/promotion/rejection/recovery, official
  Antigravity skill mirroring, and a pinned/checksummed managed Hermes update workflow.
- Added deterministic Layer 3 recipes with plan tokens, allowlisted integrity-pinned tools,
  verification, drift detection, scoped rollback, safe extraction, and the Samuel recipe.

## 0.1.2 — 2026-08-26

- Added structured `afd doctor` and controlled `afd fix layer1` reconciliation.
- Made the PowerShell bootstrap explicitly Windows-specific.
- Added a checksum-verified POSIX bootstrap with validated Linux/WSL scope and experimental macOS detection.

## 0.1.1 — 2026-08-26

- Made all public product text consistently English.
- Added a SHA-256-verified GitHub Release bootstrap that never applies Layers automatically.
- Renamed active user state to `%USERPROFILE%\.afd` and `%LOCALAPPDATA%\AI Foundry Desk` with a safe legacy migration.
- Renamed the canonical managed skill to `afd-workbench-principles`.

## 0.1.0 — 2026-08-26

- Initial public product foundation under the AI Foundry Desk name.
- `afd` CLI with safe status, verify, sync and explicit Layer 1/2 bridges.
- Windows x64 Foundation, agent bootstrap, Agent Manager, toolbox and local backup policy.
