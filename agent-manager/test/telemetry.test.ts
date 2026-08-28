import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOtlpJsonTrace, newSpanId, redactTelemetryAttributes, telemetryIdentity } from "../src/telemetry.js";

test("schema v2 separates run and trace identity and preserves real parent relationships", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "afd-telemetry-")); const secret = Buffer.alloc(32, 7); const traceId = "a".repeat(32); const root = newSpanId(); const child = newSpanId();
  const runId="b".repeat(32);const identity = await telemetryIdentity(workspace, "codex", secret, { traceId,runId }); const trace = buildOtlpJsonTrace(identity, [{ spanId: root, name: "agent.run", startedAtUnixMs: 1_000, endedAtUnixMs: 2_000, outcome: "ok" }, { spanId: child, parentSpanId: root, name: "tool.run", startedAtUnixMs: 1_100, endedAtUnixMs: 1_200, outcome: "ok" }]); const encoded = JSON.stringify(trace);
  assert.equal(identity["afd.run.id"], runId); assert.match(encoded, new RegExp(`"traceId":"${traceId}"`)); assert.match(encoded, new RegExp(`"parentSpanId":"${root}"`)); assert.doesNotMatch(identity["afd.project.id"],new RegExp(path.basename(workspace),"i")); assert.notEqual(identity["afd.workspace.id"], await realpath(workspace));
});

test("telemetry allowlist removes sensitive and unknown attributes", () => {
  assert.deepEqual(redactTelemetryAttributes({ "afd.outcome": "ok", prompt: "private", argv: "private", "file.path": "private", random: "drop", "gen_ai.request.model": "gpt-test" }), { "afd.outcome": "ok", "gen_ai.request.model": "gpt-test" });
});

test("trace validation rejects missing parents and malformed ids", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "afd-telemetry-invalid-")); const identity = await telemetryIdentity(workspace, "codex", Buffer.alloc(32, 1), { traceId: "b".repeat(32) });
  assert.throws(() => buildOtlpJsonTrace(identity, [{ spanId: "c".repeat(16), parentSpanId: "d".repeat(16), name: "agent.run", startedAtUnixMs: 1, endedAtUnixMs: 2, outcome: "ok" }]), /Parent span/);
});
