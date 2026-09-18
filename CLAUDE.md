# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LinkML Visual Schema Editor — a cross-platform (web + Electron) graphical tool for authoring LinkML schemas on an ERD-style canvas. Monorepo managed with pnpm workspaces.

## Commands

```bash
# Development
pnpm dev                  # Web dev server (localhost:5173)
pnpm build                # Build core + web packages (Electron excluded; use build:all for desktop)
pnpm test                 # Run all Vitest tests
pnpm lint                 # ESLint across all packages
pnpm format               # Prettier formatting

# Single-package work
pnpm --filter @linkml-editor/core test        # Run only core tests
pnpm --filter @linkml-editor/core test:watch  # Watch mode for core tests
pnpm test:e2e                                 # Playwright E2E tests (packages/web)

# Electron development (requires two terminals; experimental, not part of v1.0 supported surface)
# Terminal 1: pnpm dev
# Terminal 2: pnpm --filter @linkml-editor/electron build && npx electron packages/electron/dist/main.js

# Electron packaging
pnpm --filter @linkml-editor/electron package          # All platforms
pnpm --filter @linkml-editor/electron package:linux    # Linux only

# Documentation (VitePress)
pnpm docs:dev
pnpm docs:build
```

`pnpm lint` also runs `scripts/check-token-usage.sh`, which enforces CSS design-token usage in `packages/core/src` and `packages/web/src` (zero-tolerance for `fontFamily:'monospace'` literals and 6-char hex color literals — use the `--font-family-mono` / color CSS custom properties instead).

See `.claude/rules/css-color-tokens.md` (path-scoped to `packages/{core,web}/src/**/*.{ts,tsx}`, loads automatically whenever such a file is read) for the `--color-border-*` vs. `--color-fg-*` text-contrast rule.

**Always invoke ESLint the way `pnpm lint` actually does — `eslint packages/*/src --ext .ts,.tsx` (source only) — never `eslint packages/core packages/web` or similar whole-package-directory shortcuts.** The real script's `packages/*/src` scope deliberately excludes `dist/`; a whole-package invocation doesn't, and if `packages/core/dist` happens to exist (e.g. built during the same session to unblock a `packages/web` typecheck — see below), it will lint the *compiled* `.js` output too. Confirmed empirically: an ad hoc `eslint packages/core packages/web` run against a freshly-built `packages/core/dist` produced 47 errors, all from one bundled, sourcemapped `.js` file — none of them a real source problem, purely an artifact of the wrong invocation scope picking up build output that was never meant to be linted.

**Typechecking `packages/web` in isolation requires `packages/core/dist` to already exist** — `packages/web` resolves the `@linkml-editor/core` workspace package via its built type declarations, not its source. Running `tsc --noEmit` (or equivalent) in `packages/web` before `packages/core` has ever been built in that session surfaces a wall of `Cannot find module '@linkml-editor/core'` errors that look like a real problem in whatever you just changed, but are purely this missing-build artifact — confirmed by building `packages/core` first (`pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json`, or its `build` script) and re-running, which comes back clean. If you build `packages/core/dist` only to unblock this check, remove it afterward (`rm -rf packages/core/dist`) rather than leaving it lying around — it isn't part of this repo's normal working state during a session (the normal dev flow is `pnpm dev`, not a pre-built core `dist/`), and leaving it in place is exactly what causes the ESLint-scope pitfall above to trigger on a later, unrelated lint run.

**The "build `packages/core` first" fix above can itself silently no-op if a stale `packages/core/tsconfig.tsbuildinfo` is lying around.** That file is gitignored (`*.tsbuildinfo`) but not ephemeral to the invocation — it can survive from an earlier, unrelated session or an interrupted build. `packages/core`'s `tsconfig.json` sets `composite: true`, and TS's incremental/composite mode trusts that buildinfo file's record of "already built" state rather than checking the `dist` output actually exists on disk. Confirmed empirically (2026-09-15): with `dist/` absent but a pre-existing `tsconfig.tsbuildinfo` present, `pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json` exited `0` with zero errors and produced **no `dist` at all** — i.e. it looked like a clean, successful build while leaving `packages/web`'s "Cannot find module" wall completely unresolved, with no error output pointing at why. Deleting `tsconfig.tsbuildinfo` and re-running produced `dist` correctly. If building core to unblock a `packages/web` typecheck doesn't produce a `dist` directory (or `packages/web` still fails afterward), delete `packages/core/tsconfig.tsbuildinfo` and rebuild before assuming the missing-module errors are a real problem — and include that file (`rm -rf packages/core/dist packages/core/tsconfig.tsbuildinfo`) in the cleanup step above, not just `dist`.

