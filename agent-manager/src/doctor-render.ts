import type { Diagnostic, DiagnosticComponent, DiagnosticStatus } from "./doctor.js";
import { diagnosticComponent, doctorComponentOrder } from "./doctor.js";

export type DoctorRenderOptions = {
  readonly color?: boolean;
  readonly tty?: boolean;
};

function uniqueRows<T>(value: readonly T[]): readonly T[] {
  return [...new Set(value)];
}

function colorize(enabled: boolean, sequence: string, value: string): string {
  return enabled ? `${sequence}${value}\x1b[0m` : value;
}

function statusColor(status: DiagnosticStatus): string {
  if (status === "PASS") return "\x1b[32m";
  if (status === "WARN") return "\x1b[33m";
  if (status === "FAIL") return "\x1b[31m";
  return "\x1b[36m";
}

export function supportsColor(options: { readonly tty?: boolean | undefined } = {}): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== "0";
  return Boolean(options.tty ?? process.stdout.isTTY);
}

function componentLabel(component: DiagnosticComponent): string {
  return component[0]!.toUpperCase() + component.slice(1);
}

function normalizeStatus(status: DiagnosticStatus): string {
  return `[${status}]`;
}

export function renderDoctorRows(rows: readonly Diagnostic[], options: DoctorRenderOptions = {}): string {
  const useColor = options.color ?? supportsColor({ tty: options.tty });
  const grouped = new Map<DiagnosticComponent, Diagnostic[]>(
    doctorComponentOrder.map((component) => [component, []]),
  );
  for (const row of rows) {
    const component = diagnosticComponent(row.id);
    grouped.set(component, [...(grouped.get(component) ?? []), row]);
  }

  const lines: string[] = ["AFD doctor", ""]; 
  for (const component of doctorComponentOrder) {
    const componentRows = grouped.get(component);
    if (!componentRows?.length) continue;
    lines.push(`${componentLabel(component)} (${componentRows.length})`);
    for (const row of componentRows) {
      const status = normalizeStatus(row.status);
      const styledStatus = colorize(useColor, statusColor(row.status), status);
      lines.push(`  ${styledStatus} ${row.id}`);
      lines.push(`    Detail: ${row.detail}`);
      if (row.remedy !== "No action.") lines.push(`    Action: ${row.remedy}`);
      lines.push("");
    }
  }

  const fails = rows.filter((row) => row.status === "FAIL");
  const warns = rows.filter((row) => row.status === "WARN");
  const failActions = uniqueRows(fails.map((row) => row.remedy).filter((remedy) => remedy !== "No action."));
  const warnActions = uniqueRows(warns.map((row) => row.remedy).filter((remedy) => remedy !== "No action."));

  lines.push("Summary");
  lines.push(`PASS: ${rows.filter((row) => row.status === "PASS").length}; WARN: ${warns.length}; FAIL: ${fails.length}; INFO: ${rows.filter((row) => row.status === "INFO").length}`);
  if (fails.length > 0) {
    lines.push("Result: Health issues detected. Complete the required steps before continuing.");
    lines.push("Required steps:");
    for (const item of failActions) lines.push(`- ${item}`);
    if (warnActions.length > 0) {
      lines.push("Suggested actions:");
      for (const item of warnActions) lines.push(`- ${item}`);
    }
  } else if (warns.length > 0) {
    lines.push("Result: Environment is usable with pending recommendations.");
    lines.push("Suggested actions:");
    for (const item of warnActions) lines.push(`- ${item}`);
  } else {
    lines.push("Result: Environment ready for normal operation. No blocking errors or required steps.");
  }

  return `${lines.join("\n")}\n`;
}
