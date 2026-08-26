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
  return candidate.manifestVersion === MANIFEST_VERSION &&
    Boolean(candidate.profile) && Array.isArray(candidate.catalog) && Array.isArray(candidate.targets);
}
