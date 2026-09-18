# Spec: Redigering av `types:` i Properties Panel — tilsvarande global slots-redigering

Status: **Implementert og verifisert.** Brukaren godkjende: (1) inkluder fiksing av `useRangeOptionGroups`, (2) gjer type-rader i Outline View klikkbare, (3) IKKJE gjer Table View sin "types"-fane redigerbar, (4) IKKJE ta med `repr`-feltet i UI-et. Alle fire punkt implementerte som spesifisert. Sjå "Implementering" nedanfor.
Dato: 2026-09-16
Ønske (direkte sitat): "i Properties panelet kan vi editere globale slots. Evaluer om vi kan legge til mulighet for å editere types på tilsvarande måte og skriv til /specs"

## Stadfesta fakta (denne økta)

Grunnlag: lesing av `SchemaMetaPanel.tsx`, `SchemaSlotInlineEditor.tsx`, `projectSlice.ts`, `model/index.ts`, `io/yaml.ts`, `validation/index.ts`, `TableView.tsx`, `OutlineView.tsx`, `useRangeOptionGroups.ts`, `useSchemaSlotOptionGroups.ts`, `FilteredGroupedSelect.tsx`, og `specs/backlog/cross-repo-import-resolution-gaps.md` (runde 3).

1. **Global slot-redigering i dag** skjer i `SchemaMetaPanel.tsx` sin "Schema Slots"-seksjon (linje 272-315), som listar `schema.slots` via `SchemaSlotInlineEditor.tsx` (collapsible rad per slot: namn/rename, description, range-dropdown, flagg, `slot_uri`, subset-medlemskap, slett), backa av fire store-actions i `projectSlice.ts` — `addSchemaSlot`/`updateSchemaSlot`/`deleteSchemaSlot`/`renameSchemaSlot` — alle via ein delt `patchSchema`-hjelpefunksjon.

2. **`TypeDefinition`-modellen finst alt fullt ut** (`model/index.ts:215-223`: `name`, `uri`, `description`, `typeof`, `base`, `repr`, `extras` — 6 substansielle felt, vesentleg enklare enn `SlotDefinition` sine 20+), og er alt fullt **parsa/serialisert** (`io/yaml.ts` `parseType`/`serializeType`), alt brukt i **validering** (`validation/index.ts`: `allTypeNames`, `isValidRange()`) og alt handtert i **cross-schema import-oppløysing** (`importResolver.ts`). Dette er difor IKKJE eit "legg til ny modell"-prosjekt — modell-, parse- og valideringslaget er alt på plass og verifisert (jf. `specs/backlog/cross-repo-import-resolution-gaps.md` sine runde 1-2-funn B1-B3).

3. **Dette er eit kjent, eksplisitt utsett hol**, ikkje eit nytt funn. `specs/backlog/cross-repo-import-resolution-gaps.md` (runde 3, "Implementering") seier ordrett om Table View sin nyleg tilførte "types"-fane: *"Kolonnene er medvite READ-ONLY (ingen `TextCell`/mutasjon-kall) sidan det ikkje finst nokon `updateType()`-store-mutasjon å kople inline-redigering til — å leggje det til var utanfor omfanget av dette funnet."* Same fil, same runde, la til lesbare "Types"-seksjonar i Outline View, Table View og eit types-tal-badge i `ProjectPanel.tsx`, men eksplisitt INGEN mutasjonsveg. Stadfesta i koden: `TableView.tsx:401-405` har ein kommentar som siterer nøyaktig dette, og Outline View sine type-rader er *"medvite IKKJE del av `navigableIds` (tastatur-nav) sidan det ikkje finst noka `ActiveEntity`/PropertiesPanel-støtte for typar å navigere TIL"* (same kjelde).

