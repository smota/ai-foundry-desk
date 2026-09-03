# Releasing

GitHub Releases remain the checksummed and offline-capable distribution channel. After the one-time
npm package claim described in [npm publishing](NPM-PUBLISHING.md), stable tags also submit the exact
audited release tarball to npm's staged-publishing queue through OIDC. A maintainer reviews and
approves that staged package with 2FA before it becomes public; no long-lived npm write token is used.

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
passes; macOS Layer 1 remains an unvalidated implementation until exercised on real hardware.

Pushing the stable version tag triggers `.github/workflows/release.yml`. GitHub Actions verifies the
tag against both package manifests, bootstrap defaults, and README installation examples; audits the
package; runs the complete project and isolated package-install checks; and builds the tarball once.
Separate least-privilege jobs publish that same artifact to GitHub Releases and submit it to npm with
`npm stage publish --tag next`. The GitHub job has `contents: write`; the npm job has only
`contents: read` and `id-token: write`.

Before pushing the tag, verify a clean tree, confirm that the tag targets the intended `main` commit,
and inspect the generated release assets. Tags and releases must never be forced or silently replaced.
If automation fails before a release is created, fix the cause on `main`, prepare a new patch version,
and tag that new commit. If a release exists but needs an explanatory correction, edit its notes
without replacing its tag or assets. Do not advertise the remote command until the tag and all
checksum assets exist publicly.

Backups, logs, local state, profiles, `.env`, caches, node_modules, source directories, orphaned build
outputs, contributor-only release tooling, and tool installations must never enter a release. npm
trusted publishing supplies provenance for approved public packages; GitHub assets retain explicit
SHA-256 files. Independent artifact signing remains a backlog item.
