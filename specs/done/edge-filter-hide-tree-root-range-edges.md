# Spec: Ny EDGE FILTERS-veljar — skjul range-kantar knytta til `tree_root`-klassar

Status: **Implementert og verifisert (runde 3).** Sjå "Implementasjonsstatus" nedst.
Dato: 2026-09-14

Ønske (ordrett): "Ny velgar i Display panelet under EDGE FILTERS gruppa som lar deg filtrere bort range kantar knytta til tree_root klassen. Denne klassen er ikkje ein del av sjølve datamodellen, men kun ein linkml-teknisk klasse for serialisering, så det er fint å kunne velge å ikkje vise kantar knytta til akkurat denne klassen. Det er fint om dette flagget tas hensyn til ved kalkulering av layout."

## Kvifor dette er relevant no

Brukaren sitt eige testskjema, `samt-bu-schema.yaml` (repo-rota), har nøyaktig denne situasjonen:

```yaml
classes:
  SamtBuContainer:
    description: Containerklasse for alle klasser som kan inngå i datasettet.
    tree_root: true
    attributes:
      kontaktpunkter:
        range: Kontaktopplysning
      utgivere:
        range: Aktoer
      organisasjoner:
        range: Aktoer
      gjeldende_lovgivninger:
        range: RegulativRessurs
      datasettdistribusjoner:
        range: Distribusjon
      # ... fleire attributt, alle med range til andre klassar
```

`SamtBuContainer` er nettopp den "eine ekstra breie container-klassen" som alt er identifisert i `specs/backlog/canvas-layout-topdown.md` (Runde 2 og Runde 7) som ei stjerneforma kjelde til mange range-kantar og kryssande strekar — fordi han (som `tree_root`-klasse) har attributt som range'ar til nesten alle andre klassar i skjemaet, men ikkje representerer noko reelt domenekonsept. Denne nye veljaren adresserer altså direkte eit alt dokumentert problem, ikkje eit nytt.

## Funn i koden (grunnlag for forslaget)

### 1. `tree_root` er alt fullstendig modellert — ingen ny felttype trengst

- TS-modell: `treeRoot?: boolean` på `ClassDefinition`, `packages/core/src/model/index.ts:90`.
- YAML-lesing: `packages/core/src/io/yaml.ts:220` — `if (raw['tree_root'] !== undefined) cls.treeRoot = Boolean(raw['tree_root']);` (nøkkelen er òg med i lista over kjende klasse-nøklar, `yaml.ts:71`).
- YAML-skriving: `packages/core/src/io/yaml.ts:497`.
- Eigenskapspanel: avkryssingsboks i `packages/core/src/editor/PropertiesPanel/ClassPanel.tsx:188`.
- **Ikkje** brukt nokon stad i `deriveGraph.ts`, `autoLayout.ts`, `ClassNode.tsx` eller `DisplayPanel.tsx` i dag — denne funksjonen byggjer på eit alt-typa felt, ikkje eit nytt.

### 2. EDGE FILTERS-gruppa i `DisplayPanel.tsx` — eksisterande mønster

Seksjonen finst alt (`packages/core/src/editor/DisplayPanel.tsx:223-248`), bygd frå ein konstant-array:

```tsx
// DisplayPanel.tsx:33-38
const EDGE_TOGGLE_DEFS = [
  { type: 'range',    label: 'range',    color: 'var(--color-state-success)' },
  { type: 'is_a',     label: 'is_a',     color: 'var(--color-accent-hover)' },
  { type: 'mixin',    label: 'mixin',    color: 'var(--color-edge-mixin)' },
  { type: 'union_of', label: 'union_of', color: 'var(--color-edge-union)' },
] as const;
```

Kvar av desse fire er ein knapp som toggle'ar medlemskap i eit generisk `Set<string>` (`hiddenEdgeTypes`, UI-slice: `packages/core/src/store/slices/uiSlice.ts:101`), muterast via `toggleEdgeTypeVisibility(type)` (`uiSlice.ts:204-212`), persistert til `localStorage` under nøkkelen `linkml-editor-hidden-edge-types` (`uiSlice.ts:14`).

