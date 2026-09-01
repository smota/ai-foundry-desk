#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const values = process.argv.slice(2);
function option(name, fallback) { const index = values.indexOf(name); return index >= 0 ? values[index + 1] : fallback; }
const version = option("--version", "0.6.1"); const repository = option("--repository", "smota/ai-foundry-desk"); const prefix = option("--prefix", process.platform === "win32" ? undefined : path.join(homedir(), ".local")); const assetDir = option("--asset-dir", undefined);
if (values.includes("--help")) { console.log("Usage: node afd-bootstrap.mjs [--version VERSION] [--repository OWNER/REPO] [--prefix DIR] [--asset-dir DIR]"); process.exit(0); }
const major = Number(process.versions.node.split(".")[0]); if (major < 24) throw new Error("Node.js 24 or newer is required.");
function invocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  const found = spawnSync("where.exe", [command], { encoding: "utf8", timeout: 5_000 });
  const executable = found.status === 0 ? found.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? command : command;
  return /\.(?:cmd|bat)$/i.test(executable) ? { command: "cmd.exe", args: ["/d", "/s", "/c", "call", executable, ...args] } : { command: executable, args };
}
async function run(command, args) {
  const actual = invocation(command, args);
  await new Promise((resolve, reject) => {
    const child = spawn(actual.command, actual.args, { stdio: "inherit", shell: false, windowsHide: true, detached: process.platform !== "win32" });
    const timer = setTimeout(() => {
      if (child.pid && process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).once("close", () => reject(new Error(command + " timed out and its process tree was stopped.")));
      else { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* process already stopped */ } reject(new Error(command + " timed out.")); }
    }, 300_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(command + " failed with exit code " + code + ".")); });
  });
}
function capture(command, args) {
  const actual = invocation(command, args); const result = spawnSync(actual.command, actual.args, { encoding: "utf8", timeout: 30_000, windowsHide: true });
  if (result.error) throw result.error; if (result.status !== 0) throw new Error((result.stderr || result.stdout || command + " failed").trim()); return result.stdout.trim();
}
async function installWindowsLauncher(pnpm, installPrefix) {
  let packageRoot;
  if (installPrefix) {
    const globalDir = path.join(installPrefix, "share", "pnpm", "global");
    for (const schema of await readdir(globalDir, { withFileTypes: true })) {
      if (!schema.isDirectory()) continue; const schemaRoot = path.join(globalDir, schema.name);
      for (const installation of await readdir(schemaRoot, { withFileTypes: true })) {
        if (!installation.isDirectory()) continue; const candidate = path.join(schemaRoot, installation.name, "node_modules", "ai-foundry-desk");
        try { const manifest = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")); if (manifest.name === "ai-foundry-desk" && manifest.version === version) { packageRoot = candidate; break; } } catch { /* not the installed package */ }
      }
      if (packageRoot) break;
    }
  } else {
    const metadata = JSON.parse(capture(pnpm, ["list", "--global", "ai-foundry-desk", "--depth", "-1", "--json"])); packageRoot = metadata?.[0]?.dependencies?.["ai-foundry-desk"]?.path;
  }
  if (typeof packageRoot !== "string") throw new Error("Could not resolve the installed AFD package.");
  const cli = path.join(packageRoot, "agent-manager", "dist", "cli.js"); const bin = installPrefix ? path.join(installPrefix, "bin") : capture(pnpm, ["bin", "--global"]).split(/\r?\n/).at(-1)?.trim(); if (!bin) throw new Error("Could not resolve the pnpm global bin directory.");
  await readFile(cli); await mkdir(bin, { recursive: true });
  const psNode = process.execPath.replace(/'/g, "''"); const psCli = cli.replace(/'/g, "''");
  const cmd = `@echo off\r\n"${process.execPath}" "${cli}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  const shNode = process.execPath.replace(/\\/g, "/"); const shCli = cli.replace(/\\/g, "/"); if (shNode.includes('"') || shCli.includes('"')) throw new Error("Unsafe launcher path.");
  await writeFile(path.join(bin, "afd.ps1"), `#!/usr/bin/env pwsh\n& '${psNode}' '${psCli}' @args\nexit $LASTEXITCODE\n`, "utf8");
  await writeFile(path.join(bin, "afd.CMD"), cmd, "ascii"); await writeFile(path.join(bin, "afd"), `#!/bin/sh\nexec "${shNode}" "${shCli}" "$@"\n`, "ascii");
}
await run(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["--version"]);
const temp = await mkdtemp(path.join(tmpdir(), "afd-bootstrap-"));
try {
  const packageName = "ai-foundry-desk-" + version + ".tgz"; const packagePath = path.join(temp, packageName); const checksumPath = packagePath + ".sha256";
  if (assetDir) { await writeFile(packagePath, await readFile(path.join(assetDir, packageName))); await writeFile(checksumPath, await readFile(path.join(assetDir, packageName + ".sha256"))); }
  else { const base = "https://github.com/" + repository + "/releases/download/v" + version + "/"; const [archive, checksum] = await Promise.all([fetch(base + packageName, { redirect: "follow" }), fetch(base + packageName + ".sha256", { redirect: "follow" })]); if (!archive.ok || !checksum.ok) throw new Error("Release artifact download failed."); await writeFile(packagePath, Buffer.from(await archive.arrayBuffer())); await writeFile(checksumPath, Buffer.from(await checksum.arrayBuffer())); }
  const expected = (await readFile(checksumPath, "utf8")).trim().split(/\s+/)[0]; const actual = createHash("sha256").update(await readFile(packagePath)).digest("hex"); if (!expected || !/^[a-f0-9]{64}$/i.test(expected) || actual !== expected.toLowerCase()) throw new Error("AFD package checksum mismatch.");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const isolation = prefix ? ["--global-dir", path.join(prefix, "share", "pnpm", "global"), "--global-bin-dir", path.join(prefix, "bin"), "--store-dir", path.join(prefix, "store")] : [];
  const args = ["add", "--global", ...isolation, "--ignore-scripts", ...(assetDir ? ["--offline"] : []), packagePath];
  if (prefix) { const bin = path.join(prefix, "bin"); await mkdir(bin, { recursive: true }); process.env.PATH = bin + path.delimiter + (process.env.PATH ?? ""); }
  await run(pnpm, args); if (process.platform === "win32") await installWindowsLauncher(pnpm, prefix); console.log("AI Foundry Desk " + version + " installed. No Layer was applied.");
} finally { await rm(temp, { recursive: true, force: true }); }
