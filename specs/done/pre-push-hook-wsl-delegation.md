# Spec: la `.githooks/pre-push` delegere til WSL2 når han køyrer frå Windows Git Bash

Status: **implementert og stadfesta empirisk.** Brukaren køyrde `bash .githooks/pre-push` direkte frå Windows Git Bash: delegeringa til `wsl.exe -d ubuntu -e bash -ic` fungerte fullt ut — `pnpm install`, alle 745 unit-testar, og heile Playwright-E2E-suiten køyrde reelt inne i WSL2, og feil-tilfellet vart stadfesta òg (3 E2E-testar feila av grunnar heilt urelaterte til denne endringa — sjå eiga merknad nedst — og feilen propagerte korrekt til Git Bash med exit code 1, som ville blokkert ein reell `git push`).
Dato: 2026-09-15 (forslag) → 2026-09-15 (implementert og stadfesta)
Ønske (opphavleg, frå brukaren): brukaren køyrer VS Code og Git Bash i Windows (fordi det berre er Windows som kjenner SSH-nøkkelen brukt til `git push`), medan sjølve utviklingsmiljøet (Node/pnpm) held til i WSL2. Brukaren ønskjer å halde desse to miljøa **separate** — altså IKKJE installere Node/pnpm i Windows/Git Bash berre for å få `pre-push`-hooken til å fungere — men vil likevel at hooken sine faktiske sjekkar (unit + E2E, sjå under) skal køyre ved kvar `git push`, uansett kva for eit av dei to shella push vert utført frå.

## Konkret feil som utløyste dette

```
$ git push
.githooks/pre-push: line 52: pnpm: command not found
error: failed to push some refs to 'github.com:AudunVindenesEggeBR/linkml-modeler-app-fork.git'
```

`ave@BR-10637L MINGW64 ~/.../linkml-modeler-app-fork (main)` — altså Git Bash (MINGW64) på sjølve Windows-verten, ikkje inni WSL2. `pnpm` finst ikkje der fordi Node/pnpm berre er sett opp inni WSL2 (jf. `.claude/skills/node-pnpm-fallback/SKILL.md`, som heilt gjennomgåande føreset WSL2/podman som miljø).

## Noverande tilstand (funne ved gjennomgang av koden)

- `core.hooksPath` er sett til `.githooks` av root-`package.json` sitt `prepare`-script (`git config core.hooksPath .githooks || true`) — same hook-fil køyrer difor uansett kva for eit shell/OS `git push` vert trigga frå, sidan det er éin delt fil i det versjonerte arbeidstreet (same filsystem, mounta både som `/mnt/c/dev/git/linkml-modeler-app-fork` i WSL2 og som t.d. `C:\dev\git\linkml-modeler-app-fork` i Windows).
- `.githooks/pre-push` (heile fila, 57 linjer) er ein rein `bash`-script som **føreset at `pnpm` finst på PATH i det shellet hooken køyrer i** — han gjer ingen OS-/shell-deteksjon i det heile, og har ingen fallback viss `pnpm` manglar. Han gjer i tillegg WSL2-spesifikk optimalisering (unprivilegert `unshare --mount`-bind-mount av `node_modules` til natívt filsystem, sjå linje 17-54) som berre er meiningsfull/verifisert på WSL2 — ikkje noko som skal (eller kan) køyrast direkte i Git Bash/MINGW64.
- Git for Windows sitt Git Bash er MSYS2/MINGW64 — eit anna shell-miljø enn WSL2 sin eigen bash, med sitt eige (separate) syn på PATH og manglar `wsl.exe`-integrasjon som standard (`wsl.exe` finst derimot alltid tilgjengeleg *frå* eit Windows-shell som eit vanleg `.exe` på PATH, sidan WSL2 sjølv installerer det systemvidt).
- Det finst ingen eksisterande deteksjon av "er dette shellet MINGW64/Git-Bash" nokon stad i repoet (`grep -r MINGW`/`grep -r MSYSTEM` gav ingen treff).

