import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { foundationPlan } from "../src/foundation.js";

const repositoryRoot = path.resolve(process.cwd(), "..");

test("foundation plans expose supply-chain tooling and Docker privilege boundaries", () => {
  const windows = foundationPlan("win32");
  assert.equal(windows.privileged, true);
  assert.ok(windows.actions.some((action) => action.includes("@lavamoat/allow-scripts")));
  assert.ok(windows.actions.some((action) => action.includes("Docker Desktop") && action.includes("elevation")));

  const linux = foundationPlan("linux");
  assert.equal(linux.privileged, true);
  assert.ok(linux.actions.some((action) => action.includes("Docker Engine") && action.includes("privileged")));

  const macOS = foundationPlan("darwin");
  assert.equal(macOS.privileged, true);
  assert.ok(macOS.actions.some((action) => action.includes("Docker Desktop") && action.includes("authorization")));
});

test("Layer 1 runtime adapters pin and integrity-check the scoped LavaMoat package", () => {
  const windows = readFileSync(path.join(repositoryRoot, "scripts", "01-layer1-runtime.ps1"), "utf8");
  const linux = readFileSync(path.join(repositoryRoot, "scripts", "01-layer1-runtime-linux.sh"), "utf8");
  const macOS = readFileSync(path.join(repositoryRoot, "scripts", "01-layer1-runtime-macos.sh"), "utf8");
  for (const source of [windows, linux, macOS]) {
    assert.match(source, /@lavamoat\/allow-scripts/);
    assert.match(source, /5\.1\.0/);
    assert.match(source, /sha512-x00YE\+hIoak1mrP3w\/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev\/LvVUeqPnqI7w==/);
    assert.match(source, /--ignore-scripts/);
  }
});

test("macOS adapters pin both architectures and preserve interactive Docker decisions", () => {
  const runtime = readFileSync(path.join(repositoryRoot, "scripts", "01-layer1-runtime-macos.sh"), "utf8");
  const docker = readFileSync(path.join(repositoryRoot, "scripts", "02-docker-macos.sh"), "utf8");
  assert.match(runtime, /mise-v\$MISE_VERSION-macos-arm64/);
  assert.match(runtime, /mise-v\$MISE_VERSION-macos-x64/);
  assert.match(runtime, /aarch64-apple-darwin/);
  assert.match(runtime, /x86_64-apple-darwin/);
  assert.match(runtime, /ba93b3fe7e47964e4392d40c8b7bfa5740e8c2a0a575e3e86268e9764082ed3e/);
  assert.match(runtime, /02fdcaac111c2eb056432172c1c5c469b335dfd95115140c3c5524a24a889c12/);
  assert.match(runtime, /14b459d51ea2e71eeba28c45a268c922bdf8607fc6455e3f40b4e082895d160d/);
  assert.match(runtime, /2a26ea71bbeff1c7e12c2cc40245c96a041deff276bc921e7038e304d5d3e04c/);
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

test("macOS Layer 1 is routed to native adapters while Layer 2 remains fail-closed", () => {
  const service = readFileSync(path.join(repositoryRoot, "agent-manager", "src", "command-service.ts"), "utf8");
  const bootstrap = readFileSync(path.join(repositoryRoot, "scripts", "afd-bootstrap-posix.sh"), "utf8");
  assert.match(service, /01-layer1-runtime-macos\.sh/);
  assert.match(service, /02-docker-macos\.sh/);
  assert.match(service, /01-verify-layer1-macos\.sh/);
  assert.match(service, /Layer 2 automation is not implemented for macOS/);
  assert.match(bootstrap, /Darwin\) PLATFORM="macos"/);
  assert.match(bootstrap, /shasum -a 256 --check/);
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
