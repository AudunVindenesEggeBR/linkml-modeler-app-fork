# Spec: "tree_root range"-knappen i EDGE FILTERS skal IKKJE visast som aktivert som default

Status: **Implementert og verifisert.**
Dato: 2026-09-15

Ønske (ordrett): "no er det slik at 'tree_root range' valget viser som aktivt i EDGE FILTERS som default og som default viser vi ikkje edges fra tree_root til andre klasser. Alle andre EDGE FILTERS flag fungerer slik at som default viser dei det dei skal filtrere og du må trykke på knappen for å ikkje vise det. Eg ønsker å beholde default innstilling om at tree_root ranges ikkje skal vises, men eg synes det er meir logisk at 'tree_root range' filter knappen ikkje skal være valgt/aktivert."

## Stadfesta i koden

`DisplayPanel.tsx:242-279`, EDGE FILTERS-seksjonen har to ulike knapptypar med **motsett** styling-konvensjon i dag:

**Dei fire type-baserte knappane** (`EDGE_TOGGLE_DEFS.map(...)`, linje 246-265) — `range`, `is_a`, `mixin`, `union_of`:
```tsx
const hidden = hiddenEdgeTypes.has(type);
// ...
borderColor: hidden ? 'var(--color-border-default)' : color,
color: hidden ? 'var(--color-fg-muted)' : color,
opacity: hidden ? 0.5 : 1,
textDecoration: hidden ? 'line-through' : 'none',
```
Default: `hiddenEdgeTypes` startar tom → `hidden = false` → knappen viser **farga/aktiv** stil. Å trykke gøymer kanttypen OG gjer knappen grå/gjennomstroken. Altså: **aktiv utsjånad = kantane vert viste**, gjennomstroken/grå = filtrert bort. Dette er konvensjonen brukaren viser til.

**`tree_root range`-knappen** (linje 266-277):
```tsx
borderColor: hideTreeRootRangeEdges ? 'var(--color-state-success)' : 'var(--color-border-default)',
color: hideTreeRootRangeEdges ? 'var(--color-state-success)' : 'var(--color-fg-muted)',
```
Default: `hideTreeRootRangeEdges` startar `true` (`store/slices/uiSlice.ts` — jf. `specs/done/edge-filter-hide-tree-root-range-edges.md`) → knappen viser **farga/aktiv** (grøn) stil frå første stund, sjølv om han faktisk *filtrerer bort* kantar akkurat då. Dette er stikk motsett av dei fire andre knappane: her betyr "aktiv utsjånad" at filteret er PÅ (skjuler), ikkje at kantane vert viste.

Dette stadfestar nøyaktig det brukaren observerer: same visuelle språk ("farga/aktivert" vs. "grå/default"), men motsett tydingsretning mellom denne eine knappen og dei fire andre.

## Kva brukaren IKKJE ønsker endra

Standardåtferda skal vere uendra: `tree_root`-range-kantar skal framleis vere skjulte som default (`hideTreeRootRangeEdges` skal framleis starte som `true`, ingen endring i `uiSlice.ts` eller `autoLayout.ts`/`deriveGraph.ts` sin bruk av flagget). Dette er **reint ei visuell knapp-styling-endring**, ikkje ei åtferdsendring.

## Forslag til implementering

Snu berre den visuelle mappinga for `tree_root range`-knappen slik at han følgjer same konvensjon som dei fire andre — "aktiv/farga utsjånad" = kantane vert viste, "grå/default utsjånad" = kantane er filtrert bort:

```tsx
const treeRootRangeHidden = hideTreeRootRangeEdges; // true som default
// ...
style={{
  ...styles.toggleBtn,
  borderColor: treeRootRangeHidden ? 'var(--color-border-default)' : 'var(--color-state-success)',
  color: treeRootRangeHidden ? 'var(--color-fg-muted)' : 'var(--color-state-success)',
  opacity: treeRootRangeHidden ? 0.5 : 1,
  textDecoration: treeRootRangeHidden ? 'line-through' : 'none',
}}
onClick={() => setHideTreeRootRangeEdges(!hideTreeRootRangeEdges)}
title={`${treeRootRangeHidden ? 'Show' : 'Hide'} range edges sourced from tree_root classes (LinkML serialization-only container classes, not part of the domain model). Affects layout too.`}
```

Dette gjer at:
- **Default** (`hideTreeRootRangeEdges = true`, kantane skjulte): knappen viser grå/default stil med gjennomstreking — same visuelle "dette er filtrert bort"-signal som dei fire andre knappane gjev når dei skjuler noko.
- **Etter klikk** (`hideTreeRootRangeEdges = false`, kantane viste): knappen viser grøn/aktiv stil — konsistent med at "aktiv" no betyr "kantane vert viste".

Ingen endring i `title`-teksten sin logikk (framleis "Show"/"Hide" avhengig av gjeldande tilstand), berre ombytt av kva tilstand som utløyser kva farge.

## Testcase / akseptansekriterium

1. Ved fyrste innlasting (default state): `tree_root range`-knappen viser grå/default stil med gjennomstreking (same visuelle stil som dei fire andre knappane har når dei skjuler kantar) — IKKJE grøn/aktiv.
2. `hideTreeRootRangeEdges` er framleis `true` som default, og `tree_root`-range-kantar er framleis skjulte i canvaset som default — ingen åtferdsendring.
3. Etter å trykke på knappen: kantane vert viste, OG knappen viser no grøn/aktiv stil.
4. Å trykke igjen: attende til default (skjult kantar, grå/gjennomstroken knapp).

## Implementering (2026-09-15)

`DisplayPanel.tsx:266-278` — `borderColor`/`color`/`opacity`/`textDecoration` snudd til å følgje `hideTreeRootRangeEdges` med same mapping som dei fire type-baserte knappane sin `hidden`-variabel (grå/0.5-opacity/gjennomstroken når `true`, grøn/full opacity/ingen gjennomstreking når `false`). `title` bruker no `Show`/`Hide` avhengig av gjeldande tilstand, same mønster som dei andre knappane. Ingen endring i `hideTreeRootRangeEdges` sin defaultverdi eller i `autoLayout.ts`/`deriveGraph.ts` — reint visuelt.

**Verifisert:**
- `tsc --noEmit` på `@linkml-editor/core`: ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: ingen feil.
- Ingen eksisterande testar rører knappen sin visuelle stil (dei to testfilene som nemner `hideTreeRootRangeEdges` — `autoLayout.test.ts`, `edgeAttributes.test.ts` — testar layout-/graf-logikken, som er uendra), difor ingen testendring nødvendig.
