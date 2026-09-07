# TypeScript platform migration

AFD host control uses TypeScript as the source of truth for planning, state, mutation, verification, recovery, and rollback. Native operating-system executables remain narrow adapters; PowerShell and POSIX scripts do not define Layer 1 or Layer 2 behavior.

## Migrated host paths

- `afd layer1 plan|apply|verify|recover|rollback`
- `afd layer2 plan|apply|verify|recover|rollback`
- aggregate `afd verify` host-layer verification
- observability, backup reporting and retention, legacy-state migration, project initialization, MCP management, and harness management

The host capability catalogue separates reviewed installation pins from accepted compatibility ranges and declares ownership as `user-managed`, `afd-configured`, or `afd-owned`. Plans bind live executable evidence plus profile or user-environment hashes. Apply persists checkpoint receipts, recovery replans current state, and rollback uses compare-and-swap boundaries.

Windows persistence uses scoped native registry operations. Linux/WSL persistence replaces only an AFD-marked profile block. Both preserve unrelated PATH and profile content. Docker remains an optional, separate privilege boundary rather than an implicit Layer 1 mutation.

## Remaining script-backed paths

- `afd fix rust` uses the reviewed Windows Build Tools adapter.
- `afd fix sandbox` uses the reviewed Windows ACL adapter.
- `afd hermes update` remains script-backed pending a receipt-compatible TypeScript adapter.
- Docker helper scripts remain separate, explicitly privileged procedures.
- release bootstrap scripts remain distribution entrypoints and must verify package checksums.

A remaining script can be retired after its replacement has deterministic plans, stale-state protection, failure evidence, recovery or safe rollback, behavioral tests, platform evidence, and no operational documentation or packaging references.
