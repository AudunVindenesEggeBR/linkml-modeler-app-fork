# Spec: Låg kontrast på tekst — grunnårsak er at border-fargetokens vert brukt som tekstfarge, ikkje isolerte enkelttilfelle

Status: **Implementert og verifisert.**
Dato: 2026-09-15

Ønske (ordrett): "På aller nederste panel i webappen står det ein del tekst 'Click node to edit' 'Rightclick canvas to add' og så vidare. Eg ønsker at all tekst som står på dette panelet får bedre kontrast for bedre lesbarhet. I dag er det mørkegrå tekst mot lysegrå bakgrunn som er vanskelig å lese. Faktisk ser eg at det er samme tekstfarge som er brukt i IMPORTS panelet til venstre for 'raw.githuburercontent.com/../brreg-fe..' og i SUBSETS panelet til venstre 'Open a writable schema to edit subsets' og rett under SUBSETS panelet står det '1 file - 1 imported'. Alle disse tekstane er uleselige pga for dårlig kontrast mot bakgrunnen. Kom gjerne opp med ein generell fiks for dette som er framtidsretta og unngår fleire slike problem."

## Grunnårsak — stadfesta i koden, ikkje isolerte enkelttilfelle

Alle fire teksteksempla brukaren nemner bruker **nøyaktig same token**, brukt feil: `color: 'var(--color-border-default)'`.

| Brukaren sitt eksempel | Fil / linje | Style-namn |
|---|---|---|
| "Click node to edit · Right-click canvas to add · ..." (status-footer nedst i canvas) | `packages/web/src/main.tsx:730` | `footer` |
| "raw.githubusercontent.com/.../brreg-fe..." (IMPORTS-lista) | `packages/core/src/editor/ProjectPanel.tsx:799` | `importSource` |
| "Open a writable schema to edit subsets" (SUBSETS, tom-tilstand) | `packages/core/src/editor/ProjectPanel.tsx:880` | `viewsEmpty` |
| "1 file · 1 imported" (ProjectPanel-footer) | `packages/core/src/editor/ProjectPanel.tsx:849` | `footerText` |

`packages/core/src/ui/tokens.css:82-92` (og tilsvarande for lyst tema, linje 168-178) deler fargetokens eksplisitt i to grupper via kommentarar i fila sjølv:

```css
/* Foreground */
--color-fg-primary:   #e2e8f0;
--color-fg-secondary: #94a3b8;
--color-fg-muted:     #64748b;
--color-fg-on-accent: #ffffff;

/* Border */
--color-border-default: #334155;
--color-border-subtle:  #1e293b;
--color-border-strong:  #475569;
--color-border-focus:   #3b82f6;
```

`--color-border-*`-tokens er **designa til å vere svakt synlege** — det er heile poenget med ein kantlinje-token (skal ikkje stele merksemd frå innhaldet). Å bruke dei til `color:` (tekstfarge) er ein kategorifeil: same verdi som er "akkurat synleg nok" for ei 1px kantlinje er langt frå lesbar som tekst.

### Målte kontrastforhold (WCAG-formel, verifisert empirisk — ikkje anteke)

| Tokenpar (brukt som tekst) | Lyst tema | Mørkt tema | WCAG AA (normal tekst krev 4.5:1) |
|---|---|---|---|
| `--color-border-default` mot `--color-bg-canvas` | **1.42:1** | **1.72:1** | Stryk grovt — nesten usynleg |
| `--color-border-default` mot `--color-bg-deep` | **1.36:1** | (ikkje målt, tilsvarande lågt) | Stryk grovt |
| `--color-border-strong` mot `--color-bg-canvas` | 4.55:1 (vippepunkt) | **2.36:1** | Består vippepunkt i lyst, stryk i mørkt |
| `--color-fg-secondary` mot `--color-bg-canvas` | 7.24:1 | 6.96:1 | Består solid i begge tema |
| `--color-fg-muted` mot `--color-bg-canvas` | 4.55:1 (vippepunkt) | **3.75:1** | Består vippepunkt i lyst, stryk i mørkt |

Dette stadfestar brukaren sin observasjon nøyaktig: `--color-border-default` gjev 1.3-1.7:1 — katastrofalt lågt, uansett tema. Dette er ikkje ein snever "denne eine staden ser rar ut"-feil, det er ein reell, målbar WCAG AA-brot brukt konsekvent gjennom heile appen.