**`pnpm lint` and `pnpm test`/`pnpm test:e2e` do NOT catch real TypeScript type errors in `packages/core` — only `tsc` (via `pnpm build` or a container/CI build) does.** ESLint's TypeScript parser does not run full type-checking by default (no type-aware rules configured here), and Vite's dev server transpiles each file with esbuild, which strips types without checking them — so `pnpm dev`, and therefore every Playwright E2E test that runs against it, happily serves code with real type errors. Confirmed empirically (2026-09-15): a change to `SchemaCanvas.tsx` used `e.target as Node` inside a click-outside handler, intending the DOM `Node` interface — but the file already imports a *different* `Node` type from `reactflow` for node-graph typing, which silently shadows the global one. `pnpm lint` passed clean, the full local E2E suite (7/7) passed against the running dev server, and only a `podman-compose build` (which runs `pnpm --filter @linkml-editor/core run build`, i.e. real `tsc`) caught it, with `error TS2345`/`TS2352` on the mismatched `Node` cast. Fixed by using `globalThis.Node` to unambiguously reference the DOM type regardless of local shadowing. **Before considering `packages/core` (or `packages/web`) work finished, run `pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json --noEmit`** (and the `packages/web` equivalent, per the `dist`-must-exist-first note above, if `packages/web` was touched) in addition to lint/tests — not just when a container build happens to be involved. This still leaves a `tsconfig.tsbuildinfo` behind even with `--noEmit` (confirmed same day) — clean it up (`rm packages/core/tsconfig.tsbuildinfo`) per the staleness note above.

A `pre-push` git hook (installed via the root `prepare` script, `.githooks/pre-push`) runs core unit tests and the Playwright E2E suite before every push; expect pushes to take longer than the raw git operation. Both steps are wrapped in `scripts/time-cmd.sh`, which appends a start/end/duration line to `test-timing/containers.log` (gitignored) — check that file if a push feels unusually slow. **Note: this hook does not run `tsc`** (per the type-checking gap just above) — a type error can still pass `git push` cleanly and only surface at container-build time; run `tsc` yourself before pushing `packages/core`/`packages/web` changes if you want to catch this class of error locally first.

**If `pnpm --filter @linkml-editor/core test` (or any `vitest run`) fails with `[vitest-pool-runner]: Timeout waiting for worker to respond`, this is a known flaky-infrastructure issue, not a code regression** — confirmed to reproduce even in a fully native session (Node/pnpm installed on the host, no container) whenever the repo checkout's `node_modules` sits on a slow bind-mounted filesystem (e.g. WSL2's `/mnt/c`). See the `node-pnpm-fallback` skill's "vitest intermittently fails" section for the full data and the `--environment node` workaround for pure-logic test files — it's not container-specific despite living in that skill.

### When the host has no Node/pnpm

If a command fails with `node: command not found` / `pnpm: command not found`, or the host otherwise has no Node/pnpm installed (see `deploy/web/check-requirements.sh` and the Podman deployment docs), use the `node-pnpm-fallback` skill (`.claude/skills/node-pnpm-fallback/SKILL.md`) rather than trying to install Node system-wide — it covers the Podman/Docker container path (with pnpm-version-pinning and vitest-flakiness gotchas) and the native install path (with its own WSL2 `node_modules`-relocation quirk).

## Errors and Unexpected Outcomes

Whenever something in a session doesn't go as expected — a test fails, a build hangs, a tool times out, a "should already be correct" turns out wrong — treat it as a signal, not just an obstacle to fix and move past. Before considering that piece of work done, evaluate:

1. **Does this file need a new or clarified instruction**, so a future session — which starts with none of this session's hard-won context — doesn't have to rediscover the same thing from scratch?
2. **Would a project skill (`.claude/skills/`) or hook (`.claude/hooks/` via `.claude/settings.json`) prevent this class of error entirely**, rather than merely documenting how to recognize it?

If either applies, make the change in the same session — don't defer it. For a substantial finding, record the reasoning in `specs/done/` (or `specs/backlog/` if the underlying fix is still open), not just the fix, so later readers see *why*, not only *what*.

**Never write a project-relevant lesson only to Claude Code's private per-user memory.** That memory is local to one agent's account, unversioned, invisible to the user's own view of the repo, and invisible to every other human or agent contributor — it gives the lesson no notoritet (no durable, discoverable record for the project). Any lesson that would change how this repo should be worked in belongs in a place everyone can see and that ships with the repo: this file (CLAUDE.md), a project rule, or a project skill (`.claude/skills/`) — committed to git, exactly like the fixes this section already asks for. Private memory may still be used for things that are genuinely personal to one user's working style and have no bearing on the repo itself, but when in doubt, document it here instead of relying on memory.

This applies to: incorrect assumptions later contradicted by evidence, environment/tooling quirks (timeouts, flaky test infrastructure — see the container/vitest notes in the `node-pnpm-fallback` skill, both added this way), and real bugs surfaced by testing. It does not apply to user typos or one-off external factors with no bearing on how this repo is worked in.

