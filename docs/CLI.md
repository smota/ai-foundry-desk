# `afd` command-line reference

`afd` is the single command-line entry point for AI Foundry Desk. This reference documents every
user-facing command and the operational maintenance commands present in version 0.6.2. Run
`afd help` for the compact syntax summary and `afd --version` for the installed version.

## Command model

- Commands that inspect state are read-only.
- Commands with `--dry-run` preview without writing. Use the paired `--apply` or `--confirm` form
  only after reviewing that output.
- Recipe and harness plans use content-derived approval tokens. A changed plan invalidates its token.
- Human-readable output is the default. `--json` is available only where shown.
- Exit code `0` means the command completed and its checks passed. Exit code `2` means the command
  completed but found drift, blockers, failed verification, or missing evidence. Exit code `1`
  means invalid usage or an operational error.

Paths containing spaces should be quoted. On Windows, run machine-repair commands from a regular
PowerShell session for the intended user, not from an agent sandbox.

## Find help and inspect the installation

| Command | Effect |
| --- | --- |
| `afd help`, `afd --help`, `afd -h` | Print compact command syntax. |
| `afd --version`, `afd -v` | Print the CLI version. |
| `afd init [--dry-run]` | Confirm that AFD is ready for inspection and print safe next steps. It never applies a layer. |
| `afd provenance [--json]` | Show the CLI path, product root, Node.js runtime, version, and execution identity. |
| `afd catalog` | List supported agent targets and their skill, profile, and user/project MCP capabilities. |
| `afd tui` | Open the interactive terminal interface. It calls the same application services as the CLI and requires a TTY. |

See [Terminal user interface](TUI.md) for the complete capability taxonomy, keyboard map,
accessibility modes, safety workflow, and production-rendered screenshots.

## Diagnose, install, and repair the workstation

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd doctor [--json]` | No | Diagnose the foundation and sandbox-access postconditions. JSON output is intended for automation. |
| `afd layer1 --dry-run` | No | Plan the runtime, package-manager, PATH, shim, and host-tool foundation. |
| `afd layer1 --apply` | Yes | Apply the reviewed Layer 1 plan through the platform adapter. |
| `afd layer2 --dry-run` | No | Plan supported agent CLIs/apps and the common toolbox. |
| `afd layer2 --apply` | Yes | Apply the reviewed Layer 2 plan. |
| `afd layer2 --apply --allow-claude-postinstall` | Yes | Linux only: explicitly allow Claude's upstream postinstall during Layer 2 apply. |
| `afd fix layer1 --dry-run` | No | Preview reconciliation of AFD-owned Layer 1 state. |
| `afd fix layer1 --apply` | Yes | Reconcile AFD-owned Layer 1 state, then rerun the doctor. |
| `afd fix sandbox --dry-run` | No | Windows only: preview the fixed-target, RX-only sandbox toolchain ACL repair. |
| `afd fix sandbox --apply` | Yes | Apply and verify the reviewed sandbox-access repair. |
| `afd verify` | No | Inspect catalog drift and run the platform verification scripts. |

`layer1`, `layer2`, and `fix` require exactly one of `--dry-run` or `--apply`. macOS currently plans
supported declarative surfaces but fails closed for unimplemented layer automation.

## Manage shared skills and profiles

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd status` | No | Show planned catalog/profile changes and drift. |
| `afd review` | No | Show planned changes plus pending agent-created skills. |
| `afd sync --dry-run` | No | Preview one-way synchronization from the canonical catalog. |
| `afd sync` | Yes | Synchronize non-divergent managed skills and profile blocks; drift remains preserved. |
| `afd adopt <agent> <skill> [--dry-run]` | Preview or pending copy | Inspect an agent-owned skill or copy it into the pending review area. |
| `afd import <agent> <skill> [--dry-run]` | Preview or pending copy | Alias of `adopt`. |
| `afd pending` | No | List pending skills. |
| `afd promote <agent> <skill> --dry-run` | No | Preview promotion into the canonical catalog. |
| `afd promote <agent> <skill> --confirm` | Yes | Promote the reviewed pending skill. |
| `afd reject <agent> <skill> --dry-run` | No | Preview rejection and snapshot creation. |
| `afd reject <agent> <skill> --confirm` | Yes | Reject the pending skill and retain its recoverable snapshot. |
| `afd recover <agent> <rejected-snapshot> --dry-run` | No | Preview recovery of a rejected snapshot. |
| `afd recover <agent> <rejected-snapshot> --confirm` | Yes | Return a rejected snapshot to pending review. |
| `afd hermes update --dry-run` | No | Preview the guarded Hermes update. |
| `afd hermes update --apply` | Yes | Apply the guarded Hermes update. |