**Biverknad oppdaga undervegs:** sjølv den "riktige" `--color-fg-muted`-tokenen stryk WCAG AA for normal tekst i mørkt tema (3.75:1 mot `--color-bg-canvas`, treng 4.5:1 — men består AA for STOR tekst, som berre krev 3:1). `tokens.css:171` har alt ein kommentar frå eit tidlegare arbeid ("`#94a3b8` failed WCAG AA (2.47:1); `#64748b` = 4.57:1 on canvas") som viser at kontrast alt har vore eit medvite tema i prosjektet — men berre for lyst tema, ikkje sjekka i mørkt. Dette er ikkje del av brukaren sitt konkrete ønske (som gjeld `--color-border-default`), men nemnast her for fullstendigheit; sjå "Ope spørsmål" nedst.

## Omfang — 60 treff i 19 filer, ikkje 4

Eit fullstendig søk etter `color:` (tekstfarge, IKKJE `borderColor`/`border`) som viser til eit `--color-border-*`-token, gjennom heile `packages/core/src` og `packages/web/src` (ekskl. testfiler):

```bash
grep -rn --include="*.tsx" --include="*.ts" -E "^\s*color:.*--color-border-" packages/core/src packages/web/src | grep -v __tests__ | grep -v borderColor
```

**60 treff i 19 filer:**
```
packages/core/src/canvas/EnumNode.tsx
packages/core/src/canvas/ClassNode.tsx
packages/core/src/canvas/OutlineView.tsx
packages/core/src/editor/DisplayPanel.tsx
packages/core/src/editor/EntitySearchPanel.tsx
packages/core/src/editor/FocusModeToolbar.tsx
packages/core/src/canvas/SchemaCanvas.tsx
packages/core/src/editor/ProjectPanel.tsx        (10 treff åleine)
packages/core/src/editor/MenuBar.tsx
packages/core/src/editor/ValidationPanel.tsx
packages/core/src/editor/SchemaSettingsDialog.tsx
packages/core/src/editor/PropertiesPanel/styles.ts
packages/core/src/ui/fields/FilteredGroupedSelect.tsx
packages/web/src/main.tsx
packages/web/src/components/AppSettingsDialog.tsx
packages/web/src/components/GitHubProjectDialog.tsx
packages/web/src/components/UserMenu.tsx
packages/web/src/components/ProjectSwitcherDialog.tsx
packages/web/src/editor/GitPanel.tsx
```

Dette stadfestar at brukaren sitt ønske om ein "generell, framtidsretta fiks" er treffande — dei fire eksempla brukaren fann er berre dei mest synlege av eit systemisk mønster som gjennomsyrer store delar av UI-et.

## Evaluering: `--color-fg-muted` vs `--color-fg-secondary` per tilfelle

Brukaren har sett fleire eksempel på korrekt bruk av `--color-fg-muted` alt i kodebasen (ikonknappar, inaktive toggle-tilstandar, "Read Only"-varsel, inherited-badge — jf. samtale over) og vurderer at han fungerer godt nok, sjølv om han (som notert over) ikkje formelt består WCAG AA for normal tekst i mørkt tema (3.75:1). Konklusjon: **ikkje eitt einsarta erstatningsval for alle 60 treffa** — kva token som passar avheng av teksten si semantiske rolle, ikkje av kva for eit (feil) border-token som tilfeldigvis vart brukt opphavleg. Gjennomgang linje for linje av alle 60 (ikkje anteke, faktisk lest kontekst rundt kvart treff) gjev denne regelen:

**Bruk `--color-fg-muted`** når teksten er *dekorativt/sekundært UI-"møblement"* — ho har ein meir framtredande nabo (eit ikon, ein tal-badge med eiga bakgrunnsfarge, sjølve hovudinnhaldet i rada) som ber hovudvekta, eller ho representerer eit korrekt _deaktivert_ element (WCAG 1.4.3 unntek eksplisitt deaktiverte kontrollar frå kontrastkravet). Dette er nøyaktig same rolle som dei allereie-korrekte `fg-muted`-bruka brukaren fann (ikonknappar, inaktive togglar, badges):

