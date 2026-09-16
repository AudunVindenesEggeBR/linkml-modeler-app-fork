# Spec: To ulike importfeil funne på Enhetsregisteret-skjemaet — absolutte URL-imports utan filending vert stille droppa, og importerte `types:` vert usynlege

Status: **Implementert og verifisert i alle tre rundar.** Runde 1+2 (A1, A2, B1, B2, B3, toast-historikk) og runde 3 (C1: Outline+Table "Types"-visning, C2b: canvas-avgrensing dokumentert i UI, C3: ProjectPanel types-badge) er alle implementerte, godkjende av brukaren via AskUserQuestion, og verifiserte — inkludert visuell verifisering i nettlesar med Playwright-skjermbilete (sjå "Implementering (2026-09-16, runde 3)" nedst).
Dato: 2026-09-16 (runde 2: 2026-09-16, implementert runde 1+2: 2026-09-16, runde 3: 2026-09-16, implementert runde 3: 2026-09-16)

Bakgrunn (ordrett frå brukaren): "Enhetsregisteret skjemaet har både absolutte og relative imports. Det ser ut som om den relative importen til brreg-felles-typer blir lest og lagt i IMPORTS lista, men innholdet i det aktuelle skjemaet har ikkje blitt lest inn. Den absolutte importen til https://raw.githubusercontent.com/brreg/linkml-datamodellering-no/dcat-ap-no-v2.14.1/src/linkml/ap-no/dcat-ap-no/dcat-ap-no-schema har ikkje blitt lest inn i det heile."

Skjemaet det er snakk om er eit av `src/linkml/oreg/enhetsregisteret-*-schema.yaml`-filene i `brreg/linkml-datamodellering-no` (verifisert konkret mot `enhetsregisteret-bvrfriv-schema.yaml`, HEAD på `main`), som har nøyaktig dette importmønsteret:

```yaml
imports:
- linkml:types
- ../../felles/brreg-felles-typer/brreg-felles-typer-schema
- https://raw.githubusercontent.com/brreg/linkml-datamodellering-no/dcat-ap-no-v2.14.1/src/linkml/ap-no/dcat-ap-no/dcat-ap-no-schema
```

Undersøkt kode: `packages/core/src/io/importResolver.ts` (heile fila lest), forbrukarane av `ImportedEntity`/`collectImportedEntities`/`findMissingImport` (`SchemaCanvas.tsx`, `DisplayPanel.tsx`, `deriveGraph.ts`, `autoLayout.ts`, `ValidationPanel.tsx`, `projectSlice.ts`), og `validation/index.ts`. Dette er to **uavhengige** rotårsaker — brukaren sine to observasjonar er ikkje same feil på to stader, dei er to ulike hol i importsystemet som begge råkar akkurat dette skjemaet fordi det brukar begge importformene samtidig.

## Funn 1 — absolutt URL-import utan filending vert stille 404 og droppa

**Stadfesta empirisk** (curl mot den faktiske URL-en frå brukaren sin bug-rapport):

```
$ curl -sI ".../dcat-ap-no-v2.14.1/src/linkml/ap-no/dcat-ap-no/dcat-ap-no-schema"
HTTP/2 404

$ curl -sI ".../dcat-ap-no-v2.14.1/src/linkml/ap-no/dcat-ap-no/dcat-ap-no-schema.yaml"
HTTP/2 200
```

Fila finst (`dcat-ap-no-schema.yaml`, stadfesta via GitHub Contents API), men `imports:`-oppføringa — heilt i tråd med vanleg LinkML-konvensjon — har ikkje filending. LinkML sin eigen resolver legg på `.yaml` sjølv ved oppslag; det gjer ikkje vår.

I `importResolver.ts` finst det to ulike kodestiar for å byggje ein hente-URL frå eit importnamn, og dei handterer filending ULIKT:

- `resolveImportAsUrl()` (brukt når ein **relativ** import skal løysast opp mot ein URL-basis, linje 33-40) — legg medvite til `.yaml` viss importstrengen manglar det:
  ```ts
  const withExt = importStr.endsWith('.yaml') || importStr.endsWith('.yml') ? importStr : `${importStr}.yaml`;
  ```
- `loadSchemaFromUrl()` (linje 141-160), kalla direkte for **absolutte** URL-imports i `resolveImports()` (linje 217-218 og 253-254: `if (isUrlImport(imp)) { ... queue.push({ filePath: imp, ... }) }`) — sender importstrengen VIDARE UENDRA til `fetch()`, via `normalizeSchemaUrl()` som berre gjer om GitHub blob-URL-ar (ikkje legg til filending):
  ```ts
  async function loadSchemaFromUrl(url: string): Promise<SchemaFile | null> {
    const resolvedUrl = normalizeSchemaUrl(url);
    try {
      const response = await fetch(resolvedUrl);
      if (!response.ok) return null;
      ...
    } catch {
      return null;
    }
  }
  ```

Resultatet: éin og same importstreng-form ("full URL utan filending") vert korrekt filending-normalisert når han kjem via ein relativ-til-URL-oppslag, men IKKJE når han står som ein direkte, absolutt `imports:`-oppføring. Feilen er **heilt stille** — `loadSchemaFromUrl` returnerer `null` ved ikkje-ok status, og kallaren i `resolveImports` (`if (!file) continue;`, linje 240) hoppar vidare utan å varsle nokon. Dette bryt òg med prinsippet i CLAUDE.md ("Application Error Handling" — "No silent failures: every error must propagate and be visible, never swallowed").

