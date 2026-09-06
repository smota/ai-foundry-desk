import type { DiagnosticStatus } from "./doctor.js";

export type HumanStatus = DiagnosticStatus | "READY" | "BLOCKED" | "CHANGED" | "UNCHANGED";

export type ChangeRow = {
  readonly kind: string;
  readonly agent: string;
  readonly path: string;
  readonly detail: string;
};

function colorize(enabled: boolean, code: string, value: string): string {
  return enabled ? `${code}${value}\x1b[0m` : value;
}

function statusColor(status: HumanStatus): string {
  if (status === "PASS" || status === "READY" || status === "CHANGED") return "\x1b[32m";
  if (status === "WARN") return "\x1b[33m";
  if (status === "FAIL" || status === "BLOCKED") return "\x1b[31m";
  return "\x1b[36m";
}

export function supportsColor(options: { readonly tty?: boolean | undefined } = {}): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== "0";
  return Boolean(options.tty ?? process.stdout.isTTY);
}

export function renderStatus(status: HumanStatus, options: { readonly color?: boolean; readonly tty?: boolean } = {}): string {
  const color = options.color ?? supportsColor({ tty: options.tty });
  const label = `[${status}]`;
  return colorize(color, statusColor(status), label);
}

export function renderKeyValue(label: string, value: string): string {
  return `  ${label}: ${value}`;
}

export function renderChanges(rows: readonly ChangeRow[], options: { readonly color?: boolean; readonly tty?: boolean } = {}): string {
  const lines = ["AFD changes", ""];
  if (!rows.length) {
    lines.push("Result: No managed changes detected.");
    return `${lines.join("\n")}\n`;
  }
  for (const row of rows) {
    const status = row.kind.toUpperCase() as HumanStatus;
    lines.push(`${renderStatus(status, options)} ${row.agent}`);
    lines.push(renderKeyValue("Path", row.path));
    lines.push(renderKeyValue("Detail", row.detail));
    lines.push("");
  }
  lines.push(`Summary: ${rows.length} change(s).`);
  lines.push(`Result: ${rows.some((row) => row.kind.toLowerCase() === "drift") ? "Review required before synchronization." : "Managed state is ready for the selected operation."}`);
  return `${lines.join("\n")}\n`;
}

export function renderItems(title: string, items: readonly string[], empty = "None"): string {
  return `${[title, "", ...(items.length ? items.map((item) => `- ${item}`) : [`- ${empty}`]), ""].join("\n")}`;
}

export function renderResult(title: string, status: HumanStatus, summary: string, details: readonly string[] = [], actions: readonly string[] = []): string {
  const lines = [title, "", `${renderStatus(status)} ${summary}`];
  if (details.length) lines.push("", "Details:", ...details.map((item) => `- ${item}`));
  if (actions.length) lines.push("", "Next steps:", ...actions.map((item) => `- ${item}`));
  return `${lines.join("\n")}\n`;
}
