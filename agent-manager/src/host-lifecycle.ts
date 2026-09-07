import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { capabilitiesForLayer, type HostCapability, type HostLayer, type HostToolOwnership, versionCompatible } from "./host-capabilities.js";
import { resolveCommandCandidates } from "./doctor.js";
import { NodePlatformAdapter, type CommandResult, type PlatformAdapter, writePrivateText } from "./platform.js";

export type HostObservationState = "compatible" | "incompatible" | "missing" | "failed";
export interface HostObservation {
  readonly id: string;
  readonly command: string;
  readonly ownership: HostToolOwnership;
  readonly compatibleRange: string;
  readonly state: HostObservationState;
  readonly selected?: string;
  readonly candidates: readonly string[];
  readonly version?: string;
  readonly detail: string;
}
export type HostActionKind = "preserve" | "install" | "skip" | "blocked";
export interface HostAction {
  readonly id: string;
  readonly kind: HostActionKind;
  readonly ownership: HostToolOwnership;
  readonly detail: string;
  readonly before: HostObservation;
}
export interface HostPlan {
  readonly schemaVersion: 1;
  readonly layer: HostLayer;
  readonly platform: PlatformAdapter["id"];
  readonly actions: readonly HostAction[];
  readonly profiles: readonly HostProfilePlan[];
  readonly environment: readonly HostEnvironmentPlan[];
  readonly blocked: boolean;
  readonly approvalToken: string;
}
export interface HostProfilePlan {
  readonly path: string;
  readonly state: "in-sync" | "create" | "update";
  readonly beforeHash: string;
  readonly desiredHash: string;
}
export interface HostProfileCheckpoint extends HostProfilePlan { readonly snapshot?: string }
export interface HostEnvironmentPlan {
  readonly name: string;
  readonly state: "in-sync" | "create" | "update";
  readonly beforeHash: string;
  readonly desiredHash: string;
}
export interface HostEnvironmentCheckpoint extends HostEnvironmentPlan { readonly snapshot?: string; readonly wasMissing: boolean }
export interface HostCheckpoint {
  readonly id: string;
  readonly state: "preserved" | "installed" | "skipped";
  readonly observed: HostObservation;
}
export interface HostReceipt {
  readonly schemaVersion: 1;
  readonly status: "applying" | "complete" | "failed" | "rolled-back";
  readonly plan: HostPlan;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly checkpoints: readonly HostCheckpoint[];
  readonly profiles: readonly HostProfileCheckpoint[];
  readonly environment: readonly HostEnvironmentCheckpoint[];
  readonly failure?: string;
  readonly recoveryOf?: string;
  readonly rollbackNote?: string;
}
export interface HostLifecycleOptions {
  readonly adapter?: PlatformAdapter;
  readonly home?: string;
  readonly localAppData?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
}

export function renderHostPlan(plan: HostPlan): string {
  const lines = [...plan.actions.map((action) => `${action.kind.toUpperCase()} ${action.id}: ${action.detail}`), ...plan.profiles.map((profile) => `${profile.state.toUpperCase()} profile: ${profile.path}`), ...plan.environment.map((item) => `${item.state.toUpperCase()} user environment: ${item.name}`)];
  return [`AFD Layer ${plan.layer} host plan`, "", ...lines, "", `Blocked: ${plan.blocked}`, `Plan token: ${plan.approvalToken}`].join("\n");
}

export function renderHostVerification(report: Awaited<ReturnType<typeof verifyHostLayer>>): string {
  const lines = [...report.observations.map((item) => `${item.state.toUpperCase()} ${item.id}: ${item.version ?? item.detail}${item.selected ? ` via ${item.selected}` : ""}`), ...report.profiles.map((item) => `${item.state.toUpperCase()} profile: ${item.path}`), ...report.environment.map((item) => `${item.state.toUpperCase()} user environment: ${item.name}`)];
  return [`AFD host verification`, "", ...lines, "", `Valid: ${report.valid}`].join("\n");
}

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function contentHash(value: string | undefined): string { return createHash("sha256").update(value ?? "<missing>").digest("hex"); }
function firstLine(value: string): string { return value.trim().split(/\r?\n/)[0]?.trim() ?? ""; }
function adapterFor(options: HostLifecycleOptions): PlatformAdapter { return options.adapter ?? new NodePlatformAdapter(); }
function homeFor(options: HostLifecycleOptions): string { return path.resolve(options.home ?? homedir()); }
function nowFor(options: HostLifecycleOptions): string { return (options.now?.() ?? new Date()).toISOString(); }
function stateDirectory(adapter: PlatformAdapter, layer: HostLayer): string { return path.join(adapter.stateRoot, "host", `layer${layer}`); }
function receiptFile(adapter: PlatformAdapter, layer: HostLayer): string { return path.join(stateDirectory(adapter, layer), "active.json"); }
function lockFile(adapter: PlatformAdapter, layer: HostLayer): string { return path.join(stateDirectory(adapter, layer), "apply.lock"); }

