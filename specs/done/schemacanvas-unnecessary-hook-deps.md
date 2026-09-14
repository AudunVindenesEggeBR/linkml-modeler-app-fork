# Spec: Fjern dei to faste `react-hooks/exhaustive-deps`-åtvaringane i `SchemaCanvas.tsx`

Status: **Implementert og verifisert.**
Dato: 2026-09-14

## Runde 2 — implementert

Brukaren skreiv "utfør fiksen" — eksplisitt godkjenning, jf. CLAUDE.md.

**Implementert nøyaktig som skildra i "Forslag til fiks" over:** `views`/`subsetLayouts` fjerna frå `applyAutoLayout` sin dependency-array (`SchemaCanvas.tsx:599`), `hiddenEdgeTypes` fjerna frå `displayEdges` sin (`SchemaCanvas.tsx:1136`). Ingen anna kode endra.

**Verifisert:**
- `pnpm exec eslint packages/core/src/canvas/SchemaCanvas.tsx`: **0 åtvaringar** (ned frå 2).
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- Full `pnpm exec eslint packages/core packages/web`: dei to `SchemaCanvas.tsx`-åtvaringane er borte. To ANDRE, urelaterte åtvaringar dukka opp i staden (`TableView.tsx` — React Compiler-notis om TanStack Table, `GitPanel.tsx` — manglande deps) — stadfesta pre-eksisterande og urørte av denne økta (`git status` viser ingen av dei to filene som endra), ikkje del av det brukaren peika på ("stadig 2 warning" synte konsekvent til `SchemaCanvas.tsx`-para gjennom heile denne økta) og difor ikkje rørte.
- `autoLayout.test.ts` + `edgeAttributes.test.ts` (dei mest relevante testfilene for dei to endra hookane): 82/82 testar grøne. Ingen dedikerte rendrings-testar finst for `SchemaCanvas.tsx` sjølv (same mønster som `ClassNode.tsx`/`EnumNode.tsx` — stadfesta tidlegare denne økta), ikkje naudsynt her heller sidan endringa er reint mekanisk (fjerning av verdiar som aldri vert lesne, stadfesta av ESLint sjølv).

Ønske (ordrett): "vi får stadig 2 warning under testing. Kan du finne ut om vi kan fikse det slik at vi slepp denne unødvendige støyen?"

## Bakgrunn

Desse to `react-hooks/exhaustive-deps`-åtvaringane har dukka opp i KVAR EINASTE `eslint`-køyring denne økta (stadfesta som pre-eksisterande, urelaterte til kvar av dei fem separate endringane som er gjort denne økta):

```
SchemaCanvas.tsx
   599:6  warning  React Hook useCallback has unnecessary dependencies: 'subsetLayouts' and 'views'.
  1136:6  warning  React Hook useMemo has an unnecessary dependency: 'hiddenEdgeTypes'.
```

## Funn — begge er trygge å fjerne (ikkje "manglande dependency", som ville vore risikabelt)

ESLint sin `exhaustive-deps`-regel rapporterer to ULIKE ting: **manglande** dependencies (farleg å ignorere — kan gje stale closures/utdaterte verdiar) og **unødvendige** dependencies (trygt å fjerne — verdien vert aldri lese i funksjonskroppen, så han kan uansett aldri utløyse ei reell naudsynt gjenberekning). Begge desse to er av den TRYGGE typen — stadfesta ved å lese funksjonskroppane direkte, ikkje berre stole på ESLint sin eigen melding:

### 1. `applyAutoLayout` (`SchemaCanvas.tsx:568-599`)

`views` og `subsetLayouts` står i dependency-lista (linje 599), men funksjonskroppen (linje 568-598) refererer ALDRI til nokon av dei direkte — han kallar berre `updateSubsetLayout(...)` (ein funksjonsreferanse, sjølv alt ein eigen, separat dependency), aldri sjølve `subsetLayouts`-tilstanden. Truleg rest frå ei tidlegare utgåve av funksjonen som las desse direkte, seinare refaktorert til å bruke `updateViewLayout`/`updateSubsetLayout`-funksjonane i staden, utan at dependency-lista vart rydda opp samstundes.

### 2. `displayEdges` (`SchemaCanvas.tsx:1095-1136`)

`hiddenEdgeTypes` står i dependency-lista (linje 1136), men funksjonskroppen sin EIGEN kommentar (linje 1097) seier kvifor han er unødvendig: *"Hidden edge types are already excluded from storeEdges by deriveGraph."* — `storeEdges` (`SchemaCanvas.tsx:326`, `useAppStore((s) => s.edges)`) speglar Zustand-store sin `edges`-tilstand, som vert sett frå `deriveGraph(...)` sitt resultat (ein annan `useMemo`, lenger oppe i fila) — DENNE `useMemo`-en tek alt omsyn til `hiddenEdgeTypes` (stadfesta: `hiddenEdgeTypes` er alt ein dependency der). Når `hiddenEdgeTypes` endrar seg, køyrer `deriveGraph`-`useMemo`-en på nytt → `setEdges(derivedEdges)` køyrer → Zustand-store sin `edges` oppdaterer → `storeEdges` (som ALT er ein dependency i `displayEdges`) endrar seg og utløyser gjenberekning uansett. Å liste `hiddenEdgeTypes` direkte her kan difor ALDRI utløyse ei gjenberekning som `storeEdges` ikkje alt ville ha utløyst — reint overflødig.

## Forslag til fiks

Fjern dei to unødvendige namna frå kvar sin dependency-array:

```ts
// SchemaCanvas.tsx:599
}, [activeSchemaFile, ghostEntities, hiddenEdgeTypes, hideTreeRootRangeEdges, allSchemaSlots, fitView, scheduleManifestWrite, activeViewId, focusMode, updateViewLayout, updateSubsetLayout]);
// (views og subsetLayouts fjerna)

// SchemaCanvas.tsx:1136
}, [storeEdges, activeViewMemberIds, highlightOnHover, highlightOnSelection, hoveredNodeId, highlightPinnedNodeId, edgeNeighborMap, hopCloseNodeIds]);
// (hiddenEdgeTypes fjerna)
```

**Kvifor dette er trygt:** reint mekanisk fjerning av verdiar som aldri vert lesne — ingen åtferdsendring (funksjonane gjer nøyaktig det same, dei vert berre memoiserte ørlite meir presist — mindre unødvendig gjenskaping når `views`/`subsetLayouts`/`hiddenEdgeTypes` endrar seg utan at noko dei faktisk brukar òg endrar seg).

## Testcase / akseptansekriterium

1. `pnpm exec eslint packages/core/src/canvas/SchemaCanvas.tsx` (eller full `pnpm lint`) gir **0 åtvaringar**, ikkje berre 0 feil.
2. Full `packages/core`-testpakke: ingen endring i talet på grøne/raude testar samanlikna med før fiksen (reint ei ESLint-/memoiserings-retting, rører ikkje faktisk logikk).
3. Manuell stadfesting (valfritt, låg risiko): Layout-knappen (`applyAutoLayout`) og kant-highlighting/dimming (`displayEdges`) fungerer uendra i nettlesaren etter fiksen.
