# Releasing

GitHub Releases are the official distribution channel for the current phase. npm publication is
deferred until registry governance and broader supply-chain controls are decided.

Run:

```powershell
pnpm check
.\scripts\build-release.ps1 -OutputDirectory .\release
```

The builder creates an allowlisted npm tarball, `afd-bootstrap.ps1`, SHA-256 files, and release notes.
The bootstrap downloads only the versioned tarball and checksum from the same GitHub Release,
verifies SHA-256, installs with pnpm, and never applies Layer 1/2.

Before publishing, verify a clean tree, version/tag agreement, tests, PowerShell parse, secrets scan,
artifact contents, checksums, bootstrap fixture, and release notes. Publish the tag and assets without
force. Do not advertise the remote command until the tag and all checksum assets exist publicly.

Backups, logs, local state, profiles, `.env`, caches, node_modules, dist source directories, and tool
installations must never enter a release. SBOM, provenance, checksum signing, artifact signing, and
automated CI releases remain backlog items.
