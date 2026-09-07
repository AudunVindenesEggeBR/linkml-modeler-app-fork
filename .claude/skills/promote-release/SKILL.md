---
name: promote-release
description: Prepare a dev → main release promotion PR for the LinkML Visual Schema Editor monorepo — syncing dev, choosing the SemVer bump, bumping the version field in all five package.json files in lockstep, updating CHANGELOG.md, drafting curated release notes from merged dev PRs, and opening a draft PR. Use this whenever the user asks to "promote", "cut a release", "ship a release", "prepare v<X.Y.Z>", or asks whether dev is ready to promote to main — do not attempt any of these steps by hand, the lockstep version bump across five files is the easiest part to get wrong.
---

# Promote dev → main

This automates the promotion checklist in the repo's `CLAUDE.md`. Read that file's "Promoting `dev → main` (releases)" section first if it's not already in context — this skill assumes its rules and does not repeat all of them here.

The single most important constraint: **you propose, the project owner approves.** This skill always ends at an open **draft** PR. Never merge it, never tag a release, and never push directly to `main` as part of this skill, even if asked to "just do it" — the workflow doc is explicit that promotion PRs need owner sign-off before merge.

## Step 0 — Decide whether promotion is warranted

Before doing anything, check whether a promotion trigger actually fired (see `CLAUDE.md`):
1. 2+ user-visible features merged to `dev` since the last promotion, or
2. 2+ weeks since the last promotion, or
3. A security/critical fix needs to ship immediately.

Find the last promotion with `git log main --grep='^release:' --merges` or by checking the latest `vX.Y.Z` tag (`git describe --tags --abbrev=0 main`). If none of the triggers fired, say so and ask the user whether they still want to proceed — don't promote just because you were asked in passing.

Also check the "Never promote" conditions: a known regression on `dev`, or a feature that will land within ~24 hours. If you're not sure, ask.

## Step 1 — Sync dev from main

First confirm `dev` actually exists — a fresh clone or personal fork may only have `main` (verified: a bare `git checkout dev` on a repo without it fails with a raw `pathspec 'dev' did not match any file(s)` error, which is confusing to act on):

```bash
git show-ref --verify --quiet refs/heads/dev || git ls-remote --exit-code --heads origin dev
```

If that fails, stop — there is nothing on `dev` to promote, and this skill does not apply until `dev` is created (that's a decision for the user, not something to do silently as a side effect of "promoting"). Otherwise:

```bash
git checkout dev && git pull
git merge main
```

If there are conflicts, resolve them on `dev` (never on `main`, never by force-pushing). Push the synced `dev`:

```bash
git push
```

## Step 2 — Confirm CI is green on dev

```bash
gh run list --branch dev --limit 5
```

If the latest run isn't green, stop and tell the user — do not proceed with a broken `dev`.

## Step 3 — Gather what changed since the last tag

```bash
git describe --tags --abbrev=0 main   # last release tag, e.g. v1.2.0
gh pr list --base dev --state merged --search "merged:>=<date-of-last-tag>" --json number,title,url,labels
```

Group the merged PRs into Features / Fixes / Breaking changes / Dependencies by reading their titles and, where the grouping is ambiguous, the PR body. A PR touching `.linkml-editor.yaml` manifest parsing (`packages/core/src/io/manifest.ts`, `editorManifest.ts`) or removing/renaming a user-facing feature belongs under **Breaking changes** — flag these explicitly to the user even if the PR author didn't call it out, since `CLAUDE.md` requires a non-empty Breaking changes section to force a MAJOR bump.

## Step 4 — Choose the SemVer bump

- **MAJOR** if Breaking changes is non-empty.
- **MINOR** if there are new backward-compatible features but no breaking changes.
- **PATCH** if it's only fixes and dependency bumps.

State your reasoning to the user before proceeding, since this is a judgment call on ambiguous PRs.

## Step 5 — Bump versions in lockstep

There are **six** `package.json` files in this monorepo, but only **five** move in lockstep (per-package versioning for `@linkml-editor/core` is tracked in issue #111 — don't attempt to split it further). `packages/proxy` (`@linkml-editor/cors-proxy`) is versioned **independently** and stays untouched — do not bump it just because the others moved (confirmed against how issue #156 handled the v1.2.1 proposal upstream: "lockstep; `proxy` stays at its own `0.3.2`"). Update the `version` field to the new `X.Y.Z` (no `v` prefix) in exactly these five:

- `package.json` (root)
- `packages/core/package.json`
- `packages/web/package.json`
- `packages/electron/package.json`
- `packages/docs/package.json`

Verify afterward — the five lockstep files must show the new version, and `packages/proxy/package.json` must be unchanged:

```bash
grep -h '"version"' package.json packages/{core,web,electron,docs}/package.json   # must all match the new version
grep -h '"version"' packages/proxy/package.json                                   # must be unchanged
```

## Step 6 — Update CHANGELOG.md

Read the existing `CHANGELOG.md` to match its established format, then add an entry for the new version using the grouping from Step 3.

## Step 7 — Draft the commit, don't make it

Per `CLAUDE.md`, the agent never runs `git commit` itself. Leave the version bumps and changelog update staged (or just modified) in the working tree, write the full commit message (conventional-commit prefix, e.g. `chore: bump version to vX.Y.Z`), and hand both to the user. They commit it directly on `dev`, as part of the promotion PR (before the PR is opened, not as a separate PR) — you don't proceed to Step 8 until they've done that.

## Step 8 — Open the draft PR

```bash
gh pr create --base main --head dev --draft --title "release: v<X.Y.Z>" --body-file <notes-file>
```

The PR body must use this exact structure (see `CLAUDE.md` → "Release notes"):

```markdown
## v<X.Y.Z>

### Features
- ...

### Fixes
- ...

### Breaking changes
- ...  (or: "None")

### Dependencies
- ...  (omit if no bumps)
```

## Step 9 — Hand off

Tell the user the draft PR is ready for their review, link it, and summarize the chosen bump and why. Remind them that merging must use a **merge commit** (not squash) once they approve, and that tagging (`gh release create vX.Y.Z --target main ...`) happens after that merge — both are their call, not this skill's.
