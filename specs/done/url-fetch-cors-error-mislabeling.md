# Spec: Betre feilhandtering for URL-henting — slutt å gjette "CORS" for alle fetch-feil

Status: **Implementert og verifisert.**
Dato: 2026-09-15

Bakgrunn (ordrett frå brukaren, i førre melding): "oppdater CLAUDE.md med at vi ikkje skal drive med security-by-obscurity. Feil skal fangast og visast på ein ordentlig måte. Lag ein spec for korleis vi kan forbedre feilhandteringa i dette caset og skriv til /specs"

Det generelle prinsippet ("no security-by-obscurity, feil skal fangast og visast ordentleg") er alt lagt til `CLAUDE.md` (ny seksjon "Application Error Handling"). Denne spec-en gjeld det KONKRETE caset som utløyste prinsippet: brukaren fekk ei "CORS"-feilmelding ved fyrste forsøk på å opne to GitHub-URL-ar (`.../blob/main/src/linkml/samt/samt-bu/samt-bu-schema.yaml` og tilsvarande for `enhetsregisteret-frivilligorganisasjonapi-schema.yaml`), men same URL fungerte feilfritt på forsøk nummer to utan noka endring.

## Stadfesta i koden — same feilaktige heuristikk duplisert to stader

`packages/core/src/project/projectLoader.ts:204-214` (`openSchemaFromUrl`, brukt av "Open Schema from URL"-dialogen):
```ts
} catch (err) {
  if (err instanceof Error && (err.message.startsWith('HTTP ') || err.message.startsWith('Failed to fetch'))) {
    const isCors = err.message === 'Failed to fetch';
    throw new Error(
      isCors
        ? `Could not reach URL — the server may not allow cross-origin requests (CORS)`
        : err.message
    );
  }
  throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
}
```

`packages/core/src/editor/ImportSchemaDialog.tsx:141-146` (`Import Schema`-dialogen) — same mønster, uavhengig implementert:
```tsx
const isCors = err instanceof Error && err.message === 'Failed to fetch';
setError(
  isCors
    ? 'Could not reach URL — the server may not allow cross-origin requests (CORS)'
    : err instanceof Error ? err.message : 'Failed to fetch schema from URL'
);
```

**Grunnårsak:** nettlesaren sin `fetch()` kastar den identiske, medvite uinformative feilteksten `TypeError: Failed to fetch` for mange ulike underliggande årsaker — DNS-oppslag som feilar, avbroten tilkopling, offline-tilstand, ein annonseblokkar/personvern-utviding som blokkerer, ein kald TLS-handshake mot ein tidlegare ukontakta host, OG ei ekte CORS-avvising. Nettlesaren skjuler medvite den eigentlege årsaka for JS av tryggleiksgrunnar (cross-origin-informasjonslekkasje er nettopp det CORS skal hindre). Koden sin `isCors`-sjekk (`err.message === 'Failed to fetch'`) behandlar difor EIN av fleire moglege årsaker som om han var den einaste, og fortel brukaren noko koden ikkje faktisk veit.

At nøyaktig same URL fungerte utan feil på forsøk nummer to (ingen kodeendring, ingen brukar-handling utover å prøve igjen) er sjølve beviset på at det ikkje var ei ekte CORS-policy-avvising — `raw.githubusercontent.com` (som `github.com/.../blob/...`-URL-ar vert automatisk omskrivne til, jf. `normalizeSchemaUrl` i `importResolver.ts:121-136`) sender permissive `Access-Control-Allow-Origin`-headers konsekvent; ei ekte policy-avvising ville feila kvar gong, ikkje berre éin gong. Det reelle mønsteret matchar i staden ein forbigåande nettverks-/tilkoplingshikke ved fyrste kontakt med eit domene i nettlesarøkta.

## Forslag til forbetring

Fire tiltak, vurdert kvar for seg — tilrådinga er å gjere alle fire saman, sidan dei løyser ulike delar av problemet og ingen av dei åleine er tilstrekkeleg:

### A. Slutt å gjette årsak — ærleg, ikkje-diagnostiserande feilmelding

Fjern `isCors`-heuristikken. Vis i staden noko slikt:

> "Network request failed: {rå feiltekst frå nettlesaren}. This can happen due to a CORS restriction, a DNS/connectivity issue, or a browser extension blocking the request. Try again, or check the browser console (F12) for the exact failure."

Dette er strengt meir korrekt enn dagens melding utan å vere mindre nyttig — CORS er framleis nemnt som éin moglegheit (framleis relevant informasjon for ein utviklar som feilsøker), men ikkje framstilt som den stadfesta årsaka.

### B. Automatisk eitt nytt forsøk før feil vert vist

Sidan det empirisk observerte mønsteret er "feilar éin gong, fungerer umiddelbart på nytt forsøk utan endring", er den mest brukarvennlege fiksen å prøve éin gong til automatisk (t.d. etter ei kort pause, 300-500ms) før feilen i det heile vert vist til brukaren. Dette adresserer det brukaren faktisk opplevde (måtte klikke "Open" to gongar) direkte, ikkje berre meldinga sin ordlyd. Dersom det andre forsøket òg feilar, vis feilmeldinga frå tiltak A.

### C. Slå saman den dupliserte logikken til éin delt hjelpefunksjon

`projectLoader.ts` og `ImportSchemaDialog.tsx` har i dag to uavhengige, nesten identiske implementasjonar av same (feilaktige) heuristikk — dei kan drive frå kvarandre over tid (t.d. om nokon rettar den eine men gløymer den andre, slik denne saka nesten vart). Trekk ut ein delt `classifyFetchError(err: unknown): string`-funksjon (t.d. i `importResolver.ts` eller ein ny `io/fetchErrors.ts`) som implementerer tiltak A+B sin logikk éin stad, importert av begge dialogane.

