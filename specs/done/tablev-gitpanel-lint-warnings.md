# Spec: Dei to nye lint-åtvaringane (`TableView.tsx`, `GitPanel.tsx`) — analyse og forslag til fiks

Status: **Implementert og verifisert (runde 2).** Sjå "Runde 2" nedst — merk at Funn 1 sin fiks vart JUSTERT undervegs etter at lint sjølv avdekte ein regel-konflikt (sjå under).
Dato: 2026-09-14

Ønske (ordrett): "analyser dei to nye feila frå lint og oppdater specen med korleis vi kan fikse dei"

## Kontekst

Etter at dei to opphavlege `SchemaCanvas.tsx`-åtvaringane vart fjerna (`specs/done/schemacanvas-unnecessary-hook-deps.md`), synte ein full `pnpm exec eslint packages/core packages/web` to ANDRE, urelaterte åtvaringar — stadfesta pre-eksisterande (ingen av dei to filene er rørte denne økta):

```
packages/core/src/canvas/TableView.tsx:425:17  react-hooks/incompatible-library
packages/web/src/editor/GitPanel.tsx:214:6     react-hooks/exhaustive-deps (missing deps)
```

Dette er ei skriftleg oppdatering av denne spec-en, som brukaren bad om — same "ny spec per tema"-praksis som resten av denne økta (t.d. korleis `nodeGeometry.ts`-mismatchen vart splitta ut til si eiga fil i staden for å bakast inn i ein alt-ferdig spec). Den opphavlege `schemacanvas-unnecessary-hook-deps.md`-spec-en er alt flytta til `specs/done/` og fullstendig ferdig for sitt eige, avgrensa tema — desse to nye funna høyrer heime i ei eiga fil.

## Funn 1: `GitPanel.tsx:214` — ekte, om enn smal, stale-closure-risiko (IKKJE støy)

**Dette er annleis enn dei to `SchemaCanvas.tsx`-åtvaringane frå førre runde** — dei var "unødvendige" dependencies (trygt å fjerne). Denne er **"manglande" dependencies** — den farlege typen, sidan `handleCommit` (`GitPanel.tsx:178-218`) faktisk LES `activeProject?.gitConfig?.userName`/`.userEmail` inni funksjonskroppen (linje 196-199) utan at nokon av dei er med i dependency-lista (linje 214-218: `commitMessage, stagedPaths, repoPath, platform, onSaveBeforeCommit, setIsCommitting, setLastGitError, setCommitMessage, clearStaged, pushToast, refreshStatus` — korkje `activeProject` eller dei nøsta felta er med).

**Stadfesta reelt nåbart, ikkje berre teoretisk:** `GitPanel.tsx` har ein eigen "Settings"-fane (linje ~593-625) der brukaren kan REDIGERE commit-forfattar namn/e-post live, medan panelet står ope:

```tsx
onBlur={() => {
  const name = authorName.trim();
  if (name !== (activeProject?.gitConfig?.userName ?? '')) {
    updateGitConfig({ userName: name || undefined });
  }
}}
```

**Konkret feilscenario:** brukar skriv ei commit-melding og merkjer filer for staging (dette hadde alt trigga ei ny `handleCommit`-lukking, sidan `commitMessage`/`stagedPaths` er med i dependency-lista) → brukar byter til "Settings"-fana og rettar forfattar-e-post/namn → byter attende til "Changes"-fana UTAN å røre commitMessage/stagedPaths igjen → trykker Commit. Sidan INGEN av `handleCommit` sine faktiske dependencies endra seg mellom desse to stega, held React fram med å bruke DEN GAMLE `useCallback`-lukkinga — som framleis peiker på det gamle `activeProject`-objektet, med det gamle (no utdaterte) forfattarnamnet/-e-posten. Committen ville då bruke feil forfattar-identitet, stille, utan feilmelding.

### Forslag til fiks

Legg til dei to nøsta stiane ESLint sjølv føreslår, IKKJE heile `activeProject`-objektet:

```ts
}, [
  commitMessage, stagedPaths, repoPath, platform, onSaveBeforeCommit,
  setIsCommitting, setLastGitError, setCommitMessage, clearStaged,
  pushToast, refreshStatus,
  activeProject?.gitConfig?.userName, activeProject?.gitConfig?.userEmail,
]);
```

