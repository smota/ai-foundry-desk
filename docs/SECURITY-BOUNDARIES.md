# Security boundaries

- Use official sources, verifiable versions, dry-run, and separate verification.
- Keep project dependencies isolated and never manage user secrets or login state.
- Preserve drift and require human review before promoting pending or Hermes-created skills.
- Back up existing managed files under `%LOCALAPPDATA%\AI Foundry Desk\backups` before replacement.
- Keep `afd doctor` and `afd fix layer1 --dry-run` strictly read-only, including logs and state.
- Limit `afd fix layer1 --apply` to declared AFD packages, runtimes, environment, PATH, shims,
  PNPM_HOME, and marked profile blocks; never normalize unrelated machine state.
- Treat Docker as a Layer 1 host capability only. Never use it to execute Layers 1–3; higher layers
  may use it only after explicit user request or a documented technical necessity.
- Never add a user to the root-equivalent `docker` group automatically.
- Never use agent directories as the canonical catalog; Hermes receives a one-way copy.

AI Foundry Desk is not a sandbox and cannot audit every upstream dependency. Stop and review scripts
that request elevation, alter profiles, create services, or write outside expected targets. Use a
disposable environment for untrusted code.
