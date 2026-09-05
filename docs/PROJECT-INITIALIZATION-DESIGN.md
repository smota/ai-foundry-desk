# Project directory initialization design

Status: Approved design; deterministic foundation workflow implemented in the working tree.
See [the implemented CLI guide](PROJECT-INITIALIZATION.md) for the executable contract.
The original proposal below retains roadmap details beyond the first delivery: a guided facade,
custom lifecycle profiles and a general recipe plugin catalog. Initialized-project activation
uses a 24-hour evidence limit with environment/runner binding and executable version re-probes.
Date: 2026-09-05.

AFD should initialize a reviewable project foundation and then activate explicitly selected
harnesses against that foundation. These are separately verifiable outcomes. A missing harness
contract must not prevent a user from creating approved project files, and successful file
creation must not be presented as successful multi-harness activation.

The Meshloop planning and initialization conversation is the motivating case. The user selected
Rust, five harnesses, fully AI-coded engineering, an ADR lifecycle, and Apache-2.0. AFD audited,
planned, and staged adapters, but an assistant had to author and copy the entire foundation.
Executable tests were blocked by a missing linker, and the full harness set could not pass
readiness. This design makes those intermediate outcomes intentional, resumable, and precise.

## 1. Product boundary

AFD owns deterministic inspection, recipe rendering, change planning, prerequisite reporting,
staging, validation, transactional writes, and scoped receipts. A conversational assistant may
help the user draft a brief or extract practices from named sources. Its output becomes a
reviewable input artifact; it never becomes an implicit instruction to the initializer.

AFD does not infer a project's architecture, legal owner, license, approval, or deployment policy.
It does not become a coding orchestrator, install a mandatory skill framework, or implement the
application during initialization. Existing Layer 1/2/3 and optional capabilities remain separate;
project initialization is an independent capability, not a new sequential workstation layer.

Supported targets: a missing directory, an existing empty directory, an unborn Git repository,
or an existing project. Git is optional. Git initialization, commits, branches, hooks, global tools,
services, credentials, MCP configuration, publication, and deployment are outside the default
operation. A directory tree shown in a source document is a proposal, not permission to create it.

## 2. Definitions and completion contract

| Term | Definition |
| --- | --- |
| Brief | User-reviewed choices: purpose, selected harnesses, baseline, policies, recipe inputs, unresolved decisions |
| Foundation | Project-owned canonical instructions, agreed documentation, optional language scaffold and legal files |
| Recipe | Versioned deterministic templates, typed inputs, owned outputs, and declared validation requirements |
| Required policy closure | Canonical policy plus explicit supporting instruction files every selected harness must be able to read |
| Candidate | Exact rendered foundation/adapters with an immutable file manifest and input references |
| Desired harnesses | The exact user-selected set; independent of executable discovery and activation status |
| Active harnesses | Selected harnesses with passing supported-contract evidence for the current candidate |
| Receipt | Private record of exact effects, before/after content, validations, environment, and operation identity |

Report independent state dimensions rather than one success boolean:

```text
foundation: absent | planned | applied | drifted
validation: not-run | passed | failed | blocked
harnesses: pending | verified | blocked | drifted
```

Statuses carry reasons and per-check evidence. Process execution failures and inability to inspect
are not evidence of absence. Foundation completeness, build readiness, and harness readiness are
separate. The requested scope declares which validations are required for overall completion.

Default full initialization is complete only when the foundation is applied, all required
validation passes, and every desired harness is verified. A foundation-only request can complete
at its narrower scope. Never convert a full request to foundation-only silently.

## 3. User journey and proposed CLI

Use a new `afd project` namespace for foundation operations. Keep `afd harness` for activation
and ongoing adapter maintenance. Reuse the same lower-level transaction and fingerprint services.
All examples below are proposed syntax; they must not be added to current CLI usage as supported.

