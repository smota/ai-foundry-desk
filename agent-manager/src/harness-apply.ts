import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlatformAdapter } from "./platform.js";
import { NodePlatformAdapter, writePrivateText } from "./platform.js";
import { commandAvailable, expectedHarnessFingerprint, harnessRuntimeBinding } from "./harness-smoke.js";
import { harnessTarget } from "./harness-registry.js";
import { assertHarnessPlanCurrent, harnessGitState } from "./harness-plan.js";
import type {
  HarnessApplyReceipt,
  HarnessApplyResult,
  HarnessMutationReceipt,
  HarnessPlan,
  HarnessRollbackResult,
  HarnessSmokeReport,
  HarnessVerifyReport,
} from "./harness-contracts.js";

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function slash(value: string): string { return value.replaceAll("\\", "/"); }
function contained(root: string, candidate: string): boolean { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); }
async function exists(target: string): Promise<boolean> { try { await lstat(target); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]); }

function parseEvidence(value: unknown): HarnessSmokeReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Harness smoke evidence is not an object.");
  const item = value as Record<string, unknown>; const keys = ["schemaVersion", "project", "approvalToken", "selectedAgents", "live", "expectedPolicyFingerprint", "results", "ready", "consistent", "passed", "evidenceToken"];
  if ("executionContext" in item) {
    if (typeof item.executionContext !== "string") throw new Error("Invalid harness execution context.");
    keys.push("executionContext");
  }
  if ("runtimeBinding" in item) keys.push("runtimeBinding");
  if (!exactKeys(item, keys) || item.schemaVersion !== 1 || typeof item.project !== "string" || typeof item.approvalToken !== "string" || !Array.isArray(item.selectedAgents) || typeof item.live !== "boolean" || typeof item.expectedPolicyFingerprint !== "string" || !Array.isArray(item.results) || typeof item.ready !== "boolean" || typeof item.consistent !== "boolean" || typeof item.passed !== "boolean" || typeof item.evidenceToken !== "string") throw new Error("Harness smoke evidence has an invalid contract.");
  const { evidenceToken, ...base } = item; if (hash(JSON.stringify(base)) !== evidenceToken) throw new Error("Harness smoke evidence token does not match its content.");
  return item as unknown as HarnessSmokeReport;
}
async function loadEvidence(plan: HarnessPlan, input: string, adapter: PlatformAdapter): Promise<HarnessSmokeReport> {
  const target = await realpath(path.resolve(input)); if (contained(path.resolve(plan.project), target)) throw new Error("Harness smoke evidence must remain outside the target project.");
  const evidence = parseEvidence(JSON.parse(await readFile(target, "utf8")));
  if (evidence.project !== plan.project || evidence.approvalToken !== plan.approvalToken) throw new Error("Harness smoke evidence does not belong to this reviewed plan.");
  if (!evidence.live || !evidence.ready || !evidence.consistent || !evidence.passed) throw new Error("A passing live harness smoke report is required.");
  if (evidence.expectedPolicyFingerprint !== await expectedHarnessFingerprint(plan)) throw new Error("Harness evidence does not match the expected policy facts.");
  if (JSON.stringify(evidence.selectedAgents) !== JSON.stringify(plan.selectedAgents)) throw new Error("Harness smoke evidence agent selection does not match the reviewed plan.");
  if (new Set(evidence.results.map(r => r.agent)).size !== plan.selectedAgents.length || evidence.results.some(r => !plan.selectedAgents.includes(r.agent))) throw new Error("Harness evidence has duplicate or foreign agent identities.");
  if (plan.policyFiles) {
    const bound = evidence.runtimeBinding; const current = harnessRuntimeBinding();
    const age = bound ? Date.now() - Date.parse(bound.observedAt) : NaN;
    if (!bound || !Number.isFinite(age) || age < 0 || age > 86400000 || bound.context !== current.context || bound.contractDigest !== current.contractDigest) throw new Error("Harness runtime evidence is missing, stale, or from a different environment/runner contract.");
    for (const result of evidence.results) {
      const probe = await commandAvailable(harnessTarget(result.agent).command, command => adapter.run(command), adapter.id);
      if (!probe.available || !result.version || probe.version !== result.version) throw new Error(`Harness executable readiness/version changed: ${result.agent}`);
    }
  }
  if (evidence.results.length !== plan.selectedAgents.length || evidence.results.some((result) => result.state !== "passed" || result.policyFingerprint !== evidence.expectedPolicyFingerprint)) throw new Error("Every selected agent must have passing, consistent smoke evidence.");
  return evidence;
}
async function safeTarget(project: string, relative: string): Promise<string> {
  const root = path.resolve(project); const target = path.resolve(root, relative); if (!contained(root, target) || target === root) throw new Error(`Unsafe harness mutation path: ${relative}`);
  let cursor = path.dirname(target); while (cursor !== root) { if (!contained(root, cursor)) throw new Error(`Unsafe harness parent path: ${relative}`); if (await exists(cursor)) { const info = await lstat(cursor); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Harness parent is not a regular directory: ${relative}`); } cursor = path.dirname(cursor); }
  if (await exists(target)) { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Harness mutation target is not a regular file: ${relative}`); }
  return target;
}
function safeDirectoryTarget(project: string, relative: string): string { const root = path.resolve(project); const target = path.resolve(root, relative); if (!relative || !contained(root, target) || target === root) throw new Error(`Unsafe harness directory path: ${relative}`); return target; }
async function currentText(project: string, relative: string): Promise<string | null> { const target = await safeTarget(project, relative); return await exists(target) ? readFile(target, "utf8") : null; }
async function ensureParents(project: string, target: string, created: Set<string>): Promise<void> {
  const root = path.resolve(project); const missing: string[] = []; let cursor = path.dirname(target); while (cursor !== root) { if (!await exists(cursor)) missing.push(cursor); cursor = path.dirname(cursor); }
  for (const directory of missing.reverse()) { await mkdir(directory); created.add(slash(path.relative(root, directory))); }
}
async function atomicWrite(project: string, relative: string, content: string, created: Set<string>): Promise<void> {
  const target = await safeTarget(project, relative); await ensureParents(project, target, created); const temporary = `${target}.afd-${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { encoding: "utf8", flag: "wx" }); await rename(temporary, target); }
  catch (error) { if (await exists(temporary)) await unlink(temporary); throw error; }
}
async function setMutation(project: string, mutation: HarnessMutationReceipt, side: "before" | "after", created: Set<string>): Promise<void> {
  const encoded = side === "before" ? mutation.beforeContentBase64 : mutation.afterContentBase64; const relative = mutation.path; const target = await safeTarget(project, relative);
  if (encoded === null) { if (await exists(target)) await unlink(target); return; }
  await atomicWrite(project, relative, Buffer.from(encoded, "base64").toString("utf8"), created);
}
function receiptBase(receipt: HarnessApplyReceipt): Omit<HarnessApplyReceipt, "receiptToken"> { const base: Record<string, unknown> = { ...receipt }; delete base.receiptToken; return base as unknown as Omit<HarnessApplyReceipt, "receiptToken">; }
function validateReceipt(value: unknown): HarnessApplyReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Harness receipt is invalid."); const item = value as HarnessApplyReceipt;
  if (item.schemaVersion !== 1 || typeof item.project !== "string" || typeof item.approvalToken !== "string" || typeof item.receiptToken !== "string" || !Array.isArray(item.mutations) || !Array.isArray(item.createdDirectories)) throw new Error("Harness receipt contract is invalid.");
  if (hash(JSON.stringify(receiptBase(item))) !== item.receiptToken) throw new Error("Harness receipt token does not match its content."); return item;
}
function stateDirectory(adapter: PlatformAdapter, project: string): string { return path.join(adapter.stateRoot, "project-harness", hash(project).slice(0, 24)); }
async function loadReceipt(adapter: PlatformAdapter, input: string): Promise<{ readonly receipt: HarnessApplyReceipt; readonly path: string }> {
  const root = path.resolve(adapter.stateRoot, "project-harness"); const target = path.resolve(input); if (!contained(root, target)) throw new Error("Harness receipt must be inside the AFD project-harness state directory.");
  const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Harness receipt must be a regular file."); return { receipt: validateReceipt(JSON.parse(await readFile(target, "utf8"))), path: target };
}

export async function verifyHarnessReceipt(receiptInput: string, options: { readonly adapter?: PlatformAdapter } = {}): Promise<HarnessVerifyReport> {
  const adapter = options.adapter ?? new NodePlatformAdapter(); const loaded = await loadReceipt(adapter, receiptInput); const receipt = loaded.receipt; const project = await realpath(receipt.project); if (slash(project) !== receipt.project) throw new Error("Harness receipt project path no longer resolves to the reviewed target.");
  const checks: { path: string; valid: boolean; detail: string }[] = [];
  for (const file of receipt.policyDigests ?? []) {
    const content = await currentText(project, file.path);
    checks.push({ path: file.path, valid: content !== null && hash(content) === file.sha256, detail: "Required supporting policy digest" });
  }
  const canonical = await currentText(project, receipt.canonicalPath); checks.push({ path: receipt.canonicalPath, valid: canonical !== null && hash(canonical) === receipt.canonicalSha256, detail: "Canonical instruction hash" });
  for (const mutation of receipt.mutations) { const value = await currentText(project, mutation.path); const current = value === null ? null : hash(value); checks.push({ path: mutation.path, valid: current === mutation.afterSha256, detail: "Applied harness artifact hash" }); }
  const git = await harnessGitState(project); checks.push({ path: ".git/workspace", valid: git.revision === receipt.baseRevision && git.workspaceFingerprint === receipt.afterWorkspaceFingerprint, detail: "Repository revision and complete Git-visible workspace fingerprint" });
  return { schemaVersion: 1, project: receipt.project, approvalToken: receipt.approvalToken, receiptPath: slash(loaded.path), valid: checks.every((check) => check.valid), checks };
}

export async function applyHarnessPlan(plan: HarnessPlan, options: { readonly confirm: string; readonly evidence: string; readonly adapter?: PlatformAdapter }): Promise<HarnessApplyResult> {
  if (plan.blocked) throw new Error(`Harness plan is blocked: ${plan.blockers.join("; ")}`); if (options.confirm !== plan.approvalToken) throw new Error("Harness apply confirmation does not match the reviewed plan token.");
  const adapter = options.adapter ?? new NodePlatformAdapter(); const evidence = await loadEvidence(plan, options.evidence, adapter);
  const receiptPath = path.join(stateDirectory(adapter, plan.project), `${plan.approvalToken}.json`); const existing = await adapter.readText(receiptPath);
  if (existing !== undefined) { validateReceipt(JSON.parse(existing)); const verification = await verifyHarnessReceipt(receiptPath, { adapter }); if (!verification.valid) throw new Error("Existing harness apply receipt does not match the current project state."); return { schemaVersion: 1, status: "unchanged", project: plan.project, approvalToken: plan.approvalToken, receiptPath: slash(receiptPath), changed: [] }; }
  await assertHarnessPlanCurrent(plan);
  const mutations: HarnessMutationReceipt[] = [];
  for (const item of plan.actions) if (item.kind !== "preserve") { const before = await currentText(plan.project, item.path); const beforeHash = before === null ? null : hash(before); if (beforeHash !== item.beforeSha256) throw new Error(`Harness plan is stale: ${item.path} changed.`); mutations.push({ path: item.path, beforeSha256: beforeHash, beforeContentBase64: before === null ? null : Buffer.from(before, "utf8").toString("base64"), afterSha256: item.afterSha256, afterContentBase64: item.content === null ? null : Buffer.from(item.content, "utf8").toString("base64") }); }
  const created = new Set<string>(); const applied: HarnessMutationReceipt[] = [];
  try {
    for (const mutation of mutations) { await setMutation(plan.project, mutation, "after", created); applied.push(mutation); }
    const afterGit = await harnessGitState(plan.project); const base: Omit<HarnessApplyReceipt, "receiptToken"> = { schemaVersion: 1, project: plan.project, approvalToken: plan.approvalToken, evidenceToken: evidence.evidenceToken, selectedAgents: plan.selectedAgents, canonicalPath: plan.canonicalPath, canonicalSha256: plan.canonicalSha256, baseRevision: plan.baseRevision, beforeWorkspaceFingerprint: plan.workspaceFingerprint, afterWorkspaceFingerprint: afterGit.workspaceFingerprint, appliedAt: new Date().toISOString(), mutations, createdDirectories: [...created].sort() };
    const boundBase = { ...base, ...(plan.policyFiles ? { policyDigests: plan.policyFiles.map(f => ({ path: f.path, sha256: f.sha256 })) } : {}) };
    const receipt: HarnessApplyReceipt = { ...boundBase, receiptToken: hash(JSON.stringify(boundBase)) }; await writePrivateText(adapter, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) { for (const mutation of [...applied].reverse()) await setMutation(plan.project, mutation, "before", new Set()); for (const directory of [...created].sort((left, right) => right.length - left.length)) try { await rmdir(safeDirectoryTarget(plan.project, directory)); } catch { /* preserve non-empty directories */ } throw error; }
  return { schemaVersion: 1, status: "applied", project: plan.project, approvalToken: plan.approvalToken, receiptPath: slash(receiptPath), changed: mutations.map((item) => item.path) };
}

export async function rollbackHarness(receiptInput: string, options: { readonly confirm: string; readonly adapter?: PlatformAdapter }): Promise<HarnessRollbackResult> {
  const adapter = options.adapter ?? new NodePlatformAdapter(); const loaded = await loadReceipt(adapter, receiptInput); const receipt = loaded.receipt; if (options.confirm !== receipt.approvalToken) throw new Error("Harness rollback confirmation does not match the applied plan token.");
  const verification = await verifyHarnessReceipt(receiptInput, { adapter }); if (!verification.valid) throw new Error("Harness rollback refused because the applied project state has drifted."); const restored: HarnessMutationReceipt[] = [];
  let rollbackPath: string | null = null; try {
    for (const mutation of [...receipt.mutations].reverse()) { await setMutation(receipt.project, mutation, "before", new Set()); restored.push(mutation); }
    for (const directory of [...receipt.createdDirectories].sort((left, right) => right.length - left.length)) try { await rmdir(safeDirectoryTarget(receipt.project, directory)); } catch { /* retain directories that are no longer empty */ }
    const git = await harnessGitState(receipt.project); if (git.revision !== receipt.baseRevision || git.workspaceFingerprint !== receipt.beforeWorkspaceFingerprint) throw new Error("Harness rollback did not restore the reviewed repository workspace fingerprint.");
    const rolledBackAt = new Date().toISOString(); rollbackPath = path.join(path.dirname(loaded.path), `${receipt.approvalToken}.rollback-${rolledBackAt.replaceAll(/[:.]/g, "-")}.json`); if (await adapter.readText(rollbackPath) !== undefined) throw new Error("Harness rollback receipt already exists."); const record = { schemaVersion: 1, status: "rolled-back", project: receipt.project, approvalToken: receipt.approvalToken, sourceReceiptToken: receipt.receiptToken, rolledBackAt, restored: receipt.mutations.map((item) => item.path) }; await writePrivateText(adapter, rollbackPath, `${JSON.stringify({ ...record, receiptToken: hash(JSON.stringify(record)) }, null, 2)}\n`); await adapter.remove(loaded.path);
    return { schemaVersion: 1, status: "rolled-back", project: receipt.project, approvalToken: receipt.approvalToken, rollbackReceiptPath: slash(rollbackPath), restored: receipt.mutations.map((item) => item.path) };
  } catch (error) { if (rollbackPath) await adapter.remove(rollbackPath); for (const mutation of restored.reverse()) await setMutation(receipt.project, mutation, "after", new Set()); throw error; }
}

export function renderHarnessVerification(report: HarnessVerifyReport): string { return `${["AFD project harness verification", `Project: ${report.project}`, `Plan: ${report.approvalToken}`, `Result: ${report.valid ? "PASS" : "FAIL"}`, "", ...report.checks.map((check) => `- ${check.valid ? "PASS" : "FAIL"} ${check.path}: ${check.detail}`)].join("\n")}\n`; }
