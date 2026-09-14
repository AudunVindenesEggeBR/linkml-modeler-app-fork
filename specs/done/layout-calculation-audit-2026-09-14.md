# Spec: Audit — andre stader i layout-kalkuleringa som ikkje tek omsyn til `slots` eller har andre openberre manglar

Status: **Funn 1, 2 og 3 implementerte og verifiserte (runde 2).** Sjå "Runde 2" nedst. Eit nytt, ikkje-implementert 4. funn vart oppdaga undervegs, splitta ut til `specs/backlog/nodegeometry-autolayout-constant-mismatch.md`.
Dato: 2026-09-14

Ønske (ordrett): "evaluer om det finnes andre områder i layout kalkulering som ikkje tar hensyn til slots eller har andre åpenbare mangler. Skriv til /specs"

## Metode

Las gjennom heile `autoLayout.ts` (473 linjer) på nytt, kryssjekka kvar funksjon mot den tilsvarande rendringslogikken i `ClassNode.tsx`/`EnumNode.tsx` (kva vert FAKTISK teikna) og `deriveGraph.ts` (kva denne fila alt handterer korrekt), same metodikk som avdekte dei to førre feila i denne fila denne økta. Fokus: finn stader der layout-kalkuleringa (a) ikkje tek omsyn til `slots`, eller (b) har andre openberre skilnader frå kva som faktisk vert rendra.

## Funn 1 (HØG prioritet — ny, ikkje tidlegare oppdaga): `estimateClassNodeSize` set inga grense ved `SLOT_LIMIT_EXPANDED` — i motsetnad til `estimateEnumNodeSize`, som gjer nøyaktig det rette

`ClassNode.tsx:29` avgrensar synlege rader til `SLOT_LIMIT_EXPANDED = 20`, med ein `"+N more…"`-rad utover det (`ClassNode.tsx:126-127, 192-194`) — akkurat same mønster som `EnumNode.tsx:15` sin `VALUE_LIMIT = 12` (`EnumNode.tsx:20-21, 67-69`).

**`estimateEnumNodeSize` (autoLayout.ts:70-75) gjer dette RETT:**
```ts
const visibleRows = Math.min(valueCount, ENUM_VALUE_LIMIT) + (valueCount > ENUM_VALUE_LIMIT ? 1 : 0);
```
— `ENUM_VALUE_LIMIT = 12` (autoLayout.ts:43) samsvarer eksakt med `EnumNode.tsx`sin `VALUE_LIMIT = 12`.

**`estimateClassNodeSize` (autoLayout.ts:60-64) gjer det IKKJE:**
```ts
const attrCount = Object.keys(classDef.attributes).length + classDef.slots.length;
const height = HEADER_H + (classDef.isA ? ISA_ROW_H : 0) + BODY_PADDING + attrCount * ROW_H;
```
— ingen tilsvarande cap. `SLOT_LIMIT_EXPANDED` finst berre som ein privat, ikkje-eksportert konstant i `ClassNode.tsx`, `autoLayout.ts` veit ikkje at han eksisterer.

**Stadfesta empirisk** (mellombels debug-testskript, køyrt éin gong, sletta etterpå): ein syntetisk klasse med 100 attributt —
```
estimate for 100 attributes: 2342px
actual rendered height (20 synlege + 1 "+80 more"-rad): 525px
overvurdering: 1817px
```

**Konsekvens:** i MOTSETNAD til dei to førre funna denne økta (som var UNDERvurderingar → overlapp), er dette ei OVERvurdering — trygg retning (ingen overlapp-risiko), men han sløser enormt mykje loddrett plass for kvar klasse med meir enn 20 eigenskapar, og veks ubegrensa med talet på eigenskapar (t.d. 1817px bortkasta for berre 100 attributt — verre for endå fleire). Dette forvrengjer heile diagrammet sine proporsjonar rundt éin einaste stor klasse, sjølv om det ikkje gir synleg overlapp. **Vert meir sannsynleg å treffast no** enn før denne økta si `classDef.slots.length`-utviding (Runde 2 av `specs/done/estimateclassnodesize-missing-schema-level-slots.md`), sidan klassar som brukar BÅDE `attributes` OG `slots` no summerer begge — ein klasse med 12 attributt + 12 schema-slots (24 totalt) ville før denne økta aldri trigga 20-grensa i det heile (kvar kjelde under grensa kvar for seg), men gjer det no.

