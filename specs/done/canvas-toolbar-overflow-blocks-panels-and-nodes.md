# Spec: canvas-verktøylinja (`#lme-canvas-toolbar`) veks utanfor canvas-kolonna og dekkjer DisplayPanel/noder

Status: forslag / ikkje implementert
Dato: 2026-09-15
Ønske (opphavleg, frå brukaren): under valideringa av `pre-push`-hooken sin nye WSL2-delegering (sjå `specs/done/pre-push-hook-wsl-delegation.md`) feila 3 av 7 Playwright E2E-testar. Desse feila er urelaterte til sjølve hook-delegeringa, men brukaren ba eksplisitt om at dei vert skrivne opp som eiga spec ("ja, skriv opp spec for dei") før noko vert retta.

## Konkret feil som utløyste dette

Frå ein reell `bash .githooks/pre-push`-køyring (sjå fullt playwright-utskrift i forrige samtaleomgang):

```
✘ golden-path.spec.ts:53:1 › golden path: add class, set inheritance, add slot, validate, YAML preview, save, reload
✘ new-project.spec.ts:25:1 › new project: add class + slot, save, assert YAML on disk
✘ view-layout-bleed.spec.ts:62:1 › view drag does not bleed into schema layout
```

Feil 1 og 2 (`golden-path.spec.ts:68`, `new-project.spec.ts:37`): `TimeoutError: locator.click: Timeout 10000ms exceeded` på `page.locator('#lme-canvas-add-class')`, med gjentekne `- <div>Rendering</div> from <div id="lme-display-panel">…</div> subtree intercepts pointer events`-linjer i retry-loggen.

Feil 3 (`view-layout-bleed.spec.ts:80`): `expect(Math.abs(betaMoved.x - betaBefore.x)).toBeGreaterThan(50)` — venta `> 50`, fekk `0`.

## Rotårsak — stadfesta empirisk ved DIREKTE måling i nettlesar (2026-09-15, to rundar)

**Merk — første runde av denne undersøkinga (utført av ein delegert Explore-agent) skildra feil mekanisme, og vart retta i denne andre, sjølv-utført runda etter at brukaren stilte eit direkte, korrekt motspørsmål:** "Er det Layout-knappane som er problemet? I den bygde versjonen er dei stacka vertikalt under kvarandre og endrer ikkje x-posisjonen." Brukaren hadde heilt rett — `layoutControls` ER ein `flexDirection:'column'`-boks (stadfesta i koden, `SchemaCanvas.tsx:1471-1475`), og kontrollane endrar aldri x-posisjon seg imellom. Den første runda sin skildring ("6 `<select>`-element lagt til ved sida av kvarandre, kumulativt utvida over tre commits") var feil. Under er den retta, direkte-målte mekanismen (`getBoundingClientRect()` på alle involverte element, via ein mellombels, aldri committa Playwright-testfil, sletta att etter måling).

**Den faktiske mekanismen: `align-items: stretch` (flexbox sin standardverdi) i ein kolonne-boks tvingar KVART barn til å bli like breitt som det BREIASTE barnet, ikkje omvendt.**

`layoutControls` (`SchemaCanvas.tsx:1471-1475`) er:
```ts
layoutControls: { display: 'flex', flexDirection: 'column', gap: 6 },
```
— ingen `alignItems`-overstyring, så CSS-standarden `align-items: stretch` gjeld. Det tyder at breidda til HEILE kolonna vert bestemt av det breiaste barnet sitt eige naturlege innhald, og at ALLE andre barn deretter vert strekte til å matche akkurat den breidda — sjølv om dei sjølv har mykje kortare tekst.

Det breiaste barnet er `<select id="lme-canvas-layout-edge-routing">`, der standard-valt tekst er `"Orthogonal (right angles) (default)"` (36 teikn) — den lengste av alle valde tekstane i heile kolonna. Direkte måling stadfestar strekk-effekten eksplisitt: **`layoutControls`-boksen sjølv OG kvart einaste barn i han (Layout-knappen, alle 6 `<select>`-ane) har nøyaktig same breidd: 287px**, sjølv om t.d. "Layout"-knappen og "Default order"-valet berre treng ein brøkdel av det for sin eigen tekst:

| Element | x | breidd | (utvalt) tekst |
|---|---|---|---|
| `#lme-canvas-layout` (knapp) | 401 | 287px | "Layout" |
| `#lme-canvas-layout-direction` | 401 | 287px | "↓ Top-down (default)" |
| `#lme-canvas-layout-strategy` | 401 | 287px | "Longest path (default)" |
| `#lme-canvas-layout-edge-routing` | 401 | 287px | "Orthogonal (right angles) (default)" ← breiast |
| `#lme-canvas-layout-node-placement` | 401 | 287px | "Brandes-Koepf (default)" |
| `#lme-canvas-layout-spacing` | 401 | 287px | "Normal spacing (default)" |
| `#lme-canvas-layout-model-order` | 401 | 287px | "Default order" |

Kombinert med Add-Class-knappen (x:207.97, breidd 94px) og Add-Enum-knappen (x:308, breidd 87px) i same rad (`styles.toolbar`, `display:'flex'`, standard `flexDirection:'row'`), vert heile `#lme-canvas-toolbar` sin bounding box **x:207.97, breidd:480px** — dvs. høgre kant på x≈688. Sidan verktøylinja er `right:12`-forankra i canvas-kolonna utan venstre-grense, og canvas-kolonna ved E2E-viewporten (1280×900, alle tre sidepanel opne — standardtilstanden testane startar i) er klemt ned til sitt `minWidth:320`-golv (`main.tsx:560-578`, canvas-kolonne omlag x:380-700), flyt heile verktøylinja frå x≈208 til x≈688 — 152px inn i `#lme-display-panel` sitt eige område (målt x:220-380).

Live-instrumentering (`document.elementFromPoint()` på senterpunktet til `#lme-canvas-add-class`) stadfesta at treffet landar på `<div>Rendering</div>` (DisplayPanel sin seksjonsoverskrift for rendering-modus-brytaren, `DisplayPanel.tsx:180`). Same mekanisme forklarar feil 3: Beta-noden sin post-layout-posisjon (x:394-637, per tidlegare agent-rapport) fell innanfor verktøylinja sitt fulle fotavtrykk (x:208-688, y:81.5-313.5), så draget sin `mousedown` landar på eit verktøylinje-element i staden for på React Flow-noden.

### Kvifor det er ein app-regresjon, ikkje test-flaks eller ein test-forfattingsfeil

- Ein eksisterande sikring finst alt: commit `d006fc637` ("add min-width to panels and canvas horizontal scroll", 2026-04-30) la til `minWidth:320` på canvas-kolonna nettopp for å handtere denne typen trongt rom.
- Men **kolonna sin `align-items: stretch`-standardåtferd vart aldri eksplisitt vurdert** då fleire `<select>`-ar med ulikt lange standardtekstar vart lagt til over tre seinare commits (`149f99c8`, `b308cbb3`, `f96460a3`, 2026-09-08 til 2026-09-14) — ingen av desse endra sjølve `layoutControls`-stilen, så strekk-åtferda var alt til stades, men vart først synleg ved ein tilstrekkeleg lang tekststreng (edge-routing-valet sin standardtekst).
- `nodeTranslate`/`dragNode`-hjelparane i `view-layout-bleed.spec.ts:41-60` er korrekt skrivne (fersk `boundingBox()`, riktig utrekna museposisjon) — feilen oppstår ikkje av manglande `await`/timing, men fordi den utrekna, korrekte posisjonen faktisk ER okkupert av verktøylinja i den verkelege DOM-en.
- Feila oppstod på **2.4 sekund** for feil 3 (ikkje eit 10s-timeout), som utelukkar ein "trong å vente lenger"-teori.
- `test-timing/containers.log` har berre éin `pre-push-e2e`-oppføring (`2026-09-15T10:25:52Z, duration=172s, exit=1`) — éin fersk feil, ikkje eit mønster av kronisk flaks.
- Ingen `test.skip`/`test.fixme`/retry-annotasjonar finst frå før på nokon av dei tre testfilene.

## Forslag

Éin primærfiks er mykje meir målretta enn først anteke, sidan rotårsaka no er presist identifisert som CSS-strekk (`align-items:stretch`), ikkje generell breidd-vekst:

1. **Primærfiks: legg til `alignItems: 'flex-start'` på `layoutControls` (`SchemaCanvas.tsx:1471-1475`).** Dette hindrar dei korte kontrollane (Layout-knappen, "Direction", "Layering strategy", "Node placement", "Spacing", "Order") frå å verte strekt til å matche den lengste teksten sin breidd — kvar av dei ville då berre ta den plassen deira eiga tekst faktisk treng. Dette åleine reduserer truleg storparten av dei 287px breidda for 6 av 7 rader.
2. **Sekundærfiks (truleg framleis naudsynt): den eine attverande brei rada — edge-routing-valet, driven av standardteksten `"Orthogonal (right angles) (default)"` (36 teikn) — bør framleis kortast ned**, sidan flex-start åleine ikkje endrar SJØLVE innhaldsbreidda til det elementet. Konkrete alternativ (ikkje endeleg valde — brukaren bør velje):
   - **A. Kort ned sjølve valteksten** (t.d. dropp "(right angles)"-forklaringa eller "(default)"-suffikset frå alle valte tekstar i denne og andre `<select>`-ar, sidan `title`-attributtet alt gjev den fulle forklaringa ved hover).
   - **B. Set ein eksplisitt `max-width`/`width` på `styles.toolbarSelect`** (t.d. 160-180px) saman med `textOverflow:'ellipsis', overflow:'hidden', whiteSpace:'nowrap'` på sjølve `<select>`-en (Chromium respekterer dette på `<select>`; bør verifiserast empirisk på tvers av nettlesarar viss dette vert relevant, jf. CLAUDE.md sitt prinsipp om å ikkje anta CSS-åtferd på tvers av browser-motorar utan å sjekke).
3. **Legg til eit regresjonsvern**: anten ein E2E-test som eksplisitt sjekkar at `#lme-canvas-toolbar` sin bounding box ikkje overlappar `#lme-display-panel` eller noko `.react-flow__node` ved standard E2E-viewport-breidd (1280px) med alle panel opne, eller ein enklare unit-/lint-aktig sjekk. Målet er at neste gong nokon legg til éin ny kontroll (eller ein lengre standardtekst) i verktøylinja, feilar dette tidleg og tydeleg — i staden for at det viser seg som eit kryptisk "element intercepts pointer events"-Playwright-symptom slik det gjorde her.
4. **Vurder (valfritt) å køyre E2E-suiten ved fleire viewport-breidder** (eller minst éin smalare enn standard) som ein del av `pre-push`/CI, sidan denne konkrete regresjonen berre synte seg ved akkurat den breidda/panel-kombinasjonen testane brukar — men dette er ei større, separat avveging (fleire viewport-køyringar aukar E2E-klokketid, som alt er eit kjent tema i `specs/backlog/test-timing-instrumentation-and-reliability.md`), ikkje noko å implementere utan eiga vurdering.

## Status: FULLT IMPLEMENTERT OG STADFESTA (2026-09-15) — 7/7 E2E grøne

Brukaren valde "Collapse controls behind a menu" (forslag 1C) for å løyse det attverande høgde/dra-problemet. Implementert som eit `layoutSettingsPopover`: dei 6 layout-`<select>`-ane vart flytta ut av den alltid-synlege verktøylinja og inn i ein popover, opna/lukka via ein ny `SlidersHorizontal`-ikonknapp (`#lme-canvas-layout-settings-toggle`) med klikk-utanfor- og Escape-lukking (mønster kopiert frå `MenuBar.tsx` sin eksisterande `DropdownMenu`). "Layout"-knappen (køyrer layout direkte med noverande innstillingar) vart verande synleg i hovudrada, sidan det er den hyppigaste handlinga.

**Uventa oppdaga undervegs — sjølv den fire-knapps STANDARDRADA (Add Class, Add Enum, Layout, Settings-ikon) var i utgangspunktet 20px for brei for det trongaste tilfellet (320px canvas-kolonne, 296px budsjett) og vart difor sjølv verande brote til to rader** (`toolbarBtn`-padding var `'6px 12px'`, tre tekst+ikon-knappar + éin ikon-knapp trong samla 316px). Retta ved å stramme inn `toolbarBtn`-padding (`'6px 12px'` → `'6px 8px'`) og gje settings-ikonknappen ein eigen, endå trongare `toolbarIconBtn`-stil (`'6px 6px'`) — verktøylinja sin standardtilstand er no éi einaste 28px-høg rad, stadfesta direkte (`getBoundingClientRect()` via ein mellombels, aldri-committa måle-spec, sletta att etter kvar måling).

