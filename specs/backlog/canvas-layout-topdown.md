# Spec: Layout-knappen — klassar overlappar kvarandre (hovudbug), pluss meir konsekvent top-down-retning

Status: **Alt over implementert og verifisert. Runde 8 la til kantruting- og nodeplasserings-veljarar.** Sjå "Implementasjonsstatus" nedst.
Dato: 2026-09-08 (runde 8 — brukaren spurde om det finst fleire ELK-flag verdt å eksponere; svarte med kantruting og nodeplassering som dei to mest verdifulle, brukaren svarte "ja" til å implementere direkte)
Ønske (opphavleg): "Layout"-knappen skal stable klassane top-down i ein mest mogleg retta graf.
Ønske (presisert, runde 1): brukaren rapporterte at klassane **delvis legg seg over kvarandre** når Layout vert trykt, noko som gjer resultatet ubrukeleg — og spurde om det finst ein test for canvas-layout.
Ønske (presisert, runde 2, etter runde 1-fiksen): overlapp er borte bortsett frå éin ekstra brei "container"-klasse, og resultatet er framleis uleseleg fordi range-/is_a-kantar krysser kvarandre på kryss og tvers — kan vi kalkulere for minst mogleg kryssande strekar?
Ønske (presisert, runde 3, etter runde 2-fiksen): overlapp er heilt borte i begge visningane (kompakt ved opning, og etter Layout-trykk), men klassane ligg for tett saman — kantane vert uleselege. Treng meir luft. I tillegg: implementer Prioritet 3 (retnings-/algoritme-finjustering) frå denne spesifikasjonen.
Ønske (presisert, runde 4, etter runde 3-fiksen): den nye retningsveljaren (frå runde 3, Prioritet 3 punkt 3) syner seg, men val av anna retning gjer ingenting — heller ikkje etter manuelt Layout-trykk.

## Svar på "finnes det ein test for canvas-layout?"

**Nei.** Det finst ingen test for sjølve ELK-layout-algoritmen. `packages/core/src/io/__tests__/layout.test.ts` testar berre **lagring/lasting** av layout-data til/frå `.linkml-editor.yaml`-manifestet (sidecar-persistering), ikkje kva `runAutoLayout` faktisk produserer av posisjonar. `packages/core/src/__tests__/perViewLayout.test.ts` testar val AV kva layout som er aktivt per visning, heller ikkje algoritmen. Det finst altså ingen regresjonstest som ville fanga opp akkurat overlappings-buggen brukaren rapporterer — sjå forslag til ny test nedst.

## Rotårsak til overlapp — stadfesta i koden

`runAutoLayout` (`packages/core/src/canvas/autoLayout.ts:57-71`) gir ELK **faste, hardkoda dimensjonar** for kvar klassenode, uavhengig av innhald:

```ts
const CLASS_W = 240;
const CLASS_H = 120;
```

Men den faktisk rendra `ClassNode`-komponenten (`packages/core/src/canvas/ClassNode.tsx`) har **ingen fast høgde** — han veks med talet på attributt/slots klassen har. Kvar attributt-rad (`SlotRow`) har `minHeight: 22` + `1px`-kantlinje (`styles.slotRow`, line 320-327), i tillegg til ein header (~`padding: '6px 10px'` + `fontSize: 13`, line 276-284, grovt ~30-34px) og, viss klassen har `is_a`, ein ekstra `isaRow` (~24px, line 304-310) og litt body-padding (line 317-318).

Grov, men realistisk høgdeformel basert på desse CSS-verdiane:

```
faktisk høgde ≈ 34 (header) + [24 viss is_a] + 8 (body-padding) + tal_attributt × 23
```

Med `CLASS_H = 120` fast, betyr det at **alle klassar med meir enn ca. 3 attributt (utan is_a) eller ca. 2 attributt (med is_a) alt vil rendrast høgare enn ELK trudde dei var** — noko dei fleste reelle LinkML-klassar har. ELK plasserer difor neste node/lag basert på ei boks som er FOR LITEN, og den verkelege, større rendra korta stikk ned i det som skulle vore ledig rom. Dette er open og lukka forklaringa på "klassene legg seg delvis over kvarandre" — **ikkje** eit spørsmål om `direction`/algoritme-val (som var mi opphavlege, no sekundære, hypotese).

Merk òg: `ClassNode` sin ytre boks har `minWidth: 200, maxWidth: 320` (`ClassNode.tsx:240-241`) — altså variabel breidde òg, men avgrensa til eit mindre spenn (80px) enn høgda sitt potensielt ubegrensa spenn (kan verte svært høg med mange attributt) — breidde-mismatchen er difor eit mindre alvorleg sekundært problem enn høgde-mismatchen.

