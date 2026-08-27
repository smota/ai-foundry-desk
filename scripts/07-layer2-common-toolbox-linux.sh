#!/bin/sh
set -eu
AFD_INHERITED_USERPROFILE="${USERPROFILE:-}"
AFD_CALLER_DIR="$PWD"
MODE="${1:-}"
[ "$MODE" = "--dry-run" ] || [ "$MODE" = "--apply" ] || { echo "Usage: 07-layer2-common-toolbox-linux.sh --dry-run|--apply" >&2; exit 2; }
export MISE_DATA_DIR="$HOME/.local/share/mise" MISE_CONFIG_DIR="$HOME/.config/mise" MISE_CACHE_DIR="$HOME/.cache/mise"
export MISE_GLOBAL_CONFIG_FILE="$HOME/.config/mise/config.toml" MISE_CONFIG_FILE="$HOME/.config/mise/config.toml"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
case "$AFD_INHERITED_USERPROFILE" in /mnt/*) afd_windows_home="$AFD_INHERITED_USERPROFILE";; ?:\\*) afd_windows_home="$(wslpath -u "$AFD_INHERITED_USERPROFILE")";; *) afd_windows_home="";; esac
case "$AFD_CALLER_DIR" in /mnt/?/Users/*) afd_windows_home="$(printf '%s' "$AFD_CALLER_DIR" | cut -d/ -f1-5)";; esac
[ -z "$afd_windows_home" ] || export MISE_IGNORED_CONFIG_PATHS="$afd_windows_home/.config/mise${MISE_IGNORED_CONFIG_PATHS:+:$MISE_IGNORED_CONFIG_PATHS}"
export USERPROFILE="$HOME"
export PATH="$HOME/.local/bin:$MISE_DATA_DIR/shims:$PATH"
cd "$HOME"
TOOLS='github:BurntSushi/ripgrep@15.2.0 github:sharkdp/fd@10.5.0 github:jqlang/jq@jq-1.8.2 github:mikefarah/yq@4.53.6 github:sharkdp/bat@0.26.1 github:dandavison/delta@0.19.2'
if [ "$MODE" = "--dry-run" ]; then
  for tool in $TOOLS; do echo "[dry-run] ensure $tool through mise github"; done
  echo '[dry-run] RTK, fzf, zoxide, eza and sd remain excluded'
  exit 0
fi
command -v mise >/dev/null 2>&1 || { echo "Layer 1 mise is required." >&2; exit 4; }
for tool in $TOOLS; do mise use --global "$tool"; done
mise reshim
yq_root="$(mise where github:mikefarah/yq)"
if [ -x "$yq_root/yq_linux_amd64" ]; then ln -sfn "$yq_root/yq_linux_amd64" "$HOME/.local/bin/yq"; fi
for command in rg fd jq yq bat delta; do command -v "$command" >/dev/null 2>&1 || { echo "$command is missing after installation." >&2; exit 5; }; "$command" --version | head -n1; done
echo 'Linux Common Agent Toolbox is ready. No container was used.'