Valid agent IDs are reported by `afd catalog`. `adopt`/`import` never promote automatically.

## Manage MCP configuration

AFD manages explicitly selected Model Context Protocol server definitions across a canonical user
registry, a project registry, and verified native agent files. `user` scope is workstation-wide;
`project` scope belongs to one project; `effective` combines both for inspection or synchronization.
When a non-user scope omits `--project`, the current directory is used.

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd mcp status [--scope user\|project\|effective] [--project <path>] [--agents <list>] [--json]` | No | Plan synchronization and report blockers or drift. Defaults to effective scope. |
| `afd mcp verify [--scope user\|project\|effective] [--project <path>] [--agents <list>] [--json]` | No | Verify the same registry/native-file postconditions as status. |
| `afd mcp discover <agent> --scope user\|project [--project <path>] [--agents <list>] [--json]` | No | Read one verified native agent surface and return redacted definitions and fingerprints. |
| `afd mcp sync --scope user\|project\|effective [--project <path>] [--agents <list>] [--enable-pi-adapter] --dry-run [--json]` | No | Produce the exact redacted synchronization plan and approval token. |
| `afd mcp sync --scope user\|project\|effective [--project <path>] [--agents <list>] [--enable-pi-adapter] --confirm <plan-token> [--json]` | Yes | Revalidate and atomically apply the reviewed synchronization plan. |
| `afd mcp adopt <agent> <server> --from-scope user\|project --to-scope user\|project [--project <path>] [--agents <list>] [--enable-pi-adapter] --dry-run\|--confirm <plan-token> [--json]` | Preview or apply | Adopt one discovered server definition into the destination registry and selected native targets. |
| `afd mcp enable <server> --scope user\|project [--project <path>] [--agents <list>] [--enable-pi-adapter] --dry-run\|--confirm <plan-token> [--json]` | Preview or apply | Enable one managed server at the selected scope. |
| `afd mcp disable <server> --scope user\|project [--project <path>] [--agents <list>] [--enable-pi-adapter] --dry-run\|--confirm <plan-token> [--json]` | Preview or apply | Disable one managed server at the selected scope. |
| `afd mcp move <server> --from user\|project --to user\|project --project <path> [--agents <list>] [--enable-pi-adapter] --dry-run\|--confirm <plan-token> [--json]` | Preview or apply | Atomically move a server definition between user and project scope. |

Mutating MCP commands require exactly one of `--dry-run` or `--confirm <plan-token>`. `--agents`
accepts unique comma-separated IDs from `afd catalog`. Default all-agent plans fail closed when any
selected scope lacks a verified adapter; narrow the target list only intentionally. Pi's adapter is
an extension and requires explicit `--enable-pi-adapter` consent.

Discovery and plans omit rendered configuration values. Secret-like environment and header values
must remain environment references; OAuth/login state is never read or copied. Concurrent edits
invalidate approval tokens, unmanaged native entries are preserved, and failed transactions restore
earlier writes from local snapshots. See [MCP configuration](MCP-CONFIGURATION.md) for the task
workflow and per-agent support boundaries.

## Manage Layer 3 recipes

A recipe source can be a built-in identifier such as `builtin:smota-foundations`, a local JSON file,
a local directory containing a recipe, or a direct HTTPS URL accepted by the recipe loader.

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd layer3 recipes` | No | List built-in recipes. |
| `afd layer3 show <source>` | No | Load, validate, and print the normalized recipe. |
| `afd layer3 plan <source>` | No | Expand managed effects, blockers, and the approval token. |
| `afd layer3 <source>` | No | Shorthand for `plan`. |
| `afd layer3 apply <source> --confirm <plan-token>` | Yes | Revalidate and apply the exact reviewed plan. |
| `afd layer3 verify <source>` | No | Check managed recipe state for missing items or drift. |
| `afd layer3 rollback <source> --confirm` | Yes | Remove or restore only state recorded as managed by that recipe. |
| `afd layer3 extract --output <file>` | No | Print the global inventory and stop so it can be reviewed. |
| `afd layer3 extract --output <file> --include <id,id>` | Yes | Write a sanitized declarative recipe containing only the selected inventory IDs. |

