import path from "node:path";
import process from "node:process";
import { existsSync, statSync } from "node:fs";
import { NodePlatformAdapter, type PlatformAdapter } from "./platform.js";
import { HOST_CAPABILITIES, type HostCapability, versionCompatible } from "./host-capabilities.js";

export type DiagnosticStatus = "PASS" | "WARN" | "FAIL" | "INFO";
export interface Diagnostic { readonly status: DiagnosticStatus; readonly id: string; readonly detail: string; readonly remedy: string }
export type DiagnosticComponent = "platform" | "execution" | "runtime" | "command" | "project" | "sandbox" | "other";
export const doctorComponentOrder: readonly DiagnosticComponent[] = ["platform", "execution", "runtime", "command", "project", "sandbox", "other"] as const;

const diagnosticComponentPrefixes: readonly [string, DiagnosticComponent][] = [
  ["platform.", "platform"],
  ["execution.", "execution"],
  ["runtime.", "runtime"],
  ["command.", "command"],
  ["project.", "project"],
  ["sandbox.", "sandbox"],
] as const;

export function diagnosticComponent(id: string): DiagnosticComponent {
  for (const [prefix, component] of diagnosticComponentPrefixes) if (id.startsWith(prefix)) return component;
  return "other";
}

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

export async function resolveCommandCandidates(adapter: PlatformAdapter, command: string): Promise<readonly string[]> {
  const candidates: string[] = [];
  const add = (candidate: string) => {
    // WSL appends Windows PATH entries by default.  A launcher discovered through
    // /mnt/<drive> is not evidence that the capability is installed for Linux:
    // it can disappear when interop is disabled and may execute against the
    // Windows package graph.  Keep host inventories native and independent.
    if (adapter.id !== "win32" && (/^[A-Za-z]:[\\/]/.test(candidate) || /^\/mnt\/[A-Za-z](?:\/|$)/.test(candidate))) return;
    const normalized = adapter.id === "win32" ? path.win32.resolve(candidate) : path.posix.resolve(candidate);
    if (!candidates.some((item) => item.toLowerCase() === normalized.toLowerCase())) candidates.push(normalized);
  };
  if (adapter instanceof NodePlatformAdapter && adapter.id === "win32" && /^[A-Za-z0-9._-]+$/.test(command)) {
    const extensions = path.extname(command) ? [""] : (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    const directories = (process.env.PATH ?? "").split(path.delimiter).map((item) => item.trim().replace(/^"|"$/g, ""));
    for (const directory of directories) {
      for (const extension of extensions) {
        const candidate = path.join(directory, command + extension.toLowerCase());
        try { if (existsSync(candidate) && statSync(candidate).isFile()) add(candidate); } catch { continue; }
      }
    }
  }
  if (adapter instanceof NodePlatformAdapter && adapter.id === "darwin" && command === "docker") {
    const candidates = [
      "/Applications/Docker.app/Contents/Resources/bin/docker",
      path.join(process.env.HOME ?? "", "Applications", "Docker.app", "Contents", "Resources", "bin", "docker"),
    ];
    for (const candidate of candidates) {
      try { if (existsSync(candidate) && statSync(candidate).isFile()) add(candidate); } catch { continue; }
    }
  }
  const query = adapter.id === "win32"
    ? { executable: "where.exe", args: [command], timeoutMs: 5_000 }
    : { executable: "which", args: [command], timeoutMs: 5_000 };
  const result = await adapter.run(query);
  if (result.status === 0 && !result.timedOut) for (const line of result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) add(line);
  return candidates;
}

export async function probeExecutableVersion(adapter: PlatformAdapter, executable: string, versionArgs: readonly string[], timeoutMs = 5_000) {
  if (adapter.id === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    if (!/^[A-Za-z]:\\[^"&|<>^%\r\n]+\.(?:cmd|bat)$/i.test(executable) || versionArgs.some((arg) => !/^--?[A-Za-z0-9._-]+$/.test(arg))) {
      return { status: 1, stdout: "", stderr: "Unsafe batch launcher or version argument.", timedOut: false } as const;
    }
    const executableData = Buffer.from(executable, "utf8").toString("base64");
    const argumentsData = Buffer.from(JSON.stringify(versionArgs), "utf8").toString("base64");
    const script = `$ErrorActionPreference='Stop';$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableData}'));$argv=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${argumentsData}')));if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){exit 127};try{& $exe @argv;if($null -eq $LASTEXITCODE){exit 1};exit $LASTEXITCODE}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`;
    return adapter.run({ executable: "powershell.exe", args: ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], timeoutMs });
  }
  return adapter.run({ executable, args: versionArgs, timeoutMs });
}

async function probeCommand(adapter: PlatformAdapter, command: string, contract?: HostCapability): Promise<Diagnostic> {
  const candidates = await resolveCommandCandidates(adapter, command);
  const resolved = candidates[0];
  if (!resolved) return { status: contract && !contract.required ? "WARN" : "FAIL", id: "command." + command, detail: `Not resolvable from the effective process PATH${contract ? `; ownership=${contract.ownership}; supported=${contract.compatible}` : ""}.`, remedy: contract && !contract.required ? "Optional capability is unavailable; review its separate installation boundary if needed." : "Expose the reviewed managed toolchain to this execution identity." };
  const versionArgs = contract?.versionArgs ?? (command === "go" ? ["version"] : ["--version"]);
  const result = await probeExecutableVersion(adapter, resolved, versionArgs);
  if (result.timedOut) return { status: contract && !contract.required ? "WARN" : "FAIL", id: "command." + command, detail: `Resolved to ${resolved}, but the version probe timed out.`, remedy: "Repair executable access and child-process cleanup before using this command." };
  if (result.status !== 0) {
    const evidence = (result.stderr || result.stdout).trim().split(/\r?\n/)[0] ?? "execution failed";
    return { status: contract && !contract.required ? "WARN" : "FAIL", id: "command." + command, detail: `Resolved to ${resolved}, but execution failed: ${evidence}`, remedy: "Grant only reviewed read/execute access or provision an executor-owned managed toolchain." };
  }
  const version = result.stdout.trim().split(/\r?\n/)[0] ?? "version returned";
  const alternatives = candidates.length > 1 ? `; ${candidates.length} PATH candidates` : "";
  if (contract && !versionCompatible(version, contract.compatible)) return {
    status: "WARN", id: "command." + command,
    detail: `${version} via ${resolved}${alternatives}; ownership=${contract.ownership}; supported=${contract.compatible}`,
    remedy: "AFD will not replace a user-managed tool automatically. Review compatibility before applying the dependent capability.",
  };
  return { status: "PASS", id: "command." + command, detail: `${version} via ${resolved}${alternatives}${contract ? `; ownership=${contract.ownership}; supported=${contract.compatible}` : ""}`, remedy: "No action." };
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
  const commands = [...HOST_CAPABILITIES, { command: "uvx" }, { command: "cargo" }];
  const seen = new Set<string>();
  for (const item of commands) {
    if (seen.has(item.command)) continue;
    seen.add(item.command);
    rows.push(await probeCommand(adapter, item.command, "compatible" in item ? item : undefined));
  }
  rows.push({ status: adapter.id === "darwin" ? "INFO" : "PASS", id: "platform.validation", detail: adapter.id === "darwin" ? "macOS adapter requires clean-host validation." : "Platform adapter available.", remedy: adapter.id === "darwin" ? "Validate on a clean macOS host before relying on apply." : "No action." });
  return rows;
}
