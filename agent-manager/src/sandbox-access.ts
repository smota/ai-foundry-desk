import path from "node:path";
import type { Diagnostic, ExecutionIdentity } from "./doctor.js";
import type { PlatformAdapter } from "./platform.js";

interface SandboxAccessTarget {
  readonly path: string;
  readonly exists: boolean;
  readonly action: "none" | "not-installed" | "grant-read-execute" | "manual-review" | "inspect-from-normal-user-shell";
}
interface SandboxAccessReport {
  readonly schemaVersion: 1;
  readonly state: "healthy" | "drift" | "manual-review";
  readonly targets: readonly SandboxAccessTarget[];
}

function parseReport(value: string): SandboxAccessReport | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<SandboxAccessReport>;
    if (parsed.schemaVersion !== 1 || !["healthy", "drift", "manual-review"].includes(String(parsed.state)) || !Array.isArray(parsed.targets)) return undefined;
    if (parsed.targets.some((target) => !target || typeof target.path !== "string" || typeof target.exists !== "boolean" || !["none", "not-installed", "grant-read-execute", "manual-review", "inspect-from-normal-user-shell"].includes(String(target.action)))) return undefined;
    return parsed as SandboxAccessReport;
  } catch { return undefined; }
}

function targetLabel(value: string): string {
  const leaf = path.win32.basename(value);
  return leaf || "reviewed target";
}

export async function sandboxAccessDiagnostic(productRoot: string, adapter: PlatformAdapter, identity: ExecutionIdentity): Promise<Diagnostic | undefined> {
  if (adapter.id !== "win32") return undefined;
  if (identity.mismatch || identity.context === "sandbox") return {
    status: "INFO",
    id: "sandbox.toolchain-access",
    detail: "Persistent ACL state belongs to the interactive user; effective sandbox command execution is reported separately.",
    remedy: "Run afd doctor from a normal user shell after package updates; do not repair ACLs from the sandbox identity.",
  };
  const script = path.join(productRoot, "scripts", "13-reconcile-sandbox-toolchain-access.ps1");
  const result = await adapter.run({ executable: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", "Plan", "-Json"], timeoutMs: 30_000 });
  const report = parseReport(result.stdout);
  if (!report) return {
    status: "FAIL",
    id: "sandbox.toolchain-access",
    detail: `Sandbox-access inspection did not return its versioned contract (exit ${result.status}).`,
    remedy: "Run afd fix sandbox --dry-run from a normal user shell and review the reported target or policy error.",
  };
  const drift = report.targets.filter((target) => ["grant-read-execute", "manual-review", "inspect-from-normal-user-shell"].includes(target.action));
  const installed = report.targets.filter((target) => target.exists).length;
  if (report.state === "healthy" && result.status === 0) return {
    status: "PASS",
    id: "sandbox.toolchain-access",
    detail: `${installed} installed reviewed targets retain the declared Codex sandbox ReadAndExecute postcondition.`,
    remedy: "No action. Continue using normal package-manager updates and rerun afd doctor afterward.",
  };
  const labels = drift.slice(0, 4).map((target) => targetLabel(target.path)).join(", ");
  return {
    status: "FAIL",
    id: "sandbox.toolchain-access",
    detail: `${drift.length} reviewed target${drift.length === 1 ? "" : "s"} require reconciliation${labels ? `: ${labels}` : ""}.`,
    remedy: report.state === "manual-review" ? "A non-matching existing ACL requires manual review; automatic repair is refused." : "Run afd fix sandbox --dry-run, review the RX-only plan, then run afd fix sandbox --apply.",
  };
}