4. **Relatert, tilstøytande hol, stadfesta same økta:** `useRangeOptionGroups.ts` (brukt av `SchemaSlotInlineEditor` sin Range-dropdown, og truleg av class-attributt-range-editoren) byggjer options frå ein hardkoda "Built-in types"-liste (`string, integer, float, boolean, date, datetime, uri, uriorcurie`) + classes + enums **per skjema** — `schema.types` vert **aldri lese her**. I praksis: ein slot sin `range` KAN i dag teknisk setjast til eit eigendefinert type-namn (`FilteredGroupedSelect` tillèt fritekst via Enter/blur — `FilteredGroupedSelect.tsx:103-111/115-124` — og `isValidRange` godtek det korrekt), men brukaren finn ALDRI typenamnet i nedtrekkslista og må vite/hugse det utanfrå (t.d. frå Outline/Table View sine no-lesbare types-seksjonar). Ikkje funksjonelt broten, berre lite oppdageleg — men direkte relevant her sidan ein `TypeDefinition.typeof`-editor (sjå Vurdering, punkt C) treng nøyaktig den same typen liste.

5. **Presedens for delete/rename-kaskade**, stadfesta ved lesing av `projectSlice.ts`: `renameClass`/`deleteClass` cascadar `isA`/`mixins`-referansar TIL den same klassen (linje 276-303), men cascadar ALDRI `range`-verdiar PÅ ANDRE ENTITETAR som peikar på klassen — ein rename av ein klasse etterlèt "dangling" range-referansar, som deretter vert fanga av valideringspanelet sin `isValidRange`-sjekk. Same mønster gjeld `renameEnum`/`deleteEnum`. Dette gjev eit klart, alt-etablert presedens for korleis type-rename/-delete bør oppføre seg.

6. **Table View sin "slots"-fane viser klasse-attributt, ikkje globale slots** (`TableView.tsx` `deriveRows()`, `rowType === 'slots'` itererer `cls.attributes` for kvar klasse — stadfesta ved lesing). Global slot-redigering har med andre ord **aldri hatt ei eiga Table View-fane** — berre `SchemaMetaPanel`. Relevant for kor mykje av "tilsvarande måte" som faktisk skal kopierast for types.

## Vurdering — kan det gjerast på tilsvarande måte som global slots?

**Ja, strukturelt rett fram, og enklare enn slots.** `TypeDefinition` har eit vesentleg mindre feltsett enn `SlotDefinition`, og heile precedenten (global slots-mønsteret i `SchemaMetaPanel`) er direkte overførbar utan nye arkitektoniske avgjerder — same stad i panelet er rett, sidan types (som slots) er schema-level, ikkje canvas-bundne.

### Naudsynte endringar

**A. Store-actions** (`projectSlice.ts`, same mønster som dei fire slot-actionane):
- `addSchemaType(schemaId, type: TypeDefinition)`
- `updateSchemaType(schemaId, typeName, partial: Partial<TypeDefinition>)`
- `deleteSchemaType(schemaId, typeName)` — IKKJE cascade range-referansar (jf. fakta-punkt 5), berre fjern frå `schema.types`.
- `renameSchemaType(schemaId, oldName, newName)` — cascade `typeof`-referansar i ANDRE typar i same skjema (analogt med `isA` for klassar, sidan `typeof` er types sin eigen "arve"-lenkje internt i `types:`-namnerommet); IKKJE cascade `range`-referansar på slots/attributt.

**B. UI — Properties Panel** (`SchemaMetaPanel.tsx`, ny "Schema Types"-seksjon rett etter "Schema Slots"):
- Ny `SchemaTypeInlineEditor.tsx`, modellert direkte på `SchemaSlotInlineEditor.tsx` (collapsible rad: namn+rename, description, `typeof`-dropdown, `base`, `repr`, `uri`, slett-knapp). Vesentleg enklare enn slot-editoren — ingen Tier1/Tier2-flagg, ingen `SubsetMembershipEditor` (`TypeDefinition` har ikkje `subsetOf`).
- "+ Add"-rad, same mønster som "new slot name…".

**C. Ny "type option groups"-hook** (analogt med `useSchemaSlotOptionGroups.ts`, brukt til `typeof`-dropdownen): bygg groups frå `schema.types` per skjema + dei same 8 hardkoda built-in LinkML-primitivtypane som alt finst i `useRangeOptionGroups`. Kan med fordel DELAST med ei samstundes fiksing av fakta-punkt 4 (legg `schema.types`-namn til `useRangeOptionGroups` sine groups, slik at slot/attributt Range-dropdown òg viser eigendefinerte typar) — same underliggjande datainnhenting, to bruksstader. Tilrådd å ta med sidan det er billeg og fjernar eit reelt, alt-dokumentert oppdagbarheitshol — men eit sjølvstendig val, sjå opne spørsmål.

