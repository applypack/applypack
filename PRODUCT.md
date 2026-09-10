# PRODUCT.md — ApplyPack

Durable product truth for design work. Pair with [SPEC.md](./SPEC.md) (state) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (structure); this file only holds what design
decisions lean on.

## What this is

A self-hosted job-search operations console for one person. A cron worker fetches
postings from ATS boards and aggregators, an AI classifier scores them against the
user's profile, Telegram or Discord delivers alerts, and a local web dashboard (this
design's surface) is where everything is read and acted on: triage jobs, track
applications, tune the profile, manage sources, compare resumes against postings.
The same install has an opt-in employer mode (ADR 0049): a folder of resumes
screened against one position, off by default, its section gone from the menu
when it is off.

## Audience and scene

- One user: the self-hosting engineer running their own job search.
- Checked briefly a few times a day, mostly on a desktop browser at 1440–1920px,
  occasionally on a phone. Daylight, indoor work light — a light theme suits the scene.
- The user is technical; density and precision beat hand-holding.

## The task (Operate mode)

Read four numbers and the newest alerts, drill into a job, act (apply / save /
dismiss / verify / compare resume), adjust settings rarely. Nothing on the surface
persuades or markets; every screen serves a task.

The test for a new feature: does it reduce the guessing in a job search without
taking the decision away from the user? The model marks facts and code scores
(ADR 0012), the text decides what a resume contains (ADR 0045), a person decides
whom to interview (ADR 0047) and calibration never tunes the rubric by itself
(ADR 0052). Another AI output that adds no evidence, feedback or control is not
the priority.

## Brand commitments (standing)

- Name: **ApplyPack**; mark: emerald square with "AP".
- **Emerald is the single brand accent** (#059669 family). Status vocabulary:
  New=blue, Alerted=amber, Applied=emerald, Saved=violet, Dismissed=gray — quiet
  tinted pills, never saturated fills.
- **Light, calm, information-first SaaS visual world** (Linear density, Stripe
  forms, GitHub tables) — pinned by the owner's 2026-08 redesign brief. Dark theme
  may be added later via the token layer only.
- Typography: Inter for UI; monospace strictly for machine values (ids, tokens,
  cron names, durations, code).

## Constraints that shape design

- Server-rendered Hono JSX, no client framework; one CSS build step, run by
  hand (`npm run css` writes the committed `src/web/public/tailwind.css`
  from `tailwind.config.js`) over semantic CSS-variable tokens in
  `src/web/layout.tsx`. Nothing on a page is fetched from a third party.
- Every color flows through semantic tokens (surface / line / ink / accent / status
  tones) so a second theme is a token swap, not a component rewrite.
- Primitives live in `src/web/ui.tsx`; pages compose them and never hand-roll
  Tailwind for shared patterns.
- Dashboard is localhost-only, single user — no marketing surfaces, no auth UI
  beyond optional basic-auth. The first run is a five-step setup (`/welcome`,
  derived from data, skippable), not a funnel.
