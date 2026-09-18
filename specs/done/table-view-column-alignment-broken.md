# Spec: Table View sine kolonner er ikkje justerte mot overskriftene — native `<table>`-virtualisering er strukturelt inkompatibel

Status: **Implementert og verifisert.** F1 implementert etter "utfør".
Dato: 2026-09-16

Bakgrunn (ordrett frå brukaren): "eg ser at i table visning (nabovalg vil canvas og outline) så viser vi ei rad med tabelloverskrift, så viser vi rader for datainnholdet, men radene med datainnholdet alligner ikkje sine kolonner mot overskriftene så det ser ut som om tabellen er heilt ødelagt"

**Dette er IKKJE noko eg innførte i denne økta** — Table View sin grunnstruktur (native `<table>` + `@tanstack/react-virtual`) er uendra frå før "Types"-fana vart lagt til (jf. `specs/backlog/cross-repo-import-resolution-gaps.md`, runde 3); feilen råkar difor ALLE rad-typar (classes/slots/enums/types) likt, ikkje berre den nye types-fana. Truleg vart dette oppdaga no fordi Table View er bak eit feature-flag (`tableModeEnabled`, av som standard) som brukaren berre nyleg byrja å utforske via det nye "table: on"-utviklarvalet.

## Stadfesta i koden OG empirisk — CSS "blockification" bryt table-layoutet

`packages/core/src/canvas/TableView.tsx` blandar semantisk `<table>`-markup med rad-virtualisering (linje 547-589):

```tsx
<table style={{ ...styles.table, minWidth: table.getTotalSize() }}>
  <thead style={styles.thead}>
    {table.getHeaderGroups().map((hg) => (
      <tr key={hg.id} style={styles.headerRow}>
        {hg.headers.map((h) => (
          <th key={h.id} style={{ ...styles.th, width: h.getSize() }}>...</th>
        ))}
      </tr>
    ))}
  </thead>
  <tbody style={{ height: totalSize, position: 'relative', display: 'block' }}>
    {virtualItems.map((virtualItem) => {
      const row = allRows[virtualItem.index];
      return (
        <tr key={row.id} style={{ ...styles.row, position: 'absolute', top: virtualItem.start, height: ROW_HEIGHT, width: '100%' }}>
          {row.getVisibleCells().map((cell) => (
            <td key={cell.id} style={{ ...styles.td, width: cell.column.getSize() }}>...</td>
          ))}
        </tr>
      );
    })}
  </tbody>
</table>
```

`styles.table` set `tableLayout: 'fixed'`, som normalt ville tvinge alle radene til å bruke same kolonnebreidder som er spesifisert — MEN dette føreset at kvar rad faktisk ER ein ordentleg `<tr>`-unge av ei `table-row-group` (`<tbody>`), slik at nettlesaren sin kolonne-sporings-algoritme kan bruke han. Her er `<tbody>` sett til `display: 'block'` (naudsynt for at `position: 'relative'` + absolutt-posisjonerte `<tr>`-born skal fungere for virtualisering), OG kvar enkelt `<tr>` har `position: 'absolute'`.

**Rotårsak (CSS-spesifikasjonen sin "blockification"-regel):** Eit element med ein "intern tabell"-display-verdi (`table-row`, `table-cell`, osv.) som OGSÅ har `position: absolute` (eller `fixed`) får computed `display` tvinga til `block` — uavhengig av kva som står i den inline `style`-attributten. Stadfesta empirisk (Playwright, `getComputedStyle`):
```json
{
  "firstRowDisplay": "block",       // ikkje "table-row", trass i style={{display:'table-row'}}
  "firstRowPosition": "absolute",
  "tdDisplay": "table-cell"          // <td> sjølv hevdar framleis table-cell...
}
```
Sidan `<tr>` vert "blockifisert" til `display:block`, er han ikkje lenger ei ekte tabellrad i nettlesaren sin layoutmodell — og `<td>`-borna hans (sjølv om DEI framleis seier `display:table-cell`) vert "anonyme" tabellceller utan tilknyting til den DELTE kolonne-breidde-sporinga som `<thead>` sine `<th>`-element brukar. Resultatet: `<td>`-breidder følgjer IKKJE lenger `<th>`-breiddene, sjølv om begge har eksplisitte `width`-verdiar sette via inline style.

**Målt misalignment** (`brreg-felles-typer`, "types"-fana, 4 kolonnar — Name/base/uri/Description):

