# Security boundaries

```mermaid
flowchart LR
    U["User-reviewed action"] --> A["AFD-managed scope"]
    A --> M["Declared runtimes · tools · adapters"]
    A --> B["Bounded backups · receipts · telemetry"]

    A -. does not own .-> N["Agent-native data"]
    A -. does not own .-> P["Projects · credentials · login state"]
    A -. does not normalize .-> H["Unrelated host configuration"]

    D["Dry-run and doctor"] -->|read-only evidence| U
    M -->|verify postconditions| V["Verified managed state"]
    B -->|exact recorded scope| R["Rollback"]
```

- Use official sources, verifiable versions, dry-run, and separate verification.
- Keep project dependencies isolated and never manage user secrets or login state.
- Preserve drift and require human review before promoting pending or Hermes-created skills.
- Back up existing managed files under `%LOCALAPPDATA%\AI Foundry Desk\backups` before replacement.
- Keep `afd doctor` and `afd fix layer1 --dry-run` strictly read-only, including logs and state.
- Keep `afd fix sandbox --dry-run` read-only. `afd doctor` may inspect the fixed sandbox-access
  target set but must never repair it implicitly.
- Limit `afd fix layer1 --apply` to declared AFD packages, runtimes, environment, PATH, shims,
  PNPM_HOME, and marked profile blocks; never normalize unrelated machine state.
- Leave third-party installation and updates with their normal package managers. Sandbox repair may
  grant only reviewed `ReadAndExecute` entries, after an explicit apply, with snapshot and rollback;
  it must not replace tools or broaden access to the entire portable-package root.
- Treat Docker as a Layer 1 host capability only. Never use it to execute Layers 1–3; higher layers
  may use it only after explicit user request or a documented technical necessity.
- Never add a user to the root-equivalent `docker` group automatically.
- Never use agent directories as the canonical catalog; Hermes receives a one-way copy.

AI Foundry Desk is not a sandbox and cannot audit every upstream dependency. Stop and review scripts
that request elevation, alter profiles, create services, or write outside expected targets. Use a
disposable environment for untrusted code.
