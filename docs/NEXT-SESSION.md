# Next session handoff

## Current state

- AI Foundry Desk 0.2.x: validated Windows x64 Foundation, agent bootstrap, toolbox, Agent Manager,
  review workflow, and deterministic recipes.
- Daily command: `afd`; no layer runs automatically.
- Canonical catalog/state: `%USERPROFILE%\.afd`.
- Operational state/backups: `%LOCALAPPDATA%\AI Foundry Desk`.
- Supported skill targets: Claude, Codex, Antigravity, Pi, Grok, and managed Hermes.
- Supported base profiles: Claude, Codex, and Pi. Grok, Hermes, and Antigravity profiles remain deferred.
- Hermes updates use `afd hermes update --dry-run` followed by explicit `--apply`.

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
afd recipes
afd plan builtin:smota-foundations
.\scripts\10-verify-backups.ps1
pnpm check
```

Start with doctor. Use fix dry-run only for managed Layer 1 reconciliation, and require explicit
`--apply` before writing. Linux/WSL currently covers the portable bootstrap/CLI cycle only; Windows
Layers remain fail-closed there. macOS Layer 1 is implemented but unvalidated on hardware; Layer 2
remains fail-closed.

Do not promote pending/private skills automatically, overwrite drift, run `pnpm setup`, or manage
tokens/login/history/plugins. Continue from [ROADMAP.md](ROADMAP.md).
