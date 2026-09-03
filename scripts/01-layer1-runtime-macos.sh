#!/bin/sh
set -eu

MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--apply" ] || { echo "Usage: 01-layer1-runtime-macos.sh --dry-run|--apply" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "This adapter supports macOS only." >&2; exit 3; }
[ "$(id -u)" -ne 0 ] || { echo "Run the runtime adapter as the target user, not root." >&2; exit 3; }

MISE_VERSION="2026.8.14"
UV_VERSION="0.12.6"
PNPM_VERSION="11.23.0"
ALLOW_SCRIPTS_PACKAGE="@lavamoat/allow-scripts"
ALLOW_SCRIPTS_VERSION="5.1.0"
ALLOW_SCRIPTS_INTEGRITY="sha512-x00YE+hIoak1mrP3w/OZSGXaYTel2oRF0eqIT50G40aa7qqv5EcSzOQKLm1LJyzp0HGFCMXev/LvVUeqPnqI7w=="

case "$(uname -m)" in
  arm64)
    MISE_ASSET="mise-v$MISE_VERSION-macos-arm64"
    MISE_SHA256="ba93b3fe7e47964e4392d40c8b7bfa5740e8c2a0a575e3e86268e9764082ed3e"
    UV_TARGET="aarch64-apple-darwin"
    UV_SHA256="14b459d51ea2e71eeba28c45a268c922bdf8607fc6455e3f40b4e082895d160d"
    ;;
  x86_64)
    MISE_ASSET="mise-v$MISE_VERSION-macos-x64"
    MISE_SHA256="02fdcaac111c2eb056432172c1c5c469b335dfd95115140c3c5524a24a889c12"
    UV_TARGET="x86_64-apple-darwin"
    UV_SHA256="2a26ea71bbeff1c7e12c2cc40245c96a041deff276bc921e7038e304d5d3e04c"
    ;;
  *) echo "Supported macOS architectures are arm64 and x86_64." >&2; exit 3 ;;
esac

LOCAL_BIN="$HOME/.local/bin"
MISE_DATA_DIR="$HOME/.local/share/mise"
MISE_CONFIG_DIR="$HOME/.config/mise"
MISE_CACHE_DIR="$HOME/.cache/mise"
MISE_BIN="$LOCAL_BIN/mise"
UV_BIN="$LOCAL_BIN/uv"
BACKUP_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ai-foundry-desk/backups/layer1-profile"

if [ "$MODE" = "--dry-run" ]; then
  echo "[dry-run] install checksum-pinned mise $MISE_VERSION and uv $UV_VERSION for $(uname -m) in $LOCAL_BIN"
  echo "[dry-run] configure Python 3.14, Node 24, Go 1.26, Rust 1.98.0 and pnpm $PNPM_VERSION"
  echo "[dry-run] set UV_NO_MANAGED_PYTHON=1, UV_PYTHON_DOWNLOADS=0 and mise not_found_auto_install=false"
  echo "[dry-run] integrity-check and install $ALLOW_SCRIPTS_PACKAGE@$ALLOW_SCRIPTS_VERSION with lifecycle scripts disabled"
  echo "[dry-run] update only managed blocks in ~/.zprofile and ~/.zshrc after backup"
  echo "[dry-run] Docker Desktop is a separate Layer 1 host-capability adapter"
  exit 0
fi

for command in curl shasum tar install; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required." >&2; exit 4; }
done
mkdir -p "$LOCAL_BIN"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/afd-layer1-macos.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

download_verified() {
  url="$1" expected="$2" destination="$3"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$destination" "$url"
  actual="$(shasum -a 256 "$destination" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || { echo "Checksum verification failed for $url." >&2; exit 5; }
}

if [ ! -x "$MISE_BIN" ] || [ "$($MISE_BIN --version 2>/dev/null | awk '{print $1}')" != "$MISE_VERSION" ]; then
  download_verified "https://github.com/jdx/mise/releases/download/v$MISE_VERSION/$MISE_ASSET" "$MISE_SHA256" "$tmp/mise"
  install -m 0755 "$tmp/mise" "$MISE_BIN"
fi
if [ ! -x "$UV_BIN" ] || ! "$UV_BIN" --version 2>/dev/null | grep -q "uv $UV_VERSION"; then
  archive="$tmp/uv.tar.gz"
  download_verified "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$UV_TARGET.tar.gz" "$UV_SHA256" "$archive"
  tar -xzf "$archive" -C "$tmp"
  install -m 0755 "$tmp/uv-$UV_TARGET/uv" "$UV_BIN"
  install -m 0755 "$tmp/uv-$UV_TARGET/uvx" "$LOCAL_BIN/uvx"
fi

export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
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
  exit 6
fi

export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME/bin:$PATH"
installed_allow_scripts="$(allow-scripts --version 2>/dev/null | sed 's/^v//' || true)"
if [ "$installed_allow_scripts" = "$ALLOW_SCRIPTS_VERSION" ]; then
  echo "$ALLOW_SCRIPTS_PACKAGE $ALLOW_SCRIPTS_VERSION is already installed."
else
  observed_integrity="$(pnpm view "$ALLOW_SCRIPTS_PACKAGE@$ALLOW_SCRIPTS_VERSION" dist.integrity --json | tr -d '"\r\n')"
  [ "$observed_integrity" = "$ALLOW_SCRIPTS_INTEGRITY" ] || { echo "Registry integrity mismatch for $ALLOW_SCRIPTS_PACKAGE@$ALLOW_SCRIPTS_VERSION." >&2; exit 7; }
  pnpm add --global --ignore-scripts "$ALLOW_SCRIPTS_PACKAGE@$ALLOW_SCRIPTS_VERSION"
  [ "$(allow-scripts --version 2>/dev/null | sed 's/^v//' || true)" = "$ALLOW_SCRIPTS_VERSION" ] || { echo "allow-scripts verification failed." >&2; exit 7; }
  echo "Installed $ALLOW_SCRIPTS_PACKAGE $ALLOW_SCRIPTS_VERSION with lifecycle scripts disabled."
fi

managed_block='# >>> AI Foundry Desk Layer 1 >>>
# Managed by AI Foundry Desk. Layers 1-3 run natively; Docker is not an execution wrapper.
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"
export MISE_DATA_DIR="$HOME/.local/share/mise"
export MISE_CONFIG_DIR="$HOME/.config/mise"
export MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml"
export MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
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
update_profile "$HOME/.zprofile"
update_profile "$HOME/.zshrc"

test_dir="$(mktemp -d "${TMPDIR:-/tmp}/afd-hardlink-macos.XXXXXX")"
printf layer1 > "$test_dir/source"
ln "$test_dir/source" "$test_dir/link"
[ "$(cat "$test_dir/link")" = layer1 ]
rm -rf "$test_dir"
echo "macOS Layer 1 runtime foundation applied. Docker remains a separate native host capability."
