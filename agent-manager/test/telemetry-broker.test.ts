import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createTelemetryBrokerServer, ensureTelemetryBrokerToken } from "../src/telemetry-broker.js";
import type { HostCommand, PlatformAdapter } from "../src/platform.js";

async function fixture(){
  const stateRoot=await mkdtemp(path.join(tmpdir(),"afd-broker-"));const calls:HostCommand[]=[];
  const adapter:PlatformAdapter={id:"win32",stateRoot,
    async run(command){calls.push(command);if(command.executable==="whoami.exe")return{status:0,stdout:'"user","S-1-5-21-1"\n',stderr:"",timedOut:false};return{status:0,stdout:"",stderr:"",timedOut:false};},
    async start(){return 1;},async stop(){},async isRunning(){return false;},async processFingerprint(){return undefined;},async isListening(){return false;},
    async writeText(file,text){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);},async readText(file){try{return await readFile(file,"utf8");}catch{return undefined;}},async remove(file){await rm(file,{force:true});},async downloadVerified(){},
  };
  return{adapter,calls,stateRoot};
}

test("telemetry broker is loopback-only, token-authenticated and operation-scoped",async()=>{
  const value=await fixture();const invoked:string[]=[];const server=await createTelemetryBrokerServer(value.adapter,{async invoke(operation){invoked.push(operation);return{state:"healthy"};}});
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>resolve());});
  try{
    const address=server.address();if(!address||typeof address==="string")throw new Error("broker test address unavailable");const url=`http://127.0.0.1:${address.port}/v1/status`;
    assert.equal((await fetch(url,{method:"POST",body:"{}"})).status,401);
    const token=(await value.adapter.readText(path.join(value.stateRoot,"broker-access","telemetry.token")))?.trim();assert.match(token??"",/^[a-f0-9]{64}$/);
    const response=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:"{}"});assert.equal(response.status,200);assert.deepEqual(await response.json(),{state:"healthy"});assert.deepEqual(invoked,["status"]);
    assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token}`}})).status,405);
    assert.ok(value.calls.some(call=>call.executable==="icacls.exe"&&call.args.some(arg=>arg.includes("CodexSandboxUsers:(R)"))));
  }finally{server.close();await rm(value.stateRoot,{recursive:true,force:true});}
});

test("telemetry broker replaces and persists an invalid existing token",async()=>{
  const value=await fixture();const file=path.join(value.stateRoot,"broker-access","telemetry.token");
  await value.adapter.writeText(file,"invalid\n");
  try{
    const token=await ensureTelemetryBrokerToken(value.adapter);
    assert.match(token,/^[a-f0-9]{64}$/);
    assert.equal((await value.adapter.readText(file))?.trim(),token);
  }finally{await rm(value.stateRoot,{recursive:true,force:true});}
});
