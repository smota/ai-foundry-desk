import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HostCommand, CommandResult, PlatformAdapter } from "./platform.js";
import { NodePlatformAdapter } from "./platform.js";
import { executionIdentity } from "./doctor.js";
import { harnessTarget } from "./harness-registry.js";
import { assertHarnessPlanCurrent } from "./harness-plan.js";
import { safeProjectFile } from "./project-files.js";
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
  agy: {
    executable: "agy",
    safety: "plan mode, terminal sandbox, bounded print session; workspace writes are checked",
    args: (project, prompt) => ["--add-dir", project, "--mode", "plan", "--sandbox", "--print-timeout", "90s", "--output-format", "text", "--print", prompt],
  },
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
    args: (project, prompt) => ["--single", prompt, "--cwd", project, "--permission-mode", "plan", "--disable-web-search", "--no-subagents", "--output-format", "plain", "--max-turns", "6"],
  },
};

export function hasHarnessSmokeRunner(agent: HarnessAgentId): boolean { return Boolean(RUNNERS[agent]); }
export function harnessRuntimeBinding(): { observedAt: string; context: string; contractDigest: string } {
  const context = hash(JSON.stringify({ platform: process.platform, arch: process.arch, executable: process.execPath, uid: process.getuid?.() ?? null, user: process.env.USERNAME ?? process.env.USER ?? null }));
  const contractDigest = hash(JSON.stringify(Object.entries(RUNNERS).map(([id, runner]) => [id, runner.executable, runner.safety, runner.args.toString()])));
  return { observedAt: new Date().toISOString(), context, contractDigest };
}

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
function fingerprint(value: unknown): string { return hash(JSON.stringify(value)); }
function closureFacts(plan: HarnessPlan, candidate?: Record<string, unknown>): Record<string, string> | undefined {
  if (!plan.policyFiles) return undefined;
  return Object.fromEntries(plan.policyFiles.filter(f => f.path !== plan.canonicalPath && f.path !== ".afd/project.json").map(f => [f.path, candidate ? String(candidate[f.path] ?? "") : f.content]));
}
export async function expectedHarnessFingerprint(plan: HarnessPlan): Promise<string> {
  const canonical = await readFile(path.join(plan.project, plan.canonicalPath), "utf8");
  return fingerprint({ ...policyFacts(plan.canonicalPath, canonical), ...(plan.policyFiles ? { policyFiles: closureFacts(plan) } : {}) });
}
function prompt(agent: HarnessAgentId): string {
  const scope = "This tests instruction discovery only. Read instruction entrypoints and the canonical policy file in this working directory. Do not start the project's development workflow or follow its architecture/documentation links; supporting files may be read only when explicitly requested below.";
  const readTools = scope + (agent === "agy" ? " Use view_file or the automatically loaded project policy. Do not use run_command, terminal tools, or shell commands; they cannot receive permission in this headless test." : " Read-only file tools or shell commands solely to read policy files are allowed.");
  return `This is an AFD read-only harness discovery smoke test. Use automatically discovered project instructions to locate the canonical policy file in this working directory. ${readTools} Do not modify files, execute repository code, use network tools, invoke skills or subagents, or load unrelated content. Return exactly one line beginning ${MARKER} followed by compact JSON with keys agent, canonicalPath, firstHeading, finalInstructionLine, and writeAttempted. Set agent to ${JSON.stringify(agent)}, canonicalPath to the final canonical project policy source (not an adapter that points to it), copy that FILE's entire first level-one heading line exactly INCLUDING its leading # and space (not a heading from merged global instructions), copy its final non-empty non-comment instruction line exactly, and set writeAttempted to false. Prefer a project-relative canonicalPath. The expected path and text values are deliberately not included in this prompt.`;
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
export async function commandAvailable(executable: string, run: SmokeRun, platform = process.platform): Promise<{ readonly available: boolean; readonly version: string | null; readonly detail: string }> {
  const locator = platform === "win32" ? { executable: "where.exe", args: [executable] } : { executable: "which", args: [executable] };
  const located = await run({ ...locator, timeoutMs: 10_000 });
  if (located.timedOut) return { available: false, version: null, detail: "Command lookup timed out in this execution context." };
  if (located.status !== 0) return { available: false, version: null, detail: /access.*denied|permission|eperm|eacces/i.test(located.stderr) ? "Command lookup was denied in this execution context; installation status is unknown." : located.status === 1 && !located.stderr.trim() ? "Command is not on this execution context's PATH; this does not prove it is absent from the host." : "Command lookup failed in this execution context; installation status is unknown." };
  const version = await run({ executable, args: ["--version"], timeoutMs: 15_000 });
  if (version.timedOut) return { available: false, version: null, detail: "Command resolved, but its version probe timed out." };
  if (version.status !== 0) return { available: false, version: null, detail: /access.*denied|permission|eperm|eacces/i.test(version.stderr) ? "Command resolved, but execution was denied." : "Command resolved, but its version probe failed; repair the launcher before live execution." };
  const text = version.stdout.trim();
  if (!text) return { available: false, version: null, detail: "Command resolved, but returned an empty version response." };
  return { available: true, version: text.split(/\r?\n/).at(-1) ?? null, detail: "Version probe passed." };
}
function result(agent: HarnessAgentId, state: HarnessSmokeResult["state"], command: string | null, version: string | null, policyFingerprint: string | null, detail: string, durationMs: number): HarnessSmokeResult {
  return { agent, state, command, version, policyFingerprint, detail, durationMs };
}
async function assertCanonicalUnchanged(plan: HarnessPlan): Promise<void> {
  for (const file of plan.policyFiles ?? []) {
    if (hash(await readFile(path.join(plan.project, file.path), "utf8")) !== file.sha256) throw new Error("Harness smoke test detected supporting policy drift.");
  }
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
  const files = new Map<string, string>([[plan.canonicalPath, canonical]]);
  // A no-op plan still needs the already-installed instruction discovery surfaces.
  for (const relative of new Set(plan.selectedAgents.flatMap(agent => harnessTarget(agent).instructionPaths))) {
    if (files.has(relative)) continue;
    const source = await safeProjectFile(plan.project, relative);
    try { files.set(relative, await readFile(source, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const file of plan.policyFiles ?? []) files.set(file.path, file.content);
  for (const item of plan.actions) {
    if (item.kind === "remove-legacy") files.delete(item.path);
    else if (item.content !== null) files.set(item.path, item.content);
  }
  await assertHarnessPlanCurrent(plan);
  const root = await mkdtemp(path.join(tmpdir(), "afd-harness-smoke-"));
  for (const [relative, content] of files) { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, { encoding: "utf8", flag: "wx" }); }
  return { root, snapshot: await fileSnapshot(root) };
}
function evidenceDigest(value: Omit<HarnessSmokeReport, "evidenceToken">): string { return hash(JSON.stringify(value)); }

export async function testHarness(plan: HarnessPlan, options: { readonly live?: boolean; readonly timeoutMs?: number; readonly runner?: SmokeRun; readonly adapter?: PlatformAdapter } = {}): Promise<HarnessSmokeReport> {
  if (plan.blocked) throw new Error(`Harness plan is blocked: ${plan.blockers.join("; ")}`);
  const canonical = await readFile(path.join(plan.project, plan.canonicalPath), "utf8"); if (hash(canonical) !== plan.canonicalSha256) throw new Error("Harness plan is stale: canonical instructions changed.");
  const expectedFacts = { ...policyFacts(plan.canonicalPath, canonical), ...(plan.policyFiles ? { policyFiles: closureFacts(plan) } : {}) }; const expectedPolicyFingerprint = fingerprint(expectedFacts); const adapter = options.adapter ?? new NodePlatformAdapter(); const run = options.runner ?? adapter.run.bind(adapter); const results: HarnessSmokeResult[] = [];
  const workspace = options.live ? await prepareSmokeWorkspace(plan, canonical) : null;
  try { for (const agent of plan.selectedAgents) {
    const contract = RUNNERS[agent]; if (!contract) { results.push(result(agent, "unsupported", null, null, null, "No fail-closed read-only smoke runner is registered.", 0)); continue; }
    const availability = await commandAvailable(contract.executable, run, adapter.id); if (!availability.available) { results.push(result(agent, "unavailable", contract.executable, null, null, availability.detail, 0)); continue; }
    if (!options.live) { results.push(result(agent, "not-run", contract.executable, availability.version, null, `Ready for explicit live execution: ${contract.safety}.`, 0)); continue; }
    const closurePrompt = plan.policyFiles ? ` Also return policyFiles as an object mapping these required supporting file paths to their exact full UTF-8 contents (preserve newlines): ${JSON.stringify(Object.keys(closureFacts(plan)!))}. Read the files; do not infer their contents.` : "";
    const started = Date.now(); const testRoot = workspace?.root ?? plan.project; const invocation = await run({ executable: contract.executable, args: contract.args(testRoot, prompt(agent) + closurePrompt), cwd: testRoot, timeoutMs: options.timeoutMs ?? 120_000 }); const durationMs = Date.now() - started;
    await assertCanonicalUnchanged(plan); if (workspace && JSON.stringify(await fileSnapshot(workspace.root)) !== JSON.stringify(workspace.snapshot)) throw new Error("Harness smoke test detected a write in the disposable workspace."); const candidate = parseCandidate(`${invocation.stdout}\n${invocation.stderr}`);
    if (invocation.status !== 0) { results.push(result(agent, "failed", contract.executable, availability.version, null, `Runner exited ${invocation.status}${invocation.timedOut ? " after timeout" : ""}.`, durationMs)); continue; }
    if (!candidate) {
      const deniedPermission = invocation.stderr.match(/tool required the "([a-z_]+)" permission/);
      const detail = deniedPermission ? `Headless runner denied ${deniedPermission[1]} permission. Review the specific test workspace permission; do not disable permission checks.` : "Runner did not return the required structured marker.";
      results.push(result(agent, "failed", contract.executable, availability.version, null, detail, durationMs)); continue;
    }
    const reportedPath = String(candidate.canonicalPath ?? "");
    const normalizedPath = reportedPath && path.resolve(testRoot, reportedPath) === path.resolve(testRoot, plan.canonicalPath) ? plan.canonicalPath : reportedPath;
    const facts = { canonicalPath: normalizedPath, firstHeading: String(candidate.firstHeading ?? ""), finalInstructionLine: String(candidate.finalInstructionLine ?? ""), ...(plan.policyFiles ? { policyFiles: closureFacts(plan, (candidate.policyFiles ?? {}) as Record<string, unknown>) } : {}) }; const observed = fingerprint(facts);
    const valid = candidate.agent === agent && candidate.writeAttempted === false && observed === expectedPolicyFingerprint;
    results.push(result(agent, valid ? "passed" : "failed", contract.executable, availability.version, observed, valid ? "Fresh session returned the expected canonical policy facts without a write attempt." : "Fresh session policy facts or safety declaration did not match.", durationMs));
  } } finally { if (workspace) await rm(workspace.root, { recursive: true, force: true }); }
  await assertCanonicalUnchanged(plan); const ready = results.length > 0 && results.every((item) => item.state === "not-run" || item.state === "passed"); const consistent = results.length > 0 && results.every((item) => item.state === "passed" && item.policyFingerprint === expectedPolicyFingerprint); const base: Omit<HarnessSmokeReport, "evidenceToken"> = { schemaVersion: 1, project: plan.project, approvalToken: plan.approvalToken, selectedAgents: plan.selectedAgents, live: options.live ?? false, expectedPolicyFingerprint, results, ready, consistent, passed: Boolean(options.live) && consistent };
  const identity = options.runner ? "injected-test-runner" : (await executionIdentity(adapter)).context;
  const contextual = { ...base, executionContext: identity, ...(plan.policyFiles ? { runtimeBinding: harnessRuntimeBinding() } : {}) };
  return { ...contextual, evidenceToken: evidenceDigest(contextual) };
}

export async function writeHarnessEvidence(report: HarnessSmokeReport, outputInput: string): Promise<string> {
  const project = await realpath(report.project); const output = path.resolve(outputInput); if (contained(project, output)) throw new Error("Harness smoke evidence must be written outside the target project.");
  if (await lstat(output).then(() => true, () => false)) throw new Error("Harness smoke evidence output already exists.");
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); return output.replaceAll("\\", "/");
}

export function renderHarnessSmoke(report: HarnessSmokeReport): string {
  return `${["AFD project harness smoke test", `Project: ${report.project}`, `Mode: ${report.live ? "live disposable workspace" : "preflight"}`, `Plan: ${report.approvalToken}`, `Expected policy fingerprint: ${report.expectedPolicyFingerprint}`, `Result: ${report.passed ? "PASS" : report.live ? "FAIL" : report.ready ? "READY" : "NOT READY"}`, "", ...report.results.map((item) => `- ${item.agent}: ${item.state}${item.version ? ` (${item.version})` : ""} — ${item.detail}`)].join("\n")}\n`;
}
