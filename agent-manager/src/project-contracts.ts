import { createHash } from "node:crypto";
import { harnessTargets } from "./harness-registry.js";
import type { HarnessAgentId } from "./harness-contracts.js";

export const projectDigest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const bytesDigest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export interface ProjectBrief {
  schemaVersion: 1;
  project: { name: string; purpose: string };
  desiredHarnesses: HarnessAgentId[];
  foundation: { recipe: { id: "policy-only" | "rust-workspace"; version: "1"; digest?: string }; toolchain?: { version: string; edition: "2021" | "2024" }; components?: string[] };
  policy: { canonical: "AGENTS.md"; engineering: "standard" | "ai-coded-human-governed"; architectureDecisions: "adr-v1"; skills: "none" };
  licensing?: { spdx: "Apache-2.0"; rightsHolder: string };
  files?: Record<string, string>;
  policyClosure?: string[];
}
export interface ProjectFile { path: string; content: string; sha256: string }
export interface ProjectSnapshot { path: string; kind: "missing" | "directory" | "file"; digest: string | null }
export interface ProjectPlan {
  schemaVersion: 1; kind: "afd-project-plan"; project: string; brief: ProjectBrief;
  recipeDigest: string; files: ProjectFile[]; baseline: ProjectSnapshot[];
  blockers: string[]; scope: "foundation"; approvalToken: string;
}
export interface ProjectReceipt {
  schemaVersion: 1; kind: "afd-project-receipt"; project: string; approvalToken: string;
  state: "applying" | "applied" | "rolled-back"; plan: ProjectPlan;
  createdFiles: string[]; createdDirectories: string[]; receiptToken: string;
}
export function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw new Error(`${label} contains unknown fields.`);
  return record;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 32_000 || [...value].some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) throw new Error(`Invalid ${label}.`);
  return value;
}
export function projectAgents(value: unknown): HarnessAgentId[] {
  if (!Array.isArray(value) || !value.length || value.some(item => !harnessTargets.some(target => target.id === item)) || new Set(value).size !== value.length) throw new Error("desiredHarnesses requires unique known harness IDs.");
  return [...value].sort() as HarnessAgentId[];
}
export function projectRelative(value: string): string {
  if (!value || value.includes("\\") || value.startsWith("/") || value.length > 240) throw new Error(`Unsafe project path: ${value}`);
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[<>:"|?*]/.test(part) || [...part].some(c => c.charCodeAt(0) < 32) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error(`Unsafe project path: ${value}`);
  if (parts.some(part => /^(\.git|\.env(?:\..*)?|\.ssh|\.aws|\.azure|credentials?|auth\.json|node_modules|target|\.agent-runs)$/i.test(part))) throw new Error(`Protected project path: ${value}`);
  return value;
}
export function parseProjectBrief(value: unknown): ProjectBrief {
  const row = object(value, ["schemaVersion", "project", "desiredHarnesses", "foundation", "policy", "licensing", "files", "policyClosure"], "Brief");
  if (row.schemaVersion !== 1) throw new Error("Unsupported brief schemaVersion.");
  const p = object(row.project, ["name", "purpose"], "project");
  const name = text(p.name, "project name");
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new Error("Project name must be lowercase kebab-case.");
  const f = object(row.foundation, ["recipe", "toolchain", "components"], "foundation");
  const recipe = object(f.recipe, ["id", "version", "digest"], "recipe");
  if (!["policy-only", "rust-workspace"].includes(String(recipe.id)) || recipe.version !== "1") throw new Error("Unknown recipe/version.");
  if (recipe.digest !== undefined && (typeof recipe.digest !== "string" || !/^[a-f0-9]{64}$/.test(recipe.digest))) throw new Error("Invalid recipe digest.");
  const policy = object(row.policy, ["canonical", "engineering", "architectureDecisions", "skills"], "policy");
  if (policy.canonical !== "AGENTS.md" || !["standard", "ai-coded-human-governed"].includes(String(policy.engineering)) || policy.architectureDecisions !== "adr-v1" || policy.skills !== "none") throw new Error("Unsupported policy profile.");
  const result: ProjectBrief = { schemaVersion: 1, project: { name, purpose: text(p.purpose, "purpose") }, desiredHarnesses: projectAgents(row.desiredHarnesses), foundation: { recipe: { id: recipe.id as "policy-only" | "rust-workspace", version: "1", ...(recipe.digest ? { digest: String(recipe.digest) } : {}) } }, policy: policy as unknown as ProjectBrief["policy"] };
  if (recipe.id === "rust-workspace") {
    const t = object(f.toolchain, ["version", "edition"], "toolchain");
    if (typeof t.version !== "string" || !/^1\.\d+\.\d+$/.test(t.version) || !["2021", "2024"].includes(String(t.edition))) throw new Error("Rust requires an exact stable toolchain and edition.");
    if (!Array.isArray(f.components) || !f.components.length || f.components.length > 20 || f.components.some(c => typeof c !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(c)) || new Set(f.components).size !== f.components.length) throw new Error("Rust components require unique snake_case identifiers.");
    result.foundation.toolchain = t as unknown as NonNullable<ProjectBrief["foundation"]["toolchain"]>;
    result.foundation.components = f.components as string[];
  } else if (f.toolchain !== undefined || f.components !== undefined) throw new Error("policy-only does not take Rust fields.");
  if (row.licensing !== undefined) {
    const license = object(row.licensing, ["spdx", "rightsHolder"], "licensing");
    if (license.spdx !== "Apache-2.0") throw new Error("Only explicit Apache-2.0 licensing is supported.");
    result.licensing = { spdx: "Apache-2.0", rightsHolder: text(license.rightsHolder, "rights holder") };
  }
  if (row.files !== undefined) {
    const files = object(row.files, Object.keys(row.files as object), "files");
    result.files = Object.fromEntries(Object.entries(files).map(([key, value]) => [projectRelative(key), text(value, "reviewed file content")]));
  }
  if (row.policyClosure !== undefined) {
    if (!Array.isArray(row.policyClosure) || row.policyClosure.some(p => typeof p !== "string") || new Set(row.policyClosure).size !== row.policyClosure.length) throw new Error("Invalid policyClosure.");
    result.policyClosure = row.policyClosure.map(projectRelative);
  }
  return result;
}
