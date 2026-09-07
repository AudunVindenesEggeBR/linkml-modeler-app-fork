# Spec: køyre webappen i Podman-containerar lokalt

Status: **Ferdig.** Alle 5 oppgåvene implementerte og verifiserte (brukaren installerte sjølv `podman-compose` — sjå "Implementasjonsstatus" nedst). `podman-compose -f deploy/web/docker-compose.yml up --build` er stadfesta å faktisk fungere ende-til-ende, frå kva som helst arbeidskatalog. Flytta til `specs/done/`.
Dato: 2026-09-07 (oppdatert same dag)
Ønske: brukaren vil køyre opp webappen (LinkML Visual Schema Editor) lokalt, med **alt** i Podman-containerar — ikkje Docker, og helst ikkje avhengig av Node/pnpm installert på verten heller. Utgangspunktet er den eksisterande Docker Compose-oppsettet under `deploy/web/`.

## Noverande tilstand (funne ved gjennomgang av repoet og verten)

- `deploy/web/docker-compose.yml` definerer to tenester:
  - `web` — `nginx:alpine` som serverer ei allereie ferdigbygd `packages/web/dist/` (kopiert inn via `Dockerfile.web`s `COPY packages/web/dist ...`). Reverse-proxyar `/cors-proxy/` til `proxy`-tenesta (sjå `nginx.conf`).
  - `proxy` — sjølvstendig containerisert (`packages/proxy/Dockerfile`, `FROM node:20-alpine`, gjer `npm install` inni imaget). Ingen host-avhengnad her.
- Dokumentert flyt (`packages/docs/development.md`, "Deploying the web build with Docker"): du må køyre `VITE_GIT_CORS_PROXY=... pnpm --filter @linkml-editor/web build` **på verten** FØR `docker compose -f deploy/web/docker-compose.yml up --build`. `web`-tenesta sitt Dockerfile gjer altså ikkje sjølve applikasjonsbygget — berre serveringa.
- Denne verten har **korkje Node, pnpm, docker eller docker-compose** installert — berre `podman 5.7.0` (rootless, ingen `podman machine`, altså eit native Linux/WSL-podman-oppsett, truleg likt brukaren sitt eige miljø sidan dei spør etter podman spesifikt).
- `podman compose` finst som underkommando, men prøvde å shelle ut til `docker-compose` eller `podman-compose` og feila — ingen av dei er installerte no.
- `packages/proxy/Dockerfile` er pinna til `node:20-alpine` — same Node-line som er flagga EOL (2026-04-30) i det opne upstream-issuet BU-Neuromics/linkml-modeler-app#172. Ikkje i scope her, men same rotårsak — nemnt slik det ikkje vert gløymt eller duplisert som eige funn seinare.

**Kjernefunn:** `proxy`-tenesta er alt 100 % containerisert og krev ingenting frå verten. Det er kun `web`-tenesta sitt "bygg lokalt, server i container"-mønster som står i vegen for "alt i podman" slik brukaren ønskjer.

## Forslag

### A — Byggverktøy: `podman-compose` i staden for `docker-compose`

Installer `podman-compose` (pip/pipx) slik at eksisterande `deploy/web/docker-compose.yml` kan køyrast **uendra** via `podman-compose -f deploy/web/docker-compose.yml up --build`, eller via `podman compose ...` (som alt prøver `podman-compose` som fallback — installerer du han, byrjar den innebygde wrapperen å fungere gratis). Låg risiko, minimal diff, held éin fil som kjelde til sanning for topologien.

Vurdert og lagt til side: `podman kube generate`/`podman kube play` (Kube-YAML). Meir "podman-native" i prinsippet, men ein heilt ny filtype å vedlikehalde parallelt med det compose-formatet som alt er dokumentert i `development.md` — ikkje verdt det med mindre podman-compose viser seg upåliteleg i praksis.

### B — Containeriser sjølve web-bygget (multi-stage)

Sidan brukaren eksplisitt vil unngå å installere Node/pnpm på verten berre for å bygge, gjer `deploy/web/Dockerfile.web` om til ein multi-stage build:

