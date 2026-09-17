# Spec: Undo/Redo i Properties Panel verkar ikkje synleg, pluss forslag til ein edit-trail/endringslogg

Status: **Del 1 implementert og verifisert, inkludert ei oppfølgingsrunde etter manuell brukartesting.** Første runde: equality-fiks, alternativ (a) med korrigert burst-wrapper, reaktiv `useTemporalStore` + disabled-tilstand. Oppfølgingsrunde (same dag, funne under manuell testing): prosjekt-opning/-lukking vart feilaktig sjølv ei undo-oppføring (Undo tok brukaren attende til "Open from URL"-skjermbiletet) — fiksa med `guardProjectLifecycleFromTemporalHistory`; i tillegg oppdaga (under skriving av regresjonstestar) at burst-grupperinga forseinka *alle* handlingar opptil 500ms før dei vart undo-bare, ikkje berre tekstfelt-utbrot — fiksa med ein `flush()`-mekanisme kalla frå `undo()`/`redo()`. Sjå `packages/core/src/store/index.ts`, `store/temporalHandleSet.ts`, `store/temporalProjectGuard.ts`, `editor/PropertiesPanel/index.tsx`, og dei tre nye testfilene i `store/__tests__/`. **Del 2 (edit-trail/endringslogg) står framleis som ope forslag, ventar på val av alternativ A/B/C/D/E.**
Dato: 2026-09-17 (Del 1 implementert same dag, etter godkjenning av alternativ (a); oppfølgingsrunde same dag, etter brukaren sin manuelle test)

Bakgrunn (ordrett frå brukaren): "Eg ser at Properties panelet har ein "undo" og "redo" knapp som betyr at vi allerede må ta vare på state knytta til endringar som blir gjort. Eg observerer at det ser ikkje ut til å ha nokon effekt når eg trykker på disse knappane. Eg ønsker at dette wires opp slik at det fungerer som tiltenkt. Eg ønsker meg også ein edit-trail som viser ein log over alle endringar som er utført på eit linkml skjema. Så ønsker eg muligheten til å spole fram og tilbake i denne logen og at endringane skal vises i resten av applikasjonen både i hovedcanvaset der vi tegner ein grafisk representasjon, i Properties panelet og i YAML Preview panelet."

Dette er to relaterte, men uavhengig implementerbare, delar: (1) ein bug-fiks av eksisterande Undo/Redo, og (2) ein ny funksjon (edit-trail/endringslogg) som byggjer vidare på det same underliggande mekanismen. Del 1 bør implementerast fyrst uavhengig av kva som vert valt i Del 2.

## Del 1: Kvifor Undo/Redo ikkje verkar som venta

### Kva som alt er på plass

`packages/core/src/store/index.ts:14-37` set opp Zustand-storen med `zundo`s `temporal()`-middleware, `partialize`t til `{ activeProject, activeSchemaId }` og `limit: 50`. Både `MenuBar.tsx:237-240` og `PropertiesPanel/index.tsx:23-28` kallar den ekte `temporal.getState().undo()`/`.redo()` — knappane er **ikkje** død kode eller feil-kopla til ingenting. Dette stadfestar at premissen i spørsmålet ("vi må jo alt ta vare på state") er rett, og at problemet ligg i *kva* som vert lagra, ikkje i sjølve knappe-kallet.

### Rotårsak A (hovudårsak) — zundo manglar `equality`, så *alt* som skjer i heile storen pushar historie

`zundo`s middleware (`node_modules/zundo@2.3.0/dist/index.js:71-88`) legg seg rundt **heile** storen sin `set`-funksjon — ikkje berre `ProjectSlice` sine mutatorar. Sidan `AppStore` er sett saman av 7 slices (`ProjectSlice`, `CanvasSlice`, `EditorSlice`, `GitSlice`, `UISlice`, `ValidationSlice`, `ViewsSlice`) som alle deler éin `set`, går *kvart* `set()`-kall — inkludert reint kosmetiske ting som canvas pan/zoom (`setViewport`), node-val (`setSelection`), collapse/expand av ein node, panel-breidde, valideringskøyring osv. — gjennom denne same koden.

Utan ein konfigurert `equality`- (eller `diff`-)funksjon, avgjer zundo om ei historieoppføring skal pushast slik (forenkla frå kjeldekoden):

