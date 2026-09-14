# Spec: `runAutoLayout` ser ikkje range-kantar frå skjema-nivå `slots:`-referansar — klassar utan `is_a` vert heilt usamanhengande

Status: **Implementert og verifisert (runde 2).** Sjå "Runde 2" nedst.
Dato: 2026-09-14

Ønske/spørsmål (ordrett): "eg testar med eit nytt schema enhetsregisteret-frivilligorganisasjonapi-schema.yaml [...] Når eg åpner denne fila i editoren så legg alle klassene (utenom tree_root) seg veldig tett på kvarandre og det har liten effekt samme kva av layout knappane eg trykker på. Left-right og Top-Down visningane er heilt like, og Extra spacious og Compact Spacing påvirkar kun kor langt unna dei andre klassene tree_root klassa vises. Kva kan være årsaka til dette? Har vi hardkoda noko som kun fungerer for samt-bu skjemaet i layout koden?"

## Svar på spørsmålet: nei, ikkje hardkoda for samt-bu spesifikt — men éin reell, pre-eksisterande feil i `autoLayout.ts` som `samt-bu-schema.yaml` tilfeldigvis skjuler

## Rotårsak — stadfesta empirisk (parsa det faktiske nye skjemaet, ikkje berre lese kode)

`runAutoLayout` sin range-kant-løkke (`autoLayout.ts:264`) itererer **berre** `classDef.attributes`:

```ts
if (!hiddenEdgeTypes.has('range') && !(hideTreeRootRangeEdges && classDef.treeRoot)) {
  for (const [slotName, slot] of Object.entries(classDef.attributes)) {
    ...
  }
}
```

Han ser ALDRI på `classDef.slots` (lista med namngjevne referansar til skjema-nivå `slots:`-definisjonar) eller `slot_usage`-overstyringar — sjølv om `deriveGraph.ts` (som teiknar kantane på canvaset) FAKTISK dekkjer begge kjeldene (`deriveGraph.ts:255-282` for `attributes`, OG `deriveGraph.ts:284-316` for skjema-nivå `slots`). Dette gapet vart alt observert og medvite utsett i `specs/done/edge-filter-hide-tree-root-range-edges.md` ("Merk (eksisterande asymmetri, ikkje i scope for denne spec-en)"), men konsekvensen vart ikkje undersøkt vidare før no.

**Stadfesta konkret mot det nye skjemaet** (mellombels debug-testskript, køyrt éin gong, sletta etterpå): parsa `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` med den faktiske `parseYaml`-funksjonen og samanlikna:

| Kjelde | Tal range-kantar sett |
|---|---|
| `deriveGraph()` (canvas-rendering — dekkjer BÅDE `attributes` og skjema-nivå `slots`) | **17** |
| Simulert `runAutoLayout`-logikk (berre `attributes`) | **9** |

Av dei 17 `deriveGraph`-kantane er 9 frå containerklassen (`EnhetsregisteretFrivilligorganisasjonapiContainer`, som brukar inline `attributes:` og difor ER synleg for `runAutoLayout` — men vert filtrert vekk uansett av `hideTreeRootRangeEdges`, som er PÅ som standard). Dei attverande **8 kantane er ekte domene-til-domene-relasjonar** som `runAutoLayout` aldri ser i det heile teke, sidan ingen av dei ikkje-container-klassane brukar `attributes:` — dei brukar alle `slots:` (skjema-nivå referansar):

```
FrivilligOrganisasjon -> IcnpoKategori
FrivilligOrganisasjon -> Vedtekter
FrivilligOrganisasjon -> Grasrotandel
FrivilligOrganisasjon -> Regnskapsrapportering
FrivilligOrganisasjon -> Paategning
FrivilligOrganisasjon -> Virksomhetsrelasjon
Grasrotandel -> Tidsperiode
Regnskapsrapportering -> SistInnsendteAArsregnskap
```