1. **Byggsteg** (`node:22-alpine` eller nyare — ikkje `node:20-alpine`, sjå EOL-notatet over): `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm --filter @linkml-editor/core build`, så `pnpm --filter @linkml-editor/web build` med `VITE_GIT_CORS_PROXY`/`VITE_BASE_URL` sette (same rekkjefølgje som `deploy-docs.yml` CI-workflowen alt gjer: core først, så web).
2. **Serveringssteg** (uendra): `nginx:alpine`, kopier `dist/` frå byggsteget i staden for frå verten.

Med dette held `podman build`/`podman-compose build` seg sjølv — ingen host-Node kravd i det heile. Den eksisterande dokumenterte host-bygg-flyten i `development.md` kan stå att som eit alternativ for dei som alt har Node lokalt (t.d. same mønster CI brukar for GitHub Pages-utrullinga) — dette forslaget legg til eit alternativ, ikkje fjernar det gamle.

### C — Rootless-podman-spesifikke justeringar

- **Port 80** kan ikkje bindast direkte som rootless-brukar utan å justere `net.ipv4.ip_unprivileged_port_start`. Set standard host-port til noko som `8080:80` i `docker-compose.yml` i staden for dagens `80:80`, eller dokumenter at brukaren må overstyre porten sjølv (same mønster som `BASE_PATH`-variabelen alt brukar).
- Ingen bind-mounts i dagens compose-fil, så ingen SELinux `:Z`/`:z`-handtering er naudsynt.
- Stadfest at Podman sitt innebygde DNS på compose-nettverket løyser `proxy`-tenestenamnet slik `nginx.conf` sin `proxy_pass http://proxy:9999/` føreset — `podman-compose` skal ordne dette via eit brukardefinert nettverk automatisk, men bør testast eksplisitt før dette vert rekna som ferdig.

### D — Preflight-sjekk av lokale krav

Før nokon prøver å køyre opp stacken treng vi ein måte å stadfeste at maskina faktisk har det som trengst — elles endar feilsøkinga opp med å skulde på compose-fila/Dockerfile når problemet er t.d. feil podman-versjon, manglande podman-compose, eller ein oppteken port. Dette bør vere eit lite, avhengnadsfritt skript (bash), ikkje ein ny pnpm/node-avhengnad — heile poenget er å fungere FØR ein veit om Node er installert.

Føreslått: `deploy/web/check-requirements.sh`, køyrbart direkte (`./deploy/web/check-requirements.sh`) og også referert frå `development.md`. Sjekkar, med tydeleg pass/fail per punkt (ikkje berre "noko feila"):

1. `podman` finst på PATH, og versjon er over eit minimum (dokumenter kva minimum — t.d. `podman --version` >= 4.0, sidan compose-nettverk/DNS-støtte varierer mellom store versjonar).
2. `podman info` køyrer utan feil (fangar opp t.d. manglande subuid/subgid-mapping for rootless, eller ein podman-installasjon som ikkje er sett opp ferdig).
3. Anten `podman-compose` ELLER `docker-compose` finst på PATH (det er det `podman compose` sjølv leitar etter) — viss ingen av dei finst, skriv ut installasjonskommandoen for `podman-compose` (forslag A over) i staden for berre å seie "mangler".
4. Vald host-port (`8080` per forslag C, eller det brukaren har sett via miljøvariabel) er ledig — `ss`/`netstat`/`lsof` på porten, tydeleg feilmelding med kva som held han oppteken viss mogleg.
5. **Berre viss forslag B (multi-stage) ikkje er implementert enno:** sjekk at Node og pnpm finst lokalt og møter versjonskrava i rot-`package.json`s `engines`-felt (`node >=20`, `pnpm >=9`) — dette punktet forsvinn heilt frå sjekklista den dagen multi-stage-bygget er på plass, sidan bygget då skjer inni containeren.

