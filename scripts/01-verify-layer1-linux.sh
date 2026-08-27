#!/bin/sh
set -eu
AFD_INHERITED_USERPROFILE="${USERPROFILE:-}"
AFD_CALLER_DIR="$PWD"
export MISE_DATA_DIR="$HOME/.local/share/mise" MISE_CONFIG_DIR="$HOME/.config/mise" MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
case "$AFD_INHERITED_USERPROFILE" in /mnt/*) afd_windows_home="$AFD_INHERITED_USERPROFILE";; ?:\\*) afd_windows_home="$(wslpath -u "$AFD_INHERITED_USERPROFILE")";; *) afd_windows_home="";; esac
case "$AFD_CALLER_DIR" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$AFD_CALLER_DIR" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$HOME/.local/share/pnpm/bin:$PATH"
cd "$HOME"
failed=0
check() { label="$1" pattern="$2"; shift 2; output="$($@ 2>&1 | head -n1 || true)"; if printf '%s' "$output" | grep -Eq "$pattern"; then printf 'OK   %-18s %s\n' "$label" "$output"; else printf 'FAIL %-18s %s\n' "$label" "${output:-missing}"; failed=$((failed+1)); fi; }
check mise '^2026\.8\.14' mise --version
check uv '^uv 0\.12\.6' uv --version
check pnpm '^11\.23\.0$' pnpm --version
check python '^Python 3\.14\.' python --version
check node '^v24\.' node --version
check go '^go version go1\.26\.' go version
check rust '^rustc 1\.98\.0' rustc --version
[ "$(mise settings get not_found_auto_install 2>/dev/null || true)" = false ] || { echo 'FAIL mise auto-install guard'; failed=$((failed+1)); }
[ "${UV_NO_MANAGED_PYTHON:-}" = 1 ] || { echo 'FAIL UV_NO_MANAGED_PYTHON'; failed=$((failed+1)); }
[ "${UV_PYTHON_DOWNLOADS:-}" = 0 ] || { echo 'FAIL UV_PYTHON_DOWNLOADS'; failed=$((failed+1)); }
if command -v docker >/dev/null 2>&1; then
  docker --version
  if docker info >/dev/null 2>&1 || sudo -n docker info >/dev/null 2>&1; then echo 'OK   docker daemon'; else echo 'WARN docker client installed; daemon access requires sudo or explicit group review'; fi
else echo 'FAIL docker missing'; failed=$((failed+1)); fi
[ "$failed" -eq 0 ] || exit 1
echo 'Linux Layer 1 verification passed; Layers 1-3 use native host tools.'
