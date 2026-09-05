#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const excluded = new Set([".git", "node_modules", "dist", ".test-dist", "output"]);
const markdown = [];

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    if (excluded.has(entry)) continue;
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) visit(absolute);
    else if (entry.endsWith(".md")) markdown.push(absolute);
  }
}

visit(root);
const failures = [];
const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

for (const file of markdown) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    target = decodeURIComponent(target.split("#", 1)[0]);
    const resolved = path.resolve(path.dirname(file), target);
    if (!existsSync(resolved)) failures.push(`${path.relative(root, file)} -> ${target}`);
  }
}

const cliReference = readFileSync(path.join(root, "docs", "CLI.md"), "utf8");
const requiredCliSyntax = [
  "afd help", "afd --version", "afd init", "afd provenance", "afd catalog", "afd doctor",
  "afd layer1", "afd layer2", "afd fix layer1", "afd fix sandbox", "afd verify", "afd status",
  "afd review", "afd sync", "afd adopt", "afd import", "afd pending", "afd promote", "afd reject",
  "afd recover", "afd hermes update", "afd layer3 recipes", "afd layer3 show", "afd layer3 plan",
  "afd layer3 apply", "afd layer3 verify", "afd layer3 rollback", "afd layer3 extract",
  "afd telemetry plan", "afd telemetry apply", "afd telemetry status", "afd telemetry verify",
  "afd telemetry explain", "afd telemetry refresh", "afd telemetry trace", "afd telemetry stop",
  "afd telemetry resume", "afd telemetry uninstall-autostart", "afd telemetry broker",
  "afd harness audit", "afd harness plan", "afd harness stage", "afd harness test",
  "afd harness apply", "afd harness verify", "afd harness rollback", "afd backup status",
  "afd backup maintain", "afd migrate", "afd mcp status", "afd mcp verify", "afd mcp discover",
  "afd mcp sync", "afd mcp adopt", "afd mcp enable", "afd mcp disable", "afd mcp move", "afd tui",
];
for (const syntax of requiredCliSyntax) {
  if (!cliReference.includes(syntax)) failures.push(`docs/CLI.md is missing: ${syntax}`);
}

if (failures.length) {
  console.error("Broken local documentation links:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation OK (${markdown.length} Markdown files and ${requiredCliSyntax.length} CLI entries checked).`);
}
