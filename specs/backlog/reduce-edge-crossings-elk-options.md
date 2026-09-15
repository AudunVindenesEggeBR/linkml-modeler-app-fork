# Spec: Fleire ELK-parametre/andre grep for å minimere kryssande kantar — alternativ

Status: **Delvis implementert.** `considerModelOrder` (`PREFER_EDGES`) er implementert og verifisert — sjå "Runde 3". Runde 4 sine to funn (Funn 1 + Funn 2) er NO OGSÅ implementerte og verifiserte — sjå "Runde 5" nedst. `greedySwitch.type` og `compaction.connectedComponents` er IKKJE tilrådde. Alternativ C (ELK-ruta range-kantar) står framleis som eit ope, stort forslag.
Dato: 2026-09-14 (runde 4: 2026-09-15)

Ønske (ordrett, runde 1): "No lurer eg på om vi kan gjere nokon grep for å få mindre kryssande kantar. Finnes det parametre vi kan skru på i ELK eller andre måter vi kan minimere kryssande kantar ved å flytte på plasseringa av klassene?"

Ønske (ordrett, runde 2 — konkret framgangsmåte føreslått av brukaren): "Eg lurer på om ei anna tilnærming kan være fornuftig. Eg tenker at dette er eit slags sorteringsproblem. No når kvar utgåande og inngåande edge har eget anker til respektive klasser så kan vi tenke oss at frå 'topp-klassen' som har kun utgåande edges kan vi sortere utgåande edges på den rekkefølga dei er skrive i klassen. Hvis vi tenker Left-right layout betyr det at den sloten som dannar edge 1 frå topp-klassen vil plasseres øverst til høgre for topp-klassen. Neste slot sin edge vil plasseres til høgre for topp-klassen men under edge 1 sin klasse. På tilsvarande måte kan vi indeksere opp alle edges og teikne dei opp i rekkefølge. Med denne tilnærminga vil edges gå mest mulig rett ut fra kilde-klassen og vi minimerer problemet med kryssingar opp og ned. Evaluer om vi kan bruke denne framgangsmåten eller ein variant av den og oppdater specen."

## Grunnleggjande atterhald — les dette FØRST, avgjer kor mykje nokon av alternativa under kan hjelpe

Stadfesta tidlegare denne økta (`specs/backlog/range-edge-collision-and-label-visibility.md`): **range-kantar sin faktiske teikna bane kjem IKKJE frå ELK.** `deriveGraph.ts` sender ALDRI ELK sine kalkulerte "bend points" til range-kantar (stadfesta: ingen `elkData(...)`-kall for range-kant-blokkene) — dei brukar `getSmoothStepPath()` (ReactFlow, lokalt kalkulert frå handtak-posisjonar) i staden.

**Konsekvens for dette ønsket:** ELK sine kryss-minimerings-innstillingar (alt i bruk, og alle nye kandidatane under) påverkar BERRE kor NODANE (klassane) hamnar — dei påverkar ALDRI sjølve den teikna linja mellom to handtak. Betre node-plassering GIR NORMALT færre kryss i den teikna grafen (nodar plassert i "rett" rekkjefølgje treng sjeldnare at linjene deira kryssar kvarandre for å nå fram) — men det er ei INDIREKTE, ikkje-garantert samanheng, ikkje ei direkte "flytt kanten sin bane"-kontroll. Målet "flytte på plasseringa av klassane" (slik brukaren sjølv formulerer det) er difor nøyaktig det ELK-tuning FAKTISK kan gjere noko med — men **ingen** av alternativa under kan garantere null kryss, same atterhald som alt dokumentert i `canvas-layout-topdown.md` sin Runde 2 ("kryss-minimering er NP-hardt... ELK sin heuristikk REDUSERER kryss, han GARANTERER IKKJE eit kryssfritt resultat").

## Kva er alt i bruk i dag (stadfesta i `autoLayout.ts`)

- `elk.layered.crossingMinimization.strategy: 'LAYER_SWEEP'` — ELK sin eigen standard-heuristikk, gjort eksplisitt.
- `elk.layered.thoroughness: '30'` — heva frå ELK sin standard (7), gir heuristikken fleire forsøk.
- `elk.layered.layering.strategy` — brukarveljande (5 alternativ, jf. tidlegare runder).

