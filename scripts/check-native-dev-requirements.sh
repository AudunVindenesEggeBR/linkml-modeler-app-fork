#!/usr/bin/env bash
# Preflight check for the native (non-container) dev setup in
# scripts/setup-native-dev.sh -- verifies the host actually satisfies what
# that script assumes, BEFORE running it, and can also be re-run afterward
# to confirm the setup is still intact (e.g. after a fresh `git clone`,
# which won't carry over the native node_modules symlinks).
#
# Read-only: makes no changes. See scripts/setup-native-dev.sh's header for
# why this setup exists and what "native" means here.
#
# Usage: ./scripts/check-native-dev-requirements.sh
# Exit code: 0 if everything passes, 1 if anything failed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIN_NODE_MAJOR=20
PNPM_LOCKFILE_MAJOR=9 # must match this repo's pnpm-lock.yaml lockfileVersion major
FAILED=0
FIX_COMMANDS=()

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { printf '  \033[31mFEIL\033[0m  %s\n' "$1"; FAILED=1; }
info() { printf '        %s\n' "$1"; }
fix()  { printf '        \033[36m-> %s\033[0m\n' "$1"; FIX_COMMANDS+=("$1"); }

# ── filesystem type helper (works with either `findmnt` or `stat -f`) ──────

fstype_of() {
  local path="$1"
  if command -v findmnt >/dev/null 2>&1; then
    findmnt -no FSTYPE --target "$path" 2>/dev/null
  else
    stat -f -c '%T' "$path" 2>/dev/null
  fi
}

is_slow_mount() {
  case "$1" in
    9p|drvfs|cifs|smb*|nfs*) return 0 ;;
    *) return 1 ;;
  esac
}

# ── 1. Node ──────────────────────────────────────────────────────────────────

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    fail "node is not on PATH."
    fix "./scripts/setup-native-dev.sh"
    return
  fi
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if (( major < MIN_NODE_MAJOR )); then
    fail "node $(node --version) found, but >=${MIN_NODE_MAJOR}.0.0 is required (see package.json engines.node)."
    fix "./scripts/setup-native-dev.sh"
  else
    ok "node $(node --version) (>= $MIN_NODE_MAJOR required)."
  fi
}

# ── 2. pnpm, pinned to a lockfile-compatible major ──────────────────────────

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm is not on PATH."
    fix "./scripts/setup-native-dev.sh"
    return
  fi
  local version major
  version="$(pnpm --version)"
  major="${version%%.*}"
  if (( major != PNPM_LOCKFILE_MAJOR )); then
    fail "pnpm $version found, but this repo's pnpm-lock.yaml needs major version $PNPM_LOCKFILE_MAJOR.x (a newer major, e.g. pnpm 12, drops support for the legacy pnpm.overrides field this repo's package.json still uses -- see CLAUDE.md)."
    fix "corepack prepare pnpm@9.15.9 --activate"
  else
    ok "pnpm $version (lockfile-compatible major $PNPM_LOCKFILE_MAJOR)."
  fi
}

# ── 3. Is the repo itself on a slow bind-mount? (informational, not a
#      failure -- this is the whole REASON the native setup exists) ────────

check_repo_mount() {
  local fstype
  fstype="$(fstype_of "$REPO_ROOT")"
  if is_slow_mount "$fstype"; then
    info "Repo lives on a '$fstype' mount ($REPO_ROOT) -- this is exactly the"
    info "situation scripts/setup-native-dev.sh is for (relocates node_modules"
    info "off this filesystem without moving the repo itself)."
  fi
  ok "Repo filesystem: $fstype${fstype:+ }(informational)."
}

# ── 4. Is $HOME actually on a FAST filesystem? If not, native relocation
#      buys nothing -- this is a real prerequisite, not just informational ──

check_home_mount() {
  local fstype
  fstype="$(fstype_of "$HOME")"
  if is_slow_mount "$fstype"; then
    fail "\$HOME ($HOME) is itself on a slow '$fstype' mount -- relocating node_modules there would not help. Pick a different native-disk location and adjust scripts/setup-native-dev.sh's NATIVE_BASE."
  else
    ok "\$HOME filesystem: $fstype (native, suitable for relocated node_modules)."
  fi
}

# ── 5. Cross-filesystem relative-symlink write actually works ─────────────
# On WSL2 drvfs, an ABSOLUTE symlink from the repo's mount to a native path
# is silently broken (reads/writes through it fail); a RELATIVE symlink
# works for basic read/write. The pattern that actually matters, though, is
# narrower and nastier: `fs.mkdir(path, {recursive:true})` called DIRECTLY
# on a symlink path that ALREADY points to an existing native directory --
# this is exactly what pnpm's `headlessInstall` does for `node_modules`
# itself on its very first step.
#
# IMPORTANT, HONESTLY: this exact isolated probe was found to succeed
# reliably (5/5 runs) even during a stretch where REAL `pnpm install` runs
# through the identical symlink setup were failing 5 of 6 times with the
# identical ENOTDIR/ENOENT error. So a green check here is NOT a guarantee
# that scripts/setup-native-dev.sh's relocation will succeed -- it only
# rules out the simplest version of the problem. Something specific to
# pnpm's actual install process (not this simplified pattern) appears to be
# the real trigger, and is not understood yet. See
# specs/backlog/test-timing-instrumentation-and-reliability.md for the full
# saga. Treat this check as "not obviously broken," not "confirmed working."

