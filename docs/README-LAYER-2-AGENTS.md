# Layer 2 agent bootstrap

Layer 2 detects/preserves Claude Desktop and Codex Desktop and provides Claude Code, Codex CLI,
Antigravity CLI, Pi, Hermes Agent, and Grok Build through official channels. It never authenticates
agents or writes tokens.

```powershell
afd layer2 --dry-run
afd layer2 --apply
.\scripts\07-verify-layer2-agent-clis.ps1
.\scripts\07-verify-layer2-toolbox.ps1
```

WinGet is preferred when an appropriate official package exists. Pi and Grok use their official npm
packages through pnpm. Hermes uses a pinned official installer and a canonical `hermes.cmd` launcher
that invokes its existing Python entry point, avoiding the uv trampoline failure seen across MSIX
virtualization. Competing Hermes bin paths are removed. Interactive `hermes update` remains blocked;
`afd hermes update --dry-run|--apply` verifies the pinned installer, installs with mise Python 3.11
inside staging, validates the command, preserves skills, and publishes under `~/.afd/managed/hermes`.
Personal configuration and credentials remain in their existing Hermes home.

The shared toolbox contains `rg`, `fd`, `jq`, `yq`, `bat`, and `delta`. It creates no global cat/git
aliases. RTK, Paperclip, loopersai, ai-memory, ponytail, agentacct, and Tokscale are not installed.
