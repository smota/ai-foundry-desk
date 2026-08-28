import { windowsPathToWsl, type HostCommand, type PlatformAdapter } from "./platform.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentacctComponentState = "disabled" | "healthy" | "degraded" | "unavailable" | "incompatible";
export interface AgentacctStatus {
  readonly state: AgentacctComponentState;
  readonly version?: string;
  readonly capabilities?: unknown;
  readonly ingestion?: unknown;
  readonly runtime?: { readonly state: string; readonly dashboardHealth: string; readonly dashboardUrl: string; readonly watcher: string };
  readonly detail: string;
}
export interface AgentacctSessionEvidence { readonly source: "agentacct-v1-session"; readonly version: string; readonly status?: string; readonly lastActivityAt?: string; readonly instrumentationState?: string; readonly usageTokens?: number; readonly usageConfidence?: string; readonly estimatedCost?: number; readonly costConfidence?: string; readonly workItemCount: number; readonly machineCheckCount: number; readonly models: readonly string[] }
export type AgentacctSessionLookup =
  | { readonly status: "exact_session"; readonly evidence: AgentacctSessionEvidence }
  | { readonly status: "ambiguous"; readonly matchCount: number }
  | { readonly status: "unlinked"; readonly matchCount: 0 };
export interface AgentacctInstallSource { readonly source: string; readonly sha256: string; readonly lockSha256: string; readonly verifiedArtifact?: string }

const SAFE_VERSION = /^\d+\.\d+\.\d+$/;
const WINDOWS_CODEX_READ_ONLY_NAMESPACE = `
set -eu
sessions_root=$1
archived_root=$2
agentacct_bin=$3
store_root=$4
claude_root=$5
hermes_root=$6
requested_mirror=$7
shift 7
mirror_root=\${requested_mirror:-$(mktemp -d)}
cleanup() {
  umount "$mirror_root/sessions" 2>/dev/null || true
  umount "$mirror_root/archived_sessions" 2>/dev/null || true
  if [ -z "$requested_mirror" ]; then rm -rf "$mirror_root"; fi
}
if [ -z "$requested_mirror" ]; then trap cleanup EXIT; fi
mkdir -p "$mirror_root/sessions" "$mirror_root/archived_sessions"
if [ -d "$sessions_root" ]; then
  mount --bind "$sessions_root" "$mirror_root/sessions"
  mount -o remount,bind,ro "$mirror_root/sessions"
fi
if [ -d "$archived_root" ]; then
  mount --bind "$archived_root" "$mirror_root/archived_sessions"
  mount -o remount,bind,ro "$mirror_root/archived_sessions"
fi
env \
  AGENTACCT_PRICING_AUTO_REFRESH=0 \
  AGENTACCT_EVIDENCE_V2=0 \
  AGENTACCT_STORE_DIR="$store_root" \
  CODEX_HOME="$mirror_root" \
  CLAUDE_CONFIG_DIR="$claude_root" \
  HERMES_HOME="$hermes_root" \
  "$agentacct_bin" "$@"
`;

function parseJson(text: string, surface: string): unknown { try { return JSON.parse(text) as unknown; } catch { throw new Error(`agentacct ${surface} did not return valid JSON.`); } }
function boundedString(value: unknown): string | undefined { return typeof value === "string" && value.length <= 160 ? value : undefined; }
function boundedNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
function timestampMilliseconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 1_000;
  if (typeof value === "string") { const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:undefined; }
  return undefined;
}
function isRecoverableCodexRotation(health: Record<string, unknown>): boolean {
  if(health.schema_version!=="agent-chronicle.ingestion-health.v1")return false;
  const sources=Array.isArray(health.sources)?health.sources.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==="object"):[];
  const degraded=sources.filter((item)=>String(item.state).toLowerCase()!=="healthy");
  if(degraded.length!==1)return false;
  const source=degraded[0]!;
  const errorCodes=Array.isArray(source.error_codes)?source.error_codes:[];
  const issues=Array.isArray(health.issues)?health.issues.filter((item):item is Record<string,unknown>=>Boolean(item)&&typeof item==="object"):[];
  return source.source==="codex"&&source.state==="degraded"&&source.error_code==="codex_rollout_inventory_changed"&&errorCodes.length===1&&errorCodes[0]==="codex_rollout_inventory_changed"&&timestampMilliseconds(source.last_success_at)!==undefined&&issues.length===1&&issues[0]?.source==="codex"&&issues[0]?.code==="source_scan_failed";
}
function helperPath(): string { const current=path.dirname(fileURLToPath(import.meta.url));const candidates=[path.resolve(current,"..","..","scripts","agentacct-query.py"),path.resolve(current,"..","..","..","scripts","agentacct-query.py")];const found=candidates.find(existsSync);if(!found)throw new Error("AFD agentacct query helper is missing.");return found; }
function dependencyLockPath(): string { const current=path.dirname(fileURLToPath(import.meta.url));const candidates=[path.resolve(current,"..","..","requirements","pylock.agentacct.toml"),path.resolve(current,"..","..","..","requirements","pylock.agentacct.toml")];const found=candidates.find(existsSync);if(!found)throw new Error("AFD agentacct dependency lock is missing.");return found; }

