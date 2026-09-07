#!/usr/bin/env bash
# PreToolUse notice for Bash: when a `git commit` has the .linkml-editor.yaml
# manifest I/O staged, remind that a format change there requires a MAJOR
# version bump at the next dev -> main promotion (see CLAUDE.md's release
# rules). Never blocks -- this only ever adds context, it does not deny.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

if ! printf '%s' "$cmd" | grep -qE '(^|[[:space:]])git[[:space:]]+commit\b'; then
  exit 0
fi

staged=$(git diff --cached --name-only 2>/dev/null || true)
hits=$(printf '%s\n' "$staged" | grep -E 'packages/core/src/io/(manifest|editorManifest)\.ts$' || true)

if [[ -n "$hits" ]]; then
  files=$(printf '%s' "$hits" | tr '\n' ' ' | sed 's/ *$//')
  msg="Heads up: this commit touches the .linkml-editor.yaml manifest I/O ($files). Per CLAUDE.md, a change to the manifest FORMAT (not just an internal refactor) requires a MAJOR version bump at the next dev -> main promotion -- flag it in the PR description if so."
  jq -n --arg msg "$msg" '{systemMessage:$msg, continue:true, hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$msg}}'
fi
