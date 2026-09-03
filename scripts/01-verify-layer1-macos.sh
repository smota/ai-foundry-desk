#!/bin/sh
set -eu

[ "$#" -eq 0 ] || { echo "Usage: 01-verify-layer1-macos.sh" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "This verifier supports macOS only." >&2; exit 3; }
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.local/share/pnpm/bin:$PATH"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
export MISE_DATA_DIR="$HOME/.local/share/mise" MISE_CONFIG_DIR="$HOME/.config/mise" MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export UV_NO_MANAGED_PYTHON=1 UV_PYTHON_DOWNLOADS=0 PNPM_HOME="$HOME/.local/share/pnpm"
failed=0
check() { name="$1" pattern="$2"; shift 2; value="$("$@" 2>/dev/null | sed -n '1p' || true)"; if printf '%s' "$value" | grep -Eq "$pattern"; then echo "OK $name $value"; else echo "FAIL $name ${value:-missing}"; failed=$((failed+1)); fi; }
resolve_docker() {
  command -v docker 2>/dev/null && return 0
  for candidate in /Applications/Docker.app/Contents/Resources/bin/docker "$HOME/Applications/Docker.app/Contents/Resources/bin/docker"; do [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }; done
  return 1
}

check python '^Python 3\.14\.' python --version
check node '^v24\.' node --version
check go '^go version go1\.26\.' go version
check rust '^rustc 1\.98\.0' rustc --version
check allow-scripts '^v?5\.1\.0$' allow-scripts --version
[ "$(mise settings get not_found_auto_install 2>/dev/null || true)" = false ] || { echo 'FAIL mise auto-install guard'; failed=$((failed+1)); }
uv_python="$(uv python find --no-python-downloads 2>/dev/null || true)"
printf '%s' "$uv_python" | grep -Eq '/mise/installs/python/3\.14' || { echo "FAIL uv mise provenance ${uv_python:-missing}"; failed=$((failed+1)); }
for profile in "$HOME/.zprofile" "$HOME/.zshrc"; do
  [ -f "$profile" ] && grep -Fq '# >>> AI Foundry Desk Layer 1 >>>' "$profile" && grep -Fq '# <<< AI Foundry Desk Layer 1 <<<' "$profile" || { echo "FAIL managed profile $profile"; failed=$((failed+1)); }
done
docker_cli="$(resolve_docker || true)"
if [ -n "$docker_cli" ]; then
  check docker '^Docker version ' "$docker_cli" --version
  compose_cli="$(dirname "$(dirname "$docker_cli")")/cli-plugins/docker-compose"
  if [ -x "$compose_cli" ]; then check compose '^Docker Compose version ' "$compose_cli" version; else check compose '^Docker Compose version ' "$docker_cli" compose version; fi
  "$docker_cli" info >/dev/null 2>&1 || echo 'WARN Docker Desktop is installed but not running; start it interactively when needed.'
else
  echo 'FAIL Docker Desktop missing'; failed=$((failed+1))
fi
[ "$failed" -eq 0 ]