## Funn 2 — importert skjema som berre definerer `types:` (ingen `classes`/`enums`) vert usynleg overalt, sjølv om henting lukkast

**Stadfesta empirisk** at sjølve nettverksdelen fungerer korrekt for dette tilfellet:

```
$ node -e "console.log(new URL('../../felles/brreg-felles-typer/brreg-felles-typer-schema.yaml', BASE).href)"
https://raw.githubusercontent.com/brreg/linkml-datamodellering-no/main/src/linkml/felles/brreg-felles-typer/brreg-felles-typer-schema.yaml

$ curl -sI <URL over>
HTTP/2 200
```

URL-matematikken i `resolveImportAsUrl()` er altså rett, og `resolveImports()` bør faktisk klare å hente og parse `brreg-felles-typer-schema.yaml` inn i `allSchemas`. Problemet ligg eit steg lenger inn: **denne fila definerer utelukkande ein `types:`-seksjon** (53 gjenbrukbare primitiv-/avleidde typar som `Tekst50`, `Epostadresse`, `URL`, `AnyURI`, `DateTime` osv. — stadfesta ved å lese fila direkte frå GitHub), ingen `classes:` og ingen `enums:`.

`collectImportedEntities()` (`importResolver.ts:282-313`), som er heile grunnlaget for "kva finst i importerte skjema"-logikken i appen, ser berre på `classes` og `enums`:

```ts
export interface ImportedEntity {
  name: string;
  type: 'class' | 'enum';   // <- ingen 'type'-variant
  ...
}
...
for (const name of Object.keys(schema.schema.classes)) { entities.push(...) }
for (const name of Object.keys(schema.schema.enums)) { entities.push(...) }
// schema.schema.types vert aldri lest
```

Same avgrensing finst i `findMissingImport()` (linje 320-352) — både "er dette alt løyst lokalt"-sjekken (`rangeName in activeSchema.schema.classes || rangeName in activeSchema.schema.enums`, manglar `.types` **også for den AKTIVE skjemaet sine eigne lokale typar**, eit lite ekstra funn i seg sjølv) og "finst dette namnet i eit anna lasta skjema"-søket (`rangeName in schema.schema.classes || rangeName in schema.schema.enums`).

Sidan `types:` er ein fullverdig, dokumentert LinkML-mekanisme (nettopp meint for gjenbrukbare skalar-/avleidde-typar på tvers av skjema — akkurat slik brreg brukar han her, jf. kommentaren i `brreg-felles-typer-schema.yaml`: *"Skjemaet er den felles kjelda for typar som elles vart lokalt (og inkonsistent) redefinert i kvart av dei sju enhetsregisteret-*-skjemaa"*), og appen sitt eige `LinkMLSchema.types`-felt alt vert parsa/serialisert og brukt for VALIDERING AV DEN AKTIVE skjemaet (`validation/index.ts:112`, `allTypeNames = new Set(Object.keys(schema.types))`), er dette eit reelt hol: informasjonen finst i modellen, men forsvinn heilt i det han skal delast på tvers av skjema.

**Kartlagt nedstraums-konsekvens** (alle stadfesta ved å følgje kvar `ImportedEntity`/`collectImportedEntities`/`findMissingImport` vert brukt):

| Forbrukar | Fil | Konsekvens av at `types:` manglar |
|---|---|---|
| Validering av range-referansar | `validation/index.ts` (`ExternalNames`-interface, `isValidRange()`) + `ValidationPanel.tsx:198-201` (bygger `externalNames` frå `collectImportedEntities`) | Ein slot med `range: Tekst50` (definert i `brreg-felles-typer`, ikkje lokalt) vert flagga som **falsk positiv "range finst ikkje"-feil** — sjølv om typen er korrekt importert og hentinga lukkast. Dette er truleg akkurat det brukaren observerte som "innhaldet har ikkje blitt lest inn". |
| Ghost-nodar / kryssande-skjema-visning på canvas | `SchemaCanvas.tsx` (2 kallstader), `DisplayPanel.tsx`, `deriveGraph.ts`, `autoLayout.ts` (alle tek `ImportedEntity[]`) | Importerte typar vert aldri vist som tilgjengelege ghost-element — usikkert kor synleg dette er i praksis sidan `types` normalt ikkje treng eigne canvas-nodar (dei er skalarverdiar, ikkje klassar/enums), men det er likevel same rotårsak. |
| Automatisk import ved val av range | `projectSlice.ts:1117-1139` (`autoAddImportForRange`, brukar `findMissingImport`) | Skriv brukaren `Tekst50` som range på ein slot i eit skjema som ALT har tilgang til `brreg-felles-typer` (men manglar akkurat den import-lina), vert IKKJE import-lina automatisk lagt til — funksjonen finn ikkje typen fordi søket berre ser på `classes`/`enums`. |

## Forslag til forbetring

### Funn 1 — filending på absolutte URL-imports

**A1 (tilrådd).** Bruk same filending-normalisering i `loadSchemaFromUrl()` som alt finst i `resolveImportAsUrl()`: trekk ut ein delt `withYamlExtension(url: string): string`-hjelpefunksjon, og kall han på `resolvedUrl` før `fetch()` i `loadSchemaFromUrl`. Dette gjer at absolutte og relative URL-imports oppfører seg likt (slik LinkML sjølv forventar — extension-lause `imports:`-oppføringar er normalen, ikkje unntaket).

