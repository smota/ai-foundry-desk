export type HarnessAgentId =
  | "codex"
  | "claude-code"
  | "pi"
  | "agy"
  | "antigravity"
  | "gemini"
  | "copilot"
  | "cursor"
  | "windsurf"
  | "hermes"
  | "grok";

export type HarnessDiscoveryState = "verified" | "configured" | "generated-only" | "unsupported";
export type HarnessInstructionState = "canonical" | "pointer" | "distinct" | "missing" | "unsafe";
export type HarnessFindingSeverity = "blocker" | "warning" | "info";

export interface HarnessTargetContract {
  readonly id: HarnessAgentId;
  readonly displayName: string;
  readonly command: string;
  readonly instructionPaths: readonly string[];
  readonly evidencePaths: readonly string[];
  readonly discovery: HarnessDiscoveryState;
  readonly note: string;
}

export interface HarnessInstructionFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly lines: number;
  readonly state: HarnessInstructionState;
  readonly canonicalReference: boolean;
  readonly duplicateLineRatio: number;
}

export interface HarnessAgentAudit {
  readonly id: HarnessAgentId;
  readonly displayName: string;
  readonly command: string;
  readonly detected: boolean;
  readonly discovery: HarnessDiscoveryState;
  readonly instruction: HarnessInstructionFile | null;
  readonly note: string;
}

export interface HarnessFinding {
  readonly severity: HarnessFindingSeverity;
  readonly code: string;
  readonly path: string | null;
  readonly message: string;
  readonly recommendation: string;
}

export interface HarnessAuditReport {
  readonly schemaVersion: 1;
  readonly project: string;
  readonly canonical: HarnessInstructionFile | null;
  readonly agents: readonly HarnessAgentAudit[];
  readonly findings: readonly HarnessFinding[];
  readonly summary: {
    readonly blockers: number;
    readonly warnings: number;
    readonly info: number;
    readonly detectedAgents: number;
    readonly duplicateInstructionBytes: number;
  };
}
