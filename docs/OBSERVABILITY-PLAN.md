# Observability implementation plan

## Outcome

AFD provides one local-first observability capability through `afd telemetry`. Its live plane becomes
the normal Layer 2 telemetry path after the implementation and go-live gates pass. A recipe that
includes Observability declares the complete desired state; reviewing and applying that recipe is
the user's activation decision. It combines:

- an existing OpenTelemetry Collector on loopback for ingestion and routing;
- Arize Phoenix for live OpenTelemetry/OpenInference traces;
- agentacct for retrospective session intelligence from supported agents' local evidence;
- AFD-owned correlation and lifecycle contracts, without wrapping agent execution.

The product has not been released, so this plan replaces the current `afd observe` contract. No
compatibility alias or migration layer is required.

## Current gate status — 2026-08-28

- Effective for daily Layer 2 use: recipe `1.3.0`, single plan-token consent, Collector `0.159.0`,
  Phoenix `20.4.0` on isolated CPython `3.10.21`, agentacct `0.10.1` observe-only, transactional
  lifecycle, native Codex/Claude OTLP, current-user autostart, schema-v2 correlation, `trace`, and
  `explain`.
- Verified: 50 portable tests plus lint, typecheck and build; all five loopback listeners; exact
  Codex/Claude configuration; synthetic privacy canaries; a disposable `live_only` explanation;
  stop with no remaining listener; and healthy resume in 50.42 seconds.
- Codex session import reads the original rollout tree through a stable private read-only WSL mount
  namespace and does not copy the Windows SQLite carrier or transcript tree. Live health observed
  49 Codex, three Claude, and one Hermes sessions with usage.
- Supply chain: recipe-bound PEP 751 locks and artifact hashes cover Phoenix and agentacct; the
  CycloneDX 1.6 SBOM inventories 179 components and the three upstream licenses.
- Environment acceptance complete: the authorized managed-state rollback/reapply passed; privacy
  verification passed; the five-sample pilot was healthy with `explain` exit zero; and the fresh
  hybrid sandbox passed all 18 checks after the snapshotted two-root ReadAndExecute repair.
- Measured baseline: status p95 10.31 seconds, explain p95 10.26 seconds, trace freshness 558 ms,
  Phoenix query 25 ms, and zero managed/log growth during the sample. Query latency remains a
  refinement target and is not yet an SLO.
- agentacct Evidence v2 shadow mode is disabled through its public configuration because 0.10.1
  conflicts with the actively written Codex rollout. Stable v1 session, usage, cost, and Work
  Receipt evidence remains active. Only the exact inventory-rotation failure is retryable while
  watcher and peer-source health remain good; every other error degrades the capability.
- Unsupported: native Hermes detailed-run tracing, Pi, and AGY. Full five-agent coverage is not a
  current claim.

```text
native agent telemetry / project instrumentation
                    |
                    v
       OpenTelemetry Collector -----> Phoenix
                    |                 live traces
                    |
local agent session evidence -----> agentacct
                    |                 retrospective work evidence
                    +--------+--------+
                             v
              afd telemetry explain <run-id>
```

Phoenix and agentacct remain independent sources. AFD correlates them but does not copy complete
session transcripts into Phoenix or duplicate either product's database.

## Responsibility boundaries

| Component | Owns | Does not own |
| --- | --- | --- |
| AFD | reviewed installation, configuration, lifecycle, health, agent capability matrix, run correlation, concise explanation | trace storage, session parsing, agent execution |
| OpenTelemetry Collector | loopback OTLP ingestion, filtering, redaction, batching, routing | LLM interpretation or session-log parsing |
| Phoenix | trace storage, visualization, OpenInference analysis | authoritative local session evidence |
| agentacct | supported local-session import, evidence provenance, usage/cost estimates, work reconstruction | launching agents by default, remote export, canonical AFD run identity |