**D. Table View — gjer `buildTypeColumns()` redigerbar** (`TableView.tsx`): når `updateSchemaType` finst, byt dei tre no-read-only kolonnane (`base`/`uri`/`description`) til `TextCell`+`onCommit`, same mønster `buildEnumColumns(updateEnum)` alt brukar. `name`-kolonnen treng ein rename-handterar, same dobbeltbruk som `buildClassColumns(updateClass, renameClass)`.

**E. Outline View — vurder klikkbare type-rader** (`OutlineView.tsx`): per det siterte runde 3-notatet vart type-rader medvite haldne utanfor `navigableIds` sidan det ikkje fanst noko å navigere TIL. No som `SchemaMetaPanel` ville ha ein "Schema Types"-seksjon, kunne ein type-rad bli klikkbar og scrolle/ekspandere tilsvarande rad i panelet — men dette er ei sjølvstendig UX-avgjerd (kor mykje "spring til"-navigasjon Outline View skal ha for schema-level element utan canvas-nodar), ikkje strengt naudsynt for at redigering skal FUNGERE (`SchemaMetaPanel` er alt tilgjengeleg uavhengig av kva som er valt på canvas).

### Ikkje naudsynt / utanfor omfang

- Ingen ny canvas-visualisering for types — alt medvite avgjort (C2b, `cross-repo-import-resolution-gaps.md` runde 3: "ikkje vis typar på canvas i det heile").
- Ingen endring i modell/parsing/validering/import-oppløysing — alt på plass (fakta-punkt 2).
- Ingen cross-schema rename-cascade for types — same, allereie aksepterte avgrensing som for klassar/enums/slots i dag (ein rename i eitt skjema oppdaterer ikkje referansar i ANDRE skjema som importerer det).

## Opne spørsmål

1. Skal "type option groups"-fiksen (C) inkludere ei samstundes fiksing av `useRangeOptionGroups` (fakta-punkt 4), slik at slot/attributt Range-dropdown òg viser eigendefinerte typar — eller skal det haldast strengt til `typeof`-dropdownen for å halde omfanget minimalt?
2. Skal Outline View sine type-rader gjerast klikkbare/navigerbare til `SchemaMetaPanel` (E), eller er "Schema Types"-seksjonen i panelet i seg sjølv nok?
3. Skal Table View sin "types"-fane gjerast redigerbar (D) i same runde som `SchemaMetaPanel`-seksjonen (B) — eller er éin redigeringsflate (Properties Panel) nok som fyrste steg, sidan global slot-redigering sjølv aldri har hatt ei tilsvarande Table View-fane (fakta-punkt 6)?
4. Skal `repr`-feltet (Python repr-override) takast med i UI-et i det heile? Det er eit svært spesialisert, sjeldan-brukt LinkML-felt (Python-kodegenerering-detalj) — kan vurderast utelate frå fyrste versjon av editoren (framleis round-trip-bevart via `extras` viss det finst frå før, jf. korleis andre avanserte felt alt handterast andre stader i modellen) for å halde UI-et enklare, i tråd med "Tier 1/Tier 2"-tankegangen slot-editoren alt brukar for å prioritere dei mest brukte felta først.

## Svar frå brukaren

"åpne spørsmål 1 inkluder fiksing av useRangeOptionGroups. 2 gjer type-rader klikkbare. 3 ikkje gjer Table View sin types fane redigerbar. 4. ikkje ta med repr-feltet i UI-et"

## Implementering (2026-09-16)

**A — Store-actions** (`projectSlice.ts`): `addSchemaType`, `updateSchemaType`, `deleteSchemaType`, `renameSchemaType` lagt til, same mønster som dei tilsvarande slot-actionane via `patchSchema`. `renameSchemaType` cascadar `typeof`-referansar på andre typar i same skjema (analogt med `isA` for klassar); `range`-referansar på slots/attributt vert IKKJE cascada, i tråd med det stadfesta presedenset frå `renameClass`/`renameEnum` (fakta-punkt 5).

