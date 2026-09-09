# Plan: CORS-proxy for "Open Schema from URL" / "Import Schema" — eller er det eigentleg noko anna?

Status: **Ferdig — løyst utan ny proxy-infrastruktur.** Steg 0 (`build --no-cache` + `up -d --force-recreate` + hard-refresh) løyste problemet. Diagnosen i denne planen var korrekt: stale bygg/cache, ikkje ein manglande CORS-proxy. Steg 1 (ny schema-fetch-proxy) var difor aldri naudsynt. Flytta til `specs/done/`.
Dato: 2026-09-07 (oppdatert same dag)
Bakgrunn: Brukaren rapporterer at "Open Schema from URL" framleis gir `Could not reach URL — the server may not allow cross-origin requests (CORS)` med `https://github.com/brreg/linkml-datamodellering-no/blob/main/src/linkml/oreg/javazonetalk/javazonetalk-schema.yaml`, **etter** å ha rebygd containeren — sjølv om `normalizeSchemaUrl()` (blob→raw-normalisering for GitHub-URL-ar, sjå tidlegare arbeid same dag) alt ligg i arbeidstreet. Brukaren ba om ein plan for å setje opp ein CORS-proxy "slik det er beskrive" i `SECURITY.md`, testa mot denne URL-en, og at planen skrivast til `/specs` **utan** at noko vert endra no.

## Diagnostikk gjort no (berre lesing/nettverkskall, ingen kodeendring)

- `SECURITY.md` sin "Trust Boundary 2 — CORS Proxy" handlar **utelukkande** om `VITE_GIT_CORS_PROXY` / `packages/proxy` — proxyen for isomorphic-git sine smart-HTTP-operasjonar (clone/push/pull). Han er **ikkje** relatert til "Open Schema from URL" i det heile.
- `packages/proxy` sin handler (`@isomorphic-git/cors-proxy`) validerer eksplisitt at requesten ser ut som eit git-kall (`isAllowed()` krev `/info/refs?service=git-upload-pack` e.l., elles 403). Han kan difor **ikkje** gjenbrukast uendra for eit vanleg GET av ei rå YAML-fil — det er eit heilt anna bruksmønster enn det proxyen er bygd og sikra for.
- Testa target-URL-en direkte (curl, frå dette miljøet):
  - `https://api.github.com/repos/brreg/linkml-datamodellering-no` → `"private": false` (offentleg repo).
  - `https://raw.githubusercontent.com/brreg/linkml-datamodellering-no/main/src/linkml/oreg/javazonetalk/javazonetalk-schema.yaml` → **`200 OK`**, med header **`access-control-allow-origin: *`**.
  - Dvs.: den URL-en `normalizeSchemaUrl()` SKAL produsere frå den oppgjevne blob-URL-en, har alt korrekt CORS-støtte, verifisert utanfrå. Det finst i utgangspunktet ingen teknisk grunn til at denne spesifikke URL-en treng ein proxy i det heile.

**Konklusjon av diagnostikken:** dette er truleg **ikkje** eit "vi manglar ein CORS-proxy"-problem, men eit teikn på at det rebygde imaget brukaren testa mot **ikkje faktisk inneheld** `normalizeSchemaUrl()`-fiksen enno (eller at nettlesaren viste ein cacha, gammal versjon av appen). Å byggje ein heilt ny proxy-infrastruktur no ville løyst eit problem som truleg ikkje er det reelle problemet, og ville late det faktiske problemet (stale bygg) stå urørt.

## Steg 0 — Billeg diagnose FØR noko nytt vert bygd (gjer dette fyrst)

1. Opne nettlesaren sitt DevTools → Network-fana, prøv "Open Schema from URL" på nytt med same URL, og sjå **kva URL fetch-kallet faktisk går til**:
   - Går det til `github.com/.../blob/...` → koden i det køyrande imaget er **ikkje** oppdatert (stadfestar stale-bygg-teorien). Gå til Steg 0b.
   - Går det til `raw.githubusercontent.com/...` og feilar likevel → sjå den *faktiske* feilteksten frå nettlesaren i konsollen (ikkje appen sin generiske melding) — kan avdekkje noko anna (t.d. eit nettverks-/brannmurproblem spesifikt i brukaren sitt miljø, sidan curl frå dette (andre) miljøet fungerer fint).
2. **Steg 0b — tving fullstendig ombygging** (utelukk cache-attbruk av eit gammalt lag):
   ```bash
   podman-compose -f deploy/web/docker-compose.yml build --no-cache
   podman-compose -f deploy/web/docker-compose.yml up -d --force-recreate
   ```
3. **Hard-refresh nettlesaren** (tøm cache for sida, t.d. Ctrl+Shift+R eller eit privat vindauge) før ny test — vanleg nettlesar-cache av `index.html`/gamle asset-referansar er ei kjend fallgruve.
4. Stadfest kva image som faktisk køyrer og når det vart bygd:
   ```bash
   podman inspect web_web_1 --format '{{.Created}}'
   ```
   samanlikna med tidspunktet for siste `build`.

