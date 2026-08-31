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
