import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileExists as exists } from "./platform.js";
import path from "node:path";
import { homedir, platform } from "node:os";

export interface MigrationResult { readonly actions: readonly string[]; readonly applied: boolean }
function localRoot(): string { return platform() === "win32" ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "AI Foundry Desk") : path.join(process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state"), "ai-foundry-desk"); }
async function move(actions: string[], from: string, to: string, apply: boolean): Promise<void> {
  if (!await exists(from)) return;
  if (await exists(to)) throw new Error("Migration conflict: both legacy and current roots exist: " + from + " | " + to);
  actions.push("MOVE\t" + from + "\t" + to); if (apply) await rename(from, to);
}
async function renameSkill(actions: string[], root: string, apply: boolean): Promise<void> {
  const oldPath = path.join(root, "ai-workstation-principles"); const newPath = path.join(root, "afd-workbench-principles");
  if (!await exists(oldPath)) return;
  if (await exists(newPath)) throw new Error("Skill migration conflict: " + oldPath + " | " + newPath);
  actions.push("MOVE\t" + oldPath + "\t" + newPath); if (apply) await rename(oldPath, newPath);
}
export async function migrateLegacyState(apply: boolean): Promise<MigrationResult> {
  const home = homedir(); const current = path.join(home, ".afd"); const local = localRoot(); const actions: string[] = [];
  await move(actions, path.join(home, ".ai-workstation"), current, apply);
  const oldLocal = platform() === "win32" ? path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ai-workstation") : path.join(home, ".local", "share", "ai-workstation");
  await move(actions, oldLocal, local, apply);
  for (const root of [path.join(current, "catalog", "skills"), path.join(home, ".agents", "skills"), path.join(home, ".claude", "skills")]) await renameSkill(actions, root, apply);
  const manifest = path.join(current, "manifest.json");
  if (await exists(manifest)) { const oldText = await readFile(manifest, "utf8"); const next = oldText.replaceAll("ai-workstation-principles", "afd-workbench-principles"); if (next !== oldText) { actions.push("UPDATE\t" + manifest); if (apply) await writeFile(manifest, next, "utf8"); } }
  if (apply) { await mkdir(local, { recursive: true }); await writeFile(path.join(local, "migration.json"), JSON.stringify({ schemaVersion: 1, migratedAt: new Date().toISOString(), configRoot: "~/.afd", localRoot: local }, null, 2) + "\n", "utf8"); }
  return { actions, applied: apply };
}
