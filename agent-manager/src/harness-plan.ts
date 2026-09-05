import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { auditHarness } from "./harness-audit.js";
import type {
  HarnessAgentId,
  HarnessAuditReport,
  HarnessPlan,
  HarnessPlanAction,
  HarnessStageResult,
  HarnessTargetContract,
} from "./harness-contracts.js";
import { harnessTarget, harnessTargets } from "./harness-registry.js";
import { safeProjectFile } from "./project-files.js";

const execFileAsync = promisify(execFile);
const START = "<!-- >>> AFD project harness adapter";
const END = "<!-- <<< AFD project harness adapter <<< -->";

function slash(value: string): string { return value.replaceAll("\\", "/"); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function exists(target: string): Promise<boolean> { try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function regularFile(target: string): Promise<boolean> { try { const value = await lstat(target); return value.isFile() && !value.isSymbolicLink(); } catch { return false; } }
async function currentText(project: string, relative: string): Promise<string | null> {
  const target = path.resolve(project, relative); if (!contained(project, target)) throw new Error(`Harness path escapes project: ${relative}`);
  if (!(await exists(target))) return null; if (!(await regularFile(target))) throw new Error(`Harness path is not a regular file: ${relative}`);
  return readFile(target, "utf8");
}
export async function harnessGitState(project: string): Promise<{ readonly revision: string | null; readonly workspaceFingerprint: string | null }> {
  const git = (args: string[]) => execFileAsync("git", ["-c", `safe.directory=${slash(project)}`, "-C", project, ...args], { encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
  let repository = true;
  try { await git(["rev-parse", "--show-toplevel"]); }
  catch (error) {
    if (/not a git repository/i.test(String((error as { stderr?: string }).stderr)) && !(await exists(path.join(project, ".git")))) repository = false;
    else throw new Error("Cannot inspect harness Git state; repair Git access before planning.", { cause: error });
  }
  let revision: string | null = null;
  let status = "";
  let files: string[];
  if (repository) {
    try { revision = (await git(["rev-parse", "--verify", "HEAD"])).stdout.trim(); }
    catch {
      // A symbolic branch with no ref is an unborn repository, not a Git failure.
      const branch = (await git(["symbolic-ref", "-q", "HEAD"])).stdout.trim();
      try { await git(["show-ref", "--verify", "--quiet", branch]); throw new Error("HEAD exists but could not be resolved."); }
      catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
    }
    status = (await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout;
    files = (await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
  } else {
    const walk = async (directory: string): Promise<string[]> => {
      const entries = await readdir(path.join(project, directory), { withFileTypes: true });
      const rows: string[] = [];
      for (const entry of entries) {
        const relative = path.join(directory, entry.name);
        if (entry.isDirectory()) rows.push(...await walk(relative)); else rows.push(relative);
      }
      return rows;
    };
    files = await walk("");
  }
  const contents: string[] = [];
  for (const relative of [...new Set(files)].sort()) {
    const absolute = path.resolve(project, relative);
    if (!contained(project, absolute)) throw new Error("Git-visible path escapes harness project.");
    if (!(await exists(absolute))) { contents.push(`${slash(relative)}:deleted`); continue; }
    if (!(await regularFile(absolute))) throw new Error(`Cannot fingerprint non-regular harness file: ${relative}`);
    if (!contained(project, await realpath(absolute))) throw new Error(`Harness file resolves outside project: ${relative}`);
    contents.push(`${slash(relative)}:${createHash("sha256").update(await readFile(absolute)).digest("hex")}`);
  }
  return { revision, workspaceFingerprint: hash(JSON.stringify({ revision, status, contents })) };
}
function managed(value: string): boolean { return value.includes(START) && value.includes(END); }
function pointerContent(target: HarnessTargetContract, canonicalPath: string, canonicalSha256: string): string {
  const label = target.displayName.replaceAll(" `", " ");
  return `${START} schema=1 agent=${target.id} source=${canonicalPath} sha256=${canonicalSha256} >>>\n# ${label} project instructions\n\nRead and follow \`${canonicalPath}\` as the canonical project policy. This file contains no independent project rules.\n${END}\n`;
}
function primaryPath(target: HarnessTargetContract): string | null {
  if (target.id === "codex" || !target.instructionPaths.length) return null;
  return target.instructionPaths[0] ?? null;
}
function action(kind: HarnessPlanAction["kind"], group: HarnessPlanAction["group"], agent: HarnessAgentId | null, pathValue: string, reason: string, before: string | null, content: string | null): HarnessPlanAction {
  return { kind, group, agent, path: slash(pathValue), reason, beforeSha256: before === null ? null : hash(before), afterSha256: content === null ? null : hash(content), content };
}
function normalizeSelection(value: readonly HarnessAgentId[] | "auto" | undefined, audit: HarnessAuditReport): readonly HarnessAgentId[] {
  const selected = value === undefined || value === "auto" ? audit.agents.filter((item) => item.detected && item.discovery !== "unsupported").map((item) => item.id) : [...value];
  const unique = [...new Set<HarnessAgentId>(value === undefined || value === "auto" ? ["codex", ...selected] : selected)];
  for (const id of unique) harnessTarget(id);
  return unique.sort();
}
function legacyCandidates(audit: HarnessAuditReport, selected: ReadonlySet<HarnessAgentId>): readonly { path: string; agent: HarnessAgentId | null; reason: string }[] {
  const candidates: { path: string; agent: HarnessAgentId | null; reason: string }[] = [];
  const byPath = new Map(audit.agents.flatMap((agent) => agent.instruction ? [[agent.instruction.path, agent] as const] : []));
  for (const item of audit.findings.filter((finding) => finding.code === "legacy.redundant-pointer" && finding.path)) candidates.push({ path: item.path!, agent: byPath.get(item.path!)?.id ?? null, reason: item.message });
  for (const agent of audit.agents) if (agent.instruction?.state === "pointer" && !selected.has(agent.id) && !candidates.some((item) => item.path === agent.instruction?.path)) candidates.push({ path: agent.instruction.path, agent: agent.id, reason: `${agent.displayName} is not selected and its adapter is only a canonical pointer.` });
  return candidates;
}
function planDigest(value: Omit<HarnessPlan, "approvalToken">): string { return hash(JSON.stringify(value)); }

export async function planHarness(projectInput: string, options: { readonly agents?: readonly HarnessAgentId[] | "auto"; readonly removeLegacy?: boolean } = {}): Promise<HarnessPlan> {
  const project = await realpath(path.resolve(projectInput)); const audit = await auditHarness(project);
  if (!audit.canonical) throw new Error("Cannot plan a harness without canonical project instructions.");
  const selectedAgents = normalizeSelection(options.agents, audit); const selected = new Set(selectedAgents); const actions: HarnessPlanAction[] = [];
  let policyFiles: { path: string; content: string; sha256: string }[] | undefined;
  const projectManifest = await safeProjectFile(project, ".afd/project.json");
  if (await exists(projectManifest)) {
    const manifest = JSON.parse(await readFile(projectManifest, "utf8")) as { policyClosure?: unknown };
    if (!Array.isArray(manifest.policyClosure) || !manifest.policyClosure.length || manifest.policyClosure.some(p => typeof p !== "string") || new Set(manifest.policyClosure).size !== manifest.policyClosure.length) throw new Error("Invalid required policy closure.");
    policyFiles = [];
    for (const relative of [...manifest.policyClosure as string[], ".afd/project.json"].sort()) {
      const target = await safeProjectFile(project, relative);
      const content = await readFile(target, "utf8");
      if (Buffer.byteLength(content) > 64000) throw new Error("Required policy file exceeds smoke-test limit.");
      policyFiles.push({ path: relative, content, sha256: hash(content) });
    }
  }
  const blockers = audit.findings.filter((item) => item.severity === "blocker").map((item) => `${item.code}: ${item.message}`);
  for (const id of selectedAgents) {
    const target = harnessTarget(id);
    if (target.discovery === "unsupported") { blockers.push(`${id}: no project discovery contract`); continue; }
    if (target.discovery === "generated-only") { blockers.push(`${id}: project discovery is unverified`); }
    const relative = primaryPath(target); if (!relative || relative === audit.canonical.path) continue;
    const before = await currentText(project, relative); const content = pointerContent(target, audit.canonical.path, audit.canonical.sha256);
    if (before === null) actions.push(action("create", "adapters", id, relative, `Create the minimal ${target.displayName} adapter.`, null, content));
    else if (before === content) { /* already desired */ }
    else if (managed(before)) actions.push(action("update-managed", "adapters", id, relative, `Refresh the AFD-managed ${target.displayName} adapter.`, before, content));
    else { actions.push(action("preserve", "adapters", id, relative, `Preserve divergent project-owned ${target.displayName} instructions for human reconciliation.`, before, before)); blockers.push(`${id}: ${relative} contains project-owned instructions that must be reconciled with ${audit.canonical.path} before apply`); }
  }
  if (options.removeLegacy) for (const candidate of legacyCandidates(audit, selected)) {
    const before = await currentText(project, candidate.path); if (before !== null && !actions.some((item) => item.path === candidate.path)) actions.push(action("remove-legacy", "legacy-cleanup", candidate.agent, candidate.path, candidate.reason, before, null));
  }
  actions.sort((left, right) => left.group.localeCompare(right.group) || left.path.localeCompare(right.path));
  const git = await harnessGitState(project); const base: Omit<HarnessPlan, "approvalToken"> = {
    schemaVersion: 1, project: slash(project), baseRevision: git.revision, workspaceFingerprint: git.workspaceFingerprint, canonicalPath: audit.canonical.path,
    canonicalSha256: audit.canonical.sha256, selectedAgents, removeLegacy: options.removeLegacy ?? false, actions,
    blocked: blockers.length > 0, blockers,
    ...(policyFiles ? { policyFiles } : {}),
  };
  return { ...base, approvalToken: planDigest(base) };
}

export async function assertHarnessPlanCurrent(plan: HarnessPlan): Promise<void> {
  for (const file of plan.policyFiles ?? []) {
    if (hash(await readFile(await safeProjectFile(plan.project, file.path), "utf8")) !== file.sha256) throw new Error("Harness plan is stale: supporting policy changed.");
  }
  const canonical = await currentText(plan.project, plan.canonicalPath); if (canonical === null || hash(canonical) !== plan.canonicalSha256) throw new Error("Harness plan is stale: canonical instructions changed.");
  const git = await harnessGitState(plan.project); if (plan.baseRevision !== git.revision) throw new Error("Harness plan is stale: repository revision changed.");
  if (plan.workspaceFingerprint !== git.workspaceFingerprint) throw new Error("Harness plan is stale: repository workspace changed.");
  for (const item of plan.actions) { const value = await currentText(plan.project, item.path); const currentHash = value === null ? null : hash(value); if (currentHash !== item.beforeSha256) throw new Error(`Harness plan is stale: ${item.path} changed.`); }
}
async function ensureStageOutput(output: string, plan: HarnessPlan): Promise<"created" | "unchanged"> {
  if (!(await exists(output))) { await mkdir(output, { recursive: true }); return "created"; }
  const info = await lstat(output); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Harness stage output must be a regular directory.");
  const manifest = path.join(output, "harness-stage.json");
  if (!(await exists(manifest))) { if ((await readdir(output)).length) throw new Error("Harness stage output must be empty or contain the same staged plan."); return "created"; }
  const parsed = JSON.parse(await readFile(manifest, "utf8")) as { approvalToken?: string };
  if (parsed.approvalToken !== plan.approvalToken) throw new Error("Harness stage output contains a different plan.");
  return "unchanged";
}

export async function stageHarness(plan: HarnessPlan, outputInput: string): Promise<HarnessStageResult> {
  await assertHarnessPlanCurrent(plan); const output = path.resolve(outputInput); const project = path.resolve(plan.project);
  if (contained(project, output)) throw new Error("Harness stage output must be outside the target project.");
  const status = await ensureStageOutput(output, plan); const rendered: string[] = []; const removals: string[] = [];
  for (const item of plan.actions) {
    if (item.kind === "preserve") continue;
    if (item.kind === "remove-legacy") { removals.push(item.path); continue; }
    if (item.content === null) throw new Error(`Harness render content missing: ${item.path}`);
    const target = path.join(output, "rendered", item.path); await mkdir(path.dirname(target), { recursive: true });
    if (status === "unchanged" && await exists(target) && hash(await readFile(target, "utf8")) === item.afterSha256) { rendered.push(item.path); continue; }
    if (status === "unchanged") throw new Error(`Staged artifact drift: ${item.path}`);
    await writeFile(target, item.content, "utf8"); rendered.push(item.path);
  }
  const result: HarnessStageResult = { schemaVersion: 1, project: plan.project, output: slash(output), approvalToken: plan.approvalToken, status, rendered, removals };
  const manifest = path.join(output, "harness-stage.json"); const body = `${JSON.stringify({ ...result, plan }, null, 2)}\n`;
  if (status === "created") await writeFile(manifest, body, "utf8");
  return result;
}

export function parseHarnessAgents(value: string | undefined): readonly HarnessAgentId[] | "auto" {
  if (!value || value === "auto") return "auto";
  const ids = value.split(",").map((item) => item.trim()).filter(Boolean) as HarnessAgentId[];
  if (!ids.length) throw new Error("--agents requires auto or a comma-separated target list.");
  for (const id of ids) if (!harnessTargets.some((target) => target.id === id)) throw new Error(`Unknown harness target: ${id}`);
  return ids;
}

export function renderHarnessPlan(plan: HarnessPlan): string {
  const groups = ["canonical", "adapters", "legacy-cleanup"] as const; const rows = ["AFD project harness plan", `Project: ${plan.project}`, `Base revision: ${plan.baseRevision ?? "not a Git repository"}`, `Workspace fingerprint: ${plan.workspaceFingerprint ?? "not available"}`, `Selected agents: ${plan.selectedAgents.join(", ")}`, `Approval token: ${plan.approvalToken}`, `Status: ${plan.blocked ? "BLOCKED" : "ready"}`];
  for (const group of groups) { const items = plan.actions.filter((item) => item.group === group); if (!items.length) continue; rows.push("", `${group}:`, ...items.map((item) => `- ${item.kind.toUpperCase()} ${item.path}: ${item.reason}`)); }
  if (plan.blockers.length) rows.push("", "Blockers:", ...plan.blockers.map((item) => `- ${item}`));
  return `${rows.join("\n")}\n`;
}
