# Security boundaries

- Use official sources, verifiable versions, dry-run, and separate verification.
- Keep project dependencies isolated and never manage user secrets or login state.
- Preserve drift and require human review before promoting pending or Hermes-created skills.
- Back up existing managed files under `%LOCALAPPDATA%\AI Foundry Desk\backups` before replacement.
- Keep `afd doctor` and `afd fix layer1 --dry-run` strictly read-only, including logs and state.
- Limit `afd fix layer1 --apply` to declared AFD packages, runtimes, environment, PATH, shims,
  PNPM_HOME, and marked profile blocks; never normalize unrelated machine state.
- Never use agent directories as the canonical catalog; Hermes receives a one-way copy.

AI Foundry Desk is not a sandbox and cannot audit every upstream dependency. Stop and review scripts
that request elevation, alter profiles, create services, or write outside expected targets. Use a
disposable environment for untrusted code.
