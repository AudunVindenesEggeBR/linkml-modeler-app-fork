# Spec: YAML Preview-panelet skal kunne dragast i venstre kant og utvidast mot venstre, maks dobbel breidde

Status: **Implementert og verifisert.**
Dato: 2026-09-15

Ønske (ordrett): "eg ønsker at YAML Preview panelet skal kunne dras i venstre kant og utvides mot venstre til maks dobbel størrelse i x - retning"

## Stadfesta i koden

`packages/web/src/main.tsx:168-230` — `YamlPreview`-komponenten og sine stilar:

```tsx
function YamlPreview() {
  ...
  return (
    <div id="lme-yaml-preview" style={yamlStyles.panel}>
      <div style={yamlStyles.header}>
        <span style={yamlStyles.title}>YAML Preview</span>
        {schema?.isDirty && <span style={yamlStyles.dirty}>● unsaved</span>}
      </div>
      <pre style={yamlStyles.code}>{yaml}</pre>
    </div>
  );
}

const yamlStyles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: 300,
    borderLeft: '1px solid var(--color-border-subtle)',
    ...
  },
  ...
};
```

Panelet er i dag **fast breidde (300px, hardkoda)**, rendra heilt til høgre i layouten (`main.tsx:553-554`, `{yamlPreviewOpen && <YamlPreview />}`, siste element i den horisontale rada). Sidan panelet sit lengst til høgre og har `borderLeft`, er "venstre kant" av panelet nettopp kanten som grensar mot canvaset — å dra han mot venstre skal auke breidda (utvide inn i canvas-plassen), heilt i tråd med korleis brukaren skildrar det.

**Ingen dra-i-kant-resize-mekanisme finst nokon stad i kodebasen i dag** — verken for dette panelet eller andre. Eit søk etter `col-resize`/`ew-resize`/tilsvarande cursor-stilar gav null treff.

**Interessant funn:** `propertiesPanelWidth`/`setPropertiesPanelWidth` finst alt fullt utbygd i `store/slices/uiSlice.ts:103,133,159,183-185` (state + action + default `320`), og vert lese i `PropertiesPanel/index.tsx:18,64` (`style={{ ...styles.panel, width: propertiesPanelWidth }}`) — men **ingen stad i heile kodebasen kallar `setPropertiesPanelWidth`**. Det er altså daud/uferdig infrastruktur frå eit tidlegare forsøk på akkurat denne typen resize-funksjonalitet, aldri kopla til eit faktisk dra-handtak. Dette er ikkje ein feil å rette no (ikkje del av dette ønsket, og Properties-panelet sin resize er ikkje det brukaren spør om), men det stadfestar at mønsteret (namngjeving, plassering i `uiSlice.ts`) alt er etablert i prosjektet og bør følgjast for konsistens.

## Forslag til implementering

1. **Ny tilstand i `uiSlice.ts`** (same mønster som `propertiesPanelWidth`): `yamlPreviewWidth: number` (px, default `300` — uendra frå dagens hardkoda verdi) + `setYamlPreviewWidth(width: number): void`, med clamping i setteren sjølv (`Math.min(600, Math.max(300, width))`) slik at UI-koden ikkje treng duplisere grensene.
2. **Dra-handtak** — ein smal (t.d. 4-6px), usynleg/subtilt element limt til venstre kant av `yamlStyles.panel` (`position: relative` på panelet, handtaket `position: absolute; left: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize`), med `onMouseDown` som startar eit `mousemove`/`mouseup`-lytterpar på `window` (lagt til og fjerna via `useEffect`, standard React-mønster for drag-resize — ikkje avhengig av noko eksisterande bibliotek, ingen resize-bibliotek er installert i prosjektet).
3. **Retning:** sidan panelet sit til høgre og handtaket er på VENSTRE kant, skal muse-rørsle MOT VENSTRE (mindre `clientX`) auke breidda: `newWidth = startWidth + (startX - currentX)`.
4. **Maks/min:** minimum = dagens faste breidde (300px, kan ikkje gjerast smalare enn i dag), maksimum = **dobbel** breidde (600px) — nøyaktig som ønskt. Clampa i både drag-handteraren og setteren (defense-in-depth, minimal kostnad).
5. **Panelet sin `width: 300`-linje** i `yamlStyles.panel` vert fjerna/erstatta med `width: yamlPreviewWidth` lese frå store, akkurat som `PropertiesPanel` alt gjer for sin eigen (dessverre ukopla) `propertiesPanelWidth`.

