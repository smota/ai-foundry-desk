import assert from "node:assert/strict";
import test from "node:test";
import { installAutostart } from "../src/autostart.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

function fake(id: "win32" | "linux" | "darwin"): { readonly adapter: PlatformAdapter; readonly calls: HostCommand[]; readonly writes: readonly [string, string][] } {
  const calls: HostCommand[] = []; const writes: [string, string][] = [];
  return { calls, writes, adapter: { id, stateRoot: "/state", async run(command) { calls.push(command); return { status: 0, stdout: id === "darwin" && command.executable === "id" ? "501\n" : "", stderr: "", timedOut: false }; }, async start() { return 1; }, async stop() {}, async isRunning() { return false; }, async processFingerprint() { return undefined; }, async isListening() { return false; }, async writeText(file, text) { writes.push([file, text]); }, async readText() { return undefined; }, async remove() {}, async downloadVerified() {} } };
}

const command: HostCommand = { executable: "/tool/collector", args: ["--config=/state/config.yaml"], cwd: "/state", env: { AFD_LOCAL: "true" } };
test("Windows autostart is a scoped HKCU Run entry without PowerShell", async () => { const value = fake("win32"); await installAutostart(value.adapter, "host", command); assert.equal(value.calls[0]?.executable, "reg.exe"); assert.match(value.calls[0]?.args.join(" ") ?? "", /CurrentVersion\\Run/); assert.match(value.calls[0]?.args.join(" ") ?? "", /AFD-Observability-host/); assert.doesNotMatch(value.calls[0]?.args.join(" ") ?? "", /powershell/i); });
test("Linux and macOS autostart render native service definitions", async () => { const linux = fake("linux"); await installAutostart(linux.adapter, "agents", command); assert.match(linux.writes[0]?.[1] ?? "", /ExecStart=/); assert.equal(linux.calls[0]?.executable, "systemctl"); const mac = fake("darwin"); await installAutostart(mac.adapter, "agents", command); assert.match(mac.writes[0]?.[1] ?? "", /ProgramArguments/); assert.equal(mac.calls.at(-1)?.executable, "launchctl"); });