export class AgentacctAdapter {
  private wslManagedRootCache?: Promise<string>;
  constructor(private readonly adapter: PlatformAdapter, private readonly expectedVersion: string) { if (!SAFE_VERSION.test(expectedVersion)) throw new Error("An exact agentacct version is required."); }

  private managedRoot(): string { return path.join(this.adapter.stateRoot, "telemetry-v2", "agentacct"); }
  private async wslManagedRoot():Promise<string>{this.wslManagedRootCache??=(async()=>{const result=await this.adapter.run({executable:"wsl.exe",args:["--","sh","-lc",'printf %s "$HOME"'],timeoutMs:10_000});const home=result.stdout.trim();if(result.status!==0||!/^\/home\/[A-Za-z0-9._-]+$/.test(home))throw new Error("Could not resolve a safe WSL home for the agentacct runtime.");return `${home}/.local/share/afd/telemetry-v2/agentacct`;})();return this.wslManagedRootCache;}
  private async toWsl(value: string): Promise<string> {
    return windowsPathToWsl(value);
  }
  private async wslExecutable(name:string):Promise<string>{if(!/^[a-z0-9._-]+$/i.test(name))throw new Error("Invalid WSL command name.");const result=await this.adapter.run({executable:"wsl.exe",args:["--","sh","-lc",`command -v ${name}`],timeoutMs:10_000});const value=result.stdout.trim();if(result.status!==0||!value.startsWith("/"))throw new Error(`Required WSL command is unavailable: ${name}.`);return value;}
  private sourceHomes(): Readonly<{ CODEX_HOME: string; CLAUDE_CONFIG_DIR: string; HERMES_HOME: string }> {
    return {
      CODEX_HOME: path.resolve(process.env.CODEX_HOME ?? path.join(homedir(), ".codex")),
      CLAUDE_CONFIG_DIR: path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude")),
      HERMES_HOME: path.resolve(process.env.HERMES_HOME ?? path.join(homedir(), ".hermes")),
    };
  }
  private async command(args: readonly string[], timeoutMs = 30_000): Promise<HostCommand> {
    if (this.adapter.id !== "win32") return { executable: path.join(this.managedRoot(), "bin", "agentacct"), args, env: { AGENTACCT_PRICING_AUTO_REFRESH: "0", AGENTACCT_EVIDENCE_V2: "0", AGENTACCT_STORE_DIR: path.join(this.managedRoot(), "store"), ...this.sourceHomes() }, timeoutMs };
    const managed = await this.wslManagedRoot(); const assignments = ["AGENTACCT_PRICING_AUTO_REFRESH=0", "AGENTACCT_EVIDENCE_V2=0", `AGENTACCT_STORE_DIR=${managed}/store`];
    for (const [name, value] of Object.entries(this.sourceHomes())) assignments.push(`${name}=${await this.toWsl(value)}`);
    return { executable: "wsl.exe", args: ["--", "env", ...assignments, `${managed}/bin/agentacct`, ...args], timeoutMs };
  }

  private async windowsReadOnlyCodexCommand(args: readonly string[], timeoutMs: number, persistent = false): Promise<HostCommand> {
    const managed = await this.wslManagedRoot();
    const homes = this.sourceHomes();
    const codexRoot = await this.toWsl(homes.CODEX_HOME);
    return {
      executable: "wsl.exe",
      args: [
        "--exec", "unshare", "--user", "--map-root-user", "--mount", "sh", "-c",
        WINDOWS_CODEX_READ_ONLY_NAMESPACE,
        "afd-agentacct",
        `${codexRoot}/sessions`,
        `${codexRoot}/archived_sessions`,
        `${managed}/bin/agentacct`,
        `${managed}/store`,
        await this.toWsl(homes.CLAUDE_CONFIG_DIR),
        await this.toWsl(homes.HERMES_HOME),
        persistent ? `${managed}/codex-home` : "",
        ...args,
      ],
      timeoutMs,
    };
  }

