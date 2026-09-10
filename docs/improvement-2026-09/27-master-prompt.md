# §27 — The master prompt for Claude Code

**Verdict: do not paste it. Two thirds of it is already automated in this repo, the rest was run in this pass, and what remains is three owner-run checks. Below is the trimmed, repo-specific version for the next pass.**

## Why not as written

- Phases 1–2 (map the system, clean baseline) are CLAUDE.md's "Where to
  look" tables plus `npm run lint:types && npm test && npm run build` — all
  green in under ten seconds on 2026-09-10.
- Phase 16 (prompt injection) is a test that fails CI
  (`prompt-fence-registry.test.ts`); the 2026-09 audit already broke it on
  purpose to prove it fires. Re-running payloads through a model proves
  nothing the test does not.
- Phase 10 (scoring) is `score.test.ts`, the `score.mjs` parity test, and
  the hand-run `matrix:compare` / `variance:compare` / `churn:compare`
  tools, each documented in CLAUDE.md with its cost.
- Phases 3, 7, 14's install and fresh-DB paths were verified in §14
  (2026-09-02) and again by the 2026-09-09 baseline.
- Phase 4 asks for Playwright; TASKS §17.2 and
  [ai-engine-improvements.md](../ai-engine-improvements.md) rejected an
  e2e suite with reasons. The gap it points at is real (144 routes, zero
  automated requests) and gets a different answer: a route smoke in CI.
- Phase 24 (create issues from an autonomous session) is against the plan's
  own rules 6–7 and the repo's habit; issues are the owner's to open from
  the report.
- Rules 3, 5, 11–15 are already CLAUDE.md and the `testing-gate` /
  `commit-discipline` skills.

## What this pass ran instead (the checklist that fits this repo)

1. `npm run lint:types && npm test && npm run build`, twice for flakes.
2. `npm audit` (prod and dev), `npm outdated`.
3. The dead-export scan (`scratchpad/dead-exports.mjs`: exports with no
   reference outside their file, split into dead / over-exported / tests-only).
4. Every external link in README, CONTRIBUTING, SECURITY, the site, the
   launch drafts (`curl`, 35 URLs); every backticked `src/…` path in the
   top-level docs exists.
5. The source-count derivation from the enum against every public copy.
6. `docker compose ps`, the live table counts, `curl` timings of nine pages.
7. Five read-only agents over: security/privacy; routes; Prisma; fetchers +
   AI providers + prompt boundaries; a11y + copy. Every P1 re-verified by
   hand against the built code before it went into the report.

## The three checks only the owner can run

- **Provider failover, live**: two engines enabled, the first one's key
  revoked, one classification; watch `/settings` → AI usage and the run
  log. (Code says it works; nobody has watched it fail over since v1.8.)
- **The four-viewport browser pass** on the eight main pages with the
  in-app browser or the Playwright plugin — the `ui-review` skill has the
  checklist; DESIGN.md is the reference. Cheap once the database has data.
- **A populated-database performance pass** (the live instance is a fresh
  baseline today): the `/jobs` facet tally and the `/companies` render at
  5 000 jobs, with `EXPLAIN ANALYZE` on the two queries the data audit
  named.

## For the next pass: the prompt, trimmed

```text
Audit the ApplyPack working tree at HEAD. Read CLAUDE.md first; it is
authoritative. Do not change code. Produce docs/audit-<date>.md in the shape
of docs/audit-2026-09-10.md: commands run, coverage map, findings by area
with severity (P0–P3 as in docs/improvement-2026-09/25-priority-model.md),
file:line evidence for every finding, the clean list with the command that
proved it, needs-maintainer-review, fix order, not tested.

Start from the previous report's "clean" and "not tested" lists and go
elsewhere. Run: lint:types, test (twice), build, npm audit, the dead-export
scan, the link and path checks, the source-count guard. Then read-only
sweeps of: every route handler (ids, bodies, caps, idempotency, GET side
effects), every Prisma call site (indexes, loops, wide selects,
transactions), every fetcher (malformed payload, pagination, dates),
every AI backend (auth, timeout, JSON, stop_reason, failover, logs), every
prompt builder (fence, filenames), every page (a11y, copy rule), the
top-level docs (drift, counts, links). Verify every P1 by hand against the
built code before reporting it. Create no issues; list candidates.
```
