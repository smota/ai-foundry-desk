# Layer 1 Foundation

Layer 1 provides the minimum native, verifiable foundation for a personal AI workstation.

- mise is the runtime source of truth.
- uv manages Python workflows but may not download or manage another Python installation.
- pnpm manages Node.js projects and the workbench; `pnpm setup` is not used.
- Python 3.14, Node.js 24 LTS, Go 1.26, and Rust 1.98.0 are the supported baseline.
- Project dependencies remain isolated; caches may be shared, dependency trees may not.
- Interactive `pip`, `npm`, `npx`, and `fnm` guardrails guide humans without intercepting scripts.

Preview and apply explicitly:

```powershell
afd layer1 --dry-run
afd layer1 --apply
.\scripts\01-verify-layer1.ps1
```

The installer persists `UV_NO_MANAGED_PYTHON=1`, `UV_PYTHON_DOWNLOADS=0`, `PNPM_HOME`, mise shims,
and the required command paths. It does not set persistent `UV_SYSTEM_PYTHON`, `UV_PYTHON`, weaken
execution/TLS controls, or approve third-party scripts. Review untrusted repositories in a
disposable VM or Windows Sandbox without personal credentials or synchronized folders.
