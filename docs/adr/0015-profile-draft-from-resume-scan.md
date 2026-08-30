# 0015 — The profile is drafted from the resume scan, never written by AI

**Status:** Accepted (2026-08-29)

## Context

The `/settings` Profile tab asks for ~14 fields, but only `stackRequired` /
`roleTypes` (the base-filter title gate) and the location block genuinely
need user input — an empty gate admits every fetched job to the classifier
and burns AI credit. Users don't fill long forms, yet almost everything the
form needs is already extracted by the resume scan (`skills`, `role_types`,
`seniority`, `title`) and stored on the `Resume` row. What the scan lacked
was the required-vs-nice-to-have split.

Alternatives considered: (a) auto-update the profile whenever a resume is
uploaded — rejected: users keep several stack-specific resumes (PHP vs JS),
so the latest upload would silently thrash the classifier's behaviour;
(b) a dedicated "scan resume → profile" AI call — rejected: a second call
that re-reads the same text for facts the scan already extracts.

## Decision

- The scan prompt marks `primary_skills` — the 2-5 core languages/frameworks
  of recent day-to-day work, same definition as the match prompt's primary
  stack — stored as `Resume.primarySkills`.
- `src/resume/profile-draft.ts` (pure) maps a scan onto a profile:
  primary → `stackRequired`, remaining skills → `stackNiceToHave`, plus
  `roleTypes` / `seniority`; location, thresholds, rules and routing are
  never touched — a resume cannot know them.
- `POST /settings/profiles/:id/fill-from-resume` renders the draft into the
  profile editor (re-scanning the resume first when `primarySkills` is
  empty). **It persists nothing** — the user reviews and presses Save;
  auto-apply on upload stays out.

## Consequences

✅ Onboarding is upload resume → Fill from resume → tick regions → Save.
✅ Old resumes keep working — the fill route back-fills the scan on demand.
❌ One extra scan call the first time an old resume is used for filling.
❌ The draft lives only in the rendered page: a refresh re-posts, navigation
   away discards it. Accepted — matches the "review before save" intent.

## When to revisit

If profiles grow per-resume (one profile per resume variant), or if users
ask for the fill to run automatically after every upload, revisit (a) with
an explicit opt-in toggle.
