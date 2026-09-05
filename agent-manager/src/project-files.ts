import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { bytesDigest, projectRelative } from "./project-contracts.js";
import type { ProjectSnapshot } from "./project-contracts.js";

export async function projectExists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate); return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}
export async function safeProjectRoot(input: string): Promise<string> {
  const target = path.resolve(input);
  if (target === path.parse(target).root) throw new Error("A filesystem root cannot be a project target.");
  let cursor = path.parse(target).root;
  let nearest = cursor;
  for (const part of target.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (await projectExists(cursor)) {
      const info = await lstat(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Project parent is not a regular directory: ${cursor}`);
      nearest = cursor;
    }
  }
  const resolved = await realpath(nearest);
  if (process.platform === "win32" ? resolved.toLowerCase() !== nearest.toLowerCase() : resolved !== nearest) throw new Error("Project parent resolves elsewhere.");
  return target;
}
export async function safeProjectFile(root: string, relative: string): Promise<string> {
  projectRelative(relative);
  const target = path.join(root, relative);
  await safeProjectRoot(path.dirname(target));
  if (await projectExists(target)) {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Project input is not a regular file: ${relative}`);
  }
  return target;
}
export async function snapshotProject(root: string, relatives: string[]): Promise<ProjectSnapshot[]> {
  await safeProjectRoot(root);
  const result: ProjectSnapshot[] = [];
  const directories = new Set<string>([""]);
  for (const relative of relatives) {
    const target = await safeProjectFile(root, relative);
    const exists = await projectExists(target);
    result.push({ path: relative, kind: exists ? "file" : "missing", digest: exists ? bytesDigest(await readFile(target)) : null });
    let parent = path.posix.dirname(relative);
    while (parent !== ".") { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const relative of [...directories].sort()) {
    const target = path.join(root, relative); const exists = await projectExists(target);
    const names = exists ? (await readdir(target)).filter(name => !["target", ".agent-runs"].includes(name)).sort() : [];
    const lowered = names.map(name => name.toLowerCase());
    if (new Set(lowered).size !== lowered.length) throw new Error("Case-colliding directory entries.");
    const expected = relatives.filter(p => path.posix.dirname(p) === (relative || ".")).map(p => path.posix.basename(p));
    if (expected.some(name => names.some(existing => existing.toLowerCase() === name.toLowerCase() && existing !== name))) throw new Error("Case collision with a proposed file.");
    result.push({ path: relative || ".", kind: exists ? "directory" : "missing", digest: exists ? bytesDigest(JSON.stringify(names)) : null });
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
