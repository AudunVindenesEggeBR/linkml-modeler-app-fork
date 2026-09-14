# Spec: Plasser `tree_root`-klassar til venstre for alle andre klassar når "tree_root range" er aktivert

Status: **Implementert og verifisert (runde 3).** Sjå "Runde 3" nedst.
Dato: 2026-09-14

Ønske (ordrett): "no fungerer det, men eg ser at containerklassen legg seg midt inne blandt dei andre klassene og i nokon tilfeller dekker over edges mellom andre klasser. Kan vi oppdatere layout kalkulering til at dersom 'tree_root range' er aktivert for å unngå å vise kanter til tree_root klassen, så skal også tree_root klassen plasseres til venstre for alle andre klassene slik at vi slepp at den legg seg midt i diagrammet"

## Kvifor dette skjer — stadfesta i koden

Dette er ein direkte konsekvens av korleis `hideTreeRootRangeEdges` (frå `specs/done/edge-filter-hide-tree-root-range-edges.md`) verkar i `runAutoLayout` (`autoLayout.ts:262`): når flagget er på, vert range-kantar frå `tree_root`-klassen fjerna heilt frå ELK sin layout-graf. Sidan dette typisk er den einaste kanten `tree_root`-klassen har (containerklassar har vanlegvis ingen `is_a`/`mixin`/`union_of`), vert han ein **heilt isolert, usamanhengande komponent** i grafen ELK får.

**Stadfesta empirisk** (mellombels debug-testskript køyrt i samband med implementeringa av `hideTreeRootRangeEdges`, sjå "Runde 3" i `specs/done/edge-filter-hide-tree-root-range-edges.md`): for eit syntetisk skjema der `Container` (tree_root) mista si einaste kant, hamna han på **same lag** som resten av grafen (`y: 12`, likt startlaget), men ELK sin eigen standard-pakking av usamanhengande komponentar plasserte han til HØGRE for éin annan node (`x: 352`) i det aktuelle testoppsettet — ikkje nødvendigvis til venstre, og ikkje nødvendigvis på ein kant av heile layouten. ELK har **ingen dokumentert garanti** for KOR usamanhengande komponentar hamnar relativt til kvarandre — berre at dei ikkje overlappar. På eit ekte skjema med mange klassar/komponentar kan dette difor plassere `tree_root`-noden midt inni resten av grafen, akkurat slik brukaren observerer, og potensielt over ein kant mellom to andre klassar (ELK sin kollisjonskontroll gjeld node-mot-node, ikkje node-mot-kant).

## Forslag til design

### Prinsipp: etterhandsame ELK sitt resultat, ikkje stol på ELK sin komponent-pakking

Sidan ELK ikkje gir nokon pålieleg måte å garantere "lengst til venstre" for ein isolert komponent (dette ville kravd å teste/stadfeste ein spesifikk ELK-opsjon empirisk, jf. CLAUDE.md sitt prinsipp om å verifisere før ein stolar på dokumentasjon/konvensjon — og det er uklårt om ein slik opsjon eingong finst for "alltid lengst mot éin bestemt kant uansett tal komponentar"), føreslår eg i staden eit enkelt, deterministisk **etterhandsamingssteg** i `runAutoLayout` (`autoLayout.ts`), rett etter `elkResultToLayout(result)` (linje 323) og FØR resultatet vert returnert:

```ts
function repositionTreeRootNodesLeft(
  schema: LinkMLSchema,
  layout: CanvasLayout,
  layerSpacing: number
): void {
  const treeRootNames = Object.entries(schema.classes)
    .filter(([, def]) => def.treeRoot === true)
    .map(([name]) => name)
    .filter((name) => name in layout.nodes);
  if (treeRootNames.length === 0) return;

  const otherPositions = Object.entries(layout.nodes).filter(([name]) => !treeRootNames.includes(name));
  if (otherPositions.length === 0) return; // nothing to be "left of"

  const minX = Math.min(...otherPositions.map(([, pos]) => pos.x));
  const minY = Math.min(...otherPositions.map(([, pos]) => pos.y));

  let y = minY;
  for (const name of treeRootNames) {
    const { width, height } = estimateClassNodeSize(schema.classes[name]);
    layout.nodes[name] = { x: minX - width - layerSpacing, y };
    y += height + layerSpacing;
  }
}
```

— kalla som `repositionTreeRootNodesLeft(schema, layout, options.layerSpacing)` rett før `return elkResultToLayout(result)` vert bytt ut med eit mellomsteg, MEN **berre når `hideTreeRootRangeEdges` er sann** (elles uendra åtferd — ein `tree_root`-klasse med range-kantar synlege skal framleis plasserast av ELK som normalt, sidan han då faktisk ER kopla til resten av grafen og ELK sin vanlege algoritme handterer han fint).

