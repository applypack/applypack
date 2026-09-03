# 0032 — A search hunts in countries and groups; the classifier reads the posting's place once and may narrow the parser's

**Status:** Accepted (2026-09-03)

## Context

ADR 0031 gave every job three location columns. The other side of the
comparison still spoke a different language: a profile had `remoteOk`,
`hybridOk` and six pill regions (`US, Americas, EU, UK, APAC, Worldwide`),
the base filter matched those pills with six regexes over the location
string, and the classifier's rules were written for "a US-based search" —
their words. Measured before this change: 949 of 1 035 verdicts were
`location mismatch`, every European country had zero `true` (GB 0/45,
PL 1/29, DE 0/14), and the two profiles said `{US, Americas}` and `{US}`.
The wall was the profile, not the data. Two of the six pills were countries
wearing a region's hat (`US`, `UK`).

## Decision

**The profile uses the job's vocabulary.** `Profile.countries` (ISO-2),
`Profile.regions` (group codes from `src/countries.json`) and
`Profile.workplace` (`Workplace[]`, the arrangements accepted) replace
`remoteOk`, `hybridOk` and `remoteRegions` in one migration that maps the
old pills — `US → countries US`, `UK → countries GB`, `Americas / EU / APAC /
Worldwide → regions` — and drops the old columns, so there is never a moment
with two models. A group is stored as a group (`["EU"]`, never 27 codes);
both lists empty means anywhere; an empty `workplace` means any arrangement.
`onsiteCities` stays for city-level precision. The editor is one control:
workplace pills, a country chip input with gazetteer suggestions
(`public/countries.mjs` over `GET /countries.json`; the textarea takes any
spelling without JS), region pills.

**The base filter compares sets and passes every unknown to the model.** A
listed on-site city in the string admits outright; an arrangement the
search does not accept rejects; when both sides name places they must
overlap, with groups expanded to members on both sides — PL sits inside an
EU search, "Europe" on a posting reaches an EU search, WORLDWIDE reaches
everything. A posting with `UNKNOWN` workplace or no place at all goes to
the classifier, as before. Consequence measured on the corpus: hybrid
postings no longer reach a remote-only search (0 of 65 had ever matched).

**The prompt is generic and speaks codes.** `describeLocation` emits
`remote from: PL, DE, EU; hybrid in: Warsaw` — codes keep eight searches
under budget (9 118 → under 11 000 chars, guard-tested). The rules name the
groups once, distinguish EU (law) from EUROPE (geography), require the
office's city or country for hybrid / on-site, forbid inferring remote
eligibility from an office address, and default to false. The user prompt
carries the parser's reading (`Location as parsed from the source: REMOTE ·
countries PL, DE`) outside the fence — our own codes, not the posting's text.

**The classifier's place is shared and may only narrow.** The reply gains a
top-level `location` block next to salary — read once per posting, not per
search — validated against the gazetteer (unknown codes dropped, the block
optional). `jobs/location-merge.ts` merges it into the stored columns under
one rule: the model wins only where it is more specific — an arrangement
where the parser had UNKNOWN, countries where the parser had none or a
strict subset of the parser's list, regions where the parser had none — and
`locationSource` becomes `ai` when it changed something. It never blanks a
structured hint. The backfill skips `structured` and `ai` rows alike.

**The job page says why.** `jobs/location-reason.ts` turns the two sides'
columns into one line ("open to Poland; this search hunts in United States,
Americas"; "hybrid role; this search accepts remote"), shown next to
"location mismatch"; null when the columns cannot explain it and the
summary must.

## Consequences

✅ A search can say "remote from PL, DE, NL or anywhere in the EU; hybrid in
Warsaw" in one control, and the prompt repeats exactly that back. "Save &
re-classify" fills the `UNKNOWN` rows through the merge; no special run.
✅ One vocabulary end to end: gazetteer → parser → columns → filter → prompt
→ reply → merge → facets.
❌ The per-search `location_match` stays a boolean the model sets; the
reason line explains the structural cases only. Residence and relocation
(plan §5) are still not expressible — stage 4.
❌ The migration drops columns. The rollback is the pre-migration dump, not
a down migration; taken and kept for this release.

## When to revisit

When stage 4 adds `residence` / `relocation`: the rules that read "a search
that lists that country" become "the candidate lives in, or holds the right
to work in"; and when the corpus shows the merge narrowing wrongly more than
a handful of times — that is the signal to let the model override the parser
rather than only narrow it.
