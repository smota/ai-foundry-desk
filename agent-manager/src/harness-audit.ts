import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  HarnessAgentAudit,
  HarnessAuditReport,
  HarnessFinding,
  HarnessInstructionFile,
  HarnessInstructionState,
  HarnessTargetContract,
} from "./harness-contracts.js";
import { harnessTargets } from "./harness-registry.js";

const CODEX_DEFAULT_INSTRUCTION_BYTES = 32 * 1024;
const COMPATIBILITY_PATHS = ["CODEX.md", "GITHUB_COPILOT.md"] as const;

async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch { return false; }
}

function slash(value: string): string { return value.replaceAll("\\", "/"); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function lines(value: string): readonly string[] {
  return value.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter(Boolean);
}
function duplicateRatio(canonical: string, candidate: string): number {
  const base = new Set(lines(canonical)); const other = lines(candidate);
  if (!other.length) return 0;
  return Number((other.filter((line) => base.has(line)).length / other.length).toFixed(3));
}
function referencesCanonical(value: string, canonical: string): boolean {
  return new RegExp(`(?:^|[\\s(\`])${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s)\`.,])`, "im").test(value);
}
function pointerLike(value: string, canonical: string): boolean {
  const content = lines(value);
  return content.length <= 20 && referencesCanonical(value, canonical) && !/\b(?:never|must not|forbidden|required)\b/i.test(value);
}
function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function inspectInstruction(
  project: string,
  relative: string,
  canonicalPath: string,
  canonicalText: string,
  stateOverride?: HarnessInstructionState,
): Promise<{ readonly file: HarnessInstructionFile; readonly text: string }> {
  const target = path.resolve(project, relative);
  if (!contained(project, target)) throw new Error(`Instruction path escapes project: ${relative}`);
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { file: { path: slash(relative), bytes: 0, sha256: "", lines: 0, state: "unsafe", canonicalReference: false, duplicateLineRatio: 0 }, text: "" };
  }
  const text = await readFile(target, "utf8");
  const canonicalReference = relative !== canonicalPath && referencesCanonical(text, canonicalPath);
  const state = stateOverride ?? (relative === canonicalPath ? "canonical" : pointerLike(text, canonicalPath) ? "pointer" : "distinct");
  return {
    file: {
      path: slash(relative), bytes: Buffer.byteLength(text), sha256: hash(text), lines: text.split(/\r?\n/).length,
      state, canonicalReference, duplicateLineRatio: relative === canonicalPath ? 1 : duplicateRatio(canonicalText, text),
    },
    text,
  };
}

function finding(severity: HarnessFinding["severity"], code: string, pathValue: string | null, message: string, recommendation: string): HarnessFinding {
  return { severity, code, path: pathValue, message, recommendation };
}

async function firstInstruction(project: string, target: HarnessTargetContract): Promise<string | null> {
  for (const relative of target.instructionPaths) if (await exists(path.join(project, relative))) return relative;
  return null;
}

async function agentAudit(project: string, target: HarnessTargetContract, canonicalPath: string, canonicalText: string): Promise<HarnessAgentAudit> {
  const relative = await firstInstruction(project, target);
  const evidence = await Promise.all(target.evidencePaths.map((item) => exists(path.join(project, item))));
  const detected = relative !== null || evidence.some(Boolean) || target.id === "codex";
  const instruction = relative ? (await inspectInstruction(project, relative, canonicalPath, canonicalText)).file : null;
  return { id: target.id, displayName: target.displayName, command: target.command, detected, discovery: target.discovery, instruction, note: target.note };
}

