# Agent sandbox toolchain repair

Use this workflow only when `afd doctor` proves that an agent sandbox inherits the intended user
profile but cannot execute the reviewed mise, uv, or pnpm toolchain. It is not a general-purpose ACL
repair and does not modify PATH, profiles, services, credentials, or runtime contents.

## Review

Run the read-only plan from a normal PowerShell session for the intended user:

```powershell
.\scripts\13-reconcile-sandbox-toolchain-access.ps1 -Mode Plan
```

The fixed target set is `%LOCALAPPDATA%\mise`, the user's `.rustup` and `.cargo` roots, WinGet Links,
and the official WinGet package roots for `jdx.mise`, `astral-sh.uv`, and `pnpm.pnpm`. These receive an inheritable `ReadAndExecute` allow
rule for the local `CodexSandboxUsers` group. The WinGet `Packages` parent receives a non-inheritable
`ReadAndExecute` rule because Node's executable realpath lookup must inspect that parent; it does not
grant access to the contents of unrelated package directories. The workflow grants no write or
modify rights.

AFD stores its global runtime pins in `%LOCALAPPDATA%\mise\afd-global-config.toml` and persists
`MISE_GLOBAL_CONFIG_FILE` to that exact location. This keeps project-local mise configuration
available while avoiding any sandbox grant to the user's personal `.config` tree. `MISE_STATE_DIR`
uses the sandbox-writable user temp area because mise records trust/tracking state even for a
read-only global config; no executable or package content is stored there. The superseded default
global config is retained but listed in `MISE_IGNORED_CONFIG_PATHS`, preventing duplicate overrides
without disabling repository-local `mise.toml` files.

Layer 1 also persists `RUSTUP_HOME` and `CARGO_HOME` to the user's existing `.rustup` and `.cargo`
directories. This prevents a restricted process whose conventional home discovery is unavailable
from falling back to `C:\.rustup`; the sandbox receives read-and-execute access only through the
reviewed toolchain ACL reconciliation.

## Apply and rollback

After explicit review:

```powershell
.\scripts\13-reconcile-sandbox-toolchain-access.ps1 -Mode Apply -Approved
```

Apply first records the exact root SDDL values under
`%LOCALAPPDATA%\AI Foundry Desk\backups\sandbox-toolchain-acl-<timestamp>`. If any root fails, the
script removes every ACE it added during that attempt. Apply refuses a root with any pre-existing,
non-matching `CodexSandboxUsers` ACE, so rollback can remove the exact grant without rewriting owner,
group, audit sections, or unrelated DACL entries. A reviewed completed change can be
reverted with the backup directory printed by Apply:

```powershell
.\scripts\13-reconcile-sandbox-toolchain-access.ps1 -Mode Rollback -BackupDirectory <directory> -Approved
```

Rollback accepts snapshots only from the AFD backup root and only when their target set is a unique
subset of the fixed reviewed roots.

## Acceptance

ACL changes do not update a running agent's environment contract. Start a new sandbox session and
run the complete matrix:

```powershell
.\scripts\12-validate-agent-environment.ps1 -RequireSandbox
```

Do not consider the repair complete based on a normal interactive shell or a partial command list.
