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
```

Direct content is copied to `catalog/pending/<agent>/` by adopt/import and is never promoted
automatically. Drift blocks overwrites. Existing profile files are backed up before a small marked
block is added.

| Agent | Skills | Base profile | Strategy |
|---|---|---|---|
| Claude Code | supported | supported | mirror plus a marked CLAUDE.md block |
| Codex | supported | supported | `~/.agents/skills` plus a marked AGENTS.md block |
| Pi | supported | supported | `~/.agents/skills` plus a marked AGENTS.md block |
| Grok | supported | deferred | native `~/.agents/skills`; configuration preserved |
| Hermes | supported | deferred | one-way mirror; private skills preserved |
| Antigravity | deferred | deferred | no stable official global contract assumed |