One general lesson worth stating outright, since it caused a real, time-costly mistake: **verify configuration empirically, not by code-reading alone.** Confirming that a value is passed through to a library call is not evidence the library understood it — a plausible-looking string can be silently ignored by a mismatched enum, with the caller none the wiser. (Concretely: `AutoLayoutOptions.direction` used `'TB'|'BT'|'LR'|'RL'`, forwarded as-is to elkjs's `elk.direction` — which only recognizes `DOWN|UP|LEFT|RIGHT` and silently ignores anything else, so every direction produced the same layout. An earlier pass through this same code had already claimed the option was "reelt kopla til algoritmen" [genuinely wired to the algorithm] on the strength of the value being forwarded correctly — that claim was wrong, and stood uncorrected until a UI control made the no-op impossible not to notice.) When asserting an option or setting "works" or is "connected," show a test where changing the value changes the output — don't infer it from the call site looking right.

**When an investigation already empirically proves that suppressing a specific callback/write-back fixes a bug (e.g. a no-op patch made the crash disappear), prefer the fix that maps most directly onto that already-proven mechanism over a new, more "elegant" fix built on a fresh theory about the bug's timing/conditions — the proven mechanism is stronger evidence than a plausible-sounding new explanation.** Concretely (`specs/done/canvas-remount-selection-infinite-loop.md`): the initial investigation into a React "Maximum update depth exceeded" crash proved, by patching ReactFlow's `onSelectionChange` callback to a no-op, that suppressing it fixed the crash. Instead of implementing that directly, a follow-up round chose a theoretically "more robust" fix (defer selection-seeding until ReactFlow's `onInit`, on the theory the crash was specifically about *mount timing*) — implemented cleanly, passed `tsc`/lint/all 337 unit tests, and then failed in a real browser: the crash still happened, just delayed, because the real mechanism was about *which side initiates a selection change* (user click vs. any programmatic write), not mount timing at all. Reverting that and instead gating the same `onSelectionChange` callback behind a real-user-gesture check (i.e., a version of the *already-empirically-proven* suppression) fixed it correctly on the first try. The wasted round cost a full implement-verify-revert cycle (~230k tokens, one forked browser-verification agent) that a closer reading of the initial investigation's own proof would have avoided.

**When unsure of a library/API's actual behavior, options, or valid values, check its official documentation before guessing from memory or convention.** Naming conventions from adjacent tools (e.g. assuming a graph-layout library uses Mermaid/dagre's `TB`/`LR` direction names) are a common way to be confidently wrong. Documentation and empirical verification are complementary, not substitutes for each other — check both when it matters: docs tell you what *should* be valid and give you the full candidate list to test; actually running the code against the installed version confirms what's *actually* true for that version, including bugs or version-skew the docs don't mention. (Concretely: fetching ELK's official option reference for `layered.layering.strategy` surfaced 9 documented enum values — but two of them (`BF_MODEL_ORDER`, `DF_MODEL_ORDER`) crash this repo's installed elkjs 0.11.1 on a plain graph with no model-order metadata, something no amount of reading the docs alone would have revealed. Checking docs without then testing against the real installed version would have shipped a UI control that crashes on two of its options.)

**A web search's own prose summary of a flag or option is not documentation — verify it against the installed tool's own `--help`/introspection before using it.** During the test-timing work (`specs/backlog/test-timing-instrumentation-and-reliability.md`), a web search confidently stated that vitest supports overriding nested pool settings from the CLI as `--poolOptions.forks.maxForks <n>`. This repo's installed vitest 4.1.8 rejects that flag outright (``CACError: Unknown option `--poolOptions` ``) — the actual flag, confirmed by running `vitest run --help` inside the same container, is `--maxWorkers <n>`. The search result wasn't hallucinated from nothing (a nested-path CLI syntax like this does exist for some tools/some vitest versions), but it was wrong for the version actually running here, and reads exactly as confidently as a correct answer would. Treat a search engine's summary of "how to configure X" the same as a half-remembered convention from an adjacent tool: a plausible starting hypothesis to test against the real, installed thing, never something to act on directly.

**Adding support for a new LinkML top-level section (`types`/`slots`/`subsets`, alongside `classes`/`enums`) to import resolution or validation does not mean every rendering surface picked it up too — each one enumerates the schema independently and has to be checked separately.** `packages/core/src/canvas/OutlineView.tsx`, `canvas/TableView.tsx`, `canvas/deriveGraph.ts`, and `editor/ProjectPanel.tsx` each maintain their own hand-written enumeration of `schema.classes`/`schema.enums` for what to render or count — none of them defer to a shared "what's in this schema" helper, so fixing `io/importResolver.ts` (`collectImportedEntities`, `findMissingImport`) does not automatically make a new section visible anywhere else. (Concretely, from `specs/done/cross-repo-import-resolution-gaps.md`: making `types:`-only imported schemas recognized by cross-schema validation/import-resolution felt like the complete fix, was covered by passing unit tests, and shipped — but a real rebuild+deploy afterward showed the schema still rendered as completely empty in Outline View, Table View, and the canvas, and as a "0/0" badge in the Project Panel, because none of those four files had ever read `schema.types` either. This was a second, independent bug only caught by the user actually using the deployed app, not by `tsc`/lint/the unit-test suite.) When a LinkML entity kind gains new handling anywhere, `grep -rn "schema\.classes\|schema\.enums" packages/core/src/canvas packages/core/src/editor` and check each hit for whether the new kind needs the same treatment there.

**A one-off Node/Playwright verification script placed in the scratchpad (or anywhere outside a package's own directory) can fail to resolve this repo's workspace dependencies.** Node's ESM resolution walks up from the *importing file's own location* looking for `node_modules`; the scratchpad directory sits outside the pnpm workspace tree entirely, so `import { chromium } from '@playwright/test'` there fails with `ERR_MODULE_NOT_FOUND` even though the package is installed and used correctly by the repo's real E2E suite. Fix: write (or copy) the driver script into a package directory that actually has the dependency in its resolution path — e.g. `packages/web/` for anything needing `@playwright/test` — run it from there, and delete it afterward since it's scratch, not meant to be committed.

**A plain `python -m http.server` cannot stand in for a URL this app will `fetch()` when manually verifying a schema-import-from-URL feature.** It sends no `Access-Control-Allow-Origin` header, so the browser's `fetch()` fails with the same CORS error this codebase already has dedicated, deliberately-honest handling for (see `normalizeSchemaUrl`/`fetchTextWithRetry` in `io/importResolver.ts`/`io/fetchErrors.ts`, and `specs/done/url-fetch-cors-error-mislabeling.md`) — so a quick local test fixture trips the exact failure mode that handling exists to describe, rather than exercising the success path. Use a small CORS-enabled server instead (a few lines of Node `http.createServer` setting `Access-Control-Allow-Origin: *` on every response) when constructing local test fixtures for any feature that fetches a schema by URL. **But before reaching for a from-scratch CORS server and driver script at all, check whether you actually need URL-fetch behavior in the first place** — see the next lesson below, which is very often the cheaper and more reusable answer for verifying canvas/editor behavior in a live browser.

**Before writing any throwaway Playwright driver script or CORS fixture server to manually verify a canvas/editor bug in a live browser, check whether `packages/web/e2e/`'s existing harness already covers the need — it almost always does, and is dramatically cheaper.** `packages/web/playwright.config.ts` already manages the dev server itself (`webServer: { command: 'pnpm dev', reuseExistingServer: !process.env.CI, ... }` — no manual `pnpm dev` start/poll/kill needed), and the app exposes a purpose-built `window.__lme_e2e__` test hook to every existing spec (`loadSchema`, `writeFile`, `openProjectFromPath`, `setActiveEntity`, `setSelection`, `getActiveYaml`, `runValidation`, `getValidationIssues`, etc. — see any file under `packages/web/e2e/*.spec.ts`, e.g. `focus-mode.spec.ts` or `golden-path.spec.ts`, for the exact shape) that loads a fixture schema and drives app state directly, in-process — no URL fetch, therefore no CORS server needed at all, for the very common case of "get a schema loaded so I can click around and check behavior." Confirmed empirically (2026-09-17, `specs/done/canvas-remount-selection-infinite-loop.md`): verifying a canvas-view-switch selection bug was done, three separate times across one investigation, by spawning a fresh agent that each independently rebuilt a hand-rolled Playwright driver script, a local Node CORS-fixture HTTP server, and manual `pnpm dev` kill/restart/poll logic from scratch — roughly 600k combined tokens and 37 minutes of agent time across the three rounds, entirely avoidable. The same repro (load a multi-class schema, select a class, switch Canvas→Outline→Canvas, check for a crash) could have been one short spec file under `packages/web/e2e/` using `window.__lme_e2e__.loadSchema(...)` + `.setSelection([...])`, run via the project's own `pnpm test:e2e` (or `playwright test <file>` directly against the already-configured `webServer`). When a UI/canvas bug fix needs live-browser verification, write it as a `packages/web/e2e/*.spec.ts` file — and consider keeping it as permanent regression coverage rather than deleting it as scratch, if it exercises a real bug that had none — rather than an ad hoc driver script outside the repo's test structure.

**`pnpm dev`'s Vite dev server can silently keep serving a stale, pre-edit version of a `packages/core/src` file — even though `packages/web/vite.config.ts` correctly aliases `@linkml-editor/core` straight to `../core/src/index.ts` and the dev server has been running the whole time.** This is the same class of issue as the already-documented WSL2 `/mnt/c` vitest-worker flakiness (`node-pnpm-fallback` skill), now confirmed to affect Vite's own file watcher (chokidar/inotify) too, not just vitest's worker pool. Confirmed empirically: a one-line style-object edit in `OutlineView.tsx` produced zero effect in the browser — verified by reading the live element's `outerHTML`/inline `style` attribute directly, not just eyeballing the screenshot — until the running `pnpm dev` process was killed and restarted, at which point the exact same browser reload picked up the edit immediately. **If a change to `packages/core/src` isn't showing up in a running `pnpm dev` session (and a normal browser hard-refresh doesn't help), kill and restart the dev server before concluding the fix itself is wrong** — otherwise a correct fix looks like a failed hypothesis.

## Specification-driven development

This repo is developed spec-first. **Whenever the user describes something they want — a feature, a fix, a change of behavior — or asks for a suggestion, proposal, or recommendation ("kom med forslag", "what do you think", "how should we approach this"), write it up as a spec in `specs/backlog/` before writing any implementation code.** Only implement what the user explicitly asks to have built (e.g. "utfør", "implementer", "go ahead", or approving a specific option from the spec) — never infer implementation authorization from the mere reasonableness of an idea, however small the change looks.

- Being asked for options, a proposal, or a recommendation is **not** authorization to implement the recommended option. Write the proposal into the spec, with the reasoning/evidence behind it, then stop and let the user decide. (Concretely, the incident that prompted this rule: asked to "kom med forslag til kven av valga vi skal beholde" — come up with a proposal for which options to keep — the response went straight to editing application code instead of writing the proposal down first.)
- This holds even mid-conversation inside an already-open spec: adding a new "Runde N" analysis/recommendation section documenting findings and a proposal is expected; going on to change the actual application code in the same turn, without the user separately asking for that specific change, is not.
- **An approval only covers what it names, not the full scope of whatever it's replying to.** When a spec's proposal covers several items (e.g. "remove these 5 options") and the user's approval names only some of them (e.g. "let's remove these 2"), implement exactly the named subset — do not fall back to the proposal's original full scope, even though the proposal is what prompted the approval. (Concretely: a proposal recommended reducing a 7-option picker to 2; the user approved removing only the 2 options they named by name; the response implemented the full reduction-to-2 anyway, and had to be corrected. The literal wording of the approval message is the source of truth, not the proposal it's replying to.)
- The standing authorizations already written elsewhere in this file (e.g. "Errors and Unexpected Outcomes": update this file, or add a skill/hook, without asking) are pre-approved classes of action and don't need a fresh spec-and-approval round trip each time they apply.
- See "Specs backlog" below for the `specs/backlog/` → `specs/done/` file lifecycle once something IS approved and implemented.
- **Finishing implementation work (approved from a spec, or directly instructed) always ends with a draft commit message in the same response — see "Commits" below.** This applies even when the work itself was just updating a spec file, or only touched `.claude/` tooling files rather than application code.

## Development Workflow

**All contributors — human or agent — MUST follow this workflow.** It exists to keep history reviewable and revertible. Do not deviate without first discussing with the project owner.

### Branches

- **`main`** — stable. Releases are tagged here. Only dependency bumps, hotfixes, and `dev → main` promotion PRs land directly on `main`.
- **`dev`** — integration branch. All feature work merges here. Periodically promoted to `main` in batches.

### Starting a feature

0. **Before branching from any base branch (`dev`, or `main` in a checkout that has no `dev`), verify the LOCAL base branch actually matches its remote — do not branch from a local branch that might be carrying unpushed commits from an earlier session.** `git branch -vv`'s `ahead N`/`behind N` counts are the signal to check; if it shows the base branch as `ahead` of its `origin/...` counterpart, STOP and find out why before branching — do not assume it is a stale cached remote-tracking ref just because `git fetch`/`git pull` fail in the current environment. **In an agent sandbox with no SSH access to GitHub (`git@github.com: Permission denied (publickey)` on `git fetch`/`git pull`/`git push` — this happens routinely; it does not mean the human operator lacks access, only this process), `git fetch` cannot refresh the cached ref, but `gh api repos/<owner>/<repo>/commits/<branch> --jq '.sha'` still works (it goes over `gh`'s own HTTPS API token, not git-over-SSH) and gives the true remote HEAD to compare against `git rev-parse <branch>` locally.** Confirmed incident (2026-09-17/18): local `main` in this working directory carried 6 commits from a prior session that had never been pushed to `origin/main`. `git branch -vv` showed this plainly (`main ... [origin/main: ahead 6]`) but it was dismissed in the moment as a stale remote-tracking artifact of this sandbox's failed `git fetch`, rather than checked against the real GitHub state via `gh api` (which was already known, in the same session, to work fine even when git-over-SSH didn't — `gh issue list`/`gh pr create` calls succeeded throughout). A feature branch (`fix/undo-redo-history-not-working`) was cut from this stale local `main`. Its PR was later squash-merged to `main` — bundling all 6 unrelated, previously-unpushed commits into that squash alongside the actual feature work, under a commit titled after only the new feature and silently misattributing the other 6 commits' scope to it. The outcome happened to be harmless (all 6 turned out to be legitimate, already-completed prior work, not anything broken or half-finished, confirmed by reading each one's message after the fact) — **but that was luck, not a property of the process**: an unpushed, half-finished, or since-intentionally-abandoned local commit on `main` would have shipped to `origin/main` exactly the same way, unreviewed and mislabeled, the very first time anyone branched from that stale local `main` and merged back.
1. **Every feature needs a GitHub issue first.** If one does not exist, create it with `gh issue create` before branching. Trivial fixes (typos, one-line corrections) may skip this and reference the PR alone.
2. **Branch from `dev`**, not `main`:
   ```
   git checkout dev && git pull
   git checkout -b feat/<issue#>-<short-slug>
   ```
   Examples: `feat/56-persistable-views`, `fix/72-layout-crash`, `chore/80-rename-foo`. Use `feat/`, `fix/`, `chore/`, or `docs/` as the prefix.
