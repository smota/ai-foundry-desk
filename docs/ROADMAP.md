# Roadmap

## Ready

- One product with `afd`, Layer 1, Layer 2, toolbox, Agent Manager, dry-run, verification, and backups.
- Windows x64 is the only implemented, tested, and validated platform; MIT license; GitHub
  repository and release artifact allowlist.

## Next cycle

1. Safe Hermes update with pin, checksum, backup, rollback, and launcher validation.
2. Explicit review/promotion for pending and private Hermes skills.
3. Assisted `npx skills` integration without duplicating the native workflow or implicit network use.
4. Antigravity adapter and Grok/Hermes profiles after stable official contracts exist.
5. Optional Tokscale observability, local and private by default.

## Maintainer/release decisions

- Security contact and response SLA.
- CI, SBOM, provenance, checksum signing, and artifact signing.
- Registry/organization governance; npm publication is not planned for the current channel.

## Platform expansion — contributions welcome

- Implement, test, document, and validate macOS adapters while preserving the shared core.
- Implement, test, document, and validate Linux adapters while preserving the shared core.
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