## Forslag

Utvid `.githooks/pre-push` til å oppdage at han køyrer i Git Bash/MINGW64 (ikkje WSL2, ikkje ein rein Linux-native host), og i så fall **delegere heile sjekk-køyringa til `wsl.exe`** i staden for å prøve å køyre `pnpm` direkte i Windows-shellet:

1. **Deteksjon.** MSYS2/Git-Bash set miljøvariabelen `MSYSTEM` (typisk `MINGW64`); WSL2 sin eigen bash gjer ikkje det. Bruk `[ -n "${MSYSTEM:-}" ]` (eventuelt kombinert med `grep -qi microsoft /proc/version` som ei ekstra stadfesting av at ein faktisk *er* på ein Windows-vert og ikkje t.d. ein annan MSYS2-variant) som vilkåret som skil dei to tilfella.
2. **Delegering.** Når vilkåret over er sant:
   - Omset arbeidskatalogen frå Windows-sti til WSL2-sti via `wsl.exe -d ubuntu wslpath -a "$(git rev-parse --show-toplevel)"` — stadfesta empirisk å gje rett resultat (`/mnt/c/dev/git/linkml-modeler-app-fork` frå `C:/dev/git/linkml-modeler-app-fork`), sjå "Opne spørsmål" punkt 1 under.
   - Kall `wsl.exe -d ubuntu -e bash -ic "<original run_checks-logikk, uendra>"` med den omsette stien — **`-ic` (interaktivt, IKKJE login)**, stadfesta empirisk som den einaste kombinasjonen som finn `pnpm` på PATH utan å søle ut MOTD-støy, sjå "Opne spørsmål" punkt 3 under. Dette let **heile den eksisterande WSL2-optimaliserte logikken** (bind-mount-blokka, `pnpm install --frozen-lockfile`, dei to testrada) køyre akkurat som i dag, berre trigga frå Windows-sida i staden for direkte.
   - Prop videre `wsl.exe`-kommandoen sin exit code som hooken sin eigen exit code (`git push` skal framleis stoppast ved feilande testar, uansett kva for eit shell push vart starta frå — stadfesta empirisk at exit code propagerer korrekt gjennom `wsl.exe`, testa med `exit 42`).
3. **Ingen endring i WSL2/native-Linux-tilfellet** — når `MSYSTEM` ikkje er sett, skal hooken oppføre seg akkurat som i dag (uendra kodesti, ingen ny grein å teste for det vanlege tilfellet).
4. **Feilmelding viss `wsl.exe` sjølv manglar** (usannsynleg på ein vert som har WSL2 installert i det heile, men bør handterast eksplisitt): gje ei tydeleg feilmelding ("wsl.exe not found — install WSL2 or push from within it") i staden for den kryptiske `pnpm: command not found` brukaren såg i dag, jf. CLAUDE.md sitt prinsipp om å ikkje la ei uklar underliggande årsak framstå som noko anna enn det ho er.

## Opne spørsmål — status etter empirisk testing (2026-09-15)

1. **Sti-omsetjing Windows → WSL2 frå INNI Git Bash — STADFESTA.** `git rev-parse --show-toplevel` i brukaren sitt Git Bash returnerer `C:/dev/git/linkml-modeler-app-fork` (drive-bokstav-kolon-format med skråstrekar, IKKJE MSYS-monteringsformatet `/c/dev/...` som først vart anteke). Begge testa omsetjingsmetodar gav identisk, korrekt resultat — `/mnt/c/dev/git/linkml-modeler-app-fork`:
   - **Metode A:** `wsl.exe -d ubuntu wslpath -a "$RAW"` (WSL sitt eige verktøy, kalla frå Git Bash-sida).
   - **Metode B:** manuell `sed`/`tr`-omskriving: første teiknet (stasjonsbokstav) small-cased, `:/` stroken, `/mnt/<bokstav>/` sett framfor resten.

   Anbefalt for hooken: **Metode A** (`wslpath -a`), sidan han er WSL sitt eige offisielle verktøy og dermed robust mot variasjonar i korleis ulike Git for Windows-versjonar/-innstillingar formaterer stien, i staden for å stole på eit hand-skrive regex-mønster (den fyrste, naive `sed`-omskrivinga i denne spec-en anteok feil format og trefte ingenting før dette vart testa empirisk).