```powershell
# Inspection writes nothing and invokes no model or arbitrary project command.
afd project inspect 'C:\code\new-project' --agents 'codex,claude-code,pi,grok,agy' --json

# A reviewed brief is authored by the user or their assistant outside the target.
# Plan writes JSON to stdout; shell redirection explicitly saves it outside the target.
afd project plan 'C:\code\new-project' --brief .\brief.json --json > .\plan.json
afd project stage --plan .\plan.json --output .\stage
afd project validate --stage .\stage --checks structural --json

# Optional approved command probes/build checks run only in the disposable candidate.
afd project validate --stage .\stage --checks build --json

# This is an explicit narrower operation if required build/harness checks are blocked.
afd project apply --plan .\plan.json --scope foundation --confirm '<foundation-token>'
afd project verify 'C:\code\new-project' --receipt '<foundation-receipt>'

# After foundation application, use the existing harness workflow with improved contracts.
afd harness plan 'C:\code\new-project' --agents 'codex,claude-code,pi,grok,agy' --json
afd harness stage 'C:\code\new-project' --agents 'codex,claude-code,pi,grok,agy' --output .\adapters
afd harness test 'C:\code\new-project' --agents 'codex,claude-code,pi,grok,agy' --live --evidence .\live.json
afd harness apply 'C:\code\new-project' --agents 'codex,claude-code,pi,grok,agy' --evidence .\live.json --confirm '<harness-token>'
afd project status 'C:\code\new-project' --json
```

Before foundation apply, the review shows exactly which outcomes will remain blocked. A user
can approve foundation creation and live checks together in one conversation. The assistant may
then execute the corresponding exact operations without repeatedly requesting the same approval.
The CLI records effects and tokens; token possession is not proof of human identity or authorization.

An eventual `afd project init` guided facade can run this flow. Without explicit apply authority,
it stops with a staged proposal. It must never silently install prerequisites or drop harnesses.
Do not add a bypass flag for missing live evidence. MVP need not provide the facade.

Resume by inspecting current state and re-planning outstanding work. Reuse evidence only if all
its content, environment, identity, scope, and contract bindings remain valid. Do not treat an old
receipt as permission for a new candidate.

## 4. Brief and source refinement

An example brief shape (subject to schema review):

```json
{
  "schemaVersion": 1,
  "project": { "name": "meshloop", "purpose": "Local engineering orchestration" },
  "desiredHarnesses": ["codex", "claude-code", "pi", "grok", "agy"],
  "foundation": {
    "recipe": { "id": "rust-workspace", "version": "1", "digest": "<verified-template-digest>" },
    "toolchain": { "version": "1.98.0", "edition": "2024" },
    "components": ["domain", "engine", "adapters", "cli"]
  },
  "policy": {
    "canonical": "AGENTS.md",
    "engineering": "ai-coded-human-governed",
    "architectureDecisions": "adr-v1",
    "skills": "none"
  },
  "licensing": { "spdx": "Apache-2.0", "rightsHolder": null },
  "sources": [{ "id": "architecture-source", "digest": "<digest>", "publishOriginal": false }]
}
```

Toolchain versions are user choices informed by inspection, not universal defaults. A null
rights holder is an unresolved field: do not invent a legal name or an exclusive copyright claim.
Recipes needing it must stop the affected legal artifact or render an explicitly reviewed draft.
Unresolved fields affecting the requested foundation cannot be disguised as accepted defaults.

An external assistant can extract general practices from named repositories and documents into
an import manifest. For each candidate rule record source locator/digest, original excerpt or
private reference, proposed wording, classification, disposition, and review state. Classifications:
general engineering, stack-specific, product-specific, skill-dependent, obsolete/conflicting.
Dispositions: retain, adapt, omit, unresolved. Read only explicitly selected source content.

The Meshloop example should retain boundary validation and honest review evidence; adapt Rust
conventions; omit Ativaly domain policy and skill invocation requirements; and leave architecture
choices needing review proposed. Source labels such as "Approved for Implementation" never set
an approval field. Clarify ambiguous terms such as ADF versus ADR before drafting lifecycle rules.

MVP consumes reviewed UTF-8 Markdown/JSON. DOCX/PDF extraction stays in the external authoring
workflow; AFD need not acquire an office renderer or model API dependency. No repository scanning,
skill loading, credential inspection, or publishing of source documents is implied by an import.

## 5. Recipes and ownership

Separate composable inputs: base policy, language layout, engineering governance, ADR template,
and optional legal artifacts. A Rust application need not use Meshloop's four-crate architecture.
The component graph is a reviewed recipe input, validated for legal identifiers and cycles.

