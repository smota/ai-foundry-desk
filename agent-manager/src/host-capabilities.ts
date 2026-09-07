import type { PlatformId } from "./platform.js";

export type HostLayer = 1 | 2;
export type HostToolOwnership = "user-managed" | "afd-configured" | "afd-owned";
export type HostInstaller =
  | { readonly kind: "winget"; readonly id: string }
  | { readonly kind: "pnpm"; readonly package: string; readonly integrity?: string; readonly allowBuild?: boolean }
  | { readonly kind: "mise"; readonly tool: string }
  | { readonly kind: "verified-download"; readonly url: string; readonly sha256: string; readonly archiveMember?: string }
  | { readonly kind: "corepack" }
  | { readonly kind: "external"; readonly detail: string };

export interface HostCapability {
  readonly id: string;
  readonly layer: HostLayer;
  readonly command: string;
  readonly versionArgs: readonly string[];
  readonly installVersion?: string;
  readonly compatible: string;
  readonly ownership: HostToolOwnership;
  readonly installers: Partial<Record<PlatformId, HostInstaller>>;
  readonly required: boolean;
}

// Installation pins are reviewed defaults. Compatibility ranges deliberately
// remain separate so a normal user update is not treated as AFD-owned drift.
export const HOST_CAPABILITIES: readonly HostCapability[] = [
  { id: "mise", layer: 1, command: "mise", versionArgs: ["--version"], installVersion: "2026.8.14", compatible: ">=2026.8.14", ownership: "user-managed", installers: { win32: { kind: "winget", id: "jdx.mise" }, linux: { kind: "verified-download", url: "https://github.com/jdx/mise/releases/download/v2026.8.14/mise-v2026.8.14-linux-x64", sha256: "7cd12d6002d5b3c83a89cad79023712faf2a36f9e8b2ee2061dac5135b3de0ed" }, darwin: { kind: "external", detail: "architecture-specific checksum-verified mise release" } }, required: true },
  { id: "uv", layer: 1, command: "uv", versionArgs: ["--version"], installVersion: "0.12.6", compatible: ">=0.12.6 <1.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "astral-sh.uv" }, linux: { kind: "verified-download", url: "https://github.com/astral-sh/uv/releases/download/0.12.6/uv-x86_64-unknown-linux-gnu.tar.gz", sha256: "8681d8921e7d520fb368991dcf5f9c1905b80f5bf2a265a0ed085c8d8e342477", archiveMember: "uv-x86_64-unknown-linux-gnu/uv" }, darwin: { kind: "external", detail: "architecture-specific checksum-verified uv release" } }, required: true },
  { id: "node", layer: 1, command: "node", versionArgs: ["--version"], installVersion: "24", compatible: ">=24.0.0 <25.0.0", ownership: "afd-configured", installers: { win32: { kind: "mise", tool: "node" }, linux: { kind: "mise", tool: "node" }, darwin: { kind: "mise", tool: "node" } }, required: true },
  { id: "pnpm", layer: 1, command: "pnpm", versionArgs: ["--version"], installVersion: "11.23.0", compatible: ">=11.23.0 <13.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "pnpm.pnpm" }, linux: { kind: "corepack" }, darwin: { kind: "corepack" } }, required: true },
  { id: "python", layer: 1, command: "python", versionArgs: ["--version"], installVersion: "3.14", compatible: ">=3.14.0 <3.15.0", ownership: "afd-configured", installers: { win32: { kind: "mise", tool: "python" }, linux: { kind: "mise", tool: "python" }, darwin: { kind: "mise", tool: "python" } }, required: true },
  { id: "go", layer: 1, command: "go", versionArgs: ["version"], installVersion: "1.26", compatible: ">=1.26.0 <1.27.0", ownership: "afd-configured", installers: { win32: { kind: "mise", tool: "go" }, linux: { kind: "mise", tool: "go" }, darwin: { kind: "mise", tool: "go" } }, required: true },
  { id: "rust", layer: 1, command: "rustc", versionArgs: ["--version"], installVersion: "1.98.0", compatible: ">=1.98.0 <1.99.0", ownership: "afd-configured", installers: { win32: { kind: "mise", tool: "rust" }, linux: { kind: "mise", tool: "rust" }, darwin: { kind: "mise", tool: "rust" } }, required: true },
  { id: "allow-scripts", layer: 1, command: "allow-scripts", versionArgs: ["--version"], installVersion: "5.1.0", compatible: ">=5.1.0 <6.0.0", ownership: "user-managed", installers: { win32: { kind: "pnpm", package: "@lavamoat/allow-scripts", integrity: "sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w==" }, linux: { kind: "pnpm", package: "@lavamoat/allow-scripts", integrity: "sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w==" }, darwin: { kind: "pnpm", package: "@lavamoat/allow-scripts", integrity: "sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w==" } }, required: true },
  { id: "docker", layer: 1, command: "docker", versionArgs: ["--version"], compatible: ">=27.0.0", ownership: "user-managed", installers: { win32: { kind: "external", detail: "Docker Desktop installation requires a separately reviewed elevation boundary" }, linux: { kind: "external", detail: "Docker Engine installation requires a separately reviewed sudo boundary" }, darwin: { kind: "external", detail: "Docker Desktop installation requires a separately reviewed interactive application install" } }, required: false },
  { id: "codex", layer: 2, command: "codex", versionArgs: ["--version"], installVersion: "0.146.1", compatible: ">=0.146.1 <1.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "OpenAI.Codex" }, linux: { kind: "pnpm", package: "@openai/codex", integrity: "sha512-f51R56E/G15soLhf5l5pWUiM+mGHK0NdLozOtzjRoAa+bA20hgWrkyxE/fpwCnuGQM6XNdktHYtK9xQ7bPIbTA==" } }, required: true },
  { id: "claude-code", layer: 2, command: "claude", versionArgs: ["--version"], installVersion: "2.1.240", compatible: ">=2.1.240 <3.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "Anthropic.ClaudeCode" }, linux: { kind: "pnpm", package: "@anthropic-ai/claude-code", integrity: "sha512-0ivyKRUk9et03PlsZTxwb+LobqW3oGUstvdTnFNcRFATOmp/uyiO6ApVc4XDvg6eQoY6uG8j+kOeNd68BsfeoQ==", allowBuild: true } }, required: true },
  { id: "pi", layer: 2, command: "pi", versionArgs: ["--version"], installVersion: "0.84.3", compatible: ">=0.84.3 <1.0.0", ownership: "user-managed", installers: { win32: { kind: "pnpm", package: "@earendil-works/pi-coding-agent", integrity: "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==" }, linux: { kind: "pnpm", package: "@earendil-works/pi-coding-agent", integrity: "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==" } }, required: true },
  { id: "grok", layer: 2, command: "grok", versionArgs: ["--version"], installVersion: "1.0.5", compatible: ">=1.0.5 <2.0.0", ownership: "user-managed", installers: { win32: { kind: "pnpm", package: "@xai-official/grok", integrity: "sha512-kk5hez+Oz5CvWonDGkMNmL483CWRIGRF2ki8jQzpIXH56P0fhCgaX9lrr0IUoFCKh/rYAm5vfCPgQsdIIYLu8Q==", allowBuild: true }, linux: { kind: "pnpm", package: "@xai-official/grok", integrity: "sha512-kk5hez+Oz5CvWonDGkMNmL483CWRIGRF2ki8jQzpIXH56P0fhCgaX9lrr0IUoFCKh/rYAm5vfCPgQsdIIYLu8Q==", allowBuild: true } }, required: true },
  { id: "hermes", layer: 2, command: "hermes", versionArgs: ["--version"], installVersion: "2026.8.19", compatible: ">=2026.8.19", ownership: "user-managed", installers: { win32: { kind: "external", detail: "checksum-verified official installer" }, linux: { kind: "external", detail: "checksum-verified official installer" } }, required: false },
  { id: "antigravity", layer: 2, command: "agy", versionArgs: ["--version"], compatible: ">=0.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "Google.AntigravityCLI" } }, required: false },
  { id: "ripgrep", layer: 2, command: "rg", versionArgs: ["--version"], installVersion: "15.2.0", compatible: ">=15.2.0 <16.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "BurntSushi.ripgrep.MSVC" }, linux: { kind: "mise", tool: "github:BurntSushi/ripgrep" } }, required: true },
  { id: "fd", layer: 2, command: "fd", versionArgs: ["--version"], installVersion: "10.5.0", compatible: ">=10.5.0 <11.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "sharkdp.fd" }, linux: { kind: "mise", tool: "github:sharkdp/fd" } }, required: true },
  { id: "jq", layer: 2, command: "jq", versionArgs: ["--version"], installVersion: "1.8.2", compatible: ">=1.8.2 <2.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "jqlang.jq" }, linux: { kind: "mise", tool: "github:jqlang/jq" } }, required: true },
  { id: "yq", layer: 2, command: "yq", versionArgs: ["--version"], installVersion: "4.53.6", compatible: ">=4.53.6 <5.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "MikeFarah.yq" }, linux: { kind: "mise", tool: "github:mikefarah/yq" } }, required: true },
  { id: "bat", layer: 2, command: "bat", versionArgs: ["--version"], installVersion: "0.26.1", compatible: ">=0.26.1 <1.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "sharkdp.bat" }, linux: { kind: "mise", tool: "github:sharkdp/bat" } }, required: true },
  { id: "delta", layer: 2, command: "delta", versionArgs: ["--version"], installVersion: "0.19.2", compatible: ">=0.19.2 <1.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "dandavison.delta" }, linux: { kind: "mise", tool: "github:dandavison/delta" } }, required: true },
  { id: "glow", layer: 2, command: "glow", versionArgs: ["--version"], installVersion: "3.0.0", compatible: ">=3.0.0 <4.0.0", ownership: "user-managed", installers: { win32: { kind: "winget", id: "charmbracelet.glow" }, linux: { kind: "mise", tool: "github:charmbracelet/glow" } }, required: true },
] as const;

export function capability(id: string): HostCapability {
  const found = HOST_CAPABILITIES.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown host capability: ${id}.`);
  return found;
}

function numericVersion(value: string): readonly number[] | undefined {
  const match = value.match(/(?:^|[^0-9])(\d{1,4}(?:\.\d+){0,3})(?:[^0-9]|$)/);
  if (!match?.[1]) return undefined;
  return match[1].split(".").map((part) => Number(part));
}

function compare(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function versionCompatible(output: string, range: string): boolean {
  const observed = numericVersion(output);
  if (!observed) return false;
  return range.split(/\s+/).filter(Boolean).every((clause) => {
    const match = clause.match(/^(>=|<=|>|<|=)?(.+)$/);
    const expected = match?.[2] ? numericVersion(match[2]) : undefined;
    if (!match || !expected) return false;
    const relation = compare(observed, expected);
    switch (match[1] ?? "=") {
      case ">=": return relation >= 0;
      case "<=": return relation <= 0;
      case ">": return relation > 0;
      case "<": return relation < 0;
      default: return relation === 0;
    }
  });
}

export function capabilitiesForLayer(layer: HostLayer): readonly HostCapability[] {
  return HOST_CAPABILITIES.filter((item) => item.layer === layer);
}
