# Architecture

AI Foundry Desk is one product with four internal modules:

1. Layer 1 Foundation: Windows PowerShell, mise, uv, pnpm, runtimes, PATH, and interactive guardrails.
2. Layer 2 Bootstrap: Windows PowerShell, WinGet, agent applications and CLIs.
3. Common Agent Toolbox: rg, fd, jq, yq, bat, and delta.
4. Agent Manager: portable Node.js/TypeScript catalog, adapters, review, sync, verify, adopt, and recipes.

Observability is a recipe-managed capability available to Layer 2 rather than another sequential
layer. It uses an existing loopback OpenTelemetry Collector for filtering/routing, Phoenix for live
traces, agentacct for observation-only session intelligence, and an AFD-owned bounded correlation
index. AFD does not wrap agent execution or duplicate complete third-party evidence stores. See
[Observability](OBSERVABILITY.md) and the [Observability implementation plan](OBSERVABILITY-PLAN.md).

Observability is expressed as declarative recipe desired state. Recipe planning expands every
managed effect; confirmation of that content-derived plan authorizes installation, configuration,
startup, native integrations, and autostart declared by the recipe. Components do not request a
second activation confirmation during apply.

`afd` is the single user entry point. Portable inspection and catalog logic stays in Node.js.
`afd layer1`, `afd doctor`, `afd fix layer1`, and `afd layer2` cross an explicit bridge to an
allowlist of Windows PowerShell or Linux POSIX scripts. Doctor is read-only; fix delegates to the idempotent Layer 1 source
of truth and runs doctor afterward. No layer
runs by default or during `afd init`.

The user catalog is stored at `~/.afd` and operational backups remain under
`%LOCALAPPDATA%\AI Foundry Desk\backups`. Codex, Pi,
and Grok read `~/.agents/skills`; Claude, Antigravity, and managed Hermes receive one-way mirrors.
Claude, Codex, and Pi support a small managed profile block. Grok, Hermes, and Antigravity profiles
remain deferred because no stable profile contract is used.

Recipe planning is read-only and produces a content-derived approval token. Apply rejects stale or
missing tokens, records only paths and allowlisted package changes it manages, verifies drift, and
rolls back only that recorded state. HTTPS recipes reject redirects and arbitrary executable adapters.

Windows x64 and Ubuntu 26.04.1 WSL2 x86_64 are validated within their documented scope. Docker is a
Layer 1 host tool, not an execution substrate for Layers 1–3. Tokens, OAuth state, history, memory,
sessions, and proprietary plugins are never shared.
