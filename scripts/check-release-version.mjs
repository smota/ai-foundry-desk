#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv.slice(2).find((argument) => argument !== "--") ?? process.env.GITHUB_REF_NAME;

if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(tag)) {
  throw new Error("Pass a release tag in the form vX.Y.Z or vX.Y.Z-prerelease.N.");
}

const rootPackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const cliPackage = JSON.parse(await readFile(path.join(root, "agent-manager", "package.json"), "utf8"));
const version = tag.slice(1);
const stable = !version.includes("-");
const commandService = await readFile(path.join(root, "agent-manager", "src", "command-service.ts"), "utf8");

const checks = [
  ["package.json", rootPackage.version === version],
  ["agent-manager/package.json", cliPackage.version === version],
  ["agent-manager/src/command-service.ts", commandService.includes(`export const VERSION = "${version}"`)],
];
if (stable) checks.push(
  ["scripts/afd-bootstrap.mjs", (await readFile(path.join(root, "scripts", "afd-bootstrap.mjs"), "utf8")).includes(`option("--version", "${version}")`)],
  ["scripts/afd-bootstrap.ps1", (await readFile(path.join(root, "scripts", "afd-bootstrap.ps1"), "utf8")).includes(`[string]$Version = "${version}"`)],
  ["scripts/afd-bootstrap-posix.sh", (await readFile(path.join(root, "scripts", "afd-bootstrap-posix.sh"), "utf8")).includes(`VERSION="${version}"`)],
  ["README.md PowerShell install", (await readFile(path.join(root, "README.md"), "utf8")).includes(`$v='${version}'`)],
  ["README.md POSIX install", (await readFile(path.join(root, "README.md"), "utf8")).includes(`v=${version};`)],
);

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  throw new Error(`Release ${tag} is inconsistent with: ${failures.join(", ")}`);
}

console.log(stable
  ? `Release version ${version} is consistent across packages, bootstraps, and installation docs.`
  : `Prerelease version ${version} is consistent across package and CLI surfaces; stable bootstrap defaults remain unchanged.`);
