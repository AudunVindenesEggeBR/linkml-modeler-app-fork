# Spec: React error #185 (uendeleg oppdateringsloop) ved bytte Canvas → Outline → Canvas med vald klasse

Status: **Implementert og verifisert — Alternativ 1, sjå "Runde 3" under.**
Dato: 2026-09-16 (implementert 2026-09-17)

## Bug-rapport (brukaren, ordrett)

> eg har funne ein bug. Eg åpner enhetsregisteret skjemaet frå URL. Trykker så på ein klasse i canvis visninga slik at klassen viser i Properties panelet. Trykker så på outline rendering. Trykker så på canvas rendering og får denne feilmeldinga: Unexpected Error
> Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.

React error #185 = "Maximum update depth exceeded" (uendeleg `setState`-loop). Stadfesta empirisk (sjå under).

## Reproduksjon (stadfesta)

Reprodusert i ein køyrande dev-instans (Playwright, `enhetsregisteret-frivilligorganisasjonapi-schema.yaml`), instrumentert og bisecta. Krev **begge** desse saman:

1. Ein klasse er vald på Canvas (`selectedNodeIds` ikkje tom i store) **før** ein byter vekk.
2. Byte til Outline og tilbake til Canvas.

Ingen av dei to åleine krasjar (stadfesta ved å isolere kvar for seg).

## Rotårsak

`packages/web/src/main.tsx:574-578` byter mellom `<SchemaCanvas>` / `<OutlineView>` / `<TableView>` via ein JSX-ternary — dette **avmonterer og remonterer** `<SchemaCanvas>` (og `<ReactFlowProvider>`) heilt ved kvart visningsbyte, i staden for å skjule han. Zustand sin `selectedNodeIds` (canvasSlice) overlever avmonteringa, så den remonterte canvasen kjem tilbake med eit **allereie eksisterande, ikkje-tomt utval**.

Sjølve loopen er ein lukka feedback-syklus, heilt inne i `packages/core/src/canvas/SchemaCanvas.tsx`:

1. `displayNodes` (linje 1077) utleier kvar ReactFlow-node sitt `selected`-flagg frå store sin `selectedNodeIds`, og vert sendt som den **kontrollerte** `nodes`-propen til `<ReactFlow>` (linje 1208).
2. `onSelectionChange` (linje 789-797) er ReactFlow sin EIGEN "selection echo-back"-callback — han les ReactFlow sin interne `nodeInternals` og kallar `setSelection(...)` (`canvasSlice.ts:65`), som skriv resultatet rett tilbake i den same `selectedNodeIds` som steg 1 les frå.
3. Instrumentering synte dette direkte: ved remontering fyrer `onSelectionChange` gjentekne gonger, og **vekslar** mellom å rapportere `nodes=["FrivilligOrganisasjon"]` og `nodes=[]`, i det uendelege — kvar veksling går gjennom `setSelection` → `selectedNodeIds` → `displayNodes` → ReactFlow sin `<StoreUpdater>` (`useStoreUpdater(nodes, setNodes)`) → ReactFlow sin interne store → `SelectionListener` → `onSelectionChange` igjen.

Den eksisterande vakta i `canvasSlice.ts` (linje 66-76, "skip if content unchanged"-sjekken i `setSelection`, lagt til tidlegare for ein ANNAN, alt fiksa referanse-identitetsloop) **hjelper ikkje her**: dei to tilstandane er reelt ulike i innhald kvar gong (`[id]` vs `[]]`), så vakta slepp korrekt gjennom kvar av dei, sidan dei frå vakta sitt synspunkt er legitimt ulike utval.

