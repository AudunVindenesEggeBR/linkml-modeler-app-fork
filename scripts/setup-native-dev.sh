#!/usr/bin/env bash
# Sets up a native (non-container) Node/pnpm dev environment for this repo,
# on a host where the repo's own working tree sits on a slow bind-mounted
# filesystem (e.g. WSL2's /mnt/c, a 9p/drvfs mount) that can't be moved.
#
# Why this exists: measured on WSL2 + a 9p/drvfs-mounted repo checkout,
# running `pnpm --filter @linkml-editor/core test` with node_modules on the
# slow mount took ~190-205s and failed with vitest "Timeout waiting for
# worker to respond" on EVERY run (5/5). Relocating just node_modules (and
# pnpm's store) to native disk -- keeping the repo itself on the slow mount
# -- dropped that to ~10-14s with zero failures across 5 runs when it
# worked. See specs/backlog/test-timing-instrumentation-and-reliability.md
# ("Del 2 — Resultat", candidate 0) for the full measurement writeup.
#
# IMPORTANT -- the relocation step below is NOT reliable on this host as
# currently implemented. It succeeded once, then failed on 5 of the next 6
# attempts with `ENOTDIR`/`ENOENT` on pnpm's very first
# `fs.mkdir(node_modules, {recursive:true})` call -- even after ruling out
# several hypotheses (fresh vs. cached packages, symlink count, absolute vs.
# relative targets, a stat+ls "warm-up", brand-new never-touched target
# paths). An isolated reproduction of the *exact same* mkdir-on-an-existing-
# cross-filesystem-symlink pattern succeeds reliably in isolation, which
# means something specific to pnpm's actual install process (not the
# symlink mechanism in general) is the real trigger -- not yet understood.
# See the spec above for the full saga. Given that, this script:
#   1. ALWAYS installs native Node/pnpm and points the pnpm store at native
#      disk -- this part IS reliable and, on its own, cuts a fresh
#      `pnpm install` from ~226s (container) to ~11s (native, no
#      relocation) even without node_modules relocation.
#   2. Attempts the node_modules relocation up to $MAX_ATTEMPTS times,
#      verifying real content landed (not just a zero exit code -- a failed
#      install through these symlinks has been observed to leave the
#      native target directory EMPTY even when pnpm's own exit status
#      doesn't make that obvious from a quick glance).
#   3. If relocation can't be verified within $MAX_ATTEMPTS tries, cleanly
#      falls back to a plain (non-relocated) install and says so plainly --
#      it never leaves the repo half-broken or silently claims a speedup
#      that didn't happen.
#
# Run scripts/check-native-dev-requirements.sh first (or after) to check
# the host's basic prerequisites; it does not guarantee the relocation
# above will succeed, for the reasons above.
#
# Usage: ./scripts/setup-native-dev.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PNPM_VERSION="9.15.9" # keep in sync with CLAUDE.md's container install snippet
NODE_LTS="22"         # matches the node:22-alpine image used in CLAUDE.md's container path
MAX_ATTEMPTS=3
FAILED=0

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
step() { printf '  \033[36m->\033[0m %s\n' "$1"; }
warn() { printf '  \033[33mMERK\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFEIL\033[0m  %s\n' "$1"; FAILED=1; }

# ── 1. Node via nvm ──────────────────────────────────────────────────────────

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  step "nvm not found -- installing to $NVM_DIR ..."
  if ! curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash; then
    fail "nvm install failed. Install it manually: https://github.com/nvm-sh/nvm#installing-and-updating"
    exit 1
  fi
fi
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null)" -lt 20 ]]; then
  step "Installing Node.js $NODE_LTS via nvm ..."
  nvm install "$NODE_LTS"
else
  ok "Node $(node --version) already on PATH."
fi

# ── 2. pnpm via corepack, pinned exactly (see CLAUDE.md for why an exact
#      pin matters: a bare major can silently resolve to an incompatible
#      pnpm major against this repo's lockfileVersion) ────────────────────

step "Enabling corepack and pinning pnpm@$PNPM_VERSION ..."
corepack enable
corepack prepare "pnpm@$PNPM_VERSION" --activate
ok "pnpm $(pnpm --version)"

# ── 3. Native pnpm store ─────────────────────────────────────────────────────

NATIVE_STORE="$HOME/.local/share/pnpm-store"
CURRENT_STORE="$(pnpm config get store-dir 2>/dev/null)"
if [[ "$CURRENT_STORE" != "$NATIVE_STORE" ]]; then
  step "Pointing pnpm store-dir at native disk: $NATIVE_STORE"
  mkdir -p "$NATIVE_STORE"
  pnpm config set store-dir "$NATIVE_STORE" --global
else
  ok "pnpm store-dir already native ($NATIVE_STORE)."
fi

if [[ "$FAILED" == "1" ]]; then
  echo; echo "Fix the issue(s) above and re-run this script."; exit 1
fi