const profileStart = "# >>> AI Foundry Desk Layer 1 >>>";
const profileEnd = "# <<< AI Foundry Desk Layer 1 <<<";
function wslWindowsMiseConfig(options: HostLifecycleOptions): string | undefined {
  const source = options.environment ?? process.env;
  // Prefer the explicit lifecycle environment. This keeps planning
  // deterministic for callers and tests instead of coupling it to AFD's cwd.
  const candidates = [...(source.PATH ?? "").split(":"), process.cwd()];
  for (const candidate of candidates) {
    const match = candidate.match(/^(\/mnt\/[A-Za-z]\/Users\/[^/]+)(?:\/|$)/);
    if (match?.[1]) return path.posix.join(match[1], ".config", "mise", "config.toml");
  }
  return undefined;
}
function shellSingleQuoted(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function renderPosixProfile(current: string | undefined, ignoredMiseConfig?: string): string {
  const source = current ?? "";
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  let managed = false;
  for (const line of lines) {
    if (line === profileStart) { managed = true; continue; }
    if (line === profileEnd) { managed = false; continue; }
    if (!managed) output.push(line);
  }
  while (output.length && output.at(-1)?.trim() === "") output.pop();
  const block = [
    profileStart,
    "# Managed environment only; AFD preserves all unrelated profile content.",
    'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac',
    'case ":$PATH:" in *":$HOME/.local/share/mise/shims:"*) ;; *) export PATH="$HOME/.local/share/mise/shims:$PATH" ;; esac',
    'export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/ai-foundry-desk/mise/config.toml"',
    'export MISE_CONFIG_FILE="$MISE_GLOBAL_CONFIG_FILE"',
    'export MISE_STATE_DIR="$HOME/.local/state/ai-foundry-desk/mise"',
    "export MISE_NOT_FOUND_AUTO_INSTALL=false",
    ...(ignoredMiseConfig ? [
      `_afd_mise_ignored=${shellSingleQuoted(ignoredMiseConfig)}`,
      'case ":${MISE_IGNORED_CONFIG_PATHS:-}:" in *":$_afd_mise_ignored:"*) ;; *) export MISE_IGNORED_CONFIG_PATHS="$_afd_mise_ignored${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}" ;; esac',
      "unset _afd_mise_ignored",
    ] : []),
    "export UV_NO_MANAGED_PYTHON=1",
    "export UV_PYTHON_DOWNLOADS=0",
    'export PNPM_HOME="$HOME/.local/share/pnpm"',
    'case ":$PATH:" in *":$PNPM_HOME/bin:"*) ;; *) export PATH="$PNPM_HOME/bin:$PATH" ;; esac',
    profileEnd,
  ];
  return [...output, ...(output.length ? [""] : []), ...block, ""].join("\n");
}

async function planProfiles(layer: HostLayer, options: HostLifecycleOptions): Promise<readonly HostProfilePlan[]> {
  const adapter = adapterFor(options);
  if (layer !== 1 || adapter.id === "win32") return [];
  const targets = [path.posix.join(homeFor(options), ".profile"), path.posix.join(homeFor(options), ".bashrc")];
  const ignoredMiseConfig = wslWindowsMiseConfig(options);
  const result: HostProfilePlan[] = [];
  for (const target of targets) {
    const before = await adapter.readText(target);
    const desired = renderPosixProfile(before, ignoredMiseConfig);
    result.push({ path: target, state: before === desired ? "in-sync" : before === undefined ? "create" : "update", beforeHash: contentHash(before), desiredHash: contentHash(desired) });
  }
  return result;
}

async function readWindowsUserEnvironment(name: string, options: HostLifecycleOptions): Promise<string | undefined> {
  const adapter = adapterFor(options);
  const result = await invoke(adapter, "reg.exe", ["query", "HKCU\\Environment", "/v", name], options, 10_000);
  if (result.status !== 0) return undefined;
  const line = result.stdout.split(/\r?\n/).find((item) => /\sREG_(?:EXPAND_)?SZ\s/.test(item));
  return line?.match(/\sREG_(?:EXPAND_)?SZ\s+(.*)$/)?.[1] ?? "";
}

function desiredWindowsEnvironment(options: HostLifecycleOptions, currentPath: string | undefined): Readonly<Record<string, string>> {
  const home = homeFor(options);
  const source = options.environment ?? process.env;
  const local = options.localAppData ?? source.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
  const pnpmHome = path.win32.join(local, "pnpm");
  const miseShims = path.win32.join(local, "mise", "shims");
  const managed = [path.win32.join(local, "Microsoft", "WinGet", "Links"), pnpmHome, path.win32.join(pnpmHome, "bin")];
  const inherited = (currentPath ?? "").split(";").filter(Boolean);
  const normalized = (entry: string) => entry.replace(/[\\/]+$/, "").toLowerCase();
  const withoutMise = inherited.filter((entry) => normalized(entry) !== normalized(miseShims));
  const desired = [miseShims, ...withoutMise];
  for (const entry of managed) if (!desired.some((current) => normalized(current) === normalized(entry))) desired.push(entry);
  const userPath = desired.join(";");
  return {
    Path: userPath,
    MISE_GLOBAL_CONFIG_FILE: path.win32.join(local, "mise", "afd-global-config.toml"),
    MISE_CONFIG_FILE: path.win32.join(local, "mise", "afd-global-config.toml"),
    MISE_STATE_DIR: path.win32.join(source.TEMP ?? local, "afd-mise-state"),
    MISE_NOT_FOUND_AUTO_INSTALL: "false",
    UV_NO_MANAGED_PYTHON: "1",
    UV_PYTHON_DOWNLOADS: "0",
    PNPM_HOME: pnpmHome,
    RUSTUP_HOME: path.win32.join(home, ".rustup"),
    CARGO_HOME: path.win32.join(home, ".cargo"),
  };
}

async function planEnvironment(layer: HostLayer, options: HostLifecycleOptions): Promise<readonly HostEnvironmentPlan[]> {
  const adapter = adapterFor(options);
  if (layer !== 1 || adapter.id !== "win32") return [];
  const currentPath = await readWindowsUserEnvironment("Path", options);
  const desired = desiredWindowsEnvironment(options, currentPath);
  const result: HostEnvironmentPlan[] = [];
  for (const [name, value] of Object.entries(desired)) {
    const before = name === "Path" ? currentPath : await readWindowsUserEnvironment(name, options);
    result.push({ name, state: before === value ? "in-sync" : before === undefined ? "create" : "update", beforeHash: contentHash(before), desiredHash: contentHash(value) });
  }
  return result;
}

async function setWindowsUserEnvironment(name: string, value: string, options: HostLifecycleOptions): Promise<void> {
  const adapter = adapterFor(options);
  const type = name === "Path" ? "REG_EXPAND_SZ" : "REG_SZ";
  const result = await invoke(adapter, "reg.exe", ["add", "HKCU\\Environment", "/v", name, "/t", type, "/d", value, "/f"], options, 10_000);
  if (result.status !== 0 || result.timedOut) throw new Error(`Could not update the scoped user environment value ${name}.`);
}

async function removeWindowsUserEnvironment(name: string, options: HostLifecycleOptions): Promise<void> {
  const adapter = adapterFor(options);
  const result = await invoke(adapter, "reg.exe", ["delete", "HKCU\\Environment", "/v", name, "/f"], options, 10_000);
  if (result.status !== 0 || result.timedOut) throw new Error(`Could not remove the scoped user environment value ${name}.`);
}

function commandEnvironment(options: HostLifecycleOptions): Readonly<Record<string, string>> {
  const adapter = adapterFor(options);
  const home = homeFor(options);
  const source = options.environment ?? process.env;
  const pathModule = adapter.id === "win32" ? path.win32 : path.posix;
  const local = options.localAppData ?? source.LOCALAPPDATA ?? pathModule.join(home, "AppData", "Local");
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) if (value !== undefined) result[name] = value;
  result.MISE_GLOBAL_CONFIG_FILE = adapter.id === "win32"
    ? pathModule.join(local, "mise", "afd-global-config.toml")
    : pathModule.join(source.XDG_CONFIG_HOME ?? pathModule.join(home, ".config"), "ai-foundry-desk", "mise", "config.toml");
  result.MISE_CONFIG_FILE = result.MISE_GLOBAL_CONFIG_FILE;
  // Host lifecycle commands run from the user's home. Bound mise discovery at
  // that directory so an inaccessible or untrusted ancestor config cannot
  // override AFD's explicit isolated config.
  result.MISE_CEILING_PATHS = home;
  result.MISE_STATE_DIR = adapter.id === "win32" ? pathModule.join(tmpdir(), "afd-mise-state") : pathModule.join(source.XDG_STATE_HOME ?? pathModule.join(home, ".local", "state"), "ai-foundry-desk", "mise");
  result.MISE_NOT_FOUND_AUTO_INSTALL = "false";
  result.UV_NO_MANAGED_PYTHON = "1";
  result.UV_PYTHON_DOWNLOADS = "0";
  result.PNPM_HOME = source.PNPM_HOME ?? (adapter.id === "win32" ? path.join(local, "pnpm") : path.join(home, ".local", "share", "pnpm"));
  const delimiter = adapter.id === "win32" ? ";" : ":";
  const managed = adapter.id === "win32"
    ? [pathModule.join(local, "mise", "shims"), pathModule.join(local, "Microsoft", "WinGet", "Links"), result.PNPM_HOME, pathModule.join(result.PNPM_HOME, "bin")]
    : [pathModule.join(home, ".local", "share", "mise", "shims"), pathModule.join(home, ".local", "bin"), pathModule.join(result.PNPM_HOME, "bin")];
  const inherited = (source.PATH ?? "").split(delimiter).filter(Boolean);
  result.PATH = [...managed, ...inherited].filter((entry, index, entries) => entries.findIndex((other) => other.toLowerCase() === entry.toLowerCase()) === index).join(delimiter);
  return result;
}

