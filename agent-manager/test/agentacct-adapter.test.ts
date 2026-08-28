import assert from "node:assert/strict";
import test from "node:test";
import { AgentacctAdapter } from "../src/agentacct-adapter.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

function fake(sessionResult?: string, healthResult='{"status":"healthy"}', importSucceeds = false): { adapter: PlatformAdapter; calls: HostCommand[] } {
  const calls: HostCommand[] = [];
  const adapter: PlatformAdapter = {
    id: "win32", stateRoot: "C:\\state",
    async run(command) {
      calls.push(command); const joined = command.args.join(" ");
      if (joined.includes("printf %s")) return { status: 0, stdout: "/home/test\n", stderr: "", timedOut: false };
      if (joined.includes("command -v uv")) return { status: 0, stdout: "/home/test/.local/bin/uv\n", stderr: "", timedOut: false };
      if (joined.includes("command -v curl")) return { status: 0, stdout: "/usr/bin/curl\n", stderr: "", timedOut: false };
      if (joined.includes("command -v sha256sum")) return { status: 0, stdout: "/usr/bin/sha256sum\n", stderr: "", timedOut: false };
      if (joined.includes("/usr/bin/mkdir") || joined.includes("/usr/bin/curl") || joined.includes("/usr/bin/rm")) return { status: 0, stdout: "", stderr: "", timedOut: false };
      if (joined.includes("/usr/bin/sha256sum")) return { status: 0, stdout: `${"a".repeat(64)}  artifact\n`, stderr: "", timedOut: false };
      if (joined.includes("--version")) return { status: 0, stdout: "agentacct 0.10.1\n", stderr: "", timedOut: false };
      if (joined.includes("capabilities agents --json")) return { status: 0, stdout: '{"agents":[]}', stderr: "", timedOut: false };
      if (joined.includes("usage health --json")) return { status: 0, stdout: healthResult, stderr: "", timedOut: false };
      if (joined.includes("status --json")) return { status: 0, stdout: '{"schema_version":"agent-chronicle.activation-runtime.v1","state":"running","dashboard_health":"healthy","dashboard_url":"http://127.0.0.1:8765/","watcher":"running"}', stderr: "", timedOut: false };
      if (importSucceeds && joined.includes("usage import-local --client all --refresh")) return { status: 0, stdout: "", stderr: "", timedOut: false };
      if (joined.includes("python3") && sessionResult) return { status: 0, stdout: sessionResult, stderr: "", timedOut: false };
      return { status: 1, stdout: "", stderr: "missing", timedOut: false };
    },
    async start(){return 1;},async stop(){},async isRunning(){return false;},async processFingerprint(){return undefined;},async isListening(){return false;},async writeText(){},async readText(){return undefined;},async remove(){},async downloadVerified(){},
  };
  return { adapter, calls };
}

test("agentacct contract is versioned, capability-scoped, isolated and disables pricing egress", async () => {
  const value=fake();const adapter=new AgentacctAdapter(value.adapter,"0.10.1");const status=await adapter.status();
  assert.equal(status.state,"healthy");assert.equal(value.calls.at(-1)?.executable,"wsl.exe");
  assert.ok(value.calls.some((call)=>call.args.some((arg)=>arg==="AGENTACCT_PRICING_AUTO_REFRESH=0")));
  assert.ok(value.calls.some((call)=>call.args.some((arg)=>arg==="AGENTACCT_EVIDENCE_V2=0")));
  assert.ok(value.calls.some((call)=>call.args.some((arg)=>arg==="AGENTACCT_STORE_DIR=/home/test/.local/share/afd/telemetry-v2/agentacct/store")));
  assert.ok(value.calls.some((call)=>call.args.some((arg)=>arg.startsWith("CODEX_HOME=/mnt/c/"))));
  assert.equal(status.runtime?.dashboardUrl,"http://127.0.0.1:8765/");
});

test("agentacct reports degraded ingestion without hiding the public contract", async () => {
  const value=fake(undefined,'{"state":"degraded","sources":[{"source":"codex","state":"degraded"}]}');
  const status=await new AgentacctAdapter(value.adapter,"0.10.1").status();
  assert.equal(status.state,"degraded");assert.equal(status.detail,"ingestion is degraded");
});

test("agentacct tolerates only the exact fail-closed Codex inventory rotation while the runtime remains healthy", async () => {
  const rotation=(lastSuccess:unknown,extra:Record<string,unknown>={})=>JSON.stringify({schema_version:"agent-chronicle.ingestion-health.v1",state:"degraded",issues:[{source:"codex",code:"source_scan_failed"}],sources:[{source:"claude-code",state:"healthy"},{source:"codex",state:"degraded",error_code:"codex_rollout_inventory_changed",error_codes:["codex_rollout_inventory_changed"],consecutive_failures:1,last_success_at:lastSuccess,...extra}]});
  const health=rotation(Date.now()/1_000);
  const status=await new AgentacctAdapter(fake(undefined,health).adapter,"0.10.1").status();
  assert.equal(status.state,"healthy");assert.match(status.detail,/retry/);
  const repeated=rotation(new Date(Date.now()-86_400_000).toISOString(),{consecutive_failures:2});
  assert.equal((await new AgentacctAdapter(fake(undefined,repeated).adapter,"0.10.1").status()).state,"healthy");
  const wrongIssue=JSON.stringify({schema_version:"agent-chronicle.ingestion-health.v1",state:"degraded",issues:[{source:"codex",code:"different_failure"}],sources:[{source:"codex",state:"degraded",error_code:"codex_rollout_inventory_changed",error_codes:["codex_rollout_inventory_changed"],last_success_at:Date.now()/1_000}]});
  assert.equal((await new AgentacctAdapter(fake(undefined,wrongIssue).adapter,"0.10.1").status()).state,"degraded");
});

