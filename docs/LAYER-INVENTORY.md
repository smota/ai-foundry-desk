# Layer inventory

This is the quick-reference inventory for AI Foundry Desk Layers 1–3. It describes what each
component is for, where it comes from, and how AFD treats it. Versions remain pinned in the
implementation and manifests; the links below intentionally point to the maintained product or
project pages.

> **Native-first rule:** Docker is a Layer 1 host capability. AFD never uses it to install or run
> Layers 1, 2, or 3. Higher-layer workloads may use containers only when the user explicitly asks
> for them or when a documented technical requirement makes them necessary.

## At a glance

| Layer | Outcome | Inventory | Installation boundary |
| --- | --- | --- | --- |
| **1 — Foundation** | A stable native workstation | Runtime authority, language runtimes, package workflows, supply-chain security, Docker host capability, diagnostics | User-scoped by default; Docker is a reviewed platform-specific privileged step |
| **2 — Agent setup** | Consistent agents and utilities | Agent CLIs/apps, common toolbox, shared catalog and profiles | Detect first, preview, then install or synchronize only supported adapters |
| **3 — Recipes** | Reviewed, repeatable personal bundles | Recipe engine, shared skills and optional pinned tools | Plan is mandatory; apply is confirmed; rollback touches managed files only |

Legend: **Managed** means AFD can install or reconcile it. **Integrated** means AFD can detect or
synchronize with it but may deliberately leave installation to its publisher. **Capability** means
it is available to workloads without becoming the execution environment for AFD itself.

## Layer 1 — Foundation

Categories organize the inventory conceptually; they are not extra layers or an execution order.
Security remains cross-cutting even where a tool has a primary functional category.

### Runtime authority and language runtimes