**Bevis for kvar fiksen høyrer heime**: fiksen vart stadfesta ved å patche den køyrande appen (via nettverksnivå-interception, ingen filer i repoet rørte) slik at `onSelectionChange` vart ein no-op — krasjet forsvann heilt med nøyaktig same reproduksjonssteg. Dette isolerer buggen til `onSelectionChange → setSelection`-koplinga, spesifikt utløyst av å montere ein FRISK ReactFlow-instans der den initielle kontrollerte `nodes`-propen alt har `selected: true` bakt inn frå persistert store-tilstand (i motsetnad til eit brukarklikk, som set utvalet via ReactFlow sin eigen interne tilstand først og konvergerer normalt — difor krasjar aldri eit fyrste-mount-utval frå eit reelt klikk).

## Forslag til fiks (IKKJE implementert — treng godkjenning)

Bryt den lukka loopen i staden for å prøve å overstyre ReactFlow sin interne tilstand. Alternativ, om lag i rekkefølge etter kor kirurgisk dei er:

1. **Mest kirurgisk**: I `onSelectionChange` (`SchemaCanvas.tsx:789-797`), ignorer rapportar som ikkje samsvarar med ein reell brukar-utval-gest — t.d. hopp over `setSelection`-kallet rett etter mount / før fyrste `onNodeClick`/drag-selection, sidan den kontrollerte `nodes`-propen alt ER sanninga for utval ved mount og ikkje treng ekkoast tilbake.
2. **Alternativ**: Ikkje så `displayNodes` sine initielle `selected`-flagg frå persistert `selectedNodeIds` ved ein frisk ReactFlow-mount; bruk i staden ein eksplisitt eingongs `setSelection`/no-op-reconciliation ETTER at ReactFlow sin eigen interne tilstand har stabilisert seg, slik at dei to sidene aldri samstundes "eig" det same feltet på ein måte som let den eine motseia den andre kvar rendring.
3. **Meir strukturelt**: Vurder om `onSelectionChange → setSelection` i det heile trengst no som `onNodeClick`/`onEdgeClick`/tastatur/DisplayPanel-utvalsoperasjonar alt skriv `selectedNodeIds` direkte — `onSelectionChange` treng kanskje berre handterast for rubber-band/drag-multiselect, som kan special-casast i staden for å vere kopla ubetinga.

Ingen av desse er implementerte enno. Treng brukargodkjenning av kva for eit alternativ (eller kombinasjon) som skal implementerast, jf. CLAUDE.md sin spec-first-regel.

## Evaluering — kva er mest robust og framtidsretta?

Gjorde vidare kodeundersøking (les `SchemaCanvas.tsx` direkte, ikkje berre agent-rapporten) for å grunngje denne vurderinga empirisk, ikkje berre i teorien.

### Presisering som endrar biletet: `onSelectionChange` er IKKJE berre for rubber-band

Kommentaren over `onSelectionChange` (`SchemaCanvas.tsx:788`) seier *"Rubber-band / multi-selection → update store selectedNodeIds"*, men det stemmer ikkje heilt med korleis koden faktisk fungerer:

- `onNodeClick` (linje 762-778) kallar **berre** `setActiveEntity(...)` — han kallar ALDRI `setSelection(...)` direkte.
- `setSelection` vert likevel kalla for eit vanleg enkelt-klikk òg, fordi ReactFlow sjølv markerer den klikka noden som `selected` internt (mindre `elementsSelectable`/tilsvarande er skrudd av — ikkje sett i denne fila), som utløyser `onSelectionChange` → `setSelection([nodeId], [])`.
- M.a.o.: **`selectedNodeIds` sin einaste kopling til eit vanleg enkeltklikk på canvas går via nøyaktig den same echo-mekanismen som forårsakar buggen.** Dette er ikkje eit kantscenario reservert for rubber-band — det er den *normale* vegen `selectedNodeIds` vert fylt frå eit klikk i det heile.
- I tillegg kallar `OutlineView.tsx:513,522` og `DisplayPanel.tsx:138,425` `setSelection` **direkte** (ikkje via ReactFlow-echo) — så `selectedNodeIds` er alt ein delt, sentral tilstand skriven frå fleire stader, ikkje eksklusivt eigd av canvas-echoen.