The initial agentacct integration is observation-only. The recipe plan must expose any hooks, MCP
registration, profile blocks, watcher, autostart, network behavior, and rollback before confirmation.
When those effects are declared by the selected recipe, its confirmed apply authorizes them; AFD
does not ask for a second component-specific activation. Proxying, hard-stop controls, or agent
launching remain out of scope.

## Command contract

The target CLI is:

```text
afd telemetry plan
afd telemetry apply
afd telemetry verify
afd telemetry status [--json]
afd telemetry explain <run-id> [--json]
afd telemetry refresh --agentacct
afd telemetry stop
afd telemetry uninstall-autostart
```

`plan` is read-only and identifies exact versions, checksums, paths, ports, configuration changes,
agent coverage, data categories, and any unsupported requirement. `apply` accepts only the reviewed
plan and reconciles AFD-managed state. When called from a recipe, its content-derived approval token
is the authorization for every declared Observability component, including agentacct; nested applies
must not prompt again. `explain` is read-only: it resolves the AFD run, reports each
source and correlation confidence, returns a bounded summary, and provides local Phoenix/agentacct
links or identifiers when available. Missing evidence is `unavailable`, never inferred as zero or
success. It does not refresh an importer, access the network, or invoke an LLM; refresh is a separate
operation with declared effects.

## Shared identity and evidence contract

The schema distinguishes a run, a client session, a turn, a model request, a tool execution, and a
subagent run. A resumed client session can contain multiple runs and a run can have no known session.
Every observable execution uses:

- `afd.project.id` and `afd.workspace.id`;
- `afd.run.id` and optional `afd.parent.run.id`;
- `afd.agent.name` and the native agent session identifier when available;
- trace/span identifiers when available;
- source, capture time, evidence class, schema version, and correlation confidence.

Schema version `2` uses real W3C/OTEL trace and parent span relationships. An AFD public run
identifier and its OTEL trace identifier are separate identifiers recorded in the bounded index.
Child-agent and nested operations share the appropriate trace and carry a real `parentSpanId`; the
existing `afd.parent.run.id` attribute alone is not accepted as evidence of causality.

AFD stores only a bounded correlation index under its managed state root. It contains identifiers,
timestamps, source references, confidence, and lifecycle outcome; it contains no prompt, response,
file content, command body, credential, or full transcript. Agentacct and Phoenix keep their own
evidence and retention policies.

Correlation is `exact` only when a trustworthy native client/session identifier is explicitly linked
to the run. An evidenced but indirect join is labelled `evidenced`; a time/workspace candidate is
`heuristic` and is diagnostic only: AFD does not merge its evidence into the run. Multiple candidates
are `ambiguous`; otherwise the result is `unlinked`.

The initial capability matrix must report each dimension independently: native lifecycle, OTLP
trace, local-session import, tool activity, token usage, cost estimate, parent/child relation, and
content availability. A product logo alone never implies full coverage.

## Objectives and delivery gates

### 1. Implementation

Objective: establish the minimum maintainable integration without an execution wrapper.

- Replace `afd observe` with the `afd telemetry` command contract and one state model.
- Route trace ingestion through a pinned, checksummed OpenTelemetry Collector distribution rather
  than a Collector developed by AFD.
- Configure Phoenix and the Collector on loopback with remote export and upstream analytics off.
- Add agentacct as a pinned project/workbench dependency after license, release, Windows, CLI/API,
  storage, and network-behavior review.
- Bind Phoenix and agentacct transitive locks and their hashes to the same recipe plan token, and
  publish a machine-readable CycloneDX SBOM with the release.
- Extend the declarative recipe schema so a recipe can include the Observability capability and its
  components, policies, checks, and rollback. Do not represent lifecycle configuration as an opaque
  executable tool entry.
- Make recipe plan/apply the single consent boundary: the plan lists all managed changes and the
  confirmed apply installs, configures, starts, verifies, and records them as one desired state.
- Integrate only through a supported, versioned agentacct CLI/API contract; do not couple AFD to its
  internal SQLite schema. Implement an observation-only adapter and normalized capability probe.
