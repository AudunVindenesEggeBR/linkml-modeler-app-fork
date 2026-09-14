# Spec: `podman-compose up --build`/`--force-recreate` let ein gamal container stå att etter rebuild

Status: **Stadfesta feil, dokumentert og retta i README.md/`packages/docs/development.md`.** Ingen kodeendring naudsynt (feilen er i `podman-compose` sjølv, ikkje i dette repoet) — berre dokumentasjon av eit pålieleg workaround.
Dato: 2026-09-14

Ønske/observasjon (ordrett, to meldingar): "no har eg rebygd og redeploya og eg kan ikkje sjå nokon forskjell i nettlesaren", oppfølgt av "eg brukte kommandoen: `podman-compose -f deploy/web/docker-compose.yml up --build -d`".

## Kontekst

Rett før dette vart `specs/done/edge-filter-hide-tree-root-range-edges.md` implementert og verifisert med automatiserte testar (typecheck, ESLint, 626/628 vitest-testar). Brukaren committa endringa sjølv, bygde og redeploya webappen via podman lokalt, og rapporterte at ingen synleg endring dukka opp i nettlesaren — trass i grøne testar og ein tydeleg, isolert kodeendring (ein ny knapp i EDGE FILTERS-seksjonen).

## Rotårsak — stadfesta empirisk, ikkje berre lese i dokumentasjon

Same "verifiser empirisk, ikkje berre les kode"-praksis som resten av `canvas-layout-topdown.md`: køyrde faktiske `podman inspect`-kall før/etter kvar redeploy-variant i staden for å anta at `--build`/`--force-recreate` gjer det dei heiter.

**Steg 1 — stadfesta symptomet.** `podman ps -a` synte at `web_web_1`-containeren var **oppretta 2026-09-09**, sjølv om brukaren nettopp hadde køyrt ein rebuild. `podman inspect localhost/web_web:latest --format '{{.Id}}'` synte eit heilt anna image-ID (bygd for 11 minutt sidan) enn `podman inspect web_web_1 --format '{{.Image}}'` (framleis det gamle imaget frå 9. september). Containeren song altså framleis det gamle imaget, sjølv om eit nytt fanst.

**Steg 2 — stadfesta at `down && up` FAKTISK rettar det.** `podman-compose down` (fjernar containerar) etterfølgt av `podman-compose up -d` synte at den nye containeren no fekk `Created`-tidsstempel = no, og `{{.Image}}` matcha det nyaste `:latest`-imaget nøyaktig. `curl` mot den køyrande appen stadfesta at det nybygde JS-bundlet (innhaldshash `index-BK_D2P0Y.js`) inneheldt strengen `"tree_root range"` — den nye knappe-etiketten frå funksjonen som nett vart implementert.

**Steg 3 — stadfesta at brukaren sin faktiske kommando (`up --build -d`, ÅTT `down`) reproduserer feilen direkte, ikkje berre `--force-recreate` (som vart testa fyrst).** La til ei mellombels, reversert testlinje i `DisplayPanel.tsx` for å tvinge fram eit garantert ulikt image-innhald, køyrde SO `podman-compose -f deploy/web/docker-compose.yml up --build -d` (utan føregåande `down`, nøyaktig kommandoen brukaren oppga). Resultat: eit heilt nytt image vart bygd og tagga `:latest` (stadfesta via `podman inspect localhost/web_web:latest`), MEN `web_web_1`-containeren si `{{.Image}}` OG `{{.Created}}` var **heilt uendra** — framleis det FØRRE imaget, ikkje det splitter nye. Testlinja vart reverta (`git checkout --`) og ein ny, rein `down && up --build -d`-syklus stadfesta at den ekte funksjonen (`tree_root range`-knappen) faktisk ligg i det no køyrande imaget.

**Konklusjon:** dette er ein reell, reproduserbar feil/avgrensing i `podman-compose 1.5.0` (stadfesta versjon, sjå `deploy/web/check-requirements.sh` sin output) — verken `up --build` (brukaren sin faktiske kommando) eller `up --force-recreate` (den fyrste hypotesen som vart testa) klarer å faktisk byte ut ein alt-køyrande container mot eit nybygd image med same tag. Berre ein full `podman-compose down` etterfølgt av `up` gir eit pålieleg resultat. Dette er **ikkje** ein feil i sjølve applikasjonskoden, byggeprosessen, eller ei nettlesar-cache-sak — det er stadfesta på container/image-nivå, før nettlesaren nokon gong var involvert.

## Retta

- `README.md` ("Run everything in containers (Podman)"): nytt avsnitt rett etter `up --build -d`-kommandoen som forklarer at `--build`/`--force-recreate` åleine ikkje er nok, med den pålielege `down`-så-`up`-sekvensen og eit diagnose-tips (samanlikn `podman inspect <container> --format '{{.Image}}'` mot `podman inspect <image>:latest --format '{{.Id}}'`).
- `packages/docs/development.md` ("Deploying the web build with Docker or Podman"): tilsvarande avsnitt, same stad som README-duplikatet vart identifisert i ein tidlegare økt denne dagen (sjå den innleiande samtalen om at brukaren sin faktiske kommando ikkje samsvarte med dokumentasjonen — same to filer, same struktur).

**Ikkje gjort (vurdert og lagt til side):** å endre `deploy/web/check-requirements.sh` sitt føreslåtte kommandoeksempel (`up --build`, utan `-d`) til å inkludere `down` — det eksemplet gjeld FYRSTE gongs oppstart (ingen eksisterande container å vere stale), der buggen ikkje gjeld. Berre REDEPLOY-avsnitta (etter ei kodeendring) er oppdaterte.

## Testcase / stadfesting

1. Bygg og start stacken éin gong (`podman-compose down` for reinsemd, så `up --build -d`).
2. Gjer ei triviell, stadfesta kodeendring (t.d. legg til ei kommentarlinje i ein fil som endar opp i `packages/web/dist`).
3. Køyr `podman-compose -f deploy/web/docker-compose.yml up --build -d` (UTAN føregåande `down`). **Forventa (stadfesta feil):** `podman inspect <container> --format '{{.Image}}'` viser FRAMLEIS det gamle image-ID-et, sjølv om `podman inspect <image>:latest --format '{{.Id}}'` viser eit nytt.
4. Køyr i staden `podman-compose down && podman-compose up --build -d`. **Forventa (stadfesta fiks):** dei to ID-ane matchar, og endringa er synleg i nettlesaren/via `curl`.
