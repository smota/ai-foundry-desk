import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyHostPlan, loadHostReceipt, planHostLayer, recoverHostLayer, rollbackHostLayer, verifyHostLayer } from "../src/host-lifecycle.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

const versions: Readonly<Record<string, string>> = {
  mise: "2026.8.14", uv: "uv 0.12.10", pnpm: "12.3.4", node: "v24.19.0",
  python: "Python 3.14.7", go: "go version go1.26.7 linux/amd64", rustc: "rustc 1.98.0",
};

async function fixture(options: { readonly failInstall?: boolean } = {}) {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "afd-host-lifecycle-"));
  const files = new Map<string, string>();
  const miseConfig = path.posix.join(stateRoot, ".config", "ai-foundry-desk", "mise", "config.toml");
  files.set(miseConfig, '[tools]\nnode = "24"\npython = "3.14"\ngo = "1.26"\nrust = "1.98.0"\n');
  const calls: HostCommand[] = [];
  let allowScripts = false;
  const adapter: PlatformAdapter = {
    id: "linux", stateRoot,
    async run(command) {
      calls.push(command);
      if (command.executable === "id" && command.args[0] === "-un") return { status: 0, stdout: "user\n", stderr: "", timedOut: false };
      if (command.executable === "chmod") return { status: 0, stdout: "", stderr: "", timedOut: false };
      if (command.executable === "which") {
        const name = command.args[0] ?? "";
        if (name === "allow-scripts" && !allowScripts) return { status: 1, stdout: "", stderr: "", timedOut: false };
        return versions[name] || name === "allow-scripts"
          ? { status: 0, stdout: `/tools/${name}\n`, stderr: "", timedOut: false }
          : { status: 1, stdout: "", stderr: "", timedOut: false };
      }
      const name = path.basename(command.executable);
      if (name === "pnpm") {
        if (command.args[0] === "view") return { status: 0, stdout: '"sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w=="\n', stderr: "", timedOut: false };
        if (command.args[0] === "add") {
          if (options.failInstall) return { status: 1, stdout: "", stderr: "injected install failure", timedOut: false };
          allowScripts = true; return { status: 0, stdout: "installed\n", stderr: "", timedOut: false };
        }
        if (command.args[0] === "bin") return { status: 0, stdout: "/global/bin\n", stderr: "", timedOut: false };
      }
      if (allowScripts && (command.executable === "/global/bin/allow-scripts" || name === "allow-scripts")) return { status: 0, stdout: "5.1.0\n", stderr: "", timedOut: false };
      const version = versions[name];
      return version ? { status: 0, stdout: `${version}\n`, stderr: "", timedOut: false } : { status: 1, stdout: "", stderr: "missing", timedOut: false };
    },
    async start() { return 1; }, async stop() {}, async isRunning() { return false; }, async processFingerprint() { return undefined; }, async isListening() { return false; },
    async writeText(file, text) { files.set(file, text); }, async readText(file) { return files.get(file); }, async remove(file) { files.delete(file); }, async downloadVerified() {},
  };
  return { adapter, calls, stateRoot, setAllowScripts(value: boolean) { allowScripts = value; }, removeMiseConfig() { files.delete(miseConfig); } };
}

