import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function cli(...args: string[]) {
  return spawnSync(process.execPath, [".test-dist/src/cli.js", ...args], { cwd: process.cwd(), encoding: "utf8" });
}
function isolatedCli(root: string, ...args: string[]) { return spawnSync(process.execPath, [path.join(process.cwd(), ".test-dist", "src", "cli.js"), ...args], { cwd: path.join(root, "project"), env: { ...process.env, USERPROFILE: path.join(root, "home"), HOME: path.join(root, "home"), LOCALAPPDATA: path.join(root, "local") }, encoding: "utf8" }); }

test("help and version use the afd brand", () => {
  const help = cli("--help"); const version = cli("--version");
  assert.equal(help.status, 0); assert.match(help.stdout, /AI Foundry Desk/); assert.match(help.stdout, /afd layer1/); assert.match(help.stdout, /afd tui/);
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), "0.6.4");
});

test("TUI refuses non-interactive streams and preserves CLI parity", () => {
  const tui = cli("tui");
  assert.equal(tui.status, 1);
  assert.match(tui.stderr, /requires an interactive terminal/);
  assert.match(tui.stderr, /line-oriented afd CLI/);
});

test("init applies no layers and unknown mutating flags are rejected", () => {
  const init = cli("init", "--dry-run"); const typo = cli("sync", "--typo");
  assert.equal(init.status, 0); assert.match(init.stdout, /No layer was applied/);
  assert.notEqual(typo.status, 0); assert.match(typo.stderr, /Usage: afd sync/);
});

test("doctor and fix expose safe argument contracts", () => {
  const doctor = cli("doctor", "--write"); const fix = cli("fix", "layer1"); const sandbox = cli("fix", "sandbox");
  assert.notEqual(doctor.status, 0); assert.match(doctor.stderr, /Usage: afd doctor/);
  assert.notEqual(fix.status, 0); assert.match(fix.stderr, /exactly one option/);
  assert.notEqual(sandbox.status, 0); assert.match(sandbox.stderr, /exactly one option/);
});

test("provenance identifies the running CLI and hybrid repair fails closed", () => {
  const provenance = cli("provenance", "--json"); const repair = cli("fix", "layer1", "--dry-run");
  assert.equal(provenance.status, 0); const value = JSON.parse(provenance.stdout) as { version?: string; cli?: string; identity?: { context?: string } };
  assert.equal(value.version, "0.6.4"); assert.match(value.cli ?? "", /cli\.js$/);
  if (value.identity?.context === "hybrid") { assert.notEqual(repair.status, 0); assert.match(repair.stderr, /identity do not match/); }
});

test("Hermes update requires an explicit preview or apply mode",()=>{const missing=cli("hermes","update");const conflict=cli("hermes","update","--dry-run","--apply");assert.notEqual(missing.status,0);assert.match(missing.stderr,/exactly one/);assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/exactly one/);});

test("telemetry exposes the recipe plan and rejects the removed observe contract", () => {
  const plan = cli("telemetry", "plan"); const removed = cli("observe", "agents", "plan");
  assert.ok(plan.status === 0 || plan.status === 2); assert.match(plan.stdout, /"id": "observability"/); assert.match(plan.stdout, /agentacct 0\.10\.1/); assert.match(plan.stdout,/"preflight"/);
  assert.notEqual(removed.status, 0); assert.match(removed.stderr, /removed before release/);
});

test("telemetry apply uses the recipe plan token as its single consent boundary", () => {
  const apply = cli("telemetry", "apply");
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /plan-token/);
});

test("harness audit rejects incomplete arguments without entering a mutating path", () => {
  const audit = cli("harness", "audit");
  assert.notEqual(audit.status, 0); assert.match(audit.stderr, /Usage: afd harness audit/);
});

test("MCP CLI exposes redacted plans and requires an exact mutation mode", () => {
  const root=mkdtempSync(path.join(tmpdir(),"afd-mcp-cli-"));mkdirSync(path.join(root,"home",".afd","mcp"),{recursive:true});mkdirSync(path.join(root,"project"),{recursive:true});writeFileSync(path.join(root,"home",".afd","mcp","user.json"),JSON.stringify({schemaVersion:1,servers:{demo:{transport:"stdio",command:"node",args:["server.js"],enabled:true,targets:["codex","grok"]}}}));
  const plan=isolatedCli(root,"mcp","sync","--scope","user","--agents","codex,grok","--dry-run","--json");assert.equal(plan.status,0,plan.stderr);const parsed=JSON.parse(plan.stdout) as {approvalToken?:string;actions?:unknown[];desiredUser?:unknown};assert.match(parsed.approvalToken??"",/^[a-f0-9]{64}$/);assert.ok(parsed.actions?.length);assert.equal(parsed.desiredUser,undefined);
  const missing=isolatedCli(root,"mcp","sync","--scope","user","--agents","codex,grok");assert.notEqual(missing.status,0);assert.match(missing.stderr,/exactly one/);
  const typo=isolatedCli(root,"mcp","sync","--scope","user","--agents","codex,grok","--dry-run","--typo");assert.notEqual(typo.status,0);assert.match(typo.stderr,/Unknown MCP option/);
  const missingValue=isolatedCli(root,"mcp","sync","--scope","--dry-run");assert.notEqual(missingValue.status,0);assert.match(missingValue.stderr,/requires a value/);
  const unverified=isolatedCli(root,"mcp","discover","pi","--scope","user","--json");assert.notEqual(unverified.status,0);assert.match(unverified.stderr,/no verified native adapter/);
});

test("MCP catalog exposes per-scope capability instead of silently claiming all-agent support",()=>{const result=cli("catalog");assert.equal(result.status,0);assert.match(result.stdout,/hermes.*mcp-project=unsupported/);assert.match(result.stdout,/antigravity.*mcp-project=native/);assert.match(result.stdout,/pi.*mcp-project=extension/);});
