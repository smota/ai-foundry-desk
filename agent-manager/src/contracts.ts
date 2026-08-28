export const MANIFEST_VERSION = 1 as const;
export type AgentId = "claude-code" | "codex" | "antigravity" | "pi" | "hermes" | "grok";
export type Capability = "supported" | "unsupported" | "deferred";
export interface AgentTarget { readonly id: AgentId; readonly displayName: string; readonly command: string; readonly skills: Capability; readonly profile: Capability; readonly reason?: string }
export interface CatalogEntry { readonly id: string; readonly kind: "skill"; readonly source: string; readonly revision?: string; readonly promotedBy?: string }
export interface TargetSelection { readonly agent: AgentId; readonly entries: readonly string[]; readonly profile: boolean }
export interface AgentManifest { readonly manifestVersion: typeof MANIFEST_VERSION; readonly profile: { readonly source: string }; readonly catalog: readonly CatalogEntry[]; readonly targets: readonly TargetSelection[] }
export type ChangeKind = "create" | "update" | "in-sync" | "drift" | "importable" | "unsupported";
export interface Change { readonly agent: AgentId | "canonical"; readonly kind: ChangeKind; readonly path: string; readonly detail: string }
export interface AppliedState { readonly stateVersion: 1; readonly appliedAt: string; readonly files: Readonly<Record<string, string>> }
export interface PendingEntry { readonly agent: AgentId; readonly id: string; readonly path: string }
export interface RecipeSkill { readonly id: string; readonly source: string; readonly targets: readonly AgentId[]; readonly localOverlay?: string }
export interface RecipeTool { readonly id: string; readonly command: string; readonly source: string; readonly version: string; readonly checksum?: string }
export interface ObservabilityRecipeCapability {
  readonly id: "observability";
  readonly required: boolean;
  readonly collector: { readonly version: string; readonly source: string; readonly sha256: string };
  readonly phoenix: { readonly version: string; readonly lockSha256: string; readonly runtime: { readonly version: string; readonly source: string; readonly sha256: string } };
  readonly agentacct: { readonly version: string; readonly mode: "observe-only"; readonly source: string; readonly sha256: string; readonly lockSha256: string };
  readonly retentionDays: number;
  readonly autostart: boolean;
  readonly nativeIntegrations: readonly AgentId[];
}
export interface Recipe { readonly recipeVersion: 1 | 2; readonly id: string; readonly version: string; readonly origin: string; readonly skills: readonly RecipeSkill[]; readonly tools: readonly RecipeTool[]; readonly capabilities?: readonly ObservabilityRecipeCapability[]; readonly prerequisites: readonly string[]; readonly checks: readonly string[]; readonly rollback: { readonly managedOnly: true } }
export type RecipeActionKind = "copy-skill" | "install-tool" | "configure-capability" | "blocked";
export interface RecipeAction { readonly kind: RecipeActionKind; readonly id: string; readonly target: string; readonly detail: string }
export interface RecipePlan { readonly recipe: Recipe; readonly source: string; readonly actions: readonly RecipeAction[]; readonly blocked: boolean; readonly approvalToken: string }
