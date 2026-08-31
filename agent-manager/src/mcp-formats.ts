import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from "smol-toml";
import { parseDocument } from "yaml";
import type { AgentId } from "./contracts.js";
import type { McpManagerOptions, McpNativeEntry, McpScope, McpServer, McpValue } from "./mcp-contracts.js";

const TOML_START = (id: string) => `# >>> AI Foundry Desk MCP: ${id} >>>`;
const TOML_END = (id: string) => `# <<< AI Foundry Desk MCP: ${id} <<<`;
const SECRET_FIELD = /authorization|cookie|api[-_]?key|token|password|secret|credential/i;
const ENV_REF = /^\$\{([A-Z_][A-Z0-9_]*)\}$/;
export const PI_MCP_ADAPTER = "npm:pi-mcp-adapter@2.31.0";

function home(options: McpManagerOptions): string { const value = options.home ?? process.env.USERPROFILE ?? process.env.HOME; if (!value) throw new Error("Cannot resolve the user home directory."); return path.resolve(value); }
function project(options: McpManagerOptions): string { if (!options.project) throw new Error("Project scope requires --project <path>."); return path.resolve(options.project); }
export function nativeMcpPath(agent: AgentId, scope: McpScope, options: McpManagerOptions): string {
  const root = scope === "project" ? project(options) : home(options);
  switch (agent) {
    case "claude-code": return scope === "user" ? path.join(root, ".claude.json") : path.join(root, ".mcp.json");
    case "codex": return path.join(root, ".codex", "config.toml");
    case "antigravity": return scope === "user" ? path.join(root, ".gemini", "config", "mcp_config.json") : path.join(root, ".agents", "mcp_config.json");
    case "pi": return scope === "user" ? path.join(root, ".pi", "agent", "mcp.json") : path.join(root, ".pi", "mcp.json");
    case "hermes": if (scope === "project") throw new Error("Hermes has no verified project MCP configuration surface."); return path.join(root, ".hermes", "config.yaml");
    case "grok": return path.join(root, ".grok", "config.toml");
  }
}

async function text(file: string): Promise<string> { try { await access(file, constants.F_OK); return await readFile(file, "utf8"); } catch { return ""; } }
function plain(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function bool(value: unknown): boolean { return value !== false; }
function stringArray(value: unknown): readonly string[] | undefined { return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined; }

function fromNativeValue(value: unknown, field: string): McpValue {
  if (typeof value !== "string") throw new Error(`Unsupported MCP value type: ${field}.`);
  const reference = ENV_REF.exec(value); if (reference?.[1]) return { fromEnv: reference[1] };
  if (SECRET_FIELD.test(field)) throw new Error(`Inline secret-like MCP value is prohibited: ${field}.`);
  return { literal: value };
}
function fromNativeMap(value: unknown, field: string): Readonly<Record<string, McpValue>> | undefined {
  if (value === undefined) return undefined; if (!plain(value)) throw new Error(`Invalid MCP map: ${field}.`);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromNativeValue(item, `${field}.${key}`)]));
}

function normalizeRaw(raw: unknown, id: string, targets: readonly AgentId[], agent: AgentId): McpServer {
  if (!plain(raw)) throw new Error(`Invalid native MCP entry: ${agent}/${id}.`);
  const enabled = agent === "antigravity" || agent === "pi" ? raw.disabled !== true : bool(raw.enabled);
  const nativeUrl = agent === "antigravity" ? raw.serverUrl : raw.url;
  if (typeof nativeUrl === "string") {
    const headers = fromNativeMap(raw.headers ?? raw.http_headers, `${id}.headers`);
    const envHeaders = plain(raw.env_http_headers) ? Object.fromEntries(Object.entries(raw.env_http_headers).map(([key, value]) => {
      if (typeof value !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(value)) throw new Error(`Invalid MCP environment header: ${id}.${key}.`);
      return [key, { fromEnv: value } satisfies McpValue];
    })) : undefined;
    return { transport: "http", url: nativeUrl, enabled, targets, ...((headers || envHeaders) ? { headers: { ...headers, ...envHeaders } } : {}) };
  }
  if (typeof raw.command !== "string") throw new Error(`Native MCP entry has no supported command or URL: ${agent}/${id}.`);
  const args = stringArray(raw.args); const environment = fromNativeMap(raw.env, `${id}.environment`); const forwarded = Array.isArray(raw.env_vars) ? raw.env_vars : [];
  const forwardedValues: Record<string, McpValue> = {};
  for (const value of forwarded) if (typeof value === "string" && /^[A-Z_][A-Z0-9_]*$/.test(value)) forwardedValues[value] = { fromEnv: value };
  return { transport: "stdio", command: raw.command, enabled, targets, ...(args ? { args } : {}), ...(typeof raw.cwd === "string" ? { cwd: raw.cwd } : {}), ...((environment || Object.keys(forwardedValues).length) ? { environment: { ...environment, ...forwardedValues } } : {}) };
}

