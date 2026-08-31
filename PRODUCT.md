# PRODUCT.md — applypack

Durable product truth for design work. Pair with [SPEC.md](./SPEC.md) (state) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (structure); this file only holds what design
decisions lean on.

## What this is

A self-hosted job-search operations console for one person. A cron worker fetches
postings from ATS boards and aggregators, an AI classifier scores them against the
user's profile, Telegram delivers alerts, and a local web dashboard (this design's
surface) is where everything is read and acted on: triage jobs, track applications,
tune the profile, manage sources, compare resumes against postings.

## Audience and scene

- One user: the self-hosting engineer running their own job search.
- Checked briefly a few times a day, mostly on a desktop browser at 1440–1920px,
  occasionally on a phone. Daylight, indoor work light — a light theme suits the scene.
- The user is technical; density and precision beat hand-holding.

## The task (Operate mode)

Read four numbers and the newest alerts, drill into a job, act (apply / save /
dismiss / verify / compare resume), adjust settings rarely. Nothing on the surface
persuades or markets; every screen serves a task.

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

- Server-rendered Hono JSX, no client framework, no CSS build step (Tailwind Play
  CDN + semantic CSS-variable tokens in `src/web/layout.tsx`).
- Every color flows through semantic tokens (surface / line / ink / accent / status
  tones) so a second theme is a token swap, not a component rewrite.
- Primitives live in `src/web/ui.tsx`; pages compose them and never hand-roll
  Tailwind for shared patterns.
- Dashboard is localhost-only, single user — no marketing surfaces, no onboarding
  funnel, no auth UI beyond optional basic-auth.