cd "$REPO_ROOT"
WORKSPACE_PKGS=()
for pkg_dir in "$REPO_ROOT"/packages/*/; do
  [[ -f "$pkg_dir/package.json" ]] || continue
  WORKSPACE_PKGS+=("$(basename "$pkg_dir")")
done

# ── 4. Relocate node_modules to native disk, with verification + retry ─────
# Each attempt starts from a clean slate: any leftover symlinks/native
# target dirs from a PRIOR failed attempt are removed first, since a failed
# pnpm install through these symlinks has been observed to leave the native
# target directory emptied out (see file header) -- reusing it across
# attempts would retry against already-corrupted state.

REPO_HASH=$(printf '%s' "$REPO_ROOT" | sha256sum | cut -c1-12)
NATIVE_BASE="$HOME/.cache/native-node-modules/$(basename "$REPO_ROOT")-$REPO_HASH"

reset_relocation_state() {
  # rm -rf, not -f: node_modules may already be a REAL (non-symlink)
  # directory here -- e.g. on the very first run, or after a prior
  # fallback to a plain install -- and plain `rm -f` silently no-ops on a
  # directory (prints "Is a directory" and continues), which would leave
  # the old real node_modules in place and make `ln -s` create a symlink
  # *inside* it instead of replacing it.
  rm -rf "$REPO_ROOT/node_modules"
  for pkg in "${WORKSPACE_PKGS[@]}"; do
    rm -rf "$REPO_ROOT/packages/$pkg/node_modules"
  done
  rm -rf "$NATIVE_BASE"
  mkdir -p "$NATIVE_BASE"
}

link_one() {
  local link_path="$1" native_name="$2"
  local native_path="$NATIVE_BASE/$native_name"
  mkdir -p "$native_path"
  local rel_target
  rel_target="$(python3 -c "import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))" "$native_path" "$(dirname "$link_path")")"
  ln -s "$rel_target" "$link_path"
  # Empirically inconsistent workaround attempt for the drvfs quirk in the
  # file header -- kept because it's harmless and helped once, but do not
  # trust it alone (see MAX_ATTEMPTS retry + verification below instead).
  stat "$link_path" >/dev/null 2>&1
  ls "$link_path" >/dev/null 2>&1
}

# Real verification, not just pnpm's exit code: confirm node_modules is
# still a symlink (a failed install has been seen to leave it as something
# else) AND that its native target actually has installed content in it
# (a failed install has also been seen to leave the target directory
# emptied even when some later step masks pnpm's own exit status).
verify_relocation() {
  [[ -L "$REPO_ROOT/node_modules" ]] || return 1
  local target
  target="$(readlink -f "$REPO_ROOT/node_modules")"
  [[ -d "$target" ]] || return 1
  [[ -n "$(ls -A "$target" 2>/dev/null)" ]] || return 1
  [[ -d "$REPO_ROOT/node_modules/.bin" ]] || return 1
  return 0
}

relocation_succeeded=0
for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  step "Relocation attempt $attempt/$MAX_ATTEMPTS ..."
  reset_relocation_state
  link_one "$REPO_ROOT/node_modules" "root"
  for pkg in "${WORKSPACE_PKGS[@]}"; do
    link_one "$REPO_ROOT/packages/$pkg/node_modules" "packages-$pkg"
  done

  if pnpm install --frozen-lockfile && verify_relocation; then
    relocation_succeeded=1
    break
  fi
  warn "Attempt $attempt did not produce a verified native node_modules -- retrying."
done

if [[ "$relocation_succeeded" == "1" ]]; then
  echo
  ok "Native dev setup complete, INCLUDING node_modules relocation."
  echo "    node_modules under: $NATIVE_BASE"
  echo "    pnpm store under:   $NATIVE_STORE"
  echo
  echo "This only applies to interactive/native shells that source ~/.bashrc"
  echo "(nvm needs a sourced shell profile to put node/pnpm on PATH)."
  exit 0
fi

# ── 5. Fallback: relocation could not be verified -- do a plain, working
#      install rather than leave the repo broken or claim a speedup that
#      didn't happen. ────────────────────────────────────────────────────

warn "Could not reliably relocate node_modules to native disk after $MAX_ATTEMPTS attempts."
warn "This is a known, not-yet-understood reliability issue on this WSL2/drvfs"
warn "setup -- see specs/backlog/test-timing-instrumentation-and-reliability.md."
warn "Falling back to a plain install: node_modules stays on the slow mount,"
warn "so the I/O speedup and flake fix from relocation do NOT apply this run."

for pkg in "${WORKSPACE_PKGS[@]}"; do
  rm -rf "$REPO_ROOT/packages/$pkg/node_modules"
done
rm -rf "$REPO_ROOT/node_modules"
rm -rf "$NATIVE_BASE"

cd "$REPO_ROOT"
if pnpm install --frozen-lockfile; then
  echo
  ok "Plain native install complete (node_modules on the original mount)."
  echo "    Node/pnpm itself is still native -- installs are faster than the"
  echo "    container path even without relocation (no container startup cost)."
  exit 0
else
  fail "Plain install also failed -- see output above. This is unrelated to the relocation issue."
  exit 1
fi
