# Evaluering: Claude Code-reglar og skills for dette repoet

Status: `promote-release` og `start-feature` implementert som skills (sjå `.claude/skills/`) og testa mot ein ekte issue (sjå "Testresultat" nedst). Reglane (hooks), `release-notes-draft` og `update-goldens` er framleis berre forslag.
Dato: 2026-09-07 (oppdatert same dag)
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
