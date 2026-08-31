import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { emptyMcpRegistry, loadMcpRegistry, parseMcpRegistry, registryPath, resolveEffectiveMcp, serializeMcpRegistry, withServer, writeAtomic } from "../src/mcp-registry.js";

const targets = ["claude-code", "codex", "grok"] as const;
const stdio = { transport: "stdio", command: "node", args: ["server.js"], enabled: true, targets } as const;

test("MCP registries are strict, deterministic, and secret-safe", () => {
  const registry = parseMcpRegistry({ schemaVersion: 1, servers: { demo: stdio } }, "user");
  assert.equal(serializeMcpRegistry(registry), serializeMcpRegistry(parseMcpRegistry(JSON.parse(serializeMcpRegistry(registry)), "user")));
  assert.throws(() => parseMcpRegistry({ schemaVersion: 1, servers: { demo: { ...stdio, environment: { API_TOKEN: { literal: "secret" } } } } }, "user"), /Inline secret-like/);
  assert.throws(() => parseMcpRegistry({ schemaVersion: 1, servers: { demo: { ...stdio, extra: true } } }, "user"), /Unknown/);
  assert.throws(() => parseMcpRegistry({ schemaVersion: 1, servers: { demo: { inherits: "user", enabled: false } } }, "user"), /scope override/);
  assert.throws(() => parseMcpRegistry({ schemaVersion: 1, servers: { demo: { ...stdio, cwd: "C:\\outside" } } }, "project"), /project-relative/);
  assert.throws(() => parseMcpRegistry({ schemaVersion: 1, servers: { demo: { ...stdio, cwd: "../outside" } } }, "project"), /stay inside the project/);
});

test("project definitions replace user definitions and tombstones only change enabled state", () => {
  const user = parseMcpRegistry({ schemaVersion: 1, servers: { demo: stdio } }, "user");
  const disabled = parseMcpRegistry({ schemaVersion: 1, servers: { demo: { inherits: "user", enabled: false } } }, "project");
  const [effective] = resolveEffectiveMcp(user, disabled);
  assert.equal(effective?.origin, "user"); assert.equal(effective?.overridden, true); assert.equal(effective?.server.enabled, false);
  const replacement = parseMcpRegistry({ schemaVersion: 1, servers: { demo: { transport: "http", url: "https://example.test/mcp", enabled: true, targets } } }, "project");
  assert.equal(resolveEffectiveMcp(user, replacement)[0]?.server.transport, "http");
  assert.throws(() => resolveEffectiveMcp(emptyMcpRegistry(), disabled), /no user definition/);
});

test("registry paths and atomic writes stay inside their declared scopes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "afd-mcp-registry-")); const home = path.join(root, "home"); const project = path.join(root, "project");
  const options = { home, afdRoot: path.join(home, ".afd"), project };
  const userFile = registryPath("user", options); const projectFile = registryPath("project", options);
  assert.equal(userFile, path.join(home, ".afd", "mcp", "user.json")); assert.equal(projectFile, path.join(project, ".afd", "mcp.json"));
  const registry = withServer(emptyMcpRegistry(), "user", "demo", stdio); await writeAtomic(userFile, serializeMcpRegistry(registry));
  assert.deepEqual(await loadMcpRegistry("user", options), registry); assert.match(await readFile(userFile, "utf8"), /"demo"/);
});
