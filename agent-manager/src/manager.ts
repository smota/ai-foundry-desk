import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { agentTargets } from "./catalog.js";
import type { AgentId, AgentManifest, AppliedState, Change } from "./contracts.js";
import { loadManifest } from "./manifest.js";

const SKILL_ID = "ai-workstation-principles";
const PREVIOUS_SKILL_HASHES = new Set(["e49213e3b1a4a0d0326b68bfa62edb41de0f572dc5bf5f1a854c044d67901c1b"]);
const SKILL = `---
name: ai-workstation-principles
description: Princípios seguros da workstation para runtimes, dependências e scripts de terceiros.
metadata:
  managed-by: ai-workstation-layer-2
  revision: 2
---

# Princípios da workstation

- Use runtimes geridos pelo mise e dependências isoladas por projeto.
- Prefira uv para Python e pnpm para projetos Node; respeite lockfiles.
- Não instale globalmente, eleve privilégios, altere perfis ou crie serviços sem revisão explícita.
- Pare e revise scripts que escrevem fora do projeto ou solicitam credenciais.
- Nunca exponha tokens, chaves, sessões ou arquivos de autenticação.

## Ferramentas comuns

- Quando apropriado, prefira \`rg\` para busca textual respeitando arquivos de ignore e \`fd\` para localizar arquivos.
- Prefira \`jq\` para JSON, \`yq\` para YAML/TOML, \`bat\` para leitura de código-fonte e \`delta\` para diffs.
- Use alternativas nativas quando o projeto ou o sistema exigir compatibilidade diferente.
- A disponibilidade de uma ferramenta não autoriza comandos mutantes; preserve o escopo e revise efeitos antes de alterar estado.
- RTK, fzf, zoxide, eza e sd não fazem parte desta base.
`;
const PROFILE = `# AI Workstation — perfil-base

Trabalhe de forma conservadora: preserve mudanças existentes, use dependências por projeto, respeite
lockfiles e peça revisão antes de elevar privilégios, alterar perfis, criar serviços ou escrever fora
do repositório. Não leia, imprima ou grave credenciais sem solicitação explícita.
`;
const MANIFEST: AgentManifest = { manifestVersion: 1, profile: { source: "profile/base.md" }, catalog: [{ id: SKILL_ID, kind: "skill", source: `catalog/skills/${SKILL_ID}` }], targets: agentTargets.map((target) => ({ agent: target.id, entries: [SKILL_ID], profile: target.profile === "supported" })) };
const START = "<!-- >>> AI Workstation Layer 2 profile >>>";
const END = "<!-- <<< AI Workstation Layer 2 profile <<< -->";
export interface ManagerOptions { readonly root?: string; readonly dryRun?: boolean }
export interface ManagerResult { readonly root: string; readonly changes: readonly Change[] }

async function exists(target: string): Promise<boolean> { try { await access(target, constants.F_OK); return true; } catch { return false; } }
async function text(target: string): Promise<string | undefined> { try { return await readFile(target, "utf8"); } catch { return undefined; } }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
async function hashManagedPath(target: string): Promise<string | undefined> { try { const info = await stat(target); const file = info.isDirectory() ? path.join(target, "SKILL.md") : target; return hash(await readFile(file, "utf8")); } catch { return undefined; } }
function managedBlock(profile: string): string { return `${START}\n${profile.trim()}\n${END}`; }
function isPreviousManagedSkill(value: string): boolean { return PREVIOUS_SKILL_HASHES.has(hash(value)); }
function hasToolboxPolicy(value: string): boolean { return ["`rg`", "`fd`", "`jq`", "`yq`", "`bat`", "`delta`", "RTK, fzf, zoxide, eza e sd"].every((marker) => value.includes(marker)); }
async function backupFile(root: string, agent: AgentId | "canonical", target: string, content: string): Promise<void> {
  const local = process.env.LOCALAPPDATA ?? path.join(homedir(), ".local", "share");
  const backupRoot = path.join(local, "ai-workstation", "backups");
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
  try { for (const name of await readdir(packages)) { if (name.startsWith("OpenAI.Codex_")) { const candidate = path.join(packages, name, "LocalCache", "Local", "hermes", "hermes-agent", "skills"); if (await exists(candidate)) return candidate; } } } catch { /* ausente */ }
  return undefined;
}
async function targetPaths(home: string): Promise<Record<AgentId, { skill?: string | undefined; profile?: string | undefined }>> {
  const shared = path.join(home, ".agents", "skills");
  return { "claude-code": { skill: path.join(home, ".claude", "skills"), profile: path.join(home, ".claude", "CLAUDE.md") }, codex: { skill: shared, profile: path.join(home, ".codex", "AGENTS.md") }, antigravity: {}, pi: { skill: shared, profile: path.join(home, ".pi", "agent", "AGENTS.md") }, hermes: { skill: await hermesSkills(home) }, grok: { skill: shared } };
}

