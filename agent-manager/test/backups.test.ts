import assert from "node:assert/strict";
import { mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { backupReport, enforceBackupRetention } from "../src/backups.js";
import { NodePlatformAdapter } from "../src/platform.js";

test("backup retention preserves three newest snapshots and removes expired surplus", async () => {
  const root = path.join(tmpdir(), "afd-backup-test-" + Date.now()); const adapter = new NodePlatformAdapter({ id: "linux", stateRoot: root }); const target = path.join(root, "backups", "profiles"); const now = Date.now();
  try { for (let index = 0; index < 5; index += 1) { const file = path.join(target, "snapshot-" + index); await mkdir(file, { recursive: true }); await writeFile(path.join(file, "state"), "x"); const when = new Date(now - (40 + index) * 24 * 60 * 60 * 1_000); await utimes(file, when, when); } const rows = await backupReport(adapter, now); assert.equal(rows[0]?.retentionViolations, 2); const removed = await enforceBackupRetention(adapter, now); assert.equal(removed.length, 2); assert.equal((await backupReport(adapter, now))[0]?.snapshots, 3); } finally { await rm(root, { recursive: true, force: true }); }
});
