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

A `pre-push` git hook (installed via the root `prepare` script, `.githooks/pre-push`) runs core unit tests and the Playwright E2E suite before every push; expect pushes to take longer than the raw git operation.

### When the host has no Node/pnpm

Some environments this repo is worked in (see `deploy/web/check-requirements.sh` and the Podman deployment docs) have no Node/pnpm installed on the host at all — only a container runtime. To build or run tests there, run the pnpm command inside a throwaway container instead of failing or trying to install Node system-wide:

```bash
podman run --rm -v "$(pwd)":/repo -w /repo docker.io/library/node:22-alpine sh -c "
  corepack enable && corepack prepare pnpm@9.15.9 --activate &&
  pnpm install --frozen-lockfile &&
  pnpm --filter @linkml-editor/core test
"
```

This reliably takes several minutes — a cold `pnpm install` alone is commonly 60-90s, before any build or test time on top. **Always pass an explicit long timeout on the tool call running this** (5-10+ minutes); a default ~120s tool timeout will silently move the command to the background partway through `pnpm install`, which is disruptive mid-task and easy to mistake for a hang. This is a tool-invocation setting, not something to fix by adding `timeout N` inside the shell command itself — an in-shell `timeout` only kills the process at N seconds, it does not raise the tool's own execution budget.

