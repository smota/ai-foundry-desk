import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bytesDigest, parseProjectBrief, projectDigest } from "../src/project-contracts.js";
import { assertProjectCurrent, planProject, stageProject, verifyStage } from "../src/project-plan.js";
import { applyProject, recoverProject, rollbackProject, verifyProjectReceipt } from "../src/project-apply.js";
import { validateProject } from "../src/project-validate.js";
import { runProjectCommand } from "../src/project-command.js";
import { NodePlatformAdapter } from "../src/platform.js";
import { renderProject } from "../src/project-recipes.js";
import { projectExists } from "../src/project-files.js";
import { assertHarnessPlanCurrent, planHarness } from "../src/harness-plan.js";
import { testHarness } from "../src/harness-smoke.js";
import { applyHarnessPlan } from "../src/harness-apply.js";

function brief(recipe = "policy-only", agents = ["claude-code", "pi"]): unknown {
  return { schemaVersion: 1, project: { name: "sample", purpose: "A reproducible test foundation." }, desiredHarnesses: agents,
    foundation: { recipe: { id: recipe, version: "1" }, ...(recipe === "rust-workspace" ? { toolchain: { version: "1.98.0", edition: "2024" }, components: ["domain", "engine"] } : {}) },
    policy: { canonical: "AGENTS.md", engineering: "ai-coded-human-governed", architectureDecisions: "adr-v1", skills: "none" } };
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(tmpdir(), "afd-project-test-"));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); });
  return { root, target: path.join(root, "project"), options: { stateDirectory: path.join(root, "state"), adapter: new NodePlatformAdapter({ id: "linux" }) } };
}

test("strict brief preserves exact agents and rejects unknown choices, unsafe paths, and missing legal owner", () => {
  const parsed = parseProjectBrief(brief()); assert.deepEqual(parsed.desiredHarnesses, ["claude-code", "pi"]);
  assert.throws(() => parseProjectBrief({ ...parsed, ignored: true }), /unknown/);
  assert.throws(() => parseProjectBrief({ ...parsed, licensing: { spdx: "Apache-2.0", rightsHolder: null } }), /rights holder/);
  for (const key of ["../escape", "C:/escape", ".env", "docs/CON.txt", "docs/file.", "foo\\bar"]) assert.throws(() => parseProjectBrief({ ...parsed, files: { [key]: "bad" } }), /path/);
  assert.throws(() => parseProjectBrief({ ...parsed, desiredHarnesses: ["pi", "pi"] }), /unique/);
});

test("inspection and planning create nothing and are deterministic for a missing target", async t => {
  const { root, target } = await fixture(t); const before = await readdir(root);
  const a = await planProject(target, brief()); const b = await planProject(target, brief());
  assert.equal(a.approvalToken, b.approvalToken); assert.deepEqual(await readdir(root), before);
  assert.equal(await projectExists(target), false);
  const out: string[] = []; await runProjectCommand(["inspect", target, "--agents", "pi,agy", "--json"], v => out.push(v));
  assert.deepEqual(JSON.parse(out[0]!).desiredHarnesses, ["agy", "pi"]);
  assert.deepEqual(await readdir(root), before);
});

test("foundation apply, verify, repeat and rollback work without Git or models", async t => {
  const { root, target, options } = await fixture(t); const plan = await planProject(target, brief());
  await stageProject(plan, path.join(root, "stage"));
  assert.equal((await validateProject(path.join(root, "stage"), "structural")).state, "passed");
  const applied = await applyProject(plan, plan.approvalToken, options);
  assert.equal((await verifyProjectReceipt(applied.receipt, options)).valid, true);
  assert.equal((await applyProject(plan, plan.approvalToken, options)).state, "unchanged");
  assert.equal(await projectExists(path.join(target, ".git")), false);
  assert.equal(await projectExists(path.join(target, "CLAUDE.md")), false);
  await rollbackProject(applied.receipt, plan.approvalToken, options);
  assert.equal(await projectExists(target), false);
  assert.equal((await verifyProjectReceipt(applied.receipt, options)).valid, true);
});

test("unborn Git content drift invalidates same-status plans", async t => {
  const { target } = await fixture(t); await mkdir(target);
  await promisify(execFile)("git", ["init", target]);
  const parsed = parseProjectBrief(brief());
  await writeFile(path.join(target, "AGENTS.md"), "# Existing\nKeep this policy.\n");
  parsed.files = { "AGENTS.md": "# Existing\nKeep this policy.\n" };
  const plan = await planProject(target, parsed);
  assert.equal(plan.blockers.length, 0);
  await writeFile(path.join(target, "AGENTS.md"), "# Existing\nChanged policy.\n");
  await assert.rejects(assertProjectCurrent(plan), /drift/);
});

