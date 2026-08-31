import assert from "node:assert/strict";
import test from "node:test";
import { sandboxAccessDiagnostic } from "../src/sandbox-access.js";
import type { ExecutionIdentity } from "../src/doctor.js";
import type { PlatformAdapter } from "../src/platform.js";

const interactive:ExecutionIdentity={context:"interactive-user",account:"host\\user",declaredUser:"user",profile:"C:\\Users\\user",mismatch:false};
function adapter(report:unknown,status=0):PlatformAdapter{return{id:"win32",stateRoot:"C:\\state",async run(){return{status,stdout:JSON.stringify(report),stderr:"",timedOut:false};},async start(){return 1;},async stop(){},async isRunning(){return false;},async processFingerprint(){return undefined;},async isListening(){return false;},async writeText(){},async readText(){return undefined;},async remove(){},async downloadVerified(){}};}

test("sandbox access diagnostic reports a healthy durable postcondition",async()=>{
  const result=await sandboxAccessDiagnostic("C:\\afd",adapter({schemaVersion:1,state:"healthy",targets:[{path:"C:\\tools\\uv.exe",exists:true,action:"none"},{path:"C:\\tools\\missing.exe",exists:false,action:"not-installed"}]}),interactive);
  assert.equal(result?.status,"PASS");assert.match(result?.detail??"",/1 installed reviewed target/);
});

test("sandbox access diagnostic names package replacement drift without mutating",async()=>{
  const result=await sandboxAccessDiagnostic("C:\\afd",adapter({schemaVersion:1,state:"drift",targets:[{path:"C:\\tools\\uv.exe",exists:true,action:"grant-read-execute"}]},2),interactive);
  assert.equal(result?.status,"FAIL");assert.match(result?.detail??"",/uv\.exe/);assert.match(result?.remedy??"",/afd fix sandbox --dry-run/);
});

test("sandbox identity never attempts persistent ACL inspection",async()=>{
  let called=false;const value=adapter({});value.run=async()=>{called=true;throw new Error("unexpected");};
  const result=await sandboxAccessDiagnostic("C:\\afd",value,{...interactive,context:"hybrid",account:"host\\codexsandboxoffline",mismatch:true});
  assert.equal(called,false);assert.equal(result?.status,"INFO");
});