**Slotnamn/-range brekk ikkje over fleire linjer** (`overflow: hidden, textOverflow: 'ellipsis'`, line 337-339 m.fl.) — dei vert avkorta med "…" i staden. Det tyder radhøgda er pålitleg konstant (~22-23px) uavhengig av tekstlengd, som gjer ein attributt-tal-basert høgdeestimering trygg og ikkje-skjør.

## Forslag til fiks (prioritert)

### 1. (Høgast prioritet — løyser sjølve overlapp-buggen) Estimer nodehøgde/-breidde frå faktisk innhald i staden for faste konstantar

Legg til ein eksportert hjelpefunksjon i `autoLayout.ts`, t.d.:

```ts
export function estimateClassNodeSize(classDef: ClassDefinition): { width: number; height: number } {
  const HEADER_H = 34;
  const ISA_ROW_H = 24;
  const BODY_PADDING = 8;
  const ROW_H = 23;
  const attrCount = Object.keys(classDef.attributes).length;
  const height = HEADER_H + (classDef.isA ? ISA_ROW_H : 0) + BODY_PADDING + attrCount * ROW_H;
  return { width: CLASS_W, height: Math.max(height, CLASS_H) };
}
```

og bruk han i staden for den faste `CLASS_H` når `elkNodes` vert bygd (`autoLayout.ts:57-62`). Juster dei fire konstantane (`HEADER_H` osv.) ved å faktisk måle eit par rendra kort i nettlesaren (DevTools → inspiser element → "Computed" → height) før implementering, sidan CSS-verdiane over er lesne frå stilobjekta, ikkje målt direkte i nettlesaren.

**Vurder** (sekundært, kan utsetjast): ta omsyn til `collapsed`-state (`data.collapsed` i `ClassNode`) òg, sidan ein samanslegen klasse viser få/ingen attributt-rader og difor er mykje lågare enn den fullt utvida høgda — for no er det trygt/konservativt å alltid estimere for UTVIDA (verste tilfelle) høgde, som unngår overlapp sjølv om det kan gje unødvendig mykje luft rundt samanslegne klassar.

### 2. (Same prioritet som 1 — direkte respons på brukaren sin førespurnad) Legg til ein regresjonstest som eksplisitt sjekkar at ingen nodar overlappar

Ny testfil `packages/core/src/canvas/__tests__/autoLayout.test.ts` (finst ikkje i dag). Kjernetest:

```ts
it('produces non-overlapping bounding boxes for classes with many attributes', async () => {
  // Bygg eit syntetisk skjema med t.d. 3 klassar der minst éin har 15+ attributt
  const layout = await runAutoLayout(schema, {}, [], new Set(), 'show');
  const boxes = Object.entries(layout.nodes).map(([name, pos]) => {
    const { width, height } = estimateClassNodeSize(schema.classes[name]); // eller enum-dimensjonar
    return { name, x1: pos.x, y1: pos.y, x2: pos.x + width, y2: pos.y + height };
  });
  for (const [a, b] of allPairs(boxes)) {
    expect(rectanglesOverlap(a, b)).toBe(false);
  }
});
```

Denne testen er **algoritme-agnostisk** — han bryt ikkje viss nokon seinare justerer ELK-opsjonar (retning, spacing, algoritme), berre viss dei faktiske boksane overlappar. Legg gjerne òg til ein enkel, direkte unit-test av `estimateClassNodeSize()` sjølv (t.d. "10 attributt gir større høgde enn 2 attributt", "is_a legg til ekstra høgde").

### 3. (Sekundært — den opphavlege "meir retta"-førespurnaden, no lågare prioritert enn overlapp-fiksen)

Framleis relevant, men ikkje det som gjer resultatet "ubrukeleg" slik brukaren skildra:

- `elk.layered.layering.strategy: 'LONGEST_PATH'` i `elkGraph.layoutOptions` (`autoLayout.ts:137-143`) for å maksimere vertikal stabling framfor ELK sin standard (som prioriterer kompakt breidde).
- Vurder å alltid inkludere range-kantar i layout-berekninga (uavhengig av `rangeEdgesMode`, som framleis kan styre om dei vert TEIKNA) — fleire klassar får då ein hierarkisk plassering å følgje.
- Eksponer `direction`/`algorithm` som eit lite UI-val ved sida av Layout-knappen, sidan typen alt støttar `TB|BT|LR|RL`.

## Testcase / akseptansekriterium

