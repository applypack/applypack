# Architecture Decision Records

Each ADR is one screen of "we made decision X because Y, here are the
tradeoffs we accepted". They exist so future-us doesn't waste an
afternoon re-litigating a settled decision.

Format: title, status, context (what problem), decision (what we did),
consequences (what we accept). Aim for 15–30 lines each.

## Index

- [0001 — Hono not Express](./0001-hono-not-express.md)
- [0002 — Worker and web as separate processes](./0002-worker-and-web-as-separate-processes.md)
- [0003 — No queue, just node-cron](./0003-no-queue-just-node-cron.md)
- [0004 — One active profile, not multi-tenant](./0004-single-active-profile.md)
- [0005 — No LinkedIn / Indeed / Workday](./0005-no-linkedin-indeed-workday.md)
- [0006 — Discovery via HN parser, not ATS-vendor lists](./0006-discovery-via-hn-parser.md)

## When to write a new one

Add an ADR when:
- The decision is non-obvious from the code alone
- A future contributor (or you, in 6 months) might reasonably want to undo it
- You can articulate at least two alternatives you considered

Skip an ADR for: dependency picks (zod, pino — obvious), code style
choices (covered in CLAUDE.md), trivial naming.
