#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { agentTargets } from "./catalog.js";
import type { AgentId, Change } from "./contracts.js";
import { adopt, inspect, sync } from "./manager.js";

const VERSION = "0.1.2";
const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const help = `afd — AI Foundry Desk · Multi-Agent Workbench

Usage:
  afd status | review | verify
  afd doctor [--json]
  afd fix layer1 --dry-run|--apply
  afd sync [--dry-run]
  afd adopt|import <agent> <skill> [--dry-run]
  afd init [--dry-run]
  afd migrate --dry-run|--apply
  afd layer1|layer2 --dry-run|--apply
  afd catalog | help | --version

No layer is applied automatically. Use --dry-run before --apply.`;

function print(changes: readonly Change[]): void { for (const change of changes) console.log(`${change.kind.toUpperCase()}\t${change.agent}\t${change.path}\t${change.detail}`); }
function runPowerShell(scriptName: string, dryRun = false): number { const script = path.join(productRoot, "scripts", scriptName); const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...(dryRun ? ["-WhatIf"] : [])], { stdio: "inherit" }); if (result.error) throw result.error; return result.status ?? 1; }
function runPowerShellArgs(scriptName: string, args: readonly string[]): number { const script = path.join(productRoot, "scripts", scriptName); const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], { stdio: "inherit" }); if (result.error) throw result.error; return result.status ?? 1; }

async function main(args: readonly string[]): Promise<number> {
  const command = args[0] ?? "help";
  if (["--version", "-v"].includes(command)) { console.log(VERSION); return 0; }
  if (["help", "--help", "-h"].includes(command)) { console.log(help); return 0; }
  if (command === "init") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd init [--dry-run]"); console.log("AI Foundry Desk is ready for inspection. No layer was applied."); console.log("Next: afd status, then afd layer1 --dry-run and afd layer2 --dry-run."); return 0; }
  if (command === "migrate") { if (args.slice(1).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd migrate --dry-run|--apply"); const apply = args.includes("--apply"); const dryRun = args.includes("--dry-run"); if (apply === dryRun) throw new Error("Use exactly one option: afd migrate --dry-run or --apply."); return runPowerShell("00-migrate-legacy-state.ps1", dryRun); }
  if (command === "doctor") { if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Usage: afd doctor [--json]"); if (process.platform !== "win32") { const result={category:"platform",severity:"WARN",code:"platform.layer1-adapter-unavailable",summary:"Layer 1 doctor is not implemented for this platform",evidence:`platform=${process.platform}`,suggestion:"Use the portable CLI only; native Linux/macOS Layer 1 remains roadmap work."}; if(args.includes("--json")) console.log(JSON.stringify({schemaVersion:1,product:"AI Foundry Desk",command:"doctor",platform:process.platform,results:[result]},null,2)); else console.log(`WARN ${result.code} - ${result.summary}\n     Evidence: ${result.evidence}\n     Next: ${result.suggestion}`); return 0; } return runPowerShellArgs("01-doctor-layer1.ps1", args.includes("--json") ? ["-Json"] : []); }
  if (command === "fix") { if (args[1] !== "layer1" || args.slice(2).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd fix layer1 --dry-run|--apply"); const apply=args.includes("--apply"); const dryRun=args.includes("--dry-run"); if(apply===dryRun) throw new Error("Use exactly one option: afd fix layer1 --dry-run or --apply."); if(process.platform!=="win32") throw new Error("Layer 1 fix is currently validated only on Windows x64."); const repair=runPowerShell("01-layer1-runtime.ps1",dryRun); if(repair!==0 || dryRun) return repair; return runPowerShellArgs("01-doctor-layer1.ps1",[]); }
  if (command === "layer1" || command === "layer2") { if (args.slice(1).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error(`Invalid option. Use afd ${command} --dry-run or --apply.`); const apply = args.includes("--apply"); const dryRun = args.includes("--dry-run"); if (apply === dryRun) throw new Error(`Use exactly one option: afd ${command} --dry-run or --apply.`); if (process.platform !== "win32") throw new Error("Foundation/bootstrap are validated only on Windows x64."); const scripts = command === "layer1" ? ["01-layer1-runtime.ps1"] : ["07-layer2-agent-clis.ps1", "07-layer2-common-toolbox.ps1"]; for (const script of scripts) { const code = runPowerShell(script, dryRun); if (code !== 0) return code; } return 0; }
  if (command === "catalog") { if (args.length !== 1) throw new Error("Usage: afd catalog"); for (const target of agentTargets) console.log(`${target.id}\tskills=${target.skills}\tprofile=${target.profile}\t${target.reason ?? ""}`); return 0; }
  if (["status", "review", "verify"].includes(command)) { if (args.length !== 1) throw new Error(`Usage: afd ${command}`); const result = await inspect({ dryRun: true }); print(result.changes); const pending = result.changes.some((change) => ["drift", "create", "update"].includes(change.kind)); if (command === "verify" && process.platform === "win32") for (const script of ["01-verify-layer1.ps1", "07-verify-layer2-agent-clis.ps1", "07-verify-layer2-toolbox.ps1", "10-verify-backups.ps1"]) { const code = runPowerShell(script); if (code !== 0) return code; } return command === "verify" && pending ? 2 : 0; }
  if (command === "sync") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd sync [--dry-run]"); const result = await sync({ dryRun: args.includes("--dry-run") }); print(result.changes); return result.changes.some((change) => change.kind === "drift") ? 2 : 0; }
  if (command === "adopt" || command === "import") { const agent = args[1] as AgentId | undefined; const name = args[2]; if (!agent || !agentTargets.some((target) => target.id === agent) || !name) throw new Error("Usage: afd adopt <agent> <skill> [--dry-run]"); console.log(`${args.includes("--dry-run") ? "DRY-RUN" : "PENDING"}: ${await adopt(agent, name, { dryRun: args.includes("--dry-run") })}`); return 0; }
  console.error(`Unknown command: ${command}\n\n${help}`); return 1;
}
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