function knownCandidates(contract: HostCapability, options: HostLifecycleOptions): readonly string[] {
  const adapter = adapterFor(options);
  const home = homeFor(options);
  const environment = commandEnvironment(options);
  const pnpmHome = environment.PNPM_HOME!;
  if (adapter.id === "win32") {
    const local = options.localAppData ?? environment.LOCALAPPDATA ?? path.win32.join(home, "AppData", "Local");
    return [
      path.win32.join(local, "Microsoft", "WinGet", "Links", `${contract.command}.exe`),
      path.win32.join(local, "mise", "shims", `${contract.command}.exe`),
      path.win32.join(pnpmHome, `${contract.command}.cmd`),
      path.win32.join(pnpmHome, "bin", `${contract.command}.cmd`),
    ];
  }
  return [
    path.posix.join(home, ".local", "bin", contract.command),
    path.posix.join(home, ".local", "share", "mise", "shims", contract.command),
    path.posix.join(pnpmHome, "bin", contract.command),
  ];
}

async function resolveWindowsPersistentPathCandidate(contract: HostCapability, options: HostLifecycleOptions): Promise<string | undefined> {
  const adapter = adapterFor(options);
  if (adapter.id !== "win32") return undefined;
  const persistentPath = await readWindowsUserEnvironment("Path", options);
  if (!persistentPath) return undefined;
  const source = options.environment ?? process.env;
  const expand = (entry: string) => entry.replace(/%([^%]+)%/g, (token, name: string) => {
    const match = Object.entries(source).find(([key, value]) => value !== undefined && key.toLowerCase() === name.toLowerCase());
    return match?.[1] ?? token;
  }).trim().replace(/^"|"$/g, "");
  const extensions = path.win32.extname(contract.command) ? [""] : [".exe", ".cmd", ".bat", ""];
  for (const directory of persistentPath.split(";").map(expand).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.win32.join(directory, contract.command + extension);
      if (adapter instanceof NodePlatformAdapter) {
        try { if (!existsSync(candidate) || !statSync(candidate).isFile()) continue; }
        catch { continue; }
      }
      const probe = await invokeVersion(adapter, candidate, contract.versionArgs, options, 10_000, false);
      if (probe.status === 0 && !probe.timedOut) return candidate;
    }
  }
  return undefined;
}

