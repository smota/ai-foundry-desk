import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { NodePlatformAdapter } from "../src/platform.js";

test("platform adapter owns atomic local state and reports ports without a shell", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-platform-"));
  try {
    const adapter = new NodePlatformAdapter({ id: "linux", stateRoot: root });
    const file = path.join(root, "state", "example.json");
    await adapter.writeText(file, "{\"ok\":true}");
    assert.equal(await adapter.readText(file), "{\"ok\":true}");
    await adapter.remove(file);
    assert.equal(await adapter.readText(file), undefined);

    const server = http.createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    assert.equal(await adapter.isListening("127.0.0.1", address.port), true);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.equal(await adapter.isListening("127.0.0.1", address.port), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("platform adapter rejects unpinned and non-HTTPS downloads before network access", async () => {
  const adapter = new NodePlatformAdapter({ id: "linux", stateRoot: tmpdir() });
  await assert.rejects(() => adapter.downloadVerified("http://example.invalid/file", path.join(tmpdir(), "afd-no-write"), "0".repeat(64)), /HTTPS/);
  await assert.rejects(() => adapter.downloadVerified("https://example.invalid/file", path.join(tmpdir(), "afd-no-write"), "invalid"), /SHA-256/);
});

test("platform adapter times out and reaps a command process tree", async () => {
  const adapter = new NodePlatformAdapter();
  const root = await mkdtemp(path.join(tmpdir(), "afd-tree-")); const pidFile = path.join(root, "child.pid");
  try {
    const grandchild = "setInterval(() => {}, 1000)";
    const parent = `const {spawn}=require("node:child_process");const {writeFileSync}=require("node:fs");const child=spawn(process.execPath,["-e",${JSON.stringify(grandchild)}],{stdio:"ignore"});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
    const result = await adapter.run({ executable: process.execPath, args: ["-e", parent], timeoutMs: 2_000 });
    assert.equal(result.timedOut, true); assert.equal(result.status, 124);
    const childPid = Number(await readFile(pidFile, "utf8")); assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(await adapter.isRunning(childPid), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("platform adapter fingerprints one process instance before managed stop", async () => {
  const adapter = new NodePlatformAdapter(); const pid = await adapter.start({ executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] });
  try { const fingerprint = await adapter.processFingerprint(pid); assert.match(fingerprint ?? "", /^[a-f0-9]{64}$/); }
  finally { await adapter.stop(pid); }
  assert.equal(await adapter.processFingerprint(pid), undefined);
});

test("Windows PowerShell shims preserve literal arguments and propagate exit status", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-shim-"));
  const shim = path.join(root, "literal.ps1");
  await writeFile(shim, '[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($args))); exit 7\n');
  const args = ['space here', '"quoted"', '$env:HOME', '%PATH%', 'a&b|c', '`tick`', 'trailing\\', ''];
  const result = await new NodePlatformAdapter().run({ executable: shim, args });
  assert.equal(result.status, 7);
  assert.deepEqual(JSON.parse(result.stdout), args);
});
