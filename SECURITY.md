# Security policy

Do not include tokens, user names, machine paths, profiles or logs in reports. This repository does
not yet publish a private reporting channel, supported-version matrix or response SLA. Until those
are defined, avoid posting exploitable details publicly; contact the repository owner through a
non-public channel visible on their GitHub profile if one is available.

AI Foundry Desk is not a sandbox. Review scripts that elevate privileges, alter profiles, create
services or write outside expected targets. Use disposable environments for untrusted repositories.

The Observability recipe is local-first: listeners and exporters bind to loopback, and its Collector
accepts only a bounded content-free trace vocabulary. Prompt/response bodies, transcript content,
file content, command arguments, stdout/stderr, credentials, account identity, and raw workspace
paths are excluded. agentacct may read supported agent-native session stores locally to derive
bounded usage/work evidence; on Windows, Codex sources are mounted read-only into a private WSL
namespace without copying the SQLite database or transcript tree. AFD does not copy complete
transcripts into Phoenix or its correlation index. Applying the reviewed recipe authorizes only the
effects listed by its plan.

agentacct Evidence v2 shadow mode is disabled in the current recipe because its refresh conflicts
with a concurrently written Codex rollout. The stable v1 evidence path remains enabled. AFD treats
only the exact upstream inventory-rotation condition as retryable, exposes the affected nested
source state, and requires the runtime watcher and all other sources to remain healthy.