```js
if (!(deltaState === null || options?.equality?.(pastState, currentState))) {
  curriedHandleSet(pastState, undefined, currentState, deltaState);
}
```

Med `equality` og `diff` begge `undefined` er dette alltid `true` — **det pushast ei ny historieoppføring på kvart einaste `set()`-kall i heile applikasjonen**, heilt uavhengig av om `activeProject`/`activeSchemaId` faktisk endra seg.

**Stadfesta empirisk** (skrive ein throwaway-test mot ein realistisk store sett saman av `ProjectSlice` + `CanvasSlice` med same zundo-konfig som i `store/index.ts`, køyrd, og sletta att):

```
pastStates before pan: 2
pastStates after 10 setViewport calls: 12   // +10 — reint kosmetiske pan-kall pushar historie 1:1
```

```
classes after 1 undo (post-pan): [ 'A' ]    // klassen er FRAMLEIS der!
```

Dvs.: brukaren legg til ein klasse, panorerer/zoomar litt på canvaset (heilt normal arbeidsflyt — "sjå kva eg nettopp teikna"), trykkjer så Undo éin gong for å angre klassen — og ingenting synleg skjer, fordi den næraste historieoppføringa berre er ein identisk kopi av `activeProject` frå panorerings-kallet. Brukaren må trykkje fleire gongar før noko faktisk endrar seg, noko som ser ut som "knappen verkar ikkje" sjølv om `undo()` teknisk sett køyrer korrekt kvar gong.

Med `limit: 50` betyr dette òg at ei enkelt dra-i-canvaset-rørsle (som lett genererer titals `setViewport`-kall) eller ein enkelt valideringskøyring kan **skuve ut** reelle, meiningsfulle skjema-endringar av ring-bufferet før brukaren i det heile prøver å angre dei.

### Rotårsak B — kvart tastetrykk i tekstfelt er si eiga historieoppføring

`packages/core/src/ui/fields/TextArea.tsx:20` (brukt m.a. for klasse-/enum-skildringar i `ClassPanel.tsx:134-137`) kallar `onChange={(e) => onChange(e.target.value)}` — altså éin gong per tastetrykk, ikkje ved blur/Enter. Kvart tastetrykk går via `update()` → `updateClass()` → eit `set()`-kall, som (jf. Rotårsak A) blir si eiga historieoppføring. Å skrive ei 20-teikns skildring lagar dermed 20 historieoppføringar for det brukaren tenkjer på som *éi* logisk endring. Kombinert med den 50-lange grensa forsvinn reelle tidlegare endringar fort under normal tekstredigering.

### Sekundært, mindre alvorleg funn — `useTemporalStore()` er ikkje reaktiv

`store/index.ts:47`: `useTemporalStore` kallar `.temporal.getState()` direkte, som gjev eit **snapshot**, ikkje eit abonnement. `MenuBar.tsx:239-240` bruker dette til `disabled: temporal.pastStates.length === 0` — denne verdien kan bli "hengande etter" til komponenten uansett re-renderer av annan grunn. Dette forklarer *ikkje* hovudsymptomet (knappane i Properties Panel har ikkje noko `disabled`-attributt i det heile, jf. `PropertiesPanel/index.tsx:68-73`), men bør ryddast opp i same slengen for korrekt disabled-tilstand.

### Forslag til fiks (Del 1)

1. **Legg til ein `equality`-funksjon i zundo-konfigurasjonen** (`store/index.ts:26-33`) som samanliknar `activeProject`/`activeSchemaId`-referansane før/etter:
   ```ts
   equality: (a, b) => a.activeProject === b.activeProject && a.activeSchemaId === b.activeSchemaId,
   ```
   Dette er trygt fordi alle reelle skjema-mutatorar i `projectSlice.ts` allereie byggjer ein **ny** `activeProject`-referanse immutabelt (sjå `patchSchema()`, linje 111-124, og tilsvarande spreadingar elles i fila), medan ingen av dei andre 6 slicene nokon gong rører `activeProject`. Referanse-likskap er dermed tilstrekkeleg — ingen dyr deep-equal treng leggjast til. Dette eliminerer heile Rotårsak A utan å røre noka mutator-metode.

2. **Slå saman tastetrykk til éi historieoppføring per logisk redigering.** To alternativ, utdjupa under: (a) debounce/throttle av zundo sin `handleSet`-hook, (b) commit-on-blur/Enter i sjølve tekstfelta.

