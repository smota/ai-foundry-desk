#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "agent-manager", "src");
const distRoot = path.join(root, "agent-manager", "dist");

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

if (!(await stat(distRoot)).isDirectory()) throw new Error("agent-manager/dist was not generated.");
const sources = (await files(sourceRoot))
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
  .map((file) => path.relative(sourceRoot, file).replace(/\\/g, "/").replace(/\.ts$/, ""))
  .sort();
const emitted = (await files(distRoot))
  .filter((file) => file.endsWith(".js"))
  .map((file) => path.relative(distRoot, file).replace(/\\/g, "/").replace(/\.js$/, ""))
  .sort();
const declarations = (await files(distRoot))
  .filter((file) => file.endsWith(".d.ts"))
  .map((file) => path.relative(distRoot, file).replace(/\\/g, "/").replace(/\.d\.ts$/, ""))
  .sort();

const missingJs = sources.filter((file) => !emitted.includes(file));
const missingDeclarations = sources.filter((file) => !declarations.includes(file));
const orphanJs = emitted.filter((file) => !sources.includes(file));
const orphanDeclarations = declarations.filter((file) => !sources.includes(file));
if (missingJs.length || missingDeclarations.length || orphanJs.length || orphanDeclarations.length) {
  throw new Error(JSON.stringify({ missingJs, missingDeclarations, orphanJs, orphanDeclarations }));
}
console.log(`Build parity OK (${sources.length} source modules).`);
