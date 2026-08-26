# Layer 2 skills and profiles

The Agent Manager maintains an approved per-user catalog at `~/.afd` and synchronizes
only from catalog to agents. It does not use the network, run `npx skills`, or access authentication,
history, memory, or plugins.

```powershell
afd status
afd review
afd sync --dry-run
afd sync
afd verify
afd adopt claude-code my-skill --dry-run
afd pending
afd promote claude-code my-skill --dry-run
afd promote claude-code my-skill --confirm
afd reject claude-code my-skill --confirm
afd recover claude-code <rejected-snapshot> --confirm
```

Direct content is copied to `catalog/pending/<agent>/` by adopt/import and is never promoted
automatically. Drift blocks overwrites. Existing profile files are backed up before a small marked
block is added.

`status` reports environment drift; `review` additionally lists pending entries. Promotion is a
separate manual operation with preview, confirmation, validation, review backup and manifest update.
Rejection is recoverable. Invalid IDs, duplicate catalog IDs, duplicate targets, unknown references,
absolute/traversing paths, and incompatible schemas fail before synchronization writes.

Hermes updates use `afd hermes update --dry-run` followed by `--apply`. The adapter pins the upstream
tag and installer SHA-256, downloads into staging, snapshots the existing installation, validates the
canonical launcher and version, and automatically restores the snapshot if installation or validation
fails. It never invokes the interactive unverified `hermes update` route.

| Agent | Skills | Base profile | Strategy |
|---|---|---|---|
| Claude Code | supported | supported | mirror plus a marked CLAUDE.md block |
| Codex | supported | supported | `~/.agents/skills` plus a marked AGENTS.md block |
| Pi | supported | supported | `~/.agents/skills` plus a marked AGENTS.md block |
| Grok | supported | deferred | native `~/.agents/skills`; configuration preserved |
| Hermes | supported | deferred | one-way mirror; private skills preserved |
| Antigravity | supported | deferred | official `~/.gemini/antigravity-cli/skills/`; profile deferred |