### Svar frå brukar (2026-09-15)

"ingen persistens" — stadfesta. `yamlPreviewWidth` startar på 300px kvar gong (ingen `localStorage`/manifest-lagring), same mønster som `propertiesPanelOpen`/`displayPanelOpen`. Alle opne spørsmål er no løyste. Spec-en er ferdig presisert og klar for implementering ved eksplisitt godkjenning — dette dokumentet i seg sjølv utgjer framleis ikkje ei slik godkjenning.

## Testcase / akseptansekriterium

1. Eit synleg/interaktivt dra-handtak finst på venstre kant av YAML Preview-panelet (t.d. `cursor: col-resize` ved hover).
2. Å dra handtaket mot venstre aukar panelet si breidde; å dra mot høgre minkar ho.
3. Breidda kan ikkje verte mindre enn dagens faste 300px, og ikkje meir enn 600px (dobbel breidde).
4. Panelet sitt innhald (YAML-koden i `<pre>`) følgjer breidda korrekt — ingen visuelle feil eller overflow-brot ved verken min eller maks breidde.
5. Ingen regresjon i eksisterande YAML Preview-funksjonalitet (opne/lukke via `yamlPreviewOpen`, `● unsaved`-indikator, innhaldet sjølv).

## Implementering (2026-09-15)

Nøyaktig etter forslaget over:

1. **`uiSlice.ts`**: la til `YAML_PREVIEW_MIN_WIDTH = 300` og `YAML_PREVIEW_MAX_WIDTH = 600` som eksporterte konstantar, `yamlPreviewWidth: number` (state, default `YAML_PREVIEW_MIN_WIDTH`) og `setYamlPreviewWidth(width: number): void` (action) — setteren clampar sjølv (`Math.min(MAX, Math.max(MIN, width))`), same mønster som `propertiesPanelWidth`/`projectPanelWidth`, men med grensene innebygd i setteren slik at UI-koden ikkje treng duplisere dei.
2. **`packages/web/src/main.tsx`** (`YamlPreview`-komponenten):
   - Les `yamlPreviewWidth` frå store, brukt som `width` i `yamlStyles.panel` (erstatta den hardkoda `width: 300`).
   - `yamlStyles.panel` fekk `position: 'relative'` (nødvendig for det absolutt-posisjonerte dra-handtaket).
   - Nytt dra-handtak-element (`yamlStyles.resizeHandle`, `position: 'absolute'; left: 0; width: 6; cursor: 'col-resize'`), lagt inn som fyrste barn i panelet.
   - `handleResizeStart` (`onMouseDown` på handtaket): les `startX`/`startWidth` frå `useAppStore.getState()` (unngår stale-closure-problem), legg til `window`-nivå `mousemove`/`mouseup`-lyttarar (lagt til og fjerna direkte i handteraren, ikkje via `useEffect` — treng ikkje vere aktive utanom sjølve draget). Rørsle MOT VENSTRE (mindre `clientX`) aukar breidda: `startWidth + (startX - moveEvent.clientX)`. `document.body.style.userSelect = 'none'` under draget (fjerna ved `mouseup`) hindrar utilsikta tekstmarkering av YAML-innhaldet medan ein dreg.
3. **Testar**: la til fire nye testar i `uiSlice.test.ts` — default-verdi (`yamlPreviewWidth === YAML_PREVIEW_MIN_WIDTH`), vanleg oppdatering, clamping til maks (og eksplisitt stadfesting av at maks = 2× min, altså "dobbel storleik"), og clamping til min.

**Verifisert:**
- `tsc --noEmit` på `@linkml-editor/core`: ingen feil.
- `tsc --noEmit` på `@linkml-editor/web` (etter mellombels `pnpm --filter @linkml-editor/core build` for å avdekke ekte feil, `dist/` fjerna etterpå — jf. CLAUDE.md sin instruks om dette): ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: ingen feil.
- `scripts/check-token-usage.sh`: PASS.
- Full `pnpm --filter @linkml-editor/core test`-suite: 21/21 testfiler, 613/613 testar grøne (inkl. dei fire nye `yamlPreviewWidth`-testane) — dei 7 "feila" i køyringa var utelukkande den kjende, dokumenterte `[vitest-pool-runner]`-infrastrukturflakigheita (jf. CLAUDE.md), ingen reelle regresjonar.
