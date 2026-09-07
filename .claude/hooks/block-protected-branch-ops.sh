#!/usr/bin/env bash
# PreToolUse guard for Bash: blocks force-pushing or deleting the protected
# `main`/`dev` branches, per CLAUDE.md's "Do not" list (never force-push
# shared branches). Best-effort regex matching, not a full git CLI parser.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

is_dangerous=0
target=""

# Force push: `git push [...] --force|--force-with-lease|-f [...]`
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+push\b' \
   && printf '%s' "$cmd" | grep -qE -- '(--force(-with-lease)?\b|(^|[[:space:]])-f([[:space:]]|$))'; then
  # Pull out the positional (non-flag) args after `git push` -- these are
  # [remote] [refspec...]. If any names main/dev, that's explicit and wins
  # outright. If there are NO positional args at all, push targets whatever
  # the current branch's upstream is, so fall back to checking HEAD -- but
  # only in that no-args case, otherwise an explicit different branch (e.g.
  # `git push origin feat/1-foo --force` while sitting on main) would be
  # misread as force-pushing main just because main is the current branch.
  rest=$(printf '%s' "$cmd" | sed -E 's/^.*git[[:space:]]+push//')
  positional=$(printf '%s' "$rest" | tr ' \t' '\n\n' | grep -vE '^(-.*)?$' || true)

  if printf '%s' "$positional" | grep -qE '(^|[:/])(main|dev)$'; then
    is_dangerous=1
    target="force-push (explicit branch)"
  elif [[ -z "$positional" ]]; then
    current=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [[ "$current" == "main" || "$current" == "dev" ]]; then
      is_dangerous=1
      target="force-push (current branch: $current)"
    fi
  fi
fi

# Local branch delete: `git branch -D main|dev`
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+branch\b.*-D\b' \
   && printf '%s' "$cmd" | grep -qE '(^|[[:space:]])(main|dev)([[:space:]]|$)'; then
  is_dangerous=1
  target="local branch delete (-D)"
fi

# Remote branch delete: `git push origin --delete main|dev` or `git push origin :main|dev`
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+push\b.*--delete\b' \
   && printf '%s' "$cmd" | grep -qE '(^|[[:space:]])(main|dev)([[:space:]]|$)'; then
  is_dangerous=1
  target="remote branch delete (--delete)"
fi
if printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+push\b[^|;&]*[[:space:]]:(main|dev)([[:space:]]|$)'; then
  is_dangerous=1
  target="remote branch delete (colon syntax)"
fi

if [[ "$is_dangerous" == "1" ]]; then
  reason="Blocked: this command would $target the protected 'main' or 'dev' branch. CLAUDE.md forbids force-pushing or deleting these shared branches. If this is genuinely intended, run it manually in a terminal outside Claude Code."
  jq -n --arg reason "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
fi
