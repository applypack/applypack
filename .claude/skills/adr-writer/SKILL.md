---
name: adr-writer
description: Use when a decision changes architecture, interfaces, the Prisma schema, dependencies, sources policy, or supersedes a prior decision. Contains the ADR template used in docs/adr/ and the register of standing decisions.
---

# ADR Writer

Architecture Decision Records live in `docs/adr/NNNN-slug.md` and are
indexed in `docs/adr/README.md` — add the index line in the same commit.

## When an ADR is required

- New process boundary, HTTP framework, queue, or scheduler choice
- New job source family or a change to the "never scrape" policy (ADR 0005)
- A new seam that swaps implementations (like the AI provider, ADR 0007)
- New dependency with operational weight (a CLI in the image, a DB)
- Superseding any prior ADR

Not required: a new fetcher that follows an existing template, a settings
toggle, UI changes, refactors that keep contracts.

## Template (keep to one screen, 15–30 lines of prose)

```markdown
# NNNN — <decision, stated as a sentence>

**Status:** Accepted (YYYY-MM-DD) | Superseded by NNNN

## Context
What forces the decision; the facts that shaped it (numbers, measured
behaviour, external constraints).

## Decision
What we do, stated so a reviewer can check the code against it. A small
table or interface signature is welcome.

## Consequences
✅ what becomes easier   ❌ what we accept

## When to revisit
The concrete trigger that would reopen this.
```

## Supersede mechanics

The new ADR says `Supersedes NNNN`; the old one's status becomes
`Superseded by MMMM`. Both link. Never edit the substance of an accepted
ADR — write a new one.

## Standing register

- 0001 Hono, not Express, for the dashboard
- 0002 Worker and web are separate processes sharing Postgres
- 0003 node-cron only — no Redis / BullMQ
- 0004 One active profile, not multi-tenant
- 0005 Never scrape LinkedIn / Indeed / Glassdoor / Workday / Wellfound
- 0006 Discovery via the HN parser, not ATS-vendor customer lists
- 0007 One AI provider seam: Messages API (`anthropic_api`) or Claude Code
  CLI (`claude_code`), selected by `AI_PROVIDER`

Check a proposal against these before touching process layout, sources,
scheduling, profiles, or how Claude is called.
