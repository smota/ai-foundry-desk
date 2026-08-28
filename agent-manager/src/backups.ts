import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { NodePlatformAdapter, type PlatformAdapter } from "./platform.js";

export interface BackupRow { readonly target: string; readonly snapshots: number; readonly bytes: number; readonly retentionViolations: number }
async function bytes(root: string): Promise<number> { let total = 0; for (const entry of await readdir(root, { withFileTypes: true })) { const item = path.join(root, entry.name); if (entry.isDirectory()) total += await bytes(item); else if (entry.isFile()) total += (await stat(item)).size; } return total; }
export function backupRoot(adapter: PlatformAdapter = new NodePlatformAdapter()): string { return path.join(adapter.stateRoot, "backups"); }
export async function backupReport(adapter: PlatformAdapter = new NodePlatformAdapter(), now = Date.now()): Promise<readonly BackupRow[]> {
  const root = backupRoot(adapter); try { await stat(root); } catch { return []; }
  const cutoff = now - 30 * 24 * 60 * 60 * 1_000; const rows: BackupRow[] = [];
  for (const target of await readdir(root, { withFileTypes: true })) { if (!target.isDirectory()) continue; const directory = path.join(root, target.name); const snapshots = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()); const dated = await Promise.all(snapshots.map(async (entry) => ({ name: entry.name, mtime: (await stat(path.join(directory, entry.name))).mtimeMs }))); dated.sort((a, b) => b.mtime - a.mtime); rows.push({ target: target.name, snapshots: dated.length, bytes: await bytes(directory), retentionViolations: dated.slice(3).filter((item) => item.mtime < cutoff).length }); }
  return rows;
}
export async function enforceBackupRetention(adapter: PlatformAdapter = new NodePlatformAdapter(), now = Date.now(), dryRun = false): Promise<readonly string[]> {
  const root = backupRoot(adapter); if (dryRun) { try { await stat(root); } catch { return []; } } else await mkdir(root, { recursive: true }); const cutoff = now - 30 * 24 * 60 * 60 * 1_000; const removed: string[] = [];
  for (const target of await readdir(root, { withFileTypes: true })) { if (!target.isDirectory()) continue; const directory = path.join(root, target.name); const entries = await readdir(directory, { withFileTypes: true }); const dated = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => ({ file: path.join(directory, entry.name), mtime: (await stat(path.join(directory, entry.name))).mtimeMs }))); dated.sort((a, b) => b.mtime - a.mtime); for (const item of dated.slice(3)) if (item.mtime < cutoff) { removed.push(item.file); if (!dryRun) await rm(item.file, { recursive: true, force: true }); } }
  return removed;
}
