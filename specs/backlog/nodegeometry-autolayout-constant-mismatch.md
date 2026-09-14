# Spec: `nodeGeometry.ts` og `autoLayout.ts` har kvar sin, innbyrdes ulike versjon av "same" måla — handtak kan sitje feil plassert

Status: **Forslag (ikkje implementert).** Ventar på eksplisitt godkjenning (t.d. "utfør"/"implementer") før noko kode vert endra, jf. CLAUDE.md "Specification-driven development".
Dato: 2026-09-14

## Kontekst

Oppdaga som eit sidefunn medan `specs/done/layout-calculation-audit-2026-09-14.md` sitt Funn 1 (manglande delt konstant for `SLOT_LIMIT_EXPANDED`) vart implementert — då eg leita etter ein god stad å plassere den nye, delte konstanten, fann eg at `packages/core/src/canvas/nodeGeometry.ts` alt finst for NØYAKTIG dette føremålet ("Both the node renderer (handle placement) and the auto-layout engine (ELK port positions) import from here so the two never drift apart" — sitat frå fila sin eigen toppkommentar), men han er IKKJE brukt til dei måla `autoLayout.ts` sine `estimateClassNodeSize`/`estimateEnumNodeSize` treng — dei to filene har kvar sin, sjølvstendig definerte versjon av det som skal vere "same" mål, og verdiane har alt drive frå kvarandre.

## Funn

| Konstant | `nodeGeometry.ts` (brukt til handle-plassering, `classSlotMidY()`) | `autoLayout.ts` (brukt til høgdeestimat) |
|---|---|---|
| Header-høgd | `CLASS_HEADER_H = 32` | `HEADER_H = 34` |
| is_a-rad-høgd | `CLASS_ISA_H = 22` | `ISA_ROW_H = 24` |
| Body-padding | `CLASS_BODY_PAD_T = 4` | `BODY_PADDING = 8` |
| Rad-høgd | `CLASS_SLOT_H = 23` | `ROW_H = 23` (samsvarer — einaste av dei fire) |

`autoLayout.ts` sine verdiar (34/24/8/23) er dei EMPIRISK STADFESTA korrekte — jf. `specs/backlog/canvas-layout-topdown.md` sin Runde 1: "Juster dei fire konstantane (HEADER_H osv.) ved å faktisk måle eit par rendra kort i nettlesaren (DevTools → inspiser element → 'Computed' → height) før implementering". `nodeGeometry.ts` sine verdiar (32/22/4/23) ser ut til å vere dei OPPHAVLEGE, reint CSS-teoretisk utrekna verdiane FØR den empiriske korrigeringa — som aldri vart ført attende til `nodeGeometry.ts` når `autoLayout.ts` sine vart retta.

**Praktisk konsekvens:** `classSlotMidY()` (`nodeGeometry.ts:26-34`) bereknar kor høgt oppe på ein `ClassNode` sitt range-kant-handtak (den vesle tilkoplingsprikken for kvar eigenskapsrad) skal plasserast, basert på `CLASS_HEADER_H`/`CLASS_ISA_H`/`CLASS_BODY_PAD_T`/`CLASS_SLOT_H`. Sidan desse er 2px/2px/4px for låge samanlikna med dei faktiske, empirisk stadfesta CSS-verdiane, vil handtaket sannsynlegvis sitje **nokre pixel for høgt oppe** i høve til den faktiske rad-midten det skal peike frå — ein liten, kumulativ feil (body-padding-avviket åleine er 4px, pluss 2px frå header, pluss 2px per is_a-rad når til stades), som ikkje veks per slot-rad (`CLASS_SLOT_H`/`ROW_H` er einaste konstant som FAKTISK samsvarer, 23=23), men er konstant til stades for alle rader i eit kort med `is_a`, litt mindre for kort utan.

**Ikkje ein layout-OVERLAPP-risiko** (dette gjeld berre handtak-PLASSERING innanfor ein node, ikkje node-STORLEIKS-estimatet ELK brukar for å unngå at heile kort overlappar kvarandre — det er FULLSTENDIG upåverka av dette, sidan `estimateClassNodeSize`/`estimateEnumNodeSize` ikkje brukar `nodeGeometry.ts` i det heile). Konsekvensen er reint visuell/kosmetisk: kanten sitt tilkoplingspunkt kan sjå ut til å starte litt over/under midten av rada det tilhøyrer, særleg synleg for kort med mange rader eller ein `is_a`-rad.

## Forslag til fiks

Oppdater `nodeGeometry.ts` sine fire konstantar til å samsvare med `autoLayout.ts` sine empirisk stadfesta verdiar:

```ts
export const CLASS_HEADER_H = 34;  // var 32
export const CLASS_ISA_H = 24;     // var 22
export const CLASS_BODY_PAD_T = 8; // var 4
export const CLASS_SLOT_H = 23;    // uendra, alt korrekt
```

**Vurder samstundes** (valfritt, større omfang): sidan `nodeGeometry.ts` alt eksisterer nøyaktig for å vere DEN eine kjelda til sanning for desse måla, kunne `autoLayout.ts` sine eigne `HEADER_H`/`ISA_ROW_H`/`BODY_PADDING`/`ROW_H`-konstantar fjernast heilt og importerast frå `nodeGeometry.ts` i staden — dette ville gjort akkurat denne typen framtidig drift STRUKTURELT umogleg (same løysing som vart vald for `CLASS_SLOT_LIMIT`/`ENUM_VALUE_LIMIT` i `specs/done/layout-calculation-audit-2026-09-14.md`), i staden for berre å rette dagens verdiar og stole på at nokon hugsar å halde dei synkroniserte neste gong éin av dei vert justert. Dette er ei noko større endring (fjernar eksisterande, brukte konstantar frå `autoLayout.ts`, endrar importar) enn den minimale verdi-retting-varianten over, så det er verdt eit eksplisitt val heller enn å anta.

## Testcase / akseptansekriterium

1. Etter fiksen: `nodeGeometry.ts` og `autoLayout.ts` sine tal for header/isa-rad/body-padding er identiske (anten ved kopierte verdiar eller ved delt import).
2. Manuell stadfesting: opne eit skjema med minst éin klasse som har mange eigenskapar OG ein `is_a`-forelder, zoom inn på kortet, stadfest at range-kant-handtaka (dei små tilkoplingsprikkane på sida av kortet) sit visuelt på linje med midten av rada dei tilhøyrer, ikkje forskjøve oppover.
3. Ingen endring venta i `estimateClassNodeSize`/`estimateEnumNodeSize` sine returverdiar (dei brukar framleis sine eigne — no eventuelt delte — konstantar, uendra frå denne fiksen si perspektiv på sjølve talverdiane).

## Ope spørsmål til brukar

1. Berre rette verdiane i `nodeGeometry.ts` (minimal diff), eller òg konsolidere `autoLayout.ts` til å importere frå `nodeGeometry.ts` i staden for å halde eigne, framleis-potensielt-driftande konstantar (større, meir robust endring)?
