import type { AgentTarget } from "./contracts.js";
export const agentTargets: readonly AgentTarget[] = [
  { id: "claude-code", displayName: "Claude Code", command: "claude", skills: "supported", profile: "supported" },
  { id: "codex", displayName: "Codex CLI", command: "codex", skills: "supported", profile: "supported" },
  { id: "antigravity", displayName: "Antigravity CLI", command: "agy", skills: "deferred", profile: "deferred", reason: "No stable official global directory contract has been confirmed." },
  { id: "pi", displayName: "Pi", command: "pi", skills: "supported", profile: "supported" },
  { id: "hermes", displayName: "Hermes Agent", command: "hermes", skills: "supported", profile: "deferred", reason: "Skills are mirrored; the native profile is preserved." },
  { id: "grok", displayName: "Grok Build", command: "grok", skills: "supported", profile: "deferred", reason: "Global skills are supported; the global profile is preserved." }
];
