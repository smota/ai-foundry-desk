import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { homedir, platform as nodePlatform } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type PlatformId = "win32" | "linux" | "darwin";
export type HostCommand = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
};
export type CommandResult = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly pid?: number;
};

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly stateRoot: string;
  run(command: HostCommand): Promise<CommandResult>;
  start(command: HostCommand): Promise<number>;
  stop(pid: number): Promise<void>;
  isRunning(pid: number): Promise<boolean>;
  processFingerprint(pid: number): Promise<string | undefined>;
  isListening(host: string, port: number): Promise<boolean>;
  writeText(file: string, text: string): Promise<void>;
  readText(file: string): Promise<string | undefined>;
  remove(file: string): Promise<void>;
  downloadVerified(url: string, target: string, sha256: string): Promise<void>;
}

function platformId(value = nodePlatform()): PlatformId {
  if (value === "win32" || value === "linux" || value === "darwin") return value;
  throw new Error(`Unsupported platform: ${value}.`);
}
function defaultStateRoot(id: PlatformId): string {
  if (id === "win32") return path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "AI Foundry Desk");
  return path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"), "ai-foundry-desk");
}
function isSafeSha256(value: string): boolean { return /^[a-f0-9]{64}$/i.test(value); }
function isSafeHttps(url: URL): boolean { return url.protocol === "https:"; }
function validTimeout(value: number | undefined): number {
  if (value === undefined) return 30_000;
  if (!Number.isSafeInteger(value) || value < 100 || value > 300_000) throw new Error("Command timeout must be between 100 and 300000 milliseconds.");
  return value;
}
function waitMilliseconds(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function windowsRunner(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(current, "..", "..", "scripts", "afd-run-tree.ps1"), path.resolve(current, "..", "..", "..", "scripts", "afd-run-tree.ps1")];
  const runner = candidates.find((candidate) => existsSync(candidate));
  if (!runner) throw new Error("AFD Windows process runner is missing.");
  return runner;
}

async function runControl(executable: string, args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve(1)); child.once("close", (code) => resolve(code ?? 1));
  });
}

