import type { PlatformId } from "./platform.js";

export interface FoundationPlan { readonly platform: PlatformId; readonly actions: readonly string[]; readonly privileged: boolean }
export function foundationPlan(platform: PlatformId): FoundationPlan {
  const actions = ["Install or verify checksum-pinned mise and uv in user scope.", "Configure Node 24, Python, Go, Rust, and pnpm through mise.", "Install the integrity-pinned @lavamoat/allow-scripts security tool with lifecycle scripts disabled.", "Persist only managed PATH and shell-profile entries.", "Verify commands and state without reading credentials."];
  if (platform === "win32") actions.push("Install or verify Docker Desktop through WinGet; installation may request elevation and Docker is not started automatically.");
  if (platform === "linux") actions.push("Install or verify Docker Engine through the separate privileged host-tool adapter.");
  if (platform === "darwin") actions.push("Install or verify checksum-pinned Docker Desktop for Apple Silicon or Intel; macOS authorization may be requested and Docker is not started automatically.");
  return { platform, actions, privileged: platform === "win32" || platform === "linux" || platform === "darwin" };
}

export function layer2Plan(platform: PlatformId): FoundationPlan {
  const actions = ["Verify supported agent CLIs and desktop adapters.", "Install only catalogued tools through the platform adapter after explicit apply.", "Configure only managed shims and profile entries.", "Never authenticate or read agent history, sessions, or tokens."];
  if (platform === "linux") actions.push("Defer agents without checksum-verifiable Linux artifacts.");
  if (platform === "darwin") actions.push("Use only reviewed macOS package adapters after clean-host validation.");
  return { platform, actions, privileged: false };
}