Dette betyr at **Alternativ 3 (fjern `onSelectionChange → setSelection` heilt)**, slik det opphavleg var formulert, **ville øydelagt vanleg enkeltklikk-seleksjon** — `selectedNodeIds` ville slutta å oppdaterast ved klikk på ein enkelt node (sjølv om `setActiveEntity`/Properties panel framleis ville fungert, sidan den koplinga er uavhengig). Funksjonar som les `selectedNodeIds` — hop-distance dimming (linje 1042-1048), highlight-on-selection, `DisplayPanel`, `FocusModeToolbar` ("Focus N selected node(s)"), `CommandPalette` ("Save N selected node(s) as View") — ville alle slutta å reagere på eit vanleg klikk. Alternativ 3 er difor **ikkje trygt som ein isolert, minimal fiks**; det krev i tillegg at `onNodeClick` sjølv byrjar kalle `setSelection([node.id], [])` eksplisitt, som er ei større, meir risikabel åtferdsendring (heile seleksjonsmodellen i fila må gjennomgåast — kva skjer t.d. med shift-klikk-multiselect, som ReactFlow handterer internt via `multiSelectionKeyCode="Shift"` og som IKKJE går via `onNodeClick`, berre via `onSelectionChange`?).

### Ein tredje, alt dokumentert instans av same buggklasse i same fil

`displayNodes` sin eigen kommentar (linje 1078-1086) forklarar at `derivedNodes` (skjema-avleia) medvite IKKJE avheng av `storeNodes` (Zustand sin `nodes`-tilstand, skriven av `onNodesChange` via `applyNodeChanges`, linje 633-635) — nettopp for å unngå ein tidlegare, allereie fiksa uendeleg-loop mellom desse to. Det er altså **allereie eitt tidlegare tilfelle** av "to skriverar av same ReactFlow-kontrollerte tilstand fightar" i akkurat denne fila. Denne nye buggen (`selectedNodeIds` ↔ `onSelectionChange`) er strukturelt **den same buggklassen på nytt**, berre via ein annan tilstand (`selected`-flagget på nodes, i staden for heile node-arrayet). Det er eit teikn på at "kontrollert ReactFlow-tilstand + echo-tilbakeskriving" er eit gjentakande failure-mode i denne fila, ikkje eit eingongstilfelle — noko som talar FOR ein fiks som fjernar sjølve mismatch-vindauget strukturelt, ikkje berre lappar denne eine symptom-instansen.

### Vurdering av alternativa

**Alternativ 1 (gate `onSelectionChange` inntil ein reell brukar-gest)** — enklast å implementere, men har ein reell UX-regresjon: viss vi hoppar over ALLE `onSelectionChange`-kall inntil brukaren klikkar/drar noko, vert det tidlegare valde utvalet ALDRI vist som vald att på canvasen etter eit visningsbyte (sidan `displayNodes` sitt `selected`-flagg framleis er korrekt sett frå `selectedNodeIds`, men ReactFlow sin interne tilstand vert aldri bedt om å bekrefte/konvergere til det, og notatet over syner at det er nettopp DEN konvergeringa — via echo — som normalt får utvalet til å "feste seg" visuelt). Brukaren ville altså oppleve at utvalet forsvinn frå canvasen ved tilbakebyte, sjølv om det framleis står i Properties panelet/`selectedNodeIds`. Dette er ikkje ein reint kosmetisk detalj — det er nøyaktig den slags stille inkonsistens CLAUDE.md sin "No silent failures" §åtvarar mot i tilstøytande samanhengar.

