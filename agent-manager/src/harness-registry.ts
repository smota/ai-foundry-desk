import type { HarnessAgentId, HarnessTargetContract } from "./harness-contracts.js";

// Project discovery is intentionally separate from the user-level Agent Manager catalog.
// "generated-only" means AFD can recognize the surface but must not claim product discovery.
export const harnessTargets: readonly HarnessTargetContract[] = [
  {
    id: "codex",
    displayName: "Codex",
    command: "codex",
    instructionPaths: ["AGENTS.override.md", "AGENTS.md"],
    evidencePaths: [".codex"],
    discovery: "verified",
    note: "Codex natively discovers AGENTS.md; CODEX.md is not required unless configured as a fallback.",
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    command: "claude",
    instructionPaths: ["CLAUDE.md"],
    evidencePaths: [".claude"],
    discovery: "configured",
    note: "CLAUDE.md is treated as a project adapter; product-level discovery must be smoke tested.",
  },
  {
    id: "pi",
    displayName: "Pi",
    command: "pi",
    instructionPaths: ["PI.md"],
    evidencePaths: [".pi"],
    discovery: "configured",
    note: "PI.md is a recognized adapter surface; product-level discovery must be smoke tested.",
  },
  {
    id: "agy",
    displayName: "Agy",
    command: "agy",
    instructionPaths: ["AGY.md"],
    evidencePaths: [".agy"],
    discovery: "generated-only",
    note: "Agy is a distinct runtime identity. AGY.md presence alone is not discovery evidence.",
  },
  {
    id: "antigravity",
    displayName: "Antigravity",
    command: "agy",
    instructionPaths: ["ANTIGRAVITY.md", "GEMINI.md"],
    evidencePaths: [".antigravity", ".gemini"],
    discovery: "generated-only",
    note: "Antigravity is distinct from Agy even when an installed launcher is named agy.",
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    command: "gemini",
    instructionPaths: ["GEMINI.md"],
    evidencePaths: [".gemini"],
    discovery: "configured",
    note: "GEMINI.md is a recognized adapter surface; product-level discovery must be smoke tested.",
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    command: "",
    instructionPaths: [".github/copilot-instructions.md", "GITHUB_COPILOT.md"],
    evidencePaths: [".github"],
    discovery: "configured",
    note: "The repository instruction path is recognized; repository settings remain external.",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    command: "cursor",
    instructionPaths: [".cursor/rules/project.mdc", ".cursorrules"],
    evidencePaths: [".cursor"],
    discovery: "configured",
    note: "Project rule discovery must be smoke tested against the installed product version.",
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    command: "windsurf",
    instructionPaths: [".windsurfrules"],
    evidencePaths: [".windsurf"],
    discovery: "configured",
    note: "Project rule discovery must be smoke tested against the installed product version.",
  },
  {
    id: "hermes",
    displayName: "Hermes Agent",
    command: "hermes",
    instructionPaths: [],
    evidencePaths: [".hermes"],
    discovery: "unsupported",
    note: "No project instruction discovery contract is asserted.",
  },
  {
    id: "grok",
    displayName: "Grok Build",
    command: "grok",
    instructionPaths: [],
    evidencePaths: [".grok"],
    discovery: "unsupported",
    note: "No project instruction discovery contract is asserted.",
  },
];

export function harnessTarget(id: HarnessAgentId): HarnessTargetContract {
  const target = harnessTargets.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown harness target: ${id}`);
  return target;
}