## Nye kandidatar — empirisk stadfesta (installert elkjs 0.11.1, testa på BÅDE eit syntetisk graf OG dei to ekte testskjemaa)

### 1. `elk.layered.considerModelOrder.strategy` — RUNDE 2: stadfesta at han IMPLEMENTERER PRESIS brukaren sin foreslåtte algoritme

Offisiell ELK-dokumentasjon (`OrderingStrategy`-enum): `NONE` (standard — ELK omorganiserer fritt), `NODES_AND_EDGES` (prøver å behalde skjemaet si eiga rekkjefølgje for både nodar og kantar), `PREFER_EDGES`, `PREFER_NODES`.

**Brukaren sitt forslag (runde 2), presisert:** sorter ei klasse sine utgåande kantar etter DEKLARASJONS-rekkjefølgja (slik dei står skrivne i klassen), og plasser måla i SAME rekkjefølgje langs sidenoden sitt lag (t.d. for LR: fyrste kant øvst, neste kant rett under, osv.) — slik at kvar kant går "mest mogleg rett ut" frå kjelda, og "opp-og-ned"-kryssing frå tilfeldig/urelatert sortering av søsken minimerast.

**Dette er eksakt det same som Graphviz (dot) sitt `ordering="out"`-attributt gjer** — ein velkjend, etablert layout-teknikk, ikkje noko oppdikta. ELK har sitt eige, separate maskineri for akkurat dette føremålet: `considerModelOrder.strategy`.

**Stadfesta empirisk — presist, ikkje berre "annleis" (retta frå runde 1 sitt meir usikre funn):** bygde eit målretta testoppsett (éin "topp-klasse" med 4 utgåande kantar til A, B, C, D, LAGT TIL i ELK-grafen i nøyaktig DEN rekkjefølgja), køyrde LR-layout, og samanlikna Y-rekkjefølgja til A/B/C/D i resultatet mot deklarasjonsrekkjefølgja:

| Innstilling | Resulterande Y-rekkjefølgje (deklarert: A, B, C, D) |
|---|---|
| `NONE` (dagens standard) | `[C, D, A, B]` — heilt urelatert til deklarasjonsrekkjefølgja |
| `NODES_AND_EDGES` | `[A, B, C, D]` — **nøyaktig lik deklarasjonsrekkjefølgja** |
| `PREFER_EDGES` | `[A, B, C, D]` — **nøyaktig lik** |
| `PREFER_NODES` | `[A, B, C, D]` — **nøyaktig lik** |

**Stadfesta at dette ikkje er tilfeldig** — snudde input-rekkjefølgja til kantane (D, C, B, A i staden for A, B, C, D) og køyrde på nytt: Y-rekkjefølgja i resultatet vart DA `[D, C, B, A]` — følgjer presist kva rekkjefølgje EG faktisk sender inn, ikkje ein alfabetisk/storleiksbasert tilfeldigheit.

**Stadfesta på DET EKTE skjemaet, ikkje berre eit syntetisk oppsett:** `FrivilligOrganisasjon` i `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` har 6 eigenskapar med klasse-range, deklarert i denne rekkjefølgja: `IcnpoKategori, Vedtekter, Grasrotandel, Regnskapsrapportering, Paategning, Virksomhetsrelasjon`.

| Innstilling | Resulterande Y-rekkjefølgje for FrivilligOrganisasjon sine mål |
|---|---|
| `NONE` (dagens standard) | `Vedtekter, Virksomhetsrelasjon, IcnpoKategori, Grasrotandel, Paategning, Regnskapsrapportering` — fullstendig omstokka |
| `NODES_AND_EDGES` | `IcnpoKategori, Vedtekter, Grasrotandel, Regnskapsrapportering, Paategning, Virksomhetsrelasjon` — **BYTE-FOR-BYTE lik den deklarerte rekkjefølgja** |

**Konklusjon:** `considerModelOrder.strategy` (kva som helst av dei tre ikkje-NONE-verdiane) **ER** brukaren sin foreslåtte algoritme, alt implementert og tilgjengeleg i den installerte ELK-versjonen — ingen eigen, hand-rulla sorteringslogikk er naudsynt. Dette er eit sterkare, meir presist funn enn runde 1 sin konklusjon ("annleis, men kan ikkje stadfeste færre kryss") — no stadfesta at mekanismen bak endringa er PRESIS den brukaren sjølv beskreiv, ikkje berre ei tilfeldig anna omorganisering.