test("agentacct status remains available when its supported runtime cannot be probed", async () => {
  const value=fake();value.adapter.run=async(command)=>command.args.join(" ").includes("printf %s")?{status:1,stdout:"",stderr:"unavailable",timedOut:false}:{status:1,stdout:"",stderr:"unexpected",timedOut:false};
  const status=await new AgentacctAdapter(value.adapter,"0.10.1").status();
  assert.equal(status.state,"unavailable");assert.match(status.detail,/could not be probed/);
});

test("agentacct downloads and verifies the reviewed wheel on WSL ext4 before installation", async () => {
  const value=fake();const adapter=new AgentacctAdapter(value.adapter,"0.10.1");
  await assert.rejects(adapter.install({source:"https://example.invalid/agentacct.whl",sha256:"a".repeat(64),lockSha256:"86f83621d868f9759263c861fde70732d85c0c8821d24b12e6d01ff99558f3ea"}),/Pinned agentacct installation failed/);
  assert.ok(value.calls.some((call)=>call.args.includes("/usr/bin/curl")&&call.args.includes("https://example.invalid/agentacct.whl")));
  assert.ok(value.calls.some((call)=>call.args.includes("/usr/bin/sha256sum")));
  assert.ok(value.calls.some((call)=>call.args.some((arg)=>arg.endsWith("/requirements/pylock.agentacct.toml"))));
  assert.ok(value.calls.some((call)=>call.args.some((arg)=>arg==="/home/test/.local/share/afd/telemetry-v2/agentacct/staging/agentacct-0.10.1-py3-none-any.whl")));
  assert.ok(value.calls.some((call)=>call.args.includes("/usr/bin/rm")));
});

test("agentacct imports Codex through an isolated read-only WSL namespace without a copied transcript tree", async () => {
  const value=fake(undefined, '{"status":"healthy"}', true);
  await new AgentacctAdapter(value.adapter,"0.10.1").refresh();
  const command=value.calls.find((call)=>call.args.includes("unshare"));
  assert.ok(command);
  assert.deepEqual(command.args.slice(0,7),["--exec","unshare","--user","--map-root-user","--mount","sh","-c"]);
  assert.ok(command.args.some((arg)=>arg.includes("mount -o remount,bind,ro")));
  assert.ok(command.args.some((arg)=>arg.includes("AGENTACCT_EVIDENCE_V2=0")));
  assert.ok(command.args.some((arg)=>arg.endsWith("/.codex/sessions")));
  assert.ok(command.args.includes("/home/test/.local/share/afd/telemetry-v2/agentacct/codex-home"));
  assert.ok(command.args.every((arg)=>!arg.includes("state_5.sqlite")));
  assert.ok(command.args.every((arg)=>!arg.includes("rollout-")));
});

test("agentacct managed runtime inherits a persistent private Codex namespace on Windows", async () => {
  const value=fake();
  const originalRun=value.adapter.run.bind(value.adapter);
  value.adapter.run=async(command)=>{
    const joined=command.args.join(" ");
    if(joined.includes("agentacct stop")||(command.args.includes("unshare")&&command.args.includes("start"))){
      value.calls.push(command);
      return{status:0,stdout:"",stderr:"",timedOut:false};
    }
    return originalRun(command);
  };
  await new AgentacctAdapter(value.adapter,"0.10.1").start();
  const command=value.calls.find((call)=>call.args.includes("unshare")&&call.args.includes("start"));
  assert.ok(command);
  assert.ok(command.args.includes("/home/test/.local/share/afd/telemetry-v2/agentacct/codex-home"));
});

test("agentacct session lookup uses only the bounded authenticated helper result", async () => {
  const payload=JSON.stringify({status:"exact_session",evidence:{source:"agentacct-v1-session",version:"0.10.1",usageTokens:12,usageConfidence:"client_reported",workItemCount:1,machineCheckCount:0,models:["gpt-test"]}});
  const value=fake(payload);const adapter=new AgentacctAdapter(value.adapter,"0.10.1");const result=await adapter.findBySessionHash("codex","a".repeat(20),"C:\\state\\identity.key");
  assert.equal(result.status,"exact_session");if(result.status==="exact_session")assert.equal(result.evidence.usageConfidence,"client_reported");
  assert.ok(value.calls.some((call)=>call.args.includes("python3")));assert.ok(value.calls.every((call)=>!call.args.join(" ").includes("/tasks?")));
});

test("agentacct rollback removes only its exact WSL managed root", async () => {
  const value=fake();
  await new AgentacctAdapter(value.adapter,"0.10.1").uninstallManagedRuntime();
  assert.ok(value.calls.some((call)=>call.args.join(" ").includes("/usr/bin/rm -rf -- /home/test/.local/share/afd/telemetry-v2/agentacct")));
});
