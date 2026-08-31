# AFD Agent Manager

Portable Node.js/TypeScript control plane for the AI Foundry Desk catalog, manifest, inventory,
adoption, synchronization, verification, and review workflows.

`afd status`, `review`, `sync`, `verify`, and `adopt/import` operate on `%USERPROFILE%\.afd`.
`sync --dry-run` does not write. Divergent content is preserved and adoption enters
`catalog/pending`; Hermes-created skills are never promoted automatically. OpenTUI remains backlog.

Project harness inspection is separate from user-level synchronization:

```powershell
afd harness audit <project>
afd harness audit <project> --json
afd harness plan <project> --agents codex,claude-code,pi --remove-legacy
afd harness stage <project> --output <outside-project-directory> --agents codex,claude-code,pi
afd harness test <project> --agents codex,claude-code,pi
afd harness test <project> --agents codex,claude-code,pi --live --evidence <outside-project-file>
afd harness apply <project> --agents codex,claude-code,pi --evidence <passing-live-report> --confirm <plan-token>
afd harness verify <project> --receipt <apply-receipt>
afd harness rollback <project> --receipt <apply-receipt> --confirm <plan-token>
```

The audit is strictly read-only. It identifies canonical instructions, agent-specific adapter
surfaces, instruction-budget risk, duplicated policy, routing contradictions, unverified discovery,
and legacy compatibility candidates without treating file presence as proof that an agent loaded it.

`plan` is also read-only. It emits exact before/after hashes and a content-derived approval token.
Project-owned divergent adapters are preserved. `stage` revalidates the plan and writes only to an
external directory; repeated staging is idempotent, while source or staged-output drift fails closed.

`test` first reports runner readiness without invoking agents. `--live` renders the proposed policy
and adapters into a disposable local workspace, then starts fresh, bounded, read-only sessions and
compares independently returned canonical-policy facts. Every selected agent
must pass with one policy fingerprint. Missing commands, unsupported safety contracts, malformed
output, inconsistent policy, timeout, or canonical-file drift make the evidence fail closed.

`apply` recomputes the plan, requires its exact approval token and matching passing live evidence,
and stores a private receipt outside the project. It is transactional. `verify` checks every applied
artifact plus the complete Git-visible workspace fingerprint. `rollback` requires the
same token, refuses drift, restores the exact prior bytes, and emits a separate private receipt.

## MCP configuration

AFD can keep explicitly selected MCP definitions consistent between its user registry at
`~/.afd/mcp/user.json`, a project's `.afd/mcp.json`, and verified native agent files. Discovery and
status are read-only. Sync, adoption, enable/disable, and scope moves first produce a redacted plan;
the exact content-derived token is required to apply it.

```powershell
afd mcp discover codex --scope user --json
afd mcp status --scope effective --project .
afd mcp sync --scope effective --project . --agents claude-code,codex,grok --dry-run
afd mcp sync --scope effective --project . --agents claude-code,codex,grok --confirm <plan-token>
afd mcp disable context7 --scope project --project . --agents claude-code,codex,grok --dry-run
afd mcp move context7 --from user --to project --project . --agents claude-code,codex,grok --dry-run
```

Claude Code, Codex, and Grok have verified user and project adapters. Hermes has a verified user
adapter but no stable project-scoped surface. The installed Antigravity and Pi contracts are not
verified. A default all-agent plan therefore blocks when any selected scope cannot be represented;
use `afd catalog` to inspect the current per-scope capability and `--agents` only when deliberately
targeting a supported subset.

AFD never reads or copies native OAuth/login state. Secret-like environment and header values must
be environment references, plans never contain rendered configuration values, unmanaged native
entries are preserved, concurrent edits invalidate the token, and a failed transaction restores
all earlier writes from local snapshots.