**Attverande, ærleg atterhald:** dette løyser presist DET brukaren sitt opphavlege scenario skildrar — éin kjelde med fleire utgåande kantar til søsken utan andre band mellom seg. Det seier ingenting om KONVERGERANDE kantar (fleire ulike kjelder som peiker på SAME mål — stadfesta vanleg i begge ekte skjema, jf. Runde 2/3 i `range-edge-collision-and-label-visibility.md`), der målet sin plassering må tilfredsstille FLEIRE kjelder sine ønskte rekkjefølgjer samstundes — ELK sin heuristikk gjer sitt beste her òg, men kan ikkje alltid tilfredsstille alle samstundes (matematisk umogleg i visse graf-strukturar). Framleis ingen garanti mot ALLE kryss, berre ein mykje meir treffsikker, prinsipiell reduksjon av nøyaktig den typen kryssing brukaren skildrar (usortert søsken-rekkjefølgje).

### 2. `elk.layered.crossingMinimization.greedySwitch.type` — stadfesta INGEN målbar effekt på denne appen sine skjemastorleikar

Offisiell dokumentasjon: `ONE_SIDED`, `TWO_SIDED` (ELK sin standard — alt AKTIV i dag utan at me set han eksplisitt, sidan me aldri overstyrer han), `OFF`. Dette er ein lokal etterhands-heuristikk (byte om to naboe-nodar reduserer kryss) med ein dokumentert aktiverings-TERSKEL (`activationThreshold`, standard 40 — sannsynlegvis talet på nodar/kantar grafen treng før denne heuristikken i det heile koplar inn).

**Stadfesta empirisk:** `ONE_SIDED`/`TWO_SIDED`/`OFF` gir **IDENTISK resultat** på alle tre testa grafar (eit syntetisk 6-node-graf MED eit ekte kryss-avvegingsproblem, PLUSS BEGGE ekte testskjema — samt-bu har 11 klassar, enhetsregisteret 10). Sannsynleg forklaring: alle desse skjemaa ligg godt under `activationThreshold: 40`, så denne heuristikken koplar aldri inn. **Ikkje tilrådd å eksponere som ny veljar** — verifisert daud parameter for denne appen sin typiske skjema-storleik, ville berre lagt til UI-kompleksitet utan verkeleg effekt.

### 3. `elk.layered.compaction.connectedComponents` — ikkje testa mot noko relevant tilfelle enno

Offisiell dokumentasjon: `true`/`false` (standard `false`) — strammar inn avstanden MELLOM usamanhengande komponentar. Testa berre mot eit heilt samanhengande syntetisk graf (ingen skilnad, forventa — det finst ingen "komponentar" å stramme inn mellom der). **Ikkje meiningsfullt testa enno** — den EINE staden dette faktisk ville vore relevant i denne appen er akkurat den usamanhengande-komponent-situasjonen `hideTreeRootRangeEdges` skapar (jf. `specs/done/tree-root-class-leftmost-position.md`), men `repositionTreeRootNodesLeft()` OVERSTYRER uansett ELK sin plassering av tree_root-noden etterpå — så denne innstillinga ville truleg ha null praktisk effekt i DENNE appen sin konkrete bruk, sjølv om han i prinsippet er relevant for usamanhengande graf. **Ikkje tilrådd å prioritere.**

## Andre grep enn ELK-parametrar (slik brukaren sjølv opna for: "eller andre måtar")

### A — Meir avstand (alt tilgjengeleg i dag)

`SPACING_PRESETS` (`compact`/`normal`/`spacious`/`extraSpacious`) gir meir albogerom, som statistisk reduserer sjansen for at teikna linjer kjem tett/kryssar — men løyser ikkje GARANTERTE kryss (same prinsipp som spacing ikkje løyste den GARANTERTE handtak-overlappen frå ei tidlegare runde). Ingen ny kode naudsynt — alt i UI-et.

### B — Skjul mindre viktige kantar (alt delvis bygd)

`hiddenEdgeTypes`/`rangeEdgesMode`/`hideTreeRootRangeEdges`-veljarane (alle alt i UI-et) er i praksis ein måte å redusere VISUELL kryssings-STØY på — færre synlege kantar betyr færre moglege kryss, sjølv om det ikkje "flyttar klassar" slik ønsket ordrett spør om. Nemnt for fullstendigheit, ikkje eit nytt forslag.

