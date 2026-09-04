# Changelog

## Unreleased

- Install or verify Docker Desktop as a default Windows and macOS Layer 1 host capability through
  explicit, elevation-aware adapters without automatic startup, terms acceptance, backend changes,
  privileged preconfiguration, or group edits.
- Install the integrity-pinned `@lavamoat/allow-scripts` CLI on Windows and Linux with lifecycle
  hooks disabled, while keeping pnpm/LavaMoat dependency-script approval policy project-owned.
- Group the Layer 1 inventory into runtime, package workflow, supply-chain security, host capability,
  and diagnostic categories without introducing additional sequential layers.
- Add checksum-pinned Apple Silicon and Intel macOS Layer 1 runtime, Docker, doctor, verifier, and
  POSIX bootstrap adapters; the implementation remains unvalidated until exercised on real hardware.
- Add recipe schema v3 and `herdr-workbench` for exact Herdr 0.8.2 installation through the existing
  Layer 1 Mise authority on Windows, Linux/WSL2, and implemented-but-unvalidated macOS, with
  immutable manifest-hashed plugin declarations and managed-only rollback.
- Keep Herdr independent from Hermes MCP, and make the current Hermes user-global MCP limitation an
  explicit project-scope capability gate until a released native contract passes non-leak validation.

## 0.6.4 — 2026-09-01

- Unified the stable release identity across the CLI, package manifests, bootstrap defaults,
  validation gates, installation examples, GitHub Releases, and npm's `latest` distribution tag.
- Made production builds delete prior output and reject emitted modules that do not correspond to
  current TypeScript sources, preventing stale code from entering a release.
- Added explicit npm metadata, a runtime-only script allowlist, sensitive-content and artifact-size
  release gates, and disposable npm/pnpm installation smokes outside the repository.
- Split release publication into least-privilege jobs that share one audited tarball across GitHub
  Releases and stage-only npm trusted publishing with maintainer 2FA approval.

## 0.6.3-rc.1 — 2026-09-01

- Made production builds delete prior output and reject emitted modules that do not correspond to
  current TypeScript sources, preventing stale code from entering a release.
- Added explicit npm metadata, a runtime-only script allowlist, sensitive-content and artifact-size
  release gates, and disposable npm/pnpm installation smokes outside the repository.
- Split release publication into least-privilege jobs that share one audited tarball across GitHub
  Releases and stage-only npm trusted publishing with maintainer 2FA approval.

## 0.6.2 — 2026-09-01

- Explore all 74 AFD actions from one interactive terminal workspace with `afd tui`, organized by
  outcome so you can discover the right workflow without memorizing commands.
- Search capabilities, edit inputs without shell quoting, review structured results, and move between
  keyboard-accessible responsive layouts. High-contrast, monochrome, ASCII, reduced-motion, and
  mouse-free modes keep the interface usable across terminals and accessibility needs.
- Keep control of every change: read-only actions run directly, while writes show their scope and
  require the same explicit confirmation, drift checks, receipts, and rollback protections as the
  CLI.
- Receive checksummed assets from a release path that is now exercised on pull requests before a tag
  can trigger public publication.

## 0.6.1 — 2026-09-01

- Explore all 74 AFD actions from one interactive terminal workspace with `afd tui`, organized by
  outcome so you can discover the right workflow without memorizing commands.
- Search capabilities, edit inputs without shell quoting, review structured results, and move between
  keyboard-accessible responsive layouts. High-contrast, monochrome, ASCII, reduced-motion, and
  mouse-free modes keep the interface usable across terminals and accessibility needs.
- Keep control of every change: read-only actions run directly, while writes show their scope and
  require the same explicit confirmation, safety tokens, drift checks, receipts, and rollback
  protections as the CLI.
- Use the CLI and TUI interchangeably without behavioral surprises because both interfaces call the
  same application and command services.
- Install from checksummed release assets produced by a corrected Windows publication workflow that
  creates its isolated temporary directory before dependency setup.

## 0.6.0 — 2026-09-01

- Explore all 74 AFD actions from one interactive terminal workspace with `afd tui`, organized by
  outcome so you can discover the right workflow without memorizing commands.
- Search capabilities, edit inputs without shell quoting, review structured results, and move between
  keyboard-accessible responsive layouts. High-contrast, monochrome, ASCII, reduced-motion, and
  mouse-free modes keep the interface usable across terminals and accessibility needs.
- Keep control of every change: read-only actions run directly, while writes show their scope and
  require the same explicit confirmation, safety tokens, drift checks, receipts, and rollback
  protections as the CLI.
