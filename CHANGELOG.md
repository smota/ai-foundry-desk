# Changelog

## Unreleased

- Replaced the unreleased `afd observe` surface with declarative `afd telemetry` plan/apply/status,
  verification, trace, refresh, stop, and explain commands; no compatibility wrapper is retained.
- Added a checksummed upstream OpenTelemetry Collector, loopback Phoenix, isolated observe-only
  agentacct, schema-v2 identity/correlation, content-free filtering, transactional apply/rollback,
  and one current-user autostart supervisor.
- Made recipe confirmation the single activation decision for agentacct and every other declared
  Observability effect. Native Codex and Claude OTLP settings are exact and reversible.
- Added a private read-only WSL namespace for Codex rollout import without copying its transcripts
  or coupling AFD to the private SQLite schema.
- Added recipe-bound PEP 751 dependency locks with artifact hashes and a CycloneDX 1.6 telemetry
  SBOM; changing either lock invalidates the recipe consent token.
- Added executable privacy canaries and bounded redaction/freshness diagnostics, plus a content-free
  pilot evidence collector for latency, CPU, memory, managed disk, and log growth.
- Activated recipe 1.3.0 with agentacct 0.10.1, isolated CPython 3.10.21 for Phoenix, 179-component
  SBOM, exact handling of active Codex rollout rotation, and documented Evidence v2 shadow disable.
- Completed snapshotted two-root ReadAndExecute reconciliation, destructive managed-state
  rollback/reapply, privacy verification, five-sample healthy pilot, stop/resume, and the full fresh
  hybrid-sandbox matrix.
- Made the Windows `afd` launcher use the exact managed Node runtime instead of a session-dependent
  mise shim, and made `telemetry resume` reconcile its declared current-user autostart entry.

## 0.3.0 — 2026-08-27

- Added native Linux/WSL2 Layer 1 runtime, doctor, fix, verification, and hardlink adapters.
- Added Docker Engine to Layer 1 as an independent host tool while explicitly prohibiting Docker
  as the execution mechanism for Layers 1–3.
- Added native Linux Layer 2 toolbox and integrity-pinned agent CLI adapters, plus portable Linux
  routing and HOME isolation for Layer 3.
- Added optional local Observability with pinned Phoenix, native host metrics, OTLP redaction,
  project/run identity, managed lifecycle, and explicit opt-in autostart.
- Added identity-aware executable doctor probes, CLI provenance, bounded process-tree execution,
  PID-reuse protection, a fresh-sandbox validation matrix, and a reviewed ACL reconciler with
  exact-target backup and rollback.
- Added reproducible Node-based release packaging and isolated offline artifact validation.

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
