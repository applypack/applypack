# §24 — Technical audit areas

**Verdict: adopted as the checklist for this pass. What each area produced is in [docs/audit-2026-09-10.md](../audit-2026-09-10.md); this file says how each area was covered and what it is NOT covered by.**

| Area (plan) | How it was covered on 2026-09-10 | Left for the owner / a later pass |
| --- | --- | --- |
| Architecture | module boundaries read against CLAUDE.md's file rules; the route audit named the three handlers carrying domain logic; dead-export scan | a dependency graph (madge-style) was not drawn |
| Backend | every route handler read (145 handlers, 18 files): id parsing, zod vs ad-hoc bodies, length caps, idempotency, GET side effects, redirects, polled JSON | no route was exercised with a malformed body against the running server — the findings are from code |
| Frontend | code inspection of every page for a11y and copy (agent), page timings on the running instance | the four-viewport browser pass (1440 / 1024 / 768 / 390) — see §27 |
| Data / Prisma | schema, 76 migrations, every `findMany` / loop / transaction site read | none |
| AI integrations | every backend's probe, auth error, timeout, JSON handling, stop_reason, failover read | a live failover run (needs two working engines and a forced failure) |
| Prompt safety | fence registry re-read; filename paths traced to prompts; the audit of 2026-09 broke the registry on purpose | a payload run through a live model — it proves nothing the fence test does not |
| Security | SSRF (probed against the built code), uploads/zip, XSS sinks, CSRF guard, basic auth, secrets, command injection, path traversal, `npm audit` | none |
| Privacy | outbound host inventory, log lines in resume/screening/web, blind processing traced to the prompt input | none |
| Performance | query patterns, wide selects, polling, registries, build/test time, page timings | measurements on a populated database (the live one is a fresh baseline) |
| Accessibility | code inspection (labels, names, live regions, focus, motion, keyboard) | screen-reader pass |
| Content | five heaviest pages for the copy rule; top-level docs cross-checked for drift; links and paths verified | the remaining 27 pages |
| Tests | 2 170 tests run twice (no flakes: 0 failures both runs), what they prove, the route gap | — |

The plan's Backend "test every endpoint for …" list (18 conditions × 145
routes) is the shape of a test suite, not an afternoon; the route-smoke
block in TASKS §20 is the honest version of it.
