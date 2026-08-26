import assert from "node:assert/strict";
import test from "node:test";
import { isManifest } from "../src/manifest.js";

test("aceita o contrato mínimo da versão 1", () => {
  assert.equal(isManifest({ manifestVersion: 1, profile: { source: "profile/base.md" }, catalog: [], targets: [] }), true);
});

test("rejeita versões desconhecidas e estruturas incompletas", () => {
  assert.equal(isManifest({ manifestVersion: 2, catalog: [], targets: [] }), false);
  assert.equal(isManifest({ manifestVersion: 1 }), false);
});
