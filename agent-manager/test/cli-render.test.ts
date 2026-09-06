import assert from "node:assert/strict";
import test from "node:test";
import { renderChanges, renderItems, renderResult } from "../src/cli-render.js";

test("renderChanges uses readable blocks instead of tabular output", () => {
  const output = renderChanges([{ kind: "update", agent: "codex", path: "C:/work/AGENTS.md", detail: "reconcile managed policy" }], { color: false });
  assert.match(output, /AFD changes/);
  assert.match(output, /\[UPDATE\] codex/);
  assert.match(output, /Path: C:\/work\/AGENTS\.md/);
  assert.doesNotMatch(output, /\t/);
  assert.match(output, /Result:/);
});

test("renderResult exposes status, details, and next steps", () => {
  const output = renderResult("AFD backup status", "WARN", "Retention review needed.", ["target: 2 violations"], ["Run afd backup maintain --dry-run."]);
  assert.match(output, /\[WARN\]/);
  assert.match(output, /Details:/);
  assert.match(output, /Next steps:/);
});

test("renderItems handles empty collections explicitly", () => {
  assert.match(renderItems("AFD pending skills", [], "No skills are awaiting review."), /No skills are awaiting review\./);
});