Skriptet skal skrive `OK`/`FEIL` per punkt (i stil med `smoke-test.yml`s `check()`-funksjon, som alt gjer akkurat dette mønsteret for HTTP-endepunkt) og gje exit code ≠ 0 viss noko feila, slik det også kan brukast som eit steg i ein eventuell CI-jobb for `deploy/web/` seinare.

**Brukarvenleg installasjonsrettleiing ved FEIL:** det held ikkje å berre seie kva som manglar — kvart `FEIL` skal kome saman med konkret, kopierbar hjelp til å rette det, tilpassa kva OS/pakkehandsamar skriptet oppdagar (`apt`/`dnf`/`pacman` på Linux, `brew` på macOS), med ei generisk lenke som fallback når autodeteksjon ikkje er mogleg:

- **`podman` manglar eller for gamal:** vis den faktiske installasjonskommandoen for oppdaga pakkehandsamar (t.d. `sudo apt install podman` / `sudo dnf install podman` / `brew install podman`), elles lenke til podman.io sin installasjonsguide.
- **`podman info` feilar (rootless ikkje sett opp):** vis dei konkrete oppsettskommandoane (t.d. `sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $(whoami)` + `podman system migrate`), ikkje berre feilteksten frå podman rått.
- **`podman-compose`/`docker-compose` manglar:** vis eksakt installasjonskommando, t.d. `pipx install podman-compose` (føretrekt framfor `pip install` for å unngå globalt pip-miljø), med `pip install --user podman-compose` som fallback viss `pipx` ikkje finst.
- **Porten er oppteken:** vis kva prosess/container som held porten (om mogleg via `ss -ltnp`/`lsof -i`), og korleis overstyre porten i staden (miljøvariabel, jf. `BASE_PATH`-mønsteret) — ikkje berre "port 8080 opptatt".
- **Node/pnpm manglar (punkt 5, mellombels):** vis anbefalt installasjonsveg (`corepack enable && corepack prepare pnpm@<versjon frå package.json> --activate` etter at Node er på plass via nvm/fnm/pakkehandsamar), ikkje berre "Node ikkje funne".

Meldingane skal vere gode nok til at ein brukar kan løyse problemet og køyre skriptet på nytt utan å måtte søkje etter det sjølv — det er heile poenget med denne oppgåva.

## Foreslått oppgåvenedbryting

1. Skriv `deploy/web/check-requirements.sh` (forslag D) — gjer dette FØRST, sidan resten av oppgåvene er lettare å feilsøkje riktig når ein veit at grunnkrava faktisk er på plass. Kvar `FEIL` skal kome saman med ei brukarvenleg, kopierbar installasjons-/oppsettsrettleiing for akkurat det som manglar (tilpassa oppdaga OS/pakkehandsamar der det er mogleg, elles ei generisk lenke) — ikkje berre rapportere at noko manglar. Sjå detaljlista og eksempla under "Brukarvenleg installasjonsrettleiing ved FEIL" over.
2. Installer `podman-compose`; stadfest at *eksisterande* `deploy/web/docker-compose.yml` faktisk køyrer via han (kan krevje ein manuelt pre-bygd `dist/` i mellomtida, t.d. via ein eingongs Node-container, for å isolere dette steget frå punkt 3).
3. Gjer `deploy/web/Dockerfile.web` om til multi-stage (forslag B) slik at det manuelle pre-bygget ikkje lenger trengst — fjern då også preflight-sjekk-punkt D.5.
4. Endre standard host-port frå `80:80` til `8080:80` i `docker-compose.yml`.
5. Legg til ein "Podman"-seksjon ved sida av den eksisterande Docker-seksjonen i `packages/docs/development.md`, som viser fram multi-stage-flyten (ingen host-Node kravd) og nemner `check-requirements.sh`.
6. **Ikkje** i denne speca: bump av `packages/proxy/Dockerfile` sin `node:20-alpine` — gjer det saman med resten av Node-EOL-oppryddinga når/viss upstream #172 vert teke, ikkje isolert her.

## Ope spørsmål til eigar

