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
afd layer1 plan
afd layer1 verify
afd layer2 plan
afd layer2 verify
afd sync --dry-run
afd recipes
afd plan builtin:smota-foundations
.\scripts\10-verify-backups.ps1
pnpm check
```

Start with doctor. Layer apply requires the exact current plan token. Linux/WSL and Windows use the
same TypeScript lifecycle; Docker and elevation remain separate boundaries. A clean macOS host fails
closed where no architecture-specific verified installer is declared.

Do not promote pending/private skills automatically, overwrite drift, run `pnpm setup`, or manage
tokens/login/history/plugins. Continue from [ROADMAP.md](ROADMAP.md).