### Utdjuping av alternativ (a) — debounce/throttle av `handleSet`

**Korleis zundo faktisk fungerer, i detalj:** For kvart einaste `set()`-kall (altså kvart tastetrykk) hentar zundo synkront ut `pastState` (tilstanden *rett før* dette eine kallet) og `currentState` (tilstanden *rett etter*), og avgjer *då og der* om paret skal pushast til historia. `handleSet`-opsjonen let deg pakke inn **sjølve push-kallet** i ein throttle/debounce — men dei to allereie-utrekna verdiane (`pastState`/`currentState`) for det spesifikke tastetrykket er allereie låst fast i det augeblinken, uavhengig av throttling.

Det er her den nemnde eittlinjes-oppskrifta frå zundo sin eigen README (`handleSet: (handleSet) => throttle(handleSet, 1000)`) **ikkje** gjev det brukaren truleg forventar. Eit konkret døme — brukaren skriv "Hello" i skildringsfeltet, alle fem tastetrykk innanfor éitt sekund:

- Tastetrykk 1 ("" → "H"): dette er *leading edge* i ein throttle, så han fyrer **med det same** — pushar `pastState=""` til historia.
- Tastetrykk 2–5 ("He" → "Hel" → "Hell" → "Hello"): desse hamnar inni throttle-vindauget og vert ikkje pusha individuelt, men den **siste** av dei ("Hell" → "Hello") fyrer på *trailing edge* når vindauget går ut — og pushar `pastState="Hell"`, altså tilstanden rett før den ALLER SISTE bokstaven.

Resultat: to historieoppføringar, `["", "Hell"]`, ikkje éi. Trykkjer brukaren Undo rett etter å ha skrive "Hello", forsvinn berre den siste "o"-en (attende til "Hell") — eit nytt Undo-trykk fjernar resten på éin gong (attende til ""). Dette er *mykje* betre enn i dag (5 tastetrykk → 5 steg vert 5 → 2), men det er ikkje heilt "éin redigering, éin Undo" slik ordlyden "slå saman til éi oppføring" kanskje antyder — den aller siste bokstaven/endringa innanfor kvart tidsvindauge får alltid sitt eige, litt merkelege ekstra Undo-steg. `debounce` (i staden for `throttle`) gjer det faktisk *verre* på dette punktet: då fyrer ingenting før brukaren stoppar å skrive, og når det endeleg fyrer, er det framleis berre den *siste* bokstaven sin `pastState` ("Hell") som vert pusha — heile setninga "Hello" ville då krevje at brukaren skreiv HEILE setninga i eitt uavbrote sveip innanfor éin einaste `set()`-observasjon for at "eitt Undo = heile setninga" skal stemme, noko som i praksis aldri skjer.

**Rett fiks (liten eigen wrapper, ikkje berre eit off-the-shelf debounce-kall):** hugs `pastState` frå det **fyrste** kallet i eit samanhengande "redigeringsutbrot", og bruk *det* (ikkje `pastState` frå det siste kallet) når den forseinka push-en endeleg fyrer:

```ts
function groupedHandleSet(handleSet: HandleSetFn) {
  let burstStart: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (pastState, replace, currentState, deltaState) => {
    if (burstStart === undefined) burstStart = pastState; // berre sett ved START av utbrotet
    clearTimeout(timer);
    timer = setTimeout(() => {
      handleSet(burstStart, replace, currentState, deltaState); // currentState er alt "fersk" frå siste kall
      burstStart = undefined;
    }, 500);
  };
}
```

Med denne varianten: tastetrykk 1 lagrar `burstStart=""` men pushar ingenting enno; tastetrykk 2–5 oppdaterer berre nedtellinga; 500 ms etter siste tastetrykk (når brukaren sluttar å skrive/byter felt/klikkar på canvaset) fyrer han **éin gong** med `pastState=""` (den ekte tilstanden *før heile utbrotet*) og `currentState="Hello"`. Éitt Undo-trykk fjernar då heile "Hello" på éin gong — nøyaktig slik brukaren truleg forventar.

