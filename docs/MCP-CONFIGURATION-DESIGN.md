# MCP configuration management design

Status: core implemented; verified adapters and open capability blockers documented
Scope: AFD Agent Manager, user and project MCP configuration
Last reviewed: 2026-08-31

## Outcome

AFD will provide one safe workflow to manage an MCP server definition across the agents selected in
the AFD manifest. A user can:

- adopt a server definition from an existing agent at user or project scope;
- synchronize the definition to every selected agent that can represent it;
- enable or disable it at user or project scope without deleting the definition; and
- move it between user and project scope as one verified transaction.

AFD must not report success merely because it wrote files. It reports separate `configured`,
`pending-trust`, `pending-auth`, `active`, `disabled`, `drift`, and `unsupported` states. The feature
is complete only when every manifest-selected target supports the requested scope and the effective
state is verified. An unsupported target blocks an all-target operation; it is never silently
skipped.

## Why this belongs in Agent Manager

Layer 2 already owns agent discovery, manifests, one-way synchronization, drift preservation,
backups, dry runs, explicit review, and verification. MCP configuration needs the same safety model.
It must not become another recipe system or a direct agent-to-agent copy loop.

MCP servers can execute local processes or expose remote tools and data. Their configuration has a
higher risk than a skill or profile: a changed command can execute code, a changed URL can redirect
traffic, and inline environment or header values can contain credentials. Consequently MCP changes
use content-derived approval tokens, the same class of review boundary as recipe apply.

## Canonical ownership and scope

AFD owns only definitions explicitly adopted or created in its registries:

| Scope | Canonical registry | Meaning |
|---|---|---|
| User | `~/.afd/mcp/user.json` | Available to the user in every project |
| Project | `<project>/.afd/mcp.json` | Effective only when that project is active |
| State | `~/.afd/state/mcp/<scope-id>.json` | Applied fingerprints and adapter receipts |
| Backups | existing AFD operational backup root | Pre-change native file snapshots |

Native agent files are render targets, not canonical sources. Existing unmanaged native entries are
preserved and reported as `importable`. A user must adopt one explicit source before AFD manages it.
This avoids choosing a winner when two agents contain different definitions with the same name.

The project registry is safe to version only when it contains no machine-specific paths or secret
values. AFD should suggest a local ignore rule when a project registry cannot pass that portability
check; it must not edit `.gitignore` implicitly.

### Precedence

The effective definition for a server ID is resolved as follows:

1. Project entry, when present.
2. User entry.

Entries are replaced as a whole, never field-merged. A project entry with only an override and
`enabled: false` is a tombstone that disables an inherited user server in that project. Enabling it
at project scope removes the tombstone when the user definition is enabled, or records an explicit
project override when needed.

Moving a definition changes ownership rather than creating two definitions with precedence-based
ambiguity:

- user to project: create the full project entry, reconcile native project targets, then remove the
  user entry and reconcile native user targets;
- project to user: create the full user entry, reconcile native user targets, then remove the
  project entry and reconcile native project targets.

Both directions are one hash-bound transaction with rollback. A move never copies OAuth tokens,
credential stores, approval records, or agent login state.

## Canonical schema

The first schema should deliberately support only the portable intersection needed across agents:

```json
{
  "schemaVersion": 1,
  "servers": {
    "context7": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "environment": {
        "OPTIONAL_MODE": { "literal": "safe" },
        "SERVICE_TOKEN": { "fromEnv": "CONTEXT7_TOKEN" }
      },
      "enabled": true,
      "targets": ["claude-code", "codex", "antigravity", "pi", "hermes", "grok"]
    }
  }
}
```

Each server has:

- an ID matching `^[a-z0-9][a-z0-9_-]{0,63}$`;
- exactly one transport: `stdio` or `http` in schema version 1;
- transport-specific fields (`command`, `args`, and optional `cwd` for stdio; `url` for HTTP);
- environment and HTTP header values represented as a non-sensitive literal or an environment
  reference;
