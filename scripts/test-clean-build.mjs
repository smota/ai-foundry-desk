#!/usr/bin/env node
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const orphan = path.join(root, "agent-manager", "dist", "orphan-from-prior-build.js");
await mkdir(path.dirname(orphan), { recursive: true });
await writeFile(orphan, "throw new Error('stale build output');\n", "utf8");

const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error("npm_execpath is required to test the canonical package build.");
const scriptedPackageManager = /\.(?:c?js|mjs)$/i.test(packageManager);
const result = spawnSync(scriptedPackageManager ? process.execPath : packageManager, [...(scriptedPackageManager ? [packageManager] : []), "--filter", "@ai-foundry-desk/cli", "build"], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
  timeout: 300_000,
  windowsHide: true
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Clean build failed with code ${result.status}.`);
try {
  await access(orphan, constants.F_OK);
  throw new Error("Clean build retained an orphaned output file.");
} catch (error) {
  if (error instanceof Error && error.message === "Clean build retained an orphaned output file.") throw error;
}
console.log("Clean-build regression OK.");