  async install(input: AgentacctInstallSource): Promise<void> {
    const lockFile = dependencyLockPath();
    const actualLockSha256 = createHash("sha256").update(await readFile(lockFile)).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(input.lockSha256) || actualLockSha256 !== input.lockSha256.toLowerCase()) throw new Error("The agentacct dependency lock does not match the reviewed recipe.");
    let artifact = input.verifiedArtifact; let managed = this.managedRoot(); let stagedArtifact: string | undefined;
    if (this.adapter.id === "win32") {
      const source = new URL(input.source); if (source.protocol !== "https:" || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("agentacct requires a pinned HTTPS source and SHA-256.");
      managed = await this.wslManagedRoot();
      const stagingRoot = `${managed}/staging`; stagedArtifact = `${stagingRoot}/agentacct-${this.expectedVersion}-py3-none-any.whl`;
      const prepare = await this.adapter.run({ executable: "wsl.exe", args: ["--", "/usr/bin/mkdir", "-p", stagingRoot, `${managed}/store`], timeoutMs: 10_000 });
      if (prepare.status !== 0 || prepare.timedOut) throw new Error("Could not prepare the isolated agentacct staging directory: " + (prepare.stderr || prepare.stdout).trim());
      const curl = await this.wslExecutable("curl");
      const download = await this.adapter.run({ executable: "wsl.exe", args: ["--", curl, "--fail", "--silent", "--show-error", "--location", "--max-redirs", "5", "--proto", "=https", "--proto-redir", "=https", "--output", stagedArtifact, source.href], timeoutMs: 120_000 });
      if (download.status !== 0 || download.timedOut) throw new Error("Could not download the pinned agentacct artifact inside WSL: " + (download.stderr || download.stdout).trim());
      const digest = await this.adapter.run({ executable: "wsl.exe", args: ["--", await this.wslExecutable("sha256sum"), stagedArtifact], timeoutMs: 30_000 });
      if (digest.status !== 0 || digest.timedOut || digest.stdout.trim().split(/\s+/)[0]?.toLowerCase() !== input.sha256) throw new Error("The WSL agentacct artifact did not match the reviewed SHA-256.");
      artifact = stagedArtifact;
    }
    if (!artifact) throw new Error("A locally verified agentacct artifact is required on this platform.");
    if(this.adapter.id!=="win32")await this.adapter.writeText(path.join(managed,"store",".afd-root"),"managed\n");
    const install: HostCommand = this.adapter.id === "win32"
      ? { executable: "wsl.exe", args: ["--", "env", `UV_TOOL_DIR=${managed}/tools`, `UV_TOOL_BIN_DIR=${managed}/bin`, await this.wslExecutable("uv"), "tool", "install", "--force", "--link-mode", "copy", "--with-requirements", windowsPathToWsl(lockFile), artifact], timeoutMs: 300_000 }
      : { executable: "uv", args: ["tool", "install", "--force", "--link-mode", "copy", "--with-requirements", lockFile, artifact], env: { UV_TOOL_DIR: path.join(managed, "tools"), UV_TOOL_BIN_DIR: path.join(managed, "bin") }, timeoutMs: 300_000 };
    try {
      const result = await this.adapter.run(install);
      if (result.status !== 0 || result.timedOut) throw new Error("Pinned agentacct installation failed: " + (result.stderr || result.stdout).trim());
    } finally {
      if (stagedArtifact) await this.adapter.run({ executable: "wsl.exe", args: ["--", "/usr/bin/rm", "-f", stagedArtifact], timeoutMs: 10_000 }).catch(() => undefined);
    }
  }
  async start(): Promise<void> {
    if (this.adapter.id === "win32") {
      await this.stop();
      const result = await this.adapter.run(await this.windowsReadOnlyCodexCommand(["start"], 60_000, true));
      if (result.status !== 0 || result.timedOut) throw new Error("agentacct start failed: " + (result.stderr || result.stdout).trim());
      return;
    }
    const result = await this.adapter.run(await this.command(["start"], 60_000));
    if (result.status !== 0) throw new Error("agentacct start failed: " + (result.stderr || result.stdout).trim());
  }
  async refresh(): Promise<void> {
    const args = ["usage", "import-local", "--client", "all", "--refresh"] as const;
    const command = this.adapter.id === "win32"
      ? await this.windowsReadOnlyCodexCommand(args, 300_000, true)
      : await this.command(args, 300_000);
    const result = await this.adapter.run(command);
    if (result.status !== 0 || result.timedOut) throw new Error("agentacct refresh failed: " + (result.stderr || result.stdout).trim());
  }
  async stop(): Promise<void> { const result = await this.adapter.run(await this.command(["stop"], 60_000)); if (result.status !== 0) throw new Error("agentacct stop failed: " + (result.stderr || result.stdout).trim()); }
  async autostartCommand(): Promise<HostCommand> { return this.command(["start", "--foreground"], 0); }
  async uninstallManagedRuntime():Promise<void>{if(this.adapter.id==="win32"){const managed=await this.wslManagedRoot();if(!/^\/home\/[A-Za-z0-9._-]+\/\.local\/share\/afd\/telemetry-v2\/agentacct$/.test(managed))throw new Error("Unsafe AFD-managed agentacct root.");const result=await this.adapter.run({executable:"wsl.exe",args:["--","/usr/bin/rm","-rf","--",managed],timeoutMs:60_000});if(result.status!==0)throw new Error("Could not remove the AFD-managed agentacct runtime and evidence store.");return;}const result=await this.adapter.run({executable:"uv",args:["tool","uninstall","agentacct"],env:{UV_TOOL_DIR:path.join(this.managedRoot(),"tools"),UV_TOOL_BIN_DIR:path.join(this.managedRoot(),"bin")},timeoutMs:60_000});if(result.status!==0&&!/not installed/i.test(result.stderr+result.stdout))throw new Error("Could not remove the AFD-managed agentacct runtime.");}