**Alternativ 2 (eksplisitt eingongs-reconciliation etter mount, presisert)** — den robuste varianten av dette er: **ikkje** så `selected: true` inn i den ALLER FYRSTE `nodes`-propen ein fersk ReactFlow-instans mottek (uansett kva `selectedNodeIds` seier), men vent til ReactFlow sin eigen `onInit`-callback har fyrt (eit tilstandsflagg, t.d. `isReactFlowReady`, default `false`, sett `true` i `onInit`). Fyrste rendering går då ut med eit ReactFlow-internt tilstand OG ein kontrollert prop som er samstemde (begge "ikkje vald"), så ingen mismatch, ingen initial echo-storm. Straks `isReactFlowReady` vert `true`, reknar `displayNodes` seg på nytt og seier no `selected: true` for det persisterte utvalet — MEN på dette tidspunktet er ReactFlow sin interne `nodeInternals` alt initialisert og stabil, så denne oppdateringa oppfører seg som ei HEILT VANLEG kontrollert-prop-endring (nøyaktig same slags endring som eit ekte klikk produserer, og den veit vi alt konvergerer reint — stadfesta av agentrapporten: "a real click never crashes"). Dette gjev **både** korrekt gjenoppretta visuelt utval **og** ingen loop, utan å røre seleksjonsmodellen elles.

**Alternativ 3 (fjern `onSelectionChange` / gjer han spesialtilfelle)** — konseptuelt reinaste langsiktige arkitektur (éin eigar av `selectedNodeIds`, ingen echo i det heile), men **ikkje trygt som minimal fiks** av grunnane over — krev å eksplisitt kalle `setSelection` frå `onNodeClick` (og handtere shift-klikk-multiselect-tilfellet, som per no utelukkande går via `onSelectionChange`). Dette er ei god idé som **strukturell separat oppgåve** (fjerne det gjentakande "kontrollert tilstand + echo"-mønsteret frå fila for godt, jf. punktet over om at dette er andre gong same buggklasse dukkar opp), men bør handterast som sitt eige spec/issue, ikkje bakast inn i denne bugfiksen — større diff, større risiko for regresjon i multiselect/rubber-band, og vanskelegare å verifisere manuelt før ein promotion.

### Konklusjon / tilråding

**Alternativ 2 (presisert: gate initial seleksjons-seeding på `onInit`, ikkje på brukargest) er mest robust og framtidsretta som den umiddelbare fiksen**, fordi:

1. Han fjernar den faktiske rotårsaka (mismatch mellom kontrollert prop og ReactFlow sin ferske interne tilstand ved mount) i staden for å arbeide rundt symptomet.
2. Han bevarer eksisterande åtferd fullt ut — persistert utval vert framleis vist som vald etter eit visningsbyte, ingen UX-regresjon (i motsetnad til Alternativ 1).
3. Han rører IKKJE sjølve seleksjonsmodellen (`onNodeClick`, shift-klikk, rubber-band, `OutlineView`/`DisplayPanel` sine direkte `setSelection`-kall er alle upåverka) — minimal blast radius, lett å verifisere isolert.
4. Han generaliserer til FRAMTIDIGE tilfelle av same mismatch-mønster: same mekanisme ville verna mot ein tilsvarande loop dersom `SchemaCanvas` i framtida vert remounta frå andre stader enn visningsbytet (t.d. eit "hopp til node frå søk", opning av eit nytt skjema medan gamalt utval framleis står i storen, eller ein tenkjeleg framtidig fane-/split-view-funksjon) — sidan fiksen ikkje er kopla til *kva* som trigga remountinga, berre til at ein fersk ReactFlow-instans aldri får ein forhandssett `selected`-verdi før han sjølv har initialisert seg.

**Anbefaling for oppfølging (separat, ikkje del av denne fiksen):** Alternativ 3 sin idé — fjerne det doble "kontrollert tilstand + echo-tilbakeskriving"-mønsteret heilt frå `SchemaCanvas.tsx` (både for `storeNodes`/`onNodesChange` frå det FYRSTE tidlegare tilfellet, og for `selectedNodeIds`/`onSelectionChange` her) — bør vurderast som eit eige, seinare spec/issue, gjeve at dette no er stadfesta som ei tilbakevendande buggklasse i fila. Ikkje del av godkjenninga for DENNE fiksen.