**A2 (tilrådd, uavhengig av A1 — feilhandtering).** Per CLAUDE.md sitt "No silent failures"-prinsipp: ein import som ikkje kan hentast (404, nettverksfeil, ugyldig YAML) skal IKKJE berre forsvinne stille. `resolveImports()` bør samle opp kva importar som feila (URL/filsti + årsak) og returnere/eksponere dette slik at UI kan vise det. **Konkretisert i runde 2 (sjå eige avsnitt "Runde 2" nedanfor): brukaren har valt at dette skal visast via det eksisterande toast-systemet** (`pushToast`/`toastQueue` i `uiSlice.ts`, alt brukt for t.d. "Opened ... — use Save to write to a local folder"), ikkje eit nytt/eige varsel-panel.

### Funn 2 — importerte `types:` usynlege

**B1 (tilrådd som minimum, utvida omfang).** Utvid `ImportedEntity['type']` til `'class' | 'slot' | 'enum' | 'type' | 'subset'` (eintal, i tråd med dei fire andre — sjølve LinkML-seksjonen heiter `subsets:`, men kvar oppføring er éin `subset`), og la `collectImportedEntities()` lese alle fem topplevel-seksjonane (`schema.schema.classes`, `.slots`, `.enums`, `.types`, `.subsets`) i staden for berre `classes`/`enums`. Dette gjer at heile spekteret av namngjevne LinkML-element som kan definerast i eitt skjema og delast/refererast frå eit anna (ikkje berre `types`, som var det konkrete symptomet i denne saka, men òg gjenbrukbare schema-level `slots:` og `subsets:`) vert synlege via same, eine mekanisme. `SchemaCanvas.tsx`/`DisplayPanel.tsx`/`deriveGraph.ts`/`autoLayout.ts` tek alt imot `ImportedEntity[]` generisk og treng ingen endring for å FÅ dei nye radene inn i lista — men bør sjåast over for om dei filtrerer eller grupperer på `type`-feltet ein stad, sidan dei to nye variantane (`slot`, `subset`) ikkje oppfører seg som `range`-verdiar på same måte som `class`/`enum`/`type` gjer (ein `subset` er t.d. aldri gyldig som ein slot sin `range`; ein schema-level `slot` kan derimot bli referert via slot-arv/`slot_usage`, ikkje via `range`). B2/B3 under gjeld framleis primært `type`-varianten (det er den som gjev falske valideringsfeil for `range`); om `slot`/`subset`-oppføringar treng tilsvarande valideringsstøtte er ikkje kartlagt her og bør vurderast som eiga oppfølging når B1 er på plass.

**B2 (tilrådd, følgjer av B1).** Legg til `types: Set<string>` i `ExternalNames`-interfacet (`validation/index.ts`), sjekk `externalNames.types.has(range)` i `isValidRange()`, og oppdater `ValidationPanel.tsx:198-201` til å byggje `types`-settet frå `imported.filter(e => e.type === 'type')`. Dette fjernar dei falske positive "range finst ikkje"-valideringsfeilane for importerte typar.

**B3 (tilrådd, følgjer av B1).** Utvid `findMissingImport()` til òg å sjekke `.types` — både i "alt løyst lokalt"-sjekken (legg til `rangeName in activeSchema.schema.types`, som er ein liten separat feil sjølv utan importar involvert) og i "finst i eit anna lasta skjema"-søket (legg til `rangeName in schema.schema.types`). Dette gjer at `autoAddImportForRange` fungerer for importerte typar, ikkje berre klassar/enums.

**B4 (vurdert, ikkje tilrådd som eiga sak).** `collectReferencedImportedEntities()` filtrerer alt på om eit namn er brukt som `range` på eit attributt (`slot.range`) — det steget treng ingen endring for typar, sidan typar berre nokosinne opptrer som `range`, aldri som `is_a`/`mixins`/`union_of`. B1 sitt tillegg til `collectImportedEntities()` gjev automatisk riktig filtrering her òg.

## Testcase / akseptansekriterium

**Funn 1:**
1. Ein `imports:`-oppføring som er ein absolutt `https://`-URL UTAN filending, som berre finst med `.yaml` lagt til på servaren, vert no henta og lagt inn i prosjektet (ny/utvida test i `importResolver.test.ts`, t.d. med ein mocka `fetch` som 404-ar på den nakne URL-en og 200-ar på `<url>.yaml`).
2. Ein import som framleis feilar etter filending-forsøket (verkeleg 404/nettverksfeil) resulterer i eit SYNLEG toast-varsel til brukaren (ikkje berre stille dropp), jf. A2 og "Runde 2" nedanfor.

**Funn 2:**
3. Eit importert skjema som berre inneheld `types:` (ingen `classes`/`enums`) gjev IKKJE lenger falske "range finst ikkje"-valideringsfeilar for slots som brukar ein av desse typane som range (ny test i `validation/index.ts`s testsuite, med `externalNames.types` sett).
4. `collectImportedEntities()` returnerer ein `ImportedEntity` med `type: 'type'` for kvar oppføring i eit importert skjema sin `types:`-seksjon (ny test i `importResolver.test.ts`).
5. `findMissingImport()` finn og føreslår rett import-sti når `rangeName` berre finst som ein `types:`-oppføring i eit anna lasta (men ikkje-importert) skjema, OG når det finst lokalt i `activeSchema.schema.types` (ny test).
6. `pnpm --filter @linkml-editor/core test` og `tsc --noEmit` framleis grøne etter endringane.

## Runde 2 (2026-09-16): bruk toast-systemet for A2, og persister varslingshistorikk for ALLE toastar