### C — Den mest fundamentale, MEN store, fiksen: la ELK faktisk RUTE range-kantane (ikkje berre plassere nodane)

Alt identifisert som "Alternativ C" i `specs/backlog/range-edge-collision-and-label-visibility.md` (der i samband med kant-LABEL-synlegheit, men prinsippet er identisk her): viss range-kantar tok i bruk ELK sine faktiske "bend points" (slik `is_a`/`mixin`/`union_of`-kantar alt gjer) i staden for lokale `getSmoothStepPath`-banar, ville ELK sin kryss-minimering FAKTISK kunne påverke DEI TEIKNA LINJENE direkte, ikkje berre nodeplasseringa — den einaste måten å få ei REELL, direkte kryss-minimerings-garanti (innanfor NP-hard-heuristikken sine eigne grenser) for SJØLVE dei synlege linjene, ikkje berre eit indirekte "betre plasserte nodar reduserer sjansen".

**Kvifor dette ikkje er tilrådd som fyrste steg** (same grunngjeving som i den andre spec-en): dette går rett imot den eksisterande, medvitne avgjerda om at range-kantar skal bruke handtak-baserte lokale banar (naudsynt for at kvart per-slot/per-innkomande-kant-handtak, jf. Runde 2/3 denne økta, faktisk vert respektert presist) — å kombinere BÅDE presise per-slot-ankerpunkt OG ELK sin node-sentrerte rute-algoritme samstundes er ikkje trivielt, og er eit mykje større, sjølvstendig prosjekt enn å berre skru på nokre ELK-parametrar.

## Tilråding (oppdatert etter runde 2)

1. **`considerModelOrder.strategy` er no sterkt tilrådd** — ikkje lenger berre "annleis resultat", men STADFESTA å implementere presis brukaren sin eigen foreslåtte algoritme (deklarasjons-rekkjefølgje-sortering av søsken), verifisert byte-for-byte på det ekte skjemaet. Godt prinsipielt grunngjeven (same teknikk som Graphviz sitt `ordering=out`), ikkje eit vilkårleg parameter-triks. Legg til som ny, brukarveljande veljar (same UI-mønster som `layeringStrategy`/`edgeRouting`/`nodePlacementStrategy`).
2. **`greedySwitch.type` er IKKJE tilrådd** — verifisert null effekt på denne appen sine typiske skjemastorleikar.
3. **`compaction.connectedComponents` er IKKJE prioritert** — ikkje meiningsfullt testa, og sannsynleg irrelevant gitt korleis `repositionTreeRootNodesLeft()` alt overstyrer den einaste usamanhengande-komponent-situasjonen denne appen typisk har.
4. **For konvergerande kantar** (fleire kjelder til same mål) gir `considerModelOrder` inga garanti — ELK må avvege fleire kjelder sine ønskte rekkjefølgjer samstundes, ikkje alltid løyseleg utan kryss.
5. **For ei FULLSTENDIG, garantert kryss-reduksjon i dei TEIKNA linjene** (ikkje berre nodeplassering): berre Alternativ C (ELK-basert range-kant-ruting) ville gitt det — eit stort, sjølvstendig prosjekt, ikkje tilrådd no.

## Testcase / akseptansekriterium (viss `considerModelOrder.strategy` vert godkjent)

1. Ny `AutoLayoutOptions.considerModelOrder`-felt (boolsk av/på, eller ein enum-veljar — sjå ope spørsmål 2), default av (uendra åtferd frå i dag).
2. Einingstest (mirrorer det empiriske funnet over): syntetisk skjema med éi klasse med fleire attributt i kjent rekkjefølgje som kvar peiker på ei ANNA klasse; stadfest at Y-rekkjefølgja (LR) eller X-rekkjefølgja (TB) til måla samsvarer nøyaktig med attributt-deklarasjonsrekkjefølgja når innstillinga er PÅ, og IKKJE nødvendigvis når han er AV.
3. Regresjonstest: eksisterande `autoLayout.test.ts`-testar uendra når det nye feltet er utelate/av.
4. Manuell stadfesting: Layout-knapp på `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` med innstillinga PÅ. **Forventa:** `FrivilligOrganisasjon` sine 6 mål-klassar stabla i rekkjefølgja `IcnpoKategori, Vedtekter, Grasrotandel, Regnskapsrapportering, Paategning, Virksomhetsrelasjon` (den faktiske deklarasjonsrekkjefølgja i YAML-fila).