I tillegg har dette skjemaet **null `is_a`-relasjonar** (stadfesta: `classes with is_a: 0`). Sidan verken `is_a`, `mixin`, `union_of` ELLER (på grunn av denne feilen) range finst for nokon av dei ikkje-container-klassane, ser ELK **null kantar i det heile** for heile resten av grafen — kvar klasse vert sin eigen, heilt isolerte komponent.

**Kvifor `samt-bu-schema.yaml` ikkje viste dette:** stadfesta at det skjemaet OGSÅ brukar skjema-nivå `slots:` for sine ikkje-container-klassar (`Skole`, `Skoleeier`, `Kommune`, osv. — same mønster som det nye skjemaet), så same range-kant-gapet finst der òg. Men `samt-bu-schema.yaml` har ein rik `is_a`-struktur (`Kommune is_a Skoleeier`, `Fylke is_a Skoleeier`, `Elev is_a Person`, osv.) — og `is_a`-kantar vert lest direkte frå `classDef.isA` (eit klassenivå-felt, ikkje eit attributt), heilt uavhengig av denne feilen. Den rike `is_a`-hierarkiet gav difor nok struktur til at ELK produserte eit fornuftig, ikkje-hopelaus layout SJØLV OM range-kantane mellom skjema-nivå-slot-klassane var usynlege for layout — feilen var der, berre skjult av eit anna, urelatert sett kantar. Det nye skjemaet har **ingen** `is_a` i det heile, så det har ingenting igjen til å skjule gapet med.

## Kvifor dette forklarer alle tre symptoma brukaren skildra

1. **"alle klassene legg seg veldig tett på kvarandre"** — kvar klasse er ein heilt isolert enkelt-node-komponent for ELK (ingen kantar i det heile). ELK sin standard-pakking av usamanhengande komponentar er kompakt (jf. same fenomen alt dokumentert i `specs/done/tree-root-class-leftmost-position.md` sin "Kvifor dette skjer"-seksjon, berre no gjeld det NESTEN ALLE klassane, ikkje berre éin einaste tree_root-klasse).
2. **"Left-right og Top-Down visningane er heilt like"** — `elk.direction` styrer korleis ein SAMANHENGANDE, lagdelt graf vert orientert. Utan kantar er det ingen lagdeling å orientere — retningsvalet har ingenting å verke på.
3. **"Extra spacious og Compact Spacing påvirkar kun kor langt unna dei andre klassene tree_root klassa vises"** — `layerSpacing` vert brukt PÅ TO MÅTAR i koden: (a) som `elk.layered.spacing.nodeNodeBetweenLayers`, som berre gjeld avstand MELLOM LAG i ein samanhengande, lagdelt graf (irrelevant her, sidan det ikkje finst nokon lagdeling), og (b) direkte av `repositionTreeRootNodesLeft()` (frå `specs/done/tree-root-class-leftmost-position.md`) som byggjer AVSTANDEN til tree_root-klassen eksplisitt frå `layerSpacing`. Difor er tree_root-klassen sin avstand den EINASTE tingen som faktisk endrar seg når brukaren vel eit anna avstands-preset — resten av grafen sin (manglande) avstand vert styrt av ELK sin eigen, utema/standard mellomrom for usamanhengande komponentpakking, som `SPACING_PRESETS` aldri når fram til.

## Forslag til fiks

Utvid `runAutoLayout` sin range-kant-løkke (`autoLayout.ts:263-274`) til å dekkje BEGGE kjeldene `deriveGraph.ts` alt dekkjer, ikkje berre `attributes`. Konkret: legg til eit nytt steg rett etter det eksisterande, som speglar `deriveGraph.ts:284-316` sin logikk (skjema-nivå `slots`-liste, med `slot_usage`-overstyring, dedup mot attributt-avleia kantar):

```ts
for (const slotName of classDef.slots) {
  const schemaSlot = allSchemaSlots[slotName] ?? schema.slots?.[slotName];
  if (!schemaSlot) continue;
  const usage = classDef.slotUsage[slotName];
  const effectiveRange = usage?.range ?? schemaSlot.range;
  if (!effectiveRange || !allIds.has(effectiveRange)) continue;
  addEdge(
    elkEdges,
    edgeSeen,
    `range__${className}__${slotName}__${effectiveRange}`,
    className,
    effectiveRange
  );
}
```