Ønske (ordrett): "i dag får eg ein melding (heiter det ein toast?) som legg seg over canvasen når ting skjer f.eks 'Opened \"enhetsregisteret_frivilligorganisasjonapi\" — use Save to write to a local folder' Dette ligg som eit eget element som eg kan klikke vekk ved å trykke på x. Eg tenker vi kan legge synliggjering av feila importar på samme måten. I tillegg ønsker eg at alle meldingar som gis på denne måten persisteres slik at bruker kan finne dei igjen etter at han har klikka dei vekk ved å trykke på x. Gi forslag til korleis dette kan løyses og oppdater specen."

Ja, det heiter ein "toast" (`Toast`-typen i `uiSlice.ts`) — stadfesta i koden.

### Dagens toast-system — kartlagt

- **Type**: `Toast` (`uiSlice.ts:7-12`) — `{ id, message, severity: 'info'|'success'|'warning'|'error', durationMs? }`.
- **State**: `toastQueue: Toast[]` i same fil. `pushToast(toast)` (linje 197-200) legg til med ein ny auto-inkrementert id; `dismissToast(id)` (linje 202-204) fjernar (filtrerer ut) frå `toastQueue` — dette er den EINASTE staden ein toast forsvinn.
- **Rendering**: `ToastList()` i `packages/web/src/main.tsx:262-278` — ein fast posisjonert stack nede i midten av skjermen (`position: fixed; bottom: 32; ...; zIndex: 3000`). Kvar toast har ein `<X>`-knapp (via `lucide-react`) som kallar `dismissToast(t.id)`. Fargar per `severity` kjem frå eksisterande CSS-tokens (`--color-state-{success,warning,error}-{bg,border,fg}`).
- **7 eksisterande kallstader** (`pushToast(...)`) — `CloneDialog.tsx`, `ImportSchemaDialog.tsx` (×2), `OpenSchemaFromUrlDialog.tsx`, `NewSchemaDialog.tsx`, `main.tsx` (sync-feil), `AppSettingsDialog.tsx` — alle set `durationMs` (2000-4000ms).
- **Overraskande funn under kartlegginga**: `durationMs` vert ALDRI lese nokon stad i koden — ingen `setTimeout`/auto-dismiss-logikk finst verken i `ToastList`, `pushToast`, eller elles. I praksis betyr det at toastar i dag KUN forsvinn ved eksplisitt X-klikk, akkurat slik brukaren beskriv — `durationMs`-feltet er daud kode som antyder ein tiltenkt auto-dismiss-oppførsel som aldri vart kopla saman med visinga. Ikkje del av denne saka å fikse (ikkje det brukaren spurte om), men verdt å nemne sidan det er relevant kontekst for punktet under — kan takast som eiga, uavhengig oppfølgingssak.
- **Ingen persistering i dag**: `toastQueue` er rein in-memory Zustand-state. Ved sideoppdatering forsvinn heile queue; ved X-klikk forsvinn meldinga for godt — det finst ingen historikk å slå opp i.

### A2 konkretisert: bruk toast-systemet for feila importar

- `resolveImports()` (`importResolver.ts`) endrar returtype frå `Promise<SchemaFile[]>` til t.d. `Promise<{ loaded: SchemaFile[]; failed: FailedImport[] }>`, der `FailedImport = { importPath: string; reason: string }`. `reason` skal vere den ærlege, ikkje-gjetta feilteksten (HTTP-status, `parseYaml`-feil, e.l.) — jf. CLAUDE.md sitt "no security-by-obscurity"-prinsipp (same standard som `classifyFetchError` alt følgjer for CORS-saka i `specs/done/url-fetch-cors-error-mislabeling.md`).
- Kallstadene i `projectLoader.ts` (`openProjectFromDirectory`, `openSchemaFromUrl`) sender `failed`-lista vidare ut som eit ekstra felt på sitt returverdi — ein feila import skal framleis IKKJE blokkere resten av prosjektet frå å opne.
- UI-kallstadene som alt kallar `pushToast` ved vellukka opning (`OpenSchemaFromUrlDialog.tsx`, tilsvarande stad for `openProjectFromDirectory` i `SplashPage.tsx`/`main.tsx`) legg til: for kvar oppføring i `failed`, eitt `pushToast({ message: 'Could not load imported schema "${importPath}" — ${reason}', severity: 'warning' })`. Ved fleire samtidige feil: vurder å samle til éin toast ("3 imports could not be loaded — see notification history") for å unngå å spamme skjermen med ein stack av like toastar — full detalj ligg uansett i historikken (sjå under).

### Tilleggsforslag: persistert varslingshistorikk for ALLE toastar (generelt behov, ikkje avgrensa til import-feil)

**1. Datamodell.** Legg til `createdAt: string` (ISO-tidsstempel) på `Toast`-typen, og eit nytt `toastHistory: Toast[]` i `uiSlice.ts`, separat frå `toastQueue`. `pushToast()` skal leggje den nye toasten til i BÅDE `toastQueue` (synleg overlay, som i dag) OG `toastHistory` (varig liste). `dismissToast(id)` skal FRAMLEIS berre fjerne frå `toastQueue` — oppføringa i `toastHistory` skal IKKJE forsvinne ved X-klikk (det er heile poenget med ønsket). Kapp historikken ved t.d. 100 oppføringar (FIFO-utkasting av dei eldste) for å unngå ubegrensa vekst.

