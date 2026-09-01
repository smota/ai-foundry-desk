#!/usr/bin/env node
import process from "node:process";
import { runAfdCommand } from "./command-service.js";

async function main(args: readonly string[]): Promise<number> {
  if (args[0] === "tui") {
    if (args.length !== 1) throw new Error("Usage: afd tui");
    const { runTui } = await import("./tui/app.js");
    return runTui();
  }
  return runAfdCommand(args);
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