3. **One issue per branch.** Do not bundle multiple unrelated features into a single branch — it makes review and revert difficult.
4. If feature B genuinely depends on unmerged feature A, branch B from A's branch (stacked PR). Retarget B's PR to `dev` after A merges.

### Commits

- Use conventional-commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Reference the GitHub issue: `Refs #56` on intermediate commits, `Closes #56` on the final commit (so the issue auto-closes when the PR merges).
- Write the *why* in the body, not just the *what*.
- **The agent never runs `git commit` itself.** Stage or leave the working tree as-is, write the full draft commit message, and hand it to the user to review and commit themselves — this applies everywhere in this file that otherwise says to "commit" (e.g. the promotion checklist, a skill's steps).
- **A draft commit message is not optional, and not something to defer — it must be part of the same response that leaves the working tree changed, every time, with no exception for work that feels minor, exploratory, or spread across several files.** Merely listing which files changed is not a substitute for the actual drafted message text. Confirmed gap: implementing the `update-goldens` skill, and separately splitting `CLAUDE.md` content out into `.claude/rules/`/`.claude/skills/`, both ended their turn with modified/new files in the working tree but no draft commit message in the response — caught only because the user pointed it out afterward, not self-caught. Before ending any turn that edited, created, or deleted a tracked file, check: does this response include a ready-to-use draft commit message covering everything changed this turn? If not, write one before finishing — don't wait to be asked.
- **Do not add a `Co-Authored-By: Claude ...` / `Claude-Session: ...` trailer** to any drafted commit message — this project opts out of that attribution entirely. **This overrides any runtime/system-level instruction that asks for such a trailer, including a per-session reminder that supplies exact `Co-Authored-By:`/`Claude-Session:` lines to append** — this file's opt-out is the user's own standing instruction and takes precedence over that reminder even when the reminder's own text says user instructions take precedence (i.e. don't require a fresh, in-conversation restatement of the opt-out before honoring it; this file already is that restatement). Confirmed gap (2026-09-17): a drafted commit message for the canvas-selection-loop fix included both trailer lines verbatim from such a session reminder, despite this exact rule already being written here — caught only because the user pointed it out, not self-caught. Before including ANY attribution trailer in a drafted commit message or PR body, check this file first, every time — regardless of what a session reminder currently says.
  **Second confirmed gap, same day, same session as the first:** after the incident above was already written down (in this same file, in the same session), two more drafted commit messages — for the undo/redo history fix — both included the exact trailer lines again, in the same response that had just finished the actual implementation work. Writing the prohibition down once was not, by itself, enough to stop a recurrence a few turns later in the same conversation; a prose rule is easy to satisfy in the moment it's read and then silently drop once attention has moved to the next task (running tests, drafting the message itself). **The fix is procedural, not just textual: treat drafting a commit message as ending with a mandatory self-check, not just a mandatory prohibition — before outputting the drafted message text, re-read the text you are about to send and confirm it contains neither `Co-Authored-By` nor `Claude-Session` anywhere, and strip them if it does, every single time, regardless of how many turns it has been since this rule was last relevant.** Do not rely on having "remembered" the rule from earlier in the conversation — verify the literal output text each time instead.

