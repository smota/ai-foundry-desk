import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectDigest } from "./project-contracts.js";
import { isWithin, projectExists } from "./project-files.js";
import { verifyStage } from "./project-plan.js";
import { NodePlatformAdapter } from "./platform.js";
import type { PlatformAdapter } from "./platform.js";

export interface ProjectValidation {
  schemaVersion: 1; kind: "afd-project-validation"; approvalToken: string;
  checks: "structural" | "build"; state: "passed" | "failed" | "blocked";
  results: { check: string; state: string; detail: string }[]; evidenceToken: string;
}
export async function validateProject(stage: string, checks: "structural" | "build", adapter: PlatformAdapter = new NodePlatformAdapter()): Promise<ProjectValidation> {
  const plan = await verifyStage(stage);
  const results: ProjectValidation["results"] = [];
  const known = new Set(plan.files.map(f => f.path));
  for (const file of plan.files.filter(f => f.path.endsWith(".md"))) {
    for (const match of file.content.matchAll(/\]\(([^)]+)\)/g)) {
      const dest = match[1]!;
      if (/^[a-z]+:|^#/i.test(dest)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), dest.split("#")[0]!));
      if (!known.has(resolved)) results.push({ check: file.path, state: "failed", detail: `Missing or unsafe local link: ${dest}` });
    }
  }
  results.push(...plan.blockers.map(detail => ({ check: "existing-content", state: "blocked", detail })));
  if (!results.length) results.push({ check: "candidate-integrity", state: "passed", detail: "Recipe bytes, explicit policy closure, paths and Markdown links verified." });
  if (checks === "build" && !results.some(r => r.state !== "passed")) {
    if (plan.brief.foundation.recipe.id === "policy-only") results.push({ check: "build", state: "passed", detail: "No executable build in policy-only recipe." });
    else {
      const version = plan.brief.foundation.toolchain!.version;
      const toolchains = path.join(process.env.RUSTUP_HOME ?? path.join(homedir(), ".rustup"), "toolchains");
      const installed = await projectExists(toolchains) ? (await readdir(toolchains)).filter(name => name.startsWith(`${version}-`)) : [];
      const hostSuffix = process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
      const hostArch = process.arch === "arm64" ? "aarch64" : "x86_64";
      const selected = installed.find(name => name === `${version}-${hostArch}-${hostSuffix}`);
      if (!selected) results.push({ check: "rust-toolchain", state: "blocked", detail: `Exact host toolchain ${version} is not installed in the inspected Rust toolchain directory. No installation attempted.` });
      else {
        const bin = path.join(toolchains, selected, "bin"); const cargo = path.join(bin, process.platform === "win32" ? "cargo.exe" : "cargo");
        const scratch = await mkdtemp(path.join(tmpdir(), "afd-project-build-"));
        if (!isWithin(path.resolve(tmpdir()), scratch) || !path.basename(scratch).startsWith("afd-project-build-")) throw new Error("Unsafe build cleanup path.");
        try {
          for (const file of plan.files) { const dest = path.join(scratch, file.path); await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, file.content); }
          const commands = [["fmt", "--all", "--", "--check"], ["check", "--workspace", "--all-targets", "--locked", "--offline"], ["clippy", "--workspace", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"], ["test", "--workspace", "--locked", "--offline"]];
          for (const args of commands) {
            const current = path.dirname(fileURLToPath(import.meta.url));
            const helpers = [path.resolve(current, "../../scripts/01-rust-build-tools.ps1"), path.resolve(current, "../../../scripts/01-rust-build-tools.ps1")];
            let helper: string | undefined;
            for (const candidate of helpers) if (await projectExists(candidate)) { helper = candidate; break; }
            const invocation = adapter.id === "win32" && helper && args[0] === "test" ? { executable: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Mode", "Run", "-Executable", "cargo", "-ArgumentsBase64", Buffer.from(JSON.stringify(args)).toString("base64")] } : { executable: cargo, args };
            const result = await adapter.run({ ...invocation, cwd: scratch, timeoutMs: 120000, env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, CARGO_HOME: path.join(scratch, ".cargo-home"), CARGO_TARGET_DIR: path.join(scratch, "target"), CARGO_NET_OFFLINE: "true", RUSTUP_TOOLCHAIN: version, MISE_CEILING_PATHS: scratch, MISE_NOT_FOUND_AUTO_INSTALL: "false" } });
            const output = `${result.stdout}\n${result.stderr}`;
            const missing = /linker .*not found|link\.exe.*not found|cannot find.*(?:sdk|linker)|can't find crate for|toolchain .*not installed|MSVC linker, Windows SDK, or developer-shell activation is missing/i.test(output);
            results.push({ check: `cargo ${args.join(" ")}`, state: result.status === 0 ? "passed" : missing ? "blocked" : "failed", detail: result.status === 0 ? "Completed against exact generated candidate." : missing ? "Required target linker/SDK/toolchain component unavailable; no installation attempted." : `Command exited ${result.status}${result.timedOut ? " (timeout)" : ""}.` });
            if (result.status !== 0) break;
          }
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      }
    }
  }
  const state = results.some(r => r.state === "failed") ? "failed" : results.some(r => r.state === "blocked") ? "blocked" : "passed";
  const base = { schemaVersion: 1 as const, kind: "afd-project-validation" as const, approvalToken: plan.approvalToken, checks, state: state as ProjectValidation["state"], results };
  return { ...base, evidenceToken: projectDigest(base) };
}
export async function readValidation(file: string): Promise<ProjectValidation> {
  const value = JSON.parse(await readFile(file, "utf8")) as ProjectValidation;
  const { evidenceToken, ...base } = value;
  if (value.kind !== "afd-project-validation" || value.schemaVersion !== 1 || projectDigest(base) !== evidenceToken) throw new Error("Invalid validation evidence.");
  return value;
}
