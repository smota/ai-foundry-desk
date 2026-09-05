import { realpath } from "node:fs/promises";
import path from "node:path";
import type { Diagnostic } from "./doctor.js";
import { executionIdentity } from "./doctor.js";
import { commandAvailable } from "./harness-smoke.js";
import { NodePlatformAdapter, type HostCommand, type PlatformAdapter } from "./platform.js";

/** Explicit project execution scope: do not scan inaccessible or unrelated ancestors. */
export async function projectCommand(project: string, executable: string, args: readonly string[]): Promise<HostCommand> {
  const root = await realpath(path.resolve(project));
  return { executable, args, cwd: root, env: { MISE_CEILING_PATHS: root, MISE_NOT_FOUND_AUTO_INSTALL: "false" }, timeoutMs: 300_000 };
}

export async function projectDoctor(project: string, productRoot: string, adapter: PlatformAdapter = new NodePlatformAdapter()): Promise<readonly Diagnostic[]> {
  const identity = await executionIdentity(adapter);
  const rows: Diagnostic[] = [{ status: "INFO", id: "project.execution", detail: `context=${identity.context}; project=${await realpath(project)}`, remedy: "Results apply to this identity and project. No trust or ACL changes are performed." }];
  for (const executable of ["cargo", "rustc"]) {
    const probe = await commandAvailable(executable, async command => adapter.run({ ...await projectCommand(project, command.executable, command.args), timeoutMs: command.timeoutMs ?? 15_000 }), adapter.id);
    rows.push({ status: probe.available ? "PASS" : "FAIL", id: `project.${executable}`, detail: probe.available ? `${probe.version}; bounded mise ancestor discovery` : probe.detail, remedy: probe.available ? "Use afd exec for this project-scoped environment." : "Inspect PATH, launcher access, and the reviewed project toolchain. Do not broaden trust or install globally to hide an access failure." });
  }
  if (adapter.id === "win32") {
    const result = await adapter.run({ executable: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(productRoot, "scripts", "01-rust-build-tools.ps1"), "-Mode", "Inspect"], timeoutMs: 30_000 });
    let ready = false;
    try { ready = result.status === 0 && JSON.parse(result.stdout).ready === true; } catch { /* never infer success from failed diagnostics */ }
    rows.push({ status: ready ? "PASS" : "FAIL", id: "project.rust-msvc", detail: ready ? "MSVC linker, developer-shell activation and Windows SDK found; execution verification is separate." : "MSVC linker/SDK prerequisites could not be established in this context.", remedy: ready ? "Run afd exec <project> -- cargo test --workspace --locked to verify linking and execution." : "Review afd fix rust --dry-run, then explicitly apply missing prerequisites from the intended user context." });
  }
  return rows;
}

export async function executeProject(project: string, executable: string, args: readonly string[], productRoot: string, adapter: PlatformAdapter = new NodePlatformAdapter()): Promise<number> {
  const command = await projectCommand(project, executable, args);
  const rust = /^(cargo|rustc)(\.exe)?$/i.test(path.basename(executable));
  const invocation = adapter.id === "win32" && rust ? {
    ...command, executable: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(productRoot, "scripts", "01-rust-build-tools.ps1"), "-Mode", "Run", "-Executable", executable, "-ArgumentsBase64", Buffer.from(JSON.stringify(args)).toString("base64")],
  } : command;
  const result = await adapter.run(invocation);
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  return result.status;
}