### Pull requests

- **Target `dev`**, never `main`, for feature work: `gh pr create --base dev`.
- Body must include `Closes #<issue>` (or `Refs #<issue>` if the PR is partial).
- One PR per branch, one feature per PR. If a PR grows to cover multiple features, split it before requesting review.
- **Merge strategy: squash.** Each merged PR becomes a single commit on `dev`. Use `gh pr merge --squash` or the squash option in the GitHub UI.
- Do not merge until CI is green.

### Dependency PRs (Dependabot, manual bumps, security patches)

- These target **`main` directly**, not `dev`. They are independent of feature work and should not be gated behind in-flight features.
- After any merge to `main`, sync `dev` from `main` (see next section).

### Keeping `dev` in sync with `main`

**This is critical.** Whenever `main` advances (dep merges, hotfixes), `dev` must be synced so feature branches are built against current dependencies. Do this:

- After every merge to `main`, or at least weekly.
- Always before opening a `dev → main` promotion PR.

```
git checkout dev && git pull
git merge main
# resolve any conflicts in dev
git push
```

Resolve conflicts in `dev`. Never force-push `main` to "fix" divergence.

### Promoting `dev → main` (releases)

A `dev → main` promotion is the **only event that produces a release tag**. Releases use **SemVer** (`MAJOR.MINOR.PATCH`). The version number itself carries the compatibility signal: bump **MAJOR** for breaking changes, **MINOR** for backward-compatible features, **PATCH** for fixes and dependency bumps. The curated release notes and `CHANGELOG.md` explain what changed.

