import path from "node:path";
import process from "node:process";
import { existsSync, statSync } from "node:fs";
import { NodePlatformAdapter, type PlatformAdapter } from "./platform.js";

export type DiagnosticStatus = "PASS" | "WARN" | "FAIL" | "INFO";
export interface Diagnostic { readonly status: DiagnosticStatus; readonly id: string; readonly detail: string; readonly remedy: string }
export interface ExecutionIdentity {
  readonly context: "interactive-user" | "sandbox" | "service" | "hybrid";
  readonly account: string;
  readonly declaredUser: string;
  readonly profile: string;
  readonly mismatch: boolean;
}

function leafAccount(account: string): string { return account.split(/[\\/]/).at(-1)?.toLowerCase() ?? ""; }
function contextFor(account: string, mismatch: boolean): ExecutionIdentity["context"] {
  if (mismatch) return "hybrid";
  if (/sandbox/i.test(account)) return "sandbox";
  if (/^(?:nt authority[\\/])?(?:system|local service|network service)$/i.test(account)) return "service";
  return "interactive-user";
}

export async function executionIdentity(adapter: PlatformAdapter = new NodePlatformAdapter()): Promise<ExecutionIdentity> {
  const declaredUser = process.env.USERNAME ?? process.env.USER ?? "";
  const profile = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const identityCommand = adapter.id === "win32"
    ? { executable: "whoami.exe", args: [] as string[], timeoutMs: 5_000 }
    : { executable: "id", args: ["-un"], timeoutMs: 5_000 };
  const result = await adapter.run(identityCommand);
  const account = result.status === 0 ? result.stdout.trim() : "unknown";
  const mismatch = Boolean(declaredUser && account !== "unknown" && leafAccount(account) !== declaredUser.toLowerCase());
  return { context: contextFor(account, mismatch), account, declaredUser, profile, mismatch };
}

async function resolveCommand(adapter: PlatformAdapter, command: string): Promise<string | undefined> {
  if (adapter instanceof NodePlatformAdapter && adapter.id === "win32" && /^[A-Za-z0-9._-]+$/.test(command)) {
    const extensions = path.extname(command) ? [""] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    const directories = (process.env.PATH ?? "").split(path.delimiter).map((item) => item.trim().replace(/^"|"$/g, ""));
    for (const directory of directories) {
      for (const extension of extensions) {
        const candidate = path.join(directory, command + extension.toLowerCase());
        try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate; } catch { continue; }
      }
    }
  }
  const query = adapter.id === "win32"
    ? { executable: "where.exe", args: [command], timeoutMs: 5_000 }
    : { executable: "which", args: [command], timeoutMs: 5_000 };
  const result = await adapter.run(query);
  if (result.status !== 0 || result.timedOut) return undefined;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

async function probeCommand(adapter: PlatformAdapter, command: string): Promise<Diagnostic> {
  const resolved = await resolveCommand(adapter, command);
  if (!resolved) return { status: "FAIL", id: "command." + command, detail: "Not resolvable from the effective process PATH.", remedy: "Expose the reviewed managed toolchain to this execution identity." };
  const invocation = adapter.id === "win32" && /\.(?:cmd|bat)$/i.test(resolved)
    ? { executable: "cmd.exe", args: ["/d", "/s", "/c", "call", resolved, "--version"], timeoutMs: 5_000 }
    : { executable: resolved, args: ["--version"], timeoutMs: 5_000 };
  const result = await adapter.run(invocation);
  if (result.timedOut) return { status: "FAIL", id: "command." + command, detail: `Resolved to ${resolved}, but the version probe timed out.`, remedy: "Repair executable access and child-process cleanup before using this command." };
  if (result.status !== 0) {
    const evidence = (result.stderr || result.stdout).trim().split(/\r?\n/)[0] ?? "execution failed";
    return { status: "FAIL", id: "command." + command, detail: `Resolved to ${resolved}, but execution failed: ${evidence}`, remedy: "Grant only reviewed read/execute access or provision an executor-owned managed toolchain." };
  }
  const version = result.stdout.trim().split(/\r?\n/)[0] ?? "version returned";
  return { status: "PASS", id: "command." + command, detail: `${version} via ${resolved}`, remedy: "No action." };
}

export async function doctor(adapter: PlatformAdapter = new NodePlatformAdapter()): Promise<readonly Diagnostic[]> {
  const rows: Diagnostic[] = [];
  const identity = await executionIdentity(adapter);
  rows.push({ status: "PASS", id: "platform." + adapter.id, detail: "AFD TypeScript platform adapter", remedy: "No action." });
  rows.push({
    status: identity.mismatch ? "WARN" : "PASS",
    id: "execution.identity",
    detail: `context=${identity.context}; account=${identity.account}; declaredUser=${identity.declaredUser || "unset"}; profile=${identity.profile || "unset"}`,
    remedy: identity.mismatch ? "Do not apply profile, HKCU, PATH, or ACL repair from this hybrid execution context." : "No action.",
  });
  const hostMajor = Number(process.versions.node.split(".")[0]);
  rows.push({ status: hostMajor >= 24 ? "PASS" : "FAIL", id: "runtime.host-node", detail: `Node ${process.versions.node} via ${path.resolve(process.execPath)}`, remedy: "Run AFD with Node 24 or newer." });
  for (const command of ["node", "pnpm", "mise", "uv", "uvx"]) rows.push(await probeCommand(adapter, command));
  rows.push({ status: adapter.id === "darwin" ? "INFO" : "PASS", id: "platform.validation", detail: adapter.id === "darwin" ? "macOS adapter requires clean-host validation." : "Platform adapter available.", remedy: adapter.id === "darwin" ? "Validate on a clean macOS host before relying on apply." : "No action." });
  return rows;
}
