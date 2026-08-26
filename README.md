# AI Foundry Desk

**Multi-Agent Workbench**

AI Foundry Desk prepares and governs a personal Windows workstation for multiple AI coding agents.
It is a local workbench—not a SaaS platform, team orchestrator or credential manager. The product
combines a conservative Windows foundation, an idempotent agent bootstrap and a portable
Node/TypeScript control plane for shared skills and small profiles.

Windows x64 is the only validated platform today. The project is licensed under MIT.

## What is included

- **Layer 1 / Foundation:** mise, uv, pnpm, pinned runtimes, PATH and interactive guardrails.
- **Layer 2 / bootstrap:** Claude/Codex desktop detection; Claude Code, Codex CLI, Antigravity, Pi,
  Hermes and Grok; no login or token handling.
- **Agent Manager:** one-way catalog sync, status, review, verify, drift protection and pending import.
- **Common toolbox:** `rg`, `fd`, `jq`, `yq`, `bat` and `delta`; RTK is deliberately excluded.
- **Recovery:** local backups under `%LOCALAPPDATA%\ai-workstation\backups` with bounded retention.

Existing state paths keep the `ai-workstation` name for compatibility with installations made
before the product rename. They are local implementation details and are never published.

## Safe local start

From a clone, install the CLI from an audited local package in one command:

```powershell
.\install-local.ps1
```

This builds and installs `afd`; it does **not** apply either layer. Preview first:

```powershell
afd --help
afd status
afd verify
afd init --dry-run
afd layer1 --dry-run
afd layer2 --dry-run
```

Apply only after reviewing the preview:

```powershell
afd layer1 --apply
afd layer2 --apply
```

Layer 2 preserves functional installations and does not authenticate agents. `afd sync --dry-run`
previews shared skill/profile reconciliation; `afd sync` is always explicit.

## Future public one-line install

The intended release flow is a pinned GitHub release or npm package followed by `afd init --dry-run`.
No remote pipe command is published yet: registry ownership, signed release automation, checksums,
SBOM and provenance must be established first. The local command above is the supported audited path.

## Safety boundaries

- No tokens, logins, history, memory or proprietary plugins are shared.
- Drift is never silently overwritten; Hermes-created skills are never auto-promoted.
- `hermes update` is blocked interactively until a verified update workflow exists.
- `-WhatIf`/`--dry-run` must not write logs or state.
- Backups, logs, local state, caches, profiles and installations are excluded from releases.

## Development

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm afd -- --help
pnpm pack:dry-run
```

## Documentation

- [Next session handoff](docs/NEXT-SESSION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Layer 1](docs/README-LAYER-1.md)
- [Layer 2 bootstrap](docs/README-LAYER-2-AGENTS.md)
- [Skills and profiles](docs/LAYER-2-SYNC.md)
- [Security boundaries](docs/SECURITY-BOUNDARIES.md)
- [Roadmap](docs/ROADMAP.md)
- [Release process](docs/RELEASING.md)

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [LICENSE](LICENSE).