check_symlink_crossing() {
  local test_dir="$REPO_ROOT/.native-dev-check-tmp"
  local native_target="$HOME/.cache/native-dev-check-native-$$"
  local successes=0 attempts=3

  for i in $(seq 1 "$attempts"); do
    rm -rf "$test_dir" "$native_target"
    mkdir -p "$test_dir" "$native_target"

    local rel_target
    rel_target="$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$native_target" "$test_dir" 2>/dev/null)"
    if [[ -z "$rel_target" ]]; then
      fail "Could not compute a relative path (python3 missing?) -- cannot verify the symlink workaround."
      rm -rf "$test_dir" "$native_target"
      return
    fi

    # Symlink points at a directory that ALREADY exists -- matching pnpm's
    # actual pattern for node_modules, not a not-yet-created subdirectory.
    ln -s "$rel_target" "$test_dir/link"
    stat "$test_dir/link" >/dev/null 2>&1
    ls "$test_dir/link" >/dev/null 2>&1

    if node -e "require('fs').promises.mkdir(process.argv[1], {recursive:true}).then(()=>process.exit(0)).catch(()=>process.exit(1))" "$test_dir/link" 2>/dev/null; then
      successes=$((successes + 1))
    fi
    rm -rf "$test_dir" "$native_target"
  done

  if (( successes == attempts )); then
    ok "fs.mkdir(recursive) on an existing cross-filesystem symlink succeeded $successes/$attempts times (not a guarantee -- see comment above)."
  elif (( successes > 0 )); then
    fail "fs.mkdir(recursive) on an existing cross-filesystem symlink only succeeded $successes/$attempts times -- inconsistent on this host, matching the known unreliable-relocation issue."
    info "scripts/setup-native-dev.sh retries and verifies real content, then falls back to a plain install if relocation can't be confirmed -- expect that fallback to trigger sometimes."
  else
    fail "fs.mkdir(recursive) on an existing cross-filesystem symlink failed all $attempts/$attempts times."
    info "scripts/setup-native-dev.sh's relocation will very likely fail here too; it will fall back to a plain (non-relocated) install automatically."
  fi
}

# ── 6. Playwright/Chromium system shared libraries (needed for local E2E,
#      including via .githooks/pre-push's now-native-capable E2E step) ─────
# Not part of node/pnpm relocation, but discovered as a hard local-E2E
# blocker while verifying the pre-push `mount --bind` change (see
# specs/backlog/test-timing-instrumentation-and-reliability.md, "Del 2c" /
# "Tilråding"). `playwright install` (without `--with-deps`) only downloads
# the browser binary -- it does NOT install these OS-level shared library
# dependencies, so a fresh minimal host (this one included, Ubuntu 26.04)
# needs them installed separately, once, with sudo.

check_playwright_system_deps() {
  local pkgs=(libnspr4 libnss3 libasound2t64)
  local missing=()
  for pkg in "${pkgs[@]}"; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if (( ${#missing[@]} > 0 )); then
    fail "Missing system packages for headless Chromium (Playwright E2E): ${missing[*]}"
    fix "sudo apt-get update && sudo apt-get install -y libnspr4 libnss3 libasound2t64"
    info "Confirmed via ldd on the downloaded chrome-headless-shell binary + apt-get download/dpkg -c package inspection (2026-09-10, Ubuntu 26.04): libnspr4 -> libnspr4.so, libnss3 -> libnss3.so AND libnssutil3.so (bundled together, not a separate package), libasound2t64 -> libasound.so.2 (the t64 name, not libasound2, on this Ubuntu version)."
  else
    ok "Playwright/Chromium system packages present (libnspr4, libnss3, libasound2t64)."
  fi
}

# ── 7. Existing native setup, if any (informational) ───────────────────────

check_existing_setup() {
  if [[ -L "$REPO_ROOT/node_modules" ]]; then
    local target
    target="$(readlink -f "$REPO_ROOT/node_modules" 2>/dev/null)"
    local target_fstype
    target_fstype="$(fstype_of "$target")"
    if is_slow_mount "$target_fstype"; then
      fail "node_modules is a symlink, but it points back onto a slow mount ($target_fstype): $target"
      fix "./scripts/setup-native-dev.sh"
    else
      ok "node_modules already relocated to native disk ($target_fstype): $target"
    fi
  else
    info "node_modules is not yet relocated (run scripts/setup-native-dev.sh to set it up)."
  fi
}

# ── run ──────────────────────────────────────────────────────────────────────

echo "Checking native dev setup requirements for $REPO_ROOT ..."
echo
check_node
check_pnpm
check_repo_mount
check_home_mount
check_symlink_crossing
check_playwright_system_deps
check_existing_setup
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
  echo "All checks passed."
  exit 0
fi