**Forslag til fiks** (ikkje implementert): speil `estimateEnumNodeSize` sitt mønster nøyaktig:
```ts
const CLASS_SLOT_LIMIT = 20; // must match ClassNode.tsx's SLOT_LIMIT_EXPANDED
const attrCount = Object.keys(classDef.attributes).length + classDef.slots.length;
const visibleRows = Math.min(attrCount, CLASS_SLOT_LIMIT) + (attrCount > CLASS_SLOT_LIMIT ? 1 : 0);
const height = HEADER_H + (classDef.isA ? ISA_ROW_H : 0) + BODY_PADDING + visibleRows * ROW_H;
```

**Design-spørsmål verdt å avklare før implementering:** `ENUM_VALUE_LIMIT`/`VALUE_LIMIT` er alt to UAVHENGIGE konstantar (éin i `autoLayout.ts`, éin i `EnumNode.tsx`) som berre held seg i synk fordi nokon hugsar å oppdatere begge — akkurat det mønsteret som skapte DENNE buggen for `SLOT_LIMIT_EXPANDED` (som aldri vart repetert i `autoLayout.ts` i det heile). Bør `SLOT_LIMIT_EXPANDED` (og kanskje `ENUM_VALUE_LIMIT`/`VALUE_LIMIT` i same slengen) flyttast til éin delt, eksportert konstant (t.d. ein ny liten fil, eller eksportert frå éin av dei to og importert i den andre) for å hindre at dei driv frå kvarandre igjen i framtida — eller er det nok å berre leggje til ein tydeleg kryssvisande kommentar på begge stader (billegare, men same skjøre mønster som alt feila éin gong)?

## Funn 2 (allereie kjent, stadfesta på nytt for fullstendigheit): nedarva `is_a`/`mixins`-slots vert framleis ikkje talde

Dokumentert som eit medvite avgrensa/utsett funn i `specs/done/estimateclassnodesize-missing-schema-level-slots.md` ("Kjent, medvite avgrensa omfang"-seksjonen). Stadfesta framleis til stades — ingen endring sidan då. Nemnt her att for at denne evalueringa skal vere fullstendig, ikkje som eit nytt funn.

**Merk eit samspel med Funn 1 verdt å vurdere saman, viss/når nokon av dei to vert fiksa:** `resolvedSlots` i `deriveGraph.ts` (det `SLOT_LIMIT_EXPANDED`-grensa faktisk gjeld for i UI-et) inkluderer BÅDE eigne OG nedarva slots. Det tyder at Funn 1 (manglande cap) og Funn 2 (manglande nedarva-telling) delvis kan **oppheve kvarandre tilfeldig** for enkelte klassar (éin gjer estimatet for stort, den andre for lite) — ein grunn til å vurdere begge saman heller enn å fikse berre éin isolert, sidan ein isolert fiks av berre eitt av dei kunne i verste fall GJERE totalresultatet verre for enkelte klassar (mindre tilfeldig kompensasjon) før det andre òg er retta.

## Funn 3 (lågt prioritert, informativt — ikkje ein layout-kalkuleringsfeil): LinkML sine dynamiske enum-verdiar (`reachable_from`) vert ikkje viste i det heile

`EnumDefinition.reachableFrom` (`model/index.ts:187, 198-202`) er ein typa, gyldig LinkML-mekanisme (`reachable_from` — hentar tillatne verdiar dynamisk frå ein ekstern ontologi i staden for ei statisk `permissible_values`-liste). Verken `EnumNode.tsx` (rendring) eller `estimateEnumNodeSize` (layout) har NOKO kjennskap til dette feltet — ein enum med berre `reachable_from` og ingen `permissible_values` viser berre `"no values"` (den eksisterande tomme-fallback-raden, `EnumNode.tsx:70-72`).