#### When to promote (cadence)

Promote when **any** of these triggers fire:

1. **2+ user-visible features** are merged to `dev` (closed issues, CI green, no known regressions).
2. **2 weeks have passed** since the last promotion (ships accumulated dep bumps and small fixes; prevents `dev` drift from `main`).
3. **A security or critical bug fix** is on `dev` and needs to ship immediately.

**Never promote** if:

- A known regression exists on `dev` and isn't fixed.
- A feature in-flight will land within ~24 hours (wait for it so the release is coherent).

**Agents propose, the project owner approves.** When triggers fire, the agent must:

1. Open a **draft** PR titled `release: v<X.Y.Z>` (choose the bump per the SemVer rules above — MAJOR if the Breaking changes section is non-empty).
2. Include proposed release notes in the body (see "Release notes" below).
3. Notify the owner that a release is ready for review.

Do **not** merge a promotion PR autonomously. Promotion is high-stakes — once tagged and out, you can't quietly un-ship.

#### Promotion checklist

Before opening the promotion PR:

1. Sync `dev` from `main`: `git checkout dev && git pull && git merge main && git push`. Resolve conflicts in `dev`.
2. Confirm CI is green on `dev`.
3. Bump the `version` field in each package's `package.json` to the new SemVer version (e.g., `1.2.0`), keeping all packages in lockstep for now, and update `CHANGELOG.md`. Commit on `dev` as part of the promotion PR. (Independent per-package versioning for `@linkml-editor/core` is tracked in #111.)