function parseJsonServers(content: string): Record<string, unknown> {
  if (!content.trim()) return {}; const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, "")); if (!plain(parsed)) throw new Error("Native MCP JSON must contain an object.");
  const map = parsed.mcpServers; if (map === undefined) return {}; if (!plain(map)) throw new Error("Native mcpServers must contain an object."); return map;
}
function parseTomlServers(content: string): Record<string, unknown> {
  if (!content.trim()) return {}; const parsed = parseToml(content) as Record<string, unknown>; const map = parsed.mcp_servers; if (map === undefined) return {}; if (!plain(map)) throw new Error("Native mcp_servers must contain a table."); return map;
}
function parseYamlServers(content: string): Record<string, unknown> {
  if (!content.trim()) return {}; const document = parseDocument(content, { schema: "core", strict: true }); if (document.errors.length) throw document.errors[0]; const parsed: unknown = document.toJS(); if (!plain(parsed)) throw new Error("Hermes config must contain an object."); const map = parsed.mcp_servers; if (map === undefined) return {}; if (!plain(map)) throw new Error("Hermes mcp_servers must contain an object."); return map;
}

export async function discoverNativeMcp(agent: AgentId, scope: McpScope, options: McpManagerOptions, targets: readonly AgentId[]): Promise<readonly McpNativeEntry[]> {
  const file = nativeMcpPath(agent, scope, options); const content = await text(file);
  const map = agent === "codex" || agent === "grok" ? parseTomlServers(content) : agent === "hermes" ? parseYamlServers(content) : parseJsonServers(content);
  return Object.entries(map).map(([id, raw]) => ({ agent, scope, id, path: file, server: normalizeRaw(raw, id, targets, agent) })).sort((left, right) => left.id.localeCompare(right.id));
}

function nativeValue(value: McpValue): string { return "fromEnv" in value ? `\${${value.fromEnv}}` : value.literal; }
function nativeMap(values: Readonly<Record<string, McpValue>> | undefined): Record<string, string> | undefined { return values ? Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nativeValue(value)])) : undefined; }
function rawJson(server: McpServer): Record<string, unknown> {
  if (server.transport === "http") return { type: "http", url: server.url, ...(server.headers ? { headers: nativeMap(server.headers) } : {}) };
  return { command: server.command, ...(server.args ? { args: [...server.args] } : {}), ...(server.cwd ? { cwd: server.cwd } : {}), ...(server.environment ? { env: nativeMap(server.environment) } : {}) };
}

