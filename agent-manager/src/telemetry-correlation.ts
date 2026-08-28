import path from "node:path";
import type { PlatformAdapter } from "./platform.js";
import { NodePlatformAdapter } from "./platform.js";
import type { TelemetryOutcome } from "./telemetry.js";

export interface TelemetryRunRecord {
  readonly schemaVersion: 2;
  readonly runId: string;
  readonly traceId: string;
  readonly rootSpanId: string;
  readonly parentSpanId?: string;
  readonly parentRunId?: string;
  readonly projectId: string;
  readonly agent: string;
  readonly clientSessionIdHash?: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outcome: TelemetryOutcome;
  readonly source: "afd-otel";
}
const TRACE = /^[a-f0-9]{32}$/;
function indexFile(adapter: PlatformAdapter): string { return path.join(adapter.stateRoot, "telemetry-v2", "correlation.json"); }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)); }
function valid(record: Partial<TelemetryRunRecord>): record is TelemetryRunRecord {
  return record.schemaVersion === 2
    && typeof record.runId === "string" && TRACE.test(record.runId)
    && typeof record.traceId === "string" && TRACE.test(record.traceId)
    && typeof record.rootSpanId === "string" && /^[a-f0-9]{16}$/.test(record.rootSpanId)
    && (record.parentSpanId === undefined || /^[a-f0-9]{16}$/.test(record.parentSpanId))
    && (record.parentRunId === undefined || TRACE.test(record.parentRunId))
    && typeof record.projectId === "string" && /^afd:[a-f0-9]{20}$/.test(record.projectId)
    && typeof record.agent === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(record.agent)
    && (record.clientSessionIdHash === undefined || /^[a-f0-9]{20}$/.test(record.clientSessionIdHash))
    && validTimestamp(record.startedAt) && validTimestamp(record.endedAt)
    && Date.parse(record.endedAt) >= Date.parse(record.startedAt)
    && ["ok", "error", "cancelled"].includes(record.outcome ?? "") && record.source === "afd-otel";
}
async function readAll(adapter: PlatformAdapter): Promise<TelemetryRunRecord[]> { const raw = await adapter.readText(indexFile(adapter)); if (!raw) return []; try { const values = JSON.parse(raw) as unknown; return Array.isArray(values) ? values.filter((item): item is TelemetryRunRecord => Boolean(item) && typeof item === "object" && valid(item as Partial<TelemetryRunRecord>)) : []; } catch { throw new Error("Telemetry correlation index is corrupt; no evidence was inferred."); } }
export async function recordTelemetryRun(record: TelemetryRunRecord, retentionDays: number, adapter: PlatformAdapter = new NodePlatformAdapter(), now = Date.now()): Promise<void> { if (!valid(record)) throw new Error("Invalid telemetry correlation record."); if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error("Invalid telemetry correlation retention."); const cutoff = now - retentionDays * 86_400_000; const current = (await readAll(adapter)).filter((item) => Date.parse(item.endedAt) >= cutoff && item.runId !== record.runId); current.push(record); current.sort((left, right) => left.endedAt.localeCompare(right.endedAt)); await adapter.writeText(indexFile(adapter), JSON.stringify(current, null, 2) + "\n"); }
export async function findTelemetryRun(runId: string, adapter: PlatformAdapter = new NodePlatformAdapter()): Promise<TelemetryRunRecord | undefined> { if (!TRACE.test(runId)) throw new Error("Run id must be a 32-character lowercase trace id."); return (await readAll(adapter)).find((item) => item.runId === runId); }