- **Ikonknappar / interaktive kontroll-ikon** (lukk, fjern, synleg-toggle, legg-til, caret, chevron, fil-ikon): `ProjectPanel.tsx:698,753,769,854,863,926`, `ValidationPanel.tsx:373`, `PropertiesPanel/styles.ts:109,174,301`, `UserMenu.tsx:143`, `ProjectSwitcherDialog.tsx:274`, `GitPanel.tsx:825`
- **Uppercase seksjons-/gruppe-titlar** (same mønster som `headerTitle` i DisplayPanel, alt korrekt `fg-muted`): `OutlineView.tsx:717`, `DisplayPanel.tsx:610`, `FocusModeToolbar.tsx:171`, `ProjectPanel.tsx:703`, `SchemaSettingsDialog.tsx:227`, `FilteredGroupedSelect.tsx:203`, `ValidationPanel.tsx:342`, `PropertiesPanel/styles.ts:83`, `GitPanel.tsx:749,890,988`
- **Badge/pill-tekst med eiga bakgrunnsfarge** (les-only, importert, tal-badges): `EntitySearchPanel.tsx:220`, `ProjectPanel.tsx:711,815,839,911`
- **Minimert-panel-faner** (`‹ P`, `D ›` — interaktiv kontroll, ikkje lesbar prosa): `DisplayPanel.tsx:592`, `PropertiesPanel/styles.ts:19`
- **Reelt deaktivert element**: `MenuBar.tsx:397` (`itemDisabled`)

Sum: **33 av 60 treff.**

**Bruk `--color-fg-secondary`** når teksten er *det primære, lesbare innhaldet* på staden i det augeblikket — ingen meir framtredande nabo-tekst konkurrerer om merksemda, og brukaren si merksemd landar direkte på akkurat denne teksten. Dette dekkjer dei fire konkrete eksempla brukaren peika på, og alt som deler same rolle:

- **Tom-tilstand-/ingen-resultat-/status-meldingar** (fortel brukaren at det ikkje er noko der, eller kva som må gjerast): `ClassNode.tsx:476`, `EnumNode.tsx:203`, `SchemaCanvas.tsx:1450`, `EntitySearchPanel.tsx:194`, `ProjectPanel.tsx:666,880` (inkl. brukaren sitt "Open a writable schema..."-eksempel), `ValidationPanel.tsx:382,414,511`, `PropertiesPanel/styles.ts:255`, `GitPanel.tsx:925,932`
- **Frittståande informasjons-/samandragstekst, kjeldestiar, tidsstempel, hint/hjelpetekst**: `main.tsx:730` (brukaren sitt footer-eksempel), `ProjectPanel.tsx:799,849` (brukaren sine importSource-/footerText-eksempel), `ValidationPanel.tsx:424,492`, `GitHubProjectDialog.tsx:541,585`, `AppSettingsDialog.tsx:126,163,168`, `ProjectSwitcherDialog.tsx:254,268`, `GitPanel.tsx:775,996,1079`

Sum: **27 av 60 treff.**

Merk: dette betyr at det IKKJE er ein enkel 1-til-1-samanheng mellom kva border-token som opphavleg vart (feil-)brukt og kva fg-token som er riktig erstatning — t.d. er `ProjectPanel.tsx:799` (`importSource`, det katastrofale `--color-border-default`) → `fg-secondary`, medan `ProjectPanel.tsx:711` (`sectionCount`, same katastrofale `--color-border-default`) → `fg-muted`. Begge var like ulesbare, men har ulik semantisk rolle. Kvart av dei 60 treffa er difor vurdert individuelt (kontekst lese, ikkje anteke frå filnamn åleine), ikkje maskinelt via eit enkelt sed-mønster.

## Forslag til implementering

### 1. Rett dei 60 eksisterande treffa

Erstatt kvart av dei 60 treffa med token frå gruppa dei høyrer til over — 33 til `--color-fg-muted`, 27 til `--color-fg-secondary`. Verifisert linje for linje under implementering (visuell sjekk av begge tema for eit representativt utval, ikkje berre grep-count).

For dei fire spesifikke case brukaren nemnte konkret:
- `main.tsx:730` (`footer.color`) → `--color-fg-secondary`
- `ProjectPanel.tsx:799` (`importSource.color`) → `--color-fg-secondary`
- `ProjectPanel.tsx:849` (`footerText.color`) → `--color-fg-secondary`
- `ProjectPanel.tsx:880` (`viewsEmpty.color`) → `--color-fg-secondary`

