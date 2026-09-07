---
name: start-feature
description: Start a new feature/fix/chore branch in the LinkML Visual Schema Editor monorepo the way this repo requires — GitHub issue first, branched from dev (never main), named feat|fix|chore|docs/<issue#>-<slug>. Use whenever the user says "let's start on issue #N", "start a new feature for X", "create a branch for this bug", or begins describing work to implement before any branch exists — this repo's workflow is easy to get wrong by branching from main or skipping the issue.
---

# Start a feature branch

This follows the "Starting a feature" section of the repo's `CLAUDE.md`. The two mistakes this exists to prevent: branching from `main` instead of `dev`, and skipping the GitHub issue for anything non-trivial.

## Step 1 — Determine if an issue is needed

Trivial fixes (typos, one-line corrections) can skip the issue and reference the PR alone. Everything else needs a GitHub issue first.

If the user already gave you an issue number, use it — verify it exists and read its title:

```bash
gh issue view <N> --json number,title,state
```

Otherwise, create one before branching:

```bash
gh issue create --title "<short title>" --body "<description>"
```

If that fails with something like "Issues are disabled for this repo", check whether you're pointed at the right one — a personal fork often has issues disabled while the upstream project (`gh repo view --json parent`) has them enabled and is where this workflow's issue actually lives or should be filed (`gh issue create --repo <owner>/<repo>`). Don't just give up or silently skip the issue requirement; tell the user what you found and ask which repo the issue should live in.

Confirm the title/description with the user first if the ask was vague — the issue title feeds directly into the branch slug.

## Step 2 — Sync dev and branch from it

Never branch from `main` for feature work — only dependency PRs, hotfixes, and promotion PRs touch `main` directly.

First confirm `dev` exists (locally or on `origin`):

```bash
git show-ref --verify --quiet refs/heads/dev || git ls-remote --exit-code --heads origin dev
```

If it doesn't, don't silently fall back to branching from `main` — a bare `git checkout dev` fails with an opaque `pathspec` error, and creating `dev` for the first time is a repo-structure decision the user should make explicitly, not something this skill should do as a side effect of starting one branch. Tell the user `dev` doesn't exist yet and ask whether to create it from `main` now or branch from `main` for this one case.

Once `dev` exists:

```bash
git checkout dev && git pull
git checkout -b <prefix>/<issue#>-<short-slug>
```

Choose the prefix by the nature of the work:
- `feat/` — new functionality
- `fix/` — bug fix
- `chore/` — maintenance, tooling, deps (non-Dependabot)
- `docs/` — documentation only

The slug should be a short, lowercase, hyphenated summary of the issue title (e.g. issue #56 "Persistable named views" → `feat/56-persistable-views`).

## Step 3 — Stacked branches

If this feature genuinely depends on another unmerged feature branch, branch from that branch instead of `dev`, and tell the user this PR will need to retarget to `dev` after the dependency merges — don't let a stacked branch silently target `dev` while its dependency is still open.

## Step 4 — Confirm and hand off

Report the branch name and issue link, then get on with the actual implementation work the user asked for — this skill only covers getting the branch set up correctly, not the feature itself.
