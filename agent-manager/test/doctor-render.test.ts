import assert from "node:assert/strict";
import test from "node:test";
import { renderDoctorRows, supportsColor } from "../src/doctor-render.js";
import type { Diagnostic } from "../src/doctor.js";

const rows = (): readonly Diagnostic[] => [
  { status: "PASS", id: "execution.identity", detail: "identity verified", remedy: "No action." },
  { status: "PASS", id: "platform.win32", detail: "platform adapter is available", remedy: "No action." },
  { status: "WARN", id: "command.node", detail: "legacy node installed", remedy: "Pin node through managed toolchain review." },
  { status: "FAIL", id: "project.rust-msvc", detail: "MSVC tools are missing", remedy: "Run afd fix rust --dry-run in your normal user shell." },
  { status: "PASS", id: "runtime.host-node", detail: "runtime looks good", remedy: "No action." },
  { status: "FAIL", id: "sandbox.toolchain-access", detail: "toolchain access mismatch", remedy: "Review sandbox access and rerun diagnostics." },
];

function setEnv(name: string, value: string | undefined): void { if (value === undefined) delete process.env[name]; else process.env[name] = value; }

test("renderDoctorRows groups by component in stable order and includes conclusion", () => {
  const output = renderDoctorRows(rows());
  const platform = output.indexOf("Platform");
  const execution = output.indexOf("Execution");
  const runtime = output.indexOf("Runtime");
  const command = output.indexOf("Command");
  const project = output.indexOf("Project");
  const sandbox = output.indexOf("Sandbox");
  assert.equal(platform > -1, true);
  assert.equal(execution > platform, true);
  assert.equal(runtime > execution, true);
  assert.equal(command > runtime, true);
  assert.equal(project > command, true);
  assert.equal(sandbox > project, true);
  assert.match(output, /Result:/);
});

test("renderDoctorRows respects NO_COLOR", () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousForceColor = process.env.FORCE_COLOR;
  try {
    setEnv("NO_COLOR", "1");
    setEnv("FORCE_COLOR", undefined);
    const output = renderDoctorRows(rows(), { tty: true });
    assert.equal(output.includes("\u001b["), false);
  } finally {
    setEnv("NO_COLOR", previousNoColor);
    setEnv("FORCE_COLOR", previousForceColor);
  }
});

test("renderDoctorRows enables color in tty-like mode and exposes actionable conclusions", () => {
  const previousNoColor = process.env.NO_COLOR;
  const previousForceColor = process.env.FORCE_COLOR;
  try {
    setEnv("NO_COLOR", undefined);
    setEnv("FORCE_COLOR", undefined);
    assert.equal(supportsColor({ tty: true }), true);
    const output = renderDoctorRows(rows(), { color: true });
    assert.equal(output.includes("\u001b["), true);
    assert.match(output, /Required steps:/);
    assert.match(output, /Suggested actions:/);
  } finally {
    setEnv("NO_COLOR", previousNoColor);
    setEnv("FORCE_COLOR", previousForceColor);
  }
});