export function piSettingsPath(scope: McpScope, options: McpManagerOptions): string { const root = scope === "project" ? project(options) : home(options); return scope === "user" ? path.join(root, ".pi", "agent", "settings.json") : path.join(root, ".pi", "settings.json"); }
export function hasPiMcpAdapter(content: string): boolean {
  if (!content.trim()) return false; const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, "")); if (!plain(parsed)) throw new Error("Pi settings must contain an object.");
  const packages = parsed.packages; if (packages === undefined) return false; if (!Array.isArray(packages)) throw new Error("Pi settings packages must contain an array.");
  return packages.some((item) => item === PI_MCP_ADAPTER || (plain(item) && item.source === PI_MCP_ADAPTER));
}
export function renderPiMcpAdapter(content: string): string {
  const parsed: Record<string, unknown> = content.trim() ? JSON.parse(content.replace(/^\uFEFF/, "")) as Record<string, unknown> : {}; if (!plain(parsed)) throw new Error("Pi settings must contain an object.");
  const packages = parsed.packages === undefined ? [] : parsed.packages; if (!Array.isArray(packages)) throw new Error("Pi settings packages must contain an array.");
  const identity = (item: unknown): string | null => typeof item === "string" ? item : plain(item) && typeof item.source === "string" ? item.source : null;
  const existing = packages.map(identity).find((item) => item?.startsWith("npm:pi-mcp-adapter"));
  if (existing && existing !== PI_MCP_ADAPTER) throw new Error(`Pi MCP adapter declaration is divergent: ${existing}.`);
  if (!existing) packages.push(PI_MCP_ADAPTER); parsed.packages = packages; return `${JSON.stringify(parsed, null, 2)}\n`;
}
export async function piMcpAdapterConfigured(scope: McpScope, options: McpManagerOptions): Promise<boolean> { return hasPiMcpAdapter(await text(piSettingsPath(scope, options))); }
function rawAntigravity(server: McpServer): Record<string, unknown> {
  const values = server.transport === "http" ? server.headers : server.environment;
  if (Object.values(values ?? {}).some((value) => "fromEnv" in value)) throw new Error("Antigravity does not document environment-reference interpolation in MCP configuration.");
  if (server.transport === "http") return { serverUrl: server.url, ...(server.headers ? { headers: nativeMap(server.headers) } : {}), disabled: !server.enabled };
  return { command: server.command, ...(server.args ? { args: [...server.args] } : {}), ...(server.cwd ? { cwd: server.cwd } : {}), ...(server.environment ? { env: nativeMap(server.environment) } : {}), disabled: !server.enabled };
}
function rawPi(server: McpServer): Record<string, unknown> {
  if (server.transport === "http") return { url: server.url, ...(server.headers ? { headers: nativeMap(server.headers) } : {}), disabled: !server.enabled };
  return { command: server.command, ...(server.args ? { args: [...server.args] } : {}), ...(server.cwd ? { cwd: server.cwd } : {}), ...(server.environment ? { env: nativeMap(server.environment) } : {}), disabled: !server.enabled };
}
function rawHermes(server: McpServer): Record<string, unknown> { return { ...rawJson(server), enabled: server.enabled }; }
function rawToml(server: McpServer, agent: "codex" | "grok"): TomlTable {
  if (server.transport === "http") {
    const literal: Record<string, string> = {}; const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.headers ?? {})) { if ("fromEnv" in value) environment[key] = value.fromEnv; else literal[key] = value.literal; }
    if (agent === "grok" && Object.keys(environment).length) throw new Error("Grok does not document environment-backed HTTP headers.");
    return { url: server.url, enabled: server.enabled, ...(Object.keys(literal).length ? { [agent === "codex" ? "http_headers" : "headers"]: literal } : {}), ...(Object.keys(environment).length ? { env_http_headers: environment } : {}) };
  }
  const literal: Record<string, string> = {}; const forwarded: string[] = [];
  for (const [key, value] of Object.entries(server.environment ?? {})) { if ("fromEnv" in value) { if (key !== value.fromEnv) throw new Error(`MCP environment rename is not portable: ${key}.`); forwarded.push(key); } else literal[key] = value.literal; }
  if (agent === "grok" && forwarded.length) throw new Error("Grok does not document environment forwarding for stdio MCP servers.");
  return { command: server.command, ...(server.args ? { args: [...server.args] } : {}), ...(server.cwd ? { cwd: server.cwd } : {}), enabled: server.enabled, ...(Object.keys(literal).length ? { env: literal } : {}), ...(agent === "codex" && forwarded.length ? { env_vars: forwarded } : {}) };
}

