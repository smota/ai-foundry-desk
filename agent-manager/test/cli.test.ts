import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: process.cwd(), encoding: "utf8" });
}

test("help e versão usam a marca afd", () => {
  const help = cli("--help"); const version = cli("--version");
  assert.equal(help.status, 0); assert.match(help.stdout, /AI Foundry Desk/); assert.match(help.stdout, /afd layer1/);
  assert.equal(version.status, 0); assert.equal(version.stdout.trim(), "0.1.0");
});

test("init não aplica layers e flags mutantes desconhecidas são rejeitadas", () => {
  const init = cli("init", "--dry-run"); const typo = cli("sync", "--typo");
  assert.equal(init.status, 0); assert.match(init.stdout, /Nenhuma layer foi aplicada/);
  assert.notEqual(typo.status, 0); assert.match(typo.stderr, /Uso: afd sync/);
});
