import assert from "node:assert/strict";
import test from "node:test";
import { AgentacctAdapter } from "../src/agentacct-adapter.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

function agentacct(adapter:PlatformAdapter):AgentacctAdapter{return new AgentacctAdapter(adapter,"0.10.1",{pythonExecutable:"C:\\mise\\python.exe",uvExecutable:"C:\\tools\\uv.exe",managedRoot:"C:\\state\\telemetry-v2\\agentacct"});}

function fake(sessionResult?:string,healthResult='{"status":"healthy"}',importSucceeds=false):{adapter:PlatformAdapter;calls:HostCommand[];starts:HostCommand[];files:Map<string,string>} {
  const calls:HostCommand[]=[];const starts:HostCommand[]=[];const files=new Map<string,string>();const running=new Set<number>();let nextPid=100;
  const adapter:PlatformAdapter={
    id:"win32",stateRoot:"C:\\state",
    async run(command){
      calls.push(command);const joined=command.args.join(" ");
      if(command.executable.endsWith("python.exe")&&joined.endsWith("--version"))return{status:0,stdout:"agentacct 0.10.1\n",stderr:"",timedOut:false};
      if(joined.includes("capabilities agents --json"))return{status:0,stdout:'{"clients":[]}',stderr:"",timedOut:false};
      if(joined.includes("usage health --json"))return{status:0,stdout:healthResult,stderr:"",timedOut:false};
      if(importSucceeds&&joined.includes("usage import-local --client all --refresh"))return{status:0,stdout:"",stderr:"",timedOut:false};
      if(command.executable.endsWith("python.exe")&&sessionResult)return{status:0,stdout:sessionResult,stderr:"",timedOut:false};
      if(command.executable==="C:\\tools\\uv.exe"&&joined.startsWith("tool uninstall"))return{status:0,stdout:"",stderr:"",timedOut:false};
      return{status:1,stdout:"",stderr:"missing",timedOut:false};
    },
    async start(command){starts.push(command);const pid=++nextPid;running.add(pid);return pid;},
    async stop(pid){running.delete(pid);},async isRunning(pid){return running.has(pid);},async processFingerprint(pid){return running.has(pid)?"f".repeat(64):undefined;},
    async isListening(_host,port){return port===8765&&starts.some(command=>command.args.includes("serve"));},
    async writeText(file,text){files.set(file,text);},async readText(file){return files.get(file);},async remove(file){files.delete(file);},async downloadVerified(){},
  };
  return{adapter,calls,starts,files};
}

test("agentacct runs natively with isolated paths and no WSL invocation",async()=>{
  const value=fake(undefined,'{"status":"healthy"}',true);const runtime=agentacct(value.adapter);await runtime.start();const status=await runtime.status();
  assert.equal(status.state,"healthy");assert.equal(status.runtime?.dashboardUrl,"http://127.0.0.1:8765/");
  assert.equal(value.starts.length,2);assert.ok(value.starts.some(call=>call.args.join(" ").includes("api serve")));assert.ok(value.starts.some(call=>call.args.join(" ").includes("usage watch")));
  assert.ok(value.calls.every(call=>call.executable!=="wsl.exe"));assert.ok(value.starts.every(call=>call.executable.endsWith("python.exe")));assert.ok(value.starts.every(call=>call.args[0]==="-c"&&call.args[1]==="from agentacct.cli import app; app()"));
  assert.ok(value.starts.every(call=>call.env?.AGENTACCT_STORE_DIR==="C:\\state\\telemetry-v2\\agentacct\\store"));
  assert.ok(value.starts.every(call=>call.env?.PYTHONPATH==="C:\\state\\telemetry-v2\\agentacct\\compat"));
});

test("agentacct tolerates delayed Windows process fingerprint availability",async()=>{
  const value=fake();const attempts=new Map<number,number>();
  value.adapter.processFingerprint=async(pid)=>{const count=(attempts.get(pid)??0)+1;attempts.set(pid,count);return count>1?"f".repeat(64):undefined;};
  await agentacct(value.adapter).start();
  assert.deepEqual([...attempts.values()],[2,2]);
});

test("agentacct reports degraded ingestion without hiding the native runtime",async()=>{
  const value=fake(undefined,'{"state":"degraded","sources":[{"source":"codex","state":"degraded"}]}');const runtime=agentacct(value.adapter);await runtime.start();const status=await runtime.status();
  assert.equal(status.state,"degraded");assert.equal(status.detail,"ingestion is degraded");
});

