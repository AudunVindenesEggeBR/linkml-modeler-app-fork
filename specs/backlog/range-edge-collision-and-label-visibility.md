# Spec: Range-kantar som overlappar/ligg tett, og kant-labelar som forsvinn bak klassar — alternativ

Status: **Delvis implementert.** Alternativ A for Ønske 1 (eige handtak per innkomande range-kant) er implementert og verifisert — sjå "Runde 2" nedst. Ønske 2 (kant-labelar bak klassar) og resten av alternativa for Ønske 1 (B/C/D) står framleis som reine forslag, ikkje implementerte — spec-en held fram i `specs/backlog/` til dei er avgjorde.
Dato: 2026-09-14

Ønske (ordrett): "eg ønsker at range kantar ikkje skal stacke over kvarandre slik at vi unngår at fleire range kantar tegnes over kvarandre eller rett ved kvarandre (samme eller liten forskjell i x- eller y- koordinat). Det gjer visninga mindre leselig. Kan vi identifisere kantar som tegnes i nærheten av andre kantar i x- eller y- aksen og legge til padding eller distanse mellom dei? (Eller må dette løyses ved å faktisk flytte dei relaterte klassene fordi vi ikkje styrer korleis kantar plasseres, styrer vi kun klassene sin plassering?) I tillegg ønsker eg at beskrivelseslabel på kvar kant ikkje skal komme bak ei klasse men vises i sin helhet."

## Svar på hovudspørsmålet: vi styrer BÅDE klasseplassering OG korleis kantar teiknast — ikkje berre det eine

Dette er ei viktig presisering før alternativa under: range-kantar sin visuelle bane er **ikkje** ein direkte konsekvens av ELK sin layout-algoritme (i motsetnad til `is_a`/`mixin`/`union_of`-kantar, som FAKTISK brukar ELK sine kalkulerte "bend points"). Stadfesta i koden:

- `deriveGraph.ts` byggjer range-kantar UTAN å kalle `elkData(layout, edgeId)` (samanlikn `deriveGraph.ts:216/231/248` for `is_a`/`mixin`/`union_of`, som ALLE kallar `elkData(...)`, mot range-kant-blokkene på `deriveGraph.ts:253-282`/`284-316`, som ALDRI gjer det).
- `edges.tsx` sin `edgePath()`-funksjon (linje 96-134) brukar ReactFlow sin eigen `getSmoothStepPath()` for range-kantar når det ikkje finst ELK-punkt — som er alltid, sidan dei aldri vert sett for range-kantar. Banen vert difor kalkulert HEILT LOKALT frå kva to handtak (kjelde+mål-punkt) kanten koplar til, uavhengig av ELK sin kryss-minimerings-/rute-algoritme.

**Konklusjon: vi har tre uavhengige spakar, ikkje berre éin:**
1. **Klasseplassering** (ELK, alt eksponert via retning/avstand-veljarane).
2. **Kva HANDTAK ei kant koplar til** på kjelde- og mål-noden (`rangeHandles()`/`rangeEdgeSide()`, `deriveGraph.ts:50-73`).
3. **Sjølve bane-algoritmen** kanten teiknar mellom dei to handtaka (`edgePath()`, `edges.tsx:96-134`).

## Rotårsak — stadfesta konkret, ikkje berre teoretisk

### Alle innkomande range-kantar til éin klasse konvergerer på NØYAKTIG same punkt

```ts
// deriveGraph.ts:62-73
function rangeHandles(...) {
  const side = rangeEdgeSide(layout, sourceId, targetId);
  const sourceHandle = sourceCollapsed ? `side-${side}` : `slot-${side}-${slotName}`;
  const targetHandle = side === 'east' ? 'side-west' : 'side-east'; // <-- ALLTID eitt av berre to faste punkt
  return { sourceHandle, targetHandle };
}
```

