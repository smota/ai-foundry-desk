# npm publishing

AI Foundry Desk publishes a complete functional CLI package, not a workstation image. Installing the
package adds the `afd` command, schemas, recipes, operational adapters, dependency locks, and product
documentation. It never applies a Layer, creates autostart, starts telemetry, changes profiles, or
handles credentials during installation.

## One-time package claim

npm cannot configure a trusted publisher or accept a staged publication until the package exists.
The first claim therefore uses an audited prerelease and an interactive maintainer with 2FA:

1. Prepare `0.6.3-rc.1` from a reviewed commit and create the exact release tarball.
2. Run the complete release audit and isolated npm/pnpm smoke tests.
3. Confirm the commit, `ai-foundry-desk` destination, public access, and `next` tag.
4. From a trusted interactive terminal, authenticate to npm without recording credentials in the
   repository or shell history.
5. Publish only the inspected tarball:

   ```powershell
   npm publish .\release\ai-foundry-desk-0.6.3-rc.1.tgz --access public --tag next
   ```

6. Install `ai-foundry-desk@next` into disposable Windows and Linux prefixes and repeat the package
   smoke tests.

The RC is a namespace and registry-path bootstrap. Do not assign it the `latest` tag.

## Trusted publisher

After the package exists, configure exactly one stage-only trust relationship:

```powershell
npm trust github ai-foundry-desk --repo smota/ai-foundry-desk --file release.yml --allow-stage-publish
```

The npm account must have 2FA enabled. In the package's npm settings, select **Require two-factor
authentication and disallow tokens**. The trusted publisher uses:

- provider: GitHub Actions;
- user/repository: `smota/ai-foundry-desk`;
- workflow filename: `release.yml`;
- allowed action: `npm stage publish` only.

Do not create `NPM_TOKEN`, bypass-2FA, or repository write-token secrets. The GitHub-hosted npm job
uses `id-token: write`, npm 11.17.0, and Node.js 24. Trusted publishing generates provenance for the
public package automatically.

## Stable release

The stable tag workflow builds the tarball once, uploads it as a short-lived workflow artifact, and
passes the same bytes to both publication jobs. The npm job verifies the release SHA-256 before it
runs:

```text
npm stage publish <exact-tarball> --access public --tag next
```

The maintainer then:

1. opens npm's staged-package review;
2. verifies version, repository, provenance, file inventory, dependencies, package size, absence of
   lifecycle scripts, and the release checksum evidence;
3. downloads the staged tarball when byte-level inspection is required;
4. approves it with 2FA;
5. runs registry-origin npm and pnpm smoke tests against the exact version;
6. promotes the verified version:

   ```powershell
   npm dist-tag add ai-foundry-desk@0.6.4 latest
   ```

Only after promotion may documentation advertise npm as the default convenience channel. Verify
that `npm view ai-foundry-desk dist-tags --json` reports `latest` as `0.6.4` and that GitHub's latest
release is `v0.6.4`; a prerelease must not remain the canonical latest version. The checksummed
GitHub bootstrap remains the verified/offline channel.

## Recovery

npm versions are immutable. Never replace or silently republish a version. For a defective release:

1. move `latest` back to the previous verified version;
2. deprecate the defective version with a precise explanation;
3. keep its tag and evidence intact;
4. fix the defect on `main` and publish a new patch version;
5. rerun registry-origin smoke tests before restoring `latest`.
