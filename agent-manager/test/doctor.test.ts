import assert from "node:assert/strict";
import test from "node:test";
import { doctor, executionIdentity, probeExecutableVersion, resolveCommandCandidates } from "../src/doctor.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

function adapter(options: { readonly timeout?: string; readonly calls?: HostCommand[] } = {}): PlatformAdapter {
  return {
    id: "win32", stateRoot: "C:\\state",
    async run(command: HostCommand) {
      options.calls?.push(command);
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

test("doctor uses the native Go version contract", async () => {
  const calls: HostCommand[] = [];
  await doctor(adapter({ calls }));
  const go = calls.find((command) => command.executable.endsWith("go.exe"));
  assert.deepEqual(go?.args, ["version"]);
});

test("doctor preserves multiple user-managed resolutions and reports compatibility", async () => {
  const value = adapter();
  const original = value.run.bind(value);
  value.run = async (command) => command.executable === "where.exe" && command.args[0] === "pnpm"
    ? { status: 0, stdout: "C:\\user\\pnpm.exe\nC:\\other\\pnpm.exe\n", stderr: "", timedOut: false }
    : command.executable === "C:\\user\\pnpm.exe"
      ? { status: 0, stdout: "12.3.4\n", stderr: "", timedOut: false }
      : original(command);
  assert.deepEqual(await resolveCommandCandidates(value, "pnpm"), ["C:\\user\\pnpm.exe", "C:\\other\\pnpm.exe"]);
  const rows = await doctor(value);
  const pnpm = rows.find((row) => row.id === "command.pnpm");
  assert.equal(pnpm?.status, "PASS");
  assert.match(pnpm?.detail ?? "", /12\.3\.4.*2 PATH candidates.*user-managed/);
});

test("Linux command discovery rejects Windows launchers inherited through WSL interop", async () => {
  const value = adapter();
  Object.defineProperty(value, "id", { value: "linux" });
  value.run = async (command) => command.executable === "which"
    ? { status: 0, stdout: "/mnt/c/Users/person/AppData/Local/pnpm/bin/allow-scripts\n/home/person/.local/bin/allow-scripts\n", stderr: "", timedOut: false }
    : { status: 0, stdout: "person\n", stderr: "", timedOut: false };
  assert.deepEqual(await resolveCommandCandidates(value, "allow-scripts"), ["/home/person/.local/bin/allow-scripts"]);
});

test("doctor warns without replacing an incompatible user-managed update", async () => {
  const value = adapter();
  const original = value.run.bind(value);
  value.run = async (command) => command.executable.endsWith("pnpm.exe")
    ? { status: 0, stdout: "13.0.0\n", stderr: "", timedOut: false }
    : original(command);
  const rows = await doctor(value);
  const pnpm = rows.find((row) => row.id === "command.pnpm");
  assert.equal(pnpm?.status, "WARN");
  assert.match(pnpm?.remedy ?? "", /will not replace/);
});

test("Windows batch version probes use a fixed encoded wrapper, never cmd interpolation", async () => {
  const calls: HostCommand[] = [];
  const value = adapter({ calls });
  await probeExecutableVersion(value, "C:\\Users\\person\\bin\\codex.cmd", ["--version"]);
  const invocation = calls.at(-1);
  assert.equal(invocation?.executable, "powershell.exe");
  assert.deepEqual(invocation?.args.slice(0, 2), ["-NoProfile", "-EncodedCommand"]);
  assert.match(Buffer.from(invocation?.args[2] ?? "", "base64").toString("utf16le"), /Test-Path -LiteralPath.*LASTEXITCODE/);
  assert.equal(calls.some((call) => call.executable === "cmd.exe"), false);
  await assert.rejects(async () => {
    const result = await probeExecutableVersion(value, "C:\\unsafe&path\\codex.cmd", ["--version"]);
    if (result.status !== 0) throw new Error(result.stderr);
  }, /Unsafe batch/);
});
