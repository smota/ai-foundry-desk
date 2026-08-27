#!/bin/sh
set -eu
AFD_INHERITED_USERPROFILE="${USERPROFILE:-}"
AFD_CALLER_DIR="$PWD"
MODE="${1:-}"; CLAUDE_POSTINSTALL="${2:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--apply" ] || { echo "Usage: 07-layer2-agent-clis-linux.sh --dry-run|--apply [--allow-claude-postinstall]" >&2; exit 2; }
[ -z "$CLAUDE_POSTINSTALL" ] || [ "$CLAUDE_POSTINSTALL" = "--allow-claude-postinstall" ] || { echo "Unknown option: $CLAUDE_POSTINSTALL" >&2; exit 2; }
export PNPM_HOME="$HOME/.local/share/pnpm"
PNPM_BIN="$PNPM_HOME/bin"
export MISE_DATA_DIR="$HOME/.local/share/mise" MISE_CONFIG_DIR="$HOME/.config/mise" MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
case "$AFD_INHERITED_USERPROFILE" in /mnt/*) afd_windows_home="$AFD_INHERITED_USERPROFILE";; ?:\\*) afd_windows_home="$(wslpath -u "$AFD_INHERITED_USERPROFILE")";; *) afd_windows_home="";; esac
case "$AFD_CALLER_DIR" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$AFD_CALLER_DIR" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$PNPM_BIN:$PATH"
cd "$HOME"
install_npm_cli() {
  package="$1" version="$2" expected="$3" command="$4" allow_build="${5:-no}"
  if [ "$MODE" = "--dry-run" ]; then echo "[dry-run] install $package@$version after SHA-512 registry verification"; return; fi
  actual="$(pnpm view "$package@$version" dist.integrity --json | tr -d '"\r\n')"
  [ "$actual" = "$expected" ] || { echo "Registry integrity mismatch for $package@$version" >&2; exit 5; }
  if [ "$allow_build" = yes ]; then pnpm add --global --allow-build "$package" "$package@$version"; else pnpm add --global "$package@$version"; fi
  command -v "$command" >/dev/null 2>&1 || { echo "$command is missing after installation." >&2; exit 5; }
  if ! output="$("$command" --version 2>&1)"; then printf '%s\n' "$output" >&2; exit 5; fi
  printf '%s\n' "$output" | head -n1
}

if [ "$MODE" = "--apply" ]; then mkdir -p "$PNPM_BIN"; command -v pnpm >/dev/null 2>&1 || { echo "Layer 1 native pnpm is required." >&2; exit 4; }; fi

if [ "$MODE" = "--dry-run" ]; then
  echo '[dry-run] Claude requires a separately reviewed --allow-claude-postinstall opt-in'
elif [ "$CLAUDE_POSTINSTALL" = "--allow-claude-postinstall" ]; then
  install_npm_cli '@anthropic-ai/claude-code' '2.1.240' 'sha512-0ivyKRUk9et03PlsZTxwb+LobqW3oGUstvdTnFNcRFATOmp/uyiO6ApVc4XDvg6eQoY6uG8j+kOeNd68BsfeoQ==' claude yes
else
  echo '[info] Claude postinstall not authorized; existing package state is preserved.'
fi
install_npm_cli '@openai/codex' '0.146.1' 'sha512-f51R56E/G15soLhf5l5pWUiM+mGHK0NdLozOtzjRoAa+bA20hgWrkyxE/fpwCnuGQM6XNdktHYtK9xQ7bPIbTA==' codex
install_npm_cli '@earendil-works/pi-coding-agent' '0.84.3' 'sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==' pi
install_npm_cli '@xai-official/grok' '1.0.5' 'sha512-kk5hez+Oz5CvWonDGkMNmL483CWRIGRF2ki8jQzpIXH56P0fhCgaX9lrr0IUoFCKh/rYAm5vfCPgQsdIIYLu8Q==' grok
echo '[info] Antigravity and Hermes installers remain deferred until checksum-verifiable Linux artifacts are available.'
if [ "$MODE" = "--dry-run" ]; then echo 'Linux Layer 2 agent CLI plan complete.'; else echo 'Linux Layer 2 agent CLIs are ready; authentication was not inspected.'; fi