Kjelde-sida har alt EIT HANDTAK PER EIGENSKAP (`slot-${side}-${slotName}`, definert i `ClassNode.tsx` sine per-slot `Handle`-element) — kantar som GÅR UT frå ei klasse er difor alt naturleg spreidde vertikalt, éin per rad, NÅR klassen ikkje er samanslegen. Men **mål-sida har berre TO faste punkt totalt** (`side-west`/`side-east`, jf. `ClassNode.tsx` sin kommentar: "Generic side handles [...] As target: used by range edges arriving at this node from the opposite side"). Viss fem ulike klassar alle har ein range-eigenskap som peiker på same målklasse, frå same generelle retning, landar difor **alle fem kantane på nøyaktig same pixel** ved målenden — garantert overlapp, ikkje berre "nær kvarandre". Same problem oppstår på KJELDE-sida når kjeldeklassen er samanslegen (`collapsed`), sidan han då òg fell tilbake til det same faste `side-${side}`-handtaket for ALLE sine utgåande kantar.

### Eksisterande "fan out"-mekanisme finst alt, men ekskluderer eksplisitt range-kantar

```ts
// deriveGraph.ts:514-517
// ── Parallel edge annotation ────────────────────────────────────────────────
// Group non-range edges that share the same source+target and fan them out.
// Range edges are excluded: each already leaves from a distinct slot handle,
// so perpendicular offset would misalign them from their anchor points.
```

Denne mekanismen (`parallelIndex`/`parallelCount`, brukt av `edges.tsx:96-116` sin vinkelrette forskyving, `PARALLEL_STEP = 8px`) handterer BERRE tilfellet der to kantar deler NØYAKTIG same kjelde+mål-NODE-par (ikkje same handtak-PUNKT) — og han ekskluderer range-kantar HEILT, av ein god grunn (ville flytta kanten vekk frå sitt korrekte per-slot-ankerpunkt på kjeldesida). Han løyser difor ikkje problemet over i det heile, og handterer heller ikkje det meir generelle tilfellet brukaren skildrar: to HEILT URELATERTE kantar (ulikt kjelde- OG mål-par) som tilfeldigvis ligg tett i x/y fordi klassane dei koplar er plasserte nær kvarandre.

## Alternativ for Ønske 1: unngå at range-kantar ligg tett/overlappar

### Alternativ A — Eige handtak per innkomande kant (fjernar den GARANTERTE overlappen heilt)

Gje kvar MÅL-klasse eitt handtak PER distinkt innkomande range-kant, spreidd vertikalt langs sida — same mønster som kjeldesida alt brukar for utgåande kantar. Krev:
- Ny data i `ClassNodeData` (t.d. `incomingRangeEdges: string[]`, kalkulert i `deriveGraph.ts` ved å telje alle range-kantar som peiker PÅ denne klassen, før nodane vert bygde).
- `ClassNode.tsx` renderer eitt `Handle`-element per innkomande kant (i staden for dagens to faste `side-east`/`side-west`), med stabil, deterministisk ID (t.d. `in-${sourceClassName}-${slotName}`) slik at handtak ikkje "hoppar" mellom urelaterte endringar.
- `rangeHandles()` oppdaterast til å velje det SPESIFIKKE handtaket i staden for det generiske side-namnet.
- Same løysing brukt symmetrisk for samanslegne kjelde-klassar (eitt handtak per utgåande kant, ikkje eitt felles).

**Vurdering:** mest direkte og fullstendige fiks for den GARANTERTE overlappen (nøyaktig same punkt) — adresserer rotårsaka, ikkje berre symptomet. Moderat kompleksitet (ny data-flyt, fleire handtak-element å halde stabile).

### Alternativ B — Utvid den eksisterande "fan out"-mekanismen til òg å gjelde range-kantar, gruppert på MÅL-handtak (ikkje kjelde+mål-node-par)