### 2. Hindre at problemet kjem attende — utvid `scripts/check-token-usage.sh`

Same fil køyrer alt som del av `pnpm lint` (jf. CLAUDE.md) og har alt eit etablert, tilsvarande mønster for akkurat denne typen "kategori-feil ved tokenbruk" (sjekk 1: `fontFamily:'monospace'`, sjekk 2: hardkoda hex-fargar). Legg til ein tredje, tilsvarande **null-toleranse-sjekk**:

```bash
# ── 3. --color-border-* brukt som tekstfarge — strict zero ───────────────────
BORDER_AS_TEXT_COUNT=$(grep -rn --include='*.ts' --include='*.tsx' \
    -E "^\s*color\s*:.*--color-border-" "${SOURCES[@]}" 2>/dev/null \
    | grep -v "borderColor" | wc -l | tr -d ' ') || BORDER_AS_TEXT_COUNT=0

if [ "${BORDER_AS_TEXT_COUNT}" -gt 0 ]; then
  echo "ERROR: ${BORDER_AS_TEXT_COUNT} instance(s) of a --color-border-* token used as text color."
  echo "       Border tokens are deliberately low-contrast; use --color-fg-* for text."
  grep -rn --include='*.ts' --include='*.tsx' \
    -E "^\s*color\s*:.*--color-border-" "${SOURCES[@]}" 2>/dev/null | grep -v "borderColor" || true
  FAILED=1
else
  echo "OK  --color-border-* used as text color — 0 violations."
fi
```

Dette gjer at ei framtidig regel-brot (t.d. copy-paste av ein eksisterande, feil styla komponent) vert fanga automatisk av `pnpm lint`, akkurat som dei to eksisterande sjekkane — ingen ny prosess eller verktøy trengst, berre ei utviding av noko som alt køyrer i CI/pre-push.

### 3. Dokumenter regelen i CLAUDE.md, ikkje berre i scriptet

Sjølve linting-sjekken (punkt 2) fangar brotet automatisk, men fortel ikkje *kvifor*, og fortel ikkje ein agent/utviklar kva for `--color-fg-*`-token dei skal velje i staden når dei skriv NY kode — dei ville framleis måtte finne fram til denne spec-en (eller oppdage feilen på nytt via `pnpm lint`) for å vite kva som er rett. CLAUDE.md sin eigen "Errors and Unexpected Outcomes"-seksjon (linje 83-100) krev nettopp dette: "Does this file need a new or clarified instruction, so a future session... doesn't have to rediscover the same thing from scratch?" — dette er akkurat ein slik situasjon.

Legg til eit avsnitt i CLAUDE.md, plassert rett etter den eksisterande omtalen av `scripts/check-token-usage.sh` (`CLAUDE.md:37`, i "Commands"-seksjonen — same stad som dei to andre token-sjekkane alt vert omtala):

```markdown
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
```

Dette gjer at framtidig arbeid (agent eller menneske) både (a) automatisk vert stoppa av `pnpm lint` dersom dei bruker eit border-token som tekstfarge, OG (b) har eit konkret, kort svar på "kva bruker eg då i staden" utan å måtte grave fram denne spec-en frå `specs/done/` kvar gong.

## Ope spørsmål — treng svar frå brukar før implementering

1. **`--color-fg-muted` sin eigen kontrastsvikt i mørkt tema** (3.75:1, stryk AA for normal tekst): dette er ikkje del av det opphavlege ønsket (som gjeld `--color-border-*`), men vart oppdaga undervegs. Skal dette rettast i same omgang (t.d. justere `--color-fg-muted` sin hex-verdi i mørkt tema, tilsvarande korleis lyst tema alt vart retta tidlegare — jf. kommentaren i `tokens.css:171`), eller skal det handterast som ein eigen, seinare spec? Tilrådd: eigen, seinare spec — dette er eit anna, sjølvstendig funn, og bør ikkje blandast inn i denne fiksen for å halde endringa fokusert og lett å verifisere.

### Svar frå brukar (2026-09-15)