async function invoke(adapter: PlatformAdapter, executable: string, args: readonly string[], options: HostLifecycleOptions, timeoutMs = 30_000): Promise<CommandResult> {
  return adapter.run({ executable, args, cwd: homeFor(options), env: commandEnvironment(options), timeoutMs });
}

async function invokeVersion(adapter: PlatformAdapter, executable: string, args: readonly string[], options: HostLifecycleOptions, timeoutMs = 10_000, managedEnvironment = true): Promise<CommandResult> {
  const run = (target: string, targetArgs: readonly string[]) => managedEnvironment
    ? invoke(adapter, target, targetArgs, options, timeoutMs)
    : adapter.run({ executable: target, args: targetArgs, cwd: homeFor(options), ...(options.environment ? { env: Object.fromEntries(Object.entries(options.environment).filter((entry): entry is [string, string] => entry[1] !== undefined)) } : {}), timeoutMs });
  if (adapter.id === "win32" && /\.(?:cmd|bat)$/i.test(executable)) {
    if (!/^[A-Za-z]:\\[^"&|<>^%\r\n]+\.(?:cmd|bat)$/i.test(executable) || args.some((arg) => !/^--?[A-Za-z0-9._-]+$/.test(arg))) return { status: 1, stdout: "", stderr: "Unsafe batch launcher or version argument.", timedOut: false };
    const executableData = Buffer.from(executable, "utf8").toString("base64");
    const argumentsData = Buffer.from(JSON.stringify(args), "utf8").toString("base64");
    const script = `$ErrorActionPreference='Stop';$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${executableData}'));$argv=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${argumentsData}')));if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){exit 127};try{& $exe @argv;if($null -eq $LASTEXITCODE){exit 1};exit $LASTEXITCODE}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}`;
    return run("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")]);
  }
  return run(executable, args);
}

async function observeConfiguredCapability(contract: HostCapability, options: HostLifecycleOptions): Promise<HostObservation> {
  const adapter = adapterFor(options);
  const installer = contract.installers[adapter.id];
  if (contract.ownership !== "afd-configured" || installer?.kind !== "mise") return observeHostCapability(contract, options);
  const environment = commandEnvironment(options);
  const configFile = environment.MISE_GLOBAL_CONFIG_FILE!;
  const local = options.localAppData ?? environment.LOCALAPPDATA ?? path.win32.join(homeFor(options), "AppData", "Local");
  const executable = adapter.id === "win32"
    ? path.win32.join(local, "mise", "shims", `${contract.command}.exe`)
    : path.posix.join(homeFor(options), ".local", "share", "mise", "shims", contract.command);
  const base = { id: contract.id, command: contract.command, ownership: contract.ownership, compatibleRange: contract.compatible, candidates: [executable] } as const;
  const text = await adapter.readText(configFile);
  if (text === undefined) return { ...base, state: "missing", detail: `AFD isolated mise config is missing: ${configFile}` };
  let tools: Record<string, unknown> | undefined;
  try { tools = (parseToml(text) as { tools?: Record<string, unknown> }).tools; }
  catch { return { ...base, state: "failed", detail: `AFD isolated mise config is invalid: ${configFile}` }; }
  if (!tools || !Object.hasOwn(tools, installer.tool)) return { ...base, state: "missing", detail: `AFD isolated mise config does not declare ${installer.tool}` };
  const probe = await invokeVersion(adapter, executable, contract.versionArgs, options, 10_000);
  const version = firstLine(probe.stdout || probe.stderr);
  if (probe.timedOut) return { ...base, selected: executable, state: "failed", detail: "configured mise shim version probe timed out" };
  if (probe.status !== 0) return { ...base, selected: executable, state: "failed", detail: firstLine(probe.stderr || probe.stdout) || `version probe exited ${probe.status}` };
  const state = versionCompatible(version, contract.compatible) ? "compatible" : "incompatible";
  return { ...base, selected: executable, version, state, detail: state === "compatible" ? "compatible AFD-configured mise shim" : `outside supported range ${contract.compatible}` };
}

export async function observeHostCapability(contract: HostCapability, options: HostLifecycleOptions = {}): Promise<HostObservation> {
  const adapter = adapterFor(options);
  const discovered = await resolveCommandCandidates(adapter, contract.command);
  const persistent = discovered.length === 0 ? await resolveWindowsPersistentPathCandidate(contract, options) : undefined;
  const candidates = [...discovered, ...(persistent ? [persistent] : []), ...knownCandidates(contract, options)].filter((entry, index, entries) => entries.findIndex((other) => other.toLowerCase() === entry.toLowerCase()) === index);
  let selected = discovered[0] ?? persistent;
  if (!selected) {
    for (const candidate of candidates) {
      const probe = await invokeVersion(adapter, candidate, contract.versionArgs, options, 10_000, false);
      if (probe.status === 0 && !probe.timedOut) { selected = candidate; break; }
    }
  }
  const base = { id: contract.id, command: contract.command, ownership: contract.ownership, compatibleRange: contract.compatible, candidates } as const;
  if (!selected) return { ...base, state: "missing", detail: "not resolvable from the effective PATH" };
  const result = await invokeVersion(adapter, selected, contract.versionArgs, options, 10_000, false);
  if (result.timedOut) return { ...base, selected, state: "failed", detail: "version probe timed out" };
  if (result.status !== 0) return { ...base, selected, state: "failed", detail: firstLine(result.stderr || result.stdout) || `version probe exited ${result.status}` };
  const version = firstLine(result.stdout || result.stderr);
  const state = versionCompatible(version, contract.compatible) ? "compatible" : "incompatible";
  return { ...base, selected, version, state, detail: state === "compatible" ? "compatible user-visible command" : `outside supported range ${contract.compatible}` };
}