**2. Kor skal historikken visast.** Eit nytt, lite bjølle-/klokke-ikon i app-toppteksten (naturleg plassering: ved sida av sync-status-indikatoren i `main.tsx`, som alt viser global appstatus) som — når klikka — opnar ein dropdown/panel med `toastHistory`, nyaste øvst, kvar rad med tidsstempel + severity-farge (gjenbruk dei eksisterande `toastStyles`-fargane frå `ToastList`). Eit bade-tal for "n nye sidan sist opna" er ei naturleg vidareutvikling, men ikkje kritisk for kjernebehovet og kan utsetjast.

**3. Persistering over sideoppdatering — treng eit val frå brukaren:**
   - **Alt. 1 (enklast, tilrådd som fyrste steg).** Berre in-memory (Zustand-state) — historikken forsvinn ved sideoppdatering/appstart, akkurat som anna UI-ephemeral-state i dag (canvas/UI-state er alt medvite utelate frå undo/redo-persisteringa via zundo sin `partialize`, jf. CLAUDE.md sitt "State Management"-avsnitt). Løyser brukaren sitt konkrete problem ("eg klikka meldinga vekk, kor vart ho av") innanfor éin økt, som truleg dekker dei fleste tilfella (fann ein feil under aktivt arbeid, vil sjå att den seinare same økt).
   - **Alt. 2 (persisterer over reload).** Lagre `toastHistory` i `localStorage`, same mønster som t.d. `HIDDEN_EDGE_TYPES_KEY` alt brukar i `uiSlice.ts`. Krev i tillegg ein tids- eller talbasert utryddingsregel (t.d. slett oppføringar eldre enn 7 dagar, i tillegg til 100-taket) for å ikkje la `localStorage` vekse ubegrensa over tid.

  **Tilråding**: start med Alt. 1 — minst, mest reversibelt, og dekker det brukaren konkret spurte om. Alt. 2 kan leggjast til som eiga oppfølging dersom det viser seg at brukarar faktisk saknar varsel etter ein reload.

### Testcase / akseptansekriterium (tillegg, runde 2)

7. `pushToast()` legg til oppføringa i BÅDE `toastQueue` og `toastHistory`; `dismissToast(id)` fjernar KUN frå `toastQueue` (ny test i `uiSlice`-testsuiten som stadfestar at historikken framleis inneheld oppføringa etter dismiss).
8. Ein feila import (Funn 1) gjev eit synleg warning-toast med den ærlege feilteksten (ikkje ei gjetta diagnose), og oppføringa er framleis å finne i varslingshistorikk-panelet etter at brukaren har lukka toasten med X.
9. `toastHistory` er kappa til eit maks-antal (t.d. 100) — ein test som pushar fleire enn cap-grensa stadfestar at dei eldste oppføringane vert kasta ut (FIFO), ikkje dei nyaste.
10. `pnpm --filter @linkml-editor/core test` og `tsc --noEmit` framleis grøne etter endringane.

## Ope spørsmål — status etter "utfør anbefalte tiltak"

- **B1-B3**: implementert i same runde (sjå Implementering).
- **Alt. 1 vs. Alt. 2** (varslingshistorikk-persistering): Alt. 1 (in-memory, session-only) implementert, sidan det var den uttrykte tilrådinga. Alt. 2 (`localStorage`-persistering over reload) er IKKJE gjort — står som open oppfølging dersom brukarar sakner varsel etter ein reload.
- **Samla vs. individuelle toastar**: løyst som "kombiner til éin toast når >1 feilar" (sjå `summarizeFailedImports` i Implementering) — matchar spec-teksten sin leaning ("vurder å samle... for å unngå å spamme skjermen").
- **`durationMs`-funnet**: framleis IKKJE rydda opp i, med vilje — dette var eksplisitt markert som ei eiga, ikkje-tilrådd sak i planen, og "utfør anbefalte tiltak" dekte berre dei tiltaka som faktisk var merka tilrådd. Står open til brukaren eksplisitt ber om det.

## Implementering (2026-09-16)

Alle tilrådde tiltak implementert etter brukaren sa "utfør anbefalte tiltak". Kort oversikt, sjå commit-diff for fullt detaljnivå:

**A1** — `withYamlExtension()` trekt ut som delt hjelpefunksjon i `importResolver.ts`, brukt av `resolveImportAsUrl()`, `resolveImportPath()` OG (nytt) `loadSchemaFromUrl()`/import-køen sin URL-gren, slik at absolutte URL-imports utan filending no får `.yaml` lagt til akkurat som relative-til-URL-imports alt gjorde.

**A2** — `resolveImports()` returnerer no `{ loaded, failed }` i staden for ei flat liste (`FailedImport = { importPath, reason }`, `reason` er den rå, ikkje-gjetta feilteksten). `openProjectFromDirectory()` og `openSchemaFromUrl()` i `projectLoader.ts` sender `failedImports` vidare ut i returverdien sin. Ny delt `summarizeFailedImports()`-hjelpefunksjon byggjer éin toast-melding (kombinert til éitt oppsummerande toast ved fleire samtidige feil). Kalla frå alle stadene som alt kalla `pushToast` ved vellukka prosjekt-/skjema-opning: `CloneDialog.tsx`, `SplashPage.tsx` (× 2), `OpenSchemaFromUrlDialog.tsx`, `ProjectSwitcherDialog.tsx`, samt E2E-testkroken `openProjectFromPath` i `main.tsx`.

**B1** — `ImportedEntity['type']` utvida til `'class' | 'slot' | 'enum' | 'type' | 'subset'`; `collectImportedEntities()` les no alle fem topplevel-seksjonane.

**B2** — `ExternalNames` (`validation/index.ts`) fekk eit `types: Set<string>`-felt, sjekka i `isValidRange()`. `ValidationPanel.tsx` og default-verdien i `validationSlice.ts` oppdatert til å byggje/sende dette feltet.

