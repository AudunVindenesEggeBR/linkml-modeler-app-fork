# Spec: `estimateClassNodeSize` tel ikkje skjema-nivå `slots:` — klassar med mange eigenskapar via `slots:` vert teikna over av andre klassar

Status: **Implementert og verifisert (runde 2).** Sjå "Runde 2" nedst.
Dato: 2026-09-14

Ønske/observasjon (ordrett, to meldingar): "det fungerer etter rebygg og deploy. Eg ser at FrivilligOrganisasjon klassen som har mange egenskaper får andre klasser tegna over seg. Det kan virke som vi ikkje estimerer y-lengda til ei klasse riktig når det er mange egenskaper", oppfølgt av "Det er mest plagsomt når vi har normal spacing og compact spacing".

## Same rotårsak-mønster som forrige fiks, no i ein annan funksjon

`estimateClassNodeSize` (`autoLayout.ts:50-54`) har **nøyaktig same blindsone** som `runAutoLayout` sin range-kant-løkke hadde før `specs/done/autolayout-missing-schema-level-slot-range-edges.md` vart fiksa — han tel berre `classDef.attributes`, aldri `classDef.slots` (skjema-nivå slot-referansar):

```ts
export function estimateClassNodeSize(classDef: ClassDefinition): { width: number; height: number } {
  const attrCount = Object.keys(classDef.attributes).length;
  const height = HEADER_H + (classDef.isA ? ISA_ROW_H : 0) + BODY_PADDING + attrCount * ROW_H;
  return { width: CLASS_W, height: Math.max(height, CLASS_H) };
}
```

Men `ClassNode.tsx` (den faktiske rendringa) teiknar `resolvedSlots` (`ClassNode.tsx:124-126`), som — bygd av `deriveGraph.ts` — kombinerer BÅDE `attributes` OG `classDef.slots` (pluss nedarva slots via `is_a`/`mixins`, sjå `deriveGraph.ts:157-184`), avgrensa til `SLOT_LIMIT_EXPANDED = 20` synlege rader (`ClassNode.tsx:29`) før ein "+N more"-rad tek over.

## Stadfesta empirisk mot det faktiske skjemaet

`FrivilligOrganisasjon` i `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` (mellombels debug-testskript, køyrt éin gong, sletta etterpå):

```
classDef.attributes keys: []          <- tom, alt er deklarert via slots:
classDef.slots: [13 namn]             <- id, icnpokategorier, vedtekter, ...
classDef.isA: undefined               <- ingen arv involvert her
estimateClassNodeSize result: { width: 320, height: 120 }   <- golvverdien CLASS_H
actual rendered row count: 13
```

`estimateClassNodeSize` gir ELK høgda **120px** (golvverdien, sidan `attrCount = 0`), men den faktisk rendra korta treng om lag `HEADER_H(34) + BODY_PADDING(8) + 13×ROW_H(23) ≈ 341px` — knapt ein tredjedel av det verkelege behovet. ELK legg difor neste node/lag basert på ei boks som er MASSIVT for liten, og den verkelege, mykje høgare rendra korta stikk djupt ned i det som skulle vore ledig rom — nøyaktig same feilmønster som `specs/done/canvas-layout-topdown.md` sin Runde 1 (opphavleg fann og fiksa dette FOR `attributes`-baserte klassar; no dukkar det opp igjen for `slots:`-baserte klassar, av same årsak som edge-kant-buggen: koden handterer berre den eine av LinkML sine to måtar å deklarere ein klasse sine eigenskapar på).

**Kvifor brukaren merkar det mest ved `normal`/`compact` spacing:** `layerSpacing` (avstanden ELK legg MELLOM lag) er det einaste som gir noko "tilfeldig slark" til å absorbere eit undervurdert kort før det faktisk overlappar neste lag sitt innhald. `spacious`/`extraSpacious` sine større avstandar (220px/320px, jf. `SPACING_PRESETS`) gøymer feilen delvis ved at det no er nok albogerom til at eit 341px-høgt kort framleis ikkje når heilt ned i neste lag sitt innhald — medan `normal` (140px) og særleg `compact` (80px) sine mindre avstandar er for små til å absorbere eit 220px-avvik, og feilen vert tydeleg synleg som overlapp.

