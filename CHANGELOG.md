# Changelog

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