I staden for å ekskludere range-kantar heilt frå `parallelGroups`-logikken (`deriveGraph.ts:514-532`), grupper dei på `targetHandle` (t.d. `${targetId}||${targetHandle}`) i staden for `${source}||${target}`, og bruk ein forskyving som TAPRAR MOT NULL nær kjelde-enden (der det per-slot-korrekte ankerpunktet framleis må respekterast) og er størst nær mål-enden (der alle uansett konvergerer på same punkt i dag).

**Vurdering:** mindre invasiv enn Alternativ A (ingen nye handtak-element), men krev ein meir komplisert, IKKJE-uniform forskyvingsalgoritme (uniform vinkelrett forskyving — det `PARALLEL_STEP`-mekanismen alt gjer — ville flytta kjeldeenden vekk frå sitt korrekte ankerpunkt, akkurat grunnen han er ekskludert i dag). Løyser den GARANTERTE overlappen mindre fullstendig enn Alternativ A (kantane deler framleis eitt fysisk handtak-PUNKT, dei får berre ein annan BANE ut frå det punktet) — kan framleis sjå ut som dei "kjem frå same stad", berre ikkje heilt overlappande vidare.

### Alternativ C — Generell kollisjonsdeteksjon mellom ALLE kantpar (uavhengig av delt kjelde/mål)

Etter at banane er kalkulerte, samanlikn kvart par range-kantar sin avstand (t.d. minste avstand mellom linjesegmenta, eller samanlikn Y-posisjon der to kantar begge er tilnærma horisontale i overlappande X-intervall) og forskyv dei som er "for nære" adaptivt.

**Vurdering:** mest generell — einaste alternativet som direkte adresserer brukaren sin eksplisitte formulering ("identifisere kantar som tegnes i nærheten av andre kantar i x- eller y-aksen"), og fangar tilfelle Alternativ A/B ikkje gjer (heilt urelaterte kjelde/mål-par som tilfeldigvis ligg tett). Men klart høgast kompleksitet: O(n²) paarvis samanlikning (kan verte merkbart for store skjema med mange range-kantar, t.d. `enhetsregisteret`-skjemaet sine 17), vanskelegare å forklare/forytsjå for brukaren ("kvifor flytta akkurat DENNE kanten seg no?"), og risiko for visuell "vibrering" når små layout-endringar forskyv mange par-avstandar samstundes (ei kant kan hoppe fram og tilbake mellom to nesten-like-gode posisjonar ved små endringar andre stader i skjemaet).

### Alternativ D — Flytt klassane lenger frå kvarandre (brukaren sitt eige alternative forslag)

Allereie delvis mogleg i dag via dei eksisterande avstand-presetta (`compact`/`normal`/`spacious`/`extraSpacious`, `autoLayout.ts:250-258`). Meir avstand mellom klassar gir meir "albogerom" mellom kantane sine banar, som reduserer generell visuell tettleik.

**Vurdering:** **løyser IKKJE den garanterte overlappen** frå rotårsaka over — to kantar som deler NØYAKTIG same handtak-punkt landar framleis på det same punktet, uansett kor mykje avstand det er mellom klassane elles (dei møtest jo nett DER, ved punktet). Nyttig som eit supplement (reduserer "nær, men ikkje heilt overlappande"-tilfelle), men utilstrekkeleg åleine for hovudsymptomet brukaren skildrar. Kunne evt. utvidast til at ELK vektar/gir ekstra vertikalt rom til klassar med MANGE innkomande range-kantar spesifikt (eit meir målretta layout-nivå-tiltak) — framleis indirekte, og løyser ikkje sjølve konvergenspunktet.

### Tilråding for Ønske 1

**Alternativ A** (eige handtak per innkomande/utgåande kant) er det einaste alternativet som fullstendig fjernar den GARANTERTE overlappen (nøyaktig same punkt), som er den mest alvorlege forma for problemet brukaren skildrar ("tegnes over kvarandre"). Alternativ C er det mest generelle for det mildare "rett ved kvarandre"-tilfellet, men monaleg dyrare/meir risikofylt å implementere godt — kan vurderast som eit SEINARE, sekundært steg etter Alternativ A er på plass, ikkje som fyrste steg.