## Forslag til fiks

Minimal, målretta utviding av `attrCount`-utrekninga til å telje BEGGE kjeldene av eigne (ikkje-nedarva) eigenskapar, akkurat som `resolvedSlots` sitt eige-slot-steg gjer:

```ts
export function estimateClassNodeSize(classDef: ClassDefinition): { width: number; height: number } {
  const attrCount = Object.keys(classDef.attributes).length + classDef.slots.length;
  const height = HEADER_H + (classDef.isA ? ISA_ROW_H : 0) + BODY_PADDING + attrCount * ROW_H;
  return { width: CLASS_W, height: Math.max(height, CLASS_H) };
}
```

Ingen signaturendring naudsynt — `classDef.slots` er alt ei liste med NAMN (`string[]`), så berre lengda trengst for eit tal-estimat; ingen oppslag i `allSchemaSlots`/`schema.slots` er naudsynt for sjølve TALET (i motsetnad til edge-kant-fiksen, som trong dei faktiske slot-DEFINISJONANE for å finne `range`).

**Kvifor dette er trygt:** reint tillegg til ein eksisterande sum, ingen andre kall-stader eller signaturar vert påverka. Klassar som alt brukar `attributes:` konsekvent (`classDef.slots` tomt) er heilt upåverka (`+ 0`).

## Kjent, medvite avgrensa omfang: nedarva (`is_a`/`mixins`) slots vert FRAMLEIS ikkje talde

`resolvedSlots` i `deriveGraph.ts` inkluderer OGSÅ slots nedarva frå `is_a`-forfedrar og `mixins` (`deriveGraph.ts:178-184`, via `gatherAncestorSlots`), som krev både `schema` og `allSchemaSlots` for å løyse opp heile arve-kjeda. `estimateClassNodeSize(classDef: ClassDefinition)` sin noverande signatur tek IKKJE imot desse — å telje nedarva slots riktig ville kravd ei større utviding (nytt signatur med `schema`/`allSchemaSlots`-parameter, pluss ein tilsvarande ancestor-oppslags-algoritme som `gatherAncestorSlots`, dupliserast eller delast).

Dette er **ikkje** rota til det rapporterte problemet (`FrivilligOrganisasjon` har ingen `is_a` i det heile — stadfesta over), så det er **ikkje** del av dette forslaget. Nemnt eksplisitt slik det ikkje vert gløymt eller feilaktig anteke løyst av denne runda, jf. same praksis som `specs/done/autolayout-missing-schema-level-slot-range-edges.md` sin eigen "Merk (eksisterande asymmetri)"-fotnote førre runde — som seinare synte seg å VERE eit reelt problem. Alle tre kallstadene til `estimateClassNodeSize` (`autoLayout.ts:203, 226, 444`) har faktisk `schema`/`entity.schema` tilgjengeleg i sitt eige scope, så ei framtidig utviding er teknisk mogleg utan store omvegar, men er ikkje føreslått implementert no.

## Testcase / akseptansekriterium

1. Klasse med 0 `attributes` og 13 `slots`-referansar (som `FrivilligOrganisasjon`), ingen `is_a`. **Forventa (i dag, feil):** `estimateClassNodeSize` returnerer golvhøgda 120. **Forventa (etter fiks):** høgda reflekterer 13 rader (`34 + 8 + 13×23 = 341`).
2. Klasse med BÅDE `attributes` OG `slots` (blanda deklarasjon). **Forventa:** begge tal-kjeldene summerast, høgda reflekterer summen.
3. Regresjonstest: klasse som berre brukar `attributes:` (fleirtalet av eksisterande testar i `autoLayout.test.ts`) skal vere heilt uendra (`classDef.slots.length === 0` for desse).
4. Regresjonstest: ingen overlapp-testar i `autoLayout.test.ts` (frå `canvas-layout-topdown.md` sin Runde 1/2) skal endre resultat.
5. Manuell stadfesting: opne `enhetsregisteret-frivilligorganisasjonapi-schema.yaml` i editoren etter fiksen, trykk Layout med `normal`/`compact` avstand. **Forventa:** `FrivilligOrganisasjon` (og andre `slots:`-baserte klassar med mange eigenskapar) får ikkje lenger andre klassar teikna over seg.