**B — UI** (`SchemaMetaPanel.tsx` + ny `SchemaTypeInlineEditor.tsx`): ny "Schema Types"-seksjon rett etter "Schema Slots", same collapsible-rad-mønster som slot-editoren. Felt: Name (rename on commit), Description, `typeof` (dropdown), `base`, `uri`, slett-knapp. `repr` medvite UTELATE frå UI-et (ope spørsmål 4), men framleis round-trip-bevart av `io/yaml.ts` sin eksisterande `parseType`/`serializeType` for typar som alt har feltet frå før (t.d. importert frå YAML skrive utanfor editoren).

**C — Type option groups + `useRangeOptionGroups`-fiks** (ope spørsmål 1, godkjent): ny `useTypeOptionGroups.ts`-hook (built-in-typar + `schema.types` per skjema, ekskluderer typen sin eigen namn) brukt til `typeof`-dropdownen. `useRangeOptionGroups.ts` utvida til òg å inkludere `schema.types`-namn i kvart skjema si gruppe, slik at slot/attributt sin Range-dropdown no viser eigendefinerte typar (tidlegare berre synleg via fritekst).

**E — Outline View klikkbare type-rader** (ope spørsmål 2, godkjent): nytt `scrollToSchemaTypeName`-felt i `editorSlice.ts` (+ `setScrollToSchemaTypeName`-action). Klikk på ein type-rad i Outline View kallar `clearActiveEntity()` + `setPropertiesPanelOpen(true)` + `setScrollToSchemaTypeName(name)`; `SchemaMetaPanel` sender dette som `scrollTarget`-prop til den matchande `SchemaTypeInlineEditor`, som ekspanderer seg sjølv og scroller inn i synsfeltet via ein `useEffect` (same eittgongs-synk-mønster som Outline View sin eigen auto-focus-on-mount-effekt, difor same `eslint-disable react-hooks/set-state-in-effect`-presedens brukt).

**D — Table View sin "types"-fane** — IKKJE gjort, per ope spørsmål 3 sitt eksplisitte "ikkje"-svar. Framleis read-only, uendra frå før denne saka.

### Verifisert

- `pnpm --filter @linkml-editor/core exec tsc -p tsconfig.json --noEmit`: ingen feil.
- `pnpm --filter @linkml-editor/web exec tsc -p tsconfig.json --noEmit` (etter mellombels `core`-bygg, `dist/`+`tsconfig.tsbuildinfo` fjerna etterpå): ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: 0 feil frå desse endringane (éin pre-eksisterande, urelatert feil i `SchemaCanvas.tsx` — ikkje rørt av denne saka).
- `scripts/check-token-usage.sh`: PASS.
- Nye einingstestar i `projectSlice-extra.test.ts` (`ProjectSlice — schema-level type mutations`, 7 nye testar: add/update/update-noop/delete/rename-med-typeof-cascade/rename-target-finst/rename-kjelde-manglar) — `vitest run --environment node`: 49/49 grøne (heile fila, inkl. eksisterande testar).
- **Live nettlesarverifisering** (per CLAUDE.md sitt krav for UI-endringar — `pnpm dev` + Playwright `chromium.launch()`, driver-script mellombels i `packages/web/` per scratchpad-ESM-fallgruva, sletta etterpå): stadfesta empirisk, med skjermbilete, at (1) "Schema Types"-seksjonen viser seg rett etter "Schema Slots"; (2) å leggje til ein type og fylle ut `base`/`uri` serialiserer korrekt til YAML (`types: Tekst50: {uri: xsd:string, base: str}`); (3) `typeof`-dropdownen viser "BUILT-IN TYPES" + skjemaet sine eigne typar, ekskluderer typen sitt eige namn; (4) å velje ein `typeof`-verdi og deretter rename kjeldetypen cascadar korrekt til den andre typen sin `typeof` (`EmailAdresse: {typeof: Tekst50}` etter rename av `Epostadresse`→`EmailAdresse` OG av `Tekst50` sjølv verifisert via eigen unit-test); (5) ein global slot sin Range-dropdown viser no det eigendefinerte `Tekst50` under skjemaet si gruppe (stadfesta at `useRangeOptionGroups`-fiksen fungerer); (6) å klikke ein type-rad i Outline View mens ein annan entitet (ein klasse) var aktiv i Properties Panel, byter panelet korrekt attende til SchemaMetaPanel OG ekspanderer/scroller til nøyaktig den klikka typen. Ingen konsoll-/side-feil (`pageerror`) logga gjennom nokon av desse flytane.