- an `enabled` desired state; and
- an explicit target list, defaulting to all manifest-selected MCP-capable agents.

A project registry may instead contain an override entry such as
`{"inherits":"user","enabled":false}`. Overrides cannot redefine transport fields; a full project
definition is required for that. An optional `cwd` must be portable in its scope: project entries
may use a project-relative path, while user entries need either an adapter-verified dynamic project
root or an explicitly reviewed machine path supported by every selected target.

SSE, WebSocket, tool-level allow/deny policy, agent plugins, and agent-specific extension fields are
not portable enough for the first schema. Adoption reports them as incompatible rather than
silently discarding them. A later schema may add a capability-gated extension map, but an entry
targeting every agent must remain within the verified common subset.

## Secret and execution boundary

AFD does not own secrets or authentication state.

- OAuth tokens, cookies, login databases, keyrings, and agent auth files are never read or copied.
- Authorization, cookie, API-key, token, and password-like values must be environment references;
  inline values block adoption and synchronization.
- Status and plans show server IDs, field names, source paths, and fingerprints, never resolved
  environment values, header values, URL query strings, or command output that may contain them.
- Project registries reject absolute credential paths and unsafe traversal. Project-relative paths
  are resolved inside the verified project root; user definitions may use reviewed absolute command
  paths but are marked non-portable.
- Structural verification does not start a server or access the network. `afd mcp verify --connect`
  is a separate explicit action because it may execute a command, contact a remote service, or
  trigger authentication.

AFD validates the complete definition before rendering it. It rejects NUL bytes, ambiguous shell
strings, unsupported transports, duplicate normalized IDs, unsafe reparse/symlink targets, and
configuration files that changed after planning.

## CLI contract

All read commands are side-effect free. Mutations use preview plus a content-derived confirmation
token. `--json` is available on every read/plan command.

```text
afd mcp status [--scope user|project|effective] [--project <path>] [--json]
afd mcp discover [--scope user|project] [--project <path>] [--json]
afd mcp adopt <agent> <server> --from-scope user|project --to-scope user|project \
  [--project <path>] --dry-run
afd mcp adopt <agent> <server> ... --confirm <plan-token>

afd mcp sync --scope user|project|effective [--project <path>] --dry-run
afd mcp sync ... --confirm <plan-token>

afd mcp enable <server> --scope user|project [--project <path>] --dry-run
afd mcp enable <server> ... --confirm <plan-token>
afd mcp disable <server> --scope user|project [--project <path>] --dry-run
afd mcp disable <server> ... --confirm <plan-token>

afd mcp move <server> --from user|project --to user|project [--project <path>] --dry-run
afd mcp move <server> ... --confirm <plan-token>

afd mcp verify [--scope user|project|effective] [--project <path>] [--connect] [--json]
```

`discover` inventories definitions without importing them. It produces redacted fingerprints and
same-name conflicts across native scopes. `adopt` imports exactly one named definition from one
agent and scope. `sync` is always canonical-to-native.

`enable`, `disable`, and `move` are compound operations: on confirmation they update the canonical
registry and reconcile all selected native targets. The user does not need to run a second sync for
the change to become configured. If native trust or authentication is still needed, the result is
successful as a configuration transaction but exits with an attention status and names the exact
manual action; it does not claim the server is active.

Recommended exit codes:

| Code | Meaning |
|---|---|
| 0 | Desired state structurally verified (`configured`, explicitly connected `active`, or intentionally `disabled`) |
| 2 | Configuration applied but attention remains (`pending-trust` or `pending-auth`) |
| 3 | Drift, conflict, or unsupported target blocked the operation; no mutation |
| 1 | Invalid input or operational failure; any partial mutation was rolled back |

## Adapter contract

MCP support is separate from the existing skill/profile capability flags:

```ts
type McpScopeCapability = "native" | "extension" | "unsupported" | "unverified";

interface McpAdapterCapability {
  readonly user: McpScopeCapability;
  readonly project: McpScopeCapability;
  readonly transports: readonly ("stdio" | "http")[];
  readonly canPersistDisabled: boolean;
  readonly activation: "live" | "restart" | "next-session";
}
```

Each adapter must implement `discover`, `plan`, `apply`, and `verify`. It may touch only the MCP
entries it owns and the minimal native disable/approval structure required for those entries.
Unknown keys and unrelated settings are preserved. An adapter must prove project scoping; copying a
project definition into a global file is not a valid overlay.

### Evidence-backed adapter baseline

This table records the implemented and verified support boundary:

| Agent | User surface | Project surface | Disable model | Design status |
|---|---|---|---|---|
| Claude Code | `~/.claude.json` | `<project>/.mcp.json` plus per-project state | per-project `disabledMcpServers` | implemented and fixture-tested |
| Codex | `~/.codex/config.toml` | `<project>/.codex/config.toml` in trusted projects | `enabled = false` | implemented and fixture-tested |
| Antigravity | `~/.gemini/config/mcp_config.json` | `<project>/.agents/mcp_config.json` | native `disabled` | official contract implemented and fixture-tested; `agy` absent on validation host |
| Pi | `~/.pi/agent/mcp.json` | `<project>/.pi/mcp.json` | native `disabled`, including project override | pinned `pi-mcp-adapter` 2.31.0 is declared only with explicit `--enable-pi-adapter` consent |
| Hermes | `~/.hermes/config.yaml` `mcp_servers` | no stable project-native contract established | native `enabled` exists | user implemented; project remains unsupported |
| Grok | `~/.grok/config.toml` | `<project>/.grok/config.toml` | native `enabled` state | implemented and fixture-tested |

The release gate is intentionally strict: `afd catalog` shows per-scope MCP capability, and an
all-target plan still fails while Pi lacks its explicitly consented adapter declaration or Hermes
lacks genuine project scoping. A future overlay is acceptable only if launching the normal configured agent
deterministically selects the project configuration; a special one-off wrapper that leaves the
server globally active does not satisfy project scope.

## Native rendering rules

Adapters should prefer structured, entry-level edits over whole-file replacement:

- JSON: parse strictly, preserve unrelated top-level and per-project keys, replace only the named
  managed entry, and write atomically.
- TOML: validate the complete document, detect same-name tables, and update only AFD-owned server
  tables. Use a TOML library; a line-oriented parser is not acceptable.
- YAML: use a safe schema without custom tags, preserve unrelated keys, and replace only the named
  `mcp_servers` entry. If reliable round-trip preservation cannot be guaranteed, use a reviewed
  native CLI adapter or mark the capability unsupported.

AFD records a normalized hash for every managed native entry, not a whole-file ownership claim.
Unmanaged changes elsewhere in the file do not create false drift. A changed managed entry does.

Native precedence and disable behavior must be tested independently. AFD must not assume that all
agents merge user and project maps the same way.

## Transaction and recovery

Every mutating operation follows this sequence:

1. Resolve and canonicalize the user home and project root.
2. Load the AFD manifest, both registries, adapter capabilities, and native fingerprints.
3. Validate portability, secrets, scope support, conflicts, and project trust prerequisites.
4. Produce an exact redacted action plan and a token derived from desired content, source hashes,
   target paths, adapter versions, and project identity.
5. On confirmation, acquire per-scope locks and re-check every hash.
6. Snapshot each native file and canonical registry before the first write.
7. Write temporary files, validate them, and atomically replace targets one adapter at a time.
8. Structurally verify all selected adapters. Roll back every changed file if any required adapter
   fails.
9. Record entry fingerprints and redacted receipts. Run optional connectivity verification only
   when explicitly requested.