| Kolonne | `<th>` venstre-kant | `<th>` breidd | `<td>` venstre-kant (rad 1) | `<td>` breidd (rad 1) |
|---|---|---|---|---|
| Name | 380px | 200px | 380px | **118px** |
| base | 580px | 120px | **498px** | **39px** |
| uri | 700px | 160px | **536px** | **89px** |
| Description | 860px | 400px | **626px** | 284px |

Venstre-kanten for kolonne 1 tilfeldigvis stemmer (begge startar ved container sin venstre kant), men BREIDDA er alt feil (118px ≠ 200px) — og dette akkumulerer: kvar påfølgjande kolonne sin venstre-kant driv lenger og lenger unna der overskrifta faktisk står. Stadfesta visuelt med skjermbilete — akkurat det brukaren skildrar: "ser ut som om tabellen er heilt øydelagt."

## Kvifor `table-layout: fixed` ikkje reddar dette

`table-layout: fixed` styrer korleis DEI INNLEIANDE kolonnebreiddene vert rekna ut (frå første rad/`<colgroup>`), men løyser ikkje det djupare problemet: eit rad som er "blockifisert" bort frå tabellen sin rad/kolonne-modell deltek ikkje lenger i NOKON kolonne-synkronisering i det heile, uavhengig av `table-layout`-verdi.

## Dette er eit kjent, generelt inkompatibilitetsproblem — ikkje spesifikt for denne koden

Å verkeleg VIRTUALISERE ein native `<table>` (fjerne usynlege rader frå DOM-en og omplassere dei attverande med `position:absolute`, slik alle rad-virtualiseringsbibliotek gjer for ytingsskuld) er strukturelt inkompatibelt med nettlesaren sin native tabell-kolonne-algoritme, sidan den algoritmen krev at ALLE rader er ekte syskenrader i tabell-flyt. Dette er nøyaktig kvifor etablerte virtualiserte tabell-implementasjonar (TanStack sine eigne virtualiseringseksempel, `react-window`, AG-Grid, osv.) konsekvent ID IKKJE brukar semantisk `<table>`-markup for sjølve rad-/cellelaget når radene skal virtualiserast — dei brukar CSS Grid eller Flexbox-baserte "uekte tabellar" (`<div role="table">` / `role="row"` / `role="cell"` for tilgjengelegheit) i staden, der header- og kroppsrader deler NØYAKTIG same eksplisitte breidde-verdiar frå éin kjelde, heilt uavhengig av native tabell-layout.

## Forslag til forbetring

**F1 (tilrådd).** Bygg om `TableView.tsx` sin rad-/cellelayout frå semantisk `<table>/<thead>/<tbody>/<tr>/<td>` til `<div>`-baserte rader med CSS Grid: eitt delt `gridTemplateColumns`-uttrykk (bygd frå `columns.map(c => \`${c.getSize()}px\`).join(' ')`) brukt IDENTISK på header-raddiven OG kvar virtualisert kroppsrad-div. Sidan begge deriverer breidder frå NØYAKTIG same kjelde (kolonnedefinisjonane sine `size`-verdiar), er pixel-nøyaktig justering GARANTERT, uavhengig av native tabell-layout-eigenskapar. Legg til `role="table"`, `role="row"`, `role="columnheader"`, `role="cell"` (og `role="rowgroup"` for header/body-grupperingane) på dei tilsvarande div-elementa for å bevare skjermlesar-tilgjengelegheit sidan ekte `<table>`-semantikk forsvinn. `@tanstack/react-table` og `@tanstack/react-virtual` sin eksisterande logikk (kolonnedefinisjonar, cellerendering via `flexRender`, virtualiserings-rekning) treng INGEN endring — berre JSX-elementa og tilhøyrande CSS-eigenskapar (`display`, `position`, breidde-tilnærming) i sjølve render-funksjonen.

**F2 (vurdert, ikkje tilrådd).** Behalde `<table>`-markup, men fjern virtualisering (render ALLE rader samstundes). Løyser justeringsproblemet (native tabell-layout fungerer korrekt utan `position:absolute`-rader), men gjev opp yting-fordelen ved virtualisering for store skjema (`brreg-felles-typer` har 53 rader åleine — mindre kritisk der, men enkelte importerte skjema kan ha fleire hundre klassar/attributt samla). Ikkje tilrådd sidan F1 løyser problemet UTAN å ofre yting.

## Testcase / akseptansekriterium