test("agentacct tolerates only the exact fail-closed Codex inventory rotation",async()=>{
  const rotation=(issue="source_scan_failed")=>JSON.stringify({schema_version:"agent-chronicle.ingestion-health.v1",state:"degraded",issues:[{source:"codex",code:issue}],sources:[{source:"codex",state:"degraded",error_code:"codex_rollout_inventory_changed",error_codes:["codex_rollout_inventory_changed"],last_success_at:Date.now()/1_000}]});
  const healthy=fake(undefined,rotation());const healthyRuntime=agentacct(healthy.adapter);await healthyRuntime.start();assert.equal((await healthyRuntime.status()).state,"healthy");
  const wrong=fake(undefined,rotation("different_failure"));const wrongRuntime=agentacct(wrong.adapter);await wrongRuntime.start();assert.equal((await wrongRuntime.status()).state,"degraded");
});

test("agentacct status remains available when the native runtime cannot be probed",async()=>{
  const value=fake();value.adapter.run=async()=>({status:1,stdout:"",stderr:"unavailable",timedOut:false});const status=await agentacct(value.adapter).status();assert.equal(status.state,"unavailable");assert.match(status.detail,/native agentacct/);
});

test("agentacct installation uses native uv, a verified artifact and the managed compatibility layer",async()=>{
  const value=fake();const runtime=agentacct(value.adapter);
  await assert.rejects(runtime.install({source:"https://example.invalid/agentacct.whl",sha256:"a".repeat(64),lockSha256:"86f83621d868f9759263c861fde70732d85c0c8821d24b12e6d01ff99558f3ea",verifiedArtifact:"C:\\downloads\\agentacct.whl"}),/Pinned native agentacct installation failed/);
  const install=value.calls.find(call=>call.executable==="C:\\tools\\uv.exe");assert.ok(install);assert.ok(install.args.includes("C:\\downloads\\agentacct.whl"));assert.ok(install.args.includes("C:\\mise\\python.exe"));
  assert.ok([...value.files.keys()].some(file=>file.endsWith("compat\\fcntl.py")));const traversal=[...value.files].find(([file])=>file.endsWith("compat\\afd_agentacct_windows.py"));assert.ok(traversal);assert.match(traversal[1],/EXPECTED_AGENTACCT_VERSION = "0\.10\.1"/);assert.match(traversal[1],/_open_regular_source_file_fd/);const sitecustomize=[...value.files].find(([file])=>file.endsWith("compat\\sitecustomize.py"));assert.ok(sitecustomize);assert.match(sitecustomize[1],/AGENTACCT_STORE_DIR/);assert.match(sitecustomize[1],/os\.open = _afd_os_open/);
  assert.ok(value.calls.every(call=>call.executable!=="wsl.exe"));
});

test("agentacct refresh reads native client homes directly",async()=>{
  const value=fake(undefined,'{"status":"healthy"}',true);await agentacct(value.adapter).refresh();const command=value.calls.find(call=>call.args.join(" ").includes("usage import-local --client all --refresh"));assert.ok(command);assert.ok(command.executable.endsWith("python.exe"));assert.equal(command.args[0],"-c");assert.equal(command.args[1],"from agentacct.cli import app; app()");assert.match(command.env?.CODEX_HOME??"",/\.codex$/);assert.ok(command.executable!=="wsl.exe");
});

test("agentacct session lookup uses the managed native Python helper",async()=>{
  const payload=JSON.stringify({status:"exact_session",evidence:{source:"agentacct-v1-session",version:"0.10.1",usageTokens:12,usageConfidence:"client_reported",workItemCount:1,machineCheckCount:0,models:["gpt-test"]}});const value=fake(payload);const result=await agentacct(value.adapter).findBySessionHash("codex","a".repeat(20),"C:\\state\\identity.key");assert.equal(result.status,"exact_session");const command=value.calls.at(-1);assert.ok(command?.executable.endsWith("tools\\agentacct\\Scripts\\python.exe"));assert.equal(command?.env?.AGENTACCT_STORE_DIR,"C:\\state\\telemetry-v2\\agentacct\\store");assert.ok(value.calls.every(call=>call.executable!=="wsl.exe"));
});

test("agentacct stop validates and stops only its two recorded native processes",async()=>{
  const value=fake();const runtime=agentacct(value.adapter);await runtime.start();await runtime.stop();assert.equal(await value.adapter.isRunning(101),false);assert.equal(await value.adapter.isRunning(102),false);assert.equal(value.files.has("C:\\state\\telemetry-v2\\agentacct\\runtime\\api.json"),false);assert.equal(value.files.has("C:\\state\\telemetry-v2\\agentacct\\runtime\\watcher.json"),false);
});
