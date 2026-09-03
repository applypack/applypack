# 0031 — A job's location is three columns next to the string, filled by hints and a parser, never by rewriting the string

**Status:** Accepted (2026-09-03)

## Context

`Job.location` was one free-text string, and every consumer read it as
text: the base filter with six regexes, the classifier prompt, the `/jobs`
table. On 2026-09-03 the live database held 1 038 jobs and 949 of 1 035
verdicts were `location mismatch` — both running searches were US-based,
and the 151 European rows already stored could not even be listed, let
alone searched by country. The plan
([country-search-plan.md](../country-search-plan.md)) needs a per-row
place that a profile, a filter and a facet can compare against.

The sources are uneven. Lever, Workable, Recruitee, Breezy and
SmartRecruiters send ISO codes; Ashby, Himalayas and 4dayweek send country
names; WWR sends flags plus ISO long names in one element and a region
label in another; Greenhouse, Pinpoint, Rippling, HN and the pasted jobs
send prose. Measured on the corpus: 250 distinct strings, from "Remote US"
(97 rows) to "REMOTE (US or LATAM; must overlap with US Pacific hours)".
Two-letter codes collide with US states (CA, IN, DE, OR, ME, MT), "Georgia"
is a state and a country, "US" hides inside "Russia" and "campus", and
"UK" is not in the EU.

## Decision

Three columns and a provenance marker on `Job`, filled at every persist
site, with the string left exactly as fetched:

| Column | Meaning |
| --- | --- |
| `workplace` | `REMOTE` / `HYBRID` / `ONSITE` / `UNKNOWN`. Several offices → the softest arrangement named. `UNKNOWN` = nothing said, not "on-site". |
| `countries` | ISO 3166-1 alpha-2, in order of appearance. For `REMOTE` rows: where the candidate may live. For `HYBRID` / `ONSITE`: where the office is. |
| `regions` | Only the markers the source or the text **named**: `EU`, `EUROPE`, `EMEA`, `WORLDWIDE`, `AMERICAS`, `NORTH_AMERICA`, `LATAM`, `APAC`, `DACH`, `NORDICS`, `BENELUX`, `CEE`. Never derived from countries — a group is expanded at query time with `countriesOf()`. |
| `locationSource` | `structured` (the source's own fields decided), `parsed` (the string alone), `null` (nothing recognised). |

Three layers fill them, in order of trust. A fetcher passes what its feed
says in structured fields as `NormalizedJob.locationHints`; the pure
parser `src/location.ts` reads the string; hints come first and the text
can only add. A third layer, the classifier, is stage 2's. The gazetteer
is one hand-written file, `src/countries.json` — 86 countries with their
spellings, cities and flags, and the region groups — read through
`src/countries.ts`; no geocoding, no country library, no time-zone
arithmetic.

Semantics the code enforces and the tests pin:

- **Geography and law are different codes.** `EUROPE` contains GB, CH, NO,
  UA; `EU` does not. "EU time zones" is `EUROPE` (a place), "EU only" is
  `EU` (a right). The parser records the marker; whether it is hard or
  soft is the classifier's call.
- **A bare "Remote" is `REMOTE` with empty countries and regions — never
  worldwide.** The `/jobs` facet shows such rows as "Unknown". 51 rows in
  the corpus.
- **A two-letter code is a country only in a telling position**: after an
  arrangement word ("Remote (US)", "Remote · DE"), in a bare segment whose
  neighbour is not a known city of a state, or when the previous segment is
  a known city of that country ("Kyiv, UA"). "City, ST" after a known city
  of another country is the state ("Birmingham, AL" → US).
- **Names that are two places resolve only through context** — "Georgia"
  is absent from the aliases; Atlanta and Tbilisi decide. Jersey, Guernsey,
  the Isle of Man and Kosovo have no entry: no code is guessed.
- **A demonym counts only beside a residency word** ("Romanian residents
  only" → RO; "DUTCH REQUIRED" → nothing, it is a language).
- **The string is never written by this module.** Like `apply-link.ts`, the
  parser adds columns; `Job.location` and `description` stay byte-for-byte
  what the source sent, and the backfill compares checksums of both before
  and after.

The persist sites are `jobs/process-jobs.ts` (fetched rows, with hints) and
`jobs/manual-job.ts` (pasted rows, string only); `/target` still writes the
arrangement into the string because the classifier prompt reads the string
(stage 2 changes that). `scripts/backfill-locations.ts --dry-run` fills the
existing rows without an AI call and prints the distribution; it skips rows
marked `structured` and never touches a `structured` row's hints, which it
cannot reproduce.

## Consequences

✅ 1 021 of 1 038 rows became filterable in seconds, no AI spend; `/jobs`
gained place, workplace and posted facets with counts, and `q` matches the
location. Stage 2 (profile countries, prompt) has columns to compare
against, and every source that sends structure keeps it.
✅ The corpus is a test: `src/location-corpus.json` pins the reading of all
250 strings, so a parser change that moves a row has to say why.
❌ The parser is a hint layer and says so: "REMOTE (2h overlap with US
Pacific)" reads as US, "Hybrid remote in Milwaukee" as remote (the softest
word wins). The classifier corrects such rows in stage 2; the parser never
claims a residence requirement.
❌ Facet counts are tallied in the route from a four-column read of the
rows matching the other filters (1 038 rows today). Past ~50k rows the
tally moves into an `unnest()` group-by in SQL.
❌ 86 countries is a scope, not the world. A country outside the gazetteer
parses to nothing and shows as "Unknown"; adding one is a line of JSON.

## When to revisit

When stage 2 writes `locationSource = 'ai'` and the classifier's location
block disagrees with the parser on more than a handful of rows — that is
the moment to move rules from the prompt into the parser, or to retire
parser rules the model does better. And when a source arrives whose
structured fields carry a subdivision or a time zone the model needs (JobTech's
`workplace_address`), which would be the first argument for a fourth column.
