# Spec: Timing-instrumentering for testkøyring og containerkall, pluss tiltak mot random-feil i full testsuite

Status: **Del 1 implementert og verifisert empirisk** (sjå diff i `.githooks/pre-push`, vitest/playwright-configane, `.github/workflows/test.yml`, `.gitignore`, `scripts/time-cmd.sh`, CLAUDE.md). **Del 2 gjennomført i fleire rundar** for vitest-core-suiten: (1) 5× baseline + eitt `--maxWorkers=1`-eksperiment (gjorde ting verre, ikkje betre), (2) eitt avgjerande container-baserte eksperiment med `node_modules` flytta til native ext4 — 13-14× raskare, flaksen heilt borte. **Del 2b: kandidat 0 er UTFØRT** (brukaren gav eksplisitt godkjenning) — native Node/pnpm installert på WSL2-verten (pålitleg, 11-14s vs 226-228s install), pluss to nye script (`scripts/setup-native-dev.sh`, `scripts/check-native-dev-requirements.sh`). Sjølve node_modules-relokeringsmekanismen var på det tidspunktet stadfesta TO gonger uavhengig (container og ekte native) via symlink, men den automatiserte symlink-implementasjonen synte seg upåliteleg (1 suksess av 9). **Del 2c: testa `mount --bind` som erstatning for symlink — 5 av 5 uavhengige, ferske forsøk lukkast, OG oppdaga at det ikkje treng `sudo` i det heile (unprivilegerte mount-namespace via `unshare`). Del 2c-tilrådinga er no GODKJEND og IMPLEMENTERT — men avgrensa til `.githooks/pre-push` (brukaren sitt eksplisitte scope-val), IKKJE `scripts/setup-native-dev.sh` sin interaktive dagleg-bruk-mekanisme, som står uendra.** Sjå "Tilråding — GODKJENT og IMPLEMENTERT" under Del 2c. Fann og retta samtidig ein reell, aktiv `--run`-flagg-regresjon i den committa hooken (ville feila HEILE `git push` øyeblikkeleg). **E2E-infrastrukturen er no FULLT verifisert enda til enda: Chromium nedlasta, dei 3 manglande system-pakkane (`libnspr4 libnss3 libasound2t64`) identifisert og installert av brukaren sjølv (`sudo apt-get`), `scripts/check-native-dev-requirements.sh` går grønt, og ein full `.githooks/pre-push`-køyring gjennomfører heile E2E-suiten (4/7 testar bestod — dei 3 attverande feila er testnivå-feil, ikkje infrastruktur, sjå "Status" under Del 2c for detaljar).** CI-baserte målingar står framleis att.
Dato: 2026-09-10 (Del 1 implementert → Del 2 runde 1 (baseline + maxWorkers) → Del 2 runde 2 (native node_modules-eksperiment) → Del 2b (kandidat 0 utført, symlink upåliteleg) → Del 2c (mount --bind testa, 5/5 pålitleg, ingen sudo naudsynt) → Del 2c-tilråding godkjend og implementert i `.githooks/pre-push` → Chromium nedlasta, manglande system-pakkar identifisert → brukaren installerte pakkane, full E2E-infrastruktur verifisert → Del 2d: parallelliserings-evaluering — vitest sin eigen arbeidarkonfig og tvers-pakke-orkestrering er alt nær optimum (manuell overstyring gjer ting VERRE), men eit varm-cache-funn (E2E 169s→32s frå andre push) er eit mykje større, alt-eksisterande klokketid-tiltak)
Ønske (opphavleg, frå brukaren): "Det er eit førande prinsipp at vi skal bruke WSL2 og mest mulig skal kjøre i containere. Kjøring av tester går sakte og når vi kjører full testsuite får vi alltid random feil som kan være knytta til treg io og timeouts. Legg til timere i alle tester og i alle containerkall slik at vi kan finne ut nøyaktig kva som tar tid og kom med forslag til effektiviseringstiltak som reduserer klokketida samtidig som vi fjærner dei random feila som oppstår ved kjøring av full testsuite."

## Stadfesta fakta (denne økta)

Før forslag: kva er faktisk sant i akkurat dette miljøet, målt/observert no — ikkje anteke.