Concurrent agent changes invalidate the plan instead of being overwritten. Recovery uses the
existing AFD backup retention policy and receives a dedicated
`afd mcp recover <transaction-id> --dry-run|--confirm <token>` command when implementation begins.

## Trust, authentication, and activation

Configuration propagation and runtime activation are related but distinct:

- Claude project MCP files can require workspace trust and explicit project-server approval.
- Codex project MCP configuration applies only to trusted projects.
- OAuth credentials are normally stored by each native client and are not portable.
- Some clients need a restart, reload, or next session before changed tool surfaces appear.

AFD never bypasses these controls. Adapter verification reports the required action and the
activation boundary. `active` means the native client reports the expected definition enabled and,
when `--connect` was authorized, the connection succeeds. Without connectivity authorization,
verification can prove `configured` or `disabled`, not remote service health.

## Acceptance tests

The implementation is done only when the following pass on Windows and the already supported Linux
fixture, with native-host validation where the agent exists:

1. **User sync:** adopt one portable stdio and one HTTP definition from a native user config; sync
   them to every manifest-selected agent; preserve unrelated native settings; verify matching
   normalized fingerprints.
2. **Project sync:** repeat from a project source; verify the definitions are effective inside the
   project and absent outside it for every selected agent.
3. **Disable and enable:** disable a user server globally, then enable it; create a project tombstone
   for an enabled user server and prove it is disabled only in that project; repeat for a
   project-owned server.
4. **Move user to project:** move a server, prove it is absent at user scope, active only in the
   project, and unchanged in normalized content.
5. **Move project to user:** prove the reverse with no duplicate definitions.
6. **Drift:** edit one managed native entry after planning; confirm the token is rejected and no
   files change. Edit it after apply; confirm status reports drift and sync preserves it.
7. **Rollback:** inject a failure in each adapter position and prove every earlier canonical and
   native write is restored byte-for-byte.
8. **Secrets:** attempt adoption with inline Authorization, cookie, token, and password values;
   prove the operation blocks and output contains neither the value nor a resolved environment
   variable.
9. **Trust and auth:** prove pending Claude/Codex trust and missing OAuth are reported as attention,
   never as active and never auto-approved.
10. **Unsupported target:** select an agent without the requested scope; prove the all-target plan
    blocks before writes and names the missing capability.
11. **Unmanaged preservation:** keep same-file non-MCP settings, comments where the format supports
    them, unmanaged MCP entries, auth files, and OAuth stores unchanged.
12. **Idempotence:** a second confirmed sync produces no file writes and identical effective
    fingerprints.

## Implementation slices

1. Add schema, redacted normalization/fingerprinting, scope resolution, secret validation, and pure
   precedence tests.
2. Add read-only discovery/status for all six targets and expose per-scope capabilities in
   `afd catalog`.
3. Implement plan/token/transaction/rollback infrastructure with fixture adapters.
4. Implement and native-test Claude, Codex, and Grok adapters.
5. Keep the implemented Antigravity adapter aligned with its official dedicated JSON contract and
   keep the explicitly pinned Pi adapter contract covered by fixtures and dependency review.
6. Establish a genuine Hermes project-scope contract or keep all-target project operations blocked.
7. Add enable/disable and move transactions, then the acceptance matrix and documentation.

No implementation slice may silently narrow `all agents` to the agents that were easiest to adapt.

## Primary references

- [OpenAI Codex MCP documentation](https://developers.openai.com/codex/mcp/)
- [Claude Code MCP scopes and management](https://code.claude.com/docs/en/mcp)
- [Google Antigravity MCP configuration](https://www.antigravity.google/docs/cli/mcp/)
- [Pi package configuration](https://pi.dev/docs/latest/packages)
- [`pi-mcp-adapter` configuration](https://github.com/nicobailon/pi-mcp-adapter#config)

Installed CLI help and package source were also inspected for the current Pi, Hermes, and Grok
clients without reading credential values. Those observations must be revalidated during
implementation because their contracts can change independently of AFD.
