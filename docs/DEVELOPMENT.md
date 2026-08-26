# Development

Requirements: Windows x64 for Foundation/bootstrap, Node.js 24, pnpm 11, and PowerShell 5.1/7.

```powershell
pnpm install --frozen-lockfile
pnpm check
.\scripts\release-audit.ps1
```

Parse PowerShell changes and run every mutating path with `-WhatIf` or `--dry-run` first. Never
commit backups, logs, local state, profiles, credentials, `.env`, caches, installations, `dist`, or
`node_modules`. Start future work from [NEXT-SESSION.md](NEXT-SESSION.md).