Start with `policy-only` and one small Rust scaffold recipe. Recipes are packaged declarative
templates, pinned by version and digest. No remote script execution or package lifecycle hooks.
Support custom reviewed files without requiring installation of a skill or SDK. Avoid creating
empty feature implementations or smoke tests that imply a working product.

| Artifact | Ownership after creation | Later behavior |
| --- | --- | --- |
| AGENTS.md and supporting policy | Project | Explicit content reconciliation; no template overwrite |
| Source, Cargo manifests, README, architecture docs | Project | Seed once; no implicit resync |
| ADRs and legal notices | Project | Never infer approvals or overwrite legal choices |
| Thin harness adapters | AFD managed blocks/files | Refresh only against current canonical/closure digest |
| `.afd/project.json` | Declarative project intent | Selected harnesses, recipe provenance, closure and validation references |
| Private plans, original source references, receipts and transcripts | AFD state outside target | Excluded from version control and public manifests |

The committed manifest stores desired configuration, not machine-local paths or claims of live
readiness. Local receipts hold activation facts. `.afd/project.json` must coexist with the existing
`.afd/mcp.json` contract and leave it untouched. Re-running initialization preserves project-owned
bytes, reports conflicts, and generates a new plan only for explicitly requested changes.

## 6. Architecture and AI engineering profiles

Provide an optional generic governance profile with roles, task ownership, worktree isolation,
integration ownership, review evidence, and clear human action boundaries. AFD installs the
agreed policy; it does not execute this development workflow or guarantee agent compliance.

ADR lifecycle: Draft -> Proposed -> Accepted, with Rejected/Withdrawn alternatives from Proposed;
Accepted -> Superseded or Deprecated. Keep implementation state separate: not-started,
in-progress, implemented, verified. Stable IDs, alternatives, consequences, acceptance evidence,
verification references, and replacement links are required. Lifecycle names can be customized
through a versioned profile rather than hardcoded into the entire AFD runtime.

A recipe may seed draft/proposed ADRs. Mark one Accepted only when the reviewed brief includes
explicit decision evidence covering its exact content. Accepting a folder layout does not accept
every proposed runtime ADR. Fully AI-coded is an explicit project preference; do not silently
impose it, assign an AI legal authorship, or promise that generated code has exclusive copyright.

License selection must be explicit. Pin unmodified SPDX license text in the distribution and
validate its digest. Keep attribution and trademark choices separate from software permissions.
AFD offers file generation, not legal advice or automatic IP clearance.

## 7. Capability and environment model

Unify discovery, rendering, probe, and safe live-runner metadata in one capability registry.
Evaluate support before looking for an output filename. A native canonical-file consumer can
legitimately have no adapter file; an unsupported harness cannot disappear through that branch.
Honor the exact selected set: the new project API must not automatically add Codex.

For each selected harness report:

- Stable identity, explicitly distinct from aliases such as Agy/Antigravity.
- Discovery contract: native canonical, adapter, explicit configured injection, or unsupported.
- Renderer and safe runner contract IDs/versions, supported OS and tested version range.
- Executable resolution, version-probe result, and process-start readiness as separate facts.
- Probe context: host/platform, execution identity class, sandbox restrictions, and launcher path.
- Live observation: passed, failed, not-run, blocked, or inconclusive, with actionable reason.

An executable found on PATH with a failed version probe is `version-unknown`, not automatically
ready. `permission-denied` and `probe-restricted` are not `not-installed`. Preserve both sandbox
and host observations when they differ. Never auto-escalate or change profiles to make a probe pass.

Pure inspection resolves paths and reads non-secret metadata. Version/build probes are separate,
explicit command executions with known side effects and time limits; do not assume every third-party
`--version` invocation is read-only. Installed CLI authentication readiness is established only by
authorized live sessions without reading authentication files. Do not silently enable skills,
extensions, plugins, or MCP servers during tests.

Rust readiness includes compiler, Cargo, formatter, linter, target, linker, and applicable SDK.
For an MSVC target, a Rust version alone is insufficient. Report the missing prerequisite and
suggest the existing AFD workstation workflow; installing it is a separate approved operation.

## 8. Verification evidence

