import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { AgentId } from "./contracts.js";
import { MCP_SCHEMA_VERSION, isMcpOverride, type McpManagerOptions, type McpRegistry, type McpRegistryEntry, type McpScope, type McpServer, type McpValue } from "./mcp-contracts.js";

const ALL_AGENTS = new Set<AgentId>(["claude-code", "codex", "antigravity", "pi", "hermes", "grok"]);
const SECRET_FIELD = /(^|[_-])(authorization|cookie|api[-_]?key|token|password|secret|credential)([_-]|$)/i;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const emptyMcpRegistry = (): McpRegistry => ({ schemaVersion: MCP_SCHEMA_VERSION, servers: {} });
export function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

function plain(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function only(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }

function parseValue(value: unknown, field: string): McpValue {
  if (!plain(value) || !only(value, ["literal", "fromEnv"])) throw new Error(`Invalid MCP value for ${field}.`);
  if (typeof value.fromEnv === "string") {
    if (!ENVIRONMENT_NAME.test(value.fromEnv) || Object.keys(value).length !== 1) throw new Error(`Invalid MCP environment reference for ${field}.`);
    return { fromEnv: value.fromEnv };
  }
  if (typeof value.literal !== "string" || Object.keys(value).length !== 1) throw new Error(`Invalid MCP literal for ${field}.`);
  if (SECRET_FIELD.test(field)) throw new Error(`Inline secret-like MCP value is prohibited: ${field}.`);
  return { literal: value.literal };
}

function parseValues(value: unknown, field: string): Readonly<Record<string, McpValue>> | undefined {
  if (value === undefined) return undefined;
  if (!plain(value)) throw new Error(`Invalid MCP value map: ${field}.`);
  const parsed: Record<string, McpValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key || /[\0\r\n]/.test(key)) throw new Error(`Invalid MCP field name in ${field}.`);
    parsed[key] = parseValue(raw, `${field}.${key}`);
  }
  return parsed;
}

function parseTargets(value: unknown): readonly AgentId[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("MCP targets must be a non-empty array.");
  const targets: AgentId[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !ALL_AGENTS.has(item as AgentId)) throw new Error(`Unknown MCP target: ${String(item)}.`);
    if (targets.includes(item as AgentId)) throw new Error(`Duplicate MCP target: ${item}.`);
    targets.push(item as AgentId);
  }
  return targets;
}

function safeText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || /[\0\r\n]/.test(value)) throw new Error(`Invalid MCP ${field}.`);
  return value;
}

function parseServer(value: Record<string, unknown>, id: string, scope: McpScope): McpServer {
  const common = ["transport", "enabled", "targets"];
  if (value.transport === "stdio") {
    if (!only(value, [...common, "command", "args", "cwd", "environment"])) throw new Error(`Unknown stdio MCP fields: ${id}.`);
    const command = safeText(value.command, `${id}.command`);
    const args = value.args === undefined ? undefined : Array.isArray(value.args) && value.args.every((item) => typeof item === "string" && !item.includes("\0")) ? value.args as string[] : undefined;
    if (value.args !== undefined && !args) throw new Error(`Invalid MCP arguments: ${id}.`);
    const cwd = value.cwd === undefined ? undefined : safeText(value.cwd, `${id}.cwd`);
    if (scope === "project" && cwd) {
      if (path.isAbsolute(cwd)) throw new Error(`Project MCP cwd must be project-relative: ${id}.`);
      const normalized = path.normalize(cwd);
      if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw new Error(`Project MCP cwd must stay inside the project: ${id}.`);
    }
    const server: McpServer = { transport: "stdio", command, enabled: value.enabled === true, targets: parseTargets(value.targets), ...(args ? { args } : {}), ...(cwd ? { cwd } : {}), ...(value.environment === undefined ? {} : { environment: parseValues(value.environment, `${id}.environment`)! }) };
    if (typeof value.enabled !== "boolean") throw new Error(`Invalid MCP enabled state: ${id}.`);
    return server;
  }
  if (value.transport === "http") {
    if (!only(value, [...common, "url", "headers"])) throw new Error(`Unknown HTTP MCP fields: ${id}.`);
    const url = safeText(value.url, `${id}.url`); let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`Invalid MCP URL: ${id}.`); }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname))) throw new Error(`MCP HTTP URL must use HTTPS or loopback HTTP: ${id}.`);
    if (parsed.username || parsed.password) throw new Error(`MCP URL credentials are prohibited: ${id}.`);
    if (typeof value.enabled !== "boolean") throw new Error(`Invalid MCP enabled state: ${id}.`);
    return { transport: "http", url, enabled: value.enabled, targets: parseTargets(value.targets), ...(value.headers === undefined ? {} : { headers: parseValues(value.headers, `${id}.headers`)! }) };
  }
  throw new Error(`Unsupported MCP transport: ${id}.`);
}

