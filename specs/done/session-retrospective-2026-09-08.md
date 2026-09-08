# Sesjonsgjennomgang: feil og uventa utfall (2026-09-07 → 2026-09-08)

Status: Ferdig. Skriven som del av innføringa av "Errors and Unexpected Outcomes"-instruksen i `CLAUDE.md` — denne fila er sjølve fyrste gjennomføringa av instruksen, brukt på økta som førte til at instruksen vart skriven.
Dato: 2026-09-08

## Kva vart lagt til i CLAUDE.md

1. **Ny seksjon "Errors and Unexpected Outcomes"** — det generelle påbodet brukaren bad om: kvart avvik/feil skal utløyse ei vurdering av om `CLAUDE.md` treng ei presisering, eller om ein skill/hook kan hindre klassen av feil heilt.
2. **To konkrete, tidlegare uskrivne miljøfakta** flytta inn i "When the host has no Node/pnpm"-seksjonen (som alt fanst frå tidlegare i same økt):
   - Opprydding etter container-basert `pnpm install` er obligatorisk (`node_modules`/`.pnpm-store` hamnar på verten via bind-mount) — direkte årsak til eit reelt hendingar nedanfor (#7).
   - Den ikkje-deterministiske vitest-jsdom-worker-timeout-flaksen (~60s) i denne typen container, med den fungerande arbeidsrunda (`--environment node`).
3. **Éin generell leksjon skriven eksplisitt ut:** verifiser konfigurasjon empirisk, ikkje berre ved å lese koden — direkte utløyst av hending #12 nedanfor, den mest kostbare feilen i heile økta.

## Hendingar gjennomgått, kronologisk

For kvar hending: kva skjedde → rotårsak → var det alt retta i koden? → kravde det ei prosess-/dokumentasjonsendring, og vart den gjort?

### 1. Feil i mine eigne `promote-release`/`start-feature`-skills, funne ved å teste mot ein ekte issue
**Kva:** `promote-release` visste ikkje at `packages/proxy` skal haldast utanfor lockstep-versjonering. Ingen av skilla handterte manglande `dev`-branch (rå git-feil i staden for ei forklaring).
**Rotårsak:** skreiv skilla frå å lese `CLAUDE.md`-teksten, testa dei aldri mot verkeleg repo-tilstand før dette.
**Retta i koden:** ja, same økt.
**Prosessendring:** ingen ny CLAUDE.md-regel vart skriven den gongen — burde kanskje ha vore, men er no dekt implisitt av den nye generelle instruksen (skriv/endra ein skill → test han mot ekte tilstand → oppdater skillet sjølv viss han feilar, som alt vart gjort).

### 2. `check-requirements.sh` føreslo berre `pipx`/`pip` for `podman-compose`, sjølv om verten hadde ein dedikert apt-pakke
**Rotårsak:** skreiv installasjonslogikken utan å sjekke kva pakkehandsamarar som faktisk fanst på testverten.
**Retta i koden:** ja, same økt (sjekk `apt`/`dnf`/`pacman` fyrst).
**Prosessendring:** ingen — dette var spesifikt for eitt skript, ikkje eit generelt mønster verdt ein CLAUDE.md-regel.

### 3. Brukaren rapporterte at feilmeldinga "ikkje inneheldt hjelp", sjølv om han teknisk sett gjorde det
**Rotårsak:** hjelpelinja var reint ustila tekst rett under ei farga FEIL-linje — lett å oversjå ved skumlesing, ikkje ei reell mangel i innhaldet.
**Retta i koden:** ja — skilde `info()` frå ein ny, cyanfarga `fix()`, pluss eit samla oppsummeringsblokk til slutt.
**Prosessendring:** ingen generell regel skriven. Kunne vore formulert som "brukarvend feilmelding-formatering: gjer den faktiske fiksen visuelt umogleg å ikkje sjå, ikkje berre til stades i outputen" — vurdert, men skjønt som for smalt/verktøyspesifikt til å fortene ein CLAUDE.md-regel framfor berre god skikk.

### 4. `check-requirements.sh` føreslo ein repo-rot-relativ sti uansett kor skriptet vart køyrt frå
**Kva:** brukaren køyrde skriptet frå inni `deploy/web/`, og fekk ein stad som var feil (dobla `deploy/web/deploy/web/...`).
**Rotårsak:** skriptet las aldri sin eiga plassering, anna at han gjekk ut frå at cwd = repo-rot.
**Retta i koden:** ja — `SCRIPT_DIR`/`COMPOSE_FILE` via `dirname "${BASH_SOURCE[0]}"`, alltid absolutt sti i forslaga.
**Prosessendring:** ingen generell CLAUDE.md-regel — dette er eit korrekt-implementert skript-mønster (rekn ut eiga plassering), ikkje eit repo-arbeidsmønster som gjentek seg på tvers av oppgåver.

### 5. `podman-compose --version` sitt fleirlinja-svar vart mistolka (`head -1` plukka feil linje)
**Retta i koden:** ja — `grep` etter riktig linje i staden.
**Prosessendring:** ingen — for smalt til ein generell regel.

### 6. README-eksempel med ANSI-fargekodar rendra ikkje i VS Code preview
**Kva:** brukte ein `` ```ansi ``-kodeblokk med ekte escape-sekvensar for å visa fargelagt terminal-output i `README.md`; fungerer berre på GitHub, ikkje i VS Code-førehandsvising eller andre marknadsvisarar.
**Rotårsak:** valde ein GitHub-spesifikk renderingsmekanisme utan å vurdere at README vert lese fleire stader enn berre github.com.
**Retta i koden:** ja — reverterte til vanleg tekst.
**Prosessendring:** vurdert, men ikkje lagt til som eigen CLAUDE.md-regel — dette er eit generelt "vurder alle lesarar av eit dokument"-prinsipp som ikkje er spesifikt nok for dette repoet til å fortene ei eiga linje; handtert som eit engongstilfelle.

### 7. `.dockerignore` mangla heilt → `podman-compose up --build` hengde seg på `COPY . .` (STEG 11)
**Kva:** brukaren opplevde det som eit reelt hengande bygg.
**Rotårsak:** tidlegare test-økter same dag hadde køyrt `pnpm install` mot repoet via ein bind-mounta container (naudsynt sidan verten manglar Node/pnpm) — dette la att 474 MB `node_modules` OG 481 MB/31 643 filer i ein `.pnpm-store`-mappe RETT I ARBEIDSTREET. Utan `.dockerignore` kopierte `COPY . .` alt dette inn i kvart bygg, over ein ~8-9× tregare bind-mount-filsystem-I/O (WSL2 `/mnt/c/...`).
**Stadfesta, ikkje berre anteke:** brukte `ps auxf` til å stadfeste at `buildah-copier`-prosessane faktisk jobba (ikkje reelt hengande/deadlocka), berre ekstremt sakte — viktig metodisk poeng: skilde "ser ut som hengande" frå "er faktisk hengande" empirisk før konklusjon.
**Retta i koden:** ja — ny `.dockerignore`, `.pnpm-store` lagt til `.gitignore`, sletta det faktiske søppelet frå verten.
**Prosessendring:** **ja, dette er den direkte kjelda til den nye "clean up afterward, every time"-regelen i CLAUDE.md sin "When the host has no Node/pnpm"-seksjon.** Den viktigaste prosessleksjonen frå heile podman-arbeidet.

### 8. Fleire Bash-verktøykall vart automatisk flytta til bakgrunnen fordi `timeout`-parameteren var for kort
**Kva:** skjedde minst to gonger — éin gong med ein `pnpm install`-kommando (som i tillegg hadde ein intern `timeout 240`-innpakking som drap prosessen FØR verktøyet sitt eige budsjett i det heile vart eit problem), éin gong med ein `podman-compose build --no-cache` som tok over 8 minutt.
**Rotårsak:** kjende ikkje til (endå) kor lang tid desse operasjonane faktisk tek i dette miljøet.
**Retta:** brukte `TaskOutput`/`TaskStop` til å følgje opp bakgrunnskommandoar i staden for å late dei henge; fjerna den unødvendige interne `timeout N`-innpakkinga.
**Prosessendring:** ja, alt gjort tidlegare i økta (den eksisterande "Always pass an explicit long timeout..."-seksjonen i CLAUDE.md) — brukaren sin eigen respons på dette vart faktisk instruksen om å skrive akkurat den regelen. Denne gjennomgangen legg til presisering om at eit indre `timeout N` i sjølve shell-kommandoen ikkje hjelper (alt skrive), og no i tillegg oppryddingsregelen frå #7.

### 9. Vitest-forked-worker-timeout-flaks (~60s), gjentekne gonger, på tilfeldige testfiler
**Kva:** råka `gitSlice.test.ts`, `editor-panels.test.tsx`, `tours.test.ts`, og mitt eige `autoLayout.test.ts`, på ulike køyringar — aldri to gonger på same fil, aldri knytt til faktiske kodeendringar i den råka fila.
**Rotårsak, stadfesta empirisk (ikkje berre anteke):** testa med `--pool=forks` OG `--pool=threads` (same feil begge — utelukkar fork()-syscall-restriksjon spesifikt), målte `user`/`sys`-CPU-tid under hendinga (nær null over 75 sekund — utelukkar reknetungt arbeid, stadfestar at prosessen er BLOKKERT, ikkje travelt), og målte filsystem-traverseringstid gjennom bind-mounten (~8-9× tregare enn direkte på verten). Alt saman peikar mot jsdom-miljø-kaldstart som tippar over vitest sitt interne, faste 60-sekunders klar-til-svar-tidsavbrot, på eit filsystem som gjer denne kaldstarten unormalt sakte.
**Arbeidsrunde funnen:** `--environment node` for reine logikk-testfiler unngår heile problemet (jsdom-oppsettet er det som er sakte). Prøvde òg å løyse det permanent via `vitest.config.ts` sin `environmentMatchGlobs` — verka IKKJE pålitageleg for ei enkelt-fil-køyring i dette miljøet (reverterte den endringa, ville elles late ei uverifisert/ueffektiv config-endring liggje att).
**Prosessendring:** ja, no skriven inn i CLAUDE.md sin "When the host has no Node/pnpm"-seksjon, slik ei framtidig økt ikkje treng gjenta heile diagnostiseringa.

### 10. `estimateClassNodeSize` fiksa berre høgde, ikkje breidde — brukaren fann att overlapp på ei "ekstra brei" klasse
**Rotårsak:** las CSS-en (`ClassNode.tsx`) og fann `minHeight`/rad-høgder for høgde-estimatet, men noterte breidde-mismatchen (`minWidth: 200, maxWidth: 320`) berre som "eit mindre alvorleg sekundært problem" i staden for å fikse han samtidig — sidan høgde openbert var STØRRE i praksis, undervurderte eg kor lett breidde-varianten faktisk kunne triggast (lange attributt-/range-namn).
**Retta i koden:** ja, i neste runde, då brukaren rapporterte det.
**Prosessendring:** dette er akkurat mønsteret bak den nye "when a bug is found in one dimension... check its siblings"-leksjonen — men eg valde å ikkje gjenta den som ei eiga linje i CLAUDE.md sidan ho alt er dekt implisitt av det generelle "empirisk verifikasjon"-prinsippet (punkt 12 under) og av dei fortløpande spesifikasjonane sine eigne "Ope spørsmål"-seksjonar som eksplisitt spurde om nett dette før det vart eit problem.

### 11. Same CORS-bug (github.com blob-URL) duplisert i to ulike dialogar
**Kva:** `OpenSchemaFromUrlDialog` og `ImportSchemaDialog` hadde begge ein rå `fetch(url)` utan blob→raw-normalisering.
**Rotårsak:** to separate, ikkje-delte kodestiar med same feilmønster — klassisk kopiert/dupliserte-logikk-scenario.
**Retta i koden:** ja, begge, same runde — fann det andre tilfellet ved eksplisitt å grepe etter same mønster (`fetch(` + URL-handtering) i heile `packages/core/src/editor/` FØR eg konkluderte at fiksen var komplett.
**Prosessendring:** ingen eigen CLAUDE.md-regel — handtert som god skikk ("grep for same mønster andre stader") heller enn ein ny fast regel, sidan det alt er implisitt i korleis eg jobbar (og no forsterka av det generelle "sjekk søsken"-prinsippet nemnt i punkt 10).

### 12. **Den store: `direction: 'TB'` har ALDRI fungert — ELK forstår ikkje den verdien**
**Kva:** brukaren rapporterte at ein nyleg lagt til retningsveljar ikkje hadde nokon synleg effekt.
**Rotårsak:** `AutoLayoutOptions.direction` (`'TB'|'BT'|'LR'|'RL'`, eit vanleg namneverk frå andre graf-bibliotek) vart sendt UENDRA til ELK sin `elk.direction`-opsjon. ELK sin faktiske enum er `DOWN|UP|LEFT|RIGHT`. `'TB'` er ikkje gyldig, og ELK feilar ikkje på ugyldige verdiar — han **ignorerer dei stille** og fell attende til sin eigen standard (som synte seg å vere horisontal, ikkje vertikal).
**Kvifor dette er den viktigaste hendinga i heile økta:** tidlegare same dag (runde 1 av same spesifikasjon) skreiv eg eksplisitt at `direction: 'TB'` var **"reelt kopla til algoritmen, ikkje daud/uverdig kode"** — ei konklusjon basert utelukkande på å LESE koden (sjå at verdien vart sendt til rett stad), aldri på å faktisk TESTE at ELK gjorde noko ulikt med ulike verdiar. Denne feilaktige konklusjonen stod urørt gjennom TO heile rundar med vidare arbeid (breidde-fiks, kryss-minimering, avstand-justering) før retningsveljaren i UI-et endeleg gjorde det synleg at noko var gale.
**Stadfesta empirisk før fiksen vart skriven:** skreiv eit ståande testskript som kalla rå `elkjs` med `'TB'`, ein oppdikta `'bogus'`-streng, og dei fire ekte ELK-verdiane (`DOWN/UP/LEFT/RIGHT`), og samanlikna faktiske x/y-resultat. `'TB'` og `'bogus'` ga **bit-for-bit identisk** resultat som eksplisitt `'RIGHT'` — konkluderande prov.
**Retta i koden:** ja — ny `DIRECTION_TO_ELK`-oppslagstabell, pluss 5 nye testar som konkret sjekkar POSISJONEN til eit barn i høve til forelderen for kvar retning (ikkje berre at layout "køyrer utan feil").
**Prosessendring:** **ja — dette er direkte kjelda til den nye "verify configuration empirically, not by code-reading alone"-leksjonen i CLAUDE.md, sitert med akkurat dette eksempelet.** Dette er den mest generaliserbare og kostbare leksjonen frå heile økta: eit hardkoda strengverdi som "ser rett ut" og vert sendt til rett stad i koden, kan framleis vere heilt feil for mottakarbiblioteket sitt faktiske grensesnitt, og korkje kompilering, lint, eller "koden ser fornuftig ut" fangar dette opp — berre ei ekte samanlikning av output for ulike verdiar gjer det.

## Vurdert, men ikkje gjennomført

- **Eigne skills/hooks for nokon av desse feila?** Vurdert for #7 (`.dockerignore`/opprydding) og #9 (vitest-flaks) — men begge er reint informative/miljø-fakta, ikkje repeterbare fleire-steg-arbeidsflytar ein skill ville automatisert. Dei høyrer heime som CLAUDE.md-kunnskap, ikkje som skills. Ingen av dei 12 hendingane peika mot eit naturleg nytt hook-kandidat (ingen av dei er "handlingar som bør blokkerast før dei skjer" på same måte som dei tre eksisterande hookane frå tidlegare i økta).
- **Ein eigen "empirisk-test-før-du-konkluderer"-skill eller -hook?** Vurdert og forkasta — dette er eit generelt arbeidsprinsipp, ikkje ein avgrensa, automatiserbar arbeidsflyt. Éi tydeleg linje i CLAUDE.md (no skriven) er rett verktøy for dette, ikkje eit skill.