- Implement the bounded correlation index and `afd telemetry explain <run-id>`.
- Correct the current trace encoder so one execution has a real trace tree before implementing
  `explain`.
- Start with verified Codex and Claude coverage; enable Hermes, Pi, and AGY only per capability that
  passes its own fixture and live validation.
- Preserve `plan`, approval, managed-state ownership, process fingerprinting, idempotent apply,
  scoped stop, and explicit autostart behavior.
- Use a new schema-v2 state root and leave unreleased schema-v1 data untouched. A live legacy process
  or port is a reported conflict, not permission to kill it or reinterpret its state.

Implementation gate: a clean workstation can preview and apply one recipe, inspect and explain one
supported run, and roll back only the recipe-managed state without a second activation prompt.
Telemetry failure never prevents an agent from running.

### 2. Validation

Objective: prove the architecture and dependency claims before making it the AFD default
observability path.

- Record exact upstream versions, licenses, artifacts, checksums, supported platforms, and expected
  local/remote network behavior.
- Validate agentacct against sanitized fixtures for every claimed agent and against real disposable
  Codex and Claude sessions.
- Treat the upstream Windows-via-WSL support boundary as a no-go for native Windows claims until AFD
  proves path translation, controlled access to Windows-side stores, lifecycle, and performance.
- For Codex on Windows, use one stable private read-only WSL mount namespace over the original
  session roots. Never copy the transcript tree, snapshot or rewrite the private SQLite schema, or
  parse it in AFD.
- Prove exact or explicitly confidence-labelled correlation between AFD run, native session,
  Phoenix trace, and agentacct evidence.
- Prove fail-closed behavior for unknown schema, partial/corrupt/rotating logs, symlinks, concurrent
  writers, unavailable backend, port collision, stale PID, and version drift.
- Inspect generated configurations and runtime connections to prove loopback-only operation and no
  remote exporter or unexpected phone-home traffic.
- Confirm that uninstall/stop removes only AFD-managed configuration and processes; original agent
  logs and third-party databases remain untouched.
- Confirm that a stale recipe token, changed plan, unsupported required component, or failed
  precondition blocks before any write; no mid-apply question leaves partial activation.
- Confirm that usage labelled `client_reported`, estimated cost, agent-reported work, and verified
  machine evidence remain distinct in storage and output.

Validation gate: all claims in `afd telemetry status --json` are backed by captured evidence, and
unsupported capabilities are explicit.

### 3. Refinement

Objective: reduce daily friction while keeping privacy and provenance visible.

- Make `status` summarize component health, data freshness, supported capabilities, last successful
  import, schema drift, and actionable remediation.
- Keep `explain` concise by default and add explicit drill-down rather than rendering transcripts.
- Add configurable retention for the AFD correlation index and document independent Phoenix and
  agentacct retention.
- Start the pilot with 30-day AFD correlation and Phoenix retention and bounded Collector buffering;
  if the agentacct store has no supported retention contract, the recipe plan reports
  `upstream_unbounded` and its policy must be accepted as part of the same recipe decision.
- Measure startup time, import latency, query latency, CPU, memory, disk growth, and log volume;
  define budgets from pilot evidence rather than assumptions.
- Add redaction diagnostics that report rejected attribute categories without echoing rejected data.
- Revisit optional native hooks only if observation-only evidence cannot meet an accepted use case;
  each hook remains independently previewable and reversible.

Refinement gate: the capability can remain enabled during normal work without material agent
latency, noisy intervention, uncontrolled storage growth, or ambiguous privacy behavior.

The accepted pilot baseline is: no change to agent exit code/signal/TTY; `status` p95 10.31 seconds;
`explain` live-only p95 10.26 seconds; live trace freshness 558 ms; zero false `exact`
correlations; and no managed-store or log growth in the five-sample window. The earlier 2/5-second
query targets were not met and are replaced by an explicit optimization objective. Availability and
overhead SLOs are promoted only after a longer pilot establishes a reliable distribution.

### 4. Tests

