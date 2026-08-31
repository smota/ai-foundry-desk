import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HostCommand, PlatformAdapter } from "./platform.js";

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
export interface AgentacctAdapterOptions { readonly pythonExecutable?: string; readonly uvExecutable?: string; readonly managedRoot?: string }

type NativeProcessName = "api" | "watcher";
type NativeProcessState = { readonly schemaVersion: 1; readonly pid: number; readonly fingerprint: string; readonly command: HostCommand };

const SAFE_VERSION = /^\d+\.\d+\.\d+$/;

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
function repositoryFile(...segments:string[]):string { const current=path.dirname(fileURLToPath(import.meta.url));const candidates=[path.resolve(current,"..","..",...segments),path.resolve(current,"..","..","..",...segments)];const found=candidates.find(existsSync);if(!found)throw new Error(`AFD managed file is missing: ${segments.join("/")}.`);return found; }
function helperPath(): string { return repositoryFile("scripts","agentacct-query.py"); }
function dependencyLockPath(): string { return repositoryFile("requirements","pylock.agentacct.toml"); }
function compatibilityPath(name:"afd_agentacct_windows.py"|"fcntl.py"|"sitecustomize.py"):string{return repositoryFile("scripts","agentacct-native",name);}

export class AgentacctAdapter {
  private readonly pythonExecutable: string;
  private readonly uvExecutable: string;
  private readonly nativeManagedRoot: string;
  constructor(private readonly adapter: PlatformAdapter, private readonly expectedVersion: string, options: AgentacctAdapterOptions = {}) {
    if (!SAFE_VERSION.test(expectedVersion)) throw new Error("An exact agentacct version is required.");
    this.pythonExecutable=options.pythonExecutable??"python";
    this.uvExecutable=options.uvExecutable??"uv";
    this.nativeManagedRoot=path.resolve(options.managedRoot??(adapter.id==="win32"?path.join(homedir(),".afd","managed","telemetry-v2","agentacct"):path.join(adapter.stateRoot,"telemetry-v2","agentacct")));
  }

