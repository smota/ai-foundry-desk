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

export type HarnessPlanActionKind = "create" | "update-managed" | "remove-legacy" | "preserve";
export type HarnessReviewGroup = "canonical" | "adapters" | "legacy-cleanup";

export interface HarnessPlanAction {
  readonly kind: HarnessPlanActionKind;
  readonly group: HarnessReviewGroup;
  readonly agent: HarnessAgentId | null;
  readonly path: string;
  readonly reason: string;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly content: string | null;
}

export interface HarnessPlan {
  readonly policyFiles?: readonly { readonly path: string; readonly content: string; readonly sha256: string }[];
  readonly schemaVersion: 1;
  readonly project: string;
  readonly baseRevision: string | null;
  readonly workspaceFingerprint: string | null;
  readonly canonicalPath: string;
  readonly canonicalSha256: string;
  readonly selectedAgents: readonly HarnessAgentId[];
  readonly removeLegacy: boolean;
  readonly actions: readonly HarnessPlanAction[];
  readonly blocked: boolean;
  readonly blockers: readonly string[];
  readonly approvalToken: string;
}

export interface HarnessMutationReceipt {
  readonly path: string;
  readonly beforeSha256: string | null;
  readonly beforeContentBase64: string | null;
  readonly afterSha256: string | null;
  readonly afterContentBase64: string | null;
}

export interface HarnessApplyReceipt {
  readonly policyDigests?: readonly { readonly path: string; readonly sha256: string }[];
  readonly schemaVersion: 1;
  readonly project: string;
  readonly approvalToken: string;
  readonly evidenceToken: string;
  readonly selectedAgents: readonly HarnessAgentId[];
  readonly canonicalPath: string;
  readonly canonicalSha256: string;
  readonly baseRevision: string | null;
  readonly beforeWorkspaceFingerprint: string | null;
  readonly afterWorkspaceFingerprint: string | null;
  readonly appliedAt: string;
  readonly mutations: readonly HarnessMutationReceipt[];
  readonly createdDirectories: readonly string[];
  readonly receiptToken: string;
}

export interface HarnessApplyResult {
  readonly schemaVersion: 1;
  readonly status: "applied" | "unchanged";
  readonly project: string;
  readonly approvalToken: string;
  readonly receiptPath: string;
  readonly changed: readonly string[];
}

export interface HarnessVerifyReport {
  readonly schemaVersion: 1;
  readonly project: string;
  readonly approvalToken: string;
  readonly receiptPath: string;
  readonly valid: boolean;
  readonly checks: readonly { readonly path: string; readonly valid: boolean; readonly detail: string }[];
}

export interface HarnessRollbackResult {
  readonly schemaVersion: 1;
  readonly status: "rolled-back";
  readonly project: string;
  readonly approvalToken: string;
  readonly rollbackReceiptPath: string;
  readonly restored: readonly string[];
}

export interface HarnessStageResult {
  readonly schemaVersion: 1;
  readonly project: string;
  readonly output: string;
  readonly approvalToken: string;
  readonly status: "created" | "unchanged";
  readonly rendered: readonly string[];
  readonly removals: readonly string[];
}

export type HarnessSmokeState = "passed" | "failed" | "unavailable" | "unsupported" | "not-run";

export interface HarnessSmokeResult {
  readonly agent: HarnessAgentId;
  readonly state: HarnessSmokeState;
  readonly command: string | null;
  readonly version: string | null;
  readonly policyFingerprint: string | null;
  readonly detail: string;
  readonly durationMs: number;
}

export interface HarnessSmokeReport {
  readonly runtimeBinding?: { readonly observedAt: string; readonly context: string; readonly contractDigest: string };
  readonly schemaVersion: 1;
  readonly project: string;
  readonly approvalToken: string;
  readonly selectedAgents: readonly HarnessAgentId[];
  readonly live: boolean;
  readonly expectedPolicyFingerprint: string;
  readonly results: readonly HarnessSmokeResult[];
  readonly ready: boolean;
  readonly consistent: boolean;
  readonly passed: boolean;
  readonly evidenceToken: string;
  readonly executionContext?: string;
}
