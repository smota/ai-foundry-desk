export const MANIFEST_VERSION = 1 as const;
export type AgentId = "claude-code" | "codex" | "antigravity" | "pi" | "hermes" | "grok";
export type Capability = "supported" | "unsupported" | "deferred";
export interface AgentTarget { readonly id: AgentId; readonly displayName: string; readonly command: string; readonly skills: Capability; readonly profile: Capability; readonly reason?: string }
export interface CatalogEntry { readonly id: string; readonly kind: "skill"; readonly source: string }
export interface TargetSelection { readonly agent: AgentId; readonly entries: readonly string[]; readonly profile: boolean }
export interface AgentManifest { readonly manifestVersion: typeof MANIFEST_VERSION; readonly profile: { readonly source: string }; readonly catalog: readonly CatalogEntry[]; readonly targets: readonly TargetSelection[] }
export type ChangeKind = "create" | "update" | "in-sync" | "drift" | "importable" | "unsupported";
export interface Change { readonly agent: AgentId | "canonical"; readonly kind: ChangeKind; readonly path: string; readonly detail: string }
export interface AppliedState { readonly stateVersion: 1; readonly appliedAt: string; readonly files: Readonly<Record<string, string>> }
