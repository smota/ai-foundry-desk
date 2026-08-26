import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: process.cwd(), encoding: "utf8" });
}

test("help and version use the afd brand", () => {
  const help = cli("--help"); const version = cli("--version");
  assert.equal(help.status, 0); assert.match(help.stdout, /AI Foundry Desk/); assert.match(help.stdout, /afd layer1/);
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), "0.1.2");
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
