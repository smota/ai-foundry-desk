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
```

The audit is strictly read-only. It identifies canonical instructions, agent-specific adapter
surfaces, instruction-budget risk, duplicated policy, routing contradictions, unverified discovery,
and legacy compatibility candidates without treating file presence as proof that an agent loaded it.
