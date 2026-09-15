# Spec: Properties-panelet sin "X"-knapp → "Minimize panel", pluss tilsvarande knapp/funksjonalitet på Display-panelet

Status: **Implementert og verifisert.**
Dato: 2026-09-15

Ønske (ordrett): "Eg ønsker at Properties panelet sin 'X' knapp skal få endra hoover tekst frå 'Close panel' til 'Minimize panel'. Så ønsker eg at DISPLAY panelet skal få tilsvarande knapp med tilsvarande funksjonalitet."

## Del 1: Properties-panelet — reint tekst-tillegg, stadfesta korrekt namngjeving

`PropertiesPanel/index.tsx:74`:
```tsx
<button style={styles.headerBtn} onClick={() => setPropertiesPanelOpen(false)} title="Close panel">
  <X size={12} />
</button>
```

**Stadfesta at "Minimize" faktisk er den presise nemninga** — knappen kallar `setPropertiesPanelOpen(false)`, som IKKJE fjernar/øydelegg panelet, men i staden får `PropertiesPanel` til å rendere ein liten, klikkbar, ståande fane (`‹ P`) i staden for sjølve panelet (`index.tsx:30-36`):

```tsx
if (!propertiesPanelOpen) {
  return (
    <button style={styles.collapsedTab} onClick={() => setPropertiesPanelOpen(true)} title="Open Properties Panel">
      ‹ P
    </button>
  );
}
```

Dette ER eit minimer-mønster (kollapsar til ein liten fane, ikkje eit ekte lukk/øydelegg) — "Close panel" var difor ei upresis nemning frå før, "Minimize panel" er meir presist. Reint tekst-tillegg, ingen åtferdsendring.

## Del 2: Display-panelet — treng NY funksjonalitet, ikkje berre tekst

**Stadfesta at Display-panelet i dag IKKJE har NOKON open/lukk/minimer-tilstand i det heile** — søkt gjennom heile kodebasen etter `displayPanelOpen`/tilsvarande, null treff. `DisplayPanel.tsx` vert alltid rendra ubetinga (`main.tsx:536`, `<DisplayPanel />` utan noka vilkårleg rendring), og komponenten sin header (`DisplayPanel.tsx:156-159`) har berre ein tittel-`<span>`, ingen knappar:

```tsx
<div id="lme-display-panel" style={styles.panel}>
  <div style={styles.header}>
    <span style={styles.headerTitle}>Display</span>
  </div>
  ...
```

Dette betyr Del 2 er IKKJE eit reint tekst-tillegg — det krev ny tilstand + ny UI, ikkje berre ein kopiert knapp.

### Forslag til implementering (speglar Properties-panelet sitt mønster nøyaktig)

1. **Ny tilstand:** `displayPanelOpen: boolean` (standard `true`) + `setDisplayPanelOpen(open: boolean)`-setter. Føreslår same slice som `propertiesPanelOpen` alt bur i (`store/slices/editorSlice.ts:14,46,68`), for konsistens — begge er "er dette sidepanelet ope"-tilstand av same slag.
2. **Kollapsert fane** når `!displayPanelOpen`: same mønster som Properties-panelet sin `styles.collapsedTab`, MEN spegla — Display-panelet sit på VENSTRE side av skjermen (`main.tsx:533-536`, mellom `ProjectPanel` og canvas), medan Properties-panelet sit til HØGRE. Den kollapserte Properties-fana bruker `‹ P` (pil PEIKER MOT PANELET, som ekspanderer til venstre frå eit høgreplassert panel) og `borderLeft` (kant mot canvaset, som er til venstre for eit høgreplassert panel). For eit VENSTREPLASSERT Display-panel bør fana difor spegelvendast: pil som peiker HØGRE (`D ›`, ekspanderer til høgre inn mot canvaset) og `borderRight` (kant mot canvaset, som no er til høgre for eit venstreplassert panel).
3. **Ny minimer-knapp** i `DisplayPanel.tsx` sin header, same ikon (`X`, `size={12}`) og styling (`styles.headerBtn`, gjenbrukt frå Properties-panelet sin ekvivalent viss delt, elles kopiert), `title="Minimize panel"` (same tekst som Del 1, ikkje "Close panel" — konsekvent frå fyrste dag, ikkje eit mellombels feilnamn å rette seinare).
4. **`main.tsx`** treng ingen endring i sjølve renderinga (`<DisplayPanel />` framleis ubetinga rendra) — panelet handterer sin eigen open/kollapsert-tilstand internt, akkurat som Properties-panelet alt gjer.

