---
name: update-goldens
description: Regenerate the LinkML YAML round-trip golden fixtures (packages/core/src/io/__fixtures__/schemas/*.expected.yaml) safely — runs the UPDATE_GOLDENS regeneration, shows and explains the resulting diff before anything is staged, and re-runs the semantic/property-based suites to confirm nothing but formatting moved. Use whenever a parser/serializer change means the golden fixtures need updating, or the user asks to "update the goldens", "regenerate golden files", or mentions UPDATE_GOLDENS — never run that env var directly by hand, since it overwrites all 12 fixtures with zero diff or confirmation on its own.
---

# Regenerate round-trip golden fixtures

This exists because `UPDATE_GOLDENS=1` (`pnpm test:update-goldens` at the repo root, or `UPDATE_GOLDENS=1 vitest run` in `packages/core`) does a raw, unconfirmed overwrite: `packages/core/src/io/__tests__/round-trip.test.ts`'s Suite 1 calls `writeFileSync(expectedPath, emitted, 'utf-8')` directly when the flag is set — no comparison, no prompt, no diff. Run blind, it silently bakes whatever the current serializer emits into all 12 `*.expected.yaml` fixtures, including any unintended formatting drift from an unrelated change.

Suites 2 (semantic round-trip) and 3 (property-based, fast-check) do **not** read `UPDATE_GOLDENS` at all — they always run their normal semantic-equality checks against the `.yaml` inputs, independent of Suite 1's fixtures. That means a real parser/serializer *logic* regression would still fail them even if Suite 1 was blindly regenerated. What they can't catch is unintended byte/formatting drift (key ordering, whitespace, quoting) getting baked into the goldens unreviewed — that's what the diff review below is for.

## Step 1 — Regenerate

Don't use the `pnpm test:update-goldens` / `UPDATE_GOLDENS=1 vitest run` package scripts directly — they run the **entire, unscoped** `packages/core` test suite, which pulls in unrelated jsdom-rendering test files and is exposed to this repo's known `[vitest-pool-runner]: Timeout waiting for worker to respond` flakiness for no reason (goldens only touch `round-trip.test.ts`). Scope to that file directly, with `--environment node` since it's pure YAML parse/serialize logic with no DOM/React rendering — confirmed empirically (2026-09-15) that this avoids the flakiness entirely (reliable and ~2-3x faster than the unscoped run) while the unscoped/default-jsdom invocation of the same file failed 3/3 times with that timeout:

Full corpus:

```bash
UPDATE_GOLDENS=1 pnpm --filter @linkml-editor/core exec vitest run --environment node io/__tests__/round-trip.test.ts
```

To regenerate a single schema only (e.g. after touching logic that only affects one fixture), add vitest's `-t` filter, matching the test title's schema name — e.g. for `personinfo`:

```bash
UPDATE_GOLDENS=1 pnpm --filter @linkml-editor/core exec vitest run --environment node -t personinfo io/__tests__/round-trip.test.ts
```

## Step 2 — Review the diff before anything else

```bash
git diff -- packages/core/src/io/__fixtures__/schemas/*.expected.yaml
```

Don't just paste the raw diff back at the user — read it and explain **what changed semantically** (a new field, a reordered key, a whitespace/quoting change, an indentation shift) and whether that matches what you expect from the change you just made. If the diff touches fixtures you didn't expect to be affected by your change, or changes more than the specific thing you were working on, stop here and investigate before continuing — don't assume it's fine because the command "succeeded."

## Step 3 — Re-run the same file without the flag

```bash
pnpm --filter @linkml-editor/core exec vitest run --environment node io/__tests__/round-trip.test.ts
```

This confirms Suite 1 now passes a *real* byte comparison against the regenerated goldens (Step 1's run only wrote them — `UPDATE_GOLDENS=1` makes Suite 1 trivially "pass" by skipping its assertion entirely, so it proves nothing about correctness on its own), and — more importantly — that Suites 2 and 3 are still green, which is the actual signal that round-trip semantics weren't broken by whatever caused the golden diff.

## Step 4 — Hand off, don't commit

Per `CLAUDE.md`, the agent never runs `git commit` itself. Leave the regenerated `*.expected.yaml` files modified in the working tree, summarize what changed and why (from Step 2) and that the full suite is green (from Step 3), and hand it to the user to review and commit themselves.
