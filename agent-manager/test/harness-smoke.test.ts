import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { HostCommand, CommandResult } from "../src/platform.js";
import { planHarness } from "../src/harness-plan.js";
import { testHarness, writeHarnessEvidence } from "../src/harness-smoke.js";

async function fixture(): Promise<string> { const root = await mkdtemp(path.join(tmpdir(), "afd-smoke-")); await writeFile(path.join(root, "AGENTS.md"), "# Project rules\n\nUse pnpm.\nPreserve user work.\n"); return root; }
function response(command: HostCommand, overrides: Partial<CommandResult> = {}): CommandResult { return { status: 0, stdout: command.executable === "where.exe" || command.executable === "which" ? "found\n" : command.args.includes("--version") ? "1.0.0\n" : "", stderr: "", timedOut: false, ...overrides }; }
function passingRunner(): (command: HostCommand) => Promise<CommandResult> { return async (command) => { const base = response(command); if (command.executable === "where.exe" || command.executable === "which" || command.args.includes("--version")) return base; const agent = command.executable === "claude" ? "claude-code" : command.executable; return response(command, { stdout: `AFD_HARNESS_SMOKE_V1:{"agent":"${agent}","canonicalPath":"AGENTS.md","firstHeading":"# Project rules","finalInstructionLine":"Preserve user work.","writeAttempted":false}\n` }); }; }

test("preflight reports supported, unavailable, and unsupported targets without running agents", async () => {
  const root = await fixture(); const plan = await planHarness(root, { agents: ["codex", "pi", "agy"] }); let liveCalls = 0;
  const report = await testHarness(plan, { runner: async (command) => { if (!["where.exe", "which"].includes(command.executable) && !command.args.includes("--version")) liveCalls++; if (command.executable === "where.exe" && command.args[0] === "pi") return response(command, { status: 1 }); return response(command); } });
  assert.equal(liveCalls, 0); assert.equal(report.ready, false); assert.equal(report.passed, false); assert.equal(report.results.find((item) => item.agent === "codex")?.state, "not-run"); assert.equal(report.results.find((item) => item.agent === "pi")?.state, "unavailable"); assert.equal(report.results.find((item) => item.agent === "agy")?.state, "unsupported");
});

test("live smoke passes only when every selected agent returns identical canonical policy evidence", async () => {
  const root = await fixture(); const plan = await planHarness(root, { agents: ["codex", "claude-code", "pi"] }); const report = await testHarness(plan, { live: true, runner: passingRunner() });
  assert.equal(report.ready, true); assert.equal(report.passed, true); assert.equal(report.consistent, true); assert.ok(report.results.every((item) => item.state === "passed")); assert.equal(new Set(report.results.map((item) => item.policyFingerprint)).size, 1);
});

test("live smoke fails closed on one inconsistent agent", async () => {
  const root = await fixture(); const plan = await planHarness(root, { agents: ["codex", "pi"] }); const pass = passingRunner();
  const report = await testHarness(plan, { live: true, runner: async (command) => command.executable === "pi" && !command.args.includes("--version") ? response(command, { stdout: "AFD_HARNESS_SMOKE_V1:{\"agent\":\"pi\",\"canonicalPath\":\"AGENTS.md\",\"firstHeading\":\"# Wrong\",\"finalInstructionLine\":\"Preserve user work.\",\"writeAttempted\":false}" }) : pass(command) });
  assert.equal(report.passed, false); assert.equal(report.results.find((item) => item.agent === "pi")?.state, "failed");
});

test("live smoke detects disposable workspace mutation and evidence stays outside the project", async () => {
  const root = await fixture(); const plan = await planHarness(root, { agents: ["codex"] });
  await assert.rejects(testHarness(plan, { live: true, runner: async (command) => { if (!["where.exe", "which"].includes(command.executable) && !command.args.includes("--version")) await writeFile(path.join(command.cwd!, "AGENTS.md"), "# Mutated\n"); return response(command); } }), /disposable workspace/);
  assert.equal(await readFile(path.join(root, "AGENTS.md"), "utf8"), "# Project rules\n\nUse pnpm.\nPreserve user work.\n"); const current = await planHarness(root, { agents: ["codex"] }); const report = await testHarness(current, { live: true, runner: passingRunner() }); const evidence = path.join(await mkdtemp(path.join(tmpdir(), "afd-evidence-")), "smoke.json");
  await writeHarnessEvidence(report, evidence); assert.equal(JSON.parse(await readFile(evidence, "utf8")).evidenceToken, report.evidenceToken); await assert.rejects(writeHarnessEvidence(report, path.join(root, "evidence.json")), /outside/);
});