**B3** — `findMissingImport()` sjekkar no òg `.types`, både i "alt løyst lokalt"-sjekken (som no òg dekker den vesle separate lokale-typar-feilen som blei nemnd i planen) og i "finst i eit anna lasta skjema"-søket.

**Toast-historikk** — `Toast` fekk eit `createdAt`-felt; nytt `toastHistory: Toast[]` i `uiSlice.ts` (kappa til `TOAST_HISTORY_CAP = 100`, FIFO). `pushToast()` legg til i begge listene, `dismissToast()` rører framleis berre `toastQueue`. Ny `clearToastHistory()`-action. Ny UI-komponent `packages/web/src/components/NotificationHistoryButton.tsx` — ei bjølle i app-headeren (ved sida av `SyncStatusIndicator`) som opnar ein dropdown med heile historikken, nyaste øvst, med relativ tidsstempel og severity-farge, pluss ein "Clear"-knapp.

### To konsekvens-feil oppdaga og retta undervegs (ikkje eksplisitt i den opphavlege planen)

1. **URL-normaliserings-konsistens.** `collectImportedEntities()` og `findMissingImport()` bygde `activeImports`/`currentImportPaths` frå den RÅ, ikkje-normaliserte import-strengen for absolutte URL-imports (`activeImports.add(imp)`), medan det faktisk lasta `SchemaFile.filePath` (sett av `loadSchemaFromUrl`) alltid er normalisert (github-blob-omskriving + `.yaml`-filending). Utan ein fiks her ville A1 sin fetch-fiks ha lukkast reint nettverksmessig, men det henta skjemaet ville likevel ALDRI blitt attkjent som "importert av" det aktive skjemaet — same symptom som brukaren opphavleg rapporterte, berre flytta eitt steg lenger inn i koden. Retta med ein delt `normalizeUrlImport()`-hjelpefunksjon brukt konsekvent alle fire stadene som samanliknar import-strengar mot `filePath`.
2. **Canvas-rendering-vakt for dei nye entity-typane.** B1 sitt utvida `ImportedEntity['type']` ville utan vidare tiltak ha øydelagt ghost-node-rendering: `deriveGraph.ts` og `autoLayout.ts` grein `if (entity.type === 'class') {...} else {...enum-rendering...}` — ein `slot`/`type`/`subset`-entity ville falle i `else`-greina og prøve å rendere som ein enum-node med `enumDef: undefined`. Ny delt `isGraphNodeEntity()`-hjelpefunksjon (eksportert frå `importResolver.ts`) brukt til å filtrere desse ute FØR dei når node-oppretting, i `deriveGraph.ts`, `autoLayout.ts`, og dei to stadene i `DisplayPanel.tsx`/`SchemaCanvas.tsx` som byggjer eit ghost-namn-sett for utval/hop-dimming (der feilen ville vore stillegåande feil oppførsel, ikkje ein krasj, men framleis feil). Dette var noko B4 i planen (feilaktig) konkluderte ikkje trengde eiga handtering — retta.

**Verifisert:**
- `tsc --noEmit` på `@linkml-editor/core`: ingen feil.
- `tsc --noEmit` på `@linkml-editor/web` (etter mellombels `pnpm --filter @linkml-editor/core build`, `dist/`+`tsconfig.tsbuildinfo` fjerna etterpå): ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: ingen feil.
- `scripts/check-token-usage.sh`: PASS.
- `packages/core` test-suite: køyrt fleire gonger pga. kjend `[vitest-pool-runner]`-infrastrukturflakigheit (jf. `node-pnpm-fallback`-skillen). Kvar testfil som faktisk starta, på tvers av alle køyringar, hadde 100 % grøne testar — 0 reelle assertion-feil. Alle nye/endra testfiler (`importResolver.test.ts` — 67 testar, `validation.test.ts` — 56 testar, nye `uiSlice.test.ts` — 5 testar, `ghostNodes.test.ts` — 8 testar, `autoLayout.test.ts` — 48 testar) stadfesta grøne via målretta køyringar (`vitest run --environment node <fil>`).

## Runde 3 (2026-09-16): "brreg-felles-typer viser framleis ikkje noko innhald" etter rebygg/deploy

Ønske (ordrett): "etter rebygg og deploy ser eg at dcat-ap-no, common-ap-no og dqv-core skjema er importert og viser alle class, slot og enums, mens brreg-felles-typer ikkje viser noko innhold"

**Viktig: dette er IKKJE ein regresjon i A1/A2/B1-B3 (implementeringa over).** Nettverks-henting, `collectImportedEntities()`, valideringa og `findMissingImport()` fungerer no korrekt for `brreg-felles-typer` sine 53 `types:`-oppføringar — stadfesta av testane i "Implementering". Det brukaren observerer her er ei HEILT ANNA, djupare årsak: **ingen visningsflate i appen (canvas, Outline View, Table View) har NOKON gong hatt rendering-støtte for `types:`** — verken for eit aktivt skjema eller eit importert eitt. Dette gjeld likt for ALLE skjema, ikkje berre importerte, og er difor eit langt breiare, pre-eksisterande hol enn det B1-B3 dekte (B1-B3 gjorde `types` SYNLEGE for valideringa/cross-schema-oppslag, men aldri lova ein eigen VISUELL representasjon).

### Stadfesta i koden — tre uavhengige stader, same mønster

