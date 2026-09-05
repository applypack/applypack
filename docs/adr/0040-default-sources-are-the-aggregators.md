# 0040 — The default source set is the aggregators; employer boards are starter packs

**Status:** Accepted (2026-09-05)

## Context

`src/seed.ts` shipped 48 `Company` rows, 32 of them switched on: nine
aggregators (RemoteOK, Remotive, WeWorkRemotely ×2, HN /jobs, Jobicy,
Working Nomads, 4 Day Week, Himalayas) and twenty-three employer boards —
Gusto, Reddit, MongoDB, Affirm, Block, Rippling and the rest of a list
chosen in phase 7 because the boards answered and posted engineering roles.
Every regional feed (DOU, Djinni, solid.jobs, the DevITjobs sites,
Landing.jobs, JobTech, Arbeitnow) shipped off. Issue #149 named the tilt:
every employer board is a US or US-adjacent company, so for a user in
Kyiv, Warsaw or Berlin "the things that run are mostly not for me".

The reason the twenty-three were on was the wizard's step 2 — "does the
search work?" needs postings to show (onboarding-plan §6). On 2026-09-05
the per-source column measured what that costs on a fresh install
(docs/onboarding-sources.md §6): the twenty-three boards supplied 2 027 of
2 618 postings and 38 of 44 seconds of source time, Rippling's board alone
683 rows and 31.7 s; the nine aggregators supplied 591 postings in 17 s,
and step 2 asks the aggregators alone since v1.61.0. Two of the boards
(`GREENHOUSE:pleo`, `LEVER:plaid`) had been dead slugs since the companies
moved to Ashby.

## Decision

The seed ships **the aggregators switched on and the regional feeds off**,
plus one reference board per vendor that has no other row (Tylko,
SoftwareMill, FreshBooks, YouLend, Holidu, Tibber — off). **No employer
board is on by default.** The twenty-two live boards move into the
starter-pack catalog as two new segments — `us-product` (17) and
`eu-product` (Spotify, Pleo, Channable, Digital Science) — with Buffer in
`remote-first`; Niantic's empty board is dropped; the two dead slugs go on
the seed's obsolete list so existing installs lose them on the next boot.
The wizard's boards step offers the packs that fit the running searches
(`packsForSearches`: a country the search names or a group it belongs to,
a required technology, remote work or "anywhere") next to the token feeds
it already offers, and the pack flow returns to the wizard.

The seed's `upsert` never touches `active` on an existing row, so an
install that already has the boards keeps them exactly as they are; only
fresh installs see the new default.

## Alternatives considered

- **Keep the twenty-three on, add regional boards on too.** Every install
  would ask forty boards an hour for a persona it has not met; the tilt
  becomes a pile.
- **Seed everything off** (#149's option 2). Step 2 would have nothing to
  show until the profile step turned sources on — the "prove it works
  first" order of onboarding-plan §6 would be lost, for a first run that
  is empty rather than honest.
- **Ship the boards on but region-gate them at fetch time.** An employer
  board has no place filter: Gusto's board is Gusto's board. Gating would
  have to guess from the company, which is the identity problem ADR 0017
  refuses to solve by guessing.

## Consequences

- A fresh install's hourly tick asks nine sources, not thirty-two — and the
  same nine for a user in Kyiv and one in Austin; the boards for their
  place are one press on the wizard's fourth step, the employer boards one
  preview-and-confirm.
- The starter-pack catalog is now the home of every curated employer
  board; ADR 0017's rule stands — an entry is a hand-verified board, and a
  probe hit is not proof of identity. The twenty-two were verified by the
  fresh-install fetch and the Ashby probes of 2026-09-05.
- The "Sources for your searches" card on /companies still offers the
  token feeds only; the pack picker below it lists every segment. The
  wizard is the one place both are offered from the searches' own facts.
