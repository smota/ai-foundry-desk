# Security policy

Do not include tokens, user names, machine paths, profiles or logs in reports. This repository does
not yet publish a private reporting channel, supported-version matrix or response SLA. Until those
are defined, avoid posting exploitable details publicly; contact the repository owner through a
non-public channel visible on their GitHub profile if one is available.

AI Foundry Desk is not a sandbox. Review scripts that elevate privileges, alter profiles, create
services or write outside expected targets. Use disposable environments for untrusted repositories.

AFD does not intercept or replace third-party package updates. Its Windows sandbox-access repair is
an explicit, fixed-target interoperability operation: the dedicated Codex sandbox group receives
ReadAndExecute only, the prior ACL state is snapshotted, existing non-matching rules fail closed, and
`afd doctor` never applies the repair silently. See `docs/ENVIRONMENT-OWNERSHIP.md`.

The Observability recipe is local-first: listeners and exporters bind to loopback, and its Collector
accepts only a bounded content-free trace vocabulary. Prompt/response bodies, transcript content,
file content, command arguments, stdout/stderr, credentials, account identity, and raw workspace
paths are excluded. agentacct may read supported agent-native session stores locally to derive
bounded usage/work evidence. On Windows it runs in an AFD-managed native Python environment and
reads the declared Codex sources directly; AFD does not parse or copy the SQLite database or
transcript tree. The native compatibility boundary is limited to observability imports, watcher,
health/capability probes, and the loopback API; agentacct runner/wrapper activation remains outside
the supported Windows surface. The pinned importer adapter rejects symlinks and junctions, checks
every source path component, and verifies file identity before and after read-only opens. AFD does not copy complete
transcripts into Phoenix or its correlation index. Applying the reviewed recipe authorizes only the
effects listed by its plan.

agentacct Evidence v2 shadow mode is disabled in the current recipe because its refresh conflicts
with a concurrently written Codex rollout. The stable v1 evidence path remains enabled. AFD treats
only the exact upstream inventory-rotation condition as retryable, exposes the affected nested
source state, and requires the runtime watcher and all other sources to remain healthy.
