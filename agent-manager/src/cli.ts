#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { agentTargets } from "./catalog.js";
import type { AgentId, Change } from "./contracts.js";
import { adopt, inspect, sync } from "./manager.js";
import { listPending, promotePending, recoverRejected, rejectPending } from "./review.js";
import { applyRecipe, loadRecipe, planRecipe, rollbackRecipe, verifyRecipe } from "./recipes.js";
import { extractRecipe, inventoryGlobal } from "./extract.js";

const VERSION = "0.3.0";
const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const help = `afd — AI Foundry Desk · Multi-Agent Workbench

Usage:
  afd status | review | verify
  afd doctor [--json]
  afd fix layer1 --dry-run|--apply
  afd sync [--dry-run]
  afd adopt|import <agent> <skill> [--dry-run]
  afd pending
  afd hermes update --dry-run|--apply
  afd promote|reject <agent> <skill> [--dry-run|--confirm]
  afd recover <agent> <rejected-snapshot> [--dry-run|--confirm]
  afd layer3 recipes|show|plan|apply|verify|rollback <source>
  afd layer3 extract --output <file> [--include <id,id>]
  afd init [--dry-run]
  afd migrate --dry-run|--apply
  afd layer1|layer2 --dry-run|--apply [--allow-claude-postinstall]
  afd catalog | help | --version

No layer is applied automatically. Use --dry-run before --apply.`;

function print(changes: readonly Change[]): void { for (const change of changes) console.log(`${change.kind.toUpperCase()}\t${change.agent}\t${change.path}\t${change.detail}`); }
function runPowerShell(scriptName: string, dryRun = false): number { const script = path.join(productRoot, "scripts", scriptName); const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...(dryRun ? ["-WhatIf"] : [])], { stdio: "inherit" }); if (result.error) throw result.error; return result.status ?? 1; }
function runPowerShellArgs(scriptName: string, args: readonly string[]): number { const script = path.join(productRoot, "scripts", scriptName); const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { stdio: "inherit" }); if (result.error) throw result.error; return result.status ?? 1; }
function runPosix(scriptName: string, args: readonly string[], sudo = false): number { const script = path.join(productRoot, "scripts", scriptName); const result=spawnSync(sudo?"sudo":"sh",sudo?["sh",script,...args]:[script,...args],{stdio:"inherit"});if(result.error)throw result.error;return result.status??1; }

