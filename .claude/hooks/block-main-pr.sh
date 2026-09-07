#!/usr/bin/env bash
# PreToolUse guard for Bash: blocks `gh pr create --base main` from branches
# that aren't allowed to target main directly, per this repo's CLAUDE.md
# workflow ("Open feature PRs against main" is explicitly forbidden there).
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

# Only act on `gh pr create ... --base main` (or `-B main`).
if ! printf '%s' "$cmd" | grep -qE '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+create\b'; then
  exit 0
fi
if ! printf '%s' "$cmd" | grep -qE -- '(--base[[:space:]=]main\b|-B[[:space:]]+main\b)'; then
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

case "$branch" in
  dev)
    exit 0 ;;
  dependabot/*|Dependabot/*)
    exit 0 ;;
  hotfix/*|Hotfix/*)
    exit 0 ;;
esac

reason="Blocked: 'gh pr create --base main' from branch '$branch'. Per this repo's CLAUDE.md workflow, only dev (promotion), dependabot/*, and hotfix/* branches target main directly -- feature/fix/chore/docs work must PR into dev instead ('gh pr create --base dev')."
jq -n --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