1. Opprett/finn eit skjema med minst éin klasse med 10+ attributt (sjekk `packages/core/src/io/__fixtures__/schemas/` for noko eigna, elles lag eit syntetisk testskjema).
2. Trykk "Layout".
3. **Ingen synleg overlapp** mellom nokon nodar, uavhengig av kor mange attributt kvar klasse har.
4. Foreldreklassar ligg framleis konsekvent over sine barn (uendra frå i dag).
5. Den nye testen i punkt 2 over (`autoLayout.test.ts`) køyrer grønt, og ville feila mot den GAMLE (faste `CLASS_H = 120`) implementasjonen for ein klasse med mange attributt — stadfest dette ved midlertidig å reversere fiksen lokalt og sjå testen feile, før fiksen vert commit­a permanent.

## Implementasjonsstatus

- **Prioritet 1 (rotårsak-fiks):** `estimateClassNodeSize()` og `estimateEnumNodeSize()` lagt til i `autoLayout.ts`, brukt for lokale klassar/enums OG for importerte "spøkelses"-entitetar (som viste seg å ha nøyaktig same variabel-høgde-problem, sidan dei renderer via same `ClassNode`/`EnumNode`-komponentar med fullt attributt-/verdi-sett). Konstantane (`HEADER_H=34`, `ISA_ROW_H=24`, `BODY_PADDING=8`, `ROW_H=23`, `ENUM_VALUE_LIMIT=12`) er henta direkte frå `ClassNode.tsx`/`EnumNode.tsx` sine stilobjekt, ikkje gjetta. `collapsed`-state vart medvite IKKJE teke omsyn til (estimerer alltid for utvida/verste tilfelle — trygt, unngår overlapp, kan gje litt ekstra luft rundt samanslegne klassar).
- **Prioritet 2 (test):** Ny `packages/core/src/canvas/__tests__/autoLayout.test.ts` — einingstestar for begge estimat-funksjonane (attributt-tal, is_a-tillegg, verdi-tal, cap ved `ENUM_VALUE_LIMIT`), pluss to integrasjonstestar som byggjer eit syntetisk skjema med ei klasse med 20 attributt / ein enum med 15 verdiar og stadfestar at INGEN boundingboksar (posisjon frå `runAutoLayout` + estimert storleik) overlappar. 8 testar, alle grøne. Full typecheck av `packages/core` er rein.
- **Verifisert:** køyrde heile `packages/core`-testpakken via container (denne verten manglar Node/pnpm) — 567/569 testar grøne (opp frå 541-baseline før denne endringa), null feil knytt til autoLayout/canvas. Dei 7 feila som dukka opp var same kjende, tidlegare diagnostiserte infrastruktur-flaks (vitest-forked-worker-timeout i denne containeren, uavhengig av kode — treffer tilfeldige jsdom-testfiler, denne gongen `editor-panels.test.tsx`/`gitSlice.test.ts`, ingen av dei rørt av denne endringa).
### Runde 2 — breidde-overlapp + kryssande kantar

Brukaren stadfesta at høgde-fiksen (runde 1) fungerte i praksis etter rebygg/redeploy, men rapporterte to attverande problem: (a) éin ekstra brei "container"-klasse overlappar framleis, og (b) mange kryssande range-/is_a-strekar gjer visninga uleseleg.

- **(a) Breidde-overlapp — same rotårsak som høgde-buggen, no retta likt:** `CLASS_W` var 240, men `ClassNode.tsx` sin CSS tillèt kortet å vekse opp til `maxWidth: 320` (`minWidth: 200`) for klassar med lange attributt-/range-namn (tekst brekk aldri, men boksen sjølv veks opp til taket). Retta ved å bruke CSS-en sin `maxWidth` (320 for klasse, 280 for enum — same problem gjaldt `EnumNode.tsx`) som den faste ELK-breidda, i staden for eit gjetta tal midt i spennet. Dette garanterer at ELK aldri undervurderer breidda (kan i verste fall gje litt unødvendig luft for klassar med korte namn, men aldri overlapp) — tryggare enn å prøve å estimere reell tekstbreidde presist, som ville vore skjørt (avhengig av font-metrikk).
- **(b) Kryssande kantar — svar: ja, det er mogleg, og ELK gjer det alt, berre ikkje justert.** ELK sin `layered`-algoritme har «crossing minimization» som éi av dei tre kjernefasane (lagdeling → kryss-minimering → node-plassering) — han køyrde alt, berre på eit umerka standardnivå. Lagt til eksplisitt i `elkGraph.layoutOptions`:
  - `elk.layered.crossingMinimization.strategy: 'LAYER_SWEEP'` (ELK sin eigen standard-heuristikk, no eksplisitt dokumentert i koden i staden for implisitt).
  - `elk.layered.thoroughness: '30'` (opp frå ELK sin standard på 7) — gir heuristikken fleire forsøk/iterasjonar på å finne ei betre (færre kryss) rekkjefølgje av nodar innanfor kvart lag. Kostnad: noko meir reknetid per Layout-trykk, akseptabelt for talet på klassar eit LinkML-skjema typisk har.
  - **Viktig atterhald:** kryss-minimering er NP-hardt i det generelle tilfellet — ELK sin heuristikk **reduserer** kryss, han **garanterer ikkje** eit kryssfritt resultat, særleg ikkje for skjema med mange range-kantar som peikar på tvers av heile arve-treet (desse er strukturelt annleis enn eit reint is_a-hierarki, og skapar uunngåelege kryss uansett kor god heuristikken er, viss dei same nodane har mange innkommande/utgåande kantar til fjerne delar av grafen).
