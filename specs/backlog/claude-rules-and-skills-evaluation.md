# Evaluering: Claude Code-reglar og skills for dette repoet

Status: `promote-release` og `start-feature` implementert som skills (sjå `.claude/skills/`) og testa mot ein ekte issue (sjå "Testresultat" nedst). Reglane (hooks) er òg implementerte (sjå eige avsnitt nedanfor). `release-notes-draft` er vurdert på nytt i Runde 3 og halde utanfor som eige skill (framleis del av `promote-release`). `update-goldens` er vurdert på nytt i Runde 3 og no **anbefalt** implementert, men ikkje bygd enno — framleis eit ope forslag.
Dato: 2026-09-07 (oppdatert 2026-09-15, Runde 2 og 3)
Kontekst: `.claude/`-katalog finst ikkje enno i repoet. Alt av prosess-styring ligg i dag som prosa i `CLAUDE.md`, `CONTRIBUTING.md` og GitHub Actions-workflowar. Denne evalueringa ser på om noko av det bør bli til maskinlesbare Claude Code-reglar (hooks/settings) eller skills (`.claude/skills/*/SKILL.md`), basert på det som faktisk finst i repoet no.

## Kva peiker mot reglar/skills

Gjennomgang av repoet synte fleire stader der prosessen er godt spesifisert i tekst, men avhengig av at ein person (eller agent) hugsar og utfører fleire steg korrekt kvar gong:

- **`dev → main`-promotering** (`CLAUDE.md`) krev synk av `dev` mot `main`, grønn CI, oppdatering av `version`-feltet i **fire** `package.json`-filer i lockstep (`package.json`, `packages/core`, `packages/web`, `packages/electron`, `packages/docs`), oppdatering av `CHANGELOG.md`, ei kuratert PR-skildring med eit fast oppsett (Features/Fixes/Breaking changes/Dependencies), og deretter tag + merge-commit (ikkje squash) etter eigar-godkjenning. Mange manuelle steg, høg risiko for at eitt `package.json` blir gløymt.
- **Feature-oppstart** krev GitHub issue før branch, branch frå `dev` (ikkje `main`), og eit fast branch-namn-mønster (`feat/<issue#>-<slug>`). Lett å bryte ved eit uhell (spesielt: branche frå `main`).
- **Dependency-PRar** skal gå til `main` direkte, feature-PRar til `dev` — motsett av kva mange er vane med i andre repo.
- **`.linkml-editor.yaml`-manifestet** (`packages/core/src/io/manifest.ts`, `editorManifest.ts`) er eksplisitt nemnt som eit felt der endring krev MAJOR-bump. Dette er ikkje handheva noko stad, berre skrive ned.
- **`scripts/check-token-usage.sh`** handhevar CSS-token-bruk (ingen `fontFamily:'monospace'`, ingen rå hex-fargar) og køyrer som del av `pnpm lint`. Denne er allereie automatisert i CI, men reglane er ikkje synlege for ein agent før lint feilar.
- **`.githooks/pre-push`** køyrer unit- og E2E-testar før kvar push. Dette er allereie ei "regel", berre ikkje dokumentert som éin (no lagt til i `CLAUDE.md`).
- **Golden/round-trip-testar** (`packages/core/src/io/__tests__/round-trip.test.ts`) har ein `UPDATE_GOLDENS=1`-modus for medvite å oppdatere fixtures i `io/__fixtures__/`. Lett å gløyme at dette finst, og lett å køyre ved eit uhell utan å sjå gjennom diffen.
- **Release-notat-formatet** har eit fast malmønster (`## vX.Y.Z` → Features/Fixes/Breaking changes/Dependencies) henta frå PR-ar merga til `dev` sidan siste tag — dette er i dag reint manuelt arbeid.

## Forslag til skills