export async function planHostLayer(layer: HostLayer, options: HostLifecycleOptions = {}): Promise<HostPlan> {
  const adapter = adapterFor(options);
  const actions: HostAction[] = [];
  for (const contract of capabilitiesForLayer(layer)) {
    const before = await observeConfiguredCapability(contract, options);
    if (before.state === "compatible") actions.push({ id: contract.id, kind: "preserve", ownership: contract.ownership, detail: `Preserve ${before.version ?? "working version"} at ${before.selected}.`, before });
    else if (before.state === "incompatible" && contract.ownership === "afd-configured") actions.push({ id: contract.id, kind: "install", ownership: contract.ownership, detail: `Restore the reviewed ${contract.installVersion ?? "compatible"} mise configuration inside AFD's isolated config.`, before });
    else if (before.state === "incompatible") actions.push({ id: contract.id, kind: contract.required ? "blocked" : "skip", ownership: contract.ownership, detail: `Preserve the user-managed command; AFD will not replace incompatible ${before.version ?? "unknown version"}.`, before });
    else if (before.state === "failed") actions.push({ id: contract.id, kind: contract.required ? "blocked" : "skip", ownership: contract.ownership, detail: `Preserve the existing command and repair its execution failure before installation: ${before.detail}.`, before });
    else {
      const installer = contract.installers[adapter.id];
      if (installer && installer.kind !== "external") actions.push({ id: contract.id, kind: "install", ownership: contract.ownership, detail: `Install reviewed ${contract.installVersion ?? "compatible"} default using ${installer.kind}${installer.kind === "pnpm" && installer.allowBuild ? "; this package's upstream lifecycle build is explicitly enabled by the plan token" : ""}; subsequent compatible user updates remain allowed.`, before });
      else actions.push({ id: contract.id, kind: contract.required ? "blocked" : "skip", ownership: contract.ownership, detail: installer?.kind === "external" ? `External installer requires a separately implemented verified adapter: ${installer.detail}.` : `No ${adapter.id} installer is declared.`, before });
    }
  }
  const profiles = await planProfiles(layer, options);
  const environment = await planEnvironment(layer, options);
  const base = { schemaVersion: 1 as const, layer, platform: adapter.id, actions, profiles, environment, blocked: actions.some((item) => item.kind === "blocked") };
  return { ...base, approvalToken: hash(base) };
}

async function exactPnpmLauncher(contract: HostCapability, pnpm: string, options: HostLifecycleOptions): Promise<string> {
  const adapter = adapterFor(options);
  const result = await invoke(adapter, pnpm, ["bin", "--global"], options);
  if (result.status !== 0 || result.timedOut || !firstLine(result.stdout)) throw new Error(`Could not resolve the pnpm global bin directory for ${contract.id}.`);
  const bin = firstLine(result.stdout);
  const candidates = adapter.id === "win32"
    ? [path.win32.join(bin, `${contract.command}.cmd`), path.win32.join(bin, `${contract.command}.ps1`), path.win32.join(bin, contract.command)]
    : [path.posix.join(bin, contract.command)];
  for (const candidate of candidates) {
    const probe = await invokeVersion(adapter, candidate, contract.versionArgs, options, 10_000);
    const version = firstLine(probe.stdout || probe.stderr);
    if (probe.status === 0 && !probe.timedOut && versionCompatible(version, contract.compatible)) return candidate;
  }
  throw new Error(`${contract.id} installed, but no exact compatible launcher was executable from ${bin}.`);
}

async function exactObservation(contract: HostCapability, executable: string, options: HostLifecycleOptions, detail: string): Promise<HostObservation> {
  const adapter = adapterFor(options);
  const probe = await invokeVersion(adapter, executable, contract.versionArgs, options, 10_000);
  const version = firstLine(probe.stdout || probe.stderr);
  if (probe.status !== 0 || probe.timedOut || !versionCompatible(version, contract.compatible)) throw new Error(`${contract.id} installation did not produce a compatible executable at ${executable}.`);
  return { id: contract.id, command: contract.command, ownership: contract.ownership, compatibleRange: contract.compatible, candidates: [executable], selected: executable, version, state: "compatible", detail };
}

