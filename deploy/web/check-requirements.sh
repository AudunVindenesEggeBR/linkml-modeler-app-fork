#!/usr/bin/env bash
# Preflight check for running deploy/web/ locally with Podman (or Docker).
#
# Verifies the host actually has what's needed BEFORE anyone runs
# `podman-compose up --build`, so a failure points at the real cause
# (missing tool, unconfigured rootless podman, a taken port) instead of a
# confusing error partway through a build. Deliberately dependency-free
# (plain bash) so it works even when nothing else is installed yet.
#
# Usage: ./deploy/web/check-requirements.sh
# Exit code: 0 if everything passes, 1 if anything failed.
#
# WEB_PORT, if set, is checked instead of the default 8080 — keep this in
# sync with the WEB_PORT variable docker-compose.yml reads.

set -uo pipefail

# Resolve the compose file's absolute path so every suggested command below
# works regardless of where this script is actually invoked from -- e.g.
# `cd deploy/web && ./check-requirements.sh` (natural, since that's where
# this script lives) vs. `./deploy/web/check-requirements.sh` from the repo
# root both need to print a command that actually works from the caller's
# cwd. A hardcoded repo-root-relative path broke the first case.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

MIN_PODMAN_MAJOR=4
WEB_PORT="${WEB_PORT:-8080}"
FAILED=0
FIX_COMMANDS=()

# ── formatting ──────────────────────────────────────────────────────────────
# The fix line is printed right under the FEIL line in its own color (not
# just plain/indented) so it can't be mistaken for incidental detail, AND
# every fix is repeated in one consolidated block at the end -- so even a
# quick skim of the final lines is enough to find every command to run.

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() {
  printf '  \033[31mFEIL\033[0m  %s\n' "$1"
  FAILED=1
}
# info: an explanatory line under a FEIL (context, not a copy-paste command).
info() { printf '        %s\n' "$1"; }
# fix: an actual command the user can copy-paste to resolve the FEIL above.
# Printed in its own color right where it's relevant, AND collected for the
# "Fixes to run" summary at the end.
fix() {
  printf '        \033[36m-> %s\033[0m\n' "$1"
  FIX_COMMANDS+=("$1")
}

# ── package-manager detection, for tailored install commands ───────────────

pkg_install_cmd() {
  # $1: apt/dnf/pacman package name, $2: brew package name (defaults to $1)
  local pkg="$1" brew_pkg="${2:-$1}"
  if command -v apt-get >/dev/null 2>&1; then
    echo "sudo apt-get update && sudo apt-get install -y $pkg"
  elif command -v dnf >/dev/null 2>&1; then
    echo "sudo dnf install -y $pkg"
  elif command -v pacman >/dev/null 2>&1; then
    echo "sudo pacman -S $pkg"
  elif command -v brew >/dev/null 2>&1; then
    echo "brew install $brew_pkg"
  else
    echo "" # caller falls back to a doc link when this is empty
  fi
}

# ── 1. podman present and new enough ────────────────────────────────────────