Skills er best eigna der arbeidet er fleire-steg, gjentakande, og har ein tydeleg "riktig rekkjefølgje" som alt er spesifisert i `CLAUDE.md`. Foreslått som `.claude/skills/<namn>/SKILL.md` i repoet (prosjekt-scoped, versjonert saman med koden):

1. **`promote-release`** *(implementert — `.claude/skills/promote-release/SKILL.md`)* — automatiserer promoterings-sjekklista: synk `dev` mot `main`, sjekk CI-status via `gh`, bump `version` i alle fem `package.json`-filer i lockstep, generer forslag til `CHANGELOG.md`-oppføring og PR-skildring frå merga PR-ar sidan siste tag, opprett **draft**-PR (aldri merge autonomt — det er alt eksplisitt kravd i `CLAUDE.md`). Høgast verdi: flest manuelle steg, høgast feilrisiko (fem filer i lockstep). Release-notat-utkastet (punkt 3 under) er lagt inn som eit steg inni dette skillet i staden for eit eige skill.
2. **`start-feature`** *(implementert — `.claude/skills/start-feature/SKILL.md`)* — tek issue-nummer/tittel, opprettar (eller finn) GitHub issue, sjekkar ut/oppdaterer `dev`, lagar branch med korrekt `feat|fix|chore|docs/<issue#>-<slug>`-mønster. Låg kompleksitet, høg gjentaksfrekvens.
3. **`release-notes-draft`** *(ikkje implementert som eige skill — sjå punkt 1)* — køyrer `gh pr list --base dev --state merged` sidan siste tag og formaterer det inn i den faste release-notat-malen (Features/Fixes/Breaking changes/Dependencies).
4. **`update-goldens`** *(ikkje implementert)* — køyrer `UPDATE_GOLDENS=1 pnpm --filter @linkml-editor/core test`, viser diff i `io/__fixtures__/` for gjennomsyn før commit, i staden for at nokon køyrer miljøvariabelen direkte utan å sjå kva som endra seg.

## Forslag til reglar (`.claude/settings.json` hooks / permissions)

Reglar (hooks) passar best der målet er å **hindre** ei handling, ikkje utføre eit fleire-steg-arbeid:

1. **Blokker `gh pr create --base main`** frå ein branch som ikkje er `dev`, og ikkje matchar eit dependency/hotfix-mønster. Fangar det `CLAUDE.md` allereie forbyr ("Open feature PRs against `main`") før det skjer, ikkje berre som tekst-regel.
2. **Åtvaring ved diff i `io/manifest.ts` / `io/editorManifest.ts`**: ein `PreToolUse`/`PostToolUse`-hook (eller enklare: ei linje i `CLAUDE.md`, som alt delvis er lagt til) som minner om at endring i manifest-formatet krev MAJOR-bump i neste release.
3. **Blokker `git push --force` / `git branch -D` mot `main`/`dev`** — dekt av generelle Claude Code-tryggleiksreglar alt, men kan gjerast eksplisitt her sidan `CLAUDE.md` nemner det som eit "Do not"-punkt.

## Vurdert og ikkje foreslått

- **Eige skill for `pnpm lint`/`pnpm test`/`pnpm build`** — unødvendig, dette er alt trivielle eittkommando-kall som ikkje treng ein skill-wrapper.
- **Skill for Electron-pakking** — Electron er eksplisitt merkt experimental/ikkje-støtta i README; ikkje verdt investeringa før det evt. blir re-scopa.
- **Automatisk `CHANGELOG.md`-generering utan menneskeleg gjennomsyn** — `CLAUDE.md` er eksplisitt på at eigar skal godkjenne før merge; eit skill skal difor alltid stoppe ved draft-PR, aldri merge eller tagge sjølv.

## Anbefaling

