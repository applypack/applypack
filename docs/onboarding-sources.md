# Onboarding sources — the analysis behind #154 and #149

Status: analysis 2026-09-05, measured and built the same day — §6 holds the
numbers and the decisions as taken. Both issues are design questions the
owner asked to have on paper before code; the decisions they need are marked
**Decision**.

## 1. What is measured, and what is not

- **The step-2 funnel** (fresh install, 2026-09-04, from #154): 2 619 jobs
  fetched from 32 sources in 1.5 minutes (2 failed) → 2 092 stored →
  10 scored in step 4. Three orders of magnitude of work to prove the search
  runs.
- **The default set** (`src/seed.ts`): 48 `Company` rows, 32 active by
  default — 23 per-company boards and 9 aggregators; every regional board
  (DOU, Djinni, solid.jobs, the DevITjobs sites, Landing.jobs, JobTech, both
  Arbeitnow rows) ships `active: false` (#149). (#149's own count, 37 / 19,
  was out of date.)
- **Since v1.57.0 (#148)** the wizard has a step between the profile and the
  first matches: the boards for the search's countries, turned on in one
  press. On a search for 🇺🇦 UA + 🇵🇱 PL that is seven feeds — three DOU
  categories, three Djinni keywords, solid.jobs — probed and enabled by one
  POST (measured on a copy of the live database).
- **Was not measured: how long 3–5 sources take against the 32.** `FetchRun`
  and the cron row kept totals only — `sourcesDone`, `jobsFetched`,
  `durationMs`. `runAllFetchers` sees every source start and end and stamps
  a per-source duration for free now (`SourceStat`, the `bySource` list on
  the row); §6 is that measurement.

## 2. The audience question (gates #154)

The product is developer-shaped end to end, and it should say so or change:

- `AtsType` is a list of engineering boards and vendors.
- `SCAN_SYSTEM` opens *"You read a software engineer's resume"*;
  `primary_skills` is defined as the languages, runtimes and frameworks the
  day-to-day code is written in.
- The classifier caps a posting at 35 when none of the search's required
  tech appears; a product manager's resume scanned to `primarySkills =
  ['sql']` (#157) — an honest reading, and fatal as a required stack.

**Decision A — who is this for.** Two honest answers:

1. *Engineers, said out loud.* The README and the wizard say it; step 3
   warns when a resume reads as a non-engineering role ("this resume reads
   as a product role — ApplyPack's boards and scoring rules are built for
   engineering roles") and does not fill the required stack from it. Cheap,
   truthful, and it stops the PM case from silently scoring every posting
   at 35.
2. *A second profile shape* with no stack gate, its own keyword rubric and
   non-engineering sources. A new classifier rubric and a new source list,
   not a wizard change; nothing in the tracker asks for it yet.

Recommendation: 1 now, 2 only when a user asks for it with a resume in hand.

## 3. #154 — step 2 runs before the profile exists

The options the issue lists, with what the measurements say:

| Option | Verdict |
|---|---|
| A. Reorder — profile before search | No. The wizard's promise is a real number in under a minute; a resume upload and scan first costs half a minute of AI before any proof, and the stage-3 decision in onboarding-plan §6 ("prove it works before you invest") stands. |
| B. Keep the order, shrink the proof | **Yes.** Step 2 asks the aggregators only. They need no company rows and each answers with hundreds of postings; the twelve per-company vendors add little to a first impression and cost most of the requests. v1.56.0 gave the split a name (`sourceFamily` in `src/web/source-groups.ts`), so the filter is one predicate on the active list. |
| C. One question first | **A field, not a step.** "Where do you work?" — the country chip input the profile editor already has — written to the primary search's `countries` before the fetch. The four self-narrowing aggregators (Jobicy, Himalayas, 4 Day Week, Teamtailor) then narrow at step 2, and the boards of step 4 are ready the moment the profile lands. |
| D. Leave as is | The wrong-audience first impression stays for every non-US user; #148 fixed the second half (the boards) but not the first (2 000 rows nobody asked for). |

**Decision B — B plus the country field, in that order.** Measure first:
with the per-source column in place, one fresh-install run says what the
aggregators alone cost against the 32 (the guess is "seconds, not minutes", and it
is a guess until the column exists — which sources took the 1.5 minutes and
which two failed is not recorded anywhere today).

Step 4's ten-job batch means most of the 2 092 stored rows are never read at
onboarding. That is by design: `score-pick.ts` scores the ten *best*
matches, and the hourly watch scores new ones as they arrive. Fetching less
at step 2 changes nothing there — the rows are cheap to hold and the watch
needs them.

## 4. #149 — the default set was chosen for nobody

Blocked on #148, which shipped. The measurement it asked for is now
possible: on a fresh install, walk step 3 with a non-US resume, take step 4's
one press, and count what the next tick finds per source. Only then rebalance
the seed. The safer shape stays the issue's option 1 — keep the self-narrowing
aggregators on, move the US company boards into a starter pack the wizard
offers — and option 2 (seed everything inactive) needs that measurement
before it can be argued.

## 5. Order

1. Per-source `durationMs` in `runAllFetchers` → `FetchRun` and the cron row. — done, v1.61.0
2. One fresh-install walk with #148, numbers per source (this doc, §6). — done
3. Step 2 = aggregators, plus the country field (Decision B). — done, v1.61.0
4. #149 seed rebalance from the numbers. — done, v1.62.0 (§7, ADR 0040)
5. Decision A surfaces in copy (README, wizard step 3). — done, v1.61.0

## 6. Measured, then built (2026-09-05)

A fresh install — migrate, seed, the bootstrapped blank profile — ran step 2
twice on a throwaway database, minutes apart, and the new per-source column
says where the time went:

| Step 2 asks | sources | postings | stored | run | source time | slowest |
|---|---|---|---|---|---|---|
| every active source (v1.60) | 32, 2 failed | 2 618 | 2 087 | 83 s | 44 s | Rippling 31.7 s for 683 rows; 4 Day Week 3.1 s; everything else ≤ 1.4 s |
| the aggregators alone (v1.61) | 9 | 591 | 531 | 17 s | 6.6 s | 4 Day Week 2.9 s |

- A run is longer than its source time because the walk waits a polite
  second between boards (ADR 0035): 32 sources cost about 31 s of waiting
  on their own.
- The two failures are the seed's own: `GREENHOUSE:pleo` and `LEVER:plaid`
  answer `slug_gone` — both companies moved to Ashby (31 and 103 open jobs
  there, probed the same day). #149's seed change re-points them.
- The 23 company boards supplied 2 027 of the 2 618 postings and 38 of the
  44 s. One of them, Rippling's own board, is 683 rows and 72 % of the
  source time: a fixed US employer list buying the wizard's proof at the
  price of a minute, for a user who may not be in the US.

**Decision A, taken: engineers, said out loud.** The README (the intro and
the setup walk), the wizard's resume step, and `profile-draft.ts`: a scan
whose title or role words read as a product / project / programme /
delivery manager or owner, recruiter, marketing, sales, account manager,
customer success, designer, HR or business analyst keeps the required stack
and says why (`readsAsNonEngineering`). Option 2 — a second profile shape —
waits for a user with such a resume in hand.

**Decision B, taken: the aggregators alone, plus the country field.**
`POST /welcome/search` walks the sources `sourceFamily` calls aggregators
(`FetchWalkOptions.only`) and hunts where "Where do you work?" says
(`FetchWalkOptions.places`), the answer written to the primary search first,
so the profile step starts from it and the boards step can offer for it. The
company boards join the hourly watch once the profile exists; "Fetch now" on
the Overview and `/runs` still asks every source.

Found on the way: every attempt stamps a source's `nextCheckAt` an interval
ahead (ADR 0036) and the manual run honoured it, so the second test search
on the fresh install — two minutes after the first — walked **0 sources in
28 ms**, and "Fetch now" within the hour after a tick did the same. A manual
run asks every selected source now; re-run: 9 sources, 533 postings.

## 7. #149 after the numbers

Step 2 no longer needs the company boards to prove the search works, which
removes the reason the 23 were active (§4, onboarding-plan §6). The seed can
ship the aggregators on and the company boards as a starter pack the wizard
offers — the issue's option 1 — without an emptier first run: 591 postings
in 17 s is the proof, and it is the same proof for a user in Kyiv and one in
Austin. Done in v1.62.0 — the decision and its alternatives are ADR 0040;
the wizard's boards step offers the packs that fit the searches
(`packsForSearches`), and the seed's two dead slugs (Pleo, Plaid — both on
Ashby since) go on its obsolete list.