**Viktig:** dette settet representerer *edge-typar* (`range`/`is_a`/`mixin`/`union_of`), ikkje eit filter på *kva klasse ein kant er knytta til*. Den nye funksjonen er strukturelt annleis — han skal skjule ei delmengd av `range`-kantar basert på ein eigenskap ved endepunkt-klassen (`treeRoot === true`), ikkje heile edge-typen. Å presse dette inn i det same `Set<string>`-et (t.d. ein syntetisk verdi som `'range_tree_root'`) ville krevd særhandsaming likevel og gjere semantikken til `hiddenEdgeTypes` utydeleg. **Forslag:** eiga, enkel boolsk state-variabel, same mønster som `tableModeEnabled` (`uiSlice.ts:18,45-51`) — ikkje eit nytt medlem i `hiddenEdgeTypes`-settet.

### 3. `deriveGraph.ts` — kor range-kantar vert bygde (rendring)

`packages/core/src/canvas/deriveGraph.ts`, signatur `deriveGraph(schema, layout, collapsed, importedEntities, allSchemaSlots, hiddenEdgeTypes, rangeEdgesMode)` (`deriveGraph.ts:135-143`).

Range-kantar vert bygde tre stader, alle gata av `!hiddenEdgeTypes.has('range') && rangeEdgesMode === 'show'`:
- Frå inline `attributes` (eigne slots): `deriveGraph.ts:253-282`.
- Frå skjema-nivå `slots`-referansar (med `slot_usage`-overstyring): `deriveGraph.ts:284-316`.
- Speglingsblokk for kantar til importerte/"spøkelses"-nodar: `deriveGraph.ts:402-463`.

Kvar av desse har direkte tilgang til både kjelde-klassenamnet (`className`) og mål-klassenamnet (`slot.range`), så eit sjekk av `schema.classes[className]?.treeRoot` og `schema.classes[slot.range]?.treeRoot` er billig å leggje til her.

### 4. `autoLayout.ts` — kor range-kantar vert bygde (layout)

`runAutoLayout(schema, opts, ghostEntities, hiddenEdgeTypes)` (signatur `autoLayout.ts:185-190`) re-utleier kantane sine EIGE, uavhengig av `deriveGraph` sine (ikkje konsumerer det ferdig-filtrerte resultatet). Range-kantar til layout: `autoLayout.ts:262-273`, med denne eksisterande kommentaren rett over (`autoLayout.ts:257-261`):

```ts
// range edges always feed the layout, regardless of rangeEdgesMode --
// that setting only controls whether they're drawn as edges vs. inline
// chips on the canvas (see deriveGraph.ts). Without them in the layout
// graph, classes connected only by range (not is_a/mixin) get no
// hierarchical placement at all, which reads as scattered/undirected.
```

Dette er presedens for at `hiddenEdgeTypes` alt vert tredd inn i BÅDE `deriveGraph()` og `runAutoLayout()` separat (tre kallstader i `SchemaCanvas.tsx`: linje 481-482 for `deriveGraph`, linje 497/528/575-586 for `runAutoLayout`) — brukaren sitt eksplisitte ønske om at det nye flagget skal "takast hensyn til ved kalkulering av layout" følgjer altså same, alt etablerte mønster, i motsetnad til `rangeEdgesMode`/`globalRangeEdgesMode` som **medvite** IKKJE vert sendt til `runAutoLayout` i det heile (den styrer berre teikne-val, ikkje layout).

**Merk (eksisterande asymmetri, ikkje i scope for denne spec-en):** `runAutoLayout` sin range-kant-løkke (`autoLayout.ts:262-273`) itererer berre `classDef.attributes`, IKKJE skjema-nivå `slots`-referansane som `deriveGraph.ts:284-316` òg dekkjer. Denne nye funksjonen bør følgje same avgrensing som resten av `autoLayout.ts` gjer i dag (berre `attributes`) for konsistens, ikkje prøve å rette denne pre-eksisterande skilnaden i same omgang.

### 5. Per-vise-overstyring finst som type, men er ikkje kopla til noko

`EdgeFilterSet.hiddenTypes?: string[]` (`packages/core/src/io/editorManifest.ts:35-39`, del av `ViewDefinition.edgeFilters`) er definert, men vert **ikkje lese nokon stad** i dag — berre `EdgeFilterSet.rangeEdges` er faktisk kopla opp (`DisplayPanel.tsx:86`, `SchemaCanvas.tsx:466-469`). Det finst altså ikkje noko fungerande per-vise-overstyring for boolske edge-filter i dag, sjølv om typen antyder det. **Forslag:** ikkje byggje per-vise-overstyring for dette flagget i v1 — behald det som ein enkel global boolsk (same nivå som `hiddenEdgeTypes`/`tableModeEnabled` faktisk fungerer i dag), sidan å byggje på det ukopla `hiddenTypes`-feltet ville vore å byggje vidare på noko som alt er dokumentert som ikkje-fungerande.

