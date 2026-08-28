import { createHmac, randomBytes } from "node:crypto";
import { realpath } from "node:fs/promises";

export const TELEMETRY_SCHEMA_VERSION = 2 as const;
export type TelemetryOutcome = "ok" | "error" | "cancelled";
export type CorrelationStatus = "exact_trace" | "exact_session" | "evidenced" | "heuristic" | "ambiguous" | "unlinked";

export interface TelemetryIdentity {
  readonly traceId: string;
  readonly "afd.schema.version": typeof TELEMETRY_SCHEMA_VERSION;
  readonly "afd.project.id": string;
  readonly "afd.workspace.id": string;
  readonly "afd.run.id": string;
  readonly "afd.agent.name": string;
  readonly "afd.client.session.id"?: string;
}

export interface TelemetrySpan {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startedAtUnixMs: number;
  readonly endedAtUnixMs: number;
  readonly outcome: TelemetryOutcome;
  readonly attributes?: Readonly<Record<string, string | number | boolean | undefined>>;
}

const FORBIDDEN_ATTRIBUTE = /(?:api[-_]?key|authorization|credential|cookie|password|secret|prompt|response|content|session|history|command|argument|argv|env|file|path|cwd|stdout|stderr)/i;
const ALLOWED_ATTRIBUTE = /^(?:afd\.(?:schema\.version|project\.id|workspace\.id|run\.id|agent\.name|operation|outcome|evidence\.[a-z0-9._-]+)|gen_ai\.(?:operation\.name|request\.model)|error\.type)$/;
const HEX_TRACE = /^[a-f0-9]{32}$/;
const HEX_SPAN = /^[a-f0-9]{16}$/;
const OPERATION = /^[-a-zA-Z0-9._/]{1,128}$/;

export function redactTelemetryAttributes(attributes: Readonly<Record<string, string | number | boolean | undefined>> = {}): Readonly<Record<string, string | number | boolean>> {
  return Object.fromEntries(Object.entries(attributes).flatMap(([key, value]) => value === undefined || FORBIDDEN_ATTRIBUTE.test(key) || !ALLOWED_ATTRIBUTE.test(key) ? [] : [[key, value]]));
}

function hmac(secret: Uint8Array, value: string): string { return createHmac("sha256", secret).update(value).digest("hex").slice(0, 20); }
export function newTraceId(): string { return randomBytes(16).toString("hex"); }
export function newSpanId(): string { return randomBytes(8).toString("hex"); }

export async function telemetryIdentity(workspace: string, agent: string, secret: Uint8Array, options: { readonly traceId?: string; readonly runId?: string } = {}): Promise<TelemetryIdentity> {
  const root = await realpath(workspace); const traceId = options.traceId ?? newTraceId(); const runId = options.runId ?? newTraceId();
  if (!HEX_TRACE.test(traceId)) throw new Error("Telemetry trace id must be a 32-character lowercase OTEL trace id.");
  if (!HEX_TRACE.test(runId)) throw new Error("Telemetry run id must be a 32-character lowercase identifier.");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)) throw new Error("Invalid telemetry agent name.");
  return {
    "afd.schema.version": TELEMETRY_SCHEMA_VERSION,
    "afd.project.id": `afd:${hmac(secret, root)}`,
    "afd.workspace.id": hmac(secret, root),
    "afd.run.id": runId,
    "afd.agent.name": agent,
    traceId,
  };
}

function otlpValue(value: string | number | boolean): Record<string, string | number | boolean> {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}
function otlpAttributes(attributes: Readonly<Record<string, string | number | boolean>>): readonly { readonly key: string; readonly value: Record<string, string | number | boolean> }[] {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));
}
function unixNanos(milliseconds: number): string { return (BigInt(Math.trunc(milliseconds)) * 1_000_000n).toString(); }

export function buildOtlpJsonTrace(identity: TelemetryIdentity, spans: readonly TelemetrySpan[]): Record<string, unknown> {
  if (!HEX_TRACE.test(identity.traceId) || !HEX_TRACE.test(identity["afd.run.id"]) || identity["afd.schema.version"] !== TELEMETRY_SCHEMA_VERSION) throw new Error("Invalid telemetry identity.");
  if (!spans.length) throw new Error("A telemetry trace requires at least one span.");
  const ids = new Set<string>();
  for (const span of spans) {
    if (!HEX_SPAN.test(span.spanId) || ids.has(span.spanId)) throw new Error("Telemetry span ids must be unique 16-character lowercase hex values.");
    if (span.parentSpanId && !HEX_SPAN.test(span.parentSpanId)) throw new Error("Invalid parent span id.");
    if (!OPERATION.test(span.name) || !Number.isFinite(span.startedAtUnixMs) || !Number.isFinite(span.endedAtUnixMs) || span.endedAtUnixMs < span.startedAtUnixMs) throw new Error("Invalid telemetry span.");
    ids.add(span.spanId);
  }
  for (const span of spans) if (span.parentSpanId && !ids.has(span.parentSpanId)) throw new Error("Parent span is not part of the trace.");
  const publicIdentity = Object.fromEntries(Object.entries(identity).filter(([key]) => key.startsWith("afd.")));
  return {
    resourceSpans: [{
      resource: { attributes: otlpAttributes({ "service.name": "ai-foundry-desk", "telemetry.sdk.language": "nodejs", "openinference.project.name": identity["afd.project.id"] }) },
      scopeSpans: [{
        scope: { name: "afd.telemetry", version: "2" },
        spans: spans.map((span) => ({
          traceId: identity.traceId, spanId: span.spanId,
          ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
          name: span.name, kind: 1,
          startTimeUnixNano: unixNanos(span.startedAtUnixMs), endTimeUnixNano: unixNanos(span.endedAtUnixMs),
          attributes: otlpAttributes(redactTelemetryAttributes({ ...publicIdentity, "afd.operation": span.name, "afd.outcome": span.outcome, ...span.attributes })),
          status: { code: span.outcome === "ok" ? 1 : 2, ...(span.outcome === "ok" ? {} : { message: span.outcome }) },
        })),
      }],
    }],
  };
}

export async function emitLoopbackOtlpJson(endpoint: string, trace: Record<string, unknown>): Promise<void> {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Telemetry export is limited to loopback HTTP endpoints.");
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(trace), signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`Local OTLP Collector rejected trace: HTTP ${response.status}.`);
}
