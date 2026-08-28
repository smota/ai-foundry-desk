import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentTargets } from "./catalog.js";
import type { AgentId, Recipe, RecipePlan } from "./contracts.js";
import { applyTelemetry, removeTelemetryManaged, telemetryStatus, verifyTelemetry } from "./telemetry-runtime.js";

const moduleRoot=path.dirname(fileURLToPath(import.meta.url));
const root=[path.resolve(moduleRoot,"..",".."),path.resolve(moduleRoot,"..","..","..")].find(candidate=>existsSync(path.join(candidate,"recipes")))??path.resolve(moduleRoot,"..","..");
const ID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256=/^[a-f0-9]{64}$/i;
const NPM_TOOLS:Readonly<Record<string,string>>={vibium:"vibium",tokscale:"tokscale"};
async function exists(p:string){try{await stat(p);return true;}catch{return false;}}
function safeRelative(v:unknown):v is string{return typeof v==="string"&&Boolean(v)&&!v.includes("\\")&&!v.startsWith("/")&&!/^[a-z]:/i.test(v)&&v.split("/").every(p=>p&&p!=="."&&p!=="..");}
export function isRecipe(v:unknown):v is Recipe{
  if(!v||typeof v!=="object")return false; const r=v as Record<string,unknown>;
  if((r.recipeVersion!==1&&r.recipeVersion!==2)||typeof r.id!=="string"||!ID.test(r.id)||typeof r.version!=="string"||typeof r.origin!=="string"||!Array.isArray(r.skills)||!Array.isArray(r.tools)||!Array.isArray(r.prerequisites)||!Array.isArray(r.checks))return false;
  if(!r.rollback||typeof r.rollback!=="object"||(r.rollback as {managedOnly?:unknown}).managedOnly!==true)return false;
  const agents=new Set(["claude-code","codex","antigravity","pi","hermes","grok"]);const skillIds=new Set<string>(); for(const raw of r.skills){if(!raw||typeof raw!=="object")return false;const s=raw as Record<string,unknown>;if(typeof s.id!=="string"||!ID.test(s.id)||skillIds.has(s.id)||!safeRelative(s.source)||!Array.isArray(s.targets)||new Set(s.targets).size!==s.targets.length||s.targets.some(a=>typeof a!=="string"||!agents.has(a))||(s.localOverlay!==undefined&&(typeof s.localOverlay!=="string"||!/^AFD_[A-Z0-9_]+$/.test(s.localOverlay))))return false;skillIds.add(s.id);}
  const toolIds=new Set<string>(); for(const raw of r.tools){if(!raw||typeof raw!=="object")return false;const t=raw as Record<string,unknown>;if(typeof t.id!=="string"||!ID.test(t.id)||toolIds.has(t.id)||typeof t.command!=="string"||typeof t.source!=="string"||typeof t.version!=="string"||!SEMVER.test(t.version)||(t.checksum!==undefined&&!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(String(t.checksum))))return false;toolIds.add(t.id);}
  if(r.recipeVersion===1&&r.capabilities!==undefined)return false;
  if(r.recipeVersion===2&&!Array.isArray(r.capabilities))return false;
  if(r.capabilities!==undefined){
    if(!Array.isArray(r.capabilities)||r.capabilities.length>1)return false;
    for(const raw of r.capabilities){
      if(!raw||typeof raw!=="object")return false;
      const c=raw as Record<string,unknown>;
      const collector=c.collector as Record<string,unknown>|undefined;
      const phoenix=c.phoenix as Record<string,unknown>|undefined;
      const runtime=phoenix?.runtime as Record<string,unknown>|undefined;
      const agentacct=c.agentacct as Record<string,unknown>|undefined;
      if(c.id!=="observability"||typeof c.required!=="boolean"||!collector||typeof collector.version!=="string"||!SEMVER.test(collector.version)||typeof collector.source!=="string"||!/^https:\/\//i.test(collector.source)||typeof collector.sha256!=="string"||!SHA256.test(collector.sha256)||!phoenix||typeof phoenix.version!=="string"||!SEMVER.test(phoenix.version)||typeof phoenix.lockSha256!=="string"||!SHA256.test(phoenix.lockSha256)||!runtime||typeof runtime.version!=="string"||!SEMVER.test(runtime.version)||typeof runtime.source!=="string"||!/^https:\/\//i.test(runtime.source)||typeof runtime.sha256!=="string"||!SHA256.test(runtime.sha256)||!agentacct||typeof agentacct.version!=="string"||!SEMVER.test(agentacct.version)||agentacct.mode!=="observe-only"||typeof agentacct.source!=="string"||!/^https:\/\//i.test(agentacct.source)||typeof agentacct.sha256!=="string"||!SHA256.test(agentacct.sha256)||typeof agentacct.lockSha256!=="string"||!SHA256.test(agentacct.lockSha256)||!Number.isSafeInteger(c.retentionDays)||Number(c.retentionDays)<1||Number(c.retentionDays)>365||typeof c.autostart!=="boolean"||!Array.isArray(c.nativeIntegrations)||new Set(c.nativeIntegrations).size!==c.nativeIntegrations.length||c.nativeIntegrations.some(a=>typeof a!=="string"||!agents.has(a)))return false;
    }
  }
  return r.prerequisites.every(x=>typeof x==="string")&&r.checks.every(x=>typeof x==="string");
}
export async function loadRecipe(source:string):Promise<{recipe:Recipe;source:string;base:string}>{
  let content:string;let resolved:string; if(/^https:\/\//i.test(source)){const response=await fetch(source,{redirect:"error"});if(!response.ok)throw new Error(`Recipe URL failed: HTTP ${response.status}`);content=await response.text();resolved=source;}else{resolved=source.startsWith("builtin:")?path.join(root,"recipes",`${source.slice(8)}.json`):path.resolve(source);if((await stat(resolved)).isDirectory())resolved=path.join(resolved,"recipe.json");content=await readFile(resolved,"utf8");}
  const parsed:unknown=JSON.parse(content.replace(/^\uFEFF/,""));if(!isRecipe(parsed))throw new Error(`Invalid recipe: ${source}`);return{recipe:parsed,source:resolved,base:/^https:\/\//i.test(resolved)?resolved:path.dirname(resolved)};
}
function targetSkillRoot(home:string,agent:AgentId):string|undefined{const shared=path.join(home,".agents","skills");return agent==="claude-code"?path.join(home,".claude","skills"):agent==="antigravity"?path.join(home,".gemini","antigravity-cli","skills"):agent==="codex"||agent==="pi"||agent==="grok"?shared:agent==="hermes"?path.join(home,".afd","managed","hermes","skills"):undefined;}
export async function planRecipe(source:string,home=process.env.USERPROFILE??process.cwd()):Promise<RecipePlan>{
  const loaded=await loadRecipe(source);const actions:RecipePlan["actions"][number][]=[];
  for(const skill of loaded.recipe.skills)for(const agent of skill.targets){const adapter=agentTargets.find(a=>a.id===agent);const target=targetSkillRoot(home,agent);if(!adapter||adapter.skills!=="supported"||!target)actions.push({kind:"blocked",id:skill.id,target:agent,detail:"official adapter unavailable"});else actions.push({kind:"copy-skill",id:skill.id,target:path.join(target,skill.id),detail:`from ${skill.source}`});}
  for(const tool of loaded.recipe.tools){const pkg=NPM_TOOLS[tool.id];const verified=pkg&&tool.source===`npm:${pkg}`&&tool.command===tool.id&&Boolean(tool.checksum)&&tool.version!=="unresolved";actions.push({kind:verified?"install-tool":"blocked",id:tool.id,target:tool.command,detail:verified?`pnpm global ${pkg}@${tool.version}; integrity pinned`:`tool adapter unavailable or unpinned`});}
  for(const capability of loaded.recipe.capabilities??[]){actions.push({kind:"configure-capability",id:capability.id,target:"telemetry-v2",detail:`Collector ${capability.collector.version}; Phoenix ${capability.phoenix.version} on checksummed CPython ${capability.phoenix.runtime.version}; agentacct ${capability.agentacct.version} ${capability.agentacct.mode} with Evidence v2 shadow disabled; retention ${capability.retentionDays}d, agentacct upstream_unbounded; ports 4318,6006,8765,9464,13133; autostart ${capability.autostart}; integrations ${capability.nativeIntegrations.join(",")||"none"}`});}
  const blocked=actions.some(a=>a.kind==="blocked");const approvalToken=createHash("sha256").update(JSON.stringify({recipe:loaded.recipe,actions})).digest("hex").slice(0,16);return{recipe:loaded.recipe,source:loaded.source,actions,blocked,approvalToken};
}

/**
 * Runs a package-manager or tool shim without going through a shell.
 *
 * Windows package managers expose `.cmd` shims for direct process execution;
 * using the adjacent `.ps1` shim would make recipe execution depend on the
 * user's PowerShell policy and is not portable to the other host adapters.
 */
function runCommand(name:string,args:string[]){
  if(process.platform!=="win32")return spawnSync(name,args,{encoding:"utf8"});
  const pnpmHome=process.env.PNPM_HOME??path.join(process.env.LOCALAPPDATA??path.join(process.env.USERPROFILE??"","AppData","Local"),"pnpm");
  const executable=path.join(pnpmHome,"bin",`${name}.cmd`);
  return spawnSync(executable,args,{encoding:"utf8",windowsHide:true});
}
function overlayPath(name:string):string|undefined{const current=process.env[name];if(current||!/^AFD_[A-Z0-9_]+$/.test(name))return current;if(process.platform==="win32"){const result=spawnSync("reg.exe",["query","HKCU\\Environment","/v",name],{encoding:"utf8",windowsHide:true});if(result.status!==0)return undefined;const line=result.stdout.split(/\r?\n/).find(value=>value.trimStart().startsWith(name));return line?.trim().split(/\s{2,}/).at(-1);}try{const values=JSON.parse(readFileSync(path.join(process.env.HOME??process.cwd(),".config","afd","overlays.json"),"utf8")) as Record<string,unknown>;return typeof values[name]==="string"?values[name]:undefined;}catch{return undefined;}}
function pnpm(args:string[]):string{const result=runCommand("pnpm",args);if(result.status!==0)throw new Error(`pnpm ${args[0]} failed: ${(result.stderr||result.stdout).trim()}`);return result.stdout.trim();}
function installedVersion(pkg:string):string|undefined{try{const data=JSON.parse(pnpm(["list","--global",pkg,"--depth","-1","--json"])) as Array<{dependencies?:Record<string,{version?:string}>}>;return data[0]?.dependencies?.[pkg]?.version;}catch{return undefined;}}
function applyTool(tool:Recipe["tools"][number]):{package:string;previousVersion?:string}|undefined{const pkg=NPM_TOOLS[tool.id];if(!pkg||tool.source!==`npm:${pkg}`||!tool.checksum)throw new Error(`Unverified tool adapter: ${tool.id}`);const metadata=JSON.parse(pnpm(["view",`${pkg}@${tool.version}`,"dist.integrity","--json"])) as string;if(metadata!==tool.checksum)throw new Error(`Registry integrity mismatch for ${pkg}@${tool.version}`);const previousVersion=installedVersion(pkg);if(previousVersion!==tool.version)pnpm(["add","--global",`${pkg}@${tool.version}`]);const probe=runCommand(tool.command,["--version"]);if(probe.status!==0){if(previousVersion&&previousVersion!==tool.version)pnpm(["add","--global",`${pkg}@${previousVersion}`]);else if(!previousVersion)pnpm(["remove","--global",pkg]);throw new Error(`Installed tool validation failed: ${tool.command}`);}return previousVersion===tool.version?undefined:{package:pkg,...(previousVersion?{previousVersion}:{})};}
async function skillText(base:string,source:string):Promise<string>{if(/^https:\/\//i.test(base)){const url=new URL(`${source.replace(/\/$/,"")}/SKILL.md`,base).href;const response=await fetch(url,{redirect:"error"});if(!response.ok)throw new Error(`Remote skill failed: HTTP ${response.status}`);return response.text();}const src=path.resolve(base,source);if(!src.startsWith(path.resolve(base)+path.sep)||!await exists(path.join(src,"SKILL.md")))throw new Error(`Unsafe or missing skill source: ${source}`);return readFile(path.join(src,"SKILL.md"),"utf8");}
export async function applyRecipe(source:string,options:{home?:string;confirm?:boolean;approvalToken?:string|undefined}={}):Promise<RecipePlan>{
  if(!options.confirm)throw new Error("Recipe application requires --confirm <plan-token> after plan.");
  const loaded=await loadRecipe(source);const plan=await planRecipe(source,options.home);if(options.approvalToken!==plan.approvalToken)throw new Error("Plan token is missing or stale; run plan again.");if(plan.blocked)throw new Error("Recipe is blocked; resolve missing or unverified adapters first.");
  for(const skill of loaded.recipe.skills)if(skill.localOverlay){const overlay=overlayPath(skill.localOverlay);if(!overlay||!await exists(overlay))throw new Error(`Required local overlay is unavailable: ${skill.localOverlay}`);}
  const home=path.resolve(options.home??process.env.USERPROFILE??process.cwd());const stateDir=path.join(home,".afd","recipes",loaded.recipe.id);const statePath=path.join(stateDir,"applied.json");
  let managed:string[]=[];let managedTools:Array<{package:string;previousVersion?:string}>=[];let managedCapabilities:string[]=[];
  try{const prior=JSON.parse(await readFile(statePath,"utf8")) as {managed?:string[];managedTools?:typeof managedTools;managedCapabilities?:string[]};managed=prior.managed??[];managedTools=prior.managedTools??[];managedCapabilities=prior.managedCapabilities??[];}catch{/* first apply */}
  const persist=async()=>{managed=[...new Set(managed)];managedCapabilities=[...new Set(managedCapabilities)];await mkdir(stateDir,{recursive:true});await writeFile(statePath,`${JSON.stringify({recipeVersion:loaded.recipe.recipeVersion,id:loaded.recipe.id,version:loaded.recipe.version,hash:createHash("sha256").update(JSON.stringify(loaded.recipe)).digest("hex"),managed,managedTools,managedCapabilities},null,2)}\n`);};
  for(const action of plan.actions.filter(a=>a.kind==="copy-skill")){const skill=loaded.recipe.skills.find(s=>s.id===action.id)!;const content=await skillText(loaded.base,skill.source);if(await exists(action.target))continue;await mkdir(path.dirname(action.target),{recursive:true});await mkdir(action.target);await writeFile(path.join(action.target,"SKILL.md"),content,{encoding:"utf8",flag:"wx"});managed.push(action.target);await persist();}
  for(const tool of loaded.recipe.tools){const record=applyTool(tool);if(record&&!managedTools.some(item=>item.package===record.package)){managedTools.push(record);await persist();}}
  for(const capability of loaded.recipe.capabilities??[]){await applyTelemetry(capability);if(!managedCapabilities.includes(capability.id)){managedCapabilities.push(capability.id);await persist();}}
  await persist();return plan;
}
export async function verifyRecipe(source:string,home?:string):Promise<{ok:boolean;missing:string[];drift:string[]}>{const loaded=await loadRecipe(source);const plan=await planRecipe(source,home);const missing:string[]=[];const drift:string[]=[];for(const skill of loaded.recipe.skills)if(skill.localOverlay){const overlay=overlayPath(skill.localOverlay);if(!overlay||!await exists(overlay))missing.push(skill.localOverlay);}for(const action of plan.actions.filter(a=>a.kind==="copy-skill")){const target=path.join(action.target,"SKILL.md");if(!await exists(target)){missing.push(action.target);continue;}const skill=loaded.recipe.skills.find(s=>s.id===action.id)!;if(await readFile(target,"utf8")!==await skillText(loaded.base,skill.source))drift.push(action.target);}for(const tool of loaded.recipe.tools){if(installedVersion(NPM_TOOLS[tool.id]??"")!==tool.version)missing.push(tool.command);else{const probe=runCommand(tool.command,["--version"]);if(probe.status!==0)drift.push(tool.command);}}for(const capability of loaded.recipe.capabilities??[]){try{await verifyTelemetry();}catch{const status=await telemetryStatus();(capability.required?missing:drift).push(`${capability.id}:${status.state}`);}}return{ok:!plan.blocked&&!missing.length&&!drift.length,missing,drift};}
export async function rollbackRecipe(source:string,options:{home?:string;confirm?:boolean}={}):Promise<string[]>{if(!options.confirm)throw new Error("Rollback requires --confirm.");const loaded=await loadRecipe(source);const home=path.resolve(options.home??process.env.USERPROFILE??process.cwd());const plan=await planRecipe(source,home);const allowed=new Set(plan.actions.filter(a=>a.kind==="copy-skill").map(a=>path.resolve(a.target)));const state=JSON.parse(await readFile(path.join(home,".afd","recipes",loaded.recipe.id,"applied.json"),"utf8")) as {managed?:unknown;managedTools?:unknown;managedCapabilities?:unknown};if(!Array.isArray(state.managed)||state.managed.some(item=>typeof item!=="string"||!allowed.has(path.resolve(item))||!path.resolve(item).startsWith(home+path.sep))||!Array.isArray(state.managedTools??[])||!Array.isArray(state.managedCapabilities??[])||(state.managedCapabilities as unknown[]).some(item=>item!=="observability")||(state.managedTools as Array<{package?:unknown;previousVersion?:unknown}>).some(item=>typeof item.package!=="string"||!Object.values(NPM_TOOLS).includes(item.package)||(item.previousVersion!==undefined&&(typeof item.previousVersion!=="string"||!SEMVER.test(item.previousVersion)))))throw new Error("Unsafe or incompatible recipe state; rollback aborted.");if((state.managedCapabilities as string[]).includes("observability"))await removeTelemetryManaged();for(const item of state.managed)await rm(item as string,{recursive:true});for(const tool of [...(state.managedTools as Array<{package:string;previousVersion?:string}>)].reverse())if(tool.previousVersion)pnpm(["add","--global",`${tool.package}@${tool.previousVersion}`]);else pnpm(["remove","--global",tool.package]);await rm(path.join(home,".afd","recipes",loaded.recipe.id,"applied.json"),{force:true});return state.managed as string[];}
