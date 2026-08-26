import type { AgentTarget } from "./contracts.js";
export const agentTargets: readonly AgentTarget[] = [
  { id: "claude-code", displayName: "Claude Code", command: "claude", skills: "supported", profile: "supported" },
  { id: "codex", displayName: "Codex CLI", command: "codex", skills: "supported", profile: "supported" },
  { id: "antigravity", displayName: "Antigravity CLI", command: "agy", skills: "deferred", profile: "deferred", reason: "Diretório global sem contrato oficial estável confirmado." },
  { id: "pi", displayName: "Pi", command: "pi", skills: "supported", profile: "supported" },
  { id: "hermes", displayName: "Hermes Agent", command: "hermes", skills: "supported", profile: "deferred", reason: "Skills espelhadas; perfil nativo preservado." },
  { id: "grok", displayName: "Grok Build", command: "grok", skills: "supported", profile: "deferred", reason: "Skills globais suportadas; perfil global preservado." }
];