async function readOptionalJson(project: string, relative: string): Promise<Record<string, unknown> | null> {
  const target = path.join(project, relative); if (!(await exists(target))) return null;
  try { const value: unknown = JSON.parse(await readFile(target, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}

export async function auditHarness(projectInput: string): Promise<HarnessAuditReport> {
  const project = await realpath(path.resolve(projectInput)); const findings: HarnessFinding[] = [];
  const canonicalCandidates = ["AGENTS.override.md", "AGENTS.md"];
  let canonicalPath: string | null = null;
  for (const candidate of canonicalCandidates) if (await exists(path.join(project, candidate))) { canonicalPath = candidate; break; }
  let canonical: HarnessInstructionFile | null = null; let canonicalText = "";
  if (!canonicalPath) findings.push(finding("blocker", "canonical.missing", null, "No canonical project instruction file was found.", "Choose one canonical instruction source before generating agent adapters."));
  else {
    const inspected = await inspectInstruction(project, canonicalPath, canonicalPath, "", "canonical"); canonical = inspected.file; canonicalText = inspected.text;
    if (canonical.state === "unsafe") findings.push(finding("blocker", "canonical.unsafe", canonical.path, "The canonical instruction path is not a regular file.", "Replace it only after reviewing the path and ownership."));
    if (canonical.bytes > CODEX_DEFAULT_INSTRUCTION_BYTES) findings.push(finding("warning", "canonical.codex-budget", canonical.path, `Canonical instructions are ${canonical.bytes} bytes, above Codex's default 32768-byte project instruction budget.`, "Move detailed topic guidance behind links or nested instruction files and keep the root router concise."));
  }
  if (await exists(path.join(project, "AGENTS.override.md")) && await exists(path.join(project, "AGENTS.md"))) findings.push(finding("warning", "canonical.override-shadow", "AGENTS.override.md", "AGENTS.override.md shadows AGENTS.md for Codex at the project root.", "Confirm that the override is intentional or consolidate the authoritative root guidance."));

  const agents = await Promise.all(harnessTargets.map((target) => agentAudit(project, target, canonicalPath ?? "AGENTS.md", canonicalText)));
  for (const agent of agents) {
    if (agent.detected && agent.discovery === "generated-only") findings.push(finding("warning", "agent.discovery-unverified", agent.instruction?.path ?? null, `${agent.displayName} has a generated adapter surface but no verified discovery contract.`, "Require a fresh-session smoke test before reporting this agent as activated."));
    if (agent.detected && agent.discovery === "unsupported") findings.push(finding("warning", "agent.discovery-unsupported", agent.instruction?.path ?? null, `${agent.displayName} is detected without a project instruction discovery contract.`, "Provide an explicit runner/discovery adapter or exclude the agent from the target set."));
    if (agent.instruction?.state === "unsafe") findings.push(finding("blocker", "instruction.unsafe", agent.instruction.path, "Instruction adapter is not a regular file.", "Review the path before any harness plan is allowed."));
    if (agent.instruction?.state === "distinct" && agent.instruction.duplicateLineRatio >= 0.35) findings.push(finding("warning", "instruction.duplication", agent.instruction.path, `${Math.round(agent.instruction.duplicateLineRatio * 100)}% of non-empty adapter lines repeat canonical guidance.`, "Keep only genuinely agent-specific behavior in the adapter and route shared policy to the canonical source."));
  }
  for (const relative of COMPATIBILITY_PATHS) if (await exists(path.join(project, relative)) && canonicalPath) {
    const inspected = await inspectInstruction(project, relative, canonicalPath, canonicalText);
    if (inspected.file.state === "pointer") findings.push(finding("info", "legacy.redundant-pointer", relative, `${relative} is a thin compatibility pointer rather than a native canonical source.`, "Retain it only for a proven target that discovers this filename; otherwise include it in a reviewed cleanup plan."));
  }

  const workflow = await readOptionalJson(project, "agent-workflow.config.json");
  const routing = workflow?.routing;
  const defaultMode = routing && typeof routing === "object" && !Array.isArray(routing) ? (routing as Record<string, unknown>).defaultMode : undefined;
  if (defaultMode === "single-agent" && /\bmulti-agent\b/i.test(canonicalText)) findings.push(finding("warning", "routing.mode-conflict", "agent-workflow.config.json", "Machine-readable routing defaults to single-agent while canonical guidance describes multi-agent operation.", "Choose one default and make the documentation, configuration, and acceptance evidence agree."));

  const duplicateInstructionBytes = agents.reduce((total, agent) => total + (agent.instruction && agent.instruction.state !== "canonical" ? Math.round(agent.instruction.bytes * agent.instruction.duplicateLineRatio) : 0), 0);
  return {
    schemaVersion: 1, project: slash(project), canonical, agents, findings,
    summary: {
      blockers: findings.filter((item) => item.severity === "blocker").length,
      warnings: findings.filter((item) => item.severity === "warning").length,
      info: findings.filter((item) => item.severity === "info").length,
      detectedAgents: agents.filter((item) => item.detected).length,
      duplicateInstructionBytes,
    },
  };
}

export function renderHarnessAudit(report: HarnessAuditReport): string {
  const rows = [
    `AFD project harness audit`,
    `Project: ${report.project}`,
    `Canonical: ${report.canonical ? `${report.canonical.path} (${report.canonical.bytes} bytes)` : "missing"}`,
    `Summary: ${report.summary.blockers} blocker(s), ${report.summary.warnings} warning(s), ${report.summary.info} info`,
    "",
    "Agents:",
    ...report.agents.filter((agent) => agent.detected).map((agent) => `- ${agent.displayName}: ${agent.discovery}; ${agent.instruction ? `${agent.instruction.path} (${agent.instruction.state})` : "no instruction adapter"}`),
    "",
    "Findings:",
    ...(report.findings.length ? report.findings.map((item) => `- [${item.severity.toUpperCase()}] ${item.code}${item.path ? ` (${item.path})` : ""}: ${item.message}\n  Recommendation: ${item.recommendation}`) : ["- None"]),
  ];
  return `${rows.join("\n")}\n`;
}
