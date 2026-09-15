---
paths:
  - "packages/core/src/**/*.{ts,tsx}"
  - "packages/web/src/**/*.{ts,tsx}"
---

**`--color-border-*` tokens are for borders/outlines only — never for text `color:`.** They're
deliberately low-contrast (e.g. `--color-border-default` measures 1.4-1.7:1 against
`--color-bg-canvas`, far below the 4.5:1 WCAG AA text minimum — confirmed empirically, not just
visually). Use `--color-fg-*` for any `color:` property instead:
- `--color-fg-secondary` — standalone readable content with no more-prominent sibling text
  (empty-state/status messages, source paths, hints, footer summaries). Passes AA comfortably in
  both themes (~7:1).
- `--color-fg-muted` — de-emphasized UI chrome that sits next to something more prominent (icon
  buttons, uppercase section labels, badge text, collapsed-panel tabs) or a genuinely disabled
  element (WCAG 1.4.3 exempts disabled controls from the contrast requirement). Passes AA in light
  theme (~4.5:1) but is marginal in dark theme (~3.7-4.0:1) — acceptable for this de-emphasized
  role, not for primary content.

`scripts/check-token-usage.sh` (run by `pnpm lint`) enforces the first rule (zero-tolerance for
`--color-border-*` in a `color:` property); the muted-vs-secondary choice above is a judgment call
based on the text's role, not something a script can fully automate — see
`specs/done/border-token-used-as-text-color-contrast-fix.md` for the full case-by-case reasoning if
a new case doesn't clearly fit either bullet.
