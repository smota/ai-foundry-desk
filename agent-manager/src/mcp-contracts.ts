import type { AgentId } from "./contracts.js";

export const MCP_SCHEMA_VERSION = 1 as const;
export type McpScope = "user" | "project";
export type McpTransport = "stdio" | "http";
export type McpScopeCapability = "native" | "extension" | "unsupported" | "unverified";

export interface McpValueLiteral { readonly literal: string }
export interface McpValueEnvironment { readonly fromEnv: string }
export type McpValue = McpValueLiteral | McpValueEnvironment;

export interface McpStdioServer {
  readonly transport: "stdio";
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly environment?: Readonly<Record<string, McpValue>>;
  readonly enabled: boolean;
  readonly targets: readonly AgentId[];
}

export interface McpHttpServer {
  readonly transport: "http";
  readonly url: string;
  readonly headers?: Readonly<Record<string, McpValue>>;
  readonly enabled: boolean;
  readonly targets: readonly AgentId[];
}

export type McpServer = McpStdioServer | McpHttpServer;
export interface McpOverride { readonly inherits: "user"; readonly enabled: boolean }
export type McpRegistryEntry = McpServer | McpOverride;

export interface McpRegistry {
  readonly schemaVersion: typeof MCP_SCHEMA_VERSION;
  readonly servers: Readonly<Record<string, McpRegistryEntry>>;
}

export interface McpAdapterCapability {
  readonly user: McpScopeCapability;
  readonly project: McpScopeCapability;
  readonly transports: readonly McpTransport[];
  readonly canPersistDisabled: boolean;
  readonly activation: "live" | "restart" | "next-session";
  readonly detail?: string;
}

export interface McpNativeEntry {
  readonly agent: AgentId;
  readonly scope: McpScope;
  readonly id: string;
  readonly path: string;
  readonly server: McpServer;
}

export type McpActionKind = "create" | "update" | "remove" | "in-sync" | "blocked";
export interface McpFileAction {
  readonly agent: AgentId | "canonical";
  readonly scope: McpScope;
  readonly kind: McpActionKind;
  readonly path: string;
  readonly serverId?: string;
  readonly detail: string;
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly afterContent?: string | null;
}

export type McpPlanKind = "sync" | "adopt" | "enable" | "disable" | "move";
export interface McpPlan {
  readonly schemaVersion: 1;
  readonly kind: McpPlanKind;
  readonly scope: McpScope | "effective";
  readonly project: string | null;
  readonly serverId: string | null;
  readonly actions: readonly McpFileAction[];
  readonly blocked: boolean;
  readonly blockers: readonly string[];
  readonly approvalToken: string;
  readonly desiredUser: McpRegistry;
  readonly desiredProject: McpRegistry | null;
}

export interface McpApplyResult {
  readonly schemaVersion: 1;
  readonly status: "applied" | "unchanged";
  readonly kind: McpPlanKind;
  readonly approvalToken: string;
  readonly changed: readonly string[];
  readonly attention: readonly string[];
}

export interface McpManagerOptions {
  readonly home?: string;
  readonly afdRoot?: string;
  readonly backupRoot?: string;
  readonly project?: string;
  readonly targets?: readonly AgentId[];
  readonly enablePiAdapter?: boolean;
}

export const mcpCapabilities: Readonly<Record<AgentId, McpAdapterCapability>> = {
  "claude-code": { user: "native", project: "native", transports: ["stdio", "http"], canPersistDisabled: true, activation: "next-session" },
  codex: { user: "native", project: "native", transports: ["stdio", "http"], canPersistDisabled: true, activation: "restart" },
  antigravity: { user: "native", project: "native", transports: ["stdio", "http"], canPersistDisabled: true, activation: "restart", detail: "Official Antigravity mcp_config.json contract; fixture-tested because agy is not installed on this host." },
  pi: { user: "extension", project: "extension", transports: ["stdio", "http"], canPersistDisabled: true, activation: "restart", detail: "Requires explicit declaration of pinned pi-mcp-adapter 2.31.0; Pi core has no MCP client." },
  hermes: { user: "native", project: "unsupported", transports: ["stdio", "http"], canPersistDisabled: true, activation: "live", detail: "Hermes currently loads MCP servers from its user-global config; no released native project-local registry can enforce non-leak isolation." },
  grok: { user: "native", project: "native", transports: ["stdio", "http"], canPersistDisabled: true, activation: "restart" },
};

export function isMcpOverride(value: McpRegistryEntry): value is McpOverride { return "inherits" in value; }
