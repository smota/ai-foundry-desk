# AFD Agent Manager

Portable Node.js/TypeScript control plane for the AI Foundry Desk catalog, manifest, inventory,
adoption, synchronization, verification, and review workflows.

`afd status`, `review`, `sync`, `verify`, and `adopt/import` operate on `%USERPROFILE%\.afd`.
`sync --dry-run` does not write. Divergent content is preserved and adoption enters
`catalog/pending`; Hermes-created skills are never promoted automatically. OpenTUI remains backlog.