function parseEntry(value: unknown, id: string, scope: McpScope): McpRegistryEntry {
  if (!plain(value)) throw new Error(`Invalid MCP server entry: ${id}.`);
  if ("inherits" in value) {
    if (scope !== "project" || !only(value, ["inherits", "enabled"]) || value.inherits !== "user" || typeof value.enabled !== "boolean") throw new Error(`Invalid MCP scope override: ${id}.`);
    return { inherits: "user", enabled: value.enabled };
  }
  return parseServer(value, id, scope);
}

export function parseMcpRegistry(value: unknown, scope: McpScope): McpRegistry {
  if (!plain(value) || !only(value, ["schemaVersion", "servers"]) || value.schemaVersion !== MCP_SCHEMA_VERSION || !plain(value.servers)) throw new Error(`Invalid MCP ${scope} registry.`);
  const servers: Record<string, McpRegistryEntry> = {};
  for (const [id, raw] of Object.entries(value.servers)) {
    if (!SERVER_ID.test(id)) throw new Error(`Invalid MCP server id: ${id}.`);
    servers[id] = parseEntry(raw, id, scope);
  }
  return { schemaVersion: MCP_SCHEMA_VERSION, servers };
}

export function registryPath(scope: McpScope, options: McpManagerOptions): string {
  const homeValue = options.home ?? process.env.USERPROFILE ?? process.env.HOME;
  if (!homeValue) throw new Error("Cannot resolve the user home directory.");
  const home = path.resolve(homeValue);
  if (scope === "user") return path.join(path.resolve(options.afdRoot ?? path.join(home, ".afd")), "mcp", "user.json");
  if (!options.project) throw new Error("Project scope requires --project <path>.");
  return path.join(path.resolve(options.project), ".afd", "mcp.json");
}

async function exists(file: string): Promise<boolean> { try { await access(file, constants.F_OK); return true; } catch { return false; } }
export async function loadMcpRegistry(scope: McpScope, options: McpManagerOptions): Promise<McpRegistry> {
  const file = registryPath(scope, options); if (!(await exists(file))) return emptyMcpRegistry();
  let value: unknown; try { value = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")); } catch { throw new Error(`Invalid JSON in MCP ${scope} registry: ${file}.`); }
  return parseMcpRegistry(value, scope);
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
export function serializeMcpRegistry(registry: McpRegistry): string { return `${JSON.stringify(ordered(registry), null, 2)}\n`; }

export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.afd-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  await rename(temp, file);
}

export interface EffectiveMcpEntry { readonly id: string; readonly server: McpServer; readonly origin: McpScope; readonly overridden: boolean }
export function resolveEffectiveMcp(user: McpRegistry, project: McpRegistry | null): readonly EffectiveMcpEntry[] {
  const result = new Map<string, EffectiveMcpEntry>();
  for (const [id, entry] of Object.entries(user.servers)) if (!isMcpOverride(entry)) result.set(id, { id, server: entry, origin: "user", overridden: false });
  if (project) for (const [id, entry] of Object.entries(project.servers)) {
    if (isMcpOverride(entry)) {
      const inherited = result.get(id); if (!inherited) throw new Error(`Project MCP override has no user definition: ${id}.`);
      result.set(id, { id, server: { ...inherited.server, enabled: entry.enabled }, origin: "user", overridden: true });
    } else result.set(id, { id, server: entry, origin: "project", overridden: true });
  }
  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function withServer(registry: McpRegistry, scope: McpScope, id: string, entry: McpRegistryEntry | null): McpRegistry {
  const servers = { ...registry.servers }; if (entry === null) delete servers[id]; else servers[id] = entry;
  return parseMcpRegistry({ schemaVersion: MCP_SCHEMA_VERSION, servers }, scope);
}
