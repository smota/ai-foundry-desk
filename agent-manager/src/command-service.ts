import { randomBytes } from "node:crypto";
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
import { buildOtlpJsonTrace, emitLoopbackOtlpJson, newSpanId, telemetryIdentity, type TelemetryOutcome } from "./telemetry.js";
import { recordTelemetryRun } from "./telemetry-correlation.js";
import { explainTelemetry, renderTelemetryExplanation } from "./telemetry-explain.js";
import { resumeTelemetry, stopTelemetry, telemetryPlan, telemetryPreflight, telemetryStatus, uninstallTelemetryAutostart, verifyTelemetry } from "./telemetry-runtime.js";
import { ensureTelemetryBrokerProcess, requestTelemetryBroker, serveTelemetryBroker } from "./telemetry-broker.js";
import { AgentacctAdapter } from "./agentacct-adapter.js";
import { migrateLegacyState } from "./migration.js";
import { backupReport, enforceBackupRetention } from "./backups.js";
import { doctor, executionIdentity } from "./doctor.js";
import { foundationPlan, layer2Plan } from "./foundation.js";
import { NodePlatformAdapter, writePrivateText } from "./platform.js";
import { sandboxAccessDiagnostic } from "./sandbox-access.js";
import { auditHarness, renderHarnessAudit } from "./harness-audit.js";
import { parseHarnessAgents, planHarness, renderHarnessPlan, stageHarness } from "./harness-plan.js";
import { renderHarnessSmoke, testHarness, writeHarnessEvidence } from "./harness-smoke.js";
import { applyHarnessPlan, renderHarnessVerification, rollbackHarness, verifyHarnessReceipt } from "./harness-apply.js";
import { applyMcpPlan, planMcpAdopt, planMcpMove, planMcpSync, planMcpToggle, publicMcpPlan, renderMcpPlan } from "./mcp-manager.js";
import { discoverNativeMcp, piMcpAdapterConfigured } from "./mcp-formats.js";
import { mcpCapabilities, type McpManagerOptions, type McpScope } from "./mcp-contracts.js";
import { sha256 } from "./mcp-registry.js";

export const VERSION = "0.6.3-rc.1";
const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const help = `afd — AI Foundry Desk · Multi-Agent Workbench

Usage:
  afd status | review | verify
  afd doctor [--json]
  afd fix layer1|sandbox --dry-run|--apply
  afd sync [--dry-run]
  afd adopt|import <agent> <skill> [--dry-run]
  afd pending
  afd hermes update --dry-run|--apply
  afd promote|reject <agent> <skill> [--dry-run|--confirm]
  afd recover <agent> <rejected-snapshot> [--dry-run|--confirm]
  afd layer3 recipes|show|plan|apply|verify|rollback <source>
  afd layer3 extract --output <file> [--include <id,id>]
  afd telemetry plan|apply|verify|status|stop|resume [--json] [--recipe <source>] [--confirm <plan-token>]
  afd telemetry explain <run-id> [--json]
  afd telemetry refresh --agentacct
  afd telemetry trace --workspace <path> --agent <name> --operation <name> [--outcome ok|error|cancelled] [--duration-ms <ms>]
  afd telemetry uninstall-autostart
  afd init [--dry-run]
  afd migrate --dry-run|--apply
  afd backup status | maintain --dry-run|--apply
  afd provenance [--json]
  afd layer1|layer2 --dry-run|--apply [--allow-claude-postinstall]
  afd catalog | help | --version
  afd harness audit <project> [--json]
  afd harness plan <project> [--agents <auto|list>] [--remove-legacy] [--json]
  afd harness stage <project> --output <directory> [--agents <auto|list>] [--remove-legacy] [--json]
  afd harness test <project> [--agents <auto|list>] [--remove-legacy] [--live] [--evidence <outside-project-file>] [--json]
  afd harness apply <project> [--agents <auto|list>] [--remove-legacy] --evidence <file> --confirm <plan-token> [--json]
  afd harness verify <project> --receipt <file> [--json]
  afd harness rollback <project> --receipt <file> --confirm <plan-token> [--json]
  afd mcp status|verify [--scope user|project|effective] [--project <path>] [--agents <list>] [--json]
  afd mcp discover <agent> --scope user|project [--project <path>] [--json]
  afd mcp sync --scope user|project|effective [--project <path>] [--agents <list>] [--enable-pi-adapter] --dry-run|--confirm <plan-token> [--json]
  afd mcp adopt <agent> <server> --from-scope user|project --to-scope user|project [--project <path>] [--agents <list>] --dry-run|--confirm <plan-token> [--json]
  afd mcp enable|disable <server> --scope user|project [--project <path>] [--agents <list>] --dry-run|--confirm <plan-token> [--json]
  afd mcp move <server> --from user|project --to user|project --project <path> [--agents <list>] --dry-run|--confirm <plan-token> [--json]
  afd tui

No layer is applied automatically. Use --dry-run before --apply.`;

