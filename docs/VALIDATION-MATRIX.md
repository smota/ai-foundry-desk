# Agent environment validation matrix

AI Foundry Desk is complete for agent use only when the same matrix passes in a fresh sandbox
session, not only in the interactive user shell.

## Required evidence

| Gate | Expected evidence |
| --- | --- |
| Identity | The sandbox token is reported explicitly; a hybrid token/profile context is warning-only and all persistent repair is refused. |
| Toolchain | Node 24, pnpm 11.23.0, mise, uv/uvx, Python 3.14, Go 1.26, and Rust/Cargo 1.98 resolve and execute within bounded time. |
| Product | `pnpm check` passes lint, typecheck, tests, and build. |
| Process lifecycle | The process-tree fixture times out and leaves its parent, child, and grandchild stopped. |
| Provenance | Workspace and global CLI report AFD 0.3.0 and identify their CLI/runtime paths. |
| Doctor | No `FAIL` diagnostic remains; a hybrid context never recommends or performs profile/HKCU repair. |
| Observability — runtime | One confirmed recipe apply activates every declared component without nested confirmation. `afd telemetry verify` proves Collector, Phoenix, loopback/privacy policy, schema compatibility, an allowlisted control attribute, and synthetic rejection canaries. `status --json` reports each agent capability and the bounded redaction/freshness diagnostics independently. |
| Observability — release | A disposable supported run is resolved by `explain`; restart and rollback pass on a fresh workstation; recipe-bound PEP 751 locks and the CycloneDX SBOM are complete; and no capability declared required is degraded. Codex import uses the original rollout tree through a stable private read-only WSL namespace. |

Current host result (2026-08-28): the reviewed ACL reconciliation added ReadAndExecute only to the
WinGet Packages parent and `jdx.mise` package root after taking an exact ACL snapshot. The fresh
hybrid sandbox then passed all 18 matrix checks, including direct managed runtimes, `pnpm check`,
doctor, telemetry contracts, provenance, and process-tree cleanup. The ACL rollback remains
available from the managed snapshot.

Run from a fresh sandbox:

```powershell
.\scripts\12-validate-agent-environment.ps1 -RequireSandbox
```

Use `-Json` for machine-readable evidence. The verifier does not alter PATH, profiles, ACLs,
services, autostart, credentials, or observability state. `pnpm check` rebuilds only ignored
repository artifacts (`dist` and `.test-dist`).

After the recipe is active, `scripts\14-validate-observability-pilot.ps1` collects bounded CPU,
memory, latency, managed-disk, and log-growth evidence without emitting paths or raw content. Use
`-RunVerify` for the synthetic privacy/trace gate and `-RunId` for `explain` latency. Startup and
recovery measurements remain part of the explicitly reviewed stop/resume acceptance sequence.

`afd telemetry` has replaced the unreleased `afd observe` surface. Automation uses sanitized
fixtures; raw local-session inspection is reserved for an explicitly reviewed live acceptance run.
Full objectives and go-live criteria are in the
[Observability implementation plan](OBSERVABILITY-PLAN.md).

The recipe plan is the review boundary. Validation must prove that its approval token covers the
complete expanded Observability desired state and that no component asks for duplicate activation
during apply.

If the toolchain gate fails with access denied, do not run `afd fix layer1 --apply`: expose a
reviewed executor-owned toolchain or grant read/execute only to the exact managed runtime roots,
then start a new sandbox session and repeat the complete matrix. The Windows-only reviewed
reconciliation and rollback procedure is documented in [Agent sandbox toolchain repair](AGENT-SANDBOX-REPAIR.md).
