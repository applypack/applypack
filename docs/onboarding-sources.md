# Onboarding sources — the analysis behind #154 and #149

Status: analysis, 2026-09-05. Nothing in this document is built. Both issues
are design questions the owner asked to have on paper before code; the
decisions they need are marked **Decision**.

## 1. What is measured, and what is not

- **The step-2 funnel** (fresh install, 2026-09-04, from #154): 2 619 jobs
  fetched from 32 sources in 1.5 minutes (2 failed) → 2 092 stored →
  10 scored in step 4. Three orders of magnitude of work to prove the search
  runs.
- **The default set** (`src/seed.ts`): 37 `Company` rows, 19 active by
  default; every regional board (DOU, Djinni, solid.jobs, the DevITjobs
  sites, Landing.jobs, JobTech, both Arbeitnow rows) ships `active: false`
  (#149).
- **Since v1.57.0 (#148)** the wizard has a step between the profile and the
  first matches: the boards for the search's countries, turned on in one
  press. On a search for 🇺🇦 UA + 🇵🇱 PL that is seven feeds — three DOU
  categories, three Djinni keywords, solid.jobs — probed and enabled by one
  POST (measured on a copy of the live database).
- **Not measured: how long 3–5 sources take against the 32.** `FetchRun`
  and the cron row keep totals only — `sourcesDone`, `jobsFetched`,
  `durationMs`. `runAllFetchers` sees every source start and end and can
  stamp a per-source duration for free; that column is the first deliverable
  of this stage, because every option below is argued from it.

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

1. Per-source `durationMs` in `runAllFetchers` → `FetchRun` and the cron row.
2. One fresh-install walk with #148, numbers per source (this doc, §1).
3. Step 2 = aggregators, plus the country field (Decision B).
4. #149 seed rebalance from the numbers.
5. Decision A surfaces in copy (README, wizard step 3).