### D. (Vurdert, ikkje tilrådd åleine) Meir presis feilklassifisering via HEAD-request e.l.

Vurdert, men forkasta som hovudtiltak: Fetch API sitt tryggleiksdesign gjer at ingen mengd ekstra klientkode (HEAD-request, `no-cors`-modus-prøving, timing-analyse) kan pålitileg skilje ei ekte CORS-avvising frå eit DNS-/tilkoplingsproblem — informasjonen er rett og slett ikkje tilgjengeleg for JS i nettlesaren. Dette er ikkje noko denne kodebasen kan løyse med meir klientside-logikk; ærleg uvisse (tiltak A) er den korrekte responsen på ei grense i plattforma, ikkje eit teikn på at koden må jobbe hardare.

## Testcase / akseptansekriterium

1. Ei `fetch()`-feiling med melding `"Failed to fetch"` vert IKKJE lenger framstilt som ei stadfesta CORS-avvising — feilmeldinga nemner CORS som éi av fleire moglegheiter, ikkje den einaste/sikre årsaka.
2. Eit transient/forbigåande fetch-feil (simulert i test, t.d. med ein mock som feilar éin gong og lukkast andre gong) vert løyst automatisk via retry i tiltak B, utan at brukaren ser noka feilmelding i det heile.
3. Eit VEDVARANDE fetch-feil (begge forsøka feilar) viser den ærlege meldinga frå tiltak A, ikkje ei stille løkke eller eit uendeleg antal forsøk.
4. `projectLoader.ts` og `ImportSchemaDialog.tsx` bruker begge den same delte hjelpefunksjonen (tiltak C) — ingen duplisert `isCors`-logikk att nokon stad i kodebasen (`grep -rn "isCors" packages/core/src` gjev treff berre i den nye delte hjelpefunksjonen sin eigen implementasjon/testar).
5. `pnpm --filter @linkml-editor/core test` og `tsc --noEmit` framleis grøne.

## Implementering (2026-09-15)

A+B+C implementert saman, D vurdert og medvite ikkje forfølgt (jf. grunngjevinga over):

1. **Ny fil `packages/core/src/io/fetchErrors.ts`** — to eksporterte funksjonar:
   - `classifyFetchError(err: unknown): string` (tiltak A) — passerer HTTP-statusfeil uendra, gjev den ærlege, ikkje-diagnostiserande meldinga for `"Failed to fetch"` (nemner CORS som éi av fleire moglegheiter saman med DNS/tilkopling/nettlesarutvidingar), og wrappar alt anna som `Network error: ...`.
   - `fetchTextWithRetry(url, retries = 1, delayMs = 400): Promise<string>` (tiltak B) — prøver på nytt éin gong (konfigurerbart) etter ei kort pause ved feil (nettverksfeil ELLER ikkje-2xx status), kastar den klassifiserte feilen frå `classifyFetchError` berre dersom ALLE forsøk feilar.
2. **`projectLoader.ts` (`openSchemaFromUrl`)** — heile den gamle `try/catch` med `isCors`-sjekken er borte, erstatta med eitt kall: `const content = await fetchTextWithRetry(url);`. JSDoc-kommentaren oppdatert til å ikkje lenger seie "CORS/network failures" spesifikt.
3. **`ImportSchemaDialog.tsx` (`handleUrlImport`)** — same mønster: rå `fetch()` + manuell status-sjekk erstatta med `fetchTextWithRetry(url)`; catch-blokka sin `isCors`-heuristikk fjerna heilt, viser no berre `err.message` direkte (som alt er ærleg, sidan `fetchTextWithRetry` produserer det).
4. **Tiltak C (deling)** — oppnådd ved konstruksjon: begge kallstadene importerer no `fetchTextWithRetry` frå same `io/fetchErrors.ts`, ingen duplisert logikk att.
5. **Nye testar** — `packages/core/src/io/__tests__/fetchErrors.test.ts` (9 testar): `classifyFetchError` sine fire greiner (inkl. eksplisitt stadfesting av at "the server may not allow cross-origin" IKKJE lenger finst i meldinga, og at både "cors" og "dns" vert nemnt som moglegheiter), pluss `fetchTextWithRetry` sine fem scenario (suksess utan retry, transient feil løyst stille via retry, vedvarande feil kastar klassifisert melding, ikkje-2xx-status handtert likt, `retries: 0` gjev ingen retry).

**Verifisert:**
- `tsc --noEmit` på `@linkml-editor/core`: ingen feil.
- `tsc --noEmit` på `@linkml-editor/web` (etter mellombels `pnpm --filter @linkml-editor/core build`, `dist/` fjerna etterpå): ingen feil.
- `eslint packages/*/src --ext .ts,.tsx`: ingen feil.
- `scripts/check-token-usage.sh`: PASS.
- `grep -rn "isCors" packages/core/src packages/web/src`: **0 treff** — endå strengare enn akseptansekriteriet kravde (ingen `isCors`-variabel att i det heile, klassifiseringa skjer direkte i `classifyFetchError`).
- Full `pnpm --filter @linkml-editor/core test`-suite (køyrt to gongar for eit fullstendig resultat pga. kjend `[vitest-pool-runner]`-infrastrukturflakigheit): andre køyringa gav 25/25 testfiler, 632/632 testar grøne (inkl. dei 9 nye `fetchErrors.test.ts`-testane), ingen reelle `FAIL`-linjer i nokon av dei to køyringane.
