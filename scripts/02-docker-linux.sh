#!/bin/sh
set -eu

MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--apply" ] || { echo "Usage: 02-docker-linux.sh --dry-run|--apply" >&2; exit 2; }
[ "$(uname -s)" = Linux ] || { echo "Docker adapter supports Linux only." >&2; exit 3; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "Validated Docker package adapter requires Ubuntu." >&2; exit 3; }

if [ "$MODE" = "--dry-run" ]; then
  echo "[dry-run] configure Docker's signed Ubuntu apt repository"
  echo "[dry-run] install docker-ce, docker-ce-cli, containerd.io, buildx and compose plugins"
  echo "[dry-run] enable/start docker.service when systemd is active"
  echo "[dry-run] do not add users to the root-equivalent docker group"
  echo "[dry-run] Layers 1-3 continue to run natively, never inside Docker"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || { echo "Docker installation requires root. Review dry-run, then run with sudo." >&2; exit 6; }
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --location --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
arch="$(dpkg --print-architecture)"
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' "$arch" "$VERSION_CODENAME" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
if [ "$(ps -p 1 -o comm= | tr -d ' ')" = systemd ]; then systemctl enable --now docker.service containerd.service; fi
docker version --format 'Docker client={{.Client.Version}} server={{.Server.Version}}'
docker compose version
echo "Docker is installed as a native Layer 1 tool. No user was added to the docker group."
