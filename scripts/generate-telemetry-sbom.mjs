#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recipe = JSON.parse(await readFile(path.join(root, "recipes", "observability.json"), "utf8"));
const capability = recipe.capabilities.find((item) => item.id === "observability");
if (!capability) throw new Error("Observability capability is missing from its recipe.");
const lockNames = ["agentacct", "phoenix"];
const components = new Map();
const lockProperties = [];
const licenses = new Map([["agentacct", "MIT"], ["arize-phoenix", "Elastic-2.0"]]);

for (const lockName of lockNames) {
  const relative = `requirements/pylock.${lockName}.toml`;
  const text = await readFile(path.join(root, relative), "utf8");
  lockProperties.push({ name: `afd:lock:${lockName}:sha256`, value: createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex") });
  for (const block of text.split("[[packages]]").slice(1)) {
    const name = block.match(/^\s*name = "([^"]+)"/m)?.[1];
    const version = block.match(/^\s*version = "([^"]+)"/m)?.[1];
    if (!name || !version) throw new Error(`Invalid package entry in ${relative}.`);
    const key = `${name}@${version}`;
    const existing = components.get(key) ?? { type: "library", name, version, purl: `pkg:pypi/${encodeURIComponent(name)}@${encodeURIComponent(version)}`, ...(licenses.has(name) ? { licenses: [{ expression: licenses.get(name) }] } : {}), properties: [] };
    if (!existing.properties.some((item) => item.value === relative)) existing.properties.push({ name: "afd:dependency-lock", value: relative });
    components.set(key, existing);
  }
}

components.set(`otelcol-contrib@${capability.collector.version}`, {
  type: "application",
  name: "otelcol-contrib",
  version: capability.collector.version,
  purl: `pkg:github/open-telemetry/opentelemetry-collector-releases@v${capability.collector.version}`,
  licenses: [{ expression: "Apache-2.0" }],
  hashes: [{ alg: "SHA-256", content: capability.collector.sha256.toUpperCase() }],
  externalReferences: [{ type: "distribution", url: capability.collector.source }],
  properties: [{ name: "afd:recipe", value: "recipes/observability.json" }],
});

components.set(`cpython@${capability.phoenix.runtime.version}`, {
  type: "platform",
  name: "cpython",
  version: capability.phoenix.runtime.version,
  purl: `pkg:github/astral-sh/python-build-standalone@20260825`,
  licenses: [{ expression: "PSF-2.0" }],
  hashes: [{ alg: "SHA-256", content: capability.phoenix.runtime.sha256.toUpperCase() }],
  externalReferences: [{ type: "distribution", url: capability.phoenix.runtime.source }],
  properties: [{ name: "afd:purpose", value: "isolated Phoenix runtime" }],
});

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: {
    component: { type: "application", name: "ai-foundry-desk-observability", version: recipe.version },
    properties: lockProperties,
  },
  components: [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
};

await writeFile(path.join(root, "requirements", "sbom.telemetry.cdx.json"), JSON.stringify(sbom, null, 2) + "\n", "utf8");