## Forslag til design

### Ny state (UI-slice, `uiSlice.ts`)

```ts
const HIDE_TREE_ROOT_RANGE_EDGES_KEY = 'linkml-editor-hide-tree-root-range-edges';

function loadHideTreeRootRangeEdges(): boolean {
  try {
    const raw = localStorage.getItem(HIDE_TREE_ROOT_RANGE_EDGES_KEY);
    if (raw !== null) return JSON.parse(raw) === true;
  } catch { /* ignore */ }
  return true; // på som standard — sjå "Svar frå brukar (runde 2)" punkt 3
}
```

— same mønster som `loadTableModeEnabled`/`TABLE_MODE_ENABLED_KEY` (`uiSlice.ts:18,45-51`), men med **standardverdi `true`** (avgjort i runde 2 — sjå nedst i dokumentet). Dette skil han frå `hiddenEdgeTypes`/`tableModeEnabled`, som begge har uendra/av-standard. Praktisk konsekvens: alle brukarar som opnar eit skjema med ein `tree_root`-klasse ser med det same færre kryssande range-kantar (adresserer det alt-dokumenterte stjerneform-problemet frå `canvas-layout-topdown.md`) utan å måtte oppdage/slå på veljaren sjølv — men det betyr òg at dette er den einaste av dei fem EDGE FILTERS-kontrollane som endrar standard-utsjånaden på eksisterande, alt-opna prosjekt (via `localStorage`, som er delt per nettlesar/maskin, ikkje per prosjekt) med det same funksjonen vert utrulla. Nytt felt `hideTreeRootRangeEdges: boolean` i store-typen, ny setter `setHideTreeRootRangeEdges(value: boolean)`.

### Filtreringslogikk

I både `deriveGraph.ts` (dei tre stadene i punkt 3 over) og `autoLayout.ts` (punkt 4 over), legg til éin ekstra betingelse ved sida av den eksisterande `!hiddenEdgeTypes.has('range')`-sjekken. **Berre kjelda** (`className`) vert sjekka, ikkje målet — avgjort i runde 2 (sjå nedst): `tree_root`-klassen har containerens EIGNE attributt som peiker UT, ikkje omvendt, så eit sjekk av målet ville aldri treffe i praksis og er unødvendig kompleksitet:

```ts
if (hideTreeRootRangeEdges && schema.classes[className]?.treeRoot === true) continue;
```

For speglingsblokka for importerte/"spøkelses"-nodar (`deriveGraph.ts:402-463`, kantar der MÅLET er ein importert/ghost-node): kjelda (`className`) er alltid ein lokal klasse der, så same, enkle sjekk mot `schema.classes[className]?.treeRoot` dekkjer den blokka òg — ingen eigen sjekk mot `entity.schema` trengst, sidan me no berre ser på kjelda.

### UI i `DisplayPanel.tsx`

Lagt til i den eksisterande "Edge Filters"-seksjonen (`DisplayPanel.tsx:223-248`), t.d. som ein eigen knapp/kontroll rett under/etter dei fire `EDGE_TOGGLE_DEFS`-knappane, følgjer same visuelle stil (`styles.toggleBtn`, dimma/gjennomstroken når aktivert-tilstanden skjuler kantar — akkurat som dei fire eksisterande):

```tsx
<button
  id="lme-display-toggle-tree-root-range"
  style={{
    ...styles.toggleBtn,
    borderColor: hideTreeRootRangeEdges ? 'var(--color-fg-muted)' : 'var(--color-state-success)',
    color: hideTreeRootRangeEdges ? 'var(--color-fg-muted)' : 'var(--color-state-success)',
    opacity: hideTreeRootRangeEdges ? 0.5 : 1,
  }}
  onClick={() => setHideTreeRootRangeEdges(!hideTreeRootRangeEdges)}
  title="Hide range edges connected to tree_root classes (LinkML serialization-only container classes, not part of the domain model)"
>
  tree_root range
</button>
```

Knappe-etiketten `"tree_root range"` er stadfesta av brukaren i runde 2 (sjå nedst). Sidan `tree_root` er eit LinkML-fagomgrep som ikkje alle brukarar kjenner igjen, er `title`-tooltipen (forklaringa brukaren sjølv gav) viktig å ta med, ikkje berre ei kort knappe-etikett.

### Wiring (kallstader)