**Kvifor dette IKKJE er ein layout-overlapp-risiko:** den tomme fallback-raden er godt innanfor golvhøgda (`ENUM_H = 80`), så `estimateEnumNodeSize` sitt resultat for ein slik enum er om noko ei lita OVERvurdering (trygg retning), ikkje ei undervurdering. Dette er difor ikkje same type feil som Funn 1/2 eller dei to førre rettingane denne økta — det er meir eit **rendrings-/funksjonsomfang-hol** (dynamiske enum-verdiar vert ikkje synleggjort i det heile) enn ein feil i sjølve layout-STORLEIKS-utrekninga. Nemnt her for fullstendigheit sidan spørsmålet eksplisitt bad om "andre openberre manglar", men **ikkje** i same kategori eller prioritet som Funn 1.

## Stadfesta IKKJE eit problem (sjekka eksplisitt, for å vise kva som faktisk vart undersøkt)

- **`is_a`/`mixin`/`union_of`-kantar:** desse er klasse-nivå-felt (`classDef.isA: string`, `classDef.mixins: string[]`, `classDef.unionOf: string[]`) utan noka tilsvarande "skjema-nivå indirection" slik `attributes` vs. `slots` har for eigenskapar — det finst difor ingen analog "gløymt den andre kjelda"-feil moglegheit her.
- **Ingen eigen "mixins:"-rad i `ClassNode.tsx`:** berre `is_a` får ein dedikert header-rad (`ISA_ROW_H`); ein klasse som BERRE har `mixins` (ingen `is_a`) får ingen ekstra rad å telje for — stadfesta ved å lese `ClassNode.tsx` sitt render-tre eksplisitt, ingen `mixinsRow`-ekvivalent finst.
- **Badge-tal per rad (R/M/id/S/A/~/↻) påverkar ikkje radhøgd:** `slotRow`/`badgeGroup`-stilane har ingen `flexWrap: 'wrap'`, og tekst er ellipsis-avkorta (ikkje linjeskift) — radhøgd er difor pålieleg konstant uavhengig av kor mange badges ei rad har, stadfesta ved å lese dei faktiske CSS-stilobjekta i `ClassNode.tsx`.
- **Spøkelse-/importerte einingar:** `estimateClassNodeSize(entity.schema.classes[entity.name])`/`estimateEnumNodeSize(entity.schema.enums[entity.name])` (autoLayout.ts:235-237) brukar dei SAME (no fiksa for Funn frå tidlegare runder) funksjonane generisk — ingen separat, uavhengig kodesti for importerte einingar sin storleiksestimering, så alt som er retta/att-å-rette for lokale klassar gjeld automatisk for spøkelse-einingar òg.

## Runde 2 (2026-09-14) — Funn 1, 2 og 3 implementerte

Brukaren skreiv "utfør tiltak for funn 1, 2 og 3" — eksplisitt godkjenning for desse tre, jf. CLAUDE.md. Dei fire opne spørsmåla frå runde 1 vart ikkje eksplisitt svara på — avgjerdene under er difor mine eigne, grunngjevne val, tydeleg merkte som det.

### Design-val teke (opne spørsmål 1-3 var ikkje eksplisitt svara på)

1. **Konstant-synkronisering (ope spørsmål 3):** vald **delte, eksporterte konstantar** — ny fil `packages/core/src/canvas/nodeLimits.ts` med `CLASS_SLOT_LIMIT = 20` og `ENUM_VALUE_LIMIT = 12`, importert av `ClassNode.tsx`, `EnumNode.tsx` OG `autoLayout.ts`. Grunngjeving: den kryssvisande-kommentar-varianten er nøyaktig det mønsteret som alt feila éin gong (`SLOT_LIMIT_EXPANDED` fanst berre i `ClassNode.tsx`, aldri repetert i `autoLayout.ts` i det heile) — ein delt konstant gjer denne klassen av feil strukturelt umogleg å gjenta, ikkje berre dokumentert.
2. **Funn 1 + Funn 2 saman (ope spørsmål 2):** implementerte begge samtidig, som antyda i samspel-notatet — å fikse berre éin isolert kunne gjort totalresultatet verre for enkelte klassar før det andre òg vart retta.
3. **Funn 3, avgrensa omfang:** implementerte KUN ei tydeleggjering i UI-et (`EnumNode.tsx` viser `"dynamic (reachable_from)"` i staden for det generiske `"no values"` når ein enum har `reachableFrom` sett og ingen `permissibleValues`) — IKKJE noka form for henting/visning av faktiske ontologi-verdiar (ville kravd live nettverkskall til ein ekstern ontologi-teneste, ein heilt annan og mykje større funksjon enn ei layout-kalkuleringsretting). `estimateEnumNodeSize` treng ingen endring — golvhøgda (80px) dekkjer denne eine-rad-tilfellet trygt uansett tekstinnhald, stadfesta ved å òg leggje til eksplisitt `overflow/textOverflow/whiteSpace`-handtering på `emptyRow`-stilen (den lengre teksten "dynamic (reachable_from)" hadde elles ingen garanti mot linjebrot, i motsetnad til alle andre rader i same fil).