1. For kvar rad-type (classes/slots/enums/types) og for skjema med fleire rader enn kan virtualiserast usynt (fleire enn ~20-30, avhengig av viewport-høgd), er venstre-kant OG breidd for kvar `<td>`/cellediv i FØRSTE synlege rad pixel-identisk med tilsvarande `<th>`/kolonneoverskrift-div (målt via `getBoundingClientRect()`, ikkje berre visuell inspeksjon).
2. Same stemmer for RADER LENGER NED i lista (ikkje berre rad 1) — test ved å scrolle og re-måle, sidan virtualiserte radet sin `top`-posisjon endrar seg dynamisk.
3. Cellene sin tekst-innhald/redigeringsfunksjonalitet (dobbelklikk-for-å-redigere, `TextCell`/`BoolCell`) fungerer uendra etter ombygginga.
4. Skjermlesar-roller (`role="table"` osv.) er til stades på dei nye div-elementa.
5. `pnpm --filter @linkml-editor/core test` og `tsc --noEmit` framleis grøne.

## Ope spørsmål til brukaren

- Godkjenner du F1 (CSS Grid-ombygging av Table View sin rad-/cellestruktur, skildra over)?

## Implementering (2026-09-16)

F1 implementert etter "utfør":

- `<table>/<thead>/<tbody>/<tr>/<th>/<td>` erstatta med `<div>`-element med tilsvarande ARIA-roller (`role="table"`, `role="rowgroup"` × 2, `role="row"`, `role="columnheader"`, `role="cell"`).
- Ny delt `gridTemplateColumns`-streng (`table.getAllLeafColumns().map(c => \`${c.getSize()}px\`).join(' ')`) brukt IDENTISK på header-raddiven og kvar virtualisert kroppsrad-div (`styles.headerRow`/`styles.row`, no `display: 'grid'`).
- `styles.table` vart `display:'flex', flexDirection:'column'` (i staden for `tableLayout:'fixed', borderCollapse:'collapse'`, som ikkje gjeld for div-baserte element).
- **Fann og fiksa eit NYTT, relatert flex-shrink-hol undervegs** (same mønster som OutlineView-funnet i `cross-repo-import-resolution-gaps.md` runde 4): sidan `td` (no `display:'flex'`) gjer celleinnhaldet sine born (`cellDisplayStyle`, `cellInputStyle`, `boolCellStyle`) til FLEX-ITEM, ville dei utan eit eksplisitt `width:'100%'` + `minWidth:0` ikkje krympa korrekt (flex-item sin standard `min-width:auto` hindrar krymping under innhaldet sin eigen breidd, sjølv med `overflow:hidden`/`textOverflow:ellipsis` sett) — retta ved å leggje `width:'100%', minWidth:0` (og `boxSizing:'border-box'` der det mangla) til alle tre delte cellestilobjekta.

**Verifisert empirisk (ikkje berre kodelesing), før og etter, med Playwright:**
- FØR fiksen (stadfesta i planen over): `<th>`/`<td>` sine `getBoundingClientRect()`-verdiar dreiv frå kvarandre kolonne for kolonne (t.d. "base"-kolonnen sin `<th>` venstre-kant 580px vs `<td>` venstre-kant 498px).
- ETTER fiksen: identiske `getBoundingClientRect()`-verdiar for alle 4 kolonnar, både venstre-kant og breidd, stadfesta for `brreg-felles-typer-schema.yaml` sin "types"-fane (53 rader, virtualisert).
- Stadfesta at inline-redigering (dobbeltklikk → skriv → Enter) framleis fungerer korrekt etter ombygginga — redigert `description`-felt vart korrekt skrive til Zustand-lageret (synleg i YAML-førehandsvisinga).
- Stadfesta at avkryssingsboksar (`abstract`/`mixin`/`required`/`multivalued`/`identifier`) framleis sentrerer og fungerer korrekt.
- Testa alle fire rad-typar (classes/slots/enums/types) — alle korrekt justerte.
- Ingen NYE konsoll-feil (same pre-eksisterande, urelaterte ProjectPanel-hydrationsåtvaring som i tidlegare rundar).

**Verifisert elles:**
- `tsc --noEmit` på `@linkml-editor/core` og `@linkml-editor/web`: ingen feil.
- `eslint` på den endra fila: ingen feil.
- `scripts/check-token-usage.sh`: PASS.
- Ingen eksisterande unit-testar dekker `TableView.tsx` (reint UI/layout-fiks, ingen eksportert logikk endra) — Playwright-verifiseringa over er difor hovudbeviset, i tillegg til `tsc`/lint.
