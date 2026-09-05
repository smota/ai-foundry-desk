import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditHarness, renderHarnessAudit } from "../src/harness-audit.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "afd-harness-audit-"));
  await mkdir(path.join(root, ".claude"));
  await writeFile(path.join(root, "AGENTS.md"), "# Project rules\n\nUse pnpm.\nDefault mode: multi-agent.\n");
  await writeFile(path.join(root, "CLAUDE.md"), "# Claude\n\nRead and follow `AGENTS.md`.\n");
  await writeFile(path.join(root, "CODEX.md"), "# Codex\n\nRead and follow `AGENTS.md`.\n");
  await writeFile(path.join(root, "agent-workflow.config.json"), JSON.stringify({ routing: { defaultMode: "single-agent" } }));
  return root;
}

test("audit is read-only and emits equivalent human and JSON evidence", async () => {
  const root = await fixture(); const before = (await readdir(root)).sort();
  const report = await auditHarness(root); const after = (await readdir(root)).sort();
  assert.deepEqual(after, before); assert.equal(report.schemaVersion, 1); assert.equal(report.canonical?.path, "AGENTS.md");
  assert.ok(report.findings.some((item) => item.code === "routing.mode-conflict"));
  assert.ok(report.findings.some((item) => item.code === "legacy.redundant-pointer"));
  assert.match(renderHarnessAudit(report), /AFD project harness audit/);
});

test("audit records native Agy discovery as configured, retaining the separate legacy target", async () => {
  const root = await fixture(); await mkdir(path.join(root, ".agy")); await writeFile(path.join(root, "AGY.md"), "# Agy\n\nRead `AGENTS.md`.\n");
  const report = await auditHarness(root); const agy = report.agents.find((item) => item.id === "agy"); const antigravity = report.agents.find((item) => item.id === "antigravity");
  assert.equal(agy?.detected, true); assert.equal(agy?.discovery, "configured"); assert.equal(antigravity?.detected, false);
  assert.equal(agy?.instruction?.path, "AGENTS.md");
});

test("audit reports oversized canonical guidance without using line count as a blocker", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-harness-budget-")); await writeFile(path.join(root, "AGENTS.md"), `# Rules\n${"Keep evidence.\n".repeat(3000)}`);
  const report = await auditHarness(root); assert.ok(report.findings.some((item) => item.code === "canonical.codex-budget")); assert.equal(report.summary.blockers, 0);
});

test("audit blocks projects without a canonical instruction source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-harness-missing-")); const report = await auditHarness(root);
  assert.ok(report.findings.some((item) => item.code === "canonical.missing" && item.severity === "blocker"));
});