## Runde 2 — Alternativ 2 implementert, testa empirisk i nettlesar, og FORKASTA

Brukaren skreiv "utfør alternativ 2" — eksplisitt godkjenning av Alternativ 2 slik det stod skildra over.

**Implementert nøyaktig som skildra**: lagt til `isReactFlowReady`-tilstand (default `false`, sett `true` i ein ny `onInit`-callback kopla til `<ReactFlow onInit={onInit}>`), og gata `displayNodes` sin seleksjons-seeding (`selectedSet = new Set(isReactFlowReady ? selectedNodeIds : [])`) OG (etter eit fyrste funn, sjå under) `onSelectionChange` sjølv, begge på `isReactFlowReady`.

**Statisk verifikasjon (alt som normalt kvalifiserer ein fiks som "ferdig") var heilt grønt:**
- `pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json --noEmit`: rein, ingen feil.
- `pnpm exec eslint packages/*/src --ext .ts,.tsx`: ingen nye åtvaringar/feil i `SchemaCanvas.tsx`.
- `pnpm --filter @linkml-editor/core test`: 337/337 testar grøne (2 todo). (14 "Timeout waiting for worker to respond"-feil oppstod samtidig — stadfesta som den alt dokumenterte WSL2-vitest-flakiness i denne fila, IKKJE ein regresjon: alle testfiler som faktisk køyrde, gjekk grønt.)

**MEN: manuell verifikasjon i ein reell nettlesar (Playwright, `chromium`, mot ein køyrande `pnpm dev` + ein lokal CORS-aktivert fixture-server som serverte `kitchen_sink.yaml`) synte at fiksen IKKJE fungerer.** Dette er nøyaktig den slags gap CLAUDE.md sitt "verifiser empirisk, ikkje berre ved kodelesing"-punkt åtvarar mot — statisk verifikasjon (tsc/lint/unit-testar) kan ikkje fange ein runtime-interaksjonsbug som denne i det heile, sidan ingen eksisterande test øver på "vald node → byt visning → byt tilbake"-sekvensen.

### Kva som faktisk skjedde (stadfesta med diagnostisk logging)

Fyrste nettlesar-køyring (rett etter koderedigering, UTAN å restarte `pnpm dev`) viste INGEN krasj — men det var **falsk positiv**, forårsaka av den alt dokumenterte Vite-dev-server-staleness-buggen i denne fila ("kan stille bli ved å servere ein gamal, pre-edit versjon av ei `packages/core/src`-fil"). Etter å ha DREPT og RESTARTA `pnpm dev` (per den eksisterande instruksen i denne fila), reproduserte krasjet på nytt — no i sjølve `<StoreUpdater>`-komponenten, med identisk "Maximum update depth exceeded"-feil.

Lagt til temporær diagnostisk `console.log` i `onInit`, `onSelectionChange`, og `displayNodes` (fjerna igjen etterpå — ikkje del av den endelege koden) synte nøyaktig kva som skjer:

```
[DIAG] onInit fired
[DIAG] displayNodes recompute {isReactFlowReady: true, selectedNodeIds: ["Person"]}
[DIAG] onSelectionChange {isReactFlowReady: true, nodeIds: []}
[DIAG] displayNodes recompute {isReactFlowReady: true, selectedNodeIds: []}
[DIAG] onSelectionChange {isReactFlowReady: true, nodeIds: ["Person"]}
[DIAG] displayNodes recompute {isReactFlowReady: true, selectedNodeIds: ["Person"]}
[DIAG] onSelectionChange {isReactFlowReady: true, nodeIds: []}
... (vekslar i det uendelege, identisk mønster som i Runde 1, heilt til React kastar "Maximum update depth exceeded")
```