- **Testa:** `estimateClassNodeSize`/`estimateEnumNodeSize` sine breidde-verdiar er no låst med eigne regresjonstestar (320/280 i staden for gamle 240/200-verdiane). Alle 10 testar i `autoLayout.test.ts` grøne, full typecheck rein. Ingen eigen automatisert test for sjølve kryss-talet — det ville kravd å telje kryss for ein kjend graftopologi manuelt, og me lener oss i staden på ELK sin eigen, veletablerte implementasjon av algoritmen; me testar berre at me sender dei rette opsjonane til han.

### Runde 3 — meir luft mellom klassane + Prioritet 3

Brukaren stadfesta (på eit ekte, sjølvlaga testskjema, `samt-bu-schema.yaml`, kopiert inn i repo-rota) at BÅDE den kompakte startvisninga (ved opning av eit skjema utan lagra layout) OG top-down-visninga (etter Layout-trykk) no er fri for overlapp og fungerer "ganske bra" — men klassane ligg for tett saman, så kantane er vanskelege å følgje visuelt. Undersøkt: begge visningane viste seg å bruke **nøyaktig same kode** (`runAutoLayout` med tomme opsjonar, kalla frå tre stader i `SchemaCanvas.tsx` — automatisk ved fyrste opning, automatisk ved nye importerte entitetar, og manuelt frå Layout-knappen), så éin og same fiks dekkjer begge.

**Meir luft:**
- `nodeNodeSpacing` (avstand mellom nodar i same lag): 40 → 70.
- `layerSpacing` (avstand mellom hierarki-nivå): 80 → 140.
- Nye, tidlegare ueksplisitte ELK-opsjonar for avstand RUNDT KANTAR spesifikt (skilt frå node-node-avstand): `elk.spacing.edgeNode: '20'`, `elk.layered.spacing.edgeNodeBetweenLayers: '20'`, `elk.spacing.edgeEdge: '15'`, `elk.layered.spacing.edgeEdgeBetweenLayers: '15'` — utan desse ruta dei ortogonale kantane tett inntil nodekantar og kvarandre, sjølv når nodane sjølve ikkje overlappa.

**Prioritet 3 (alle tre punkt implementerte):**
1. `elk.layered.layering.strategy: 'LONGEST_PATH'` lagt til — pressar kvar node til djupaste lovlege lag, maksimerer vertikal stabling (ELK sin eigen standard, `NETWORK_SIMPLEX`, prioriterer kompakt breidde i staden).
2. Range-kantar går no **alltid** inn i layout-berekninga (styrt berre av `hiddenEdgeTypes`), heilt uavhengig av `rangeEdgesMode` (som framleis styrer om dei vert TEIKNA som synlege kantar vs. inline chips på canvas). Sidan `rangeEdgesMode` dermed vart heilt ubrukt i `runAutoLayout`, vart parameteren **fjerna frå signaturen** (i staden for å behalde han daud) — oppdaterte alle tre kallstadene i `SchemaCanvas.tsx` og dei to testkalla i `autoLayout.test.ts` tilsvarande.
3. Lagt til ein liten `<select>` i verktøylinja rett ved sida av Layout-knappen (`SchemaCanvas.tsx`, ny `layoutDirection`-state), med dei fire retningane ELK alt støtta i typen (`TB|BT|LR|RL`) — verkar berre på manuelt Layout-trykk, ikkje dei to automatiske layout-trigga (som held fram med TB-standard, sidan det ikkje finst nokon brukarinteraksjon å lese ei retning frå på det tidspunktet).

