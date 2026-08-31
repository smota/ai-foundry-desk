#!/bin/sh
set -eu

VERSION="0.4.0"
REPOSITORY="smota/ai-foundry-desk"
PREFIX="${HOME}/.local"
ASSET_DIR=""
DRY_RUN=0

usage() { echo "Usage: afd-bootstrap-posix.sh [--dry-run] [--version VERSION] [--prefix DIR] [--asset-dir DIR]"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --version) shift; VERSION="${1:?missing version}" ;;
    --prefix) shift; PREFIX="${1:?missing prefix}" ;;
    --asset-dir) shift; ASSET_DIR="${1:?missing asset directory}" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

OS="$(uname -s)"
case "$OS" in
  Linux) PLATFORM="linux" ;;
  Darwin)
    echo "macOS bootstrap is experimental and has not been validated on real macOS hardware." >&2
    echo "Install Node.js 24+ and pnpm, then use the local development path until validation exists." >&2
    exit 3 ;;
  *) echo "Unsupported operating system: $OS" >&2; exit 3 ;;
esac

PACKAGE="ai-foundry-desk-${VERSION}.tgz"
CHECKSUM="${PACKAGE}.sha256"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] platform=${PLATFORM} prefix=${PREFIX}"
  echo "[dry-run] would download and verify ${PACKAGE} from GitHub Release v${VERSION}"
  echo "[dry-run] would install only afd; no Layer would run"
  exit 0
fi

command -v node >/dev/null 2>&1 || { echo "Node.js 24+ is required." >&2; exit 4; }
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 24 ] || { echo "Node.js 24+ is required; found $(node --version)." >&2; exit 4; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required." >&2; exit 4; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required." >&2; exit 4; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/afd-bootstrap.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
if [ -n "$ASSET_DIR" ]; then
  cp "${ASSET_DIR}/${PACKAGE}" "$TMP/$PACKAGE"
  cp "${ASSET_DIR}/${CHECKSUM}" "$TMP/$CHECKSUM"
else
  command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 4; }
  BASE="https://github.com/${REPOSITORY}/releases/download/v${VERSION}"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$TMP/$PACKAGE" "$BASE/$PACKAGE"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$TMP/$CHECKSUM" "$BASE/$CHECKSUM"
fi
(cd "$TMP" && sha256sum --check "$CHECKSUM")
mkdir -p "$PREFIX/bin" "$PREFIX/share/pnpm/global"
PATH="$PREFIX/bin:$PATH"
export PATH
pnpm add --global --global-dir "$PREFIX/share/pnpm/global" --global-bin-dir "$PREFIX/bin" --ignore-scripts "$TMP/$PACKAGE"
echo "AI Foundry Desk ${VERSION} installed in ${PREFIX}."
echo "No Layer was applied. Add ${PREFIX}/bin to PATH, then run: afd init --dry-run"
