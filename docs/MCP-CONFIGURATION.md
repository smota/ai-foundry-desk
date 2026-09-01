# MCP configuration

AI Foundry Desk keeps explicitly selected Model Context Protocol (MCP) server definitions consistent
across supported agents. It manages configuration, not credentials or server processes: discovery is
redacted, changes require a hash-bound preview, and verification is structural.

## Choose a scope

| Scope | Canonical registry | Meaning |
| --- | --- | --- |
| User | `~/.afd/mcp/user.json` | Available across projects for the current user |
| Project | `<project>/.afd/mcp.json` | Applies only in that project |
| Effective | Computed, not stored | Project definitions override user definitions; project tombstones can disable inherited servers |

When a project or effective command omits `--project`, AFD uses the current directory. Use an
explicit path in automation.

## 1. Inspect support and current state

Start with the agent capability matrix and a read-only status plan:

```powershell
afd catalog
afd mcp status --scope effective --project .
```

Claude Code, Codex, Antigravity, and Grok have verified user and project adapters. Hermes has a
verified user adapter but no stable project adapter. Pi core has no native MCP surface; AFD supports
the pinned `pi-mcp-adapter` only after explicit `--enable-pi-adapter` consent. Capabilities vary, so a
default all-agent plan blocks when any selected target cannot represent the requested scope.

Use `--agents` to choose a deliberate comma-separated subset:

```powershell
afd mcp status --scope effective --project . --agents claude-code,codex,grok
```

Exit code `2` means AFD found drift, a blocker, or a required action. It is an inspection result, not
an invocation failure.

## 2. Discover an existing native definition

Discovery reads one verified native agent surface and returns IDs, transport, enabled state, paths,
and fingerprints without rendered configuration values:

```powershell
afd mcp discover codex --scope user --json
afd mcp discover claude-code --scope project --project .
```

Discovery does not add the server to an AFD registry. Use `adopt` after reviewing the result.

## 3. Preview and synchronize

Synchronization starts with a redacted dry run:

```powershell
afd mcp sync --scope effective --project . --agents claude-code,codex,grok --dry-run
```

The plan contains a content-derived token. Apply that exact plan with:

```powershell
afd mcp sync --scope effective --project . --agents claude-code,codex,grok --confirm <plan-token>
```

AFD recomputes the plan before writing. Changed registries or native files invalidate the token.

## Adopt, enable, disable, or move a server

Each mutation uses the same preview/confirm contract.

```powershell
# Adopt a discovered user definition into project scope
afd mcp adopt codex context7 --from-scope user --to-scope project --project . --agents codex --dry-run

# Change effective availability without deleting the definition
afd mcp disable context7 --scope project --project . --agents claude-code,codex,grok --dry-run
afd mcp enable context7 --scope project --project . --agents claude-code,codex,grok --dry-run

# Atomically move canonical ownership between scopes
afd mcp move context7 --from user --to project --project . --agents claude-code,codex,grok --dry-run
```

Replace `--dry-run` with `--confirm <plan-token>` only after reviewing the output. Moving a server
updates canonical and selected native ownership as one transaction.

## Pi adapter opt-in

Pi requires an extension rather than a native adapter. Include the explicit opt-in in both the dry
run and confirmed command so the approved plan stays identical:

```powershell
afd mcp sync --scope project --project . --agents pi --enable-pi-adapter --dry-run
afd mcp sync --scope project --project . --agents pi --enable-pi-adapter --confirm <plan-token>
```

AFD declares only the pinned adapter version in its contract and preserves unrelated Pi settings.

## Safety and troubleshooting

- AFD never reads or copies native OAuth or login state.
- Secret-like environment and header values must be environment-variable references; inline values
  are rejected without being echoed.
- Plans omit rendered server values and preserve unrelated settings and unmanaged native entries.
- Apply uses atomic writes and snapshots. A failed multi-target transaction restores earlier files.
- `afd mcp verify ...` is structural; it does not start MCP servers or make network connections.
- Use `afd catalog` when a plan reports an unsupported adapter or scope. Narrow `--agents` only when
  excluding that target is intentional.
- Rerun the dry run after any stale-token or concurrent-edit error; never reuse an old token.

See the [CLI reference](CLI.md#manage-mcp-configuration) for every option and the
[MCP configuration design](MCP-CONFIGURATION-DESIGN.md) for registry schemas, precedence, adapter
architecture, security decisions, and validation evidence.