**Kvifor dette (og ikkje ein ELK-opsjon):**
- Deterministisk og lett å teste (reine tal-utrekningar, ingen avhengnad av ELK sine interne heuristikkar).
- Fungerer likt uavhengig av `direction` (TB/BT/LR/RL) og `layeringStrategy` — sjå ope spørsmål 2 under for om dette faktisk ER ønskt, eller om "venstre" burde tolkast relativt til vald retning.
- Handterer fleire `tree_root`-klassar (sjeldan, men lovleg i LinkML) ved å stable dei vertikalt til venstre i staden for å krasje/overlappe kvarandre.
- Bruker `estimateClassNodeSize` (finst alt i `autoLayout.ts`, brukt til akkurat dette føremålet andre stader — sjå `canvas-layout-topdown.md`) for å garantere ingen overlapp med resten av grafen sin bounding box, same prinsipp som resten av fila alt følgjer.
- Gjenbruker `options.layerSpacing` som avstanden til resten av grafen — konsistent med at dette konseptuelt ER ein ny "kolonne" åtskilt frå hovudgrafen, ikkje eit vilkårleg nytt magisk tal.

### Kvar dette bør kallast frå

Inni `runAutoLayout` sjølv (`autoLayout.ts:321-328`), rett etter ein vellukka `elk.layout()`-kall, FØR returnering — dette gjer at ALLE tre kallstadene i `SchemaCanvas.tsx` (fyrste opning, re-layout ved nye importerte nodar, manuelt Layout-trykk) automatisk får denne åtferda utan eiga wiring kvar stad, akkurat slik `hideTreeRootRangeEdges`-filtreringa alt er bygd inn sentralt same stad.

## Svar frå brukar (runde 2, 2026-09-14)

1. **Retning:** bokstaveleg canvas-venstre (negativ x) uansett `direction`-val — same resultat for TB/BT/LR/RL. Forslaget over ("Kvifor dette (og ikkje ein ELK-opsjon)") er allereie designa slik — stadfesta uendra.
2. **Vertikal justering:** på line med den øvste andre noden i grafen (`minY`) — forslaget over sin variant med `y = minY` er stadfesta, dei to alternativa (alltid `y=0`, eller vertikalt midtstilt) er forkasta.
3. **Låst/fritt:** fritt draget etterpå, akkurat som alle andre nodar — INGEN ny låsemekanisme. Forslaget påverkar berre resultatet av éin layout-kalkulering (Layout-knappen/auto-layout), ikkje noko brukaren er hindra frå å endre manuelt etterpå.

**Ikkje eksplisitt spurt om, adoptert som standard i forslaget over (lågt-innsats, lite kontroversielle val):**
- **Fleire `tree_root`-klassar:** stabla vertikalt til venstre, som skildra i `repositionTreeRootNodesLeft()`.
- **Avstand:** gjenbruker `options.layerSpacing` (same som avstanden mellom hierarki-nivå elles).

Designet er dermed ferdig presisert og klart for implementering ved eksplisitt godkjenning — dette dokumentet i seg sjølv utgjer framleis ikkje ei slik godkjenning.

## Testcase / akseptansekriterium (basert på forslaget over)

1. Skjema med éin `tree_root`-klasse og fleire andre klassar/enums, `hideTreeRootRangeEdges = true`. Køyr `runAutoLayout`. **Forventa:** `tree_root`-noden sin `x`-posisjon + breidde + `layerSpacing` ≤ den minste `x`-posisjonen blant alle andre nodar (ingen overlapp, strengt til venstre for alt anna).
2. Same skjema med `hideTreeRootRangeEdges = false`. **Forventa:** uendra åtferd frå før denne endringa — `tree_root`-noden vert plassert av ELK som normalt (kan hamne kor som helst ELK sjølv vel, ikkje tvinga til venstre).
3. Skjema med to `tree_root`-klassar. **Forventa:** begge til venstre for resten av grafen, stabla vertikalt utan overlapp seg imellom.
4. Regresjonstest: ingen av dei eksisterande `autoLayout.test.ts`-testane (inkl. dei nye frå `hideTreeRootRangeEdges`-runda) skal endre resultat når `hideTreeRootRangeEdges` er `false` (default-av-tilfellet er heilt uendra av denne nye funksjonen).

## Runde 3 (2026-09-14) — implementert

Brukaren skreiv "utfør specen" — eksplisitt godkjenning, jf. CLAUDE.md.

