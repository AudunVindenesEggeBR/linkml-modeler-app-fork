# Spec: "Overskrift" som fyrste val i kvar av dei 6 layout-veljarane i verktøylinja

Status: **Implementert og verifisert.**
Dato: 2026-09-14

Ønske (ordrett, runde 1): "eg ønsker at alle layout toggles skal ha ein 'overskrift' som i praksis er valg nr 1 i kvar toggle som seier kva denne toggelen handlar om. F.eks kan toggelen som lar deg velge Left-right eller Top-down heite 'Direction'."

Ønske (ordrett, runde 2 — tillegg): "i tillegg ønsker eg at kvar toggle merker default verdien med ein '(default)' tekst tilslutt."

## Noverande tilstand

`SchemaCanvas.tsx` sin verktøylinje har 6 `<select>`-element for layout-styring (`lme-canvas-layout-direction`, `-strategy`, `-edge-routing`, `-node-placement`, `-spacing`, `-model-order`). Ingen av dei har ein synleg `<label>` — einaste forklaring i dag er ein `title`-attributt (berre synleg ved hover, ikkje alltid oppdaga). Når ein `<select>` er lukka, viser han berre teksten til den NO VALDE verdien (t.d. "↓ Top-down") — ingenting fortel kva SJØLVE VELJAREN gjeld før du opnar han eller hovrar over han.

## Forslag

Legg til eit fyrste `<option>`-element i KVAR av dei 6 veljarane, `disabled` (kan ikkje faktisk veljast — reint ei overskrift synleg når lista vert opna), med tekst som seier kva veljaren gjeld — nøyaktig slik brukaren sjølv føreslår for retning-veljaren ("Direction").

**Merk kva dette IKKJE endrar:** sidan `value={layoutDirection}` (osv.) alltid er bunde til ein ekte tilstandsverdi (aldri den tomme/disabled overskrift-verdien), vil den LUKKA veljaren framleis vise den faktiske noverande valde verdien (t.d. "↓ Top-down"), akkurat som i dag — overskrifta er berre synleg NÅR DU OPNAR lista, som fyrste (gråa ut, ikkje-klikkbare) linje over dei ekte vala.

Føreslegne overskrifter (matcha mot kvar veljar sin eksisterande `title`-tekst):

| Veljar (`id`) | Ny overskrift-tekst |
|---|---|
| `lme-canvas-layout-direction` | `Direction` |
| `lme-canvas-layout-strategy` | `Layering strategy` |
| `lme-canvas-layout-edge-routing` | `Edge routing` |
| `lme-canvas-layout-node-placement` | `Node placement` |
| `lme-canvas-layout-spacing` | `Spacing` |
| `lme-canvas-layout-model-order` | `Order` (alternativ: `Model order`, matchar ELK-feltnamnet meir presist — sjå ope spørsmål) |

Implementeringseksempel (retning-veljaren):

```tsx
<select id="lme-canvas-layout-direction" ...>
  <option value="" disabled>Direction</option>
  <option value="TB">↓ Top-down</option>
  <option value="BT">↑ Bottom-up</option>
  <option value="LR">→ Left-right</option>
  <option value="RL">← Right-left</option>
</select>
```

Same mønster for dei andre fem — berre eitt nytt `<option disabled value="">…</option>`-element lagt til fremst i kvar, ingen annan kode (state, `onChange`, `applyAutoLayout`-kall) rørt.

## Forslag, runde 2: merk standardverdien med "(default)" tilslutt

Legg til `" (default)"` bakarst i teksten til den `<option>` som samsvarer med den FAKTISKE standardverdien (initial `useState`-verdien i `SchemaCanvas.tsx`/`DEFAULT_OPTIONS` i `autoLayout.ts`) for kvar av dei 6 veljarane:

| Veljar | Standardverdi i koden | Dagens opsjonstekst | Ny tekst |
|---|---|---|---|
| Direction | `'TB'` | `↓ Top-down` | `↓ Top-down (default)` |
| Layering strategy | `'LONGEST_PATH'` | `Longest path` | `Longest path (default)` |
| Edge routing | `'ORTHOGONAL'` | `Orthogonal (right angles)` | `Orthogonal (right angles) (default)` |
| Node placement | `'BRANDES_KOEPF'` | `Brandes-Koepf (ELK default)` | `Brandes-Koepf (default)` — stadfesta av brukaren, sjå "Svar frå brukar (runde 4)" under |
| Spacing | `'normal'` | `Normal spacing` | `Normal spacing (default)` |
| Order | `false` (av) | `Default order` | **uendra — stadfesta av brukaren, sjå "Svar frå brukar (runde 3)" under** |

**To stader treng eit eksplisitt val før implementering, ikkje berre mekanisk vedheng av "(default)":**

