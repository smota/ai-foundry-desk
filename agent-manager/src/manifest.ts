import { readFile } from "node:fs/promises";
import { MANIFEST_VERSION, type AgentManifest } from "./contracts.js";

export async function loadManifest(path: string): Promise<AgentManifest> {
  const parsed: unknown = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
  if (!isManifest(parsed)) throw new Error(`Invalid or incompatible manifest: ${path}`);
  return parsed;
}

export function isManifest(value: unknown): value is AgentManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (!only(candidate,["manifestVersion","profile","catalog","targets"])) return false;
  if (candidate.manifestVersion !== MANIFEST_VERSION || !plain(candidate.profile) || !Array.isArray(candidate.catalog) || !Array.isArray(candidate.targets)) return false;
  const profile = candidate.profile as Record<string, unknown>;
  if (!only(profile,["source"]) || !safeRelative(profile.source)) return false;
  const ids = new Set<string>();
  for (const raw of candidate.catalog) {
    if (!plain(raw)) return false; const item = raw as Record<string, unknown>;
    if (!only(item,["id","kind","source","revision","promotedBy"]) || !validId(item.id) || item.kind !== "skill" || !safeRelative(item.source) || ids.has(item.id as string)) return false;
    ids.add(item.id as string);
  }
  const agents = new Set<string>();
  const allowed = new Set(["claude-code", "codex", "antigravity", "pi", "hermes", "grok"]);
  for (const raw of candidate.targets) {
    if (!plain(raw)) return false; const item = raw as Record<string, unknown>;
    if (!only(item,["agent","entries","profile"]) || typeof item.agent !== "string" || !allowed.has(item.agent) || agents.has(item.agent) || typeof item.profile !== "boolean" || !Array.isArray(item.entries)) return false;
    if (new Set(item.entries).size !== item.entries.length || item.entries.some((id) => typeof id !== "string" || !ids.has(id))) return false;
    agents.add(item.agent);
  }
  return true;
}

function plain(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function only(value:Record<string,unknown>,keys:readonly string[]):boolean{return Object.keys(value).every(key=>keys.includes(key));}
function validId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value); }
function safeRelative(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) return false;
  const parts = value.split("/"); return !value.startsWith("/") && !/^[a-z]:/i.test(value) && parts.every((part) => part && part !== "." && part !== "..");
}