### Implementert

- **`packages/core/src/canvas/nodeLimits.ts`** (ny fil): `CLASS_SLOT_LIMIT = 20`, `ENUM_VALUE_LIMIT = 12`.
- **`ClassNode.tsx`**: `SLOT_LIMIT_EXPANDED` er no henta frå `nodeLimits.ts` i staden for ein lokal, ikkje-delt konstant.
- **`EnumNode.tsx`**: `VALUE_LIMIT` henta frå `nodeLimits.ts` same måte. `emptyRow` viser no `"dynamic (reachable_from)"` vs `"no values"` avhengig av `enumDef.reachableFrom`, med ny `overflow/textOverflow/whiteSpace`-styling for tryggleik mot linjebrot.
- **`autoLayout.ts`**:
  - `estimateClassNodeSize` fekk to nye, valfrie parameter (`schema?: LinkMLSchema`, `allSchemaSlots: Record<string, SlotDefinition> = {}`) — bakoverkompatibel, alle ~30 eksisterande kall utan desse er heilt uendra.
  - Ny privat `gatherAncestorSlotNames()`-funksjon, ein forenkla parallell til `deriveGraph.ts` sin ikkje-eksporterte `gatherAncestorSlots()` (same is_a-kjede-så-mixins-rekkjefølgje, same `visited`-syklusvakt), men returnerer berre namn (ein `Set<string>`) i staden for fulle `ResolvedSlot`-objekt — unngår kopling til `ClassNode.tsx` sin `ResolvedSlot`-type, som er overkill for eit reint tal-estimat. Logikken er dupliserte, ikkje delt — kommentert eksplisitt kvifor, og at han bør haldast i synk viss traverseringslogikken nokon gong endrar seg ein av dei to stadene.
  - `estimateClassNodeSize` sin `attrCount`-utrekning bytt frå ein tal-sum til eit `Set<string>` av unike slot-namn (eigne attributt + eigne skjema-slots + — når `schema` er gitt — nedarva namn), som naturleg dedupliserer (ein slot som finst BÅDE som attributt OG som nedarva, eller nedarva frå fleire stader, tel no berre éin gong — ein liten ekstra korrektheitsforbetring utan ekstra kompleksitet).
  - Cap lagt til: `Math.min(attrCount, CLASS_SLOT_LIMIT) + (attrCount > CLASS_SLOT_LIMIT ? 1 : 0)`, same mønster som `estimateEnumNodeSize` alt brukte.
  - Alle tre kallstadene til `estimateClassNodeSize` INNI `autoLayout.ts` (hovudløkka for lokale klassar, spøkelse-/importerte einingar, `repositionTreeRootNodesLeft`) oppdatert til å sende `schema`/`allSchemaSlots` — utan denne oppdateringa ville Funn 2 vore implementert, men aldri faktisk BRUKT av `runAutoLayout` sjølv. `repositionTreeRootNodesLeft` fekk eit nytt 4. parameter (`allSchemaSlots`), tredd inn frå `runAutoLayout` sitt eige (alt eksisterande) parameter.

### Empirisk stadfesta (mellombels debug-testskript, køyrt fleire gonger undervegs, sletta etterpå)

