# Roadmap

## Ready

- One product with `afd`, Layer 1, Layer 2, toolbox, Agent Manager, doctor, controlled Layer 1 fix,
  dry-run, verification, and backups.
- Pinned/checksummed Hermes staging updates, explicit pending-skill review, official Antigravity
  skill mirroring, and deterministic local/internal/HTTPS recipes with scoped rollback.
- smota-foundations recipe for Holoself, pinned Vibium/Tokscale, plus fail-closed local extraction.
- Recipe-managed telemetry-v2 with a checksummed upstream Collector, Phoenix, observe-only
  agentacct, native Codex/Claude OTLP configuration, one consent boundary, bounded correlation, and
  `afd telemetry explain <run-id>`.
- Recipe-bound PEP 751 dependency locks, artifact hashes, and a CycloneDX SBOM for Phoenix and
  agentacct, plus read-only Codex session import that does not depend on its Windows SQLite carrier.
- Observability recipe `1.4.0` defines the native-agentacct daily Layer 2 environment with Collector
  `0.159.0`, Phoenix `20.4.0` on isolated CPython `3.10.21`, agentacct `0.10.1` on native mise
  Python, privacy canaries, current-user autostart, and managed rollback.
- Windows x64 and Ubuntu 26.04.1 WSL2 x86_64 have implemented and tested platform adapters; native
  Linux outside WSL still needs independent validation evidence.
- Scope-aware MCP registries, redacted discovery, hash-bound transactions, enable/disable, atomic
  scope moves, and Claude Code/Codex/Antigravity/Grok plus Hermes-user adapters are implemented.
  Pi is available through an explicitly consented, pinned adapter declaration; plans fail closed
  without that declaration and for unsupported Hermes project scope.
- Project harness audit, hash-bound staging, and disposable multi-agent smoke tests are implemented
  without claiming that file presence proves an agent loaded the policy.
- `afd tui` provides a responsive HQTUI interface over the shared typed application service, with
  complete command taxonomy, shell-free inputs, explicit write review, accessible fallbacks,
  headless tests, and production-rendered documentation screens.

## Next cycle

1. Close the remaining MCP adapter evidence gap in
   [MCP-CONFIGURATION-DESIGN.md](MCP-CONFIGURATION-DESIGN.md): establish genuine Hermes project
   scoping before enabling default all-target project apply.
2. Reduce the measured `status`/`explain` p95 baseline of about 10.3 seconds without weakening
   fail-closed source checks, privacy, or process isolation.
3. Add Hermes native operational OTLP only after its recipe effects and content-free vocabulary are
   reviewed. Implement Pi telemetry as a native extension, not a launcher wrapper. Keep AGY explicit
   as unsupported until a stable native contract exists.
4. Track agentacct Evidence v2 upstream maturity and enable it only after its shadow refresh is
   conflict-free in live acceptance; v1 session/usage/Work Receipt evidence remains the daily path.
5. CI matrices for the validated Windows workflows and portable unit suite.
6. Assisted `npx skills` integration without duplicating the native workflow or implicit network use.
7. Grok/Hermes/Antigravity profiles only after stable official contracts exist.
8. Optional local/private Tokscale reporting without credential capture or duplicated session data.

## Maintainer/release decisions

- Security contact and response SLA.
- CI, SBOM, provenance, checksum signing, and artifact signing.
- Registry/organization governance; npm publication is not planned for the current channel.

## Platform expansion — contributions welcome

- Validate the implemented macOS Layer 1 adapters on Apple Silicon and Intel hardware, then add a
  representative CI matrix before making a validated compatibility claim.
- Implement macOS Layer 2 adapters while preserving the shared core and fail-closed boundaries.
- Validate the Linux adapters on native Ubuntu hardware/VMs in addition to the WSL2 fixture.
- Define WSL behavior separately from native Windows and Linux after its boundaries are tested.
- Add platform and architecture CI matrices only when representative environments are available.

These are roadmap goals, not current compatibility claims. New platform behavior belongs behind
explicit adapters; AI Foundry Desk remains one product with one portable core.

## Later

- Windows ARM64 and native CI matrices.

## Deliberately out of scope

Shared credentials, login state, memory replication, proprietary plugins, automatic skill promotion,
full sandboxing, Paperclip, RTK, loopersai, ai-memory, ponytail, AFD-owned session parsers, and raw
session/transcript ingestion into Phoenix.