| | Tool / product | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
| <img src="https://cdn.simpleicons.org/mise" alt="mise" width="22"> | [mise](https://mise.jdx.dev/) | Polyglot runtime and tool version manager. | Provide one declared source of truth for runtime versions and shims. | **Managed**; pinned, checksum-verified binary. |
| <img src="https://cdn.simpleicons.org/python" alt="Python" width="22"> | [Python](https://www.python.org/) | General-purpose programming runtime. | Support Python applications, automation, and agent tooling. | **Managed** by mise. |
| <img src="https://cdn.simpleicons.org/nodedotjs" alt="Node.js" width="22"> | [Node.js](https://nodejs.org/) | JavaScript runtime used by AFD and many agent tools. | Run the AFD CLI and Node-based development tools. | **Managed** by mise. |
| <img src="https://cdn.simpleicons.org/go" alt="Go" width="22"> | [Go](https://go.dev/) | Compiled language and toolchain. | Support Go projects and utilities without a system-wide version conflict. | **Managed** by mise. |
| <img src="https://cdn.simpleicons.org/rust" alt="Rust" width="22"> | [Rust](https://www.rust-lang.org/) | Systems language and Cargo toolchain. | Support Rust projects and source-based tooling. | **Managed** by mise. |

### Package workflows and supply-chain security

| | Tool / product | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
| <img src="https://cdn.simpleicons.org/astral" alt="Astral" width="22"> | [uv](https://docs.astral.sh/uv/) | Fast Python project and package workflow tool. | Create reproducible Python environments while mise remains the runtime authority. | **Managed**; pinned, checksum-verified binary. |
| <img src="https://cdn.simpleicons.org/pnpm" alt="pnpm" width="22"> | [pnpm](https://pnpm.io/) | Disk-efficient Node.js package manager with native dependency-build approval. | Install from lockfiles without mixing dependency trees and keep lifecycle builds default-deny through project `allowBuilds`. | **Managed** through Corepack; pinned version. |
|  | [`@lavamoat/allow-scripts`](https://github.com/LavaMoat/LavaMoat/tree/main/packages/allow-scripts) | Runs only dependency lifecycle hooks explicitly allowed by project policy. | Bootstrap deny-by-default lifecycle-script policy for npm, Yarn, and mixed-tool projects. | **Managed CLI**; exact version and registry integrity verified, installed with lifecycle scripts disabled; policy remains project-owned. |

### Native host capability

| | Tool / product | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
| <img src="https://cdn.simpleicons.org/docker" alt="Docker" width="22"> | [Docker](https://docs.docker.com/) | Container runtime and build tooling: Docker Desktop on Windows/macOS, Docker Engine on Ubuntu. | Offer a native host capability for workloads that explicitly need containers. | **Capability**; platform-native reviewed installation, never an AFD layer runtime; no automatic startup, terms acceptance, backend change, privileged preconfiguration, or group membership. |

### Diagnostics and controlled recovery

| | Tool / product | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
| <img src="../assets/brand/ai-foundry-desk-logo.png" alt="AFD" width="22"> | AFD doctor, fix and verifier | Read-only diagnostics, scoped reconciliation, and compact verification. | Explain drift and repair only state owned by the foundation. | **Managed component**; dry-run before apply. |

## Layer 2 — Agents and common toolbox

### Agent surfaces

| | Tool / product | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
| <img src="https://cdn.simpleicons.org/anthropic" alt="Anthropic" width="22"> | [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | Anthropic's terminal coding agent. | Provide a supported agent surface for shared skills and profiles. | **Integrated**; pinned package, with publisher postinstall requiring explicit approval. |
| <img src="https://cdn.simpleicons.org/openai" alt="OpenAI" width="22"> | [Codex](https://developers.openai.com/codex/cli) | OpenAI's local coding agent and CLI. | Provide a supported agent surface for repository work and shared guidance. | **Managed/integrated**; pinned CLI package. |
| <img src="https://cdn.simpleicons.org/google" alt="Google" width="22"> | [Google Antigravity](https://antigravity.google/) | Google's agentic development environment. | Extend the shared catalog to a supported desktop agent surface. | **Integrated**; detection/sync where supported, installation currently deferred on Linux. |
|  | [Pi](https://github.com/badlogic/pi-mono) | Extensible terminal coding agent. | Provide a lightweight agent surface with shared skill visibility. | **Managed/integrated**; pinned CLI package. |
|  | [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Nous Research command-line agent. | Make the shared skill catalog available to another terminal agent. | **Integrated**; checksum-verifiable Linux installation remains deferred. |
| <img src="https://cdn.simpleicons.org/x" alt="xAI" width="22"> | [Grok CLI](https://www.npmjs.com/package/@vibe-kit/grok-cli) | Terminal agent powered by Grok models. | Provide another supported CLI surface for shared guidance. | **Managed/integrated**; pinned CLI package. |
| <img src="../assets/brand/ai-foundry-desk-logo.png" alt="AFD" width="22"> | Agent Manager | Canonical catalog, small profiles, one-way sync, drift detection, and safe adoption. | Keep shared guidance consistent without owning agent credentials or native data. | **Managed component**; previewable and idempotent. |

### Common Agent Toolbox

| | Tool | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
|  | [ripgrep (`rg`)](https://github.com/BurntSushi/ripgrep) | Fast recursive text search with ignore-file support. | Find code, configuration, and references quickly. | **Managed**; pinned release. |
|  | [`fd`](https://github.com/sharkdp/fd) | Friendly, fast filesystem search. | Locate files without complex platform-specific syntax. | **Managed**; pinned release. |
| <img src="https://cdn.simpleicons.org/jq" alt="jq" width="22"> | [`jq`](https://jqlang.org/) | JSON query and transformation utility. | Inspect machine-readable output and manifests. | **Managed**; pinned release. |
|  | [`yq`](https://mikefarah.gitbook.io/yq/) | YAML, JSON and TOML processor. | Inspect and transform structured configuration. | **Managed**; pinned release. |
|  | [`bat`](https://github.com/sharkdp/bat) | Source viewer with syntax highlighting and context. | Make read-only source inspection faster and clearer. | **Managed**; pinned release. |
| <img src="https://cdn.simpleicons.org/git" alt="Git" width="22"> | [`delta`](https://dandavison.github.io/delta/) | Syntax-aware viewer for Git and diff output. | Improve review clarity without changing Git's global behavior. | **Managed**; pinned release. |

## Layer 3 — Recipes

Layer 3 is an execution contract rather than a general-purpose package manager. Every recipe is
loaded from a declared local, built-in, or HTTPS source, validated, planned, confirmed, applied,
and verified. Rollback is limited to files and links recorded as AFD-managed.

| | Component / product | Description | Objective in the layer | AFD treatment |
| --- | --- | --- | --- | --- |
| <img src="../assets/brand/ai-foundry-desk-logo.png" alt="AFD" width="22"> | [AFD recipe engine](LAYER-3-RECIPES.md) | Planner and transactional installer for reviewed bundles. | Turn personal workstation extensions into visible, repeatable changes. | **Managed component**; plan and confirmation are mandatory. |
|  | [Holoself](https://github.com/smota/holoself) | Portable, reviewable personal context distributed as an agent skill. | Give detected agents the same user-owned context without duplicating its source. | **Integrated** by the built-in smota-foundations recipe through an explicit local overlay. |
|  | [Vibium](https://www.npmjs.com/package/vibium) | Browser automation CLI and library. | Add the browser-control tool declared by the smota-foundations bundle. | **Managed by recipe**; pinned package and integrity hash. |
|  | [Tokscale](https://www.npmjs.com/package/tokscale) | Local token-usage analysis CLI. | Add the usage-analysis tool declared by the smota-foundations bundle. | **Managed by recipe**; pinned package and integrity hash. |
|  | [Herdr](https://herdr.dev/) | Persistent terminal runtime for coding agents and plugin workflows. | Give local agents durable workspaces without replacing their native CLIs. | **Managed by recipe through Layer 1 mise**; exact version, companion agent skill for all supported agents, immutable plugin inputs, and platform-specific verification. Separate from Hermes MCP management. |

## Reading the inventory safely

- A product appearing here does not mean AFD owns its login, subscription, credentials, updates,
  conversations, projects, or native configuration.
- Platform-specific availability is documented in [Platform support](PLATFORM-SUPPORT.md). A green
  verification result applies only to the environment and versions listed there.
- Exact versions, checksums, package integrity values, and recipe prerequisites live in the scripts,
  package lockfile, and recipe manifests so that documentation cannot silently override executable
  policy.
- Installation and reconciliation boundaries are documented in [Security boundaries](SECURITY-BOUNDARIES.md).