## Alternativ for Ønske 2: kant-labelar skal ikkje forsvinne bak ein klasse

### Uavklart, bør stadfestast FØR val av fiks: er dette eit stablings-/z-index-problem, eller eit reint geometrisk plasseringsproblem?

`EdgeLabelRenderer` (ReactFlow) sitt overlegg-lag sin faktiske stablingsrekkjefølgje i høve til node-laget (`.react-flow__nodes`) er **ikkje stadfesta empirisk i denne økta** — ingen eksplisitt `z-index`-overstyring av desse laga finst i kodebasen (søkt gjennom, stadfesta ingen treff utanom urelaterte dropdown/modal/toast-verdiar). Dette bør sjekkast i nettlesar (DevTools → inspiser eit tilfelle der ein label faktisk forsvinn) FØR val av fiks, sidan svaret avgjer kor stort problemet reelt er:
- **Viss reint stablingsrekkjefølgje** (label-laget ligg UNDER node-laget i DOM-en): eit label ligg framleis på "rett" geometrisk stad, berre skjult av ein node over. Sidan kvar label alt har sin eigen ugjennomsiktige bakgrunn/border (`edges.tsx:220-252`, `background: var(--color-bg-surface)`), ville ei rein z-index-heving over nodelaget truleg løyst STORPARTEN av problemet åleine, billeg.
- **Viss geometrisk plassering** (labelen si utrekna midtpunkt-posisjon landar bokstaveleg oppå ein anna node sin boundingboks, uavhengig av lag-rekkjefølgje): ei rein z-index-fiks ville gjort labelen synleg, men FRAMLEIS visuelt "inni"/oppå ein urelatert klasse sitt kort — lesbart, men rotete, ikkje det brukaren truleg meiner med "vises i sin heilheit" i ei rein, ryddig forstand.

### Alternativ A — Berre z-index-heving av label-laget over node-laget

Enklaste moglege fiks, DERSOM diagnosen over stadfestar at det er eit reint stablingsproblem. Global CSS-overstyring (t.d. i `globals.css`/`tokens.css`) som sikrar `.react-flow__edgelabel-renderer` alltid renderer over `.react-flow__nodes`.

**Vurdering:** billegast, men adresserer berre halve moglege rotårsak (stabling, ikkje geometri). Bør verifiserast empirisk fyrst, ikkje implementerast blindt.

### Alternativ B — Kollisjonsmedviten label-plassering: oppdag når midtpunktet landar i ein annan node sin boundingboks, og flytt labelen

Bruk alt tilgjengeleg node-storleiksdata (`estimateClassNodeSize`/`estimateEnumNodeSize`, alt brukt fleire stader denne økta) til å sjekke om kanten sitt utrekna label-midtpunkt (`edges.tsx:74-88` sin `buildElkPath`, eller `getSmoothStepPath` sitt tilsvarande midtpunkt) landar innanfor ein ANNAN (urelatert) node sin boundingboks. Viss ja, flytt labelen — enklaste variant: prøv nokre alternative punkt langs same bane (t.d. 25%/75% i staden for 50% lengd) til eit fritt punkt vert funne; meir avansert: skyv vinkelrett frå banen til labelen klarer boundingboksen.

**Vurdering:** løyser BÅDE stablings- og geometri-varianten av problemet direkte, uavhengig av kva den faktiske rotårsaka viser seg å vere. Moderat kompleksitet — treng tilgang til alle andre nodar sine posisjonar+storleikar på render-tidspunktet til kvar kant (ikkje urimeleg, sidan denne dataen alt vert kalkulert éin gong per layout og kan sendast ned som edge-data eller lesast frå ein delt selector).

### Alternativ C — Rut sjølve kant-banen forbi (ikkje gjennom) urelaterte nodar (obstacle avoidance)

