# Spec: Redusere klokketid for `podman-compose -f deploy/web/docker-compose.yml build/up`

Status: **Implementert.** Brukaren godkjende opne spørsmål 1 (fjern `--no-cache`) og 2a (`init: true`). `init: true` er lagt til `proxy`-tenesta i `deploy/web/docker-compose.yml`. `--no-cache` var aldri hardkoda nokon stad i repoet (berre ein vane i brukaren sin manuelle kommando) — dokumentert i `README.md` og `packages/docs/development.md` at det ikkje trengst for vanlege redeploy, med tilvising til den alt-dokumenterte `down`/`up --build`-flyten for stale-container-problemet.
Dato: 2026-09-16

**Viktig tilleggsfunn under implementering (ikkje i opphavleg scope, berre til orientering):** `README.md`/`packages/docs/development.md` dokumenterer frå før (uavhengig av denne saka) at `--force-recreate` **ikkje** er pålitleg for å faktisk plukke opp eit nytt image på `podman-compose` 1.5.0 — berre full `down` + `up --build -d` er stadfesta pålitleg. Brukaren sin vanlege kommando (`up -d --force-recreate`) brukar nettopp `--force-recreate`. Dette vart ikkje endra her (kun `--no-cache`-delen og `init: true` var godkjent), men er verdt å vurdere separat sidan det er ei anna, alt-dokumentert kjelde til bortkasta tid (ein rebuild som ikkje slår gjennom, som må reprøvast).
Ønske (direkte sitat frå brukaren): "bygg og deploy tek litt tid. Kan du evaluere loggen og finne ut om det er tiltak vi kan gjere for å få ned klokketida? `podman-compose -f deploy/web/docker-compose.yml build --no-cache && podman-compose -f deploy/web/docker-compose.yml up -d --force-recreate`"

## Stadfesta fakta (denne økta)

Grunnlag: den limte inn loggen frå brukaren sin faktiske køyring, pluss lesing av `deploy/web/Dockerfile.web`, `deploy/web/docker-compose.yml`, `packages/proxy/Dockerfile`, `packages/proxy/server.js` og root-`.dockerignore`.

1. **Kommandoen brukaren faktisk køyrde inneheld eksplisitt `--no-cache`.** `deploy/web/Dockerfile.web` er allereie strukturert for lagdelt cache — manifestfilene (`package.json`, `pnpm-lock.yaml`, kvart pakke-`package.json`) vert kopiert *før* `COPY . .` og `pnpm install`, nøyaktig for at eit vanleg (ikkje `--no-cache`) bygg skal kunne hoppe over `pnpm install` OG begge `tsc`/`vite build`-stega når berre kjeldekode (ikkje avhengnadar) er endra sidan førre bygg. `--no-cache` nullstiller denne cachen fullstendig kvar einaste gong, uavhengig av kva som faktisk endra seg.

2. **Loggen viser eit konkret, fast 10-sekunders stopp ved nedrivinga:**
   ```
   WARN[0010] StopSignal SIGTERM failed to stop container web_proxy_1 in 10 seconds, resorting to SIGKILL
   ```
   Rotårsak stadfesta ved lesing av `packages/proxy/Dockerfile` (`CMD ["node", "server.js"]`) og `packages/proxy/server.js`: `node` køyrer direkte som PID 1 i containeren, og `server.js` registrerer aldri ein handler for `SIGTERM`/`SIGINT` (ingen `process.on('SIGTERM', ...)` noko stad). Dette er det kjende Docker/Node-fallgruva: Linux-kjernen brukar IKKJE default-handteringa (avslutt) for signal sendt til PID 1 i eit PID-namespace med mindre prosessen sjølv har registrert ein handler — bortsett frå `SIGKILL`/`SIGSTOP`, som alltid går gjennom. Sidan `server.js` ikkje registrerer noko, vert `SIGTERM` stille ignorert, og podman/docker sin stopp-timeout (10s, `STOPSIGNAL`-standard) må alltid renne ut før eit tvinga `SIGKILL` skjer. Dette skjer kvar einaste gong proxy-containeren vert stoppa/gjenoppretta (`--force-recreate`, `down`, `restart`), ikkje berre denne eine gongen.

3. **Dei einskilde byggstega som FAKTISK viser varigheit i loggen er alle raske:**
   - `pnpm install --frozen-lockfile` (906 pakkar): "Done in 11s"
   - `packages/core`-bygg (tsc + vite + dts-generering): vite-steget "built in 6.09s" (dts-generering på 5.38s er ein del av desse 6.09s, ikkje i tillegg)
   - `packages/web`-bygg: vite-steget "built in 2.71s"

   Til saman under ~20 sekund reell kompileringstid. Loggen manglar derimot tidsstempel per `STEP`, så eg kan **ikkje** frå denne loggen aleine talfeste kor mykje av den totale klokketida som går med til base-image-pulling, `COPY . .`/build-context-overføring, eller `corepack prepare pnpm@10`. Det er difor ein reell kunnskapslakune — sjå tiltak 3 under.