Use `afd layer3 show <source>` before planning an unfamiliar local or remote recipe. HTTPS recipes
are data, not script delivery: redirects and arbitrary executable adapters are rejected.

## Operate observability

The default recipe source is `builtin:observability`. Pass `--recipe <source>` to the plan or apply
flow when using another recipe that declares the Observability capability.

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd telemetry plan [--recipe <source>]` | No | Plan the recipe-managed capability and run its preflight checks. |
| `afd telemetry apply --confirm <plan-token> [--recipe <source>]` | Yes | Apply the reviewed capability; on Windows, also ensure the loopback broker is available. |
| `afd telemetry status [--json]` | No | Report component, source, retention, and health state. |
| `afd telemetry verify` | No | Verify the configured telemetry runtime. |
| `afd telemetry explain <run-id> [--json]` | No | Explain one correlated run using bounded metadata. |
| `afd telemetry refresh --agentacct` | Local operational state | Refresh supported agentacct-derived evidence. |
| `afd telemetry trace --workspace <path> --agent <name> --operation <name> [--outcome ok\|error\|cancelled] [--duration-ms <ms>]` | Local operational state | Emit a bounded OTLP trace and correlation record. |
| `afd telemetry stop` | Yes | Stop managed telemetry runtime components. |
| `afd telemetry resume` | Yes | Resume managed telemetry components and reconcile autostart where supported. |
| `afd telemetry uninstall-autostart` | Yes | Remove AFD-managed telemetry autostart. |

Supported trace agent names are `claude-code`, `codex`, `antigravity` (or input alias `agy`), `pi`,
and `hermes`. The default outcome is `ok` and the default duration is `0`. Raw client session IDs
are intentionally rejected. See [Observability](OBSERVABILITY.md) for privacy and coverage details.

`afd telemetry broker [--already-resumed]` is an internal Windows operational entry point used to
serve bounded loopback requests under the interactive identity. It is not an interactive user
workflow and fails when the process identity does not match the user profile.

## Govern project instructions with harnesses

`<project>` is the repository to inspect. `--agents` accepts `auto` or a comma-separated subset of
supported harness agents. `--remove-legacy` proposes removal only for recognized legacy adapters;
project-owned divergent content remains protected.

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd harness audit <project> [--json]` | No | Identify canonical policy, adapters, duplication, contradictions, discovery risk, and blockers. |
| `afd harness plan <project> [--agents <auto\|list>] [--remove-legacy] [--json]` | No | Produce exact changes, hashes, blockers, and an approval token. |
| `afd harness stage <project> --output <outside-directory> [--agents <auto\|list>] [--remove-legacy] [--json]` | Outside project only | Revalidate and render proposed files into an external staging directory. |
| `afd harness test <project> [--agents <auto\|list>] [--remove-legacy] [--live] [--evidence <outside-project-file>] [--timeout-ms <1000-600000>] [--json]` | Disposable workspace; optional evidence file | Check runner readiness or execute bounded live smoke tests against staged policy. Default timeout: 120000 ms. |
| `afd harness apply <project> [--agents <auto\|list>] [--remove-legacy] --evidence <passing-live-report> --confirm <plan-token> [--json]` | Yes | Transactionally apply the exact plan after matching passing evidence. |
| `afd harness verify <project> --receipt <file> [--json]` | No | Verify applied artifacts and the complete Git-visible workspace fingerprint. |
| `afd harness rollback <project> --receipt <file> --confirm <plan-token> [--json]` | Yes | Refuse drift, restore exact previous bytes, and write a rollback receipt. |

Harness receipts and evidence must stay outside the target project. See [Project harnesses](PROJECT-HARNESSES.md)
for the policy model and safety contract.

## Backups and migration

| Command | Writes? | Purpose |
| --- | --- | --- |
| `afd backup status` | No | Report snapshot counts, sizes, and retention violations by target. |
| `afd backup maintain --dry-run` | No | Preview snapshots that exceed retention. |
| `afd backup maintain --apply` | Yes | Remove only snapshots identified by the retention policy. |
| `afd migrate --dry-run` | No | Preview migration of recognized legacy AFD state. |
| `afd migrate --apply` | Yes | Apply the reviewed legacy-state migration. |

## Automation notes

Use `afd doctor --json`, `afd provenance --json`, harness `--json` modes, and telemetry JSON modes
where a stable machine-readable form is explicitly offered. Do not assume every command emits JSON:
some operational commands intentionally use tab-delimited summaries or JSON as their only output.
Treat exit code `2` as an actionable result rather than a parser or invocation failure.
