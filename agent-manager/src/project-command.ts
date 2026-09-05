import { readFile } from "node:fs/promises";
import path from "node:path";
import { projectAgents, bytesDigest } from "./project-contracts.js";
import { applyProject, recoverProject, rollbackProject, verifyProjectReceipt } from "./project-apply.js";
import { planProject, readProjectPlan, stageProject } from "./project-plan.js";
import { recipeIdentity } from "./project-recipes.js";
import { projectExists, safeProjectFile, safeProjectRoot } from "./project-files.js";
import { readValidation, validateProject } from "./project-validate.js";
import { harnessTarget } from "./harness-registry.js";
import { verifyHarnessReceipt } from "./harness-apply.js";
import { hasHarnessSmokeRunner } from "./harness-smoke.js";

export async function runProjectCommand(args: readonly string[], output: (value: string) => void): Promise<number> {
  const sub = args[0];
  const contracts: Record<string, { target: boolean; flags: string[] }> = {
    recipes: { target: false, flags: [] }, inspect: { target: true, flags: ["agents"] },
    plan: { target: true, flags: ["brief"] }, stage: { target: false, flags: ["plan", "output"] },
    validate: { target: false, flags: ["stage", "checks"] },
    apply: { target: false, flags: ["plan", "scope", "confirm", "state-dir"] },
    verify: { target: true, flags: ["receipt", "state-dir"] },
    rollback: { target: true, flags: ["receipt", "confirm", "state-dir"] },
    recover: { target: true, flags: ["receipt", "confirm", "state-dir"] },
    status: { target: true, flags: ["receipt", "state-dir", "validation", "harness-receipt"] },
  };
  const contract = sub ? contracts[sub] : undefined;
  if (!contract) throw new Error("Usage: afd project recipes|inspect|plan|stage|validate|apply|verify|rollback|recover|status [options]");
  const target = contract.target ? args[1] : undefined;
  if (contract.target && (!target || target.startsWith("--"))) throw new Error("A project target is required.");
  const flags: Record<string, string> = {};
  for (let i = contract.target ? 2 : 1; i < args.length; i++) {
    const arg = args[i]!; if (arg === "--json") continue;
    if (!arg.startsWith("--") || !contract.flags.includes(arg.slice(2)) || flags[arg.slice(2)] !== undefined) throw new Error(`Unknown or duplicate project option: ${arg}`);
    const value = args[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    flags[arg.slice(2)] = value;
  }
  const need = (key: string): string => { if (!flags[key]) throw new Error(`--${key} is required.`); return flags[key]!; };
  const emit = (value: unknown) => output(JSON.stringify(value, null, 2) + "\n");
  const options = flags["state-dir"] ? { stateDirectory: flags["state-dir"] } : {};
  if (sub === "recipes") { const digest = await recipeIdentity(); emit({ recipes: ["policy-only", "rust-workspace"].map(id => ({ id, version: "1", digest })) }); return 0; }
  if (sub === "inspect") {
    const project = await safeProjectRoot(target!);
    const agents = projectAgents(need("agents").split(","));
    emit({ project, exists: await projectExists(project), canonical: await projectExists(path.join(project, "AGENTS.md")), desiredHarnesses: agents, capabilities: agents.map(id => { const t = harnessTarget(id); return { id, discovery: t.discovery, safeRunner: hasHarnessSmokeRunner(id), command: t.command, state: "not-probed", detail: t.note }; }), modelInvocations: 0 }); return 0;
  }
  if (sub === "plan") { const plan = await planProject(target!, JSON.parse(await readFile(need("brief"), "utf8"))); emit(plan); return plan.blockers.length ? 2 : 0; }
  if (sub === "stage") { emit(await stageProject(await readProjectPlan(need("plan")), need("output"))); return 0; }
  if (sub === "validate") {
    const checks = need("checks"); if (checks !== "structural" && checks !== "build") throw new Error("--checks must be structural or build.");
    const report = await validateProject(need("stage"), checks); emit(report); return report.state === "passed" ? 0 : 2;
  }
  if (sub === "apply") {
    if (need("scope") !== "foundation") throw new Error("Only explicit foundation apply is supported; harness activation uses afd harness.");
    emit(await applyProject(await readProjectPlan(need("plan")), need("confirm"), options)); return 0;
  }
  if (sub === "verify" || sub === "rollback" || sub === "recover") {
    const receipt = need("receipt"); const before = await verifyProjectReceipt(receipt, options);
    if (before.project !== await safeProjectRoot(target!)) throw new Error("Receipt target mismatch.");
    if (sub === "verify") { emit(before); return before.valid ? 0 : 2; }
    emit(await (sub === "recover" ? recoverProject : rollbackProject)(receipt, need("confirm"), options)); return 0;
  }
  const project = await safeProjectRoot(target!);
  const manifestPath = await safeProjectFile(project, ".afd/project.json");
  if (!await projectExists(manifestPath)) { emit({ project, foundation: "absent", validation: "not-run", harnesses: "pending", complete: false }); return 2; }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { desiredHarnesses: unknown; policyClosure: string[]; policyDigest: string };
  const agents = projectAgents(manifest.desiredHarnesses);
  let policyIntact = true;
  const rows: [string, string][] = [];
  for (const name of manifest.policyClosure) {
    const file = await safeProjectFile(project, name);
    if (!await projectExists(file)) { policyIntact = false; break; }
    rows.push([name, bytesDigest(await readFile(file))]);
  }
  const { projectDigest } = await import("./project-contracts.js");
  policyIntact &&= projectDigest(rows) === manifest.policyDigest;
  const verified = flags.receipt ? await verifyProjectReceipt(flags.receipt, options) : null;
  if (verified && verified.project !== project) throw new Error("Receipt target mismatch.");
  const validation = flags.validation ? await readValidation(flags.validation) : null;
  if (validation) {
    if (!flags.receipt) throw new Error("Validation status requires --receipt for candidate binding.");
    const { loadProjectReceipt } = await import("./project-apply.js");
    if (validation.approvalToken !== (await loadProjectReceipt(flags.receipt, options)).approvalToken) throw new Error("Validation belongs to another candidate.");
  }
  let harnesses = "pending";
  if (flags["harness-receipt"]) {
    const report = await verifyHarnessReceipt(flags["harness-receipt"]);
    const receipt = JSON.parse(await readFile(flags["harness-receipt"], "utf8")) as { selectedAgents: string[] };
    if (report.project.replaceAll("\\", "/") !== project.replaceAll("\\", "/") || projectDigest(receipt.selectedAgents.slice().sort()) !== projectDigest(agents)) throw new Error("Harness receipt target/selection mismatch.");
    harnesses = report.valid && policyIntact ? "verified" : "drifted";
  }
  const foundation = policyIntact && (!verified || verified.valid) ? "applied" : "drifted";
  const validationState = foundation === "drifted" ? "blocked" : validation?.state ?? "not-run";
  const complete = foundation === "applied" && validationState === "passed" && harnesses === "verified";
  emit({ project, foundation, validation: validationState, harnesses, desiredHarnesses: agents, complete, next: complete ? "No pending initialization gates." : "Supply exact validation and harness receipts; no live activation is inferred from files." }); return complete ? 0 : 2;
}