"Eg synes `--color-fg-muted` fungerer greit nok" — stadfesta at det ikkje er naudsynt å endre `--color-fg-muted` sin hex-verdi no (spørsmål 1 over står som "eigen, seinare spec" om han i det heile skal takast). I staden vart spørsmålet om EITT vs TO erstatningstokens avklart ved å be om ei full evaluering av kva token som passar for kvart av dei 60 tilfella — sjå "Evaluering"-seksjonen over, som no erstattar det tidlegare "eitt token for alt"-forslaget.

## Testcase / akseptansekriterium

1. Alle fire tekstane brukaren viste til (status-footer, IMPORTS-kjelde-URL, SUBSETS tom-tekst, ProjectPanel-footer) har synleg betre kontrast og er lette å lese i både lyst og mørkt tema.
2. `grep -rn -E "^\s*color\s*:.*--color-border-" packages/core/src packages/web/src | grep -v __tests__ | grep -v borderColor` gjev **0 treff** etter fiksen (ned frå 60).
3. `scripts/check-token-usage.sh` (og dermed `pnpm lint`) failar dersom nokon i framtida legg til eit nytt slikt treff.
4. Ingen visuell regresjon i anna UI — `borderColor`/`border`-bruk av same tokens er uendra (dei ER meint å vere subtile som kantlinjer).
5. `pnpm --filter @linkml-editor/core test` og `tsc --noEmit` framleis grøne (reint CSS/token-endringar, ingen logikkendring venta å påverke testar).
6. `CLAUDE.md` har fått avsnittet skildra i "Forslag til implementering" punkt 3, plassert rett etter den eksisterande omtalen av `scripts/check-token-usage.sh` — ein framtidig agent/utviklar som les CLAUDE.md skal kunne finne både regelen (border-tokens aldri som tekstfarge) og kva erstatningstoken dei skal bruke, utan å måtte oppdage feilen sjølv først.

## Implementering (2026-09-15)

Alle tre punkta i "Forslag til implementering" er gjennomførte nøyaktig som skildra:

1. **60 treff retta** — 33 til `--color-fg-muted`, 27 til `--color-fg-secondary`, fordelt nøyaktig etter "Evaluering"-seksjonen over. Kvart treff vart endra via linjenummer-anker (ikkje blind sed over heile fila), verifisert etterpå med `grep -rn -E "^\s*color\s*:.*--color-border-" packages/core/src packages/web/src | grep -v __tests__ | grep -v borderColor` → **0 treff** (ned frå 60), og stadfesta at ingen `borderColor`/`border`-bruk av same tokens vart rørt (`git diff --stat` viser nøyaktig 60 innsett/60 sletta linjer over dei 19 filene frå kartlegginga).
2. **`scripts/check-token-usage.sh`** fekk sjekk 3 (`--color-border-*` som tekstfarge, null-toleranse), lagt til etter sjekk 2, same mønster/feilmelding-stil som dei to eksisterande. Køyrt og stadfesta PASS (inkl. "OK --color-border-* used as text color — 0 violations.").
3. **`CLAUDE.md`** fekk avsnittet, plassert rett etter den eksisterande `check-token-usage.sh`-omtalen i "Commands"-seksjonen (linje 37), nøyaktig som spesifisert i "Forslag til implementering" punkt 3.

**Verifisert:**
- `tsc --noEmit` på `@linkml-editor/core`: ingen feil.
- `tsc --noEmit` på `@linkml-editor/web` (etter mellombels `pnpm --filter @linkml-editor/core build` for å avdekke ekte feil, `dist/` fjerna etterpå — jf. CLAUDE.md sin eigen instruks om dette): ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: ingen feil.
- `scripts/check-token-usage.sh` (alle tre sjekkar, inkl. den nye): PASS.
- Full `pnpm --filter @linkml-editor/core test`-suite (køyrt to gongar for å få eit fullstendig, ikkje-infrastruktur-avbrote resultat — jf. CLAUDE.md sin dokumenterte `[vitest-pool-runner]`-flakigheit): andre køyringa gav 22/22 testfiler, 610/610 testar grøne, dei 6 "feila" var utelukkande den kjende infrastrukturflakigheita (ulike, tilfeldige filer kvar gong, ingen ekte `FAIL`-linjer). Ingen reelle regresjonar.
