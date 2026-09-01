import { runAfdCommand } from "./command-service.js";

export type CommandEvent = { readonly stream: "stdout" | "stderr"; readonly text: string };
export type CommandOutcome = "passed" | "action-needed" | "error";
export interface CommandExecution {
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly outcome: CommandOutcome;
  readonly events: readonly CommandEvent[];
  readonly startedAt: string;
  readonly endedAt: string;
}

export async function executeAfdUseCase(args: readonly string[]): Promise<CommandExecution> {
  const events: CommandEvent[] = [];
  const startedAt = new Date().toISOString();
  let exitCode = 1;
  try {
    exitCode = await runAfdCommand(args, {
      stdout: (text) => events.push({ stream: "stdout", text }),
      stderr: (text) => events.push({ stream: "stderr", text }),
    });
  } catch (error: unknown) {
    events.push({ stream: "stderr", text: `${error instanceof Error ? error.message : String(error)}\n` });
  }
  return {
    args: [...args],
    exitCode,
    outcome: exitCode === 0 ? "passed" : exitCode === 2 ? "action-needed" : "error",
    events,
    startedAt,
    endedAt: new Date().toISOString(),
  };
}

/** Parse an editable command field into argv without invoking a shell. */
export function parseCommandField(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === "\\" && quote === '"' && index + 1 < value.length && ["\\", '"'].includes(value[index + 1]!)) current += value[++index]!;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (/\s/.test(char)) { if (current) { result.push(current); current = ""; } continue; }
    current += char;
  }
  if (quote) throw new Error("Close the quoted value before running this action.");
  if (current) result.push(current);
  if (result[0] === "afd") result.shift();
  if (!result.length) throw new Error("Enter an AFD command.");
  return result;
}

export function hasUnresolvedInput(args: readonly string[]): boolean {
  return args.some((arg) => /<[^>]+>/.test(arg));
}

/** Conservative safety classification for an edited command field. Unknown commands require review. */
export function commandMayWrite(args: readonly string[]): boolean {
  if (args.includes("--dry-run")) return false;
  const [command, sub] = args;
  if (!command) return true;
  if (["help", "--help", "-h", "--version", "-v", "init", "doctor", "provenance", "catalog", "status", "review", "verify", "pending"].includes(command)) return false;
  if (["layer1", "layer2", "fix", "migrate"].includes(command)) return args.includes("--apply");
  if (command === "backup") return sub !== "status";
  if (command === "sync") return true;
  if (["adopt", "import", "promote", "reject", "recover", "hermes"].includes(command)) return true;
  if (command === "mcp") return !["status", "verify", "discover"].includes(sub ?? "status");
  if (command === "layer3") {
    if (["recipes", "show", "plan", "verify"].includes(sub ?? "")) return false;
    if (sub === "extract") return args.includes("--include");
    return true;
  }
  if (command === "telemetry") return !["plan", "status", "verify", "explain"].includes(sub ?? "status");
  if (command === "harness") {
    if (["audit", "plan", "verify"].includes(sub ?? "")) return false;
    if (sub === "test") return args.includes("--evidence");
    return true;
  }
  return true;
}