Mest grundig: viss sjølve BANEN aldri passerer nær/gjennom ein urelatert node, vil eit midtpunkt-plassert label naturleg unngå han òg — ingen eigen label-spesifikk logikk naudsynt i det heile. Ville i praksis bety at range-kantar MÅ ta i bruk ein rute-algoritme med hinder-medvit (t.d. via ELK sjølv, som alt gjer dette for `is_a`/`mixin`/`union_of`-kantar) — men dette går rett imot den eksisterande, medvitne avgjerda om at range-kantar bør bruke handtak-baserte lokale banar i staden for ELK sine node-sentrerte "bend points" (`deriveGraph.ts` sin kommentar: "Range edges use smooth-step routing from slot handles; ELK bend points [...] would produce incorrect paths here").

**Vurdering:** løyser problemet på det mest fundamentale nivået, men er eit MYKJE større, sjølvstendig prosjekt (treng ein heilt ny rute-algoritme som respekterer BÅDE per-slot-ankerpunkt OG hinder-unngåing samstundes — desse to måla er ikkje trivielt sams). **Ikkje tilrådd som fyrste steg.**

### Tilråding for Ønske 2

1. **Stadfest z-index/stablingsrekkjefølgje empirisk i nettlesar FØRST** (billeg å sjekke, avgjer kor mykje av problemet ei enkel fiks løyser).
2. Implementer **Alternativ B** (kollisjonsmedviten plassering) som hovudfiks uansett — han dekkjer begge moglege rotårsaker og er den einaste som garanterer "vises i sin heilheit" slik brukaren ber om, ikkje berre "synleg, men rotete".
3. **Alternativ C** (full hinder-unngåande ruting) er eit mykje større, sjølvstendig initiativ — ikkje tilrådd no.

## Ope spørsmål til brukar

1. **Ønske 1 — kva ambisjonsnivå?** Alternativ A (eige handtak per kant) fjernar den GARANTERTE overlappen fullstendig, men ikkje det mildare "ligg nære kvarandre, kryssar tilfeldig"-tilfellet mellom heilt urelaterte kjelde/mål-par. Er A åleine godt nok som fyrste steg, eller ønskjer du at C (generell kollisjonsdeteksjon) skal inn i same runde?
2. **Ønske 2 — skal z-index-diagnosen gjerast FØR eit val av fiks**, eller skal me berre implementere Alternativ B direkte (han løyser problemet uansett kva rotårsaka er, berre med litt meir arbeid enn strengt naudsynt viss det viser seg å vere reint stabling)?
3. Er det akseptabelt at Alternativ A (nye per-kant-handtak) kan endre EKSISTERANDE, lagra kant-tilkoplingspunkt for brukarar med alt-lagra layout (sidan handtak-ID-ane endrar namn frå `side-east`/`side-west` til noko per-kant-spesifikt)? Dette bør i så fall handterast bakoverkompatibelt (fall tilbake til gammal åtferd for lagra data utan dei nye ID-ane).

## Runde 2 (2026-09-14) — Alternativ A for Ønske 1 implementert

Brukaren skreiv "utfør alternativ A for ønske 1" — eksplisitt godkjenning for nøyaktig dette eine alternativet, jf. CLAUDE.md. Ønske 2 og alternativa B/C/D for Ønske 1 er UENDRA, framleis reine forslag.

**Svar på ope spørsmål 3 (viste seg unødvendig å svare på):** `CanvasLayout` lagrar berre NODE-posisjonar (`Record<string, {x,y}>`), aldri per-kant-handtak-tilknytingar — `deriveGraph()` er ein rein funksjon som reknar ut handtak-ID-ar på nytt kvar gong han køyrer, ikkje noko som vert persistert. Det finst difor **ingen bakoverkompatibilitets-/migrasjonsbekymring i det heile** — handtak-namn kan endrast fritt utan å påverke noka lagra brukar-tilstand.