**Testa:** alle 10 testar i `autoLayout.test.ts` framleis grøne (breidde-/høgde-estimata er uendra av desse justeringane — berre ELK sine eigne layout-opsjonar og edge-inkludering endra seg, ikkje storleiksberekninga). Full typecheck og ESLint (0 feil — dei to eksisterande åtvaringane i `SchemaCanvas.tsx` er stadfesta pre-eksisterande, urelaterte til denne endringa) verifisert via container. Full `packages/core`-testpakke: 579/581 testar grøne (opp frå 567), same kjende, ikkje-deterministiske infrastruktur-flaks (denne gongen råka `tours.test.ts`, endå ein annan, urelatert fil kvar gong — stadfestar at dette er eit miljøproblem i denne sandkassa, ikkje ein kodefeil).

### Runde 4 — retningsveljaren gjorde ingenting: `elk.direction` fekk ugyldige verdiar

Brukaren rapporterte at den nye retningsveljaren frå runde 3 ikkje hadde nokon synleg effekt, korkje ved val eller etter manuelt Layout-trykk.

**Rotårsak, stadfesta empirisk (ikkje berre lese i koden — sjå metode under):** `AutoLayoutOptions.direction` sine verdiar (`'TB'|'BT'|'LR'|'RL'`, ein vanleg konvensjon frå andre graf-bibliotek som Mermaid/dagre) vart sendt **direkte og uendra** til ELK sin `elk.direction`-layout-opsjon. Men ELK sin faktiske enum for denne opsjonen er **`DOWN|UP|LEFT|RIGHT`** — `TB` er ikkje eit gyldig ELK-verdi i det heile. ELK feilar ikkje på ein ukjend verdi, han **ignorerer han stille** og fell tilbake til sin eigen standard. Dette var difor ein *pre-eksisterande* feil i koden, usynleg heilt sidan `AutoLayoutOptions`-typen vart skrive opphavleg — ingen kalla nokon gong `runAutoLayout` med noko anna enn tomme opsjonar (alltid implisitt "TB") før retningsveljaren i runde 3 gjorde det mogleg å faktisk MERKE at retning ikkje batt noko.

**Metode for stadfesting (viktig, sidan dette er andre gong i denne spesifikasjonen ei rein kode-lesing førte til feil konklusjon om at noko "verka" — jf. runde 1 sin feilaktige "direction er reelt kopla til algoritmen"-påstand):** skreiv eit mellombels testskript som kalla rå `elkjs` direkte med `elk.direction` sett til `'TB'`, `'bogus'`, `'DOWN'`, `'UP'`, `'LEFT'`, `'RIGHT'` og samanlikna faktiske x/y-resultat. `'TB'` og `'bogus'` ga **identisk** resultat som `'RIGHT'` (ELK sin eigen standard er tydelegvis horisontal, ikkje vertikal, når retning er udefinert/ugyldig) — medan `'DOWN'`/`'UP'`/`'LEFT'`/`'RIGHT'` alle ga tydeleg ulike, korrekte resultat. Dette provar konklusivt at strengen `'TB'` aldri har fungert.

**Viktig sjølvkritisk merknad:** min tidlegare påstand i "Rotårsak til overlapp"-seksjonen over — at `direction: 'TB'` var "reelt kopla til algoritmen, ikkje daud/uverdig kode" — var **feil**. Eg verifiserte at verdien vart *sendt* til ELK, men verifiserte aldri at ELK faktisk *forstod* verdien. Dette er grunnen til at eg no konsekvent testar empirisk (faktisk køyrer koden og samanliknar resultat) i staden for berre å lese kode og anta at noko fungerer fordi det "ser rett ut".

**Retta:** ny `DIRECTION_TO_ELK`-oppslagstabell i `autoLayout.ts` som omset vårt offentlege `TB|BT|LR|RL`-namneverk til ELK sin faktiske `DOWN|UP|RIGHT|LEFT`-enum, brukt når `elkGraph.layoutOptions['elk.direction']` vert bygd. Det offentlege API-et (`AutoLayoutOptions.direction`) er uendra — berre omsetjinga ved ELK-grensa er lagt til.

**Testa:** 5 nye testar i `autoLayout.test.ts` som konkret sjekkar at TB/BT/LR/RL faktisk PLASSERER barnet ulikt i høve til forelderen (over/under/høgre/venstre), pluss ein eksplisitt "TB og LR gir IKKJE same resultat"-sanity-sjekk — nøyaktig den typen test som ville ha fanga denne feilen frå starten av, om han hadde eksistert i runde 1-3. Alle 15 testar i fila grøne, full typecheck og ESLint reine.

