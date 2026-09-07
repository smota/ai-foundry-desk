# Layer 1 foundation

Layer 1 provides the minimum native, verifiable foundation for an AI workstation. The TypeScript capability catalogue is the single source of truth for installation pins, compatible version ranges, ownership, and platform installers.

- mise configures Python 3.14, Node.js 24, Go 1.26, and Rust 1.98.
- uv uses the mise-managed Python and may not download another Python runtime.
- pnpm remains user-managed. Compatible independent upgrades, including pnpm 12, are preserved.
- `@lavamoat/allow-scripts` is installed at the reviewed default with lifecycle scripts disabled. AFD verifies the registry integrity and the exact launcher returned by `pnpm bin --global`.
- Project dependencies remain project-scoped and lockfiles remain authoritative.

Use the receipt-backed lifecycle:

```powershell
afd layer1 plan
afd layer1 apply --confirm <plan-token>
afd layer1 verify
```

Interrupted operations use `recover --confirm <plan-token>`. Rollback restores only unchanged AFD-managed profile or user-environment values. It deliberately does not uninstall tools: after installation, those tools are user-owned and may have been independently updated.

On Windows, the reviewed plan binds user environment values and a deduplicated PATH edit before mutation. It preserves every unrelated entry and never replaces the process PATH. On Linux/WSL, it updates only marked blocks in `~/.profile` and `~/.bashrc`, snapshots prior bytes, and refuses rollback after later user edits. New child processes receive the same additive managed-path overlay so a first install can continue without restarting the shell.

Docker is optional and has a separate privilege boundary. AFD reports it but does not install, start, authorize, change group membership, or accept terms as part of Layer 1. Use the platform-specific Docker procedure only after a separate review.

`afd doctor` and `afd layer1 verify` execute bounded version probes and report command candidates, selected provenance, ownership, and supported ranges. A missing optional capability is a warning; an incompatible user-managed tool is preserved and reported rather than silently replaced.