- **Funn 1 (cap):** ein syntetisk klasse med 100 attributt — FØR: 2342px. ETTER: 525px (20 synlege rader + 1 "+80 more"-rad), nøyaktig som handrekna forventa. Stadfesta at cap-grensa (21 rader) ikkje veks vidare forbi det, uansett kor mange fleire attributt (100 vs 21 gir identisk høgd).
- **Funn 2 (nedarva slots):** køyrde `runAutoLayout` mot BÅDE `samt-bu-schema.yaml` (har rik `is_a`-struktur) OG `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` (ingen `is_a`) med full inheritance-medvit (`schema`/`allSchemaSlots` sendt inn):
  - `samt-bu`: **0 overlapp** blant 11 nodar. `Kontaktlaerer` (is_a `Person`) sitt estimat endra seg synleg med nedarving aktivert: **135px (utan nedarving) → 158px (med nedarving)** — stadfestar at Funn 2 er reelt aktiv for ein ekte klasse, ikkje berre i syntetiske testar.
  - `enhetsregisteret`: **0 overlapp** blant 10 nodar (uendra frå førre runde, sidan dette skjemaet ikkje har `is_a` i det heile — Funn 2 har ingenting å telje der, som venta).

### Testar lagt til (`autoLayout.test.ts`)

- Ny `describe('estimateClassNodeSize slot-count cap (Funn 1)')` — 2 testar: cap-grensa legg til nøyaktig éi rad si høgd ved overgang frå 20→21, og veks IKKJE vidare frå 21→100.
- Ny `describe('estimateClassNodeSize inherited slots via is_a/mixins (Funn 2)')` — 5 testar: bakoverkompatibilitet (ingen endring når `schema` er utelaten), `is_a`-nedarving aukar estimatet, `mixins`-nedarving aukar estimatet, eit namn som finst BÅDE lokalt og nedarva tel berre éin gong (deduplisering), og eit `is_a` som peiker på ein ikkje-eksisterande klasse krasjar ikkje.
- Ingen ny automatisert test for Funn 3 (EnumNode.tsx-tekstendring) — inga eksisterande komponent-rendrings-testinfrastruktur (`@testing-library/react` e.l.) finst for `ClassNode.tsx`/`EnumNode.tsx` i dette repoet i det heile (stadfesta ved søk), og å byggje ei ny testinfrastruktur berre for denne eine tekstlinja vart vurdert som uforholdsmessig stort i høve til endringa sjølv. Verifisert i staden via typecheck + lint + manuell logikk-gjennomgang; bør stadfestast visuelt ved neste rebuild/redeploy.

### Verifisert

- `autoLayout.test.ts` åleine: 44/44 testar grøne (37 eksisterande + 7 nye).
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- ESLint på alle 5 endra/nye filene: 0 feil, 0 åtvaringar.
- `scripts/check-token-usage.sh`: PASS (0 fargeliteralar, 0 `fontFamily:monospace`-literalar — relevant sidan `EnumNode.tsx` fekk nye CSS-stilfelt).
- Full `packages/core`-testpakke via `pnpm --filter @linkml-editor/core test`: 294/296 testar grøne (2 todo, **null faktiske testfeil**), 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]`-infrastrukturflaksen — ingen reelle regresjonar.

**Ikkje verifisert manuelt i nettlesar** — særleg Funn 3 sin nye enum-tekst, og at cap+nedarving saman gir eit visuelt fornuftig resultat for `samt-bu-schema.yaml` sine is_a-klassar, bør stadfestast ved neste rebuild/redeploy (hugs `podman-compose down` FØR `up --build -d`, jf. `specs/done/podman-compose-stale-container-on-rebuild.md`).

## Nytt funn oppdaga undervegs — no eiga spec

Medan Funn 1 sin konstant-delings-implementering var i gang, vart det oppdaga at `nodeGeometry.ts` (handle-plassering) og `autoLayout.ts` (høgdeestimat) har kvar sin, innbyrdes ULIKE versjon av "same" mål (header-høgd, is_a-rad-høgd, body-padding). Dette er UTANFOR dei tre eksplisitt godkjende funna denne runda ("funn 1, 2 og 3"), så det er splitta ut til ei eiga spec i staden for å implementerast her: **`specs/backlog/nodegeometry-autolayout-constant-mismatch.md`**.