4. **Arbeidskatalogen ligg på `/mnt/c` (WSL2 9p/drvfs-bind-mount).** `specs/backlog/test-timing-instrumentation-and-reliability.md` og CLAUDE.md sin `node-pnpm-fallback`-skill har alt stadfesta empirisk (målt, ikkje anteke) at denne typen filsystem er vesentleg tregare (~8-9×) for arbeid med mange små filer, noko som råkar både `pnpm install` og build-context-lesinga same veg som det alt er dokumentert å råke vitest-workers og Vite sin file-watcher. Denne pasted loggen isolerer ikkje den kostnaden separat, men det er den same klassen problem som er dokumentert andre stader i dette repoet, ikkje eit nytt funn.

5. **Root-`.dockerignore` er allereie korrekt sett opp** — ekskluderer `node_modules`, `.pnpm-store`, `.git`, build-output og testartefaktar frå build-konteksten. Feilmodusen CLAUDE.md åtvarar mot andre stader ("COPY . . kopierer noko stort og unødvendig") er difor **ikkje** stadfesta som eit problem her.

6. **Bundle-storleiksåtvaringa i loggen** ("Some chunks are larger than 500 kB after minification") gjeld nedlastingsstorleik/køyretid for sluttbrukaren i nettlesaren, ikkje byggets klokketid — ikkje relevant for dette spørsmålet, men nemnt for ordens skuld.

## Tiltak (forslag — ingen av desse er implementerte)

### 1. Ikkje bruk `--no-cache` for vanlege deploy — høgast tillit, lågast innsats
`--no-cache` slår av heile cache-mekanismen `Dockerfile.web` allereie er bygd for å utnytte (fakta-punkt 1). Utan `--no-cache` vil eit bygg der berre appkode (ikkje `package.json`/lockfile) er endra sidan sist, hoppe over både `pnpm install` OG `corepack prepare` heilt, og berre køyre dei laga som faktisk endra seg (`COPY . .` og nedover). Dette gjev truleg det største enkelttiltaket for redusert klokketid ved vanlege deploys.

Om `--no-cache` er brukt medvite — t.d. for å unngå ein mistenkt stale-cache-feil — bør det heller brukast punktvis (berre når det faktisk trengst) enn som standard i kvar deploy. **Spør brukaren:** var `--no-cache` medvite valt av ein spesifikk grunn (t.d. eit tidlegare cache-relatert problem), eller berre vane? Det avgjer om tiltaket er "fjern det" eller "dokumenter når det skal brukast".

### 2. Fiks proxy-containeren sin signalhandtering — sparar eit garantert, fast 10 sekund per `--force-recreate`/`down`/`restart`
To alternative løysingar, i prioritert rekkjefølgje:

- **a) `init: true` på `proxy`-tenesta i `deploy/web/docker-compose.yml`** (Compose Spec-standardfelt, støtta av `podman-compose`/`podman run --init`). Legg til ein liten init-prosess (tini/catatonit) som PID 1 i staden for `node` sjølv — denne vidaresender signal korrekt til barneprosessen og krev **ingen** endring i `packages/proxy/server.js`. Éi linje, ingen appkode-endring, standard mønster for akkurat denne klassen feil.
- **b) Registrer eksplisitte signalhandlerar i `packages/proxy/server.js`** (`process.on('SIGTERM', () => server.close(() => process.exit(0)))`, tilsvarande for `SIGINT`) — meir eksplisitt, men krev appkode-endring og må hugsast om fleire signal skal handterast likt seinare.

(a) er tilrådd som primærtiltak sidan det er minimal, veletablert, og uavhengig av kva `server.js` gjer eller endrar seg til.

### 3. Mål faktisk tidsbruk før eventuelle vidare tiltak
Sidan pasted-loggen manglar per-steg tidsstempel (fakta-punkt 3), bør tiltak 1 og 2 verifiserast empirisk (jf. CLAUDE.md sitt prinsipp "verify configuration empirically, not by code-reading alone") ved å samanlikne total klokketid før/etter — t.d. ved å pakke inn heile kommandoen med `time`, eller bruke podman/buildah sin `--log-level=debug`/BuildKit `--progress=plain` med tidsstempel per steg. Dette gjev og eit grunnlag for å vurdere om WSL2 `/mnt/c`-kostnaden (fakta-punkt 4) er stor nok til å grunngje eit vidare tiltak (t.d. flytte arbeidstreet), eller om tiltak 1+2 aleine er nok.

### 4. Ikkje eit tiltak, berre eit notat: bundle-storleik
"Some chunks are larger than 500 kB" (fakta-punkt 6) er urelatert til byggets klokketid — nemnt her berre for å eksplisitt utelukke det som eit tiltaksområde for dette spørsmålet.

## Opne spørsmål — avklara før implementering

1. Skal `--no-cache` fjernast heilt frå standard deploy-kommandoen, eller berre dokumenterast (t.d. i ein kommentar i `docker-compose.yml` eller ein README/deploy-notat) som "bruk berre ved mistanke om stale cache"?
2. Godkjenner brukaren tiltak 2a (`init: true`) framfor 2b (appkode-endring), eller føretrekk dei sistnemnde av andre grunnar (t.d. ønske om eksplisitt, sjølvdokumenterande shutdown-logikk i `server.js`)?
