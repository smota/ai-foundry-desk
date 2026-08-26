import assert from "node:assert/strict";
import test from "node:test";
import { isManifest } from "../src/manifest.js";

test("accepts the minimum version 1 contract", () => {
  assert.equal(isManifest({ manifestVersion: 1, profile: { source: "profile/base.md" }, catalog: [], targets: [] }), true);
});

test("rejects unknown versions and incomplete structures", () => {
  assert.equal(isManifest({ manifestVersion: 2, catalog: [], targets: [] }), false);
  assert.equal(isManifest({ manifestVersion: 1 }), false);
});

test("rejects duplicate ids, unsafe paths, duplicate agents, and unknown entry references", () => {
  const base = { manifestVersion: 1, profile: { source: "profile/base.md" }, catalog: [{ id: "one", kind: "skill", source: "catalog/skills/one" }], targets: [{ agent: "codex", entries: ["one"], profile: true }] };
  assert.equal(isManifest({ ...base, profile: { source: "../private" } }), false);
  assert.equal(isManifest({ ...base, catalog: [...base.catalog, base.catalog[0]] }), false);
  assert.equal(isManifest({ ...base, targets: [...base.targets, base.targets[0]] }), false);
  assert.equal(isManifest({ ...base, targets: [{ agent: "codex", entries: ["missing"], profile: true }] }), false);
  assert.equal(isManifest({ ...base, unexpected: true }), false);
});
