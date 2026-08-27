#!/bin/sh
set -eu
AFD_INHERITED_USERPROFILE="${USERPROFILE:-}"
AFD_CALLER_DIR="$PWD"
JSON=0; [ "${1:-}" != "--json" ] || JSON=1
export MISE_DATA_DIR="$HOME/.local/share/mise" MISE_CONFIG_DIR="$HOME/.config/mise" MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
case "$AFD_INHERITED_USERPROFILE" in /mnt/*) afd_windows_home="$AFD_INHERITED_USERPROFILE";; ?:\\*) afd_windows_home="$(wslpath -u "$AFD_INHERITED_USERPROFILE")";; *) afd_windows_home="";; esac
case "$AFD_CALLER_DIR" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$AFD_CALLER_DIR" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$HOME/.local/share/pnpm/bin:$PATH"
cd "$HOME"
results=""; failures=0
add() { severity="$1" code="$2" summary="$3" evidence="$4" suggestion="$5"; [ "$severity" != FAIL ] || failures=$((failures+1)); item="{\"category\":\"foundation\",\"severity\":\"$severity\",\"code\":\"$code\",\"summary\":\"$summary\",\"evidence\":\"$evidence\",\"suggestion\":\"$suggestion\"}"; results="${results}${results:+,}$item"; [ "$JSON" -eq 1 ] || printf '%s %s - %s\n     Evidence: %s\n     Next: %s\n' "$severity" "$code" "$summary" "$evidence" "$suggestion"; }
if [ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]; then add PASS platform.linux-x64 'Validated platform' "$(uname -srmo)" 'No action'; else add FAIL platform.linux-x64 'Unsupported platform' "$(uname -srmo)" 'Use Linux x86_64'; fi
for command in mise uv pnpm python node go rustc cargo docker; do if command -v "$command" >/dev/null 2>&1; then add PASS "command.$command" "$command available" "$(command -v "$command")" 'No action'; else add FAIL "command.$command" "$command missing" missing "Run afd fix layer1 --dry-run"; fi; done
if command -v docker >/dev/null 2>&1; then add PASS docker.native-policy 'Docker installed as an optional host tool' "$(docker --version 2>/dev/null || true)" 'Do not use Docker to execute Layers 1-3'; fi
if [ "$JSON" -eq 1 ]; then printf '{"schemaVersion":1,"product":"AI Foundry Desk","command":"doctor","platform":"linux-x64","results":[%s]}\n' "$results"; fi
[ "$failures" -eq 0 ]