2. **`wsl.exe` på PATH i Git Bash/MINGW64 — STADFESTA.** `command -v wsl.exe` finn han på `/c/WINDOWS/system32/wsl.exe`, `wsl.exe --version` svarar (WSL 2.7.13.0).

3. **Rett shell-påkallingsflagg for at `pnpm` skal vere synleg — STADFESTA, etter éin feilslått freistnad.** Første forsøk (`wsl.exe -d ubuntu -e bash -lc "..."`, ein login-men-ikkje-interaktiv shell) fann IKKJE `pnpm` sjølv med rett omsett sti (`command -v pnpm` gav tom output, `&&`-kjeda stoppa). Mistanke: standard Ubuntu `~/.bashrc` startar med ein guard som returnerer tidleg for ikkje-interaktive shell, før nvm/pnpm-PATH-oppsettet lenger nede i fila vert nådd — stadfesta indirekte ved at eit eksplisitt `source ~/.bashrc` frå ein `-lc`-kontekst framleis ikkje gav `pnpm` på PATH. Fire kombinasjonar testa direkte i brukaren sitt Git Bash:

   | Kall | Fann `pnpm`? | Anna |
   |---|---|---|
   | `wsl.exe -d ubuntu -e bash -ic "command -v pnpm && pnpm -v"` | **Ja** (`/home/ave/.nvm/versions/node/v22.23.2/bin/pnpm`, `9.15.9`) | Ingen ekstra output — reint |
   | `wsl.exe -d ubuntu -e bash -lic "..."` | Ja, same resultat | Skriv ut Ubuntu sin MOTD-velkomstbanner (~15 linjer systeminfo) kvar einaste gong — ville gjere kvar `git push` støyete |
   | `wsl.exe -d ubuntu -e bash -lc "source ~/.bashrc 2>/dev/null; ..."` | Nei (tom output) | Stadfestar guard-teorien — kjelding skjer, men `.bashrc`-guarden hindrar resten frå å køyre |
   | `grep -l -iE 'pnpm\|nvm\|corepack' ~/.bashrc ~/.profile ~/.bash_profile` | (ikkje relevant for sjølve `pnpm`-spørsmålet) | Fann ingen treff i nokon av dei tre filene — uavklara kvar den faktiske nvm-kjeldinga skjer frå, men **ikkje ein blokkerande detalj** sidan `-ic` uansett fungerer stabilt |

   **Konklusjon: bruk `wsl.exe -d ubuntu -e bash -ic "<kommando>"`** (interaktivt, IKKJE login) — den einaste kombinasjonen som både finn `pnpm` og ikkje søl ut MOTD-støy.

   **Attverande, ikkje-blokkerande risiko:** `-i` (interaktiv) bash-modus er normalt meint for eit shell kopla til eit terminal (tty). Alle testane over vart køyrde frå eit interaktivt Git Bash-vindauge — nøyaktig den konteksten `git push` faktisk skjer frå i denne brukaren sitt daglege bruk — så dette dekker det reelle bruksmønsteret. Men viss hooken nokon gong vert trigga frå ein kontekst utan tilkopla terminal (t.d. eit automatisert Windows-script), bør ein vere merksam på at `-i`-åtferd i prinsippet kan avvike.

4. **Distribusjon — STADFESTA av brukaren: `ubuntu`.** `wsl.exe` skal kallast med `-d ubuntu` eksplisitt (ikkje standard-distribusjonen utan flagg).