export class NodePlatformAdapter implements PlatformAdapter {
  readonly id: PlatformId;
  readonly stateRoot: string;
  constructor(options: { readonly id?: PlatformId; readonly stateRoot?: string } = {}) {
    this.id = options.id ?? platformId();
    this.stateRoot = options.stateRoot ?? defaultStateRoot(this.id);
  }
  async run(command: HostCommand): Promise<CommandResult> {
    const timeoutMs = validTimeout(command.timeoutMs);
    const invocation = this.id === "win32"
      ? {
          executable: "powershell.exe",
          args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", windowsRunner(), "-Executable", command.executable, "-ArgumentsBase64", Buffer.from(JSON.stringify(command.args), "utf8").toString("base64"), "-TimeoutMs", String(timeoutMs), ...(command.cwd ? ["-WorkingDirectory", command.cwd] : [])],
        }
      : { executable: command.executable, args: [...command.args] };
    return new Promise((resolve) => {
      let stdout = ""; let stderr = ""; let timedOut = false; let finished = false;
      const child = spawn(invocation.executable, invocation.args, {
        cwd: command.cwd,
        env: { ...process.env, ...command.env },
        detached: this.id !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const finish = (status: number) => {
        if (finished) return; finished = true; clearTimeout(timer); if (status === 124) timedOut = true;
        resolve({ status, stdout, stderr, timedOut, ...(child.pid ? { pid: child.pid } : {}) });
      };
      child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
      child.once("error", (error) => { stderr += error.message; finish(1); });
      child.once("close", (code) => finish(code ?? (timedOut ? 124 : 1)));
      const timer = setTimeout(() => {
        timedOut = true;
        void this.stop(child.pid ?? 0).finally(() => finish(124));
      }, timeoutMs + (this.id === "win32" ? 5_000 : 0));
    });
  }
  async start(command: HostCommand): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const child = spawn(command.executable, [...command.args], { cwd: command.cwd, env: { ...process.env, ...command.env }, detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", (error) => reject(new Error(`Could not start ${command.executable}: ${error.message}`)));
      child.once("spawn", () => { child.unref(); if (!child.pid) reject(new Error(`Could not start ${command.executable}.`)); else resolve(child.pid); });
    });
  }
  async stop(pid: number): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid managed process id.");
    if (!await this.isRunning(pid)) return;
    if (this.id === "win32") {
      await runControl("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
      if (await this.isRunning(pid)) try { process.kill(pid, "SIGKILL"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    } else {
      try { process.kill(-pid, "SIGTERM"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      await waitMilliseconds(250);
      if (await this.isRunning(pid)) try { process.kill(-pid, "SIGKILL"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    }
    for (let index = 0; index < 20 && await this.isRunning(pid); index += 1) await waitMilliseconds(50);
    if (await this.isRunning(pid)) throw new Error(`Managed process tree ${pid} did not stop.`);
  }
  async isRunning(pid: number): Promise<boolean> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (error: unknown) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
  }
  async processFingerprint(pid: number): Promise<string | undefined> {
    if (!Number.isSafeInteger(pid) || pid <= 0 || !await this.isRunning(pid)) return undefined;
    const result = this.id === "win32"
      ? await this.run({ executable: "powershell.exe", args: ["-NoProfile", "-Command", `$p=Get-Process -Id ${pid} -ErrorAction Stop;[Console]::Write($p.StartTime.ToUniversalTime().Ticks.ToString()+'|'+$p.Path)`], timeoutMs: 5_000 })
      : await this.run({ executable: "ps", args: ["-p", String(pid), "-o", "lstart=", "-o", "comm="], timeoutMs: 5_000 });
    if (result.status !== 0 || result.timedOut || !result.stdout.trim()) return undefined;
    return createHash("sha256").update(result.stdout.trim()).digest("hex");
  }
  async isListening(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (value: boolean) => { socket.removeAllListeners(); socket.destroy(); resolve(value); };
      socket.setTimeout(1_000); socket.once("connect", () => done(true)); socket.once("error", () => done(false)); socket.once("timeout", () => done(false));
    });
  }
  async writeText(file: string, text: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    await writeFile(temporary, text, "utf8"); await rename(temporary, file);
  }
  async readText(file: string): Promise<string | undefined> { try { return await readFile(file, "utf8"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
  async remove(file: string): Promise<void> { await rm(file, { force: true }); }
  async downloadVerified(urlText: string, target: string, sha256: string): Promise<void> {
    if (!isSafeSha256(sha256)) throw new Error("A SHA-256 checksum is required.");
    let url = new URL(urlText); if (!isSafeHttps(url)) throw new Error("Downloads must use HTTPS.");
    let response: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
      if (response.ok) break;
      const location = response.headers.get("location");
      if (!location || response.status < 300 || response.status >= 400) throw new Error(`Download rejected: HTTP ${response.status}.`);
      url = new URL(location, url); if (!isSafeHttps(url)) throw new Error("Download redirect left HTTPS.");
    }
    if (!response?.ok) throw new Error("Download exceeded the redirect limit.");
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha256.toLowerCase()) throw new Error("Downloaded checksum does not match the reviewed SHA-256.");
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); if (this.id !== "win32") await chmod(target, 0o700);
  }
}

export async function fileExists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
export function windowsPathToWsl(value:string):string{const absolute=path.win32.resolve(value);const match=absolute.match(/^([A-Za-z]):\\(.*)$/);if(!match)throw new Error("Only absolute Windows drive paths can be exposed to WSL.");return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/\\/g,"/")}`;}

export async function writePrivateText(adapter: PlatformAdapter, file: string, text: string): Promise<void> {
  await adapter.writeText(file, text);
  if (adapter.id === "win32") {
    const identity = await adapter.run({ executable: "whoami.exe", args: ["/user", "/fo", "csv", "/nh"], timeoutMs: 5_000 });
    const sid = identity.stdout.match(/S-1-(?:\d+-)+\d+/)?.[0];
    if (identity.status !== 0 || !sid) { await adapter.remove(file); throw new Error("Could not resolve the current Windows identity for telemetry key protection."); }
    const acl = await adapter.run({ executable: "icacls.exe", args: [file, "/inheritance:r", "/grant:r", `*${sid}:(F)`], timeoutMs: 10_000 });
    if (acl.status !== 0) { await adapter.remove(file); throw new Error("Could not restrict telemetry identity key permissions."); }
    return;
  }
  const permissions = await adapter.run({ executable: "chmod", args: ["600", file], timeoutMs: 5_000 });
  if (permissions.status !== 0) { await adapter.remove(file); throw new Error("Could not restrict telemetry identity key permissions."); }
}
