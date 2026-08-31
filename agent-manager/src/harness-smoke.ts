import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HostCommand, CommandResult, PlatformAdapter } from "./platform.js";
import { NodePlatformAdapter } from "./platform.js";
import type {
  HarnessAgentId,
  HarnessPlan,
  HarnessSmokeReport,
  HarnessSmokeResult,
} from "./harness-contracts.js";

const MARKER = "AFD_HARNESS_SMOKE_V1:";
type SmokeRun = (command: HostCommand) => Promise<CommandResult>;

interface RunnerContract {
  readonly executable: string;
  readonly safety: string;
  readonly args: (project: string, prompt: string) => readonly string[];
}

const RUNNERS: Readonly<Partial<Record<HarnessAgentId, RunnerContract>>> = {
  codex: {
    executable: "codex",
    safety: "ephemeral session, ignored user config, read-only sandbox",
    args: (project, prompt) => ["exec", "--sandbox", "read-only", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check", "--color", "never", "-C", project, prompt],
  },
  "claude-code": {
    executable: "claude",
    safety: "plan permission mode with read-only tools",
    args: (_project, prompt) => ["-p", prompt, "--output-format", "text", "--permission-mode", "plan", "--tools", "Read,Grep,Glob"],
  },
  pi: {
    executable: "pi",
    safety: "ephemeral session with an explicit read-only tool allowlist",
    args: (_project, prompt) => ["--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--tools", "read,grep,find,ls", "--offline", "-p", prompt],
  },
  grok: {
    executable: "grok",
    safety: "single turn, plan permission mode, no subagents or web tools",
    args: (project, prompt) => ["--single", prompt, "--cwd", project, "--permission-mode", "plan", "--disable-web-search", "--no-subagents", "--output-format", "plain", "--max-turns", "1"],
  },
};

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function policyFacts(canonicalPath: string, text: string): { readonly canonicalPath: string; readonly firstHeading: string; readonly finalInstructionLine: string } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstHeading = lines.find((line) => /^#\s+/.test(line)) ?? lines[0] ?? "";
  const finalInstructionLine = [...lines].reverse().find((line) => !/^```/.test(line) && !/^<!--/.test(line)) ?? "";
  return { canonicalPath, firstHeading, finalInstructionLine };
}
function fingerprint(value: { readonly canonicalPath: string; readonly firstHeading: string; readonly finalInstructionLine: string }): string { return hash(JSON.stringify(value)); }
function prompt(agent: HarnessAgentId): string {
  return `This is an AFD read-only harness discovery smoke test. Use only automatically discovered project instructions and read-only file tools. Do not modify files, run project commands, use network tools, or load unrelated content. Return exactly one line beginning ${MARKER} followed by compact JSON with keys agent, canonicalPath, firstHeading, finalInstructionLine, and writeAttempted. Set agent to ${JSON.stringify(agent)}, canonicalPath to the final canonical project policy source (not an adapter that points to it), copy that source's first level-one heading exactly, copy its final non-empty non-comment instruction line exactly, and set writeAttempted to false. The expected path and text values are deliberately not included in this prompt.`;
}
function nestedCandidate(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>; if (["agent", "canonicalPath", "firstHeading", "finalInstructionLine", "writeAttempted"].every((key) => key in record)) return record;
  for (const child of Object.values(record)) { if (typeof child === "string" && child.includes(MARKER)) { const parsed = markerCandidate(child); if (parsed) return parsed; } const parsed = nestedCandidate(child); if (parsed) return parsed; }
  return null;
}
function markerCandidate(output: string): Record<string, unknown> | null {
  const index = output.lastIndexOf(MARKER); if (index < 0) return null; const tail = output.slice(index + MARKER.length).trim();
  const first = tail.indexOf("{"); if (first < 0) return null; let depth = 0; let quoted = false; let escaped = false;
  for (let cursor = first; cursor < tail.length; cursor++) { const char = tail[cursor]!; if (escaped) { escaped = false; continue; } if (char === "\\") { escaped = true; continue; } if (char === '"') { quoted = !quoted; continue; } if (quoted) continue; if (char === "{") depth++; if (char === "}" && --depth === 0) { try { const value: unknown = JSON.parse(tail.slice(first, cursor + 1)); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; } } }
  return null;
}
function parseCandidate(output: string): Record<string, unknown> | null {
  const marked = markerCandidate(output); if (marked) return marked;
  for (const line of output.split(/\r?\n/).reverse()) { try { const value: unknown = JSON.parse(line); const candidate = nestedCandidate(value); if (candidate) return candidate; } catch { /* non-JSON output */ } }
  return null;
}
async function commandAvailable(executable: string, run: SmokeRun): Promise<{ readonly available: boolean; readonly version: string | null }> {
  const locator = process.platform === "win32" ? { executable: "where.exe", args: [executable] } : { executable: "which", args: [executable] };
  const located = await run({ ...locator, timeoutMs: 10_000 }); if (located.status !== 0) return { available: false, version: null };
  const version = await run({ executable, args: ["--version"], timeoutMs: 15_000 }); return { available: true, version: version.status === 0 ? version.stdout.trim().split(/\r?\n/).at(-1) ?? null : null };
}
function result(agent: HarnessAgentId, state: HarnessSmokeResult["state"], command: string | null, version: string | null, policyFingerprint: string | null, detail: string, durationMs: number): HarnessSmokeResult {
  return { agent, state, command, version, policyFingerprint, detail, durationMs };
}
async function assertCanonicalUnchanged(plan: HarnessPlan): Promise<void> {
  const current = await readFile(path.join(plan.project, plan.canonicalPath), "utf8"); if (hash(current) !== plan.canonicalSha256) throw new Error("Harness smoke test detected canonical instruction drift.");
}
async function fileSnapshot(root: string, relative = ""): Promise<readonly string[]> {
  const directory = path.join(root, relative); const entries = await readdir(directory, { withFileTypes: true }); const rows: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const item = path.join(relative, entry.name); const absolute = path.join(root, item);
    if (entry.isSymbolicLink()) throw new Error(`Harness smoke workspace contains a symbolic link: ${item}`);
    if (entry.isDirectory()) rows.push(...await fileSnapshot(root, item));
    else if (entry.isFile()) rows.push(`${item.replaceAll("\\", "/")}:${hash(await readFile(absolute, "utf8"))}`);
    else throw new Error(`Harness smoke workspace contains an unsupported entry: ${item}`);
  }
  return rows;
}
async function prepareSmokeWorkspace(plan: HarnessPlan, canonical: string): Promise<{ readonly root: string; readonly snapshot: readonly string[] }> {
  const root = await mkdtemp(path.join(tmpdir(), "afd-harness-smoke-"));
  const files = new Map<string, string>([[plan.canonicalPath, canonical]]);
  for (const item of plan.actions) if (item.kind !== "remove-legacy" && item.content !== null) files.set(item.path, item.content);
  for (const [relative, content] of files) { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { encoding: "utf8", flag: "wx" }); }
  return { root, snapshot: await fileSnapshot(root) };
}
function evidenceDigest(value: Omit<HarnessSmokeReport, "evidenceToken">): string { return hash(JSON.stringify(value)); }

