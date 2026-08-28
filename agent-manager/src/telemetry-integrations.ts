import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { AgentId, ObservabilityRecipeCapability } from "./contracts.js";
import type { PlatformAdapter } from "./platform.js";

type ManagedAgent = "codex" | "claude-code";
type JournalEntry = { readonly agent: ManagedAgent; readonly file: string; readonly existed: boolean; readonly beforeHash: string; readonly afterHash: string };
type IntegrationJournal = { readonly schemaVersion: 1; readonly entries: readonly JournalEntry[] };

const CODEX_MARKER = "# >>> AFD telemetry v2 >>>";
const CODEX_END = "# <<< AFD telemetry v2 <<<";
const CODEX_BLOCK = `${CODEX_MARKER}\n[otel]\nenvironment = "afd-local"\nlog_user_prompt = false\nexporter = "none"\nmetrics_exporter = "none"\ntrace_exporter = { "otlp-http" = { endpoint = "http://127.0.0.1:4318/v1/traces", protocol = "json", headers = {} } }\n${CODEX_END}`;
const CLAUDE_ENV: Readonly<Record<string,string>> = {
  CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
  OTEL_METRICS_EXPORTER: "none",
  OTEL_LOGS_EXPORTER: "none",
  OTEL_LOG_USER_PROMPTS: "0",
  OTEL_LOG_TOOL_DETAILS: "0",
  OTEL_LOG_TOOL_CONTENT: "0",
  OTEL_LOG_RAW_API_BODIES: "0",
};

function digest(value:string):string{return createHash("sha256").update(value).digest("hex");}
function journalFile(adapter:PlatformAdapter):string{return path.join(adapter.stateRoot,"telemetry-v2","integrations","journal.json");}
function target(agent:ManagedAgent):string{return agent==="codex"?path.join(process.env.CODEX_HOME??path.join(homedir(),".codex"),"config.toml"):path.join(process.env.CLAUDE_CONFIG_DIR??path.join(homedir(),".claude"),"settings.json");}
function managed(capability:ObservabilityRecipeCapability):ManagedAgent[]{return capability.nativeIntegrations.filter((agent):agent is ManagedAgent=>agent==="codex"||agent==="claude-code");}

export function nativeIntegrationEffects(capability:ObservabilityRecipeCapability):readonly string[]{return managed(capability).map(agent=>`${agent}: managed telemetry settings in ${target(agent)}`);}

export async function nativeIntegrationPreflight(capability:ObservabilityRecipeCapability,adapter:PlatformAdapter):Promise<readonly string[]> {
  const issues:string[]=[];const journal=await adapter.readText(journalFile(adapter));if(journal)return issues;
  for(const agent of managed(capability)){const file=target(agent);const current=await adapter.readText(file);if(!current)continue;if(agent==="codex"&&(/^\s*\[otel(?:\.|\])/m.test(current)||current.includes(CODEX_MARKER)))issues.push("Codex already has telemetry configuration; automatic merge is refused.");if(agent==="claude-code"){try{const root=JSON.parse(current) as Record<string,unknown>;const env=root.env&&typeof root.env==="object"?root.env as Record<string,unknown>:{};if(Object.keys(CLAUDE_ENV).some(key=>key in env))issues.push("Claude Code already has telemetry environment settings; automatic merge is refused.");}catch{issues.push("Claude Code settings.json is not valid JSON.");}}
  }return issues;
}

export async function applyNativeIntegrations(capability:ObservabilityRecipeCapability,adapter:PlatformAdapter):Promise<void>{
  const existing=await adapter.readText(journalFile(adapter));if(existing)return;const issues=await nativeIntegrationPreflight(capability,adapter);if(issues.length)throw new Error(issues.join("; "));const entries:JournalEntry[]=[];
  try{for(const agent of managed(capability)){const file=target(agent);const before=await adapter.readText(file)??"";let after:string;if(agent==="codex"){after=before.replace(/\s*$/u,"")+(before.trim()?"\n\n":"")+CODEX_BLOCK+"\n";}else{const root=before?JSON.parse(before) as Record<string,unknown>:{};const env=root.env&&typeof root.env==="object"?root.env as Record<string,unknown>:{};after=JSON.stringify({...root,env:{...env,...CLAUDE_ENV}},null,2)+"\n";}await adapter.writeText(file,after);entries.push({agent,file,existed:Boolean(before),beforeHash:digest(before),afterHash:digest(after)});}await adapter.writeText(journalFile(adapter),JSON.stringify({schemaVersion:1,entries} satisfies IntegrationJournal,null,2)+"\n");}
  catch(error){for(const entry of entries.reverse())await revert(entry,adapter).catch(()=>undefined);throw error;}
}

async function revert(entry:JournalEntry,adapter:PlatformAdapter):Promise<void>{const current=await adapter.readText(entry.file);if(current===undefined)return;if(digest(current)!==entry.afterHash)throw new Error(`${entry.agent} telemetry settings drifted; rollback refused.`);if(entry.agent==="codex"){const start=current.indexOf(CODEX_MARKER);const end=current.indexOf(CODEX_END,start);if(start<0||end<0)throw new Error("Managed Codex telemetry block is missing.");const before=current.slice(0,start).replace(/\s*$/u,"")+(entry.existed?"\n":"");if(digest(before)!==entry.beforeHash)throw new Error("Codex telemetry rollback could not prove the prior state.");if(entry.existed)await adapter.writeText(entry.file,before);else await adapter.remove(entry.file);return;}const root=JSON.parse(current) as Record<string,unknown>;const env=root.env&&typeof root.env==="object"?{...(root.env as Record<string,unknown>)}:{};for(const [key,value] of Object.entries(CLAUDE_ENV)){if(env[key]!==value)throw new Error("Managed Claude telemetry settings drifted; rollback refused.");delete env[key];}const next={...root};if(Object.keys(env).length)next.env=env;else delete next.env;const before=entry.existed?JSON.stringify(next,null,2)+"\n":"";if(digest(before)!==entry.beforeHash)throw new Error("Claude telemetry rollback could not prove the prior state.");if(entry.existed)await adapter.writeText(entry.file,before);else await adapter.remove(entry.file);}

export async function rollbackNativeIntegrations(adapter:PlatformAdapter):Promise<void>{const raw=await adapter.readText(journalFile(adapter));if(!raw)return;const value=JSON.parse(raw) as IntegrationJournal;if(value.schemaVersion!==1||!Array.isArray(value.entries))throw new Error("Telemetry integration journal is incompatible.");for(const entry of [...value.entries].reverse())await revert(entry,adapter);await adapter.remove(journalFile(adapter));}

export const supportedNativeTelemetryAgents:readonly AgentId[]=["codex","claude-code"];