## Steg 1 — Berre viss Steg 0 stadfestar at raw-URL-en FRAMLEIS feilar frå brukaren sin nettlesar

Då er det truleg eit nettverksomsyn spesifikt for brukaren sitt miljø (proxy/brannmur/DNS), eller ein framtidig schema-kjelde som genuint manglar CORS-støtte (ikkje GitHub). I så fall, bygg ein **eigen, avgrensa** schema-fetch-proxy — ikkje gjenbruk git-cors-proxyen:

- **Ny, separat endpoint/teneste**, skilt frå `packages/proxy` sin eksisterande git-spesifikke handler.
- **Sikkerheitsavgrensingar** (ein open "hent-kva-URL-som-helst"-proxy er eit klassisk SSRF-mønster — same tillitsgrense-resonnement som `SECURITY.md` alt brukar for git-proxyen):
  - Berre `GET`.
  - Berre `https:`-skjema; blokker `http:`, `file:`, og private/interne IP-ranges (hindrar SSRF mot t.d. `169.254.169.254`-metadata-endepunkt eller interne tenester).
  - Vurder ei domene-allow-list (t.d. `raw.githubusercontent.com`, `gist.githubusercontent.com`, pluss det administrator eksplisitt legg til) framfor fritt-fram — konsistent med korleis `SECURITY.md` alt krev eit eksplisitt, informert val for den andre proxyen ("no default proxy").
  - **Ikkje** følg redirects blindt (kan omgå ei domene-allow-list) — valider på nytt per hopp, eller nekt redirects heilt.
  - Maks response-storleik og timeout, for å hindre misbruk som ein DoS- eller data-exfiltrerings-vektor.
- **Frontend:** ny miljøvariabel (t.d. `VITE_SCHEMA_FETCH_PROXY`), brukt av `openSchemaFromUrl`/`ImportSchemaDialog` som **fallback** når direkte fetch feilar — ikkje som einaste veg, sidan dei fleste offentlege GitHub-URL-ar alt fungerer utan proxy etter blob→raw-normaliseringa.
- **Dokumenter** som ei tredje "Trust Boundary" i `SECURITY.md`, i same stil som dei to eksisterande (trussel → vurdert tiltak → restrisiko-tabell).

## Testcase (uansett kva steg som løyser det)

```
https://github.com/brreg/linkml-datamodellering-no/blob/main/src/linkml/oreg/javazonetalk/javazonetalk-schema.yaml
```

Sjekkliste:
1. Lim inn URL-en i "Open Schema from URL".
2. Stadfest at schemaet opnar utan feilmelding.
3. Stadfest at eventuelle relative imports i `javazonetalk-schema.yaml` løyser korrekt mot same repo/ref (via `sourceUrl`-basert relativ URL-oppløysing, alt implementert i `importResolver.ts`).
4. (Alt stadfesta uavhengig av UI, via curl i denne økta): den normaliserte raw-URL-en returnerer `200` med `access-control-allow-origin: *` — punkt 1–3 **bør** lukkast utan ny proxy-infrastruktur, gitt at Steg 0 stadfestar at fiksen faktisk køyrer.

## Tilråding

**Ikkje bygg ein ny CORS-proxy fyrst.** Køyr Steg 0 (nokre minutt) — alt tyder på, verifisert utanfrå denne økta, at target-URL-en alt har korrekt CORS-støtte via `raw.githubusercontent.com`. Den mest sannsynlege forklaringa er at det rebygde imaget brukaren testa mot ikkje inneheldt `normalizeSchemaUrl()`-fiksen enno (stale bygg/cache, eller nettlesar-cache). Gå berre vidare til Steg 1 (ny proxy-infrastruktur) viss Steg 0 konkret stadfestar at raw-URL-fetch framleis feilar frå brukaren sin faktiske nettlesar.

## Utfall

Brukaren køyrde Steg 0b (`podman-compose -f deploy/web/docker-compose.yml build --no-cache && podman-compose -f deploy/web/docker-compose.yml up -d --force-recreate`) pluss hard-refresh av nettlesaren, og stadfesta at "Open Schema from URL" no fungerer for testcase-URL-en. Ingen Steg 1 (ny proxy-infrastruktur) var naudsynt.

Dei to opne spørsmåla over vart aldri formelt svart (kva URL DevTools viste, om fiksen var committa på byggmaskina) — dei er no overflødige sidan `--no-cache`-ombygginga løyste det uansett bakanforliggjande årsak (mest sannsynleg attbruk av eit cacha lag frå eit tidlegare bygg, sidan koden alt var på plass i arbeidstreet uavhengig av commit-status).