**Kvifor nøsta stiar, ikkje heile `activeProject`:** `activeProject` er eit rikt objekt (skjema-liste m.m.) som truleg endrar identitet ofte av grunnar heilt urelaterte til `gitConfig` — å leggje til heile objektet som dependency ville gjort at `handleCommit` vert oppretta på nytt mykje oftare enn naudsynt (unødvendig ytingskostnad, om enn liten). ESLint sin eigen `exhaustive-deps`-regel støttar nøsta member-expression-dependencies presist for denne typen tilfelle, og går allereie rett i sin eigen feilmelding: *"missing dependencies: 'activeProject.gitConfig.userEmail' and 'activeProject.gitConfig.userName'"* — ikkje "activeProject".

## Funn 2: `TableView.tsx:425` — informativ, framtidsretta støy (INGEN kjøretidskonsekvens i dag)

**Rotårsak, stadfesta ved å sjekke faktisk verktøykjede, ikkje anta:** `react-hooks/incompatible-library` er ein NY regel, bunta inn i `eslint-plugin-react-hooks` sin eigen `recommended`-konfig frå og med v6+ (stadfesta installert versjon: **7.1.1**, jf. `package.json`). Denne pakken sitt nyare `recommended`-sett inkluderer no fleire diagnostikkar frå det ekte **React Compiler**-verktøyet (eit valfritt, separat build-verktøy som automatisk memoiserer komponentar).

**Stadfesta at sjølve React Compiler-transformasjonen IKKJE er teken i bruk i dette repoet i det heile:** søkte gjennom heile repoet (root `package.json`, alle `vite.config.*`, `node_modules`) etter `babel-plugin-react-compiler`/`react-compiler` — **ingenting installert eller konfigurert**. `eslint-plugin-react-hooks` sin `plugin:react-hooks/recommended` (alt brukt i `.eslintrc.cjs:8`, uendra av denne økta) dreg no berre INN denne éine LINT-regelen som eit statisk, framtidsretta råd — ho seier ingenting om noko som faktisk skjer i den ekte bygg-/kjøretidsprosessen i dag.

**Kva regelen faktisk seier:** TanStack Table sin `useReactTable()` returnerer eit objekt med FUNKSJONAR (radmodellar, cellerenderarar m.m.) som ikkje kan memoiserast trygt av React Compiler sin auto-memoiserings-algoritme. OM ein nokon gong tek i bruk sjølve React Compiler-verktøyet i dette repoet, ville han automatisk (og trygt) HOPPE OVER auto-memoisering av nøyaktig denne eine komponenten (`TableView`) — akkurat den trygge, dokumenterte fallback-åtferda verktøyet har for kjende biblioteks-inkompatibilitetar som dette. Ingen kodefeil, ingen krasj, berre eit opt-out for denne eine komponenten.

**Er det nokon reell risiko akkurat no?** Nei — sidan sjølve transformasjonsverktøyet ikkje køyrer, er "Compilation Skipped"-meldinga reint hypotetisk ("viss du nokon gong tek i bruk dette verktøyet, ville denne komponenten bli hoppa over"). `TableView` er dessutan bak eit feature-flag (`tableModeEnabled`, jf. filen sin eigen toppkommentar) — eit sjølvstendig, avgrensa spreadsheet-grensesnitt.

### Forslag til fiks (tre alternativ, ulikt omfang)

1. **Minst inngripande — lokal undertrykking med grunngjeving** (tilrådd): legg til ein `// eslint-disable-next-line react-hooks/incompatible-library` rett over `useReactTable`-kallet, med ein kommentar som forklarer at dette er ein kjend, dokumentert TanStack-Table-avgrensing, og at ingen faktisk React-Compiler-transformasjon køyrer i dette repoet enno. Rører berre den eine lina, tydeleg dokumentert, lett å finne att og fjerne viss/når prosjektet nokon gong faktisk tek i bruk React Compiler.
2. **Mellomstort omfang** — deaktiver `react-hooks/incompatible-library`-regelen HEILT i `.eslintrc.cjs` sin `rules`-seksjon (`'react-hooks/incompatible-library': 'off'`), med ein grunngjevande kommentar. Fjernar all støy frå denne EINE regelen repo-vidt, men skjuler han òg for eventuelle FRAMTIDIGE, ekte tilfelle andre stader i kodebasen (om enn usannsynleg sidan TanStack Table berre er brukt denne eine staden, stadfesta ved eit raskt søk).
3. **Størst omfang, IKKJE tilrådd no** — fjern/nedgrader `eslint-plugin-react-hooks` frå v7 til ein eldre major utan dei nye compiler-diagnostikkane. Uforholdsmessig stort: ville òg mista legitime, nye `exhaustive-deps`-forbetringar (t.d. presis nøsta-sti-støtte, som Funn 1 sin fiks over dreg nytte av), berre for å bli kvitt éin einaste, harmlaus åtvaring.

