import assert from "node:assert/strict";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { NodePlatformAdapter, type HostCommand } from "../src/platform.js";
import { executeProject, projectCommand, projectDoctor } from "../src/project-environment.js";

test("project execution bounds mise discovery without mutating global trust or PATH", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-project-env-"));
  const before = { ceiling: process.env.MISE_CEILING_PATHS, trust: process.env.MISE_TRUSTED_CONFIG_PATHS, path: process.env.PATH };
  const command = await projectCommand(root, "cargo", ["test", "--locked"]);
  assert.equal(command.cwd, await realpath(root));
  assert.deepEqual(command.env, { MISE_CEILING_PATHS: await realpath(root), MISE_NOT_FOUND_AUTO_INSTALL: "false" });
  assert.deepEqual(command.args, ["test", "--locked"]);
  assert.deepEqual({ ceiling: process.env.MISE_CEILING_PATHS, trust: process.env.MISE_TRUSTED_CONFIG_PATHS, path: process.env.PATH }, before);
});

test("project doctor never calls version-only success a verified MSVC environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-project-doctor-"));
  class Fake extends NodePlatformAdapter {
    constructor() { super({ id: "win32" }); }
    override async run(command: HostCommand) {
      return { status: 0, timedOut: false, stderr: "", stdout: command.args.includes("Inspect") ? '{"ready":false}' : command.executable === "whoami.exe" ? "host\\user" : "1.0.0" };
    }
  }
  const rows = await projectDoctor(root, root, new Fake());
  assert.equal(rows.find(row => row.id === "project.cargo")?.status, "PASS");
  assert.equal(rows.find(row => row.id === "project.rust-msvc")?.status, "FAIL");
});

test("project execution propagates failure and routes Windows Cargo through scoped developer activation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-project-run-"));
  await writeFile(path.join(root, "mise.toml"), '[tools]\nrust="1.98.0"\n');
  const calls: HostCommand[] = [];
  class Fake extends NodePlatformAdapter {
    constructor() { super({ id: "win32" }); }
    override async run(command: HostCommand) { calls.push(command); return { status: 17, stdout: "", stderr: "", timedOut: false }; }
  }
  assert.equal(await executeProject(root, "cargo", ["test", "--locked"], root, new Fake()), 17);
  assert.equal(calls[0]?.executable, "powershell.exe");
  const args = calls[0]!.args;
  assert.equal(args[args.indexOf("-Mode") + 1], "Run");
  assert.deepEqual(JSON.parse(Buffer.from(args[args.indexOf("-ArgumentsBase64") + 1]!, "base64").toString()), ["test", "--locked"]);
});