**Korleis dette opplevast for brukaren, steg for steg:**
1. Brukaren klikkar i Skildring-feltet til ein klasse og byrjar å skrive "En person i systemet".
2. *Medan* dei skriv, oppdaterer skjemaet seg i storen på kvart tastetrykk **akkurat som i dag** — YAML Preview og klassenoden på canvaset held fram med å oppdatere seg live, bokstav for bokstav (dette er alt stadfesta åtferd i dag, sjå `YamlPreview` i `packages/web/src/main.tsx:171-182`, som re-serialiserer på kvar endra `activeSchema`-referanse). Denne fiksen endrar **ikkje** noko her.
3. Det som er nytt: sjølve Undo-historia ventar. Så lenge brukaren held fram å skrive (utan 500 ms pause), vert det ikkje oppretta noka ny historieoppføring.
4. Når brukaren stoppar å skrive i minst 500 ms (t.d. flyttar fokus til eit anna felt, eller berre tenkjer seg om), vert **éin** historieoppføring skriven: "gamal skildring" → "En person i systemet".
5. Trykkjer brukaren Undo då, forsvinn heile setninga i eitt steg, attende til den gamle skildringa — ikkje berre siste bokstav.
6. Skriv brukaren vidare i same felt seinare (etter ein pause), separat frå den fyrste "sveipen", vert det ei ny, separat historieoppføring for den andre økta — kvar samanhengande skriveøkt (< 500 ms mellomrom) tel som éi logisk endring, ikkje kvart felt totalt sett.
7. Strukturelle handlingar som "legg til klasse"/"slett slot" er alt éin `set()`-kvar og vert difor upåverka — dei er alt éin historieoppføring i dag (etter equality-fiksen i punkt 1) og treng ikkje debounce.

### Utdjuping av alternativ (b) — commit-on-blur/Enter

Her endrar ein sjølve tekstfelt-komponenten (`TextArea.tsx` m.fl.) til å halde det brukaren skriv i **lokal** komponent-state (t.d. `useState` i `ClassPanel`/feltet sjølv) medan feltet har fokus, og kallar den ekte store-mutatoren (`updateClass`, …) — altså det einaste `set()`-kallet — fyrst når feltet mistar fokus (blur) eller brukaren trykkjer Enter.

**Korleis dette opplevast for brukaren, steg for steg:**
1. Brukaren klikkar i Skildring-feltet og byrjar å skrive "En person i systemet". Sjølve skrivinga i feltet kjennest heilt likt som i dag — teiknet dukkar opp med det same, lokalt i feltet.
2. **Skilnad frå i dag:** medan feltet framleis har fokus, oppdaterer *ikkje* YAML Preview eller klassenoden på canvaset seg. Dei står og syner den **gamle** skildringa heilt til feltet mistar fokus.
3. Brukaren klikkar ut av feltet (eller trykkjer Enter/Tab) — i det augeblinken vert éin `set()` kalla med heile den nye teksten, og YAML Preview + canvas "hoppar" umiddelbart til den nye skildringa. Samtidig vert nøyaktig éi historieoppføring skriven: "gamal skildring" → "ny skildring".
4. Trykkjer brukaren Undo rett etterpå, forsvinn heile redigeringa i eitt steg — same sluttresultat som alternativ (a) med den korrigerte wrapperen.
5. **Reell, brukar-synleg avveging brukaren bør vere merksam på:** i dag oppdaterer YAML Preview og canvas seg *live, bokstav for bokstav* medan ein skriv (stadfesta i koden, jf. punkt 2 over). Med commit-on-blur forsvinn denne live-synkroniseringa for tekstfelt spesifikt — brukaren ser ingenting endre seg andre stader før dei forlèt feltet. Dette kan opplevast som eit steg tilbake i "kjenslen" av direkte manipulasjon, sjølv om Undo-oppførselen vert like god som (a).
6. **Ein ekstra, mindre kant-case:** sidan teksten berre finst i lokal komponent-state fram til blur, vil ein pågåande, ikkje-committa redigering **gå tapt** dersom appen lastar på nytt eller krasjar medan feltet framleis har fokus (t.d. nettlesar-krasj, utilsikta reload). I dag, der kvart tastetrykk alt går til storen, finst ikkje dette tapet — kvart tastetrykk er alt "lagra" i appen sin tilstand (om enn ikkje nødvendigvis skrive til disk).

### Samla tilråding