export async function testHarness(plan: HarnessPlan, options: { readonly live?: boolean; readonly timeoutMs?: number; readonly runner?: SmokeRun; readonly adapter?: PlatformAdapter } = {}): Promise<HarnessSmokeReport> {
  if (plan.blocked) throw new Error(`Harness plan is blocked: ${plan.blockers.join("; ")}`);
  const canonical = await readFile(path.join(plan.project, plan.canonicalPath), "utf8"); if (hash(canonical) !== plan.canonicalSha256) throw new Error("Harness plan is stale: canonical instructions changed.");
  const expectedFacts = policyFacts(plan.canonicalPath, canonical); const expectedPolicyFingerprint = fingerprint(expectedFacts); const adapter = options.adapter ?? new NodePlatformAdapter(); const run = options.runner ?? adapter.run.bind(adapter); const results: HarnessSmokeResult[] = [];
  const workspace = options.live ? await prepareSmokeWorkspace(plan, canonical) : null;
  try { for (const agent of plan.selectedAgents) {
    const contract = RUNNERS[agent]; if (!contract) { results.push(result(agent, "unsupported", null, null, null, "No fail-closed read-only smoke runner is registered.", 0)); continue; }
    const availability = await commandAvailable(contract.executable, run); if (!availability.available) { results.push(result(agent, "unavailable", contract.executable, null, null, "Runner command is not installed or not visible on PATH.", 0)); continue; }
    if (!options.live) { results.push(result(agent, "not-run", contract.executable, availability.version, null, `Ready for explicit live execution: ${contract.safety}.`, 0)); continue; }
    const started = Date.now(); const testRoot = workspace?.root ?? plan.project; const invocation = await run({ executable: contract.executable, args: contract.args(testRoot, prompt(agent)), cwd: testRoot, timeoutMs: options.timeoutMs ?? 120_000 }); const durationMs = Date.now() - started;
    await assertCanonicalUnchanged(plan); if (workspace && JSON.stringify(await fileSnapshot(workspace.root)) !== JSON.stringify(workspace.snapshot)) throw new Error("Harness smoke test detected a write in the disposable workspace."); const candidate = parseCandidate(`${invocation.stdout}\n${invocation.stderr}`);
    if (invocation.status !== 0) { results.push(result(agent, "failed", contract.executable, availability.version, null, `Runner exited ${invocation.status}${invocation.timedOut ? " after timeout" : ""}.`, durationMs)); continue; }
    if (!candidate) { results.push(result(agent, "failed", contract.executable, availability.version, null, "Runner did not return the required structured marker.", durationMs)); continue; }
    const facts = { canonicalPath: String(candidate.canonicalPath ?? ""), firstHeading: String(candidate.firstHeading ?? ""), finalInstructionLine: String(candidate.finalInstructionLine ?? "") }; const observed = fingerprint(facts);
    const valid = candidate.agent === agent && candidate.writeAttempted === false && observed === expectedPolicyFingerprint;
    results.push(result(agent, valid ? "passed" : "failed", contract.executable, availability.version, observed, valid ? "Fresh session returned the expected canonical policy facts without a write attempt." : "Fresh session policy facts or safety declaration did not match.", durationMs));
  } } finally { if (workspace) await rm(workspace.root, { recursive: true, force: true }); }
  await assertCanonicalUnchanged(plan); const ready = results.length > 0 && results.every((item) => item.state === "not-run" || item.state === "passed"); const consistent = results.length > 0 && results.every((item) => item.state === "passed" && item.policyFingerprint === expectedPolicyFingerprint); const base: Omit<HarnessSmokeReport, "evidenceToken"> = { schemaVersion: 1, project: plan.project, approvalToken: plan.approvalToken, selectedAgents: plan.selectedAgents, live: options.live ?? false, expectedPolicyFingerprint, results, ready, consistent, passed: Boolean(options.live) && consistent };
  return { ...base, evidenceToken: evidenceDigest(base) };
}

export async function writeHarnessEvidence(report: HarnessSmokeReport, outputInput: string): Promise<string> {
  const project = await realpath(report.project); const output = path.resolve(outputInput); if (contained(project, output)) throw new Error("Harness smoke evidence must be written outside the target project.");
  if (await lstat(output).then(() => true, () => false)) throw new Error("Harness smoke evidence output already exists.");
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); return output.replaceAll("\\", "/");
}

export function renderHarnessSmoke(report: HarnessSmokeReport): string {
  return `${["AFD project harness smoke test", `Project: ${report.project}`, `Mode: ${report.live ? "live disposable workspace" : "preflight"}`, `Plan: ${report.approvalToken}`, `Expected policy fingerprint: ${report.expectedPolicyFingerprint}`, `Result: ${report.passed ? "PASS" : report.live ? "FAIL" : report.ready ? "READY" : "NOT READY"}`, "", ...report.results.map((item) => `- ${item.agent}: ${item.state}${item.version ? ` (${item.version})` : ""} — ${item.detail}`)].join("\n")}\n`;
}
