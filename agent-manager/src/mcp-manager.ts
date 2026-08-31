import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { agentTargets } from "./catalog.js";
import type { AgentId } from "./contracts.js";
import { mcpCapabilities, isMcpOverride, type McpApplyResult, type McpFileAction, type McpManagerOptions, type McpPlan, type McpPlanKind, type McpRegistry, type McpScope, type McpServer } from "./mcp-contracts.js";
import { discoverNativeMcp, hasPiMcpAdapter, nativeMcpPath, piSettingsPath, renderClaudeProjectDisabled, renderNativeMcpContent, renderPiMcpAdapter } from "./mcp-formats.js";
import { emptyMcpRegistry, loadMcpRegistry, registryPath, resolveEffectiveMcp, serializeMcpRegistry, sha256, withServer, writeAtomic } from "./mcp-registry.js";

interface ManagedState { readonly stateVersion: 1; readonly paths: Readonly<Record<string, readonly string[]>>; readonly claudeProjectDisabled: Readonly<Record<string, readonly string[]>> }
const emptyState = (): ManagedState => ({ stateVersion: 1, paths: {}, claudeProjectDisabled: {} });
function allTargets(options: McpManagerOptions): readonly AgentId[] { return options.targets ?? agentTargets.map((target) => target.id); }
function afdRoot(options: McpManagerOptions): string { const home = options.home ?? process.env.USERPROFILE ?? process.env.HOME; if (!home) throw new Error("Cannot resolve the user home directory."); return path.resolve(options.afdRoot ?? path.join(home, ".afd")); }
function statePath(options: McpManagerOptions): string { return path.join(afdRoot(options), "state", "mcp", "managed.json"); }
async function currentText(file: string): Promise<string | null> { try { return await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
async function loadState(options: McpManagerOptions): Promise<ManagedState> { const content = await currentText(statePath(options)); if (!content) return emptyState(); const value: unknown = JSON.parse(content); if (!value || typeof value !== "object" || (value as { stateVersion?: unknown }).stateVersion !== 1) throw new Error("Invalid MCP managed state."); return value as ManagedState; }
function sortedState(value: ManagedState): string { return `${JSON.stringify({ stateVersion: 1, paths: Object.fromEntries(Object.entries(value.paths).sort().map(([key, ids]) => [key, [...new Set(ids)].sort()])), claudeProjectDisabled: Object.fromEntries(Object.entries(value.claudeProjectDisabled).sort().map(([key, ids]) => [key, [...new Set(ids)].sort()])) }, null, 2)}\n`; }
function registryServerHash(server: McpServer): string { return sha256(JSON.stringify(server)); }

interface MutableFile { readonly agent: AgentId | "canonical"; readonly scope: McpScope; readonly path: string; readonly before: string | null; after: string | null; readonly details: Set<string>; readonly ids: Set<string> }
function actionKind(before: string | null, after: string | null): McpFileAction["kind"] { if (before === after) return "in-sync"; if (before === null) return "create"; if (after === null) return "remove"; return "update"; }
function withoutContent(action: McpFileAction): Omit<McpFileAction, "afterContent"> { const copy = { ...action }; delete copy.afterContent; return copy; }

async function buildPlan(kind: McpPlanKind, scope: McpScope | "effective", serverId: string | null, desiredUser: McpRegistry, desiredProject: McpRegistry | null, options: McpManagerOptions): Promise<McpPlan> {
  const targets = allTargets(options); const blockers: string[] = []; const files = new Map<string, MutableFile>(); const managed = await loadState(options); const nextPaths: Record<string, readonly string[]> = { ...managed.paths }; const nextDisabled: Record<string, readonly string[]> = { ...managed.claudeProjectDisabled };
  const scopes: readonly McpScope[] = scope === "effective" ? ["user", "project"] : [scope];
  if (scopes.includes("project") && !options.project) blockers.push("Project scope requires --project <path>.");
  const getFile = async (agent: AgentId | "canonical", itemScope: McpScope, file: string): Promise<MutableFile> => {
    const existing = files.get(file); if (existing) return existing; const before = await currentText(file); const item = { agent, scope: itemScope, path: file, before, after: before, details: new Set<string>(), ids: new Set<string>() }; files.set(file, item); return item;
  };
  const setCanonical = async (itemScope: McpScope, registry: McpRegistry) => { const file = registryPath(itemScope, options); const item = await getFile("canonical", itemScope, file); item.after = serializeMcpRegistry(registry); item.details.add(`${itemScope} registry`); };
  await setCanonical("user", desiredUser); if (desiredProject) await setCanonical("project", desiredProject);
  const effective = desiredProject ? resolveEffectiveMcp(desiredUser, desiredProject) : resolveEffectiveMcp(desiredUser, null);

  for (const itemScope of scopes) {
    const registry = itemScope === "user" ? desiredUser : desiredProject ?? emptyMcpRegistry();
    for (const agent of targets) {
      const capability = mcpCapabilities[agent][itemScope];
      if (capability === "extension" && agent === "pi") {
        const settingsFile = piSettingsPath(itemScope, options); const settingsItem = await getFile("pi", itemScope, settingsFile); let configured = false;
        try { configured = hasPiMcpAdapter(settingsItem.after ?? ""); } catch (error) { blockers.push(`pi ${itemScope} settings discovery failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
        if (!configured) {
          if (!options.enablePiAdapter) { blockers.push(`pi ${itemScope} MCP requires ${mcpCapabilities.pi.detail} Preview again with --enable-pi-adapter to declare it explicitly.`); continue; }
          try { settingsItem.after = renderPiMcpAdapter(settingsItem.after ?? ""); settingsItem.details.add("declare pinned pi-mcp-adapter 2.31.0"); }
          catch (error) { blockers.push(`pi ${itemScope} extension declaration failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
        }
      } else if (capability !== "native") { blockers.push(`${agent} ${itemScope} MCP scope is ${capability}: ${mcpCapabilities[agent].detail ?? "no verified adapter"}`); continue; }
      let file: string; try { file = nativeMcpPath(agent, itemScope, options); } catch (error) { blockers.push(error instanceof Error ? error.message : String(error)); continue; }
      const fileItem = await getFile(agent, itemScope, file); let content = fileItem.after ?? ""; const priorManaged = new Set(managed.paths[file] ?? []); const desired = new Map<string, McpServer>();
      for (const [id, entry] of Object.entries(registry.servers)) {
        const resolved = isMcpOverride(entry) ? effective.find((candidate) => candidate.id === id)?.server : entry;
        if (!resolved || !resolved.targets.includes(agent)) continue;
        if (!mcpCapabilities[agent].transports.includes(resolved.transport)) { blockers.push(`${agent} does not support ${resolved.transport} for ${id}.`); continue; }
        if (agent === "claude-code" && itemScope === "project" && isMcpOverride(entry)) continue;
        desired.set(id, resolved);
      }
      let discovered = new Map<string, McpServer>();
      try { discovered = new Map((await discoverNativeMcp(agent, itemScope, options, targets)).map((entry) => [entry.id, entry.server])); } catch (error) { blockers.push(`${agent} ${itemScope} discovery failed: ${error instanceof Error ? error.message : String(error)}`); continue; }
      const ids = new Set([...priorManaged, ...desired.keys()]);
      for (const id of ids) {
        let server = desired.get(id) ?? null;
        if (agent === "claude-code" && itemScope === "user" && server && !server.enabled) server = null;
        const native = discovered.get(id); if (!priorManaged.has(id) && native && server && registryServerHash(native) !== registryServerHash(server)) { blockers.push(`${agent} ${itemScope} has divergent unmanaged MCP entry ${id}.`); continue; }
        if (!priorManaged.has(id) && native && server && registryServerHash(native) === registryServerHash(server)) { priorManaged.add(id); }
        if (!priorManaged.has(id) && !server) continue;
        try { content = renderNativeMcpContent(agent, id, server, content); fileItem.ids.add(id); fileItem.details.add(`${server ? "reconcile" : "remove"} ${id}`); }
        catch (error) { blockers.push(`${agent} ${itemScope} ${id}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      fileItem.after = content; nextPaths[file] = [...desired.keys()].sort();
    }
  }

  if (scopes.includes("project") && desiredProject && targets.includes("claude-code") && options.project && mcpCapabilities["claude-code"].project === "native") {
    const userFile = nativeMcpPath("claude-code", "user", options); const item = await getFile("claude-code", "project", userFile); let content = item.after ?? ""; const projectKey = path.resolve(options.project); const prior = new Set(managed.claudeProjectDisabled[projectKey] ?? []); const desired = new Set<string>();
    for (const [id, entry] of Object.entries(desiredProject.servers)) { const resolved = isMcpOverride(entry) ? effective.find((candidate) => candidate.id === id)?.server : entry; if (resolved?.targets.includes("claude-code") && !resolved.enabled) desired.add(id); }
    for (const id of new Set([...prior, ...desired])) { content = renderClaudeProjectDisabled(content, projectKey, id, desired.has(id)); item.ids.add(id); item.details.add(`${desired.has(id) ? "disable" : "enable"} ${id} for project`); }
    item.after = content; nextDisabled[projectKey] = [...desired].sort();
  }

  const stateFile = statePath(options); const stateItem = await getFile("canonical", "user", stateFile); stateItem.after = sortedState({ stateVersion: 1, paths: nextPaths, claudeProjectDisabled: nextDisabled }); stateItem.details.add("managed entry receipts");
  const actions: McpFileAction[] = [...files.values()].map((item) => ({ agent: item.agent, scope: item.scope, kind: actionKind(item.before, item.after), path: item.path, ...(item.ids.size === 1 ? { serverId: [...item.ids][0] } : {}), detail: [...item.details].sort().join("; "), beforeSha256: item.before === null ? null : sha256(item.before), afterSha256: item.after === null ? null : sha256(item.after), afterContent: item.after })).sort((left, right) => left.path.localeCompare(right.path));
  const tokenInput = { schemaVersion: 1, kind, scope, project: options.project ? path.resolve(options.project) : null, serverId, actions: actions.map(withoutContent), blockers: [...new Set(blockers)].sort() }; const approvalToken = sha256(JSON.stringify(tokenInput));
  return { schemaVersion: 1, kind, scope, project: options.project ? path.resolve(options.project) : null, serverId, actions, blocked: blockers.length > 0, blockers: [...new Set(blockers)].sort(), approvalToken, desiredUser, desiredProject };
}

export async function planMcpSync(scope: McpScope | "effective", options: McpManagerOptions): Promise<McpPlan> { const user = await loadMcpRegistry("user", options); const projectRegistry = scope === "user" || !options.project ? null : await loadMcpRegistry("project", options); return buildPlan("sync", scope, null, user, projectRegistry, options); }
export async function planMcpAdopt(agent: AgentId, id: string, fromScope: McpScope, toScope: McpScope, options: McpManagerOptions): Promise<McpPlan> {
  const capability = mcpCapabilities[agent][fromScope]; if (capability !== "native" && !(agent === "pi" && capability === "extension" && hasPiMcpAdapter(await currentText(piSettingsPath(fromScope, options)) ?? ""))) throw new Error(`${agent} ${fromScope} MCP discovery is ${capability}; adoption requires a verified native adapter or declared pinned extension.`);
  const targets = allTargets(options); const entries = await discoverNativeMcp(agent, fromScope, options, targets); const found = entries.find((entry) => entry.id === id); if (!found) throw new Error(`MCP server not found: ${agent}/${fromScope}/${id}.`);
  const user = await loadMcpRegistry("user", options); const projectRegistry = options.project ? await loadMcpRegistry("project", options) : null;
  const desiredUser = toScope === "user" ? withServer(user, "user", id, found.server) : user; const desiredProject = toScope === "project" ? withServer(projectRegistry ?? emptyMcpRegistry(), "project", id, found.server) : projectRegistry;
  return buildPlan("adopt", toScope, id, desiredUser, desiredProject, options);
}
export async function planMcpToggle(id: string, scope: McpScope, enabled: boolean, options: McpManagerOptions): Promise<McpPlan> {
  const user = await loadMcpRegistry("user", options); const projectRegistry = options.project ? await loadMcpRegistry("project", options) : null;
  if (scope === "user") { const entry = user.servers[id]; if (!entry || isMcpOverride(entry)) throw new Error(`User MCP server not found: ${id}.`); return buildPlan(enabled ? "enable" : "disable", "effective", id, withServer(user, "user", id, { ...entry, enabled }), projectRegistry, options); }
  const current = projectRegistry?.servers[id]; const next = current && !isMcpOverride(current) ? { ...current, enabled } : { inherits: "user", enabled } as const;
  return buildPlan(enabled ? "enable" : "disable", "project", id, user, withServer(projectRegistry ?? emptyMcpRegistry(), "project", id, next), options);
}
export async function planMcpMove(id: string, from: McpScope, to: McpScope, options: McpManagerOptions): Promise<McpPlan> {
  if (from === to) throw new Error("MCP move scopes must differ."); const user = await loadMcpRegistry("user", options); const projectRegistry = options.project ? await loadMcpRegistry("project", options) : null; const source = (from === "user" ? user : projectRegistry)?.servers[id]; if (!source || isMcpOverride(source)) throw new Error(`${from} MCP server not found or is only an override: ${id}.`);
  const desiredUser = from === "user" ? withServer(user, "user", id, null) : withServer(user, "user", id, source); const desiredProject = from === "project" ? withServer(projectRegistry ?? emptyMcpRegistry(), "project", id, null) : withServer(projectRegistry ?? emptyMcpRegistry(), "project", id, source);
  return buildPlan("move", "effective", id, desiredUser, desiredProject, options);
}

export async function applyMcpPlan(plan: McpPlan, confirm: string, options: McpManagerOptions): Promise<McpApplyResult> {
  if (plan.blocked) throw new Error(`MCP plan is blocked: ${plan.blockers.join("; ")}`); if (confirm !== plan.approvalToken) throw new Error("MCP confirmation token does not match the current plan.");
  for (const action of plan.actions) {
    const renderedHash = action.afterContent === null || action.afterContent === undefined ? null : sha256(action.afterContent);
    if (renderedHash !== action.afterSha256) throw new Error(`MCP plan payload does not match its approved hash: ${action.path}.`);
    const current = await currentText(action.path); const hash = current === null ? null : sha256(current); if (hash !== action.beforeSha256) throw new Error(`MCP plan is stale: ${action.path}.`);
  }
  const changed = plan.actions.filter((action) => action.kind !== "in-sync"); if (!changed.length) return { schemaVersion: 1, status: "unchanged", kind: plan.kind, approvalToken: plan.approvalToken, changed: [], attention: [] };
  const backupRoot = path.resolve(options.backupRoot ?? path.join(process.env.LOCALAPPDATA ?? path.join(afdRoot(options), "local"), "AI Foundry Desk", "backups"), "mcp", new Date().toISOString().replace(/[:.]/g, "-")); const snapshots = new Map<string, string | null>();
  try {
    for (const [index, action] of changed.entries()) { const before = await currentText(action.path); snapshots.set(action.path, before); await mkdir(backupRoot, { recursive: true }); await writeFile(path.join(backupRoot, `${String(index).padStart(3, "0")}-${path.basename(action.path)}.before`), before ?? "", "utf8"); if (action.afterContent === null || action.afterContent === undefined) await rm(action.path, { force: true }); else await writeAtomic(action.path, action.afterContent); }
  } catch (error) {
    for (const [file, before] of [...snapshots.entries()].reverse()) { if (before === null) await rm(file, { force: true }); else await writeAtomic(file, before); }
    throw error;
  }
  return { schemaVersion: 1, status: "applied", kind: plan.kind, approvalToken: plan.approvalToken, changed: changed.map((action) => action.path), attention: targetsAttention(plan, options) };
}

function targetsAttention(plan: McpPlan, options: McpManagerOptions): readonly string[] { const notes: string[] = []; const targets = allTargets(options); if (plan.scope !== "user" && targets.includes("claude-code")) notes.push("Claude Code may require project trust and MCP approval in a new session."); if (plan.scope !== "user" && targets.includes("codex")) notes.push("Codex project MCP configuration requires a trusted project and client restart."); if (targets.includes("pi") && options.enablePiAdapter) notes.push("Pi will install and execute pinned pi-mcp-adapter 2.31.0 on its next trusted startup; review the third-party package before confirmation."); return notes; }

export function publicMcpPlan(plan: McpPlan): Omit<McpPlan, "desiredUser" | "desiredProject"> { return { schemaVersion: plan.schemaVersion, kind: plan.kind, scope: plan.scope, project: plan.project, serverId: plan.serverId, actions: plan.actions.map(withoutContent), blocked: plan.blocked, blockers: plan.blockers, approvalToken: plan.approvalToken }; }

export function renderMcpPlan(plan: McpPlan): string { const rows = [`AFD MCP ${plan.kind} plan`, `Scope: ${plan.scope}`, `Project: ${plan.project ?? "-"}`, `Approval token: ${plan.approvalToken}`, `Status: ${plan.blocked ? "BLOCKED" : "ready"}`]; for (const action of plan.actions) rows.push(`${action.kind.toUpperCase()}\t${action.agent}\t${action.scope}\t${action.path}\t${action.detail}`); if (plan.blockers.length) rows.push("", "Blockers:", ...plan.blockers.map((item) => `- ${item}`)); return `${rows.join("\n")}\n`; }