- Skal `deploy/web/docker-compose.yml` framleis heite det (Docker-spesifikt namn) sjølv om han primært vert køyrt med `podman-compose`, eller omdøypast til det verktøy-nøytrale `compose.yml` i same slag? (Ikkje endra — filnamnet er urørt i denne runda.)
- Er multi-stage-bygget (forslag B) verdt å gjere no, eller held det med forslag A + at brukaren installerer Node/pnpm lokalt berre for dette eine bygget, som eit raskare første steg? (Svart implisitt: multi-stage vart implementert no, sidan det var kjernen i det opphavlege ønsket om "alt i podman".)

## Implementasjonsstatus

- **Oppgåve 1 — `deploy/web/check-requirements.sh`:** skrive og testa mot alle fem utfalla (podman manglar, podman for gammal, `podman info` feilar, compose-verktøy manglar, port oppteken, samt alt-OK). Fann og retta to reelle hól undervegs:
  1. Skriptet føreslo opphavleg berre `pipx`/`pip` for `podman-compose`, sjølv om denne verten (Debian/Ubuntu via apt) har ein dedikert `podman-compose`-pakke — retta til å sjekke `apt`/`dnf`/`pacman` for `podman-compose` direkte først, `pipx`/`pip` berre som siste utveg.
  2. Brukaren rapporterte at feilmeldinga "ikkje inneheldt hjelp til å fikse problemet", sjølv om kvart `FEIL` alt hadde ei `info()`-linje med installasjonskommandoen — problemet var at hjelpelinja var reint kvit/ustila tekst rett under ei farga FEIL-linje, lett å oversjå ved rask lesing. Retta ved å skilje `info()` (kontekst) frå ein ny `fix()` (cyanfarga, `->`-prefiks, faktisk kopierbar kommando) for kvar sjekk, PLUSS eit samla "Fixes to run, in order:"-oppsummeringsblokk heilt til slutt som listar opp alle kommandoane på nytt — slik er hjelpa synleg to gonger og kan ikkje forsvinne i skumlesing.
- **Oppgåve 3 — multi-stage `Dockerfile.web`:** implementert og verifisert med ein faktisk `podman build` (sjå under). Byggjer no `packages/core` + `packages/web` inni ein `node:22-alpine`-byggsteg (pnpm via corepack, pinna til same major-versjon som CI, `pnpm@10`) før nginx-steget kopierer ut resultatet — ingen host-Node kravd lenger. Preflight-sjekk-punkt D.5 (Node/pnpm-sjekk) vart difor aldri lagt til i skriptet, sidan multi-stage var på plass før D vart skrive.
- **Uventa funn undervegs — korte biletnamn er ikkje pålitelege på tvers av vertar:** første `podman build` feila på `FROM nginx:alpine` med "short-name did not resolve to an alias", sjølv om `FROM node:22-alpine` rett før hadde løyst fint. Årsak: denne verten sin `/etc/containers/registries.conf.d/shortnames.conf` har ein alias for `node`, men ikkje for `nginx` — reint tilfeldig kva korte namn som løyser på ein gjeven Podman-installasjon. Retta ved å fullt kvalifisere begge `FROM`-linjene i `Dockerfile.web` (`docker.io/library/node:22-alpine`, `docker.io/library/nginx:alpine`) — og same fiks i `packages/proxy/Dockerfile` (`docker.io/library/node:20-alpine`, versjonen urørt, sjå oppgåve 6). Dette gjer byggja reproduserbare uavhengig av kva short-name-aliasar den enkelte verten har konfigurert.
- **Oppgåve 4 — port:** `docker-compose.yml` bind no `${WEB_PORT:-8080}:80` i staden for `80:80`.
- **Oppgåve 5 — dokumentasjon:** `packages/docs/development.md` sin "Deploying the web build with Docker"-seksjon er omskriven til "... with Docker or Podman", viser `check-requirements.sh`, `podman-compose`-installasjon, og oppdatert konfigurasjonstabell (inkl. `WEB_PORT`). Subpath-seksjonen er omskriven frå den gamle to-stegs host-bygg-flyten til éin `podman-compose up --build`-kommando med alle miljøvariablane sette samtidig, sidan bygget no skjer inni containeren.
  - **Merk:** repoet har ein tilsynelatande ute-av-synk duplikat, `docs/development.md` (rot-nivå, skil seg frå `packages/docs/development.md` i commit-historikk og innhald — ingen synk-skript funne mellom dei). Denne speca rørte berre `packages/docs/development.md`, sidan det er fila VitePress-sida (og dermed GitHub Pages-dokumentasjonen) faktisk byggjer frå. Drifta mellom dei to filene er ikkje fiksa her — eige, uavhengig ryddeproblem, verdt ein eigen backlog-post viss det skal ryddast opp.
  - **I tillegg (ikkje eksplisitt i oppgåvelista, men naturleg del av same dokumentasjonsarbeid):** `README.md` sin "Quick Start" har no ein eigen "Run everything in containers (Podman)"-seksjon — kallar `check-requirements.sh` og viser eksempel på eit vellukka (alt-OK) utfall, deretter `podman-compose up --build`, med lenke vidare til Developer Guide for subpath/Docker-alternativ.