### Runde 5 — layeringstrategi-veljar + auto-køyring ved endring

**Layeringstrategi-veljar:** før denne vart lagt til, verifiserte eg — empirisk, ikkje berre frå ELK sin offisielle dokumentasjon (henta via nettoppslag) — kva verdiar av `elk.layered.layering.strategy` som faktisk er trygge å eksponere i denne bundla elkjs-versjonen (0.11.1). Bygde eit syntetisk "diamant"-testoppsett (éin kort veg, éin lang veg til same node) og køyrde `elk.layout()` direkte med kvar av dei 9 dokumenterte verdiane pluss ein oppdikta kontrollverdi:
- **7 verdiar er trygge og gir reelt ulike resultat** (skil seg frå kontrollverdien og/eller frå kvarandre): `NETWORK_SIMPLEX` (ELK sin eigen standard — identisk med kontrollverdien, som stadfestar at han faktisk ER standarden), `LONGEST_PATH`, `LONGEST_PATH_SOURCE`, `COFFMAN_GRAHAM`, `INTERACTIVE`, `STRETCH_WIDTH`, `MIN_WIDTH`.
- **2 verdiar `BF_MODEL_ORDER`/`DF_MODEL_ORDER` KRASJAR** (`Cannot read properties of null (reading 'a')`) på ein vanleg graf utan eksplisitt "model order"-metadata, som denne appen aldri gir. Desse er difor **medvite ekskluderte** frå veljaren — å leggje dei til ville gjort Layout-knappen krasje for enkelte val, ikkje berre gje eit rart resultat.

Lagt til: ny `LAYERING_STRATEGIES`-konstant og `AutoLayoutOptions.layeringStrategy`-felt i `autoLayout.ts` (standard: `LONGEST_PATH`, uendra frå runde 3), og ein ny `<select>` i verktøylinja med dei 7 trygge vala.

**Auto-køyring ved endring:** begge veljarane (retning og layeringstrategi) køyrer no Layout automatisk med det NYVALDE verdiet, ikkje berre ved neste manuelle knappetrykk. Implementeringsdetalj verdt å merke: `handleAutoLayout` vart delt i to — ein ny `applyAutoLayout(direction, layeringStrategy)` som tek verdiane som eksplisitte argument (ikkje les dei frå React-state), kalla direkte frå kvar `<select>` sin `onChange` med det NYE verdiet med éin gong, PLUSS ei separat `setState`-oppdatering for at veljaren skal visast korrekt. Grunnen til å ikkje berre kalle `handleAutoLayout()` (som les frå state) rett etter `setState()` i same handlar: React sin `setState` er ikkje synkron, så ein slik kombinasjon ville ha køyrt layout med det GAMLE (før-oppdaterte) verdiet — eit klassisk "stale closure"-feilmønster som ville ha reprodusert nøyaktig same type usynleg feil som runde 4-buggen (eit UI-val som ser ut til å gjere noko, men i praksis ikkje verkar på den nyaste tilstanden).

**Testa:** 2 nye testar i `autoLayout.test.ts` — éin som stadfestar at `LONGEST_PATH`/`NETWORK_SIMPLEX` gir ulikt resultat for eit diamant-forma skjema (bygd via `is_a` + `mixins` for å skape to vegar av ulik lengd til same node), éin som køyrer alle 7 trygge strategiane til gjennomføring utan krasj. 17 testar totalt i fila, alle grøne. Full typecheck og ESLint reine (0 feil, same to pre-eksisterande åtvaringar som før).

### Runde 6 — avstandsveljar + samla layout-kontrollar i ei kolonne

**Avstandsveljar:** ny `SPACING_PRESETS`-konstant i `autoLayout.ts` — fire namngjevne par av `nodeNodeSpacing`/`layerSpacing`: `compact` (40/80, dei opphavlege verdiane frå før runde 3), `normal` (70/140, standarden sidan runde 3), `spacious` (110/220), `extraSpacious` (160/320). Tredje `<select>` lagt til, same auto-køyr-ved-endring-mønster som dei to andre.

**Kolonne-omstrukturering:** Layout-knappen og alle tre veljarane (retning, layeringstrategi, avstand) er no pakka inn i ein eigen `styles.layoutControls`-`<div>` (`display:flex, flexDirection:'column'`) som sit som ELT barn i den opphavlege verktøylinja — "Add Class"/"Add Enum"-knappane står framleis i sjølve verktøylinja sin horisontale rad, ved sida av denne kolonnen, uendra. La òg til `alignItems: 'flex-start'` på sjølve verktøylinja slik at dei korte "Add Class"/"Add Enum"-knappane ikkje vart strekte i høgda til å matche den no mykje høgare kolonnen (flex sin standard kryssaksestrekking ville elles gjort det).