**Always pin a full, exact `pnpm` version (`X.Y.Z`), never a bare major (`pnpm@9`, `pnpm@10`) or `corepack enable` alone with no `prepare` step.** `corepack prepare pnpm@<major>` has to make a live registry call to resolve which concrete patch version satisfies that major; on any transient failure of that specific call (seen in this environment as `Internal Error: Error when performing the request to https://registry.npmjs.org/pnpm`, easy to miss since it scrolls by before the real error), corepack silently falls back to whichever pnpm build is bundled in the base image (`node:22-alpine`'s corepack currently bundles pnpm 12.3.4) instead of failing loudly. pnpm 12.x has a real, unrelated breaking change — it no longer reads the legacy `pnpm.overrides` field in `package.json` — so installing under it against this repo's `pnpm-lock.yaml` (`lockfileVersion: '9.0'`) fails with `Error: ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. **The symptom is a lockfile-mismatch error that has nothing to do with the lockfile actually being stale** — don't "fix" it by regenerating the lockfile with `--no-frozen-lockfile`. The fix is pinning the exact version above: an exact `X.Y.Z` skips the version-range resolution step entirely (verified — no registry call, no warning, clean install), so there's nothing left for a transient network hiccup to silently override. If `9.15.9` is ever no longer installable, pick any current pnpm 9.x patch release (the major must match this repo's `lockfileVersion: '9.0'`) and pin it exactly the same way, not as a bare `9`.

**Clean up afterward, every time:** because this bind-mounts the live working tree (not an isolated volume), `pnpm install` writes a real `node_modules` (and sometimes a stray `.pnpm-store`, if pnpm can't use its usual global store location inside the ephemeral container) onto the host. Both are gitignored, but neither is automatically removed. Run `rm -rf node_modules packages/*/node_modules .pnpm-store` when done — otherwise `deploy/web/Dockerfile.web`'s `COPY . .` (or any Dockerfile doing the same) will copy this into the build context on the next `podman build`/`podman-compose build`, which over this kind of container's bind-mount I/O can look exactly like a hang (real incident: turned a few seconds of copying into multi-minute stalls). This is also why `.dockerignore` at the repo root excludes `node_modules` and `.pnpm-store` explicitly — both must stay covered if either changes.

**vitest in this kind of container intermittently fails with `[vitest-pool-runner]: Timeout waiting for worker to respond` (~60s duration).** This is a jsdom-environment cold-start exceeding vitest's internal worker-ready timeout on a slow bind-mounted filesystem — not a code bug, and not tied to any specific test file (it hits an effectively random file each run: seen on `gitSlice.test.ts`, `editor-panels.test.tsx`, and `tours.test.ts` across different runs with no code changes to any of them). For a pure-logic test file with no DOM/React rendering, run it with the CLI flag `--environment node` to sidestep it — this is more reliable than routing it through `vitest.config.ts`'s `environmentMatchGlobs`, which did not reliably apply per-file in this environment when tried. Otherwise, just retry; a full-suite run typically has a handful of these among hundreds of passing files.

## Errors and Unexpected Outcomes

Whenever something in a session doesn't go as expected — a test fails, a build hangs, a tool times out, a "should already be correct" turns out wrong — treat it as a signal, not just an obstacle to fix and move past. Before considering that piece of work done, evaluate:

1. **Does this file need a new or clarified instruction**, so a future session — which starts with none of this session's hard-won context — doesn't have to rediscover the same thing from scratch?
2. **Would a project skill (`.claude/skills/`) or hook (`.claude/hooks/` via `.claude/settings.json`) prevent this class of error entirely**, rather than merely documenting how to recognize it?

If either applies, make the change in the same session — don't defer it. For a substantial finding, record the reasoning in `specs/done/` (or `specs/backlog/` if the underlying fix is still open), not just the fix, so later readers see *why*, not only *what*.

**Never write a project-relevant lesson only to Claude Code's private per-user memory.** That memory is local to one agent's account, unversioned, invisible to the user's own view of the repo, and invisible to every other human or agent contributor — it gives the lesson no notoritet (no durable, discoverable record for the project). Any lesson that would change how this repo should be worked in belongs in a place everyone can see and that ships with the repo: this file (CLAUDE.md), a project rule, or a project skill (`.claude/skills/`) — committed to git, exactly like the fixes this section already asks for. Private memory may still be used for things that are genuinely personal to one user's working style and have no bearing on the repo itself, but when in doubt, document it here instead of relying on memory.

This applies to: incorrect assumptions later contradicted by evidence, environment/tooling quirks (timeouts, flaky test infrastructure — see the two container/vitest notes just above, both added this way), and real bugs surfaced by testing. It does not apply to user typos or one-off external factors with no bearing on how this repo is worked in.

One general lesson worth stating outright, since it caused a real, time-costly mistake: **verify configuration empirically, not by code-reading alone.** Confirming that a value is passed through to a library call is not evidence the library understood it — a plausible-looking string can be silently ignored by a mismatched enum, with the caller none the wiser. (Concretely: `AutoLayoutOptions.direction` used `'TB'|'BT'|'LR'|'RL'`, forwarded as-is to elkjs's `elk.direction` — which only recognizes `DOWN|UP|LEFT|RIGHT` and silently ignores anything else, so every direction produced the same layout. An earlier pass through this same code had already claimed the option was "reelt kopla til algoritmen" [genuinely wired to the algorithm] on the strength of the value being forwarded correctly — that claim was wrong, and stood uncorrected until a UI control made the no-op impossible not to notice.) When asserting an option or setting "works" or is "connected," show a test where changing the value changes the output — don't infer it from the call site looking right.

**When unsure of a library/API's actual behavior, options, or valid values, check its official documentation before guessing from memory or convention.** Naming conventions from adjacent tools (e.g. assuming a graph-layout library uses Mermaid/dagre's `TB`/`LR` direction names) are a common way to be confidently wrong. Documentation and empirical verification are complementary, not substitutes for each other — check both when it matters: docs tell you what *should* be valid and give you the full candidate list to test; actually running the code against the installed version confirms what's *actually* true for that version, including bugs or version-skew the docs don't mention. (Concretely: fetching ELK's official option reference for `layered.layering.strategy` surfaced 9 documented enum values — but two of them (`BF_MODEL_ORDER`, `DF_MODEL_ORDER`) crash this repo's installed elkjs 0.11.1 on a plain graph with no model-order metadata, something no amount of reading the docs alone would have revealed. Checking docs without then testing against the real installed version would have shipped a UI control that crashes on two of its options.)

## Specification-driven development

This repo is developed spec-first. **Whenever the user describes something they want — a feature, a fix, a change of behavior — or asks for a suggestion, proposal, or recommendation ("kom med forslag", "what do you think", "how should we approach this"), write it up as a spec in `specs/backlog/` before writing any implementation code.** Only implement what the user explicitly asks to have built (e.g. "utfør", "implementer", "go ahead", or approving a specific option from the spec) — never infer implementation authorization from the mere reasonableness of an idea, however small the change looks.

- Being asked for options, a proposal, or a recommendation is **not** authorization to implement the recommended option. Write the proposal into the spec, with the reasoning/evidence behind it, then stop and let the user decide. (Concretely, the incident that prompted this rule: asked to "kom med forslag til kven av valga vi skal beholde" — come up with a proposal for which options to keep — the response went straight to editing application code instead of writing the proposal down first.)
- This holds even mid-conversation inside an already-open spec: adding a new "Runde N" analysis/recommendation section documenting findings and a proposal is expected; going on to change the actual application code in the same turn, without the user separately asking for that specific change, is not.
- **An approval only covers what it names, not the full scope of whatever it's replying to.** When a spec's proposal covers several items (e.g. "remove these 5 options") and the user's approval names only some of them (e.g. "let's remove these 2"), implement exactly the named subset — do not fall back to the proposal's original full scope, even though the proposal is what prompted the approval. (Concretely: a proposal recommended reducing a 7-option picker to 2; the user approved removing only the 2 options they named by name; the response implemented the full reduction-to-2 anyway, and had to be corrected. The literal wording of the approval message is the source of truth, not the proposal it's replying to.)
- The standing authorizations already written elsewhere in this file (e.g. "Errors and Unexpected Outcomes": update this file, or add a skill/hook, without asking) are pre-approved classes of action and don't need a fresh spec-and-approval round trip each time they apply.
- See "Specs backlog" below for the `specs/backlog/` → `specs/done/` file lifecycle once something IS approved and implemented.

## Development Workflow

**All contributors — human or agent — MUST follow this workflow.** It exists to keep history reviewable and revertible. Do not deviate without first discussing with the project owner.

### Branches

- **`main`** — stable. Releases are tagged here. Only dependency bumps, hotfixes, and `dev → main` promotion PRs land directly on `main`.
- **`dev`** — integration branch. All feature work merges here. Periodically promoted to `main` in batches.

### Starting a feature

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
- **Do not add a `Co-Authored-By: Claude ...` / `Claude-Session: ...` trailer** to any drafted commit message — this project opts out of that attribution entirely.

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