- **Ekstra korrektheitsfiks utover oppgåvelista, oppdaga medan multi-stage vart implementert:** `docker-compose.yml` sette tidlegare ALDRI `VITE_GIT_CORS_PROXY` for `web`-tenesta i det heile (han vart berre sett i den no-fjerna host-`pnpm build`-kommandoen i dokumentasjonen) — ein reint frisk `docker compose up --build` utan manuell pre-bygg ville difor ha bygd appen UTAN CORS-proxy konfigurert. `docker-compose.yml` set no `VITE_GIT_CORS_PROXY` som build-arg med standardverdi `/cors-proxy` (matchar `nginx.conf` sin `/cors-proxy/`-location for standard `BASE_PATH=/`), slik at git-fjernoperasjonar fungerer ut boksen utan at nokon må hugse å setje han manuelt.
- **Oppgåve 2 — installer `podman-compose`:** sjølve installasjonen var blokkert for meg i denne økta (treng `sudo`), men før det vart heile stacken verifisert ende-til-ende med rå `podman build`/`podman run` (same Containerfiles `podman-compose` bruker) — sjå det opphavlege funnet lenger nede. Brukaren installerte deretter `podman-compose` sjølv (`sudo apt-get install -y podman-compose`, versjon 1.5.0), og **det fulle, verkelege `podman-compose -f deploy/web/docker-compose.yml up --build`-kallet er no stadfesta å fungere**: begge tenestene bygde og starta via `podman-compose` sjølv (utan manuell nettverksoppsett denne gongen), hovudsida svarte 200, og CORS-proxyen henta ekte git-data frå `https://github.com/isomorphic-git/isomorphic-git.git` gjennom nginx. Stacken vart teken ned og images/nettverk rydda att etterpå (`podman-compose down` + `podman rmi`).
  - **To reelle feil funne under denne verifiseringa, begge no retta i `check-requirements.sh`:**
    1. **Feil arbeidskatalog ga feil sti.** Brukaren køyrde `podman-compose -f deploy/web/docker-compose.yml up --build` frå INNI `deploy/web/`-katalogen (naturleg, sidan det er der `check-requirements.sh` ligg) — som gjorde stien til `deploy/web/deploy/web/docker-compose.yml` og feila med "missing files". Skriptet sine eigne forslag til neste steg var hardkoda repo-rot-relative og tok ikkje omsyn til kor skriptet faktisk vart køyrt frå. Retta ved at skriptet no reknar ut si eiga absolutte plassering (`SCRIPT_DIR`/`COMPOSE_FILE` via `dirname "${BASH_SOURCE[0]}"`) og alltid føreslår ein absolutt sti — fungerer no likt anten du køyrer `./deploy/web/check-requirements.sh` frå rota eller `./check-requirements.sh`/`bash check-requirements.sh` inni `deploy/web/`.
    2. **Feil `podman-compose`-versjon vist.** `podman-compose --version` skriv ut TO linjer ("podman version X" fyrst, "podman-compose version Y" deretter) — skriptet sitt `head -1` plukka feil linje, så "alt OK"-meldinga viste feilaktig `podman-compose found (podman version 5.7.0)` i staden for podman-compose sin eigen versjon. Retta til å `grep`e etter linja som faktisk inneheld "podman-compose".
