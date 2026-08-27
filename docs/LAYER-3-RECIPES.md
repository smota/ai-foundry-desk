# Layer 3 recipes

Layer 3 provisions reviewed global skills and tools from a versioned declarative recipe. Internal
recipes (`builtin:<id>`), local files/directories, and HTTPS JSON use the same strict loader. A URL
redirect, unavailable response, invalid schema, unsafe relative path, duplicate ID, unverified tool
adapter, or unsupported agent blocks application without writing.

```text
afd layer3 recipes
afd layer3 show builtin:samuel
afd layer3 plan builtin:samuel
afd layer3 builtin:samuel
afd layer3 apply builtin:samuel --confirm <plan-token>
afd layer3 verify builtin:samuel
afd layer3 rollback builtin:samuel --confirm
afd layer3 extract --output recipe.json
afd layer3 extract --output recipe.json --include skill-a,vibium
```

The shorthand is plan-only. Plan emits a deterministic approval token; apply requires that exact
token, so a stale or skipped preview cannot install. Rollback requires confirmation. Apply records exact paths and
rollback removes only paths created by that application. Existing destinations are preserved.
External recipes never execute embedded scripts. Extraction first prints a sanitized inventory and
requires a second invocation naming what to include; it emits IDs and portable placeholders, never
tokens, sessions, credentials, environment files, or private absolute paths.

## Samuel

`builtin:samuel` describes Holoself, Vibium, and Tokscale. Holoself uses `AFD_HOLOSELF_ROOT` for the
private local overlay; its machine-specific path never enters the public recipe. Windows reads the
persisted user variable; Linux may use the process environment or `~/.config/afd/overlays.json`.
Broken overlay links are warnings only, and rollback never touches overlay data.

Samuel pins Vibium 26.8.21 and Tokscale 4.14.0 with their registry SHA-512 integrity values. The
allowlisted pnpm adapter verifies metadata before installation, records any prior global version,
validates each command, and restores the prior version (or removes only a newly managed package) on
rollback. Antigravity CLI uses its documented global `~/.gemini/antigravity-cli/skills/` adapter.
Vibium's optional first browser download remains a later explicit runtime action; recipe application
does not launch a browser.
