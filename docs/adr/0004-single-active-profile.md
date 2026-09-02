# 0004 — One active Profile, not multi-tenant

**Status:** Superseded by [0028](./0028-parallel-searches-one-call-per-posting.md)
(2026-09-02). Several profiles now run at once and each posting carries a
`JobScore` per search — the table this ADR's last consequence said we would
need. What survives: this is still one person's deployment, not multi-tenant.
No auth, no per-user views; a friend still runs their own compose.

**Was:** Accepted (phase-3.0, reaffirmed at user's request when
asked about giving friends access)

## Context

Phase 3 introduced `Profile` rows with stack / role types / region /
threshold preferences. Three options for how multiple profiles could
work:

- **A. One profile, editable** — simplest.
- **B. Many profiles, one active** — switch via dropdown, "Re-classify
  all" button reruns Claude across existing jobs under the new profile.
- **C. True multi-tenant** — auth, sessions, per-user view of jobs,
  per-user `Job.fitScore` (so two users can have different scores for
  the same job).

The user has expressed two different needs at different times:
1. "I sometimes look as backend, sometimes as full-stack" → want to
   easily swap stacks.
2. "My friend is a Java dev, can he use this too?" → wants someone
   else to use the system with their own profile.

## Decision

**Option B.** Multiple `Profile` rows, exactly one active at a time
(`AppSettings.activeProfileId`). The active one drives every classifier
call, every alert, every filter pass. Switch via `/settings`. After
switching, click "Re-classify all jobs" to rescore existing rows.

## Consequences

✅ Trivial schema. One FK on AppSettings, no per-job-per-user tables.
✅ The user can have "PHP/Laravel + AI" and "Java/Spring (Andrii)" as
distinct profiles, switching for each role hunt.
✅ A friend on the same deployment can create a profile, activate it,
re-classify, and live in the system — the cost is that the *primary*
user's view is now driven by their friend's profile while it's active.
That's acceptable for an occasional shared-use scenario.
✅ Zero auth surface. The dashboard remains localhost-only with optional
basic auth.

❌ Real shared multi-user (everyone has their own concurrent view) is
NOT supported. The pragmatic answer is "your friend runs their own
docker compose on their own laptop" — 5 minutes of setup, full
isolation, no auth code for us to maintain.
❌ Activating a profile invalidates the prompt cache for the next ~5
classifier calls. Imperceptible at our scale.
❌ Per-user `fitScore` is impossible. If we ever truly need it, we'd
introduce a `JobScore { jobId, profileId, fitScore }` table — but
that's substantial schema work we haven't justified.

## When to revisit

If two or more people end up sharing a single deployment for more than
a month and the "their profile is active right now" friction becomes
annoying — that's the signal. Until then, this stays.
