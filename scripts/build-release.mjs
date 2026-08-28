#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "release");
function resolveWindowsCommand(command) {
  const extensions = path.extname(command) ? [""] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).map((value) => value.trim().replace(/^"|"$/g, ""))) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension.toLowerCase());
      try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { continue; }
    }
  }
  return command;
}
function run(command, args, timeoutMs = 300_000) {
  let executable = command; let actualArgs = args;
  if (process.platform === "win32") {
    executable = resolveWindowsCommand(command);
    if (/\.(?:cmd|bat)$/i.test(executable)) { actualArgs = ["/d", "/s", "/c", "call", executable, ...args]; executable = "cmd.exe"; }
  }
  const invocation = process.platform === "win32"
    ? { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "afd-run-tree.ps1"), "-Executable", executable, "-ArgumentsBase64", Buffer.from(JSON.stringify(actualArgs), "utf8").toString("base64"), "-TimeoutMs", String(timeoutMs), "-WorkingDirectory", root] }
    : { command: executable, args: actualArgs };
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, encoding: "utf8", timeout: timeoutMs + 10_000 });
  if (result.error) throw result.error; if (result.status !== 0) throw new Error((result.stderr || result.stdout || command + " failed").trim()); return result.stdout.trim();
}
async function publishScript(sourceName, outputName = sourceName) {
  const source = path.join(root, "scripts", sourceName); const destination = path.join(output, outputName);
  await copyFile(source, destination); const sha = createHash("sha256").update(await readFile(destination)).digest("hex");
  await writeFile(destination + ".sha256", sha + "  " + outputName + "\n", "utf8");
}
const pnpm = "pnpm"; const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")); const name = "ai-foundry-desk-" + pkg.version + ".tgz";
await mkdir(output, { recursive: true }); run(pnpm, ["check"]); const packed = run(pnpm, ["pack", "--pack-destination", output]).split(/\r?\n/).at(-1); if (!packed) throw new Error("pnpm pack did not return an artifact."); const source = path.isAbsolute(packed) ? packed : path.join(root, packed); const artifact = path.join(output, name); if (path.resolve(source) !== path.resolve(artifact)) await rename(source, artifact); const sha = createHash("sha256").update(await readFile(artifact)).digest("hex"); await writeFile(artifact + ".sha256", sha + "  " + name + "\n", "utf8");
await publishScript("afd-bootstrap.mjs"); await publishScript("afd-bootstrap.ps1"); await publishScript("afd-bootstrap.ps1", "afd-bootstrap-windows.ps1"); await publishScript("afd-bootstrap-posix.sh"); console.log("Release assets created in " + output);