### Implementert, nøyaktig som skildra i "Alternativ A" over

- **`nodeGeometry.ts`** (den alt-eksisterande, delte geometri-fila): ny eksportert `IncomingRangeHandle`-type (`{id, side, source, slotName}`) og `incomingHandleTopPercent(index, count)` — jamt fordelte prosent-posisjonar (10%-90%-spennet) langs ei side, uavhengig av faktisk rendra høgd.
- **`deriveGraph.ts`**:
  - Ny `rangeTargetEntrySide()` — same eittvegs-logikk som før (motsett side av kjelda sin utgangsside), no delt mellom `rangeHandles()` og den nye pre-pass-funksjonen.
  - Ny `incomingRangeHandleId(side, sourceId, slotName)` — deterministisk ID-formel (`in-${side}-${sourceId}-${slotName}`), brukt av BÅDE `rangeHandles()` (kva ei kant refererer til) og pre-pass-funksjonen (kva ein målnode faktisk renderer), slik at dei alltid samsvarer utan at nokon av dei treng den andre sin data.
  - `rangeHandles()` sin `targetHandle` bytt frå det gamle, faste `side-west`/`side-east` til den nye per-kant-ID-en. `sourceHandle` (kollapsa-kjelde-tilfellet) heilt uendra.
  - Ny `collectIncomingRangeHandles()` — pre-pass som listar opp KVAR (kjelde, slotName) → mål-relasjon skjemaet faktisk vil teikne som ei kant, med nøyaktig same portar/filter (`hiddenEdgeTypes`, `rangeEdgesMode`, `hideTreeRootRangeEdges`, `slot_usage`-overstyring, sjølvreferanse-ekskludering) som dei eksisterande kant-byggjande løkkene alt brukar — kommentert eksplisitt at han MÅ haldast i synk med dei.
  - Køyrer FØR nokon nodar vert bygde (treng å vite om ALLE mål-relasjonar før noko enkelt-node sin data vert laga), grupperer resultatet per mål-ID, sorterer deterministisk (kjelde-namn, så slot-namn) slik at handtak ikkje "hoppar" ved urelaterte endringar.
  - Alle fire stadene der node-data vert bygd (lokale klassar, lokale enums, importerte/spøkelse-klassar, importerte/spøkelse-enums) får no eit nytt `incomingRangeHandles`-felt frå denne pre-pass-en.
- **`ClassNode.tsx`**: ny `incomingRangeHandles?: IncomingRangeHandle[]`-felt på `ClassNodeData`. Dei gamle `side-east`/`side-west`-handtaka er BEHALDNE (framleis naudsynte for kollapsa-kjelde-tilfellet — utanfor scope for denne runda, sjå "Vurdert, ikkje implementert" under), men er no BERRE `type="source"` i praksis (ingen kant refererer dei lenger som mål). Nye `type="target"`-handtak vert rendra éin per innkomande kant, delt i aust/vest-grupper, jamt fordelt via `incomingHandleTopPercent`.
- **`EnumNode.tsx`**: same mønster, MEN dei gamle `side-east`/`side-west`-handtaka er FJERNA heilt (ikkje berre behaldne-men-ubrukte) — enums mottek berre range-kantar, sender aldri sjølve, så det finst ingen kollapsa-kjelde-bruk å halde dei for.

### Vurdert, medvite IKKJE implementert denne runda: kollapsa-kjelde-symmetri