  async status(): Promise<AgentacctStatus> {
    try {
    const version = await this.adapter.run(await this.command(["--version"], 10_000));
    if (version.status !== 0 || version.timedOut) return { state: "unavailable", detail: "agentacct is not executable in its supported environment" };
    const match = version.stdout.match(/(\d+\.\d+\.\d+)/); const actual = match?.[1];
    if (actual !== this.expectedVersion) return { state: "incompatible", ...(actual ? { version: actual } : {}), detail: `expected ${this.expectedVersion}` };
    const [capabilities,health,runtime] = await Promise.all([
      this.adapter.run(await this.command(["capabilities", "agents", "--json"])),
      this.adapter.run(await this.command(["usage", "health", "--json"])),
      this.adapter.run(await this.command(["status", "--json"])),
    ]);
    if (capabilities.status !== 0) return { state: "degraded", version: actual, detail: "capability probe failed" };
    if (health.status !== 0) return { state: "degraded", version: actual, capabilities: parseJson(capabilities.stdout, "capabilities"), detail: "ingestion health probe failed" };
    if (runtime.status !== 0) return { state: "degraded", version: actual, capabilities: parseJson(capabilities.stdout, "capabilities"), ingestion: parseJson(health.stdout, "health"), detail: "runtime health probe failed" };
    const capabilityValue=parseJson(capabilities.stdout,"capabilities");const healthValue=parseJson(health.stdout,"health");const runtimeValue=parseJson(runtime.stdout,"runtime");if(!capabilityValue||typeof capabilityValue!=="object"||!healthValue||typeof healthValue!=="object"||!runtimeValue||typeof runtimeValue!=="object")return{state:"incompatible",version:actual,detail:"public CLI JSON contract is incompatible"};const runtimeObject=runtimeValue as Record<string,unknown>;if(runtimeObject.schema_version!=="agent-chronicle.activation-runtime.v1")return{state:"incompatible",version:actual,detail:"public runtime schema is incompatible"};const runtimeStatus={state:boundedString(runtimeObject.state)??"unknown",dashboardHealth:boundedString(runtimeObject.dashboard_health)??"unknown",dashboardUrl:boundedString(runtimeObject.dashboard_url)??"unknown",watcher:boundedString(runtimeObject.watcher)??"unknown"};if(runtimeStatus.dashboardUrl!=="http://127.0.0.1:8765/")return{state:"incompatible",version:actual,detail:"agentacct dashboard is not bound to the declared loopback endpoint"};const healthObject=healthValue as Record<string,unknown>;const ingestionState=boundedString(healthObject.state??healthObject.status);const transientRotation=ingestionState?.toLowerCase()==="degraded"&&isRecoverableCodexRotation(healthObject);if(ingestionState&&["degraded","error","failed","unhealthy","stale"].includes(ingestionState.toLowerCase())&&!transientRotation)return{state:"degraded",version:actual,capabilities:capabilityValue,ingestion:healthValue,runtime:runtimeStatus,detail:`ingestion is ${ingestionState}`};if(runtimeStatus.state!=="running"||runtimeStatus.dashboardHealth!=="healthy"||runtimeStatus.watcher!=="running")return{state:"degraded",version:actual,capabilities:capabilityValue,ingestion:healthValue,runtime:runtimeStatus,detail:"agentacct local runtime is not healthy"};return { state: "healthy", version: actual, capabilities: capabilityValue, ingestion: healthValue, runtime:runtimeStatus, detail: transientRotation?"public CLI contract is healthy; active Codex rollout scans are fail-closed and retry":"public CLI contract is healthy" };
    } catch {
      return { state: "unavailable", detail: "agentacct runtime could not be probed in its supported environment" };
    }
  }