async function installCapability(contract: HostCapability, options: HostLifecycleOptions): Promise<HostObservation> {
  const adapter = adapterFor(options);
  const installer = contract.installers[adapter.id];
  if (!installer || installer.kind === "external") throw new Error(`No automated ${adapter.id} installer is available for ${contract.id}.`);
  if (installer.kind === "winget") {
    const installArgs = ["install", "--id", installer.id, "-e", "--source", "winget", ...(contract.installVersion ? ["--version", contract.installVersion] : []), "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
    const result = await invoke(adapter, "winget.exe", installArgs, options, 300_000);
    if (result.status !== 0 || result.timedOut) {
      const evidence = `${result.stdout}\n${result.stderr}`;
      if (!result.timedOut && /existing package already installed/i.test(evidence)) {
        // A WinGet portable package can remain registered while its Links alias
        // is absent.  Repair the registered package so the user-facing command
        // is restored instead of forcing an upgrade or taking ownership of the
        // package directory.
        const repaired = await invoke(adapter, "winget.exe", ["repair", "--id", installer.id, "-e", "--source", "winget", ...(contract.installVersion ? ["--version", contract.installVersion] : []), "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], options, 300_000);
        if (repaired.status !== 0 || repaired.timedOut) {
          const repairEvidence = `${repaired.stdout}\n${repaired.stderr}`;
          if (!repaired.timedOut && /does not support repair/i.test(repairEvidence)) {
            const forced = await invoke(adapter, "winget.exe", [...installArgs, "--force"], options, 300_000);
            if (forced.status !== 0 || forced.timedOut) throw new Error(`WinGet found ${contract.id} installed, repair is unsupported, and exact forced reinstall failed: ${firstLine(forced.stderr || forced.stdout) || `exit ${forced.status}`}.`);
          } else {
            throw new Error(`WinGet found ${contract.id} installed but could not repair its command exposure: ${firstLine(repaired.stderr || repaired.stdout) || `exit ${repaired.status}`}.`);
          }
        }
      } else {
        throw new Error(`WinGet failed to install ${contract.id}: ${firstLine(result.stderr || result.stdout) || `exit ${result.status}`}.`);
      }
    }
  } else if (installer.kind === "mise") {
    const mise = await observeHostCapability(capabilitiesForLayer(1).find((item) => item.id === "mise")!, options);
    if (mise.state !== "compatible" || !mise.selected) throw new Error(`Compatible mise is required before installing ${contract.id}.`);
    const target = `${installer.tool}@${contract.installVersion}`;
    const result = await invoke(adapter, mise.selected, ["use", "--global", target], options, 300_000);
    if (result.status !== 0 || result.timedOut) throw new Error(`mise failed to configure ${contract.id}: ${firstLine(result.stderr || result.stdout) || `exit ${result.status}`}.`);
    const resolved = await invoke(adapter, mise.selected, ["which", contract.command], options, 30_000);
    const executable = firstLine(resolved.stdout);
    if (resolved.status !== 0 || resolved.timedOut || !executable) throw new Error(`mise configured ${contract.id}, but could not resolve its exact executable.`);
    return exactObservation(contract, executable, options, "configured and verified through the exact mise executable");
  } else if (installer.kind === "verified-download") {
    if (adapter.id === "win32") throw new Error("Verified binary installation is POSIX-only.");
    const localBin = path.posix.join(homeFor(options), ".local", "bin");
    const destination = path.posix.join(localBin, contract.command);
    if (!installer.archiveMember) {
      await adapter.downloadVerified(installer.url, destination, installer.sha256);
    } else {
      const temporary = path.posix.join(adapter.stateRoot, "host", "downloads", `${contract.id}-${process.pid}`);
      const archive = path.posix.join(temporary, "artifact.tar.gz");
      try {
        await mkdir(temporary, { recursive: true });
        await adapter.downloadVerified(installer.url, archive, installer.sha256);
        const extracted = await invoke(adapter, "tar", ["-xzf", archive, "-C", temporary, "--strip-components=1"], options, 60_000);
        if (extracted.status !== 0 || extracted.timedOut) throw new Error(`Could not extract the verified ${contract.id} archive.`);
        const source = path.posix.join(temporary, path.posix.basename(installer.archiveMember));
        const installed = await invoke(adapter, "install", ["-m", "0755", source, destination], options, 30_000);
        if (installed.status !== 0 || installed.timedOut) throw new Error(`Could not install the verified ${contract.id} executable.`);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }
    return exactObservation(contract, destination, options, "downloaded with the reviewed SHA-256 and verified at the exact destination");
  } else if (installer.kind === "corepack") {
    const mise = await observeHostCapability(capabilitiesForLayer(1).find((item) => item.id === "mise")!, options);
    if (mise.state !== "compatible" || !mise.selected) throw new Error("Compatible mise is required before configuring pnpm through Corepack.");
    const nodeResult = await invoke(adapter, mise.selected, ["which", "node"], options, 30_000);
    const node = firstLine(nodeResult.stdout);
    if (nodeResult.status !== 0 || !node) throw new Error("Could not resolve the exact mise-managed Node.js runtime for Corepack.");
    const corepack = path.posix.join(path.posix.dirname(node), "corepack");
    const localBin = path.posix.join(homeFor(options), ".local", "bin");
    const enabled = await invoke(adapter, corepack, ["enable", "--install-directory", localBin], options, 60_000);
    if (enabled.status !== 0 || enabled.timedOut) throw new Error("Corepack could not create the user-scoped pnpm launcher.");
    const prepared = await invoke(adapter, corepack, ["prepare", `pnpm@${contract.installVersion}`, "--activate"], options, 120_000);
    if (prepared.status !== 0 || prepared.timedOut) throw new Error(`Corepack could not activate pnpm ${contract.installVersion}.`);
    return exactObservation(contract, path.posix.join(localBin, "pnpm"), options, "configured with the exact reviewed Corepack pin");
  } else {
    const pnpmContract = capabilitiesForLayer(1).find((item) => item.id === "pnpm")!;
    const pnpm = await observeHostCapability(pnpmContract, options);
    if (pnpm.state !== "compatible" || !pnpm.selected) throw new Error(`Compatible pnpm is required before installing ${contract.id}.`);
    if (!contract.installVersion) throw new Error(`${contract.id} has no reviewed installation pin.`);
    const spec = `${installer.package}@${contract.installVersion}`;
    if (installer.integrity) {
      const view = await invoke(adapter, pnpm.selected, ["view", spec, "dist.integrity", "--json"], options, 60_000);
      const observed = view.stdout.trim().replace(/^"|"$/g, "");
      if (view.status !== 0 || view.timedOut || observed !== installer.integrity) throw new Error(`Registry integrity mismatch for ${spec}.`);
    }
    const args = installer.allowBuild
      ? ["add", "--global", "--allow-build", installer.package, spec]
      : ["add", "--global", "--ignore-scripts", spec];
    const result = await invoke(adapter, pnpm.selected, args, options, 300_000);
    if (result.status !== 0 || result.timedOut) throw new Error(`pnpm failed to install ${spec}: ${firstLine(result.stderr || result.stdout) || `exit ${result.status}`}.`);
    const launcher = await exactPnpmLauncher(contract, pnpm.selected, options);
    const verified = await invokeVersion(adapter, launcher, contract.versionArgs, options, 10_000);
    return { id: contract.id, command: contract.command, ownership: contract.ownership, compatibleRange: contract.compatible, candidates: [launcher], selected: launcher, version: firstLine(verified.stdout || verified.stderr), state: "compatible", detail: "installed and verified through the exact pnpm launcher" };
  }
  const observed = await observeHostCapability(contract, options);
  if (observed.state !== "compatible") throw new Error(`${contract.id} installation completed without a compatible executable postcondition: ${observed.detail}.`);
  return observed;
}

async function saveReceipt(adapter: PlatformAdapter, layer: HostLayer, receipt: HostReceipt): Promise<void> {
  await writePrivateText(adapter, receiptFile(adapter, layer), `${JSON.stringify(receipt, null, 2)}\n`);
}

async function acquireLock(adapter: PlatformAdapter, layer: HostLayer): Promise<() => Promise<void>> {
  const file = lockFile(adapter, layer);
  await mkdir(path.dirname(file), { recursive: true });
  let handle;
  try { handle = await open(file, "wx"); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const recorded = Number.parseInt((await readFile(file, "utf8")).trim(), 10);
    if (!Number.isSafeInteger(recorded) || recorded <= 0) throw new Error(`Layer ${layer} apply lock is invalid; inspect it before recovery.`);
    let alive = false;
    try { process.kill(recorded, 0); alive = true; }
    catch (probe: unknown) { if ((probe as NodeJS.ErrnoException).code === "EPERM") alive = true; else if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
    if (alive) throw new Error(`Layer ${layer} apply is already running as process ${recorded}.`);
    const stale = `${file}.stale-${recorded}-${process.pid}`;
    try { await rename(file, stale); }
    catch (move: unknown) {
      if ((move as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Layer ${layer} apply lock changed during recovery; retry.`);
      throw move;
    }
    try { handle = await open(file, "wx"); }
    catch (create: unknown) { throw (create as NodeJS.ErrnoException).code === "EEXIST" ? new Error(`Layer ${layer} apply lock changed during recovery; retry.`) : create; }
    finally { await rm(stale, { force: true }); }
  }
  await handle.writeFile(`${process.pid}\n`);
  return async () => { await handle.close(); await rm(file, { force: true }); };
}

export async function applyHostPlan(plan: HostPlan, confirm: string, options: HostLifecycleOptions = {}, recoveryOf?: string): Promise<HostReceipt> {
  if (confirm !== plan.approvalToken) throw new Error("Host apply confirmation does not match the reviewed plan token.");
  if (plan.blocked) throw new Error(`Layer ${plan.layer} plan is blocked; no mutation was attempted.`);
  const adapter = adapterFor(options);
  const current = await planHostLayer(plan.layer, options);
  if (current.approvalToken !== plan.approvalToken) throw new Error("Host state changed after planning; review a fresh plan.");
  const release = await acquireLock(adapter, plan.layer);
  const startedAt = nowFor(options);
  let receipt: HostReceipt = { schemaVersion: 1, status: "applying", plan, startedAt, updatedAt: startedAt, checkpoints: [], profiles: [], environment: [], ...(recoveryOf ? { recoveryOf } : {}) };
  try {
    await saveReceipt(adapter, plan.layer, receipt);
    for (const action of plan.actions) {
      const contract = capabilitiesForLayer(plan.layer).find((item) => item.id === action.id)!;
      const observed = action.kind === "install" ? await installCapability(contract, options) : action.before;
      const checkpoint: HostCheckpoint = { id: action.id, state: action.kind === "install" ? "installed" : action.kind === "skip" ? "skipped" : "preserved", observed };
      receipt = { ...receipt, updatedAt: nowFor(options), checkpoints: [...receipt.checkpoints, checkpoint] };
      await saveReceipt(adapter, plan.layer, receipt);
    }
    for (const profile of plan.profiles) {
      const before = await adapter.readText(profile.path);
      if (contentHash(before) !== profile.beforeHash) throw new Error(`Profile changed after planning: ${profile.path}.`);
      let snapshot: string | undefined;
      if (profile.state !== "in-sync") {
        if (before !== undefined) {
          snapshot = path.join(stateDirectory(adapter, plan.layer), "snapshots", `${path.basename(profile.path)}-${profile.beforeHash}.txt`);
          await writePrivateText(adapter, snapshot, before);
        }
        const desired = renderPosixProfile(before, wslWindowsMiseConfig(options));
        if (contentHash(desired) !== profile.desiredHash) throw new Error(`Profile render changed after planning: ${profile.path}.`);
        await adapter.writeText(profile.path, desired);
      }
      receipt = { ...receipt, updatedAt: nowFor(options), profiles: [...receipt.profiles, { ...profile, ...(snapshot ? { snapshot } : {}) }] };
      await saveReceipt(adapter, plan.layer, receipt);
    }
    const desiredEnvironment = adapter.id === "win32" ? desiredWindowsEnvironment(options, await readWindowsUserEnvironment("Path", options)) : {};
    for (const variable of plan.environment) {
      const before = await readWindowsUserEnvironment(variable.name, options);
      if (contentHash(before) !== variable.beforeHash) throw new Error(`User environment changed after planning: ${variable.name}.`);
      const desired = desiredEnvironment[variable.name];
      if (desired === undefined || contentHash(desired) !== variable.desiredHash) throw new Error(`User environment render changed after planning: ${variable.name}.`);
      let snapshot: string | undefined;
      if (variable.state !== "in-sync" && before !== undefined) {
        snapshot = path.join(stateDirectory(adapter, plan.layer), "snapshots", `environment-${variable.name}.txt`);
        await writePrivateText(adapter, snapshot, before);
      }
      if (variable.state !== "in-sync") await setWindowsUserEnvironment(variable.name, desired, options);
      receipt = { ...receipt, updatedAt: nowFor(options), environment: [...receipt.environment, { ...variable, ...(snapshot ? { snapshot } : {}), wasMissing: before === undefined }] };
      await saveReceipt(adapter, plan.layer, receipt);
    }
    receipt = { ...receipt, status: "complete", updatedAt: nowFor(options) };
    await saveReceipt(adapter, plan.layer, receipt);
    return receipt;
  } catch (error) {
    receipt = { ...receipt, status: "failed", updatedAt: nowFor(options), failure: error instanceof Error ? error.message : String(error) };
    await saveReceipt(adapter, plan.layer, receipt);
    throw error;
  } finally { await release(); }
}

export async function loadHostReceipt(layer: HostLayer, options: HostLifecycleOptions = {}): Promise<HostReceipt | undefined> {
  const adapter = adapterFor(options);
  const text = await adapter.readText(receiptFile(adapter, layer));
  if (!text) return undefined;
  const value = JSON.parse(text) as HostReceipt;
  if (value.schemaVersion !== 1 || value.plan.layer !== layer || value.plan.platform !== adapter.id) throw new Error(`Layer ${layer} receipt is invalid for this environment.`);
  return value;
}

export async function recoverHostLayer(layer: HostLayer, confirm: string, options: HostLifecycleOptions = {}): Promise<HostReceipt> {
  const previous = await loadHostReceipt(layer, options);
  if (!previous || !["applying", "failed"].includes(previous.status)) throw new Error(`Layer ${layer} has no interrupted apply to recover.`);
  if (confirm !== previous.plan.approvalToken) throw new Error("Recovery confirmation does not match the interrupted plan token.");
  const current = await planHostLayer(layer, options);
  if (current.blocked) throw new Error(`Layer ${layer} recovery is blocked by current incompatible or unavailable state.`);
  return applyHostPlan(current, current.approvalToken, options, previous.plan.approvalToken);
}

export async function verifyHostLayer(layer: HostLayer, options: HostLifecycleOptions = {}): Promise<{ readonly valid: boolean; readonly observations: readonly HostObservation[]; readonly profiles: readonly HostProfilePlan[]; readonly environment: readonly HostEnvironmentPlan[] }> {
  const observations: HostObservation[] = [];
  for (const contract of capabilitiesForLayer(layer)) observations.push(await observeConfiguredCapability(contract, options));
  const profiles = await planProfiles(layer, options);
  const environment = await planEnvironment(layer, options);
  return { valid: observations.every((item) => {
    const contract = capabilitiesForLayer(layer).find((candidate) => candidate.id === item.id)!;
    return item.state === "compatible" || !contract.required;
  }) && profiles.every((item) => item.state === "in-sync") && environment.every((item) => item.state === "in-sync"), observations, profiles, environment };
}

export async function rollbackHostLayer(layer: HostLayer, confirm: string, options: HostLifecycleOptions = {}): Promise<HostReceipt> {
  const adapter = adapterFor(options);
  const receipt = await loadHostReceipt(layer, options);
  if (!receipt || receipt.status !== "complete") throw new Error(`Layer ${layer} has no completed receipt to roll back.`);
  if (confirm !== receipt.plan.approvalToken) throw new Error("Rollback confirmation does not match the applied plan token.");
  for (const profile of receipt.profiles) {
    const current = await adapter.readText(profile.path);
    if (contentHash(current) !== profile.desiredHash) throw new Error(`Rollback refused because profile changed after apply: ${profile.path}.`);
    if (profile.snapshot) {
      const before = await adapter.readText(profile.snapshot);
      if (before === undefined || contentHash(before) !== profile.beforeHash) throw new Error(`Rollback snapshot is missing or invalid: ${profile.snapshot}.`);
      await adapter.writeText(profile.path, before);
    } else if (profile.state === "create") await adapter.remove(profile.path);
  }
  for (const variable of receipt.environment) {
    const current = await readWindowsUserEnvironment(variable.name, options);
    if (contentHash(current) !== variable.desiredHash) throw new Error(`Rollback refused because the user environment changed after apply: ${variable.name}.`);
    if (variable.wasMissing) await removeWindowsUserEnvironment(variable.name, options);
    else {
      if (!variable.snapshot) throw new Error(`Rollback snapshot is missing for user environment value ${variable.name}.`);
      const before = await adapter.readText(variable.snapshot);
      if (before === undefined || contentHash(before) !== variable.beforeHash) throw new Error(`Rollback snapshot is missing or invalid: ${variable.snapshot}.`);
      await setWindowsUserEnvironment(variable.name, before, options);
    }
  }
  // Tools installed for the user become user-owned immediately. Removing them
  // later could destroy independent updates or user work, so rollback is a
  // recorded safe failure boundary rather than an implicit package uninstall.
  const rolledBack: HostReceipt = { ...receipt, status: "rolled-back", updatedAt: nowFor(options), rollbackNote: "AFD restored only unchanged managed profile targets and preserved user-owned tools; no package or unrelated environment state was removed." };
  await saveReceipt(adapter, layer, rolledBack);
  return rolledBack;
}
