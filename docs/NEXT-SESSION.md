# Next session handoff

## Current state

- AI Foundry Desk 0.1.x: Windows x64 Foundation, agent bootstrap, toolbox, and Agent Manager.
- Daily command: `afd`; no layer runs automatically.
- Canonical catalog/state: `%USERPROFILE%\.afd`.
- Operational state/backups: `%LOCALAPPDATA%\AI Foundry Desk`.
- Supported skills: Claude, Codex, Pi, Grok, Hermes. Antigravity is deferred.
- Supported base profiles: Claude, Codex, Pi. Grok and Hermes profiles are deferred.

## Safe starting order

```powershell
afd --version
afd status
afd verify
afd doctor
afd doctor --json
afd fix layer1 --dry-run
afd layer1 --dry-run
afd layer2 --dry-run
afd sync --dry-run
.\scripts\10-verify-backups.ps1
pnpm check
```

Start with doctor. Use fix dry-run only for managed Layer 1 reconciliation, and require explicit
`--apply` before writing. Linux/WSL currently covers the portable bootstrap/CLI cycle only; Windows
Layers remain fail-closed there. macOS remains experimental and unvalidated.

Do not run `hermes update`, promote pending/Hermes skills automatically, overwrite drift, run
`pnpm setup`, or manage tokens/login/history/plugins. Continue from [ROADMAP.md](ROADMAP.md).
