import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { AgentacctAdapter } from "./agentacct-adapter.js";
import { explainTelemetry } from "./telemetry-explain.js";
import { resumeTelemetry, stopTelemetry, telemetryStatus, verifyTelemetry } from "./telemetry-runtime.js";
import { NodePlatformAdapter, type PlatformAdapter, writePrivateText } from "./platform.js";

export const TELEMETRY_BROKER_PORT = 13134;
const MAX_REQUEST_BYTES = 4096;
const TOKEN = /^[a-f0-9]{64}$/;
export type TelemetryBrokerOperation = "status" | "resume" | "verify" | "stop" | "refresh" | "explain";
export interface TelemetryBrokerHandlers { readonly invoke: (operation:TelemetryBrokerOperation,input:Record<string,unknown>)=>Promise<unknown> }

function tokenFile(adapter:PlatformAdapter):string{return path.join(adapter.stateRoot,"broker-access","telemetry.token");}
function brokerUrl(operation:TelemetryBrokerOperation):string{return `http://127.0.0.1:${TELEMETRY_BROKER_PORT}/v1/${operation}`;}
function safeEqual(left:string,right:string):boolean{if(!TOKEN.test(left)||!TOKEN.test(right))return false;return timingSafeEqual(Buffer.from(left),Buffer.from(right));}
function writeJson(response:ServerResponse,status:number,value:unknown):void{const body=JSON.stringify(value);response.writeHead(status,{"content-type":"application/json","content-length":Buffer.byteLength(body),"cache-control":"no-store"});response.end(body);}
async function requestBody(request:IncomingMessage):Promise<Record<string,unknown>>{const chunks:Buffer[]=[];let total=0;for await(const chunk of request){const value=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=value.length;if(total>MAX_REQUEST_BYTES)throw new Error("Broker request is too large.");chunks.push(value);}if(total===0)return{};const parsed=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Broker request must be a JSON object.");return parsed as Record<string,unknown>;}

export async function ensureTelemetryBrokerToken(adapter:PlatformAdapter=new NodePlatformAdapter()):Promise<string>{
  const file=tokenFile(adapter);const existing=(await adapter.readText(file))?.trim();const validExisting=existing&&TOKEN.test(existing);const token=validExisting?existing:randomBytes(32).toString("hex");if(!validExisting)await writePrivateText(adapter,file,token+"\n");
  if(adapter.id==="win32"){
    const computer=process.env.COMPUTERNAME;if(!computer)throw new Error("COMPUTERNAME is required to grant broker access.");
    const group=`${computer}\\CodexSandboxUsers`;const directory=path.dirname(file);
    for(const [target,rights] of [[directory,"(RX)"],[file,"(R)"]] as const){const grant=await adapter.run({executable:"icacls.exe",args:[target,"/grant:r",`${group}:${rights}`],timeoutMs:10_000});if(grant.status!==0){if(!validExisting)await adapter.remove(file);throw new Error("Could not grant the sandbox read-only access to the telemetry broker token.");}}
  }
  return token;
}

export function defaultTelemetryBrokerHandlers(adapter:PlatformAdapter=new NodePlatformAdapter()):TelemetryBrokerHandlers{return{async invoke(operation,input){
  if(operation==="status")return telemetryStatus(adapter);
  if(operation==="resume")return resumeTelemetry(adapter,{reconcileAutostart:false});
  if(operation==="verify")return verifyTelemetry(adapter);
  if(operation==="stop"){await stopTelemetry(adapter);return{state:"stopped"};}
  if(operation==="refresh"){
    const status=await telemetryStatus(adapter);if(!status.agentacct.version)throw new Error("agentacct is not configured.");
    await new AgentacctAdapter(adapter,status.agentacct.version).refresh();return{state:"refreshed",component:"agentacct"};
  }
  const runId=input.runId;if(typeof runId!=="string"||!/^[a-f0-9]{32}$/.test(runId))throw new Error("A valid run id is required.");return explainTelemetry(runId,adapter);
}};}

export async function createTelemetryBrokerServer(adapter:PlatformAdapter=new NodePlatformAdapter(),handlers:TelemetryBrokerHandlers=defaultTelemetryBrokerHandlers(adapter)):Promise<Server>{
  const token=await ensureTelemetryBrokerToken(adapter);
  return createServer(async(request,response)=>{try{
    if(request.socket.remoteAddress!=="127.0.0.1"&&request.socket.remoteAddress!=="::ffff:127.0.0.1"){writeJson(response,403,{error:"loopback only"});return;}
    if(request.method!=="POST"){writeJson(response,405,{error:"method not allowed"});return;}
    const match=request.url?.match(/^\/v1\/(status|resume|verify|stop|refresh|explain)$/);if(!match){writeJson(response,404,{error:"not found"});return;}
    const supplied=request.headers.authorization?.replace(/^Bearer\s+/i,"")??"";if(!safeEqual(token,supplied)){writeJson(response,401,{error:"unauthorized"});return;}
    const value=await handlers.invoke(match[1] as TelemetryBrokerOperation,await requestBody(request));writeJson(response,200,value);
  }catch(error){writeJson(response,400,{error:error instanceof Error?error.message:"broker request failed"});}});
}

export async function serveTelemetryBroker(adapter:PlatformAdapter=new NodePlatformAdapter(),handlers?:TelemetryBrokerHandlers):Promise<void>{
  const server=await createTelemetryBrokerServer(adapter,handlers??defaultTelemetryBrokerHandlers(adapter));
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(TELEMETRY_BROKER_PORT,"127.0.0.1",()=>resolve());});
}

export async function requestTelemetryBroker(operation:TelemetryBrokerOperation,input:Record<string,unknown>={},adapter:PlatformAdapter=new NodePlatformAdapter()):Promise<unknown>{
  const token=(await adapter.readText(tokenFile(adapter)))?.trim();if(!token||!TOKEN.test(token))throw new Error("Telemetry broker access is not provisioned for this execution identity.");
  const response=await fetch(brokerUrl(operation),{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(120_000)});
  const value=await response.json() as unknown;if(!response.ok){const message=value&&typeof value==="object"&&"error" in value?String((value as {error:unknown}).error):`HTTP ${response.status}`;throw new Error("Telemetry broker request failed: "+message);}return value;
}

export async function ensureTelemetryBrokerProcess(cli:string,adapter:PlatformAdapter=new NodePlatformAdapter()):Promise<void>{
  if(await adapter.isListening("127.0.0.1",TELEMETRY_BROKER_PORT))return;
  await ensureTelemetryBrokerToken(adapter);await adapter.start({executable:process.execPath,args:[cli,"telemetry","broker","--already-resumed"]});
  for(let attempt=0;attempt<80;attempt+=1){if(await adapter.isListening("127.0.0.1",TELEMETRY_BROKER_PORT))return;await new Promise(resolve=>setTimeout(resolve,250));}
  throw new Error("The current-user telemetry broker did not become ready.");
}

export function telemetryBrokerTokenDigest(token:string):string{return createHash("sha256").update(token).digest("hex").slice(0,12);}
