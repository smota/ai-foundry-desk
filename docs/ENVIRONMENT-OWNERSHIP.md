# Environment ownership and update lifecycle

AFD is an environment contract and verifier, not a replacement package manager. Users continue to
install and update third-party tools through their normal trusted mechanisms, including WinGet.

## Ownership matrix

| Surface | Installation and updates | AFD responsibility | AFD does not own |
| --- | --- | --- | --- |
| WinGet portable tools such as uv, pnpm, mise and Codex | WinGet and the user | Detect resolution, execution, version, provenance and declared sandbox-access drift | Package selection, upgrade timing, upstream files or release policy |
| mise language runtimes | mise using AFD's declared pins | Validate the pinned runtime and effective command path | Project-local mise configuration or unrelated runtimes |
| Project dependencies | The project through its lockfile and package manager | Prefer isolated, reproducible project operations | Dependency upgrades or lockfile policy |
| Codex Windows sandbox | Codex/OpenAI and Windows | Validate that declared tools remain executable; reconcile only reviewed RX metadata after approval | Sandbox users, firewall policy, workspace roots or approval policy |
| AFD CLI | AFD's local or released installer | Report its exact version, CLI path and Node runtime | Third-party CLI replacement or transparent command brokering |

## Why updates can create drift

Windows ACLs belong to filesystem objects, not abstract command names. WinGet portable-package
upgrades may replace an executable and its command alias. A custom `CodexSandboxUsers` ACE on the old
file is therefore not a durable property of the package. AFD treats this as expected interoperability
drift, not as a reason to block or take over normal updates.

The declared lifecycle is:

1. Update tools normally, for example with `winget upgrade --all`.
2. Run `afd doctor` from a normal user shell. This is read-only.
3. If `sandbox.toolchain-access` fails, run `afd fix sandbox --dry-run`.
4. Review the exact paths and RX grants, then run `afd fix sandbox --apply`.
5. Start a fresh Codex task and run the sandbox validation matrix when full evidence is required.

AFD does not silently mutate ACLs during doctor, startup, installation or updates. It does not wrap
WinGet, keep private replacement copies of tools, suppress updates, or execute normal tools through
an out-of-sandbox broker.

Codex can prepend bundled PowerShell 7 modules to `PSModulePath`. The Windows ACL reconciler binds
the Security module from its active PowerShell host explicitly, preventing Windows PowerShell 5.1
from autoloading incompatible PowerShell 7 type data. AFD does not replace either PowerShell runtime
or rewrite the user's module path.

This repository declares a project-local pnpm store in `pnpm-workspace.yaml`. That keeps dependency
resolution consistent when the interactive user and Codex sandbox have different user-global pnpm
store access; the ignored `.pnpm-store` remains a disposable cache, while `pnpm-lock.yaml` remains
authoritative.

## Execution contexts

Three evidence classes remain distinct:

| Context | Authoritative evidence |
| --- | --- |
| Normal user shell | Persistent HKCU, user PATH, profiles, package inventory and durable ACL state |
| Codex sandbox task | Effective command resolution and execution under the dedicated sandbox identity |
| New task, worktree or process | Fresh environment snapshot, workspace-root authority and setup-script result |

Changing the working directory does not expand workspace roots. Repairing persistent state does not
change a process that is already running; restart or create a fresh task after relevant updates.

Read-only telemetry status follows the same principle: if the normal-user broker is unavailable to a
sandbox task, AFD still returns its versioned local status contract with an unavailable/degraded state.
It does not start a broker or service implicitly. Telemetry mutation and verification remain brokered
and fail closed when the owning interactive-user process is unavailable.

## Security tradeoff

The Windows elevated Codex sandbox intentionally uses a separate lower-privilege identity. AFD grants
that identity only `ReadAndExecute` on a fixed allowlist of declared toolchain directories and entry
points. It grants no write or modify access. The WinGet Packages parent receives traversal access only;
unrelated package contents do not inherit the grant.

Broader access would reduce reconciliation frequency but weaken isolation. AFD therefore prefers
targeted post-update reconciliation with an ACL snapshot and rollback over a permanent grant on the
entire portable-package root. Existing non-matching AFD group rules fail closed for manual review.