**Dette forkastar ein sentral premiss i Alternativ 2 sin argumentasjon.** Konklusjonen over hevda: *"denne oppdateringa oppfører seg som ei HEILT VANLEG kontrollert-prop-endring (nøyaktig same slags endring som eit ekte klikk produserer, og den veit vi alt konvergerer reint)."* Det stemmer IKKJE. Oscillasjonen startar ikkje FØR `onInit` (det gata vi bort, og det virka), men startar på nytt REKKE ETTER `onInit`, akkurat i det øyeblikket vi (via `displayNodes`) fyrste gong skriv det PERSISTERTE utvalet inn i den kontrollerte `nodes`-propen — sjølv om ReactFlow sin interne tilstand på det tidspunktet er fullt initialisert og "stabil".

**Revidert forståing av rotårsaka:** Skiljet er IKKJE "kald mismatch ved mount" vs. "stabil tilstand etter mount" (som Alternativ 2 sitt resonnement bygde på). Skiljet er **kven som initierte at ein node skal vere `selected`**:
- Eit ekte klikk/drag/shift-klikk: ReactFlow sin EIGEN interne pointer-/tastatur-handtering set sin interne tilstand FØRST (utan om vår kontrollerte `nodes`-prop i det heile), og fortel oss det ETTERPÅ via `onSelectionChange`. Når vi då skriv `selected:true` inn i vår kontrollerte prop, samsvarar det allereie med det ReactFlow internt alt trudde — inga uoverensstemming, ingen kamp.
- ALL programmatisk seleksjon som IKKJE går via ReactFlow sin eigen pointer-handtering — inkludert restaurering av persistert `selectedNodeIds` etter ein remount, uansett OM det skjer før eller etter `onInit` — tvinger ReactFlow til å akseptera ein `selected:true`-verdi det ikkje sjølv "bestemte". Det ser ut til at ReactFlow (denne versjonen, 11.x) då korrigerer tilbake internt, ekkoar den korrigeringa til oss via `onSelectionChange`, vi skriv tilbake det opphavlege utvalet, osv. — ein sjølv-forsterkande, ikkje-konvergerande kamp, IKKJE avhengig av mount-tidspunkt.

Dette betyr at det opphavlege prinsippet Alternativ 2 bygde på ("berre unngå MISMATCH-VINDAUGET ved mount") var feil karakterisert — problemet er strukturelt kopla til at `selectedNodeIds → displayNodes.selected → kontrollert nodes-prop` i det heile er ein ANNAN skriveveg enn ReactFlow sin eigen interne seleksjonshandtering, for ALL programmatisk (ikkje-klikk-initiert) seleksjon — ikkje spesifikt for "kald" mount-tilstand.

### Handling denne runden

- All kode reversert til nøyaktig samme tilstand som før denne økta (stadfesta med `git diff` — tom diff på `SchemaCanvas.tsx`). Diagnostisk logging fjerna.
- Scratch-filer (Playwright-driver, CORS-fixture-server, skjermbilde) i `packages/web/` sletta, `pnpm dev`- og fixture-serverprosessane drepne.
- INGEN kodeendring står ute no — repoet er tilbake i utgangspunktet.

### Konsekvens for alternativa (revidert)

