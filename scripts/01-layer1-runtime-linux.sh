#!/bin/sh
set -eu
AFD_INHERITED_USERPROFILE="${USERPROFILE:-}"
AFD_CALLER_DIR="$PWD"

MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--apply" ] || { echo "Usage: 01-layer1-runtime-linux.sh --dry-run|--apply" >&2; exit 2; }
[ "$(uname -s)" = Linux ] || { echo "This adapter supports Linux only." >&2; exit 3; }
[ "$(uname -m)" = x86_64 ] || { echo "Validated architecture is Linux x86_64." >&2; exit 3; }
[ "$(id -u)" -ne 0 ] || { echo "Run the runtime adapter as the target user, not root." >&2; exit 3; }

MISE_VERSION="2026.8.14"
MISE_SHA256="7cd12d6002d5b3c83a89cad79023712faf2a36f9e8b2ee2061dac5135b3de0ed"
UV_VERSION="0.12.6"
UV_SHA256="8681d8921e7d520fb368991dcf5f9c1905b80f5bf2a265a0ed085c8d8e342477"
PNPM_VERSION="11.23.0"
LOCAL_BIN="$HOME/.local/bin"
MISE_DATA_DIR="$HOME/.local/share/mise"
MISE_CONFIG_DIR="$HOME/.config/mise"
MISE_CACHE_DIR="$HOME/.cache/mise"
MISE_BIN="$LOCAL_BIN/mise"
UV_BIN="$LOCAL_BIN/uv"
BACKUP_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ai-foundry-desk/backups/layer1-profile"

if [ "$MODE" = "--dry-run" ]; then
  echo "[dry-run] install checksum-pinned mise $MISE_VERSION and uv $UV_VERSION in $LOCAL_BIN"
  echo "[dry-run] configure Python 3.14, Node 24, Go 1.26, Rust 1.98.0 and pnpm $PNPM_VERSION"
  echo "[dry-run] set UV_NO_MANAGED_PYTHON=1, UV_PYTHON_DOWNLOADS=0 and mise not_found_auto_install=false"
  echo "[dry-run] update only managed blocks in ~/.profile and ~/.bashrc after backup"
  echo "[dry-run] Docker Engine is a Layer 1 tool; use 02-docker-linux.sh separately for its privileged apply"
  exit 0
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 4; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required." >&2; exit 4; }
command -v tar >/dev/null 2>&1 || { echo "tar is required." >&2; exit 4; }
mkdir -p "$LOCAL_BIN"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/afd-layer1.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

install_verified() {
  url="$1" expected="$2" destination="$3"
  artifact="$tmp/$(basename "$url")"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$artifact" "$url"
  printf '%s  %s\n' "$expected" "$artifact" | sha256sum --check --status
  install -m 0755 "$artifact" "$destination"
}

if [ ! -x "$MISE_BIN" ] || [ "$($MISE_BIN --version 2>/dev/null | awk '{print $1}')" != "$MISE_VERSION" ]; then
  install_verified "https://github.com/jdx/mise/releases/download/v$MISE_VERSION/mise-v$MISE_VERSION-linux-x64" "$MISE_SHA256" "$MISE_BIN"
fi
if [ ! -x "$UV_BIN" ] || ! "$UV_BIN" --version 2>/dev/null | grep -q "uv $UV_VERSION"; then
  archive="$tmp/uv.tar.gz"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$archive" "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-x86_64-unknown-linux-gnu.tar.gz"
  printf '%s  %s\n' "$UV_SHA256" "$archive" | sha256sum --check --status
  tar -xzf "$archive" -C "$tmp"
  install -m 0755 "$tmp/uv-x86_64-unknown-linux-gnu/uv" "$UV_BIN"
  install -m 0755 "$tmp/uv-x86_64-unknown-linux-gnu/uvx" "$LOCAL_BIN/uvx"
fi

export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
case "$AFD_INHERITED_USERPROFILE" in /mnt/*) afd_windows_home="$AFD_INHERITED_USERPROFILE";; ?:\\*) afd_windows_home="$(wslpath -u "$AFD_INHERITED_USERPROFILE")";; *) afd_windows_home="";; esac
case "$AFD_CALLER_DIR" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$AFD_CALLER_DIR" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export MISE_DATA_DIR MISE_CONFIG_DIR MISE_CACHE_DIR
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export PATH="$LOCAL_BIN:$MISE_DATA_DIR/shims:$PATH"
export UV_NO_MANAGED_PYTHON=1 UV_PYTHON_DOWNLOADS=0
cd "$HOME"
"$MISE_BIN" settings set not_found_auto_install false
"$MISE_BIN" use --global python@3.14 node@24 go@1.26 rust@1.98.0
"$MISE_BIN" reshim

NODE_BIN="$($MISE_BIN which node)"
NODE_DIR="$(dirname "$NODE_BIN")"
if [ -x "$NODE_DIR/corepack" ]; then
  "$NODE_DIR/corepack" enable --install-directory "$LOCAL_BIN"
  "$NODE_DIR/corepack" prepare "pnpm@$PNPM_VERSION" --activate
else
  echo "The pinned Node distribution does not contain corepack; refusing an implicit npm fallback." >&2
  exit 5
fi

managed_block='# >>> AI Foundry Desk Layer 1 >>>
# Managed by AI Foundry Desk. Layers 1-3 run natively; Docker is not an execution wrapper.
afd_inherited_userprofile="${USERPROFILE:-}"
afd_caller_dir="$PWD"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
export MISE_DATA_DIR="$HOME/.local/share/mise"
export MISE_CONFIG_DIR="$HOME/.config/mise"
export MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml"
export MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
case "$afd_inherited_userprofile" in /mnt/*) afd_windows_home="$afd_inherited_userprofile";; ?:\\*) afd_windows_home="$(wslpath -u "$afd_inherited_userprofile")";; *) afd_windows_home="";; esac
case "$afd_caller_dir" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$afd_caller_dir" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export UV_NO_MANAGED_PYTHON=1
export UV_PYTHON_DOWNLOADS=0
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in *":$PNPM_HOME/bin:"*) ;; *) export PATH="$PNPM_HOME/bin:$PATH" ;; esac
# <<< AI Foundry Desk Layer 1 <<<'

update_profile() {
  profile="$1" start='# >>> AI Foundry Desk Layer 1 >>>' end='# <<< AI Foundry Desk Layer 1 <<<'
  current=""; [ ! -f "$profile" ] || current="$(cat "$profile")"
  clean="$(printf '%s\n' "$current" | awk -v s="$start" -v e="$end" '$0==s{skip=1;next}$0==e{skip=0;next}!skip{print}')"
  desired="$(printf '%s\n\n%s\n' "$(printf '%s' "$clean" | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}')" "$managed_block")"
  [ "$current" = "$desired" ] && return 0
  if [ -f "$profile" ]; then mkdir -p "$BACKUP_ROOT"; cp -p "$profile" "$BACKUP_ROOT/$(basename "$profile").$(date -u +%Y%m%dT%H%M%SZ)"; fi
  printf '%s' "$desired" > "$profile"
}
update_profile "$HOME/.profile"
update_profile "$HOME/.bashrc"

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/afd-hardlink.XXXXXX")"
printf layer1 > "$test_dir/source"; ln "$test_dir/source" "$test_dir/link"; [ "$(cat "$test_dir/link")" = layer1 ]; rm -rf "$test_dir"
echo "Linux Layer 1 runtime foundation applied. Docker remains a separate native tool step."