test("Layer 1 first install verifies the exact pnpm launcher and writes a complete receipt", async () => {
  const value = await fixture();
  try {
    const plan = await planHostLayer(1, { adapter: value.adapter, home: value.stateRoot });
    assert.equal(plan.blocked, false);
    assert.equal(plan.actions.find((item) => item.id === "allow-scripts")?.kind, "install");
    const receipt = await applyHostPlan(plan, plan.approvalToken, { adapter: value.adapter, home: value.stateRoot });
    assert.equal(receipt.status, "complete");
    assert.equal(receipt.checkpoints.find((item) => item.id === "allow-scripts")?.observed.selected, "/global/bin/allow-scripts");
    const install = value.calls.find((call) => call.executable === "/tools/pnpm" && call.args.includes("@lavamoat/allow-scripts@5.1.0"));
    assert.ok(install);
    assert.equal(install.env?.MISE_CEILING_PATHS, value.stateRoot);
    assert.equal((await verifyHostLayer(1, { adapter: value.adapter, home: value.stateRoot })).valid, true);
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("compatible independent updates are preserved and require no install", async () => {
  const value = await fixture(); value.setAllowScripts(true);
  try {
    const plan = await planHostLayer(1, { adapter: value.adapter, home: value.stateRoot });
    assert.equal(plan.actions.filter((item) => item.id !== "docker").every((item) => item.kind === "preserve"), true);
    assert.equal(plan.actions.find((item) => item.id === "docker")?.kind, "skip");
    await applyHostPlan(plan, plan.approvalToken, { adapter: value.adapter, home: value.stateRoot });
    assert.equal(value.calls.some((call) => call.args[0] === "add"), false);
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("ambient runtimes do not substitute for AFD's isolated mise configuration", async () => {
  const value = await fixture(); value.setAllowScripts(true); value.removeMiseConfig();
  try {
    const plan = await planHostLayer(1, { adapter: value.adapter, home: value.stateRoot });
    assert.deepEqual(plan.actions.filter((item) => item.ownership === "afd-configured").map((item) => [item.id, item.kind]), [
      ["node", "install"], ["python", "install"], ["go", "install"], ["rust", "install"],
    ]);
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("failed applies retain resumable evidence and recovery never repeats a completed install", async () => {
  const failed = await fixture({ failInstall: true });
  try {
    const plan = await planHostLayer(1, { adapter: failed.adapter, home: failed.stateRoot });
    await assert.rejects(applyHostPlan(plan, plan.approvalToken, { adapter: failed.adapter, home: failed.stateRoot }), /injected install failure/);
    assert.equal((await loadHostReceipt(1, { adapter: failed.adapter }))?.status, "failed");
    await assert.rejects(recoverHostLayer(1, "wrong", { adapter: failed.adapter, home: failed.stateRoot }), /confirmation/);
  } finally { await rm(failed.stateRoot, { recursive: true, force: true }); }
});

test("recovery reclaims only a lock whose recorded process is gone", async () => {
  const value = await fixture(); value.setAllowScripts(true);
  try {
    const lock = path.join(value.stateRoot, "host", "layer1", "apply.lock");
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(lock, "2147483647\n", "utf8");
    const plan = await planHostLayer(1, { adapter: value.adapter, home: value.stateRoot });
    const receipt = await applyHostPlan(plan, plan.approvalToken, { adapter: value.adapter, home: value.stateRoot });
    assert.equal(receipt.status, "complete");
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("stale host plans fail before mutation", async () => {
  const value = await fixture();
  try {
    const plan = await planHostLayer(1, { adapter: value.adapter, home: value.stateRoot });
    value.setAllowScripts(true);
    await assert.rejects(applyHostPlan(plan, plan.approvalToken, { adapter: value.adapter, home: value.stateRoot }), /state changed/);
    assert.equal(value.calls.some((call) => call.args[0] === "add"), false);
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("an existing command that fails execution is never treated as missing and reinstalled", async () => {
  const value = await fixture();
  const original = value.adapter.run.bind(value.adapter);
  value.adapter.run = async (command) => command.executable === "/tools/pnpm"
    ? { status: 1, stdout: "", stderr: "access denied", timedOut: false }
    : original(command);
  try {
    const plan = await planHostLayer(1, { adapter: value.adapter, home: value.stateRoot });
    const pnpm = plan.actions.find((item) => item.id === "pnpm");
    assert.equal(pnpm?.kind, "blocked");
    assert.equal(pnpm?.before.state, "failed");
    await assert.rejects(applyHostPlan(plan, plan.approvalToken, { adapter: value.adapter, home: value.stateRoot }), /blocked/);
    assert.equal(value.calls.some((call) => call.args[0] === "add"), false);
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("POSIX profile blocks preserve unrelated content and roll back with compare-and-swap", async () => {
  const value = await fixture(); value.setAllowScripts(true);
  const profile = path.posix.join(path.resolve(value.stateRoot), ".profile");
  await value.adapter.writeText(profile, "export USER_SETTING=kept\n");
  try {
    const options = { adapter: value.adapter, home: value.stateRoot, environment: { PATH: "/mnt/c/Users/person/AppData/Local/pnpm:/usr/bin" } } as const;
    const plan = await planHostLayer(1, options);
    const receipt = await applyHostPlan(plan, plan.approvalToken, options);
    const applied = await value.adapter.readText(profile);
    assert.match(applied ?? "", /USER_SETTING=kept/);
    assert.match(applied ?? "", /AI Foundry Desk Layer 1/);
    assert.match(applied ?? "", /_afd_mise_ignored='\/mnt\/c\/Users\/person\/\.config\/mise\/config\.toml'/);
    assert.match(applied ?? "", /export MISE_IGNORED_CONFIG_PATHS=/);
    assert.equal((await planHostLayer(1, options)).profiles.every((item) => item.state === "in-sync"), true);
    await value.adapter.writeText(profile, `${applied}# user changed this later\n`);
    await assert.rejects(rollbackHostLayer(1, receipt.plan.approvalToken, options), /changed after apply/);
    await value.adapter.writeText(profile, applied!);
    await rollbackHostLayer(1, receipt.plan.approvalToken, options);
    assert.equal(await value.adapter.readText(profile), "export USER_SETTING=kept\n");
  } finally { await rm(value.stateRoot, { recursive: true, force: true }); }
});

test("Windows user environment changes preserve PATH and roll back only unchanged values", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "afd-host-windows-"));
  const files = new Map<string, string>();
  files.set("C:\\Users\\person\\AppData\\Local\\mise\\afd-global-config.toml", '[tools]\nnode = "24"\npython = "3.14"\ngo = "1.26"\nrust = "1.98.0"\n');
  const registry = new Map<string, string>([["Path", "C:\\UserBin"]]);
  const winVersions: Readonly<Record<string, string>> = { ...versions, "allow-scripts": "5.1.0", docker: "Docker version 29.0.0" };
  const adapter: PlatformAdapter = {
    id: "win32", stateRoot,
    async run(command) {
      if (command.executable === "where.exe") { const name = command.args[0] ?? ""; return winVersions[name] ? { status: 0, stdout: `C:\\tools\\${name}.exe\r\n`, stderr: "", timedOut: false } : { status: 1, stdout: "", stderr: "", timedOut: false }; }
      if (command.executable === "reg.exe") {
        const name = command.args[command.args.indexOf("/v") + 1]!;
        if (command.args[0] === "query") { const value = registry.get(name); return value === undefined ? { status: 1, stdout: "", stderr: "", timedOut: false } : { status: 0, stdout: `    ${name}    REG_SZ    ${value}\r\n`, stderr: "", timedOut: false }; }
        if (command.args[0] === "add") registry.set(name, command.args[command.args.indexOf("/d") + 1]!);
        else registry.delete(name);
        return { status: 0, stdout: "", stderr: "", timedOut: false };
      }
      if (command.executable === "whoami.exe" && command.args[0] === "/user") return { status: 0, stdout: '"user","S-1-5-21-1"\r\n', stderr: "", timedOut: false };
      if (command.executable === "icacls.exe") return { status: 0, stdout: "", stderr: "", timedOut: false };
      const name = path.win32.basename(command.executable).replace(/\.exe$/i, "");
      const version = winVersions[name];
      return version ? { status: 0, stdout: `${version}\r\n`, stderr: "", timedOut: false } : { status: 1, stdout: "", stderr: "missing", timedOut: false };
    },
    async start() { return 1; }, async stop() {}, async isRunning() { return false; }, async processFingerprint() { return undefined; }, async isListening() { return false; },
    async writeText(file, text) { files.set(file, text); }, async readText(file) { return files.get(file); }, async remove(file) { files.delete(file); }, async downloadVerified() {},
  };
  try {
    const options = { adapter, home: "C:\\Users\\person", localAppData: "C:\\Users\\person\\AppData\\Local", environment: { PATH: "C:\\tools", TEMP: "C:\\Temp" } } as const;
    const plan = await planHostLayer(1, options);
    assert.equal(plan.actions.find((item) => item.id === "node")?.kind, "preserve");
    assert.ok(plan.environment.some((item) => item.name === "Path" && item.state === "update"));
    const receipt = await applyHostPlan(plan, plan.approvalToken, options);
    assert.match(registry.get("Path") ?? "", /^C:\\Users\\person\\AppData\\Local\\mise\\shims;/);
    assert.match(registry.get("Path") ?? "", /;C:\\UserBin;/);
    assert.match(registry.get("Path") ?? "", /C:\\Users\\person\\AppData\\Local\\pnpm\\bin$/);
    assert.equal((await verifyHostLayer(1, options)).valid, true);
    await rollbackHostLayer(1, receipt.plan.approvalToken, options);
    assert.equal(registry.get("Path"), "C:\\UserBin");
    assert.equal(registry.has("PNPM_HOME"), false);
  } finally { await rm(stateRoot, { recursive: true, force: true }); }
});

test("WinGet force reinstalls an installed portable package when alias repair is unsupported", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "afd-host-winget-repair-"));
  const files = new Map<string, string>();
  const calls: HostCommand[] = [];
  let glowVisible = false;
  const toolVersions: Readonly<Record<string, string>> = {
    codex: "codex-cli 0.146.1", claude: "2.1.240 (Claude Code)", pi: "0.84.3", grok: "grok 1.0.5", agy: "1.1.27",
    rg: "ripgrep 15.2.0", fd: "fd 10.5.0", jq: "jq-1.8.2", yq: "yq version v4.53.6",
    bat: "bat 0.26.1", delta: "delta 0.19.2", glow: "glow version 3.0.0",
  };
  const adapter: PlatformAdapter = {
    id: "win32", stateRoot,
    async run(command) {
      calls.push(command);
      if (command.executable === "whoami.exe" && command.args[0] === "/user") return { status: 0, stdout: '"user","S-1-5-21-1"\r\n', stderr: "", timedOut: false };
      if (command.executable === "icacls.exe") return { status: 0, stdout: "", stderr: "", timedOut: false };
      if (command.executable === "reg.exe" && command.args[0] === "query") return glowVisible
        ? { status: 0, stdout: "    Path    REG_SZ    C:\\winget\r\n", stderr: "", timedOut: false }
        : { status: 1, stdout: "", stderr: "", timedOut: false };
      if (command.executable === "where.exe") {
        const name = command.args[0] ?? "";
        if (!toolVersions[name] || name === "glow") return { status: 1, stdout: "", stderr: "", timedOut: false };
        return { status: 0, stdout: `C:\\tools\\${name}.exe\r\n`, stderr: "", timedOut: false };
      }
      if (command.executable === "winget.exe" && command.args[0] === "install") {
        if (command.args.includes("--force")) { glowVisible = true; return { status: 0, stdout: "Reinstalled\r\n", stderr: "", timedOut: false }; }
        return { status: 1, stdout: "Found an existing package already installed. Trying to upgrade the installed package.\r\n", stderr: "", timedOut: false };
      }
      if (command.executable === "winget.exe" && command.args[0] === "repair") return { status: 1, stdout: "The installer technology in use does not support repair.\r\n", stderr: "", timedOut: false };
      const name = path.win32.basename(command.executable).replace(/\.exe$/i, "");
      if (name === "glow" && !glowVisible) return { status: 1, stdout: "", stderr: "missing", timedOut: false };
      const version = toolVersions[name];
      return version ? { status: 0, stdout: `${version}\r\n`, stderr: "", timedOut: false } : { status: 1, stdout: "", stderr: "missing", timedOut: false };
    },
    async start() { return 1; }, async stop() {}, async isRunning() { return false; }, async processFingerprint() { return undefined; }, async isListening() { return false; },
    async writeText(file, text) { files.set(file, text); }, async readText(file) { return files.get(file); }, async remove(file) { files.delete(file); }, async downloadVerified() {},
  };
  try {
    const plan = await planHostLayer(2, { adapter, home: "C:\\Users\\person", localAppData: "C:\\Users\\person\\AppData\\Local", environment: { PATH: "C:\\tools" } });
    assert.equal(plan.actions.find((item) => item.id === "glow")?.kind, "install");
    const receipt = await applyHostPlan(plan, plan.approvalToken, { adapter, home: "C:\\Users\\person", localAppData: "C:\\Users\\person\\AppData\\Local", environment: { PATH: "C:\\tools" } });
    assert.equal(receipt.status, "complete");
    assert.equal(receipt.checkpoints.find((item) => item.id === "glow")?.observed.selected, "C:\\winget\\glow.exe");
    assert.ok(calls.some((call) => call.executable === "winget.exe" && call.args[0] === "repair" && call.args.includes("charmbracelet.glow")));
    assert.ok(calls.some((call) => call.executable === "winget.exe" && call.args[0] === "install" && call.args.includes("--force")));
    assert.equal((await verifyHostLayer(2, { adapter, home: "C:\\Users\\person", localAppData: "C:\\Users\\person\\AppData\\Local", environment: { PATH: "C:\\tools" } })).valid, true);
  } finally { await rm(stateRoot, { recursive: true, force: true }); }
});
