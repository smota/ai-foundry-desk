import { homedir } from "node:os";
import path from "node:path";
import type { HostCommand, PlatformAdapter } from "./platform.js";

function name(component: string): string { return "AFD-Observability-" + component; }
function quoteWindows(value: string): string { return '"' + value.replace(/"/g, '\\"') + '"'; }
function commandLine(command: HostCommand): string { return [command.executable, ...command.args].map(quoteWindows).join(" "); }
function xml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function systemdValue(value: string): string { return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

export async function installAutostart(adapter: PlatformAdapter, component: string, command: HostCommand): Promise<void> {
  const task = name(component);
  if (adapter.id === "win32") {
    const env = Object.entries(command.env ?? {}).map(([key, value]) => "set \"" + key + "=" + value.replace(/"/g, "") + "\"").join(" && ");
    const taskCommand = env ? "cmd.exe /d /c " + quoteWindows(env + " && " + commandLine(command)) : commandLine(command);
    const result = await adapter.run({ executable: "reg.exe", args: ["ADD", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", task, "/t", "REG_SZ", "/d", taskCommand, "/f"] });
    if (result.status !== 0) throw new Error("Could not create the Windows per-user autostart entry: " + (result.stderr || result.stdout).trim());
    return;
  }
  if (adapter.id === "linux") {
    const unit = path.join(homedir(), ".config", "systemd", "user", task.toLowerCase() + ".service");
    const environment = Object.entries(command.env ?? {}).map(([key, value]) => "Environment=" + systemdValue(key + "=" + value)).join("\n");
    const body = "[Unit]\nDescription=" + task + "\n[Service]\nType=simple\n" + environment + (environment ? "\n" : "") + "WorkingDirectory=" + systemdValue(command.cwd ?? homedir()) + "\nExecStart=" + [command.executable, ...command.args].map(systemdValue).join(" ") + "\nRestart=on-failure\n[Install]\nWantedBy=default.target\n";
    await adapter.writeText(unit, body);
    for (const args of [["--user", "daemon-reload"], ["--user", "enable", "--now", path.basename(unit)]]) { const result = await adapter.run({ executable: "systemctl", args }); if (result.status !== 0) throw new Error("Could not install the systemd user service."); }
    return;
  }
  const uid = (await adapter.run({ executable: "id", args: ["-u"] })).stdout.trim();
  if (!/^\d+$/.test(uid)) throw new Error("Could not determine the macOS user id.");
  const file = path.join(homedir(), "Library", "LaunchAgents", task + ".plist");
  const args = [command.executable, ...command.args].map((value) => "<string>" + xml(value) + "</string>").join("");
  const env = Object.entries(command.env ?? {}).map(([key, value]) => "<key>" + xml(key) + "</key><string>" + xml(value) + "</string>").join("");
  const body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>Label</key><string>" + task + "</string><key>ProgramArguments</key><array>" + args + "</array><key>WorkingDirectory</key><string>" + xml(command.cwd ?? homedir()) + "</string><key>EnvironmentVariables</key><dict>" + env + "</dict><key>RunAtLoad</key><true/></dict></plist>";
  await adapter.writeText(file, body); const result = await adapter.run({ executable: "launchctl", args: ["bootstrap", "gui/" + uid, file] }); if (result.status !== 0) throw new Error("Could not install the launchd agent.");
}

export async function uninstallAutostart(adapter: PlatformAdapter, component: string): Promise<void> {
  const task = name(component);
  if (adapter.id === "win32") { const result = await adapter.run({ executable: "reg.exe", args: ["DELETE", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", task, "/f"] }); if (result.status !== 0&&!/unable to find|not found/i.test(result.stderr+result.stdout)) throw new Error("Could not remove the Windows per-user autostart entry."); return; }
  if (adapter.id === "linux") { const unit = task.toLowerCase() + ".service"; await adapter.run({ executable: "systemctl", args: ["--user", "disable", "--now", unit] }); const file = path.join(homedir(), ".config", "systemd", "user", unit); await adapter.remove(file); await adapter.run({ executable: "systemctl", args: ["--user", "daemon-reload"] }); return; }
  const uid = (await adapter.run({ executable: "id", args: ["-u"] })).stdout.trim(); const file = path.join(homedir(), "Library", "LaunchAgents", task + ".plist"); await adapter.run({ executable: "launchctl", args: ["bootout", "gui/" + uid, file] }); await adapter.remove(file);
}
