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
afd layer1 --dry-run
afd layer2 --dry-run
afd sync --dry-run
.\scripts\10-verify-backups.ps1
pnpm check
```

Do not run `hermes update`, promote pending/Hermes skills automatically, overwrite drift, run
`pnpm setup`, or manage tokens/login/history/plugins. Continue from [ROADMAP.md](ROADMAP.md).