**Outline View** (`packages/core/src/canvas/OutlineView.tsx`) byggjer rader utelukkande frå to seksjonar:
```ts
// linje 225
rows.push({ kind: 'section', label: 'Classes' });   // + slots nøsta under kvar klasse (collectSlots)
// linje 238
rows.push({ kind: 'section', label: 'Enums' });
```
Ingen tredje seksjon for `types` (eller `subsets`) finst. Dette forklarer nøyaktig brukaren sin observasjon: dei tre andre skjemaa (som har ekte `classes:`, med sine `slots:` vist nøsta under kvar klasse, pluss `enums:`) fyller ut "Classes" (+ nøsta slots) og "Enums"-seksjonane heilt normalt — difor "viser alle class, slot og enums". `brreg-felles-typer` har 0 classes og 0 enums → BEGGE seksjonane vert tomme → heile Outline View-treet for det skjemaet vert blankt, sjølv om skjemaet er korrekt lasta og dei 53 typane finst i modellen.

**Table View** (`packages/core/src/canvas/TableView.tsx:406`):
```ts
return deriveRows(rowType, schemaId, schema.classes ?? {}, schema.enums ?? {}, visibleNames);
```
Same avgrensing — `deriveRows` tek berre imot `classes`/`enums`, aldri `types`.

**Canvas** (`packages/core/src/canvas/deriveGraph.ts`, hovudløkka for DET AKTIVE skjemaet sitt EIGE innhald — ikkje ghost-entity-løkka frå B1/Funn 2, som alt er retta): itererer utelukkande `schema.classes`/`schema.enums` (fleire stader, t.d. linje 125, 241, 251). Eit skjema med berre `types:` ville difor vist eit HEILT TOMT canvas sjølv om det vert opna direkte som det aktive skjemaet (ikkje berre når det er importert).

**Sekundært, mindre funn — same mønster, ein fjerde stad:** `ProjectPanel.tsx` sine per-skjema "innhald"-badgar i både "Project Files"- og "Imports"-seksjonen viser berre eit klasse-tal og eit enum-tal:
```ts
// linje 291-292 (Project Files) og 354-355 (Imports)
const classCount = Object.keys(sf.schema.classes).length;
const enumCount = Object.keys(sf.schema.enums).length;
```
For `brreg-felles-typer` ville dette vist "0 ⬡ · 0 ◆" i imports-lista — ser ut som "tomt skjema" sjølv om det har 53 typar. Mindre kritisk enn Outline/Table/Canvas-funnet (det er berre eit statistikk-badge, ikkje sjølve innhaldsvisinga), men same rotårsak, verdt å fikse saman.

### Forslag til forbetring

**C1 (tilrådd for Outline View og Table View).** Legg til ein tredje seksjon "Types" i `OutlineView.tsx` (lista flatt, utan nøsting sidan typar ikkje har eigne "slots" eller arv-hierarki å vise nøsta innhald for — berre namn + evt. `base`/`uri`/`description`) og tilsvarande i `TableView.tsx` (ein tredje `rowType` for typar, kolonner tilpassa `TypeDefinition`-felta: `uri`, `base`, `typeof`, `description` — ikkje dei klasse-/enum-spesifikke kolonnane). Dette er den mest direkte fiksen på det brukaren faktisk melde.

**C2 (vurdert, meir usikker — canvas).** Canvas er vanskelegare: ein `type` er ein skalarverdi, ikkje ei ERD-boks med relasjonar, så eit vanleg klasse-/enum-node-design passar dårleg. Alternativ:
  - **C2a**: la canvas vise ei enkel, kompakt "Types"-liste-boks (éin node per skjema som listar alle typane sine namn, IKKJE éin node per type) i eit hjørne av canvaset, analogt med korleis nokre ER-diagram-verktøy viser domenetypar i ei sidefelt-boks.
  - **C2b**: ikkje prøv å visualisere typar på canvas i det heile — canvas er meint for ERD-relasjonar (klassar/enums), og typar høyrer betre heime i Outline/Table View (tekst-baserte visingar) pluss PropertiesPanel sin range-nedtrekksliste (som alt viser typenamn via B1-fiksen, som range-val). Utoler brukaren at canvas skal vere "the one true view" for alt, eller er Outline/Table nok for typar spesifikt?
  
  Uklart kva brukaren faktisk forventar her — bør avklarast før nokon kode vert skriven for C2, sidan dei to alternativa har heilt ulikt omfang (C2a er ny UI-komponent, C2b er "ingen endring, dokumenter avgrensinga").

**C3 (tilrådd, liten uavhengig fiks).** Legg til eit tredje "types"-tal-badge (med eit eige eksportert `Type`/liste-ikon, t.d. gjenbruk `Diamond`- eller eit nytt enkelt ikon) ved sida av klasse-/enum-badgane i `ProjectPanel.tsx`, begge stadene (linje 291-292 og 354-355).

### Testcase / akseptansekriterium (runde 3)

11. Eit skjema som berre inneheld `types:` (som `brreg-felles-typer`) viser ein synleg "Types"-seksjon i Outline View med alle typenamna lista, i staden for eit heilt blankt tre.
12. Same skjema viser ein "Types"-rad-type i Table View med typane sine felt (uri/base/description).
13. `ProjectPanel.tsx` sine badgar for eit slikt skjema viser eit types-tal > 0, ikkje berre "0 ⬡ · 0 ◆" som ser ut som eit tomt skjema.
14. (Berre dersom C2a vert valt) Canvas viser ei eiga, ikkje-ERD types-liste-boks for eit slikt skjema; (dersom C2b vert valt) ingen canvas-endring, men avgrensinga er dokumentert ein synleg stad for brukaren (t.d. tooltip/melding når eit `types`-only skjema opnast på canvas og viser tomt).

