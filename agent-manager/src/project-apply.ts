import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { bytesDigest, projectDigest, projectRelative } from "./project-contracts.js";
import type { ProjectPlan, ProjectReceipt } from "./project-contracts.js";
import { assertProjectCurrent, validateProjectPlan } from "./project-plan.js";
import { isWithin, projectExists, safeProjectFile, safeProjectRoot } from "./project-files.js";
import { NodePlatformAdapter } from "./platform.js";
import type { PlatformAdapter } from "./platform.js";

export interface ProjectApplyOptions { stateDirectory?: string; adapter?: PlatformAdapter; afterWrite?: (count: number) => void }
export function projectStateRoot(options: ProjectApplyOptions = {}): string {
  return path.resolve(options.stateDirectory ?? path.join((options.adapter ?? new NodePlatformAdapter()).stateRoot, "projects"));
}
function receiptName(root: string, token: string): string { return path.join(root, `${token}.json`); }
async function privateState(project: string, options: ProjectApplyOptions): Promise<string> {
  const root = await safeProjectRoot(projectStateRoot(options));
  if (isWithin(project, root) || isWithin(root, project)) throw new Error("Project state must be outside and disjoint from target.");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const adapter = options.adapter ?? new NodePlatformAdapter();
  if (adapter.id === "win32") {
    const identity = await adapter.run({ executable: "whoami.exe", args: ["/user", "/fo", "csv", "/nh"], timeoutMs: 5000 });
    const sid = identity.stdout.match(/S-1-(?:\d+-)+\d+/)?.[0];
    if (identity.status !== 0 || !sid) throw new Error("Cannot resolve private receipt identity.");
    const acl = await adapter.run({ executable: "icacls.exe", args: [root, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)(F)`], timeoutMs: 10000 });
    if (acl.status !== 0) throw new Error("Cannot protect project receipt directory.");
  }
  return root;
}
async function saveReceipt(file: string, receipt: ProjectReceipt): Promise<void> {
  const { receiptToken: _old, ...base } = receipt; void _old;
  receipt.receiptToken = projectDigest(base);
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try { await rename(temp, file); } finally { if (await projectExists(temp)) await unlink(temp); }
}
export async function loadProjectReceipt(file: string, options: ProjectApplyOptions = {}): Promise<ProjectReceipt> {
  const absolute = path.resolve(file); const state = await safeProjectRoot(projectStateRoot(options));
  if (path.dirname(absolute) !== state) throw new Error("Receipt is outside the configured private project state.");
  await safeProjectFile(state, path.basename(absolute));
  const receipt = JSON.parse(await readFile(absolute, "utf8")) as ProjectReceipt;
  if (receipt.kind !== "afd-project-receipt" || receipt.schemaVersion !== 1 || !["applying", "applied", "rolled-back"].includes(receipt.state)) throw new Error("Invalid project receipt.");
  const { receiptToken, ...base } = receipt;
  if (receiptToken !== projectDigest(base)) throw new Error("Receipt integrity failure.");
  if (receipt.project !== receipt.plan.project || receipt.approvalToken !== receipt.plan.approvalToken || path.basename(file) !== `${receipt.approvalToken}.json`) throw new Error("Receipt identity mismatch.");
  const { approvalToken, ...planBase } = receipt.plan;
  if (projectDigest(planBase) !== approvalToken) throw new Error("Receipt plan integrity failure.");
  await safeProjectRoot(receipt.project);
  for (const f of receipt.plan.files) { projectRelative(f.path); if (bytesDigest(f.content) !== f.sha256) throw new Error("Receipt file integrity failure."); }
  if (new Set(receipt.createdFiles).size !== receipt.createdFiles.length || receipt.createdFiles.some(p => !receipt.plan.files.some(f => f.path === p))) throw new Error("Invalid receipt mutations.");
  for (const dir of receipt.createdDirectories) {
    if (!isWithin(receipt.project, dir) && !isWithin(dir, receipt.project)) throw new Error("Invalid created directory.");
    if (dir === path.parse(dir).root) throw new Error("Unsafe directory receipt.");
  }
  return receipt;
}
export async function verifyProjectReceipt(file: string, options: ProjectApplyOptions = {}): Promise<{ valid: boolean; state: string; project: string; checks: { path: string; valid: boolean }[] }> {
  const receipt = await loadProjectReceipt(file, options);
  const checks = [];
  for (const expected of receipt.plan.files) {
    const target = await safeProjectFile(receipt.project, expected.path);
    const present = await projectExists(target);
    const before = receipt.plan.baseline.find(s => s.path === expected.path);
    const digest = receipt.state === "rolled-back" ? before?.digest : expected.sha256;
    checks.push({ path: expected.path, valid: digest === null ? !present : present && bytesDigest(await readFile(target)) === digest });
  }
  return { valid: receipt.state !== "applying" && checks.every(c => c.valid), state: receipt.state, project: receipt.project, checks };
}
async function withProjectLock<T>(root: string, project: string, run: () => Promise<T>): Promise<T> {
  const lock = path.join(root, `${bytesDigest(project)}.lock`);
  try { await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) { throw new Error(`Project operation lock exists or cannot be created: ${lock}. After a crashed process, inspect its PID before removing this lock.`, { cause: error }); }
  try { return await run(); } finally { await unlink(lock); }
}
export async function applyProject(plan: ProjectPlan, confirm: string, options: ProjectApplyOptions = {}): Promise<{ state: "applied" | "unchanged"; receipt: string; project: string }> {
  await validateProjectPlan(plan);
  if (confirm !== plan.approvalToken) throw new Error("Confirmation does not match the exact foundation plan.");
  if (plan.blockers.length) throw new Error(plan.blockers.join("\n"));
  const root = await privateState(plan.project, options); const file = receiptName(root, plan.approvalToken);
  return withProjectLock(root, plan.project, async () => {
    if (await projectExists(file)) {
      const prior = await loadProjectReceipt(file, options);
      if (prior.state === "applying") throw new Error(`Interrupted apply requires explicit recovery: ${file}`);
      if (prior.state === "applied") {
        if (!(await verifyProjectReceipt(file, options)).valid) throw new Error("Applied project drifted.");
        return { state: "unchanged", receipt: file, project: plan.project };
      }
    }
    await assertProjectCurrent(plan);
    const receipt: ProjectReceipt = { schemaVersion: 1, kind: "afd-project-receipt", project: plan.project, approvalToken: plan.approvalToken, state: "applying", plan, createdFiles: [], createdDirectories: [], receiptToken: "" };
    await saveReceipt(file, receipt);
    for (const entry of plan.files) {
      const target = await safeProjectFile(plan.project, entry.path);
      if (await projectExists(target)) {
        if (bytesDigest(await readFile(target)) !== entry.sha256) throw new Error("Concurrent project edit; recovery required.");
        continue;
      }
      const dirs: string[] = []; let parent = path.dirname(target);
      while (!await projectExists(parent)) { dirs.unshift(parent); parent = path.dirname(parent); }
      for (const dir of dirs) { await safeProjectRoot(dir); await mkdir(dir); receipt.createdDirectories.push(dir); await saveReceipt(file, receipt); }
      // Intent is durable before creating a file. Recovery only removes matching bytes.
      receipt.createdFiles.push(entry.path); await saveReceipt(file, receipt);
      await writeFile(await safeProjectFile(plan.project, entry.path), entry.content, { flag: "wx" });
      options.afterWrite?.(receipt.createdFiles.length);
    }
    receipt.state = "applied"; await saveReceipt(file, receipt);
    if (!(await verifyProjectReceipt(file, options)).valid) throw new Error("Post-apply verification failed.");
    return { state: "applied", receipt: file, project: plan.project };
  });
}
export async function rollbackProject(file: string, confirm: string, options: ProjectApplyOptions = {}): Promise<{ state: "rolled-back"; receipt: string }> {
  const receipt = await loadProjectReceipt(file, options);
  if (confirm !== receipt.approvalToken) throw new Error("Rollback confirmation mismatch.");
  const root = await privateState(receipt.project, options);
  return withProjectLock(root, receipt.project, async () => {
    // Any new adapter/native configuration may depend on canonical policy. Preserve it.
    const { harnessTargets } = await import("./harness-registry.js");
    for (const name of new Set(harnessTargets.flatMap(t => [...t.instructionPaths, ...t.evidencePaths]))) {
      if (receipt.plan.files.some(f => f.path === name) || name === ".afd") continue;
      if (await projectExists(path.join(receipt.project, name))) throw new Error(`Dependent harness artifact exists; rollback activation first: ${name}`);
    }
    for (const name of receipt.createdFiles) {
      const target = await safeProjectFile(receipt.project, name); const expected = receipt.plan.files.find(f => f.path === name)!;
      if (await projectExists(target) && bytesDigest(await readFile(target)) !== expected.sha256) throw new Error(`Rollback refused; user content changed: ${name}`);
    }
    for (const name of [...receipt.createdFiles].reverse()) {
      const target = await safeProjectFile(receipt.project, name);
      if (await projectExists(target)) await unlink(target);
    }
    for (const dir of [...receipt.createdDirectories].reverse()) {
      await safeProjectRoot(dir);
      try { await rmdir(dir); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    }
    receipt.state = "rolled-back"; await saveReceipt(file, receipt);
    return { state: "rolled-back", receipt: file };
  });
}

export async function recoverProject(file: string, confirm: string, options: ProjectApplyOptions = {}): Promise<{ state: "rolled-back"; receipt: string }> {
  const receipt = await loadProjectReceipt(file, options);
  if (receipt.state !== "applying" || confirm !== receipt.approvalToken) throw new Error("Recovery requires an interrupted receipt and its exact confirmation.");
  const lock = path.join(projectStateRoot(options), `${bytesDigest(receipt.project)}.lock`);
  if (await projectExists(lock)) {
    await safeProjectFile(projectStateRoot(options), path.basename(lock));
    const pid = Number((await readFile(lock, "utf8")).trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Cannot verify stale operation lock PID.");
    try { process.kill(pid, 0); throw new Error("Operation owner is still running; recovery refused."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    await unlink(lock);
  }
  return rollbackProject(file, confirm, options);
}