Objective: make the capability reproducible without depending on live proprietary agents in the
portable test suite.

- Unit tests: schemas, allowlists, redaction, identity, confidence rules, capability normalization,
  correlation, real trace parenting, retention, CLI parsing, and safe rendering.
- Contract tests: pinned Collector configuration, Phoenix health/query boundary, and agentacct
  capability/import/query boundary using sanitized versioned fixtures.
- Integration tests: trace through Collector to Phoenix, session import into agentacct, combined
  `explain`, partial-source behavior, restart, and scoped cleanup.
- Security tests: secret canaries, prompt/response/file-content exclusion, path disclosure,
  symlink/race handling, loopback enforcement, malicious log fields, and command-argument safety.
- Explanation tests: no network or model call, no importer refresh, deterministic JSON schema, stale
  evidence, contradictions, incompatible adapter, ambiguous correlation, and missing sources.
- Lifecycle tests: idempotent plan/apply, exact-version drift, stale/external processes, autostart,
  timeout tree cleanup, rollback, and interrupted startup.
- Recipe tests: Observability schema, deterministic approval token, complete effect preview, single
  confirmation, transactional failure, idempotent reapply, drift detection, and managed-only
  rollback.
- Platform tests: Windows x64 first, then the existing WSL2 fixture; other platforms remain
  unclaimed until independently evidenced.
- Live acceptance: one disposable run per claimed agent capability, with a reviewable evidence
  bundle that contains metadata but no raw sensitive content.

Test gate: `pnpm check` and the fresh-sandbox validation matrix pass, plus the live acceptance bundle
passes manual privacy and provenance review.

### 5. Environment activation

Objective: make the reviewed capability effective for daily use without silently changing the
workstation.

1. Produce and review the selected recipe plan for the target workstation. It must expand the full
   `afd telemetry plan`, including agentacct and every managed effect.
2. Pin all third-party versions and verify downloaded artifacts before extraction or execution.
3. Apply the confirmed recipe once. It installs, configures, starts, and verifies Collector, Phoenix,
   agentacct, declared native integrations, retention, and autostart without another activation step.
4. If a required component is unsupported on the target platform, fail before writing. A recipe may
   explicitly declare a component optional; in that case status must report the omission.
5. Verify health, ports, exporters, retention, quotas, storage roots, one synthetic trace, and the
   agentacct public contract.
6. Run disposable Codex and Claude pilots and inspect `status` and `explain` results.
7. Observe a bounded pilot period and review performance, disk growth, data exposure, and failures.
8. Promote the validated Observability recipe into the normal Layer 2 environment recipe; package
   updates reconcile its declared state but never add effects absent from the approved recipe.
9. Mark each session-intelligence capability effective only after its agent-specific acceptance gate
   passes. Pi and AGY remain `unsupported` until proved otherwise.
10. Capture the final environment evidence in the validation matrix and release checklist.

Recipe publication gate: Phoenix, Collector, agentacct, privacy, retention, lifecycle, recovery, and
at least the declared baseline adapters pass before the recipe is offered as ready. Adapter coverage
remains independent: unsupported agents are clearly partial instead of blocking supported daily use
unless the recipe declares that adapter required.

Steps 1–8 and 10 are complete on the current validated workstation. Step 9 remains intentionally
agent-specific: Codex and Claude are effective for live trace plus session import, Hermes is
effective for session import only, and Pi/AGY remain unsupported.

## Explicit non-goals

- No wrapper around Codex, Claude, Pi, Hermes, or AGY.
- No AFD-developed OTLP Collector, tracing backend, session parser, or observability dashboard.
- No raw transcript replication into Phoenix or the AFD state store.
- No remote telemetry, hosted account, credential collection, or provider billing claim by default.
- No undeclared hooks, profile changes, MCP registration, service, or autostart; declared recipe
  effects use its existing plan/confirmation boundary and do not require duplicate consent.
- No proxy, execution enforcement, or agent launching.
- No promise of equal coverage across agents whose native evidence differs.
