import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseProjectBrief, projectDigest } from "./project-contracts.js";
import type { ProjectPlan } from "./project-contracts.js";
import { isWithin, projectExists, safeProjectFile, safeProjectRoot, snapshotProject } from "./project-files.js";
import { renderProject } from "./project-recipes.js";

export async function planProject(target: string, input: unknown): Promise<ProjectPlan> {
  const project = await safeProjectRoot(target); const brief = parseProjectBrief(input);
  const rendered = await renderProject(brief);
  const baseline = await snapshotProject(project, rendered.files.map(f => f.path));
  const blockers: string[] = [];
  const known = new Set(rendered.files.map(f => f.path));
  for (const file of rendered.files.filter(f => f.path.endsWith(".md"))) {
    for (const match of file.content.matchAll(/\]\(([^)]+)\)/g)) {
      const dest = match[1]!;
      if (/^[a-z]+:|^#/i.test(dest)) continue;
      const linked = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), dest.split("#")[0]!));
      if (!known.has(linked)) blockers.push(`Missing or unsafe local link in ${file.path}: ${dest}`);
    }
  }
  for (const file of rendered.files) {
    const previous = baseline.find(s => s.path === file.path);
    if (previous?.kind === "file" && previous.digest !== file.sha256) blockers.push(`Preserve project-owned file; reconcile explicitly: ${file.path}`);
  }
  const base = { schemaVersion: 1 as const, kind: "afd-project-plan" as const, project, brief, ...rendered, baseline, blockers, scope: "foundation" as const };
  return { ...base, approvalToken: projectDigest(base) };
}
export async function readProjectPlan(file: string): Promise<ProjectPlan> {
  const plan = JSON.parse(await readFile(file, "utf8")) as ProjectPlan;
  await validateProjectPlan(plan); return plan;
}
export async function validateProjectPlan(plan: ProjectPlan): Promise<void> {
  if (!plan || plan.schemaVersion !== 1 || plan.kind !== "afd-project-plan" || plan.scope !== "foundation") throw new Error("Invalid project plan.");
  const { approvalToken, ...base } = plan;
  if (projectDigest(base) !== approvalToken) throw new Error("Project plan was modified.");
  const brief = parseProjectBrief(plan.brief); const rendered = await renderProject(brief);
  if (projectDigest(rendered.files) !== projectDigest(plan.files) || rendered.recipeDigest !== plan.recipeDigest) throw new Error("Recipe/candidate drift; make a new plan.");
  if (await safeProjectRoot(plan.project) !== plan.project) throw new Error("Project path changed.");
}
export async function assertProjectCurrent(plan: ProjectPlan): Promise<void> {
  await validateProjectPlan(plan);
  const current = await snapshotProject(plan.project, plan.files.map(f => f.path));
  if (projectDigest(current) !== projectDigest(plan.baseline)) throw new Error("Project content or directory state drifted; re-plan.");
}
export async function stageProject(plan: ProjectPlan, output: string): Promise<{ stage: string; candidate: string; approvalToken: string }> {
  await assertProjectCurrent(plan);
  const stage = await safeProjectRoot(output);
  if (isWithin(plan.project, stage) || isWithin(stage, plan.project)) throw new Error("Stage must be outside and disjoint from the target.");
  if (await projectExists(stage)) {
    const existing = await readProjectPlan(path.join(stage, "plan.json"));
    if (existing.approvalToken !== plan.approvalToken) throw new Error("Stage belongs to another plan.");
    await verifyStage(stage);
  } else {
    await mkdir(stage, { recursive: true });
    await writeFile(path.join(stage, "plan.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    for (const file of plan.files) {
      const target = await safeProjectFile(path.join(stage, "candidate"), file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, { flag: "wx" });
    }
  }
  return { stage, candidate: path.join(stage, "candidate"), approvalToken: plan.approvalToken };
}
export async function verifyStage(stage: string): Promise<ProjectPlan> {
  await safeProjectRoot(stage);
  const plan = await readProjectPlan(path.join(stage, "plan.json"));
  for (const file of plan.files) {
    const target = await safeProjectFile(path.join(stage, "candidate"), file.path);
    if (await readFile(target, "utf8") !== file.content) throw new Error(`Staged content changed: ${file.path}`);
  }
  // Reject injected files as well as edited files. No ignored paths in a candidate.
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir: string, prefix = ""): Promise<string[]> => {
    const rows: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Staged symlink is unsafe.");
      const rel = prefix + entry.name;
      if (entry.isDirectory()) rows.push(...await walk(path.join(dir, entry.name), rel + "/")); else rows.push(rel);
    }
    return rows;
  };
  const actual = await walk(path.join(stage, "candidate"));
  if (projectDigest(actual.sort()) !== projectDigest(plan.files.map(f => f.path).sort())) throw new Error("Unexpected staged files.");
  return plan;
}
