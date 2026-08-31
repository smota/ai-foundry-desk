import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentId } from "../src/contracts.js";
import { applyMcpPlan, planMcpAdopt, planMcpMove, planMcpSync, planMcpToggle } from "../src/mcp-manager.js";
import { nativeMcpPath, piSettingsPath } from "../src/mcp-formats.js";
import { loadMcpRegistry, registryPath, serializeMcpRegistry, writeAtomic } from "../src/mcp-registry.js";
import type { McpManagerOptions, McpRegistry } from "../src/mcp-contracts.js";

const targets: readonly AgentId[] = ["claude-code", "codex", "grok"];
const server = { transport: "stdio", command: "node", args: ["server.js"], enabled: true, targets } as const;
async function fixture(): Promise<McpManagerOptions> { const root = await mkdtemp(path.join(tmpdir(), "afd-mcp-manager-")); return { home: path.join(root, "home"), afdRoot: path.join(root, "home", ".afd"), backupRoot: path.join(root, "backups"), project: path.join(root, "project"), targets }; }
async function registry(scope: "user" | "project", options: McpManagerOptions, value: McpRegistry) { await writeAtomic(registryPath(scope, options), serializeMcpRegistry(value)); }

test("user MCP sync is hash-bound, transactional, and idempotent across supported adapters", async () => {
  const options = await fixture(); await registry("user", options, { schemaVersion: 1, servers: { demo: server } });
  const plan = await planMcpSync("user", options); assert.equal(plan.blocked, false); assert.ok(plan.actions.some((item) => item.agent === "codex" && item.kind === "create"));
  await assert.rejects(applyMcpPlan(plan, "wrong", options), /does not match/); const applied = await applyMcpPlan(plan, plan.approvalToken, options); assert.equal(applied.status, "applied");
  assert.match(await readFile(nativeMcpPath("claude-code", "user", options), "utf8"), /"demo"/); assert.match(await readFile(nativeMcpPath("codex", "user", options), "utf8"), /mcp_servers\.demo/); assert.match(await readFile(nativeMcpPath("grok", "user", options), "utf8"), /mcp_servers\.demo/);
  const again = await planMcpSync("user", options); assert.equal(again.blocked, false); assert.ok(again.actions.every((item) => item.kind === "in-sync")); assert.equal((await applyMcpPlan(again, again.approvalToken, options)).status, "unchanged");
});

test("project tombstone disables an inherited user server without removing its definition", async () => {
  const options = await fixture(); await registry("user", options, { schemaVersion: 1, servers: { demo: server } }); await registry("project", options, { schemaVersion: 1, servers: { demo: { inherits: "user", enabled: false } } });
  const plan = await planMcpSync("effective", options); assert.equal(plan.blocked, false, plan.blockers.join("; ")); await applyMcpPlan(plan, plan.approvalToken, options);
  const claude = JSON.parse(await readFile(nativeMcpPath("claude-code", "user", options), "utf8")) as { projects?: Record<string, { disabledMcpServers?: string[] }> }; assert.deepEqual(claude.projects?.[path.resolve(options.project!)]?.disabledMcpServers, ["demo"]);
  assert.match(await readFile(nativeMcpPath("codex", "project", options), "utf8"), /enabled = false/); assert.match(await readFile(nativeMcpPath("grok", "project", options), "utf8"), /enabled = false/);
  const enable = await planMcpToggle("demo", "project", true, options); assert.equal(enable.blocked, false); await applyMcpPlan(enable, enable.approvalToken, options); const enabledClaude = JSON.parse(await readFile(nativeMcpPath("claude-code", "user", options), "utf8")) as { projects?: Record<string, { disabledMcpServers?: string[] }> }; assert.equal(enabledClaude.projects?.[path.resolve(options.project!)]?.disabledMcpServers, undefined);
});

test("moving between scopes updates canonical and native ownership in one plan", async () => {
  const options = await fixture(); await registry("user", options, { schemaVersion: 1, servers: { demo: server } }); await registry("project", options, { schemaVersion: 1, servers: {} });
  const initial = await planMcpSync("effective", options); await applyMcpPlan(initial, initial.approvalToken, options);
  const move = await planMcpMove("demo", "user", "project", options); assert.equal(move.blocked, false); await applyMcpPlan(move, move.approvalToken, options);
  assert.equal((await loadMcpRegistry("user", options)).servers.demo, undefined); assert.deepEqual((await loadMcpRegistry("project", options)).servers.demo, server);
  const userCodex = await readFile(nativeMcpPath("codex", "user", options), "utf8"); const projectCodex = await readFile(nativeMcpPath("codex", "project", options), "utf8"); assert.doesNotMatch(userCodex, /mcp_servers\.demo/); assert.match(projectCodex, /mcp_servers\.demo/);
});