- **Alternativ 2 (som skildra i Runde 1) er forkasta — fungerer ikkje.** Ei eventuell vidare presisering ("gate på `onInit` OG utfør restaureringa via ReactFlow sitt EIGE imperative API, t.d. `reactFlowInstance.setNodes(...)` frå `useReactFlow()`, i staden for via den eksterne kontrollerte `nodes`-propen — og då la `displayNodes` sitt `selected`-felt aldri lenger avhenge av `selectedNodeIds` i det heile") er ei HYPOTESE, IKKJE stadfesta — det er ei strukturelt større endring (flytter kven som "eig" `selected` heilt over til ReactFlow sjølv, med `selectedNodeIds` berre som eit einvegs-speglingsresultat), nærmar seg i praksis Alternativ 3 sin arkitektur, og må testast empirisk i nettlesar på nøyaktig same måte før den kan tilrådast.
- **Alternativ 1 (gate `onSelectionChange` permanent inntil brukaren faktisk klikkar/drar)** ser no meir attraktivt ut enn i Runde 1 sin vurdering: den tidlegare vurderte "UX-regresjonen" er mindre alvorleg enn fyrst framstilt — stadfesta i denne runden sitt browser-testoppsett (før koden vart reversert) at Properties panel/`activeEntity`-utvalet ("class: Person") framleis vises korrekt etter visningsbyte HELT UAVHENGIG av om `selectedNodeIds` blir null-stilt, sidan dei er to separate tilstandar (`setActiveEntity` vs. `setSelection`). Det som faktisk går tapt utan Alternativ 1 sin visuelle re-seleksjon er berre: (a) den blå seleksjons-ringen på selve canvas-noden, og (b) avledde tilstandar som `FocusModeToolbar` sin "Focus N selected node(s)"-status og hop-distance-dimming. Dette er ei mindre, meir avgrensa kostnad enn opphavleg vurdert.
- **Alternativ 3 (strukturell: fjern `onSelectionChange → setSelection`-koplinga for klikk-tilfellet, la `onNodeClick` skrive `setSelection` direkte)** er no meir relevant enn før: Runde 2 sitt funn ("problemet er strukturelt, ikkje eit mount-tidspunkt-artefakt") talar for at DENNE buggklassen vil dukke opp igjen i FRAMTIDIGE tilfelle av programmatisk seleksjon uansett tidspunkt (ikkje berre remount) om ikkje sjølve skriveveg-arkitekturen endrar seg. Framleis ei større, meir risikabel endring enn ein isolert bugfiks bør vere.

### Tilråding for neste runde

Gjeve at Alternativ 2 (som opphavleg formulert) er stadfesta IKKJE å fungere, ber denne specen om NY brukargodkjenning av kva som skal implementeres, blant:

1. **Alternativ 1** (enklaste, tryggaste, verifiserbare fiks — misser berre den visuelle seleksjons-ringen + avledde tilstandar etter eit visningsbyte, IKKJE Properties panel-konteksten).
2. **Ei presisert, empirisk verifisert utgåve av "Alternativ 2b"** (imperativ ReactFlow-restaurering via `useReactFlow()`, IKKJE via kontrollert prop) — MEN dette krev ein ny implementerings- og empirisk-verifikasjonsrunde før det kan tilrådast, og kan vise seg å ha sine eigne komplikasjonar.
3. Gje opp å fikse dette no og heller dokumentere det som ei kjend avgrensing (ikkje tilrådd — det er framleis ein reell krasj brukaren opplevde).

## Runde 3 — Alternativ 1 implementert og empirisk stadfesta i nettlesar

Brukaren skreiv "utfør alternativ 1" — eksplisitt godkjenning, etter at Runde 2 synte at Alternativ 2 ikkje fungerte og la fram Alternativ 1 og ei uverifisert "Alternativ 2b" som dei attverande vegane.

**Implementert nøyaktig som skildra i Runde 2 sin konklusjon** (`packages/core/src/canvas/SchemaCanvas.tsx`):
- Ny `hasUserInteractedRef` (`useRef(false)`), plassert ved sida av `onSelectionChange`.
- `onSelectionChange` hoppar no over `setSelection(...)` heilt (`if (!hasUserInteractedRef.current) return;`) inntil eit reelt peikar-trykk har skjedd på dette mountet.
- Canvas-wrapper-diven (`#lme-canvas-wrapper`) fekk ein `onPointerDownCapture`-handler som set `hasUserInteractedRef.current = true` — dette dekker klikk, drag og rubber-band-start, sidan alle startar med eit `pointerdown` inne i wrapperen.

