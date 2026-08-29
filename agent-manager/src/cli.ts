#!/usr/bin/env node
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
  afd telemetry plan|apply|verify|status|stop [--json] [--recipe <source>] [--confirm <plan-token>]
  afd telemetry explain <run-id> [--json]
  afd telemetry refresh --agentacct
  afd telemetry trace --workspace <path> --agent <name> --operation <name> [--outcome ok|error|cancelled] [--duration-ms <ms>] [--client-session-id <id>]
  afd init [--dry-run]
  afd migrate --dry-run|--apply
  afd backup status | maintain --dry-run|--apply
  afd provenance [--json]
  afd layer1|layer2 --dry-run|--apply [--allow-claude-postinstall]
  afd catalog | help | --version

No layer is applied automatically. Use --dry-run before --apply.`;

function print(changes: readonly Change[]): void { for (const change of changes) console.log(`${change.kind.toUpperCase()}\t${change.agent}\t${change.path}\t${change.detail}`); }
const cliPlatform = new NodePlatformAdapter();
async function runHost(executable: string, args: readonly string[]): Promise<number> { const result = await cliPlatform.run({ executable, args, timeoutMs: 300_000 }); if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);return result.status; }
function runPowerShell(scriptName: string, dryRun = false): Promise<number> { const script = path.join(productRoot, "scripts", scriptName); return runHost("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...(dryRun ? ["-WhatIf"] : [])]); }
function runPowerShellArgs(scriptName: string, args: readonly string[]): Promise<number> { const script = path.join(productRoot, "scripts", scriptName); return runHost("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args]); }
function runPosix(scriptName: string, args: readonly string[], sudo = false): Promise<number> { const script = path.join(productRoot, "scripts", scriptName);return runHost(sudo?"sudo":"sh",sudo?["sh",script,...args]:[script,...args]); }

async function main(args: readonly string[]): Promise<number> {
  process.env.USERPROFILE ??= homedir();
  const command = args[0] ?? "help";
  if (["--version", "-v"].includes(command)) { console.log(VERSION); return 0; }
  if (["help", "--help", "-h"].includes(command)) { console.log(help); return 0; }
  if (command === "layer3" && args[1] === "recipes") { console.log("builtin:smota-foundations\nbuiltin:observability"); return 0; }
  if (command === "init") { if (args.slice(1).some((arg) => arg !== "--dry-run")) throw new Error("Usage: afd init [--dry-run]"); console.log("AI Foundry Desk is ready for inspection. No layer was applied."); console.log("Next: afd status, then afd layer1 --dry-run and afd layer2 --dry-run."); return 0; }
  if (command === "migrate") { if (args.slice(1).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd migrate --dry-run|--apply"); const apply = args.includes("--apply"); const dryRun = args.includes("--dry-run"); if (apply === dryRun) throw new Error("Use exactly one option: afd migrate --dry-run or --apply."); const result = await migrateLegacyState(apply); for (const action of result.actions) console.log(action); console.log(apply ? "Migration complete." : "Dry run: no files were changed."); return 0; }
  if (command === "backup") { const subcommand = args[1] ?? "status"; if (subcommand === "status" && args.length === 2) { for (const item of await backupReport()) console.log("BACKUP\t" + item.target + "\tsnapshots=" + item.snapshots + "\tbytes=" + item.bytes + "\tviolations=" + item.retentionViolations); return 0; } if (subcommand === "maintain" && (args[2] === "--dry-run" || args[2] === "--apply") && args.length === 3) { const removed = await enforceBackupRetention(undefined, Date.now(), args[2] === "--dry-run"); for (const item of removed) console.log((args[2] === "--dry-run" ? "WOULD_REMOVE\t" : "REMOVED\t") + item); return 0; } throw new Error("Usage: afd backup status | maintain --dry-run|--apply"); }
  if (command === "doctor") { if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Usage: afd doctor [--json]"); const rows = await doctor(); if (args.includes("--json")) console.log(JSON.stringify(rows, null, 2)); else for (const row of rows) console.log(row.status + "\t" + row.id + "\t" + row.detail + "\t" + row.remedy); return rows.some((row) => row.status === "FAIL") ? 2 : 0; }
  if (command === "provenance") { if (args.slice(1).some((arg) => arg !== "--json")) throw new Error("Usage: afd provenance [--json]"); const value={version:VERSION,cli:path.resolve(process.argv[1]??""),productRoot,runtime:{executable:path.resolve(process.execPath),version:process.versions.node},identity:await executionIdentity()};if(args.includes("--json"))console.log(JSON.stringify(value,null,2));else console.log(`AFD ${VERSION}\nCLI ${value.cli}\nRuntime ${value.runtime.version} ${value.runtime.executable}\nContext ${value.identity.context} ${value.identity.account}`);return 0; }
  if (command === "fix") { if (args[1] !== "layer1" || args.slice(2).some((arg) => !["--apply", "--dry-run"].includes(arg))) throw new Error("Usage: afd fix layer1 --dry-run|--apply"); const apply=args.includes("--apply"); const dryRun=args.includes("--dry-run"); if(apply===dryRun) throw new Error("Use exactly one option: afd fix layer1 --dry-run or --apply.");const identity=await executionIdentity();if(identity.mismatch)throw new Error("Layer 1 repair is refused because the process token and profile identity do not match. Use a normal shell for the intended user.");if(process.platform==="win32"){const repair=await runPowerShell("01-layer1-runtime.ps1",dryRun);if(repair!==0||dryRun)return repair;return runPowerShellArgs("01-doctor-layer1.ps1",[]);}if(process.platform==="linux"){for(const [script,sudo]of [["01-layer1-runtime-linux.sh",false],["02-docker-linux.sh",apply]] as const){const code=await runPosix(script,[dryRun?"--dry-run":"--apply"],sudo);if(code!==0)return code;}return dryRun?0:runPosix("01-doctor-layer1-linux.sh",[]);}throw new Error("Layer 1 fix is not implemented for macOS."); }
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
  if (command === "catalog") { if (args.length !== 1) throw new Error("Usage: afd catalog"); for (const target of agentTargets) console.log(`${target.id}\tskills=${target.skills}\tprofile=${target.profile}\t${target.reason ?? ""}`); return 0; }
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
    if (sub === "status") { const status=brokered?await requestTelemetryBroker("status",{},cliPlatform) as Awaited<ReturnType<typeof telemetryStatus>>:await telemetryStatus(); console.log(JSON.stringify(status, null, json ? 2 : 0)); return status.state === "healthy" || status.state === "disabled" ? 0 : 2; }
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
    throw new Error("Usage: afd telemetry plan|apply|verify|status|stop|explain|refresh|trace");
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
main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
