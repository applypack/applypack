# 0048 — Applicants' resumes are redacted before any model reads them, and they expire

**Status:** Accepted (2026-09-09)

## Context

Every AI call in ApplyPack carried the owner's own data until employer
mode; a screening carries other people's. Ukrainian and European CVs put a
photo, a date of birth, marital status and citizenship in the header, and
under GDPR art. 5 / 22 and the AI Act's Annex III a hiring tool that reads
them is the textbook high-risk case. The candidate side's `Resume` rows are
also read as the owner's own evidence (`store.ts:listOtherResumeSkills`),
so an applicant stored there would start "proving" the owner's skills.

## Decision

- **Own tables, one screening each.** `Screening` → `Applicant` →
  `ScreeningVerdict`, cascading on delete; no talent pool across
  screenings, and nothing in `src/resume/` reads them.
- **Redaction cannot be switched off.** `screening/redact.ts` removes the
  name (and its parts, reversed, hyphen halves), emails, phones, links,
  date of birth, age, marital status and children, gender, citizenship (an
  explicit field, or a bare demonym beside one), a street address, and the
  years on education lines; the city stays because a location gate needs
  it. Name and contacts go to columns of their own, shown to the person
  only; the model reads "Applicant №N". `findLeaks` runs on every
  applicant at intake and again on the scorecard, and the audit line says
  what was removed.
- **Retention is a date, and the cleanup cron enforces it.**
  `Screening.retainUntil` = creation + `AppSettings.screeningRetentionDays`
  (90 by default, 7–365); the weekly cleanup deletes what has passed it,
  files and verdicts included; "Delete with files" does it now, and "Keep
  N more days" extends one screening.
- **The engine is the employer's problem, said out loud.** A screening
  page and the settings tab warn when the first engine in the chain is a
  personal-subscription CLI — the defensible path for other people's data
  is an API under a data-processing agreement or a local model — and they
  do not block. A copy-ready notice for applicants sits on the settings
  tab (`screening/notice.ts`).

## Consequences

✅ Blind screening by construction, minimisation by cascade, a retention
policy that runs without anyone remembering it. ❌ Redaction is regex over
text: a name that is not the first line and not a "Name:" field is not
found (the scorecard's leak line says so), a photo is not text and is
simply never extracted, and a demonym on a language line stays because it
is a language. None of this is a substitute for the notice, the DPIA or
the DPA, which are the employer's.

## When to revisit

A leak-line hit on a real batch that a rule could have caught; a
jurisdiction that requires a bias audit the tool cannot produce (it holds
no protected-group data by design).