## Ope spørsmål til brukar

3. Er du interessert i det store, sjølvstendige Alternativ C-prosjektet (ELK-ruta range-kantar) som eit HELT eige spec/initiativ seinare, gitt at det er den einaste vegen til FULLSTENDIG kryss-kontroll (inkl. konvergerande kantar) over dei synlege linjene?

## Runde 3 (2026-09-14) — `considerModelOrder` (PREFER_EDGES) implementert

Brukaren skreiv "utfør PREFER_EDGES" — eksplisitt godkjenning for `PREFER_EDGES` spesifikt (svarar på ope spørsmål 2: éin enkel av/på-brytar med denne eine verdien, ikkje alle fire ELK-verdiane synlege).

**Implementert:**
- `autoLayout.ts`: nytt `AutoLayoutOptions.considerModelOrder?: boolean`-felt (standard `false`, uendra åtferd). Set `elk.layered.considerModelOrder.strategy` til `'PREFER_EDGES'` når PÅ, eksplisitt `'NONE'` når AV (same "alltid eksplisitt, aldri betinga utelate"-mønster som resten av dei ELK-opsjonane i fila).
- `SchemaCanvas.tsx`: ny `considerModelOrder`-tilstand, tredd inn i `applyAutoLayout` som eit 6. eksplisitt parameter (same "unngå stale closure"-mønster som dei fem eksisterande), og alle seks kallstadene (`handleAutoLayout` + dei fem eksisterande `<select>`-endringshandterarane) oppdaterte til å sende han vidare. Ny sjette `<select>` i verktøylinja ("Default order" / "Schema order"), same auto-køyr-ved-endring-mønster som dei andre.
- Dei to AUTOMATISKE layout-kalla (fyrste opning, nye importerte einingar) er uendra — dei brukar framleis `{}` som opsjonar, som gir `considerModelOrder: false` via `DEFAULT_OPTIONS`, akkurat som alle dei andre nye opsjonane denne fila alt har fått.

**Testar lagt til** (`autoLayout.test.ts`, ny `describe('runAutoLayout considerModelOrder')`, 4 testar — speglar den empiriske verifiseringa frå runde 2, no som regresjonstestar mot `runAutoLayout` sjølv, ikkje berre rå `elkjs`):
- Stablar mål i deklarasjonsrekkjefølgje når PÅ (LR-layout).
- IKKJE pålieleg deklarasjonsrekkjefølgje når AV (standard).
- Snudd deklarasjonsrekkjefølgje snur resultatet tilsvarande (provar at det er VÅR rekkjefølgje som vert lesen, ikkje ein tilfeldigheit).
- Standardverdi av (uendra åtferd) når parameteret er utelate.