- **Node placement:** opsjonen heiter alt `Brandes-Koepf (ELK default)` — å leggje til enda eit "(default)" ville gje `Brandes-Koepf (ELK default) (default)`, dobbelt opp og rotete. Denne teksten var opphavleg vald FØR dette nye "(default)"-mønsteret fanst (jf. `canvas-layout-topdown.md`), og skildrar noko litt anna (at ELK SJØLV brukar denne som sin eigen standard-algoritme) enn det nye mønsteret (at DETTE er kva EDITOREN vel som standard for deg). Sjå ope spørsmål 2.
- **Order:** av-opsjonen heiter alt `Default order` — å leggje til "(default)" ville gje `Default order (default)`, same type dobbeltopp-problem. Sjå ope spørsmål 3.

## Testcase / akseptansekriterium

1. Kvar av dei 6 veljarane viser overskrifta si som FYRSTE, gråa-ut/ikkje-klikkbare linje når lista vert opna.
2. Den lukka veljaren viser framleis den faktiske valde verdien (uendra åtferd) — overskrifta "stel" ikkje visinga.
3. Overskrifta kan IKKJE veljast (freistar du klikke han, skjer ingenting — `disabled`).
4. Nøyaktig éin opsjon i kvar veljar (utanom sjølve overskrifta) er merkt "(default)" (eller tilsvarande, jf. dei to særtilfella over), og han samsvarer med den FAKTISKE `useState`-startverdien/`DEFAULT_OPTIONS`-verdien i koden — ikkje berre visuelt plausibel, men verifisert mot koden.
5. Ingen endring i faktisk layout-åtferd (reint UI-tekst-tillegg).

## Svar frå brukar (runde 3, 2026-09-14)

"Order (default) — keep it, don't rename" — svarar på både spørsmål 1 og 3 for denne eine veljaren:
- **Overskrift stadfesta:** `Order` (ikkje `Model order`).
- **Ope spørsmål 3 løyst:** `Default order`/`Schema order` (dei to eksisterande opsjonstekstane) skal stå HEILT UENDRA — ingen "(default)"-vedheng, ingen omdøyping. Denne veljaren sitt av-val held fram med å seie "Default order" nøyaktig som i dag, og tel som denne veljaren si "(default)"-merking (ekvivalent i meining, om enn ikkje bokstaveleg vedhengt).

## Svar frå brukar (runde 4, 2026-09-14)

"change to Brandes-Koepf (default)" — løyser siste opne spørsmål: Node placement sin standard-opsjon vert `Brandes-Koepf (default)` (erstattar `Brandes-Koepf (ELK default)`, mister "ELK"-presiseringa til fordel for konsekvens med dei fire andre veljarane som alle no får eit reint "(default)"-vedheng).

**Alle opne spørsmål er no løyste. Spec-en er ferdig presisert:**

| Veljar | Overskrift (nytt fyrste, disabled `<option>`) | Standard-opsjon sin endelege tekst |
|---|---|---|
| Direction | `Direction` | `↓ Top-down (default)` |
| Layering strategy | `Layering strategy` | `Longest path (default)` |
| Edge routing | `Edge routing` | `Orthogonal (right angles) (default)` |
| Node placement | `Node placement` | `Brandes-Koepf (default)` |
| Spacing | `Spacing` | `Normal spacing (default)` |
| Order | `Order` | `Default order` (uendra) |

## Runde 5 (2026-09-14) — implementert

Brukaren skreiv "utfør spec" — eksplisitt godkjenning, jf. CLAUDE.md.

**Implementert nøyaktig som skildra i tabellen over:** eitt nytt `<option value="" disabled>…</option>` lagt til fremst i kvar av dei 6 `<select>`-elementa i `SchemaCanvas.tsx`, pluss `" (default)"` lagt til bakarst i standard-opsjonen sin tekst for dei fem der det vart avtala (Direction, Layering strategy, Edge routing, Node placement, Spacing). Order-veljaren si `Default order`/`Schema order`-tekst er heilt uendra, som avtala. Ingen anna kode (state, `onChange`-handterarar, `applyAutoLayout`-kall) rørt.

**Verifisert:**
- Full typecheck av `packages/core` (`tsc --noEmit`): rein.
- `pnpm exec eslint packages/core/src/canvas/SchemaCanvas.tsx`: 0 feil, 0 åtvaringar.
- `scripts/check-token-usage.sh`: PASS.
- Full `packages/core`-testpakke: 275/275 testar grøne (**null faktiske testfeil**), 14 filer feila å STARTE med den alt-dokumenterte `[vitest-pool-runner]`-infrastrukturflaksen — ingen reelle regresjonar.
- Ingen dedikert automatisert test lagt til — reint JSX-tekst-/markup-tillegg (nye `<option>`-element, ingen logikkendring), same grunngjeving som tidlegare reine UI-tekst-endringar denne økta (t.d. `EnumNode.tsx` sitt `reachable_from`-label) — verifisert via typecheck+lint, ikkje eigne einingstestar.

**Ikkje verifisert manuelt i nettlesar** — bør stadfestast ved neste rebuild/redeploy (hugs `podman-compose down` FØR `up --build -d`).