function jsonRender(content: string, id: string, server: McpServer | null): string {
  const parsed: Record<string, unknown> = content.trim() ? JSON.parse(content.replace(/^\uFEFF/, "")) as Record<string, unknown> : {}; if (!plain(parsed)) throw new Error("Native MCP JSON must contain an object.");
  const servers = plain(parsed.mcpServers) ? { ...parsed.mcpServers } : {}; if (server) servers[id] = rawJson(server); else delete servers[id]; parsed.mcpServers = servers;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
function yamlRender(content: string, id: string, server: McpServer | null): string {
  const document = parseDocument(content || "{}\n", { schema: "core", strict: true }); if (document.errors.length) throw document.errors[0];
  if (server) document.setIn(["mcp_servers", id], rawHermes(server)); else document.deleteIn(["mcp_servers", id]); return document.toString({ lineWidth: 0 });
}
function tomlRender(content: string, id: string, server: McpServer | null, agent: "codex" | "grok"): string {
  if (content.trim()) parseToml(content); const start = TOML_START(id); const end = TOML_END(id); const startAt = content.indexOf(start); const endAt = content.indexOf(end);
  if ((startAt >= 0) !== (endAt >= 0) || (startAt >= 0 && endAt < startAt)) throw new Error(`Malformed AFD MCP block: ${id}.`);
  let base = content;
  if (startAt >= 0 && endAt >= 0) { const after = endAt + end.length; base = `${content.slice(0, startAt)}${content.slice(after).replace(/^\r?\n/, "")}`; }
  else if (parseTomlServers(content)[id] !== undefined) throw new Error(`Divergent unmanaged native MCP entry is preserved: ${id}.`);
  if (!server) return base;
  const table = stringifyToml({ mcp_servers: { [id]: rawToml(server, agent) } }); const block = `${start}\n${table.trim()}\n${end}\n`;
  return `${base.trimEnd()}${base.trim() ? "\n\n" : ""}${block}`;
}

export async function renderNativeMcp(agent: AgentId, scope: McpScope, id: string, server: McpServer | null, options: McpManagerOptions): Promise<{ readonly path: string; readonly before: string; readonly after: string }> {
  const file = nativeMcpPath(agent, scope, options); const before = await text(file); const after = renderNativeMcpContent(agent, id, server, before);
  return { path: file, before, after };
}

export function renderNativeMcpContent(agent: AgentId, id: string, server: McpServer | null, before: string): string {
  if (agent === "codex" || agent === "grok") return tomlRender(before, id, server, agent);
  if (agent === "hermes") return yamlRender(before, id, server);
  if (agent === "antigravity") {
    const parsed: Record<string, unknown> = before.trim() ? JSON.parse(before.replace(/^\uFEFF/, "")) as Record<string, unknown> : {}; if (!plain(parsed)) throw new Error("Native MCP JSON must contain an object.");
    const servers = plain(parsed.mcpServers) ? { ...parsed.mcpServers } : {}; if (server) servers[id] = rawAntigravity(server); else delete servers[id]; parsed.mcpServers = servers; return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  if (agent === "pi") {
    const parsed: Record<string, unknown> = before.trim() ? JSON.parse(before.replace(/^\uFEFF/, "")) as Record<string, unknown> : {}; if (!plain(parsed)) throw new Error("Native MCP JSON must contain an object.");
    const servers = plain(parsed.mcpServers) ? { ...parsed.mcpServers } : {}; if (server) servers[id] = rawPi(server); else delete servers[id]; parsed.mcpServers = servers; return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  return jsonRender(before, id, server);
}

export function renderClaudeProjectDisabled(content: string, projectPath: string, id: string, disabled: boolean): string {
  const parsed: Record<string, unknown> = content.trim() ? JSON.parse(content.replace(/^\uFEFF/, "")) as Record<string, unknown> : {}; if (!plain(parsed)) throw new Error("Claude user config must contain an object.");
  const projects = plain(parsed.projects) ? { ...parsed.projects } : {}; const key = path.resolve(projectPath); const current = plain(projects[key]) ? { ...projects[key] } : {};
  const list = Array.isArray(current.disabledMcpServers) ? current.disabledMcpServers.filter((value): value is string => typeof value === "string" && value !== id) : [];
  if (disabled) list.push(id); if (list.length) current.disabledMcpServers = [...new Set(list)].sort(); else delete current.disabledMcpServers;
  projects[key] = current; parsed.projects = projects; return `${JSON.stringify(parsed, null, 2)}\n`;
}