Alternativ (a) — **med den korrigerte wrapperen** som hugsar `pastState` frå *starten* av utbrotet, ikkje off-the-shelf `lodash.debounce`/`throttle` rett frå zundo sin README — gjev det beste av begge verder: nøyaktig "éin skriveøkt = éin Undo-steg"-oppførsel, **utan** å ofre dagens live-synkronisering til YAML Preview/canvas medan ein skriv, og utan risikoen for tapt, ikkje-committa tekst ved reload. Alternativ (b) er enklare å resonnere om isolert, men inneber ei reell, synleg åtferdsendring (tapt live-sync) som brukaren bør godkjenne eksplisitt dersom det er ønskt — det er ikkje berre eit implementasjonsdetalj.

3. **(Mindre, valfritt) Gjer `useTemporalStore` reaktiv** — abonner på `store.temporal` (t.d. via eit `useSyncExternalStore`/`subscribe`-mønster) i staden for eit rått `getState()`-kall, og legg til `disabled`-attributt på knappane i `PropertiesPanel/index.tsx` (manglar heilt i dag) i tillegg til dei som alt finst i `MenuBar.tsx`.

4. **Legg til ein regresjonstest** tilsvarande den empiriske scratch-testen brukt til å stadfeste dette funnet: eit `set()`-kall på ei ikkje-schema-slice (t.d. `setViewport`) skal **ikkje** endre `temporal.getState().pastStates.length`. Dette hindrar at akkurat denne feilklassen kjem stille tilbake.

### Etterfølgjande funn under manuell testing av Del 1 — prosjekt-opning/-lukking vart sjølv ei undo-oppføring

Etter at punkt 1-4 over var implementert og verifisert med `addClass`-baserte testar, testa brukaren manuelt med ei ekte redigering (endra `DEFAULT_RANGE` frå `string` til `integer`) og rapporterte: Undo verka no korrekt for sjølve redigeringa, **men** eit par ekstra trykk på Undo tok brukaren heilt attende til "Open from URL"-skjermbiletet (prosjektet vart lukka). Ønskt åtferd, ordrett: "Undo og redo knappane skal kun gjelde editering av skjemaet og hvis eg har gjort undo på den siste endringa slik at det ikkje er nokon fleire endringar å undoe bør knappen gråes ut."

**Rotårsak:** `setProject()` (opning av eit prosjekt, t.d. via "Open from URL") og `closeProject()` gjer begge eit vanleg `set({activeProject: ...})`-kall gjennom den same, no korrekt fungerande, temporal-spora `set`-funksjonen. Sidan `equality`-fiksen (punkt 1) berre hindrar *uendra* `activeProject`-referansar frå å pushast — og å opne/lukke eit prosjekt **faktisk endrar** `activeProject`-referansen (frå/til `null`) — vart dette framleis rekna som ei ekte, undo-bar hending. Éin ekstra Undo utover den siste reelle skjema-endringa tok dermed brukaren attende til "ingen prosjekt ope"-tilstanden, som synte seg som prosjekt-veljar-skjermbiletet.

**Fiks implementert:** Prosjekt-opning/-lukking skal vere ein context-switch, ikkje ei skjema-redigering, og skal difor aldri sjølv bli eit undo-steg — og eventuell historikk frå eit tidlegare ope prosjekt skal ikkje "lekke" inn i det nyopna. Løyst med ein ny, testbar hjelpefunksjon (`store/temporalProjectGuard.ts`, `guardProjectLifecycleFromTemporalHistory`) som pakkar inn `setProject`/`closeProject`: han **pausar** temporal-sporing (`temporal.pause()`) heilt gjennom sjølve kallet (slik at akkurat *det* `set()`-kallet aldri vert registrert i det heile), køyrer den ekte handlinga, avbryt eventuell ventande burst-gruppert push frå eit redigeringsutbrot rett før byttet (`burstGrouper.reset()` — sjå neste avsnitt for kvifor dette var nødvendig), tømmer heile historikken (`temporal.clear()`), og skrur sporing på att (`temporal.resume()`).