5. **Ytingskonsekvens — enno IKKJE målt.** Ein `wsl.exe`-oppstart frå Windows har si eiga kaldstart-kostnad, separat frå den WSL2-interne containercold-start/bind-mount-kostnaden som alt er dokumentert i `specs/backlog/test-timing-instrumentation-and-reliability.md`. Bør målast under implementering og eventuelt loggast til `test-timing/containers.log` same måte som resten av hooken alt gjer, slik at ein uventa treg `git push` frå Windows-sida ikkje ser ut som eit nytt problem for neste sesjon. Dette er det einaste attverande opne punktet — alle andre er no stadfesta.

## Testcase / akseptansekriterium

1. Frå Windows Git Bash (MINGW64), utan Node/pnpm installert på Windows i det heile: `git push` skal trigge dei same unit- + E2E-sjekkane som i dag køyrer inne i WSL2, og blokkere pushen viss dei feilar — utan at brukaren treng opne eit separat WSL2-terminalvindauge sjølv.
2. Frå WSL2 sin eigen bash (uendra i dag-tilfelle): `git push` skal oppføre seg **nøyaktig** som før denne endringa — same bind-mount-optimalisering, same testkøyring, ingen ny grein trigga.
3. Ein feilande test inni WSL2 (trigga via delegeringa frå Git Bash) skal stoppe `git push` frå Windows-sida med ikkje-null exit code, akkurat som når testen feilar ved direkte WSL2-push i dag.
4. Om `wsl.exe` av ein eller annan grunn ikkje finn repoet på den omsette stien, skal feilmeldinga seie akkurat det (sti-omsetjing feila), ikkje falle tilbake til den generiske `pnpm: command not found`-meldinga.

## Stadfesta empirisk (2026-09-15) — reell `bash .githooks/pre-push`-køyring frå Windows Git Bash

Brukaren køyrde `bash .githooks/pre-push` direkte (ingen ekte `git push` naudsynt for å trigge hooken sin fulle logikk). Resultat mot akseptansekriteria over:

- **Punkt 1 — stadfesta.** `pnpm install --frozen-lockfile` (906 pakkar), alle 29 testfilar / 745 einingstestar, og heile Playwright-E2E-suiten (7 testar) køyrde reelt inne i `wsl.exe -d ubuntu -e bash -ic`, trigga frå Git Bash, utan at brukaren opna noko eige WSL2-vindauge.
- **Punkt 3 — stadfesta.** 3 av 7 E2E-testar feila (sjå eiga merknad under — urelatert til sjølve delegeringsmekanismen), og feilen propagerte korrekt: `pnpm`/Playwright sin eigen `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`-feil og exit code 1 nådde heilt fram til Git Bash-prompten, nøyaktig som ønska — ein reell `git push` ville vorte blokkert.
- **Punkt 2 — ikkje eksplisitt re-testa i denne runda**, men koden for WSL2/native-greina er heilt uendra av denne implementeringa (guarda bak `[ -n "${MSYSTEM:-}" ]`, som aldri er sett i WSL2 sin eigen bash), så regresjon er usannsynleg.
- **Punkt 4 — ikkje eksplisitt trigga i denne runda** (ingen `wslpath`-feil oppstod), men feilhandteringskoden (eksplisitt `||`-fallback med tydeleg feilmelding) vart lagt til nøyaktig etter mønsteret som alt er verifisert manuelt tidlegare i denne spec-en.

**Merknad — 3 E2E-testfeil observerte, IKKJE ein del av denne oppgåva:** `golden-path.spec.ts` og `new-project.spec.ts` feila fordi eit `<div>Rendering</div>`-element frå `#lme-display-panel` fanga opp peikarhendingar over `#lme-canvas-add-class`-knappen (10s timeout på klikk); `view-layout-bleed.spec.ts` feila fordi ein forventa drakt-forskyving på >50px vart målt til 0px. Ingen av desse har noko med sjølve WSL-delegeringsmekanismen å gjere — dei ville feila likt ved ein direkte push frå WSL2 sjølv. Ikkje undersøkt vidare her; ny eiga spec om brukaren ønskjer det.