Foundation structural checks validate brief schema, required fields, legal paths, links, template
integrity, Cargo component graph, ADR states, and absence of unresolved required placeholders.
Build validation executes only a reviewed command list in a disposable candidate, with declared
write roots, network policy, timeout, and lockfile behavior. Existing-repository scripts are
untrusted inputs and must not run merely because a recipe recognizes the language.

Harness tests include the full approved required-policy closure, not just AGENTS.md and adapters.
Resolve explicit references with containment checks; never crawl arbitrary links or source trees.
Use a fresh session and a contract capable of disabling unrelated context. Record when isolation
cannot be established. Verify bounded content challenges from the closure, not just the first
heading and final line. The result proves limited discovery behavior, not universal obedience.

Bind evidence to candidate digest, plan/scope, exact harness set, policy closure, recipe versions,
AFD build identity, runner contract, executable identity/version, platform, and execution context.
Hashes establish integrity and comparison, not trustworthy authorship by themselves. Store receipts
in the existing private state boundary and require exact per-agent identities without duplicates.

Source edits invalidate content evidence; relevant executable/config/contract changes invalidate
runtime evidence. Define expiry and re-probe rules per check. A matching old file is insufficient
after an environment change. Model output cannot declare itself accepted or grant permissions.

## 9. Fingerprints, transactions, and rollback

Do not depend on HEAD for content safety. Use a sorted manifest of scoped path, file type,
existence, exact byte digest, and applicable executable bit. Include all proposed writes and
declared policy/build inputs, relevant directory-entry inventories, and explicit expected absences.
Git branch, HEAD, and status are supplementary context. Content changes must be detected even
when Git status text remains unchanged. Denylisted secret stores are neither read nor hashed.

Declare coverage and exclusions. Never call a limited manifest a complete-workspace fingerprint.
Unreadable required inputs block planning. Newly created protected targets or unexpected entries
in a reviewed empty directory invalidate apply. Excluded build/cache output cannot become a write
target or required input without a new plan. For existing repositories, plan only an explicit scope.

Resolve a missing destination against its nearest existing real parent. Validate containment,
Windows case collisions, reserved names, junctions/reparse points, and symlink parents. Bind the
target and recheck immediately before writes. Another process creating the directory is drift.
Use a per-target lock for cooperating operations and detect noncooperating edits; do not claim a
lock makes concurrent filesystem mutation impossible.

Foundation apply has its own token over exact bytes, effects, and any explicitly acknowledged
incomplete outcomes. Adapter activation has a dependent token and requires passing live evidence
for every desired harness. An explicit subset activation can be designed later, but changing the
desired set is always a separate user choice and never an automatic fallback.

Journal mutation intent before writes, use atomic file replacement where supported, and record
created directories. A multi-file operation is recoverable, not a single filesystem-atomic action.
On interruption, inspect journal and current bytes before rollback/resume. Restore only artifacts
whose expected state still matches; preserve concurrent user changes and report manual conflicts.
Remove only directories created by the operation and only when empty. Never recursively remove
a target directory as generic rollback. No Git commit is needed to establish a rollback baseline.

Distinguish `verify --receipt` (exact historical snapshot) from project status (current desired
conformance). Normal user evolution may invalidate a receipt without meaning the project is broken.
Foundation rollback must account for later adapter receipts; block while dependent activation is
present or perform an explicitly reviewed reverse-order rollback. Do not leave dangling pointers.

## 10. Current implementation gaps and reuse

These are code-inspection findings, not newly executed regression tests. During this design
session, concurrent uncommitted edits appeared in harness planning and its tests. They add
content hashing for unborn/non-Git repositories and move capability checks before path handling.
Those changes are preserved and were not authored or tested as part of this design. The table
distinguishes the case-study baseline from work already underway; release status is unverified.

| Existing surface | Reuse or required change |
| --- | --- |
| `harness-plan.ts` | Preserve deterministic actions; allow planning foundation candidates before canonical files exist |
| `harnessGitState` | Case-study baseline used nullable/status-only protection; concurrent edits add content hashing. Extend toward explicitly scoped manifests, privacy exclusions, and required-input declarations |
| `normalizeSelection` | Existing code inserts Codex; new explicit selection must preserve the exact user's set |
| `planHarness` | Case-study baseline checked primary path before unsupported discovery; concurrent edits fix ordering and block generated-only discovery. Integrate verified results into the unified capability contract |
| `harness-registry.ts` and `RUNNERS` | Reconcile split registries; Grok runner existence currently coexists with unsupported discovery |
| `commandAvailable` | Version failure can yield available with null version; separate discovery from usable/versioned readiness |
| `prepareSmokeWorkspace` | Include declared supporting policy closure, not only canonical text and adapter actions |
| `policyFacts` | First-heading/final-line checks are a narrow smoke test, not whole-policy evidence |
| `harness-apply.ts` | Reuse safe path handling and scoped receipts; strengthen manifests, evidence identity checks, and crash journaling |

