import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { applyHarnessPlan, rollbackHarness, verifyHarnessReceipt } from "../src/harness-apply.js";
import { planHarness, stageHarness } from "../src/harness-plan.js";
import { testHarness, writeHarnessEvidence } from "../src/harness-smoke.js";
import type { CommandResult } from "../src/platform.js";
import { NodePlatformAdapter } from "../src/platform.js";

const exec = promisify(execFile);
function commandResult(stdout = ""): CommandResult { return { status: 0, stdout, stderr: "", timedOut: false }; }
class ReceiptAdapter extends NodePlatformAdapter { override async run(): Promise<CommandResult> { return commandResult(); } }
async function repositoryFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "afd-apply-project-")); await writeFile(path.join(root, "AGENTS.md"), "# Project policy\n\nUse project dependencies.\nPreserve user work.\n");
  await exec("git", ["init", "-q", root]); await exec("git", ["-C", root, "add", "AGENTS.md"]); await exec("git", ["-C", root, "-c", "user.name=AFD Test", "-c", "user.email=afd@example.invalid", "commit", "-q", "-m", "fixture"]); return root;
}
async function passingEvidence(project: string, output: string) {
  const plan = await planHarness(project, { agents: ["codex", "claude-code"] });
  const report = await testHarness(plan, { live: true, runner: async (command) => {
    if (command.executable === "where.exe" || command.executable === "which") return commandResult("found\n"); if (command.args.includes("--version")) return commandResult("1.0.0\n"); const agent = command.executable === "claude" ? "claude-code" : "codex";
    return commandResult(`AFD_HARNESS_SMOKE_V1:{"agent":"${agent}","canonicalPath":"AGENTS.md","firstHeading":"# Project policy","finalInstructionLine":"Preserve user work.","writeAttempted":false}\n`);
  } });
  await writeHarnessEvidence(report, output); return { plan, report };
}

test("apply requires matching live evidence, verifies Git-visible workspace state, and rolls back exactly", async () => {
  const project = await repositoryFixture(); const stateRoot = await mkdtemp(path.join(tmpdir(), "afd-apply-state-")); const adapter = new ReceiptAdapter({ id: "linux", stateRoot }); const evidencePath = path.join(await mkdtemp(path.join(tmpdir(), "afd-apply-evidence-")), "smoke.json"); const { plan } = await passingEvidence(project, evidencePath);
  await assert.rejects(applyHarnessPlan(plan, { confirm: "wrong", evidence: evidencePath, adapter }), /confirmation/);
  const applied = await applyHarnessPlan(plan, { confirm: plan.approvalToken, evidence: evidencePath, adapter }); assert.equal(applied.status, "applied"); assert.deepEqual(applied.changed, ["CLAUDE.md"]); assert.match(await readFile(path.join(project, "CLAUDE.md"), "utf8"), /AGENTS\.md/);
  const verified = await verifyHarnessReceipt(applied.receiptPath, { adapter }); assert.equal(verified.valid, true);
  const repeated = await applyHarnessPlan(plan, { confirm: plan.approvalToken, evidence: evidencePath, adapter }); assert.equal(repeated.status, "unchanged");
  await writeFile(path.join(project, "unrelated.txt"), "drift\n"); assert.equal((await verifyHarnessReceipt(applied.receiptPath, { adapter })).valid, false); await assert.rejects(rollbackHarness(applied.receiptPath, { confirm: plan.approvalToken, adapter }), /drifted/);
  await import("node:fs/promises").then(({ unlink }) => unlink(path.join(project, "unrelated.txt"))); const rolledBack = await rollbackHarness(applied.receiptPath, { confirm: plan.approvalToken, adapter }); assert.equal(rolledBack.status, "rolled-back"); await assert.rejects(readFile(path.join(project, "CLAUDE.md"), "utf8"), /ENOENT/); assert.equal(await readFile(path.join(project, "AGENTS.md"), "utf8"), "# Project policy\n\nUse project dependencies.\nPreserve user work.\n");
  const reapplied = await applyHarnessPlan(plan, { confirm: plan.approvalToken, evidence: evidencePath, adapter }); assert.equal(reapplied.status, "applied");
});

test("apply refuses stale workspace and tampered or non-live evidence", async () => {
  const project = await repositoryFixture(); const stateRoot = await mkdtemp(path.join(tmpdir(), "afd-stale-state-")); const adapter = new ReceiptAdapter({ id: "linux", stateRoot }); const evidencePath = path.join(await mkdtemp(path.join(tmpdir(), "afd-stale-evidence-")), "smoke.json"); const { plan, report } = await passingEvidence(project, evidencePath);
  const tamperedPath = path.join(path.dirname(evidencePath), "tampered.json"); await writeFile(tamperedPath, `${JSON.stringify({ ...report, passed: false }, null, 2)}\n`); await assert.rejects(applyHarnessPlan(plan, { confirm: plan.approvalToken, evidence: tamperedPath, adapter }), /token/);
  await writeFile(path.join(project, "unrelated.txt"), "drift\n"); await assert.rejects(applyHarnessPlan(plan, { confirm: plan.approvalToken, evidence: evidencePath, adapter }), /workspace changed/);
});

test("stage rejects unrelated Git workspace drift after review", async () => {
  const project = await repositoryFixture(); const plan = await planHarness(project, { agents: ["codex", "claude-code"] }); const output = path.join(await mkdtemp(path.join(tmpdir(), "afd-stage-parent-")), "stage"); await writeFile(path.join(project, "new.txt"), "changed\n"); await assert.rejects(stageHarness(plan, output), /workspace changed/);
});