Alternativ A sin skildring nemnde òg "same løysing brukt symmetrisk for samanslegne kjelde-klassar" (eitt handtak per UTGÅANDE kant når kjelda er kollapsa, i staden for eitt felles `side-${side}`-punkt). Dette er **ikkje implementert i denne runda** — kollapsa klassar si utgåande side brukar framleis det gamle, delte handtaket. Grunngjeving for å utsetje: dette er eit mindre alvorleg, sjeldnare-nåbart tilfelle (krev at brukaren aktivt har SAMANSLEGE ei kjelde-klasse med FLEIRE utgåande range-eigenskapar) samanlikna med hovudfunnet (KVAR EINASTE mål-klasse med meir enn éin innkomande kant, uansett kollaps-tilstand — stadfesta reelt og hyppig i BÅDE testskjema). Ikkje nemnt i brukaren sin eksplisitte godkjenning ("alternativ A for ønske 1"), så ikkje utvida scope til å inkludere det utan eksplisitt førespurnad — same prinsipp som resten av denne økta sin praksis (jf. "ein tidlegare versjon av dette svaret implementerte forslaget direkte i staden for berre å skrive det ned"-lærdomen i CLAUDE.md). Kan takast som eit eige, lite oppfølgingssteg viss ønskt.

### Testar lagt til

- `packages/core/src/__tests__/edgeAttributes.test.ts`, ny `describe('deriveGraph incoming range-edge handles (Alternativ A)')` — 7 testar: distinkte handtak-ID-ar for konvergerande kantar (ikkje lenger delt `side-east`/`side-west`), node-data sitt `incomingRangeHandles` samsvarer nøyaktig med kva kantane faktisk refererer, deterministisk sorteringsrekkjefølgje, eitt-innkomande-kant-tilfellet framleis fungerer (ikkje eit spesialtilfelle), respekterer `hiddenEdgeTypes`/`rangeEdgesMode`-filtrering (ingen handtak for skjulte kantar), kollapsa-kjelde sin `sourceHandle` uendra (regresjonssjekk), og enum-mål får òg eigne handtak.
- `packages/core/src/__tests__/ghostNodes.test.ts` — 1 ny test: importerte/spøkelse-mål-klassar (ein separat kode-sti frå lokale klassar) får òg distinkte handtak, ikkje delte.

### Empirisk stadfesta mot BÅDE dei ekte testskjemaa (mellombels debug-testskript, køyrt éin gong, sletta etterpå)

- `samt-bu-schema.yaml`: `Skole` har 4 innkomande range-kantar → **4 distinkte handtak-ID-ar** (før: alle 4 ville delt eitt einaste punkt). `Basisgruppe` (3 innkomande) → 3 distinkte. `Elev` (2 innkomande) → 2 distinkte.
- `enhetsregisteret-frivilligorganisasjonapi-schema.yaml`: ALLE åtte klassar med meir enn éin innkomande kant (`IcnpoKategori`, `Vedtekter`, `Grasrotandel`, `Regnskapsrapportering`, `Paategning`, `Virksomhetsrelasjon`, `Tidsperiode`, `SistInnsendteAArsregnskap` — kvar med 2 innkomande, éin frå containerklassen og éin frå `FrivilligOrganisasjon`) fekk **nøyaktig så mange distinkte handtak-ID-ar som innkomande kantar** — null kollisjonar, stadfesta for KVAR EINASTE reelle konvergens-tilfelle i begge skjema.

### Verifisert

- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- `pnpm exec eslint packages/*/src --ext .ts,.tsx` (heile repoet, den faktiske `pnpm lint`-kommandoen): 0 feil, 0 åtvaringar.
- `scripts/check-token-usage.sh`: PASS.
- `edgeAttributes.test.ts` + `ghostNodes.test.ts` åleine: 53/53 testar grøne (45 + 8, inkl. dei 8 nye).
- Full `packages/core`-testpakke: 574/574 testar grøne (**null faktiske testfeil**, stadfesta via eksplisitt `grep -c "FAIL "`), 6 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]`-infrastrukturflaksen — ingen reelle regresjonar.

**Ikkje verifisert manuelt i nettlesar** — visuell stadfesting av at kantane faktisk ser synleg meir spreidde ut på canvaset (ikkje berre at handtak-ID-ane er tekniske ulike) bør gjerast ved neste rebuild/redeploy (hugs `podman-compose down` FØR `up --build -d`).
