# Contributing

AI Foundry Desk accepts focused changes that preserve minimal configuration, isolation,
reversibility and explicit user intent. Open an issue before broad architecture changes.

- Run `pnpm check` and PowerShell parse checks.
- Exercise mutating scripts with `-WhatIf` first.
- Never commit credentials, profiles, logs, backups, local state, caches or installations.
- Use official sources and verifiable versions; preserve drift and existing user content.
- Keep Windows-specific work behind the PowerShell bridge and portable logic in TypeScript.

## Platform adapters

Windows x64 remains the only fully implemented workstation platform. The portable CLI/bootstrap
cycle is additionally validated on the specific WSL2 environment documented in
`docs/PLATFORM-SUPPORT.md`; native Linux Layer adapters and all macOS support remain open
contribution areas.

Keep one shared product core. Platform-specific discovery, installation, PATH handling, backup,
and verification must live behind explicit adapters rather than forks or duplicated products. A
platform contribution should document its tested operating-system versions and architectures,
include non-mutating verification and dry-run coverage, and avoid claiming support beyond the
environments contributors have actually validated. Open an issue before introducing a new adapter
contract or changing portable core behavior.

DCO/CLA, commit conventions and required review policy are not yet defined by the maintainer.