### Svar frå brukar (2026-09-15)

"D ›, editorSlice, no persistence" — løyser alle tre opne spørsmål:
1. **Kollapsert-fane-tekst:** `D ›` — stadfesta.
2. **Tilstandsplassering:** `editorSlice.ts`, same stad som `propertiesPanelOpen` — stadfesta.
3. **Persistens:** ingen — panelet startar ope kvar gong (uendra frå korleis `propertiesPanelOpen` alt fungerer), ingen `localStorage`-lagring.

Alle opne spørsmål er no løyste. Spec-en er ferdig presisert og klar for implementering ved eksplisitt godkjenning — dette dokumentet i seg sjølv utgjer framleis ikkje ei slik godkjenning.

## Testcase / akseptansekriterium

1. **Del 1:** Properties-panelet sin X-knapp viser "Minimize panel" ved hover, ikkje "Close panel". Ingen åtferdsendring.
2. **Del 2:** Display-panelet får ein tilsvarande X-knapp (same ikon, same `title="Minimize panel"`) i sin header. Å klikke han kollapsar panelet til ei lita, klikkbar fane (same mønster som Properties-panelet). Å klikke fana att opnar panelet.
3. Ingen regresjon i eksisterande Properties-panel-åtferd eller -testar.

## Implementering (2026-09-15)

**Del 1** — `PropertiesPanel/index.tsx:74`: `title="Close panel"` → `title="Minimize panel"`. Reint tekst, ingen andre endringar.

**Del 2** — nøyaktig etter forslaget over:

1. `store/slices/editorSlice.ts`: la til `displayPanelOpen: boolean` (state), `setDisplayPanelOpen(open: boolean): void` (action), `displayPanelOpen: true` (initialverdi) og setter-implementasjonen — alle fire plassert rett ved sida av dei tilsvarande `propertiesPanelOpen`-linjene, same slice som spesifisert.
2. `DisplayPanel.tsx`: importerte `X`-ikonet (`../ui/icons/index.js`), las ut `displayPanelOpen`/`setDisplayPanelOpen` frå store, og la til eit tidleg-return for kollapsert tilstand (etter alle hook-kall, rett før `hasSelection`-linja — kan ikkje liggje før dei seinare `useMemo`-kalla utan å bryte Rules of Hooks):
   ```tsx
   if (!displayPanelOpen) {
     return (
       <button style={styles.collapsedTab} onClick={() => setDisplayPanelOpen(true)} title="Open Display Panel">
         D ›
       </button>
     );
   }
   ```
3. Header-JSX fekk ein `headerActions`-wrapper med minimer-knappen (`title="Minimize panel"`, same `X size={12}`-ikon), og `styles.header` fekk `justifyContent: 'space-between'` for å skyve knappen til høgre.
4. Nye stilar i `DisplayPanel.tsx` sin `styles`-objekt: `headerActions`, `headerBtn` (kopiert frå Properties-panelet sin ekvivalent) og `collapsedTab` (spegla versjon — `borderRight` i staden for `borderLeft`, elles identisk styling).
5. `main.tsx` — ingen endring, stadfesta unødvendig som venta.
6. Testar: la til ein mirrora test i `store/__tests__/editor.test.ts` for `displayPanelOpen`/`setDisplayPanelOpen`, parallelt med den eksisterande `propertiesPanelOpen`-testen.

**Verifisert:**
- `tsc --noEmit` på `@linkml-editor/core`: ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: 0 feil (rett scope, ikkje `dist`).
- `scripts/check-token-usage.sh`: PASS.
- `editor.test.ts` (inkl. ny `displayPanelOpen`-test): 8/8 testar grøne.
- Full `pnpm --filter @linkml-editor/core test`-suite: ingen reelle feil (kun kjend, ikkje-blokkerande `[vitest-pool-runner]`-infrastrukturflakigheit, jf. CLAUDE.md).