export interface CommandIO { stdout(value: string): void; stderr(value: string): void }
const processIO: CommandIO = { stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) };
let activeIO = processIO;
function print(changes: readonly Change[]): void { for (const change of changes) activeIO.stdout(`${change.kind.toUpperCase()}\t${change.agent}\t${change.path}\t${change.detail}\n`); }
const cliPlatform = new NodePlatformAdapter();
async function runHost(executable: string, args: readonly string[]): Promise<number> { const result = await cliPlatform.run({ executable, args, timeoutMs: 300_000 }); if(result.stdout)activeIO.stdout(result.stdout);if(result.stderr)activeIO.stderr(result.stderr);return result.status; }
async function readTelemetryStatus(brokered: boolean): Promise<Awaited<ReturnType<typeof telemetryStatus>>> {
  if (!brokered) return telemetryStatus();
  try { return await requestTelemetryBroker("status", {}, cliPlatform) as Awaited<ReturnType<typeof telemetryStatus>>; }
  catch { return telemetryStatus(); }
}
function runPowerShell(scriptName: string, dryRun = false): Promise<number> { const script = path.join(productRoot, "scripts", scriptName); return runHost("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...(dryRun ? ["-WhatIf"] : [])]); }
function runPowerShellArgs(scriptName: string, args: readonly string[]): Promise<number> { const script = path.join(productRoot, "scripts", scriptName); return runHost("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args]); }
function runPosix(scriptName: string, args: readonly string[], sudo = false): Promise<number> { const script = path.join(productRoot, "scripts", scriptName);return runHost(sudo?"sudo":"sh",sudo?["sh",script,...args]:[script,...args]); }

async function dispatch(args: readonly string[]): Promise<number> {
  const console = { log: (...values: unknown[]) => activeIO.stdout(values.map(String).join(" ") + "\n"), error: (...values: unknown[]) => activeIO.stderr(values.map(String).join(" ") + "\n") };
  process.env.USERPROFILE ??= homedir();
  const command = args[0] ?? "help";
  if (["--version", "-v"].includes(command)) { console.log(VERSION); return 0; }
  if (["help", "--help", "-h"].includes(command)) { console.log(help); return 0; }
  if (command === "layer3" && args[1] === "recipes") { console.log("builtin:smota-foundations\nbuiltin:observability"); return 0; }
  if (command === "init") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd init [--dry-run]"); console.log("AI Foundry Desk is ready for inspection. No layer was applied."); console.log("Next: afd status, then afd layer1 --dry-run and afd layer2 --dry-run."); return 0; }
  if (command === "migrate") { if (args.slice(1).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd migrate --dry-run|--apply"); const apply = args.includes("--apply"); const dryRun = args.includes("--dry-run"); if (apply === dryRun) throw new Error("Use exactly one option: afd migrate --dry-run or --apply."); const result = await migrateLegacyState(apply); for (const action of result.actions) console.log(action); console.log(apply ? "Migration complete." : "Dry run: no files were changed."); return 0; }
  if (command === "backup") { const subcommand = args[1] ?? "status"; if (subcommand === "status" && args.length === 2) { for (const item of await backupReport()) console.log("BACKUP\t" + item.target + "\tsnapshots=" + item.snapshots + "\tbytes=" + item.bytes + "\tviolations=" + item.retentionViolations); return 0; } if (subcommand === "maintain" && (args[2] === "--dry-run" || args[2] === "--apply") && args.length === 3) { const removed = await enforceBackupRetention(undefined, Date.now(), args[2] === "--dry-run"); for (const item of removed) console.log((args[2] === "--dry-run" ? "WOULD_REMOVE\t" : "REMOVED\t") + item); return 0; } throw new Error("Usage: afd backup status | maintain --dry-run|--apply"); }
  if (command === "doctor") { if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Usage: afd doctor [--json]"); const identity=await executionIdentity();const rows = [...await doctor()];const access=await sandboxAccessDiagnostic(productRoot,cliPlatform,identity);if(access)rows.push(access); if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2)); else for (const row of rows) console.log(row.status + "\t" + row.id + "\t" + row.detail + "\t" + row.remedy); return rows.some((row) => row.status === "FAIL") ? 2 : 0; }
  if (command === "provenance") { if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Usage: afd provenance [--json]"); const value={version:VERSION,cli:path.resolve(process.argv[1]??""),productRoot,runtime:{executable:path.resolve(process.execPath),version:process.versions.node},identity:await executionIdentity()};if(args.includes("--json"))console.log(JSON.stringify(value,null,2));else console.log(`AFD ${VERSION}\nCLI ${value.cli}\nRuntime ${value.runtime.version} ${value.runtime.executable}\nContext ${value.identity.context} ${value.identity.account}`);return 0; }
  if (command === "fix") { const target=args[1];if(!["layer1","sandbox"].includes(target??"")||args.slice(2).some((arg) => !["--apply", "--dry-run"].includes(arg)))throw new Error("Usage: afd fix layer1|sandbox --dry-run|--apply");const apply=args.includes("--apply");const dryRun=args.includes("--dry-run");if(apply===dryRun)throw new Error(`Use exactly one option: afd fix ${target??"layer1"} --dry-run or --apply.`);const identity=await executionIdentity();if(identity.mismatch||identity.context==="sandbox")throw new Error(`${target==="sandbox"?"Sandbox access":"Layer 1"} repair is refused because the process token and profile identity do not match. Use a normal shell for the intended user.`);if(target==="sandbox"){if(process.platform!=="win32")throw new Error("Sandbox access repair is Windows-only.");const repaired=await runPowerShellArgs("13-reconcile-sandbox-toolchain-access.ps1",["-Mode",dryRun?"Plan":"Apply",...(apply?["-Approved"]:[])]);if(repaired!==0||dryRun)return repaired;return runPowerShellArgs("13-reconcile-sandbox-toolchain-access.ps1",["-Mode","Plan"]);}if(process.platform==="win32"){const repair=await runPowerShell("01-layer1-runtime.ps1",dryRun);if(repair!==0||dryRun)return repair;return runPowerShellArgs("01-doctor-layer1.ps1",[]);}if(process.platform==="linux"){for(const [script,sudo]of [["01-layer1-runtime-linux.sh",false],["02-docker-linux.sh",apply]] as const){const code=await runPosix(script,[dryRun?"--dry-run":"--apply"],sudo);if(code!==0)return code;}return dryRun?0:runPosix("01-doctor-layer1-linux.sh",[]);}throw new Error("Layer 1 fix is not implemented for macOS."); }
  if (command === "layer1" || command === "layer2") {
    const allowClaude=args.includes("--allow-claude-postinstall");
    if(args.slice(1).some(arg=>!["--apply","--dry-run","--allow-claude-postinstall"].includes(arg))||allowClaude&&(command!=="layer2"||!args.includes("--apply")))throw new Error(`Invalid option. Use afd ${command} --dry-run or --apply.`);
    const apply=args.includes("--apply"),dryRun=args.includes("--dry-run");if(apply===dryRun)throw new Error(`Use exactly one option: afd ${command} --dry-run or --apply.`);
    if(command==="layer1"&&dryRun){const current=process.platform;if(current!=="win32"&&current!=="linux"&&current!=="darwin")throw new Error("Unsupported platform.");console.log(JSON.stringify(foundationPlan(current),null,2));return 0;}
    if(command==="layer2"&&dryRun){const current=process.platform;if(current!=="win32"&&current!=="linux"&&current!=="darwin")throw new Error("Unsupported platform.");console.log(JSON.stringify(layer2Plan(current),null,2));return 0;}
    if(process.platform==="win32"){if(allowClaude)throw new Error("Claude postinstall opt-in is Linux-only.");const scripts=command==="layer1"?["01-layer1-runtime.ps1"]:["07-layer2-agent-clis.ps1","07-layer2-common-toolbox.ps1"];for(const script of scripts){const code=await runPowerShell(script,dryRun);if(code!==0)return code;}return 0;}
    if(process.platform==="linux"){if(command==="layer1"){for(const[script,sudo]of [["01-layer1-runtime-linux.sh",false],["02-docker-linux.sh",apply]] as const){const code=await runPosix(script,[dryRun?"--dry-run":"--apply"],sudo);if(code!==0)return code;}}else{let code=await runPosix("07-layer2-common-toolbox-linux.sh",[dryRun?"--dry-run":"--apply"]);if(code!==0)return code;code=await runPosix("07-layer2-agent-clis-linux.sh",[dryRun?"--dry-run":"--apply",...(allowClaude?["--allow-claude-postinstall"]:[])]);if(code!==0)return code;}return 0;}
    throw new Error("Layer automation is not implemented for macOS.");
  }
  if (command === "catalog") { if (args.length !== 1) throw new Error("Usage: afd catalog"); for (const target of agentTargets) { const mcp=mcpCapabilities[target.id]; console.log(`${target.id}\tskills=${target.skills}\tprofile=${target.profile}\tmcp-user=${mcp.user}\tmcp-project=${mcp.project}\t${target.reason ?? mcp.detail ?? ""}`); } return 0; }
  if (command === "mcp") {
    const sub = args[1] ?? "status"; const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }; const json = args.includes("--json");
    const valuedFlags = new Set(["--scope", "--project", "--agents", "--confirm", "--from-scope", "--to-scope", "--from", "--to"]); const booleanFlags = new Set(["--json", "--dry-run", "--enable-pi-adapter"]);
    const contracts: Readonly<Record<string, { readonly positional: number; readonly flags: readonly string[] }>> = { status: { positional: 0, flags: ["--scope", "--project", "--agents", "--json"] }, verify: { positional: 0, flags: ["--scope", "--project", "--agents", "--json"] }, discover: { positional: 1, flags: ["--scope", "--project", "--agents", "--json"] }, sync: { positional: 0, flags: ["--scope", "--project", "--agents", "--enable-pi-adapter", "--dry-run", "--confirm", "--json"] }, adopt: { positional: 2, flags: ["--from-scope", "--to-scope", "--project", "--agents", "--enable-pi-adapter", "--dry-run", "--confirm", "--json"] }, enable: { positional: 1, flags: ["--scope", "--project", "--agents", "--enable-pi-adapter", "--dry-run", "--confirm", "--json"] }, disable: { positional: 1, flags: ["--scope", "--project", "--agents", "--enable-pi-adapter", "--dry-run", "--confirm", "--json"] }, move: { positional: 1, flags: ["--from", "--to", "--project", "--agents", "--enable-pi-adapter", "--dry-run", "--confirm", "--json"] } };
    const contract=contracts[sub]; if(contract){const allowed=new Set(contract.flags);for(let index=2+contract.positional;index<args.length;index++){const token=args[index]!;if(!token.startsWith("--")||!allowed.has(token)||(!valuedFlags.has(token)&&!booleanFlags.has(token)))throw new Error(`Unknown MCP option: ${token}.`);if(valuedFlags.has(token)){const value=args[++index];if(!value||value.startsWith("--"))throw new Error(`MCP option requires a value: ${token}.`);}}}
    const parseScope = (value: string | undefined, allowEffective: boolean): McpScope | "effective" => { const actual=value??(allowEffective?"effective":"user"); if(actual!=="user"&&actual!=="project"&&(allowEffective?actual!=="effective":true))throw new Error(`Invalid MCP scope: ${actual}.`);return actual as McpScope|"effective"; };
    const parseAgents = (): readonly AgentId[] | undefined => { const value=flag("--agents");if(!value)return undefined;const values=value.split(",") as AgentId[];if(!values.length||values.some(item=>!agentTargets.some(target=>target.id===item))||new Set(values).size!==values.length)throw new Error("--agents must contain unique known agent ids.");return values; };
    const optionsFor = (scope: McpScope | "effective"): McpManagerOptions => { const projectFlag=flag("--project");const project=scope!=="user"?(projectFlag??process.cwd()):projectFlag;const targets=parseAgents();return { ...(project?{project}:{}),...(targets?{targets}:{}),...(args.includes("--enable-pi-adapter")?{enablePiAdapter:true}:{}) }; };
    const mode = () => { const dry=args.includes("--dry-run"),confirm=flag("--confirm");if(dry===Boolean(confirm))throw new Error("Use exactly one of --dry-run or --confirm <plan-token>.");return {dry,confirm}; };
    const outputPlan = (plan: Awaited<ReturnType<typeof planMcpSync>>) => console.log(json?JSON.stringify(publicMcpPlan(plan),null,2):renderMcpPlan(plan));
    if(sub==="discover") { const agent=args[2] as AgentId|undefined;const scope=parseScope(flag("--scope"),false) as McpScope;if(!agent||!agentTargets.some(target=>target.id===agent))throw new Error("Usage: afd mcp discover <agent> --scope user|project [--project <path>] [--json]");const options=optionsFor(scope);const capability=mcpCapabilities[agent][scope];if(capability!=="native"&&!(agent==="pi"&&capability==="extension"&&await piMcpAdapterConfigured(scope,options)))throw new Error(`${agent} ${scope} MCP discovery is ${capability}; no verified native adapter or declared pinned extension is available.`);const targets=parseAgents()??agentTargets.map(target=>target.id);const entries=await discoverNativeMcp(agent,scope,options,targets);const visible=entries.map(entry=>({agent:entry.agent,scope:entry.scope,id:entry.id,path:entry.path,transport:entry.server.transport,enabled:entry.server.enabled,fingerprint:sha256(JSON.stringify(entry.server))}));console.log(json?JSON.stringify(visible,null,2):visible.map(item=>`${item.agent}\t${item.scope}\t${item.id}\t${item.transport}\tenabled=${item.enabled}\t${item.path}\t${item.fingerprint}`).join("\n"));return 0;}
    if(sub==="status"||sub==="verify") { const scope=parseScope(flag("--scope"),true);const plan=await planMcpSync(scope,optionsFor(scope));outputPlan(plan);return plan.blocked||plan.actions.some(action=>!["in-sync"].includes(action.kind))?2:0; }
    if(sub==="sync") { if(!flag("--scope"))throw new Error("afd mcp sync requires --scope user|project|effective.");const scope=parseScope(flag("--scope"),true);const options=optionsFor(scope);const plan=await planMcpSync(scope,options);const selected=mode();if(selected.dry){outputPlan(plan);return plan.blocked?2:0;}console.log(JSON.stringify(await applyMcpPlan(plan,selected.confirm!,options),null,json?2:0));return 0; }
    if(sub==="adopt") { const agent=args[2] as AgentId|undefined,id=args[3];if(!flag("--from-scope")||!flag("--to-scope"))throw new Error("afd mcp adopt requires --from-scope and --to-scope.");const from=parseScope(flag("--from-scope"),false) as McpScope,to=parseScope(flag("--to-scope"),false) as McpScope;if(!agent||!id||!agentTargets.some(target=>target.id===agent))throw new Error("Usage: afd mcp adopt <agent> <server> --from-scope user|project --to-scope user|project ...");const options=optionsFor(to==="project"||from==="project"?"project":"user");const plan=await planMcpAdopt(agent,id,from,to,options);const selected=mode();if(selected.dry){outputPlan(plan);return plan.blocked?2:0;}console.log(JSON.stringify(await applyMcpPlan(plan,selected.confirm!,options),null,json?2:0));return 0; }
    if(sub==="enable"||sub==="disable") { const id=args[2];if(!flag("--scope"))throw new Error(`afd mcp ${sub} requires --scope user|project.`);const scope=parseScope(flag("--scope"),false) as McpScope;if(!id)throw new Error(`Usage: afd mcp ${sub} <server> --scope user|project ...`);const options=optionsFor(scope);const plan=await planMcpToggle(id,scope,sub==="enable",options);const selected=mode();if(selected.dry){outputPlan(plan);return plan.blocked?2:0;}console.log(JSON.stringify(await applyMcpPlan(plan,selected.confirm!,options),null,json?2:0));return 0; }
    if(sub==="move") { const id=args[2];if(!flag("--from")||!flag("--to"))throw new Error("afd mcp move requires --from and --to.");const from=parseScope(flag("--from"),false) as McpScope,to=parseScope(flag("--to"),false) as McpScope;if(!id)throw new Error("Usage: afd mcp move <server> --from user|project --to user|project --project <path> ...");const options=optionsFor("project");const plan=await planMcpMove(id,from,to,options);const selected=mode();if(selected.dry){outputPlan(plan);return plan.blocked?2:0;}console.log(JSON.stringify(await applyMcpPlan(plan,selected.confirm!,options),null,json?2:0));return 0; }
    throw new Error("Usage: afd mcp status|discover|sync|adopt|enable|disable|move|verify ...");
  }
  if (command === "harness") {
    const subcommand = args[1]; const project = args[2]; const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
    if (!project) throw new Error("Usage: afd harness audit|plan|stage|test|apply|verify|rollback <project> [options]");
    if (subcommand === "audit") { if (args.slice(3).some((arg) => arg !== "--json")) throw new Error("Usage: afd harness audit <project> [--json]"); const report = await auditHarness(project); console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderHarnessAudit(report)); return report.summary.blockers ? 2 : 0; }
    if (subcommand === "verify" || subcommand === "rollback") {
      const allowed = new Set(["--json", "--receipt", "--confirm"]); for (let index = 3; index < args.length; index++) { const value = args[index]!; if (!allowed.has(value) && !["--receipt", "--confirm"].includes(args[index - 1]!)) throw new Error(`Unknown harness option: ${value}`); }
      const receipt = flag("--receipt"); if (!receipt) throw new Error(`Usage: afd harness ${subcommand} <project> --receipt <file>${subcommand === "rollback" ? " --confirm <plan-token>" : ""} [--json]`);
      if (subcommand === "verify") { const report = await verifyHarnessReceipt(receipt); if (path.resolve(project) !== path.resolve(report.project)) throw new Error("Harness receipt belongs to a different project."); console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderHarnessVerification(report)); return report.valid ? 0 : 2; }
      const confirm = flag("--confirm"); if (!confirm) throw new Error("Harness rollback requires --confirm <plan-token>."); const preflight = await verifyHarnessReceipt(receipt); if (path.resolve(project) !== path.resolve(preflight.project)) throw new Error("Harness receipt belongs to a different project."); const result = await rollbackHarness(receipt, { confirm }); console.log(JSON.stringify(result, null, args.includes("--json") ? 2 : 0)); return 0;
    }
    if (subcommand === "plan" || subcommand === "stage" || subcommand === "test" || subcommand === "apply") {
      const allowed = new Set(["--json", "--remove-legacy", "--agents", "--output", "--live", "--evidence", "--timeout-ms", "--confirm"]); for (let index = 3; index < args.length; index++) { const value = args[index]!; if (!allowed.has(value) && (index === 3 || !["--agents", "--output", "--evidence", "--timeout-ms", "--confirm"].includes(args[index - 1]!))) throw new Error(`Unknown harness option: ${value}`); }
      const agents = parseHarnessAgents(flag("--agents")); const plan = await planHarness(project, { agents, removeLegacy: args.includes("--remove-legacy") });
      if (subcommand === "plan") { console.log(args.includes("--json") ? JSON.stringify(plan, null, 2) : renderHarnessPlan(plan)); return plan.blocked ? 2 : 0; }
      if (subcommand === "test") { const timeout = Number(flag("--timeout-ms") ?? "120000"); if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) throw new Error("--timeout-ms must be between 1000 and 600000."); const report = await testHarness(plan, { live: args.includes("--live"), timeoutMs: timeout }); const evidence = flag("--evidence"); if (evidence) await writeHarnessEvidence(report, evidence); console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : renderHarnessSmoke(report)); return (report.live ? report.passed : report.ready) ? 0 : 2; }
      if (subcommand === "apply") { const evidence = flag("--evidence"); const confirm = flag("--confirm"); if (!evidence || !confirm) throw new Error("Use: afd harness apply <project> --evidence <passing-live-report> --confirm <plan-token>."); const result = await applyHarnessPlan(plan, { evidence, confirm }); console.log(JSON.stringify(result, null, args.includes("--json") ? 2 : 0)); return 0; }
      const output = flag("--output"); if (!output) throw new Error("Usage: afd harness stage <project> --output <directory> [--agents <auto|list>] [--remove-legacy] [--json]");
      const result = await stageHarness(plan, output); console.log(JSON.stringify(result, null, args.includes("--json") ? 2 : 0)); return 0;
    }
    throw new Error("Usage: afd harness audit|plan|stage|test|apply|verify|rollback <project> [options]");
  }
  if (command === "observe") throw new Error("afd observe was removed before release; use afd telemetry.");
  if (command === "telemetry") {
    const sub = args[1] ?? "status"; const json = args.includes("--json"); const recipeIndex = args.indexOf("--recipe"); const source = recipeIndex >= 0 ? args[recipeIndex + 1] : "builtin:observability"; if (!source || source.startsWith("--")) throw new Error("--recipe requires a value.");
    if(sub==="broker"){
      if(args.slice(2).some(value=>value!=="--already-resumed"))throw new Error("Usage: afd telemetry broker");
      const identity=await executionIdentity();if(identity.mismatch)throw new Error("The telemetry broker must run as the interactive user, not inside the agent sandbox.");
      if(!args.includes("--already-resumed"))await resumeTelemetry(cliPlatform,{reconcileAutostart:false});await serveTelemetryBroker(cliPlatform);return 0;
    }
    const brokered=process.platform==="win32"&&(await executionIdentity()).mismatch;
    if (sub === "plan") { const recipe = await planRecipe(source); const capability = recipe.recipe.capabilities?.find((item) => item.id === "observability"); if (!capability) throw new Error("Selected recipe does not include Observability."); const preflight=await telemetryPreflight(capability);console.log(JSON.stringify({ recipe, telemetry: telemetryPlan(capability), preflight }, null, 2)); return recipe.blocked||!preflight.ok ? 2 : 0; }
    if (sub === "apply") { const confirmIndex = args.indexOf("--confirm"); if (confirmIndex < 0 || !args[confirmIndex + 1]) throw new Error("Use the token from telemetry plan: afd telemetry apply --confirm <plan-token>."); const result=await applyRecipe(source, { confirm: true, approvalToken: args[confirmIndex + 1] });if(process.platform==="win32")await ensureTelemetryBrokerProcess(fileURLToPath(new URL("./cli.js",import.meta.url)),cliPlatform);console.log(JSON.stringify(result, null, 2)); return 0; }
    if (sub === "status") { const status=await readTelemetryStatus(brokered); console.log(JSON.stringify(status, null, json ? 2 : 0)); return status.state === "healthy" || status.state === "disabled" ? 0 : 2; }
    if (sub === "verify") { const status=brokered?await requestTelemetryBroker("verify",{},cliPlatform):await verifyTelemetry();console.log(JSON.stringify(status, null, 2)); return 0; }
    if (sub === "stop") { if(brokered)await requestTelemetryBroker("stop",{},cliPlatform);else await stopTelemetry(); console.log("STOPPED\ttelemetry-v2"); return 0; }
    if (sub === "uninstall-autostart") { await uninstallTelemetryAutostart(); console.log("AUTOSTART_REMOVED\ttelemetry-v2"); return 0; }
    if (sub === "resume") { const status=brokered?await requestTelemetryBroker("resume",{},cliPlatform) as Awaited<ReturnType<typeof telemetryStatus>>:await resumeTelemetry();if(!brokered&&process.platform==="win32")await ensureTelemetryBrokerProcess(fileURLToPath(new URL("./cli.js",import.meta.url)),cliPlatform);console.log(JSON.stringify(status));return status.state==="healthy"?0:2; }
    if (sub === "refresh" && args[2] === "--agentacct" && args.length === 3) { if(brokered)await requestTelemetryBroker("refresh",{},cliPlatform);else{const status = await telemetryStatus(); if (!status.agentacct.version) throw new Error("agentacct is not configured."); await new AgentacctAdapter(cliPlatform, status.agentacct.version).refresh();} console.log("REFRESHED\tagentacct"); return 0; }
    if (sub === "explain") { const runId = args[2]; if (!runId || args.slice(3).some((arg) => arg !== "--json")) throw new Error("Usage: afd telemetry explain <run-id> [--json]"); const explanation=brokered?await requestTelemetryBroker("explain",{runId},cliPlatform) as Awaited<ReturnType<typeof explainTelemetry>>:await explainTelemetry(runId); console.log(json ? JSON.stringify(explanation, null, 2) : renderTelemetryExplanation(explanation)); return explanation.status === "not_found" ? 2 : 0; }
    if (sub === "trace") {
      const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
      const workspace = value("--workspace"); const requestedAgent = value("--agent"); const agent = requestedAgent === "agy" ? "antigravity" : requestedAgent;
      const operation = value("--operation"); const outcome = value("--outcome") ?? "ok"; const duration = Number(value("--duration-ms") ?? "0");
      if (!workspace || !agent || !operation || !["claude-code", "codex", "antigravity", "pi", "hermes"].includes(agent) || !["ok", "error", "cancelled"].includes(outcome) || !Number.isFinite(duration) || duration < 0) throw new Error("Usage: afd telemetry trace --workspace <path> --agent <name> --operation <name> [--outcome ok|error|cancelled] [--duration-ms <ms>]");
      if (args.includes("--client-session-id")) throw new Error("Raw client session ids are not accepted on the command line.");
      const keyFile = path.join(cliPlatform.stateRoot, "telemetry-v2", "identity.key"); let key = await cliPlatform.readText(keyFile);
      if (!key) { key = randomBytes(32).toString("hex"); await writePrivateText(cliPlatform,keyFile,key+"\n"); }
      if (!/^[a-f0-9]{64}\s*$/.test(key)) throw new Error("Telemetry identity key is invalid.");
      const identity = await telemetryIdentity(workspace, agent, Buffer.from(key.trim(), "hex")); const endedAt = Date.now(); const rootSpanId = newSpanId();
      const trace = buildOtlpJsonTrace(identity, [{ spanId: rootSpanId, name: operation, startedAtUnixMs: endedAt - duration, endedAtUnixMs: endedAt, outcome: outcome as TelemetryOutcome }]);
      await emitLoopbackOtlpJson("http://127.0.0.1:4318/v1/traces", trace); const status = await telemetryStatus();
      await recordTelemetryRun({ schemaVersion: 2, runId: identity["afd.run.id"], traceId: identity.traceId, rootSpanId, projectId: identity["afd.project.id"], agent, startedAt: new Date(endedAt-duration).toISOString(), endedAt: new Date(endedAt).toISOString(), outcome: outcome as TelemetryOutcome, source: "afd-otel" }, status.retention?.correlationDays ?? 30);
      console.log(`EXPORTED\t${identity["afd.project.id"]}\t${identity["afd.run.id"]}`); return 0;
    }
    throw new Error("Usage: afd telemetry plan|apply|verify|status|stop|resume|uninstall-autostart|explain|refresh|trace");
  }
  if(command==="hermes"){if(args[1]!=="update"||args.slice(2).some(arg=>!["--dry-run","--apply"].includes(arg)))throw new Error("Usage: afd hermes update --dry-run|--apply");const dry=args.includes("--dry-run"),apply=args.includes("--apply");if(dry===apply)throw new Error("Use exactly one of --dry-run or --apply.");return runPowerShellArgs("08-update-hermes.ps1",dry?["-WhatIf"]:["-Confirm"]);}
  if (["status", "review", "verify"].includes(command)) { if (args.length !== 1) throw new Error(`Usage: afd ${command}`); const result = await inspect({ dryRun: true }); print(result.changes); if(command==="review") for(const item of await listPending(result.root)) console.log(`PENDING\t${item.agent}\t${item.id}\t${item.path}`); const pending = result.changes.some((change) => ["drift", "create", "update"].includes(change.kind)); if(command==="verify"){if(process.platform==="win32")for(const script of ["01-verify-layer1.ps1","07-verify-layer2-agent-clis.ps1","07-verify-layer2-toolbox.ps1","10-verify-backups.ps1"]){const code=await runPowerShell(script);if(code!==0)return code;}else if(process.platform==="linux")for(const script of ["01-verify-layer1-linux.sh","07-verify-layer2-linux.sh"]){const code=await runPosix(script,[]);if(code!==0)return code;}} return command === "verify" && pending ? 2 : 0; }
  if (command === "sync") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd sync [--dry-run]"); const result = await sync({ dryRun: args.includes("--dry-run") }); print(result.changes); return result.changes.some((change) => change.kind === "drift") ? 2 : 0; }
  if (command === "adopt" || command === "import") { const agent = args[1] as AgentId | undefined; const name = args[2]; if (!agent || !agentTargets.some((target) => target.id === agent) || !name) throw new Error("Usage: afd adopt <agent> <skill> [--dry-run]"); console.log(`${args.includes("--dry-run") ? "DRY-RUN" : "PENDING"}: ${await adopt(agent, name, { dryRun: args.includes("--dry-run") })}`); return 0; }
  if(command==="pending"){if(args.length!==1)throw new Error("Usage: afd pending");for(const item of await listPending(path.join(homedir(),".afd")))console.log(`${item.agent}\t${item.id}\t${item.path}`);return 0;}
  if(command==="promote"||command==="reject"){const agent=args[1] as AgentId;const id=args[2];if(!agent||!id)throw new Error(`Usage: afd ${command} <agent> <skill> --dry-run|--confirm`);const options={dryRun:args.includes("--dry-run"),confirm:args.includes("--confirm")};if(options.dryRun===options.confirm)throw new Error("Use exactly one of --dry-run or --confirm.");const root=path.join(homedir(),".afd");console.log(await(command==="promote"?promotePending(root,agent,id,options):rejectPending(root,agent,id,options)));return 0;}
  if(command==="recover"){const agent=args[1] as AgentId;const snapshot=args[2];if(!agent||!snapshot)throw new Error("Usage: afd recover <agent> <snapshot> --dry-run|--confirm");const options={dryRun:args.includes("--dry-run"),confirm:args.includes("--confirm")};if(options.dryRun===options.confirm)throw new Error("Use exactly one of --dry-run or --confirm.");console.log(await recoverRejected(path.join(homedir(),".afd"),agent,snapshot,options));return 0;}
  if(command==="layer3"){const sub=args[1];if(sub==="recipes"){console.log("builtin:smota-foundations");return 0;}if(sub==="extract"){const outputIndex=args.indexOf("--output");const output=outputIndex>=0?args[outputIndex+1]:undefined;if(!output||output.startsWith("--"))throw new Error("Usage: afd layer3 extract --output <file> [--include <id,id>]");const inventory=await inventoryGlobal();const includeIndex=args.indexOf("--include");const includeArg=includeIndex>=0?args[includeIndex+1]:undefined;if(!includeArg||includeArg.startsWith("--")){console.log(JSON.stringify(inventory,null,2));throw new Error("Review the inventory, then repeat with --include <id,id>.");}console.log(JSON.stringify(await extractRecipe(path.resolve(output),includeArg.split(",")),null,2));return 0;}const source=args[2]??(sub&&!['show','plan','apply','verify','rollback'].includes(sub)?sub:undefined);if(!source)throw new Error("Usage: afd layer3 recipes|show|plan|apply|verify|rollback <source>");if(sub==="show"){console.log(JSON.stringify((await loadRecipe(source)).recipe,null,2));return 0;}if(sub==="apply"){const confirmIndex=args.indexOf("--confirm");console.log(JSON.stringify(await applyRecipe(source,{confirm:confirmIndex>=0,approvalToken:confirmIndex>=0?args[confirmIndex+1]:undefined}),null,2));return 0;}if(sub==="verify"){const result=await verifyRecipe(source);console.log(JSON.stringify(result,null,2));return result.ok?0:2;}if(sub==="rollback"){console.log(JSON.stringify(await rollbackRecipe(source,{confirm:args.includes("--confirm")}),null,2));return 0;}console.log(JSON.stringify(await planRecipe(source),null,2));return 0;}
  console.error(`Unknown command: ${command}\n\n${help}`); return 1;
}

export async function runAfdCommand(args: readonly string[], io: CommandIO = processIO): Promise<number> {
  const previous = activeIO;
  activeIO = io;
  try { return await dispatch(args); }
  finally { activeIO = previous; }
}
