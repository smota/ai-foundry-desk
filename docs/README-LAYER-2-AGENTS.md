# Layer 2 agent and toolbox bootstrap

Layer 2 detects and preserves independently managed agent CLIs, and installs missing reviewed defaults through the installer declared in the TypeScript capability catalogue. It never authenticates an agent or writes tokens.

```powershell
afd layer2 plan
afd layer2 apply --confirm <plan-token>
afd layer2 verify
```

The catalogue covers Claude Code, Codex CLI, Antigravity CLI, Pi, Hermes Agent, Grok Build, `rg`, `fd`, `jq`, `yq`, `bat`, `delta`, and `glow`. Installation pins and compatibility ranges are separate, so compatible user updates are retained. pnpm packages are integrity-checked before installation and verified through their exact global launcher. Packages with an upstream lifecycle build name that consent explicitly in the plan bound to the confirmation token.

WinGet is used for reviewed Windows packages. Linux/WSL toolbox commands use mise; Node CLIs use the compatible user-managed pnpm. Missing optional tools such as Hermes or Antigravity are reported without blocking the layer when no verified automated installer is declared.

Receipts persist after each checkpoint. Recovery replans current state and does not repeat capabilities that are already compatible. Rollback retires AFD operation state but never uninstalls user-owned packages or overwrites independent updates.