test("conflicting project-owned policy blocks apply and preserves original bytes", async t => {
  const { target, options } = await fixture(t); await mkdir(target); await writeFile(path.join(target, "AGENTS.md"), "User policy");
  const plan = await planProject(target, brief()); assert.ok(plan.blockers.length);
  await assert.rejects(applyProject(plan, plan.approvalToken, options), /Preserve/);
  assert.equal(await readFile(path.join(target, "AGENTS.md"), "utf8"), "User policy");
});

test("stale target and edited or injected stage files fail closed", async t => {
  const { root, target } = await fixture(t); const plan = await planProject(target, brief());
  const stage = path.join(root, "stage"); await stageProject(plan, stage);
  await writeFile(path.join(stage, "candidate", "injected.txt"), "surprise");
  await assert.rejects(verifyStage(stage), /Unexpected staged/);
  await mkdir(target); await writeFile(path.join(target, "other.txt"), "concurrent");
  await assert.rejects(assertProjectCurrent(plan), /drift/);
});

test("plan tampering, case collision and required-closure omissions are rejected", async t => {
  const { root, target } = await fixture(t); const plan = await planProject(target, brief());
  plan.files[0]!.content = "modified";
  await assert.rejects(stageProject(plan, path.join(root, "stage")), /modified/);
  const parsed = parseProjectBrief(brief()); parsed.files = { "agents.md": "duplicate" };
  await assert.rejects(planProject(target, parsed), /Case/);
  delete parsed.files; parsed.policyClosure = ["missing.md"];
  await assert.rejects(planProject(target, parsed), /missing/);
});

test("interrupted apply is recoverable without deleting unrelated work", async t => {
  const { target, options } = await fixture(t); const plan = await planProject(target, brief());
  await assert.rejects(applyProject(plan, plan.approvalToken, { ...options, afterWrite: count => { if (count === 3) throw new Error("simulated crash"); } }), /simulated crash/);
  const receipt = path.join(options.stateDirectory, `${plan.approvalToken}.json`);
  await writeFile(path.join(target, "user.txt"), "preserve");
  assert.equal((await verifyProjectReceipt(receipt, options)).state, "applying");
  await recoverProject(receipt, plan.approvalToken, options);
  assert.equal(await readFile(path.join(target, "user.txt"), "utf8"), "preserve");
});

test("rollback refuses user drift and dependent harness artifacts", async t => {
  const { target, options } = await fixture(t); const plan = await planProject(target, brief());
  const applied = await applyProject(plan, plan.approvalToken, options);
  await writeFile(path.join(target, "CLAUDE.md"), "Read AGENTS.md");
  await assert.rejects(rollbackProject(applied.receipt, plan.approvalToken, options), /Dependent/);
  await rm(path.join(target, "CLAUDE.md"));
  await writeFile(path.join(target, "README.md"), "user edit");
  await assert.rejects(rollbackProject(applied.receipt, plan.approvalToken, options), /user content changed/);
  assert.equal(await readFile(path.join(target, "README.md"), "utf8"), "user edit");
});

test("all five harnesses can be selected without invoking or claiming activation", async t => {
  const { target, options } = await fixture(t);
  const plan = await planProject(target, brief("policy-only", ["codex", "claude-code", "pi", "grok", "agy"]));
  await applyProject(plan, plan.approvalToken, options);
  const out: string[] = []; const exit = await runProjectCommand(["status", target, "--json"], s => out.push(s));
  const report = JSON.parse(out[0]!); assert.equal(exit, 2); assert.equal(report.harnesses, "pending");
  assert.equal(report.complete, false); assert.equal(report.desiredHarnesses.length, 5);
});

test("Rust recipe and Apache license are deterministic and structural checks pass unchanged", async t => {
  const { root, target } = await fixture(t); const parsed = parseProjectBrief(brief("rust-workspace"));
  parsed.licensing = { spdx: "Apache-2.0", rightsHolder: "Test Maintainer" };
  const plan = await planProject(target, parsed);
  assert.ok(plan.files.some(f => f.path === "LICENSE" && f.sha256 === "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"));
  assert.ok(plan.files.some(f => f.path === "Cargo.lock"));
  const stage = path.join(root, "stage"); await stageProject(plan, stage);
  assert.equal((await validateProject(stage, "structural")).state, "passed");
  assert.deepEqual(plan.files, (await renderProject(parsed)).files);
});

