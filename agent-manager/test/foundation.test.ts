import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { capability } from "../src/host-capabilities.js";

const repositoryRoot = path.resolve(process.cwd(), "..");

test("the capability manifest owns runtime, supply-chain, and privilege boundaries", () => {
  const allowScripts = capability("allow-scripts");
  assert.equal(allowScripts.installVersion, "5.1.0");
  for (const platform of ["win32", "linux", "darwin"] as const) {
    const installer = allowScripts.installers[platform];
    assert.equal(installer?.kind, "pnpm");
    if (installer?.kind === "pnpm") assert.equal(installer.integrity, "sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w==");
  }
  const dockerCapability = capability("docker");
  assert.equal(dockerCapability.required, false);
  for (const platform of ["win32", "linux", "darwin"] as const) assert.equal(dockerCapability.installers[platform]?.kind, "external");
});

test("macOS Docker adapter preserves interactive privilege decisions", () => {
  const docker = readFileSync(path.join(repositoryRoot, "scripts", "02-docker-macos.sh"), "utf8");
  assert.match(docker, /DOCKER_VERSION="4\.89\.0"/);
  assert.match(docker, /DOCKER_BUILD="238018"/);
  assert.match(docker, /d333f7c8d42f746429ab1f32ad3284efec887e2a08c03b2ed373a7091373e392/);
  assert.match(docker, /cb22c74b9c6c9c2768d64459828b6c2b0ab4d5b7ace4b28f0979d7de4f28e336/);
  assert.match(docker, /product_major.*-ge 14/);
  assert.match(docker, /codesign --verify --deep --strict/);
  assert.match(docker, /with administrator privileges/);
  assert.doesNotMatch(docker, /--accept-license|--user=/);
  assert.doesNotMatch(docker, /open -a|launchctl/);
});

test("host layers are routed through the typed cross-platform lifecycle", () => {
  const service = readFileSync(path.join(repositoryRoot, "agent-manager", "src", "command-service.ts"), "utf8");
  const bootstrap = readFileSync(path.join(repositoryRoot, "scripts", "afd-bootstrap-posix.sh"), "utf8");
  const nodeBootstrap = readFileSync(path.join(repositoryRoot, "scripts", "afd-bootstrap.mjs"), "utf8");
  const windowsBootstrap = readFileSync(path.join(repositoryRoot, "scripts", "afd-bootstrap.ps1"), "utf8");
  assert.match(service, /planHostLayer/);
  assert.match(service, /applyHostPlan/);
  assert.match(service, /recoverHostLayer/);
  assert.match(service, /rollbackHostLayer/);
  assert.doesNotMatch(service, /01-layer1-runtime-macos\.sh|01-layer1-runtime\.ps1|07-layer2-agent-clis\.ps1/);
  assert.match(bootstrap, /Darwin\) PLATFORM="macos"/);
  assert.match(bootstrap, /shasum -a 256 --check/);
  for (const source of [bootstrap, nodeBootstrap, windowsBootstrap]) assert.match(source, /versions/);
  assert.match(nodeBootstrap, /AI Foundry Desk.*cli/);
  assert.doesNotMatch(bootstrap, /\r/);
});

test("Windows Docker dry-run reports installation and elevation without invoking install", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "afd-docker-plan-"));
  try {
    const marker = path.join(root, "install-called.txt");
    const winget = path.join(root, "winget.cmd");
    writeFileSync(winget, `@echo off\r\nif /I "%1"=="install" echo called>"${marker}"\r\nexit /b 0\r\n`);
    const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const powershell = path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repositoryRoot, "scripts", "02-docker-windows.ps1"), "-WhatIf", "-ProgramFilesRoot", root, "-LocalAppDataRoot", root], {
      encoding: "utf8",
      env: { ...process.env, ProgramFiles: root, LOCALAPPDATA: root, PATH: `${root};${system32}`, Path: `${root};${system32}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would install Docker Desktop/);
    assert.match(result.stdout, /may request elevation/);
    assert.doesNotMatch(result.stdout, /Installing Docker Desktop through WinGet/);
    assert.throws(() => readFileSync(marker), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows Docker adapter preserves an existing Desktop installation and verifies its CLI", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(path.join(tmpdir(), "afd-docker-existing-"));
  try {
    const desktop = path.join(root, "Docker", "Docker", "Docker Desktop.exe");
    const docker = path.join(root, "docker.cmd");
    mkdirSync(path.dirname(desktop), { recursive: true });
    writeFileSync(desktop, "synthetic", { flush: true });
    writeFileSync(docker, [
      "@echo off",
      "if /I \"%1\"==\"--version\" echo Docker version 29.0.0, build synthetic& exit /b 0",
      "if /I \"%1\"==\"compose\" echo Docker Compose version v5.0.0& exit /b 0",
      "if /I \"%1\"==\"info\" echo 29.0.0& exit /b 0",
      "exit /b 1",
      "",
    ].join("\r\n"));
    const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
    const powershell = path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repositoryRoot, "scripts", "02-docker-windows.ps1"), "-ProgramFilesRoot", root, "-LocalAppDataRoot", root], {
      encoding: "utf8",
      env: { ...process.env, ProgramFiles: root, LOCALAPPDATA: root, PATH: `${root};${system32}`, Path: `${root};${system32}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No reinstall is required/);
    assert.match(result.stdout, /Docker daemon available: 29\.0\.0/);
    assert.doesNotMatch(result.stdout, /Installing Docker Desktop through WinGet/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
