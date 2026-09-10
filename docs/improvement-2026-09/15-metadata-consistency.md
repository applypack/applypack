# §15 — Public metadata consistency

**Verdict: adopt (P2, one PR, no tag) — the plan's three numbers are real, and the repo already has half the guard.**

## What the plan proposes

One source of truth for the source count; a release checklist that updates
homepage, package.json, README, repository description, structured metadata,
docs, release notes.

## What the repo has today (verified 2026-09-10)

The truth: `enum AtsType` has 35 values; minus `MANUAL` (pasted jobs) and
`CAREER_PAGE` (a change watch, never a job) = **33 kinds of source** =
12 ATS vendors + 20 aggregators + the generic `FEED`.

| Surface | Says | State |
| --- | --- | --- |
| `README.md` (4 places) | 33 | correct, **guarded** |
| `site/public/index.html` (4 places incl. JSON-LD) | 33 | correct, **guarded** |
| `package.json` `description` | 24 | stale |
| GitHub "About" (`gh repo view`) | 22 | stale — already an owner item in TASKS §14 |
| `docs/launch/show-hn.md`, `reddit-selfhosted.md`, `awesome-selfhosted-pr.md` | 22, "ten ATS vendors" | stale (twelve now) |
| landing `#open` | "Over a thousand unit tests" | true (2 170), understated |

The guard: `src/source-count.test.ts` (issue #160) derives the count from the
enum and fails CI when README or the landing page say another number — the
plan's "constant / generated metadata source", already built. Its `DOCS` list
simply does not include `package.json` and `docs/launch/`.

## Assessment

Extend the guard rather than write a checklist: a checklist is what went
stale three releases running before #160. The GitHub About text is not in
the repo; it stays an owner click (or one `gh repo edit --description`
command, run with the owner's say-so). The AI-backend count ("5") is stable
and matches `AI_PROVIDER_IDS`; no guard needed.

## Steps → TASKS §20, block `metadata-drift`

- [ ] `package.json` description: 24 → 33, and open with "Runs locally with
      Docker" (§9) — keep the phrase shape `NN sources` so the guard sees it.
- [ ] `docs/launch/*.md`: 22 → 33, "ten ATS vendors" → "twelve", and the
      story line matches the site's (found the job).
- [ ] `source-count.test.ts` `DOCS` += `package.json`, the three launch
      drafts; the test reads the JSON field, not the file, for `package.json`.
- [ ] Owner: GitHub About → the package description (TASKS §14 item), social
      preview from `docs/brand/social-card.png`.