**Sekundært funn oppdaga *under* skriving av regresjonstestane for fiksen over (ikkje rapportert av brukaren enno, men reelt):** Burst-grupperinga frå alternativ (a) (punkt 2) forseinkar **alle** `set()`-kall inntil 500 ms før dei faktisk vert skrivne til `pastStates` — ikkje berre tastetrykk-utbrot i tekstfelt, men òg eittsteg-handlingar som "Legg til klasse". Det vart stadfesta empirisk (ein test som kalla `addClass` og umiddelbart deretter sjekka `pastStates.length` utan å avansere klokka, feila: talet var framleis 0). Konsekvens: trykkjer brukaren Undo *innan* 500 ms etter t.d. å ha lagt til ein klasse, ville ingenting skje — endringa synest alt i UI-et, men er enno ikkje skriven til historia. **Fiks:** ein ny `flush()`-funksjon i burst-wrapperen (`temporalHandleSet.ts`) som skriv ei ventande, enno-ikkje-committa endring til historia *med det same*, og ein ny `flushBurstBeforeUndoRedo`-funksjon (same fil som guard-en over) som kallar `flush()` heilt fyrst inni både `undo()` og `redo()`. Dermed handlar Undo alltid på den redigeringa brukaren nettopp såg skje, uavhengig av kor lenge sidan det var.

Alle fire (equality, burst-gruppering med flush, prosjekt-livssyklus-vern, reaktiv useTemporalStore) er no implementerte og dekte av regresjonstestar (`temporalEquality.test.ts`, `temporalHandleSet.test.ts`, `temporalProjectGuard.test.ts`).

## Del 2: Edit-trail / endringslogg — designforslag

Brukaren ønskjer: (1) ein synleg logg over alle endringar gjort på eit LinkML-skjema, (2) moglegheit til å spole fram/tilbake i denne loggen, og (3) at endringane då skal reflekterast konsistent i **alle tre** visningane — hovudcanvaset, Properties Panel og YAML Preview.

### Kva som alt finst å byggje vidare på

Etter Del 1-fiksen inneheld zundo sine `pastStates`/`futureStates` alt eitt fullt `activeProject`-snapshot per *reelle* skjema-endring (ikkje lenger per tastetrykk/UI-støy). Vidare: Canvas, Properties Panel og YAML Preview les i dag alle frå den same `activeProject`/`getActiveSchema()`-tilstanden i storen — dei har ingen eigen, separat kopi av skjema-dataen. Å hoppe `activeProject` til eit tidlegare snapshot bør difor i prinsippet halde alle tre visningane synkroniserte "gratis", utan eigen wiring per visning.

Denne antakinga bør likevel **stadfestast empirisk før implementering**, ikkje berre lesast ut av koden — jf. det generelle prinsippet i CLAUDE.md om at "verify configuration empirically, not by code-reading alone", og den konkrete presedensen i `specs/done/cross-repo-import-resolution-gaps.md` der fleire visningar (Outline/Table/Canvas/ProjectPanel) synte seg å ha *sine eigne* hand-skrivne enumereringar av skjemaet som ikkje automatisk fekk med seg ei endring gjort éin stad. Same risiko kan i prinsippet gjelde her: sjekk konkret at YAML Preview og Canvas faktisk re-rendrar korrekt når `activeProject` vert bytta ut under føtene deira via `undo()`/eit historie-hopp, ikkje berre når det endrast via dei vanlege mutator-kalla.

### Opne spørsmål / alternativ

**A) Kva vert logga — auto-diff eller eksplisitt tagga handlingar?**

- *Alt. 1 — auto-diff:* Generer eit lesbart samandrag ved å samanlikne kvart par av påfølgande `activeProject`-snapshots. Ingen endring i sjølve mutatorane i `projectSlice.ts`, men krev ein eigen, ikkje-triviell LinkML-schema-diff (klasse lagt til/fjerna, slot lagt til/fjerna/endra type, enum permissible values endra, osv.) som truleg aldri vert like presis som ei eksplisitt logga hending.
- *Alt. 2 — eksplisitt tagging (anbefalt):* Kvar mutator-metode i `projectSlice.ts` (`addClass`, `renameClass`, `updateSlot`, …) sender med ei kort skildring når han køyrer (t.d. via ein liten wrapper rundt `set()` som tek imot eit valfritt `label`), lagra saman med snapshotet i eit eige array parallelt med zundo sitt. Meir arbeid å innføre (rører kvar mutator), men gjev presise, direkte lesbare oppføringar ("La til klasse `Person`", "Endra type på `age` frå `integer` til `float`") utan å måtte rekonstruere meining frå eit diff.
- *Mellomting:* start med Alt. 2 for dei mest brukte handlingane (add/delete/rename for klasse, slot, enum), fall attende til "Ukjend endring" (Alt. 1-stil, eller berre eit tidsstempel) for resten inntil dei òg vert tagga.

**B) Kor finn brukaren loggen?**