Start med **`promote-release`**-skillet — det har flest manuelle steg, høgast feilrisiko (fem `package.json`-filer), og prosessen er alt 100 % spesifisert i `CLAUDE.md`, så det er berre snakk om å omsetje eksisterande tekst til eit køyrbart skill. `start-feature` er enklast å implementere og bør takast saman med det. Reglane (hooks) er valfrie forsterkingar — dei gir handheving, men skilla åleine dekkjer det meste av den faktiske smerten.

**Status:** Begge er implementerte (sjå `.claude/skills/`). Gjenstår i backlogen: `.claude/settings.json`-hooks for punkta under "Forslag til reglar", samt evt. `update-goldens`-skillet. Ingen av desse er hasteprioritet — flytt denne fila til `specs/done/` når/viss dei også blir tekne, eller behald ho her som open backlog for resten.

## Testresultat (mot ein ekte issue)

Testa begge skilla mot BU-Neuromics/linkml-modeler-app#172 (Node 20 EOL) — upstream-repoet CLAUDE.md-arbeidsflyten faktisk gjeld for. Denne forken (`AudunVindenesEggeBR/linkml-modeler-app-fork`) har berre `main` (ingen `dev`) og har issues avslått (`has_issues: false`), så testen var delvis eit tørrkøyr: verifiserte issue #172 via `gh issue view --repo`, oppretta ein lokal (aldri pusha) `chore/172-node-20-eol`-branch frå `main` i mangel av `dev`, og validerte `promote-release`-mekanikken sine `gh`-kall (`git describe --tags`, `gh pr list --base dev --state merged --search`) mot upstream sitt faktiske `dev`/tag-oppsett (siste tag `v1.2.0`). Fann og fiksa to reelle feil før dei rakk å bite nokon i produksjon:

1. **`promote-release` visste ikkje om `packages/proxy`.** Upstream sitt eige promoterings-issue #156 (som proposerer v1.2.1) seier eksplisitt at `@linkml-editor/cors-proxy` i `packages/proxy` held sin eigen versjon (`0.3.2`) og **ikkje** skal bumpast i lockstep med dei andre fem. Skillet sa "bump alle fem" utan å nemne at det finst ein sjette `package.json` som må la vere urørt — retta i Steg 5.
2. **Ingen av skilla handterte manglande `dev`-branch.** `git checkout dev` på eit repo utan `dev` feilar med ein rå `pathspec 'dev' did not match any file(s)`-feil. Begge skilla prøvde `git checkout dev` blindt; no sjekkar begge om `dev` finst først (`git show-ref` / `git ls-remote`) og stoppar med ei tydeleg forklaring i staden for å la brukaren tolke ein rå git-feil — og for `start-feature` spør dei om branchen skal opprettast frå `main` no, i staden for å gjere det stilt som eit sideeffekt.

