# Releasing

GitHub Releases are the official distribution channel for the current phase. npm publication is
deferred until registry governance and broader supply-chain controls are decided.

Releases use a short release-preparation pull request followed by a version tag. No permanent release
branch is kept. Prepare the release from current `main` on `release/vX.Y.Z`, then:

1. update the versions in both package manifests, the bootstrap defaults, validation expectations,
   and the installation examples in `README.md`;
2. move the relevant `Unreleased` changelog entries into a dated `X.Y.Z` section;
3. run the checks below and open a pull request against `main`;
4. merge with squash after CI succeeds and review conversations are resolved;
5. create and push an annotated `vX.Y.Z` tag on the resulting `main` commit.

Run before opening the release pull request:

```powershell
pnpm check
pnpm release:check -- vX.Y.Z
.\scripts\release-audit.ps1
.\scripts\build-release.ps1 -OutputDirectory .\release
```

The builder creates an allowlisted npm tarball, an explicitly Windows-specific PowerShell bootstrap,
a separate POSIX bootstrap, SHA-256 files, and release notes. Each bootstrap downloads only the
versioned tarball and checksum from the same GitHub Release, verifies SHA-256, installs the CLI, and
never applies Layer 1/2. Publish POSIX assets as stable only after the documented platform fixture
passes; macOS remains experimental until validated on real hardware.

Pushing the stable version tag triggers `.github/workflows/release.yml`. GitHub Actions verifies the
tag against both package manifests, bootstrap defaults, and README installation examples; audits the
package; runs the complete project checks while building the checksummed assets; and creates the
GitHub Release. The workflow uses only the repository-provided `GITHUB_TOKEN` and does not publish to
npm.

Before pushing the tag, verify a clean tree, confirm that the tag targets the intended `main` commit,
and inspect the generated release assets. Tags and releases must never be forced or silently replaced.
If automation fails before a release is created, fix the cause on `main`, prepare a new patch version,
and tag that new commit. If a release exists but needs an explanatory correction, edit its notes
without replacing its tag or assets. Do not advertise the remote command until the tag and all
checksum assets exist publicly.

Backups, logs, local state, profiles, `.env`, caches, node_modules, dist source directories, and tool
installations must never enter a release. SBOM, provenance, checksum signing, and artifact signing
remain backlog items.