async function main(args: readonly string[]): Promise<number> {
  process.env.USERPROFILE ??= homedir();
  const command = args[0] ?? "help";
  if (["--version", "-v"].includes(command)) { console.log(VERSION); return 0; }
  if (["help", "--help", "-h"].includes(command)) { console.log(help); return 0; }
  if (command === "init") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd init [--dry-run]"); console.log("AI Foundry Desk is ready for inspection. No layer was applied."); console.log("Next: afd status, then afd layer1 --dry-run and afd layer2 --dry-run."); return 0; }
  if (command === "migrate") { if (args.slice(1).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd migrate --dry-run|--apply"); const apply = args.includes("--apply"); const dryRun = args.includes("--dry-run"); if (apply === dryRun) throw new Error("Use exactly one option: afd migrate --dry-run or --apply."); return runPowerShell("00-migrate-legacy-state.ps1", dryRun); }
  if (command === "doctor") { if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Usage: afd doctor [--json]"); if(process.platform==="win32")return runPowerShellArgs("01-doctor-layer1.ps1",args.includes("--json")?["-Json"]:[]);if(process.platform==="linux")return runPosix("01-doctor-layer1-linux.sh",args.includes("--json")?["--json"]:[]);throw new Error("Layer 1 doctor is not implemented for macOS."); }
  if (command === "fix") { if (args[1] !== "layer1" || args.slice(2).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd fix layer1 --dry-run|--apply"); const apply=args.includes("--apply"); const dryRun=args.includes("--dry-run"); if(apply===dryRun) throw new Error("Use exactly one option: afd fix layer1 --dry-run or --apply.");if(process.platform==="win32"){const repair=runPowerShell("01-layer1-runtime.ps1",dryRun);if(repair!==0||dryRun)return repair;return runPowerShellArgs("01-doctor-layer1.ps1",[]);}if(process.platform==="linux"){for(const [script,sudo]of [["01-layer1-runtime-linux.sh",false],["02-docker-linux.sh",apply]] as const){const code=runPosix(script,[dryRun?"--dry-run":"--apply"],sudo);if(code!==0)return code;}return dryRun?0:runPosix("01-doctor-layer1-linux.sh",[]);}throw new Error("Layer 1 fix is not implemented for macOS."); }
  if (command === "layer1" || command === "layer2") {
    const allowClaude=args.includes("--allow-claude-postinstall");
    if(args.slice(1).some(arg=>!["--apply","--dry-run","--allow-claude-postinstall"].includes(arg))||allowClaude&&(command!=="layer2"||!args.includes("--apply")))throw new Error(`Invalid option. Use afd ${command} --dry-run or --apply.`);
    const apply=args.includes("--apply"),dryRun=args.includes("--dry-run");if(apply===dryRun)throw new Error(`Use exactly one option: afd ${command} --dry-run or --apply.`);
    if(process.platform==="win32"){if(allowClaude)throw new Error("Claude postinstall opt-in is Linux-only.");const scripts=command==="layer1"?["01-layer1-runtime.ps1"]:["07-layer2-agent-clis.ps1","07-layer2-common-toolbox.ps1"];for(const script of scripts){const code=runPowerShell(script,dryRun);if(code!==0)return code;}return 0;}
    if(process.platform==="linux"){if(command==="layer1"){for(const[script,sudo]of [["01-layer1-runtime-linux.sh",false],["02-docker-linux.sh",apply]] as const){const code=runPosix(script,[dryRun?"--dry-run":"--apply"],sudo);if(code!==0)return code;}}else{let code=runPosix("07-layer2-common-toolbox-linux.sh",[dryRun?"--dry-run":"--apply"]);if(code!==0)return code;code=runPosix("07-layer2-agent-clis-linux.sh",[dryRun?"--dry-run":"--apply",...(allowClaude?["--allow-claude-postinstall"]:[])]);if(code!==0)return code;}return 0;}
    throw new Error("Layer automation is not implemented for macOS.");
  }
  if (command === "catalog") { if (args.length !== 1) throw new Error("Usage: afd catalog"); for (const target of agentTargets) console.log(`${target.id}\tskills=${target.skills}\tprofile=${target.profile}\t${target.reason ?? ""}`); return 0; }
  if(command==="hermes"){if(args[1]!=="update"||args.slice(2).some(arg=>!["--dry-run","--apply"].includes(arg)))throw new Error("Usage: afd hermes update --dry-run|--apply");const dry=args.includes("--dry-run"),apply=args.includes("--apply");if(dry===apply)throw new Error("Use exactly one of --dry-run or --apply.");return runPowerShellArgs("08-update-hermes.ps1",dry?["-WhatIf"]:["-Confirm"]);}
  if (["status", "review", "verify"].includes(command)) { if (args.length !== 1) throw new Error(`Usage: afd ${command}`); const result = await inspect({ dryRun: true }); print(result.changes); if(command==="review") for(const item of await listPending(result.root)) console.log(`PENDING\t${item.agent}\t${item.id}\t${item.path}`); const pending = result.changes.some((change) => ["drift", "create", "update"].includes(change.kind)); if(command==="verify"){if(process.platform==="win32")for(const script of ["01-verify-layer1.ps1","07-verify-layer2-agent-clis.ps1","07-verify-layer2-toolbox.ps1","10-verify-backups.ps1"]){const code=runPowerShell(script);if(code!==0)return code;}else if(process.platform==="linux")for(const script of ["01-verify-layer1-linux.sh","07-verify-layer2-linux.sh"]){const code=runPosix(script,[]);if(code!==0)return code;}} return command === "verify" && pending ? 2 : 0; }
  if (command === "sync") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd sync [--dry-run]"); const result = await sync({ dryRun: args.includes("--dry-run") }); print(result.changes); return result.changes.some((change) => change.kind === "drift") ? 2 : 0; }
  if (command === "adopt" || command === "import") { const agent = args[1] as AgentId | undefined; const name = args[2]; if (!agent || !agentTargets.some((target) => target.id === agent) || !name) throw new Error("Usage: afd adopt <agent> <skill> [--dry-run]"); console.log(`${args.includes("--dry-run") ? "DRY-RUN" : "PENDING"}: ${await adopt(agent, name, { dryRun: args.includes("--dry-run") })}`); return 0; }
  if(command==="pending"){if(args.length!==1)throw new Error("Usage: afd pending");for(const item of await listPending(path.join(homedir(),".afd")))console.log(`${item.agent}\t${item.id}\t${item.path}`);return 0;}
  if(command==="promote"||command==="reject"){const agent=args[1] as AgentId;const id=args[2];if(!agent||!id)throw new Error(`Usage: afd ${command} <agent> <skill> --dry-run|--confirm`);const options={dryRun:args.includes("--dry-run"),confirm:args.includes("--confirm")};if(options.dryRun===options.confirm)throw new Error("Use exactly one of --dry-run or --confirm.");const root=path.join(homedir(),".afd");console.log(await(command==="promote"?promotePending(root,agent,id,options):rejectPending(root,agent,id,options)));return 0;}
  if(command==="recover"){const agent=args[1] as AgentId;const snapshot=args[2];if(!agent||!snapshot)throw new Error("Usage: afd recover <agent> <snapshot> --dry-run|--confirm");const options={dryRun:args.includes("--dry-run"),confirm:args.includes("--confirm")};if(options.dryRun===options.confirm)throw new Error("Use exactly one of --dry-run or --confirm.");console.log(await recoverRejected(path.join(homedir(),".afd"),agent,snapshot,options));return 0;}
  if(command==="layer3"){const sub=args[1];if(sub==="recipes"){console.log("builtin:samuel");return 0;}if(sub==="extract"){const outputIndex=args.indexOf("--output");const output=outputIndex>=0?args[outputIndex+1]:undefined;if(!output||output.startsWith("--"))throw new Error("Usage: afd layer3 extract --output <file> [--include <id,id>]");const inventory=await inventoryGlobal();const includeIndex=args.indexOf("--include");const includeArg=includeIndex>=0?args[includeIndex+1]:undefined;if(!includeArg||includeArg.startsWith("--")){console.log(JSON.stringify(inventory,null,2));throw new Error("Review the inventory, then repeat with --include <id,id>.");}console.log(JSON.stringify(await extractRecipe(path.resolve(output),includeArg.split(",")),null,2));return 0;}const source=args[2]??(sub&&!['show','plan','apply','verify','rollback'].includes(sub)?sub:undefined);if(!source)throw new Error("Usage: afd layer3 recipes|show|plan|apply|verify|rollback <source>");if(sub==="show"){console.log(JSON.stringify((await loadRecipe(source)).recipe,null,2));return 0;}if(sub==="apply"){const confirmIndex=args.indexOf("--confirm");console.log(JSON.stringify(await applyRecipe(source,{confirm:confirmIndex>=0,approvalToken:confirmIndex>=0?args[confirmIndex+1]:undefined}),null,2));return 0;}if(sub==="verify"){const result=await verifyRecipe(source);console.log(JSON.stringify(result,null,2));return result.ok?0:2;}if(sub==="rollback"){console.log(JSON.stringify(await rollbackRecipe(source,{confirm:args.includes("--confirm")}),null,2));return 0;}console.log(JSON.stringify(await planRecipe(source),null,2));return 0;}
  console.error(`Unknown command: ${command}\n\n${help}`); return 1;
}
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
