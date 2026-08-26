import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { agentTargets } from "./catalog.js";
import type { AgentId, AgentManifest, AppliedState, Change } from "./contracts.js";
import { loadManifest } from "./manifest.js";

const SKILL_ID = "afd-workbench-principles";
const PREVIOUS_SKILL_HASHES = new Set(["e49213e3b1a4a0d0326b68bfa62edb41de0f572dc5bf5f1a854c044d67901c1b", "50a852b7a547842feb9f457730b272f8a7563e2a0adc1e62fd7888a31b3e7610"]);
const SKILL = `---
name: afd-workbench-principles
description: Safe workbench principles for runtimes, dependencies, tools, and third-party scripts.
metadata:
  managed-by: afd-agent-manager
  revision: 3
---

# Workbench principles

- Use mise-managed runtimes and project-isolated dependencies.
- Prefer uv for Python and pnpm for Node.js projects; respect lockfiles.
- Do not install globally, elevate privileges, alter profiles, or create services without explicit review.
- Stop and review scripts that write outside the project or request credentials.
- Never expose tokens, keys, sessions, or authentication files.

## Common tools

- When appropriate, prefer \`rg\` for ignore-aware text search and \`fd\` for file discovery.
- Prefer \`jq\` for JSON, \`yq\` for YAML/TOML, \`bat\` for source reading, and \`delta\` for diffs.
- Use native alternatives when the project or operating system requires different compatibility.
- Tool availability never authorizes mutating commands; preserve scope and review effects first.
- RTK, fzf, zoxide, eza, and sd are not part of this baseline.
`;
const PROFILE = `# AI Foundry Desk — base profile

Work conservatively: preserve existing changes, use project-scoped dependencies, respect lockfiles,
and request review before elevating privileges, altering profiles, creating services, or writing
outside the repository. Never read, print, or store credentials without an explicit request.
`;
const MANIFEST: AgentManifest = { manifestVersion: 1, profile: { source: "profile/base.md" }, catalog: [{ id: SKILL_ID, kind: "skill", source: `catalog/skills/${SKILL_ID}` }], targets: agentTargets.map((target) => ({ agent: target.id, entries: [SKILL_ID], profile: target.profile === "supported" })) };
const START = "<!-- >>> AI Foundry Desk profile >>>";
const END = "<!-- <<< AI Foundry Desk profile <<< -->";
const LEGACY_START = "<!-- >>> AI Workstation Layer 2 profile >>>";
const LEGACY_END = "<!-- <<< AI Workstation Layer 2 profile <<< -->";
export interface ManagerOptions { readonly root?: string; readonly dryRun?: boolean }
export interface ManagerResult { readonly root: string; readonly changes: readonly Change[] }