  private managedRoot(): string { return this.nativeManagedRoot; }
  private storeRoot():string{return path.join(this.managedRoot(),"store");}
  private compatibilityRoot():string{return path.join(this.managedRoot(),"compat");}
  private executable():string{return path.join(this.managedRoot(),"bin",this.adapter.id==="win32"?"agentacct.exe":"agentacct");}
  private toolPython():string{return path.join(this.managedRoot(),"tools","agentacct",this.adapter.id==="win32"?"Scripts":"bin",this.adapter.id==="win32"?"python.exe":"python");}
  private sourceHomes(): Readonly<{ CODEX_HOME: string; CLAUDE_CONFIG_DIR: string; HERMES_HOME: string }> {
    return {
      CODEX_HOME: path.resolve(process.env.CODEX_HOME ?? path.join(homedir(), ".codex")),
      CLAUDE_CONFIG_DIR: path.resolve(process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude")),
      HERMES_HOME: path.resolve(process.env.HERMES_HOME ?? path.join(homedir(), ".hermes")),
    };
  }
  private environment():Readonly<Record<string,string>>{
    return {
      AGENTACCT_PRICING_AUTO_REFRESH:"0",
      AGENTACCT_EVIDENCE_V2:"0",
      AGENTACCT_STORE_DIR:this.storeRoot(),
      PYTHONNOUSERSITE:"1",
      ...(this.adapter.id==="win32"?{PYTHONPATH:this.compatibilityRoot()}:{}),
      ...this.sourceHomes(),
    };
  }
  private command(args: readonly string[], timeoutMs = 30_000): HostCommand { return this.adapter.id==="win32"?{executable:this.toolPython(),args:["-c","from agentacct.cli import app; app()",...args],env:this.environment(),timeoutMs}:{executable:this.executable(),args,env:this.environment(),timeoutMs}; }
  private processFile(name:NativeProcessName):string{return path.join(this.managedRoot(),"runtime",`${name}.json`);}
  private async readNativeProcess(name:NativeProcessName):Promise<NativeProcessState|undefined>{
    const raw=await this.adapter.readText(this.processFile(name));if(!raw)return undefined;
    try{const value=JSON.parse(raw) as NativeProcessState;if(value.schemaVersion!==1||!Number.isSafeInteger(value.pid)||value.pid<=0||!/^[a-f0-9]{64}$/.test(value.fingerprint)||!value.command||typeof value.command.executable!=="string"||!Array.isArray(value.command.args))return undefined;return value;}catch{return undefined;}
  }
  private async nativeProcessHealthy(name:NativeProcessName):Promise<boolean>{
    const state=await this.readNativeProcess(name);if(!state||!await this.adapter.isRunning(state.pid))return false;
    return await this.adapter.processFingerprint(state.pid)===state.fingerprint;
  }
  private async fingerprintStartedProcess(pid:number):Promise<string|undefined>{
    for(let attempt=0;attempt<20;attempt+=1){
      const fingerprint=await this.adapter.processFingerprint(pid);if(fingerprint)return fingerprint;
      if(!await this.adapter.isRunning(pid))return undefined;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return undefined;
  }
  private async startNativeProcess(name:NativeProcessName,command:HostCommand):Promise<void>{
    const existing=await this.readNativeProcess(name);
    if(existing&&await this.adapter.isRunning(existing.pid)){
      if(await this.adapter.processFingerprint(existing.pid)===existing.fingerprint)return;
      throw new Error(`Refusing to replace unrelated process recorded as agentacct ${name}.`);
    }
    await this.adapter.remove(this.processFile(name));
    const pid=await this.adapter.start(command);const fingerprint=await this.fingerprintStartedProcess(pid);
    if(!fingerprint){await this.adapter.stop(pid).catch(()=>undefined);throw new Error(`Could not fingerprint native agentacct ${name} process.`);}
    await this.adapter.writeText(this.processFile(name),JSON.stringify({schemaVersion:1,pid,fingerprint,command} satisfies NativeProcessState,null,2)+"\n");
  }
  private async stopNativeProcess(name:NativeProcessName):Promise<void>{
    const state=await this.readNativeProcess(name);if(!state){await this.adapter.remove(this.processFile(name));return;}
    if(await this.adapter.isRunning(state.pid)){
      if(await this.adapter.processFingerprint(state.pid)!==state.fingerprint)throw new Error(`Refusing to stop unrelated process recorded as agentacct ${name}.`);
      await this.adapter.stop(state.pid);
    }
    await this.adapter.remove(this.processFile(name));
  }
  private async nativeRuntime():Promise<NonNullable<AgentacctStatus["runtime"]>>{
    const [api,watcher,listening]=await Promise.all([this.nativeProcessHealthy("api"),this.nativeProcessHealthy("watcher"),this.adapter.isListening("127.0.0.1",8765)]);
    return{state:api&&watcher&&listening?"running":"degraded",dashboardHealth:api&&listening?"healthy":"unavailable",dashboardUrl:"http://127.0.0.1:8765/",watcher:watcher?"running":"unavailable"};
  }

  async install(input: AgentacctInstallSource): Promise<void> {
    const lockFile=dependencyLockPath();
    const actualLockSha256=createHash("sha256").update((await readFile(lockFile,"utf8")).replace(/\r\n/g,"\n")).digest("hex");
    if(!/^[a-f0-9]{64}$/.test(input.lockSha256)||actualLockSha256!==input.lockSha256.toLowerCase())throw new Error("The agentacct dependency lock does not match the reviewed recipe.");
    if(!input.verifiedArtifact)throw new Error("A locally verified agentacct artifact is required.");
    await this.adapter.writeText(path.join(this.storeRoot(),".afd-root"),"managed\n");
    if(this.adapter.id==="win32")for(const name of ["afd_agentacct_windows.py","fcntl.py","sitecustomize.py"] as const)await this.adapter.writeText(path.join(this.compatibilityRoot(),name),await readFile(compatibilityPath(name),"utf8"));
    const result=await this.adapter.run({
      executable:this.uvExecutable,
      args:["tool","install","--force","--link-mode","copy","--python",this.pythonExecutable,"--no-python-downloads","--with-requirements",lockFile,input.verifiedArtifact],
      env:{UV_TOOL_DIR:path.join(this.managedRoot(),"tools"),UV_TOOL_BIN_DIR:path.join(this.managedRoot(),"bin"),UV_CACHE_DIR:path.join(this.managedRoot(),"cache")},
      timeoutMs:300_000,
    });
    if(result.status!==0||result.timedOut)throw new Error("Pinned native agentacct installation failed: "+(result.stderr||result.stdout).trim());
    const version=await this.adapter.run(this.command(["--version"],10_000));
    if(version.status!==0||!version.stdout.includes(this.expectedVersion))throw new Error("Installed native agentacct runtime failed its version probe: "+(version.stderr||version.stdout).trim());
  }
  async start():Promise<void>{
    if(this.adapter.id!=="win32"){
      const result=await this.adapter.run(this.command(["start"],60_000));if(result.status!==0||result.timedOut)throw new Error("agentacct start failed: "+(result.stderr||result.stdout).trim());return;
    }
    try{
      await this.startNativeProcess("watcher",this.command(["usage","watch","--client","all","--interval-seconds","60","--refresh","--store-dir",this.storeRoot()],0));
      await this.startNativeProcess("api",this.command(["api","serve","--host","127.0.0.1","--port","8765","--store-dir",this.storeRoot()],0));
    }catch(error){await this.stop().catch(()=>undefined);throw error;}
  }
  async refresh():Promise<void>{const result=await this.adapter.run(this.command(["usage","import-local","--client","all","--refresh"],300_000));if(result.status!==0||result.timedOut)throw new Error("agentacct refresh failed: "+(result.stderr||result.stdout).trim());}
  async stop():Promise<void>{
    if(this.adapter.id!=="win32"){const result=await this.adapter.run(this.command(["stop"],60_000));if(result.status!==0)throw new Error("agentacct stop failed: "+(result.stderr||result.stdout).trim());return;}
    await this.stopNativeProcess("api");await this.stopNativeProcess("watcher");
  }
  async autostartCommand():Promise<HostCommand>{return this.adapter.id==="win32"?this.command(["api","serve","--host","127.0.0.1","--port","8765","--store-dir",this.storeRoot()],0):this.command(["start","--foreground"],0);}
  async uninstallManagedRuntime():Promise<void>{
    const managed=path.resolve(this.managedRoot());const allowedRoot=path.resolve(this.adapter.id==="win32"?path.join(homedir(),".afd","managed"):this.adapter.stateRoot);
    if(!managed.startsWith(allowedRoot+path.sep))throw new Error("Unsafe AFD-managed agentacct root.");
    await this.stop().catch(()=>undefined);
    const result=await this.adapter.run({executable:this.uvExecutable,args:["tool","uninstall","agentacct"],env:{UV_TOOL_DIR:path.join(managed,"tools"),UV_TOOL_BIN_DIR:path.join(managed,"bin"),UV_CACHE_DIR:path.join(managed,"cache")},timeoutMs:60_000});
    if(result.status!==0&&!/not installed/i.test(result.stderr+result.stdout))throw new Error("Could not uninstall the native AFD-managed agentacct runtime.");
    await rm(managed,{recursive:true,force:true});
  }

  async status():Promise<AgentacctStatus>{
    try{
      const version=await this.adapter.run(this.command(["--version"],10_000));
      if(version.status!==0||version.timedOut)return{state:"unavailable",detail:"native agentacct is not executable in its managed environment"};
      const match=version.stdout.match(/(\d+\.\d+\.\d+)/);const actual=match?.[1];if(actual!==this.expectedVersion)return{state:"incompatible",...(actual?{version:actual}:{}),detail:`expected ${this.expectedVersion}`};
      const capabilities=await this.adapter.run(this.command(["capabilities","agents","--json"]));
      const health=await this.adapter.run(this.command(["usage","health","--json"]));
      if(capabilities.status!==0)return{state:"degraded",version:actual,detail:"capability probe failed"};
      if(health.status!==0)return{state:"degraded",version:actual,capabilities:parseJson(capabilities.stdout,"capabilities"),detail:"ingestion health probe failed"};
      let runtime:NonNullable<AgentacctStatus["runtime"]>;
      if(this.adapter.id==="win32")runtime=await this.nativeRuntime();
      else{const runtimeResult=await this.adapter.run(this.command(["status","--json"]));if(runtimeResult.status!==0)throw new Error("runtime health probe failed");const value=parseJson(runtimeResult.stdout,"runtime") as Record<string,unknown>;if(value.schema_version!=="agent-chronicle.activation-runtime.v1")throw new Error("public runtime schema is incompatible");runtime={state:boundedString(value.state)??"unknown",dashboardHealth:boundedString(value.dashboard_health)??"unknown",dashboardUrl:boundedString(value.dashboard_url)??"unknown",watcher:boundedString(value.watcher)??"unknown"};}
      const capabilityValue=parseJson(capabilities.stdout,"capabilities");const healthValue=parseJson(health.stdout,"health");if(!capabilityValue||typeof capabilityValue!=="object"||!healthValue||typeof healthValue!=="object")return{state:"incompatible",version:actual,detail:"public CLI JSON contract is incompatible"};
      if(runtime.dashboardUrl!=="http://127.0.0.1:8765/")return{state:"incompatible",version:actual,detail:"agentacct API is not bound to the declared loopback endpoint"};
      const healthObject=healthValue as Record<string,unknown>;const ingestionState=boundedString(healthObject.state??healthObject.status);const transientRotation=ingestionState?.toLowerCase()==="degraded"&&isRecoverableCodexRotation(healthObject);
      if(ingestionState&&["degraded","error","failed","unhealthy","stale"].includes(ingestionState.toLowerCase())&&!transientRotation)return{state:"degraded",version:actual,capabilities:capabilityValue,ingestion:healthValue,runtime,detail:`ingestion is ${ingestionState}`};
      if(runtime.state!=="running"||runtime.dashboardHealth!=="healthy"||runtime.watcher!=="running")return{state:"degraded",version:actual,capabilities:capabilityValue,ingestion:healthValue,runtime,detail:"native agentacct runtime is not healthy"};
      return{state:"healthy",version:actual,capabilities:capabilityValue,ingestion:healthValue,runtime,detail:transientRotation?"native public CLI contract is healthy; active Codex rollout scans are fail-closed and retry":"native public CLI contract is healthy"};
    }catch(error){return{state:"unavailable",detail:`native agentacct runtime could not be probed: ${error instanceof Error?error.message:String(error)}`};}
  }

  async findBySessionHash(agent:string,sessionHash:string,identityKeyFile:string):Promise<AgentacctSessionLookup>{
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)||!/^[a-f0-9]{20}$/.test(sessionHash))throw new Error("Invalid exact-session correlation input.");
    const result=await this.adapter.run({executable:this.toolPython(),args:[helperPath(),"session-hash",agent,sessionHash,identityKeyFile],env:this.environment(),timeoutMs:15_000});
    if((result.status!==0&&result.status!==3)||result.timedOut)throw new Error("agentacct exact-session query failed without exposing private identifiers.");
    const raw=parseJson(result.stdout,"session query");if(!raw||typeof raw!=="object")throw new Error("agentacct exact-session response is incompatible.");const object=raw as Record<string,unknown>;
    if(object.status==="unlinked")return{status:"unlinked",matchCount:0};if(object.status==="ambiguous"){const count=boundedNumber(object.matchCount);if(count===undefined||!Number.isSafeInteger(count)||count<2)throw new Error("agentacct ambiguity response is invalid.");return{status:"ambiguous",matchCount:count};}
    if(object.status!=="exact_session"||!object.evidence||typeof object.evidence!=="object")throw new Error("agentacct exact-session response is incompatible.");const evidence=object.evidence as Record<string,unknown>;if(evidence.source!=="agentacct-v1-session"||evidence.version!==this.expectedVersion)throw new Error("agentacct exact-session contract version is incompatible.");const workItemCount=boundedNumber(evidence.workItemCount);const machineCheckCount=boundedNumber(evidence.machineCheckCount);if(workItemCount===undefined||machineCheckCount===undefined)throw new Error("agentacct exact-session counts are invalid.");const models=Array.isArray(evidence.models)?evidence.models.filter((item):item is string=>typeof item==="string"&&item.length<=120&&/^[A-Za-z0-9._:/-]+$/.test(item)).slice(0,20):[];
    return{status:"exact_session",evidence:{source:"agentacct-v1-session",version:this.expectedVersion,...(boundedString(evidence.status)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.status)!)?{status:boundedString(evidence.status)!}:{}),...(boundedString(evidence.lastActivityAt)&&Number.isFinite(Date.parse(boundedString(evidence.lastActivityAt)!))?{lastActivityAt:boundedString(evidence.lastActivityAt)!}:{}),...(boundedString(evidence.instrumentationState)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.instrumentationState)!)?{instrumentationState:boundedString(evidence.instrumentationState)!}:{}),...(boundedNumber(evidence.usageTokens)!==undefined?{usageTokens:boundedNumber(evidence.usageTokens)!}:{}),...(boundedString(evidence.usageConfidence)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.usageConfidence)!)?{usageConfidence:boundedString(evidence.usageConfidence)!}:{}),...(boundedNumber(evidence.estimatedCost)!==undefined?{estimatedCost:boundedNumber(evidence.estimatedCost)!}:{}),...(boundedString(evidence.costConfidence)&&/^[a-z0-9._-]+$/i.test(boundedString(evidence.costConfidence)!)?{costConfidence:boundedString(evidence.costConfidence)!}:{}),workItemCount,machineCheckCount,models}};
  }
}
