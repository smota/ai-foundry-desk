# Contributing

Thank you for improving AI Foundry Desk. Focused bug fixes, documentation, tests, platform evidence,
and small capability improvements are welcome. Open a proposal before changing architecture,
security boundaries, CLI contracts, or managed machine state.

## Before you start

1. Read the [architecture](docs/ARCHITECTURE.md), [security boundaries](docs/SECURITY-BOUNDARIES.md),
   and [development guide](docs/DEVELOPMENT.md).
2. Search existing issues and pull requests.
3. Open the relevant GitHub issue form. For a broad or security-sensitive change, wait for scope
   agreement before implementation. Report vulnerabilities using [the security policy](SECURITY.md),
   not a public issue.

## Make a change

Contributors without write access should fork the repository, then clone their fork:

```powershell
git clone https://github.com/<your-account>/ai-foundry-desk.git
cd ai-foundry-desk
git remote add upstream https://github.com/smota/ai-foundry-desk.git
git switch -c fix/short-description
pnpm install --frozen-lockfile
pnpm check
```

Maintainers follow the same short-lived branch flow directly in the main repository. Use a descriptive
branch such as `fix/short-description`, `feat/short-description`, or `docs/short-description`; no
long-lived development or release branch is required. Make the smallest coherent change, and add or
update tests and documentation with the implementation.
During development:

- exercise mutating scripts with `-WhatIf` or `--dry-run` first;
- never commit credentials, profiles, logs, backups, local state, caches, installations, `.env`,
  `dist`, or `node_modules`;
- use official sources and verifiable versions; preserve drift and existing user content;
- keep Windows-specific work behind the PowerShell bridge and portable logic in TypeScript;
- update [the CLI reference](docs/CLI.md) whenever command syntax or behavior changes;
- add a concise entry under `Unreleased` in [the changelog](CHANGELOG.md) for user-visible changes;
- add validation evidence without claiming support beyond the environment actually tested.

## Validate the result

Run the project checks from the repository root:

```powershell
pnpm check
```

This runs lint, TypeScript checks, tests, the production build, and documentation-link validation.
For PowerShell changes, also parse each changed script and run its non-mutating preview. For release
work, follow [the release process](docs/RELEASING.md).

## Open a pull request

Push the branch to your fork or the main repository and open a pull request against `main`. Complete
the pull-request template with the problem, scope, safety effects, test evidence, and documentation
impact. Keep unrelated changes out of the pull request.

Every change is merged through a pull request. The cross-platform checks must pass and review
conversations must be resolved before merge. External contributions require maintainer review;
architecture, security boundaries, CLI contracts, and managed-machine effects may need additional
design agreement. The project uses squash merge so each pull request becomes one focused commit on
`main`. It does not currently require a DCO sign-off or CLA, and it does not prescribe a
commit-message convention.

GitHub deletes merged branches that live in the main repository. After a fork-based pull request is
merged or closed, contributors can delete their fork branch in GitHub or run:

```powershell
git switch main
git pull --ff-only upstream main
git branch -d fix/short-description
git push origin --delete fix/short-description
```

## Platform adapters

Windows x64 provides the complete workstation experience. Native Linux support is validated only
on the specific WSL2 environment documented in [platform support](docs/PLATFORM-SUPPORT.md). macOS
remains experimental and fail-closed.

Keep one shared product core. Platform-specific discovery, installation, PATH handling, backup,
and verification must live behind explicit adapters rather than forks or duplicated products. A
platform contribution should document its tested operating-system versions and architectures,
include non-mutating verification and dry-run coverage, and avoid claiming support beyond the
environments contributors have actually validated. Open an issue before introducing a new adapter
contract or changing portable core behavior.