async function exists(target: string): Promise<boolean> { try { await access(target, constants.F_OK); return true; } catch { return false; } }
async function text(target: string): Promise<string | undefined> { try { return await readFile(target, "utf8"); } catch { return undefined; } }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
async function hashManagedPath(target: string): Promise<string | undefined> { try { const info = await stat(target); const file = info.isDirectory() ? path.join(target, "SKILL.md") : target; return hash(await readFile(file, "utf8")); } catch { return undefined; } }
function managedBlock(profile: string): string { return `${START}\n${profile.trim()}\n${END}`; }
function isPreviousManagedSkill(value: string): boolean { return PREVIOUS_SKILL_HASHES.has(hash(value)); }
function hasToolboxPolicy(value: string): boolean { return ["`rg`", "`fd`", "`jq`", "`yq`", "`bat`", "`delta`", "RTK, fzf, zoxide, eza, and sd"].every((marker) => value.includes(marker)); }
async function backupFile(root: string, agent: AgentId | "canonical", target: string, content: string): Promise<void> {
  const local = process.env.LOCALAPPDATA ?? path.join(homedir(), ".local", "share");
  const backupRoot = path.join(local, "AI Foundry Desk", "backups");
  const targetRoot = path.join(backupRoot, `agent-manager-${agent}`);
  const backup = path.join(targetRoot, new Date().toISOString().replace(/[:.]/g, "-"), path.basename(target));
  await mkdir(path.dirname(backup), { recursive: true }); await writeFile(backup, content, "utf8");
  const snapshots = await Promise.all((await readdir(targetRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(async (entry) => ({ name: entry.name, time: (await stat(path.join(targetRoot, entry.name))).mtimeMs })));
  snapshots.sort((left, right) => right.time - left.time);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const snapshot of snapshots.slice(3)) if (snapshot.time < cutoff) await rm(path.join(targetRoot, snapshot.name), { recursive: true });
}

async function hermesSkills(home: string): Promise<string | undefined> {
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const direct = path.join(local, "hermes", "hermes-agent", "skills"); if (await exists(direct)) return direct;
  const packages = path.join(local, "Packages");
  try { for (const name of await readdir(packages)) { if (name.startsWith("OpenAI.Codex_")) { const candidate = path.join(packages, name, "LocalCache", "Local", "hermes", "hermes-agent", "skills"); if (await exists(candidate)) return candidate; } } } catch { /* not present */ }
  return undefined;
}
async function targetPaths(home: string): Promise<Record<AgentId, { skill?: string | undefined; profile?: string | undefined }>> {
  const shared = path.join(home, ".agents", "skills");
  return { "claude-code": { skill: path.join(home, ".claude", "skills"), profile: path.join(home, ".claude", "CLAUDE.md") }, codex: { skill: shared, profile: path.join(home, ".codex", "AGENTS.md") }, antigravity: {}, pi: { skill: shared, profile: path.join(home, ".pi", "agent", "AGENTS.md") }, hermes: { skill: await hermesSkills(home) }, grok: { skill: shared } };
}

async function ensureCanonical(root: string, dryRun: boolean, changes: Change[]): Promise<void> {
  const files: Array<[string, string]> = [[path.join(root, "catalog", "skills", SKILL_ID, "SKILL.md"), SKILL], [path.join(root, "profile", "base.md"), PROFILE], [path.join(root, "manifest.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`]];
  for (const [target, content] of files) { const current = await text(target); if (current === undefined) { changes.push({ agent: "canonical", kind: "create", path: target, detail: "canonical base is missing" }); if (!dryRun) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, "utf8"); } } else if (current === content) { /* reconciled */ } else if (target.endsWith(`${SKILL_ID}\\SKILL.md`) && isPreviousManagedSkill(current)) { changes.push({ agent: "canonical", kind: "update", path: target, detail: "managed canonical revision" }); if (!dryRun) { await backupFile(root, "canonical", target, current); await writeFile(target, content, "utf8"); } } else if (target.endsWith(`${SKILL_ID}\\SKILL.md`)) changes.push({ agent: "canonical", kind: "drift", path: target, detail: "canonical skill is divergent or missing the toolbox policy" }); else if (target.endsWith("manifest.json")) changes.push({ agent: "canonical", kind: "drift", path: target, detail: "existing manifest preserved" }); }
}
async function copySkill(source: string, targetRoot: string, agent: AgentId, root: string, dryRun: boolean, changes: Change[]): Promise<void> {
  const target = path.join(targetRoot, SKILL_ID); const storedCanonical = (await text(path.join(source, "SKILL.md"))) ?? SKILL; const canonical = isPreviousManagedSkill(storedCanonical) ? SKILL : storedCanonical; const current = await text(path.join(target, "SKILL.md"));
  if (!hasToolboxPolicy(canonical)) { changes.push({ agent, kind: "drift", path: target, detail: "Canonical toolbox policy is incomplete; destination preserved." }); return; }
  if (current === undefined) { changes.push({ agent, kind: "create", path: target, detail: "approved skill" }); if (!dryRun) { await mkdir(targetRoot, { recursive: true }); await cp(source, target, { recursive: true, errorOnExist: true }); } }
  else if (current === canonical) changes.push({ agent, kind: "in-sync", path: target, detail: "approved skill" });
  else if (isPreviousManagedSkill(current)) { changes.push({ agent, kind: "update", path: target, detail: "approved skill revision" }); if (!dryRun) { const targetFile = path.join(target, "SKILL.md"); await backupFile(root, agent, targetFile, current); await writeFile(targetFile, canonical, "utf8"); } }
  else changes.push({ agent, kind: "drift", path: target, detail: "Divergent content preserved; use review/adopt." });
  try { for (const entry of await readdir(targetRoot, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== SKILL_ID) changes.push({ agent, kind: "importable", path: path.join(targetRoot, entry.name), detail: "unmanaged direct skill" }); } catch { /* absent */ }
}
async function mergeProfile(sourceFile: string, target: string, agent: AgentId, root: string, dryRun: boolean, changes: Change[]): Promise<void> {
  const base = (await text(sourceFile)) ?? PROFILE; const block = managedBlock(base); const current = (await text(target)) ?? "";
  if (current.includes(LEGACY_START)) { const start = current.indexOf(LEGACY_START); const end = current.indexOf(LEGACY_END, start); changes.push({ agent, kind: "update", path: target, detail: "replace legacy managed profile block" }); if (!dryRun && end >= 0) { await backupFile(root, agent, target, current); await writeFile(target, `${current.slice(0, start)}${block}${current.slice(end + LEGACY_END.length)}`, "utf8"); } return; }
  if (current.includes(START)) { const start = current.indexOf(START); const end = current.indexOf(END, start); const existing = end >= 0 ? current.slice(start, end + END.length) : ""; changes.push({ agent, kind: existing === block ? "in-sync" : "drift", path: target, detail: existing === block ? "base profile" : "divergent managed block preserved" }); return; }
  changes.push({ agent, kind: "create", path: target, detail: "add base profile block" });
  if (!dryRun) { await mkdir(path.dirname(target), { recursive: true }); if (current) await backupFile(root, agent, target, current); await writeFile(target, `${current.trimEnd()}${current ? "\n\n" : ""}${block}\n`, "utf8"); }
}
export async function inspect(options: ManagerOptions = {}): Promise<ManagerResult> {
  const home = homedir(); const root = options.root ?? path.join(home, ".afd"); const dryRun = options.dryRun ?? true; const changes: Change[] = [];
  await ensureCanonical(root, dryRun, changes); const manifestPath = path.join(root, "manifest.json"); const manifest = await exists(manifestPath) ? await loadManifest(manifestPath) : MANIFEST; const map = await targetPaths(home); const skillSource = path.join(root, manifest.catalog[0]?.source ?? ""); const profileSource = path.join(root, manifest.profile.source);
  for (const target of agentTargets) { const selection = manifest.targets.find((item) => item.agent === target.id); const destination = map[target.id]; if (target.skills !== "supported" || !destination.skill) changes.push({ agent: target.id, kind: "unsupported", path: "-", detail: target.reason ?? "skills unavailable" }); else if (selection?.entries.includes(SKILL_ID)) await copySkill(skillSource, destination.skill, target.id, root, dryRun, changes); if (selection?.profile && target.profile === "supported" && destination.profile) await mergeProfile(profileSource, destination.profile, target.id, root, dryRun, changes); else if (target.profile !== "supported") changes.push({ agent: target.id, kind: "unsupported", path: "-", detail: `profile: ${target.reason ?? "unsupported"}` }); }
  return { root, changes };
}
export async function sync(options: ManagerOptions = {}): Promise<ManagerResult> { const result = await inspect({ ...options, dryRun: options.dryRun ?? false }); if (!(options.dryRun ?? false) && result.changes.some((item) => item.kind === "create" || item.kind === "update")) { const files: Record<string, string> = {}; for (const change of result.changes.filter((item) => item.kind === "create" || item.kind === "update" || item.kind === "in-sync")) { const contentHash = await hashManagedPath(change.path); if (contentHash) files[change.path] = contentHash; } const state: AppliedState = { stateVersion: 1, appliedAt: new Date().toISOString(), files }; const statePath = path.join(result.root, "state", "applied.json"); await mkdir(path.dirname(statePath), { recursive: true }); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8"); } return result; }
export async function adopt(agent: AgentId, name: string, options: ManagerOptions = {}): Promise<string> { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("Invalid skill name."); const home = homedir(); const root = options.root ?? path.join(home, ".afd"); const map = await targetPaths(home); const sourceRoot = map[agent].skill; if (!sourceRoot) throw new Error(`Adapter ${agent} does not offer safe import/adopt.`); const source = path.join(sourceRoot, name); if (!(await exists(path.join(source, "SKILL.md")))) throw new Error(`Skill not found: ${source}`); const pending = path.join(root, "catalog", "pending", agent, name); if (await exists(pending)) throw new Error(`Pending entry already exists: ${pending}`); if (!(options.dryRun ?? false)) { await mkdir(path.dirname(pending), { recursive: true }); await cp(source, pending, { recursive: true, errorOnExist: true }); } return pending; }