## Svar frå brukaren (runde 3, via AskUserQuestion)

- **Kva visingsflate**: alle fire — Outline View, Table View, Canvas, ProjectPanel sine importer-badgar.
- **Canvas-tilnærming**: **C2b** valt eksplisitt — ikkje vis typar på canvas i det heile; dokumenter avgrensinga i staden.

Dette godkjenner C1 (Outline + Table) og C3 (ProjectPanel-badgar) i sin heilskap, og avgjer C2 til fordel for alternativ B (ingen ny canvas-komponent).

## Implementering (2026-09-16, runde 3)

**C1 — Outline View** (`packages/core/src/canvas/OutlineView.tsx`): ny `TypeRow`-variant på `OutlineRow`-unionen; `deriveOutlineRows()` legg til ein tredje, flat "Types"-seksjon (ingen nøsting — ein type har ingen underelement å ekspandere, ulikt ein klasse). Kvar rad viser typenamnet + `base`/`uri` som eit lite badge, med `description` som tooltip. Typerader er medvite IKKJE del av `navigableIds` (tastatur-nav) sidan det ikkje finst noka `ActiveEntity`/PropertiesPanel-støtte for typar å navigere TIL.

**C1 — Table View** (`packages/core/src/canvas/TableView.tsx`): `RowType` utvida med `'types'`; ny `TypeRow`, `buildTypeColumns()` (Name/base/uri/Description) og eit fjerde faneval i rad-type-veljaren. Kolonnene er medvite READ-ONLY (ingen `TextCell`/mutasjon-kall) sidan det ikkje finst nokon `updateType()`-store-mutasjon å kople inline-redigering til — å leggje det til var utanfor omfanget av dette funnet.

**C3 — ProjectPanel** (`packages/core/src/editor/ProjectPanel.tsx`): tredje badge (`Type`-ikonet frå `lucide-react`, re-eksportert som `TypeIcon` i `ui/icons/index.ts`) lagt til begge stadene (Project Files- og Imports-seksjonen), vist berre når `typeCount > 0` (i motsetnad til klasse-/enum-badgane, som alltid vert viste — færre skjema har eigendefinerte typar enn klassar, så eit alltid-synleg "0"-badge ville berre vore støy).

**C2b — Canvas** (`packages/core/src/canvas/SchemaCanvas.tsx`): ny tidleg-return rett etter "No schema open"-tilstanden — dersom det aktive skjemaet har 0 klassar, 0 enums, OG (types > 0 ELLER schema-level slots > 0 ELLER subsets > 0), OG det faktisk ikkje finst nokon canvas-nodar (heller ikkje ghost-nodar frå importar), vert ei forklarande melding vist ("No classes or enums to display — ... Switch to Outline or Table view...") i staden for eit blankt ReactFlow-canvas som elles ville sett ut som ein lasting-/importfeil.

### Verifisert visuelt (ikkje berre tsc/lint/unit-testar)

Per CLAUDE.md sitt krav om å faktisk prøve UI-endringar i nettlesar: `pnpm dev` starta, to test-skjema laga (eitt med `Person`-klasse + `Status`-enum, eitt med BERRE to `types:`-oppføringar, parallelt med den verkelege `brreg-felles-typer`-saka), servert over ein lokal CORS-aktivert HTTP-server, og opna via "Open Schema from URL" med Playwright (`chromium.launch()`, ikkje berre eit statisk `import`/typecheck). Stadfesta med skjermbilete:
- **Types-only-skjemaet**: Outline View viser "TYPES"-seksjon med begge typane + `base`-badge; Table View sin nye "types"-fane viser Name/base/uri/Description-kolonnene korrekt; ProjectPanel-badgen viser "⬡ 0 · ◇ 0 · T 2"; Canvas viser den nye forklarande tomt-meldinga i staden for eit blankt lerret.
- **Klassar+enum-skjemaet** (regresjonssjekk): Canvas, Outline og Table (classes/types-faner) framleis heilt uendra oppførsel — Person-klassen og Status-enumen renderer normalt, types-fana viser "0 rows" utan å krasje.
- Ingen NYE konsoll-feil introdusert (éin pre-eksisterande, urelatert React-hydration-åtvaring om nøsta knappar i "Views"-seksjonen av ProjectPanel dukka opp i begge køyringane — uendra av desse endringane).

**Verifisert elles:**
- `tsc --noEmit` på `@linkml-editor/core` og `@linkml-editor/web`: ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: ingen feil.
- `scripts/check-token-usage.sh`: PASS.
- Målretta `vitest run --environment node` på alle testfiler nær koden som vart endra (`uiSlice.test.ts`, `importResolver.test.ts`, `validation.test.ts`, `ghostNodes.test.ts`, `autoLayout.test.ts`): 182/182 grøne, 2 todo.
- **Ikkje gjort**: ingen nye automatiserte (unit- eller E2E-)testar for sjølve Outline/Table/ProjectPanel/Canvas-rendering-endringane — desse komponenta hadde ingen eksisterande unit-testdekning for rad-avleiingslogikken sin frå før (`deriveOutlineRows`/`deriveRows` er ikkje eksporterte), og å endre modul-overflata berre for å teste var vurdert som utanfor omfanget av dette funnet. Playwright-skjermbileta over er difor det einaste beviset — vurder å leggje til E2E-dekning for Outline/Table sine "types"-visingar som eiga oppfølging dersom dette området held fram å endre seg.
