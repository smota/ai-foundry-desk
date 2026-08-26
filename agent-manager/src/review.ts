import { appendFile, cp, mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId, AgentManifest, PendingEntry } from "./contracts.js";
import { loadManifest } from "./manifest.js";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
async function exists(p: string): Promise<boolean> { try { await stat(p); return true; } catch { return false; } }
async function audit(root:string,action:string,agent:AgentId,id:string,detail:string){const file=path.join(root,"state","review-audit.jsonl");await mkdir(path.dirname(file),{recursive:true});await appendFile(file,`${JSON.stringify({at:new Date().toISOString(),action,agent,id,detail})}\n`,"utf8");}
export async function listPending(root: string): Promise<PendingEntry[]> {
  const base=path.join(root,"catalog","pending"); const out: PendingEntry[]=[];
  try { for (const agent of await readdir(base,{withFileTypes:true})) if(agent.isDirectory()) for(const entry of await readdir(path.join(base,agent.name),{withFileTypes:true})) if(entry.isDirectory() && ID.test(entry.name) && await exists(path.join(base,agent.name,entry.name,"SKILL.md"))) out.push({agent:agent.name as AgentId,id:entry.name,path:path.join(base,agent.name,entry.name)}); } catch { /* empty */ }
  return out.sort((a,b)=>`${a.agent}/${a.id}`.localeCompare(`${b.agent}/${b.id}`));
}
export async function promotePending(root:string, agent:AgentId, id:string, options:{dryRun?:boolean;confirm?:boolean}={}):Promise<string> {
  if(!ID.test(id)) throw new Error("Invalid skill id."); if(!options.dryRun && !options.confirm) throw new Error("Promotion requires --confirm.");
  const source=path.join(root,"catalog","pending",agent,id); const skill=path.join(source,"SKILL.md"); if(!await exists(skill)) throw new Error(`Pending skill not found: ${agent}/${id}`);
  const manifestPath=path.join(root,"manifest.json"); const manifest=await loadManifest(manifestPath); if(manifest.catalog.some(e=>e.id===id)) throw new Error(`Catalog id already exists: ${id}`);
  const destination=path.join(root,"catalog","skills",id); if(await exists(destination)) throw new Error(`Catalog path already exists: ${destination}`); if(options.dryRun) return destination;
  const backup=path.join(root,"state","reviews",`${Date.now()}-${agent}-${id}`); await mkdir(backup,{recursive:true}); await cp(source,path.join(backup,"pending"),{recursive:true}); await cp(manifestPath,path.join(backup,"manifest.json")); await mkdir(path.dirname(destination),{recursive:true}); await rename(source,destination);
  const next:AgentManifest={...manifest,catalog:[...manifest.catalog,{id,kind:"skill",source:`catalog/skills/${id}`,promotedBy:"manual-review"}],targets:manifest.targets.map(t=>t.agent===agent?{...t,entries:[...t.entries,id]}:t)};
  await writeFile(manifestPath,`${JSON.stringify(next,null,2)}\n`,`utf8`); await audit(root,"promote",agent,id,backup); return destination;
}
export async function rejectPending(root:string,agent:AgentId,id:string,options:{dryRun?:boolean;confirm?:boolean}={}):Promise<string>{
  if(!ID.test(id)) throw new Error("Invalid skill id."); if(!options.dryRun&&!options.confirm) throw new Error("Rejection requires --confirm."); const source=path.join(root,"catalog","pending",agent,id); if(!await exists(source)) throw new Error(`Pending skill not found: ${agent}/${id}`); const rejected=path.join(root,"catalog","rejected",agent,`${Date.now()}-${id}`); if(!options.dryRun){await mkdir(path.dirname(rejected),{recursive:true});await rename(source,rejected);await audit(root,"reject",agent,id,rejected);} return rejected;
}
export async function recoverRejected(root:string,agent:AgentId,snapshot:string,options:{dryRun?:boolean;confirm?:boolean}={}):Promise<string>{
  if(!/^[0-9]+-[a-z0-9-]+$/.test(snapshot)) throw new Error("Invalid rejected snapshot."); if(!options.dryRun&&!options.confirm) throw new Error("Recovery requires --confirm."); const source=path.join(root,"catalog","rejected",agent,snapshot); const id=snapshot.replace(/^[0-9]+-/,""); const target=path.join(root,"catalog","pending",agent,id); if(!await exists(source)||await exists(target)) throw new Error("Rejected snapshot unavailable or pending target exists."); if(!options.dryRun){await mkdir(path.dirname(target),{recursive:true});await rename(source,target);await audit(root,"recover",agent,id,source);} return target;
}