`start-feature` sitt issues-disabled-handtering (sjekk `gh repo view --json parent` og fall tilbake til å spørje kva repo issuet skal liggje i) vart lagt til av same grunn, men er ikkje testa mot eit faktisk avslått-issues-tilfelle utover det denne forken viste (`gh issue create` vart aldri faktisk køyrt her, sidan #172 alt fanst upstream).

## Reglane (hooks) — implementert

Dei tre forslaga under "Forslag til reglar" er no implementerte som `PreToolUse`-hooks på `Bash`, registrerte i `.claude/settings.json` (project-scoped, sjekka inn) og med logikken i separate skript under `.claude/hooks/` (lettare å lese/teste enn inline ettlinjekommandoar):

1. **`.claude/hooks/block-main-pr.sh`** — blokkerer `gh pr create --base main` med mindre inneverande branch er `dev`, eller matchar `dependabot/*`/`hotfix/*`. Alt anna (`feat/*`, `fix/*`, `chore/*`, `docs/*`) vert avvist med forklaring om å PR-e mot `dev` i staden.
2. **`.claude/hooks/warn-manifest-change.sh`** — ved `git commit`, sjekkar staga filer for `packages/core/src/io/manifest.ts`/`editorManifest.ts` og legg på ei ikkje-blokkerande påminning om MAJOR-bump-kravet. Blokkerer aldri.
3. **`.claude/hooks/block-protected-branch-ops.sh`** — blokkerer force-push (`--force`/`--force-with-lease`/`-f`) og branch-sletting (`git branch -D`, `git push --delete`, kolon-sletting) retta mot `main`/`dev`, både eksplisitt namngjeve og via gjeldande branch.

**Testa:** Alle tre er pipe-testa direkte (syntetisk stdin-JSON) mot eit sett positive og negative case, inkludert kant-tilfelle. Dette avdekte og fiksa ein reell feil undervegs: `block-protected-branch-ops.sh` blokkerte i utgangspunktet *alle* force-push utan eksplisitt `main`/`dev`-namn ved å falle tilbake på gjeldande branch (`main` i denne forken), som ville ha blokkert eit heilt normalt `git push origin feat/1-foo --force` berre fordi brukaren tilfeldigvis stod på `main` — retta til berre å falle tilbake på gjeldande branch når *ingen* branch/refspec er oppgjeve i det heile.

**Ikkje verifisert end-to-end i denne økta:** Prøvde å bevise at ein hook faktisk vert trigga av eit ekte Bash-kall (sentinel-teknikken), men denne økta starta før `.claude/settings.json` fanst, så innstillings-overvakinga fanga ikkje opp den nye fila. Hookane er skrivne og validerte isolert, men treng at brukaren opnar `/hooks` (for å laste config på nytt) eller startar ei ny økt før dei faktisk er aktive.

## Runde 2 (2026-09-15): Kan delar av CLAUDE.md lastast ved behov i staden for alltid?

Ny vinkling på same tema: `CLAUDE.md` har vakse til 342 linjer (var ~15 linjer kortare før økta som la til tsbuildinfo-notatet same dag). Spørsmålet her er ikkje "bør noko bli eit skill" (jf. Runde 1), men reint **kontekst-økonomi**: kva i fila blir lasta inn i *kvar einaste* økt uansett kva oppgåva er, og kan noko av det i staden lastast berre når det faktisk trengst?

### Mekanismane som faktisk finst (verifisert mot offisiell dokumentasjon, ikkje anteke)

Henta frå `https://code.claude.com/docs/en/memory.md`, verifisert av `claude-code-guide`-agenten før noko vart foreslått under (jf. CLAUDE.md sin eigen regel om å sjekke dokumentasjon, ikkje gjette):

1. **Rot-`CLAUDE.md`** — lastar heilt og alltid inn ved økt-start. Ingen måte å gjere delar av rot-fila kondisjonell på.
2. **`.claude/rules/*.md`** — *automatisk/passiv* mekanisme, ingen modell-avgjerd involvert:
   - Ei fil **utan** `paths`-felt i frontmatter lastar akkurat som rot-`CLAUDE.md` — altså inga kontekst-innsparing, berre fil-organisering.
   - Ei fil **med** `paths` (liste av glob-mønster, t.d. `packages/core/src/**/*.{ts,tsx}`) lastar berre når Claude faktisk les ei fil som matchar mønsteret. Dette er den einaste dokumenterte måten å gjere noko "på-etterspurnad" på reglar-mekanismen — det finst ingen verktøy/kommando-basert triggering, berre fil-sti-matching.
   - Ingen andre frontmatter-felt (ingen `description`) er dokumenterte for reglar.
3. **`.claude/skills/*/SKILL.md`** — *invokert* mekanisme: berre namn + eittlinjes `description` er alltid i kontekst; heile innhaldet lastar berre når skillet vert kalla (brukar skriv `/namn`, eller modellen sjølv vurderer det relevant ut frå skildringa). Dette er allereie i bruk her (`promote-release`, `start-feature`).
4. **Nøsta `CLAUDE.md` i underkatalogar** (t.d. `packages/core/CLAUDE.md`) — lastar automatisk, men berre når Claude les filer i den katalogen, ikkje ved økt-start.
5. Offisiell rettleiing: sikt mot **under ~200 linjer** per `CLAUDE.md`-fil; flytt fil-type/katalog-spesifikt innhald til `.claude/rules/`, flytt prosedyrar/domenekunnskap som ikkje gjeld overalt til skills.

Nøkkelskilnaden for denne vurderinga: **reglar (med `paths`) er trygge å flytte passivt-gjeldande krav til** — dei lastar utan at modellen treng å hugse å spørje etter dei. **Skills krev at modellen sjølv kjenner att situasjonen og kallar dei** — grei for fleire-steg-*prosedyrar* utløyst av eit tydeleg signal (som Runde 1 alt nyttar), men feil verktøy for eit krav som skal gjelde *stille, alltid, i bakgrunnen* utan noko eksplisitt utløysande hendingsord.

### Gjennomgang, seksjon for seksjon

| Seksjon (liner) | Storleik | Forslag | Grunngjeving |
|---|---|---|---|
| Project Overview, Commands, Tech Stack, Requirements (5-35, 329-342) | ~30 | **Behald i rot** | Alltid relevant, uansett oppgåve; for lite til å vinne noko på å flytte. |
| `--color-border-*`-kontrastregel (39-56) | 18 | **Flytt til `.claude/rules/`** | Passivt krav som skal gjelde kvar gong nokon skriv `color:` i UI-kode — akkurat den type "stille, alltid-gjeldande, avgrensa til éin katalog"-regel `paths` er laga for. Sjå forslag til fil under. |
| ESLint-scope / tsc+dist / tsbuildinfo-fallgruver (58-62) | ~10 | **Behald i rot** | Utløyst av *kva kommando som vert køyrt*, ikkje av kva fil som vert lesen — `paths` kan ikkje fange dette. Å gjere det om til eit skill ville krevje at modellen sjølv hugsar å spørje etter det *før* han køyrer ein rå `tsc`/`eslint`-kommando — nett det som svikta i hendinga som førte til at notatet vart skrive i utgangspunktet (jf. tsbuildinfo-hendinga same dag). |
| Pre-push-hook-notat (64) | 1 | **Behald i rot** | For lite til å vurdere. |
| "When the host has no Node/pnpm" + "Native (non-container) dev setup" (66-102) | 37 | **Flytt til eit nytt skill** | Dette er ein fleire-steg-*prosedyre* (podman-kommando, pnpm-versjonspinning, opprydding, vitest-flakiness, native fallback) utløyst av eit tydeleg, lett-attkjenneleg signal (`node: command not found`, `pnpm: command not found`, "ikkje noko Node på denne maskina"). Presis den profilen Runde 1 alt brukte for `promote-release`/`start-feature`. ~11 % av fila. |
| Errors and Unexpected Outcomes (104-121) | 18 | **Behald i rot** | Metodologi som skal gjelde for *alle* typar feil i *alle* delar av kodebasen — ikkje katalog- eller filtype-avgrensa, så `paths` passar ikkje. Er dessutan sjølve regelen som ber om å utvide denne fila — eit sjølvforsterkande argument for at ho må vere alltid synleg, ikkje putta bort. |
| Specification-driven development (123-131) | 9 | **Behald i rot** | Styrer *korleis Claude skal svare* (forslag vs. implementering) uavhengig av kva fil som vert redigert — kan ikkje `paths`-avgrensast meiningsfullt. |
| Development Workflow (branches → specs backlog, 133-282) | **150** | **Behald i rot — ikkje flytt** | Klårt største seksjonen (44 % av fila), men: (1) cross-cutting — gjeld *kvar* commit/branch/PR uansett kva som vart endra, ikkje filtype/katalog-avgrensa, så `paths` passar dårleg; (2) **`promote-release`/`start-feature` viser eksplisitt til denne seksjonen som sanningskjelda og deler han bevisst** ("Read that file's … section first if it's not already in context — this skill assumes its rules and does not repeat all of them here") — å flytte eller korte ned innhaldet ville bryte denne føresetnaden med mindre begge skill-filene vert skrivne om samstundes til anten å peike til ein ny stad eller bli sjølvstendige (dupliserer innhald, aukar driftrisiko). Ei rules-fil utan `paths` ville berre flytte teksten utan å spare kontekst i det heile. |
| Application Error Handling (283-289) | 7 | **Vurdert, lita vinst — behald i rot** | Prinsipielt eit godt `paths`-kandidat (gjeld feilhandtering), men feilhandtering finst spreidd over heile `packages/*/src` (io, project, platform, editor-dialogar) — eit `paths`-mønster vidt nok til å dekkje det reelt sett er nesten "alt", som ikkje sparer noko. Berre 7 linjer uansett. |
| Architecture (291-327) | 37 | **Valfritt / lågare prioritet: nøsta `CLAUDE.md` per pakke** | God passform i prinsippet (`packages/core/CLAUDE.md`, `packages/web/CLAUDE.md`, `packages/electron/CLAUDE.md` med eksperimentell-merking, `packages/docs/CLAUDE.md`), men orienteringsverdien er høg i nesten kvar økt som rører kodebasen, så innsparinga er mindre sikker enn dei to andre forslaga. Foreslår å vente med dette til/viss rot-fila treng krympast ytterlegare. |

### Konkret forslag (dei to tryggaste vinstane)

**1. `.claude/rules/css-color-tokens.md`** (ny fil, flytt linjer 39-56 frå CLAUDE.md hit):

```yaml
---
paths:
  - "packages/core/src/**/*.{ts,tsx}"
  - "packages/web/src/**/*.{ts,tsx}"
---
```
(glob matchar nøyaktig scope til `scripts/check-token-usage.sh`, verifisert mot skriptet: `SOURCES=(packages/core/src packages/web/src)`, `--include='*.ts' --include='*.tsx'` — ikkje `.css`, sidan UI-en er stila via inline style-objekt, ikkje CSS-filer). Innhaldet under er identisk med dagens tekst i CLAUDE.md linje 39-56.

Att i rot-CLAUDE.md: éi linje som peiker til fila, t.d. "Sjå `.claude/rules/css-color-tokens.md` for reglar om `--color-border-*` vs. `--color-fg-*` i `color:`-eigenskapar."

**2. Nytt skill: `.claude/skills/node-pnpm-fallback/SKILL.md`** (flytt linjer 66-102 hit, ~37 linjer):

`description`-forslag: *"Run pnpm/build/test commands when this host has no Node.js or pnpm installed — spins up a throwaway Podman/Docker container, handles pnpm-version-pinning gotchas, known vitest container flakiness, and cleans up afterward. Use whenever a command fails with 'node: command not found' / 'pnpm: command not found', or the user says there's no Node on this machine."*

Att i rot-CLAUDE.md: éi-to linjer: "Dersom verten manglar Node/pnpm, sjå `node-pnpm-fallback`-skillet i staden for å prøve å installere Node systemvidt." — kort nok til at modellen framleis "veit at dette finst" utan å måtte laste heile prosedyren kvar gong.

### Forventa gevinst

342 → **~287 linjer** i rot-`CLAUDE.md` etter forslag 1+2 (55 linjer flytta, ~16 % reduksjon), utan å røre noko cross-cutting, sikkerheitskritisk, eller skill-avhengig innhald. Kjem framleis ikkje under den uoffisielle 200-linjers-retningslinja — det ville krevje å også ta Development Workflow og/eller Architecture, som begge har eigne motargument dokumenterte over. Foreslår å ta forslag 1+2 først og vurdere resten seinare dersom fila held fram å vekse (jf. at "Errors and Unexpected Outcomes" eksplisitt *ber* om at ho skal vekse over tid).

**Status:** Forslag 1 og 2 er gjennomførte (2026-09-15) — sjå `.claude/rules/css-color-tokens.md` og `.claude/skills/node-pnpm-fallback/SKILL.md`. Rot-`CLAUDE.md` er no 290 linjer (ned frå 342). Den valfrie nøsta-CLAUDE.md-varianten for Architecture-seksjonen (lågare prioritet) står framleis open, saman med `update-goldens`-skillet frå Runde 1 — difor vert fila verande i `backlog/` i staden for å flyttast til `done/`.

## Runde 3 (2026-09-15): Ny evaluering av `release-notes-draft` og `update-goldens`

Dei to gjenståande, ikkje-implementerte forslaga frå Runde 1 (punkt 3 og 4 under "Forslag til skills") vurdert på nytt no, ei veke seinare, mot faktisk kodetilstand — ikkje berre ei gjentaking av den opphavlege vurderinga.

### `release-notes-draft` — stadfesta: framleis ikkje eit eige skill

Sjekka om noko har endra grunnlaget for Runde 1 sin konklusjon:

- **Ingen ekte promotering har skjedd sidan skillet vart laga.** `git log` syner at `v1.2.0` (siste tag) vart merga 2026-06-09 — tre månader **før** `promote-release`-skillet vart oppretta (2026-09-07). Det finst altså enno ingen ekte, live bruk av skillet sitt Steg 3 (samle+gruppere PR-ar sidan siste tag) å evaluere mot, berre det tørrkøyrde testresultatet mot upstream-issue #172 som alt står dokumentert ovanfor.
- Steg 3 i `promote-release/SKILL.md` (`gh pr list --base dev --state merged --search ...` + gruppering i Features/Fixes/Breaking changes/Dependencies) dekkjer framleis heile det opphavlege forslaget sitt scope. Det finst ikkje noko attverande "release-notes-draft"-behov som ikkje alt ligg der.

**Konklusjon: uendra frå Runde 1.** Ikkje byggje eit eige skill for dette — det er allereie løyst som eit steg inni `promote-release`. Denne vurderinga kan reknast som avslutta med mindre eit framtidig verkeleg promoterings-forsøk syner at Steg 3 faktisk manglar noko i praksis (i så fall bør det rettast direkte i `promote-release/SKILL.md`, ikkje via eit nytt skill).

### `update-goldens` — ny vurdering: **anbefalt implementert**, oppgradert frå Runde 1

Runde 1 sitt forslag var basert på skildringa i prosa; denne runden las faktisk implementasjonen (`packages/core/src/io/__tests__/round-trip.test.ts`) for å stadfeste kor stor risikoen eigentleg er, i staden for å ta det opphavlege forslaget for gitt:

- **Stadfesta empirisk: `UPDATE_GOLDENS=1` skriv fixtures direkte utan diff eller stadfesting.** Suite 1 (`round-trip.test.ts:49-52`) gjer `writeFileSync(expectedPath, emitted, 'utf-8'); return;` — ingen samanlikning, ingen prompt, berre eit rått filoverskriv av alle 12 `*.expected.yaml`-filene i `io/__fixtures__/schemas/`.
- **Ny observasjon, ikkje nemnd i Runde 1:** verken `pnpm test:update-goldens` (rot-`package.json`) eller `UPDATE_GOLDENS=1 vitest run` (`packages/core/package.json`) er nemnde noko stad i `CLAUDE.md` — kommandoen har ingen åtvaring i nærleiken av seg i det heile, som gjer eit uhells-køyr *meir* sannsynleg enn Runde 1 sitt utgangspunkt forutsette.
- **Nyansert, positivt funn:** Suite 2 (semantisk round-trip) og Suite 3 (property-based, fast-check) les *ikkje* `UPDATE_GOLDENS`-flagget i det heile — dei køyrer sine vanlege semantiske likskaps-sjekkar uansett. Det tyder at ein rein *logikk*-regresjon i parsar/serialisator framleis ville feile desse to suitene sjølv om nokon blindt regenererte Suite 1 sine gullfiler. Risikoen er difor meir avgrensa enn "kva som helst kan gå gale usett" — men står att for **formaterings-/byte-nivå-drift som ikkje er tilsikta** (t.d. ei utilsikta nøkkel-rekkjefølgje- eller mellomrom-endring frå ei urelatert kodeendring), som per definisjon ikkje vil feile Suite 2/3 (dei bryr seg berre om semantisk likskap, ikkje byte-format) og dermed kan bli bakt inn i gullfilene ubemerka utan gjennomsyn av diff-en.

**Konklusjon: oppgradert frå "ikkje prioritert" (Runde 1) til anbefalt.** Grunngjevinga har styrkja seg, ikkje svekt seg, ved faktisk kode-lesing: verktøyet finst alt (`pnpm test:update-goldens`), er heilt udokumentert i `CLAUDE.md`, og gjer eit ekte, ureversibelt filoverskriv utan noka form for gjennomsyn. Føreslått skill-skisse (ikkje bygd enno):

1. Køyr `pnpm test:update-goldens` (evt. scopa til enkeltskjema via vitest sitt `-t`-filter om brukaren berre vil oppdatere éin).
2. Vis `git diff -- packages/core/src/io/__fixtures__/schemas/*.expected.yaml` for gjennomsyn — forklar kva som endra seg semantisk (ny nøkkel-rekkjefølgje? nytt felt? whitespace?), ikkje berre lim inn rå diff.
3. Køyr heile `packages/core`-testpakken på nytt utan `UPDATE_GOLDENS` etterpå, for å stadfeste at Suite 2/3 framleis er grøne (dei validerer noko `UPDATE_GOLDENS`-flagget sjølv ikkje rører ved, jf. over).
4. Om diff-en ser uventa ut (endring i fleire filer enn venta, eller ei endring som ikkje heng saman med kva som vart implementert i denne økta), stopp og spør før noko vert liggjande att til commit.
5. Aldri commit sjølv — legg att endra `*.expected.yaml`-filer i arbeidstreet, slik den generelle regelen i CLAUDE.md ("agenten committar aldri sjølv") alt krev.

**Status:** Implementert (2026-09-15) — sjå `.claude/skills/update-goldens/SKILL.md`. Steg 1 og 3 vart justerte frå det opphavlege forslaget under bygginga, basert på empirisk testing (ikkje berre implementert som skissert): scoper alltid til `io/__tests__/round-trip.test.ts` direkte med `--environment node`, i staden for å nytte dei udokumenterte `pnpm test:update-goldens`-pakke-skripta (som køyrer heile den uskoperte `packages/core`-testpakken utan `--environment node`) — stadfesta at det uskoperte/jsdom-alternativet feila 3/3 gonger med den kjende `[vitest-pool-runner]: Timeout waiting for worker to respond`-flakskapen på denne verten (endå stadfesting av at dette *ikkje* er avgrensa til container-miljøet, sjølv om det opphavleg vart dokumentert under det: root-årsaka er I/O-forseinking mot `node_modules` på den trege `/mnt/c`-monteringa, uavhengig av om prosessen er native eller containerisert). Heile flyten (regenerer → diff → re-køyr utan flagget) vart køyrd ende-til-ende mot dagens kode: gav tom diff (som venta, sidan ingen emitter-logikk vart endra) og alle 25 testar grøne.

Alle fire opphavlege forslag frå Runde 1 ("Forslag til skills") er no gjennomførte. Attverande ope punkt: den valfrie nøsta-CLAUDE.md-varianten for Architecture-seksjonen frå Runde 2 (lågare prioritet) — fila vert verande i `backlog/` til den evt. blir teken eller eksplisitt lagt bort.