## Runde 2 (2026-09-14) — implementert

Brukaren skreiv "utfør specen" — eksplisitt godkjenning, jf. CLAUDE.md.

**Implementert, nøyaktig som skildra i "Forslag til fiks" over:**
- `autoLayout.ts`: `estimateClassNodeSize` sin `attrCount`-utrekning er no `Object.keys(classDef.attributes).length + classDef.slots.length`. Ingen signaturendring — funksjonstyper og alle tre kallstadene (`autoLayout.ts:203, 226, 444`) er uendra. Utvida doc-kommentaren på funksjonen til å forklare kvifor begge kjeldene tel, og eksplisitt nemne at nedarva slots framleis IKKJE vert talde (viser til den medvite avgrensa scope-seksjonen i denne spec-en).

**Empirisk stadfesta FØR og ETTER, mot det faktiske skjemaet** (mellombels debug-testskript, køyrt to gonger, sletta etterpå):
- Før fiksen (frå diagnose-runda): `estimateClassNodeSize(FrivilligOrganisasjon)` → `{ width: 320, height: 120 }` (golvverdien).
- Etter fiksen: `estimateClassNodeSize(FrivilligOrganisasjon)` → `{ width: 320, height: 341 }` — nøyaktig samsvar med handrekna forventing (`34 + 8 + 13×23 = 341`).
- Køyrde `runAutoLayout` mot HEILE det ekte skjemaet med kompakt-liknande avstand (`layerSpacing: 80, nodeNodeSpacing: 40`, tettare enn både `normal`- og `compact`-presetta sine faktiske verdiar) og sjekka bounding-box-overlapp for ALLE klassepar via `estimateClassNodeSize`. **Resultat: 0 overlapp**, sjølv ved denne strammare enn vanleg avstanden — stadfestar at fiksen løyser det rapporterte symptomet også under nettopp dei to spacing-presetta brukaren peika ut som mest plagsame.

**Testar lagt til** (`packages/core/src/canvas/__tests__/autoLayout.test.ts`, i den eksisterande `describe('estimateClassNodeSize')`-blokka, 4 nye testar):
- Høgd veks med `classDef.slots`-tal, ikkje berre attributt-tal (speglar den fyrste eksisterande testen i blokka, no for den andre kjelda).
- Ein klasse med 0 attributt og mange schema-nivå-slots hamnar IKKJE lenger fast på 120px-golvet — direkte regresjonstest for det rapporterte tilfellet.
- Blanda deklarasjon (både `attributes` OG `slots` på same klasse) summerer begge kjeldene.
- Reint `attributes:`-baserte klassar er upåverka (sanity-sjekk pluss ein direkte samanlikningstest).

**Verifisert:**
- `autoLayout.test.ts` åleine: 37/37 testar grøne (33 eksisterande + 4 nye).
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- ESLint på dei to endra filene: 0 feil, 0 åtvaringar.
- Full `packages/core`-testpakke via `pnpm --filter @linkml-editor/core test`: 285/287 testar grøne (2 todo, **null faktiske testfeil** — stadfesta via eksplisitt `grep -c "FAIL "` på testutdata), 15 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]: Timeout waiting for worker to respond`-infrastrukturflaksen (CLAUDE.md) — ingen reelle regresjonar.

**Ikkje verifisert manuelt i nettlesar** (akseptansekriterium 5) — sjølve UI-et bør stadfestast ved neste rebuild/redeploy (hugs `podman-compose down` FØR `up --build -d`, jf. `specs/done/podman-compose-stale-container-on-rebuild.md`), sjølv om det automatiserte bounding-box-overlappsjekket over mot heile det ekte skjemaet gir sterk grunn til å vente at UI-et no er korrekt.
