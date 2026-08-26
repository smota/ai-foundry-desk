# AI Foundry Desk

**Multi-Agent Workbench**

[![GitHub stars](https://img.shields.io/github/stars/smota/ai-foundry-desk?style=flat-square&logo=github&label=stars)](https://github.com/smota/ai-foundry-desk)
[![GitHub watchers](https://img.shields.io/github/watchers/smota/ai-foundry-desk?style=flat-square&logo=github&label=watchers)](https://github.com/smota/ai-foundry-desk/subscription)
[![License: MIT](https://img.shields.io/github/license/smota/ai-foundry-desk?style=flat-square&label=license)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/smota/ai-foundry-desk?style=flat-square&logo=github&label=release)](https://github.com/smota/ai-foundry-desk/releases/latest)
[![Validated on Windows x64](https://img.shields.io/badge/validated-Windows%20x64-0078D4?style=flat-square&logo=windows11)](docs/README-LAYER-1.md)
[![Linux WSL validated](https://img.shields.io/badge/validated-Linux%20WSL2-FCC624?style=flat-square&logo=linux&logoColor=black)](docs/PLATFORM-SUPPORT.md)

![AI Foundry Desk multi-agent workstation banner](assets/brand/ai-foundry-desk-banner.png)

<p align="center">
  <img src="assets/brand/ai-foundry-desk-logo.png" alt="AI Foundry Desk logo: a luminous multi-agent workstation" width="144">
</p>

AI Foundry Desk prepares and governs a personal Windows workstation for multiple AI coding agents.
It is a local workbench—not a SaaS platform, team orchestrator or credential manager. The product
combines a conservative Windows foundation, an idempotent agent bootstrap and a portable
Node/TypeScript control plane for shared skills and small profiles.

Windows x64 is the only platform implemented, tested, and validated today. macOS and Linux are
product direction and roadmap items, not currently supported platforms. The project is licensed
under MIT.

Contributions that implement, test, and validate macOS or Linux adapters are warmly welcomed.
The product will keep one portable core and place operating-system behavior behind explicit,
reviewable adapters; see [Contributing](CONTRIBUTING.md) and the [Roadmap](docs/ROADMAP.md).

## What is included

- **Layer 1 / Foundation:** mise, uv, pnpm, pinned runtimes, PATH and interactive guardrails.
- **Layer 2 / bootstrap:** Claude/Codex desktop detection; Claude Code, Codex CLI, Antigravity, Pi,
  Hermes and Grok; no login or token handling.
- **Agent Manager:** one-way catalog sync, status, review, verify, drift protection and pending import.
- **Common toolbox:** `rg`, `fd`, `jq`, `yq`, `bat` and `delta`; RTK is deliberately excluded.
- **Recovery:** local backups under `%LOCALAPPDATA%\AI Foundry Desk\backups` with bounded retention.

Canonical configuration lives under `%USERPROFILE%\.afd`; operational state lives under
`%LOCALAPPDATA%\AI Foundry Desk`. Neither is published.

## Recommended Windows install

The current versioned Windows/PowerShell bootstrap installs only `afd`; it does **not** apply either layer.
This command downloads the bootstrap and its checksum, verifies SHA-256 locally, and only then runs it:

```powershell
$v='0.1.1'; $u="https://github.com/smota/ai-foundry-desk/releases/download/v$v"; $d=Join-Path $env:TEMP "afd-$v"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest "$u/afd-bootstrap.ps1" -OutFile "$d/afd-bootstrap.ps1"; Invoke-WebRequest "$u/afd-bootstrap.ps1.sha256" -OutFile "$d/afd-bootstrap.ps1.sha256"; $e=((Get-Content "$d/afd-bootstrap.ps1.sha256") -split '\s+')[0]; if((Get-FileHash "$d/afd-bootstrap.ps1" -Algorithm SHA256).Hash -ne $e){throw 'AFD bootstrap checksum mismatch'}; & "$d/afd-bootstrap.ps1" -Version $v
```

The bootstrap requires Node.js 24+ and pnpm. After installation, open a new terminal and preview:

```powershell
afd init --dry-run
afd layer1 --dry-run
afd layer2 --dry-run
```

## Local development install

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

Diagnose Layer 1 without writing, then reconcile only AFD-managed state when explicitly approved:

```powershell
afd doctor
afd doctor --json
afd fix layer1 --dry-run
afd fix layer1 --apply
```

`doctor` reports structured PASS/WARN/FAIL results. `fix` never resets the machine: it is limited to
declared Layer 1 packages and mise runtimes, user environment/PATH, managed profile blocks, shims,
and PNPM_HOME. Windows aliases, third-party runtimes, projects, credentials, and Layer 2 are reported
but not modified.

## Linux/WSL and macOS bootstrap status

`scripts/afd-bootstrap-posix.sh` is a separate POSIX adapter with `--dry-run`, SHA-256 verification,
and an isolated `--prefix`. Linux support is limited to the WSL distribution and portable CLI cycle
recorded in [Platform support](docs/PLATFORM-SUPPORT.md). It installs only `afd` and never applies
Layers. macOS detection is experimental and fail-closed because no real macOS host was validated.
Never use a blind remote pipe; download the script and checksum separately before execution.

Layer 2 preserves functional installations and does not authenticate agents. `afd sync --dry-run`
previews shared skill/profile reconciliation; `afd sync` is always explicit.

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

Brand artwork is documented in [assets/brand/README.md](assets/brand/README.md).