**Alle stega vart verifisert empirisk, ikkje anteke frå kodelesing**, i tråd med CLAUDE.md sitt prinsipp: kvart steg (flex-start åleine, +wrap/max-width, +popover, +padding-innstramming) vart målt direkte i nettlesaren mellom kvar endring, og feila FLEIRE gonger undervegs på måtar som reint kodelesing ikkje ville avdekt (t.d. at "kollapsa til éin rad" i seg sjølv framleis var 20px for brei og braut til to rader att, noko som framleis overlappa Beta-noden delvis — oppdaga berre ved å måle på nytt etter kvar endring i staden for å anta at popover-flyttinga var nok).

**Sluttresultat, stadfesta ved reell full E2E-køyring (`pnpm --filter @linkml-editor/web test:e2e`, Playwright, ikkje simulert):**
```
7 passed (21.6s)
```
Alle tre opphavleg feilande testar (`golden-path.spec.ts`, `new-project.spec.ts`, `view-layout-bleed.spec.ts`) går no grøne, saman med dei 4 som alt var grøne før.

**Regresjonsvern lagt til** (forslag 3, valde alternativet "eigen E2E-test" sidan ei enklare Vitest/RTL-basert geometrisk sjekk synte seg IKKJE mogleg — `jsdom` har ingen ekte CSS-layoutmotor, så `getBoundingClientRect()` returnerer alltid null/0 der, stadfesta ved gjennomgang av korleis testane i dette repoet alt brukar `jsdom`): ny fil `packages/web/e2e/canvas-toolbar-geometry.spec.ts`, som opnar eit nytt prosjekt og assertar at `#lme-canvas-toolbar` sin `x`-posisjon aldri er mindre enn `#lme-display-panel` sin høgre kant. Køyrt og stadfesta grøn isolert.

`pnpm lint` (ESLint + token-usage-sjekken) er grøn etter alle endringane. `pnpm --filter @linkml-editor/core test` vart køyrt to gonger som ekstra stadfesting — begge køyringane trefte den alt kjende, dokumenterte `[vitest-pool-runner]: Timeout waiting for worker to respond`-flaksen (jf. `node-pnpm-fallback`-skillet og CLAUDE.md), IKKJE nokon reell testfeil (alle testar som faktisk køyrde, bestod – berre talet på gjennomførte testfiler varierte mellom dei to køyringane, eit kjent symptom på denne infrastruktur-flaksen på denne verten, urelatert til endringane her).

### Tidlegare (no utdatert) status-notat, behalde for historikk:

Implementert: `alignItems:'flex-start'` på `layoutControls` (forslag 1), kutta `"(default)"` frå edge-routing-valet (forslag 2A, delvis — behaldt `"(right angles)"`-forklaringa), OG i tillegg lagt til `flexWrap:'wrap'` + `justifyContent:'flex-end'` + `maxWidth:'calc(100% - 24px)'` på sjølve `#lme-canvas-toolbar` (eit strukturelt supplement, ikkje eksplisitt i forslag 1-4 over, men naudsynt — sjå kvifor under).

**Direkte måling stadfesta at forslag 1+2 ÅLEINE (utan wrap/max-width) IKKJE var nok**: etter berre desse to endringane var verktøylinja framleis 408px brei (ned frå 480px, men Edge-routing-valet var framleis den breiaste enkeltkontrollen på 215px og drog resten av breidda med seg), og overlappa framleis `#lme-display-panel` med 100px. Løysinga vart å i tillegg gje `#lme-canvas-toolbar` sjølv `flexWrap:'wrap'` + `maxWidth:'calc(100% - 24px)'` (rekna ut frå containeren sin eigen breidd, ikkje ein gjetta fast pikselverdi) + `justifyContent:'flex-end'` slik at layout-kontroll-kolonna bryt ned til ei eiga rad når ho ikkje lenger får plass ved sida av Add Class/Add Enum-knappane. Etter dette: verktøylinja sin bounding box vart x:392-688 (320px canvas-kolonne, display-panel sluttar på x:380) — **0px overlapp med DisplayPanel, stadfesta ved direkte måling.**

**Testcase 1 og 2 (DisplayPanel-overlappen, klikk-testane) er no fullt stadfesta** — `golden-path.spec.ts` og `new-project.spec.ts` går begge grøne (køyrt reelt via Playwright etter fiksen).