**Statisk verifikasjon:**
- `pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json --noEmit`: rein.
- `pnpm exec eslint packages/*/src --ext .ts,.tsx`: ingen nye åtvaringar/feil.
- `pnpm --filter @linkml-editor/core test`: 336/336 testar grøne (2 todo). (14 "Timeout waiting for worker to respond"-feil — same alt-dokumenterte WSL2-vitest-flakiness som i Runde 2, stadfesta ikkje ein regresjon: talet varierer mellom køyringar reint pga. kva testfiler som tilfeldigvis vert ramma av flakiness-en, ikkje pga. denne endringa.)

**Empirisk stadfesta i ein reell nettlesar** (Playwright, `chromium`, mot ein FRISK restarta `pnpm dev` — lærdomen frå Runde 2 sin falske positiv vart følgt denne gongen), over to fulle Canvas → Outline → Canvas-rundturar:

- **Krasjet er borte** på begge rundturane — ingen "Unexpected Error", ingen "Maximum update depth"/React #185, `page.on('pageerror')` fanga null feil.
- **Seleksjonsringen på canvas BEVARAST** — i motsetnad til denne specen sin eigen gjetting i Runde 1/2-vurderinga. `[data-id="Person"]` sin `classList` inneheldt framleis `selected` etter tilbakebyte til Canvas, begge rundturane. Grunnen: vakta hindrar berre SKRIVINGA tilbake til `selectedNodeIds` i mismatch-vindauget — sidan `selectedNodeIds` i storen aldri vert rørt, held `displayNodes` fram med å setje `selected: true` på den same noden, og denne kontrollerte verdien held seg stabil (visuelt korrekt) no som ingen konkurrerande echo lenger fightar mot han.
- **Regresjonssjekk greidd**: klikk på ein ANNAN node (`Thing`) etter visningsbyte valde han normalt; klikk på `Person` att etter andre rundturen fungerte òg normalt — vakta vert permanent open ved fyrste reelle peikar-trykk og er då heilt usynleg for vanleg bruk.
- Éin urelatert, PREEKSISTERANDE konsoll-åtvaring dukka opp under testen (React: nøsta `<button>` inni `<button>` i `ProjectPanel` sin "Collapse views"-kontroll) — stadfesta urelatert til denne fiksen (`git diff --stat` viser berre `SchemaCanvas.tsx` endra) og difor utanfor scope her. Bør fangast opp i ein eigen, seinare issue/spec om nokon støyter på han igjen.
- Opprydding gjort: Playwright-driver, debug-skript og CORS-fixture-server sletta frå `packages/web/`, dev-server- og fixture-serverprosessane drepne, skjermbilete/loggar sletta. `git status` er rein bortsett frå den tilsikta `SchemaCanvas.tsx`-fiksen og denne spec-fila.

**Konklusjon**: Alternativ 1 leverer alt Alternativ 2 lova (ingen krasj, bevart visuelt utval) UTAN Alternativ 2 sin feilaktige premiss om mount-tidspunkt, og med eit vesentleg mindre og lettare-å-resonnere-om diff (eitt `useRef`, éin tidleg-return, éin DOM-event-handler — ingen endring i `displayNodes` eller sjølve seleksjonsmodellen elles).

## Testcase / akseptansekriterium

1. Manuell repro: opne eit fleire-klasse-skjema frå URL, vel ein klasse på Canvas, byt til Outline, byt tilbake til Canvas — ingen krasj, utvalet (både i Properties panelet OG den visuelle ringen på canvas) er bevart. ✅ Stadfesta i Runde 3.
2. Automatisert (bør leggjast til, t.d. Playwright E2E i `packages/web`): reproduser same sekvens og stadfest ingen konsolfeil / ingen "Unexpected Error"-boundary trigga. **Ikkje gjort enno** — berre manuell/engongs Playwright-verifikasjon i denne runda, ikkje ein varig test i suiten. Vurder som eiga oppfølging.
3. `pnpm --filter @linkml-editor/core test` framleis grøn (ingen regresjon i eksisterande canvas-/selection-testar). ✅ 336/336, sjå over.
4. `pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json --noEmit` rein. ✅ Stadfesta.