- `SchemaCanvas.tsx:481-482` — legg `hideTreeRootRangeEdges` til `deriveGraph(...)`-kallet.
- `SchemaCanvas.tsx:497`, `:528`, `:575-586` — legg `hideTreeRootRangeEdges` til alle tre `runAutoLayout(...)`-kalla, som eit nytt (5.) parameter etter `hiddenEdgeTypes`.
- `DisplayPanel.tsx` — les/set via `useAppStore`, same mønster som `hiddenEdgeTypes`/`toggleEdgeTypeVisibility`.

## Testcase / akseptansekriterium

1. Opne `samt-bu-schema.yaml` (eller eit tilsvarande syntetisk testskjema med éin `tree_root: true`-klasse med fleire range-attributt) i eit prosjekt/nettlesar utan tidlegare lagra verdi for denne veljaren. **Forventa (standard PÅ, runde 2):** alle range-kantar UT FRÅ `SamtBuContainer` er skjulte frå canvaset med det same, utan at brukaren treng gjere noko — range-kantar mellom andre klassepar (utan `tree_root`-involvering) er uendra synlege.
2. Layout ved opning/auto-layout. **Forventa:** dei skjulte range-kantane påverkar IKKJE node-plasseringa — dei andre klassane skal kunne plassere seg friare enn viss containerklassen sine range-kantar hadde vore med (samanlikna med å slå veljaren AV, sjå punkt 3).
3. Slå AV veljaren i EDGE FILTERS. **Forventa:** dei tidlegare skjulte range-kantane frå `SamtBuContainer` kjem tilbake; eit nytt Layout-trykk gir dei att innverknad på node-plasseringa (attende til åtferda frå før denne funksjonen fanst).
4. Slå PÅ veljaren att. **Forventa:** tilbake til tilstanden i punkt 1/2 — ingen datatap undervegs (dette er eit reint vise-/layout-filter, ikkje ei endring av sjølve skjemaet).
5. Ny einingstest i `packages/core/src/canvas/__tests__/deriveGraph.test.ts` (viss ho finst; elles ny fil) og `autoLayout.test.ts`: bygg eit syntetisk skjema med ein `treeRoot: true`-klasse som har range-attributt til to andre klassar, stadfest at kantane er borte frå både `deriveGraph()`-resultatet OG `runAutoLayout()` sin edge-liste (kan verifiserast indirekte via at layout-resultatet for eit skjema MED vs UTAN denne containerklassen sine range-kantar inkludert gir ulik plassering av dei andre nodane) når flagget er sett.

## Svar frå brukar (runde 2, 2026-09-14)

1. **Knappe-etikett:** `"tree_root range"` — stadfesta som skildra i "UI i `DisplayPanel.tsx`" over.
2. **Retning:** berre KJELDA vert sjekka, ikkje målet — "tree_root klassen har kontainerens EIGNE attributt som peiker UT ikkje omvendt". `Forslag til design`/`Filtreringslogikk` over er oppdatert til denne enklare, eitt-vegs sjekken (allereie retta i dette dokumentet — sjå over, det fanst tidlegare eit forslag om å sjekke begge endepunkt, no forkasta).
3. **Standardverdi:** PÅ. `loadHideTreeRootRangeEdges()` over er oppdatert til å returnere `true` når det ikkje finst nokon lagra verdi enno.
4. **Kanttype:** kun `range` — ingen utviding til `is_a`/`mixin`/`union_of` for `tree_root`-klassar.

Alle fire punkt er no reflekterte i sjølve designet over (state-standardverdi, filtreringslogikk, knappetekst).

## Runde 3 (2026-09-14) — implementert

Brukaren skreiv "utfør specen" — eksplisitt godkjenning til å implementere, jf. CLAUDE.md.

**Implementert, nøyaktig som skildra i "Forslag til design" over:**
- `uiSlice.ts`: `HIDE_TREE_ROOT_RANGE_EDGES_KEY`, `loadHideTreeRootRangeEdges()` (standard `true`), `hideTreeRootRangeEdges`-felt og `setHideTreeRootRangeEdges()`-setter — same mønster som `tableModeEnabled`.
- `deriveGraph.ts`: nytt 8. parameter `hideTreeRootRangeEdges = false`. Begge range-kant-blokkene inni hovudløkka (eigne attributt + skjema-nivå slots, som deler éin `if`) og range-kant-blokka i speglingsblokka for importerte/ghost-mål har no `&& !(hideTreeRootRangeEdges && classDef.treeRoot)` lagt til ved sida av dei eksisterande gatene. Berre KJELDA (`classDef` for klassen løkka held på) vert sjekka, som avgjort i runde 2.
- `autoLayout.ts`: nytt 5. parameter `hideTreeRootRangeEdges = false` på `runAutoLayout()`. Same eittvegs kjelde-sjekk lagt til i range-kant-løkka (`autoLayout.ts:262`).
- `DisplayPanel.tsx`: ny knapp `"tree_root range"` i EDGE FILTERS-seksjonen, rett etter dei fire `EDGE_TOGGLE_DEFS`-knappane, med `title`-tooltip som forklarer `tree_root`-omgrepet.
- `SchemaCanvas.tsx`: `hideTreeRootRangeEdges` lese frå store og tredd inn i alle fire kallstadene (éin `deriveGraph`, tre `runAutoLayout`), med tilsvarande `useMemo`/`useCallback`-avhengigheiter oppdatert.

