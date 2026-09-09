# Spec: gjer "YAML Preview"-panelet dra-i-utvidbart

Status: forslag / ikkje implementert
Dato: 2026-09-07
Ønske: brukaren vil kunne utvide/forminske "YAML Preview"-panelet ved å dra i venstre kant av panelet.

## Noverande tilstand (funne ved gjennomgang av koden)

- Komponenten er `YamlPreview`, definert **inline i `packages/web/src/main.tsx:169-230`** — altså i web-app-skalet, ikkje i `packages/core` slik nesten alle andre UI-komponentar er (jf. `CLAUDE.md`: "packages/core — ... Contains all React components"). Verdt å merke seg, ikkje nødvendigvis noko som må rettast i denne oppgåva.
- Breidda er **hardkoda**: `yamlStyles.panel.width = 300` (`main.tsx:196`). Ingen dra-logikk, ingen persistert breidde, berre ein statisk flex-child (`flexShrink: 0`).
- Panelet vert rendra vist/skjult via `editorSlice.yamlPreviewOpen` (`packages/core/src/store/slices/editorSlice.ts:19,51`, sett via `setYamlPreviewOpen`, styrt frå View-menyen i `MenuBar.tsx:248`). **Det finst ingen breidde-state** for panelet i det heile.
- DOM-plassering: siste barn i `styles.main`, ein flex-rad (`display:'flex'`) saman med `ProjectPanel`, `DisplayPanel`, sjølve canvas-kolonna, og `PropertiesPanel` (`main.tsx:531-555`). YAML Preview er lengst til høgre, så "dra i venstre kant" tyder å dra i grensa mellom canvas/PropertiesPanel og YAML Preview-panelet.

### Viktig: det finst IKKJE noko fungerande dra-til-å-endre-storleik-mønster å kopiere frå i dag

`uiSlice.ts` har alt `projectPanelWidth` (default 240, `uiSlice.ts:93,146`) og `propertiesPanelWidth` (default 320, `uiSlice.ts:94,147`) med tilhøyrande setters (`setProjectPanelWidth`, `setPropertiesPanelWidth`, `uiSlice.ts:121-122,167-172`), og `PropertiesPanel/index.tsx` bruker faktisk `propertiesPanelWidth` som sin `width`-stil. **Men det finst ingen komponent nokon stad i repoet som kallar desse setterane** — ingen `mousedown`/`mousemove`/dra-handtak-kode finst i det heile (stadfesta ved grep over heile `packages/core/src` og `packages/web/src`). Dette er altså daud state-rørleiing for to ANDRE panel, ikkje ein ferdig mal å kopiere direkte — men namnekonvensjonen (`<panel>Width` + `set<Panel>Width` i `uiSlice`) bør følgjast for konsistens.

## Forslag

1. **Legg til breidde-state i `uiSlice.ts`**, same mønster som dei to eksisterande: `yamlPreviewWidth: number` (foreslått standard: behald dagens `300`) + `setYamlPreviewWidth(width: number): void`, med rimeleg klemming (t.d. min ~200px, maks ~50 % av vindaugsbreidda eller ein fast øvre grense som 800px) gjort i setteren eller i drahandtaket sin `mousemove`-handtering.
2. **Legg til eit dra-handtak** på venstre kant av `YamlPreview` (`main.tsx`) — ein smal (~4-6px) usynleg/hover-synleg stripe med `cursor: 'col-resize'`, med `onMouseDown` som startar eit `mousemove`/`mouseup`-lyttarpar på `window` (standard dra-til-endre-storleik-mønster: rekn ut delta frå start-X, oppdater `yamlPreviewWidth` fortløpande, fjern lyttarane på `mouseup`). Bruk `useAppStore((s) => s.yamlPreviewWidth)` i staden for den hardkoda `300`.
3. **Byt `yamlStyles.panel.width` frå konstant til `yamlPreviewWidth` frå store.**
4. **Vurder** (valfritt, separat frå kjernebehovet): persister breidda i `localStorage` slik andre UI-preferansar i `uiSlice.ts` alt gjer (sjå `HIGHLIGHT_SETTINGS_KEY`-mønsteret, `uiSlice.ts:86-88`), slik at brukaren sin valde breidde overlever ein sideoppdatering.

## Naturleg vidareføring (IKKJE del av denne oppgåva, berre nemnt)

Sidan `projectPanelWidth`/`propertiesPanelWidth` alt har daud state-rørleiing med akkurat same behov, ville det same dra-handtaket (som ein liten delt hjelpefunksjon/hook, t.d. `useResizablePanel(width, setWidth, {min, max})`) kunne kople dei to andre panela til på same vis seinare — men berre YAML Preview er i scope her, per brukaren sitt konkrete ønske.

## Testcase / akseptansekriterium

1. Opne eit prosjekt med eit aktivt schema, opne YAML Preview via View-menyen.
2. Dra i venstre kant av panelet — panelet skal utvidast/forminskast fortløpande med musepeikaren, ikkje berre etter sleppt museknapp.
3. Innhaldet (`<pre>`-koden) skal framleis fylle tilgjengeleg plass korrekt ved alle breidder (ingen overflow-brot).
4. Breidda skal ikkje kunne dragast under eit minimum (framleis lesbar) eller over eit fornuftig maksimum (skal ikkje kunne dekkje heile skjermen).
5. (Viss persistering vert implementert) Lukk og opne appen på nytt — breidda skal vere den same som sist sett.