- *Alt. 1:* Nytt panel/fane ved sida av Properties/Validation (t.d. eit "History"-ikon i panel-fanebaren), med ei reverse-kronologisk liste (tidsstempel + skildring), klikk for å hoppe direkte dit.
- *Alt. 2:* Eit tidslinje-/scrubber-UI (meir video-editor-aktig) — ein horisontal tidslinje med eit "spelehovud" ein dreg att og fram, t.d. i ei skuff nedst i vindauget.
- *Alt. 3:* Utvid dagens Undo/Redo-knapp i MenuBar til ein dropdown (Word/Photoshop-stil Edit History-meny) — lettvekt, men mindre synleg/oppdagbart, og dårlegare eigna for "spol fram/tilbake"-interaksjonen brukaren spør etter.
- *Tilråding:* Alt. 1 (eige panel) med eit element frå Alt. 2 (ein enkel scrubber øvst i panelet) — dekkjer både "sjå kva som har skjedd" og "spol fram/tilbake" utan å gøyme funksjonen bak eit lite ikon.

**C) Skal loggen overleve ein reload?**

- I dag er zundo-historia berre i minnet (session-only) — nullstilt ved sideoppdatering/attopning av prosjekt.
- *Alt. 1 (anbefalt for fyrste versjon):* behald as-is, session-only. Krev ingen manifest-endring, altså ingen MAJOR-versjonskonsekvens (jf. CLAUDE.md sitt krav om at `.linkml-editor.yaml`-formatendringar er MAJOR).
- *Alt. 2:* Persister loggen til disk, i ei **eiga** fil ved sida av manifestet (t.d. `.linkml-editor-history.jsonl`) — **ikkje** inni `.linkml-editor.yaml` sjølv, nettopp for å unngå å gjere dette til ei manifest-formatendring. Krev ei avgjerd om øvre storleiksgrense/rullering, og bør truleg `.gitignore`-ast som lokal arbeidshistorie, ikkje del av sjølve skjemaet.
- Tilråding: start med Alt. 1; vurder Alt. 2 som eige, mindre forslag seinare dersom session-only viser seg utilstrekkeleg i praksis.

**D) Grensa på 50 historieoppføringar**

Ein synleg logg gjer denne grensa mykje meir merkbar for brukaren enn i dag (der historia uansett ikkje verka reelt). Bør truleg aukast (t.d. 200–500) no som kvar oppføring representerer éi meiningsfull endring etter Del 1-fiksen, ikkje potensielt tusenvis av tastetrykk/UI-støy. Kvart snapshot er eit fullt `activeProject`-objekt — minnebruk bør sjekkast empirisk mot eit realistisk stort skjema før talet vert sett endeleg.

**E) Sjølve "spol fram/tilbake"-interaksjonen**

`temporal.undo(steps)`/`redo(steps)` tek alt imot eit stegtal, så eit "hopp direkte til oppføring N" kan i prinsippet implementerast som `undo(currentIndex - N)`. Ved dra-interaksjon i ein scrubber bør eit hopp truleg setjast som **éi** direkte tilstands-tilordning til `states[i]` (ikkje N enkeltvise `undo()`-kall i ein lykkje) — meir robust dersom framtidige mutatorar nokon gong får biverknader utanfor sjølve `activeProject`-tilstanden (t.d. ein valideringskøyring eller ein toast trigga per steg).

### Ikkje-mål for dette forslaget

- Fleirbrukar-/samarbeidshistorie (kven gjorde kva, på tvers av personar) er ikkje dekt — berre éin lokal brukar si eiga redigeringshistorie i éi økt.
- Git-historikk/commits (`GitSlice`) er ein heilt separat mekanisme frå denne applikasjons-interne edit-loggen, og vert ikkje rørt av dette forslaget.

## Tilråding for rekkjefølgje

1. Implementer Del 1 (equality-fiks + debounce) fyrst — dette er ein rein bug-fiks av noko som alt skal finnast, låg risiko, og gjer eksisterande Undo/Redo brukande med det same.
2. Vent på eksplisitt godkjenning av kva for alternativ (A/B/C/D/E over) som skal veljast for sjølve edit-trail-funksjonen før noko av Del 2 vert implementert. Dette er ein ny funksjon, ikkje ein bug-fiks, og krev — når han er godkjend for implementering — ein eigen GitHub-issue og feature-branch per "Starting a feature" i CLAUDE.md, ikkje same branch som Del 1.