- Use the CLI and TUI interchangeably without behavioral surprises. Both interfaces now call the
  same application and command services instead of duplicating or parsing command logic.
- Start quickly with a practical TUI guide and production-rendered screenshots, including a
  machine-redacted real doctor result.
- Contribute through a protected pull-request workflow with automatic merged-branch cleanup and
  tag-driven releases that validate versions and artifacts before publication.

## 0.5.0 — 2026-08-31

- Added one scope-aware MCP workflow for discovering, adopting, synchronizing, enabling, disabling,
  and moving server definitions between user and project configuration.
- Added native user/project adapters for Claude Code, Codex, Antigravity, and Grok, a verified
  user adapter for Hermes, and explicit opt-in Pi support through pinned `pi-mcp-adapter` 2.31.0;
  AFD reports per-scope capabilities and blocks all-target operations whenever an agent cannot
  safely represent the requested scope or its third-party adapter has not been consented to.
- Added canonical user/project registries, whole-entry project precedence, project tombstones,
  deterministic fingerprints, redacted plans, and content-derived confirmation tokens.
- Preserved unrelated JSON, TOML, and YAML settings while refusing divergent unmanaged entries,
  undocumented value conversions, inline secret-like values, unsafe project paths, and stale plans.
- Made compound MCP changes transactional with pre-change snapshots and byte-for-byte rollback on
  failure; added focused coverage for idempotence, drift, unsupported targets, atomic scope moves,
  project-only disable, comment preservation, and injected mid-transaction failure.

## 0.4.0 — 2026-08-31

- Added the project-harness workflow: read-only repository audit, hash-bound human/JSON plans,
  external staging, and minimal agent adapters that point to one canonical project policy instead
  of copying its instructions.
- Added disposable live smoke tests that exercise the proposed harness in fresh, bounded,
  read-only agent sessions. Every selected agent must return the same canonical-policy fingerprint;
  unavailable, unsupported, inconsistent, or mutating agents fail closed.
- Added evidence-gated transactional apply, exact post-apply verification, private receipts, and
  drift-refusing rollback. Plans bind the canonical hash, Git revision, and Git-visible workspace
  state so an older approval cannot be applied after the project changes.
- Added conservative legacy cleanup for proven redundant or unselected thin pointers, including
  `AGY.md` where appropriate. Divergent project-owned instructions are preserved and block apply
  until a human reconciles them.
- Documented the four review gates and validated the audit against Ativaly, MoveTheNeedle,
  Metaskills, and Holoself without modifying those repositories.

## 0.3.1 — 2026-08-31

- Added AFD 0.3.1's transparent WinGet-update compatibility contract: `afd doctor` detects
  package-replacement ACL drift, while `afd fix sandbox --dry-run|--apply` provides the only
  fixed-target, RX-only, snapshot-backed mutation path. AFD continues to leave installation and
  updates with the user's normal package managers.
- Documented environment ownership, post-update operations, execution-context boundaries, and the
  security tradeoff of granting the dedicated Codex sandbox group read/execute access only to
  declared toolchain targets.
- Declared a disposable project-local pnpm store so normal-user and sandbox processes do not derive
  incompatible `node_modules` metadata from different user-global stores.
- Kept read-only telemetry status schema-stable when the interactive-user broker is offline;
  mutating operations still fail closed and no service is started implicitly.
- Replaced the unreleased `afd observe` surface with declarative `afd telemetry` plan/apply/status,
  verification, trace, refresh, stop, and explain commands; no compatibility wrapper is retained.
- Added a checksummed upstream OpenTelemetry Collector, loopback Phoenix, isolated observe-only
  agentacct, schema-v2 identity/correlation, content-free filtering, transactional apply/rollback,
  and one current-user autostart supervisor.
- Made recipe confirmation the single activation decision for agentacct and every other declared
  Observability effect. Native Codex and Claude OTLP settings are exact and reversible.
- Replaced the interim WSL-hosted agentacct path with an AFD-managed native Windows runtime using
  mise Python, uv isolation, Windows file locking, and AFD-owned process lifecycle. Codex stores are
  read directly through agentacct's public importer; AFD still does not parse its private SQLite
  schema or copy transcripts.
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
- Made mise's global runtime pins explicit under its reviewed LocalAppData root, strengthened the
  fresh-agent gate to exercise raw shell commands and live telemetry health, and added an
  authenticated current-user broker for bounded control from elevated Windows sandboxes.

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
  verification, drift detection, scoped rollback, safe extraction, and the smota-foundations recipe.

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
