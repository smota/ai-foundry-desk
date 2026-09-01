import assert from "node:assert/strict";
import test from "node:test";
import { renderToScreen } from "@profullstack/hqtui";
import { commandMayWrite, executeAfdUseCase, hasUnresolvedInput, parseCommandField } from "../src/application-service.js";
import { capabilitiesFor, capabilityRegistry, tuiCategories } from "../src/capability-registry.js";
import { createTuiState, selectCategory, selectCapability } from "../src/tui/state.js";
import { drawAfdTui } from "../src/tui/view.js";

test("capability registry is complete, unique, and categorized", () => {
  assert.ok(capabilityRegistry.length >= 70, `expected complete CLI coverage, found ${capabilityRegistry.length}`);
  assert.equal(new Set(capabilityRegistry.map((item) => item.id)).size, capabilityRegistry.length);
  for (const category of tuiCategories) assert.ok(capabilitiesFor(category).length > 0, `${category} is empty`);
  const commands = capabilityRegistry.map((item) => item.command);
  const searchableCoverage = capabilityRegistry.map((item) => `${item.command} ${item.description}`).join("\n");
  for (const required of [
    "help", "--version", "init", "provenance", "catalog", "doctor", "layer1", "layer2", "fix layer1", "fix sandbox", "verify",
    "status", "review", "sync", "adopt", "import", "pending", "promote", "reject", "recover", "hermes update",
    "layer3 recipes", "layer3 show", "layer3 plan", "layer3 apply", "layer3 verify", "layer3 rollback", "layer3 extract",
    "mcp status", "mcp verify", "mcp discover", "mcp sync", "mcp adopt", "mcp enable", "mcp disable", "mcp move",
    "telemetry plan", "telemetry apply", "telemetry status", "telemetry verify", "telemetry explain", "telemetry refresh", "telemetry trace", "telemetry stop", "telemetry resume", "telemetry uninstall-autostart",
    "harness audit", "harness plan", "harness stage", "harness test", "harness apply", "harness verify", "harness rollback",
    "backup status", "backup maintain", "migrate",
  ]) assert.ok(searchableCoverage.includes(required), `taxonomy does not cover ${required}`);
  for (const required of [
    "doctor", "layer1 --dry-run", "layer2 --apply", "fix sandbox --apply", "backup maintain --apply", "migrate --apply",
    "catalog", "review", "sync", "adopt <agent> <skill>", "promote <agent> <skill> --confirm", "hermes update --apply",
    "mcp status --scope effective", "mcp discover <agent> --scope user", "mcp sync --scope effective --confirm <plan-token>",
    "layer3 recipes", "layer3 apply <source> --confirm <plan-token>", "layer3 rollback <source> --confirm",
    "telemetry status", "telemetry trace --workspace . --agent codex --operation <name>", "telemetry uninstall-autostart",
    "harness audit .", "harness test . --live --evidence <outside-project-file>", "harness rollback . --receipt <file> --confirm <plan-token>",
  ]) assert.ok(commands.includes(required), `missing ${required}`);
  assert.equal(commands.some((command) => command.includes("telemetry broker")), false, "internal broker must not be interactive");
});

test("editable command parser never invokes a shell and preserves quoted paths", () => {
  assert.deepEqual(parseCommandField('afd harness audit "C:\\My Project"'), ["harness", "audit", "C:\\My Project"]);
  assert.deepEqual(parseCommandField("mcp status --scope effective"), ["mcp", "status", "--scope", "effective"]);
  assert.throws(() => parseCommandField('doctor "unfinished'), /Close the quoted value/);
  assert.equal(hasUnresolvedInput(["layer3", "plan", "<source>"]), true);
});

test("edited command safety classifier fails closed", () => {
  assert.equal(commandMayWrite(["doctor"]), false);
  assert.equal(commandMayWrite(["mcp", "sync", "--scope", "user", "--dry-run"]), false);
  assert.equal(commandMayWrite(["mcp", "sync", "--scope", "user", "--confirm", "token"]), true);
  assert.equal(commandMayWrite(["harness", "test", "."]), false);
  assert.equal(commandMayWrite(["harness", "test", ".", "--live", "--evidence", "report.json"]), true);
  assert.equal(commandMayWrite(["unknown-command"]), true);
});

test("typed application service and CLI adapter share command behavior", async () => {
  const result = await executeAfdUseCase(["--version"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.outcome, "passed");
  assert.equal(result.events.map((event) => event.text).join("").trim(), "0.6.1");
});

test("TUI renders real responsive screens at wide, standard, and compact sizes", () => {
  for (const [width, height] of [[120, 40], [100, 30], [80, 24], [70, 22]] as const) {
    const state = createTuiState();
    const screen = renderToScreen((args) => drawAfdTui(args, state), { width, height });
    assert.equal(screen.width, width);
    assert.equal(screen.height, height);
    assert.ok(screen.contains("AI Foundry Desk"));
    assert.ok(screen.contains("Command help"));
    assert.ok(screen.contains("READ ONLY"));
    assert.ok(screen.contains("Search"));
  }
});

test("TUI renders all taxonomy areas, confirmation, output, monochrome, and ASCII", () => {
  const state = createTuiState();
  for (let category = 0; category < tuiCategories.length; category += 1) {
    selectCategory(state, category);
    selectCapability(state, Math.min(1, capabilitiesFor(tuiCategories[category]!).length - 1));
    const screen = renderToScreen((args) => drawAfdTui(args, state), { width: 120, height: 40, theme: "highContrast" });
    assert.ok(screen.contains(tuiCategories[category]!));
    assert.ok(screen.contains("Equivalent CLI"));
  }
  selectCategory(state, 1); selectCapability(state, 1); state.confirm = true;
  const confirm = renderToScreen((args) => drawAfdTui(args, state), { width: 100, height: 30, theme: "monochrome", capabilities: { unicode: false, braille: false, colors: "none" } });
  assert.ok(confirm.contains("Confirm reviewed action"));
  assert.ok(confirm.contains("Enter: Execute"));
  state.confirm = false; state.screen = "output"; state.execution = { args: ["doctor"], exitCode: 2, outcome: "action-needed", events: [{ stream: "stdout", text: "WARN\ttoolbox\tReview required\n" }], startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:01.000Z" };
  const output = renderToScreen((args) => drawAfdTui(args, state), { width: 100, height: 30 });
  assert.ok(output.contains("ACTION-NEEDED"));
  assert.ok(output.contains("Review required"));
});
