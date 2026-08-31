import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentId } from "../src/contracts.js";
import { discoverNativeMcp, hasPiMcpAdapter, nativeMcpPath, piSettingsPath, renderNativeMcp, renderPiMcpAdapter } from "../src/mcp-formats.js";
import { writeAtomic } from "../src/mcp-registry.js";

const targets: readonly AgentId[] = ["claude-code", "codex", "grok"];
const stdio = { transport: "stdio", command: "node", args: ["server.js"], environment: { MODE: { literal: "safe" }, TOKEN_NAME: { fromEnv: "TOKEN_NAME" } }, enabled: true, targets } as const;
const http = { transport: "http", url: "https://example.test/mcp", headers: { "x-mode": { literal: "safe" }, authorization: { fromEnv: "MCP_AUTHORIZATION" } }, enabled: false, targets } as const;

async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "afd-mcp-format-")); return { root, options: { home: path.join(root, "home"), project: path.join(root, "project") } }; }
async function seed(file: string, value: string) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, value, "utf8"); }

test("Claude JSON rendering preserves unrelated settings and round-trips portable entries", async () => {
  const { options } = await fixture(); const file = nativeMcpPath("claude-code", "user", options); await seed(file, '{"theme":"dark","mcpServers":{}}\n');
  const rendered = await renderNativeMcp("claude-code", "user", "demo", stdio, options); await writeAtomic(rendered.path, rendered.after);
  const parsed = JSON.parse(await readFile(file, "utf8")) as { theme?: string }; assert.equal(parsed.theme, "dark");
  const [entry] = await discoverNativeMcp("claude-code", "user", options, targets); assert.equal(entry?.id, "demo"); assert.deepEqual(entry?.server, stdio);
});

test("Antigravity uses its documented global/workspace paths and serverUrl schema", async () => {
  const { options } = await fixture(); const file = nativeMcpPath("antigravity", "project", options); assert.equal(file, path.join(options.project, ".agents", "mcp_config.json"));
  const portableHttp = { transport: "http", url: "https://example.test/mcp", headers: { "x-mode": { literal: "safe" } }, enabled: false, targets } as const;
  const rendered = await renderNativeMcp("antigravity", "project", "docs", portableHttp, options); await writeAtomic(rendered.path, rendered.after);
  assert.match(rendered.after, /"serverUrl": "https:\/\/example\.test\/mcp"/); assert.match(rendered.after, /"disabled": true/); assert.doesNotMatch(rendered.after, /"url":/);
  const [entry] = await discoverNativeMcp("antigravity", "project", options, targets); assert.deepEqual(entry?.server, portableHttp);
  assert.equal(nativeMcpPath("antigravity", "user", options), path.join(options.home, ".gemini", "config", "mcp_config.json"));
  await assert.rejects(renderNativeMcp("antigravity", "user", "stdio", stdio, options), /does not document environment-reference interpolation/);
});

test("Pi declares a pinned adapter without replacing unrelated settings", async () => {
  const { options } = await fixture(); assert.equal(piSettingsPath("user", options), path.join(options.home, ".pi", "agent", "settings.json")); assert.equal(piSettingsPath("project", options), path.join(options.project, ".pi", "settings.json"));
  const rendered = renderPiMcpAdapter('{"theme":"dark","packages":["npm:other@1.0.0"]}\n'); assert.equal(hasPiMcpAdapter(rendered), true); assert.match(rendered, /npm:other@1\.0\.0/); assert.match(rendered, /npm:pi-mcp-adapter@2\.31\.0/);
  assert.throws(() => renderPiMcpAdapter('{"packages":["npm:pi-mcp-adapter@2.30.0"]}'), /divergent/);
});

test("Pi adapter rendering round-trips HTTP headers and persistent disabled state", async () => {
  const { options } = await fixture(); const piTargets: readonly AgentId[] = ["pi"]; const portable = { transport: "http", url: "https://example.test/mcp", headers: { authorization: { fromEnv: "MCP_AUTHORIZATION" } }, enabled: false, targets: piTargets } as const;
  const rendered = await renderNativeMcp("pi", "project", "docs", portable, options); await writeAtomic(rendered.path, rendered.after); assert.doesNotMatch(rendered.after, /"type"/); assert.match(rendered.after, /"disabled": true/);
  const [entry] = await discoverNativeMcp("pi", "project", options, piTargets); assert.deepEqual(entry?.server, portable);
});

test("Codex TOML uses replaceable managed blocks while preserving comments", async () => {
  const { options } = await fixture(); const file = nativeMcpPath("codex", "project", options); await seed(file, '# user comment\nmodel = "gpt"\n');
  const first = await renderNativeMcp("codex", "project", "docs", http, options); await writeAtomic(first.path, first.after);
  assert.match(await readFile(file, "utf8"), /# user comment/); assert.match(first.after, /AI Foundry Desk MCP: docs/); assert.match(first.after, /env_http_headers/);
  const enabled = { ...http, enabled: true }; const second = await renderNativeMcp("codex", "project", "docs", enabled, options); assert.equal((second.after.match(/AI Foundry Desk MCP: docs/g) ?? []).length, 2);
  await writeAtomic(second.path, second.after); const [entry] = await discoverNativeMcp("codex", "project", options, targets); assert.equal(entry?.server.enabled, true);
  const removed = await renderNativeMcp("codex", "project", "docs", null, options); assert.doesNotMatch(removed.after, /mcp_servers\.docs/); assert.match(removed.after, /# user comment/);
});

test("TOML rendering preserves divergent unmanaged entries", async () => {
  const { options } = await fixture(); const file = nativeMcpPath("grok", "user", options); await seed(file, '[mcp_servers.demo]\ncommand = "custom"\n');
  await assert.rejects(renderNativeMcp("grok", "user", "demo", stdio, options), /Divergent unmanaged/);
});

test("Grok rendering blocks undocumented environment forwarding instead of dropping it", async () => {
  const { options } = await fixture();
  await assert.rejects(renderNativeMcp("grok", "user", "demo", stdio, options), /does not document environment forwarding/);
  await assert.rejects(renderNativeMcp("grok", "user", "docs", http, options), /does not document environment-backed HTTP headers/);
});

test("Hermes YAML rendering preserves unrelated keys and comments", async () => {
  const { options } = await fixture(); const file = nativeMcpPath("hermes", "user", options); await seed(file, '# keep\nmodel:\n  provider: openai\n');
  const rendered = await renderNativeMcp("hermes", "user", "demo", stdio, options); await writeAtomic(rendered.path, rendered.after);
  const content = await readFile(file, "utf8"); assert.match(content, /# keep/); assert.match(content, /provider: openai/);
  const [entry] = await discoverNativeMcp("hermes", "user", options, targets); assert.equal(entry?.server.transport, "stdio");
  assert.throws(() => nativeMcpPath("hermes", "project", options), /no verified project/);
});

test("native discovery rejects inline credential-like values without echoing them", async () => {
  const { options } = await fixture(); const file = nativeMcpPath("pi", "user", options); await seed(file, '{"mcpServers":{"bad":{"command":"node","env":{"API_TOKEN":"do-not-print"}}}}');
  await assert.rejects(discoverNativeMcp("pi", "user", options, targets), (error: unknown) => error instanceof Error && /Inline secret-like/.test(error.message) && !error.message.includes("do-not-print"));
});
