#!/bin/sh
set -eu
AFD_INHERITED_USERPROFILE="${USERPROFILE:-}"
AFD_CALLER_DIR="$PWD"
export PNPM_HOME="$HOME/.local/share/pnpm"
export MISE_DATA_DIR="$HOME/.local/share/mise" MISE_CONFIG_DIR="$HOME/.config/mise" MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
case "$AFD_INHERITED_USERPROFILE" in /mnt/*) afd_windows_home="$AFD_INHERITED_USERPROFILE";; ?:\\*) afd_windows_home="$(wslpath -u "$AFD_INHERITED_USERPROFILE")";; *) afd_windows_home="";; esac
case "$AFD_CALLER_DIR" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$AFD_CALLER_DIR" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$PNPM_HOME/bin:$PATH"
cd "$HOME"
failed=0
for command in claude codex pi grok rg fd jq yq bat delta; do
  if ! command -v "$command" >/dev/null 2>&1; then printf 'FAIL %-10s missing\n' "$command"; failed=$((failed+1)); continue; fi
  if output="$("$command" --version 2>&1)"; then printf 'OK   %-10s %s | %s\n' "$command" "$(command -v "$command")" "$(printf '%s' "$output" | head -n1)"; else printf 'FAIL %-10s %s\n' "$command" "$(printf '%s' "$output" | head -n1)"; failed=$((failed+1)); fi
done
for optional in agy hermes; do if command -v "$optional" >/dev/null 2>&1; then printf 'OK   %-10s %s\n' "$optional" "$(command -v "$optional")"; else printf 'INFO %-10s official checksum-verifiable Linux installer unavailable\n' "$optional"; fi; done
[ "$failed" -eq 0 ] || exit 1
echo 'Linux Layer 2 verification passed; authentication remains manual.'