test("Git checkout preserves pinned Apache license bytes with Windows autocrlf enabled", async t => {
  const { root } = await fixture(t);
  const repository = path.join(root, "repository");
  const licensePath = "recipes/project-init/Apache-2.0.txt";
  const content = await readFile(path.resolve("..", licensePath));
  await mkdir(path.join(repository, "recipes/project-init"), { recursive: true });
  await writeFile(path.join(repository, licensePath), content);
  const git = (args: string[]) => promisify(execFile)("git", ["-C", repository, "-c", "core.autocrlf=true", ...args], { windowsHide: true });
  await git(["init"]);
  await git(["add", licensePath]);
  const before = path.join(root, "before").replaceAll("\\", "/") + "/";
  await git(["checkout-index", `--prefix=${before}`, "--", licensePath]);
  assert.notEqual(bytesDigest(await readFile(path.join(before, licensePath))), "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30");
  await writeFile(path.join(repository, ".gitattributes"), await readFile(path.resolve("..", ".gitattributes")));
  await git(["add", ".gitattributes"]);
  const after = path.join(root, "after").replaceAll("\\", "/") + "/";
  await git(["checkout-index", `--prefix=${after}`, "--", licensePath]);
  assert.equal(bytesDigest(await readFile(path.join(after, licensePath))), "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30");
});

test("broken reviewed links block apply instead of requiring later repair", async t => {
  const { target } = await fixture(t); const parsed = parseProjectBrief(brief());
  parsed.files = { "AGENTS.md": "# Instructions\nRead [missing](missing.md).\n" };
  const plan = await planProject(target, parsed); assert.match(plan.blockers.join(""), /Missing or unsafe/);
});

test("harness handoff preserves selection, binds closure, and rejects duplicate or stale evidence", async t => {
  const { root, target, options } = await fixture(t); const plan = await planProject(target, brief());
  await applyProject(plan, plan.approvalToken, options);
  const harness = await planHarness(target, { agents: ["claude-code", "pi"] });
  assert.deepEqual(harness.selectedAgents, ["claude-code", "pi"]);
  assert.ok(harness.policyFiles?.some(f => f.path === "docs/engineering.md"));
  let invocations = 0;
  const report = await testHarness(harness, { live: true, runner: async command => {
    if (["where.exe", "which"].includes(command.executable) || command.args.includes("--version")) return { status: 0, stdout: "fixture-1.0\n", stderr: "", timedOut: false };
    invocations++;
    const files: Record<string, string> = {};
    for (const f of harness.policyFiles!) {
      const content = await readFile(path.join(command.cwd!, f.path), "utf8");
      assert.equal(content, f.content);
      if (f.path !== "AGENTS.md" && f.path !== ".afd/project.json") files[f.path] = content;
    }
    const response = { agent: command.executable === "claude" ? "claude-code" : "pi", canonicalPath: "AGENTS.md", firstHeading: "# sample project instructions", finalInstructionLine: "Preserve scope, evidence, and explicit human authorization.", writeAttempted: false, policyFiles: files };
    return { status: 0, stdout: `AFD_HARNESS_SMOKE_V1:${JSON.stringify(response)}`, stderr: "", timedOut: false };
  } });
  assert.equal(invocations, 2); assert.equal(report.passed, true);
  const { evidenceToken: _token, ...base } = report; void _token;
  const duplicates = { ...base, results: [report.results[0]!, report.results[0]!] };
  const duplicateFile = path.join(root, "duplicate.json");
  await writeFile(duplicateFile, JSON.stringify({ ...duplicates, evidenceToken: projectDigest(duplicates) }));
  await assert.rejects(applyHarnessPlan(harness, { evidence: duplicateFile, confirm: harness.approvalToken, adapter: options.adapter }), /duplicate or foreign/);
  const expired = { ...base, runtimeBinding: { ...report.runtimeBinding!, observedAt: "2000-01-01T00:00:00Z" } };
  const expiredFile = path.join(root, "expired.json");
  await writeFile(expiredFile, JSON.stringify({ ...expired, evidenceToken: projectDigest(expired) }));
  await assert.rejects(applyHarnessPlan(harness, { evidence: expiredFile, confirm: harness.approvalToken, adapter: options.adapter }), /stale/);
  await writeFile(path.join(target, "docs/engineering.md"), "changed");
  await assert.rejects(assertHarnessPlanCurrent(harness), /supporting policy/);
});
