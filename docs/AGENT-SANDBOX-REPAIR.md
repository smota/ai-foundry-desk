# Agent sandbox toolchain repair

Use this workflow only when `afd doctor` proves that an agent sandbox inherits the intended user
profile but cannot execute the reviewed mise, uv, or pnpm toolchain. It is not a general-purpose ACL
repair and does not modify PATH, profiles, services, credentials, or runtime contents.

Normal package-manager updates remain supported. AFD does not wrap WinGet or own third-party update
timing. Run `afd doctor` after updates; it automatically reports the versioned
`sandbox.toolchain-access` postcondition from a normal user shell.

## Review

Run the read-only plan from a normal PowerShell session for the intended user:

```powershell
afd fix sandbox --dry-run
```

The fixed target set is `%LOCALAPPDATA%\mise`, the user's `.rustup` and `.cargo` roots, WinGet Links,
and the official WinGet package roots for `jdx.mise`, `astral-sh.uv`, `pnpm.pnpm`, and
`OpenAI.Codex`. These receive an inheritable `ReadAndExecute` allow
rule for the local `CodexSandboxUsers` group. The WinGet `Packages` parent receives a non-inheritable
`ReadAndExecute` rule because Node's executable realpath lookup must inspect that parent; it does not
grant access to the contents of unrelated package directories. The workflow grants no write or
modify rights.

The plan also checks and, when needed, grants `ReadAndExecute` directly on the reviewed `uv.exe`,
`uvx.exe`, `pnpm.exe`, and Codex executable entry points. WinGet upgrades can replace a file with a
protected ACL that does not inherit the still-correct package-directory rule, so a directory-only
check is not durable evidence that the command remains executable.

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
afd fix sandbox --apply
```

The CLI still delegates to `scripts/13-reconcile-sandbox-toolchain-access.ps1`; it does not install,
replace, pin, downgrade or update any tool. Apply is accepted only from the matching normal user
identity and immediately re-runs the read-only plan to verify the postcondition.

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
The matrix executes the resolved `codex` launcher as well as the managed language toolchain; resolving
the wrapper without executing its target is not sufficient evidence.

The repair deliberately does not grant write access to user-global npm caches or sibling repositories.
Project commands must keep disposable caches inside the active workspace or an allowed temporary
directory. A task that must modify multiple repositories needs those repositories declared as workspace
roots when the task starts; changing the command's working directory does not expand sandbox authority.

See [Environment ownership and update lifecycle](ENVIRONMENT-OWNERSHIP.md) for the complete division
of responsibility and the explicit security tradeoff.
