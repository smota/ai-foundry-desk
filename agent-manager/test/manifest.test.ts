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
