#!/usr/bin/env node
// Real CLI/filesystem smoke. No model, harness invocation, generated-file repair, or install.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "output", "project-init-smoke", `${Date.now()}`);
await mkdir(output, { recursive: true });
const cli = path.join(root, "agent-manager/dist/cli.js");
const steps = [];
async function run(args, expected = 0) {
  let stdout; let code = 0;
  try { ({ stdout } = await promisify(execFile)(process.execPath, [cli, "project", ...args, "--json"], { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { code = error.code; stdout = error.stdout; if (code !== expected) throw error; }
  assert.equal(code, expected);
  const report = JSON.parse(stdout); steps.push({ operation: args[0], exitCode: code }); return report;
}
for (const recipe of ["policy-only", "rust-workspace"]) {
  const brief = path.join(root, `recipes/project-init/${recipe}.brief.json`);
  const target = path.join(output, recipe);
  const state = path.join(output, "private-state");
  const inspected = await run(["inspect", target, "--agents", "codex,claude-code,pi,grok,agy"]);
  assert.equal(inspected.modelInvocations, 0); assert.equal(inspected.exists, false);
  const plan = await run(["plan", target, "--brief", brief]);
  const repeated = await run(["plan", target, "--brief", brief]);
  assert.equal(plan.approvalToken, repeated.approvalToken);
  const planFile = path.join(output, `${recipe}-plan.json`);
  await writeFile(planFile, JSON.stringify(plan, null, 2));
  const stage = path.join(output, `${recipe}-stage`);
  await run(["stage", "--plan", planFile, "--output", stage]);
  assert.equal((await run(["validate", "--stage", stage, "--checks", "structural"])).state, "passed");
  const applied = await run(["apply", "--plan", planFile, "--scope", "foundation", "--confirm", plan.approvalToken, "--state-dir", state]);
  assert.equal((await run(["verify", target, "--receipt", applied.receipt, "--state-dir", state])).valid, true);
  assert.equal((await run(["apply", "--plan", planFile, "--scope", "foundation", "--confirm", plan.approvalToken, "--state-dir", state])).state, "unchanged");
  for (const file of plan.files) assert.equal(await readFile(path.join(target, file.path), "utf8"), file.content);
  const status = await run(["status", target, "--receipt", applied.receipt, "--state-dir", state], 2);
  assert.equal(status.harnesses, "pending"); assert.equal(status.complete, false);
  await run(["rollback", target, "--receipt", applied.receipt, "--confirm", plan.approvalToken, "--state-dir", state]);
  assert.equal((await run(["verify", target, "--receipt", applied.receipt, "--state-dir", state])).valid, true);
}
const evidence = { passed: true, modelInvocations: 0, generatedFileAdjustments: 0, recipes: ["policy-only", "rust-workspace"], scope: "deterministic foundation lifecycle; live harness activation is intentionally not tested", steps };
await writeFile(path.join(output, "smoke.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ ...evidence, evidence: path.join(output, "smoke.json") }, null, 2));
