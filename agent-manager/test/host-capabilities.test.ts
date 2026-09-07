import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesForLayer, capability, versionCompatible } from "../src/host-capabilities.js";

test("host capabilities separate installation pins from compatible user updates", () => {
  assert.equal(versionCompatible("11.23.0", capability("pnpm").compatible), true);
  assert.equal(versionCompatible("pnpm 12.3.4", capability("pnpm").compatible), true);
  assert.equal(versionCompatible("13.0.0", capability("pnpm").compatible), false);
  assert.equal(versionCompatible("uv 0.12.10", capability("uv").compatible), true);
  assert.equal(versionCompatible("rustc 1.99.0", capability("rust").compatible), false);
});

test("Windows and Linux package-manager installs share reviewed package pins", () => {
  for (const id of ["allow-scripts", "pi", "grok"] as const) {
    const item = capability(id);
    assert.equal(item.installers.win32?.kind, "pnpm");
    assert.equal(item.installers.linux?.kind, "pnpm");
    assert.equal(item.installVersion?.length ? true : false, true);
    assert.match(item.installers.win32?.kind === "pnpm" ? item.installers.win32.integrity ?? "" : "", /^sha512-/);
  }
});

test("every required capability declares ownership and a compatible range", () => {
  for (const layer of [1, 2] as const) for (const item of capabilitiesForLayer(layer)) {
    assert.ok(item.ownership);
    assert.ok(item.compatible);
    if (item.required) assert.ok(item.installers.win32 || item.installers.linux || item.installers.darwin);
  }
});
