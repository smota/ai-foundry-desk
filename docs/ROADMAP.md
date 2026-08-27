# Roadmap

## Ready

- One product with `afd`, Layer 1, Layer 2, toolbox, Agent Manager, doctor, controlled Layer 1 fix,
  dry-run, verification, and backups.
- Pinned/checksummed Hermes staging updates, explicit pending-skill review, official Antigravity
  skill mirroring, and deterministic local/internal/HTTPS recipes with scoped rollback.
- Samuel recipe for Holoself, pinned Vibium/Tokscale, plus fail-closed local extraction.
- Windows x64 and Ubuntu 26.04.1 WSL2 x86_64 have implemented and tested platform adapters; native
  Linux outside WSL still needs independent validation evidence.

## Next cycle

1. CI matrices for the validated Windows workflows and portable unit suite.
2. Assisted `npx skills` integration without duplicating the native workflow or implicit network use.
3. Grok/Hermes/Antigravity profiles only after stable official contracts exist.
4. Optional local/private Tokscale reporting without credential or session capture.

## Maintainer/release decisions

- Security contact and response SLA.
- CI, SBOM, provenance, checksum signing, and artifact signing.
- Registry/organization governance; npm publication is not planned for the current channel.

## Platform expansion — contributions welcome

- Implement, test, document, and validate macOS adapters while preserving the shared core.
- Validate the Linux adapters on native Ubuntu hardware/VMs in addition to the WSL2 fixture.
- Define WSL behavior separately from native Windows and Linux after its boundaries are tested.
- Add platform and architecture CI matrices only when representative environments are available.

These are roadmap goals, not current compatibility claims. New platform behavior belongs behind
explicit adapters; AI Foundry Desk remains one product with one portable core.

## Later

- OpenTUI interface over existing CLI contracts.
- Windows ARM64 and native CI matrices.

## Deliberately out of scope

Shared credentials, login state, memory, sessions, proprietary plugins, automatic skill promotion,
full sandboxing, Paperclip, RTK, loopersai, ai-memory, ponytail, and agentacct.