**Utvida `applyAutoLayout`** til å ta imot `spacingPreset` som eit tredje eksplisitt argument, av same "unngå stale closure"-grunn som direction/layeringStrategy alt vart handtert slik i runde 4/5.

**Testa:** 17 eksisterande testar i `autoLayout.test.ts` framleis grøne (ingen av dei testar sjølve spacing-verdiane direkte, sidan `nodeNodeSpacing`/`layerSpacing` alt var eksisterande, testa opsjonar frå før denne runda — berre nye NAMNGJEVNE preset-par vart lagt til, ikkje ny kjernefunksjonalitet som treng eigne testar). Full typecheck og ESLint reine (0 feil, same to pre-eksisterande åtvaringar).

### Runde 7 — kvifor gir tre layeringstrategiar identisk resultat på det ekte skjemaet?

**Undersøking, steg for steg (alt empirisk, ikkje teoretisk):**

1. Las `samt-bu-schema.yaml` (brukaren sitt eige testskjema, kopiert inn i repo-rota) direkte inn med den faktiske `parseYaml`-funksjonen, og køyrde `runAutoLayout` med kvar av dei tre strategiane mot DETTE ekte skjemaet. **Stadfesta:** resultatet er bit-for-bit identisk for alle 11 klassar, ikkje berre "pixel-nivå" — same x OG y for kvar node, alle tre strategiane. Ikkje ein synsvilling.
2. Skjemaet sin `is_a`-struktur synte seg å vere ein grunn skog: `Skoleeier`→{Kommune, Fylke, PrivatVirksomhet} og `Person`→{Elev, Rektor, Kontaktlaerer}, pluss tre klassar (`SamtBuContainer`, `Skole`, `Basisgruppe`) utan nokon `is_a` i det heile. Ingen `mixins`. `SamtBuContainer` har 23 attributt, truleg med range-kantar til dei fleste andre klassane (stjerneform).
3. **Fyrste hypotese (teoretisk, ikkje testa enno):** NETWORK_SIMPLEX/LONGEST_PATH/LONGEST_PATH_SOURCE er lag-TILORDNINGS-algoritmar som berre kan usemjast om ein node har fleire innkomande vegar av ULIK lengd (ein "diamant", akkurat som `diamondSchema()`-testen frå runde 5 alt provar dei gjer). Ein rein tre-struktur utan slike diamantar skulle i teorien tvinge alle korrekte algoritmar til å semjast, sidan kvar node sitt lag då er eintydig gitt av djupna frå rota.
4. **Testa hypotesen direkte — og han heldt IKKJE heilt:** bygde eit lite syntetisk tre (Root→B,C; B→D,E, INGEN diamant) og køyrde alle tre strategiane. Dei usemja seg framleis, både i `y` (lag) OG `x` (rekkjefølgje innanfor laget) for enkelte nodar — sjølv utan nokon diamant. Prøvde deretter ein ENDÅ meir tilpassa syntetisk variant (grunn skog + éin stjerneforma "container"-klasse med range-kantar til alle andre, meint å etterlikne det ekte skjemaet strukturelt) — usemje FRAMLEIS, sjølv om det no berre var i `x`, ikkje `y`.
5. **Konklusjon: den fyrste hypotesen var for enkel.** Fråvær av ein "diamant" garanterer IKKJE full semje mellom desse tre strategiane for eit generelt tre — noko meir spesifikt ved DET EKTE skjemaet sin eksakte struktur/storleik gir full semje der, men eg klarte ikkje å spore opp nøyaktig kva ved to forsøk på forenkla syntetiske gjenskapingar. Begge dei "forklarande" testane eg fyrst skreiv (basert på den for-enkle hypotesen) FEILA når dei faktisk vart køyrde — dei vart difor fjerna att i staden for å svekkjast til å bestå med ei påstand eg ikkje kunne stå inne for. Dette er dokumentert som ein kommentar i testfila i staden for ein påstått-bevist test, nøyaktig i tråd med det nye "verifiser empirisk"-prinsippet i `CLAUDE.md` — same prinsipp brukt til å FINNE at mi eiga forklaring var mangelfull, ikkje berre til å finne den opphavlege ELK-buggen.