Keep v1 harness receipts readable with their original, explicitly limited semantics. Do not silently
upgrade their coverage claims. New activation should produce a versioned stronger contract. Where
v1 and v2 cannot safely compose, require a new plan/test instead of fabricating migration evidence.

Proposed modules under `agent-manager/src`: `project-contracts`, `project-inspect`,
`project-recipes`, `project-plan`, `project-validate`, and `project-apply`. Factor shared
fingerprinting, capability resolution, and transaction handling into reusable internal services.
Keep provider-specific launch details in registry/platform adapters; do not shell out to another
AFD process to compose internal commands.

## 11. Delivery slices and acceptance scenarios

1. Harden shared selection, capability diagnostics, and fingerprints with regression tests.
2. Add brief/recipe schemas, pure inspection, deterministic plan/stage, and structural validation.
3. Add foundation apply/verify/rollback with journaling and project-owned output preservation.
4. Compose full harness closure tests, activation, status, and resume; add a Rust prerequisite profile.
5. Evaluate additional language recipes and a guided `project init` interface after the core proves useful.

Required scenarios before release:

- Missing directory, empty directory, unborn Git, normal Git, worktree, and non-Git target.
- Existing canonical policy preserved; divergent adapter blocks; no overwritten project-owned file.
- Same input yields the same plan; changed content with identical Git status invalidates it.
- Case collisions, symlink/junction substitution, new target files, and unreadable required inputs block safely.
- Exact selected set is preserved, including selections without Codex and explicit Agy identity.
- Grok-like runner/discovery mismatch and Agy-like missing runner block activation, not an approved foundation-only apply.
- Missing linker, null CLI version, sandbox-denied probe, absent executable, and failed live login remain distinct.
- Required policy document missing from a smoke workspace fails; changed closure invalidates evidence.
- Staged input or recipe tampering, duplicate agent evidence, foreign plan evidence, and stale runtime evidence fail.
- Failure between file writes or before receipt completion can recover without deleting subsequent user changes.
- Repeated apply is idempotent; rollback refuses drift and handles dependent receipts explicitly.
- Source-document approval text is ignored as authority; source/private paths never leak into public files.
- Skill-free initialization performs no skill installation, global config mutation, or unsolicited Git action.

For the Meshloop case, the honest result would be foundation applied, static checks passed,
executable tests blocked by linker availability, and activation blocked by incomplete harness
contracts. The next action should be explicit without losing approved inputs or redoing the
foundation. Full initialization must remain incomplete until its declared prerequisites pass.

## 12. Review decisions before implementation

Recommended defaults: `afd project` for foundation operations; explicit desired harnesses;
policy-only plus a minimal Rust recipe for MVP; separate foundation/activation receipts; private
state for machine evidence; external assistant authoring instead of built-in model calls; and no
automatic system installation. Review these choices as an AFD feature proposal before coding.

The user subsequently authorized implementation, testing, and a deterministic current-environment
smoke test without LLM processing. That authorization does not imply changes to Meshloop,
upstream publication, or workstation reconfiguration.

## References

- [Current project harness workflow](PROJECT-HARNESSES.md)
- [AFD architecture and ownership](ARCHITECTURE.md)
- [Harness contracts](../agent-manager/src/harness-contracts.ts)
- [Harness planning](../agent-manager/src/harness-plan.ts)
- [Discovery registry](../agent-manager/src/harness-registry.ts)
- [Harness smoke tests](../agent-manager/src/harness-smoke.ts)
- [Apply and rollback](../agent-manager/src/harness-apply.ts)

The motivating transcript and generated Meshloop reports are private local case evidence; they
are not copied into this design or linked through machine-specific paths for publication.
