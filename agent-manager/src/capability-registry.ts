export const tuiCategories = ["Overview", "Workstation", "Agent assets", "Connections", "Recipes", "Observability", "Projects"] as const;
export type TuiCategory = typeof tuiCategories[number];
export type SafetyClass = "read-only" | "writes-local" | "writes-project" | "destructive-recoverable";
export type WorkflowStage = "inspect" | "plan" | "apply" | "verify" | "operate" | "rollback";

export interface CapabilityDefinition {
  readonly id: string;
  readonly category: TuiCategory;
  readonly title: string;
  readonly description: string;
  readonly command: string;
  readonly safety: SafetyClass;
  readonly stage: WorkflowStage;
  readonly inputs?: string;
  readonly internal?: boolean;
}

const c = (category: TuiCategory, id: string, title: string, command: string, description: string, safety: SafetyClass, stage: WorkflowStage, inputs?: string): CapabilityDefinition => ({
  category, id, title, command, description, safety, stage, ...(inputs ? { inputs } : {}),
});

export const capabilityRegistry: readonly CapabilityDefinition[] = [
  c("Overview", "help", "Command help", "help", "Show the compact command reference.", "read-only", "inspect"),
  c("Overview", "version", "Version", "--version", "Show the installed AFD version.", "read-only", "inspect"),
  c("Overview", "init", "Safe start", "init --dry-run", "Confirm readiness and show safe next steps without applying a layer.", "read-only", "inspect"),
  c("Overview", "provenance", "Installation provenance", "provenance", "Inspect CLI, product root, runtime, version, and execution identity.", "read-only", "inspect"),
  c("Overview", "doctor", "Workstation doctor", "doctor", "Diagnose foundation and sandbox-access postconditions.", "read-only", "inspect"),
  c("Overview", "verify", "Full verification", "verify", "Inspect catalog drift and run supported platform verification scripts.", "read-only", "verify"),

  c("Workstation", "layer1-plan", "Plan Layer 1", "layer1 --dry-run", "Plan runtimes, package managers, PATH, shims, and host tools.", "read-only", "plan"),
  c("Workstation", "layer1-apply", "Apply Layer 1", "layer1 --apply", "Apply the reviewed Layer 1 foundation plan.", "writes-local", "apply"),
  c("Workstation", "layer2-plan", "Plan Layer 2", "layer2 --dry-run", "Plan supported agent applications, CLIs, and common toolbox.", "read-only", "plan"),
  c("Workstation", "layer2-apply", "Apply Layer 2", "layer2 --apply", "Apply the reviewed Layer 2 plan.", "writes-local", "apply", "Optional Linux flag: --allow-claude-postinstall"),
  c("Workstation", "fix-layer1-plan", "Preview Layer 1 repair", "fix layer1 --dry-run", "Preview reconciliation of AFD-owned Layer 1 state.", "read-only", "plan"),
  c("Workstation", "fix-layer1-apply", "Repair Layer 1", "fix layer1 --apply", "Reconcile Layer 1 and rerun its doctor.", "writes-local", "apply"),
  c("Workstation", "fix-sandbox-plan", "Preview sandbox repair", "fix sandbox --dry-run", "Preview the Windows fixed-target RX-only access repair.", "read-only", "plan"),
  c("Workstation", "fix-sandbox-apply", "Repair sandbox access", "fix sandbox --apply", "Apply and verify the reviewed sandbox-access repair.", "writes-local", "apply"),
  c("Workstation", "backup-status", "Backup status", "backup status", "Inspect snapshot counts, sizes, and retention violations.", "read-only", "inspect"),
  c("Workstation", "backup-maintain-plan", "Preview backup maintenance", "backup maintain --dry-run", "Preview snapshots exceeding retention.", "read-only", "plan"),
  c("Workstation", "backup-maintain-apply", "Maintain backups", "backup maintain --apply", "Remove only snapshots selected by retention policy.", "destructive-recoverable", "apply"),
  c("Workstation", "migrate-plan", "Preview migration", "migrate --dry-run", "Preview recognized legacy AFD state migration.", "read-only", "plan"),
  c("Workstation", "migrate-apply", "Apply migration", "migrate --apply", "Apply the reviewed legacy-state migration.", "writes-local", "apply"),

  c("Agent assets", "catalog", "Agent catalog", "catalog", "List target skill, profile, and MCP capabilities.", "read-only", "inspect"),
  c("Agent assets", "assets-status", "Managed asset status", "status", "Inspect planned catalog/profile changes and drift.", "read-only", "inspect"),
  c("Agent assets", "assets-review", "Review managed assets", "review", "Inspect planned changes and pending agent-created skills.", "read-only", "inspect"),
  c("Agent assets", "sync-plan", "Preview asset sync", "sync --dry-run", "Preview one-way synchronization from the canonical catalog.", "read-only", "plan"),
  c("Agent assets", "sync-apply", "Synchronize assets", "sync", "Synchronize non-divergent managed skills and profiles.", "writes-local", "apply"),
  c("Agent assets", "adopt-plan", "Preview adopt from agent", "adopt <agent> <skill> --dry-run", "Inspect an agent-owned skill before copying it to pending review.", "read-only", "plan", "Agent ID and skill ID"),
  c("Agent assets", "adopt-apply", "Adopt from agent", "adopt <agent> <skill>", "Copy an agent-owned skill into pending review; import is the CLI alias.", "writes-local", "apply", "Agent ID and skill ID"),
  c("Agent assets", "pending", "Pending skills", "pending", "List skills awaiting review.", "read-only", "inspect"),
  c("Agent assets", "promote-plan", "Preview promotion", "promote <agent> <skill> --dry-run", "Preview promotion into the canonical catalog.", "read-only", "plan", "Agent ID and skill ID"),
  c("Agent assets", "promote-apply", "Promote skill", "promote <agent> <skill> --confirm", "Promote the reviewed pending skill.", "writes-local", "apply", "Agent ID and skill ID"),
  c("Agent assets", "reject-plan", "Preview rejection", "reject <agent> <skill> --dry-run", "Preview rejection and recoverable snapshot creation.", "read-only", "plan", "Agent ID and skill ID"),
  c("Agent assets", "reject-apply", "Reject skill", "reject <agent> <skill> --confirm", "Reject a pending skill and retain its snapshot.", "destructive-recoverable", "apply", "Agent ID and skill ID"),
  c("Agent assets", "recover-plan", "Preview recovery", "recover <agent> <rejected-snapshot> --dry-run", "Preview return of a rejected snapshot to pending review.", "read-only", "plan", "Agent ID and snapshot ID"),
  c("Agent assets", "recover-apply", "Recover rejected skill", "recover <agent> <rejected-snapshot> --confirm", "Return a rejected snapshot to pending review.", "writes-local", "apply", "Agent ID and snapshot ID"),
  c("Agent assets", "hermes-plan", "Preview Hermes update", "hermes update --dry-run", "Preview the guarded Hermes update.", "read-only", "plan"),
  c("Agent assets", "hermes-apply", "Update Hermes", "hermes update --apply", "Apply the guarded Hermes update.", "writes-local", "apply"),

  c("Connections", "mcp-status", "MCP status", "mcp status --scope effective", "Plan synchronization and report MCP blockers or drift.", "read-only", "inspect", "Scope, optional project and agents"),
  c("Connections", "mcp-verify", "Verify MCP", "mcp verify --scope effective", "Verify registry and native-file postconditions.", "read-only", "verify", "Scope, optional project and agents"),
  c("Connections", "mcp-discover", "Discover native MCP", "mcp discover <agent> --scope user", "Read a verified native agent surface with redacted definitions.", "read-only", "inspect", "Agent, user/project scope, optional project"),
  c("Connections", "mcp-sync-plan", "Preview MCP sync", "mcp sync --scope effective --dry-run", "Produce a redacted exact synchronization plan and token.", "read-only", "plan", "Scope, optional project, agents and Pi adapter"),
  c("Connections", "mcp-sync-apply", "Apply MCP sync", "mcp sync --scope effective --confirm <plan-token>", "Revalidate and atomically apply a reviewed synchronization plan.", "writes-local", "apply", "Scope, project, agents and plan token"),
  c("Connections", "mcp-adopt-plan", "Preview MCP adoption", "mcp adopt <agent> <server> --from-scope user --to-scope project --project . --dry-run", "Preview adoption into a destination registry and native targets.", "read-only", "plan", "Agent, server, source/destination scope and project"),
  c("Connections", "mcp-adopt-apply", "Adopt MCP server", "mcp adopt <agent> <server> --from-scope user --to-scope project --project . --confirm <plan-token>", "Apply a reviewed server adoption.", "writes-project", "apply", "Agent, server, scopes, project and plan token"),
  c("Connections", "mcp-enable-plan", "Preview MCP enable", "mcp enable <server> --scope project --project . --dry-run", "Preview enabling one managed server.", "read-only", "plan", "Server, scope, project and agents"),
  c("Connections", "mcp-enable-apply", "Enable MCP server", "mcp enable <server> --scope project --project . --confirm <plan-token>", "Enable one reviewed managed server.", "writes-project", "apply", "Server, scope, project and plan token"),
  c("Connections", "mcp-disable-plan", "Preview MCP disable", "mcp disable <server> --scope project --project . --dry-run", "Preview disabling one managed server.", "read-only", "plan", "Server, scope, project and agents"),
  c("Connections", "mcp-disable-apply", "Disable MCP server", "mcp disable <server> --scope project --project . --confirm <plan-token>", "Disable one reviewed managed server.", "writes-project", "apply", "Server, scope, project and plan token"),
  c("Connections", "mcp-move-plan", "Preview MCP scope move", "mcp move <server> --from user --to project --project . --dry-run", "Preview an atomic server move between user and project scope.", "read-only", "plan", "Server, source/destination scope, project and agents"),
  c("Connections", "mcp-move-apply", "Move MCP scope", "mcp move <server> --from user --to project --project . --confirm <plan-token>", "Apply a reviewed atomic server scope move.", "writes-project", "apply", "Server, scopes, project and plan token"),

  c("Recipes", "recipes-list", "Built-in recipes", "layer3 recipes", "List built-in recipes.", "read-only", "inspect"),
  c("Recipes", "recipe-show", "Show recipe", "layer3 show <source>", "Load, validate, and show a normalized recipe.", "read-only", "inspect", "Built-in ID, local file/directory, or HTTPS source"),
  c("Recipes", "recipe-plan", "Plan recipe", "layer3 plan <source>", "Expand managed effects, blockers, and approval token.", "read-only", "plan", "Recipe source"),
  c("Recipes", "recipe-apply", "Apply recipe", "layer3 apply <source> --confirm <plan-token>", "Revalidate and apply the exact reviewed recipe plan.", "writes-local", "apply", "Recipe source and plan token"),
  c("Recipes", "recipe-verify", "Verify recipe", "layer3 verify <source>", "Check managed recipe state for missing items or drift.", "read-only", "verify", "Recipe source"),
  c("Recipes", "recipe-rollback", "Rollback recipe", "layer3 rollback <source> --confirm", "Restore or remove only state recorded as managed by the recipe.", "destructive-recoverable", "rollback", "Recipe source"),
  c("Recipes", "recipe-extract-inventory", "Inspect extraction inventory", "layer3 extract --output <file>", "Print the global inventory for review without writing.", "read-only", "inspect", "Outside-project output path"),
  c("Recipes", "recipe-extract-write", "Extract recipe", "layer3 extract --output <file> --include <id,id>", "Write a sanitized recipe containing selected inventory IDs.", "writes-project", "apply", "Output path and selected inventory IDs"),

  c("Observability", "telemetry-plan", "Plan observability", "telemetry plan", "Plan recipe-managed observability and run preflight checks.", "read-only", "plan", "Optional recipe source"),
  c("Observability", "telemetry-apply", "Apply observability", "telemetry apply --confirm <plan-token>", "Apply reviewed observability and ensure the loopback broker where supported.", "writes-local", "apply", "Plan token and optional recipe source"),
  c("Observability", "telemetry-status", "Telemetry status", "telemetry status", "Report component, source, retention, and health state.", "read-only", "inspect"),
  c("Observability", "telemetry-verify", "Verify telemetry", "telemetry verify", "Verify the configured telemetry runtime.", "read-only", "verify"),
  c("Observability", "telemetry-explain", "Explain run", "telemetry explain <run-id>", "Explain one correlated run using bounded metadata.", "read-only", "inspect", "Run ID"),
  c("Observability", "telemetry-refresh", "Refresh agentacct evidence", "telemetry refresh --agentacct", "Refresh supported agentacct-derived evidence.", "writes-local", "operate"),
  c("Observability", "telemetry-trace", "Emit bounded trace", "telemetry trace --workspace . --agent codex --operation <name>", "Emit a bounded OTLP trace and correlation record.", "writes-local", "operate", "Workspace, agent, operation, outcome and duration"),
  c("Observability", "telemetry-stop", "Stop telemetry", "telemetry stop", "Stop managed telemetry runtime components.", "writes-local", "operate"),
  c("Observability", "telemetry-resume", "Resume telemetry", "telemetry resume", "Resume components and reconcile supported autostart.", "writes-local", "operate"),
  c("Observability", "telemetry-uninstall-autostart", "Remove telemetry autostart", "telemetry uninstall-autostart", "Remove AFD-managed telemetry autostart.", "destructive-recoverable", "operate"),

  c("Projects", "harness-audit", "Audit project harness", "harness audit .", "Identify canonical policy, adapters, duplication, contradictions, and blockers.", "read-only", "inspect", "Project path"),
  c("Projects", "harness-plan", "Plan project harness", "harness plan .", "Produce exact changes, hashes, blockers, and approval token.", "read-only", "plan", "Project path, agents, optional legacy removal"),
  c("Projects", "harness-stage", "Stage project harness", "harness stage . --output <outside-directory>", "Render proposed files into an external staging directory.", "writes-local", "operate", "Project and outside-project output path"),
  c("Projects", "harness-test-ready", "Check harness runner", "harness test .", "Check runner readiness against staged policy.", "read-only", "verify", "Project, agents and timeout"),
  c("Projects", "harness-test-live", "Run live harness test", "harness test . --live --evidence <outside-project-file>", "Execute bounded live tests and optionally write external evidence.", "writes-local", "verify", "Project, agents, timeout and evidence path"),
  c("Projects", "harness-apply", "Apply project harness", "harness apply . --evidence <passing-live-report> --confirm <plan-token>", "Transactionally apply the exact evidence-bound plan.", "writes-project", "apply", "Project, evidence path and plan token"),
  c("Projects", "harness-verify", "Verify applied harness", "harness verify . --receipt <file>", "Verify applied artifacts and complete Git-visible fingerprint.", "read-only", "verify", "Project and receipt path"),
  c("Projects", "harness-rollback", "Rollback project harness", "harness rollback . --receipt <file> --confirm <plan-token>", "Refuse drift and restore exact previous bytes.", "destructive-recoverable", "rollback", "Project, receipt path and plan token"),
] as const;

export function capabilitiesFor(category: TuiCategory): readonly CapabilityDefinition[] {
  return capabilityRegistry.filter((item) => item.category === category && !item.internal);
}

export function safetyLabel(value: SafetyClass): string {
  return ({ "read-only": "READ ONLY", "writes-local": "WRITES LOCAL STATE", "writes-project": "WRITES PROJECT", "destructive-recoverable": "DESTRUCTIVE - RECOVERABLE" })[value];
}