async function ensureCanonical(root: string, dryRun: boolean, changes: Change[]): Promise<void> {
  const files: Array<[string, string]> = [[path.join(root, "catalog", "skills", SKILL_ID, "SKILL.md"), SKILL], [path.join(root, "profile", "base.md"), PROFILE], [path.join(root, "manifest.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`]];
  for (const [target, content] of files) { const current = await text(target); if (current === undefined) { changes.push({ agent: "canonical", kind: "create", path: target, detail: "base canônica ausente" }); if (!dryRun) { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, "utf8"); } } else if (current === content) { /* reconciliado */ } else if (target.endsWith(`${SKILL_ID}\\SKILL.md`) && isPreviousManagedSkill(current)) { changes.push({ agent: "canonical", kind: "update", path: target, detail: "revisão canônica gerenciada" }); if (!dryRun) { await backupFile(root, "canonical", target, current); await writeFile(target, content, "utf8"); } } else if (target.endsWith(`${SKILL_ID}\\SKILL.md`)) changes.push({ agent: "canonical", kind: "drift", path: target, detail: "skill canônica divergente ou sem política completa da toolbox" }); else if (target.endsWith("manifest.json")) changes.push({ agent: "canonical", kind: "drift", path: target, detail: "manifesto existente preservado" }); }
}
async function copySkill(source: string, targetRoot: string, agent: AgentId, root: string, dryRun: boolean, changes: Change[]): Promise<void> {
  const target = path.join(targetRoot, SKILL_ID); const storedCanonical = (await text(path.join(source, "SKILL.md"))) ?? SKILL; const canonical = isPreviousManagedSkill(storedCanonical) ? SKILL : storedCanonical; const current = await text(path.join(target, "SKILL.md"));
  if (!hasToolboxPolicy(canonical)) { changes.push({ agent, kind: "drift", path: target, detail: "política canônica da toolbox incompleta; destino preservado" }); return; }
  if (current === undefined) { changes.push({ agent, kind: "create", path: target, detail: "skill aprovada" }); if (!dryRun) { await mkdir(targetRoot, { recursive: true }); await cp(source, target, { recursive: true, errorOnExist: true }); } }
  else if (current === canonical) changes.push({ agent, kind: "in-sync", path: target, detail: "skill aprovada" });
  else if (isPreviousManagedSkill(current)) { changes.push({ agent, kind: "update", path: target, detail: "revisão aprovada da skill" }); if (!dryRun) { const targetFile = path.join(target, "SKILL.md"); await backupFile(root, agent, targetFile, current); await writeFile(targetFile, canonical, "utf8"); } }
  else changes.push({ agent, kind: "drift", path: target, detail: "conteúdo divergente preservado; use review/adopt" });
  try { for (const entry of await readdir(targetRoot, { withFileTypes: true })) if (entry.isDirectory() && entry.name !== SKILL_ID) changes.push({ agent, kind: "importable", path: path.join(targetRoot, entry.name), detail: "skill direta não gerenciada" }); } catch { /* ausente */ }
}
async function mergeProfile(sourceFile: string, target: string, agent: AgentId, root: string, dryRun: boolean, changes: Change[]): Promise<void> {
  const base = (await text(sourceFile)) ?? PROFILE; const block = managedBlock(base); const current = (await text(target)) ?? "";
  if (current.includes(START)) { const start = current.indexOf(START); const end = current.indexOf(END, start); const existing = end >= 0 ? current.slice(start, end + END.length) : ""; changes.push({ agent, kind: existing === block ? "in-sync" : "drift", path: target, detail: existing === block ? "perfil-base" : "bloco divergente preservado" }); return; }
  changes.push({ agent, kind: "create", path: target, detail: "adicionar bloco de perfil-base" });
  if (!dryRun) { await mkdir(path.dirname(target), { recursive: true }); if (current) await backupFile(root, agent, target, current); await writeFile(target, `${current.trimEnd()}${current ? "\n\n" : ""}${block}\n`, "utf8"); }
}
export async function inspect(options: ManagerOptions = {}): Promise<ManagerResult> {
  const home = homedir(); const root = options.root ?? path.join(home, ".ai-workstation"); const dryRun = options.dryRun ?? true; const changes: Change[] = [];
  await ensureCanonical(root, dryRun, changes); const manifestPath = path.join(root, "manifest.json"); const manifest = await exists(manifestPath) ? await loadManifest(manifestPath) : MANIFEST; const map = await targetPaths(home); const skillSource = path.join(root, manifest.catalog[0]?.source ?? ""); const profileSource = path.join(root, manifest.profile.source);
  for (const target of agentTargets) { const selection = manifest.targets.find((item) => item.agent === target.id); const destination = map[target.id]; if (target.skills !== "supported" || !destination.skill) changes.push({ agent: target.id, kind: "unsupported", path: "-", detail: target.reason ?? "skills indisponíveis" }); else if (selection?.entries.includes(SKILL_ID)) await copySkill(skillSource, destination.skill, target.id, root, dryRun, changes); if (selection?.profile && target.profile === "supported" && destination.profile) await mergeProfile(profileSource, destination.profile, target.id, root, dryRun, changes); else if (target.profile !== "supported") changes.push({ agent: target.id, kind: "unsupported", path: "-", detail: `perfil: ${target.reason ?? "não suportado"}` }); }
  return { root, changes };
}
export async function sync(options: ManagerOptions = {}): Promise<ManagerResult> { const result = await inspect({ ...options, dryRun: options.dryRun ?? false }); if (!(options.dryRun ?? false) && result.changes.some((item) => item.kind === "create" || item.kind === "update")) { const files: Record<string, string> = {}; for (const change of result.changes.filter((item) => item.kind === "create" || item.kind === "update" || item.kind === "in-sync")) { const contentHash = await hashManagedPath(change.path); if (contentHash) files[change.path] = contentHash; } const state: AppliedState = { stateVersion: 1, appliedAt: new Date().toISOString(), files }; const statePath = path.join(result.root, "state", "applied.json"); await mkdir(path.dirname(statePath), { recursive: true }); await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8"); } return result; }
export async function adopt(agent: AgentId, name: string, options: ManagerOptions = {}): Promise<string> { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error("Nome de skill inválido."); const home = homedir(); const root = options.root ?? path.join(home, ".ai-workstation"); const map = await targetPaths(home); const sourceRoot = map[agent].skill; if (!sourceRoot) throw new Error(`Adapter ${agent} não oferece import/adopt seguro.`); const source = path.join(sourceRoot, name); if (!(await exists(path.join(source, "SKILL.md")))) throw new Error(`Skill não encontrada: ${source}`); const pending = path.join(root, "catalog", "pending", agent, name); if (await exists(pending)) throw new Error(`Pending já existe: ${pending}`); if (!(options.dryRun ?? false)) { await mkdir(path.dirname(pending), { recursive: true }); await cp(source, pending, { recursive: true, errorOnExist: true }); } return pending; }
