#!/bin/sh
set -eu

MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--apply" ] || { echo "Usage: 02-docker-macos.sh --dry-run|--apply" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "Docker Desktop adapter supports macOS only." >&2; exit 3; }

DOCKER_VERSION="4.89.0"
DOCKER_BUILD="238018"
case "$(uname -m)" in
  arm64)
    DOCKER_ARCH="arm64"
    DOCKER_SHA256="d333f7c8d42f746429ab1f32ad3284efec887e2a08c03b2ed373a7091373e392"
    ;;
  x86_64)
    DOCKER_ARCH="amd64"
    DOCKER_SHA256="cb22c74b9c6c9c2768d64459828b6c2b0ab4d5b7ace4b28f0979d7de4f28e336"
    ;;
  *) echo "Supported macOS architectures are arm64 and x86_64." >&2; exit 3 ;;
esac
DOCKER_URL="https://desktop.docker.com/mac/main/$DOCKER_ARCH/$DOCKER_BUILD/Docker.dmg"

product_version="$(sw_vers -productVersion)"
product_major="${product_version%%.*}"
case "$product_major" in ''|*[!0-9]*) echo "Could not determine the macOS version." >&2; exit 3;; esac
[ "$product_major" -ge 14 ] || { echo "Docker Desktop $DOCKER_VERSION requires a currently supported macOS release (macOS 14 or newer)." >&2; exit 3; }

find_docker_app() {
  for app in /Applications/Docker.app "$HOME/Applications/Docker.app"; do
    [ -d "$app" ] && { printf '%s\n' "$app"; return 0; }
  done
  return 1
}

docker_app="$(find_docker_app || true)"
if [ -n "$docker_app" ]; then
  echo "Docker Desktop is already installed at $docker_app. No reinstall is required."
elif [ "$MODE" = "--dry-run" ]; then
  echo "[dry-run] download Docker Desktop $DOCKER_VERSION ($DOCKER_BUILD) for $DOCKER_ARCH from Docker"
  echo "[dry-run] verify the official SHA-256 before mounting the DMG"
  echo "[dry-run] run only Docker's verified installer with macOS administrator authorization"
  echo "[dry-run] do not launch Docker Desktop, accept its license, or preconfigure privileged settings"
  exit 0
else
  for command in curl shasum hdiutil osascript codesign; do
    command -v "$command" >/dev/null 2>&1 || { echo "$command is required." >&2; exit 4; }
  done
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/afd-docker-macos.XXXXXX")"
  mount="$tmp/mount"
  dmg="$tmp/Docker.dmg"
  attached=0
  cleanup() {
    [ "$attached" -eq 0 ] || hdiutil detach "$mount" >/dev/null 2>&1 || true
    rm -rf "$tmp"
  }
  trap cleanup EXIT HUP INT TERM
  mkdir -p "$mount"
  curl --fail --location --proto '=https' --tlsv1.2 --output "$dmg" "$DOCKER_URL"
  actual="$(shasum -a 256 "$dmg" | awk '{print $1}')"
  [ "$actual" = "$DOCKER_SHA256" ] || { echo "Docker Desktop checksum verification failed." >&2; exit 5; }
  hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
  attached=1
  installer="$mount/Docker.app/Contents/MacOS/install"
  [ -x "$installer" ] || { echo "The verified Docker image does not contain the expected installer." >&2; exit 5; }
  codesign --verify --deep --strict "$mount/Docker.app"
  echo "Requesting administrator authorization for Docker's verified installer..."
  osascript -e 'on run argv' \
    -e 'do shell script quoted form of (item 1 of argv) with administrator privileges' \
    -e 'end run' "$installer"
  docker_app="$(find_docker_app || true)"
  [ -n "$docker_app" ] || { echo "Docker Desktop installation completed without creating Docker.app." >&2; exit 6; }
fi

docker_cli="$docker_app/Contents/Resources/bin/docker"
[ -x "$docker_cli" ] || { echo "Docker Desktop is installed but its bundled Docker CLI is missing." >&2; exit 6; }
docker_version="$($docker_cli --version 2>/dev/null | sed -n '1p')"
compose_version="$($docker_cli compose version 2>/dev/null | sed -n '1p')"
if ! printf '%s' "$compose_version" | grep -Eq '^Docker Compose version '; then
  compose_cli="$docker_app/Contents/Resources/cli-plugins/docker-compose"
  [ ! -x "$compose_cli" ] || compose_version="$($compose_cli version 2>/dev/null | sed -n '1p')"
fi
printf '  %s\n  %s\n' "$docker_version" "$compose_version"
printf '%s' "$docker_version" | grep -Eq '^Docker version ' || { echo "Docker CLI verification failed." >&2; exit 6; }
printf '%s' "$compose_version" | grep -Eq '^Docker Compose version ' || { echo "Docker Compose verification failed." >&2; exit 6; }
if daemon_version="$($docker_cli info --format '{{.ServerVersion}}' 2>/dev/null)" && [ -n "$daemon_version" ]; then
  echo "  Docker daemon available: $daemon_version"
else
  echo "WARN Docker Desktop is installed but not running. Start it interactively, review the license, and choose settings when containers are needed."
fi
echo "Docker Desktop Layer 1 host capability verified. Layers 1-3 remain native."