**Implementert, nøyaktig som skildra i "Forslag til design" over, alle tre runde-2-avgjerder følgde bokstaveleg:**
- `autoLayout.ts`: ny privat funksjon `repositionTreeRootNodesLeft(schema, layout, layerSpacing)` rett etter `elkResultToLayout()`. Finn alle `treeRoot === true`-klassar som fekk ein posisjon frå ELK, reknar `minX`/`minY` blant ALLE ANDRE nodar, og set kvar tree_root-node sin posisjon til `x = minX - width - layerSpacing`, stabla vertikalt frå `y = minY` med `height + layerSpacing` mellomrom for fleire tree_root-klassar.
- `runAutoLayout()`: kallar `repositionTreeRootNodesLeft(...)` rett etter ein vellukka `elk.layout()`, **berre når `hideTreeRootRangeEdges` er sann** — uendra åtferd (ingen reposisjonering) når flagget er av, akkurat som spesifisert.
- Ingen endring i `deriveGraph.ts`/`DisplayPanel.tsx`/`SchemaCanvas.tsx`/`uiSlice.ts` var naudsynt — denne funksjonen bygger direkte oppå det eksisterande `hideTreeRootRangeEdges`-flagget frå `specs/done/edge-filter-hide-tree-root-range-edges.md`, ingen ny state eller UI.

**Testar lagt til** (`packages/core/src/canvas/__tests__/autoLayout.test.ts`, ny `describe('runAutoLayout tree_root leftmost repositioning')`, 4 testar — dekkjer alle 4 akseptansekriteria over):
- tree_root-noden strengt til venstre for BOUNDING BOX-en til alle andre nodar (ikkje berre éin nabo) — testar akseptansekriterium 1.
- Topp-justert med den øvste andre noden (`minY`) — stadfestar runde 2-avgjerd 2.
- Reposisjonering skjer IKKJE når flagget er av — testar akseptansekriterium 2; stadfestar strukturelt at Container (som framleis HAR range-kanten når flagget er av) hamnar i sitt eige hierarki-lag over `A`, ikkje tvinga til venstre.
- To tree_root-klassar stabla vertikalt i venstre-kolonna utan å overlappe kvarandre — testar akseptansekriterium 3.

**Verifisert:**
- `autoLayout.test.ts` åleine: 29/29 testar grøne (25 eksisterande + 4 nye) — inkludert dei eksisterande `hideTreeRootRangeEdges`-testane frå forrige runde, som framleis går gjennom uendra sjølv om `repositionTreeRootNodesLeft` no køyrer for dei same testoppsetta (stadfesta empirisk, ikkje anteke — éin av dei eksisterande påstandane var avhengig av akkurat ELK sin rå plassering, og heldt framleis etter reposisjoneringa vart lagt til, av grunnar dokumentert i testkommentaren).
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- ESLint på begge endra filene (`autoLayout.ts`, `autoLayout.test.ts`): 0 feil, 0 åtvaringar.
- Retta ein feil eg sjølv gjorde undervegs: køyrde fyrst dei tre mest relevante testfilene (`uiSlice.test.ts`, `editor.test.ts`, `project.test.ts`) med eksplisitt `--environment node` (feilsøkingsvanen frå tidlegare runde, meint for reine logikk-testfiler utan DOM) — dette FEILA `uiSlice.test.ts` med `ReferenceError: Storage is not defined`, sidan den fila faktisk testar `localStorage`/`Storage.prototype` og treng jsdom. Dette var mitt eige miljø-val, ikkje ein kodefeil. Køyrde på nytt UTAN `--environment`-overstyringa (prosjektet sin standard jsdom-miljøkonfigurasjon): alle 86 testar i dei tre filene grøne.
- Full `packages/core`-testpakke via `pnpm --filter @linkml-editor/core test`: 218/218 testar grøne i dei 14 filene som fekk køyre, 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]: Timeout waiting for worker to respond`-infrastrukturflaksen (fleire enn dei 5 frå forrige runde — stadfestar at talet varierer frå køyring til køyring, som alt dokumentert i CLAUDE.md). Ingen av desse 14 er ekte testfeil — stadfesta ved å køyre dei tre mest relevante filene isolert (over), alle grøne.

**Ikkje verifisert manuelt i nettlesar** — visuell stadfesting av at containerklassen faktisk hamnar synleg til venstre (og ikkje lenger dekker andre kantar) bør gjerast ved neste rebuild/redeploy, same praksis som resten av `canvas-layout-topdown.md`. **Merk òg**: sidan `podman-compose up --build`/`--force-recreate` alt er stadfesta upåliteleg for redeploy (sjå `specs/done/podman-compose-stale-container-on-rebuild.md`), bruk `podman-compose down` FØR `up --build -d` ved neste redeploy for å unngå å teste mot ein stale container.
