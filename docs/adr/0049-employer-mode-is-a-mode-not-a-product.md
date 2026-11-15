# 0049 — Employer mode is a switchable mode, not a second product and not a card

**Status:** Accepted (2026-09-09); see the 2026-09-24 addendum

## Context

Bulk screening is the other side of the table from everything ApplyPack
does — README's first sentence is "gets your resume past the keyword
filter", and this *is* the filter. hr-screening-plan.md §5 weighed three
homes: one more card on the candidate pages (mixes the sides, and the
legal surface of ADR 0048 lands on the whole product), a separate product
vendoring `src/resume/` (the repo has no package structure to pay for
that), or an explicit mode. Nazar's ask added a constraint: the feature
may have to be turned off — or removed — later if nobody uses it.

## Decision

- `AppSettings.employerMode`, off by default. While it is off the
  "Screening" menu item is not rendered and every `/screen` route
  redirects to the settings tab that explains it (`web/employer-mode.ts`);
  stored screenings keep their retention dates meanwhile.
- Everything of it lives in three places and nowhere else: `src/screening/`
  (pure modules, `store.ts`, `batch.ts`), `src/web/routes/screen.tsx` with
  its four pages and one served module, and the "Screening" settings tab.
  Its only touches on the rest are one guarded nav item, one route mount,
  one delete in the cleanup cron, two settings columns and three tables.
  The worker never imports `src/screening/` (0008's rule).
- It reuses, never forks: the posting brief (0044) is the rubric draft,
  `extractResumeText` and `zip.ts` are the intake, `createLimiter` and the
  run registry are the batch, `evidence.ts` and the keyword matcher are the
  anchor's floor, `MANUAL` jobs are the position. A screening call goes
  through `askForJson` with its own builder in the fence registry.
- Removing it is: drop the directory, the route file and its pages, the
  settings tab, the nav item, the cleanup line, and one migration that
  drops the three tables and two columns.

## Consequences

✅ Off by default, one switch to hide, one afternoon to delete; the
candidate side is untouched in behaviour and in prompt. ❌ Two products'
worth of copy in one dashboard: the settings tab has to explain a legal
regime the rest of the app never mentions, and "Screening" in the menu
next to "Compare" is only clear because it is off until asked for.

## When to revisit

The mode is on in no install after a few releases (delete it), or a second
user of it needs multi-user (which SPEC.md rules out — then it is a
product, and ADR 0049 was the wrong answer).

## Addendum (2026-09-24): what changed since

- "its four pages and one served module": five pages in `src/web/pages/`
  since v2.4.0 (`screen-list`, `screen-new`, `screen-detail`,
  `screen-applicant`, and `screen-compare` from
  [0051](./0051-a-shortlist-is-compared-head-to-head-twice.md)). The served
  module is still `src/web/public/screen.mjs`. Beside them sit
  `src/web/employer-mode.ts` and two view helpers, `src/web/screen-view.ts`
  and `src/web/screen-compare.ts`.
- "two settings columns and three tables": four tables since v2.4.0, with
  `ScreeningComparison`
  ([0051](./0051-a-shortlist-is-compared-head-to-head-twice.md)). Removing
  the mode drops four.

## Addendum (2026-11-15): a posting pasted for a screening is not a job of the search

Found live (#567): a posting pasted on **New screening** was stored as a
Saved job, so it showed on the Overview and in Jobs, could be scored against
the user's own searches, and stayed after **Delete screening**. A screening
still needs a `jobId` (the rubric draft reads the posting brief by it), so the
row stays and is marked instead: `Job.forScreening`.

- Set only by `/screen/new`'s paste path (`createManualJob(…, { forScreening: true })`).
- Left out of `/jobs` and its counts, the Overview, the job pickers of Tailor
  resume, Cover letter and New screening, "Save & re-classify" and the setup
  facts. The job's own page still opens from the screening.
- Deleted with the last screening that reads it, by `store.ts:deleteScreening`
  and by the retention sweep in `cleanup-job.ts`.
- Pasting the same text on **Paste a job** clears the flag: it is the user's
  job from then on. A posting already in the user's jobs that a screening is
  started from is never flagged.
- Rows stored before this are not touched: nothing says which of them were
  pasted for a screening.
