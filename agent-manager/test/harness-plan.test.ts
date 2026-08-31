import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { planHarness, stageHarness } from "../src/harness-plan.js";

const execFileAsync = promisify(execFile);

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "afd-harness-plan-"));
  await writeFile(path.join(root, "AGENTS.md"), "# Project\n\nUse pnpm.\n");
  await writeFile(path.join(root, "CODEX.md"), "# Codex\n\nRead and follow `AGENTS.md`.\n");
  return root;
}

test("plan is read-only, hash-bound, and generates only selected minimal adapters", async () => {
  const root = await fixture(); const before = (await readdir(root)).sort();
  const plan = await planHarness(root, { agents: ["codex", "claude-code"], removeLegacy: true });
  assert.deepEqual((await readdir(root)).sort(), before); assert.equal(plan.blocked, false); assert.equal(plan.approvalToken.length, 64);
  assert.ok(plan.actions.some((item) => item.kind === "create" && item.path === "CLAUDE.md"));
  assert.ok(plan.actions.some((item) => item.kind === "remove-legacy" && item.path === "CODEX.md"));
  assert.ok(plan.actions.every((item) => item.content === null || !item.content.includes("Use pnpm")));
});

test("plan preserves divergent project-owned adapters", async () => {
  const root = await fixture(); await writeFile(path.join(root, "CLAUDE.md"), "# Claude role\n\nPerform a distinct review role.\n");
  const plan = await planHarness(root, { agents: ["claude-code"] });
  assert.equal(plan.blocked, true); assert.ok(plan.actions.some((item) => item.kind === "preserve" && item.path === "CLAUDE.md"));
});

test("plan token changes with canonical content", async () => {
  const root = await fixture(); const first = await planHarness(root, { agents: ["claude-code"] });
  await writeFile(path.join(root, "AGENTS.md"), "# Changed\n"); const second = await planHarness(root, { agents: ["claude-code"] });
  assert.notEqual(first.approvalToken, second.approvalToken);
});

test("plan binds an available Git revision", async () => {
  const root = await fixture(); await execFileAsync("git", ["init", root]); await execFileAsync("git", ["-C", root, "add", "AGENTS.md", "CODEX.md"]); await execFileAsync("git", ["-C", root, "-c", "user.name=AFD Test", "-c", "user.email=afd@example.invalid", "commit", "-m", "fixture"]);
  const plan = await planHarness(root, { agents: ["codex"] }); assert.match(plan.baseRevision ?? "", /^[a-f0-9]{40}$/);
});

test("stage writes only outside the project, is idempotent, and rejects source drift", async () => {
  const root = await fixture(); const output = path.join(await mkdtemp(path.join(tmpdir(), "afd-stage-parent-")), "stage");
  const plan = await planHarness(root, { agents: ["claude-code"] }); const first = await stageHarness(plan, output); const second = await stageHarness(plan, output);
  assert.equal(first.status, "created"); assert.equal(second.status, "unchanged"); assert.match(await readFile(path.join(output, "rendered", "CLAUDE.md"), "utf8"), /AFD project harness adapter/);
  await assert.rejects(access(path.join(root, "CLAUDE.md"))); await writeFile(path.join(root, "AGENTS.md"), "# Drift\n");
  await assert.rejects(stageHarness(plan, path.join(output, "other")), /stale/);
});

test("stage refuses an output inside the target project", async () => {
  const root = await fixture(); const plan = await planHarness(root, { agents: ["claude-code"] });
  await assert.rejects(stageHarness(plan, path.join(root, ".afd-stage")), /outside/);
});
