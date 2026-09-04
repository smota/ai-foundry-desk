#!/bin/sh
set -eu

JSON=0
[ "${1:-}" != "--json" ] || JSON=1
[ "$#" -le 1 ] && { [ "$#" -eq 0 ] || [ "$1" = "--json" ]; } || { echo "Usage: 01-doctor-layer1-macos.sh [--json]" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "This doctor supports macOS only." >&2; exit 3; }

results=""; failures=0
escape_json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
add() {
  category="$1" severity="$2" code="$3" summary="$4" evidence="$5" suggestion="$6"
  [ "$severity" != FAIL ] || failures=$((failures+1))
  item="{\"category\":\"$(escape_json "$category")\",\"severity\":\"$severity\",\"code\":\"$(escape_json "$code")\",\"summary\":\"$(escape_json "$summary")\",\"evidence\":\"$(escape_json "$evidence")\",\"suggestion\":\"$(escape_json "$suggestion")\"}"
  results="${results}${results:+,}$item"
  [ "$JSON" -eq 1 ] || printf '%s %s - %s\n     Evidence: %s\n     Next: %s\n' "$severity" "$code" "$summary" "$evidence" "$suggestion"
}
first_line() { "$@" 2>/dev/null | sed -n '1p' || true; }
resolve_docker() {
  command -v docker 2>/dev/null && return 0
  for candidate in /Applications/Docker.app/Contents/Resources/bin/docker "$HOME/Applications/Docker.app/Contents/Resources/bin/docker"; do
    [ -x "$candidate" ] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

arch="$(uname -m)"
case "$arch" in arm64|x86_64) add platform PASS platform.macos "Supported macOS architecture" "$(sw_vers -productVersion)/$arch" "No action";; *) add platform FAIL platform.macos "Unsupported macOS architecture" "$arch" "Use Apple Silicon or Intel macOS";; esac
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.local/share/pnpm/bin:$PATH"
for command in mise uv pnpm python node go rustc cargo allow-scripts; do
  if location="$(command -v "$command" 2>/dev/null)"; then add commands PASS "command.$command" "$command available" "$location" "No action"; else add commands FAIL "command.$command" "$command missing" missing "Run afd fix layer1 --dry-run"; fi
done

check_version() { category="$1" code="$2" summary="$3" value="$4" pattern="$5"; if printf '%s' "$value" | grep -Eq "$pattern"; then add "$category" PASS "$code" "$summary" "$value" "No action"; else add "$category" FAIL "$code" "$summary" "${value:-missing}" "Run afd fix layer1 --dry-run"; fi; }
check_version runtimes runtime.python "Python 3.14" "$(first_line python --version)" '^Python 3\.14\.'
check_version runtimes runtime.node "Node.js 24" "$(first_line node --version)" '^v24\.'
check_version runtimes runtime.go "Go 1.26" "$(first_line go version)" 'go1\.26\.'
check_version runtimes runtime.rust "Rust 1.98.0" "$(first_line rustc --version)" '^rustc 1\.98\.0'
check_version supply-chain-security security.allow-scripts "LavaMoat allow-scripts 5.1.0" "$(first_line allow-scripts --version)" '^v?5\.1\.0$'

docker_cli="$(resolve_docker || true)"
if [ -n "$docker_cli" ]; then
  check_version host-capabilities host.docker-cli "Docker CLI" "$(first_line "$docker_cli" --version)" '^Docker version '
  compose_version="$(first_line "$docker_cli" compose version)"
  if ! printf '%s' "$compose_version" | grep -Eq '^Docker Compose version '; then
    compose_cli="$(dirname "$(dirname "$docker_cli")")/cli-plugins/docker-compose"
    [ ! -x "$compose_cli" ] || compose_version="$(first_line "$compose_cli" version)"
  fi
  check_version host-capabilities host.docker-compose "Docker Compose" "$compose_version" '^Docker Compose version '
  if daemon_version="$($docker_cli info --format '{{.ServerVersion}}' 2>/dev/null)" && [ -n "$daemon_version" ]; then add host-capabilities PASS host.docker-daemon "Docker daemon availability" "$daemon_version" "No action"; else add host-capabilities WARN host.docker-daemon "Docker daemon availability" "installed but not running" "Start Docker Desktop interactively when needed"; fi
else
  add host-capabilities FAIL host.docker-cli "Docker Desktop" missing "Run afd fix layer1 --dry-run"
fi

for profile in "$HOME/.zprofile" "$HOME/.zshrc"; do
  if [ -f "$profile" ] && grep -Fq '# >>> AI Foundry Desk Layer 1 >>>' "$profile" && grep -Fq '# <<< AI Foundry Desk Layer 1 <<<' "$profile"; then add profiles PASS "profile.$(basename "$profile")" "Managed profile block" "$profile" "No action"; else add profiles FAIL "profile.$(basename "$profile")" "Managed profile block" missing "Run afd fix layer1 --dry-run"; fi
done

if [ "$JSON" -eq 1 ]; then printf '{"schemaVersion":1,"product":"AI Foundry Desk","command":"doctor","platform":"macos","results":[%s]}\n' "$results"; fi
[ "$failures" -eq 0 ]