  async findBySessionHash(agent: string, sessionHash: string, identityKeyFile: string): Promise<AgentacctSessionLookup> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent) || !/^[a-f0-9]{20}$/.test(sessionHash)) throw new Error("Invalid exact-session correlation input.");
    let helper=helperPath();let keyFile=identityKeyFile;
    if(this.adapter.id==="win32"){helper=windowsPathToWsl(helper);keyFile=windowsPathToWsl(keyFile);}
    const invocation:HostCommand=this.adapter.id==="win32"?{executable:"wsl.exe",args:["--","python3",helper,"session-hash",agent,sessionHash,keyFile],env:{AGENTACCT_PRICING_AUTO_REFRESH:"0"},timeoutMs:15_000}:{executable:"python3",args:[helper,"session-hash",agent,sessionHash,keyFile],env:{AGENTACCT_PRICING_AUTO_REFRESH:"0"},timeoutMs:15_000};
    const result=await this.adapter.run(invocation);if((result.status!==0&&result.status!==3)||result.timedOut)throw new Error("agentacct exact-session query failed without exposing private identifiers.");const raw=parseJson(result.stdout,"session query");if(!raw||typeof raw!=="object")throw new Error("agentacct exact-session response is incompatible.");const object=raw as Record<string,unknown>;if(object.status==="unlinked")return{status:"unlinked",matchCount:0};if(object.status==="ambiguous"){const count=boundedNumber(object.matchCount);if(count===undefined||!Number.isSafeInteger(count)||count<2)throw new Error("agentacct ambiguity response is invalid.");return{status:"ambiguous",matchCount:count};}if(object.status!=="exact_session"||!object.evidence||typeof object.evidence!=="object")throw new Error("agentacct exact-session response is incompatible.");const evidence=object.evidence as Record<string,unknown>;if(evidence.source!=="agentacct-v1-session"||evidence.version!==this.expectedVersion)throw new Error("agentacct exact-session contract version is incompatible.");const workItemCount=boundedNumber(evidence.workItemCount);const machineCheckCount=boundedNumber(evidence.machineCheckCount);if(workItemCount===undefined||machineCheckCount===undefined)throw new Error("agentacct exact-session counts are invalid.");const models=Array.isArray(evidence.models)?evidence.models.filter((item):item is string=>typeof item==="string"&&item.length<=120&&/^[A-Za-z0-9._:/-]+$/.test(item)).slice(0,20):[];return{status:"exact_session",evidence:{source:"agentacct-v1-session",version:this.expectedVersion,...(boundedString(evidence.status)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.status)!)?{status:boundedString(evidence.status)!}:{}),...(boundedString(evidence.lastActivityAt)&&Number.isFinite(Date.parse(boundedString(evidence.lastActivityAt)!))?{lastActivityAt:boundedString(evidence.lastActivityAt)!}:{}),...(boundedString(evidence.instrumentationState)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.instrumentationState)!)?{instrumentationState:boundedString(evidence.instrumentationState)!}:{}),...(boundedNumber(evidence.usageTokens)!==undefined?{usageTokens:boundedNumber(evidence.usageTokens)!}:{}),...(boundedString(evidence.usageConfidence)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.usageConfidence)!)?{usageConfidence:boundedString(evidence.usageConfidence)!}:{}),...(boundedNumber(evidence.estimatedCost)!==undefined?{estimatedCost:boundedNumber(evidence.estimatedCost)!}:{}),...(boundedString(evidence.costConfidence)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.costConfidence)!)?{costConfidence:boundedString(evidence.costConfidence)!}:{}),workItemCount,machineCheckCount,models}};
  }
}