- **Oppgåve 6:** Node-versjonen i `packages/proxy/Dockerfile` er urørt (framleis `node:20-alpine`, ikkje bumpa). Éin ting vart likevel retta der: `FROM node:20-alpine` → `FROM docker.io/library/node:20-alpine`, av same grunn som over — reint namneoppslag, ingen versjonsendring.

## Reelt funn etter at speca vart markert ferdig: manglande `.dockerignore` fekk `podman-compose up --build` til å henge på STEP 11

Brukaren rapporterte at `podman-compose -f deploy/web/docker-compose.yml up --build` hengde seg på "steg 11" (`COPY . .` i `Dockerfile.web`, forslag B sitt multi-stage-bygg). Undersøkt og stadfesta:

- **Rotårsak:** det fanst ingen `.dockerignore` i det heile i repoet. `COPY . .` kopierer difor bokstaveleg talt ALT som ligg i arbeidstreet inn i byggsteget — inkludert `node_modules` (474 MB, oppstått fordi tidlegare test-økter i denne speca køyrde `pnpm install` mot repoet via ein bind-mounta container for å verifisere kode utan Node/pnpm på verten) og, verre, ein **`.pnpm-store`-mappe på 481 MB med 31 643 enkeltfiler** som pnpm hadde oppretta lokalt i repoet i staden for i sin vanlege globale plassering (også eit biprodukt av same container-baserte `pnpm install`-mønster). Denne verten (WSL2, repoet ligg under `/mnt/c/...`) har stadfesta ~8-9× tregare filsystem-I/O gjennom eit podman-bind-mount samanlikna med direkte på verten — verst tenkeleg kombinasjon med titusenvis av små filer.
- **Diagnose:** stadfesta med `ps auxf` at `buildah-copier`-prosessane FAKTISK jobba (ikkje deadlocka), berre ekstremt sakte — konsistent med filsystem-I/O-flaskehals, ikkje ein hengande/blokkert prosess.
- **Retta:** ny `.dockerignore` i repo-rota (der build-konteksten er, sidan `docker-compose.yml` sin `context: ../..` peikar dit) som ekskluderer `node_modules`, `.pnpm-store`, `.git`, byggartefaktar (`dist`, `coverage`, osv.) — i ånda til `.gitignore`, men som eiga fil sidan dei to tener ulike formål. La også til `.pnpm-store/` i `.gitignore` sjølv, sidan `git status` viste at han stod som usporа (`??`) og kunne ha blitt committa ved eit uhell.
- **Rydda opp:** sletta det faktiske `node_modules`- og `.pnpm-store`-innhaldet frå verten (reint attskapbar cache, null tap).
- **Verifisert:** full `podman-compose build --no-cache` frå botnen av gjekk frå å henge i fleire minutt på steg 11, til **68 sekund totalt for heile stacken** (begge tenester, ingen cache). Deretter full `up -d` + same curl-verifisering som tidlegare (hovudside 200, CORS-proxy hentar ekte git-data frå GitHub gjennom nginx) — framleis grønt. Stacken teken ned og rydda att.

**Leksjon for framtidige `.dockerignore`-vurderingar i denne typen prosjekt:** ikkje anta at berre `node_modules` er problemet — verktøy som `pnpm` kan leggje frå seg eigne cache-/store-mapper direkte i arbeidstreet under uvante køyremønster (t.d. container-basert install mot eit bind-mounta repo), og desse kan vere like store og talrike i filtal som `node_modules` sjølv, men lett å oversjå fordi dei ikkje har eit like kjent namn.