**Vurdering:** alternativ 1 (lokal, grunngjeven undertrykking) er tilrådd — minst overraskande for framtidige lesarar (grunngjevinga står rett attmed koden ho gjeld), null risiko for å skjule noko anna, og reversibel med éin linje viss React Compiler nokon gong faktisk vert teken i bruk.

## Testcase / akseptansekriterium

1. **Funn 1:** `pnpm exec eslint packages/web/src/editor/GitPanel.tsx` gir 0 åtvaringar. Manuell/scenario-stadfesting (valfritt, låg automatiserbarheit utan RTL-oppsett for denne komponenten): rediger forfattarnamn i Settings-fana, byt til Changes-fana utan å røre commit-melding/staging, commit — stadfest at den NYE forfattarinfoen faktisk vert brukt (kan verifiserast ved å inspisere `platform.gitCommit`-kallet sitt `author`-argument, t.d. via eit mellombels `console.log` eller ein eksisterande git-log-visning).
2. **Funn 2:** `pnpm exec eslint packages/core/src/canvas/TableView.tsx` gir 0 åtvaringar. Ingen funksjonell endring venta — `TableView` fungerer identisk før/etter (undertrykkinga endrar ingen ting ved korleis komponenten faktisk køyrer, sidan compiler-transformasjonen ikkje er aktiv).
3. Full `pnpm exec eslint packages/core packages/web`: **0 åtvaringar totalt** (ned frå 2), ingen nye åtvaringar dukkar opp andre stader.
4. Full `packages/core`/`packages/web`-testpakke: ingen endring i talet på grøne/raude testar.

## Runde 2 (2026-09-14) — implementert, Funn 1 sin fiks justert etter ein oppdaga regel-konflikt

Brukaren skreiv "utfør begge tiltaka" — eksplisitt godkjenning, jf. CLAUDE.md.

### Funn 2 (`TableView.tsx`): implementert nøyaktig som føreslått

Lokal `// eslint-disable-next-line react-hooks/incompatible-library` rett over `useReactTable`-kallet, med ein kommentar som forklarer kvifor (kjend TanStack Table-avgrensing, ingen faktisk React Compiler-transformasjon i dette repoet).

### Funn 1 (`GitPanel.tsx`): implementert med nøsta stiar — MEN lint avdekte umiddelbart ein NY, urelatert feil frå den nøsta varianten

Fyrste forsøk følgde forslaget bokstaveleg: la til `activeProject?.gitConfig?.userName, activeProject?.gitConfig?.userEmail` i dependency-lista. Ein umiddelbar `pnpm exec eslint`-køyring på den endra fila avdekte at dette utløyste ein HEILT NY, tidlegare usett `react-hooks/preserve-manual-memoization`-**FEIL** (ikkje berre ei åtvaring):

> "Compilation Skipped: Existing memoization could not be preserved [...] The inferred dependency was `activeProject`, but the source dependencies were [...] Inferred less specific property than source."

**Rotårsak:** dette er OGSÅ ein compiler-beredskaps-regel (same familie som Funn 2, bunta inn i `eslint-plugin-react-hooks@7.1.1`), men han krev at den MANUELT skrivne dependency-lista samsvarer med kva React Compiler sin EIGEN statiske analyse ville utleia — som for eit nøsta, valgfri-kjeda uttrykk som `activeProject?.gitConfig?.userName` er HEILE `activeProject`-objektet, ikkje dei presise under-felta. Dette står i direkte motsetnad til KVA den klassiske `exhaustive-deps`-regelen sjølv føreslo (nøsta stiar) — dei to reglane, begge no i same plugin-versjon, er ueinige om kva som er "rett" her.

**Løysing, stadfesta trygg empirisk (ikkje berre anteke):** sjekka `updateGitConfig` (`packages/core/src/store/slices/projectSlice.ts:939-954`, funksjonen som faktisk oppdaterer `gitConfig` frå Settings-fana) — han gjer ei FULL, IMMUTABEL erstatning: `activeProject: { ...state.activeProject, gitConfig: {...} }`. Det tyder `activeProject` sin OBJEKT-IDENTITET endrar seg kvar gong `gitConfig` (inkl. `userName`/`userEmail`) endrar seg — så å bruke HEILE `activeProject` som dependency (den grovare forma React Compiler sjølv ønskjer) fangar framleis korrekt opp presis dei same endringane som den opphavleg føreslåtte, finare nøsta-sti-forma ville gjort, UTAN å trigge `preserve-manual-memoization`-feilen. Retta til:

