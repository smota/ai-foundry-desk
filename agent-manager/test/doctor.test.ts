import assert from "node:assert/strict";
import test from "node:test";
import { doctor, executionIdentity } from "../src/doctor.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

function adapter(options: { readonly timeout?: string } = {}): PlatformAdapter {
  return {
    id: "win32", stateRoot: "C:\\state",
    async run(command: HostCommand) {
      if (command.executable === "whoami.exe") return { status: 0, stdout: "host\\codexsandboxoffline\n", stderr: "", timedOut: false };
      if (command.executable === "where.exe") return { status: 0, stdout: `C:\\tools\\${command.args[0]}.exe\n`, stderr: "", timedOut: false };
      if (command.executable.endsWith((options.timeout ?? "") + ".exe") && options.timeout) return { status: 124, stdout: "", stderr: "", timedOut: true };
      return { status: 0, stdout: command.executable.endsWith("node.exe") ? "v24.19.0\n" : "1.0.0\n", stderr: "", timedOut: false };
    },
    async start() { return 1; }, async stop() {}, async isRunning() { return false; }, async processFingerprint() { return undefined; }, async isListening() { return false; },
    async writeText() {}, async readText() { return undefined; }, async remove() {}, async downloadVerified() {},
  };
}

test("doctor identifies a hybrid sandbox identity and executable provenance", async () => {
  const identity = await executionIdentity(adapter());
  assert.equal(identity.context, "hybrid"); assert.equal(identity.mismatch, true);
  const rows = await doctor(adapter());
  assert.equal(rows.find((row) => row.id === "execution.identity")?.status, "WARN");
  assert.equal(rows.find((row) => row.id === "command.node")?.status, "PASS");
  assert.match(rows.find((row) => row.id === "command.node")?.detail ?? "", /C:\\tools\\node\.exe/);
});

test("doctor treats a resolved command timeout as failure", async () => {
  const rows = await doctor(adapter({ timeout: "pnpm" }));
  const pnpm = rows.find((row) => row.id === "command.pnpm");
  assert.equal(pnpm?.status, "FAIL"); assert.match(pnpm?.detail ?? "", /timed out/);
});
