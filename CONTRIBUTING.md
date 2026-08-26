# Contributing

AI Foundry Desk accepts focused changes that preserve minimal configuration, isolation,
reversibility and explicit user intent. Open an issue before broad architecture changes.

- Run `pnpm check` and PowerShell parse checks.
- Exercise mutating scripts with `-WhatIf` first.
- Never commit credentials, profiles, logs, backups, local state, caches or installations.
- Use official sources and verifiable versions; preserve drift and existing user content.
- Keep Windows-specific work behind the PowerShell bridge and portable logic in TypeScript.

DCO/CLA, commit conventions and required review policy are not yet defined by the maintainer.