```ts
}, [
  commitMessage, stagedPaths, repoPath, platform, onSaveBeforeCommit,
  setIsCommitting, setLastGitError, setCommitMessage, clearStaged,
  pushToast, refreshStatus, activeProject,
]);
```

**Lærdom verdt å notere:** dette stadfestar EMPIRISK (ikkje berre les-koden-og-anta) at den opphavlege spec-en sin grunngjeving for å føretrekkje nøsta stiar over heile objektet ("unngår unødvendig gjenskaping når urelaterte delar av `activeProject` endrar seg") var teoretisk fornuftig, men i PRAKSIS ville ha brote ein annan, nyare lint-regel i same plugin-versjon — nøyaktig den typen overraskande interaksjon CLAUDE.md sitt "verifiser empirisk"-prinsipp er meint å fange opp. Sidan `pnpm exec eslint` vart køyrt på den faktiske endringa STRAKS etter ho vart skriven (ikkje utsett til slutten), vart konflikten fanga og retta i same runde, ikkje levert som ein ny feil.

### Sidefunn: mellombels forvirrande lint-resultat frå eiga miljø-handling, ikkje eit kodeproblem

Ved forsøk på å typecheck `packages/web` (for å stadfesta at GitPanel-fiksen ikkje introduserte typefeil) synte `packages/web` sin eigen `tsc` mange `Cannot find module '@linkml-editor/core'`-feil — stadfesta reint miljømessig: `packages/core/dist` fanst ikkje enno i denne økta (aldri bygd), naudsynt for at TypeScript skal løyse workspace-pakke-importar via bygde typedeklarasjonar. Bygde `packages/core` (`tsc -p tsconfig.json`) for å stadfesta web-typecheck var reint — det var. Deretter synte ein AD HOC `eslint packages/core packages/web`-køyring (feilaktig omfang, ikkje prosjektet sin faktiske `pnpm lint`-kommando, som er avgrensa til `packages/*/src`) 47 feil frå EI BYGD `.js`-fil (`FilteredGroupedSelect.js`, med `sourceMappingURL`-kommentar — tydeleg dist-utdata, ikkje kjeldekode) som nyleg vart oppretta av byggjeprosessen. Retta ved å fjerne den mellombels bygde `packages/core/dist`-mappa (ikkje del av det opphavlege repo-tilstanden) og re-køyre med det RETTE, prosjekt-eigne lint-kommandoet (`eslint packages/*/src --ext .ts,.tsx`, same som `pnpm lint` faktisk brukar) — **0 feil, 0 åtvaringar** over heile repoet. Nemnt her for ryddigheit, sidan det kunne sett ut som eit tredje, uventa funn om det ikkje vart forklart — det var mitt eige, mellombels miljøavtrykk, ikkje eit kodeproblem.

### Verifisert

- `pnpm exec eslint packages/*/src --ext .ts,.tsx` (den faktiske `pnpm lint`-kommandoen sin eslint-del): **0 feil, 0 åtvaringar** over heile repoet (`packages/core`, `packages/web`, alle andre pakkar).
- `scripts/check-token-usage.sh`: PASS.
- Typecheck av både `packages/core` og `packages/web` (etter at `packages/core` sitt naudsynte bygg vart stadfesta og deretter rydda opp att): reine, ingen feil i `GitPanel.tsx`/`TableView.tsx`.
- `packages/core`-testpakke: 274/274 testar grøne (0 faktiske feil), 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]`-infrastrukturflaksen — ingen reelle regresjonar.
- Ingen dedikerte rendrings-testar finst for `GitPanel.tsx`/`TableView.tsx` (same mønster som stadfesta fleire gonger tidlegare denne økta for andre UI-komponentar) — begge endringane er reine dependency-array-/undertrykkings-endringar utan logikkendring, verifisert via lint + typecheck.

**Ikkje verifisert manuelt i nettlesar** — særleg scenarioet frå akseptansekriterium 1 (rediger forfattarnamn, commit utan å røre melding/staging, stadfest korrekt forfattar) krev interaktiv git-testing, bør stadfestast ved neste rebuild/redeploy eller lokal `pnpm dev`-økt.
