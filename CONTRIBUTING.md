# Contributing

AI Foundry Desk accepts focused changes that preserve minimal configuration, isolation,
reversibility and explicit user intent. Open an issue before broad architecture changes.

- Run `pnpm check` and PowerShell parse checks.
- Exercise mutating scripts with `-WhatIf` first.
- Never commit credentials, profiles, logs, backups, local state, caches or installations.
- Use official sources and verifiable versions; preserve drift and existing user content.
- Keep Windows-specific work behind the PowerShell bridge and portable logic in TypeScript.

## Platform adapters

Windows x64 is currently the only implemented and validated platform. macOS and Linux support is
an open contribution area, and contributions that implement, test, document, and validate those
platform adapters are especially welcome.

Keep one shared product core. Platform-specific discovery, installation, PATH handling, backup,
and verification must live behind explicit adapters rather than forks or duplicated products. A
platform contribution should document its tested operating-system versions and architectures,
include non-mutating verification and dry-run coverage, and avoid claiming support beyond the
environments contributors have actually validated. Open an issue before introducing a new adapter
contract or changing portable core behavior.

DCO/CLA, commit conventions and required review policy are not yet defined by the maintainer.