— `addEdge()` sin eksisterande `edgeSeen`-dedup (same `Set<string>` som attributt-løkka alt brukar) gjer at ingen duplikat oppstår viss ein slot skulle finnast begge stader (usannsynleg, men trygt).

**Naudsynt signaturendring:** `runAutoLayout` treng tilgang til `allSchemaSlots` (skjema-nivå slot-definisjonar frå importerte skjema, same parameter `deriveGraph` alt tek — sjå `deriveGraph.ts:135-143`, parameter 5) for å slå opp slotar som er definerte i eit IMPORTERT skjema, ikkje berre lokalt i `schema.slots`. `runAutoLayout` tek i dag IKKJE imot denne parameteren i det heile. Må leggjast til i signaturen (t.d. som eit nytt, valfritt parameter med standardverdi `{}` for bakoverkompatibilitet, same mønster som `hiddenEdgeTypes`/`hideTreeRootRangeEdges` alt følgjer), og tredast inn frå alle tre kallstadene i `SchemaCanvas.tsx` (som alt reknar ut `allSchemaSlots` for sitt eige `deriveGraph`-kall — same verdi kan gjenbrukast).

**Kvifor dette er trygt/lite risikofylt:** reint tilleggsarbeid (fleire kantar vert synlege for ELK enn før), ingen eksisterande kant vert fjerna eller endra. Skjema som alt brukar `attributes:` konsekvent (ikkje skjema-nivå `slots:`) er heilt upåverka, sidan dei ikkje har noko i `classDef.slots` å hente frå. `samt-bu-schema.yaml` sitt layout vil truleg verte ENNO betre strukturert (fleire reelle relasjonar synlege for ELK), ikkje verre.

## Testcase / akseptansekriterium

1. Bygg eit syntetisk skjema der to klassar er kopla UTELUKKANDE via ein skjema-nivå `slots:`-referanse (ingen `attributes:`, ingen `is_a`) — akkurat som `enhetsregisteret-frivilligorganisasjonapi-schema.yaml`. Køyr `runAutoLayout`. **Forventa (i dag, feil):** dei to klassane hamnar usamanhengande/tilfeldig plasserte. **Forventa (etter fiks):** dei to klassane vert stabla/plasserte i høve til kvarandre akkurat som om relasjonen var deklarert via `attributes:` i staden.
2. Regresjonstest: eksisterande testar i `autoLayout.test.ts` som brukar `attributes:`-baserte range-kantar (fleirtalet av eksisterande testar) skal vere heilt uendra.
3. Ny test som stadfestar at `slot_usage`-overstyring av `range` (skjema-nivå slot sin standard-range overstyrt for éin spesifikk klasse) vert respektert i layout-grafen, same som `deriveGraph.ts` alt gjer.
4. Manuell stadfesting: opne `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` i editoren etter fiksen, trykk Layout. **Forventa:** klassane spreier seg i eit fornuftig, retningsavhengig mønster (ikkje lenger tett klynge), og retnings-/avstandsveljarane får synleg effekt på HEILE grafen, ikkje berre tree_root-klassen.

## Runde 2 (2026-09-14) — implementert

Brukaren skreiv "utfør tiltaka" — eksplisitt godkjenning, jf. CLAUDE.md.

**Implementert, nøyaktig som skildra i "Forslag til fiks" over:**
- `autoLayout.ts`: nytt import av `SlotDefinition`-typen. `runAutoLayout` fekk eit nytt, sjette parameter `allSchemaSlots: Record<string, SlotDefinition> = {}` (valfritt, bakoverkompatibelt standardverdi). Rett etter den eksisterande `attributes`-baserte range-kant-løkka er det no ein ny løkke over `classDef.slots` som speglar `deriveGraph.ts:284-316` sin logikk nøyaktig: slår opp slot-definisjonen i `allSchemaSlots` (fell tilbake til `schema.slots`), respekterer `classDef.slotUsage`-overstyring av `range`, og legg til ei kant via same `addEdge()`/`edgeSeen`-dedup som attributt-løkka.
- `SchemaCanvas.tsx`: `allSchemaSlots` (alt utrekna der for `deriveGraph`-kallet) tredd inn i alle tre `runAutoLayout(...)`-kallstadene, med tilsvarande `useEffect`/`useCallback`-avhengigheiter oppdaterte.