**Empirisk verifisert FØR testane vart skrivne** (jf. CLAUDE.md sitt "verifiser empirisk, ikkje berre les kode"-prinsipp — same praksis som resten av `canvas-layout-topdown.md`): eit mellombels debug-testskript (`_debug-treeroot.test.ts`, køyrt éin gong, sletta etterpå) stadfesta faktisk ELK-åtferd for eit syntetisk skjema (`Container` med `tree_root: true` og range til `A`; separat `B` med range til `C`):
- MED flagget PÅ: `A` hamnar på **same lag** som `Container` (`y: 12` for begge) — kanten er heilt borte frå layout-grafen.
- MED flagget AV (og ved utelaten parameter, som stadfesta bruker standardverdien `false`): `A` hamnar **under** `Container` (`y: 272` vs `12`) — uendra frå før denne endringa.
- `B → C` er upåverka av flagget i begge tilfelle (`C` alltid under `B`), sidan `B` ikkje er `tree_root`.

**Testar lagt til:**
- `packages/core/src/__tests__/edgeAttributes.test.ts` — ny `describe('deriveGraph hideTreeRootRangeEdges')` med 3 testar: kantar frå tree_root-klassen er med som standard (flagg av), vert fjerna når flagget er på (medan ei ikkje-tree_root range-kant, `Tag → Item`, held fram uendra), og at ikkje-range-kanttypar er upåverka.
- `packages/core/src/canvas/__tests__/autoLayout.test.ts` — ny `describe('runAutoLayout hideTreeRootRangeEdges')` med 2 testar: same lags-plassering-skilnad som vart empirisk stadfesta over, pluss ein test som stadfestar at utelaten parameter gir identisk resultat som eksplisitt `false` (bakoverkompatibilitet for alle eksisterande kallstader/testar som ikkje sender parameteret).

**Verifisert:**
- Dei to nye testfilene direkte: 63/63 testar grøne (`autoLayout.test.ts` 25, `edgeAttributes.test.ts` 38).
- Full typecheck av `packages/core` (`tsc --noEmit`): rein, ingen feil.
- ESLint på alle 7 endra filene: 0 feil. 2 åtvaringar i `SchemaCanvas.tsx` (`react-hooks/exhaustive-deps` for `subsetLayouts`/`views` og for `hiddenEdgeTypes`) — stadfesta pre-eksisterande (dei står på liner denne endringa berre la `hideTreeRootRangeEdges` til i, ikkje på liner denne endringa oppretta), same to åtvaringar som alt dokumentert i `canvas-layout-topdown.md` runde 3/9b.
- Full `packages/core`-testpakke via `pnpm --filter @linkml-editor/core test`: 626/628 testar grøne, 2 todo, 5 feil — alle 5 er den alt-dokumenterte `[vitest-pool-runner]: Timeout waiting for worker to respond`-infrastrukturflaksen (jf. CLAUDE.md sin container-instruks, som viser seg å opptre likt på denne native, ikkje-relokerte installasjonen òg) på **fem filer denne endringa ikkje rører** (`acceptance.test.ts`, `useTheme.test.ts`, `viewsSlice.test.ts`, `editorManifestViews.test.ts`, `tours.test.ts`) — ikkje ein regresjon frå denne endringa.

**Ikkje verifisert manuelt i nettlesar** (ingen dev-server/browser-tilgang i denne økta) — knappen sin visuelle plassering/styling i EDGE FILTERS-seksjonen og faktisk klikk-åtferd i UI-et bør stadfestast ved neste `pnpm dev`-økt eller rebygg/redeploy, i tråd med praksisen frå `canvas-layout-topdown.md` (brukaren stadfesta kvar runde etter faktisk rebygg/redeploy der òg).