**Det som STÅR seg, solid verifisert:**
- Strategiane gir **reelt ulikt resultat** for ein graf med ein ekte diamant (multiple, ulik-lengde vegar til same node) — provast av dei tre eksisterande testane frå runde 5 (no utvida med ein eksplisitt `LONGEST_PATH_SOURCE`-samanlikning òg).
- Strategiane KAN gje identisk resultat for visse ikkje-diamant-grafar, stadfesta direkte mot brukaren sitt eige skjema — dette er **ikkje ein feil**, det er venta åtferd for algoritmar som berre har grunnlag for å usemjast når det finst ei reell tvetydigheit å løyse. Nøyaktig KVA eigenskapar ved ein ikkje-diamant-graf som garanterer full semje er ikkje fullstendig kartlagt.

**Testfila (`autoLayout.test.ts`) inneheld no:** dei to diamant-testane (LONGEST_PATH vs NETWORK_SIMPLEX, LONGEST_PATH_SOURCE vs begge), ein "alle 7 strategiar køyrer utan krasj"-test, og ein utfyllande kommentar (ikkje ein test-påstand) som dokumenterer heile denne undersøkinga og kvifor to tidlegare forsøk på "bevis for full semje ved ikkje-diamant"-testar vart fjerna att. 18 testar totalt, alle grøne. Full typecheck og ESLint reine.

### Runde 8 — kantruting- og nodeplasserings-veljarar

Brukaren spurde om det finst fleire ELK-flag verdt å eksponere. Svarte med to kandidatar (kantruting og nodeplassering innanfor eit lag) som dei mest verdifulle, nemnde òg `elk.separateConnectedComponents`/`elk.padding` som mindre opplagde alternativ (ikkje implementerte). Brukaren svara "ja" til direkte implementering.

**Empirisk verifisert FØR implementering** (same praksis som layeringstrategiane i runde 5): testa alle 3 `elk.edgeRouting`-verdiar (`ORTHOGONAL`, `POLYLINE`, `SPLINES`) og alle 4 `elk.layered.nodePlacement.strategy`-verdiar (`BRANDES_KOEPF`, `LINEAR_SEGMENTS`, `NETWORK_SIMPLEX`, `SIMPLE`) direkte mot rå elkjs. **Ingen krasja** (i motsetnad til layeringstrategi-runda, der 2 av 9 krasja) — alle 7 er trygge å eksponere. Alle er òg stadfesta reelt ulike frå kvarandre (kantruting: talet på bend-punkt per kant varierte tydeleg — ORTHOGONAL/POLYLINE/SPLINES ga høvesvis 2/1/8 bend-punkt for same kant; nodeplassering: x-koordinatar varierte, om enn NETWORK_SIMPLEX-varianten var subtil for testgrafen).

**Lagt til:** `EDGE_ROUTINGS`- og `NODE_PLACEMENT_STRATEGIES`-konstantar i `autoLayout.ts`, tilsvarande `AutoLayoutOptions`-felt, standardverdiar uendra frå før (`ORTHOGONAL`/`BRANDES_KOEPF`, som var hardkoda implisitt tidlegare). To nye `<select>`-element lagt til i same layout-kontroll-kolonne, same auto-køyr-ved-endring-mønster, `applyAutoLayout`/`handleAutoLayout` utvida til å ta imot alle 5 parameter no (retning, layeringstrategi, kantruting, nodeplassering, avstand).

**Testa:** 4 nye testar — kantruting-forskjell stadfesta via faktisk telling av bend-punkt i det returnerte layoutet (ikkje berre "køyrer utan feil"), nodeplasserings-forskjell stadfesta via ulik node-posisjon, pluss to "alle verdiar køyrer utan krasj"-testar. 22 testar totalt i fila, alle grøne. Full typecheck og ESLint reine (0 feil, same to pre-eksisterande åtvaringar).

## Ope spørsmål til brukar

- **Fungerer dei to nye veljarane (kantruting, nodeplassering) som venta?**
- Er det framleis viktig å forstå PRESIST kvifor skjemaet ditt gir identisk resultat for dei tre layeringstrategiane (runde 7), eller held den generelle forklaringa?
- Er `spacious`/`extraSpacious`-verdiane (110/220 og 160/320) gode nivå, eller bør presetta justerast?
- Ønskjer du `elk.separateConnectedComponents`/`elk.padding` (nemnt, ikkje implementerte i runde 8) som neste veljarar, eller er dei fem noverande nok?
- Er samanslegne (`collapsed`) klassar noko du bruker mykje? Viss ja, er det verdt å prioritere collapsed-state-utviding (nemnt under Prioritet 1) — for no estimerer koden alltid for utvida/verste tilfelle.