**Verifisert:**
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- `pnpm exec eslint packages/*/src --ext .ts,.tsx` (heile repoet): 0 feil, 0 åtvaringar.
- `scripts/check-token-usage.sh`: PASS.
- `autoLayout.test.ts` åleine: 48/48 testar grøne (44 eksisterande + 4 nye).
- Full `packages/core`-testpakke: 275/275 testar grøne (**null faktiske testfeil**), 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]`-infrastrukturflaksen — ingen reelle regresjonar.

**Ikkje verifisert manuelt i nettlesar** — visuell stadfesting av den nye "Schema order"-veljaren (spesielt på `enhetsregisteret-frivilligorganisasjonapi-schema.yaml`, der `FrivilligOrganisasjon` sine 6 mål no bør stable seg i deklarasjonsrekkjefølgje) bør gjerast ved neste rebuild/redeploy.

**Attverande, ikkje implementert:** `greedySwitch.type` (ikkje tilrådd, verifisert null effekt), `compaction.connectedComponents` (ikkje prioritert), og Alternativ C (ELK-ruta range-kantar, stort sjølvstendig prosjekt) — sjå ope spørsmål 3 over, framleis ubesvara.

## Runde 4 (2026-09-15) — nytt hovudfunn: to uavhengige, alfabetiske sorteringar undergrev `considerModelOrder`

Ønske (ordrett): "Kva andre tiltak kan vi gjere for å få mindre overlappande range kantar?"

### Funn 1 — kjeldekortet sine handtak følgjer IKKJE deklarasjonsrekkjefølgja, sjølv når `considerModelOrder` er PÅ

`considerModelOrder` (Runde 3) styrer KOR ELK PLASSERER mål-nodane — stadfesta perfekt (byte-for-byte deklarasjonsrekkjefølgje). Men KOR PÅ KJELDEKORTET kvar kant faktisk GÅR UT FRÅ er ein heilt annan, uavhengig kodesti: `deriveGraph.ts` sorterer `resolvedSlots` (som avgjer rad-/handtak-rekkjefølgja via `classSlotMidY`) ALFABETISK etter slot-namn:

```ts
// deriveGraph.ts:274
resolvedSlots.sort((a, b) => a.slot.name.localeCompare(b.slot.name));
```

Denne sorteringa bryr seg ikkje om `considerModelOrder` i det heile — han er alltid alfabetisk, uansett kva layout-innstilling som er vald.

**Stadfesta empirisk mot `FrivilligOrganisasjon` (`enhetsregisteret-frivilligorganisasjonapi-schema.yaml`), med `considerModelOrder` PÅ:**

| Attributt | Deklarasjons-indeks | Rad/handtak-indeks (alfabetisk) | Mål-stabel-indeks (ELK, no korrekt) |
|---|---|---|---|
| icnpokategorier → IcnpoKategori | 0 | 1 | 0 |
| vedtekter → Vedtekter | 1 | **5 (sist)** | 1 |
| grasrotandel → Grasrotandel | 2 | **0 (fyrst)** | 2 |
| regnskapsrapportering → Regnskapsrapportering | 3 | 3 | 3 |
| paategninger → Paategning | 4 | 2 | 4 |
| relasjoner → Virksomhetsrelasjon | 5 | 4 | 5 |

Mål-stabelen er PERFEKT ordna (kolonne 4 = kolonne 1, alltid). Men rad-/handtak-rekkjefølgja (kolonne 3) er HEILT ulik — t.d. "vedtekter" sitt handtak sit NEST NEDST på kortet (rad 5 av 6), sjølv om målet "Vedtekter" er stabla NEST ØVST (stabel-plass 1 av 6). Kanten frå "vedtekter" må difor gå frå BOTNEN av kjeldekortet HEILT OPP TIL NESTEN TOPPEN av mål-stabelen — akkurat den typen unødvendige sikk-sakk-rørsle `considerModelOrder` var meint å fjerne. Tilsvarande for "grasrotandel" (handtak øvst, mål midt i stabelen).

**Konsekvens:** `considerModelOrder` løyser berre HALVPARTEN av problemet han er meint for — mål-SIDA er perfekt, men kjelde-SIDA (kor kanten fysisk går UT FRÅ) er framleis tilfeldig (alfabetisk) i høve til den same rekkjefølgja. To kantar med handtak i "feil" rekkjefølgje i høve til kvarandre vil framleis krysse kvarandre, sjølv om måla deira er perfekt stabla.

### Funn 2 — innkomande handtak på MÅL-noden er sorterte alfabetisk etter KJELDE-namn, ikkje etter kjelda sin faktiske posisjon

Same rotårsak-mønster, motsett side: `collectIncomingRangeHandles()` (lagt til i Runde 2/3 av `range-edge-collision-and-label-visibility.md`) sorterer dei innkomande handtaka på eit mål slik:

```ts
// deriveGraph.ts
list.sort((a, b) => a.source.localeCompare(b.source) || a.slotName.localeCompare(b.slotName));
```

Alfabetisk etter KJELDE-KLASSENAMN — utan omsyn til kor kjeldene FAKTISK er plasserte på canvaset.

**Stadfesta empirisk mot `Skole` (`samt-bu-schema.yaml`, 3 innkomande kantar på vest-sida):**

| Kjelde | Alfabetisk handtak-rekkjefølgje (dagens) | Faktisk Y-posisjon | Rekkjefølgje etter faktisk posisjon |
|---|---|---|---|
| Basisgruppe | 1 (øvst) | y=770 (**nedst**) | 3 (nedst) |
| Kontaktlaerer | 2 (midt) | y=699 (midt) | 2 (midt) |
| Rektor | 3 (nedst) | y=609 (**øvst**) | 1 (øvst) |

**Stikk motsett rekkjefølgje** — det øvste handtaket på Skole koplar til Basisgruppe, som faktisk sit NEDST på skjermen, medan det nedste handtaket koplar til Rektor, som faktisk sit ØVST. Dette GARANTERER at desse to kantane kryssar kvarandre — heilt unødvendig, sidan det einaste som trengst er å sortere etter faktisk Y-posisjon i staden for alfabetisk namn.

### Forslag til fiks

**Funn 2 (innkomande handtak): tilrådd som eit ubetinga, trygt fiks** — byt sorteringsnøkkelen frå `a.source.localeCompare(b.source)` til faktisk Y-posisjon (`layout.nodes[a.source]?.y - layout.nodes[b.source]?.y`, med alfabetisk som sekundær tiebreak for stabilitet når posisjonar er like/manglar). Dette har INGEN synleg kostnad eller åtferdsendring utanom å fjerne unødvendige kryssingar — det finst ingen god grunn til å halde fram med alfabetisk sortering her, sidan handtak-DOTTEN sjølv ikkje er noko brukaren "les" i rekkjefølgje (i motsetnad til klasse-eigenskapslista, som ER meint å lesast). Treng ikkje eit eige på/av-val — kan vere alltid-på.

**Funn 1 (kjeldekort-handtak): treng eit brukarval, IKKJE eit ubetinga fiks** — å endre `resolvedSlots` sin sorteringsrekkjefølgje frå alfabetisk til deklarasjonsrekkjefølgje ville ENDRE KVA REKKJEFØLGJE EIGENSKAPANE FAKTISK VERT LISTA I på kvart einaste klassekort i heile appen — ei synleg, lesbarheits-relevant endring (alfabetisk er lettare å skanne/finne ein bestemt eigenskap i, deklarasjonsrekkjefølgje matchar YAML-fila men kan vere vilkårleg for lesaren). Tre alternativ:

- **A — Ubetinga endring:** byt `resolvedSlots` sin sortering til deklarasjonsrekkjefølgje for ALLE klassar, alltid. Størst nytte (hjelper sjølv når `considerModelOrder` er av, sidan det framleis fjernar EITT tilfeldig avvik), men størst synleg åtferdsendring for alle brukarar, alltid.
- **B — Kopla til `considerModelOrder`:** behald alfabetisk sortering som standard (uendra), men byt til deklarasjonsrekkjefølgje BERRE når `considerModelOrder` er PÅ. Gjer "Schema order"-valet til ein FULLSTENDIG, samanhengande funksjon (kjelde OG mål ordna likt) i staden for berre halvvegs, utan å endre standard-åtferda for nokon som ikkje har slått på valet.
- **C — Ikkje rør listevisinga, berre handtak-POSISJONEN:** hald fram med alfabetisk LISTEVISING (lesbarheit uendra), men gjer sjølve HANDTAK-DOTTEN sin Y-posisjon uavhengig av kva rad han visuelt står ved (bruk deklarasjonsindeks for handtak-Y, ikkje rad-indeks). **Ikkje tilrådd** — ville gjort at handtak-dotten "flyt vekk" frå si eiga rad-tekst, eit anna, truleg meir forvirrande visuelt avvik enn det som vert fiksa (den vesle dotten ved sida av "vedtekter"-teksten ville ikkje lenger vere DER "vedtekter" står skrive).

**Tilråding:** Funn 2 åleine (trygt, ubetinga). For Funn 1: **Alternativ B** — kopla til `considerModelOrder`, gjer det eksisterande valet heilskapleg i staden for å innføre ei ny, brei åtferdsendring for alle.

## Testcase / akseptansekriterium (Runde 4)

1. **Funn 2:** syntetisk skjema med eitt mål og 3 kjelder plasserte i KJEND, ikkje-alfabetisk Y-rekkjefølgje; stadfest at `incomingRangeHandles` sin rekkjefølgje matchar den faktiske Y-rekkjefølgja, ikkje alfabetisk kjeldenamn.
2. **Funn 1 (viss Alternativ B godkjent):** `resolvedSlots` sin rekkjefølgje matchar deklarasjonsrekkjefølgje NÅR `considerModelOrder` er PÅ, framleis alfabetisk NÅR AV (regresjon).
3. Manuell stadfesting på `enhetsregisteret-frivilligorganisasjonapi-schema.yaml`/`samt-bu-schema.yaml`: synleg færre kryssande/sikk-sakk-kantar med begge fiksane aktive samstundes.

## Runde 5 (2026-09-15) — dei tilrådde tiltaka for Funn 1 og 2 implementerte

Brukaren skreiv "utfør tilrådde tiltak for funn 1 og 2" — eksplisitt godkjenning for dei TILRÅDDE alternativa spesifikt (Funn 2 sitt ubetinga fiks, Funn 1 sitt Alternativ B), ikkje dei andre alternativa (A/C for Funn 1) som vart lista som ikkje-tilrådde.

**Funn 2 implementert, ubetinga (`deriveGraph.ts`, `collectIncomingRangeHandles()`):** sorteringsnøkkelen for innkomande handtak bytt frå `a.source.localeCompare(b.source)` til faktisk Y-posisjon (`layout.nodes[a.source]?.y - layout.nodes[b.source]?.y`), med namn-basert samanlikning som fallback når posisjon manglar eller er lik (for determinisme, t.d. med `emptyCanvasLayout()` i testar).

**Funn 1 implementert, Alternativ B (`deriveGraph.ts`, `deriveGraph()`):** nytt `considerModelOrder = false`-parameter. Den eksisterande `resolvedSlots.sort(...)` (alfabetisk) køyrer no BERRE `if (!considerModelOrder)` — når PÅ, held `resolvedSlots` fram med sin naturlege push-rekkjefølgje (eigne attributt i YAML-rekkjefølgje, så eigne skjema-slots i YAML-rekkjefølgje, så nedarva), som samsvarer med den same rekkjefølgja `elk.layered.considerModelOrder.strategy` (autoLayout.ts) alt nyttar for å stable måla. `SchemaCanvas.tsx` sin `deriveGraph(...)`-kall oppdatert til å sende det eksisterande `considerModelOrder`-tilstandsfeltet vidare (attgjenbruk av same togle som Runde 3 alt la til, ingen ny UI-kontroll naudsynt).

**Testar lagt til** (`edgeAttributes.test.ts`):
- Funn 2: éin test som stadfestar namn-basert fallback (uendra åtferd med `emptyCanvasLayout()`), éin NY test med eksplisitte, bevisst REVERSERT-alfabetiske Y-posisjonar som stadfestar handtaka no følgjer faktisk posisjon.
- Funn 1: ny `describe('deriveGraph resolvedSlots order (Funn 1, considerModelOrder)')` med 2 testar — alfabetisk som standard (av, uendra), deklarasjonsrekkjefølgje når PÅ.

**Empirisk re-stadfesta mot NØYAKTIG dei same røyndoms-tilfella som avdekte funna** (mellombels debug-testskript, køyrt éin gong, sletta etterpå):
- `FrivilligOrganisasjon`: rendra rad-rekkjefølgje er no BYTE-FOR-BYTE lik deklarasjonsrekkjefølgja (`icnpokategorier, vedtekter, grasrotandel, regnskapsrapportering, paategninger, relasjoner`) når `considerModelOrder` er PÅ — stadfesta at Funn 1 sitt gap er lukka.
- `Skole` (samt-bu-schema.yaml): dei 3 vest-side innkomande handtaka er no ordna `[Rektor, Kontaktlaerer, Basisgruppe]` — nøyaktig same rekkjefølgje som faktisk Y-posisjon, IKKJE lenger den reverserte alfabetiske rekkjefølgja frå før.

**Verifisert:**
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- `pnpm exec eslint packages/*/src --ext .ts,.tsx` (heile repoet): 0 feil, 0 åtvaringar.
- `scripts/check-token-usage.sh`: PASS.
- `edgeAttributes.test.ts` åleine: 48/48 testar grøne (45 eksisterande + 3 nye).
- Full `packages/core`-testpakke: 277/277 testar grøne (**null faktiske testfeil**), 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]`-infrastrukturflaksen — ingen reelle regresjonar.

**Ikkje implementert (ikkje del av godkjenninga denne runda):** Alternativ A/C for Funn 1, `greedySwitch.type`, `compaction.connectedComponents`, og Alternativ C frå Runde 1/2 (ELK-ruta range-kantar) — spec-en held difor fram i `specs/backlog/`.

**Ikkje verifisert manuelt i nettlesar** — bør stadfestast ved neste rebuild/redeploy (hugs `podman-compose down` FØR `up --build -d`).
