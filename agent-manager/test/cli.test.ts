import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function cli(...args: string[]) {
  return spawnSync(process.execPath, [".test-dist/src/cli.js", ...args], { cwd: process.cwd(), encoding: "utf8" });
}

test("help and version use the afd brand", () => {
  const help = cli("--help"); const version = cli("--version");
  assert.equal(help.status, 0); assert.match(help.stdout, /AI Foundry Desk/); assert.match(help.stdout, /afd layer1/);
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), "0.3.0");
});

test("init applies no layers and unknown mutating flags are rejected", () => {
  const init = cli("init", "--dry-run"); const typo = cli("sync", "--typo");
  assert.equal(init.status, 0); assert.match(init.stdout, /No layer was applied/);
  assert.notEqual(typo.status, 0); assert.match(typo.stderr, /Usage: afd sync/);
});

test("doctor and fix expose safe argument contracts", () => {
  const doctor = cli("doctor", "--write"); const fix = cli("fix", "layer1");
  assert.notEqual(doctor.status, 0); assert.match(doctor.stderr, /Usage: afd doctor/);
  assert.notEqual(fix.status, 0); assert.match(fix.stderr, /exactly one option/);
});

test("provenance identifies the running CLI and hybrid repair fails closed", () => {
  const provenance = cli("provenance", "--json"); const repair = cli("fix", "layer1", "--dry-run");
  assert.equal(provenance.status, 0); const value = JSON.parse(provenance.stdout) as { version?: string; cli?: string; identity?: { context?: string } };
  assert.equal(value.version, "0.3.0"); assert.match(value.cli ?? "", /cli\.js$/);
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