test("all-target project plans fail closed on Pi dependency and unsupported Hermes project scope before writes", async () => {
  const options = await fixture(); const allOptions: McpManagerOptions = { home: options.home!, afdRoot: options.afdRoot!, backupRoot: options.backupRoot!, project: options.project! }; await registry("user", allOptions, { schemaVersion: 1, servers: {} }); await registry("project", allOptions, { schemaVersion: 1, servers: {} });
  const plan = await planMcpSync("project", allOptions); assert.equal(plan.blocked, true); assert.ok(!plan.blockers.some((item) => item.includes("antigravity"))); assert.ok(plan.blockers.some((item) => item.includes("pi") && item.includes("--enable-pi-adapter"))); assert.ok(plan.blockers.some((item) => item.includes("hermes") && item.includes("unsupported")));
  await assert.rejects(applyMcpPlan(plan, plan.approvalToken, allOptions), /blocked/);
});

test("adoption refuses an unverified extension source", async () => {
  const options = await fixture();
  await assert.rejects(planMcpAdopt("pi", "demo", "user", "user", options), /requires a verified native adapter/);
});

test("Pi opt-in is pinned, transactional, and then idempotent", async () => {
  const options = await fixture(); const piOptions: McpManagerOptions = { ...options, targets: ["pi"], enablePiAdapter: true }; const piServer = { ...server, targets: ["pi"] as readonly AgentId[] }; await registry("user", piOptions, { schemaVersion: 1, servers: { demo: piServer } });
  const plan = await planMcpSync("user", piOptions); assert.equal(plan.blocked, false, plan.blockers.join("; ")); assert.ok(plan.actions.some((item) => item.path === piSettingsPath("user", piOptions) && item.afterSha256)); await applyMcpPlan(plan, plan.approvalToken, piOptions);
  assert.match(await readFile(piSettingsPath("user", piOptions), "utf8"), /npm:pi-mcp-adapter@2\.31\.0/); assert.match(await readFile(nativeMcpPath("pi", "user", piOptions), "utf8"), /"demo"/);
  const again = await planMcpSync("user", { ...piOptions, enablePiAdapter: false }); assert.equal(again.blocked, false, again.blockers.join("; ")); assert.ok(again.actions.every((item) => item.kind === "in-sync"));
});

test("stale native content rejects apply without overwriting concurrent edits", async () => {
  const options = await fixture(); await registry("user", options, { schemaVersion: 1, servers: { demo: server } }); const plan = await planMcpSync("user", options); const claude = nativeMcpPath("claude-code", "user", options); await mkdir(path.dirname(claude), { recursive: true }); await writeFile(claude, '{"concurrent":true}\n', "utf8");
  await assert.rejects(applyMcpPlan(plan, plan.approvalToken, options), /stale/); assert.match(await readFile(claude, "utf8"), /concurrent/);
});

test("apply rejects a rendered payload that no longer matches the approved hash", async () => {
  const options = await fixture(); await registry("user", options, { schemaVersion: 1, servers: { demo: server } }); const plan = await planMcpSync("user", options);
  const actions = plan.actions.map((action, index) => index === 0 ? { ...action, afterContent: "tampered\n" } : action);
  await assert.rejects(applyMcpPlan({ ...plan, actions }, plan.approvalToken, options), /payload does not match/);
});

test("a mid-transaction write failure restores every earlier file byte-for-byte", async () => {
  const options = await fixture(); const root = path.dirname(options.project!); const first = path.join(root, "rollback-blocker"); const impossible = path.join(first, "child.json");
  const plan = {
    schemaVersion: 1 as const, kind: "sync" as const, scope: "user" as const, project: null, serverId: null, blocked: false, blockers: [], approvalToken: "rollback-test", desiredUser: { schemaVersion: 1 as const, servers: {} }, desiredProject: null,
    actions: [
      { agent: "canonical" as const, scope: "user" as const, kind: "create" as const, path: first, detail: "first write", beforeSha256: null, afterSha256: "291ebfbc2d4eb297c3a9bd7be49d0e0e35a2a6803f4eaa2b56f6d7b5dd4c47ea", afterContent: "originally absent\n" },
      { agent: "canonical" as const, scope: "user" as const, kind: "create" as const, path: impossible, detail: "forced failure", beforeSha256: null, afterSha256: "c8d1bc830dc693c2fb045eea9020909bfd722002fb6cb8b6a09aece0084be3e1", afterContent: "cannot be written\n" },
    ],
  };
  await assert.rejects(applyMcpPlan(plan, plan.approvalToken, options));
  await assert.rejects(readFile(first, "utf8"), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});