**Testcase 3 (`view-layout-bleed.spec.ts`, dra-testen) FEILAR FRAMLEIS — ny, separat rotårsak oppdaga:** verktøylinja sin *vertikale* utstrekning (no 266px høg, opp frå 232px før wrap-fiksen, sidan layout-kontroll-kolonna no ligg på ei EIGA rad under Add Class/Add Enum-rada) dekkjer framleis den øvre delen av sjølve canvas-området (y:81.5-347.5 av eit 582.5px høgt canvas-vindauge) — nøyaktig der ein topp-ned auto-layout plasserer sitt FØRSTE node-lag. Direkte måling i det faktiske test-scenarioet (Alpha/Beta/Gamma-skjemaet frå `view-layout-bleed.spec.ts`) stadfestar: Beta-noden sin bounding box (x:417.7-621.5, y:96-159.7) ligg HEILT INNANFOR verktøylinja sitt fotavtrykk (x:392-688, y:81.5-347.5) — musetrykket i `dragNode()` landar på verktøylinja, ikkje på noden.

**Viktig:** dette er IKKJE noko fiksen over introduserte — direkte måling av det ORIGINALE (ufiksa) tilstanden synte at Beta alt då (x:394-637, y:135-211) låg innanfor den daverande verktøylinja sin vertikale rekkjevidde (y:81-313), UAVHENGIG av breidde-regresjonen. Breidde-fiksen løyste DisplayPanel-overlappen fullstendig, men avdekte/etterlét eit **separat, alt eksisterande problem**: verktøylinja sin HØGDE (7 stabla kontrollar ≈ 232-266px) er stor nok til å dekkje akkurat det området der auto-layout plasserer sitt første nodelag, heilt uavhengig av horisontal posisjon.

Å løyse dette fullt ut krev å redusere verktøylinja sin STANDARD-høgde vesentleg — den einaste av dei opphavlege forslaga som adresserer dette direkte er **forslag 1C frå den opphavlege lista** (gøym dei mindre brukte layout-kontrollane bak eit "meir"-ikon/undermeny, slik at verktøylinja sin standardhøgde vert éi rad, ikkje sju). Dette er ei ny UI-komponent (ein popover/undermeny), ikkje berre ein stilendring — vesentleg større endring enn resten av denne fiksen, og bør avklarast med brukaren før implementering, ikkje byggjast stille som ein del av eit "utfør"-svar på resten av spec-en.

**Status per no: 6/7 E2E-testar grøne** (opp frå 4/7 før denne økta). Attverande: `view-layout-bleed.spec.ts`.

## Opne spørsmål — brukaren bør avklare før implementering

1. **Er forslag 1 (`alignItems:'flex-start'`) sjølvsagt ønska?** Det verkar risikofritt (reint visuelt, gjer kontrollane kompakte i staden for kunstig brei), men bør stadfestast at det ikkje er eit bevisst designval at alle kontrollane skal vere jamt breie (t.d. av estetiske grunnar) før det vert endra.
2. **Kva for eitt av forslag 2A/2B (eller ein kombinasjon) for edge-routing-valet sin lange tekst?** A er enklare og krev ingen nye CSS-eigenskapar; B gjev meir kontroll over maks-breidd generelt (nyttig viss framtidige val får enda lengre tekst) men har den nemnde cross-browser-uvissa på `<select>`-styling.
3. **Skal regresjonsverns-testen (forslag 3) vere ein eigen, ny E2E-test, eller held det med ei enklare geometrisk sjekk** (t.d. ein Vitest/RTL-test som monterer heile app-skallet og målar `getBoundingClientRect()` på dei relevante elementa, som ville vere raskare enn ein full Playwright-køyring)?

## Testcase / akseptansekriterium — ALLE OPPFYLTE, stadfesta 2026-09-15

1. ✅ Ved E2E-viewport (1280×900) med `ProjectPanel`, `DisplayPanel`, og `PropertiesPanel` alle opne: `#lme-canvas-toolbar` sin bounding box overlappar IKKJE `#lme-display-panel` sin bounding box — stadfesta både ved direkte måling og av det nye regresjonsvernet (`canvas-toolbar-geometry.spec.ts`).
2. ✅ `golden-path.spec.ts` og `new-project.spec.ts` passerer, utan modifikasjon av sjølve testfilene.
3. ✅ `view-layout-bleed.spec.ts` passerer, utan modifikasjon av `nodeTranslate`/`dragNode`-hjelparane.
4. ✅ Heile Playwright-E2E-suiten går **7/7 grøn** (`pnpm --filter @linkml-editor/web test:e2e`, stadfesta direkte via Playwright, ikkje via WSL-delegeringa i denne runda — den WSL2/native testkøyringa er uendra av denne fiksen sidan han berre gjeld sjølve applikasjonskoden, ikkje hooken).