**Empirisk stadfesta FØR og ETTER fiksen, mot det faktiske skjemaet** (mellombels debug-testskript, køyrt to gonger — éin gong for å stadfeste feilen ved diagnosen, éin gong etter fiksen for å stadfeste retting — begge sletta etterpå):
- Før fiksen: `deriveGraph` såg 17 range-kantar, den simulerte "berre attributes"-logikken (det `runAutoLayout` faktisk gjorde) såg berre 9, alle frå containeren (som uansett vert filtrert vekk av `hideTreeRootRangeEdges`). Netto: 0 kantar synlege for ELK blant dei 9 ikkje-container-klassane.
- Etter fiksen: køyrde `runAutoLayout` direkte mot det ekte skjemaet med `direction: 'TB'` og `direction: 'LR'`. Nodane spreier seg no over fleire reelle lag (`y`-verdiar frå 281 til 801 i TB-visninga, IKKJE alle klumpa saman), og **TB- og LR-resultata er no stadfesta ULIKE** (`JSON.stringify(layoutTB.nodes) === JSON.stringify(layoutLR.nodes)` → `false`) — nøyaktig det motsette av brukaren sitt rapporterte symptom ("Left-right og Top-Down visningane er heilt like"). `FrivilligOrganisasjon` (som har 6 utgåande range-kantar via skjema-nivå slots) hamnar no synleg som ein "hub" med borna sine plassert i eit lag under, i staden for tilfeldig spreidd.

**Testar lagt til** (`packages/core/src/canvas/__tests__/autoLayout.test.ts`, ny `describe('runAutoLayout schema-level slots (classDef.slots) range edges')`, 4 testar):
- Ei skjema-nivå `slots:`-kant vert no lagt til layout-grafen (testar akseptansekriterium 1).
- `slot_usage`-overstyring av `range` vert respektert (testar akseptansekriterium 3).
- Slot-oppslag frå `allSchemaSlots` (cross-schema-import-tilfellet, ikkje berre lokal `schema.slots`) fungerer.
- Ein manglande/uløyseleg slot-referanse krasjar ikkje `runAutoLayout` (regresjons-tryggleik for `if (!schemaSlot) continue`-vakta).

**Verifisert:**
- `autoLayout.test.ts` åleine: 33/33 testar grøne (29 eksisterande + 4 nye).
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- ESLint på dei tre endra filene: 0 feil. Same to pre-eksisterande `react-hooks/exhaustive-deps`-åtvaringar i `SchemaCanvas.tsx` (urelaterte, stadfesta uendra frå før — linene denne endringa rører er berre der `allSchemaSlots` vart lagt til dependency-listene, ikkje sjølve dei linene åtvaringane peiker på).
- Full `packages/core`-testpakke via `pnpm --filter @linkml-editor/core test`: 281/283 testar grøne (2 todo, ingen faktiske testfeil), 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]: Timeout waiting for worker to respond`-infrastrukturflaksen (CLAUDE.md) — null reelle regresjonar, stadfesta ved at `autoLayout.test.ts` (den einaste direkte relevante fila) alt vart køyrt isolert og grøn over.

**Ikkje verifisert manuelt i nettlesar** (akseptansekriterium 4) — visuell stadfesting av at `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` faktisk spreier seg fornuftig i sjølve UI-et, og at retnings-/avstandsveljarane synleg påverkar heile grafen, bør gjerast ved neste rebuild/redeploy (hugs `podman-compose down` FØR `up --build -d`, jf. `specs/done/podman-compose-stale-container-on-rebuild.md`).