check_podman() {
  if ! command -v podman >/dev/null 2>&1; then
    fail "podman is not installed."
    local cmd; cmd=$(pkg_install_cmd podman)
    if [[ -n "$cmd" ]]; then fix "$cmd"; else fix "see https://podman.io/docs/installation"; fi
    return
  fi

  local version major
  version=$(podman --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  major=${version%%.*}

  if [[ -z "$version" ]]; then
    fail "Could not determine podman version from 'podman --version'."
    fix "run 'podman --version' yourself and check https://podman.io/docs/installation"
    return
  fi

  if (( major < MIN_PODMAN_MAJOR )); then
    fail "podman $version is installed, but $MIN_PODMAN_MAJOR.0+ is needed (compose networking/DNS support varies a lot across major versions)."
    local cmd; cmd=$(pkg_install_cmd podman)
    if [[ -n "$cmd" ]]; then fix "$cmd  # upgrade"; else fix "see https://podman.io/docs/installation"; fi
  else
    ok "podman $version found."
  fi
}

# ── 2. podman actually works (rootless setup complete) ──────────────────────

check_podman_info() {
  if ! command -v podman >/dev/null 2>&1; then
    return # already reported by check_podman
  fi
  if podman info >/dev/null 2>&1; then
    ok "podman info runs cleanly (rootless setup looks complete)."
  else
    fail "'podman info' failed -- rootless podman isn't fully set up."
    info "This is usually a missing subuid/subgid range."
    fix "sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 \$(whoami) && podman system migrate"
    info "Then re-run this script. Full troubleshooting: https://github.com/containers/podman/blob/main/troubleshooting.md"
  fi
}

# ── 3. a compose tool podman can use ─────────────────────────────────────────

check_compose_tool() {
  if command -v podman-compose >/dev/null 2>&1; then
    # `podman-compose --version` prints "podman version X" on line 1 and
    # "podman-compose version Y" on line 2 -- grep for the right one instead
    # of assuming line order (confirmed on podman-compose 1.5.0).
    local pc_version
    pc_version=$(podman-compose --version 2>&1 | grep -i 'podman-compose' | head -1)
    ok "podman-compose found (${pc_version:-podman-compose})."
  elif command -v docker-compose >/dev/null 2>&1; then
    ok "docker-compose found (podman compose will use it as a fallback)."
  else
    fail "Neither podman-compose nor docker-compose is installed."
    # Prefer the distro package where one exists (Debian/Ubuntu and Fedora
    # both ship podman-compose) -- only fall back to pip/pipx when there's
    # no system package manager with it.
    if command -v apt-get >/dev/null 2>&1; then
      fix "sudo apt-get update && sudo apt-get install -y podman-compose"
    elif command -v dnf >/dev/null 2>&1; then
      fix "sudo dnf install -y podman-compose"
    elif command -v pacman >/dev/null 2>&1; then
      fix "sudo pacman -S podman-compose"
    elif command -v pipx >/dev/null 2>&1; then
      fix "pipx install podman-compose"
    elif command -v pip3 >/dev/null 2>&1 || command -v pip >/dev/null 2>&1; then
      fix "pip install --user podman-compose  # or: pipx install podman-compose"
    else
      info "No pipx/pip found either -- install pipx first, then podman-compose."
      fix "see https://github.com/containers/podman-compose#installation"
    fi
  fi
}

# ── 4. the port we want to bind is free ─────────────────────────────────────

check_port() {
  local holder=""
  if command -v ss >/dev/null 2>&1; then
    holder=$(ss -ltnp 2>/dev/null | awk -v p=":$WEB_PORT" '$4 ~ p {print; exit}')
  elif command -v lsof >/dev/null 2>&1; then
    holder=$(lsof -iTCP:"$WEB_PORT" -sTCP:LISTEN -P 2>/dev/null | tail -n +2 | head -1)
  fi

  if [[ -n "$holder" ]]; then
    fail "Port $WEB_PORT is already in use."
    info "Holder: $holder"
    info "Either stop that process, or use a different port for this stack:"
    fix "WEB_PORT=8081 podman-compose -f \"$COMPOSE_FILE\" up --build"
  else
    ok "Port $WEB_PORT is free."
  fi
}

# ── run ──────────────────────────────────────────────────────────────────────

echo "Checking local requirements for deploy/web/ ..."
echo
check_podman
check_podman_info
check_compose_tool
check_port
echo

if [[ "$FAILED" == "1" ]]; then
  echo "One or more checks failed. Fixes to run, in order:"
  for cmd in "${FIX_COMMANDS[@]}"; do
    printf '  \033[36m%s\033[0m\n' "$cmd"
  done
  echo
  echo "Then re-run this script to confirm."
  exit 1
else
  echo "All checks passed. You can run:"
  echo "  podman-compose -f \"$COMPOSE_FILE\" up --build"
  exit 0
fi
