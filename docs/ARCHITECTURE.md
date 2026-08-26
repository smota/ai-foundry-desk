# Architecture

AI Foundry Desk is one product with four internal modules:

1. Layer 1 Foundation: Windows PowerShell, mise, uv, pnpm, runtimes, PATH, and interactive guardrails.
2. Layer 2 Bootstrap: Windows PowerShell, WinGet, agent applications and CLIs.
3. Common Agent Toolbox: rg, fd, jq, yq, bat, and delta.
4. Agent Manager: portable Node.js/TypeScript catalog, adapters, review, sync, verify, and adopt.

`afd` is the single user entry point. Portable inspection and catalog logic stays in Node.js.
`afd layer1` and `afd layer2` cross an explicit bridge to an allowlist of Windows scripts. No layer
runs by default or during `afd init`.

The user catalog is stored at `~/.afd` and operational backups remain under
`%LOCALAPPDATA%\AI Foundry Desk\backups`. Codex, Pi,
and Grok read `~/.agents/skills`; Claude and Hermes receive one-way mirrors. Claude, Codex, and Pi
support a small managed profile block. Antigravity skills and Grok/Hermes profiles remain deferred.

Windows x64 is the only validated platform. Tokens, OAuth state, history, memory, sessions, and
proprietary plugins are never shared.
