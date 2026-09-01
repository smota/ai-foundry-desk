#!/usr/bin/env node
import { mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const values = process.argv.slice(2);
function option(name, fallback) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : fallback;
}
const tarballValue = option("--tarball");
const manager = option("--manager", "both");
const hostDryRun = values.includes("--host-dry-run");
if (!tarballValue || tarballValue.startsWith("--")) throw new Error("Use --tarball <path>.");
if (!["npm", "pnpm", "both"].includes(manager)) throw new Error("--manager must be npm, pnpm, or both.");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
let tarball = path.resolve(tarballValue);
const tarballStatus = await stat(tarball);
if (tarballStatus.isDirectory()) {
  const candidates = (await readdir(tarball)).filter((name) => name === `ai-foundry-desk-${manifest.version}.tgz`);
  if (candidates.length !== 1) throw new Error(`Expected exactly one AFD tarball in ${tarball}; found ${candidates.length}.`);
  tarball = path.join(tarball, candidates[0]);
} else if (!tarballStatus.isFile()) throw new Error(`Tarball not found: ${tarball}`);

function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  const extensions = path.extname(command) ? [""] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).map((value) => value.trim().replace(/^"|"$/g, ""))) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension.toLowerCase());
      try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { continue; }
    }
  }
  return command;
}

function invoke(command, args, options = {}) {
  const executable = resolveCommand(command);
  const actual = /\.(?:cmd|bat)$/i.test(executable)
    ? { command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", "call", executable, ...args] }
    : { command: executable, args };
  const result = spawnSync(actual.command, actual.args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? 300_000,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (!options.allowed?.includes(result.status) && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function smoke(selected, base) {
  const prefix = path.join(base, `${selected}-prefix`);
  const cache = path.join(base, `${selected}-cache`);
  const env = { ...process.env, npm_config_cache: cache, NPM_CONFIG_CACHE: cache };
  let launcher;
  if (selected === "npm") {
    invoke("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", tarball], { cwd: base, env });
    launcher = process.platform === "win32" ? path.join(prefix, "afd.cmd") : path.join(prefix, "bin", "afd");
  } else {
    const bin = path.join(prefix, "bin");
    env.PNPM_HOME = bin;
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = bin + path.delimiter + (env[pathKey] ?? "");
    invoke("pnpm", ["add", "--global", "--global-dir", path.join(prefix, "global"), "--global-bin-dir", bin, "--store-dir", path.join(prefix, "store"), "--ignore-scripts", tarball], { cwd: base, env });
    launcher = process.platform === "win32" ? path.join(bin, "afd.CMD") : path.join(bin, "afd");
  }
  if (!(await stat(launcher)).isFile()) throw new Error(`${selected} did not create the afd launcher at ${launcher}.`);
  const version = invoke(launcher, ["--version"], { cwd: base, env });
  if (version.stdout.trim() !== manifest.version) throw new Error(`${selected} installed unexpected version: ${version.stdout.trim()}`);
  const help = invoke(launcher, ["--help"], { cwd: base, env });
  if (!help.stdout.includes("AI Foundry Desk")) throw new Error(`${selected} help output is not branded.`);
  const init = invoke(launcher, ["init", "--dry-run"], { cwd: base, env });
  if (!init.stdout.includes("No layer was applied")) throw new Error(`${selected} init smoke did not preserve the no-apply boundary.`);
  const recipes = invoke(launcher, ["layer3", "recipes"], { cwd: base, env });
  if (!recipes.stdout.includes("builtin:smota-foundations") || !recipes.stdout.includes("builtin:observability")) throw new Error(`${selected} built-in recipes are unavailable.`);
  const provenance = invoke(launcher, ["provenance", "--json"], { cwd: base, env });
  const parsed = JSON.parse(provenance.stdout);
  const canonicalPrefix = await realpath(prefix);
  const canonicalProductRoot = await realpath(parsed.productRoot);
  const relativeProductRoot = path.relative(canonicalPrefix, canonicalProductRoot);
  const productRootIsIsolated = relativeProductRoot !== "" && relativeProductRoot !== ".." && !relativeProductRoot.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeProductRoot);
  if (parsed.version !== manifest.version || !productRootIsIsolated) throw new Error(`${selected} provenance does not resolve to the isolated package.`);
  if (hostDryRun && ["win32", "linux"].includes(process.platform)) invoke(launcher, ["layer1", "--dry-run"], { cwd: base, env, timeout: 300_000 });
  console.log(`${selected} isolated package smoke OK.`);
}

const temporary = await mkdtemp(path.join(tmpdir(), "afd-package-smoke-"));
try {
  if (manager === "npm" || manager === "both") await smoke("npm", temporary);
  if (manager === "pnpm" || manager === "both") await smoke("pnpm", temporary);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