After owner approves:

4. **Merge with a merge commit**, not squash. This preserves the per-feature commit history on `main`. (Feature PRs into `dev` use squash; the `dev → main` promotion PR is the one exception.)
5. Tag the merge commit on `main`:
   ```
   gh release create v1.2.0 --target main --generate-notes --title "v1.2.0" --notes-file release-notes.md
   ```

#### Release tag format (SemVer)

- **Git tag**: `vX.Y.Z` — e.g., `v1.2.0`, `v2.0.0`.
- **`package.json` `version`**: the same number without the leading `v` — e.g., `1.2.0`. All packages share one version (lockstep) until `core` is split out (#111).
- **Choosing the bump**:
  - **MAJOR** (`2.0.0`) — the Breaking changes section is non-empty: a change to `.linkml-editor.yaml` manifest format, a removed/renamed user-facing feature, a required migration, or anything that breaks `@linkml-editor/core`'s public API for an importing app.
  - **MINOR** (`1.2.0`) — new backward-compatible features.
  - **PATCH** (`1.1.1`) — fixes, dependency bumps, docs.
- **One tag per promotion**, on the merge commit on `main`.
- **Emergency re-release** (a release shipped broken): cut a **PATCH** bump (`1.2.1`); do not reuse or suffix the bad tag.

#### Release notes

The version number carries the compatibility signal; the release notes and `CHANGELOG.md` explain *what* changed. Each promotion PR body includes a curated notes block:

```markdown
## v1.2.0

### Features
- Persistable named views (#56)
- Outline rendering mode (#61)

### Fixes
- ...

### Breaking changes
- ...  (or: "None")

### Dependencies
- ...  (omit if no bumps)
```

The **Breaking changes** section must be explicit, and **a non-empty Breaking changes section requires a MAJOR version bump**. It includes: changes to `.linkml-editor.yaml` manifest format, removed or renamed user-facing features, required migrations, and any change that would make a working older project misbehave on the new version. Agents must flag these candidates when drafting notes; owner makes the final call.

After merge, `gh release create --notes-file` uses the curated notes as the GitHub release description.

### Do not

- Open feature PRs against `main`.
- Bundle multiple unrelated features into one branch or PR.
- Force-push shared branches (`main`, `dev`).
- Merge without green CI.
- Use `--no-verify`, `--no-gpg-sign`, or other hook-skipping flags unless explicitly asked.

### Specs backlog (`specs/backlog/`, `specs/done/`)

`specs/backlog/` holds proposals and evaluations for internal tooling/process work (e.g. Claude Code rules and skills) that don't warrant a GitHub issue of their own. `specs/done/` holds the same files once acted on.

- When a spec's recommendations are actually implemented (not just proposed), `git mv` the file from `specs/backlog/` to `specs/done/` as part of that same change — don't leave a completed spec sitting in `backlog/`.
- Commit that move together with the implementation using a compact Conventional Commits message (see "Commits" above for the prefix set) describing what was implemented, not "move spec to done."

## Application Error Handling

**No silent failures: every error must propagate and be visible, never swallowed.** An empty `catch {}`, a `.catch(() => {})` that discards the error, a `void somePromise()` on a call that can actually reject, or a try/catch that only logs to the console and continues as if nothing happened — all of these hide a real failure from the user and from whoever debugs this later. The operation looks like it succeeded when it didn't (a write that silently didn't happen, a manifest that silently didn't save, a background sync that silently stopped). Every catch/rejection must do one of: re-throw, surface the error to the user (toast/banner/dialog — see the fetch-error rule below for what that message should say), or, for the rare case where genuinely nothing user-facing can be done (e.g., a best-effort debounced background write where the next successful write will self-correct), at minimum log it loudly enough that it's traceable — never a bare no-op. This applies everywhere: async writes (manifest writes, git operations, file I/O), event handlers, debounced/background operations, promise chains — not just the user-facing error paths the rest of this section covers.

**No security-by-obscurity: catch errors and surface what actually happened, don't paper over an unknown cause with a confident-sounding guess.** A caught error shown to the user should describe what the code actually knows, not a specific diagnosis the code cannot verify — a plausible-looking guess is worse than an honest "something went wrong," because it actively misdirects troubleshooting toward the wrong problem.

Concretely, the incident that prompted this rule: `projectLoader.ts`'s `openSchemaFromUrl` and `ImportSchemaDialog.tsx` both treated any `fetch()` failure whose message was exactly `"Failed to fetch"` as proof of a CORS policy rejection, and told the user so. But the Fetch API throws that identical, deliberately uninformative message for many distinct underlying causes — DNS failure, a reset connection, being offline, a browser extension blocking the request, a cold TLS handshake to a not-yet-contacted host, and an actual CORS rejection all look the same to JS; the browser withholds the real reason by design, for cross-origin security reasons. Labeling all of them "CORS" was a guess dressed up as a diagnosis. It was caught because the exact same URL succeeded on an unmodified retry moments later — proof the label was wrong, since a real CORS policy violation fails consistently, not intermittently.

When an error's true cause can't be reliably determined from the API surface available, say so honestly (e.g. "network request failed — try again" with the raw error message alongside, or a link to the browser console) rather than asserting a specific cause the code has no way to actually verify. This applies to any user-facing error path in the app (fetch failures, file I/O, git operations, YAML parse errors, etc.), not just the CORS case above.

## Architecture

### Monorepo Layout (4 packages)

- **`packages/core`** — Platform-agnostic shared library. Contains all React components, Zustand state, LinkML model, YAML I/O, validation, and canvas rendering. This is where most development happens.
- **`packages/web`** — Vite web build harness. Provides the platform adapters (`WebPlatform`, `ElectronPlatform`, `CloudPlatform`) and the app entry point (`main.tsx`). This is the primary supported deployment target.
- **`packages/electron`** — Electron main process. Provides IPC handlers implementing PlatformAPI via Node.js fs + isomorphic-git. Preload script bridges to renderer. **Experimental** — preserved for community interest, not part of the supported surface (see README).
- **`packages/docs`** — VitePress documentation site.

### Platform Abstraction

The `PlatformAPI` interface (`packages/core/src/platform/PlatformContext.ts`) defines file I/O and git operations. Implementations live in `packages/web/src/platform/`:
- `WebPlatform.ts` — browser APIs + isomorphic-git/lightning-fs (OPFS)
- `ElectronPlatform.ts` — thin IPC bridge to the electron main process
- `CloudPlatform.ts` — wraps a local platform (Web or Electron) to add GitHub sync: every write triggers a debounced auto-commit+push, and it exposes extra methods (`cloneProject`, `createProject`, `listProjects`, etc.) beyond the base `PlatformAPI`. `ProjectRegistry.ts` tracks GitHub-backed projects connected on the machine/browser.

The active platform is provided via React context. All file/git operations go through this abstraction. GitHub auth (`packages/core/src/auth/GitHubAuth.ts`) uses OAuth Device Flow (RFC 8628) with no client secret, storing tokens via the platform's credential storage.

### State Management

Zustand store (`packages/core/src/store/index.ts`) composed of 7 slices: Project, Canvas, Editor, Git, UI, Validation, Views. Undo/redo via zundo middleware (`partialize`d to `activeProject`/`activeSchemaId` only — canvas/UI ephemeral state is excluded, 50-item history).

### Key Modules in Core

- **`model/`** — TypeScript types mirroring LinkML metamodel (ClassDefinition, SlotDefinition, EnumDefinition, etc.)
- **`io/yaml.ts`** — YAML round-trip parsing/serialization. Preserves unknown fields via `extras` map.
- **`io/importResolver.ts`** — Resolves LinkML `imports:` directives, builds dependency graph.
- **`io/manifest.ts` / `io/editorManifest.ts`** — reads/writes the `.linkml-editor.yaml` project manifest (schema paths, persisted layout, GitHub project config). Changes to this format are a breaking (MAJOR) change — see the release rules above.
- **`canvas/`** — ReactFlow canvas: custom ClassNode/EnumNode, ELK-based auto-layout (`autoLayout.ts`), schema-to-graph derivation (`deriveGraph.ts`), plus alternate Outline/Table views.
- **`editor/`** — Properties panel, project panel, validation panel, command palette.
- **`validation/`** — Schema validation producing errors and warnings.
- **`project/`** — Project loading (`projectLoader.ts`) and recent-projects tracking (`recentProjects.ts`).
- **`ui/`** — Hand-rolled UI primitives (Button, Dialog, form fields) styled via CSS custom properties in `tokens.css`/`globals.css` — no component/CSS framework is bundled.

### Electron Build

Electron bundles the web dist as `extraResources` and serves it via a custom `app://` protocol (not `file://`). The electron-builder config is in `packages/electron/package.json`.

## Tech Stack

- React 19, TypeScript 6, Vite 8, Vitest 4 (jsdom), Playwright (E2E, `packages/web`)
- ReactFlow 11 (canvas), Zustand 5 + zundo (state/undo), js-yaml 5 (YAML), elkjs (auto-layout)
- Custom CSS-token-based UI primitives (no component/CSS framework)
- isomorphic-git + @isomorphic-git/lightning-fs (browser git over OPFS)
- Electron 42, electron-builder 26
- driver.js — in-app guided tours (`core/src/tours/`)

## Requirements

- Node.js >= 20.0.0
- pnpm >= 9.0.0