1. **Denne arbeidskatalogen ligg på ein 9p/drvfs-bind-mount, ikkje på nativt Linux-filsystem.**
   ```
   $ pwd
   /mnt/c/dev/git/linkml-modeler-app-fork
   $ mount | grep /mnt/c
   C:\ on /mnt/c type 9p (rw,noatime,aname=drvfs;...,cache=0x5,...)
   ```
   Rotfilsystemet (`/`) er derimot ekte `ext4` på `/dev/sdd`. Dette stadfestar direkte den typen I/O-skilnad CLAUDE.md alt dokumenterer generelt ("~8-9× tregare enn direkte på verten", frå `specs/done/session-retrospective-2026-09-08.md` hending #9) — men her målt konkret på **repoet sin eigen arbeidskatalog**, ikkje berre eit containerbind-mount internt i eit `podman run`-kall. Alt arbeid i dette repoet, inkludert `git`, editor-I/O og (når Node finst) `node_modules`-oppslag, går gjennom denne tregare stien med mindre nokon flyttar arbeidstreet.

2. **Denne verten har ikkje Node/pnpm installert i det heile:**
   ```
   $ which node pnpm; echo exit:$?
   exit:127
   ```
   Alt testarbeid her må difor gå via `podman run ... node:22-alpine ...`-mønsteret som alt er dokumentert i CLAUDE.md sin "When the host has no Node/pnpm"-seksjon. Det tyder at kvar full testkøyring i praksis kombinerer **to** kjelder til treigheit: (a) container-cold-start + fersk `pnpm install` kvar gong (già dokumentert, "60-90s åleine for install"), OG (b) 9p-bind-mounten i punkt 1, sidan containeren monterer akkurat denne arbeidskatalogen inn via `-v "$(pwd)":/repo`.

3. **Den kjende, ikkje-deterministiske vitest-flaksen er alt rotårsak-analysert** (same fil, hending #9): jsdom-miljø-kaldstart som av og til overstig vitest sin interne, faste ~60-sekunders "worker ready"-tidsavbrot — stadfesta empirisk til IKKJE å vere CPU-bunde (nær null user/sys-tid under hendinga) og IKKJE spesifikk for `--pool=forks` vs `--pool=threads` (begge råka). Arbeidsrunda som er dokumentert (`--environment node` for reine logikk-testfiler) er verifisert å fungere, men er manuell (må hugsast per fil) og løyser berre eitt symptom, ikkje root cause (treg I/O under kaldstart).

4. **CI (`.github/workflows/test.yml`) køyrer IKKJE i WSL2/podman** — det er ein vanleg `ubuntu-latest` GitHub-runner med Node installert direkte via `actions/setup-node`. Dei to miljøa (lokalt WSL2+podman, og GitHub Actions) har difor **ulike** flaskehalsar og bør ikkje handterast med same tiltak:
   - Lokalt: container cold-start + 9p-bind-mount I/O er hovudmistenkte.
   - CI: ingen bind-mount, ingen container — men lint, `pnpm test --coverage` og heile Playwright E2E-suiten køyrer **sekvensielt i éin jobb**, og pnpm-store/Playwright-browser-cache er alt på plass (line 33-64 i workflow-fila), men **vitest/Vite sin eigen transform-cache er ikkje cacha mellom CI-køyringar**.
   - `.githooks/pre-push` køyrer full unit- + E2E-suite **på utviklaren sin eigen host** før kvar push — **avklara:** dette skjer via same containermetode som er dokumentert og brukt i denne økta (verten har ikkje Node/pnpm). Det tyder at `pre-push` er fullt eksponert for BÅDE container-cold-start-kostnaden OG 9p-bind-mount-treigheita i punkt 1, kvar einaste push, ikkje berre eit skjeldsynt scenario.

5. **Playwright-konfigen (`packages/web/playwright.config.ts`) har alt `retries: process.env.CI ? 2 : 0`** — altså finst det alt eit presedens i repoet for "retry som symptom-lindring i CI" for E2E, men ikkje for vitest, og ikkje lokalt.

## Målsetting

To mål som må handterast saman, ikkje sekvensielt, sidan eit tiltak som "fiksar" det eine lett kan forverre det andre (t.d. fleire retries skjuler treigheit; færre parallelle workers reduserer I/O-kontensjon men aukar klokketid):

- **A. Presis synleggjering:** for kvar full testkøyring (lokalt og i CI), vite nøyaktig kor mykje klokketid som går med til kvar fase (container-oppstart, `pnpm install`, lint, per vitest-testfil, Playwright webServer-oppstart, per Playwright-testfil) — ikkje berre totaltid.
- **B. Redusert klokketid OG null random-feil** i full testsuite, basert på reelle målingar frå A — ikkje gjetting.

## Del 1 — Instrumentering ("legg til timere")

Foreslått, ikkje implementert. Målet er observability utan å endre teståtferd, slik at fase 2 (diagnostisering) får reelle data. **Avklara:** når/viss Del 1 vert godkjend, skal 1a-1e implementerast samla (éin bolk), ikkje stykkevis — sjå "Opne spørsmål — avklara", punkt 3.

### 1a. Vitest (`packages/core`, `packages/electron`)

- Legg til eit eige tidtakings-reporter-oppsett: vitest 4 støttar fleire reporterar samtidig og ein JSON-reporter (`--reporter=json --outputFile=...`) som inkluderer `duration` per test og per fil. Foreslått: køyr med `--reporter=default --reporter=json --outputFile=./test-timing/vitest-<timestamp>.json` slik at kvar køyring skriv eit maskinlesbart tidsspor i tillegg til vanleg terminal-output.
- Vurder `test.slowTestThreshold` i `vitest.config.ts` (flagg testar/filer over ei gitt grense, t.d. 1000ms, tydeleg i output) — **må verifiserast mot vitest 4.1.8 sin faktiske dokumentasjon før bruk**, jf. CLAUDE.md-prinsippet om å ikkje anta API-namn/verdiar frå minnet.
- Vurder å eksplisitt logge `poolOptions`-relatert konfigurasjon (kor mange workers/forks som faktisk vert brukt) ved oppstart, sidan talet på parallelle jsdom-kaldstartar direkte påverkar kor ofte 60s-flaksen (fakta-punkt 3) vert trigga på treg I/O.

### 1b. Playwright (`packages/web`)

- Legg til `reporter: [['list'], ['json', { outputFile: 'test-timing/playwright-<timestamp>.json' }]]` i `playwright.config.ts` — Playwright sin JSON-reporter inkluderer `duration` per test allereie i dagens versjon.
- Legg til eksplisitte `console.error`-tidsstempel (til dømes via ein `globalSetup`-hook) rundt `webServer`-oppstarten spesifikt, sidan `timeout: 60_000` for webServer-oppstart er ein separat klokke frå sjølve testkøyringa og kan vere sin eigen flaskehals.

### 1c. Containerkall (podman/docker)

Foreslått: éin liten, gjenbrukbar bash-hjelpefunksjon (t.d. `scripts/time-cmd.sh`, kjelda inn der det trengst) som pakkar inn eit vilkårleg kommando-kall og skriv `start`, `slutt`, `varigheit` (sekund) og sjølve kommandoen til ei felles tidsloggfil (t.d. `test-timing/containers.log`), i staden for å berre stole på at brukaren/CI-verktøyet tilfeldigvis viser varigheit. Kandidatar til kor dette bør brukast:
  - Kvart `podman run --rm -v "$(pwd)":/repo ...`-kall som alt er dokumentert i CLAUDE.md ("When the host has no Node/pnpm").
  - `deploy/web/check-requirements.sh` og `docker-compose.yml`/`Dockerfile.web`-relaterte `podman-compose build`/`up`-kall.
  - Test- og lint-stega inni sjølve containerkallet (`pnpm install`, `pnpm --filter ... test`), slik at "container cold-start" og "faktisk pnpm/test-arbeid inni containeren" kan skiljast frå kvarandre i tidsloggen — utan dette veit vi ikkje om treigheit kjem frå containeroppstart eller frå testarbeidet sjølv.

### 1d. CI (`.github/workflows/test.yml`)

- GitHub Actions viser alt per-steg-varigheit i Actions-UI-et og i den rå loggen (kvart steg har eit tidsstempel) — **inga ny instrumentering trengst for steg-granularitet**. Det som manglar er **per-fil-granularitet** inni "Test with coverage" og "Run E2E tests"-stega, som JSON-reporterane frå 1a/1b løyser når dei vert lasta opp som artifacts (parallelt med den eksisterande `coverage-report`-artifacten, line 77-83).
- Foreslått ny steg: last opp `test-timing/*.json` som eigen artifact (same mønster som `coverage-report`), slik at tidsdata frå CI-køyringar kan hentast ut og samanliknast over tid utan å måtte re-køyre lokalt.

### 1e. `.githooks/pre-push`

- Legg til enkle `date +%s`-baserte start/slutt/varigheit-linjer rundt kvart av dei to store stega (`pnpm --filter @linkml-editor/core test --run` og `pnpm --filter @linkml-editor/web test:e2e`), skrive til stdout (synleg for brukaren direkte i push-outputen) — dette er den enklaste og lågaste-risiko delen av heile forslaget, reint tillegg utan åtferdsendring.

## Del 2 — Diagnostisering (bruk av dataa)

Før noko av Del 3 vert implementert:

1. Køyr full testsuite **5-10 gonger** lokalt (via podman, sidan det er einaste tilgjengelege metode på denne verten) med instrumenteringa frå Del 1 på plass, og separat i CI (naturleg over fleire PR-ar/push).
2. Bygg ei enkel tabell: fase → median varigheit → varians → tal random-feil observert i den fasen.
3. Stadfest eller avkreft konkret, med tal, kva som faktisk dominerer klokketida (mistanke: container cold-start + `pnpm install` lokalt; sekvensiell E2E-køyring i CI) og kva som faktisk korrelerer med random-feila (mistanke: jsdom-kaldstart under I/O-kontensjon, jf. fakta-punkt 3) — **ikkje gå vidare til Del 3-tiltak basert på mistanke åleine**, jf. CLAUDE.md sitt "verifiser konfigurasjon empirisk"-prinsipp, som gjeld like mykje for ytingsdiagnose som for konfig-verdiar.

## Del 2 — Resultat (runde 1, lokalt via podman, 2026-09-09)

Alt gjennomført med instrumenteringa frå Del 1. Metode: éin `podman run` heldt containeren oppe gjennom `corepack`/`pnpm install` (éin gong) og deretter ei `while`-løkke som køyrde `pnpm --filter @linkml-editor/core test` 5 gonger etter kvarandre — dette isolerer sjølve test-fase-variansen (der den kjende flaksen bur) frå container-cold-start-kostnaden, som alt er målt separat (sjå fakta-punkt 2/tabellen under).

### Baseline: 5× `pnpm --filter @linkml-editor/core test`, ingen konfigendring

| Fase | Varigheit | Merknad |
|---|---|---|
| `pnpm install --frozen-lockfile` (éin gong) | 228s | Samsvarar med CLAUDE.md sitt "60-90s åleine for install"-anslag — **faktisk verdi er 2-4× høgare** enn det talet skildrar, truleg fordi det opphavlege anslaget ikkje var målt frå akkurat denne verten/dette 9p-filsystemet. |
| Testkøyring 1 | 198s | **exit=1** — 9 "Timeout waiting for worker to respond"-feil |
| Testkøyring 2 | 191s | **exit=1** — 9 feil |
| Testkøyring 3 | 205s | **exit=1** — 9 feil |
| Testkøyring 4 | 203s | **exit=1** — 9 feil |
| Testkøyring 5 | 202s | **exit=1** — 10 feil |

**Alle 5 av 5 køyringar feila.** Dette er den viktigaste enkeltoppdaginga i heile Del 2, og **motseier direkte** CLAUDE.md sin noverande skildring av flaksen som "occasional... a handful among hundreds of files" — i dette miljøet (denne verten, denne podman-baserte containeren, dette 9p-bind-mounta filsystemet) er flaksen **ikkje sjeldan i det heile, han er 100% reproduserbar per full køyring**, sjølv om KVA filer som konkret feilar varierer noko frå gong til gong (delvis tilfeldig, delvis ikkje — sjå under).

Ingen av dei 46 feila (9+9+9+9+10) var ekte testfeil — kvar einaste køyring rapporterte 0 faktiske assertion-feil (481-541 testar bestod per køyring, talet varierer fordi filer som feilar å starte i det heile ikkje bidreg testar til totalen den runden). Feila er utelukkande `[vitest-pool-runner]: Timeout waiting for worker to respond` / `Failed to start forks worker for test files ...` — same feilbilete som alt dokumentert i CLAUDE.md, men i eit heilt anna omfang enn skildringa der tilseier.

### Kva filer feilar, og kor ofte (17 unike filer råka over 5 køyringar)

| Fil | Feila i N/5 køyringar |
|---|---|
| `useTheme.test.ts` | **5/5** |
| `manifest.test.ts` | **5/5** |
| `editor-panels.test.tsx` | **5/5** |
| `tours.test.ts` | 4/5 |
| `editorManifestViews.test.ts` | 4/5 |
| `viewsSlice.test.ts` | 3/5 |
| `validation.test.ts` | 3/5 |
| `uiSlice.test.ts` | 3/5 |
| `selectionOps.test.ts`, `layout.test.ts`, `editor.test.ts`, `CommandPalette.test.tsx` | 2/5 kvar |
| `subsets.test.ts`, `round-trip.test.ts`, `perViewLayout.test.ts`, `importResolver.test.ts`, `ghostNodes.test.ts`, `autoLayout.test.ts` | 1/5 kvar |

**Dette er ikkje reint tilfeldig støy.** Tre spesifikke filer (`useTheme.test.ts`, `manifest.test.ts`, `editor-panels.test.tsx`) feila i **absolutt kvar einaste** av dei 5 køyringane — det er eit deterministisk mønster for desse tre, ikkje flaks. Fleire andre filer feila i 3-4/5. Dette peikar mot **systemisk ressurskontensjon** (truleg for mange samtidige forked jsdom-workers i høve til reelt tilgjengeleg CPU/IO-kapasitet på denne verten/containeren) heller enn rein tilfeldig kaldstart-uflaks — sjølv om han framleis IKKJE er 100% deterministisk for alle filer (dei fleste filene varierer mellom køyringar), så den konsekvente kjerna på 3 filer tyder på at desse tre systematisk hamnar bakarst i startkøen/ressurskonkurransen kvar gong. Merk òg at `round-trip.test.ts` (som køyrer i `node`-miljø via `environmentMatchGlobs`, ikkje `jsdom`) òg feila éin gong — dette svekker (motseier ikkje heilt, men nyanserer) hypotesen om at flaksen er *reint* jsdom-spesifikk; ho kan vere ein meir generell fork-pool-ressursflaks som råkar jsdom-filer oftare fordi dei har lengre/tyngre oppstart, ikkje fordi jsdom er einaste triggeren.

### Diagnostisk eksperiment: `--maxWorkers=1` (tvinga serialisering)

For å teste ressurskontensjons-hypotesen direkte (utan å endre nokon committa konfigurasjon — reint ein CLI-parameter for éi diagnostisk køyring, i tråd med Del 2 sitt mandat om å samle empiriske data før Del 3 vert vurdert): køyrde `vitest run --maxWorkers=1` for å tvinge full serialisering (éin test-fil om gongen, ingen samtidige forks).

**Feil undervegs, retta empirisk:** Første forsøk brukte CLI-flagget `--poolOptions.forks.maxForks=1`, henta frå eit websøk. Vitest 4.1.8 avviste det direkte: `CACError: Unknown option \`--poolOptions\``. Rett flagg, stadfesta mot den faktisk installerte versjonen sin eigen `--help`-output (ikkje berre dokumentasjon/søk): **`--maxWorkers`** (heiltal eller prosent, ikkje ein nøsta `poolOptions.*`-sti på kommandolinja). Dette er nøyaktig den typen feil CLAUDE.md sitt eksisterande "sjekk dokumentasjon OG verifiser empirisk"-prinsipp åtvarar mot — sjå tillegget til det avsnittet i CLAUDE.md, lagt til same runde.

**Resultat: prosessen hang.** Med rett flagg (`--maxWorkers=1`) produserte køyringa **null** linjer med testresultat (ikkje éin enkelt "✓ fil.test.ts"-linje) i **1406 sekund (23,4 minutt)** før han vart tvangsavslutta (`podman stop` → SIGKILL, exit 137). Til samanlikning viste dei 5 baseline-køyringane (parallell, standard config) fortløpande "✓ fil"-linjer gjennom heile køyringa og var ferdige på 190-205s kvar. At INGEN fil i det heile vart ferdig på over 23 minutt — ikkje "tregare", men reelt fastlåst/hengande — er sjølv eit substansielt funn, ikkje eit ufullstendig eksperiment.

**Tolking:** Denne eine diagnostiske køyringa **motseier heller enn stadfestar** den enklaste versjonen av "berre reduser parallelliteten"-hypotesen (Del 3, kandidat 3/opphavleg kandidat 2). Å tvinge `maxWorkers=1` løyste ikkje flaksen — han introduserte i staden ein **verre** feilmodus (uendeleg/svært lang hengetilstand) i dette miljøet. Dette kan botne i minst tre ulike, ikkje gjensidig utelukkande forklaringar, ingen av dei stadfesta her:
  1. Vitest sin `forks`-pool har kjende, ikkje-relaterte v4-stabilitetsproblem under viss oppsett (jf. `vitest-dev/vitest#8861`, funne via websøk under dette arbeidet — andre symptom enn vårt, men same underliggjande pool-mekanisme, i same major-versjon).
  2. Éin enkelt forked worker utan nokon "søsken" til å dele/varme opp t.d. Vite sin transform-cache kan i dette spesifikke miljøet (9p-bind-mount) ende opp i eit heilt anna, verre I/O-mønster enn fleire samtidige workers gjer (t.d. ingen andre prosessar "held varmt" noko delt OS-sidecache som elles ville vore trefte av andre workers sine tilgangar).
  3. Reint praktisk: 23 minutt er kanskje rett og slett ikkje nok tid for FØRSTE fil under `maxWorkers=1` i dette miljøet dersom kvar fil sin jsdom-kaldstart-kostnad multipliserer med den samla 9p-treigheita på ein måte som ikkje skalerer lineært nedover ved redusert samtidigheit — dvs. at éin isolert oppstart kan vere tregare enn 1/14 av ein samtidig 14-fila-oppstart, ikkje same eller raskare, dersom noko av kostnaden er fast per-prosess-oppstart-overhead (container/Node/V8-initialisering) som elles vert amortisert/overlappa på tvers av parallelle workers.

**Konklusjon for Del 3-prioritering:** Kandidat "reduser talet på parallelle jsdom-kaldstartar" (opphavleg rangert høgt etter at kandidat 1 vart avvist) er **IKKJE lenger ein trygg antatt vinnar** — det trengst fleire, meir finmaska diagnostiske eksperiment (t.d. `--maxWorkers=2` eller `4` i staden for den ekstreme `1`, og eit tidsavgrensa forsøk med eksplisitt lågare timeout for å unngå eit nytt 23-minutters hovudlås) før nokon konkret Del 3-tiltak i denne retninga kan foreslåast med tillit. Retry-kandidaten (opphavleg kandidat 4, symptomlindring) ser dermed relativt sett **meir attraktiv på kort sikt** enn før, gitt kor upåliteleg og potensielt kontraproduktivt "berre reduser parallelliteten" viste seg å vere i praksis — men framleis berre som mellombels sikkerheitsnett, ikkje endeleg fiks, per den opphavlege grunngjevinga.

### Diagnostisk eksperiment: `node_modules` på native ext4 i staden for `/mnt/c` — **hovudfunnet i heile Del 2**

**Bakgrunn/kvifor dette vart testa:** brukaren spurde eksplisitt om å evaluere effekten av å installere mest mogleg lokalt/nativt (ikkje via container) i staden for dagens containerbaserte arbeidsflyt. Før noko vart skrive ned som evaluering, vart det testa direkte, av same grunn som resten av Del 2: ikkje gjett, mål.

**Viktig føresetnad, sjekka FØR eksperimentet (ikkje anteke):** podman på denne verten er *rootless podman som køyrer direkte i same WSL2-kjerne* (stadfesta via `mount`-output — inga eiga podman-machine/Hyper-V-VM er involvert). Eit bind-mount (`-v $(pwd):/repo`) er difor berre eit vanleg Linux-bind-mount av ein sti som alt går via 9p — containeren legg **ikkje** til eit ekstra virtualiserings-/monteringslag oppå 9p-treigheita. Det tyder at "unngå containerar" i seg sjølv, isolert, truleg ikkje ville gjeve nokon målbar speedup, sidan sjølve flaskehalsen (les-latens mot filer på `/mnt/c`) er identisk anten ein prosess er containerisert eller ei — **så lenge dei same filene framleis vert lesne frå `/mnt/c`.** Det avgjerande spørsmålet vart difor ikkje "container eller ikkje", men eit meir presist eitt: kva om berre `node_modules` (som dominerer I/O under vitest sine `setup`/`transform`/`environment`-fasar) vert flytta av `/mnt/c`, MEN sjølve kjeldekoden/repoet framleis ligg der (som er eit fast rammevilkår, jf. avklaring punkt 2)?

**Oppsett:** same `podman run`-mønster som baseline, men med to ekstra bind-mount: root-`node_modules` og `packages/core/node_modules` peika til tomme mapper på native ext4 (`/home/ave/nm-experiment/{root-nm,core-nm}`, stadfesta via `mount`/`df` til å vere ekte disk, ikkje `tmpfs`). Sjølve repoet (`-v "$(pwd)":/repo`) var uendra, framleis på `/mnt/c`. Frisk `pnpm install` (dei native mappene var tomme), deretter éin køyring av `pnpm --filter @linkml-editor/core test`.

**Resultat:**

| Fase | Baseline (node_modules på `/mnt/c`) | Native `node_modules` | Endring |
|---|---|---|---|
| `pnpm install` | 228s | 226s | ≈ ingen endring |
| Testkøyring | 191-205s | **14s** | **≈13-14× raskare** |
| Feil (`Timeout waiting for worker to respond`) | 9-10 per køyring, ALLE 5/5 køyringar | **0** | Flaksen forsvann heilt i denne køyringa |
| Testfiler fullførte | 16-19 (resten feila å starte) | **28/28** | Alle filer køyrde, ingen feila å starte |
| `Duration`-breakdown (vitest sin eigen rapport) | `setup 279-372s`, `import 82-111s`, `environment 767-810s` (summert på tvers av samtidige workers) | `setup 12.26s`, `import 51.45s`, `environment 60.08s` | `environment`-fasen (jsdom-oppsett) gjekk frå **~700-800s til 60s** — nøyaktig den fasen flaks-hypotesen alt peika mot |

**Dette er det klaraste og mest eintydige funnet i heile Del 2.** Éin einaste endring — flytt `node_modules` av `/mnt/c`, IKKJE flytt resten av repoet — fjerna flaksen fullstendig og kutta testtida med over ein faktor 13 i denne køyringa. Dette stadfestar direkte hypotesen frå baseline-analysen (systemisk I/O-ressurskontensjon under jsdom-oppstart) og forklarer samtidig KVIFOR `--maxWorkers=1` gjorde ting verre: å redusere samtidigheit hjelper ikkje når sjølve flaskehalsen er *per-fil lese-latens mot ein treg disk*, uavhengig av kor mange filer som les samtidig — det gjer i beste fall ingenting, og i verste fall (som observert) fjernar det evna til å skjule/overlappe latens på tvers av parallelle workers, og gjer alt verre.

**Uventa funn undervegs, med reell konsekvens for korleis eit ekte tiltak må utformast:** sjølv om `node_modules` vart omdirigert, enda ein separat **506 MB** `.pnpm-store`-mappe opp att på `/mnt/c` (rot-nivå, ved sida av det omdirigerte `node_modules`). Truleg forklaring: pnpm sitt innhaldsadresserte lager ("store") og sjølve `node_modules` må liggje på SAME filsystem for at pnpm skal kunne hardlinke pakkefiler mellom dei (hardlinker kan ikkje krysse filsystem). Sidan `node_modules` no var native ext4 og standard-store-plasseringa framleis var på `/mnt/c` (ulike filsystem), måtte pnpm anten kopiere faktisk filinnhald inn i det native `node_modules` (mest sannsynleg forklaring, gitt den dramatiske lesefart-forbetringa) eller på anna vis unngå hardlink-kravet — men i alle tilfelle vart dei 506 MB på `/mnt/c` verdilaus, bortkasta skriving til den trege disken. **Det tyder at eit ekte Del 3-tiltak i denne retninga må omdirigere BÅDE `node_modules` OG pnpm sin store-dir (t.d. via `pnpm config set store-dir` eller `PNPM_HOME`) til native disk, ikkje berre `node_modules` åleine** — elles betaler ein framleis unødvendig skrivekostnad (og potensielt framleis noko lesekostnad, avhengig av kva pnpm faktisk brukte store-mappa til her) mot den trege disken.

**Kva dette betyr for brukaren sitt opphavlege spørsmål ("kva effekt kan det ha å installere mest mogleg lokalt"):**
- **"Unngå containerar" i seg sjølv → truleg liten/inga direkte speedup**, gitt at podman her er native (ikkje ein nøsta VM) — sjølve containerlaget kosta ikkje mykje i desse målingane (container-oppstart er sekund, ikkje minutt; heile kostnaden ligg i I/O mot filene, ikkje i å vere "inni ein container").
- **"Behald filene unna `/mnt/c`" → dramatisk, stadfesta effekt** (13-14× på testtid, flaksen forsvinn heilt) — men dette gjeld spesifikt AVHENGIGE FILER (`node_modules`/pnpm-store), ikkje sjølve kjeldekoden/repoet, som framleis kan liggje på `/mnt/c` som før (kandidat 1 sitt avviste "flytt heile arbeidstreet" var altså unødvendig strengt — ein treng ikkje flytte HEILE repoet for å få mesteparten av gevinsten, berre avhengnadene).
- Eit **nativt Node/pnpm-installasjon på WSL2-verten** (i staden for containerbasert) ville vore éin naturleg måte å implementere "node_modules/pnpm-store på native disk" på i praksis (sidan ein då naturleg ville late `pnpm install` skrive til ein heim-katalog-basert store som alt ligg på ext4) — men det er IKKJE containeriseringa i seg sjølv som gjev gevinsten, det er FILPLASSERINGA. Ein kunne i prinsippet oppnå same gevinst med containerar framleis i bruk, berre ved å alltid bind-mounte `node_modules`/store-dir til ein native-disk-katalog (slik dette eksperimentet gjorde), utan å gje slepp på "mest mogleg i containerar"-prinsippet i det heile.
- Separat, ekte fordel ved eit nativt Node/pnpm-oppsett (uavhengig av I/O-funnet over): det ville fjerne behovet for CLAUDE.md sin noverande obligatoriske "rydd opp `node_modules`/`.pnpm-store` etter kvar økt"-praksis (som eksisterer FORDI dagens containerar er meint som eingongsbruk) — ein persistent lokal installasjon kunne behalde `node_modules` permanent mellom øktar, som i eit heilt vanleg prosjekt, og sleppe unna corepack-versjonspinning-skjørheita som alt er dokumentert i same fil.

**Atterhald (viktig — n=1):** Dette er éin enkelt køyring, ikkje 5× som baseline. Den observerte effekten er stor og mekanistisk godt forklart (samsvarar nøyaktig med "environment"-tidskomponenten i vitest sin eigen rapport, som var akkurat den komponenten flaks-hypotesen peika mot), så det er rimeleg å stole på retninga av funnet — men **talfesta storleik (13-14×, 0 feil) bør stadfestast med minst 3-5 fleire køyringar før dette vert lagt til grunn for eit konkret, godkjent Del 3-tiltak.** Det er òg ikkje testa enno om denne native-`node_modules`-tilnærminga skalerer likt til dei andre pakkane (`web`, `electron`) eller til Playwright E2E-suiten, som har andre avhengnadstre (m.a. nedlasta Chromium-binærfiler, som òg må plasserast native for å unngå tilsvarande I/O-kostnad ved nettlesaroppstart).

**Oppdatert Del 3-prioritering:** Denne kandidaten ("relokér `node_modules` + pnpm store-dir til native disk, behald repoet på `/mnt/c`") er lagt til som **ny kandidat 0** — rangert FØRAN alle dei tidlegare kandidatane, sidan han (a) er den einaste kandidaten med faktisk stadfesta stor effekt i denne runda, (b) er fullt ut kompatibel med det faste rammevilkåret (repoet kan ikkje flyttast), og (c) direkte adresserer rotårsaka (I/O-latens) i staden for å omgå eller dempe henne. Sjå oppdatert liste i "Del 3" under.

**Ope for vidare arbeid (ikkje gjort i denne runda, tidsbruken vart alt stor):** 5× stadfesting av native-`node_modules`-funnet (ikkje berre n=1); tilsvarande test for `packages/web`/Playwright (inkl. Chromium-binærplassering); tilsvarande 5×-baseline-måling for Playwright E2E-suiten generelt (planen sa "full testsuite", og E2E-delen står att). Ingen CI-baserte målingar er heller samla enno (krev faktiske push/PR-ar over tid, kan ikkje simulerast lokalt).

## Del 2b — Kandidat 0 utført: native Node/pnpm-oppsett på WSL2-verten, og påliteleiks-soga

Status: **Godkjent og utført** — brukaren gav eksplisitt "utfør tiltak 0 med nativet node/pnpm-oppsett på WSL2-verten og lag eit script som sjekker at alle prerequisites er tilfredsstilt på klienten." Dette er IKKJE lenger berre eit forslag til vurdering; det er implementert, men resultatet av implementeringa er **delvis** — sjå under for kvifor.

### Kva vart faktisk sett opp på verten

- **Node v22.23.2 og pnpm 9.15.9 installert nativt** via nvm + corepack (ingen `sudo` naudsynt). Dette fungerer stabilt og pålitleg. Ein `pnpm install --frozen-lockfile` UTAN nokon node_modules-relokering tek no **~11-14s nativt**, mot **~226-228s** via containermønsteret dokumentert i CLAUDE.md — sjølv UTAN relokeringsgevinsten er dette ei stor, reell, pålitleg forbetring (fjernar container-cold-start + korepack-reprep-kostnaden kvar gong).
- **pnpm sin globale store-dir peika til native disk** (`~/.local/share/pnpm-store`, stadfesta ext4 via `stat -f`), konfigurert globalt (`pnpm config set store-dir ... --global`).
- **To nye script** (jf. brukaren sin eksplisitte førespurnad):
  - `scripts/setup-native-dev.sh` — installerer/konfigurerer alt over, og prøver deretter å relokere `node_modules` (rot + alle 5 workspace-pakkar: `core`, `docs`, `electron`, `proxy`, `web`) til native disk via relative symlink.
  - `scripts/check-native-dev-requirements.sh` — reint lesande preflight-sjekk (Node-versjon, pnpm-versjon/lockfile-kompatibilitet, filsystemtype for repo og `$HOME`, og eit direkte empirisk symlink-testar-prøve), i same stil som det eksisterande `deploy/web/check-requirements.sh`.

### Påliteleiks-soga for sjølve node_modules-relokeringa (det viktige å forstå)

Dette er IKKJE ei rein suksesshistorie. Rekkefølgja av hendingar, i kronologisk orden:

1. **Fyrste forsøk: absolutt symlink.** `node_modules -> /home/ave/...` (absolutt sti). Feila heilt — `touch`/`cat` gjennom symlinken gav `No such file or directory`, sjølv for grunnleggjande lesing/skriving. Årsak, ikkje fullt stadfesta men sannsynleggjort: drvfs-monteringsopsjonen `symlinkroot=/mnt/` (sjå fakta-punkt 1) tolkar/omskriv truleg absolutte symlink-mål på ein måte som øydelegg mål utanfor `/mnt/`.
2. **Andre forsøk: relativ symlink** (`../../../../../home/ave/...`). Løyste den grunnleggjande lese-/skrivefeilen fullstendig — verifisert med `touch`, `cat`, `mkdir` av ei ny undermappe gjennom symlinken, alle OK.
3. **Full `pnpm install` med relativ symlink + eit "oppvarmings"-steg (`stat`+`ls` rett etter symlink-oppretting): FUNGERTE PERFEKT FØRSTE GONGEN.** Install: 11s. Deretter 5× `pnpm --filter @linkml-editor/core test`: **9,48-13,54s per køyring, 0 feil i alle 5, 28/28 testfiler bestod kvar gong.** Dette var ei FULL, ekte (ikkje container-emulert) stadfesting av det same fenomenet frå det opphavlege container-eksperimentet — endå meir overtydande sidan container-overhead no òg var borte.
4. **Alle påfølgjande forsøk på å køyre AKKURAT DEN SAME oppskrifta feila.** Minst 6 separate forsøk, med denne variasjonen prøvd for å finne rotårsaka — INGEN av dei løyste det:
   - Fjerna og oppretta symlinken heilt på nytt (same relative sti-mønster).
   - Bytte til eit HEILT NYTT, aldri-før-brukt natively mål (utelukkar "forureina" tidlegare tilstand i akkurat den mappa).
   - Fullstendig fersk pnpm store-dir (utelukkar "reused vs downloaded pakkar" som forklaring — testa eksplisitt og feila likevel, umiddelbart, før nokon nedlasting i det heile).
   - Isolert til BERRE éin symlink (rot-nivå, ikkje alle 6 samtidig) — utelukkar samtidig tilgang til fleire symlinkar som årsak.
   - Eksplisitt `sleep 2` mellom symlink-oppretting og install — utelukkar ein enkel tidsbasert cache-innhentingsteori.
   - Attende gjennomgang av `~/.cache/pnpm`/`~/.local/state/pnpm` for stale metadata — ingen openbert relevant tilstand funne.
   
   Feilen var konsekvent den same: `ENOTDIR`/`ENOENT` på pnpm sitt aller fyrste `fs.mkdir(node_modules, {recursive:true})`-kall.
5. **Ein FORVIRRANDE, motstridande observasjon:** ein ISOLERT reproduksjon av akkurat det same mønsteret (symlink som peikar til ei ALT EKSISTERANDE mappe, kryssar frå drvfs til ext4, med same oppvarmingssteg, testa direkte med `node -e "fs.promises.mkdir(...)"`) **lukkast pålitleg 5 av 5 gonger** — SJØLV medan ekte `pnpm install`-forsøk feila konsekvent i same tidsrom med identisk oppsett. Dette provar at det ikkje er symlink-mekanismen generelt som er broten (han fungerer, stadfesta gong på gong i isolasjon) — det er noko SPESIFIKT ved korleis pnpm sin faktiske installasjonsprosess bruker/kryssar denne symlinken (truleg fleire samtidige `fs`-kall, worker-prosessar, eller intern tilstandshandtering i pnpm sjølv) som trigger feilen. Rotårsaka er **ikkje forstått**.
6. **Ein skadeleg sideeffekt oppdaga undervegs:** når `pnpm install` feilar gjennom ein slik symlink, ser det ut til at feilhandteringa i pnpm/Node **tømmer/slettar det native målet** symlinken peika til (stadfesta: ei mappe oppretta med `mkdir -p` rett før, populert med testfiler, var heilt tom rett etter ein feila installasjon) — sjølv om symlinken sjølv framleis eksisterer. Dette gjer at eit blindt "berre prøv igjen" utan å reinsetje/gjenskape den native mål-mappa FØRST, ikkje er trygt.
7. **Avgjerd: slutta å jakte rotårsaka blindt.** Etter minst 8 reelle forsøk (1 suksess, 7 feil) og fleire timars arbeid, vart det vurdert at vidare blind prøving-og-feiling ikkje var eit godt bruk av tid utan djupare WSL2/drvfs/kernel-nivå-verktøy som ikkje er tilgjengelege her. I staden vart begge script omforma til å vere **ærlege om upåliteleiken**:
   - `scripts/setup-native-dev.sh` prøver relokeringa opptil 3 gonger, **verifiserer faktisk innhald** (ikkje berre pnpm sin exit-kode — sjekkar at `node_modules` framleis er ein symlink OG at målmappa faktisk har innhald OG at `node_modules/.bin` finst), og **fell reint attende til ein vanleg, ikkje-relokert installasjon** med ei tydeleg åtvaring dersom relokering ikkje kan stadfestast — han skal ALDRI la repoet stå att i ein øydelagd eller halvferdig tilstand, og ALDRI hevde ein fart-gevinst som ikkje faktisk skjedde.
   - `scripts/check-native-dev-requirements.sh` sin symlink-sjekk vart retta til å teste det EKSAKTE feilmønsteret (mkdir DIREKTE på ein symlink som alt peikar til ei eksisterande mappe, køyrt 3 gonger for å fange inkonsistens) — men inneheld no eit eksplisitt atterhald i koden og i output-teksten: **eit grønt resultat her er IKKJE ein garanti**, gitt at akkurat dette isolerte mønsteret synte seg å lukkast pålitleg SJØLV I PERIODAR DER EKTE `pnpm install` feila konsekvent.
8. **Stadfesta i denne økta at begge script fungerer som designa:** køyrde det retta `setup-native-dev.sh` på nytt (etter å ha fiksa ein reell bug i det fyrste utkastet — `rm -f` feilar stille på ein ekte mappe, «Is a directory», som gjorde at reset-steget ikkje fungerte fyrste gong dette vart testa). Med bugen retta gjorde scriptet 3 ekte relokeringsforsøk (alle feila med same `ENOTDIR`, no totalt 8 feil av 9 reelle forsøk sidan økta starta), og fall deretter **korrekt og reint** attende til ein vanleg installasjon — repoet vart verifisert att i ein fullt fungerande tilstand (`node_modules` reelle mapper, `pnpm --filter @linkml-editor/core test` køyrer og trigga den alt kjende, alt dokumenterte flaksen — ikkje ein ny regresjon).

### Konklusjon: mekanisme stadfesta, automatisering upåliteleg

- **Sjølve mekanismen ("node_modules av `/mnt/c`, behald repoet der") er no stadfesta TO gonger uavhengig** — éin gong via container-bind-mount (Del 2, 1 køyring), éin gong via ekte native symlink (denne seksjonen, 5 fulle testkøyringar) — begge med dramatisk, konsistent forbetring når dei fungerer.
- **Den automatiserte, symlink-baserte implementasjonen på nett DENNE WSL2/drvfs-oppsettet er IKKJE påliteleg** — 1 suksess av 9 reelle forsøk. Rotårsaka er ikkje forstått, og motseiande data (isolert test lukkast konsekvent, ekte pnpm feilar konsekvent) tyder på at feilen sit i eit samspel mellom pnpm sin interne installasjonslogikk og drvfs, ikkje i symlink-mekanismen isolert sett.
- **Native Node/pnpm-installasjonen sjølv (utan relokering) er derimot ei stadfesta, pålitleg, uvilkårleg forbetring** (11-14s vs 226-228s install, ingen containeroverhead) og er verande installert på verten.
- Realistiske vegar vidare for relokeringsdelen spesifikt, status oppdatert etter Del 2c:
  1. Djupare WSL2/drvfs-feilsøking av symlink-feilen spesifikt (t.d. `strace`, eller rapportere som ein mogleg WSL2-feil oppstraums) — ikkje lenger prioritert, sidan kandidat 2 under no er stadfesta som ei fungerande erstatning; symlink-rotårsaka treng ikkje forståast for å kome vidare.
  2. **Ein privilegert `mount --bind` i staden for symlink — TESTA i Del 2c, med eit viktig korrigert premiss: krev IKKJE `sudo`/brukaren sitt passord i det heile.** Sjå Del 2c for full metode og resultat: 5 av 5 uavhengige, ferske forsøk lukkast (mot symlinken sin 1 av 9).
  3. Attende til det ALT STADFESTA pålitelege containerbaserte bind-mount-mønsteret (Del 2 sitt opphavlege eksperiment) for den spesifikke relokeringsgevinsten, medan native Node/pnpm framleis vert brukt for alt anna — no overflødig, sidan kandidat 2 (mount --bind, native, utan container) gjev same eller betre pålitelegheit utan container-overhead.
  4. Berre halde fram med `scripts/setup-native-dev.sh` sin symlink-baserte retry-og-fall-attende-mekanisme som han er — **allereie forbetra av kandidat 2**; sjå Del 2c for tilrådd neste steg (byt `setup-native-dev.sh` sin relokeringsmekanisme frå symlink til `mount --bind`).

## Del 2c — Testa: privilegert `mount --bind` i staden for symlink, med eit korrigert premiss (ikkje faktisk privilegert)

Status: **Gjennomført denne runda, på brukaren sin eksplisitte førespurnad ("oppdater specen med testing av priviligert mount --bind").** Dette er eit diagnostisk eksperiment i same kategori som resten av Del 2 (måling for å informere eit seinare, eksplisitt godkjent Del 3-tiltak) — sjølve KODA (`scripts/setup-native-dev.sh`) er IKKJE endra i denne runda, berre spesifikasjonen, i tråd med CLAUDE.md sitt spesifikasjonsdrevne prinsipp.

### Korrigert premiss: `mount --bind` treng ikkje `sudo` i det heile

Del 2b sin konklusjon antok at `mount --bind` krev root/`sudo` (stadfesta ved å faktisk prøve: `sudo -n true` → `sudo: interactive authentication is required`, og Claude har korkje tilgang til eller skal handtere brukaren sitt passord). Men Linux støttar **unprivilegerte brukar- + mount-namespace** (`unshare --mount --user --map-root-user ...`), som let ein vanleg brukar utføre `mount --bind` **heilt utan `sudo`**, avgrensa til sin eigen private mount-namespace. Stadfesta direkte på denne verten:

```
$ unshare --mount --user --map-root-user echo "unshare works"
unshare works
```

Dette er ikkje ein tryggleiksfeil eller eit hack — det er ein standard, tilsikta Linux-kjernefunksjon (brukt m.a. av rootless podman/Docker sjølv, som alt køyrer på denne verten). Konsekvens: kandidat 2 frå Del 2b ("privilegert mount --bind... ikkje forsøkt") kunne testast fullt ut, utan å involvere brukaren sitt passord i det heile.

### Isolert stadfesting (før noko rørte ved det ekte repoet)

Ein enkel, reversibel test: montér ei ny, tom, native ext4-mappe oppå ei mappe INNI repoet (på 9p/drvfs), skriv gjennom monteringspunktet, stadfest at skrivinga faktisk landar i den native kjeldemappa, og stadfest at monteringa forsvinn att av seg sjølv når prosessen/namespace-et avsluttar (ingen manuell `umount` naudsynt):

```
$ mount | grep mount-bind-test-target
/dev/sdd on .../mount-bind-test-target type ext4 (rw,relatime,discard,errors=remount-ro,data=ordered)
```

Lesing og skriving gjennom monteringspunktet fungerte begge vegar (verifisert med `cat`/`echo >`), og etter at `unshare`-prosessen avslutta var monteringspunktet att ei tom, vanleg mappe på drvfs — inga oppstramming, inga `sudo umount`, ingen risiko for at ei øydelagd/halvvegs montering vart ståande att slik symlink-feilen (Del 2b, punkt 6) kunne gjere med den native måtmappa.

### Ekte eksperiment: `node_modules` + `packages/core/node_modules` bind-mounta til native ext4

**Oppsett:** éin samanhengande `unshare --mount --user --map-root-user bash -c '...'`-prosess (må vere éin prosess/namespace, sidan monteringane berre er synlege i det same namespace-et og undertrea hans) som (1) opprettar tomme mappe-monteringspunkt for `node_modules` og `packages/core/node_modules` på repoet (framleis på drvfs), (2) monterer to tomme native ext4-mapper (`/home/ave/nm-bind-experiment/{root-nm,core-nm}`) oppå desse, (3) køyrer `pnpm install --frozen-lockfile`, (4) køyrer `pnpm --filter @linkml-editor/core test`. Ingen endring av `pnpm config store-dir`, som alt peika til native disk frå Del 2b.

**Resultat — 5 uavhengige, FERSKE forsøk** (kvar med nye, tomme native mål-mapper og ei ny `unshare`-økt, for å teste akkurat den same "kald start"-situasjonen som fekk symlinken til å feile 8 av 9 gonger):

| Forsøk | `pnpm install` | Test-resultat |
|---|---|---|
| 1 (fullt, 5× testkøyring i same økt) | 4s | **5/5 testkøyringar: 0 feil, 693/693 testar bestod kvar gong, 9-11s per køyring** |
| A | 4s, exit=0 | (install-nivå verifisert) |
| B | 3s, exit=0 | (install-nivå verifisert) |
| C | 3s, exit=0 | (install-nivå verifisert) |
| D | 4s, exit=0, deretter re-montert og full testkøyring: **693/693 testar bestod, 0 feil, 10,18s** | |

**5 av 5 uavhengige, ferske forsøk lukkast — 0 feil.** Dette står i skarp kontrast til symlink-metoden i Del 2b (1 suksess av 9 reelle forsøk, same type "kald start"-scenario). To av dei fem forsøka (1 og D) vart følgt heilt gjennom ein full testkøyring (ikkje berre `pnpm install`) med identisk, feilfritt resultat som den EINE gongen symlinken lukkast — installasjonstida var attpåtil raskare (2-4s mot 11s for symlinken, sannsynlegvis fordi pnpm sin store-cache alt var varm frå tidlegare forsøk i denne runda).

**Falskt alarmsignal, retta før konklusjon (viktig metodisk poeng):** eit fyrste forsøk på å verifisere forsøk C/D sjekka `node_modules/.bin/vitest` (rot-nivå) og fann han manglande — men dette var ein feil i VERIFIKASJONEN, ikkje eit reelt problem: `vitest` er ein `devDependency` av `@linkml-editor/core` spesifikt, så pnpm plasserer `.bin/vitest`-symlinken korrekt i `packages/core/node_modules/.bin/`, ikkje i rot-`node_modules/.bin/`. Ein faktisk testkøyring (ikkje berre ein binærfil-sjekk) stadfesta at alt fungerte. Dette er sjølv eit døme på CLAUDE.md sitt "verifiser empirisk, ikkje anta"-prinsipp — å stole på feil verifikasjonslogikk kunne ha ført til ei falsk "kandidat 2 feila òg"-konklusjon.

### Oppdatert samanlikning: symlink vs. `mount --bind`

| | Symlink (Del 2b) | `mount --bind` via unprivilegert namespace (Del 2c) |
|---|---|---|
| Krev `sudo`/passord | Nei (men trudd å vere naudsynt for bind-mount-alternativet — feilaktig premiss, no retta) | **Nei** — unprivilegerte user+mount-namespace |
| Pålitelegheit, ferske forsøk | 1 suksess av 9 | **5 suksess av 5** |
| Oppstramming ved feil | Kan tømme den native mål-mappa som sideeffekt (Del 2b, punkt 6) — treng eksplisitt reset-logikk | Automatisk — monteringa forsvinn heilt av seg sjølv når prosessen/namespace-et avsluttar, uansett om noko inni feila |
| Kva slags mekanisme | Filsystem-drivar-tolka symlink-oppslag (drvfs-spesifikk oppførsel, ikkje fullt forstått) | Ekte kjernenivå VFS-mount (same mekanisme rootless podman sjølv brukar) |
| Krev at monteringa held seg i live på tvers av separate shell-kall | Nei (symlinken er ein permanent filsystem-entitet) | **Ja** — mount+install+test må skje i éin samanhengande `unshare`-prosess/skript, sidan monteringa berre er synleg i det namespace-et. Dette er ei reell arkitektonisk avgrensing for korleis `scripts/setup-native-dev.sh` må omformast (kan ikkje berre "montere og gå vidare" som eit separat steg slik symlink-oppretting kunne). |

### Tilråding — GODKJENT og IMPLEMENTERT (denne runda)

Brukaren fekk spørsmål om kva av tre konkrete scope-alternativ (sjå under), og valde det snevraste: **berre `.githooks/pre-push`, ikkje `scripts/setup-native-dev.sh` sin interaktive dagleg-bruk-mekanisme.** Grunngjeving for valet: `pre-push` er allereie éin samanhengande skript-invokasjon (ikkje ei interaktiv fleire-terminal-økt), så avgrensinga "monteringa må halde seg i live i éin `unshare`-prosess" (tabellen over) er eit ikkje-problem akkurat der — og det er samstundes staden der flaksen/treigheita faktisk kostar mest (kvar einaste push).

**Alternativ som vart vurdert og valt bort:**
1. Persistent interaktiv dev-skal (`scripts/native-dev-shell.sh`) som pakkar inn HEILE utviklingsøkta — større endring av kvardagsarbeidsflyten, valt bort.
2. Berre `.githooks/pre-push`, ingen nye filer, ingen endring av `setup-native-dev.sh` — **valt.**
3. (Same som 2, men opna for eit separat "køyr testar pålitelig"-hjelpeskript) — ikkje naudsynt, `pre-push` sjølv dekkjer behovet.

**Implementert i `.githooks/pre-push`:**
- Sjekkar per node_modules-sti (rot, `packages/core`, `packages/web`) om han alt er ein symlink (frå `setup-native-dev.sh` sin separate, interaktive relokering) — i så fall vert han IKKJE rørt, ingen bind-mount. Berre stiar som framleis er vanlege mapper får bind-mount-behandling. Dette gjer at dei to mekanismane (symlink for dagleg interaktiv bruk, mount --bind for pre-push) kan eksistere side om side utan å forstyrre kvarandre.
- Når minst éin sti treng bind-mount OG `unshare --mount --user --map-root-user` faktisk fungerer på verten (begge sjekka eksplisitt, med fallback til vanleg køyring elles): heile `pnpm install --frozen-lockfile` + unit- + E2E-testkøyringa skjer INNI éin samanhengande `unshare`-prosess, med native ext4-mål under `~/.cache/linkml-editor-pre-push-nm/`.
- **Sidefiks, oppdaga medan denne fila vart lesen for å planleggje endringa:** den committa hooken kalla `pnpm --filter @linkml-editor/core test --run` — stadfesta empirisk (før denne endringa) å faktisk FEILE med `ERROR Unknown option: 'run'`, sidan `test`-scriptet i `packages/core/package.json` allereie er `vitest run` (ein ekstra bar `--run` vert då tolka som eit pnpm-nivå-flagg, ikkje vidaresendt). Det tyder **kvar einaste `git push` ville ha feila øyeblikkeleg** med denne feilen, før noka reell testkøyring i det heile — ein reell, aktiv regresjon i den ukommitta test-timing-instrumenteringa frå tidlegare i denne spesifikasjonen. Retta ved å fjerne det overflødige `--run`-flagget (scriptet gjer det alt).

**Testa (køyrde heile hooken direkte, `bash .githooks/pre-push`, ikkje via ein ekte `git push`):**
- Symlink-ekskludering: stadfesta isolert at ein sti som faktisk ER ein symlink vert korrekt utelaten frå `NEEDS_BIND`-lista.
- Full køyring frå reint utgangspunkt (ingen `node_modules` i det heile): `pnpm install` 3s, unit-testkøyringa 9s med **0 "Timeout waiting for worker to respond"-feil, 28/28 testfiler, 693/693 testar bestod** — matchar Del 2c sine tal nøyaktig, no verifisert gjennom den faktiske hooken, ikkje berre eit isolert eksperiment. `scripts/time-cmd.sh` sin timing-logg fanga alle tre stega korrekt (`pre-push-install`, `pre-push-unit`, `pre-push-e2e`) med rett varigheit og exit-kode.
- **E2E-steget feila** — men av ein grunn som IKKJE har med denne endringa å gjere: Playwright sine nedlasta Chromium-binærfilar finst ikkje på denne native verten (`Executable doesn't exist at .../chrome-headless-shell`). Dette er eit kjent, ope hol frå Del 2b (native Node/pnpm vart sett opp, men `pnpm exec playwright install` vart aldri køyrt) — ikkje noko denne runda skal fikse stille, sidan det er ei separat, potensielt stor nedlasting som brukaren bør be om eksplisitt. Sjølve hook-logikken (feilpropagering, exit-kode, timing-logging) fungerte korrekt: E2E-feilen vart fanga, logga med `exit=1`, og heile hooken feila synleg (som han skal, for å blokkere ein push med reelle E2E-feil) i staden for å feile stille eller halde fram.

**Ope for vidare arbeid, oppdatert:** `pnpm exec playwright install chromium` vart faktisk køyrt på brukaren sin eksplisitte førespurnad (nedlasta Chromium 149/chrome-headless-shell/FFmpeg til `~/.cache/ms-playwright`, ~295 MB totalt). Ein full re-køyring av `.githooks/pre-push` synte då at nedlastinga i seg sjølv IKKJE var nok — ein NY, separat blokkering dukka opp.

### To sudo-kommandoar identifisert i denne runda (ingen av dei utførte av Claude — krev brukaren sitt eige passord)

1. **Frå Del 2c/tilrådinga (attende referert):** `unshare --mount --user --map-root-user` treng IKKJE `sudo` i det heile — dette var nettopp poenget med heile Del 2c-funnet. Inga sudo-kommando naudsynt for sjølve node_modules-relokeringa i `pre-push`.
2. **NY, denne runda: manglande system-delte bibliotek for headless Chromium.** Etter at Chromium vart lasta ned, feila E2E-testane med `error while loading shared libraries: libnspr4.so: cannot open shared object file`. `ldd` mot den nedlasta `chrome-headless-shell`-binærfila synte **4 manglande `.so`-filer**: `libnspr4.so`, `libnss3.so`, `libnssutil3.so`, `libasound.so.2`. Stadfesta (utan sudo, via `apt-cache policy` + `apt-get download`/`dpkg -c`, som ikkje krev root) kva Ubuntu-pakkar som faktisk gir desse filene på denne verten (Ubuntu 26.04 "Resolute Raccoon"):
   - `libnspr4` → `libnspr4.so`
   - `libnss3` → BÅDE `libnss3.so` OG `libnssutil3.so` (bunta saman i éin pakke, ikkje to)
   - `libasound2t64` → `libasound.so.2` (merk: **ikkje** `libasound2` — den pakken finst ikkje på denne Ubuntu-versjonen, `t64`-transisjonspakken er den rette)

   **Kommandoen brukaren må køyre:**
   ```
   sudo apt-get update && sudo apt-get install -y libnspr4 libnss3 libasound2t64
   ```
   Dette er det playwright sin eigen `playwright install --with-deps` ville gjort automatisk (han krev òg sudo internt) — men sidan Claude korkje har eller skal handtere brukaren sitt passord, må kommandoen køyrast av brukaren direkte, anten via `playwright install-deps chromium` eller den eksplisitte `apt-get`-linja over (verifisert å gje identisk resultat, sidan begge til sjuande og sist berre installerer desse tre pakkane).

`scripts/check-native-dev-requirements.sh` er oppdatert med ein ny, dedikert sjekk (`check_playwright_system_deps`) som oppdagar akkurat denne mangelen via `dpkg -s` og skriv ut nøyaktig kommandoen over som `fix`-forslag — stadfesta å fungere (feila korrekt med denne meldinga på denne verten, før pakkane er installerte).

**Status: brukaren køyrde `sudo apt-get install -y libnspr4 libnss3 libasound2t64` sjølv, stadfesta installert (`dpkg -s`, alle tre), og `scripts/check-native-dev-requirements.sh` går no fullstendig grønt.**

**Full re-køyring av `bash .githooks/pre-push` (framleis frå reint utgangspunkt, ikkje via ein ekte `git push`):**

| Steg | Resultat |
|---|---|
| `pnpm install` | 4s, exit=0 |
| Unit-testar (`@linkml-editor/core`) | 10s, exit=0, **0 flake-feil, 693/693 testar bestod, 28/28 filer** |
| E2E-testar (`@linkml-editor/web`) | 169s (2,8 min), exit=1, **4 av 7 testar bestod** |

**Node_modules-relokeringa (Del 2c sin hovudfunn) og Chromium-infrastrukturen (nedlasting + system-bibliotek) er no BÅDE fullt verifiserte** — nettlesaren startar, koplar til dev-serveren, og køyrer faktiske testar. Dette er den fyrste gongen E2E-suiten i det heile har køyrt til fullføring på denne native verten (tidlegare stega feila anten på manglande binærfil eller manglande delte bibliotek, aldri kome så langt som til å faktisk teste applikasjonen).

**Dei 3 attverande feila er IKKJE infrastruktur-/miljøfeil — dei er feil PÅ TESTNIVÅ, urelaterte til denne spesifikasjonen sitt tema (timing/pålitelegheit av testKØYRINGA, ikkje korrektheita til sjølve testane):**
- `golden-path.spec.ts` og `new-project.spec.ts`: begge feilar på det same mønsteret — eit klikk på `#lme-canvas-add-class` vert gjentekne gonger avbrote fordi eit `<div>Rendering</div>`-overlay "intercepts pointer events" (Playwright sin eigen auto-retry prøvde i opptil ~500ms-intervall, gav til slutt opp).
- `view-layout-bleed.spec.ts`: ei simulert dra-handling flytta ikkje noden så mykje som venta (`expect(...).toBeGreaterThan(50)`, fekk 0).

Dette **kan** vere ekte, fortente E2E-testfeil (fortener eiga feilsøking), eller det kan vere at denne native verten sin fyrste nokosinne E2E-køyring rett og slett har annleis timing-karakteristikk enn kva desse testane vart opphavleg verifiserte mot (t.d. ein tregare fyrste-gongs Vite-kaldstart som gjer at "Rendering"-overlayen står lenger oppe enn testen sitt implisitte tidsvindauge tillet). **Ingen av desse er utforska vidare i denne runda** — dei ligg utanfor denne spesifikasjonen sitt mandat (timing-instrumentering + pålitelegheit av SJØLVE testkøyringa, ikkje korrektheita til individuelle E2E-testar) og krev eit separat, eksplisitt brukarval om å prioritere.

**Korrigering (frå Del 2d under):** hypotesen over om "fyrste-gongs Vite-kaldstart" som forklaring på DEI 3 TESTFEILA held ikkje — Del 2d stadfesta at sjølve suitetida ELLES vart 5× raskare på seinare, varme køyringar (169s → 32-37s), men **nøyaktig dei same 3 testane feila på nøyaktig same måte** på både den kalde og dei varme køyringane. Kaldstart-timing forklarer altså ikkje testfeila sjølv om han forklarer mykje av totaltida — dei 3 feila ser ut til å vere ekte, konsistente testfeil (eller eit ekte, konsistent miljøavvik), ikkje eit engongs-timing-slumpetreff.

**Konklusjon: Del 2c sin `mount --bind`-tilråding er no 100 % implementert og verifisert for BÅDE unit- og E2E-delen av `pre-push`, inkludert heile kjeda av tidlegare ukjende blokkeringar (manglande browser-binærfil → manglande system-bibliotek → no faktisk fungerande).** Dei 3 gjenverande E2E-testfeila er ei separat sak.

## Del 2d — Evaluering: kan vi auke parallellisering for å spare klokketid?

Status: **Evaluert empirisk denne runda, på brukaren sin eksplisitte førespurnad ("evaluer om vi no kan øke parallelisering... slik at vi kan spare klokketid både på full test suite og pre-commit hooken"). Reint diagnostisk — ingen kodeendring gjort, berre målingar og ei tilråding.** Konteksten som gjer dette spørsmålet verdt å stille no: Del 2/2b/2c sin resonnering rundt parallellisering (t.d. `--maxWorkers=1`-eksperimentet i Del 2, som gjorde ting mykje verre) galdt eit heilt anna scenario — `node_modules` på treg `/mnt/c`-disk, der FLASKEHALSEN VAR I/O-ventetid. No som `node_modules` kan relokerast til native disk (Del 2c), er det ikkje lenger gitt at same konklusjon gjeld — flaskehalsen kan ha flytta seg til noko anna (CPU-bunde testkøyring), der parallellisering kan verke heilt annleis.

**Tre separate spørsmål vart evaluerte, kvar med sin eigen konklusjon:**

### 1. Vitest sin EIGEN arbeidar-/pool-konfigurasjon for `packages/core` (28 testfiler) — svar: NEI, ikkje rør han

Testa `npx vitest run` (ingen flagg, vitest sin eigen auto-deteksjon) mot eksplisitte `--maxWorkers=2/4/8/14/20` og `--pool=threads`, alle på native bind-mounta `node_modules` (14 CPU-kjernar, 27 GB RAM tilgjengeleg på denne verten). Kvar variant køyrd minst 2×, i tillegg ein eigen kontrollrunde der standard vart køyrd BÅDE fyrst og sist (for å utelukke ein rekkjefølgje-/oppvarmingseffekt):

| Variant | Varigheit (fleire målingar) |
|---|---|
| **Standard (ingen flagg)** | **8,7s / 8,9s / 9,9s** (fyrst) — **10,4s / 10,4s / 10,8s** (sist, etter alle andre variantar) |
| `--maxWorkers=2` | 17,3s / 17,4s |
| `--maxWorkers=4` | 12,4s / 17,5s — og 12,8s / 13,0s ved re-sjekk |
| `--maxWorkers=8` | 16,2s / 13,5s |
| `--maxWorkers=14` (= talet på kjernar) | 13,4s / 12,9s |
| `--maxWorkers=20` (over talet på kjernar) | 14,8s / 13,2s |
| `--pool=threads` (standard workers) | 12,6s / 12,7s |

**Eintydig resultat: STANDARD (ingen manuell overstyring) er raskast i KVART EINASTE forsøk** — typisk 8,7-10,8s mot 12,4-17,5s for alle manuelle alternativ (25-70 % tregare). Dette gjeld sjølv når standard vert køyrd SIST (etter at systemet alt har vore under last frå dei andre testane), så det er ikkje ein rein oppvarmings-/rekkjefølgje-artefakt. **Tilråding: ikkje set `--maxWorkers` eller `--pool` manuelt nokon stad i repoet.** Vitest sin eigen auto-deteksjon (som mest truleg tek omsyn til fleire faktorar enn berre kjernetal — t.d. faktisk filtal, minnebruk, eller dynamisk lastbalansering — på ein måte ein fast tal ikkje kan) er alt betre tilpassa denne verten enn noko av dei manuelle verdiane som vart prøvde.

### 2. Tvers-pakke-parallellisering (`pnpm -r test` standard vs. `pnpm -r --parallel test`) — svar: NEI, inga målbar skilnad

3 av 6 pakkar har eit `test`-script (`core`: 28 filer, `electron`: 1 fil, `web` unit: 4 filer). Testa standard `pnpm -r test` (respekterer topologisk rekkjefølgje + ein implisitt samstundes-grense) mot `pnpm -r --parallel test` (ignorerer heilt rekkjefølgje/grense), 3× kvar, alle med native bind-mounta `node_modules` for alle pakkane:

| Variant | Varigheit |
|---|---|
| `pnpm -r test` (standard) | 11s / 11s / 11s |
| `pnpm -r --parallel test` | 11s / 12s / 12s |

**Ingen reell skilnad.** Forklaring, stadfesta ved å sjå på per-pakke-varigheit inni same køyring: `core` (8,4-10,3s) dominerer TOTALT — `electron` (0,3-0,6s) og `web` unit (1,4-3,7s) er nærmast neglisjerbare i samanlikning (til saman under 10 % av totaltida). Sjølv om dei to små pakkane vart perfekt overlappa med `core`, ville det spart under eitt sekund. **Tilråding: ikkje bry deg med `--parallel` for `pnpm -r test` — flaskehalsen er heilt inni `core` sin eigen suite, ikkje i korleis pakkane vert orkestrerte seg imellom.**

### 3. `pre-push`: unit- og E2E-testar samstundes i staden for sekvensielt — svar: JA, moderat gevinst (~14 %), MEN eit viktig sideoppdaga funn er MYKJE større

**Sideoppdaga funn, viktigare enn sjølve parallelliserings-spørsmålet:** E2E-suiten sin varigheit synte seg å vere DRAMATISK avhengig av om det er fyrste eller seinare gong ho køyrer mot eit gitt sett med native `node_modules` — **169s (2,8 min) fyrste gong, 32-37s alle seinare gongar, målt fleire gonger** — ein faktor på nesten 5×. Dette er nesten heilt sikkert kostnaden ved Vite sin dependency-pre-bundling-cache (`node_modules/.vite`) som vert bygd frå botnen fyrste gong, men ligg VARM og gjenbrukbar i den native `node_modules`-mappa etterpå. Sidan `.githooks/pre-push` (Del 2c) alt brukar EIN FAST, VEDVARANDE native mål-katalog (`~/.cache/linkml-editor-pre-push-nm/`, ikkje sletta mellom push-ar), får ein ekte brukar denne 5×-gevinsten **automatisk og gratis** frå og med andre push — utan at noko meir treng byggjast. Dette einskilde funnet er eit mykje større klokketid-sparande tiltak enn nokon av parallelliserings-spørsmåla under, og krev ingen implementering — han er alt der, ein konsekvens av korleis Del 2c vart bygd.

**Sjølve parallelliserings-spørsmålet, målt med varme cachar (etter at kaldstart-kostnaden over var betalt), for å unngå å blande dei to effektane:**

| Variant | Varigheit |
|---|---|
| E2E åleine (sekvensielt etter unit, ikkje målt her — unit tek 10-11s frå del 1 over) | ~32-33s |
| E2E + unit SAMSTUNDES (bakgrunnsjobbar, byrja likt) | **37s totalt** (2× målt, begge 37s) |

Sekvensielt ville vore ~32s (e2e) + ~10s (unit) = **~42-43s**. Samstundes gav **37s** — ei ekte, men moderat, spart tid på **~5-6s (~13-14 %)**, ikkje dei naivt venta ~10s. Grunnen til skilnaden: E2E sjølv vart MÅLBART tregare når han delte CPU med den samstundes unit-testkøyringa (32-33s åleine → tilsvarande ~37s når han deler ressursar med unit-suiten, sjølv om unit-suiten sjølv er ferdig etter berre 10-11s av dei 37) — ei ekte, om enn liten, ressurskonkurranse, ikkje gratis parallellisme. Dette er konsistent med funn 1 over: å presse fleire samstundes CPU-tunge prosessar på denne verten har ein reell, om lita, kostnad, ikkje null.

**Tilråding (forslag, IKKJE implementert):** verdt å implementere i `.githooks/pre-push` (start unit- og E2E-steget som to bakgrunnsjobbar i staden for sekvensielt, `wait` på begge), men er ei moderat, ikkje dramatisk, forbetring (~5-6s av eit no typisk ~40-50s totalt pre-push-løp) mot noko meir skriptkompleksitet (to samstundes `scripts/time-cmd.sh`-kall, host-prosesskoordinering, at feil frå BEGGE prosessane må fangast og rapporterast tydeleg i staden for at éin feil stoppar den andre tidleg). Gitt at Del 2c sin varm-cache-oppdaging over alt sparer mykje meir (169s → 32s) heilt utan denne endringa, er den relative verdien av å i tillegg leggje til samstundes køyring mindre enn han såg ut før dette vart målt.

**Samla konklusjon for Del 2d:** Svaret på "kan vi auke parallellisering" er **stort sett NEI** for dei to spørsmåla brukaren opphavleg lurte mest på (vitest sin eigen arbeidarkonfigurasjon, tvers-pakke-orkestrering) — begge er alt nær sitt optimum, og å røre dei manuelt gjer ting VERRE, ikkje betre. Den eine staden med ei reell, om moderat, gevinst (pre-push sin unit+E2E-sekvens) er mindre viktig enn det store, allereie-eksisterande varm-cache-funnet som gjer E2E 5× raskare frå og med andre push, heilt uavhengig av parallellisering.

## Del 3 — Kandidatar til effektiviseringstiltak (IKKJE godkjende — til vurdering)

Ranger etter venta gevinst basert på fakta over, men **ingen av desse skal implementerast utan eksplisitt, punktvis godkjenning** — jf. CLAUDE.md: godkjenning av "forslaget" som heilskap dekker ikkje automatisk kvart enkelttiltak.

**Kandidat "flytt arbeidstreet av 9p-bind-mounten" er avvist av brukaren (avklaring, punkt 2 under) og difor teken ut av lista.** Det er dermed eit fast rammevilkår at 9p-bind-mount-I/O-treigheita (fakta-punkt 1) IKKJE kan fjernast — han må handterast/dempast, ikkje elimineres. Dette flyttar tyngdepunktet i ranginga mot tiltak som reduserer *eksponering* for treig I/O (kandidat 2-3 under) framfor tiltak som fjernar I/O-kjelda.

**Oppdatert etter Del 2-resultat (runde 1):** kandidaten under om å redusere parallelliteten er no **nedgradert frå "høgast prioritet" til "treng meir finmaska diagnose før han kan foreslåast"**. Det faktiske eksperimentet (`--maxWorkers=1`) gjorde ikkje flaksen betre — han produserte i staden ein 23+ minutts hengetilstand utan at éin einaste testfil vart ferdig, eit klårt verre utfall enn baseline (5/5 køyringar feila, men var ferdige på ~200s kvar). Sjå "Del 2 — Resultat" for detaljar. Dette er nøyaktig grunnen til at Del 3 krev eksplisitt godkjenning PER TILTAK, ikkje berre for planen som heilskap: den intuitivt mest opplagde fiksen synte seg å vere feil retning når han faktisk vart testa.

**Oppdatert etter Del 2-resultat (runde 2 — native `node_modules`):** ein NY kandidat (0) er lagt til øvst, basert på det klaraste funnet i heile Del 2 — sjå "Diagnostisk eksperiment: `node_modules` på native ext4" over. Han er ranger føre alle dei andre fordi han er den einaste som faktisk synte stor, målt effekt (13-14× på testtid, flaksen borte) i staden for berre teoretisert effekt.

0. **(UTFØRT, no med ein STADFESTA pålitleg relokeringsmekanisme klar til implementering — sjå "Del 2b"/"Del 2c") Relokér `node_modules` (og pnpm sin store-dir) til native ext4-disk, behald sjølve repoet på `/mnt/c`.** Godkjent eksplisitt av brukaren ("utfør tiltak 0 med nativet node/pnpm-oppsett på WSL2-verten") og implementert via `scripts/setup-native-dev.sh` + `scripts/check-native-dev-requirements.sh`. Native Node/pnpm-installasjonen sjølv (utan relokering) ER pålitleg og gir ei stadfesta, uvilkårleg forbetring (11-14s vs 226-228s install) og er verande installert. **Symlink-relokeringa som faktisk ligg i `setup-native-dev.sh` i dag er UPÅLITELEG** (1 suksess av 9 reelle forsøk, rotårsak ikkje forstått) og prøver 3× med ekte verifikasjon før han fell reint attende. **Del 2c testa erstattinga (`mount --bind` via unprivilegert `unshare`-namespace, ingen `sudo` naudsynt) og fekk 5 av 5 uavhengige, ferske forsøk til å lukkast** — klart meir pålitleg enn symlinken, men **ikkje enno bygd inn i `setup-native-dev.sh`** (krev eit script-design som held mount+install+test i éin samanhengande namespace-økt, sjå Del 2c "Tilråding" for detaljar og kvifor dette ikkje er eit trivielt copy-paste-byte). Å faktisk byte ut mekanismen i scriptet er difor eit separat, ikkje-godkjent Del 3-deltiltak.
1. **(Høg gevinst, container-arbeid, delvis overlappande med kandidat 0 — same underliggjande innsikt, snevrare tiltak) Persistent pnpm-store-volum for containerkall**, i staden for ein fersk in-container store kvar gong — monter ein namngitt podman-volum for `.pnpm-store` mellom køyringar, slik at berre FØRSTE `pnpm install` betaler full kaldstart-kostnad. Gjeld like mykje for `pre-push` som for manuelle containerkall, sidan begge no er stadfesta å bruke same containermetode (fakta-punkt 4). Del 2 stadfesta at install åleine tek 228s — eit reelt, stort tal å spare på kvar gjentekne køyring.
2. **(Nedgradert — treng vidare diagnose, ikkje ein trygg antatt vinnar) Juster talet på parallelle jsdom-kaldstartar** — det VART testa (`--maxWorkers=1`), og resultatet var eit 23+ minutts hovudlås utan eitt ferdig testfil, ikkje ein forbetring. Før dette kan foreslåast som eit konkret tiltak, trengst finmaska oppfølging (t.d. `--maxWorkers=2` eller `4` med ein eksplisitt kortare timeout for å unngå eit nytt langvarig hovudlås) — sjå "Del 2 — Resultat" for dei tre ikkje-stadfesta hypotesane om kvifor serialisering gjekk gale.
3. **(Moderat gevinst, men same atterhald som kandidat 2) Utvid `environmentMatchGlobs`** i `packages/core/vitest.config.ts` til fleire reint-logiske testfilbaner enn berre `src/io/**`, basert på faktiske data frå Del 2 om kva filer faktisk trigga jsdom-relatert treigheit/flaks. Del 2 fann derimot at éin av dei 17 råka filene (`round-trip.test.ts`) alt køyrer i `node`-miljø (ikkje jsdom) og likevel feila éin gong — dette nyanserer kor stor gevinst denne kandidaten realistisk kan gje, sidan ikkje alt av feila nødvendigvis er jsdom-spesifikke.
4. **(No relativt sett meir attraktivt på kort sikt, framleis berre symptomlindring — ikkje rotårsak) Legg til `retry`** for vitest (tilsvarande Playwright sin alt eksisterande `retries: process.env.CI ? 2 : 0`), avgrensa til CI eller til den containerbaserte lokale køyringa. Dette fjernar IKKJE random-feila, det skjuler dei — men gitt at kandidat 2/3 synte seg meir usikre enn venta i praksis, er dette no det tiltaket med høgast venta gevinst-per-innsats på kort sikt, sjølv om det aldri bør vere sluttpunktet, jf. brukaren sitt eksplisitte krav om å faktisk **fjerne** feila.
5. **(Strukturelt, berre CI) Splitt CI-jobben** (`test.yml`) i parallelle jobbar (t.d. `lint+unit` og `e2e` som separate jobbar) i staden for sekvensielt i éin jobb — reduserer klokketid i CI spesifikt (ikkje lokalt), på bekostning av duplisert oppsett-overhead (delvis dempa av eksisterande cache).
6. **(Strukturelt, berre CI) Cache vitest/Vite sin transform-cache** mellom CI-køyringar (tilsvarande den alt eksisterande pnpm-store- og Playwright-browser-cachen), sidan dette per no ikkje er cacha (fakta-punkt 4).
7. **(Openbert, men eksplisitt nemnt for fullstende) Vurder om `pre-push` verkeleg treng full E2E-suite på kvar push**, eller om ein mindre delmengd lokalt + full suite i CI (som alt køyrer) er nok — dette er ei prosessendring med direkte konsekvens for CLAUDE.md sitt "Development Workflow"-avsnitt, og må difor drøftast eksplisitt med brukaren, ikkje avgjerast stille. No meir relevant enn før, sidan avklaring punkt 1 stadfestar at `pre-push` betaler full container-cold-start-kostnad ved KVAR push.

## Opne spørsmål — avklara

1. **Køyrer `pre-push` via WSL2-host-Node eller via container?** → **Via same containermetode som er dokumentert og brukt i denne økta** (verten har ikkje Node/pnpm). Innarbeidd i fakta-punkt 4 og kandidat 1/7 over.
2. **Er det aktuelt å flytte arbeidstreet vekk frå `/mnt/c/...`?** → **Nei.** Fast rammevilkår. Kandidaten er teken ut av Del 3 (sjå merknad over); alle gjenverande tiltak må fungere GITT at 9p-bind-mount-I/O-treigheita er permanent til stades.
3. **Skal Del 1-instrumenteringa rullast ut samla eller stykkevis?** → **Samla.** 1a-1e implementerast som éin bolk når/viss Del 1 vert godkjend, ikkje éin del om gongen.

## Rulleplan (foreslått rekkefølgje, gitt godkjenning)

1. Del 1 (instrumentering, 1a-1e samla — jf. avklaring punkt 3) — reint tillegg, ingen åtferdsendring.
2. Del 2 (datainnsamling) — ingen kodeendring, berre gjentekne køyringar + tabellføring.
3. Del 3 — vel 1-2 tiltak basert på FAKTISKE tal frå Del 2, ikkje frå ranking-lista over åleine (ranginga over er ei kvalifisert hypotese, oppdatert med det no faste rammevilkåret frå avklaring punkt 2, men framleis ikkje ein ferdig konklusjon).
